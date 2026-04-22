import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { createApp } from '../src/app.js';
import { getRuntimeEnv, requireGatewayBuyerEnv, type RuntimeEnv } from '../src/config/env.js';
import { buildAgentGraph, type AgentSession, type AgentSessionRun } from '../src/demo/agent-graph.js';
import { demoCorpus } from '../src/demo/corpus.js';
import type {
  EntityExtractionResult,
  ExtractionOperation,
  ExtractionRelation,
  ExtractionRequest,
  ExtractionResult,
  RelationExtractionResult,
  SummaryExtractionResult
} from '../src/domain/extraction/types.js';
import { createGatewayBuyer, type GatewayBuyer, type GatewayBuyerConfig, type GatewayBuyerRequest } from '../src/domain/payment/gateway-buyer.js';
import type { Price } from '../src/domain/payment/types.js';
import type { ReceiptWriter } from '../src/domain/receipt/writer.js';
import { FileAgentGraphStore } from '../src/store/agent-graph-store.js';
import { FileCallLogStore } from '../src/store/call-log-store.js';
import { invokeApp } from '../src/support/invoke-app.js';
import { parseReceiptWriterFromEnv } from './demo-runner.js';

type PaidExtractionPayload = {
  requestId: string;
  pricedOperation: {
    operation: ExtractionOperation;
    price: Price;
  };
  result: ExtractionResult;
};

type AgentGraphRunArtifacts = {
  summary: string;
  entities: EntityExtractionResult['entities'];
  relations: ExtractionRelation[];
  runs: AgentSessionRun[];
};

export type AgentGraphRunResult = {
  sessionId: string;
  artifactPath: string;
  graphUrl: string;
  session: AgentSession;
};

export type AgentGraphRunOptions = {
  artifactRootDirectory: string;
  source?: ExtractionRequest;
  runtimeEnv?: RuntimeEnv;
  receiptWriter?: ReceiptWriter;
  graphBaseUrl?: string;
  sessionIdFactory?: () => string;
  createBuyer?: (config: GatewayBuyerConfig) => GatewayBuyer;
};

const OPERATIONS: ExtractionOperation[] = ['summary', 'entities', 'relations'];

const createSessionId = (): string => `session-${Date.now()}-${randomUUID().slice(0, 8)}`;

const buildGraphUrl = (sessionId: string, runtimeEnv: RuntimeEnv, graphBaseUrl?: string): string => {
  const baseUrl = graphBaseUrl ?? runtimeEnv.gatewayBuyerBaseUrl ?? `http://127.0.0.1:${runtimeEnv.port}`;
  return `${baseUrl.replace(/\/$/, '')}/demo/graph/${sessionId}`;
};

const priceToAtomicAmount = (price: Price): string => {
  return String(Math.round(Number(price.slice(1)) * 1_000_000));
};

const sumPrices = (prices: Price[]): Price => {
  const total = prices.reduce((sum, price) => sum + Number(price.slice(1)), 0);
  return `$${total.toFixed(3)}` as Price;
};

const hashPayload = (payload: ExtractionResult): `0x${string}` => {
  return `0x${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}` as `0x${string}`;
};

const normalizeResult = <Operation extends ExtractionOperation>(
  operation: Operation,
  result: ExtractionResult
): Operation extends 'summary'
  ? SummaryExtractionResult
  : Operation extends 'entities'
    ? EntityExtractionResult
    : RelationExtractionResult => {
  if (operation !== result.kind) {
    throw new Error(`Expected ${operation} result but received ${result.kind}.`);
  }

  return result as never;
};

const buildGatewayRequests = (source: ExtractionRequest): GatewayBuyerRequest[] => {
  return OPERATIONS.map((operation, index) => ({
    requestId: `gateway-${String(index + 1).padStart(3, '0')}`,
    operation,
    body: source
  }));
};

const runMockAgentSession = async (
  sessionId: string,
  source: ExtractionRequest,
  runtimeEnv: RuntimeEnv,
  artifactRootDirectory: string,
  receiptWriter?: ReceiptWriter
): Promise<AgentGraphRunArtifacts> => {
  const sessionDirectory = join(artifactRootDirectory, sessionId);
  const callLogStore = new FileCallLogStore(join(sessionDirectory, 'call-log.jsonl'));
  const app = createApp({
    runtimeEnv: {
      ...runtimeEnv,
      paymentMode: 'mock',
      callLogPath: join(sessionDirectory, 'call-log.jsonl')
    },
    callLogStore
  });
  const runs: AgentSessionRun[] = [];
  let summary = '';
  let entities: EntityExtractionResult['entities'] = [];
  let relations: ExtractionRelation[] = [];

  for (const [index, operation] of OPERATIONS.entries()) {
    const requestId = `agent-${String(index + 1).padStart(3, '0')}`;
    const response = await invokeApp(app, {
      method: 'POST',
      path: `/api/extract/${operation}`,
      headers: {
        'x-request-id': requestId,
        'x-payment-token': 'mock-paid'
      },
      body: source
    });

    if (response.statusCode !== 200) {
      throw new Error(`Mock agent session failed for ${operation} with status ${response.statusCode}.`);
    }

    const payload = response.json as PaidExtractionPayload;
    const result = normalizeResult(operation, payload.result);
    const payloadHash = hashPayload(result);
    let receiptTxHash: `0x${string}` | undefined;

    if (receiptWriter) {
      const receipt = await receiptWriter.write({
        requestId: payload.requestId,
        operation,
        payloadHash
      });
      receiptTxHash = receipt.txHash;
      await callLogStore.attachReceiptTxHash(payload.requestId, receipt.txHash);
    }

    runs.push({
      requestId: payload.requestId,
      operation,
      price: payload.pricedOperation.price,
      paymentTransaction: `mock-${payload.requestId}`,
      paymentAmount: priceToAtomicAmount(payload.pricedOperation.price),
      paymentNetwork: 'mock-network',
      paymentPayer: 'mock-buyer',
      payloadHash,
      ...(receiptTxHash ? { receiptTxHash } : {})
    });

    if (operation === 'summary') {
      summary = (result as SummaryExtractionResult).summary;
      continue;
    }

    if (operation === 'entities') {
      entities = (result as EntityExtractionResult).entities;
      continue;
    }

    relations = (result as RelationExtractionResult).relations;
  }

  return {
    summary,
    entities,
    relations,
    runs
  };
};

