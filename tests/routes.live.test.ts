import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { loadRuntimeEnv } from '../src/config/env.js';
import { buildAgentGraph, type AgentSession } from '../src/demo/agent-graph.js';
import { LiveAgentSessionService, type LiveAgentSession } from '../src/demo/live-session.js';
import type { AgentGraphRunResult } from '../src/demo/agent-session-runner.js';
import { FileAgentGraphStore } from '../src/store/agent-graph-store.js';
import { FileLiveAgentSessionStore } from '../src/store/live-session-store.js';
import { invokeApp } from '../src/support/invoke-app.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const sleep = async (milliseconds: number) => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const createCompletedAgentSession = (sessionId: string): AgentSession => ({
  status: 'completed',
  sessionId,
  createdAt: '2026-04-22T10:00:00.000Z',
  source: {
    sourceType: 'news',
    title: 'Arc live console',
    text: 'Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.'
  },
  summary: 'Arc partners with Circle on machine-pay flows.',
  entities: [
    { name: 'Arc', type: 'organization' },
    { name: 'Circle', type: 'organization' }
  ],
  relations: [{ source: 'Arc', relation: 'mentions', target: 'Circle' }],
  runs: [
    {
      requestId: 'agent-001',
      operation: 'summary',
      price: '$0.004',
      paymentTransaction: 'mock-agent-001',
      paymentAmount: '4000',
      paymentNetwork: 'mock-network',
      paymentPayer: 'mock-buyer',
      payloadHash: '0xsummary'
    },
    {
      requestId: 'agent-002',
      operation: 'entities',
      price: '$0.003',
      paymentTransaction: 'mock-agent-002',
      paymentAmount: '3000',
      paymentNetwork: 'mock-network',
      paymentPayer: 'mock-buyer',
      payloadHash: '0xentities'
    },
    {
      requestId: 'agent-003',
      operation: 'relations',
      price: '$0.005',
      paymentTransaction: 'mock-agent-003',
      paymentAmount: '5000',
      paymentNetwork: 'mock-network',
      paymentPayer: 'mock-buyer',
      payloadHash: '0xrelations'
    }
  ],
  graph: buildAgentGraph(
    [
      { name: 'Arc', type: 'organization' },
      { name: 'Circle', type: 'organization' }
    ],
    [{ source: 'Arc', relation: 'mentions', target: 'Circle' }]
  ),
  totals: {
    totalPrice: '$0.012',
    successfulRuns: 3
  }
});

const waitForSession = async (
  store: FileLiveAgentSessionStore,
  sessionId: string,
  status: LiveAgentSession['status'] = 'completed'
) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const session = await store.readSession(sessionId);

    if (session?.status === status) {
      return session;
    }

    await sleep(10);
  }

  throw new Error(`Timed out waiting for live session ${sessionId} to reach ${status}.`);
};

const createTestHarness = (overrides: {
  runAgentGraphSession?: (options: { sessionId: string }) => Promise<AgentGraphRunResult>;
} = {}) => {
  const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-live-route-'));
  const runtimeEnv = loadRuntimeEnv({
    NODE_ENV: 'test',
    PORT: '3000',
    PAYMENT_MODE: 'mock',
    AI_MODE: 'mock',
    CALL_LOG_PATH: join(workingDirectory, 'call-log.jsonl')
  });
  const agentGraphStore = new FileAgentGraphStore(join(workingDirectory, 'artifacts', 'agent-graph'));
  const liveSessionStore = new FileLiveAgentSessionStore(join(workingDirectory, 'artifacts', 'live-console'));
  const customRunAgentGraphSession = overrides.runAgentGraphSession;
  const liveSessionService = new LiveAgentSessionService({
    runtimeEnv,
    liveSessionStore,
    agentGraphArtifactRootDirectory: agentGraphStore.getRootDirectory(),
    runAgentGraphSession: customRunAgentGraphSession
      ? async (options) => customRunAgentGraphSession({ sessionId: options.sessionIdFactory?.() ?? 'missing-session-id' })
      : undefined
  });

  temporaryDirectories.push(workingDirectory);

  return {
    app: createApp({
      runtimeEnv,
      agentGraphStore,
      liveSessionStore,
      liveSessionService
    }),
    liveSessionStore,
    workingDirectory
  };
};

