import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
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

  private async clearActivePointerIfMatches(sessionId: string): Promise<void> {
    const activePointer = await readJsonFile<SessionPointer>(this.getActivePath());

    if (activePointer?.sessionId === sessionId) {
      await removeFileIfExists(this.getActivePath());
    }
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
    return readJsonFile<LiveAgentSession>(this.getSessionPath(sessionId));
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
