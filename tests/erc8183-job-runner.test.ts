import { describe, expect, it, vi } from 'vitest';
import { type Address, type Hex, encodeAbiParameters, encodeEventTopics, keccak256, parseUnits, toHex } from 'viem';

import { agenticCommerceAbi } from '../src/domain/arc-standards/abi.js';
import { ARC_STANDARDS_ADDRESSES, ZERO_ADDRESS } from '../src/domain/arc-standards/constants.js';

const buildJobCreatedLog = (overrides: {
  jobId: bigint;
  client?: Address;
  provider?: Address;
  evaluator?: Address;
  expiredAt?: bigint;
  address?: Address;
}): { address: Address; topics: readonly [Hex, ...Hex[]]; data: Hex } => {
  const client = overrides.client ?? ('0x3333333333333333333333333333333333333333' as Address);
  const provider = overrides.provider ?? ('0x4444444444444444444444444444444444444444' as Address);
  const evaluator = overrides.evaluator ?? client;
  const expiredAt = overrides.expiredAt ?? 4_600n;
  const hook = ZERO_ADDRESS;
  const topics = encodeEventTopics({
    abi: agenticCommerceAbi,
    eventName: 'JobCreated',
    args: {
      jobId: overrides.jobId,
      client,
      provider
    }
  }) as [Hex, ...Hex[]];

  return {
    address: overrides.address ?? ARC_STANDARDS_ADDRESSES.agenticCommerce,
    topics,
    data: encodeAbiParameters(
      [
        { name: 'evaluator', type: 'address' },
        { name: 'expiredAt', type: 'uint256' },
        { name: 'hook', type: 'address' }
      ],
      [evaluator, expiredAt, hook]
    )
  };
};

