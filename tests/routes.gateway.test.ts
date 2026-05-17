import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayHarness = vi.hoisted(() => {
  type FacilitatorConfig = {
    url?: string;
  };

  type PaymentRequirements = {
    amount: string;
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
              assets: [{ symbol: 'USDC', address: '0xUSDC' }]
            }
          },
          {
            x402Version: 2,
            scheme: 'exact',
            network: 'eip155:84532',
            extra: {
              verifyingContract: '0xgatewayverifier-base',
              assets: [{ symbol: 'USDC', address: '0xBaseUSDC' }]
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
        amount: paymentRequirements.amount,
        network: paymentRequirements.network,
        transaction: '0xsettlement'
      };
    }
  }

  return {
    state,
    BatchFacilitatorClient
  };
});

vi.mock('@circle-fin/x402-batching/server', () => ({
  BatchFacilitatorClient: gatewayHarness.BatchFacilitatorClient
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
  gatewayHarness.state.verifyRequirements.length = 0;
  gatewayHarness.state.settleRequirements.length = 0;

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

beforeEach(() => {
  gatewayHarness.state.configs.length = 0;
  gatewayHarness.state.verifyRequirements.length = 0;
  gatewayHarness.state.settleRequirements.length = 0;
});

const createTestApp = (overrides?: Partial<Record<string, string>>) => {
  const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-gateway-'));
  const callLogPath = join(workingDirectory, 'call-log.jsonl');
  temporaryDirectories.push(workingDirectory);

  const runtimeEnv = loadRuntimeEnv({
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
    expect(gatewayHarness.state.configs).toEqual([{ url: 'https://gateway.example/facilitator' }]);
    expect(await callLogStore.list()).toEqual([]);

    const paymentRequired = JSON.parse(Buffer.from(response.headers['payment-required'], 'base64').toString('utf8'));
    expect(paymentRequired).toMatchObject({
      x402Version: 2,
      accepts: expect.arrayContaining([
        expect.objectContaining({
          scheme: 'exact',
          network: 'eip155:5042002',
          amount: '4000',
          payTo: '0xSeller',
          maxTimeoutSeconds: 691200
        })
      ])
    });
  });

  it('should include gateway payment metadata in the response and call log after approval', async () => {
    const { app, callLogStore } = createTestApp();

    const response = await invokeApp(app, {
      method: 'POST',
      path: '/api/extract/entities',
      headers: {
        'payment-signature': Buffer.from(
          JSON.stringify({
            x402Version: 2,
            accepted: {
              network: 'eip155:5042002'
            },
            payload: {
              authorization: {},
              signature: '0xsig'
            }
          })
        ).toString('base64')
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
    expect(gatewayHarness.state.verifyRequirements[0]).toMatchObject({
      amount: '3000',
      network: 'eip155:5042002',
      maxTimeoutSeconds: 691200
    });
    expect(gatewayHarness.state.settleRequirements[0]).toMatchObject({
      amount: '3000',
      network: 'eip155:5042002',
      maxTimeoutSeconds: 691200
    });
  });
});
