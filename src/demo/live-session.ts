import { randomUUID } from 'node:crypto';

import type { RuntimeEnv } from '../config/env.js';
import type {
  ExtractionEntity,
  ExtractionOperation,
  ExtractionRelation,
  ExtractionRequest,
  SourceMetadata,
  SourceType
} from '../domain/extraction/types.js';
import type { Price } from '../domain/payment/types.js';
import type { ReceiptWriter } from '../domain/receipt/writer.js';
import type { AgentSession, AgentSessionRun } from './agent-graph.js';
import {
  runAgentGraphSession as defaultRunAgentGraphSession,
  type AgentGraphRunOptions,
  type AgentGraphRunResult,
  type AgentGraphRunnerProgressEvent
} from './agent-session-runner.js';
import { FileLiveAgentSessionStore } from '../store/live-session-store.js';
import {
  collectRuntimeSensitiveValues,
  extractSafeErrorMessage,
  sanitizeSensitiveValue,
  stripSensitiveUrlParts
} from '../support/sensitive.js';

export const LIVE_SESSION_STEP_KEYS = ['summary', 'entities', 'relations'] as const;

export type LiveSessionStatus = 'queued' | 'running' | 'completed' | 'failed';
export type LiveSessionStepKey = (typeof LIVE_SESSION_STEP_KEYS)[number];
export type LiveSessionStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export type LiveSessionStep = {
  key: LiveSessionStepKey;
  status: LiveSessionStepStatus;
  requestId?: string;
  price?: Price;
  paymentTransaction?: string;
  paymentAmount?: string;
  paymentNetwork?: string;
  paymentPayer?: string;
  payloadHash?: `0x${string}`;
  receiptTxHash?: `0x${string}`;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

export type LiveSessionPreview = {
  summary?: string;
  entities?: ExtractionEntity[];
  relations?: ExtractionRelation[];
};

export type LiveAgentSession = {
  sessionId: string;
  mode: RuntimeEnv['paymentMode'];
  status: LiveSessionStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failedAt?: string;
  source: ExtractionRequest;
  steps: LiveSessionStep[];
  preview: LiveSessionPreview;
  graphUrl?: string;
  agentSession?: AgentSession;
  error?: string;
};

export type LiveAgentSessionCreateInput = {
  title?: string;
  text: string;
  sourceType?: SourceType;
  metadata?: SourceMetadata;
};

export type LiveAgentSessionStartResult =
  | {
      kind: 'created';
      session: LiveAgentSession;
    }
  | {
      kind: 'conflict';
      session: LiveAgentSession;
    };

type LiveAgentSessionServiceOptions = {
  runtimeEnv: RuntimeEnv;
  liveSessionStore: FileLiveAgentSessionStore;
  agentGraphArtifactRootDirectory: string;
  receiptWriter?: ReceiptWriter;
  graphBaseUrl?: string;
  sessionIdFactory?: () => string;
  runAgentGraphSession?: (options: AgentGraphRunOptions) => Promise<AgentGraphRunResult>;
};

const createLiveSessionId = (): string => `live-${Date.now()}-${randomUUID().slice(0, 8)}`;

const buildInitialSteps = (): LiveSessionStep[] =>
  LIVE_SESSION_STEP_KEYS.map((key) => ({
    key,
    status: 'pending'
  }));

const cloneSteps = (steps: LiveSessionStep[]): LiveSessionStep[] => steps.map((step) => ({ ...step }));

const normalizeTitle = (title: string | undefined): string | undefined => {
  const trimmed = title?.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeMetadata = (metadata: SourceMetadata | undefined): SourceMetadata | undefined => {
  if (!metadata) {
    return undefined;
  }

  const normalizedArticleUrl = metadata.articleUrl?.trim();
  const normalizedCachedAt = metadata.cachedAt?.trim();
  const normalizedMetadata: SourceMetadata = {
    ...(normalizedArticleUrl ? { articleUrl: stripSensitiveUrlParts(normalizedArticleUrl) } : {}),
    ...(metadata.sourceSite ? { sourceSite: metadata.sourceSite } : {}),
    ...(metadata.importMode ? { importMode: metadata.importMode } : {}),
    ...(metadata.importStatus ? { importStatus: metadata.importStatus } : {}),
    ...(normalizedCachedAt ? { cachedAt: normalizedCachedAt } : {})
  };

  return Object.keys(normalizedMetadata).length > 0 ? normalizedMetadata : undefined;
};

export const isActiveLiveSession = (session: LiveAgentSession | null | undefined): session is LiveAgentSession =>
  Boolean(session && (session.status === 'queued' || session.status === 'running'));

export const createLiveAgentSession = (input: {
  sessionId: string;
  source: ExtractionRequest;
  mode: RuntimeEnv['paymentMode'];
  createdAt?: string;
}): LiveAgentSession => {
  const createdAt = input.createdAt ?? new Date().toISOString();

  return {
    sessionId: input.sessionId,
    mode: input.mode,
    status: 'queued',
    createdAt,
    updatedAt: createdAt,
    source: input.source,
    steps: buildInitialSteps(),
    preview: {}
  };
};

const updateSessionStep = (
  session: LiveAgentSession,
  key: LiveSessionStepKey,
  updater: (step: LiveSessionStep) => LiveSessionStep
): LiveAgentSession => ({
  ...session,
  steps: session.steps.map((step) => (step.key === key ? updater(step) : { ...step }))
});

const mapRunIntoStep = (step: LiveSessionStep, run: AgentSessionRun, status: LiveSessionStepStatus, at: string): LiveSessionStep => ({
  ...step,
  status,
  requestId: run.requestId,
  price: run.price,
  paymentTransaction: run.paymentTransaction,
  paymentAmount: run.paymentAmount,
  paymentNetwork: run.paymentNetwork,
  paymentPayer: run.paymentPayer,
  payloadHash: run.payloadHash,
  ...(run.receiptTxHash ? { receiptTxHash: run.receiptTxHash } : {}),
  ...(step.startedAt ? {} : { startedAt: at }),
  ...(status === 'completed' ? { completedAt: at } : {})
});

const applyProgressEvent = (session: LiveAgentSession, event: AgentGraphRunnerProgressEvent): LiveAgentSession => {
  if (event.type === 'step-started') {
    return {
      ...updateSessionStep(session, event.step, (step) => ({
        ...step,
        status: 'running',
        startedAt: step.startedAt ?? event.at,
        error: undefined
      })),
      status: 'running',
      updatedAt: event.at
    };
  }

  return {
    ...updateSessionStep(session, event.step, (step) => mapRunIntoStep(step, event.run, 'completed', event.at)),
    status: 'running',
    updatedAt: event.at,
    preview: {
      ...session.preview,
      ...event.snapshot
    }
  };
};

const hydrateCompletedStepsFromAgentSession = (session: LiveAgentSession, agentSession: AgentSession, at: string): LiveSessionStep[] =>
  LIVE_SESSION_STEP_KEYS.map((key) => {
    const existing = session.steps.find((step) => step.key === key) ?? { key, status: 'pending' };
    const run = agentSession.runs.find((entry) => entry.operation === key);

    if (!run) {
      return {
        ...existing,
        status: agentSession.status === 'completed' ? 'completed' : existing.status
      };
    }

    return mapRunIntoStep(existing, run, 'completed', existing.completedAt ?? at);
  });

const createFailedSession = (session: LiveAgentSession, errorMessage: string, failedAt: string): LiveAgentSession => {
  const runningStep = session.steps.find((step) => step.status === 'running');

  return {
    ...session,
    status: 'failed',
    updatedAt: failedAt,
    failedAt,
    error: errorMessage,
    steps: session.steps.map((step) => {
      if (runningStep && step.key === runningStep.key) {
        return {
          ...step,
          status: 'failed',
          completedAt: failedAt,
          error: errorMessage
        };
      }

      return { ...step };
    })
  };
};

const extractErrorMessage = (runtimeEnv: RuntimeEnv, error: unknown): string => {
  return extractSafeErrorMessage(error, 'Unknown live session error.', {
    sensitiveValues: collectRuntimeSensitiveValues(runtimeEnv)
  });
};

const logLiveSession = (
  runtimeEnv: RuntimeEnv,
  message: string,
  details: Record<string, unknown>
): void => {
  if (runtimeEnv.nodeEnv === 'test') {
    return;
  }

  const safeDetails = sanitizeSensitiveValue(details, {
    sensitiveValues: collectRuntimeSensitiveValues(runtimeEnv)
  });

  console.log(`[live-session] ${message} ${JSON.stringify(safeDetails, null, 0)}`);
};

const buildSource = (input: LiveAgentSessionCreateInput): ExtractionRequest => ({
  sourceType: input.sourceType ?? 'news',
  ...(normalizeTitle(input.title) ? { title: normalizeTitle(input.title) } : {}),
  text: input.text.trim(),
  ...(normalizeMetadata(input.metadata) ? { metadata: normalizeMetadata(input.metadata) } : {})
});

const LIVE_SESSION_HEARTBEAT_INTERVAL_MS = 2_000;

export class LiveAgentSessionService {
  private readonly runAgentGraphSessionImpl: (options: AgentGraphRunOptions) => Promise<AgentGraphRunResult>;

  constructor(private readonly options: LiveAgentSessionServiceOptions) {
    this.runAgentGraphSessionImpl = options.runAgentGraphSession ?? defaultRunAgentGraphSession;
  }

  async startSession(input: LiveAgentSessionCreateInput): Promise<LiveAgentSessionStartResult> {
    const activeSession = await this.options.liveSessionStore.readActiveSession();

    if (isActiveLiveSession(activeSession)) {
      logLiveSession(this.options.runtimeEnv, 'conflict active session exists', {
        sessionId: activeSession.sessionId
      });
      return {
        kind: 'conflict',
        session: activeSession
      };
    }

    const session = createLiveAgentSession({
      sessionId: (this.options.sessionIdFactory ?? createLiveSessionId)(),
      source: buildSource(input),
      mode: this.options.runtimeEnv.paymentMode
    });

    await this.options.liveSessionStore.writeSession(session);

    logLiveSession(this.options.runtimeEnv, 'queued session', {
      sessionId: session.sessionId,
      mode: session.mode,
      sourceType: session.source.sourceType,
      importMode: session.source.metadata?.importMode ?? 'manual',
      importStatus: session.source.metadata?.importStatus ?? null,
      articleUrl: session.source.metadata?.articleUrl ?? null
    });

    queueMicrotask(() => {
      void this.executeSession(session);
    });

    return {
      kind: 'created',
      session
    };
  }

  async readSession(sessionId: string): Promise<LiveAgentSession | null> {
    return this.options.liveSessionStore.readSession(sessionId);
  }

  async readLatestSession(): Promise<LiveAgentSession | null> {
    return this.options.liveSessionStore.readLatestSession();
  }

  async readActiveSession(): Promise<LiveAgentSession | null> {
    return this.options.liveSessionStore.readActiveSession();
  }

  private async executeSession(initialSession: LiveAgentSession): Promise<void> {
    let session: LiveAgentSession = {
      ...initialSession,
      status: 'running',
      updatedAt: new Date().toISOString(),
      steps: cloneSteps(initialSession.steps)
    };

    await this.options.liveSessionStore.writeSession(session);
    logLiveSession(this.options.runtimeEnv, 'start execution', {
      sessionId: session.sessionId,
      mode: session.mode
    });
    const heartbeatTimer = setInterval(() => {
      void this.options.liveSessionStore.touchSession(session.sessionId).catch((error) => {
        logLiveSession(this.options.runtimeEnv, 'heartbeat touch failed', {
          sessionId: session.sessionId,
          error: extractErrorMessage(this.options.runtimeEnv, error)
        });
      });
    }, LIVE_SESSION_HEARTBEAT_INTERVAL_MS);

    heartbeatTimer.unref?.();

    try {
      const result = await this.runAgentGraphSessionImpl({
        artifactRootDirectory: this.options.agentGraphArtifactRootDirectory,
        source: session.source,
        runtimeEnv: this.options.runtimeEnv,
        receiptWriter: this.options.receiptWriter,
        graphBaseUrl: this.options.graphBaseUrl,
        sessionIdFactory: () => session.sessionId,
        onProgress: async (event) => {
          logLiveSession(this.options.runtimeEnv, event.type, {
            sessionId: event.sessionId,
            step: event.step,
            requestId: event.type === 'step-completed' ? event.run.requestId : null,
            paymentTransaction: event.type === 'step-completed' ? event.run.paymentTransaction : null
          });

          session = applyProgressEvent(session, event);
          await this.options.liveSessionStore.writeSession(session);
        }
      });
      const completedAt = new Date().toISOString();

      session = {
        ...session,
        status: 'completed',
        updatedAt: completedAt,
        completedAt,
        graphUrl: result.graphUrl,
        agentSession: result.session,
        preview: {
          summary: result.session.summary,
          entities: result.session.entities,
          relations: result.session.relations
        },
        steps: hydrateCompletedStepsFromAgentSession(session, result.session, completedAt)
      };
      await this.options.liveSessionStore.writeSession(session);
      logLiveSession(this.options.runtimeEnv, 'completed session', {
        sessionId: session.sessionId,
        successfulRuns: result.session.runs.length,
        totalPrice: result.session.totals.totalPrice,
        graphUrl: result.graphUrl
      });
    } catch (error) {
      session = createFailedSession(session, extractErrorMessage(this.options.runtimeEnv, error), new Date().toISOString());
      await this.options.liveSessionStore.writeSession(session);
      logLiveSession(this.options.runtimeEnv, 'failed session', {
        sessionId: session.sessionId,
        error: session.error ?? 'Unknown live session error.'
      });
    } finally {
      clearInterval(heartbeatTimer);
    }
  }
}
