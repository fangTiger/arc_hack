import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildAgentGraph, type AgentSession } from '../src/demo/agent-graph.js';
import { FileAgentGraphStore } from '../src/store/agent-graph-store.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const createSession = (): AgentSession => ({
  status: 'completed',
  sessionId: 'session-001',
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
  relations: [
    { source: 'Arc', relation: 'partners_with', target: 'Circle' },
    { source: 'Arc', relation: 'serves', target: 'AI agents' }
  ],
  runs: [
    {
      requestId: 'agent-001',
      operation: 'summary',
      price: '$0.004',
      paymentTransaction: 'mock-summary',
      paymentAmount: '4000',
      paymentNetwork: 'mock-network',
      paymentPayer: 'mock-buyer',
      payloadHash: '0xsummary'
    }
  ],
  graph: buildAgentGraph(
    [
      { name: 'Arc', type: 'organization' },
      { name: 'Circle', type: 'organization' }
    ],
    [
      { source: 'Arc', relation: 'partners_with', target: 'Circle' },
      { source: 'Arc', relation: 'serves', target: 'AI agents' }
    ]
  ),
  totals: {
    totalPrice: '$0.004',
    successfulRuns: 1
  }
});

describe('FileAgentGraphStore', () => {
  it('should persist sessions under artifacts/agent-graph/<sessionId>/session.json and load latest session', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-agent-graph-store-'));
    temporaryDirectories.push(workingDirectory);
    const store = new FileAgentGraphStore(join(workingDirectory, 'artifacts', 'agent-graph'));
    const session = createSession();

    await store.writeSession(session);

    const sessionPath = join(workingDirectory, 'artifacts', 'agent-graph', session.sessionId, 'session.json');
    const latestPath = join(workingDirectory, 'artifacts', 'agent-graph', 'latest.json');
    const persisted = JSON.parse(readFileSync(sessionPath, 'utf8'));

    expect(persisted).toMatchObject({
      sessionId: 'session-001',
      summary: 'Arc partners with Circle on machine-pay flows.'
    });
    expect(JSON.parse(readFileSync(latestPath, 'utf8'))).toEqual({ sessionId: 'session-001' });
    await expect(store.readSession('session-001')).resolves.toEqual(session);
    await expect(store.readLatestSession()).resolves.toEqual(session);
  });

  it('should return null when reading a missing session or latest pointer', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-agent-graph-missing-'));
    temporaryDirectories.push(workingDirectory);
    const store = new FileAgentGraphStore(join(workingDirectory, 'artifacts', 'agent-graph'));

    await expect(store.readSession('missing')).resolves.toBeNull();
    await expect(store.readLatestSession()).resolves.toBeNull();
  });
});

describe('buildAgentGraph', () => {
  it('should dedupe entities and create unknown nodes for dangling relations', () => {
    const graph = buildAgentGraph(
      [
        { name: 'Arc', type: 'organization' },
        { name: 'Arc', type: 'organization' },
        { name: 'Circle', type: 'organization' }
      ],
      [
        { source: 'Arc', relation: 'partners_with', target: 'Circle' },
        { source: 'Arc', relation: 'serves', target: 'AI agents' }
      ]
    );

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'Arc', type: 'organization', color: '#0f766e' }),
        expect.objectContaining({ id: 'Circle', type: 'organization', color: '#0f766e' }),
        expect.objectContaining({ id: 'AI agents', type: 'unknown', color: '#6b7280' })
      ])
    );
    expect(graph.edges).toEqual([
      {
        id: 'Arc:partners_with:Circle',
        source: 'Arc',
        target: 'Circle',
        label: 'partners_with'
      },
      {
        id: 'Arc:serves:AI agents',
        source: 'Arc',
        target: 'AI agents',
        label: 'serves'
      }
    ]);
    expect(graph.nodes.every((node) => typeof node.x === 'number' && typeof node.y === 'number')).toBe(true);
  });
});
