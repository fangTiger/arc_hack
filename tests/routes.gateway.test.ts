import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const gatewayHarness = vi.hoisted(() => {
  type GatewayMiddlewareConfig = {
    sellerAddress: string;
    networks?: string[] | string;
    facilitatorUrl?: string;
  };

  const state = {
    configs: [] as GatewayMiddlewareConfig[],
    requiredPrices: [] as string[],
    paidRequests: [] as Array<{
      price: string;
      payment: {
        verified: true;
        payer: string;
        amount: string;
        network: string;
        transaction: string;
      };
    }>
  };

  const priceToMicroUnits = (price: string): string => {
    return String(Math.round(Number(price.replace(/[$]/g, '')) * 1_000_000));
  };

  const createGatewayMiddleware = vi.fn((config: GatewayMiddlewareConfig) => {
    state.configs.push(config);

    return {
      require: vi.fn((price: string) => {
        state.requiredPrices.push(price);

        return async (request: any, response: any, next: (error?: unknown) => void) => {
          const network = Array.isArray(config.networks) ? config.networks[0] : config.networks ?? 'eip155:5042002';

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
                  network,
                  amount: priceToMicroUnits(price),
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

          const payment = {
            verified: true as const,
            payer: '0xbuyer',
            amount: priceToMicroUnits(price),
            network,
            transaction: '0xsettlement'
          };

          request.payment = payment;
          state.paidRequests.push({ price, payment });

          response.setHeader(
            'PAYMENT-RESPONSE',
            Buffer.from(
              JSON.stringify({
                success: true,
                transaction: payment.transaction,
                network: payment.network,
                payer: payment.payer
              })
            ).toString('base64')
          );

          next();
        };
      }),
      verify: vi.fn(),
      settle: vi.fn()
    };
  });

  return {
    state,
    createGatewayMiddleware
  };
});

vi.mock('@circle-fin/x402-batching/server', () => ({
  createGatewayMiddleware: gatewayHarness.createGatewayMiddleware
}));

import { createApp } from '../src/app.js';
import { loadRuntimeEnv } from '../src/config/env.js';
import { PRICE_BY_OPERATION } from '../src/routes/extract.js';
import { FileCallLogStore } from '../src/store/call-log-store.js';
import { invokeApp } from '../src/support/invoke-app.js';

const body = {
  sourceType: 'news',
  title: 'Arc partners with Circle',
  text: 'Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.'
} as const;

const temporaryDirectories: string[] = [];

afterEach(() => {
  gatewayHarness.state.configs.length = 0;
  gatewayHarness.state.requiredPrices.length = 0;
  gatewayHarness.state.paidRequests.length = 0;

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const createTestApp = (overrides?: Partial<Record<string, string>>) => {
  const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-gateway-'));
  const callLogPath = join(workingDirectory, 'call-log.jsonl');
  temporaryDirectories.push(workingDirectory);

  const runtimeEnv = loadRuntimeEnv({
    ...process.env,
    NODE_ENV: 'test',
    PORT: '3000',
    PAYMENT_MODE: 'gateway',
    AI_MODE: 'mock',
    CALL_LOG_PATH: callLogPath,
    CIRCLE_SELLER_ADDRESS: '0xSeller',
    CIRCLE_GATEWAY_NETWORKS: 'eip155:5042002,eip155:84532',
    CIRCLE_GATEWAY_FACILITATOR_URL: 'https://gateway.example/facilitator',
    ...overrides
  });

  let requestCounter = 0;

  return {
    app: createApp({
      runtimeEnv,
      requestIdFactory: () => `req-${String(++requestCounter).padStart(3, '0')}`
    }),
    callLogStore: new FileCallLogStore(callLogPath)
  };
};

describe('gateway seller integration', () => {
  it('should return 402 from the gateway middleware before the handler runs', async () => {
    const { app, callLogStore } = createTestApp();

    const response = await invokeApp(app, {
      method: 'POST',
      path: '/api/extract/summary',
      body
    });

    expect(response.statusCode).toBe(402);
    expect(response.json).toEqual({});
    expect(response.headers['payment-required']).toBeDefined();
    expect(gatewayHarness.state.configs).toEqual([
      {
        sellerAddress: '0xSeller',
        networks: ['eip155:5042002', 'eip155:84532'],
        facilitatorUrl: 'https://gateway.example/facilitator'
      }
    ]);
    expect(gatewayHarness.state.requiredPrices).toEqual(['$0.004', '$0.003', '$0.005']);
    expect(await callLogStore.list()).toEqual([]);

    const paymentRequired = JSON.parse(Buffer.from(response.headers['payment-required'], 'base64').toString('utf8'));
    expect(paymentRequired).toMatchObject({
      x402Version: 2,
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:5042002',
          amount: '4000',
          payTo: '0xSeller'
        }
      ]
    });
  });

  it('should include gateway payment metadata in the response and call log after approval', async () => {
    const { app, callLogStore } = createTestApp();

    const response = await invokeApp(app, {
      method: 'POST',
      path: '/api/extract/entities',
      headers: {
        'payment-signature': 'demo-signed-payment'
      },
      body
    });
    const entries = await callLogStore.list();

    expect(response.statusCode).toBe(200);
    expect(response.headers['payment-response']).toBeDefined();
    expect(response.json).toMatchObject({
      requestId: 'req-001',
      pricedOperation: {
        operation: 'entities',
        price: PRICE_BY_OPERATION.entities
      },
      result: {
        kind: 'entities',
        entities: [
          { name: 'Arc', type: 'organization' },
          { name: 'Circle', type: 'organization' }
        ]
      },
      payment: {
        mode: 'gateway',
        status: 'paid',
        payer: '0xbuyer',
        amount: '3000',
        network: 'eip155:5042002',
        transaction: '0xsettlement'
      }
    });
    expect(entries).toEqual([
      expect.objectContaining({
        requestId: 'req-001',
        operation: 'entities',
        paymentMode: 'gateway',
        paymentStatus: 'paid',
        paymentPayer: '0xbuyer',
        paymentAmount: '3000',
        paymentNetwork: 'eip155:5042002',
        paymentTransaction: '0xsettlement'
      })
    ]);
    expect(gatewayHarness.state.paidRequests).toEqual([
      {
        price: '$0.003',
        payment: {
          verified: true,
          payer: '0xbuyer',
          amount: '3000',
          network: 'eip155:5042002',
          transaction: '0xsettlement'
        }
      }
    ]);
  });
});
