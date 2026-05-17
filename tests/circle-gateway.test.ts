import { describe, expect, it, vi } from 'vitest';

const gatewayHarness = vi.hoisted(() => {
  type FacilitatorConfig = {
    url?: string;
  };

  type PaymentRequirements = {
    maxTimeoutSeconds: number;
    network: string;
  };

  const state = {
    configs: [] as FacilitatorConfig[],
    verifyRequirements: [] as PaymentRequirements[],
    settleRequirements: [] as PaymentRequirements[]
  };

  class BatchFacilitatorClient {
    constructor(config: FacilitatorConfig = {}) {
      state.configs.push(config);
    }

    async getSupported() {
      return {
        kinds: [
          {
            x402Version: 2,
            scheme: 'exact',
            network: 'eip155:5042002',
            extra: {
              verifyingContract: '0xgatewayverifier',
              assets: [
                {
                  symbol: 'USDC',
                  address: '0xusdc'
                }
              ]
            }
          }
        ],
        extensions: [],
        signers: {}
      };
    }

    async verify(_paymentPayload: unknown, paymentRequirements: PaymentRequirements) {
      state.verifyRequirements.push(paymentRequirements);

      return {
        isValid: true,
        payer: '0xbuyer'
      };
    }

    async settle(_paymentPayload: unknown, paymentRequirements: PaymentRequirements) {
      state.settleRequirements.push(paymentRequirements);

      return {
        success: true,
        payer: '0xbuyer',
        transaction: '0xsettlement',
        network: paymentRequirements.network
      };
    }
  }

  const createGatewayMiddleware = vi.fn((config: { sellerAddress: string }) => ({
    require: vi.fn((price: string) => {
      return async (request: any, response: any, next: () => void) => {
        if (!request.headers['payment-signature']) {
          const paymentRequired = {
            x402Version: 2,
            resource: {
              url: request.url ?? '/',
              description: 'Paid resource',
              mimeType: 'application/json'
            },
            accepts: [
              {
                scheme: 'exact',
                network: 'eip155:5042002',
                asset: '0xusdc',
                amount: String(Math.round(Number(price.replace(/[$]/g, '')) * 1_000_000)),
                payTo: config.sellerAddress,
                maxTimeoutSeconds: 345600,
                extra: {
                  name: 'GatewayWalletBatched',
                  version: '1',
                  verifyingContract: '0xgatewayverifier'
                }
              }
            ]
          };

          response.statusCode = 402;
          response.setHeader('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(paymentRequired)).toString('base64'));
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({}));
          return;
        }

        next();
      };
    }),
    verify: vi.fn(),
    settle: vi.fn()
  }));

  return {
    state,
    BatchFacilitatorClient,
    createGatewayMiddleware
  };
});

vi.mock('@circle-fin/x402-batching/server', () => ({
  BatchFacilitatorClient: gatewayHarness.BatchFacilitatorClient,
  createGatewayMiddleware: gatewayHarness.createGatewayMiddleware
}));

import { createCircleGatewayMiddleware } from '../src/domain/payment/circle-gateway.js';

const createResponse = () => {
  const headers = new Map<string, string>();
  let body = '';

  return {
    response: {
      statusCode: 200,
      setHeader: vi.fn((name: string, value: string) => {
        headers.set(name.toLowerCase(), value);
      }),
      end: vi.fn((value: string) => {
        body = value;
      })
    },
    getHeader: (name: string) => headers.get(name.toLowerCase()),
    getBody: () => body
  };
};

describe('createCircleGatewayMiddleware', () => {
  it('should use an eight-day validity window for gateway challenge and verification requirements', async () => {
    const gateway = createCircleGatewayMiddleware({
      sellerAddress: '0xSeller',
      networks: ['eip155:5042002'],
      facilitatorUrl: 'https://gateway.example/facilitator'
    });
    const middleware = gateway.require('$0.004');
    const unpaidResponse = createResponse();

    await middleware(
      {
        headers: {},
        url: '/summary'
      } as any,
      unpaidResponse.response as any,
      vi.fn()
    );

    const paymentRequired = JSON.parse(
      Buffer.from(unpaidResponse.getHeader('PAYMENT-REQUIRED') ?? '', 'base64').toString('utf8')
    ) as {
      accepts: Array<{
        maxTimeoutSeconds: number;
        network: string;
      }>;
    };

    expect(paymentRequired.accepts[0]).toMatchObject({
      network: 'eip155:5042002',
      maxTimeoutSeconds: 691200
    });

    const paymentHeader = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepted: paymentRequired.accepts[0],
        payload: {
          authorization: {},
          signature: '0xsig'
        }
      })
    ).toString('base64');
    const paidResponse = createResponse();
    const next = vi.fn();

    await middleware(
      {
        headers: {
          'payment-signature': paymentHeader
        },
        url: '/summary'
      } as any,
      paidResponse.response as any,
      next
    );

    expect(gatewayHarness.state.verifyRequirements[0]).toMatchObject({
      network: 'eip155:5042002',
      maxTimeoutSeconds: 691200
    });
    expect(gatewayHarness.state.settleRequirements[0]).toMatchObject({
      network: 'eip155:5042002',
      maxTimeoutSeconds: 691200
    });
    expect(next).toHaveBeenCalledOnce();
  });
});
