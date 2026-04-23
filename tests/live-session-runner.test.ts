import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadRuntimeEnv } from '../src/config/env.js';
import {
  runAgentGraphSession,
  type AgentGraphRunnerProgressEvent
} from '../src/demo/agent-session-runner.js';
import type { ExtractionRequest } from '../src/domain/extraction/types.js';
import type { GatewayBuyer } from '../src/domain/payment/gateway-buyer.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('runAgentGraphSession progress callback', () => {
  it('should report mock progress in summary -> entities -> relations order before returning the completed session', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-live-runner-'));
    temporaryDirectories.push(workingDirectory);
    const progressEvents: AgentGraphRunnerProgressEvent[] = [];
    const source: ExtractionRequest = {
      sourceType: 'news',
      title: 'Arc partners with Circle',
      text: 'Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.',
      metadata: {
        articleUrl: 'https://wublock123.com/p/654321',
        sourceSite: 'wublock123',
        importMode: 'link'
      }
    };

    const result = await runAgentGraphSession({
      artifactRootDirectory: join(workingDirectory, 'artifacts', 'agent-graph'),
      source,
      sessionIdFactory: () => 'session-live',
      runtimeEnv: loadRuntimeEnv({
        NODE_ENV: 'test',
        PORT: '4020',
        PAYMENT_MODE: 'mock',
        AI_MODE: 'mock',
        CALL_LOG_PATH: join(workingDirectory, 'call-log.jsonl')
      }),
      onProgress(event) {
        progressEvents.push(event);
      }
    });

    expect(result.sessionId).toBe('session-live');
    expect(result.session.source.metadata).toEqual(source.metadata);
    expect(progressEvents.map((event) => `${event.type}:${event.step}`)).toEqual([
      'step-started:summary',
      'step-completed:summary',
      'step-started:entities',
      'step-completed:entities',
      'step-started:relations',
      'step-completed:relations'
    ]);

    const summaryCompleted = progressEvents[1];
    const entitiesCompleted = progressEvents[3];
    const relationsCompleted = progressEvents[5];

    expect(summaryCompleted).toMatchObject({
      type: 'step-completed',
      step: 'summary',
      run: {
        requestId: 'agent-001',
        operation: 'summary',
        price: '$0.004'
      },
      snapshot: {
        summary: 'Arc partners with Circle. Arc introduced gasless nanopayments for AI agents.'
      }
    });
    expect(entitiesCompleted).toMatchObject({
      type: 'step-completed',
      step: 'entities',
      run: {
        requestId: 'agent-002',
        operation: 'entities',
        price: '$0.003'
      },
      snapshot: {
        entities: [
          { name: 'Arc', type: 'organization' },
          { name: 'Circle', type: 'organization' }
        ]
      }
    });
    expect(relationsCompleted).toMatchObject({
      type: 'step-completed',
      step: 'relations',
      run: {
        requestId: 'agent-003',
        operation: 'relations',
        price: '$0.005'
      },
      snapshot: {
        relations: [{ source: 'Arc', relation: 'mentions', target: 'Circle' }]
      }
    });
    expect(result.session.runs.map((run) => run.operation)).toEqual(['summary', 'entities', 'relations']);
  });

  it('should replay gateway progress in stage order after the batched payment response returns', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-live-gateway-runner-'));
    temporaryDirectories.push(workingDirectory);
    const progressEvents: AgentGraphRunnerProgressEvent[] = [];
    const source: ExtractionRequest = {
      sourceType: 'news',
      title: 'Arc partners with Circle',
      text: 'Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.'
    };
    const buyer: GatewayBuyer = {
      probe: vi.fn(),
      payBatch: vi.fn().mockResolvedValue({
        probes: [],
        balances: {
          before: {
            wallet: { balance: 20_000n, formatted: '0.020000' },
            gateway: {
              total: 20_000n,
              available: 20_000n,
              withdrawing: 0n,
              withdrawable: 0n,
              formattedTotal: '0.020000',
              formattedAvailable: '0.020000',
              formattedWithdrawing: '0.000000',
              formattedWithdrawable: '0.000000'
            }
          },
          after: {
            wallet: { balance: 8_000n, formatted: '0.008000' },
            gateway: {
              total: 8_000n,
              available: 8_000n,
              withdrawing: 0n,
              withdrawable: 0n,
              formattedTotal: '0.008000',
              formattedAvailable: '0.008000',
              formattedWithdrawing: '0.000000',
              formattedWithdrawable: '0.000000'
            }
          }
        },
        payments: [
          {
            requestId: 'gateway-001',
            operation: 'summary',
            pricedOperation: { operation: 'summary', price: '$0.004' },
            result: { kind: 'summary', summary: 'Arc partners with Circle.' },
            payment: {
              mode: 'gateway',
              status: 'paid',
              payer: '0xbuyer',
              amount: '4000',
              network: 'eip155:5042002',
              transaction: '0xsummary'
            },
            transaction: '0xsummary',
            amount: 4_000n,
            formattedAmount: '0.004000',
            status: 200
          },
          {
            requestId: 'gateway-002',
            operation: 'entities',
            pricedOperation: { operation: 'entities', price: '$0.003' },
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
              transaction: '0xentities'
            },
            transaction: '0xentities',
            amount: 3_000n,
            formattedAmount: '0.003000',
            status: 200
          },
          {
            requestId: 'gateway-003',
            operation: 'relations',
            pricedOperation: { operation: 'relations', price: '$0.005' },
            result: {
              kind: 'relations',
              relations: [{ source: 'Arc', relation: 'mentions', target: 'Circle' }]
            },
            payment: {
              mode: 'gateway',
              status: 'paid',
              payer: '0xbuyer',
              amount: '5000',
              network: 'eip155:5042002',
              transaction: '0xrelations'
            },
            transaction: '0xrelations',
            amount: 5_000n,
            formattedAmount: '0.005000',
            status: 200
          }
        ]
      })
    };

    const result = await runAgentGraphSession({
      artifactRootDirectory: join(workingDirectory, 'artifacts', 'agent-graph'),
      source,
      sessionIdFactory: () => 'session-gateway-live',
      createBuyer: () => buyer,
      runtimeEnv: loadRuntimeEnv({
        NODE_ENV: 'test',
        PORT: '4021',
        PAYMENT_MODE: 'gateway',
        AI_MODE: 'mock',
        CALL_LOG_PATH: join(workingDirectory, 'call-log.jsonl'),
        GATEWAY_BUYER_BASE_URL: 'http://127.0.0.1:3000',
        GATEWAY_BUYER_PRIVATE_KEY: '0xabc',
        GATEWAY_BUYER_CHAIN: 'arcTestnet'
      }),
      onProgress(event) {
        progressEvents.push(event);
      }
    });

    expect(progressEvents.map((event) => `${event.type}:${event.step}`)).toEqual([
      'step-started:summary',
      'step-completed:summary',
      'step-started:entities',
      'step-completed:entities',
      'step-started:relations',
      'step-completed:relations'
    ]);
    expect(progressEvents[1]).toMatchObject({
      type: 'step-completed',
      step: 'summary',
      run: {
        requestId: 'gateway-001',
        paymentTransaction: '0xsummary'
      },
      snapshot: {
        summary: 'Arc partners with Circle.'
      }
    });
    expect(result.session.runs.map((run) => run.operation)).toEqual(['summary', 'entities', 'relations']);
  });
});
