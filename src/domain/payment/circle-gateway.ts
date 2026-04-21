import { createGatewayMiddleware as createOfficialGatewayMiddleware } from '@circle-fin/x402-batching/server';

import type { GatewayPaymentMetadata } from './types.js';

export type CircleGatewayMiddlewareOptions = {
  sellerAddress: string;
  networks?: string[];
  facilitatorUrl?: string;
};

export type GatewayMiddleware = ReturnType<typeof createOfficialGatewayMiddleware>;

export const createCircleGatewayMiddleware = (
  options: CircleGatewayMiddlewareOptions
): GatewayMiddleware => {
  return createOfficialGatewayMiddleware({
    sellerAddress: options.sellerAddress,
    ...(options.networks && options.networks.length > 0 ? { networks: options.networks } : {}),
    ...(options.facilitatorUrl ? { facilitatorUrl: options.facilitatorUrl } : {})
  });
};

export const readGatewayPayment = (
  request: {
    payment?: GatewayPaymentMetadata;
  }
): GatewayPaymentMetadata | undefined => {
  return request.payment;
};
