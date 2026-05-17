import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { Router } from 'express';
import type { Response } from 'express';
import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import type {
  Erc8004AgentArtifact,
  Erc8183JobArtifact
} from '../domain/arc-standards/artifacts.js';
import {
  formatErc8004AgentError,
  parseErc8004AgentEnv,
  runErc8004AgentProof,
  type Erc8004AgentProofResult
} from '../domain/arc-standards/erc8004-agent.js';
import {
  formatErc8183JobError,
  parseErc8183JobEnv,
  runErc8183JobProof,
  type Erc8183JobProofResult
} from '../domain/arc-standards/erc8183-job.js';
import { extractSafeErrorMessage, sanitizeSensitiveValue } from '../support/sensitive.js';

type EnvSource = Record<string, string | undefined>;

type ArcProofArtifactSummary =
  | {
      kind: 'erc8004';
      agentId: string;
      owner: string;
      validator: string;
      primaryTxHash: Hex;
      explorerUrl: string;
      metadataUri?: string;
      updatedAt?: string;
    }
  | {
      kind: 'erc8183';
      jobId: string;
      client: string;
      provider: string;
      finalStatus: string;
      primaryTxHash: Hex;
      explorerUrl: string;
      budgetUsdc?: string;
      updatedAt?: string;
    };

export type ArcProofStatusEntry = {
  configured: boolean;
  missingEnv: string[];
  artifactPath: string;
  artifactSummary: ArcProofArtifactSummary | null;
  error?: string;
};

export type ArcProofStatus = {
  erc8004: ArcProofStatusEntry;
  erc8183: ArcProofStatusEntry;
};

export type ArcProofService = {
  getStatus: () => Promise<ArcProofStatus>;
  runErc8004: () => Promise<Erc8004AgentProofResult>;
  runErc8183: () => Promise<Erc8183JobProofResult>;
};

type CreateArcProofRouterOptions = {
  proofService?: ArcProofService;
  envSource?: EnvSource;
  nodeEnv?: string;
};

class ArcProofRouteError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'ArcProofRouteError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

const ERC8004_REQUIRED_ENV = [
  'ARC_RPC_URL',
  'ARC_AGENT_OWNER_PRIVATE_KEY',
  'ARC_AGENT_VALIDATOR_PRIVATE_KEY',
  'ARC_AGENT_METADATA_URI'
] as const;
const ERC8183_REQUIRED_ENV = ['ARC_RPC_URL', 'ARC_JOB_CLIENT_PRIVATE_KEY', 'ARC_JOB_PROVIDER_PRIVATE_KEY'] as const;
const SENSITIVE_KEY_PATTERN = /(private.?key|secret|password)/i;
const SENSITIVE_ENV_KEY_PATTERN = /(private.?key|secret|password|token)/i;
const DEFAULT_TEST_MODE_BLOCK_MESSAGE = 'Arc proof runner is disabled in test mode without an injected proof service.';
const DEFAULT_RUN_DISABLED_MESSAGE = 'Set ARC_PROOF_CONSOLE_ENABLED=true to allow Arc proof console runs.';

const getEnvValue = (source: EnvSource, key: string): string | undefined => {
  const value = source[key]?.trim();
  return value ? value : undefined;
};

const getMissingEnv = (source: EnvSource, keys: readonly string[]): string[] => {
  return keys.filter((key) => !getEnvValue(source, key));
};

const isArcProofConsoleEnabled = (source: EnvSource): boolean => {
  return getEnvValue(source, 'ARC_PROOF_CONSOLE_ENABLED')?.toLowerCase() === 'true';
};

const resolveErc8004ArtifactPath = (source: EnvSource): string => {
  return getEnvValue(source, 'ARC_ERC8004_ARTIFACT_PATH') ?? join(process.cwd(), 'artifacts', 'arc-standards', 'erc8004-agent.json');
};

const resolveErc8183ArtifactPath = (source: EnvSource): string => {
  return getEnvValue(source, 'ARC_ERC8183_ARTIFACT_PATH') ?? join(process.cwd(), 'artifacts', 'arc-standards', 'erc8183-job.json');
};

const isFileMissingError = (error: unknown): boolean => {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT');
};

const redactSensitiveKeys = <Value>(value: Value): Value => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveKeys(entry)) as Value;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactSensitiveKeys(entry)
      ])
    ) as Value;
  }

  return value;
};

const collectSensitiveEnvValues = (source: EnvSource): string[] => {
  return Object.entries(source)
    .filter(([key, value]) => SENSITIVE_ENV_KEY_PATTERN.test(key) && typeof value === 'string' && value.trim().length > 0)
    .map(([, value]) => value!.trim());
};

