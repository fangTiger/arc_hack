import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runDemo } from '../scripts/demo-runner.js';
import { demoCorpus } from '../src/demo/corpus.js';
import { createReceiptWriter } from '../src/domain/receipt/writer.js';
import { FileCallLogStore } from '../src/store/call-log-store.js';

describe('runDemo', () => {
  it('should reset old artifacts and keep summary stats aligned with the current run', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-demo-'));
    const artifactDirectory = join(workingDirectory, 'artifacts');
    const callLogStore = new FileCallLogStore(join(artifactDirectory, 'call-log.jsonl'));

    try {
      await callLogStore.append({
        requestId: 'stale-001',
        operation: 'summary',
        price: '$0.004',
        paymentMode: 'mock',
        paymentStatus: 'paid',
        resultKind: 'summary',
        createdAt: '2026-04-21T22:00:00.000Z'
      });

      const summary = await runDemo({
        artifactDirectory,
        operations: ['summary', 'entities'],
        corpus: demoCorpus.slice(0, 2)
      });

      expect(summary.totalRuns).toBe(4);
      expect(summary.successCount).toBe(4);
      expect(summary.requestIds).toEqual(['demo-001', 'demo-002', 'demo-003', 'demo-004']);
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
      await expect(callLogStore.list()).resolves.toHaveLength(4);
    } finally {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it('should support repeated runs and attach receipt tx hashes to each successful call', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-receipt-'));
    const artifactDirectory = join(workingDirectory, 'artifacts');
    const callLogStore = new FileCallLogStore(join(artifactDirectory, 'call-log.jsonl'));

    try {
      const summary = await runDemo({
        artifactDirectory,
        operations: ['summary'],
        corpus: demoCorpus.slice(0, 1),
        repeatCount: 3,
        receiptWriter: createReceiptWriter({ mode: 'mock' })
      });
      const entries = await callLogStore.list();

      expect(summary.totalRuns).toBe(3);
      expect(summary.successCount).toBe(3);
      expect(summary.receiptTxHashes).toHaveLength(3);
      expect(summary.stats).toEqual({
        totalCalls: 3,
        successfulCalls: 3,
        totalRevenue: '$0.012',
        byOperation: {
          summary: 3,
          entities: 0,
          relations: 0
        }
      });
      expect(entries.map((entry) => entry.receiptTxHash)).toEqual(summary.receiptTxHashes);
    } finally {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });
});
