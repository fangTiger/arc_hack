import type { ExtractionOperation } from '../extraction/types.js';

export type Price = `$${number}`;

export type PricedOperation = {
  operation: ExtractionOperation;
  price: Price;
};

export type PaymentRequiredResult =
  | {
      mode: 'mock';
      status: 'payment_required';
      message: string;
    }
  | {
      mode: 'gateway';
      status: 'payment_required';
      x402Version: 2;
      accepts: Array<{
        scheme: 'exact';
        network: 'eip155:5042002';
        amount: string;
        payTo: string;
      }>;
    };

export type PaymentAcceptedResult = {
  mode: 'mock' | 'gateway';
  status: 'paid';
  proof: string;
};

export type PaymentAuthorizationResult =
  | {
      approved: true;
      payment: PaymentAcceptedResult;
    }
  | {
      approved: false;
      payment: PaymentRequiredResult;
    };

export type PaymentAuthorizationInput = {
  headers: Record<string, string | undefined>;
  pricedOperation: PricedOperation;
};

export interface PaymentAdapter {
  authorize(input: PaymentAuthorizationInput): Promise<PaymentAuthorizationResult>;
}