describe('erc8183 job proof runner', () => {
  it('should reject invalid private keys without leaking their values', async () => {
    const { parseErc8183JobEnv } = await import('../scripts/erc8183-job-runner.js');

    expect(() =>
      parseErc8183JobEnv({
        ARC_RPC_URL: 'https://rpc.arc.example',
        ARC_JOB_CLIENT_PRIVATE_KEY: `0x${'3'.repeat(64)}`,
        ARC_JOB_PROVIDER_PRIVATE_KEY: 'not-a-private-key',
        ARC_JOB_BUDGET_USDC: '1'
      })
    ).toThrowError(/ARC_JOB_PROVIDER_PRIVATE_KEY/);

    try {
      parseErc8183JobEnv({
        ARC_RPC_URL: 'https://rpc.arc.example',
        ARC_JOB_CLIENT_PRIVATE_KEY: `0x${'3'.repeat(64)}`,
        ARC_JOB_PROVIDER_PRIVATE_KEY: 'not-a-private-key',
        ARC_JOB_BUDGET_USDC: '1'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('not-a-private-key');
    }
  });

  it('should reject invalid budgets before broadcasting', async () => {
    const { parseErc8183JobEnv } = await import('../scripts/erc8183-job-runner.js');

    expect(() =>
      parseErc8183JobEnv({
        ARC_RPC_URL: 'https://rpc.arc.example',
        ARC_JOB_CLIENT_PRIVATE_KEY: '0xclientsecret',
        ARC_JOB_PROVIDER_PRIVATE_KEY: '0xprovidersecret',
        ARC_JOB_BUDGET_USDC: '0'
      })
    ).toThrowError(/预算必须是正数 USDC/);

    try {
      parseErc8183JobEnv({
        ARC_RPC_URL: 'https://rpc.arc.example',
        ARC_JOB_CLIENT_PRIVATE_KEY: '0xclientsecret',
        ARC_JOB_PROVIDER_PRIVATE_KEY: '0xprovidersecret',
        ARC_JOB_BUDGET_USDC: '0'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('0xclientsecret');
      expect(message).not.toContain('0xprovidersecret');
    }
  });

  it('should reject missing rpc url or private keys without leaking configured secrets', async () => {
    const { parseErc8183JobEnv } = await import('../scripts/erc8183-job-runner.js');

    expect(() =>
      parseErc8183JobEnv({
        ARC_JOB_CLIENT_PRIVATE_KEY: '0xclientsecret',
        ARC_JOB_PROVIDER_PRIVATE_KEY: '0xprovidersecret',
        ARC_JOB_BUDGET_USDC: '1'
      })
    ).toThrowError(/ARC_RPC_URL/);

    try {
      parseErc8183JobEnv({
        ARC_RPC_URL: 'https://rpc.arc.example?token=super-secret',
        ARC_JOB_CLIENT_PRIVATE_KEY: '0xclientsecret',
        ARC_JOB_BUDGET_USDC: '1'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toMatch(/ARC_JOB_PROVIDER_PRIVATE_KEY/);
      expect(message).not.toContain('0xclientsecret');
      expect(message).not.toContain('token=super-secret');
    }
  });

  it('should run the full job lifecycle and write the completed artifact', async () => {
    const { runErc8183JobProof } = await import('../scripts/erc8183-job-runner.js');

    const client = '0x3333333333333333333333333333333333333333';
    const provider = '0x4444444444444444444444444444444444444444';
    const createTxHash = `0x${'1'.repeat(64)}` as const;
    const setBudgetTxHash = `0x${'2'.repeat(64)}` as const;
    const approveTxHash = `0x${'3'.repeat(64)}` as const;
    const fundTxHash = `0x${'4'.repeat(64)}` as const;
    const submitTxHash = `0x${'5'.repeat(64)}` as const;
    const completeTxHash = `0x${'6'.repeat(64)}` as const;
    const jobId = 34n;
    const budgetAtomic = parseUnits('2.5', 6);
    const functionCalls: string[] = [];

    const clientClient = {
      account: { address: client },
      writeContract: vi.fn(async (request: { functionName: string; args?: readonly unknown[] }) => {
        functionCalls.push(`client:${request.functionName}`);

        if (request.functionName === 'createJob') {
          expect(request.args).toEqual([
            provider,
            client,
            4_600n,
            'Arc Signal Desk proof job',
            '0x0000000000000000000000000000000000000000'
          ]);
          return createTxHash;
        }

        if (request.functionName === 'approve') {
          expect(request.args).toEqual(['0x0747EEf0706327138c69792bF28Cd525089e4583', budgetAtomic]);
          return approveTxHash;
        }

        if (request.functionName === 'fund') {
          expect(request.args).toEqual([jobId, '0x']);
          return fundTxHash;
        }

        expect(request.args).toEqual([jobId, keccak256(toHex('work-delivered-and-approved')), '0x']);
        return completeTxHash;
      })
    };

    const providerClient = {
      account: { address: provider },
      writeContract: vi.fn(async (request: { functionName: string; args?: readonly unknown[] }) => {
        functionCalls.push(`provider:${request.functionName}`);

        if (request.functionName === 'setBudget') {
          expect(request.args).toEqual([jobId, budgetAtomic, '0x']);
          return setBudgetTxHash;
        }

        expect(request.args).toEqual([jobId, keccak256(toHex('arc-erc8183-demo-deliverable')), '0x']);
        return submitTxHash;
      })
    };

    const publicClient = {
      getBlock: vi.fn(async () => ({ timestamp: 1_000n })),
      waitForTransactionReceipt: vi.fn(async (request: { hash: `0x${string}` }) => {
        if (request.hash === createTxHash) {
          return {
            blockNumber: 201n,
            status: 'success' as const,
            logs: [
              buildJobCreatedLog({
                jobId: 999n,
                address: '0x5555555555555555555555555555555555555555'
              }),
              buildJobCreatedLog({ jobId })
            ]
          };
        }

        return {
          blockNumber: 201n,
          status: 'success' as const,
          logs: []
        };
      }),
      getLogs: vi.fn(async () => {
        throw new Error('block-level getLogs should not be used');
      }),
      readContract: vi.fn(async () => ({
        id: jobId,
        status: 3,
        budget: budgetAtomic
      }))
    };

    const artifactWriter = vi.fn().mockResolvedValue(undefined);
    const artifactPath = '/tmp/arc-standards/erc8183-job.json';

    const result = await runErc8183JobProof({
      clientClient,
      providerClient,
      publicClient,
      budgetAtomic,
      budgetUsdc: '2.5',
      description: 'Arc Signal Desk proof job',
      artifactPath,
      explorerBaseUrl: 'https://scan.arc.example',
      artifactWriter
    });

    expect(functionCalls).toEqual([
      'client:createJob',
      'provider:setBudget',
      'client:approve',
      'client:fund',
      'provider:submit',
      'client:complete'
    ]);
    expect(publicClient.getLogs).not.toHaveBeenCalled();
    expect(artifactWriter).toHaveBeenCalledWith(
      artifactPath,
      expect.objectContaining({
        client,
        provider,
        jobId: jobId.toString(),
        budgetAtomic: budgetAtomic.toString(),
        budgetUsdc: '2.5',
        finalStatus: 'Completed',
        createTxHash,
        setBudgetTxHash,
        approveTxHash,
        fundTxHash,
        submitTxHash,
        completeTxHash,
        deliverableHash: keccak256(toHex('arc-erc8183-demo-deliverable')),
        reasonHash: keccak256(toHex('work-delivered-and-approved')),
        explorerLinks: {
          createTx: `https://scan.arc.example/tx/${createTxHash}`,
          setBudgetTx: `https://scan.arc.example/tx/${setBudgetTxHash}`,
          approveTx: `https://scan.arc.example/tx/${approveTxHash}`,
          fundTx: `https://scan.arc.example/tx/${fundTxHash}`,
          submitTx: `https://scan.arc.example/tx/${submitTxHash}`,
          completeTx: `https://scan.arc.example/tx/${completeTxHash}`
        }
      })
    );
    expect(result.artifact.finalStatus).toBe('Completed');
    expect(result.artifactPath).toBe(artifactPath);
  });

  it('should fail and avoid writing artifacts when a transaction receipt is reverted', async () => {
    const { runErc8183JobProof } = await import('../scripts/erc8183-job-runner.js');

    const createTxHash = `0x${'7'.repeat(64)}` as const;
    const artifactWriter = vi.fn().mockResolvedValue(undefined);
    const publicClient = {
      getBlock: vi.fn(async () => ({ timestamp: 1_000n })),
      waitForTransactionReceipt: vi.fn(async () => ({
        blockNumber: 201n,
        status: 'reverted' as const,
        logs: []
      })),
      getLogs: vi.fn(async () => [{ args: { jobId: 34n } }]),
      readContract: vi.fn()
    };

    await expect(
      runErc8183JobProof({
        clientClient: {
          account: { address: '0x3333333333333333333333333333333333333333' },
          writeContract: vi.fn(async () => createTxHash)
        },
        providerClient: {
          account: { address: '0x4444444444444444444444444444444444444444' },
          writeContract: vi.fn(async () => `0x${'8'.repeat(64)}` as const)
        },
        publicClient,
        budgetAtomic: parseUnits('1', 6),
        budgetUsdc: '1',
        description: 'Arc Signal Desk proof job',
        artifactPath: '/tmp/arc-standards/erc8183-job.json',
        artifactWriter
      })
    ).rejects.toThrow(/reverted/i);

    expect(publicClient.getLogs).not.toHaveBeenCalled();
    expect(artifactWriter).not.toHaveBeenCalled();
  });

  it('should fail when the final job status is not Completed', async () => {
    const { runErc8183JobProof } = await import('../scripts/erc8183-job-runner.js');

    const createTxHash = `0x${'9'.repeat(64)}` as const;
    const setBudgetTxHash = `0x${'a'.repeat(64)}` as const;
    const approveTxHash = `0x${'b'.repeat(64)}` as const;
    const fundTxHash = `0x${'c'.repeat(64)}` as const;
    const submitTxHash = `0x${'d'.repeat(64)}` as const;
    const completeTxHash = `0x${'e'.repeat(64)}` as const;
    const jobId = 52n;
    const artifactWriter = vi.fn().mockResolvedValue(undefined);

    const publicClient = {
      getBlock: vi.fn(async () => ({ timestamp: 1_000n })),
      waitForTransactionReceipt: vi.fn(async (request: { hash: `0x${string}` }) => {
        if (request.hash === createTxHash) {
          return {
            blockNumber: 201n,
            status: 'success' as const,
            logs: [buildJobCreatedLog({ jobId })]
          };
        }

        return {
          blockNumber: 201n,
          status: 'success' as const,
          logs: []
        };
      }),
      getLogs: vi.fn(async () => [{ args: { jobId } }]),
      readContract: vi.fn(async () => ({
        id: jobId,
        status: 2,
        budget: parseUnits('1', 6)
      }))
    };

    await expect(
      runErc8183JobProof({
        clientClient: {
          account: { address: '0x3333333333333333333333333333333333333333' },
          writeContract: vi.fn(async (request: { functionName: string }) => {
            if (request.functionName === 'createJob') {
              return createTxHash;
            }

            if (request.functionName === 'approve') {
              return approveTxHash;
            }

            if (request.functionName === 'fund') {
              return fundTxHash;
            }

            return completeTxHash;
          })
        },
        providerClient: {
          account: { address: '0x4444444444444444444444444444444444444444' },
          writeContract: vi.fn(async (request: { functionName: string }) => {
            if (request.functionName === 'setBudget') {
              return setBudgetTxHash;
            }

            return submitTxHash;
          })
        },
        publicClient,
        budgetAtomic: parseUnits('1', 6),
        budgetUsdc: '1',
        description: 'Arc Signal Desk proof job',
        artifactPath: '/tmp/arc-standards/erc8183-job.json',
        artifactWriter
      })
    ).rejects.toThrow(/Completed/);

    expect(artifactWriter).not.toHaveBeenCalled();
  });
});
