import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const importEnvModule = async () => {
  vi.resetModules();
  return import('../src/config/env.js');
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loadRuntimeEnv', () => {
  it('should allow importing env helpers when process env contains unrelated invalid values', async () => {
    vi.stubEnv('GATEWAY_BUYER_CHAIN', 'notARealChain');

    await expect(importEnvModule()).resolves.toMatchObject({
      loadRuntimeEnv: expect.any(Function)
    });
  });

  it('should parse AI mode and call log path from environment variables', async () => {
    const { loadRuntimeEnv } = await importEnvModule();
    const runtimeEnv = loadRuntimeEnv({
      NODE_ENV: 'test',
      PORT: '4300',
      PAYMENT_MODE: 'gateway',
      AI_MODE: 'real',
      CALL_LOG_PATH: join('/tmp', 'arc-hack', 'call-log.jsonl'),
      ARC_EXPLORER_BASE_URL: 'https://testnet.arcscan.app',
      LLM_BASE_URL: 'https://llm.example.com/v1',
      LLM_MODEL: 'gpt-test',
      LLM_API_KEY: 'secret'
    });

    expect(runtimeEnv).toMatchObject({
      nodeEnv: 'test',
      port: 4300,
      paymentMode: 'gateway',
      aiMode: 'real',
      receiptMode: 'off',
      callLogPath: join('/tmp', 'arc-hack', 'call-log.jsonl'),
      arcExplorerBaseUrl: 'https://testnet.arcscan.app',
      llmBaseUrl: 'https://llm.example.com/v1',
      llmModel: 'gpt-test',
      llmApiKey: 'secret'
    });
  });

  it('should parse gateway seller settings from environment variables', async () => {
    const { loadRuntimeEnv } = await importEnvModule();
    const runtimeEnv = loadRuntimeEnv({
      NODE_ENV: 'test',
      PORT: '4300',
      PAYMENT_MODE: 'gateway',
      AI_MODE: 'mock',
      RECEIPT_MODE: 'arc',
      CALL_LOG_PATH: join('/tmp', 'arc-hack', 'call-log.jsonl'),
      CIRCLE_SELLER_ADDRESS: '0xSeller',
      CIRCLE_GATEWAY_NETWORKS: 'eip155:5042002,eip155:84532',
      CIRCLE_GATEWAY_FACILITATOR_URL: 'https://gateway.example/facilitator'
    });

    expect(runtimeEnv).toMatchObject({
      receiptMode: 'arc',
      circleSellerAddress: '0xSeller',
      circleGatewayNetworks: ['eip155:5042002', 'eip155:84532'],
      circleGatewayFacilitatorUrl: 'https://gateway.example/facilitator'
    });
  });

  it('should parse gateway buyer settings from environment variables', async () => {
    const { loadRuntimeEnv } = await importEnvModule();
    const runtimeEnv = loadRuntimeEnv({
      NODE_ENV: 'test',
      PORT: '4300',
      PAYMENT_MODE: 'gateway',
      AI_MODE: 'mock',
      CALL_LOG_PATH: join('/tmp', 'arc-hack', 'call-log.jsonl'),
      GATEWAY_BUYER_BASE_URL: 'http://127.0.0.1:3000',
      GATEWAY_BUYER_PRIVATE_KEY: '0x1234',
      GATEWAY_BUYER_CHAIN: 'arcTestnet',
      GATEWAY_BUYER_RPC_URL: 'https://rpc.testnet.arc.network',
      GATEWAY_BUYER_AUTO_DEPOSIT_AMOUNT: '1.5'
    });

    expect(runtimeEnv).toMatchObject({
      gatewayBuyerBaseUrl: 'http://127.0.0.1:3000',
      gatewayBuyerPrivateKey: '0x1234',
      gatewayBuyerChain: 'arcTestnet',
      gatewayBuyerRpcUrl: 'https://rpc.testnet.arc.network',
      gatewayBuyerAutoDepositAmount: '1.5'
    });
  });
});
