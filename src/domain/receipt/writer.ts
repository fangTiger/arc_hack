import { createHash } from 'node:crypto';
import type { Address, Hex } from 'viem';
import { createPublicClient, createWalletClient, encodeFunctionData, http } from 'viem';
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

const TRANSIENT_RECEIPT_RETRY_DELAYS_MS = [250, 750] as const;

class ReceiptWriteAttemptError extends Error {
  constructor(
    readonly causeError: unknown,
    readonly broadcasted: boolean
  ) {
    super(causeError instanceof Error ? causeError.message : 'Receipt write attempt failed.');
  }
}

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
  private readonly account;
  private readonly publicClient;
  private readonly walletClient;
  private nextNonce: number | undefined;
  private nonceQueue: Promise<void> = Promise.resolve();

  constructor(private readonly config: ArcReceiptWriterConfig) {
    this.account = privateKeyToAccount(this.config.privateKey as Hex);
    const transport = http(this.config.rpcUrl);

    this.publicClient = createPublicClient({
      transport
    });
    this.walletClient = createWalletClient({
      account: this.account,
      transport
    });
  }

  private isAmbiguousBroadcastError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    return ['timeout', 'timed out', 'fetch', 'network', 'socket', 'connection reset', 'econnreset'].some((pattern) =>
      message.includes(pattern)
    );
  }

  private isRetryableSubmissionError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    return ['txpool is full', 'pool is full', 'temporarily unavailable', 'rate limit', 'too many requests'].some(
      (pattern) => message.includes(pattern)
    );
  }

  private async withReservedNonce<T>(run: (nonce: number) => Promise<T>): Promise<T> {
    const previousReservation = this.nonceQueue;
    let releaseReservation: () => void = () => undefined;

    this.nonceQueue = new Promise<void>((resolve) => {
      releaseReservation = resolve;
    });

    await previousReservation;

    let reservedNonce: number | undefined;

    try {
      const pendingNonce = await this.publicClient.getTransactionCount({
        address: this.account.address,
        blockTag: 'pending'
      });

      if (this.nextNonce === undefined || pendingNonce > this.nextNonce) {
        this.nextNonce = pendingNonce;
      }

      reservedNonce = this.nextNonce ?? pendingNonce;
      this.nextNonce = reservedNonce + 1;
      return await run(reservedNonce);
    } catch (error) {
      const attemptError =
        error instanceof ReceiptWriteAttemptError ? error : new ReceiptWriteAttemptError(error, false);
      const refreshedPendingNonce = await this.publicClient
        .getTransactionCount({
          address: this.account.address,
          blockTag: 'pending'
        })
        .catch(() => undefined);

      if (
        this.isAmbiguousBroadcastError(attemptError.causeError) &&
        attemptError.broadcasted &&
        reservedNonce !== undefined
      ) {
        this.nextNonce = Math.max(refreshedPendingNonce ?? reservedNonce + 1, reservedNonce + 1);
      } else {
        this.nextNonce = refreshedPendingNonce;
      }

      throw attemptError.causeError;
    } finally {
      releaseReservation();
    }
  }

  async write(input: ReceiptWriteInput): Promise<ReceiptWriteResult> {
    let lastError: unknown;

    try {
      for (const retryDelayMs of [0, ...TRANSIENT_RECEIPT_RETRY_DELAYS_MS]) {
        try {
          if (retryDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          }

          const txHash = await this.withReservedNonce(async (nonce) => {
            let hash: Hex;

            try {
              hash = await this.walletClient.sendTransaction({
                account: this.account,
                chain: undefined,
                nonce,
                to: this.config.contractAddress as Address,
                data: encodeFunctionData({
                  abi: usageReceiptAbi,
                  functionName: 'recordReceipt',
                  args: [input.requestId, input.operation, input.payloadHash as Hex]
                })
              });
            } catch (error) {
              throw new ReceiptWriteAttemptError(error, this.isAmbiguousBroadcastError(error));
            }

            try {
              await this.publicClient.waitForTransactionReceipt({
                hash
              });
            } catch (error) {
              throw new ReceiptWriteAttemptError(error, true);
            }

            return hash;
          });

          return {
            mode: 'arc',
            txHash: txHash as `0x${string}`
          };
        } catch (error) {
          lastError = error;

          if (!this.isRetryableSubmissionError(error) || retryDelayMs === TRANSIENT_RECEIPT_RETRY_DELAYS_MS.at(-1)) {
            throw error;
          }
        }
      }

      throw lastError;
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
