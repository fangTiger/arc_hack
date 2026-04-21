import { describe, expect, it } from 'vitest';

import { app } from '../src/app.js';

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

const createMockResponse = (): MockResponse => {
  return {
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
  };
};

const getHealthHandler = () => {
  const router = Reflect.get(app, 'router');
  const layer = router?.stack?.find((entry: { route?: { path?: string } }) => entry.route?.path === '/healthz');

  return layer?.route?.stack?.[0]?.handle;
};

describe('smoke', () => {
  it('should expose healthz route', () => {
    const handler = getHealthHandler();
    const response = createMockResponse();

    expect(typeof handler).toBe('function');

    handler?.({} as any, response as any, () => undefined);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
