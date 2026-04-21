import { describe, expect, it } from 'vitest';

import { MockKnowledgeExtractionProvider } from '../src/domain/extraction/mock-provider.js';
import { GatewayPaymentAdapter } from '../src/domain/payment/circle-gateway.js';
import { MockPaymentAdapter } from '../src/domain/payment/mock-payment.js';
import { createExtractRouter, PRICE_BY_OPERATION } from '../src/routes/extract.js';

type MockRequest = {
  body: Record<string, unknown>;
  headers: Record<string, string | undefined>;
};

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

const createMockResponse = (): MockResponse => ({
  statusCode: 200,
  body: undefined,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(payload: unknown) {
    this.body = payload;
    return this;
  }
});

const getRouteHandler = (path: string, paymentAdapter: MockPaymentAdapter | GatewayPaymentAdapter) => {
  const router = createExtractRouter({
    extractionProvider: new MockKnowledgeExtractionProvider(),
    paymentAdapter,
    requestIdFactory: () => `req-${path.replaceAll('/', '-')}`
  });

  const stack = Reflect.get(router, 'stack') as Array<{
    route?: { path?: string; stack?: Array<{ handle?: (...args: any[]) => unknown }> };
  }>;
  const layer = stack.find((entry) => entry.route?.path === path);

  return layer?.route?.stack?.[0]?.handle;
};

const invokeRoute = async (path: string, paymentAdapter: MockPaymentAdapter | GatewayPaymentAdapter, request: MockRequest) => {
  const handler = getRouteHandler(path, paymentAdapter);
  const response = createMockResponse();

  expect(typeof handler).toBe('function');

  await handler?.(request as any, response as any, () => undefined);

  return response;
};

const body = {
  sourceType: 'news',
  title: 'Arc partners with Circle',
  text: 'Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.'
};

describe('createExtractRouter', () => {
  it('should return 402 for unpaid mock payment requests', async () => {
    const response = await invokeRoute('/summary', new MockPaymentAdapter(), {
      body,
      headers: {}
    });

    expect(response.statusCode).toBe(402);
    expect(response.body).toEqual({
      requestId: 'req--summary',
      pricedOperation: {
        operation: 'summary',
        price: PRICE_BY_OPERATION.summary
      },
      payment: {
        mode: 'mock',
        status: 'payment_required',
        message: 'Provide x-payment-token=mock-paid to simulate payment.'
      }
    });
  });

  it('should return structured extraction results after mock payment succeeds', async () => {
    const response = await invokeRoute('/entities', new MockPaymentAdapter(), {
      body,
      headers: {
        'x-payment-token': 'mock-paid'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      requestId: 'req--entities',
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
        mode: 'mock',
        status: 'paid',
        proof: 'mock-paid'
      }
    });
  });

  it('should expose gateway style payment requirements for unpaid requests', async () => {
    const response = await invokeRoute('/relations', new GatewayPaymentAdapter({ sellerAddress: '0xSELLER' }), {
      body,
      headers: {}
    });

    expect(response.statusCode).toBe(402);
    expect(response.body).toEqual({
      requestId: 'req--relations',
      pricedOperation: {
        operation: 'relations',
        price: PRICE_BY_OPERATION.relations
      },
      payment: {
        mode: 'gateway',
        status: 'payment_required',
        x402Version: 2,
        accepts: [
          {
            scheme: 'exact',
            network: 'eip155:5042002',
            amount: '5000',
            payTo: '0xSELLER'
          }
        ]
      }
    });
  });
});
