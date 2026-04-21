import { mkdir, readFile, appendFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { ExtractionOperation, ExtractionResult } from '../domain/extraction/types.js';
import type { PaymentAcceptedResult, Price } from '../domain/payment/types.js';

export type CallLogEntry = {
  requestId: string;
  operation: ExtractionOperation;
  price: Price;
  paymentMode: PaymentAcceptedResult['mode'];
  paymentStatus: PaymentAcceptedResult['status'];
  resultKind: ExtractionResult['kind'];
  createdAt: string;
  receiptTxHash?: `0x${string}`;
};

export type CallLogStats = {
  totalCalls: number;
  successfulCalls: number;
  totalRevenue: Price;
  byOperation: Record<ExtractionOperation, number>;
};

const parsePrice = (price: Price): number => Number(price.slice(1));

const formatPrice = (value: number): Price => `$${value.toFixed(3)}` as Price;

const emptyStats = (): CallLogStats => ({
  totalCalls: 0,
  successfulCalls: 0,
  totalRevenue: '$0.000',
  byOperation: {
    summary: 0,
    entities: 0,
    relations: 0
  }
});

export class FileCallLogStore {
  constructor(private readonly logFilePath: string) {}

  async append(entry: CallLogEntry): Promise<void> {
    await mkdir(dirname(this.logFilePath), { recursive: true });
    await appendFile(this.logFilePath, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  async list(): Promise<CallLogEntry[]> {
    try {
      const content = await readFile(this.logFilePath, 'utf8');

      return content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as CallLogEntry);
    } catch (error) {
      const systemError = error as NodeJS.ErrnoException;

      if (systemError.code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  async getStats(): Promise<CallLogStats> {
    const entries = await this.list();

    if (entries.length === 0) {
      return emptyStats();
    }

    const totalRevenue = entries.reduce((sum, entry) => sum + parsePrice(entry.price), 0);
    const stats = entries.reduce<CallLogStats>(
      (accumulator, entry) => {
        accumulator.totalCalls += 1;
        accumulator.successfulCalls += entry.paymentStatus === 'paid' ? 1 : 0;
        accumulator.byOperation[entry.operation] += 1;
        return accumulator;
      },
      emptyStats()
    );

    stats.totalRevenue = formatPrice(totalRevenue);
    return stats;
  }

  async writeSummary(summaryPath: string, payload: unknown): Promise<void> {
    await mkdir(dirname(summaryPath), { recursive: true });
    await writeFile(summaryPath, JSON.stringify(payload, null, 2), 'utf8');
  }
}
