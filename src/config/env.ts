import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CHAIN_CONFIGS, type SupportedChainName } from '@circle-fin/x402-batching/client';

export type PaymentMode = 'mock' | 'gateway';
export type AiMode = 'mock' | 'real';
export type ReceiptMode = 'off' | 'mock' | 'arc';

export type GatewayBuyerEnv = {
  baseUrl: string;
  privateKey: string;
  chain: SupportedChainName;
  rpcUrl?: string;
  autoDepositAmount?: string;
};

export type RuntimeEnv = {
  nodeEnv: string;
  port: number;
  paymentMode: PaymentMode;
  aiMode: AiMode;
  receiptMode: ReceiptMode;
  arcExplorerBaseUrl?: string;
  circleSellerAddress?: string;
  circleGatewayNetworks?: string[];
  circleGatewayFacilitatorUrl?: string;
  arcRpcUrl?: string;
  arcPrivateKey?: string;
  usageReceiptAddress?: string;
  callLogPath: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
  gatewayBuyerBaseUrl?: string;
  gatewayBuyerPrivateKey?: string;
  gatewayBuyerChain?: SupportedChainName;
  gatewayBuyerRpcUrl?: string;
  gatewayBuyerAutoDepositAmount?: string;
};

type EnvSource = Record<string, string | undefined>;

const parsePort = (value: string | undefined): number => {
  if (!value) {
    return 3000;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return parsed;
};

const parsePaymentMode = (value: string | undefined): PaymentMode => {
  if (!value) {
    return 'mock';
  }

  if (value === 'mock' || value === 'gateway') {
    return value;
  }

  throw new Error(`Invalid PAYMENT_MODE value: ${value}`);
};

const parseAiMode = (value: string | undefined): AiMode => {
  if (!value) {
    return 'mock';
  }

  if (value === 'mock' || value === 'real') {
    return value;
  }

  throw new Error(`Invalid AI_MODE value: ${value}`);
};

const parseReceiptMode = (value: string | undefined): ReceiptMode => {
  if (!value) {
    return 'off';
  }

  if (value === 'off' || value === 'mock' || value === 'arc') {
    return value;
  }

  throw new Error(`Invalid RECEIPT_MODE value: ${value}`);
};

const parseCommaSeparatedList = (value: string | undefined): string[] | undefined => {
  if (!value) {
    return undefined;
  }

  const items = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
};

const parseGatewayBuyerChain = (value: string | undefined): SupportedChainName | undefined => {
  if (!value) {
    return undefined;
  }

  if (value in CHAIN_CONFIGS) {
    return value as SupportedChainName;
  }

  throw new Error(`Invalid GATEWAY_BUYER_CHAIN value: ${value}`);
};

const parseOptionalPositiveDecimal = (name: string, value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name} value: ${value}`);
  }

  return value;
};

const parseEnvLine = (line: string): [string, string] | null => {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const separatorIndex = trimmed.indexOf('=');

  if (separatorIndex <= 0) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  const rawValue = trimmed.slice(separatorIndex + 1).trim();
  const value =
    rawValue.startsWith('"') && rawValue.endsWith('"')
      ? rawValue.slice(1, -1)
      : rawValue.startsWith("'") && rawValue.endsWith("'")
        ? rawValue.slice(1, -1)
        : rawValue;

  return [key, value];
};

export const loadDotEnvFile = (
  target: EnvSource = process.env,
  envFilePath = join(process.cwd(), '.env')
): EnvSource => {
  try {
    const content = readFileSync(envFilePath, 'utf8');

    for (const line of content.split('\n')) {
      const parsed = parseEnvLine(line);

      if (!parsed) {
        continue;
      }

      const [key, value] = parsed;

      if (target[key] === undefined) {
        target[key] = value;
      }
    }
  } catch (error) {
    const systemError = error as NodeJS.ErrnoException;

    if (systemError.code !== 'ENOENT') {
      throw error;
    }
  }

  return target;
};

export const loadRuntimeEnv = (source: EnvSource): RuntimeEnv => {
  return {
    nodeEnv: source.NODE_ENV ?? 'development',
    port: parsePort(source.PORT),
    paymentMode: parsePaymentMode(source.PAYMENT_MODE),
    aiMode: parseAiMode(source.AI_MODE),
    receiptMode: parseReceiptMode(source.RECEIPT_MODE),
    arcExplorerBaseUrl: source.ARC_EXPLORER_BASE_URL,
    circleSellerAddress: source.CIRCLE_SELLER_ADDRESS,
    circleGatewayNetworks: parseCommaSeparatedList(source.CIRCLE_GATEWAY_NETWORKS),
    circleGatewayFacilitatorUrl: source.CIRCLE_GATEWAY_FACILITATOR_URL,
    arcRpcUrl: source.ARC_RPC_URL,
    arcPrivateKey: source.ARC_PRIVATE_KEY,
    usageReceiptAddress: source.USAGE_RECEIPT_ADDRESS,
    callLogPath: source.CALL_LOG_PATH ?? join(process.cwd(), 'artifacts', 'demo-run', 'call-log.jsonl'),
    llmBaseUrl: source.LLM_BASE_URL,
    llmApiKey: source.LLM_API_KEY,
    llmModel: source.LLM_MODEL,
    gatewayBuyerBaseUrl: source.GATEWAY_BUYER_BASE_URL,
    gatewayBuyerPrivateKey: source.GATEWAY_BUYER_PRIVATE_KEY,
    gatewayBuyerChain: parseGatewayBuyerChain(source.GATEWAY_BUYER_CHAIN),
    gatewayBuyerRpcUrl: source.GATEWAY_BUYER_RPC_URL,
    gatewayBuyerAutoDepositAmount: parseOptionalPositiveDecimal(
      'GATEWAY_BUYER_AUTO_DEPOSIT_AMOUNT',
      source.GATEWAY_BUYER_AUTO_DEPOSIT_AMOUNT
    )
  };
};

export const getRuntimeEnv = (source: EnvSource = process.env): RuntimeEnv => {
  const resolvedSource = source === process.env ? loadDotEnvFile(source) : source;
  return loadRuntimeEnv(resolvedSource);
};

export const requireGatewayBuyerEnv = (
  runtimeEnv: Pick<
    RuntimeEnv,
    | 'gatewayBuyerBaseUrl'
    | 'gatewayBuyerPrivateKey'
    | 'gatewayBuyerChain'
    | 'gatewayBuyerRpcUrl'
    | 'gatewayBuyerAutoDepositAmount'
  >
): GatewayBuyerEnv => {
  if (!runtimeEnv.gatewayBuyerBaseUrl || !runtimeEnv.gatewayBuyerPrivateKey || !runtimeEnv.gatewayBuyerChain) {
    throw new Error(
      'GATEWAY_BUYER_BASE_URL, GATEWAY_BUYER_PRIVATE_KEY and GATEWAY_BUYER_CHAIN are required for the gateway buyer demo.'
    );
  }

  return {
    baseUrl: runtimeEnv.gatewayBuyerBaseUrl,
    privateKey: runtimeEnv.gatewayBuyerPrivateKey,
    chain: runtimeEnv.gatewayBuyerChain,
    rpcUrl: runtimeEnv.gatewayBuyerRpcUrl,
    autoDepositAmount: runtimeEnv.gatewayBuyerAutoDepositAmount
  };
};
