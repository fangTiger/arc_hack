import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadRuntimeEnv } from '../src/config/env.js';
import { demoCorpus } from '../src/demo/corpus.js';
import {
  runAgentGraphSession,
  type AgentGraphRunnerProgressEvent
} from '../src/demo/agent-session-runner.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('runAgentGraphSession progress callback', () => {
  it('should report mock progress in summary -> entities -> relations order before returning the completed session', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-live-runner-'));
    temporaryDirectories.push(workingDirectory);
    const progressEvents: AgentGraphRunnerProgressEvent[] = [];

    const result = await runAgentGraphSession({
      artifactRootDirectory: join(workingDirectory, 'artifacts', 'agent-graph'),
      source: demoCorpus[0],
      sessionIdFactory: () => 'session-live',
      runtimeEnv: loadRuntimeEnv({
        NODE_ENV: 'test',
        PORT: '4020',
        PAYMENT_MODE: 'mock',
        AI_MODE: 'mock',
        CALL_LOG_PATH: join(workingDirectory, 'call-log.jsonl')
      }),
      onProgress(event) {
        progressEvents.push(event);
      }
    });

    expect(result.sessionId).toBe('session-live');
    expect(progressEvents.map((event) => `${event.type}:${event.step}`)).toEqual([
      'step-started:summary',
      'step-completed:summary',
      'step-started:entities',
      'step-completed:entities',
      'step-started:relations',
      'step-completed:relations'
    ]);

    const summaryCompleted = progressEvents[1];
    const entitiesCompleted = progressEvents[3];
    const relationsCompleted = progressEvents[5];

    expect(summaryCompleted).toMatchObject({
      type: 'step-completed',
      step: 'summary',
      run: {
        requestId: 'agent-001',
        operation: 'summary',
        price: '$0.004'
      },
      snapshot: {
        summary: 'Arc partners with Circle. Arc introduced gasless nanopayments for AI agents.'
      }
    });
    expect(entitiesCompleted).toMatchObject({
      type: 'step-completed',
      step: 'entities',
      run: {
        requestId: 'agent-002',
        operation: 'entities',
        price: '$0.003'
      },
      snapshot: {
        entities: [
          { name: 'Arc', type: 'organization' },
          { name: 'Circle', type: 'organization' }
        ]
      }
    });
    expect(relationsCompleted).toMatchObject({
      type: 'step-completed',
      step: 'relations',
      run: {
        requestId: 'agent-003',
        operation: 'relations',
        price: '$0.005'
      },
      snapshot: {
        relations: [{ source: 'Arc', relation: 'mentions', target: 'Circle' }]
      }
    });
    expect(result.session.runs.map((run) => run.operation)).toEqual(['summary', 'entities', 'relations']);
  });
});
