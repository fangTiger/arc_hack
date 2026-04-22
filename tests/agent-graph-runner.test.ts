import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runAgentGraphSession } from '../scripts/agent-graph-runner.js';
import { loadRuntimeEnv } from '../src/config/env.js';
import { demoCorpus } from '../src/demo/corpus.js';
import { createReceiptWriter } from '../src/domain/receipt/writer.js';
import type { GatewayBuyer } from '../src/domain/payment/gateway-buyer.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const createMockBuyer = (): GatewayBuyer => ({
  probe: vi.fn(),
  payBatch: vi.fn()
});

describe('runAgentGraphSession', () => {
  it('should run a mock agent session, persist session artifacts and expose a graph url', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-agent-graph-runner-'));
    temporaryDirectories.push(workingDirectory);
    const artifactRootDirectory = join(workingDirectory, 'artifacts', 'agent-graph');

    const result = await runAgentGraphSession({
      artifactRootDirectory,
      source: demoCorpus[0],
      sessionIdFactory: () => 'session-mock',
      receiptWriter: createReceiptWriter({ mode: 'mock' }),
      runtimeEnv: loadRuntimeEnv({
        NODE_ENV: 'test',
        PORT: '4010',
        PAYMENT_MODE: 'mock',
        AI_MODE: 'mock',
        CALL_LOG_PATH: join(workingDirectory, 'call-log.jsonl')
      })
    });

    const persisted = JSON.parse(readFileSync(result.artifactPath, 'utf8'));

    expect(result.sessionId).toBe('session-mock');
    expect(result.artifactPath).toBe(join(artifactRootDirectory, 'session-mock', 'session.json'));
    expect(result.graphUrl).toBe('http://127.0.0.1:4010/demo/graph/session-mock');
    expect(result.session).toMatchObject({
      sessionId: 'session-mock',
      source: demoCorpus[0],
      summary: 'Arc partners with Circle. Arc introduced gasless nanopayments for AI agents.',
      entities: [
        { name: 'Arc', type: 'organization' },
        { name: 'Circle', type: 'organization' }
      ],
      relations: [{ source: 'Arc', relation: 'mentions', target: 'Circle' }],
      totals: {
        totalPrice: '$0.012',
        successfulRuns: 3
      }
    });
    expect(result.session.runs).toHaveLength(3);
    expect(result.session.runs.map((run) => run.operation)).toEqual(['summary', 'entities', 'relations']);
    expect(result.session.runs.every((run) => Boolean(run.receiptTxHash))).toBe(true);
    expect(result.session.graph.nodes).toHaveLength(2);
    expect(result.session.graph.edges).toEqual([
      {
        id: 'Arc:mentions:Circle',
        source: 'Arc',
        target: 'Circle',
        label: 'mentions'
      }
    ]);
    expect(persisted).toMatchObject({
      sessionId: 'session-mock',
      totals: {
        totalPrice: '$0.012',
        successfulRuns: 3
      }
    });
  });

  it('should run a gateway agent session and map buyer payment evidence into runs', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-agent-graph-gateway-'));
    temporaryDirectories.push(workingDirectory);
    const artifactRootDirectory = join(workingDirectory, 'artifacts', 'agent-graph');
    const buyer = createMockBuyer();

    buyer.payBatch = vi.fn().mockResolvedValue({
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
    });

    const result = await runAgentGraphSession({
      artifactRootDirectory,
      source: demoCorpus[0],
      sessionIdFactory: () => 'session-gateway',
      createBuyer: () => buyer,
      runtimeEnv: {
        nodeEnv: 'test',
        port: 3000,
        paymentMode: 'gateway',
        aiMode: 'mock',
        receiptMode: 'off',
        callLogPath: join(workingDirectory, 'call-log.jsonl'),
        gatewayBuyerBaseUrl: 'http://127.0.0.1:3000',
        gatewayBuyerPrivateKey: '0x1234',
        gatewayBuyerChain: 'arcTestnet'
      }
    });

    expect(result.graphUrl).toBe('http://127.0.0.1:3000/demo/graph/session-gateway');
    expect(result.session.totals).toEqual({
      totalPrice: '$0.012',
      successfulRuns: 3
    });
    expect(result.session.runs).toEqual([
      expect.objectContaining({
        requestId: 'gateway-001',
        operation: 'summary',
        paymentTransaction: '0xsummary',
        paymentAmount: '4000',
        paymentNetwork: 'eip155:5042002',
        paymentPayer: '0xbuyer'
      }),
      expect.objectContaining({
        requestId: 'gateway-002',
        operation: 'entities',
        paymentTransaction: '0xentities',
        paymentAmount: '3000',
        paymentNetwork: 'eip155:5042002',
        paymentPayer: '0xbuyer'
      }),
      expect.objectContaining({
        requestId: 'gateway-003',
        operation: 'relations',
        paymentTransaction: '0xrelations',
        paymentAmount: '5000',
        paymentNetwork: 'eip155:5042002',
        paymentPayer: '0xbuyer'
      })
    ]);
    expect(result.session.summary).toBe('Arc partners with Circle.');
    expect(result.session.entities).toEqual([
      { name: 'Arc', type: 'organization' },
      { name: 'Circle', type: 'organization' }
    ]);
    expect(result.session.relations).toEqual([{ source: 'Arc', relation: 'mentions', target: 'Circle' }]);
  });
});
