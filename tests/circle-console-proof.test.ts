import { describe, expect, it, vi } from 'vitest';

const USAGE_RECEIPT_ADDRESS = '0x1111111111111111111111111111111111111111';

const createJsonResponse = (body: unknown, options: { status?: number; requestId?: string } = {}) => {
  const headers = new Headers({
    'content-type': 'application/json'
  });

  if (options.requestId) {
    headers.set('x-request-id', options.requestId);
  }

  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers
  });
};

describe('circle console proof domain', () => {
  it('should reject missing CIRCLE_API_KEY without leaking configured values', async () => {
    const { parseCircleConsoleEnv } = await import('../src/domain/circle-console/proof.js');

    expect(() =>
      parseCircleConsoleEnv({
        CIRCLE_API_BASE_URL: 'https://api.circle.com/v1?token=super-secret',
        USAGE_RECEIPT_ADDRESS: USAGE_RECEIPT_ADDRESS
      })
    ).toThrowError(/CIRCLE_API_KEY/);

    try {
      parseCircleConsoleEnv({
        CIRCLE_API_BASE_URL: 'https://api.circle.com/v1?token=super-secret',
        USAGE_RECEIPT_ADDRESS: USAGE_RECEIPT_ADDRESS
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('super-secret');
      expect(message).not.toContain(USAGE_RECEIPT_ADDRESS);
    }
  });

  it('should reject secret-bearing Circle API base URLs without echoing their contents', async () => {
    const { parseCircleConsoleEnv } = await import('../src/domain/circle-console/proof.js');

    try {
      parseCircleConsoleEnv({
        CIRCLE_API_KEY: 'circle-secret-key',
        CIRCLE_API_BASE_URL: 'https://user:password@api.circle.com?token=super-secret#secret-frag-value',
        USAGE_RECEIPT_ADDRESS: USAGE_RECEIPT_ADDRESS
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('CIRCLE_API_BASE_URL');
      expect(message).not.toContain('super-secret');
      expect(message).not.toContain('password');
      expect(message).not.toContain('secret-frag-value');
      return;
    }

    throw new Error('Expected CIRCLE_API_BASE_URL validation to fail.');
  });

  it('should skip contract import when UsageReceipt already exists in Circle Contracts', async () => {
    const { parseCircleConsoleEnv, runCircleConsoleProof } = await import('../src/domain/circle-console/proof.js');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      expect(init?.headers).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer circle-secret-key',
          'Content-Type': 'application/json',
          'X-Request-Id': expect.any(String)
        })
      );

      if (url === 'https://api.circle.com/v1/w3s/wallets') {
        return createJsonResponse(
          {
            data: {
              wallets: [{ id: 'wallet-1' }, { id: 'wallet-2' }]
            }
          },
          { requestId: 'req-wallets' }
        );
      }

      if (url === 'https://api.circle.com/v1/w3s/contracts?blockchain=ARC-TESTNET') {
        return createJsonResponse(
          {
            data: {
              contracts: [
                {
                  id: 'contract-usage-receipt',
                  contractAddress: USAGE_RECEIPT_ADDRESS,
                  blockchain: 'ARC-TESTNET',
                  name: 'ArcSignalDeskUsageReceipt'
                }
              ]
            }
          },
          { requestId: 'req-contracts' }
        );
      }

      throw new Error(`unexpected fetch ${url}`);
    });
    const artifactWriter = vi.fn(async () => undefined);
    const env = parseCircleConsoleEnv({
      CIRCLE_API_KEY: 'circle-secret-key',
      USAGE_RECEIPT_ADDRESS: USAGE_RECEIPT_ADDRESS,
      CIRCLE_CONSOLE_PROOF_ARTIFACT_PATH: '/tmp/circle-console-proof.json'
    });

    const result = await runCircleConsoleProof({
      env,
      fetchImpl: fetchMock,
      artifactWriter,
      requestIdFactory: vi.fn(() => 'circle-proof-request')
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(artifactWriter).toHaveBeenCalledWith('/tmp/circle-console-proof.json', {
      checkedAt: expect.any(String),
      walletCount: 2,
      contractCount: 1,
      usageReceiptImportStatus: 'already_imported',
      contractId: 'contract-usage-receipt',
      contractAddress: USAGE_RECEIPT_ADDRESS,
      requestIds: {
        wallets: 'req-wallets',
        contracts: 'req-contracts'
      },
      source: {
        apiBaseUrl: 'https://api.circle.com',
        blockchain: 'ARC-TESTNET',
        runner: 'circle-console-proof'
      }
    });
    expect(result.artifact.usageReceiptImportStatus).toBe('already_imported');
    expect(result.artifact.contractId).toBe('contract-usage-receipt');
    expect(result.artifact.requestIds.import).toBeUndefined();
  });

  it('should import UsageReceipt into Circle Contracts when it is missing', async () => {
    const { parseCircleConsoleEnv, runCircleConsoleProof } = await import('../src/domain/circle-console/proof.js');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === 'https://api.circle.com/v1/w3s/wallets') {
        return createJsonResponse(
          {
            data: {
              wallets: [{ id: 'wallet-1' }]
            }
          },
          { requestId: 'req-wallets' }
        );
      }

      if (url === 'https://api.circle.com/v1/w3s/contracts?blockchain=ARC-TESTNET') {
        return createJsonResponse(
          {
            data: {
              contracts: [{ id: 'contract-other', contractAddress: '0x2222222222222222222222222222222222222222' }]
            }
          },
          { requestId: 'req-contracts' }
        );
      }

      if (url === 'https://api.circle.com/v1/w3s/contracts/import') {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(
          JSON.stringify({
            blockchain: 'ARC-TESTNET',
            address: USAGE_RECEIPT_ADDRESS,
            idempotencyKey: 'circle-proof-request',
            name: 'ArcSignalDeskUsageReceipt'
          })
        );

        return createJsonResponse(
          {
            data: {
              contract: {
                id: 'contract-new',
                contractAddress: USAGE_RECEIPT_ADDRESS,
                blockchain: 'ARC-TESTNET'
              }
            }
          },
          { requestId: 'req-import' }
        );
      }

      throw new Error(`unexpected fetch ${url}`);
    });
    const env = parseCircleConsoleEnv({
      CIRCLE_API_KEY: 'circle-secret-key',
      USAGE_RECEIPT_ADDRESS: USAGE_RECEIPT_ADDRESS,
      CIRCLE_CONSOLE_PROOF_ARTIFACT_PATH: '/tmp/circle-console-proof.json'
    });

    const result = await runCircleConsoleProof({
      env,
      fetchImpl: fetchMock,
      artifactWriter: vi.fn(async () => undefined),
      requestIdFactory: vi.fn(() => 'circle-proof-request')
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.artifact).toEqual({
      checkedAt: expect.any(String),
      walletCount: 1,
      contractCount: 2,
      usageReceiptImportStatus: 'imported',
      contractId: 'contract-new',
      contractAddress: USAGE_RECEIPT_ADDRESS,
      requestIds: {
        wallets: 'req-wallets',
        contracts: 'req-contracts',
        import: 'req-import'
      },
      source: {
        apiBaseUrl: 'https://api.circle.com',
        blockchain: 'ARC-TESTNET',
        runner: 'circle-console-proof'
      }
    });
  });

  it('should skip import when USAGE_RECEIPT_ADDRESS is missing and still prove auth plus list access', async () => {
    const { parseCircleConsoleEnv, runCircleConsoleProof } = await import('../src/domain/circle-console/proof.js');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === 'https://api.circle.com/v1/w3s/wallets') {
        return createJsonResponse(
          {
            data: {
              wallets: [{ id: 'wallet-1' }]
            }
          },
          { requestId: 'req-wallets' }
        );
      }

      if (url === 'https://api.circle.com/v1/w3s/contracts?blockchain=ARC-TESTNET') {
        return createJsonResponse(
          {
            data: {
              contracts: []
            }
          },
          { requestId: 'req-contracts' }
        );
      }

      throw new Error(`unexpected fetch ${url}`);
    });
    const env = parseCircleConsoleEnv({
      CIRCLE_API_KEY: 'circle-secret-key',
      CIRCLE_CONSOLE_PROOF_ARTIFACT_PATH: '/tmp/circle-console-proof.json'
    });

    const result = await runCircleConsoleProof({
      env,
      fetchImpl: fetchMock,
      artifactWriter: vi.fn(async () => undefined),
      requestIdFactory: vi.fn(() => 'circle-proof-request')
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.artifact.usageReceiptImportStatus).toBe('skipped_missing_contract_address');
    expect(result.artifact.contractAddress).toBeUndefined();
    expect(result.artifact.requestIds.import).toBeUndefined();
  });

  it('should sanitize Circle API failures without exposing API keys or Authorization headers', async () => {
    const { formatCircleConsoleProofError, parseCircleConsoleEnv, runCircleConsoleProof } = await import(
      '../src/domain/circle-console/proof.js'
    );
    const env = parseCircleConsoleEnv({
      CIRCLE_API_KEY: 'circle-secret-key',
      USAGE_RECEIPT_ADDRESS: USAGE_RECEIPT_ADDRESS
    });

    await expect(
      runCircleConsoleProof({
        env,
        fetchImpl: vi.fn(async () => {
          throw new Error('Circle API rejected Authorization: Bearer circle-secret-key');
        }),
        artifactWriter: vi.fn(async () => undefined),
        requestIdFactory: vi.fn(() => 'circle-proof-request')
      })
    ).rejects.toThrowError(/Circle API request failed/);

    const message = formatCircleConsoleProofError(new Error('Authorization: Bearer circle-secret-key failed'), env);
    expect(message).toContain('[REDACTED]');
    expect(message).not.toContain('circle-secret-key');
    expect(message).not.toContain('Authorization: Bearer');
  });
});
