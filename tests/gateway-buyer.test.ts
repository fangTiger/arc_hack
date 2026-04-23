import { describe, expect, it, vi } from 'vitest';

import type { ExtractionRequest } from '../src/domain/extraction/types.js';
import type {
  GatewayBuyerClient,
  GatewayBuyerDependencies,
  GatewayBuyerRequest,
  PostProbeResponse
} from '../src/domain/payment/gateway-buyer.js';
import { createGatewayBuyer } from '../src/domain/payment/gateway-buyer.js';

const extractionBody: ExtractionRequest = {
  sourceType: 'news',
  title: 'Arc partners with Circle',
  text: 'Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.'
};

const buildProbeHeader = (overrides: Partial<PostProbeResponse> = {}) => {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:5042002',
          asset: 'USDC',
          amount: '4000',
          payTo: '0xSeller',
          maxTimeoutSeconds: 345600,
          extra: {
            name: 'GatewayWalletBatched',
            version: '1',
            verifyingContract: '0xgatewayverifier'
          }
        }
      ],
      ...overrides
    } satisfies PostProbeResponse)
  ).toString('base64');
};

const createMockClient = () =>
  ({
    address: '0xbuyer',
    getBalances: vi.fn(),
    deposit: vi.fn(),
    pay: vi.fn()
  }) satisfies GatewayBuyerClient;

const createDependencies = (
  client: GatewayBuyerClient,
  fetchImplementation: GatewayBuyerDependencies['fetch']
): GatewayBuyerDependencies => ({
  createClient: vi.fn(() => client),
  fetch: fetchImplementation
});

const createBatchRequest = (requestId: string): GatewayBuyerRequest => ({
  requestId,
  operation: 'summary',
  body: extractionBody
});

