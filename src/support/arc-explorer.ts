import type { RuntimeEnv } from '../config/env.js';

const DEFAULT_ARC_EXPLORER_BASE_URL = 'https://testnet.arcscan.app';

export const getArcExplorerBaseUrl = (runtimeEnv?: Pick<RuntimeEnv, 'arcExplorerBaseUrl'>): string =>
  (runtimeEnv?.arcExplorerBaseUrl ?? DEFAULT_ARC_EXPLORER_BASE_URL).replace(/\/$/, '');

export const isHexAddress = (value: string | undefined): value is `0x${string}` =>
  Boolean(value && /^0x[a-fA-F0-9]{40}$/.test(value));

export const isHexTransactionHash = (value: string | undefined): value is `0x${string}` =>
  Boolean(value && /^0x[a-fA-F0-9]{64}$/.test(value));

export const buildArcExplorerAddressUrl = (
  address: `0x${string}`,
  runtimeEnv?: Pick<RuntimeEnv, 'arcExplorerBaseUrl'>
): string => `${getArcExplorerBaseUrl(runtimeEnv)}/address/${address}`;

export const buildArcExplorerTransactionUrl = (
  transactionHash: `0x${string}`,
  runtimeEnv?: Pick<RuntimeEnv, 'arcExplorerBaseUrl'>
): string => `${getArcExplorerBaseUrl(runtimeEnv)}/tx/${transactionHash}`;
