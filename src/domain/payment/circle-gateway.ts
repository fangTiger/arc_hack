import type {
  PaymentAdapter,
  PaymentAuthorizationInput,
  PaymentAuthorizationResult,
  Price
} from './types.js';

type GatewayPaymentAdapterOptions = {
  sellerAddress: string;
};

const priceToMicroUnits = (price: Price): string => {
  return Math.round(Number(price.slice(1)) * 1_000_000).toString();
};

export class GatewayPaymentAdapter implements PaymentAdapter {
  private readonly sellerAddress: string;

  constructor(options: GatewayPaymentAdapterOptions) {
    this.sellerAddress = options.sellerAddress;
  }

  async authorize(input: PaymentAuthorizationInput): Promise<PaymentAuthorizationResult> {
    const signature = input.headers['payment-signature'];

    if (signature) {
      return {
        approved: true,
        payment: {
          mode: 'gateway',
          status: 'paid',
          proof: signature
        }
      };
    }

    return {
      approved: false,
      payment: {
        mode: 'gateway',
        status: 'payment_required',
        x402Version: 2,
        accepts: [
          {
            scheme: 'exact',
            network: 'eip155:5042002',
            amount: priceToMicroUnits(input.pricedOperation.price),
            payTo: this.sellerAddress
          }
        ]
      }
    };
  }
}
