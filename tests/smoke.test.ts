import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { loadRuntimeEnv } from '../src/config/env.js';
import { invokeApp } from '../src/support/invoke-app.js';

describe('smoke', () => {
  it('should expose healthz route', async () => {
    const app = createApp({
      runtimeEnv: loadRuntimeEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        PAYMENT_MODE: 'mock',
        AI_MODE: 'mock',
        CALL_LOG_PATH: join(tmpdir(), 'arc-hack-smoke-call-log.jsonl')
      })
    });
    const response = await invokeApp(app, {
      method: 'GET',
      path: '/healthz'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json).toEqual({ status: 'ok' });
  });
});
