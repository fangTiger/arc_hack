import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

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
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const createTestApp = (overrides?: Partial<Record<string, string>>) => {
  const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-routes-'));
  const callLogPath = join(workingDirectory, 'call-log.jsonl');
  temporaryDirectories.push(workingDirectory);

  const runtimeEnv = loadRuntimeEnv({
    ...process.env,
    NODE_ENV: 'test',
    PORT: '3000',
    PAYMENT_MODE: 'mock',
    AI_MODE: 'mock',
    CALL_LOG_PATH: callLogPath,
    CIRCLE_SELLER_ADDRESS: '0xSELLER',
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

describe('createExtractRouter', () => {
  it('should return 402 for unpaid mock payment requests', async () => {
    const { app } = createTestApp();

    const response = await invokeApp(app, {
      method: 'POST',
      path: '/api/extract/summary',
      body
    });

    expect(response.statusCode).toBe(402);
    expect(response.json).toEqual({
      requestId: 'req-001',
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

  it('should return structured extraction results and persist a call log after payment succeeds', async () => {
    const { app, callLogStore } = createTestApp();

    const response = await invokeApp(app, {
      method: 'POST',
      path: '/api/extract/entities',
      headers: {
        'x-payment-token': 'mock-paid'
      },
      body
    });
    const statsResponse = await invokeApp(app, {
      method: 'GET',
      path: '/ops/stats'
    });
    const entries = await callLogStore.list();

    expect(response.statusCode).toBe(200);
    expect(response.json).toEqual({
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
        mode: 'mock',
        status: 'paid',
        proof: 'mock-paid'
      }
    });
    expect(entries).toEqual([
      {
        requestId: 'req-001',
        operation: 'entities',
        price: PRICE_BY_OPERATION.entities,
        paymentMode: 'mock',
        paymentStatus: 'paid',
        resultKind: 'entities',
        createdAt: expect.any(String)
      }
    ]);
    expect(statsResponse.statusCode).toBe(200);
    expect(statsResponse.json).toEqual({
      totalCalls: 1,
      successfulCalls: 1,
      totalRevenue: '$0.003',
      byOperation: {
        summary: 0,
        entities: 1,
        relations: 0
      }
    });
  });
});
