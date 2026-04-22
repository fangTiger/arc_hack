import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AgentSession } from '../demo/agent-graph.js';

type LatestSessionPointer = {
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

export class FileAgentGraphStore {
  constructor(private readonly rootDirectory: string) {}

  getSessionDirectory(sessionId: string): string {
    return join(this.rootDirectory, sessionId);
  }

  getSessionPath(sessionId: string): string {
    return join(this.getSessionDirectory(sessionId), 'session.json');
  }

  getLatestPath(): string {
    return join(this.rootDirectory, 'latest.json');
  }

  async writeSession(session: AgentSession): Promise<void> {
    await mkdir(this.getSessionDirectory(session.sessionId), { recursive: true });
    await writeFile(this.getSessionPath(session.sessionId), JSON.stringify(session, null, 2), 'utf8');
    await writeFile(this.getLatestPath(), JSON.stringify({ sessionId: session.sessionId } satisfies LatestSessionPointer, null, 2), 'utf8');
  }

  async readSession(sessionId: string): Promise<AgentSession | null> {
    return readJsonFile<AgentSession>(this.getSessionPath(sessionId));
  }

  async readLatestSession(): Promise<AgentSession | null> {
    const latest = await readJsonFile<LatestSessionPointer>(this.getLatestPath());

    if (!latest) {
      return null;
    }

    return this.readSession(latest.sessionId);
  }
}
