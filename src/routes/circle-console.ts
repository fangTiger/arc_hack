import { Router } from 'express';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import {
  readCircleConsoleProofArtifactSummary,
  type CircleConsoleProofArtifactSummary
} from '../domain/circle-console/artifacts.js';
import {
  formatCircleConsoleProofError,
  parseCircleConsoleEnv,
  runCircleConsoleProof,
  type CircleConsoleProofEnv,
  type CircleConsoleProofResult
} from '../domain/circle-console/proof.js';
import { extractSafeErrorMessage, sanitizeSensitiveValue } from '../support/sensitive.js';

type EnvSource = Record<string, string | undefined>;

export type CircleConsoleStatus = {
  apiKeyConfigured: boolean;
  usageReceiptAddressConfigured: boolean;
  artifactPath: string;
  artifactSummary: CircleConsoleProofArtifactSummary | null;
  error?: string;
};

export type CircleConsoleProofService = {
  getStatus: () => Promise<CircleConsoleStatus>;
  runProof: () => Promise<CircleConsoleProofResult>;
};

type CreateCircleConsoleRouterOptions = {
  proofService?: CircleConsoleProofService;
  envSource?: EnvSource;
  nodeEnv?: string;
};

class CircleConsoleRouteError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'CircleConsoleRouteError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

const SENSITIVE_KEY_PATTERN = /(api.?key|secret|password|token)/i;
const DEFAULT_TEST_MODE_BLOCK_MESSAGE = 'Circle Console proof runner is disabled in test mode without an injected proof service.';
const DEFAULT_RUN_DISABLED_MESSAGE = 'Set CIRCLE_CONSOLE_PROOF_ENABLED=true to allow Circle Console proof runs.';

const getEnvValue = (source: EnvSource, key: string): string | undefined => {
  const value = source[key]?.trim();
  return value ? value : undefined;
};

const isCircleConsoleProofEnabled = (source: EnvSource): boolean => {
  return getEnvValue(source, 'CIRCLE_CONSOLE_PROOF_ENABLED')?.toLowerCase() === 'true';
};

const resolveArtifactPath = (source: EnvSource): string => {
  return getEnvValue(source, 'CIRCLE_CONSOLE_PROOF_ARTIFACT_PATH') ?? join(process.cwd(), 'artifacts', 'circle-console', 'proof.json');
};

const collectSensitiveEnvValues = (source: EnvSource): string[] => {
  return Object.entries(source)
    .filter(([key, value]) => SENSITIVE_KEY_PATTERN.test(key) && typeof value === 'string' && value.trim().length > 0)
    .map(([, value]) => value!.trim());
};

const isSensitiveResponseKey = (key: string): boolean => {
  return SENSITIVE_KEY_PATTERN.test(key) && !/(configured|enabled)$/i.test(key);
};

const redactSensitiveKeys = <Value>(value: Value): Value => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveKeys(entry)) as Value;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        isSensitiveResponseKey(key) ? '[REDACTED]' : redactSensitiveKeys(entry)
      ])
    ) as Value;
  }

  return value;
};

const sanitizeCircleConsolePayload = <Value>(value: Value, envSource: EnvSource): Value => {
  return sanitizeSensitiveValue(redactSensitiveKeys(value), {
    sensitiveValues: collectSensitiveEnvValues(envSource)
  });
};

const applyNoStoreHeaders = (response: Response): void => {
  response.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  response.set('Pragma', 'no-cache');
  response.set('Expires', '0');
};

const wrapConfigError = (message: string): CircleConsoleRouteError => {
  return new CircleConsoleRouteError(400, 'circle_console_config_invalid', message);
};

const wrapTestModeRunDisabledError = (): CircleConsoleRouteError => {
  return new CircleConsoleRouteError(409, 'circle_console_proof_disabled', DEFAULT_TEST_MODE_BLOCK_MESSAGE);
};

const collectSensitiveRequestFields = (value: unknown, parentPath?: string): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectSensitiveRequestFields(entry, `${parentPath ?? 'body'}[${index}]`));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    const path = parentPath ? `${parentPath}.${key}` : key;

    if (SENSITIVE_KEY_PATTERN.test(key)) {
      return [path];
    }

    return collectSensitiveRequestFields(entry, path);
  });
};

const rejectSensitiveRequestFields = (body: unknown): void => {
  const sensitiveFields = collectSensitiveRequestFields(body);

  if (sensitiveFields.length > 0) {
    throw new CircleConsoleRouteError(
      400,
      'circle_console_request_invalid',
      `Circle Console proof request body must not include sensitive fields: ${sensitiveFields.join(', ')}`
    );
  }
};

