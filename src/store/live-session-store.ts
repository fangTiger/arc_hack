import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { LiveAgentSession } from '../demo/live-session.js';

type SessionPointer = {
  sessionId: string;
};

const readJsonFile = async <T>(path: string): Promise<T | null> => {
  try {
    const content = await readFile(path, 'utf8');
    return JSON.parse(content) as T;
  } catch (error) {
    const systemError = error as NodeJS.ErrnoException;

    if (systemError.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
};

const removeFileIfExists = async (path: string): Promise<void> => {
  try {
    await unlink(path);
  } catch (error) {
    const systemError = error as NodeJS.ErrnoException;

    if (systemError.code !== 'ENOENT') {
      throw error;
    }
  }
};

const writeJsonFile = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;

  await writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporaryPath, path);
};

const isActiveStatus = (status: LiveAgentSession['status']) => status === 'queued' || status === 'running';
const LIVE_SESSION_STALE_AFTER_MS = 15_000;
const LIVE_SESSION_STALE_ERROR =
  'Live session 心跳已丢失，上一轮演示进程可能已经停止；请重新开始演示。';

const createStaleFailedSession = (session: LiveAgentSession, failedAt: string): LiveAgentSession => {
  const failingStepKey =
    session.steps.find((step) => step.status === 'running')?.key ??
    session.steps.find((step) => step.status === 'pending')?.key;

  return {
    ...session,
    status: 'failed',
    updatedAt: failedAt,
    failedAt,
    error: LIVE_SESSION_STALE_ERROR,
    steps: session.steps.map((step) => {
      if (step.key !== failingStepKey) {
        return { ...step };
      }

      return {
        ...step,
        status: 'failed',
        startedAt: step.startedAt ?? session.updatedAt,
        completedAt: failedAt,
        error: LIVE_SESSION_STALE_ERROR
      };
    })
  };
};

export class FileLiveAgentSessionStore {
  constructor(private readonly rootDirectory: string) {}

  getRootDirectory(): string {
    return this.rootDirectory;
  }

  getSessionDirectory(sessionId: string): string {
    return join(this.rootDirectory, sessionId);
  }

  getSessionPath(sessionId: string): string {
    return join(this.getSessionDirectory(sessionId), 'live-session.json');
  }

  getLatestPath(): string {
    return join(this.rootDirectory, 'latest.json');
  }

  getActivePath(): string {
    return join(this.rootDirectory, 'active.json');
  }

  async touchSession(sessionId: string, touchedAt = new Date()): Promise<void> {
    try {
      await utimes(this.getSessionPath(sessionId), touchedAt, touchedAt);
    } catch (error) {
      const systemError = error as NodeJS.ErrnoException;

      if (systemError.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private async clearActivePointerIfMatches(sessionId: string): Promise<void> {
    const activePointer = await readJsonFile<SessionPointer>(this.getActivePath());

    if (activePointer?.sessionId === sessionId) {
      await removeFileIfExists(this.getActivePath());
    }
  }

  private async normalizeSession(session: LiveAgentSession): Promise<LiveAgentSession> {
    if (!isActiveStatus(session.status)) {
      return session;
    }

    try {
      const sessionStats = await stat(this.getSessionPath(session.sessionId));

      if (Date.now() - sessionStats.mtimeMs <= LIVE_SESSION_STALE_AFTER_MS) {
        return session;
      }
    } catch (error) {
      const systemError = error as NodeJS.ErrnoException;

      if (systemError.code === 'ENOENT') {
        return session;
      }

      throw error;
    }

    const failedSession = createStaleFailedSession(session, new Date().toISOString());
    await writeJsonFile(this.getSessionPath(session.sessionId), failedSession);
    await this.clearActivePointerIfMatches(session.sessionId);
    return failedSession;
  }

  async writeSession(session: LiveAgentSession): Promise<void> {
    await writeJsonFile(this.getSessionPath(session.sessionId), session);
    await writeJsonFile(this.getLatestPath(), { sessionId: session.sessionId } satisfies SessionPointer);

    if (isActiveStatus(session.status)) {
      await writeJsonFile(this.getActivePath(), { sessionId: session.sessionId } satisfies SessionPointer);
      return;
    }

    await this.clearActivePointerIfMatches(session.sessionId);
  }

  async readSession(sessionId: string): Promise<LiveAgentSession | null> {
    const session = await readJsonFile<LiveAgentSession>(this.getSessionPath(sessionId));

    if (!session) {
      return null;
    }

    return this.normalizeSession(session);
  }

  async readLatestSession(): Promise<LiveAgentSession | null> {
    const latestPointer = await readJsonFile<SessionPointer>(this.getLatestPath());

    if (!latestPointer) {
      return null;
    }

    return this.readSession(latestPointer.sessionId);
  }

  async readActiveSession(): Promise<LiveAgentSession | null> {
    const activePointer = await readJsonFile<SessionPointer>(this.getActivePath());

    if (!activePointer) {
      return null;
    }

    const session = await this.readSession(activePointer.sessionId);

    if (!session || !isActiveStatus(session.status)) {
      await this.clearActivePointerIfMatches(activePointer.sessionId);
      return null;
    }

    return session;
  }
}
