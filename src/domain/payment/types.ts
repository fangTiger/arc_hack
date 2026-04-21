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
        network: string;
        amount: string;
        payTo: string;
        asset?: string;
        maxTimeoutSeconds?: number;
        extra?: {
          name: 'GatewayWalletBatched';
          version: '1';
          verifyingContract?: string;
        };
      }>;
    };

export type MockPaymentAcceptedResult = {
  mode: 'mock';
  status: 'paid';
  proof: string;
};

export type GatewayPaymentAcceptedResult = {
  mode: 'gateway';
  status: 'paid';
  payer: string;
  amount: string;
  network: string;
  transaction: string;
};

export type GatewayAcceptedOption = Extract<PaymentRequiredResult, { mode: 'gateway' }>['accepts'][number];

export type PaymentAcceptedResult =
  | MockPaymentAcceptedResult
  | GatewayPaymentAcceptedResult;

export type GatewayPaymentMetadata = {
  verified: true;
  payer: string;
  amount: string;
  network: string;
  transaction: string;
};

export type GatewayPaymentRequest = {
  payment?: GatewayPaymentMetadata;
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

export type GatewayPaidExtractionPayload<Result = unknown> = {
  requestId: string;
  pricedOperation: PricedOperation;
  result: Result;
  payment: GatewayPaymentAcceptedResult;
};

export interface PaymentAdapter {
  authorize(input: PaymentAuthorizationInput): Promise<PaymentAuthorizationResult>;
}
