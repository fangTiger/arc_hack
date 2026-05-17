import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { extractSafeErrorMessage, sanitizeSensitiveText } from '../../support/sensitive.js';
import {
  writeCircleConsoleProofArtifact,
  type CircleConsoleImportStatus,
  type CircleConsoleProofArtifact
} from './artifacts.js';

type EnvSource = Record<string, string | undefined>;

export type CircleConsoleProofEnv = {
  apiKey: string;
  apiBaseUrl: string;
  usageReceiptAddress?: string;
  artifactPath: string;
};

export type CircleConsoleProofOptions = {
  env: CircleConsoleProofEnv;
  fetchImpl?: typeof fetch;
  artifactWriter?: (artifactPath: string, artifact: CircleConsoleProofArtifact) => Promise<void>;
  requestIdFactory?: () => string;
};

export type CircleConsoleProofResult = {
  artifactPath: string;
  artifact: CircleConsoleProofArtifact;
};

type CircleWallet = {
  id?: string;
};

type CircleContract = {
  id?: string;
  name?: string;
  blockchain?: string;
  contractAddress?: string;
};

type CircleApiDataEnvelope<Value> = {
  data?: Value;
  message?: string;
  error?: string;
};

type CircleApiRequestResult<Value> = {
  data: Value;
  requestId: string;
};

const DEFAULT_CIRCLE_API_BASE_URL = 'https://api.circle.com';
const DEFAULT_CIRCLE_CONSOLE_ARTIFACT_PATH = join(process.cwd(), 'artifacts', 'circle-console', 'proof.json');
const CIRCLE_CONSOLE_BLOCKCHAIN = 'ARC-TESTNET' as const;
const USAGE_RECEIPT_CONTRACT_NAME = 'ArcSignalDeskUsageReceipt';
const HEX_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

const getEnvValue = (source: EnvSource, key: string): string | undefined => {
  const value = source[key]?.trim();
  return value ? value : undefined;
};

const sanitizeCircleConsoleMessage = (value: unknown, env?: Partial<CircleConsoleProofEnv>, fallback = 'Circle API request failed.'): string => {
  const sanitized = extractSafeErrorMessage(value, fallback, {
    sensitiveValues: [env?.apiKey].filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  });

  return sanitizeSensitiveText(sanitized, {
    sensitiveValues: [env?.apiKey].filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  })
    .replace(/Authorization:\s*Bearer\s+\[REDACTED\]/gi, 'authorization header [REDACTED]')
    .replace(/Authorization:\s*Bearer\s+\S+/gi, 'authorization header [REDACTED]');
};

const normalizeApiBaseUrl = (value: string): string => {
  try {
    const url = new URL(value);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('CIRCLE_API_BASE_URL must use http or https.');
    }

    if (url.username || url.password || url.search || url.hash) {
      throw new Error('CIRCLE_API_BASE_URL must not include credentials, query strings, or fragments.');
    }

    return url.toString().replace(/\/$/, '');
  } catch (error) {
    throw new Error(sanitizeCircleConsoleMessage(error, undefined, 'CIRCLE_API_BASE_URL is invalid.'));
  }
};

const normalizeUsageReceiptAddress = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  if (!HEX_ADDRESS_PATTERN.test(value)) {
    throw new Error('USAGE_RECEIPT_ADDRESS must be a 0x-prefixed 40-character hex address.');
  }

  return value;
};

const buildCircleApiUrl = (baseUrl: string, path: string, query?: Record<string, string>): string => {
  const url = new URL(path, `${baseUrl}/`);

  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }

  return url.toString();
};

const parseCircleApiJson = async <Value>(response: Response): Promise<CircleApiDataEnvelope<Value>> => {
  const bodyText = await response.text();

  if (!bodyText) {
    return {};
  }

  try {
    return JSON.parse(bodyText) as CircleApiDataEnvelope<Value>;
  } catch {
    return {
      message: bodyText
    };
  }
};

