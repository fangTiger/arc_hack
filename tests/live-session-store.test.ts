import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { LiveAgentSession } from '../src/demo/live-session.js';
import { FileLiveAgentSessionStore } from '../src/store/live-session-store.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const createSession = (overrides: Partial<LiveAgentSession> = {}): LiveAgentSession => ({
  sessionId: 'live-001',
  mode: 'mock',
  status: 'queued',
  createdAt: '2026-04-22T10:00:00.000Z',
  updatedAt: '2026-04-22T10:00:00.000Z',
  source: {
    sourceType: 'news',
    title: 'Arc live console',
    text: 'Arc introduced gasless nanopayments for AI agents.'
  },
  steps: [
    { key: 'summary', status: 'pending' },
    { key: 'entities', status: 'pending' },
    { key: 'relations', status: 'pending' }
  ],
  ...overrides,
  preview: overrides.preview ?? {}
});

describe('FileLiveAgentSessionStore', () => {
  it('should persist queued sessions under artifacts/live-console/<sessionId>/live-session.json and expose latest and active pointers', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-live-session-store-'));
    temporaryDirectories.push(workingDirectory);
    const store = new FileLiveAgentSessionStore(join(workingDirectory, 'artifacts', 'live-console'));
    const session = createSession();

    await store.writeSession(session);

    const sessionPath = join(workingDirectory, 'artifacts', 'live-console', session.sessionId, 'live-session.json');
    const latestPath = join(workingDirectory, 'artifacts', 'live-console', 'latest.json');
    const activePath = join(workingDirectory, 'artifacts', 'live-console', 'active.json');

    expect(JSON.parse(readFileSync(sessionPath, 'utf8'))).toMatchObject({
      sessionId: 'live-001',
      status: 'queued'
    });
    expect(JSON.parse(readFileSync(latestPath, 'utf8'))).toEqual({ sessionId: 'live-001' });
    expect(JSON.parse(readFileSync(activePath, 'utf8'))).toEqual({ sessionId: 'live-001' });
    await expect(store.readSession('live-001')).resolves.toEqual(session);
    await expect(store.readLatestSession()).resolves.toEqual(session);
    await expect(store.readActiveSession()).resolves.toEqual(session);
  });

  it('should clear the active pointer when a queued session finishes and return null for missing records', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-live-session-complete-'));
    temporaryDirectories.push(workingDirectory);
    const store = new FileLiveAgentSessionStore(join(workingDirectory, 'artifacts', 'live-console'));

    await store.writeSession(createSession());
    await store.writeSession(
      createSession({
        status: 'completed',
        updatedAt: '2026-04-22T10:00:03.000Z',
        completedAt: '2026-04-22T10:00:03.000Z',
        steps: [
          { key: 'summary', status: 'completed', completedAt: '2026-04-22T10:00:01.000Z' },
          { key: 'entities', status: 'completed', completedAt: '2026-04-22T10:00:02.000Z' },
          { key: 'relations', status: 'completed', completedAt: '2026-04-22T10:00:03.000Z' }
        ]
      })
    );

    const activePath = join(workingDirectory, 'artifacts', 'live-console', 'active.json');

    await expect(store.readActiveSession()).resolves.toBeNull();
    await expect(store.readLatestSession()).resolves.toMatchObject({
      sessionId: 'live-001',
      status: 'completed'
    });
    expect(() => readFileSync(activePath, 'utf8')).toThrow();
    await expect(store.readSession('missing')).resolves.toBeNull();
  });

  it('should ignore and clean a stale active pointer that references a completed session', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-live-session-stale-active-'));
    temporaryDirectories.push(workingDirectory);
    const store = new FileLiveAgentSessionStore(join(workingDirectory, 'artifacts', 'live-console'));
    const queuedSession = createSession();

    await store.writeSession(queuedSession);

    const completedSession = createSession({
      status: 'completed',
      updatedAt: '2026-04-22T10:00:03.000Z',
      completedAt: '2026-04-22T10:00:03.000Z'
    });
    writeFileSync(store.getSessionPath(queuedSession.sessionId), JSON.stringify(completedSession, null, 2), 'utf8');

    await expect(store.readActiveSession()).resolves.toBeNull();
    expect(() => readFileSync(store.getActivePath(), 'utf8')).toThrow();
  });

  it('should mark a stale active session as failed and clear the active pointer', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-live-session-heartbeat-timeout-'));
    temporaryDirectories.push(workingDirectory);
    const store = new FileLiveAgentSessionStore(join(workingDirectory, 'artifacts', 'live-console'));
    const session = createSession({
      status: 'running',
      steps: [
        { key: 'summary', status: 'running', startedAt: '2026-04-22T10:00:01.000Z' },
        { key: 'entities', status: 'pending' },
        { key: 'relations', status: 'pending' }
      ]
    });

    await store.writeSession(session);
    const staleAt = new Date(Date.now() - 60_000);
    utimesSync(store.getSessionPath(session.sessionId), staleAt, staleAt);

    const normalizedSession = await store.readSession(session.sessionId);

    expect(normalizedSession).toMatchObject({
      sessionId: session.sessionId,
      status: 'failed',
      error: expect.stringContaining('心跳已丢失')
    });
    expect(normalizedSession?.steps.find((step) => step.key === 'summary')).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('心跳已丢失')
    });
    await expect(store.readActiveSession()).resolves.toBeNull();
    await expect(store.readLatestSession()).resolves.toMatchObject({
      sessionId: session.sessionId,
      status: 'failed'
    });
    expect(() => readFileSync(store.getActivePath(), 'utf8')).toThrow();
  });
});