const sanitizeProofPayload = <Value>(value: Value, envSource: EnvSource): Value => {
  return sanitizeSensitiveValue(redactSensitiveKeys(value), {
    sensitiveValues: collectSensitiveEnvValues(envSource)
  });
};

const applyNoStoreHeaders = (response: Response): void => {
  response.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  response.set('Pragma', 'no-cache');
  response.set('Expires', '0');
};

const readErc8004ArtifactSummary = async (artifactPath: string): Promise<ArcProofStatusEntry['artifactSummary']> => {
  try {
    const [contents, artifactStat] = await Promise.all([readFile(artifactPath, 'utf8'), stat(artifactPath)]);
    const artifact = JSON.parse(contents) as Erc8004AgentArtifact;

    return {
      kind: 'erc8004',
      agentId: artifact.agentId,
      owner: artifact.owner,
      validator: artifact.validator,
      primaryTxHash: artifact.registrationTxHash,
      explorerUrl: artifact.explorerLinks.registrationTx,
      metadataUri: artifact.metadataUri,
      updatedAt: artifactStat.mtime.toISOString()
    };
  } catch (error) {
    if (isFileMissingError(error)) {
      return null;
    }

    return null;
  }
};

const readErc8183ArtifactSummary = async (artifactPath: string): Promise<ArcProofStatusEntry['artifactSummary']> => {
  try {
    const [contents, artifactStat] = await Promise.all([readFile(artifactPath, 'utf8'), stat(artifactPath)]);
    const artifact = JSON.parse(contents) as Erc8183JobArtifact;

    return {
      kind: 'erc8183',
      jobId: artifact.jobId,
      client: artifact.client,
      provider: artifact.provider,
      finalStatus: artifact.finalStatus,
      primaryTxHash: artifact.completeTxHash,
      explorerUrl: artifact.explorerLinks.completeTx,
      budgetUsdc: artifact.budgetUsdc,
      updatedAt: artifactStat.mtime.toISOString()
    };
  } catch (error) {
    if (isFileMissingError(error)) {
      return null;
    }

    return null;
  }
};

const buildErc8004Status = async (envSource: EnvSource): Promise<ArcProofStatusEntry> => {
  const missingEnv = getMissingEnv(envSource, ERC8004_REQUIRED_ENV);
  const artifactPath = resolveErc8004ArtifactPath(envSource);
  const artifactSummary = await readErc8004ArtifactSummary(artifactPath);

  if (missingEnv.length > 0) {
    return {
      configured: false,
      missingEnv,
      artifactPath,
      artifactSummary
    };
  }

  try {
    parseErc8004AgentEnv(envSource);

    return {
      configured: true,
      missingEnv,
      artifactPath,
      artifactSummary
    };
  } catch (error) {
    return {
      configured: false,
      missingEnv,
      artifactPath,
      artifactSummary,
      error: formatErc8004AgentError(error)
    };
  }
};

const buildErc8183Status = async (envSource: EnvSource): Promise<ArcProofStatusEntry> => {
  const missingEnv = getMissingEnv(envSource, ERC8183_REQUIRED_ENV);
  const artifactPath = resolveErc8183ArtifactPath(envSource);
  const artifactSummary = await readErc8183ArtifactSummary(artifactPath);

  if (missingEnv.length > 0) {
    return {
      configured: false,
      missingEnv,
      artifactPath,
      artifactSummary
    };
  }

  try {
    parseErc8183JobEnv(envSource);

    return {
      configured: true,
      missingEnv,
      artifactPath,
      artifactSummary
    };
  } catch (error) {
    return {
      configured: false,
      missingEnv,
      artifactPath,
      artifactSummary,
      error: formatErc8183JobError(error)
    };
  }
};

const wrapConfigError = (message: string): ArcProofRouteError => {
  return new ArcProofRouteError(400, 'arc_proof_config_invalid', message);
};

const wrapTestModeRunDisabledError = (): ArcProofRouteError => {
  return new ArcProofRouteError(409, 'arc_proof_run_disabled', DEFAULT_TEST_MODE_BLOCK_MESSAGE);
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
    throw new ArcProofRouteError(
      400,
      'arc_proof_request_invalid',
      `Arc proof request body must not include sensitive fields: ${sensitiveFields.join(', ')}`
    );
  }
};