const buildCircleConsoleStatus = async (envSource: EnvSource): Promise<CircleConsoleStatus> => {
  const apiKeyConfigured = Boolean(getEnvValue(envSource, 'CIRCLE_API_KEY'));
  const usageReceiptAddressConfigured = Boolean(getEnvValue(envSource, 'USAGE_RECEIPT_ADDRESS'));
  const artifactPath = resolveArtifactPath(envSource);
  const artifactSummary = await readCircleConsoleProofArtifactSummary(artifactPath);

  if (!apiKeyConfigured) {
    return {
      apiKeyConfigured,
      usageReceiptAddressConfigured,
      artifactPath,
      artifactSummary
    };
  }

  try {
    parseCircleConsoleEnv(envSource);

    return {
      apiKeyConfigured,
      usageReceiptAddressConfigured,
      artifactPath,
      artifactSummary
    };
  } catch (error) {
    return {
      apiKeyConfigured,
      usageReceiptAddressConfigured,
      artifactPath,
      artifactSummary,
      error: formatCircleConsoleProofError(error, {
        apiKey: getEnvValue(envSource, 'CIRCLE_API_KEY'),
        artifactPath,
        apiBaseUrl: getEnvValue(envSource, 'CIRCLE_API_BASE_URL'),
        usageReceiptAddress: getEnvValue(envSource, 'USAGE_RECEIPT_ADDRESS')
      } satisfies Partial<CircleConsoleProofEnv>)
    };
  }
};

const createDefaultCircleConsoleProofService = (envSource: EnvSource, nodeEnv?: string): CircleConsoleProofService => {
  return {
    getStatus: async () => buildCircleConsoleStatus(envSource),
    runProof: async () => {
      if (nodeEnv === 'test') {
        throw wrapTestModeRunDisabledError();
      }

      let env;

      try {
        env = parseCircleConsoleEnv(envSource);
      } catch (error) {
        throw wrapConfigError(formatCircleConsoleProofError(error, { apiKey: getEnvValue(envSource, 'CIRCLE_API_KEY') }));
      }

      try {
        return await runCircleConsoleProof({
          env,
          fetchImpl: fetch,
          requestIdFactory: randomUUID
        });
      } catch (error) {
        throw new CircleConsoleRouteError(500, 'circle_console_proof_failed', formatCircleConsoleProofError(error, env));
      }
    }
  };
};

const respondWithCircleConsoleError = (
  response: Response,
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
  envSource: EnvSource
): void => {
  applyNoStoreHeaders(response);

  if (error instanceof CircleConsoleRouteError) {
    response.status(error.statusCode).json({
      error: error.code,
      message: error.message
    });
    return;
  }

  response.status(500).json({
    error: fallbackCode,
    message: formatCircleConsoleProofError(
      extractSafeErrorMessage(error, fallbackMessage, {
        sensitiveValues: collectSensitiveEnvValues(envSource)
      }),
      { apiKey: getEnvValue(envSource, 'CIRCLE_API_KEY') }
    )
  });
};

export const createCircleConsoleRouter = (options: CreateCircleConsoleRouterOptions = {}) => {
  const envSource = options.envSource ?? process.env;
  const proofService = options.proofService ?? createDefaultCircleConsoleProofService(envSource, options.nodeEnv);
  const router = Router();

  router.get('/status', async (_request, response) => {
    applyNoStoreHeaders(response);

    try {
      const status = await proofService.getStatus();
      response.status(200).json(
        sanitizeCircleConsolePayload(
          {
            ...status,
            runEnabled: isCircleConsoleProofEnabled(envSource)
          },
          envSource
        )
      );
    } catch (error) {
      respondWithCircleConsoleError(
        response,
        error,
        'circle_console_status_unavailable',
        'Circle Console proof status unavailable.',
        envSource
      );
    }
  });

  router.post('/proof', async (request, response) => {
    applyNoStoreHeaders(response);

    try {
      rejectSensitiveRequestFields(request.body);

      if (!isCircleConsoleProofEnabled(envSource)) {
        throw new CircleConsoleRouteError(403, 'circle_console_proof_disabled', DEFAULT_RUN_DISABLED_MESSAGE);
      }

      const result = await proofService.runProof();
      response.status(200).json(sanitizeCircleConsolePayload(result, envSource));
    } catch (error) {
      respondWithCircleConsoleError(
        response,
        error,
        'circle_console_proof_failed',
        'Circle Console proof failed.',
        envSource
      );
    }
  });

  return router;
};
