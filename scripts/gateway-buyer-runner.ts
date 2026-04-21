import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { env, loadRuntimeEnv, requireGatewayBuyerEnv, type RuntimeEnv } from '../src/config/env.js';
import { demoCorpus } from '../src/demo/corpus.js';
import type { ExtractionOperation, ExtractionRequest } from '../src/domain/extraction/types.js';
import { createGatewayBuyer, type GatewayBuyer, type GatewayBuyerConfig, type GatewayBuyerRequest } from '../src/domain/payment/gateway-buyer.js';
import { type ReceiptWriter } from '../src/domain/receipt/writer.js';
import { FileCallLogStore, type CallLogEntry, type CallLogStats } from '../src/store/call-log-store.js';
import { parseOperations, parseReceiptWriterFromEnv, parseRepeatCount } from './demo-runner.js';

export type GatewayBuyerDemoOptions = {
  artifactDirectory: string;
  corpus?: ExtractionRequest[];
  operations?: ExtractionOperation[];
  repeatCount?: number;
  runtimeEnv?: RuntimeEnv;
  receiptWriter?: ReceiptWriter;
  createBuyer?: (config: GatewayBuyerConfig) => GatewayBuyer;
  resetArtifacts?: boolean;
};

type SerializableBalances = {
  wallet: {
    balance: string;
    formatted: string;
  };
  gateway: {
    total: string;
    available: string;
    withdrawing: string;
    withdrawable: string;
    formattedTotal: string;
    formattedAvailable: string;
    formattedWithdrawing: string;
    formattedWithdrawable: string;
  };
};

export type GatewayBuyerDemoSummary = {
  totalRuns: number;
  successCount: number;
  requestIds: string[];
  paymentTransactions: string[];
  stats: CallLogStats;
  balances: {
    before: SerializableBalances;
    after: SerializableBalances;
  };
  deposit?: {
    amount: string;
    formattedAmount: string;
    depositor: string;
    depositTxHash: string;
    approvalTxHash?: string;
  };
  receiptTxHashes?: `0x${string}`[];
};

const buildRequests = (
  corpus: ExtractionRequest[],
  operations: ExtractionOperation[],
  repeatCount: number
): GatewayBuyerRequest[] => {
  const requests: GatewayBuyerRequest[] = [];
  let counter = 0;

  for (let round = 0; round < repeatCount; round += 1) {
    for (const item of corpus) {
      for (const operation of operations) {
        requests.push({
          requestId: `gateway-${String(++counter).padStart(3, '0')}`,
          operation,
          body: item
        });
      }
    }
  }

  return requests;
};

const buildCallLogEntry = (payment: Awaited<ReturnType<GatewayBuyer['payBatch']>>['payments'][number]): CallLogEntry => {
  return {
    requestId: payment.requestId,
    operation: payment.operation,
    price: payment.pricedOperation.price,
    paymentMode: payment.payment.mode,
    paymentStatus: payment.payment.status,
    resultKind: payment.result.kind,
    createdAt: new Date().toISOString(),
    paymentAmount: payment.payment.amount,
    paymentNetwork: payment.payment.network,
    paymentPayer: payment.payment.payer,
    paymentTransaction: payment.payment.transaction
  };
};

const serializeBalances = (value: Awaited<ReturnType<GatewayBuyer['payBatch']>>['balances']['before']): SerializableBalances => {
  return {
    wallet: {
      balance: value.wallet.formatted,
      formatted: value.wallet.formatted
    },
    gateway: {
      total: value.gateway.formattedTotal,
      available: value.gateway.formattedAvailable,
      withdrawing: value.gateway.formattedWithdrawing,
      withdrawable: value.gateway.formattedWithdrawable,
      formattedTotal: value.gateway.formattedTotal,
      formattedAvailable: value.gateway.formattedAvailable,
      formattedWithdrawing: value.gateway.formattedWithdrawing,
      formattedWithdrawable: value.gateway.formattedWithdrawable
    }
  };
};

export const runGatewayBuyerDemo = async (options: GatewayBuyerDemoOptions): Promise<GatewayBuyerDemoSummary> => {
  const runtimeEnv = options.runtimeEnv ?? env;
  const buyerConfig = requireGatewayBuyerEnv(runtimeEnv);
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

  const buyer = (options.createBuyer ?? createGatewayBuyer)(buyerConfig);
  const requests = buildRequests(corpus, operations, repeatCount);
  const batch = await buyer.payBatch(requests);
  const receiptTxHashes: `0x${string}`[] = [];

  for (const payment of batch.payments) {
    await store.append(buildCallLogEntry(payment));

    if (options.receiptWriter) {
      const payloadHash = `0x${createHash('sha256').update(JSON.stringify(payment.result)).digest('hex')}` as `0x${string}`;
      const receipt = await options.receiptWriter.write({
        requestId: payment.requestId,
        operation: payment.operation,
        payloadHash
      });

      receiptTxHashes.push(receipt.txHash);
      await store.attachReceiptTxHash(payment.requestId, receipt.txHash);
    }
  }

  const stats = await store.getStats();
  const summary = {
    totalRuns: requests.length,
    successCount: batch.payments.length,
    requestIds: batch.payments.map((payment) => payment.requestId),
    paymentTransactions: batch.payments.map((payment) => payment.payment.transaction),
    stats,
    balances: {
      before: serializeBalances(batch.balances.before),
      after: serializeBalances(batch.balances.after)
    },
    ...(batch.deposit
      ? {
          deposit: {
            amount: batch.deposit.amount.toString(),
            formattedAmount: batch.deposit.formattedAmount,
            depositor: batch.deposit.depositor,
            depositTxHash: batch.deposit.depositTxHash,
            ...(batch.deposit.approvalTxHash ? { approvalTxHash: batch.deposit.approvalTxHash } : {})
          }
        }
      : {}),
    ...(options.receiptWriter ? { receiptTxHashes } : {})
  } satisfies GatewayBuyerDemoSummary;

  await store.writeSummary(summaryPath, summary);
  return summary;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const runtimeEnv = loadRuntimeEnv();
  const receiptWriter = parseReceiptWriterFromEnv();
  const artifactDirectory = process.env.DEMO_ARTIFACT_DIR ?? join(process.cwd(), 'artifacts', 'gateway-run');
  const summary = await runGatewayBuyerDemo({
    artifactDirectory,
    operations: parseOperations(process.env.DEMO_OPERATIONS),
    repeatCount: parseRepeatCount(process.env.DEMO_REPEAT_COUNT),
    receiptWriter,
    runtimeEnv
  });

  console.log(JSON.stringify(summary, null, 2));
}