const createDefaultArcProofService = (envSource: EnvSource, nodeEnv?: string): ArcProofService => {
  return {
    getStatus: async () => {
      const [erc8004, erc8183] = await Promise.all([buildErc8004Status(envSource), buildErc8183Status(envSource)]);

      return {
        erc8004,
        erc8183
      };
    },
    runErc8004: async () => {
      if (nodeEnv === 'test') {
        throw wrapTestModeRunDisabledError();
      }

      let env;

      try {
        env = parseErc8004AgentEnv(envSource);
      } catch (error) {
        throw wrapConfigError(extractSafeErrorMessage(error, 'ERC-8004 proof config invalid.'));
      }

      try {
        const transport = http(env.rpcUrl);
        const ownerAccount = privateKeyToAccount(env.ownerPrivateKey);
        const validatorAccount = privateKeyToAccount(env.validatorPrivateKey);
        const publicClient = createPublicClient({ transport });
        const ownerClient = createWalletClient({
          account: ownerAccount,
          transport
        });
        const validatorClient = createWalletClient({
          account: validatorAccount,
          transport
        });

        return await runErc8004AgentProof({
          ownerClient,
          validatorClient,
          publicClient,
          metadataUri: env.metadataUri,
          validationRequestUri: env.validationRequestUri,
          artifactPath: env.artifactPath,
          explorerBaseUrl: env.explorerBaseUrl
        });
      } catch (error) {
        throw new ArcProofRouteError(500, 'arc_proof_failed', formatErc8004AgentError(error, env));
      }
    },
    runErc8183: async () => {
      if (nodeEnv === 'test') {
        throw wrapTestModeRunDisabledError();
      }

      let env;

      try {
        env = parseErc8183JobEnv(envSource);
      } catch (error) {
        throw wrapConfigError(extractSafeErrorMessage(error, 'ERC-8183 proof config invalid.'));
      }

      try {
        const transport = http(env.rpcUrl);
        const clientAccount = privateKeyToAccount(env.clientPrivateKey);
        const providerAccount = privateKeyToAccount(env.providerPrivateKey);
        const publicClient = createPublicClient({ transport });
        const clientClient = createWalletClient({
          account: clientAccount,
          transport
        });
        const providerClient = createWalletClient({
          account: providerAccount,
          transport
        });

        return await runErc8183JobProof({
          clientClient,
          providerClient,
          publicClient,
          budgetAtomic: env.budgetAtomic,
          budgetUsdc: env.budgetUsdc,
          description: env.description,
          artifactPath: env.artifactPath,
          explorerBaseUrl: env.explorerBaseUrl
        });
      } catch (error) {
        throw new ArcProofRouteError(500, 'arc_proof_failed', formatErc8183JobError(error, env));
      }
    }
  };
};

const respondWithArcProofError = (
  response: Response,
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
  envSource: EnvSource
): void => {
  applyNoStoreHeaders(response);

  if (error instanceof ArcProofRouteError) {
    response.status(error.statusCode).json({
      error: error.code,
      message: error.message
    });
    return;
  }

  response.status(500).json({
    error: fallbackCode,
    message: extractSafeErrorMessage(error, fallbackMessage, {
      sensitiveValues: collectSensitiveEnvValues(envSource)
    })
  });
};

export const createArcProofRouter = (options: CreateArcProofRouterOptions = {}) => {
  const envSource = options.envSource ?? process.env;
  const proofService = options.proofService ?? createDefaultArcProofService(envSource, options.nodeEnv);
  const router = Router();

  router.get('/status', async (_request, response) => {
    applyNoStoreHeaders(response);

    try {
      const status = await proofService.getStatus();
      response.status(200).json(
        sanitizeProofPayload(
          {
            ...status,
            runEnabled: isArcProofConsoleEnabled(envSource)
          },
          envSource
        )
      );
    } catch (error) {
      respondWithArcProofError(response, error, 'arc_proof_status_unavailable', 'Arc proof status unavailable.', envSource);
    }
  });

  router.post('/erc8004', async (request, response) => {
    applyNoStoreHeaders(response);

    try {
      rejectSensitiveRequestFields(request.body);

      if (!isArcProofConsoleEnabled(envSource)) {
        throw new ArcProofRouteError(403, 'arc_proof_run_disabled', DEFAULT_RUN_DISABLED_MESSAGE);
      }

      const result = await proofService.runErc8004();
      response.status(200).json(sanitizeProofPayload(result, envSource));
    } catch (error) {
      respondWithArcProofError(response, error, 'arc_proof_failed', 'ERC-8004 proof failed.', envSource);
    }
  });

  router.post('/erc8183', async (request, response) => {
    applyNoStoreHeaders(response);

    try {
      rejectSensitiveRequestFields(request.body);

      if (!isArcProofConsoleEnabled(envSource)) {
        throw new ArcProofRouteError(403, 'arc_proof_run_disabled', DEFAULT_RUN_DISABLED_MESSAGE);
      }

      const result = await proofService.runErc8183();
      response.status(200).json(sanitizeProofPayload(result, envSource));
    } catch (error) {
      respondWithArcProofError(response, error, 'arc_proof_failed', 'ERC-8183 proof failed.', envSource);
    }
  });

  return router;
};
