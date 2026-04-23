import type { RuntimeEnv } from '../config/env.js';

const sensitivePatterns: RegExp[] = [
  /(--private-key\s+)(\S+)/gi,
  /(ARC_PRIVATE_KEY=)(\S+)/g,
  /(CAST_UNSAFE_PASSWORD=)(\S+)/g,
  /("arcPrivateKey"\s*:\s*")([^"]+)(")/g,
  /("gatewayBuyerPrivateKey"\s*:\s*")([^"]+)(")/g,
  /("privateKey"\s*:\s*")([^"]+)(")/g,
  /((?:arc|private|secret|password)[-_ ]?(?:key|token)?\s*[:=]\s*)(0x[a-fA-F0-9]+|\S+)/gi
];

export type SensitiveSanitizeOptions = {
  sensitiveValues?: readonly string[];
};

const normalizeSensitiveValues = (options: SensitiveSanitizeOptions | undefined): string[] => {
  return [...new Set((options?.sensitiveValues ?? []).map((value) => value?.trim()).filter(Boolean) as string[])];
};

const replaceLiteralSensitiveValues = (value: string, sensitiveValues: readonly string[]): string => {
  let sanitized = value;

  for (const sensitiveValue of sensitiveValues) {
    sanitized = sanitized.split(sensitiveValue).join('[REDACTED]');
  }

  return sanitized;
};

const urlPattern = /\bhttps?:\/\/[^\s"'<>]+/gi;

export const stripSensitiveUrlParts = (candidate: string): string => {
  try {
    const url = new URL(candidate);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return candidate;
  }
};

const redactUrlSensitiveParts = (candidate: string): string => {
  try {
    const url = new URL(candidate);
    const hasSensitiveParts = Boolean(url.username || url.password || url.search || url.hash);

    if (!hasSensitiveParts) {
      return candidate;
    }

    const redactedQuery = url.search ? '?[REDACTED]' : '';
    const redactedHash = url.hash ? '#[REDACTED]' : '';

    return `${stripSensitiveUrlParts(candidate)}${redactedQuery}${redactedHash}`;
  } catch {
    return candidate;
  }
};

export const sanitizeSensitiveText = (
  value: string,
  options: SensitiveSanitizeOptions = {}
): string => {
  const sensitiveValues = normalizeSensitiveValues(options);
  let sanitized = replaceLiteralSensitiveValues(value, sensitiveValues);

  for (const pattern of sensitivePatterns) {
    sanitized = sanitized.replace(pattern, (match, ...args: unknown[]) => {
      const captures = args.slice(0, -2) as string[];
      const prefix = captures[0] ?? match;
      const suffix = captures.length >= 3 ? (captures[captures.length - 1] ?? '') : '';

      return `${prefix}[REDACTED]${suffix}`;
    });
  }

  sanitized = sanitized.replace(urlPattern, (candidate) => redactUrlSensitiveParts(candidate));

  return sanitized;
};

export const sanitizeSensitiveValue = <Value>(
  value: Value,
  options: SensitiveSanitizeOptions = {}
): Value => {
  if (typeof value === 'string') {
    return sanitizeSensitiveText(value, options) as Value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSensitiveValue(entry, options)) as Value;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, sanitizeSensitiveValue(entry, options)])
    ) as Value;
  }

  return value;
};

export const extractSafeErrorMessage = (
  error: unknown,
  fallback: string,
  options: SensitiveSanitizeOptions = {}
): string => {
  if (error instanceof Error) {
    return sanitizeSensitiveText(error.message, options);
  }

  if (typeof error === 'string') {
    return sanitizeSensitiveText(error, options);
  }

  return sanitizeSensitiveText(fallback, options);
};

export const collectRuntimeSensitiveValues = (
  runtimeEnv: Pick<RuntimeEnv, 'arcPrivateKey' | 'gatewayBuyerPrivateKey' | 'llmApiKey'>
): string[] => {
  return normalizeSensitiveValues({
    sensitiveValues: [runtimeEnv.arcPrivateKey, runtimeEnv.gatewayBuyerPrivateKey, runtimeEnv.llmApiKey].filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    )
  });
};
