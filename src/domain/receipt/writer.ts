import { createHash } from 'node:crypto';
import type { Address, Hex } from 'viem';
import { createWalletClient, encodeFunctionData, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import type { RuntimeEnv } from '../../config/env.js';
import type { ExtractionOperation } from '../extraction/types.js';
import { extractSafeErrorMessage } from '../../support/sensitive.js';

export type ReceiptWriteInput = {
  requestId: string;
  operation: ExtractionOperation;
  payloadHash: `0x${string}`;
};

export type ReceiptWriteResult = {
  mode: 'mock' | 'arc';
  txHash: `0x${string}`;
};

export interface ReceiptWriter {
  write(input: ReceiptWriteInput): Promise<ReceiptWriteResult>;
}

type MockReceiptWriterConfig = {
  mode: 'mock';
};

type ArcReceiptWriterConfig = {
  mode: 'arc';
  rpcUrl: string;
  contractAddress: string;
  privateKey: string;
};

type ReceiptWriterConfig = MockReceiptWriterConfig | ArcReceiptWriterConfig;

const usageReceiptAbi = [
  {
    type: 'function',
    name: 'recordReceipt',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'requestId', type: 'string' },
      { name: 'operation', type: 'string' },
      { name: 'payloadHash', type: 'bytes32' }
    ],
    outputs: []
  }
] as const;

const buildDeterministicHash = (input: ReceiptWriteInput): `0x${string}` => {
  const digest = createHash('sha256')
    .update(`${input.requestId}:${input.operation}:${input.payloadHash}`)
    .digest('hex');

  return `0x${digest}` as `0x${string}`;
};

class MockReceiptWriter implements ReceiptWriter {
  async write(input: ReceiptWriteInput): Promise<ReceiptWriteResult> {
    return {
      mode: 'mock',
      txHash: buildDeterministicHash(input)
    };
  }
}

class ArcReceiptWriter implements ReceiptWriter {
  constructor(private readonly config: ArcReceiptWriterConfig) {}

  async write(input: ReceiptWriteInput): Promise<ReceiptWriteResult> {
    const account = privateKeyToAccount(this.config.privateKey as Hex);
    const walletClient = createWalletClient({
      account,
      transport: http(this.config.rpcUrl)
    });

    try {
      const txHash = await walletClient.sendTransaction({
        account,
        chain: undefined,
        to: this.config.contractAddress as Address,
        data: encodeFunctionData({
          abi: usageReceiptAbi,
          functionName: 'recordReceipt',
          args: [input.requestId, input.operation, input.payloadHash as Hex]
        })
      });

      return {
        mode: 'arc',
        txHash: txHash as `0x${string}`
      };
    } catch (error) {
      throw new Error(
        extractSafeErrorMessage(error, 'Arc receipt writer command failed.', {
          sensitiveValues: [this.config.privateKey]
        })
      );
    }
  }
}

export const createReceiptWriter = (config: ReceiptWriterConfig): ReceiptWriter => {
  if (config.mode === 'mock') {
    return new MockReceiptWriter();
  }

  return new ArcReceiptWriter(config);
};

export const createReceiptWriterFromRuntimeEnv = (
  runtimeEnv: Pick<RuntimeEnv, 'receiptMode' | 'arcRpcUrl' | 'usageReceiptAddress' | 'arcPrivateKey'>
): ReceiptWriter | undefined => {
  if (runtimeEnv.receiptMode === 'off') {
    return undefined;
  }

  if (runtimeEnv.receiptMode === 'mock') {
    return createReceiptWriter({ mode: 'mock' });
  }

  if (!runtimeEnv.arcRpcUrl || !runtimeEnv.usageReceiptAddress || !runtimeEnv.arcPrivateKey) {
    throw new Error('ARC_RPC_URL, USAGE_RECEIPT_ADDRESS and ARC_PRIVATE_KEY are required for RECEIPT_MODE=arc.');
  }

  return createReceiptWriter({
    mode: 'arc',
    rpcUrl: runtimeEnv.arcRpcUrl,
    contractAddress: runtimeEnv.usageReceiptAddress,
    privateKey: runtimeEnv.arcPrivateKey
  });
};
