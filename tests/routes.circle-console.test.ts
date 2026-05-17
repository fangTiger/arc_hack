import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { loadRuntimeEnv } from '../src/config/env.js';
import { invokeApp } from '../src/support/invoke-app.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const createTestApp = (overrides: {
  circleConsoleService?: unknown;
  runtimeEnv?: Partial<Record<string, string>>;
  circleConsoleEnvSource?: Record<string, string | undefined>;
} = {}) => {
  const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-circle-console-route-'));
  temporaryDirectories.push(workingDirectory);

  const runtimeEnv = loadRuntimeEnv({
    ...process.env,
    NODE_ENV: 'test',
    PORT: '3000',
    PAYMENT_MODE: 'mock',
    AI_MODE: 'mock',
    CALL_LOG_PATH: join(workingDirectory, 'call-log.jsonl'),
    ...overrides.runtimeEnv
  });

  return createApp({
    runtimeEnv,
    circleConsoleService: overrides.circleConsoleService,
    circleConsoleEnvSource: overrides.circleConsoleEnvSource
  } as any);
};

describe('createCircleConsoleRouter', () => {
  it('should expose injected Circle Console status via /api/circle/console/status', async () => {
    const getStatus = vi.fn(async () => ({
      apiKeyConfigured: true,
      usageReceiptAddressConfigured: true,
      artifactPath: '/tmp/circle-console/proof.json',
      artifactSummary: {
        checkedAt: '2026-05-17T10:00:00.000Z',
        walletCount: 2,
        contractCount: 3,
        usageReceiptImportStatus: 'already_imported',
        contractId: 'contract-123',
        contractAddress: '0x1111111111111111111111111111111111111111',
        requestIds: {
          wallets: 'req-wallets',
          contracts: 'req-contracts'
        },
        source: {
          runner: 'circle-console-proof',
          blockchain: 'ARC-TESTNET',
          apiBaseUrl: 'https://api.circle.com'
        }
      }
    }));
    const app = createTestApp({
      circleConsoleService: {
        getStatus,
        runProof: vi.fn()
      },
      circleConsoleEnvSource: {
        CIRCLE_CONSOLE_PROOF_ENABLED: 'true'
      }
    });

    const response = await invokeApp(app, {
      method: 'GET',
      path: '/api/circle/console/status'
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(response.json).toEqual({
      runEnabled: true,
      apiKeyConfigured: true,
      usageReceiptAddressConfigured: true,
      artifactPath: '/tmp/circle-console/proof.json',
      artifactSummary: {
        checkedAt: '2026-05-17T10:00:00.000Z',
        walletCount: 2,
        contractCount: 3,
        usageReceiptImportStatus: 'already_imported',
        contractId: 'contract-123',
        contractAddress: '0x1111111111111111111111111111111111111111',
        requestIds: {
          wallets: 'req-wallets',
          contracts: 'req-contracts'
        },
        source: {
          runner: 'circle-console-proof',
          blockchain: 'ARC-TESTNET',
          apiBaseUrl: 'https://api.circle.com'
        }
      }
    });
  });

  it('should return 403 and not call injected service when Circle Console proof is disabled', async () => {
    const runProof = vi.fn(async () => ({
      artifactPath: '/tmp/circle-console/proof.json',
      artifact: {}
    }));
    const app = createTestApp({
      circleConsoleService: {
        getStatus: vi.fn(),
        runProof
      },
      circleConsoleEnvSource: {}
    });

    const response = await invokeApp(app, {
      method: 'POST',
      path: '/api/circle/console/proof'
    });

    expect(response.statusCode).toBe(403);
    expect(runProof).not.toHaveBeenCalled();
    expect(response.json).toEqual({
      error: 'circle_console_proof_disabled',
      message: expect.stringContaining('CIRCLE_CONSOLE_PROOF_ENABLED=true')
    });
  });

  it('should reject sensitive request fields before running Circle Console proof', async () => {
    const runProof = vi.fn(async () => ({
      artifactPath: '/tmp/circle-console/proof.json',
      artifact: {}
    }));
    const app = createTestApp({
      circleConsoleService: {
        getStatus: vi.fn(),
        runProof
      },
      circleConsoleEnvSource: {
        CIRCLE_CONSOLE_PROOF_ENABLED: 'true'
      }
    });

    const response = await invokeApp(app, {
      method: 'POST',
      path: '/api/circle/console/proof',
      body: {
        nested: {
          apiKey: 'circle-secret-key'
        },
        token: 'demo-token'
      }
    });

    expect(response.statusCode).toBe(400);
    expect(runProof).not.toHaveBeenCalled();
    expect(response.text).not.toContain('circle-secret-key');
    expect(response.text).not.toContain('demo-token');
    expect(response.json).toEqual({
      error: 'circle_console_request_invalid',
      message: expect.stringContaining('nested.apiKey')
    });
  });

  it('should run Circle Console proof through the injected service when enabled', async () => {
    const runProof = vi.fn(async () => ({
      artifactPath: '/tmp/circle-console/proof.json',
      artifact: {
        checkedAt: '2026-05-17T10:00:00.000Z',
        walletCount: 2,
        contractCount: 3,
        usageReceiptImportStatus: 'imported',
        contractId: 'contract-456',
        contractAddress: '0x1111111111111111111111111111111111111111',
        requestIds: {
          wallets: 'req-wallets',
          contracts: 'req-contracts',
          import: 'req-import'
        },
        source: {
          runner: 'circle-console-proof',
          blockchain: 'ARC-TESTNET',
          apiBaseUrl: 'https://api.circle.com'
        }
      }
    }));
    const app = createTestApp({
      circleConsoleService: {
        getStatus: vi.fn(),
        runProof
      },
      circleConsoleEnvSource: {
        CIRCLE_CONSOLE_PROOF_ENABLED: 'true'
      }
    });

    const response = await invokeApp(app, {
      method: 'POST',
      path: '/api/circle/console/proof',
      body: {}
    });

    expect(response.statusCode).toBe(200);
    expect(runProof).toHaveBeenCalledTimes(1);
    expect(response.json).toEqual({
      artifactPath: '/tmp/circle-console/proof.json',
      artifact: {
        checkedAt: '2026-05-17T10:00:00.000Z',
        walletCount: 2,
        contractCount: 3,
        usageReceiptImportStatus: 'imported',
        contractId: 'contract-456',
        contractAddress: '0x1111111111111111111111111111111111111111',
        requestIds: {
          wallets: 'req-wallets',
          contracts: 'req-contracts',
          import: 'req-import'
        },
        source: {
          runner: 'circle-console-proof',
          blockchain: 'ARC-TESTNET',
          apiBaseUrl: 'https://api.circle.com'
        }
      }
    });
  });

  it('should redact secret-like fields from successful proof responses', async () => {
    const runProof = vi.fn(async () => ({
      artifactPath: '/tmp/circle-console/proof.json',
      artifact: {
        checkedAt: '2026-05-17T10:00:00.000Z',
        walletCount: 1,
        contractCount: 1,
        usageReceiptImportStatus: 'imported',
        contractId: 'contract-456',
        contractAddress: '0x1111111111111111111111111111111111111111'
      },
      accessToken: 'response-token',
      apiKey: 'response-api-key',
      nested: {
        serviceSecret: 'nested-secret',
        plainValue: 'kept'
      }
    }));
    const app = createTestApp({
      circleConsoleService: {
        getStatus: vi.fn(),
        runProof
      },
      circleConsoleEnvSource: {
        CIRCLE_CONSOLE_PROOF_ENABLED: 'true'
      }
    });

    const response = await invokeApp(app, {
      method: 'POST',
      path: '/api/circle/console/proof',
      body: {}
    });

    expect(response.statusCode).toBe(200);
    expect(response.text).not.toContain('response-token');
    expect(response.text).not.toContain('response-api-key');
    expect(response.text).not.toContain('nested-secret');
    expect(response.json).toMatchObject({
      accessToken: '[REDACTED]',
      apiKey: '[REDACTED]',
      nested: {
        serviceSecret: '[REDACTED]',
        plainValue: 'kept'
      }
    });
  });

  it('should sanitize unexpected Circle API failures without exposing Authorization headers', async () => {
    const app = createTestApp({
      circleConsoleService: {
        getStatus: vi.fn(),
        runProof: vi.fn(async () => {
          throw new Error('Circle API rejected Authorization: Bearer circle-secret-key');
        })
      },
      circleConsoleEnvSource: {
        CIRCLE_CONSOLE_PROOF_ENABLED: 'true',
        CIRCLE_API_KEY: 'circle-secret-key'
      }
    });

    const response = await invokeApp(app, {
      method: 'POST',
      path: '/api/circle/console/proof',
      body: {}
    });

    expect(response.statusCode).toBe(500);
    expect(response.json).toEqual({
      error: 'circle_console_proof_failed',
      message: expect.stringContaining('[REDACTED]')
    });
    expect(response.text).not.toContain('circle-secret-key');
    expect(response.text).not.toContain('Authorization: Bearer');
  });
});
