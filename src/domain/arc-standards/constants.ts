import type { Address, Hex } from 'viem';

export const ARC_TESTNET_CHAIN_ID = 5_042_002;
export const ARC_TESTNET_EXPLORER_BASE_URL = 'https://testnet.arcscan.app';
export const ARC_USDC_DECIMALS = 6;

export const ARC_STANDARDS_ADDRESSES = {
  identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
  reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
  validationRegistry: '0x8004Cb1BF31DAf7788923b405b754f57acEB4272',
  agenticCommerce: '0x0747EEf0706327138c69792bF28Cd525089e4583',
  usdc: '0x3600000000000000000000000000000000000000'
} as const satisfies Record<string, Address>;

export const ERC8183_JOB_STATUS = {
  Open: 0,
  Funded: 1,
  Submitted: 2,
  Completed: 3,
  Rejected: 4,
  Expired: 5
} as const;

export type Erc8183JobStatusName = keyof typeof ERC8183_JOB_STATUS;

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const satisfies Address;

const normalizeExplorerBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, '');

export const buildArcScanTxUrl = (txHash: Hex, baseUrl = ARC_TESTNET_EXPLORER_BASE_URL): string => {
  return `${normalizeExplorerBaseUrl(baseUrl)}/tx/${txHash}`;
};

export const buildArcScanAddressUrl = (address: Address, baseUrl = ARC_TESTNET_EXPLORER_BASE_URL): string => {
  return `${normalizeExplorerBaseUrl(baseUrl)}/address/${address}`;
};
