import type {
  PaymentAdapter,
  PaymentAuthorizationInput,
  PaymentAuthorizationResult
} from './types.js';

export class MockPaymentAdapter implements PaymentAdapter {
  async authorize(input: PaymentAuthorizationInput): Promise<PaymentAuthorizationResult> {
    if (input.headers['x-payment-token'] === 'mock-paid') {
      return {
        approved: true,
        payment: {
          mode: 'mock',
          status: 'paid',
          proof: 'mock-paid'
        }
      };
    }

    return {
      approved: false,
      payment: {
        mode: 'mock',
        status: 'payment_required',
        message: 'Provide x-payment-token=mock-paid to simulate payment.'
      }
    };
  }
}
