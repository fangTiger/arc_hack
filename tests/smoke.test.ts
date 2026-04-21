import { describe, expect, it } from 'vitest';

import { app } from '../src/app.js';
import { invokeApp } from '../src/support/invoke-app.js';

describe('smoke', () => {
  it('should expose healthz route', async () => {
    const response = await invokeApp(app, {
      method: 'GET',
      path: '/healthz'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json).toEqual({ status: 'ok' });
  });
});
