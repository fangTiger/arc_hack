import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ExtractionOperation } from '../extraction/types.js';

const execFileAsync = promisify(execFile);
const castBinary = '/Users/captain/.foundry/bin/cast';

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
    const { stdout } = await execFileAsync(castBinary, [
      'send',
      '--async',
      '--rpc-url',
      this.config.rpcUrl,
      '--private-key',
      this.config.privateKey,
      this.config.contractAddress,
      'recordReceipt(string,string,bytes32)',
      input.requestId,
      input.operation,
      input.payloadHash
    ]);

    const txHash = stdout.match(/0x[a-fA-F0-9]{64}/)?.[0];

    if (!txHash) {
      throw new Error('Arc receipt writer did not return a transaction hash.');
    }

    return {
      mode: 'arc',
      txHash: txHash as `0x${string}`
    };
  }
}

export const createReceiptWriter = (config: ReceiptWriterConfig): ReceiptWriter => {
  if (config.mode === 'mock') {
    return new MockReceiptWriter();
  }

  return new ArcReceiptWriter(config);
};
