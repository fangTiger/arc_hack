import { randomUUID } from 'node:crypto';

import type { RuntimeEnv } from '../config/env.js';
import type { ExtractionEntity, ExtractionOperation, ExtractionRelation, ExtractionRequest, SourceType } from '../domain/extraction/types.js';
import type { Price } from '../domain/payment/types.js';
import type { AgentSession, AgentSessionRun } from './agent-graph.js';
import {
  runAgentGraphSession as defaultRunAgentGraphSession,
  type AgentGraphRunOptions,
  type AgentGraphRunResult,
  type AgentGraphRunnerProgressEvent
} from './agent-session-runner.js';
import { FileLiveAgentSessionStore } from '../store/live-session-store.js';

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

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown live session error.';
};

const buildSource = (input: LiveAgentSessionCreateInput): ExtractionRequest => ({
  sourceType: input.sourceType ?? 'news',
  ...(normalizeTitle(input.title) ? { title: normalizeTitle(input.title) } : {}),
  text: input.text.trim()
});

export class LiveAgentSessionService {
  private readonly runAgentGraphSessionImpl: (options: AgentGraphRunOptions) => Promise<AgentGraphRunResult>;

  constructor(private readonly options: LiveAgentSessionServiceOptions) {
    this.runAgentGraphSessionImpl = options.runAgentGraphSession ?? defaultRunAgentGraphSession;
  }

  async startSession(input: LiveAgentSessionCreateInput): Promise<LiveAgentSessionStartResult> {
    const activeSession = await this.options.liveSessionStore.readActiveSession();

    if (isActiveLiveSession(activeSession)) {
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

  private async executeSession(initialSession: LiveAgentSession): Promise<void> {
    let session: LiveAgentSession = {
      ...initialSession,
      status: 'running',
      updatedAt: new Date().toISOString(),
      steps: cloneSteps(initialSession.steps)
    };

    await this.options.liveSessionStore.writeSession(session);

    try {
      const result = await this.runAgentGraphSessionImpl({
        artifactRootDirectory: this.options.agentGraphArtifactRootDirectory,
        source: session.source,
        runtimeEnv: this.options.runtimeEnv,
        graphBaseUrl: this.options.graphBaseUrl,
        sessionIdFactory: () => session.sessionId,
        onProgress: async (event) => {
          if (this.options.runtimeEnv.paymentMode !== 'mock') {
            return;
          }

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
    } catch (error) {
      session = createFailedSession(session, extractErrorMessage(error), new Date().toISOString());
      await this.options.liveSessionStore.writeSession(session);
    }
  }
}
