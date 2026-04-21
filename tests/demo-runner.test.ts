import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { demoCorpus } from '../src/demo/corpus.js';
import { FileCallLogStore } from '../src/store/call-log-store.js';
import { runDemo } from '../scripts/demo-runner.js';
import { createOpsRouter } from '../src/routes/ops.js';

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

const createMockResponse = (): MockResponse => ({
  statusCode: 200,
  body: undefined,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(payload: unknown) {
    this.body = payload;
    return this;
  }
});

const getStatsHandler = () => {
  const router = createOpsRouter({
    callLogStore: new FileCallLogStore(join(process.cwd(), 'tmp', 'unused.jsonl'))
  });
  const stack = Reflect.get(router, 'stack') as Array<{
    route?: { path?: string; stack?: Array<{ handle?: (...args: any[]) => unknown }> };
  }>;
  const layer = stack.find((entry) => entry.route?.path === '/stats');

  return layer?.route?.stack?.[0]?.handle;
};

describe('runDemo', () => {
  it('should create call logs and summary artifacts for batch demo runs', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-demo-'));
    const artifactDirectory = join(workingDirectory, 'artifacts');

    try {
      const summary = await runDemo({
        artifactDirectory,
        operations: ['summary', 'entities'],
        corpus: demoCorpus.slice(0, 2)
      });

      expect(summary.totalRuns).toBe(4);
      expect(summary.successCount).toBe(4);
      expect(summary.requestIds).toEqual([
        'demo-001',
        'demo-002',
        'demo-003',
        'demo-004'
      ]);
      expect(summary.stats).toEqual({
        totalCalls: 4,
        successfulCalls: 4,
        totalRevenue: '$0.014',
        byOperation: {
          summary: 2,
          entities: 2,
          relations: 0
        }
      });
    } finally {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });
});

describe('createOpsRouter', () => {
  it('should expose aggregated stats from the call log store', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-ops-'));
    const logFilePath = join(workingDirectory, 'call-log.jsonl');
    const callLogStore = new FileCallLogStore(logFilePath);
    const router = createOpsRouter({ callLogStore });
    const stack = Reflect.get(router, 'stack') as Array<{
      route?: { path?: string; stack?: Array<{ handle?: (...args: any[]) => unknown }> };
    }>;
    const layer = stack.find((entry) => entry.route?.path === '/stats');
    const handler = layer?.route?.stack?.[0]?.handle;
    const response = createMockResponse();

    try {
      await callLogStore.append({
        requestId: 'demo-001',
        operation: 'summary',
        price: '$0.004',
        paymentMode: 'mock',
        paymentStatus: 'paid',
        resultKind: 'summary',
        createdAt: '2026-04-21T22:00:00.000Z'
      });

      expect(typeof handler).toBe('function');

      await handler?.({} as any, response as any, () => undefined);

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({
        totalCalls: 1,
        successfulCalls: 1,
        totalRevenue: '$0.004',
        byOperation: {
          summary: 1,
          entities: 0,
          relations: 0
        }
      });
    } finally {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });
});
