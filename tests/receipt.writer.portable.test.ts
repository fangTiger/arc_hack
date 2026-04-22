import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn()
}));

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');

  return {
    ...actual,
    execFile: execFileMock
  };
});

const loadReceiptWriterModule = async () => import('../src/domain/receipt/writer.js');

const defaultTxHash = '0x1111111111111111111111111111111111111111111111111111111111111111';

beforeEach(() => {
  delete process.env.CAST_BIN;
  vi.resetModules();
  execFileMock.mockReset();
  execFileMock.mockImplementation(
    (_command: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
      callback(null, {
        stdout: JSON.stringify({
          transactionHash: defaultTxHash
        })
      });
    }
  );
});

afterEach(() => {
  delete process.env.CAST_BIN;
});

describe('portable receipt writer', () => {
  it('parses transactionHash from cast JSON output instead of the first hex string', async () => {
    const wrongHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const expectedTxHash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    execFileMock.mockImplementationOnce(
      (_command: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
        callback(null, {
          stdout: JSON.stringify({
            blockHash: wrongHash,
            transactionHash: expectedTxHash
          })
        });
      }
    );

    const { createReceiptWriter } = await loadReceiptWriterModule();
    const writer = createReceiptWriter({
      mode: 'arc',
      rpcUrl: 'https://arc.example',
      contractAddress: '0x1234567890123456789012345678901234567890',
      privateKey: '0xabc'
    });

    await expect(
      writer.write({
        requestId: 'demo-001',
        operation: 'summary',
        payloadHash: '0x1111111111111111111111111111111111111111111111111111111111111111'
      })
    ).resolves.toEqual({
      mode: 'arc',
      txHash: expectedTxHash
    });

    expect(execFileMock).toHaveBeenCalled();
    expect(execFileMock.mock.calls[0]?.[1]).toContain('--json');
    expect(execFileMock.mock.calls[0]?.[1]).not.toContain('--async');
  });

  it('uses CAST_BIN when provided', async () => {
    process.env.CAST_BIN = 'cast-custom';

    const { createReceiptWriter } = await loadReceiptWriterModule();
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

    expect(execFileMock).toHaveBeenCalled();
    expect(execFileMock.mock.calls[0]?.[0]).toBe('cast-custom');
  });
});