describe('createLiveRouter', () => {
  it('should render the live console page shell', async () => {
    const { app } = createTestHarness();

    const response = await invokeApp(app, {
      method: 'GET',
      path: '/demo/live'
    });

    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('Live Agent Console');
    expect(response.text).toContain('知识图谱 Live Console');
    expect(response.text).toContain('填充示例');
    expect(response.text).toContain('/demo/live/session');
    expect(response.text).toContain('graph-preview');
    expect(response.text).toContain('copyField');
    expect(response.text).toContain('https://testnet.arcscan.app');
    expect(response.text).not.toContain('把 agent 运行过程直接录进同一块屏幕');
  });

  it('should create a live session, expose latest and detail endpoints, and return 404 when latest is missing', async () => {
    const { app, liveSessionStore } = createTestHarness();

    const missingLatestResponse = await invokeApp(app, {
      method: 'GET',
      path: '/demo/live/session/latest'
    });

    expect(missingLatestResponse.statusCode).toBe(404);

    const createResponse = await invokeApp(app, {
      method: 'POST',
      path: '/demo/live/session',
      body: {
        title: 'Arc live console',
        text: 'Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.'
      }
    });

    expect(createResponse.statusCode).toBe(202);
    expect(createResponse.json).toMatchObject({
      sessionId: expect.any(String),
      status: 'queued'
    });

    const { sessionId } = createResponse.json as { sessionId: string };
    const session = await waitForSession(liveSessionStore, sessionId);
    const latestResponse = await invokeApp(app, {
      method: 'GET',
      path: '/demo/live/session/latest'
    });
    const detailResponse = await invokeApp(app, {
      method: 'GET',
      path: `/demo/live/session/${sessionId}`
    });
    const missingResponse = await invokeApp(app, {
      method: 'GET',
      path: '/demo/live/session/missing'
    });

    expect(session).toMatchObject({
      sessionId,
      status: 'completed',
      steps: [
        { key: 'summary', status: 'completed' },
        { key: 'entities', status: 'completed' },
        { key: 'relations', status: 'completed' }
      ],
      agentSession: {
        sessionId,
        totals: {
          totalPrice: '$0.012',
          successfulRuns: 3
        }
      }
    });
    expect(latestResponse.statusCode).toBe(200);
    expect((latestResponse.json as LiveAgentSession).sessionId).toBe(sessionId);
    expect(detailResponse.statusCode).toBe(200);
    expect((detailResponse.json as LiveAgentSession).agentSession?.graph.nodes).toHaveLength(2);
    expect(missingResponse.statusCode).toBe(404);
  });

  it('should include receiptTxHash in the completed live session when RECEIPT_MODE is enabled', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-live-route-receipt-'));
    const runtimeEnv = loadRuntimeEnv({
      NODE_ENV: 'test',
      PORT: '3000',
      PAYMENT_MODE: 'mock',
      AI_MODE: 'mock',
      RECEIPT_MODE: 'mock',
      CALL_LOG_PATH: join(workingDirectory, 'call-log.jsonl')
    });
    const agentGraphStore = new FileAgentGraphStore(join(workingDirectory, 'artifacts', 'agent-graph'));
    const liveSessionStore = new FileLiveAgentSessionStore(join(workingDirectory, 'artifacts', 'live-console'));

    temporaryDirectories.push(workingDirectory);

    const app = createApp({
      runtimeEnv,
      agentGraphStore,
      liveSessionStore
    });

    const createResponse = await invokeApp(app, {
      method: 'POST',
      path: '/demo/live/session',
      body: {
        title: 'Arc live receipt',
        text: 'Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.'
      }
    });

    expect(createResponse.statusCode).toBe(202);

    const { sessionId } = createResponse.json as { sessionId: string };
    const session = await waitForSession(liveSessionStore, sessionId);

    expect(session?.steps.map((step) => step.receiptTxHash ?? null)).toEqual([
      expect.stringMatching(/^0x[a-f0-9]{64}$/),
      expect.stringMatching(/^0x[a-f0-9]{64}$/),
      expect.stringMatching(/^0x[a-f0-9]{64}$/)
    ]);
    expect(session?.agentSession?.runs.map((run) => run.receiptTxHash ?? null)).toEqual([
      expect.stringMatching(/^0x[a-f0-9]{64}$/),
      expect.stringMatching(/^0x[a-f0-9]{64}$/),
      expect.stringMatching(/^0x[a-f0-9]{64}$/)
    ]);
  });

  it('should reject invalid input and block duplicate creation when an active session already exists', async () => {
    let releaseRunner: (() => void) | undefined;
    const { app, liveSessionStore } = createTestHarness({
      runAgentGraphSession: async ({ sessionId }): Promise<AgentGraphRunResult> => {
          await new Promise<void>((resolve) => {
            releaseRunner = resolve;
          });

          return {
            sessionId,
            artifactPath: join(tmpdir(), `${sessionId}.json`),
            graphUrl: `http://127.0.0.1:3000/demo/graph/${sessionId}`,
            session: createCompletedAgentSession(sessionId)
          };
        }
    });

    const invalidResponse = await invokeApp(app, {
      method: 'POST',
      path: '/demo/live/session',
      body: {
        title: '   ',
        text: '   '
      }
    });

    expect(invalidResponse.statusCode).toBe(400);

    const firstCreateResponse = await invokeApp(app, {
      method: 'POST',
      path: '/demo/live/session',
      body: {
        title: 'Active session',
        text: 'Arc introduced gasless nanopayments for AI agents.'
      }
    });

    expect(firstCreateResponse.statusCode).toBe(202);

    const { sessionId } = firstCreateResponse.json as { sessionId: string };

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const activeSession = await liveSessionStore.readActiveSession();

      if (activeSession?.sessionId === sessionId && releaseRunner) {
        break;
      }

      await sleep(10);
    }

    const duplicateResponse = await invokeApp(app, {
      method: 'POST',
      path: '/demo/live/session',
      body: {
        title: 'Duplicate session',
        text: 'Circle provides the settlement layer.'
      }
    });

    expect(duplicateResponse.statusCode).toBe(409);
    expect(duplicateResponse.json).toMatchObject({
      error: 'live_session_active',
      sessionId
    });

    releaseRunner?.();

    await waitForSession(liveSessionStore, sessionId);
  });
});
