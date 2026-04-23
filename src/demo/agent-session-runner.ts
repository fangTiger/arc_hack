import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { getRuntimeEnv, requireGatewayBuyerEnv, type RuntimeEnv } from '../config/env.js';
import { buildAgentGraph, type AgentSession, type AgentSessionRun } from './agent-graph.js';
import { demoCorpus } from './corpus.js';
import type {
  EntityExtractionResult,
  ExtractionOperation,
  ExtractionRelation,
  ExtractionRequest,
  ExtractionResult,
  RelationExtractionResult,
  SummaryExtractionResult
} from '../domain/extraction/types.js';
import { createGatewayBuyer, type GatewayBuyer, type GatewayBuyerConfig, type GatewayBuyerRequest } from '../domain/payment/gateway-buyer.js';
import type { Price } from '../domain/payment/types.js';
import type { ReceiptWriter } from '../domain/receipt/writer.js';
import { FileAgentGraphStore } from '../store/agent-graph-store.js';
import { FileCallLogStore } from '../store/call-log-store.js';
import { invokeApp } from '../support/invoke-app.js';

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

export type AgentGraphRunnerProgressEvent =
  | {
      type: 'step-started';
      step: ExtractionOperation;
      at: string;
      sessionId: string;
    }
  | {
      type: 'step-completed';
      step: ExtractionOperation;
      at: string;
      sessionId: string;
      run: AgentSessionRun;
      snapshot: {
        summary?: string;
        entities?: EntityExtractionResult['entities'];
        relations?: ExtractionRelation[];
      };
    };

export type AgentGraphRunOptions = {
  artifactRootDirectory: string;
  source?: ExtractionRequest;
  runtimeEnv?: RuntimeEnv;
  receiptWriter?: ReceiptWriter;
  graphBaseUrl?: string;
  sessionIdFactory?: () => string;
  createBuyer?: (config: GatewayBuyerConfig) => GatewayBuyer;
  onProgress?: (event: AgentGraphRunnerProgressEvent) => Promise<void> | void;
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

const emitProgress = async (
  handler: AgentGraphRunOptions['onProgress'],
  event: AgentGraphRunnerProgressEvent
): Promise<void> => {
  await handler?.(event);
};

const runMockAgentSession = async (
  sessionId: string,
  source: ExtractionRequest,
  runtimeEnv: RuntimeEnv,
  artifactRootDirectory: string,
  receiptWriter: ReceiptWriter | undefined,
  onProgress: AgentGraphRunOptions['onProgress']
): Promise<AgentGraphRunArtifacts> => {
  const sessionDirectory = join(artifactRootDirectory, sessionId);
  const callLogStore = new FileCallLogStore(join(sessionDirectory, 'call-log.jsonl'));
  const { createApp } = await import('../app.js');
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
    const startedAt = new Date().toISOString();

    await emitProgress(onProgress, {
      type: 'step-started',
      step: operation,
      at: startedAt,
      sessionId
    });

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

    const run = {
      requestId: payload.requestId,
      operation,
      price: payload.pricedOperation.price,
      paymentTransaction: `mock-${payload.requestId}`,
      paymentAmount: priceToAtomicAmount(payload.pricedOperation.price),
      paymentNetwork: 'mock-network',
      paymentPayer: 'mock-buyer',
      payloadHash,
      ...(receiptTxHash ? { receiptTxHash } : {})
    } satisfies AgentSessionRun;

    runs.push(run);

    if (operation === 'summary') {
      summary = (result as SummaryExtractionResult).summary;
    } else if (operation === 'entities') {
      entities = (result as EntityExtractionResult).entities;
    } else {
      relations = (result as RelationExtractionResult).relations;
    }

    await emitProgress(onProgress, {
      type: 'step-completed',
      step: operation,
      at: new Date().toISOString(),
      sessionId,
      run,
      snapshot: {
        ...(summary ? { summary } : {}),
        ...(entities.length > 0 ? { entities } : {}),
        ...(relations.length > 0 ? { relations } : {})
      }
    });
  }

  return {
    summary,
    entities,
    relations,
    runs
  };
};

const runGatewayAgentSession = async (
  sessionId: string,
  source: ExtractionRequest,
  runtimeEnv: RuntimeEnv,
  receiptWriter: ReceiptWriter | undefined,
  createBuyer: ((config: GatewayBuyerConfig) => GatewayBuyer) | undefined,
  onProgress: AgentGraphRunOptions['onProgress']
): Promise<AgentGraphRunArtifacts> => {
  const buyerConfig = requireGatewayBuyerEnv(runtimeEnv);
  const buyer = (createBuyer ?? createGatewayBuyer)(buyerConfig);
  const startedSteps = new Set<ExtractionOperation>();

  const ensureStepStarted = async (step: ExtractionOperation) => {
    if (startedSteps.has(step)) {
      return;
    }

    startedSteps.add(step);
    await emitProgress(onProgress, {
      type: 'step-started',
      step,
      at: new Date().toISOString(),
      sessionId
    });
  };

  await ensureStepStarted('summary');
  const payments = (await buyer.payBatch(buildGatewayRequests(source))).payments;
  const runs: AgentSessionRun[] = [];
  let summary = '';
  let entities: EntityExtractionResult['entities'] = [];
  let relations: ExtractionRelation[] = [];

  for (const payment of payments) {
    await ensureStepStarted(payment.operation);

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
    } else if (payment.operation === 'entities') {
      entities = (result as EntityExtractionResult).entities;
    } else {
      relations = (result as RelationExtractionResult).relations;
    }

    await emitProgress(onProgress, {
      type: 'step-completed',
      step: payment.operation,
      at: new Date().toISOString(),
      sessionId,
      run: runs[runs.length - 1]!,
      snapshot: {
        ...(summary ? { summary } : {}),
        ...(entities.length > 0 ? { entities } : {}),
        ...(relations.length > 0 ? { relations } : {})
      }
    });

    const nextOperation = OPERATIONS[OPERATIONS.indexOf(payment.operation) + 1];

    if (nextOperation) {
      await ensureStepStarted(nextOperation);
    }
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
      ? await runGatewayAgentSession(
          sessionId,
          source,
          runtimeEnv,
          options.receiptWriter,
          options.createBuyer,
          options.onProgress
        )
      : await runMockAgentSession(
          sessionId,
          source,
          runtimeEnv,
          options.artifactRootDirectory,
          options.receiptWriter,
          options.onProgress
        );
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
