import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runGatewayBuyerDemo } from '../scripts/gateway-buyer-runner.js';
import { demoCorpus } from '../src/demo/corpus.js';
import { createReceiptWriter } from '../src/domain/receipt/writer.js';
import type { GatewayBuyer } from '../src/domain/payment/gateway-buyer.js';

const createMockBuyer = (): GatewayBuyer => ({
  probe: vi.fn(),
  payBatch: vi.fn()
});

describe('runGatewayBuyerDemo', () => {
  it('should execute batch payments, write summary artifacts and attach receipt hashes', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-gateway-buyer-'));
    const artifactDirectory = join(workingDirectory, 'artifacts');
    const buyer = createMockBuyer();

    buyer.payBatch = vi.fn().mockResolvedValue({
      probes: [
        {
          requestId: 'gateway-001',
          operation: 'summary',
          accepted: {
            scheme: 'exact',
            network: 'eip155:5042002',
            asset: 'USDC',
            amount: '4000',
            payTo: '0xSeller',
            maxTimeoutSeconds: 345600,
            extra: {
              name: 'GatewayWalletBatched',
              version: '1',
              verifyingContract: '0xgatewayverifier'
            }
          }
        },
        {
          requestId: 'gateway-002',
          operation: 'summary',
          accepted: {
            scheme: 'exact',
            network: 'eip155:5042002',
            asset: 'USDC',
            amount: '4000',
            payTo: '0xSeller',
            maxTimeoutSeconds: 345600,
            extra: {
              name: 'GatewayWalletBatched',
              version: '1',
              verifyingContract: '0xgatewayverifier'
            }
          }
        }
      ],
      balances: {
        before: {
          wallet: { balance: 20_000n, formatted: '0.020000' },
          gateway: {
            total: 12_000n,
            available: 12_000n,
            withdrawing: 0n,
            withdrawable: 0n,
            formattedTotal: '0.012000',
            formattedAvailable: '0.012000',
            formattedWithdrawing: '0.000000',
            formattedWithdrawable: '0.000000'
          }
        },
        after: {
          wallet: { balance: 20_000n, formatted: '0.020000' },
          gateway: {
            total: 4_000n,
            available: 4_000n,
            withdrawing: 0n,
            withdrawable: 0n,
            formattedTotal: '0.004000',
            formattedAvailable: '0.004000',
            formattedWithdrawing: '0.000000',
            formattedWithdrawable: '0.000000'
          }
        }
      },
      payments: [
        {
          requestId: 'gateway-001',
          operation: 'summary',
          pricedOperation: {
            operation: 'summary',
            price: '$0.004'
          },
          result: {
            kind: 'summary',
            summary: 'Arc and Circle'
          },
          payment: {
            mode: 'gateway',
            status: 'paid',
            payer: '0xbuyer',
            amount: '4000',
            network: 'eip155:5042002',
            transaction: '0xsettlement-1'
          },
          transaction: '0xsettlement-1',
          amount: 4_000n,
          formattedAmount: '0.004000',
          status: 200
        },
        {
          requestId: 'gateway-002',
          operation: 'summary',
          pricedOperation: {
            operation: 'summary',
            price: '$0.004'
          },
          result: {
            kind: 'summary',
            summary: 'Arc and Circle'
          },
          payment: {
            mode: 'gateway',
            status: 'paid',
            payer: '0xbuyer',
            amount: '4000',
            network: 'eip155:5042002',
            transaction: '0xsettlement-2'
          },
          transaction: '0xsettlement-2',
          amount: 4_000n,
          formattedAmount: '0.004000',
          status: 200
        }
      ]
    });

    try {
      const summary = await runGatewayBuyerDemo({
        artifactDirectory,
        corpus: demoCorpus.slice(0, 1),
        operations: ['summary'],
        repeatCount: 2,
        receiptWriter: createReceiptWriter({ mode: 'mock' }),
        createBuyer: () => buyer,
        runtimeEnv: {
          nodeEnv: 'test',
          port: 3000,
          paymentMode: 'gateway',
          aiMode: 'mock',
          callLogPath: join(artifactDirectory, 'call-log.jsonl'),
          gatewayBuyerBaseUrl: 'http://127.0.0.1:3000',
          gatewayBuyerPrivateKey: '0x1234',
          gatewayBuyerChain: 'arcTestnet'
        }
      });

      expect(summary.totalRuns).toBe(2);
      expect(summary.successCount).toBe(2);
      expect(summary.requestIds).toEqual(['gateway-001', 'gateway-002']);
      expect(summary.paymentTransactions).toEqual(['0xsettlement-1', '0xsettlement-2']);
      expect(summary.receiptTxHashes).toHaveLength(2);
      expect(summary.runs[0]?.receiptTxHash).toBe(summary.receiptTxHashes?.[0]);
      expect(summary.runs[1]?.receiptTxHash).toBe(summary.receiptTxHashes?.[1]);
      expect(summary.runs).toEqual([
        {
          requestId: 'gateway-001',
          operation: 'summary',
          price: '$0.004',
          resultKind: 'summary',
          paymentTransaction: '0xsettlement-1',
          paymentAmount: '4000',
          paymentNetwork: 'eip155:5042002',
          paymentPayer: '0xbuyer',
          payloadHash: `0x${createHash('sha256').update(JSON.stringify({ kind: 'summary', summary: 'Arc and Circle' })).digest('hex')}`,
          receiptTxHash: summary.receiptTxHashes?.[0]
        },
        {
          requestId: 'gateway-002',
          operation: 'summary',
          price: '$0.004',
          resultKind: 'summary',
          paymentTransaction: '0xsettlement-2',
          paymentAmount: '4000',
          paymentNetwork: 'eip155:5042002',
          paymentPayer: '0xbuyer',
          payloadHash: `0x${createHash('sha256').update(JSON.stringify({ kind: 'summary', summary: 'Arc and Circle' })).digest('hex')}`,
          receiptTxHash: summary.receiptTxHashes?.[1]
        }
      ]);
      expect(summary.balances.before.gateway.available).toBe('0.012000');
      expect(summary.balances.after.gateway.available).toBe('0.004000');
      expect(summary.stats.totalCalls).toBe(2);
    } finally {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it('should reject when gateway buyer env is incomplete', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-gateway-buyer-missing-'));

    try {
      await expect(
        runGatewayBuyerDemo({
          artifactDirectory: join(workingDirectory, 'artifacts'),
          corpus: demoCorpus.slice(0, 1),
          operations: ['summary'],
          repeatCount: 1,
          runtimeEnv: {
            nodeEnv: 'test',
            port: 3000,
            paymentMode: 'gateway',
            aiMode: 'mock',
            callLogPath: join(workingDirectory, 'artifacts', 'call-log.jsonl')
          }
        })
      ).rejects.toThrow('GATEWAY_BUYER_BASE_URL, GATEWAY_BUYER_PRIVATE_KEY and GATEWAY_BUYER_CHAIN are required');
    } finally {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });
});
