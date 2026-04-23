import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { getRuntimeEnv, requireGatewayBuyerEnv, type RuntimeEnv } from '../config/env.js';
import { buildAgentGraph, type AgentSession, type AgentSessionRun } from './agent-graph.js';
import { demoCorpus } from './corpus.js';
import type {
  EntityExtractionResult,
  ExtractionEntity,
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

const normalizeGraphCandidateLabel = (value: string): string =>
  value
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’.,;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const buildGraphInputs = (
  source: ExtractionRequest,
  summary: string,
  entities: ExtractionEntity[],
  relations: ExtractionRelation[]
): {
  entities: ExtractionEntity[];
  relations: ExtractionRelation[];
} => {
  const entityMap = new Map<string, ExtractionEntity['type']>();
  const relationMap = new Map<string, ExtractionRelation>();

  const upsertEntity = (name: string, type: ExtractionEntity['type'] = 'topic') => {
    const normalizedName = normalizeGraphCandidateLabel(name);

    if (!normalizedName) {
      return;
    }

    const existing = entityMap.get(normalizedName);

    if (!existing || (existing === 'topic' && type !== 'topic')) {
      entityMap.set(normalizedName, type);
    }
  };

  const upsertRelation = (sourceName: string, relation: string, targetName: string) => {
    const normalizedSource = normalizeGraphCandidateLabel(sourceName);
    const normalizedRelation = normalizeGraphCandidateLabel(relation);
    const normalizedTarget = normalizeGraphCandidateLabel(targetName);

    if (!normalizedSource || !normalizedRelation || !normalizedTarget || normalizedSource === normalizedTarget) {
      return;
    }

    const key = `${normalizedSource}:${normalizedRelation}:${normalizedTarget}`;
    relationMap.set(key, {
      source: normalizedSource,
      relation: normalizedRelation,
      target: normalizedTarget
    });
  };

  for (const entity of entities) {
    upsertEntity(entity.name, entity.type);
  }

  for (const relation of relations) {
    upsertEntity(relation.source, entityMap.get(relation.source) ?? 'topic');
    upsertEntity(relation.target, entityMap.get(relation.target) ?? 'topic');
    upsertRelation(relation.source, relation.relation, relation.target);
  }

  const combinedText = [source.title, summary, source.text].filter(Boolean).join('. ');
  const strongOrganizations = [...combinedText.matchAll(/\b[A-Z][a-zA-Z]{1,}\b/g)]
    .map((match) => match[0])
    .filter((token) => !(token === token.toUpperCase() && token.length <= 4));

  for (const organizationName of strongOrganizations) {
    upsertEntity(organizationName, 'organization');
  }

  const topicPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\bAI agents?\b/i, label: 'AI agents' },
    { pattern: /\bgasless nanopayments?\b/i, label: 'Gasless nanopayments' },
    { pattern: /\bsettlement layer\b/i, label: 'Settlement layer' },
    { pattern: /\bmachine-pay flows?\b/i, label: 'Machine-pay flows' },
    { pattern: /\bUSDC\b/i, label: 'USDC' },
    { pattern: /\bpayment network\b/i, label: 'Payment network' },
    { pattern: /结算层/u, label: '结算层' },
    { pattern: /支付网络/u, label: '支付网络' },
    { pattern: /稳定币/u, label: '稳定币' },
    { pattern: /亚太市场/u, label: '亚太市场' },
    { pattern: /AI代理|智能代理/u, label: 'AI 代理' }
  ];

  for (const { pattern, label } of topicPatterns) {
    if (pattern.test(combinedText)) {
      upsertEntity(label, 'topic');
    }
  }

  const partnerMatch = combinedText.match(
    /([A-Z][a-zA-Z]{1,})\s+(?:partners with|partnered with|collaborates with)\s+([A-Z][a-zA-Z]{1,})/i
  );

  if (partnerMatch) {
    upsertEntity(partnerMatch[1], 'organization');
    upsertEntity(partnerMatch[2], 'organization');
    upsertRelation(partnerMatch[1], 'partners_with', partnerMatch[2]);
  }

  const introducedMatch = source.text.match(
    /([A-Z][a-zA-Z]{1,})\s+(?:introduced|launched?)\s+([A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*){0,4})(?:\s+for\s+([A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*){0,3}))?/i
  );

  if (introducedMatch) {
    const [, actor, product, audience] = introducedMatch;
    upsertEntity(actor, 'organization');
    upsertEntity(product, 'topic');
    upsertRelation(actor, 'introduces', product);

    if (audience) {
      upsertEntity(audience, 'topic');
      upsertRelation(product, 'targets', audience);
    }
  }

  const providesMatch = source.text.match(
    /([A-Z][a-zA-Z]{1,})\s+(?:provides|powers|supports)\s+(?:the\s+)?([A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*){0,4})/i
  );

  if (providesMatch) {
    const [, actor, capability] = providesMatch;
    upsertEntity(actor, 'organization');
    upsertEntity(capability, 'topic');
    upsertRelation(actor, 'supports', capability);
  }

  return {
    entities: [...entityMap.entries()].map(([name, type]) => ({ name, type })),
    relations: [...relationMap.values()]
  };
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
    graph: (() => {
      const graphInputs = buildGraphInputs(source, runArtifacts.summary, runArtifacts.entities, runArtifacts.relations);
      return buildAgentGraph(graphInputs.entities, graphInputs.relations);
    })(),
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
