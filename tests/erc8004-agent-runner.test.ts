import { describe, expect, it, vi } from 'vitest';
import { keccak256, toHex } from 'viem';

describe('erc8004 agent proof runner', () => {
  it('should reject invalid private keys without leaking their values', async () => {
    const { parseErc8004AgentEnv } = await import('../scripts/erc8004-agent-runner.js');

    expect(() =>
      parseErc8004AgentEnv({
        ARC_RPC_URL: 'https://rpc.arc.example',
        ARC_AGENT_OWNER_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
        ARC_AGENT_VALIDATOR_PRIVATE_KEY: 'not-a-private-key',
        ARC_AGENT_METADATA_URI: 'ipfs://arc-agent'
      })
    ).toThrowError(/ARC_AGENT_VALIDATOR_PRIVATE_KEY/);

    try {
      parseErc8004AgentEnv({
        ARC_RPC_URL: 'https://rpc.arc.example',
        ARC_AGENT_OWNER_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
        ARC_AGENT_VALIDATOR_PRIVATE_KEY: 'not-a-private-key',
        ARC_AGENT_METADATA_URI: 'ipfs://arc-agent'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('not-a-private-key');
    }
  });

  it('should reject missing env vars without leaking configured secrets', async () => {
    const { parseErc8004AgentEnv } = await import('../scripts/erc8004-agent-runner.js');

    expect(() =>
      parseErc8004AgentEnv({
        ARC_RPC_URL: 'https://rpc.arc.example/path?apiKey=super-secret',
        ARC_AGENT_OWNER_PRIVATE_KEY: '0xownersecret',
        ARC_AGENT_METADATA_URI: 'ipfs://arc-agent'
      })
    ).toThrowError(/ARC_AGENT_VALIDATOR_PRIVATE_KEY/);

    try {
      parseErc8004AgentEnv({
        ARC_RPC_URL: 'https://rpc.arc.example/path?apiKey=super-secret',
        ARC_AGENT_OWNER_PRIVATE_KEY: '0xownersecret',
        ARC_AGENT_METADATA_URI: 'ipfs://arc-agent'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('0xownersecret');
      expect(message).not.toContain('apiKey=super-secret');
    }
  });

  it('should register an agent, record reputation, request validation, respond and write an artifact', async () => {
    const { runErc8004AgentProof } = await import('../scripts/erc8004-agent-runner.js');

    const owner = '0x1111111111111111111111111111111111111111';
    const validator = '0x2222222222222222222222222222222222222222';
    const registerTxHash = `0x${'a'.repeat(64)}` as const;
    const reputationTxHash = `0x${'b'.repeat(64)}` as const;
    const validationRequestTxHash = `0x${'c'.repeat(64)}` as const;
    const validationResponseTxHash = `0x${'d'.repeat(64)}` as const;
    const expectedAgentId = 12n;
    const expectedRequestHash = keccak256(toHex(`kyc_verification_request_agent_${expectedAgentId}`));
    const functionCalls: string[] = [];

    const ownerClient = {
      account: { address: owner },
      writeContract: vi.fn(async (request: { functionName: string; args?: readonly unknown[] }) => {
        functionCalls.push(`owner:${request.functionName}`);

        if (request.functionName === 'register') {
          expect(request.args).toEqual(['ipfs://arc-agent']);
          return registerTxHash;
        }

        expect(request.args).toEqual([validator, expectedAgentId, 'ipfs://validation-request', expectedRequestHash]);
        return validationRequestTxHash;
      })
    };

    const validatorClient = {
      account: { address: validator },
      writeContract: vi.fn(async (request: { functionName: string; args?: readonly unknown[] }) => {
        functionCalls.push(`validator:${request.functionName}`);

        if (request.functionName === 'giveFeedback') {
          expect(request.args).toEqual([
            expectedAgentId,
            95n,
            0,
            'successful_trade',
            '',
            '',
            '',
            keccak256(toHex('successful_trade'))
          ]);

          return reputationTxHash;
        }

        expect(request.args).toEqual([expectedRequestHash, 100, '', `0x${'0'.repeat(64)}`, 'kyc_verified']);
        return validationResponseTxHash;
      })
    };

    const publicClient = {
      waitForTransactionReceipt: vi.fn(async (request: { hash: `0x${string}` }) => {
        if (request.hash === registerTxHash) {
          return { blockNumber: 101n, status: 'success' as const };
        }

        if (request.hash === reputationTxHash) {
          return { blockNumber: 102n, status: 'success' as const };
        }

        if (request.hash === validationRequestTxHash) {
          return { blockNumber: 103n, status: 'success' as const };
        }

        return { blockNumber: 104n, status: 'success' as const };
      }),
      getLogs: vi.fn(async () => [{ args: { tokenId: expectedAgentId } }])
    };

    const artifactWriter = vi.fn().mockResolvedValue(undefined);
    const artifactPath = '/tmp/arc-standards/erc8004-agent.json';

    const result = await runErc8004AgentProof({
      ownerClient,
      validatorClient,
      publicClient,
      metadataUri: 'ipfs://arc-agent',
      validationRequestUri: 'ipfs://validation-request',
      artifactPath,
      explorerBaseUrl: 'https://scan.arc.example',
      artifactWriter
    });

    expect(functionCalls).toEqual([
      'owner:register',
      'validator:giveFeedback',
      'owner:validationRequest',
      'validator:validationResponse'
    ]);
    expect(publicClient.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        fromBlock: 101n,
        toBlock: 101n
      })
    );
    expect(artifactWriter).toHaveBeenCalledWith(
      artifactPath,
      expect.objectContaining({
        owner,
        validator,
        agentId: expectedAgentId.toString(),
        requestHash: expectedRequestHash,
        registrationTxHash: registerTxHash,
        reputationTxHash,
        validationRequestTxHash,
        validationResponseTxHash,
        explorerLinks: {
          registrationTx: `https://scan.arc.example/tx/${registerTxHash}`,
          reputationTx: `https://scan.arc.example/tx/${reputationTxHash}`,
          validationRequestTx: `https://scan.arc.example/tx/${validationRequestTxHash}`,
          validationResponseTx: `https://scan.arc.example/tx/${validationResponseTxHash}`
        }
      })
    );
    expect(result.artifact.agentId).toBe(expectedAgentId.toString());
    expect(result.artifactPath).toBe(artifactPath);
  });

  it('should fail and avoid writing artifacts when a transaction receipt is reverted', async () => {
    const { runErc8004AgentProof } = await import('../scripts/erc8004-agent-runner.js');

    const registerTxHash = `0x${'e'.repeat(64)}` as const;
    const artifactWriter = vi.fn().mockResolvedValue(undefined);
    const publicClient = {
      waitForTransactionReceipt: vi.fn(async () => ({
        blockNumber: 101n,
        status: 'reverted' as const
      })),
      getLogs: vi.fn(async () => [{ args: { tokenId: 1n } }])
    };

    await expect(
      runErc8004AgentProof({
        ownerClient: {
          account: { address: '0x1111111111111111111111111111111111111111' },
          writeContract: vi.fn(async () => registerTxHash)
        },
        validatorClient: {
          account: { address: '0x2222222222222222222222222222222222222222' },
          writeContract: vi.fn(async () => `0x${'f'.repeat(64)}` as const)
        },
        publicClient,
        metadataUri: 'ipfs://arc-agent',
        validationRequestUri: 'ipfs://validation-request',
        artifactPath: '/tmp/arc-standards/erc8004-agent.json',
        artifactWriter
      })
    ).rejects.toThrow(/reverted/i);

    expect(publicClient.getLogs).not.toHaveBeenCalled();
    expect(artifactWriter).not.toHaveBeenCalled();
  });
});