describe('createGatewayBuyer', () => {
  it('should probe with POST and parse the gateway batching option for the configured chain', async () => {
    const client = createMockClient();
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      return new Response('{}', {
        status: 402,
        headers: {
          'PAYMENT-REQUIRED': buildProbeHeader()
        }
      });
    });
    const buyer = createGatewayBuyer(
      {
        baseUrl: 'http://127.0.0.1:3000',
        chain: 'arcTestnet',
        privateKey: '0x1234'
      },
      createDependencies(client, fetchMock)
    );

    const probe = await buyer.probe(createBatchRequest('buyer-001'));

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/extract/summary',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(extractionBody),
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-request-id': 'buyer-001'
        })
      })
    );
    expect(probe.accepted.network).toBe('eip155:5042002');
    expect(probe.accepted.amount).toBe('4000');
  });

  it('should auto-deposit before batch pay when gateway balance is insufficient', async () => {
    const client = createMockClient();
    const fetchMock = vi.fn(async () => {
      return new Response('{}', {
        status: 402,
        headers: {
          'PAYMENT-REQUIRED': buildProbeHeader()
        }
      });
    });

    client.getBalances
      .mockResolvedValueOnce({
        wallet: { balance: 20_000n, formatted: '0.020000' },
        gateway: {
          total: 1_000n,
          available: 1_000n,
          withdrawing: 0n,
          withdrawable: 0n,
          formattedTotal: '0.001000',
          formattedAvailable: '0.001000',
          formattedWithdrawing: '0.000000',
          formattedWithdrawable: '0.000000'
        }
      })
      .mockResolvedValueOnce({
        wallet: { balance: 10_000n, formatted: '0.010000' },
        gateway: {
          total: 11_000n,
          available: 11_000n,
          withdrawing: 0n,
          withdrawable: 0n,
          formattedTotal: '0.011000',
          formattedAvailable: '0.011000',
          formattedWithdrawing: '0.000000',
          formattedWithdrawable: '0.000000'
        }
      })
      .mockResolvedValueOnce({
        wallet: { balance: 6_000n, formatted: '0.006000' },
        gateway: {
          total: 7_000n,
          available: 7_000n,
          withdrawing: 0n,
          withdrawable: 0n,
          formattedTotal: '0.007000',
          formattedAvailable: '0.007000',
          formattedWithdrawing: '0.000000',
          formattedWithdrawable: '0.000000'
        }
      });
    client.deposit.mockResolvedValue({
      amount: 10_000n,
      formattedAmount: '0.010000',
      depositor: '0xbuyer',
      depositTxHash: '0xdeposit'
    });
    client.pay.mockResolvedValue({
      data: {
        requestId: 'buyer-001',
        pricedOperation: {
          operation: 'summary',
          price: '$0.004'
        },
        result: {
          kind: 'summary',
          summary: 'Arc and Circle'
        },
        payment: {
          mode: 'gateway',
          status: 'paid',
          payer: '0xbuyer',
          amount: '4000',
          network: 'eip155:5042002',
          transaction: '0xsettlement-1'
        }
      },
      amount: 4_000n,
      formattedAmount: '0.004000',
      transaction: '0xsettlement-1',
      status: 200
    });

    const buyer = createGatewayBuyer(
      {
        baseUrl: 'http://127.0.0.1:3000',
        chain: 'arcTestnet',
        privateKey: '0x1234',
        autoDepositAmount: '0.010000'
      },
      createDependencies(client, fetchMock)
    );

    const result = await buyer.payBatch([createBatchRequest('buyer-001')]);

    expect(client.deposit).toHaveBeenCalledWith('0.010000');
    expect(result.deposit).toMatchObject({
      amount: 10_000n,
      formattedAmount: '0.010000'
    });
    expect(result.balances.before.gateway.available).toBe(1_000n);
    expect(result.balances.after.gateway.available).toBe(7_000n);
    expect(result.payments[0]).toMatchObject({
      requestId: 'buyer-001',
      transaction: '0xsettlement-1',
      payment: {
        amount: '4000',
        network: 'eip155:5042002'
      }
    });
  });

  it('should throw a clear error when balance is insufficient and auto deposit is not configured', async () => {
    const client = createMockClient();
    const fetchMock = vi.fn(async () => {
      return new Response('{}', {
        status: 402,
        headers: {
          'PAYMENT-REQUIRED': buildProbeHeader()
        }
      });
    });

    client.getBalances.mockResolvedValue({
      wallet: { balance: 4_000n, formatted: '0.004000' },
      gateway: {
        total: 1_000n,
        available: 1_000n,
        withdrawing: 0n,
        withdrawable: 0n,
        formattedTotal: '0.001000',
        formattedAvailable: '0.001000',
        formattedWithdrawing: '0.000000',
        formattedWithdrawable: '0.000000'
      }
    });

    const buyer = createGatewayBuyer(
      {
        baseUrl: 'http://127.0.0.1:3000',
        chain: 'arcTestnet',
        privateKey: '0x1234'
      },
      createDependencies(client, fetchMock)
    );

    await expect(buyer.payBatch([createBatchRequest('buyer-001')])).rejects.toThrow(
      'Gateway available balance is insufficient'
    );
    expect(client.deposit).not.toHaveBeenCalled();
    expect(client.pay).not.toHaveBeenCalled();
  });

  it('should surface probe errors when the seller does not return a matching batching option', async () => {
    const client = createMockClient();
    const fetchMock = vi.fn(async () => {
      return new Response('{}', {
        status: 402,
        headers: {
          'PAYMENT-REQUIRED': buildProbeHeader({
            accepts: [
              {
                scheme: 'exact',
                network: 'eip155:84532',
                asset: 'USDC',
                amount: '4000',
                payTo: '0xSeller',
                maxTimeoutSeconds: 345600,
                extra: {
                  name: 'GatewayWalletBatched',
                  version: '1',
                  verifyingContract: '0xgatewayverifier'
                }
              }
            ]
          })
        }
      });
    });
    const buyer = createGatewayBuyer(
      {
        baseUrl: 'http://127.0.0.1:3000',
        chain: 'arcTestnet',
        privateKey: '0x1234'
      },
      createDependencies(client, fetchMock)
    );

    await expect(buyer.probe(createBatchRequest('buyer-001'))).rejects.toThrow(
      'No Gateway batching option available for network eip155:5042002'
    );
  });

  it('should preserve seller failure details when the paid request returns payment processing error', async () => {
    const client = createMockClient();
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;

      if (!headers?.['Payment-Signature']) {
        return new Response('{}', {
          status: 402,
          headers: {
            'PAYMENT-REQUIRED': buildProbeHeader()
          }
        });
      }

      return new Response(
        JSON.stringify({
          error: 'Payment processing error',
          message: 'Circle Gateway settle failed (503): upstream timeout'
        }),
        {
          status: 500,
          headers: {
            'content-type': 'application/json'
          }
        }
      );
    });

    client.getBalances.mockResolvedValue({
      wallet: { balance: 20_000n, formatted: '0.020000' },
      gateway: {
        total: 20_000n,
        available: 20_000n,
        withdrawing: 0n,
        withdrawable: 0n,
        formattedTotal: '0.020000',
        formattedAvailable: '0.020000',
        formattedWithdrawing: '0.000000',
        formattedWithdrawable: '0.000000'
      }
    });
    (
      client as unknown as GatewayBuyerClient & {
        createPaymentPayload: ReturnType<typeof vi.fn>;
      }
    ).createPaymentPayload = vi.fn().mockResolvedValue({
      x402Version: 2,
      payload: {
        authorization: { nonce: '0xnonce' },
        signature: '0xsig'
      }
    });

    const buyer = createGatewayBuyer(
      {
        baseUrl: 'http://127.0.0.1:3000',
        chain: 'arcTestnet',
        privateKey: '0x1234'
      },
      createDependencies(client, fetchMock)
    );

    await expect(buyer.payBatch([createBatchRequest('buyer-001')])).rejects.toThrow(
      'Payment failed: Payment processing error | Circle Gateway settle failed (503): upstream timeout'
    );
    expect(client.pay).not.toHaveBeenCalled();
  });

  it('should keep createPaymentPayload bound to the gateway client instance', async () => {
    const client = createMockClient();
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;

      if (!headers?.['Payment-Signature']) {
        return new Response('{}', {
          status: 402,
          headers: {
            'PAYMENT-REQUIRED': buildProbeHeader()
          }
        });
      }

      return new Response(
        JSON.stringify({
          requestId: 'buyer-001',
          pricedOperation: {
            operation: 'summary',
            price: '$0.004'
          },
          result: {
            kind: 'summary',
            summary: 'Arc and Circle'
          },
          payment: {
            mode: 'gateway',
            status: 'paid',
            payer: '0xbuyer',
            amount: '4000',
            network: 'eip155:5042002',
            transaction: '0xsettlement-1'
          }
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      );
    });

    client.getBalances.mockResolvedValue({
      wallet: { balance: 20_000n, formatted: '0.020000' },
      gateway: {
        total: 20_000n,
        available: 20_000n,
        withdrawing: 0n,
        withdrawable: 0n,
        formattedTotal: '0.020000',
        formattedAvailable: '0.020000',
        formattedWithdrawing: '0.000000',
        formattedWithdrawable: '0.000000'
      }
    });
    (
      client as unknown as GatewayBuyerClient & {
        createPaymentPayload: (
          x402Version: number,
          paymentRequirements: PostProbeResponse['accepts'][number]
        ) => Promise<{
          x402Version: number;
          payload: unknown;
        }>;
      }
    ).createPaymentPayload = async function (x402Version) {
      return {
        x402Version,
        payload: {
          payer: this.address
        }
      };
    };

    const buyer = createGatewayBuyer(
      {
        baseUrl: 'http://127.0.0.1:3000',
        chain: 'arcTestnet',
        privateKey: '0x1234'
      },
      createDependencies(client, fetchMock)
    );

    const result = await buyer.payBatch([createBatchRequest('buyer-001')]);

    expect(result.payments[0]).toMatchObject({
      requestId: 'buyer-001',
      transaction: '0xsettlement-1'
    });
    expect(client.pay).not.toHaveBeenCalled();
  });
});