const callCircleApi = async <Value>(
  env: CircleConsoleProofEnv,
  fetchImpl: typeof fetch,
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
  },
  requestIdFactory: () => string
): Promise<CircleApiRequestResult<Value>> => {
  const requestId = requestIdFactory();
  const url = buildCircleApiUrl(
    env.apiBaseUrl,
    path,
    path === '/v1/w3s/contracts' ? { blockchain: CIRCLE_CONSOLE_BLOCKCHAIN } : undefined
  );

  let response: Response;

  try {
    response = await fetchImpl(url, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${env.apiKey}`,
        'Content-Type': 'application/json',
        'X-Request-Id': requestId
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    });
  } catch (error) {
    throw new Error(`Circle API request failed: ${sanitizeCircleConsoleMessage(error, env)}`);
  }

  const payload = await parseCircleApiJson<Value>(response);
  const responseRequestId = response.headers.get('x-request-id') ?? requestId;

  if (!response.ok) {
    throw new Error(
      `Circle API request failed: ${sanitizeCircleConsoleMessage(
        payload.message ?? payload.error ?? `Circle API returned ${response.status}.`,
        env
      )}`
    );
  }

  return {
    data: (payload.data ?? {}) as Value,
    requestId: responseRequestId
  };
};

export const parseCircleConsoleEnv = (source: EnvSource): CircleConsoleProofEnv => {
  const apiKey = getEnvValue(source, 'CIRCLE_API_KEY');

  if (!apiKey) {
    throw new Error('Missing required Circle Console env vars: CIRCLE_API_KEY');
  }

  return {
    apiKey,
    apiBaseUrl: normalizeApiBaseUrl(getEnvValue(source, 'CIRCLE_API_BASE_URL') ?? DEFAULT_CIRCLE_API_BASE_URL),
    usageReceiptAddress: normalizeUsageReceiptAddress(getEnvValue(source, 'USAGE_RECEIPT_ADDRESS')),
    artifactPath: getEnvValue(source, 'CIRCLE_CONSOLE_PROOF_ARTIFACT_PATH') ?? DEFAULT_CIRCLE_CONSOLE_ARTIFACT_PATH
  };
};

export const runCircleConsoleProof = async (options: CircleConsoleProofOptions): Promise<CircleConsoleProofResult> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const artifactWriter = options.artifactWriter ?? writeCircleConsoleProofArtifact;
  const requestIdFactory = options.requestIdFactory ?? randomUUID;
  const env = options.env;

  const [walletsResponse, contractsResponse] = await Promise.all([
    callCircleApi<{ wallets?: CircleWallet[] }>(env, fetchImpl, '/v1/w3s/wallets', {}, requestIdFactory),
    callCircleApi<{ contracts?: CircleContract[] }>(env, fetchImpl, '/v1/w3s/contracts', {}, requestIdFactory)
  ]);
  const wallets = Array.isArray(walletsResponse.data.wallets) ? walletsResponse.data.wallets : [];
  const contracts = Array.isArray(contractsResponse.data.contracts) ? contractsResponse.data.contracts : [];

  let usageReceiptImportStatus: CircleConsoleImportStatus = 'skipped_missing_contract_address';
  let contractId: string | undefined;
  let contractAddress: string | undefined;
  let importRequestId: string | undefined;
  let contractCount = contracts.length;

  if (env.usageReceiptAddress) {
    const existingContract = contracts.find(
      (contract) => contract.contractAddress?.toLowerCase() === env.usageReceiptAddress?.toLowerCase()
    );

    if (existingContract) {
      usageReceiptImportStatus = 'already_imported';
      contractId = existingContract.id;
      contractAddress = existingContract.contractAddress ?? env.usageReceiptAddress;
    } else {
      const importedContractResponse = await callCircleApi<{ contract?: CircleContract }>(
        env,
        fetchImpl,
        '/v1/w3s/contracts/import',
        {
          method: 'POST',
          body: {
            blockchain: CIRCLE_CONSOLE_BLOCKCHAIN,
            address: env.usageReceiptAddress,
            idempotencyKey: requestIdFactory(),
            name: USAGE_RECEIPT_CONTRACT_NAME
          }
        },
        requestIdFactory
      );
      const importedContract = importedContractResponse.data.contract;

      usageReceiptImportStatus = 'imported';
      contractId = importedContract?.id;
      contractAddress = importedContract?.contractAddress ?? env.usageReceiptAddress;
      importRequestId = importedContractResponse.requestId;
      contractCount += 1;
    }
  }

  const artifact: CircleConsoleProofArtifact = {
    checkedAt: new Date().toISOString(),
    walletCount: wallets.length,
    contractCount,
    usageReceiptImportStatus,
    ...(contractId ? { contractId } : {}),
    ...(contractAddress ? { contractAddress } : {}),
    requestIds: {
      wallets: walletsResponse.requestId,
      contracts: contractsResponse.requestId,
      ...(importRequestId ? { import: importRequestId } : {})
    },
    source: {
      runner: 'circle-console-proof',
      blockchain: CIRCLE_CONSOLE_BLOCKCHAIN,
      apiBaseUrl: env.apiBaseUrl
    }
  };

  await artifactWriter(env.artifactPath, artifact);

  return {
    artifactPath: env.artifactPath,
    artifact
  };
};

export const formatCircleConsoleProofError = (error: unknown, env?: Partial<CircleConsoleProofEnv>): string => {
  return sanitizeCircleConsoleMessage(error, env, 'Circle Console proof failed.');
};
