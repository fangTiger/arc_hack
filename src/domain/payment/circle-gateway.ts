import { BatchFacilitatorClient, type GatewayMiddleware as CircleGatewayMiddleware } from '@circle-fin/x402-batching/server';

import type { GatewayPaymentMetadata } from './types.js';

export type CircleGatewayMiddlewareOptions = {
  sellerAddress: string;
  networks?: string[];
  facilitatorUrl?: string;
  description?: string;
};

type FacilitatorPaymentPayload = Parameters<BatchFacilitatorClient['verify']>[0];
type FacilitatorPaymentRequirements = Parameters<BatchFacilitatorClient['verify']>[1];
type SupportedResponse = Awaited<ReturnType<BatchFacilitatorClient['getSupported']>>;
type SupportedKind = SupportedResponse['kinds'][number];

type HeaderValue = string | string[] | undefined;

export type GatewayMiddleware = CircleGatewayMiddleware;

const CIRCLE_BATCHING_NAME = 'GatewayWalletBatched';
const CIRCLE_BATCHING_VERSION = '1';
const CIRCLE_BATCHING_SCHEME = 'exact';
const GATEWAY_PAYMENT_VALIDITY_SECONDS = 60 * 60 * 24 * 8;

const readHeaderValue = (headers: Record<string, HeaderValue>, name: string): string | undefined => {
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];

  return Array.isArray(value) ? value[0] : value;
};

const writeJson = (
  response: {
    statusCode?: number;
    setHeader: (name: string, value: string) => void;
    end: (body: string) => void;
  },
  statusCode: number,
  payload: unknown
): void => {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(payload));
};

