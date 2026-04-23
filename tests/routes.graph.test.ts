import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { loadRuntimeEnv } from '../src/config/env.js';
import { buildAgentGraph, type AgentSession } from '../src/demo/agent-graph.js';
import { FileAgentGraphStore } from '../src/store/agent-graph-store.js';
import { invokeApp } from '../src/support/invoke-app.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const createSession = (overrides: Partial<AgentSession> = {}): AgentSession => {
  const baseSession: AgentSession = {
    status: 'completed',
    sessionId: 'session-graph',
    createdAt: '2026-04-22T10:00:00.000Z',
    source: {
      sourceType: 'news',
      title: 'Arc partners with Circle',
      text: 'Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.',
      metadata: {
        articleUrl: 'https://wublock123.com/p/654321',
        sourceSite: 'wublock123',
        importMode: 'link'
      }
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
        paymentPayer: '0x70a65aa0cb3ee82cf8ba353d585f880c943d68c0',
        payloadHash: '0x9a8cea55da137cde718fd2416c85c46f509f49dfd7630b539b9ba5e3a34c90fa',
        receiptTxHash: '0xb716431da93f68d44743c4348da003f1c86a69497fa20bc583f6e6c8e6fbbdd8'
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
      totalPrice: '$0.004',
      successfulRuns: 1
    }
  };

  return {
    ...baseSession,
    ...overrides,
    source: overrides.source ? { ...overrides.source } : baseSession.source
  };
};

const createTestApp = async () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-graph-route-'));
  const callLogPath = join(workingDirectory, 'call-log.jsonl');
  const agentGraphStore = new FileAgentGraphStore(join(workingDirectory, 'artifacts', 'agent-graph'));
  temporaryDirectories.push(workingDirectory);

  await agentGraphStore.writeSession(createSession());

  return createApp({
    runtimeEnv: loadRuntimeEnv({
      NODE_ENV: 'test',
      PORT: '3000',
      PAYMENT_MODE: 'mock',
      AI_MODE: 'mock',
      CALL_LOG_PATH: callLogPath
    }),
    agentGraphStore
  });
};

const createTestAppWithSessions = async (sessions: AgentSession[]) => {
  const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-graph-route-'));
  const callLogPath = join(workingDirectory, 'call-log.jsonl');
  const agentGraphStore = new FileAgentGraphStore(join(workingDirectory, 'artifacts', 'agent-graph'));
  temporaryDirectories.push(workingDirectory);

  for (const session of sessions) {
    await agentGraphStore.writeSession(session);
  }

  return createApp({
    runtimeEnv: loadRuntimeEnv({
      NODE_ENV: 'test',
      PORT: '3000',
      PAYMENT_MODE: 'mock',
      AI_MODE: 'mock',
      CALL_LOG_PATH: callLogPath
    }),
    agentGraphStore
  });
};

describe('createGraphRouter', () => {
  it('should render the latest graph page as a relationship browser with a workbench return entry', async () => {
    const app = await createTestApp();

    const response = await invokeApp(app, {
      method: 'GET',
      path: '/demo/graph/latest'
    });

    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('session-graph');
    expect(response.text).toContain('返回工作台');
    expect(response.text).toContain('/demo/live');
    expect(response.text).toContain('graph-canvas');
    expect(response.text).toContain('cdn.jsdelivr.net/npm/echarts@5');
    expect(response.text).toContain('roam: true');
    expect(response.text).toContain('滚轮缩放');
    expect(response.text).toContain('拖动画布');
    expect(response.text).toContain('辅助关系浏览器');
    expect(response.text).toContain('关系清单');
    expect(response.text).toContain('来源元数据');
    expect(response.text).toContain('导入来源');
    expect(response.text).toContain('articleUrl');
    expect(response.text).toContain('sourceSite');
    expect(response.text).toContain('importMode');
    expect(response.text).toContain('wublock123');
    expect(response.text).toContain('https://wublock123.com/p/654321');
    expect(response.text).toContain('原文');
    expect(response.text).toContain('derived 仅用于浏览连通性，不代表真实抽取关系');
    expect(response.text).not.toContain('分析凭证');
    expect(response.text).not.toContain('Source Text');
    expect(response.text).not.toContain('Arc partners with Circle on machine-pay flows.');
    expect(response.text).not.toContain('Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.');
    expect(response.text).not.toContain('mock-agent-001');
    expect(response.text).not.toContain('0xb716431da93f68d44743c4348da003f1c86a69497fa20bc583f6e6c8e6fbbdd8');
  });

  it('should surface import status, cachedAt and derived edge guidance when present', async () => {
    const app = await createTestAppWithSessions([
      createSession({
        sessionId: 'session-cache',
        source: {
          sourceType: 'news',
          title: 'PANews：某协议完成 5000 万美元融资',
          text: 'PANews 4 月 22 日消息，某协议宣布完成 5000 万美元融资。',
          metadata: {
            articleUrl: 'https://www.panewslab.com/articles/0123456789',
            sourceSite: 'panews',
            importMode: 'link',
            importStatus: 'cache',
            cachedAt: '2026-04-22T11:22:33.000Z'
          }
        }
      })
    ]);

    const response = await invokeApp(app, {
      method: 'GET',
      path: '/demo/graph/session-cache'
    });

    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('importStatus');
    expect(response.text).toContain('缓存回退');
    expect(response.text).toContain('cachedAt');
    expect(response.text).toContain('2026-04-22T11:22:33.000Z');
    expect(response.text).toContain('返回工作台');
    expect(response.text).toContain('derived 仅用于浏览连通性，不代表真实抽取关系');
  });

  it('should keep old sessions without metadata compatible and return 404 when the session is missing', async () => {
    const app = await createTestAppWithSessions([
      createSession(),
      createSession({
        sessionId: 'session-legacy',
        source: {
          sourceType: 'news',
          title: 'Legacy session',
          text: 'Legacy graph source text.'
        }
      })
    ]);

    const okResponse = await invokeApp(app, {
      method: 'GET',
      path: '/demo/graph/session-legacy'
    });
    const missingResponse = await invokeApp(app, {
      method: 'GET',
      path: '/demo/graph/missing'
    });

    expect(okResponse.statusCode).toBe(200);
    expect(okResponse.text).toContain('辅助关系浏览器');
    expect(okResponse.text).toContain('Legacy session');
    expect(okResponse.text).toContain('未记录导入来源');
    expect(okResponse.text).not.toContain('https://wublock123.com/p/654321');
    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.text).toContain('Agent graph session not found');
  });
});
