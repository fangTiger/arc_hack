import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const originalWorkingDirectory = process.cwd();
const originalCircleApiKey = process.env.CIRCLE_API_KEY;
const originalCircleConsoleProofArtifactPath = process.env.CIRCLE_CONSOLE_PROOF_ARTIFACT_PATH;
const temporaryDirectories: string[] = [];

afterEach(() => {
  process.chdir(originalWorkingDirectory);

  if (originalCircleApiKey === undefined) {
    delete process.env.CIRCLE_API_KEY;
  } else {
    process.env.CIRCLE_API_KEY = originalCircleApiKey;
  }

  if (originalCircleConsoleProofArtifactPath === undefined) {
    delete process.env.CIRCLE_CONSOLE_PROOF_ARTIFACT_PATH;
  } else {
    process.env.CIRCLE_CONSOLE_PROOF_ARTIFACT_PATH = originalCircleConsoleProofArtifactPath;
  }

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('circle console proof runner', () => {
  it('should reject missing env vars without leaking configured secrets', async () => {
    const { parseCircleConsoleEnv } = await import('../scripts/circle-console-proof-runner.js');

    expect(() =>
      parseCircleConsoleEnv({
        CIRCLE_API_BASE_URL: 'https://api.circle.com?token=super-secret',
        USAGE_RECEIPT_ADDRESS: '0x1111111111111111111111111111111111111111'
      })
    ).toThrowError(/CIRCLE_API_KEY/);

    try {
      parseCircleConsoleEnv({
        CIRCLE_API_BASE_URL: 'https://api.circle.com?token=super-secret',
        USAGE_RECEIPT_ADDRESS: '0x1111111111111111111111111111111111111111'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('super-secret');
      expect(message).not.toContain('0x1111111111111111111111111111111111111111');
    }
  });

  it('should print sanitized proof artifact JSON without leaking the Circle API key', async () => {
    const { runCircleConsoleProofCli } = await import('../scripts/circle-console-proof-runner.js');
    const output = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === 'https://api.circle.com/v1/w3s/wallets') {
        return new Response(
          JSON.stringify({
            data: {
              wallets: [{ id: 'wallet-1' }]
            }
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'req-wallets'
            }
          }
        );
      }

      if (url === 'https://api.circle.com/v1/w3s/contracts?blockchain=ARC-TESTNET') {
        return new Response(
          JSON.stringify({
            data: {
              contracts: []
            }
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'req-contracts'
            }
          }
        );
      }

      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await runCircleConsoleProofCli({
      envSource: {
        CIRCLE_API_KEY: 'circle-secret-key',
        CIRCLE_CONSOLE_PROOF_ARTIFACT_PATH: '/tmp/circle-console-proof.json'
      },
      fetchImpl: fetchMock,
      log: output,
      artifactWriter: vi.fn(async () => undefined),
      requestIdFactory: vi.fn(() => 'circle-proof-request')
    });

    expect(result.artifact.usageReceiptImportStatus).toBe('skipped_missing_contract_address');
    expect(output).toHaveBeenCalledTimes(1);
    const rendered = output.mock.calls[0]?.[0] as string;
    expect(rendered).toContain('"usageReceiptImportStatus": "skipped_missing_contract_address"');
    expect(rendered).not.toContain('circle-secret-key');
  });

  it('should load Circle Console env vars from the project .env file without logging secrets', async () => {
    const { runCircleConsoleProofCli } = await import('../scripts/circle-console-proof-runner.js');
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-circle-console-cli-'));
    const output = vi.fn();
    temporaryDirectories.push(workingDirectory);
    writeFileSync(
      join(workingDirectory, '.env'),
      [
        'CIRCLE_API_KEY=circle-secret-key-from-dotenv',
        'CIRCLE_CONSOLE_PROOF_ARTIFACT_PATH=/tmp/circle-console-proof-from-dotenv.json'
      ].join('\n'),
      'utf8'
    );
    process.chdir(workingDirectory);
    delete process.env.CIRCLE_API_KEY;
    delete process.env.CIRCLE_CONSOLE_PROOF_ARTIFACT_PATH;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === 'https://api.circle.com/v1/w3s/wallets') {
        return new Response(
          JSON.stringify({
            data: {
              wallets: [{ id: 'wallet-1' }]
            }
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'req-wallets'
            }
          }
        );
      }

      if (url === 'https://api.circle.com/v1/w3s/contracts?blockchain=ARC-TESTNET') {
        return new Response(
          JSON.stringify({
            data: {
              contracts: []
            }
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'req-contracts'
            }
          }
        );
      }

      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await runCircleConsoleProofCli({
      fetchImpl: fetchMock,
      log: output,
      artifactWriter: vi.fn(async () => undefined),
      requestIdFactory: vi.fn(() => 'circle-proof-request')
    });

    expect(result.artifactPath).toBe('/tmp/circle-console-proof-from-dotenv.json');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(output).toHaveBeenCalledTimes(1);
    const rendered = output.mock.calls[0]?.[0] as string;
    expect(rendered).toContain('"walletCount": 1');
    expect(rendered).not.toContain('circle-secret-key-from-dotenv');
  });
});