const parsePrice = (price: string): string => {
  const amount = Number(price.replace(/[$]/g, ''));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid price: ${price}`);
  }

  return String(Math.round(amount * 1_000_000));
};

const getUsdcAddress = (kind: SupportedKind): string | null => {
  const assets = kind.extra?.assets;

  if (!Array.isArray(assets)) {
    return null;
  }

  const usdc = assets.find((asset): asset is { symbol: string; address: string } => {
    return (
      typeof asset === 'object' &&
      asset !== null &&
      (asset as { symbol?: unknown }).symbol === 'USDC' &&
      typeof (asset as { address?: unknown }).address === 'string'
    );
  });

  return usdc?.address ?? null;
};

const hasGatewayVerifyingContract = (kind: SupportedKind): kind is SupportedKind & {
  extra: Record<string, unknown> & {
    verifyingContract: string;
  };
} => typeof kind.extra?.verifyingContract === 'string';

export const createCircleGatewayMiddleware = (
  options: CircleGatewayMiddlewareOptions
): GatewayMiddleware => {
  const facilitator = new BatchFacilitatorClient({
    ...(options.facilitatorUrl ? { url: options.facilitatorUrl } : {})
  });
  const configuredNetworks = options.networks && options.networks.length > 0 ? new Set(options.networks) : null;
  let cachedSupportedKinds: SupportedKind[] | null = null;

  const getSupportedKinds = async (): Promise<SupportedKind[]> => {
    if (cachedSupportedKinds) {
      return cachedSupportedKinds;
    }

    const supported = await facilitator.getSupported();
    cachedSupportedKinds = supported.kinds;

    return cachedSupportedKinds;
  };

  const getAcceptedNetworks = async (): Promise<Array<SupportedKind & { extra: { verifyingContract: string } }>> => {
    const supportedKinds = await getSupportedKinds();
    const gatewayKinds = supportedKinds.filter(hasGatewayVerifyingContract);

    if (!configuredNetworks) {
      return gatewayKinds;
    }

    return gatewayKinds.filter((kind) => configuredNetworks.has(kind.network));
  };

  const buildPaymentRequirements = (price: string, kind: SupportedKind & { extra: { verifyingContract: string } }) => {
    const asset = getUsdcAddress(kind);

    if (!asset) {
      return null;
    }

    return {
      scheme: CIRCLE_BATCHING_SCHEME,
      network: kind.network,
      asset,
      amount: parsePrice(price),
      payTo: options.sellerAddress,
      maxTimeoutSeconds: GATEWAY_PAYMENT_VALIDITY_SECONDS,
      extra: {
        name: CIRCLE_BATCHING_NAME,
        version: CIRCLE_BATCHING_VERSION,
        verifyingContract: kind.extra.verifyingContract
      }
    } satisfies FacilitatorPaymentRequirements;
  };

  const createAllPaymentRequirements = async (price: string): Promise<FacilitatorPaymentRequirements[]> => {
    const networks = await getAcceptedNetworks();

    return networks.flatMap((kind) => {
      const requirements = buildPaymentRequirements(price, kind);

      return requirements ? [requirements] : [];
    });
  };

  const createPaymentRequirements = async (
    price: string,
    network: string
  ): Promise<FacilitatorPaymentRequirements | null> => {
    const networks = await getAcceptedNetworks();
    const kind = networks.find((candidate) => candidate.network === network);

    return kind ? buildPaymentRequirements(price, kind) : null;
  };

  return {
    require: (price) => {
      return async (request, response, next) => {
        try {
          const paymentHeader = readHeaderValue(
            request.headers as Record<string, HeaderValue>,
            'payment-signature'
          );

          if (!paymentHeader) {
            const accepts = await createAllPaymentRequirements(price);

            if (accepts.length === 0) {
              writeJson(response, 503, { error: 'No payment networks available' });
              return;
            }

            const paymentRequired = {
              x402Version: 2,
              resource: {
                url: request.url ?? '/',
                description: options.description ?? 'Paid resource',
                mimeType: 'application/json'
              },
              accepts
            };

            response.statusCode = 402;
            response.setHeader('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(paymentRequired)).toString('base64'));
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({}));
            return;
          }

          const paymentPayload = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8')) as FacilitatorPaymentPayload;
          const acceptedNetwork =
            typeof paymentPayload.accepted?.network === 'string' ? paymentPayload.accepted.network : undefined;

          if (!acceptedNetwork) {
            writeJson(response, 400, { error: 'Missing accepted requirements in payment' });
            return;
          }

          const requirements = await createPaymentRequirements(price, acceptedNetwork);

          if (!requirements) {
            writeJson(response, 400, { error: `Network ${acceptedNetwork} not accepted` });
            return;
          }

          const verifyResult = await facilitator.verify(paymentPayload, requirements);

          if (!verifyResult.isValid) {
            writeJson(response, 402, {
              error: 'Payment verification failed',
              reason: verifyResult.invalidReason
            });
            return;
          }

          const settleResult = await facilitator.settle(paymentPayload, requirements);

          if (!settleResult.success) {
            writeJson(response, 402, {
              error: 'Payment settlement failed',
              reason: settleResult.errorReason
            });
            return;
          }

          request.payment = {
            verified: true,
            payer: settleResult.payer ?? verifyResult.payer ?? '',
            amount: parsePrice(price),
            network: requirements.network,
            transaction: settleResult.transaction
          };
          response.setHeader(
            'PAYMENT-RESPONSE',
            Buffer.from(
              JSON.stringify({
                success: true,
                transaction: settleResult.transaction,
                network: requirements.network,
                payer: settleResult.payer ?? verifyResult.payer ?? ''
              })
            ).toString('base64')
          );

          next();
        } catch (error) {
          writeJson(response, 500, {
            error: 'Payment processing error',
            message: error instanceof Error ? error.message : 'Unknown payment processing error'
          });
        }
      };
    },
    verify: async (payment) => {
      try {
        const paymentPayload = payment as {
          paymentPayload: FacilitatorPaymentPayload;
          paymentRequirements: FacilitatorPaymentRequirements;
        };
        const result = await facilitator.verify(paymentPayload.paymentPayload, paymentPayload.paymentRequirements);

        return {
          valid: result.isValid,
          payer: result.payer,
          error: result.invalidReason
        };
      } catch (error) {
        return {
          valid: false,
          error: error instanceof Error ? error.message : 'Unknown payment verification error'
        };
      }
    },
    settle: async (payment) => {
      try {
        const paymentPayload = payment as {
          paymentPayload: FacilitatorPaymentPayload;
          paymentRequirements: FacilitatorPaymentRequirements;
        };
        const result = await facilitator.settle(paymentPayload.paymentPayload, paymentPayload.paymentRequirements);

        return {
          success: result.success,
          transaction: result.transaction,
          error: result.errorReason
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown payment settlement error'
        };
      }
    }
  };
};

export const readGatewayPayment = (
  request: {
    payment?: GatewayPaymentMetadata;
  }
): GatewayPaymentMetadata | undefined => {
  return request.payment;
};
