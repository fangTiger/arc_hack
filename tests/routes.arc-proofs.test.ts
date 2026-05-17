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
  arcProofService?: unknown;
  runtimeEnv?: Partial<Record<string, string>>;
  arcProofEnvSource?: Record<string, string | undefined>;
} = {}) => {
  const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-proof-route-'));
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
    arcProofService: overrides.arcProofService,
    arcProofEnvSource: overrides.arcProofEnvSource
  } as any);
};

describe('createArcProofRouter', () => {
  it('should expose injected proof status and artifact summaries via /api/arc/proofs/status', async () => {
    const getStatus = vi.fn(async () => ({
      erc8004: {
        configured: true,
        missingEnv: [],
        artifactPath: '/tmp/arc-standards/erc8004-agent.json',
        artifactSummary: {
          kind: 'erc8004',
          agentId: '14296',
          owner: '0x70a65AA0cB3Ee82cF8ba353D585F880c943D68C0',
          validator: '0x84CE50903884def745739c727c9eaA8d737C7457',
          primaryTxHash: `0x${'1'.repeat(64)}`,
          explorerUrl: `https://scan.arc.example/tx/0x${'1'.repeat(64)}`
        }
      },
      erc8183: {
        configured: true,
        missingEnv: [],
        artifactPath: '/tmp/arc-standards/erc8183-job.json',
        artifactSummary: {
          kind: 'erc8183',
          jobId: '20889',
          client: '0x70a65AA0cB3Ee82cF8ba353D585F880c943D68C0',
          provider: '0x63C62f4Fec4CE2CeD067fe291a9DFFDc15a223c1',
          finalStatus: 'Completed',
          primaryTxHash: `0x${'2'.repeat(64)}`,
          explorerUrl: `https://scan.arc.example/tx/0x${'2'.repeat(64)}`
        }
      }
    }));
    const app = createTestApp({
      arcProofService: {
        getStatus,
        runErc8004: vi.fn(),
        runErc8183: vi.fn()
      },
      arcProofEnvSource: {
        ARC_PROOF_CONSOLE_ENABLED: 'true'
      }
    });

    const response = await invokeApp(app, {
      method: 'GET',
      path: '/api/arc/proofs/status'
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(response.json).toEqual({
      runEnabled: true,
      erc8004: {
        configured: true,
        missingEnv: [],
        artifactPath: '/tmp/arc-standards/erc8004-agent.json',
        artifactSummary: {
          kind: 'erc8004',
          agentId: '14296',
          owner: '0x70a65AA0cB3Ee82cF8ba353D585F880c943D68C0',
          validator: '0x84CE50903884def745739c727c9eaA8d737C7457',
          primaryTxHash: `0x${'1'.repeat(64)}`,
          explorerUrl: `https://scan.arc.example/tx/0x${'1'.repeat(64)}`
        }
      },
      erc8183: {
        configured: true,
        missingEnv: [],
        artifactPath: '/tmp/arc-standards/erc8183-job.json',
        artifactSummary: {
          kind: 'erc8183',
          jobId: '20889',
          client: '0x70a65AA0cB3Ee82cF8ba353D585F880c943D68C0',
          provider: '0x63C62f4Fec4CE2CeD067fe291a9DFFDc15a223c1',
          finalStatus: 'Completed',
          primaryTxHash: `0x${'2'.repeat(64)}`,
          explorerUrl: `https://scan.arc.example/tx/0x${'2'.repeat(64)}`
        }
      }
    });
  });

  it('should return 403 and not call injected ERC-8004 service when proof console is disabled', async () => {
    const runErc8004 = vi.fn(async () => ({
      artifactPath: '/tmp/arc-standards/erc8004-agent.json',
      artifact: {}
    }));
    const app = createTestApp({
      arcProofService: {
        getStatus: vi.fn(),
        runErc8004,
        runErc8183: vi.fn()
      },
      arcProofEnvSource: {}
    });

    const response = await invokeApp(app, {
      method: 'POST',
      path: '/api/arc/proofs/erc8004'
    });

    expect(response.statusCode).toBe(403);
    expect(runErc8004).not.toHaveBeenCalled();
    expect(response.json).toEqual({
      error: 'arc_proof_run_disabled',
      message: expect.stringContaining('ARC_PROOF_CONSOLE_ENABLED=true')
    });
  });

  it('should run ERC-8004 proofs through the injected service when proof console is enabled', async () => {
    const leakedPrivateKey = '0x50fff75e326b04954b6d4b7fb4cbd046d943a640a88a4b3a2e59163dbbfcbece';
    const runErc8004 = vi.fn(async (...args: unknown[]) => {
      expect(args).toEqual([]);

      return {
        artifactPath: '/tmp/arc-standards/erc8004-agent.json',
        artifact: {
          owner: '0x70a65AA0cB3Ee82cF8ba353D585F880c943D68C0',
          validator: '0x84CE50903884def745739c727c9eaA8d737C7457',
          agentId: '14296',
          metadataUri: 'ipfs://arc-agent',
          registrationTxHash: `0x${'a'.repeat(64)}`,
          reputationTxHash: `0x${'b'.repeat(64)}`,
          validationRequestTxHash: `0x${'c'.repeat(64)}`,
          validationResponseTxHash: `0x${'d'.repeat(64)}`,
          requestHash: `0x${'e'.repeat(64)}`,
          explorerLinks: {
            registrationTx: `https://scan.arc.example/tx/0x${'a'.repeat(64)}`,
            reputationTx: `https://scan.arc.example/tx/0x${'b'.repeat(64)}`,
            validationRequestTx: `https://scan.arc.example/tx/0x${'c'.repeat(64)}`,
            validationResponseTx: `https://scan.arc.example/tx/0x${'d'.repeat(64)}`
          }
        }
      };
    });
    const app = createTestApp({
      arcProofService: {
        getStatus: vi.fn(),
        runErc8004,
        runErc8183: vi.fn()
      },
      arcProofEnvSource: {
        ARC_PROOF_CONSOLE_ENABLED: 'true'
      }
    });

    const response = await invokeApp(app, {
      method: 'POST',
      path: '/api/arc/proofs/erc8004',
      body: {
        privateKey: leakedPrivateKey
      }
    });

    expect(response.statusCode).toBe(400);
    expect(runErc8004).not.toHaveBeenCalled();
    expect(response.text).not.toContain(leakedPrivateKey);
    expect(response.json).toEqual({
      error: 'arc_proof_request_invalid',
      message: expect.stringContaining('privateKey')
    });
  });

  it('should reject sensitive request fields before running ERC-8183 proofs', async () => {
    const leakedPrivateKey = '0x60fff75e326b04954b6d4b7fb4cbd046d943a640a88a4b3a2e59163dbbfcbece';
    const runErc8183 = vi.fn(async (...args: unknown[]) => {
      expect(args).toEqual([]);

      return {
        artifactPath: '/tmp/arc-standards/erc8183-job.json',
        artifact: {
          client: '0x70a65AA0cB3Ee82cF8ba353D585F880c943D68C0',
          provider: '0x63C62f4Fec4CE2CeD067fe291a9DFFDc15a223c1',
          jobId: '20889',
          budgetAtomic: '1000000',
          budgetUsdc: '1',
          description: 'Arc proof console demo',
          createTxHash: `0x${'1'.repeat(64)}`,
          setBudgetTxHash: `0x${'2'.repeat(64)}`,
          approveTxHash: `0x${'3'.repeat(64)}`,
          fundTxHash: `0x${'4'.repeat(64)}`,
          submitTxHash: `0x${'5'.repeat(64)}`,
          completeTxHash: `0x${'6'.repeat(64)}`,
          deliverableHash: `0x${'7'.repeat(64)}`,
          reasonHash: `0x${'8'.repeat(64)}`,
          finalStatus: 'Completed',
          explorerLinks: {
            createTx: `https://scan.arc.example/tx/0x${'1'.repeat(64)}`,
            setBudgetTx: `https://scan.arc.example/tx/0x${'2'.repeat(64)}`,
            approveTx: `https://scan.arc.example/tx/0x${'3'.repeat(64)}`,
            fundTx: `https://scan.arc.example/tx/0x${'4'.repeat(64)}`,
            submitTx: `https://scan.arc.example/tx/0x${'5'.repeat(64)}`,
            completeTx: `https://scan.arc.example/tx/0x${'6'.repeat(64)}`
          }
        }
      };
    });
    const app = createTestApp({
      arcProofService: {
        getStatus: vi.fn(),
        runErc8004: vi.fn(),
        runErc8183
      },
      arcProofEnvSource: {
        ARC_PROOF_CONSOLE_ENABLED: 'true'
      }
    });

    const response = await invokeApp(app, {
      method: 'POST',
      path: '/api/arc/proofs/erc8183',
      body: {
        nested: {
          ownerPrivateKey: leakedPrivateKey
        },
        secret: 'demo-secret'
      }
    });

    expect(response.statusCode).toBe(400);
    expect(runErc8183).not.toHaveBeenCalled();
    expect(response.text).not.toContain(leakedPrivateKey);
    expect(response.text).not.toContain('demo-secret');
    expect(response.json).toEqual({
      error: 'arc_proof_request_invalid',
      message: expect.stringContaining('ownerPrivateKey')
    });
  });

  it('should run ERC-8183 proofs through the injected service when proof console is enabled and redact env secrets', async () => {
    const leakedProviderSecret = `0x${'f'.repeat(64)}`;
    const completeTxHash = `0x${'6'.repeat(64)}`;
    const completeTxExplorerLink = `https://scan.arc.example/tx/${completeTxHash}`;
    const runErc8183 = vi.fn(async (...args: unknown[]) => {
      expect(args).toEqual([]);

      return {
        artifactPath: '/tmp/arc-standards/erc8183-job.json',
        artifact: {
          client: '0x70a65AA0cB3Ee82cF8ba353D585F880c943D68C0',
          provider: '0x63C62f4Fec4CE2CeD067fe291a9DFFDc15a223c1',
          jobId: '20889',
          budgetAtomic: '1250000',
          budgetUsdc: '1.25',
          description: `proof artifact carries ${leakedProviderSecret}`,
          createTxHash: `0x${'1'.repeat(64)}`,
          setBudgetTxHash: `0x${'2'.repeat(64)}`,
          approveTxHash: `0x${'3'.repeat(64)}`,
          fundTxHash: `0x${'4'.repeat(64)}`,
          submitTxHash: `0x${'5'.repeat(64)}`,
          completeTxHash,
          deliverableHash: `0x${'7'.repeat(64)}`,
          reasonHash: `0x${'8'.repeat(64)}`,
          finalStatus: 'Completed',
          explorerLinks: {
            createTx: `https://scan.arc.example/tx/0x${'1'.repeat(64)}`,
            setBudgetTx: `https://scan.arc.example/tx/0x${'2'.repeat(64)}`,
            approveTx: `https://scan.arc.example/tx/0x${'3'.repeat(64)}`,
            fundTx: `https://scan.arc.example/tx/0x${'4'.repeat(64)}`,
            submitTx: `https://scan.arc.example/tx/0x${'5'.repeat(64)}`,
            completeTx: completeTxExplorerLink
          }
        }
      };
    });
    const app = createTestApp({
      arcProofService: {
        getStatus: vi.fn(),
        runErc8004: vi.fn(),
        runErc8183
      },
      arcProofEnvSource: {
        ARC_PROOF_CONSOLE_ENABLED: 'true',
        ARC_JOB_PROVIDER_PRIVATE_KEY: leakedProviderSecret
      }
    });

    const response = await invokeApp(app, {
      method: 'POST',
      path: '/api/arc/proofs/erc8183'
    });

    expect(response.statusCode).toBe(200);
    expect(runErc8183).toHaveBeenCalledTimes(1);
    expect(response.text).not.toContain(leakedProviderSecret);
    expect(response.json).toEqual({
      artifactPath: '/tmp/arc-standards/erc8183-job.json',
      artifact: expect.objectContaining({
        jobId: '20889',
        finalStatus: 'Completed',
        budgetUsdc: '1.25',
        description: expect.stringContaining('[REDACTED]'),
        explorerLinks: expect.objectContaining({
          completeTx: completeTxExplorerLink
        })
      })
    });
  });

  it('should return 400 when default ERC-8004 proof config is missing', async () => {
    const originalEnv = {
      ARC_RPC_URL: process.env.ARC_RPC_URL,
      ARC_AGENT_OWNER_PRIVATE_KEY: process.env.ARC_AGENT_OWNER_PRIVATE_KEY,
      ARC_AGENT_VALIDATOR_PRIVATE_KEY: process.env.ARC_AGENT_VALIDATOR_PRIVATE_KEY,
      ARC_AGENT_METADATA_URI: process.env.ARC_AGENT_METADATA_URI
    };

    delete process.env.ARC_RPC_URL;
    delete process.env.ARC_AGENT_OWNER_PRIVATE_KEY;
    delete process.env.ARC_AGENT_VALIDATOR_PRIVATE_KEY;
    delete process.env.ARC_AGENT_METADATA_URI;

    try {
      const app = createTestApp({
        runtimeEnv: {
          NODE_ENV: 'development'
        },
        arcProofEnvSource: {
          ARC_PROOF_CONSOLE_ENABLED: 'true'
        }
      });
      const response = await invokeApp(app, {
        method: 'POST',
        path: '/api/arc/proofs/erc8004'
      });

      expect(response.statusCode).toBe(400);
      expect(response.json).toEqual({
        error: 'arc_proof_config_invalid',
        message: expect.stringContaining('ARC_RPC_URL')
      });
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('should mark proof status unconfigured when private keys are invalid', async () => {
    const app = createTestApp({
      arcProofEnvSource: {
        ARC_PROOF_CONSOLE_ENABLED: 'true',
        ARC_RPC_URL: 'https://rpc.testnet.arc.network',
        ARC_AGENT_OWNER_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
        ARC_AGENT_VALIDATOR_PRIVATE_KEY: 'not-a-private-key',
        ARC_AGENT_METADATA_URI: 'ipfs://agent-proof',
        ARC_JOB_CLIENT_PRIVATE_KEY: `0x${'3'.repeat(64)}`,
        ARC_JOB_PROVIDER_PRIVATE_KEY: 'not-a-private-key',
        ARC_JOB_BUDGET_USDC: '1'
      }
    });

    const response = await invokeApp(app, {
      method: 'GET',
      path: '/api/arc/proofs/status'
    });

    const json = response.json as {
      erc8004: { configured: boolean; error?: string };
      erc8183: { configured: boolean; error?: string };
    };

    expect(response.statusCode).toBe(200);
    expect(json.erc8004.configured).toBe(false);
    expect(json.erc8004.error).toContain('ARC_AGENT_VALIDATOR_PRIVATE_KEY');
    expect(response.text).not.toContain('not-a-private-key');
    expect(json.erc8183.configured).toBe(false);
    expect(json.erc8183.error).toContain('ARC_JOB_PROVIDER_PRIVATE_KEY');
  });

  it('should refuse default proof runs in test mode even when ARC env is present', async () => {
    const app = createTestApp({
      arcProofEnvSource: {
        ARC_PROOF_CONSOLE_ENABLED: 'true',
        ARC_RPC_URL: 'https://rpc.testnet.arc.network',
        ARC_AGENT_OWNER_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
        ARC_AGENT_VALIDATOR_PRIVATE_KEY: `0x${'2'.repeat(64)}`,
        ARC_AGENT_METADATA_URI: 'ipfs://agent-proof',
        ARC_JOB_CLIENT_PRIVATE_KEY: `0x${'3'.repeat(64)}`,
        ARC_JOB_PROVIDER_PRIVATE_KEY: `0x${'4'.repeat(64)}`,
        ARC_JOB_BUDGET_USDC: '1'
      }
    });

    const erc8004Response = await invokeApp(app, {
      method: 'POST',
      path: '/api/arc/proofs/erc8004'
    });
    const erc8183Response = await invokeApp(app, {
      method: 'POST',
      path: '/api/arc/proofs/erc8183'
    });

    expect(erc8004Response.statusCode).toBe(409);
    expect(erc8004Response.json).toEqual({
      error: 'arc_proof_run_disabled',
      message: expect.stringContaining('test mode')
    });
    expect(erc8183Response.statusCode).toBe(409);
    expect(erc8183Response.json).toEqual({
      error: 'arc_proof_run_disabled',
      message: expect.stringContaining('test mode')
    });
  });

  it('should redact env-sourced secrets from successful injected proof responses', async () => {
    const originalSecret = process.env.ARC_AGENT_OWNER_PRIVATE_KEY;
    const leakedPrivateKey = `0x${'9'.repeat(64)}`;
    process.env.ARC_AGENT_OWNER_PRIVATE_KEY = leakedPrivateKey;

    try {
      const app = createTestApp({
        arcProofService: {
          getStatus: vi.fn(),
          runErc8004: vi.fn(async () => ({
            artifactPath: '/tmp/arc-standards/erc8004-agent.json',
            artifact: {
              owner: '0x70a65AA0cB3Ee82cF8ba353D585F880c943D68C0',
              validator: '0x84CE50903884def745739c727c9eaA8d737C7457',
              agentId: '14296',
              metadataUri: leakedPrivateKey,
              registrationTxHash: `0x${'a'.repeat(64)}`,
              reputationTxHash: `0x${'b'.repeat(64)}`,
              validationRequestTxHash: `0x${'c'.repeat(64)}`,
              validationResponseTxHash: `0x${'d'.repeat(64)}`,
              requestHash: `0x${'e'.repeat(64)}`,
              explorerLinks: {
                registrationTx: `https://scan.arc.example/tx/0x${'a'.repeat(64)}`,
                reputationTx: `https://scan.arc.example/tx/0x${'b'.repeat(64)}`,
                validationRequestTx: `https://scan.arc.example/tx/0x${'c'.repeat(64)}`,
                validationResponseTx: `https://scan.arc.example/tx/0x${'d'.repeat(64)}`
              }
            }
          })),
          runErc8183: vi.fn()
        },
        arcProofEnvSource: {
          ARC_PROOF_CONSOLE_ENABLED: 'true',
          ARC_AGENT_OWNER_PRIVATE_KEY: leakedPrivateKey
        }
      });

      const response = await invokeApp(app, {
        method: 'POST',
        path: '/api/arc/proofs/erc8004'
      });

      expect(response.statusCode).toBe(200);
      expect(response.text).not.toContain(leakedPrivateKey);
      expect(response.json).toEqual({
        artifactPath: '/tmp/arc-standards/erc8004-agent.json',
        artifact: expect.objectContaining({
          metadataUri: '[REDACTED]'
        })
      });
    } finally {
      if (originalSecret === undefined) {
        delete process.env.ARC_AGENT_OWNER_PRIVATE_KEY;
      } else {
        process.env.ARC_AGENT_OWNER_PRIVATE_KEY = originalSecret;
      }
    }
  });

  it('should sanitize unexpected proof service failures', async () => {
    const leakedPrivateKey = '0x70fff75e326b04954b6d4b7fb4cbd046d943a640a88a4b3a2e59163dbbfcbece';
    const app = createTestApp({
      arcProofService: {
        getStatus: vi.fn(),
        runErc8004: vi.fn(async () => {
          throw new Error(`runner failed with --private-key ${leakedPrivateKey}`);
        }),
        runErc8183: vi.fn()
      },
      arcProofEnvSource: {
        ARC_PROOF_CONSOLE_ENABLED: 'true'
      }
    });

    const response = await invokeApp(app, {
      method: 'POST',
      path: '/api/arc/proofs/erc8004'
    });

    expect(response.statusCode).toBe(500);
    expect(response.json).toEqual({
      error: 'arc_proof_failed',
      message: expect.stringContaining('[REDACTED]')
    });
    expect(response.text).not.toContain(leakedPrivateKey);
  });
});
