import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { createReceiptWriter } from '../src/domain/receipt/writer.js';
import { runDemo } from '../scripts/demo-runner.js';
import { demoCorpus } from '../src/demo/corpus.js';
import { FileCallLogStore } from '../src/store/call-log-store.js';

describe('createReceiptWriter', () => {
  it('should return a pseudo tx hash in mock mode', async () => {
    const writer = createReceiptWriter({ mode: 'mock' });

    await expect(
      writer.write({
        requestId: 'demo-001',
        operation: 'summary',
        payloadHash: '0x1111111111111111111111111111111111111111111111111111111111111111'
      })
    ).resolves.toEqual({
      mode: 'mock',
      txHash: '0x827f95fb9c381e0bdf17045153f39f45447d9847bb4f8a732e0b281b430573b3'
    });
  });
});

describe('runDemo with receipt mode', () => {
  it('should append receipt tx hashes when a receipt writer is enabled', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-receipt-'));
    const artifactDirectory = join(workingDirectory, 'artifacts');

    try {
      const summary = await runDemo({
        artifactDirectory,
        operations: ['summary'],
        corpus: demoCorpus.slice(0, 1),
        receiptWriter: createReceiptWriter({ mode: 'mock' })
      });
      const store = new FileCallLogStore(join(artifactDirectory, 'call-log.jsonl'));
      const entries = await store.list();

      expect(summary.receiptTxHashes).toEqual([
        '0x9b80ad83d2f3e1fb7645fff5ad5c74cbdec05c880446a998bf880f266cdcbc68'
      ]);
      expect(entries[0]?.receiptTxHash).toBe(
        '0x9b80ad83d2f3e1fb7645fff5ad5c74cbdec05c880446a998bf880f266cdcbc68'
      );
    } finally {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });
});
