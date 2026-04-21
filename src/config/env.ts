type PaymentMode = 'mock' | 'gateway';

const parsePort = (value: string | undefined): number => {
  if (!value) {
    return 3000;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return parsed;
};

const parsePaymentMode = (value: string | undefined): PaymentMode => {
  if (!value) {
    return 'mock';
  }

  if (value === 'mock' || value === 'gateway') {
    return value;
  }

  throw new Error(`Invalid PAYMENT_MODE value: ${value}`);
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parsePort(process.env.PORT),
  paymentMode: parsePaymentMode(process.env.PAYMENT_MODE),
  circleSellerAddress: process.env.CIRCLE_SELLER_ADDRESS,
  arcRpcUrl: process.env.ARC_RPC_URL,
  arcPrivateKey: process.env.ARC_PRIVATE_KEY,
  usageReceiptAddress: process.env.USAGE_RECEIPT_ADDRESS
};
