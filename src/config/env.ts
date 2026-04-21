import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type PaymentMode = 'mock' | 'gateway';
export type AiMode = 'mock' | 'real';

export type RuntimeEnv = {
  nodeEnv: string;
  port: number;
  paymentMode: PaymentMode;
  aiMode: AiMode;
  circleSellerAddress?: string;
  arcRpcUrl?: string;
  arcPrivateKey?: string;
  usageReceiptAddress?: string;
  callLogPath: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
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

export const loadDotEnvFile = (envFilePath = join(process.cwd(), '.env')): void => {
  try {
    const content = readFileSync(envFilePath, 'utf8');

    for (const line of content.split('\n')) {
      const parsed = parseEnvLine(line);

      if (!parsed) {
        continue;
      }

      const [key, value] = parsed;

      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    const systemError = error as NodeJS.ErrnoException;

    if (systemError.code !== 'ENOENT') {
      throw error;
    }
  }
};

export const loadRuntimeEnv = (source: EnvSource = process.env): RuntimeEnv => {
  return {
    nodeEnv: source.NODE_ENV ?? 'development',
    port: parsePort(source.PORT),
    paymentMode: parsePaymentMode(source.PAYMENT_MODE),
    aiMode: parseAiMode(source.AI_MODE),
    circleSellerAddress: source.CIRCLE_SELLER_ADDRESS,
    arcRpcUrl: source.ARC_RPC_URL,
    arcPrivateKey: source.ARC_PRIVATE_KEY,
    usageReceiptAddress: source.USAGE_RECEIPT_ADDRESS,
    callLogPath: source.CALL_LOG_PATH ?? join(process.cwd(), 'artifacts', 'demo-run', 'call-log.jsonl'),
    llmBaseUrl: source.LLM_BASE_URL,
    llmApiKey: source.LLM_API_KEY,
    llmModel: source.LLM_MODEL
  };
};

loadDotEnvFile();

export const env = loadRuntimeEnv();
