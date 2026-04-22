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

const createSession = (): AgentSession => ({
  status: 'completed',
  sessionId: 'session-graph',
  createdAt: '2026-04-22T10:00:00.000Z',
  source: {
    sourceType: 'news',
    title: 'Arc partners with Circle',
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
      payloadHash: '0xsummary',
      receiptTxHash: '0xreceipt'
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
});

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

describe('createGraphRouter', () => {
  it('should render the latest graph page with summary, svg graph and payment evidence', async () => {
    const app = await createTestApp();

    const response = await invokeApp(app, {
      method: 'GET',
      path: '/demo/graph/latest'
    });

    expect(response.statusCode).toBe(200);
    expect(response.text).toContain('session-graph');
    expect(response.text).toContain('Arc partners with Circle on machine-pay flows.');
    expect(response.text).toContain('<svg');
    expect(response.text).toContain('mock-agent-001');
    expect(response.text).toContain('0xreceipt');
  });

  it('should render a session page by id and return 404 when the session is missing', async () => {
    const app = await createTestApp();

    const okResponse = await invokeApp(app, {
      method: 'GET',
      path: '/demo/graph/session-graph'
    });
    const missingResponse = await invokeApp(app, {
      method: 'GET',
      path: '/demo/graph/missing'
    });

    expect(okResponse.statusCode).toBe(200);
    expect(okResponse.text).toContain('Graph Nodes');
    expect(okResponse.text).toContain('Arc');
    expect(okResponse.text).toContain('Circle');
    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.text).toContain('Agent graph session not found');
  });
});
