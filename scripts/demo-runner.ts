import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { MockKnowledgeExtractionProvider } from '../src/domain/extraction/mock-provider.js';
import type { ExtractionOperation, ExtractionRequest } from '../src/domain/extraction/types.js';
import { MockPaymentAdapter } from '../src/domain/payment/mock-payment.js';
import type { ReceiptWriter } from '../src/domain/receipt/writer.js';
import { createExtractRouter } from '../src/routes/extract.js';
import { FileCallLogStore, type CallLogStats } from '../src/store/call-log-store.js';
import { demoCorpus } from '../src/demo/corpus.js';

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

export type DemoRunOptions = {
  artifactDirectory: string;
  corpus?: ExtractionRequest[];
  operations?: ExtractionOperation[];
  receiptWriter?: ReceiptWriter;
};

export type DemoRunSummary = {
  totalRuns: number;
  successCount: number;
  requestIds: string[];
  stats: CallLogStats;
  receiptTxHashes?: `0x${string}`[];
};

const createMockResponse = (): MockResponse => ({
  statusCode: 200,
  body: undefined,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(payload: unknown) {
    this.body = payload;
    return this;
  }
});

const getRouteHandler = (path: string, requestIdFactory: () => string) => {
  const router = createExtractRouter({
    extractionProvider: new MockKnowledgeExtractionProvider(),
    paymentAdapter: new MockPaymentAdapter(),
    requestIdFactory
  });
  const stack = Reflect.get(router, 'stack') as Array<{
    route?: { path?: string; stack?: Array<{ handle?: (...args: any[]) => unknown }> };
  }>;
  const layer = stack.find((entry) => entry.route?.path === path);

  return layer?.route?.stack?.[0]?.handle;
};

const operationPath: Record<ExtractionOperation, `/${ExtractionOperation}`> = {
  summary: '/summary',
  entities: '/entities',
  relations: '/relations'
};

export const runDemo = async (options: DemoRunOptions): Promise<DemoRunSummary> => {
  const corpus = options.corpus ?? demoCorpus;
  const operations = options.operations ?? ['summary', 'entities', 'relations'];
  const callLogPath = join(options.artifactDirectory, 'call-log.jsonl');
  const summaryPath = join(options.artifactDirectory, 'summary.json');
  const store = new FileCallLogStore(callLogPath);
  let requestCounter = 0;
  const requestIdFactory = () => `demo-${String(++requestCounter).padStart(3, '0')}`;
  const requestIds: string[] = [];
  const receiptTxHashes: `0x${string}`[] = [];
  let successCount = 0;

  await mkdir(options.artifactDirectory, { recursive: true });

  for (const item of corpus) {
    for (const operation of operations) {
      const handler = getRouteHandler(operationPath[operation], requestIdFactory);
      const response = createMockResponse();

      await handler?.(
        {
          body: item,
          headers: {
            'x-payment-token': 'mock-paid'
          }
        } as any,
        response as any,
        () => undefined
      );

      if (response.statusCode !== 200) {
        continue;
      }

      const payload = response.body as {
        requestId: string;
        pricedOperation: { operation: ExtractionOperation; price: `$${number}` };
        result: { kind: 'summary' | 'entities' | 'relations' };
        payment: { mode: 'mock' | 'gateway'; status: 'paid' };
      };

      requestIds.push(payload.requestId);
      successCount += 1;

      const payloadHash = `0x${createHash('sha256').update(JSON.stringify(payload.result)).digest('hex')}` as `0x${string}`;
      const receiptResult = options.receiptWriter
        ? await options.receiptWriter.write({
            requestId: payload.requestId,
            operation: payload.pricedOperation.operation,
            payloadHash
          })
        : undefined;

      if (receiptResult) {
        receiptTxHashes.push(receiptResult.txHash);
      }

      await store.append({
        requestId: payload.requestId,
        operation: payload.pricedOperation.operation,
        price: payload.pricedOperation.price,
        paymentMode: payload.payment.mode,
        paymentStatus: payload.payment.status,
        resultKind: payload.result.kind,
        createdAt: new Date().toISOString(),
        receiptTxHash: receiptResult?.txHash
      });
    }
  }

  const stats = await store.getStats();
  const summary = {
    totalRuns: corpus.length * operations.length,
    successCount,
    requestIds,
    stats,
    ...(options.receiptWriter ? { receiptTxHashes } : {})
  } satisfies DemoRunSummary;

  await store.writeSummary(summaryPath, summary);
  return summary;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const artifactDirectory = join(process.cwd(), 'artifacts', 'demo-run');
  const summary = await runDemo({ artifactDirectory });
  console.log(JSON.stringify(summary, null, 2));
}
