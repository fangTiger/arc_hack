import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadRuntimeEnv } from '../src/config/env.js';

describe('loadRuntimeEnv', () => {
  it('should parse AI mode and call log path from environment variables', () => {
    const runtimeEnv = loadRuntimeEnv({
      NODE_ENV: 'test',
      PORT: '4300',
      PAYMENT_MODE: 'gateway',
      AI_MODE: 'real',
      CALL_LOG_PATH: join('/tmp', 'arc-hack', 'call-log.jsonl'),
      LLM_BASE_URL: 'https://llm.example.com/v1',
      LLM_MODEL: 'gpt-test',
      LLM_API_KEY: 'secret'
    });

    expect(runtimeEnv).toMatchObject({
      nodeEnv: 'test',
      port: 4300,
      paymentMode: 'gateway',
      aiMode: 'real',
      callLogPath: join('/tmp', 'arc-hack', 'call-log.jsonl'),
      llmBaseUrl: 'https://llm.example.com/v1',
      llmModel: 'gpt-test',
      llmApiKey: 'secret'
    });
  });
});
