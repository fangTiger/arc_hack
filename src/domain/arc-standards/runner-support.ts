import type { Hex } from 'viem';

export type ArcTransactionReceiptLog = {
  address?: string;
  data?: Hex;
  topics?: readonly Hex[];
};

export type ArcTransactionReceipt = {
  blockNumber: bigint;
  status: 'success' | 'reverted';
  logs?: ArcTransactionReceiptLog[];
};

export type ArcReceiptWaitingClient = {
  waitForTransactionReceipt: (...args: any[]) => Promise<ArcTransactionReceipt>;
};

export const waitForSuccessfulTransaction = async (
  publicClient: ArcReceiptWaitingClient,
  hash: Hex,
  label: string
): Promise<ArcTransactionReceipt> => {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error(`${label} transaction reverted: ${hash}`);
  }

  return receipt;
};
