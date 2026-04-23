import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { loadRuntimeEnv } from '../src/config/env.js';
import { buildAgentGraph, type AgentSession } from '../src/demo/agent-graph.js';
import { LiveAgentSessionService, type LiveAgentSession } from '../src/demo/live-session.js';
import type { AgentGraphRunOptions, AgentGraphRunResult } from '../src/demo/agent-session-runner.js';
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
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const session = await store.readSession(sessionId);

    if (session?.status === status) {
      return session;
    }

    await sleep(10);
  }

  throw new Error(`Timed out waiting for live session ${sessionId} to reach ${status}.`);
};

const createTestHarness = (overrides: {
  runAgentGraphSession?: (options: AgentGraphRunOptions & { sessionId: string }) => Promise<AgentGraphRunResult>;
  newsImporter?: {
    import: (articleUrl: string) => Promise<ImportedArticle>;
  };
  runtimeEnv?: Partial<Record<string, string>>;
} = {}) => {
  const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-live-route-'));
  const runtimeEnv = loadRuntimeEnv({
    NODE_ENV: 'test',
    PORT: '3000',
    PAYMENT_MODE: 'mock',
    AI_MODE: 'mock',
    CALL_LOG_PATH: join(workingDirectory, 'call-log.jsonl'),
    ...overrides.runtimeEnv
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
            ...options,
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
  it('should render the trusted research workbench shell', async () => {
    const { app } = createTestHarness();

    const response = await invokeApp(app, {
      method: 'GET',
      path: '/demo/live'
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.text).toContain('可信投研工作台');
    expect(response.text).not.toContain('Live Agent Console');
    expect(response.text).not.toContain('比赛版');
    expect(response.text).not.toContain('<section class="hero">');
    expect(response.text).toContain('顶部工具带');
    expect(response.text).toContain('toolbelt-shell');
    expect(response.text).toContain('toolbelt-actions');
    expect(response.text).toContain('当前对象');
    expect(response.text).toContain('来源状态');
    expect(response.text).toContain('运行状态');
    expect(response.text).toContain('凭证状态');
    expect(response.text).toContain('下一步动作');
    expect(response.text).toContain('导入仓');
    expect(response.text).toContain('source-drawer');
    expect(response.text).toContain('导入来源');
    expect(response.text).not.toContain('分析入口');
    expect(response.text).toContain('情报侧栏');
    expect(response.text).toContain('分析凭证');
    expect(response.text).toContain('分析流程');
    expect(response.text).toContain('待导入');
    expect(response.text).toContain('待分析');
    expect(response.text).toContain('分析中');
    expect(response.text).toContain('分析完成');
    expect(response.text).toContain('分析失败');
    expect(response.text).toContain('文章链接');
    expect(response.text).toContain('手动文本');
    expect(response.text).toContain('<option value="manual" selected>');
    expect(response.text).toContain('系统会基于正文自动生成展示标题');
    expect(response.text).toContain('article-url-input');
    expect(response.text).not.toContain('title-input');
    expect(response.text).toContain('开始分析');
    expect(response.text).not.toContain('开始演示');
    expect(response.text).toContain('preset-launcher');
    expect(response.text).toContain('detail-drawer');
    expect(response.text).toContain('detail-panel');
    expect(response.text).toContain('graph-modal');
    expect(response.text).toContain('graph-modal-preview');
    expect(response.text).toContain('card-detail-trigger');
    expect(response.text).not.toContain('detail-dialog');
    expect(response.text).not.toContain('点击查看详情');
    expect(response.text).not.toContain('完整内容');
    expect(response.text).toContain('事件总览');
    expect(response.text).toContain('关键判断');
    expect(response.text).toContain('证据摘录');
    expect(response.text).toContain('深读层');
    expect(response.text).toContain('main-reading-rail');
    expect(response.text).toContain('辅助关系图');
    expect(response.text).toContain('关键判断需要证据挂钩');
    expect(response.text).toContain('判断卡会先保留为待核验提示');
    expect(response.text).toContain('证据摘录会固定留在主区');
    expect(response.text).toContain('吴说获悉：香港虚拟资产 ETF 本周净流入创新高');
    expect(response.text).toContain('香港比特币与以太坊现货 ETF 本周净流入达到近三个月高点');
    expect(response.text).toContain('"importMode":"preset"');
    expect(response.text).toContain('填充示例');
    expect(response.text).toContain('/demo/live/session');
    expect(response.text).toContain('/demo/live/session/active');
    expect(response.text).toContain("cache: 'no-store'");
    expect(response.text).toContain('graph-surface');
    expect(response.text).toContain('position: static;');
    expect(response.text).toContain('order: 2;');
    expect(response.text).toContain('copyField');
    expect(response.text).toContain('cdn.jsdelivr.net/npm/echarts@5');
    expect(response.text).toContain('https://testnet.arcscan.app');
    expect(response.text).toContain('分析连接已中断，请重新开始分析。');
    expect(response.text).toContain('回执未启用');
    expect(response.text).toContain('等待回执写入');
    expect(response.text).toContain('const __name = (target, _value) => target;');
    expect(response.text).toContain(`const receiptMode = "off"`);
    expect(response.text).toContain('function buildPreviewText');
    expect(response.text).toContain('function buildDetailSourceStatus');
    expect(response.text).toContain('function buildEvidenceDetail');
    expect(response.text).toContain('stableResultSession');
    expect(response.text).toContain('displaySession');
    expect(response.text).toContain('acceptedSnapshotMeta');
    expect(response.text).toContain('lastTerminalSnapshotMeta');
    expect(response.text).toContain('shouldAcceptLiveSnapshot');
    expect(response.text).toContain('data-graph-expand');
    expect(response.text).toContain('只有新结果成功返回后才替换当前工作台');
    expect(response.text).toContain('本轮失败，已保留上一版结果');
    expect(response.text).toContain('renderCredentials(displaySession ?? session)');
    expect(response.text).toContain('判断标签');
    expect(response.text).toContain('来源状态');
    expect(response.text).toContain('前文上下文');
    expect(response.text).toContain('后文上下文');
    expect(response.text).toContain('缓存说明');
    expect(response.text).toContain('原始片段');
    expect(response.text).toContain('直接启动分析');
    expect(response.text).toContain('查看原文');
    expect(response.text).toContain('展开辅助关系图');
    expect(response.text).toContain('展开关系图');
    expect(response.text).toContain('@media (max-width: 720px)');
    expect(response.text).not.toContain('滚轮缩放，拖动画布可查看细节。graphUrl');
    expect(response.text).not.toContain('把 agent 运行过程直接录进同一块屏幕');

    const openGraphModalMatch = response.text.match(/const openGraphModal = \(session\) => \{([\s\S]*?)\n        \};/);

    expect(openGraphModalMatch?.[1]).toContain("graphModal.classList.remove('hidden');");
    expect(openGraphModalMatch?.[1]).toContain("graphModal.setAttribute('aria-hidden', 'false');");
    expect(openGraphModalMatch?.[1]).toContain('requestAnimationFrame(() => {');
    expect(openGraphModalMatch?.[1]).toContain('state.graphModalChart?.resize();');
    expect(openGraphModalMatch?.[1].indexOf("graphModal.classList.remove('hidden');")).toBeLessThan(
      openGraphModalMatch?.[1].indexOf('renderGraphSurface(graphModalPreview, session, {') ?? Number.POSITIVE_INFINITY
    );
  });

  it('should create a live session, expose latest and detail endpoints, and return 404 when latest is missing', async () => {
    const { app, liveSessionStore } = createTestHarness();

    const missingLatestResponse = await invokeApp(app, {
      method: 'GET',
      path: '/demo/live/session/latest'
    });
    const missingActiveResponse = await invokeApp(app, {
      method: 'GET',
      path: '/demo/live/session/active'
    });

    expect(missingLatestResponse.statusCode).toBe(404);
    expect(missingActiveResponse.statusCode).toBe(404);

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
    const activeResponse = await invokeApp(app, {
      method: 'GET',
      path: '/demo/live/session/active'
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
    expect(latestResponse.headers['cache-control']).toContain('no-store');
    expect((latestResponse.json as LiveAgentSession).sessionId).toBe(sessionId);
    expect(activeResponse.statusCode).toBe(404);
    expect(activeResponse.headers['cache-control']).toContain('no-store');
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.headers['cache-control']).toContain('no-store');
    expect((detailResponse.json as LiveAgentSession).agentSession?.graph.nodes.length).toBeGreaterThanOrEqual(4);
    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.headers['cache-control']).toContain('no-store');
  });

  it('should accept manual text without a title and persist an empty source title', async () => {
    const { app, liveSessionStore } = createTestHarness({
      runAgentGraphSession: async ({ sessionId, source }) => ({
        sessionId,
        artifactPath: join(tmpdir(), `${sessionId}.json`),
        graphUrl: `http://127.0.0.1:3000/demo/graph/${sessionId}`,
        session: createCompletedAgentSession(sessionId, source!)
      })
    });

    const createResponse = await invokeApp(app, {
      method: 'POST',
      path: '/demo/live/session',
      body: {
        text: 'Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.',
        sourceType: 'research',
        metadata: {
          importMode: 'manual'
        }
      }
    });

    expect(createResponse.statusCode).toBe(202);

    const { sessionId } = createResponse.json as { sessionId: string };
    const session = await waitForSession(liveSessionStore, sessionId);

    expect(session?.source.title).toBeUndefined();
    expect(session?.source.text).toContain('Arc introduced gasless nanopayments');
    expect(session?.source.metadata?.importMode).toBe('manual');
  });

  it('should import a whitelisted articleUrl, then preserve metadata in live payloads and agent session output', async () => {
    const importedArticle: ImportedArticle = {
      sourceUrl: 'https://wublock123.com/p/654321?signature=abc123&token=xyz',
      canonicalUrl: 'https://wublock123.com/p/654321',
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
        session: createCompletedAgentSession(sessionId, source!)
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
          articleUrl: importedArticle.canonicalUrl,
          sourceSite: importedArticle.sourceSite,
          importMode: 'link'
        }
      },
      agentSession: {
        source: {
          metadata: {
            articleUrl: importedArticle.canonicalUrl,
            sourceSite: importedArticle.sourceSite,
            importMode: 'link'
          }
        }
      }
    });
    expect((latestResponse.json as LiveAgentSession).source.metadata).toEqual({
      articleUrl: importedArticle.canonicalUrl,
      sourceSite: importedArticle.sourceSite,
      importMode: 'link'
    });
    expect((detailResponse.json as LiveAgentSession).agentSession?.source.metadata).toEqual({
      articleUrl: importedArticle.canonicalUrl,
      sourceSite: importedArticle.sourceSite,
      importMode: 'link'
    });
  });

  it('should expose live/cache import status and cachedAt in live payloads and the page shell', async () => {
    const importedArticle: ImportedArticle = {
      sourceUrl: 'https://www.panewslab.com/articles/0123456789',
      canonicalUrl: 'https://panewslab.com/articles/0123456789',
      sourceSite: 'panews',
      sourceType: 'news',
      title: 'PANews：某协议完成 5000 万美元融资',
      text: 'PANews 4 月 22 日消息，某协议宣布完成 5000 万美元融资。',
      importStatus: 'cache',
      cachedAt: '2026-04-22T11:22:33.000Z'
    };
    const { app, liveSessionStore } = createTestHarness({
      newsImporter: {
        import: async (articleUrl: string) => {
          expect(articleUrl).toBe(importedArticle.sourceUrl);
          return importedArticle;
        }
      },
      runAgentGraphSession: async ({ sessionId, source }) => ({
        sessionId,
        artifactPath: join(tmpdir(), `${sessionId}.json`),
        graphUrl: `http://127.0.0.1:3000/demo/graph/${sessionId}`,
        session: createCompletedAgentSession(sessionId, source!)
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
    const pageResponse = await invokeApp(app, {
      method: 'GET',
      path: '/demo/live'
    });

    expect(session?.source.metadata).toEqual({
      articleUrl: importedArticle.sourceUrl,
      sourceSite: importedArticle.sourceSite,
      importMode: 'link',
      importStatus: 'cache',
      cachedAt: importedArticle.cachedAt
    });
    expect((latestResponse.json as LiveAgentSession).source.metadata).toEqual({
      articleUrl: importedArticle.sourceUrl,
      sourceSite: importedArticle.sourceSite,
      importMode: 'link',
      importStatus: 'cache',
      cachedAt: importedArticle.cachedAt
    });
    expect(pageResponse.text).toContain('导入状态：实时抓取');
    expect(pageResponse.text).toContain('导入状态：缓存回退');
    expect(pageResponse.text).toContain('缓存时间');
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
        session: createCompletedAgentSession(sessionId, source!)
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

  it('should surface a preset fallback hint when link import hits an anti-bot challenge page', async () => {
    const { app } = createTestHarness({
      newsImporter: {
        import: async () => {
          throw new Error('新闻导入失败：wublock123 返回了反爬挑战页，当前无法实时抓取该链接。');
        }
      }
    });

    const response = await invokeApp(app, {
      method: 'POST',
      path: '/demo/live/session',
      body: {
        articleUrl: 'https://www.wublock123.com/articles/kelpdao-exploit-debt-crisis-defi-bad-debt-resolution-58888'
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json).toEqual({
      error: 'news_import_failed',
      message: '新闻导入失败：wublock123 返回了反爬挑战页，当前无法实时抓取该链接。 建议改用预置卡片。'
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

  it('should redact private keys from failed live session errors', async () => {
    const leakedPrivateKey = '0x50fff75e326b04954b6d4b7fb4cbd046d943a640a88a4b3a2e59163dbbfcbece';
    const { app, liveSessionStore } = createTestHarness({
      runAgentGraphSession: async (options) => {
        await options.onProgress?.({
          type: 'step-started',
          step: 'summary',
          at: '2026-04-22T10:00:01.000Z',
          sessionId: options.sessionId
        });

        throw new Error(
          `Command failed: cast send --json --rpc-url https://rpc.testnet.arc.network --private-key ${leakedPrivateKey} 0x5dc554A1A887a34eDcF61650BeF73E6372D5DaE3 recordReceipt(string,string,bytes32)\nerror: boom`
        );
      }
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
    const failedSession = await waitForSession(liveSessionStore, sessionId, 'failed');
    const latestResponse = await invokeApp(app, {
      method: 'GET',
      path: '/demo/live/session/latest'
    });
    const detailResponse = await invokeApp(app, {
      method: 'GET',
      path: `/demo/live/session/${sessionId}`
    });

    expect(failedSession?.error).toContain('--private-key [REDACTED]');
    expect(failedSession?.error).not.toContain(leakedPrivateKey);
    expect(failedSession?.steps.find((step) => step.status === 'failed')?.error).toContain('[REDACTED]');
    expect(failedSession?.steps.find((step) => step.status === 'failed')?.error).not.toContain(leakedPrivateKey);
    expect((latestResponse.json as LiveAgentSession).error).toContain('[REDACTED]');
    expect((latestResponse.json as LiveAgentSession).error).not.toContain(leakedPrivateKey);
    expect(
      (detailResponse.json as LiveAgentSession).steps.find((step) => step.status === 'failed')?.error
    ).toContain('[REDACTED]');
    expect(
      (detailResponse.json as LiveAgentSession).steps.find((step) => step.status === 'failed')?.error
    ).not.toContain(leakedPrivateKey);
  });

  it('should persist progress snapshots for gateway mode before the final session completes', async () => {
    let releaseCompletion: (() => void) | undefined;
    let resolveSummaryPersisted: (() => void) | undefined;
    const summaryPersisted = new Promise<void>((resolve) => {
      resolveSummaryPersisted = resolve;
    });
    const { app, liveSessionStore } = createTestHarness({
      runtimeEnv: {
        PAYMENT_MODE: 'gateway',
        CIRCLE_SELLER_ADDRESS: '0x1234567890123456789012345678901234567890'
      },
      runAgentGraphSession: async (options) => {
        const { sessionId, source } = options;

        await options.onProgress?.({
          type: 'step-started',
          step: 'summary',
          at: '2026-04-22T10:00:01.000Z',
          sessionId
        });
        await options.onProgress?.({
          type: 'step-completed',
          step: 'summary',
          at: '2026-04-22T10:00:02.000Z',
          sessionId,
          run: {
            requestId: 'gateway-001',
            operation: 'summary',
            price: '$0.004',
            paymentTransaction: 'gateway-tx-001',
            paymentAmount: '4000',
            paymentNetwork: 'arc-testnet',
            paymentPayer: 'gateway-buyer',
            payloadHash: '0xsummary'
          },
          snapshot: {
            summary: 'Arc partners with Circle on machine-pay flows.'
          }
        });
        resolveSummaryPersisted?.();

        await new Promise<void>((resolve) => {
          releaseCompletion = resolve;
        });

        return {
          sessionId,
          artifactPath: join(tmpdir(), `${sessionId}.json`),
          graphUrl: `http://127.0.0.1:3000/demo/graph/${sessionId}`,
          session: createCompletedAgentSession(sessionId, source!)
        };
      }
    });

    const createResponse = await invokeApp(app, {
      method: 'POST',
      path: '/demo/live/session',
      body: {
        title: 'Gateway progress session',
        text: 'Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.'
      }
    });

    expect(createResponse.statusCode).toBe(202);

    const { sessionId } = createResponse.json as { sessionId: string };
    await summaryPersisted;
    const runningSnapshot = await liveSessionStore.readSession(sessionId);

    expect(runningSnapshot?.status).toBe('running');
    expect(runningSnapshot?.preview.summary).toBe('Arc partners with Circle on machine-pay flows.');
    expect(runningSnapshot?.steps.find((step) => step.key === 'summary')).toMatchObject({
      key: 'summary',
      status: 'completed',
      requestId: 'gateway-001',
      paymentTransaction: 'gateway-tx-001'
    });

    releaseCompletion?.();

    const completedSession = await waitForSession(liveSessionStore, sessionId);

    expect(completedSession.status).toBe('completed');
  });

  it('should redact sensitive values at the live session log sink', async () => {
    const leakedPrivateKey = '0x50fff75e326b04954b6d4b7fb4cbd046d943a640a88a4b3a2e59163dbbfcbece';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      const { app, liveSessionStore } = createTestHarness({
        runtimeEnv: {
          NODE_ENV: 'development',
          ARC_PRIVATE_KEY: leakedPrivateKey
        },
        runAgentGraphSession: async () => {
          throw new Error(`signer rejected ${leakedPrivateKey}`);
        }
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
      await waitForSession(liveSessionStore, sessionId, 'failed');

      let logs = '';
      await vi.waitFor(() => {
        logs = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
        expect(logs).toContain('[REDACTED]');
      });

      expect(logs).toContain('[REDACTED]');
      expect(logs).not.toContain(leakedPrivateKey);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('should redact sensitive values at the live route log sink', async () => {
    const leakedPrivateKey = '0x60fff75e326b04954b6d4b7fb4cbd046d943a640a88a4b3a2e59163dbbfcbece';
    const signedArticleUrl = 'https://wublock123.com/p/654321?signature=abc123&token=xyz';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      const { app } = createTestHarness({
        runtimeEnv: {
          NODE_ENV: 'development',
          ARC_PRIVATE_KEY: leakedPrivateKey
        },
        newsImporter: {
          import: async () => {
            throw new Error(`ARC_PRIVATE_KEY=${leakedPrivateKey}`);
          }
        }
      });

      const response = await invokeApp(app, {
        method: 'POST',
        path: '/demo/live/session',
        body: {
          articleUrl: signedArticleUrl
        }
      });

      expect(response.statusCode).toBe(400);
      expect((response.json as { message: string }).message).toContain('[REDACTED]');
      expect((response.json as { message: string }).message).not.toContain(leakedPrivateKey);

      const logs = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');

      expect(logs).toContain('[REDACTED]');
      expect(logs).not.toContain(leakedPrivateKey);
      expect(logs).toContain('https://wublock123.com/p/654321?[REDACTED]');
      expect(logs).not.toContain('signature=abc123');
    } finally {
      logSpy.mockRestore();
    }
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

    const activeResponse = await invokeApp(app, {
      method: 'GET',
      path: '/demo/live/session/active'
    });

    const duplicateResponse = await invokeApp(app, {
      method: 'POST',
      path: '/demo/live/session',
      body: {
        title: 'Duplicate session',
        text: 'Circle provides the settlement layer.'
      }
    });

    expect(activeResponse.statusCode).toBe(200);
    expect((activeResponse.json as LiveAgentSession).sessionId).toBe(sessionId);
    expect(duplicateResponse.statusCode).toBe(409);
    expect(duplicateResponse.json).toMatchObject({
      error: 'live_session_active',
      sessionId
    });

    releaseRunner?.();

    await waitForSession(liveSessionStore, sessionId);
  });

  it('should fail a stale active session and allow a fresh demo to start', async () => {
    const { app, liveSessionStore } = createTestHarness({
      runAgentGraphSession: async ({ sessionId, source }) => ({
        sessionId,
        artifactPath: join(tmpdir(), `${sessionId}.json`),
        graphUrl: `http://127.0.0.1:3000/demo/graph/${sessionId}`,
        session: createCompletedAgentSession(sessionId, source!)
      })
    });

    const staleSession: LiveAgentSession = {
      sessionId: 'live-stale-001',
      mode: 'mock',
      status: 'running',
      createdAt: '2026-04-22T10:00:00.000Z',
      updatedAt: '2026-04-22T10:00:01.000Z',
      source: {
        sourceType: 'news',
        text: 'Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.'
      },
      steps: [
        { key: 'summary', status: 'running', startedAt: '2026-04-22T10:00:01.000Z' },
        { key: 'entities', status: 'pending' },
        { key: 'relations', status: 'pending' }
      ],
      preview: {
        summary: 'Arc partners with Circle on machine-pay flows.'
      }
    };

    await liveSessionStore.writeSession(staleSession);
    const staleAt = new Date(Date.now() - 60_000);
    utimesSync(liveSessionStore.getSessionPath(staleSession.sessionId), staleAt, staleAt);

    const activeResponse = await invokeApp(app, {
      method: 'GET',
      path: '/demo/live/session/active'
    });
    const detailResponse = await invokeApp(app, {
      method: 'GET',
      path: `/demo/live/session/${staleSession.sessionId}`
    });
    const createResponse = await invokeApp(app, {
      method: 'POST',
      path: '/demo/live/session',
      body: {
        text: 'Circle provides the settlement layer for Arc machine payments.',
        sourceType: 'news',
        metadata: {
          importMode: 'manual'
        }
      }
    });
    const { sessionId } = createResponse.json as { sessionId: string };
    const createdSession = await waitForSession(liveSessionStore, sessionId);

    expect(activeResponse.statusCode).toBe(404);
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json).toMatchObject({
      sessionId: staleSession.sessionId,
      status: 'failed',
      error: expect.stringContaining('心跳已丢失')
    });
    expect(createResponse.statusCode).toBe(202);
    expect(createdSession.status).toBe('completed');
  });
});