const runGatewayAgentSession = async (
  source: ExtractionRequest,
  runtimeEnv: RuntimeEnv,
  receiptWriter: ReceiptWriter | undefined,
  createBuyer: ((config: GatewayBuyerConfig) => GatewayBuyer) | undefined
): Promise<AgentGraphRunArtifacts> => {
  const buyerConfig = requireGatewayBuyerEnv(runtimeEnv);
  const buyer = (createBuyer ?? createGatewayBuyer)(buyerConfig);
  const payments = (await buyer.payBatch(buildGatewayRequests(source))).payments;
  const runs: AgentSessionRun[] = [];
  let summary = '';
  let entities: EntityExtractionResult['entities'] = [];
  let relations: ExtractionRelation[] = [];

  for (const payment of payments) {
    const result = normalizeResult(payment.operation, payment.result);
    const payloadHash = hashPayload(result);
    let receiptTxHash: `0x${string}` | undefined;

    if (receiptWriter) {
      const receipt = await receiptWriter.write({
        requestId: payment.requestId,
        operation: payment.operation,
        payloadHash
      });
      receiptTxHash = receipt.txHash;
    }

    runs.push({
      requestId: payment.requestId,
      operation: payment.operation,
      price: payment.pricedOperation.price,
      paymentTransaction: payment.payment.transaction,
      paymentAmount: payment.payment.amount,
      paymentNetwork: payment.payment.network,
      paymentPayer: payment.payment.payer,
      payloadHash,
      ...(receiptTxHash ? { receiptTxHash } : {})
    });

    if (payment.operation === 'summary') {
      summary = (result as SummaryExtractionResult).summary;
      continue;
    }

    if (payment.operation === 'entities') {
      entities = (result as EntityExtractionResult).entities;
      continue;
    }

    relations = (result as RelationExtractionResult).relations;
  }

  return {
    summary,
    entities,
    relations,
    runs
  };
};

export const runAgentGraphSession = async (options: AgentGraphRunOptions): Promise<AgentGraphRunResult> => {
  const runtimeEnv = options.runtimeEnv ?? getRuntimeEnv();
  const source = options.source ?? demoCorpus[0];
  const sessionId = (options.sessionIdFactory ?? createSessionId)();
  const store = new FileAgentGraphStore(options.artifactRootDirectory);
  const runArtifacts =
    runtimeEnv.paymentMode === 'gateway'
      ? await runGatewayAgentSession(source, runtimeEnv, options.receiptWriter, options.createBuyer)
      : await runMockAgentSession(sessionId, source, runtimeEnv, options.artifactRootDirectory, options.receiptWriter);
  const session: AgentSession = {
    status: 'completed',
    sessionId,
    createdAt: new Date().toISOString(),
    source,
    summary: runArtifacts.summary,
    entities: runArtifacts.entities,
    relations: runArtifacts.relations,
    runs: runArtifacts.runs,
    graph: buildAgentGraph(runArtifacts.entities, runArtifacts.relations),
    totals: {
      totalPrice: sumPrices(runArtifacts.runs.map((run) => run.price)),
      successfulRuns: runArtifacts.runs.length
    }
  };

  await store.writeSession(session);

  return {
    sessionId,
    artifactPath: store.getSessionPath(sessionId),
    graphUrl: buildGraphUrl(sessionId, runtimeEnv, options.graphBaseUrl),
    session
  };
};

const buildSourceFromEnv = (): ExtractionRequest => {
  const defaultSource = demoCorpus[0];
  const sourceType = process.env.AGENT_SOURCE_TYPE === 'research' ? 'research' : defaultSource.sourceType;

  return {
    sourceType,
    title: process.env.AGENT_SOURCE_TITLE ?? defaultSource.title,
    text: process.env.AGENT_SOURCE_TEXT ?? defaultSource.text
  };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const runtimeEnv = getRuntimeEnv();
  const receiptWriter = parseReceiptWriterFromEnv();
  const result = await runAgentGraphSession({
    artifactRootDirectory: process.env.DEMO_ARTIFACT_DIR ?? join(process.cwd(), 'artifacts', 'agent-graph'),
    source: buildSourceFromEnv(),
    runtimeEnv,
    receiptWriter,
    graphBaseUrl: process.env.GRAPH_BASE_URL
  });

  console.log(`sessionId: ${result.sessionId}`);
  console.log(`artifactPath: ${result.artifactPath}`);
  console.log(`graphUrl: ${result.graphUrl}`);
}
