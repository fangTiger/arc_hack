import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');

  return {
    ...actual,
    execFile: vi.fn((command: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
      callback(null, {
        stdout: '0x1111111111111111111111111111111111111111111111111111111111111111'
      });
    })
  };
});

import { createReceiptWriter } from '../src/domain/receipt/writer.js';

describe('portable receipt writer', () => {
  it('uses the portable cast command name', async () => {
    const { execFile } = await import('node:child_process');
    const writer = createReceiptWriter({
      mode: 'arc',
      rpcUrl: 'https://arc.example',
      contractAddress: '0x1234567890123456789012345678901234567890',
      privateKey: '0xabc'
    });

    await writer.write({
      requestId: 'demo-001',
      operation: 'summary',
      payloadHash: '0x1111111111111111111111111111111111111111111111111111111111111111'
    });

    expect(vi.mocked(execFile)).toHaveBeenCalled();
    expect(vi.mocked(execFile).mock.calls[0]?.[0]).toBe('cast');
  });
});
