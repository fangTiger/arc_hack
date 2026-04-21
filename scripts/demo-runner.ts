import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { createApp } from '../src/app.js';
import { loadRuntimeEnv, type PaymentMode } from '../src/config/env.js';
import { demoCorpus } from '../src/demo/corpus.js';
import type { ExtractionOperation, ExtractionRequest, ExtractionResult } from '../src/domain/extraction/types.js';
import { createReceiptWriter, type ReceiptWriter } from '../src/domain/receipt/writer.js';
import { FileCallLogStore, type CallLogStats } from '../src/store/call-log-store.js';
import { invokeApp } from '../src/support/invoke-app.js';

export type DemoRunOptions = {
  artifactDirectory: string;
  corpus?: ExtractionRequest[];
  operations?: ExtractionOperation[];
  repeatCount?: number;
  paymentMode?: PaymentMode;
  receiptWriter?: ReceiptWriter;
  resetArtifacts?: boolean;
};

export type DemoRunSummary = {
  totalRuns: number;
  successCount: number;
  requestIds: string[];
  stats: CallLogStats;
  receiptTxHashes?: `0x${string}`[];
};

type ReceiptMode = 'off' | 'mock' | 'arc';

type PaidExtractionPayload = {
  requestId: string;
  pricedOperation: { operation: ExtractionOperation; price: `$${number}` };
  result: ExtractionResult;
  payment: { mode: 'mock' | 'gateway'; status: 'paid' };
};

type PaymentRequiredPayload = {
  payment: {
    mode: 'mock' | 'gateway';
    status: 'payment_required';
  };
};

const operationPath: Record<ExtractionOperation, `/api/extract/${ExtractionOperation}`> = {
  summary: '/api/extract/summary',
  entities: '/api/extract/entities',
  relations: '/api/extract/relations'
};

const buildPaidHeaders = (paymentMode: 'mock' | 'gateway'): Record<string, string> => {
  if (paymentMode === 'gateway') {
    return {
      'payment-signature': 'demo-gateway-proof'
    };
  }

  return {
    'x-payment-token': 'mock-paid'
  };
};

export const runDemo = async (options: DemoRunOptions): Promise<DemoRunSummary> => {
  const corpus = options.corpus ?? demoCorpus;
  const operations = options.operations ?? ['summary', 'entities', 'relations'];
  const repeatCount = options.repeatCount ?? 1;
  const callLogPath = join(options.artifactDirectory, 'call-log.jsonl');
  const summaryPath = join(options.artifactDirectory, 'summary.json');
  const store = new FileCallLogStore(callLogPath);

  if (options.resetArtifacts ?? true) {
    await rm(options.artifactDirectory, { recursive: true, force: true });
  }

  await mkdir(options.artifactDirectory, { recursive: true });

  let requestCounter = 0;
  const app = createApp({
    runtimeEnv: loadRuntimeEnv({
      ...process.env,
      NODE_ENV: 'test',
      PORT: '3000',
      PAYMENT_MODE: options.paymentMode ?? process.env.PAYMENT_MODE ?? 'mock',
      AI_MODE: process.env.AI_MODE ?? 'mock',
      CALL_LOG_PATH: callLogPath
    }),
    requestIdFactory: () => `demo-${String(++requestCounter).padStart(3, '0')}`
  });
  let requestSeedCounter = 0;
  const requestIds: string[] = [];
  const receiptTxHashes: `0x${string}`[] = [];
  let successCount = 0;

  for (let round = 0; round < repeatCount; round += 1) {
    for (const item of corpus) {
      for (const operation of operations) {
        const requestId = `demo-${String(++requestSeedCounter).padStart(3, '0')}`;
        const requiredResponse = await invokeApp(app, {
          method: 'POST',
          path: operationPath[operation],
          headers: {
            'x-request-id': requestId
          },
          body: item
        });

        if (requiredResponse.statusCode !== 402) {
          continue;
        }

        const requiredPayload = requiredResponse.json as PaymentRequiredPayload;
        const paidResponse = await invokeApp(app, {
          method: 'POST',
          path: operationPath[operation],
          headers: {
            'x-request-id': requestId,
            ...buildPaidHeaders(requiredPayload.payment.mode)
          },
          body: item
        });

        if (paidResponse.statusCode !== 200) {
          continue;
        }

        const payload = paidResponse.json as PaidExtractionPayload;
        requestIds.push(payload.requestId);
        successCount += 1;

        if (options.receiptWriter) {
          const payloadHash = `0x${createHash('sha256').update(JSON.stringify(payload.result)).digest('hex')}` as `0x${string}`;
          const receiptResult = await options.receiptWriter.write({
            requestId: payload.requestId,
            operation: payload.pricedOperation.operation,
            payloadHash
          });

          receiptTxHashes.push(receiptResult.txHash);
          await store.attachReceiptTxHash(payload.requestId, receiptResult.txHash);
        }
      }
    }
  }

  const stats = await store.getStats();
  const summary = {
    totalRuns: corpus.length * operations.length * repeatCount,
    successCount,
    requestIds,
    stats,
    ...(options.receiptWriter ? { receiptTxHashes } : {})
  } satisfies DemoRunSummary;

  await store.writeSummary(summaryPath, summary);
  return summary;
};

const parseOperations = (value: string | undefined): ExtractionOperation[] | undefined => {
  if (!value) {
    return undefined;
  }

  return value
    .split(',')
    .map((operation) => operation.trim())
    .filter(Boolean) as ExtractionOperation[];
};

const parseRepeatCount = (value: string | undefined): number => {
  if (!value) {
    return 1;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid DEMO_REPEAT_COUNT value: ${value}`);
  }

  return parsed;
};

const parseReceiptWriterFromEnv = (): ReceiptWriter | undefined => {
  const receiptMode = (process.env.RECEIPT_MODE ?? 'off') as ReceiptMode;

  if (receiptMode === 'off') {
    return undefined;
  }

  if (receiptMode === 'mock') {
    return createReceiptWriter({ mode: 'mock' });
  }

  if (receiptMode === 'arc') {
    const rpcUrl = process.env.ARC_RPC_URL;
    const contractAddress = process.env.USAGE_RECEIPT_ADDRESS;
    const privateKey = process.env.ARC_PRIVATE_KEY;

    if (!rpcUrl || !contractAddress || !privateKey) {
      throw new Error('ARC_RPC_URL, USAGE_RECEIPT_ADDRESS and ARC_PRIVATE_KEY are required for RECEIPT_MODE=arc.');
    }

    return createReceiptWriter({
      mode: 'arc',
      rpcUrl,
      contractAddress,
      privateKey
    });
  }

  throw new Error(`Unsupported RECEIPT_MODE: ${receiptMode}`);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const receiptWriter = parseReceiptWriterFromEnv();
  const artifactDirectory =
    process.env.DEMO_ARTIFACT_DIR ??
    join(process.cwd(), 'artifacts', receiptWriter ? 'receipt-demo' : 'demo-run');
  const summary = await runDemo({
    artifactDirectory,
    operations: parseOperations(process.env.DEMO_OPERATIONS),
    repeatCount: parseRepeatCount(process.env.DEMO_REPEAT_COUNT),
    receiptWriter
  });
  console.log(JSON.stringify(summary, null, 2));
}
