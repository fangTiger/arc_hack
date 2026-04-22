import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { loadRuntimeEnv } from '../src/config/env.js';
import { buildAgentGraph, type AgentSession } from '../src/demo/agent-graph.js';
import { LiveAgentSessionService, type LiveAgentSession } from '../src/demo/live-session.js';
import type { AgentGraphRunResult } from '../src/demo/agent-session-runner.js';
import type { ExtractionRequest } from '../src/domain/extraction/types.js';
import type { ImportedArticle } from '../src/domain/news-import/index.js';
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

const createCompletedAgentSession = (sessionId: string, source: ExtractionRequest): AgentSession => ({
  status: 'completed',
  sessionId,
  createdAt: '2026-04-22T10:00:00.000Z',
  source,
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
  runAgentGraphSession?: (options: { sessionId: string; source: ExtractionRequest }) => Promise<AgentGraphRunResult>;
  newsImporter?: {
    import: (articleUrl: string) => Promise<ImportedArticle>;
  };
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
      ? async (options) =>
          customRunAgentGraphSession({
            sessionId: options.sessionIdFactory?.() ?? 'missing-session-id',
            source: options.source!
          })
      : undefined
  });

  temporaryDirectories.push(workingDirectory);

  return {
    app: createApp({
      runtimeEnv,
      agentGraphStore,
      liveSessionStore,
      liveSessionService,
      newsImporter: overrides.newsImporter
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
    expect(response.text).toContain('文章链接');
    expect(response.text).toContain('手动文本');
    expect(response.text).toContain('article-url-input');
    expect(response.text).toContain('preset-card');
    expect(response.text).toContain('吴说获悉：香港虚拟资产 ETF 本周净流入创新高');
    expect(response.text).toContain('香港比特币与以太坊现货 ETF 本周净流入达到近三个月高点');
    expect(response.text).toContain('"importMode":"preset"');
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

  it('should import a whitelisted articleUrl, then preserve metadata in live payloads and agent session output', async () => {
    const importedArticle: ImportedArticle = {
      sourceUrl: 'https://wublock123.com/p/654321',
      sourceSite: 'wublock123',
      sourceType: 'news',
      title: '吴说获悉：香港虚拟资产 ETF 本周净流入创新高',
      text: '香港比特币与以太坊现货 ETF 本周净流入达到近三个月高点。'
    };
    const newsImporter = {
      import: async (articleUrl: string) => {
        expect(articleUrl).toBe(importedArticle.sourceUrl);
        return importedArticle;
      }
    };
    const { app, liveSessionStore } = createTestHarness({
      newsImporter,
      runAgentGraphSession: async ({ sessionId, source }) => ({
        sessionId,
        artifactPath: join(tmpdir(), `${sessionId}.json`),
        graphUrl: `http://127.0.0.1:3000/demo/graph/${sessionId}`,
        session: createCompletedAgentSession(sessionId, source)
      })
    });

    const createResponse = await invokeApp(app, {
      method: 'POST',
      path: '/demo/live/session',
      body: {
        articleUrl: importedArticle.sourceUrl
      }
    });

    expect(createResponse.statusCode).toBe(202);

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

    expect(session).toMatchObject({
      source: {
        sourceType: 'news',
        title: importedArticle.title,
        text: importedArticle.text,
        metadata: {
          articleUrl: importedArticle.sourceUrl,
          sourceSite: importedArticle.sourceSite,
          importMode: 'link'
        }
      },
      agentSession: {
        source: {
          metadata: {
            articleUrl: importedArticle.sourceUrl,
            sourceSite: importedArticle.sourceSite,
            importMode: 'link'
          }
        }
      }
    });
    expect((latestResponse.json as LiveAgentSession).source.metadata).toEqual({
      articleUrl: importedArticle.sourceUrl,
      sourceSite: importedArticle.sourceSite,
      importMode: 'link'
    });
    expect((detailResponse.json as LiveAgentSession).agentSession?.source.metadata).toEqual({
      articleUrl: importedArticle.sourceUrl,
      sourceSite: importedArticle.sourceSite,
      importMode: 'link'
    });
  });

  it('should create a preset-backed live session from cached text without calling the importer', async () => {
    const newsImporter = {
      import: async () => {
        throw new Error('preset should not call importer');
      }
    };
    const { app, liveSessionStore } = createTestHarness({
      newsImporter,
      runAgentGraphSession: async ({ sessionId, source }) => ({
        sessionId,
        artifactPath: join(tmpdir(), `${sessionId}.json`),
        graphUrl: `http://127.0.0.1:3000/demo/graph/${sessionId}`,
        session: createCompletedAgentSession(sessionId, source)
      })
    });

    const createResponse = await invokeApp(app, {
      method: 'POST',
      path: '/demo/live/session',
      body: {
        title: 'PANews：某协议完成 5000 万美元融资',
        text: 'PANews 4 月 22 日消息，某协议宣布完成 5000 万美元融资。',
        sourceType: 'news',
        metadata: {
          articleUrl: 'https://www.panewslab.com/articles/0123456789',
          sourceSite: 'panews',
          importMode: 'preset'
        }
      }
    });

    expect(createResponse.statusCode).toBe(202);

    const { sessionId } = createResponse.json as { sessionId: string };
    const session = await waitForSession(liveSessionStore, sessionId);

    expect(session?.source.metadata).toEqual({
      articleUrl: 'https://www.panewslab.com/articles/0123456789',
      sourceSite: 'panews',
      importMode: 'preset'
    });
    expect(session?.agentSession?.source.metadata).toEqual({
      articleUrl: 'https://www.panewslab.com/articles/0123456789',
      sourceSite: 'panews',
      importMode: 'preset'
    });
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
    let importCalls = 0;
    const { app, liveSessionStore } = createTestHarness({
      newsImporter: {
        import: async () => {
          importCalls += 1;
          throw new Error('should not import invalid input');
        }
      },
      runAgentGraphSession: async ({ sessionId }): Promise<AgentGraphRunResult> => {
          await new Promise<void>((resolve) => {
            releaseRunner = resolve;
          });

          return {
            sessionId,
            artifactPath: join(tmpdir(), `${sessionId}.json`),
            graphUrl: `http://127.0.0.1:3000/demo/graph/${sessionId}`,
            session: createCompletedAgentSession(sessionId, {
              sourceType: 'news',
              title: 'Active session',
              text: 'Arc introduced gasless nanopayments for AI agents.'
            })
          };
        }
    });

    const missingInputResponse = await invokeApp(app, {
      method: 'POST',
      path: '/demo/live/session',
      body: {}
    });
    const bothInputsResponse = await invokeApp(app, {
      method: 'POST',
      path: '/demo/live/session',
      body: {
        text: 'Arc introduced gasless nanopayments for AI agents.',
        articleUrl: 'https://wublock123.com/p/654321'
      }
    });
    const invalidUrlResponse = await invokeApp(app, {
      method: 'POST',
      path: '/demo/live/session',
      body: {
        articleUrl: 'not-a-valid-url'
      }
    });

    expect(missingInputResponse.statusCode).toBe(400);
    expect(bothInputsResponse.statusCode).toBe(400);
    expect(invalidUrlResponse.statusCode).toBe(400);
    expect(importCalls).toBe(0);

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
