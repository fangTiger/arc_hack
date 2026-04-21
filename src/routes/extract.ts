import { randomUUID } from 'node:crypto';
import { Router } from 'express';

import type { KnowledgeExtractionProvider } from '../domain/extraction/provider.js';
import type { ExtractionOperation, ExtractionRequest, ExtractionResult } from '../domain/extraction/types.js';
import type { GatewayMiddleware } from '../domain/payment/circle-gateway.js';
import type {
  GatewayPaymentMetadata,
  PaymentAdapter,
  PaymentAcceptedResult,
  Price,
  PricedOperation
} from '../domain/payment/types.js';
import type { CallLogEntry, FileCallLogStore } from '../store/call-log-store.js';

type CreateExtractRouterOptions = {
  extractionProvider: KnowledgeExtractionProvider;
  paymentAdapter?: PaymentAdapter;
  gatewayMiddleware?: GatewayMiddleware;
  callLogStore: FileCallLogStore;
  requestIdFactory?: () => string;
};

export const PRICE_BY_OPERATION: Record<ExtractionOperation, Price> = {
  summary: '$0.004',
  entities: '$0.003',
  relations: '$0.005'
};

const isSourceType = (value: unknown): value is ExtractionRequest['sourceType'] => {
  return value === 'news' || value === 'research';
};

const parseRequest = (body: Record<string, unknown>): ExtractionRequest | null => {
  if (!isSourceType(body.sourceType) || typeof body.text !== 'string' || body.text.trim().length === 0) {
    return null;
  }

  return {
    sourceType: body.sourceType,
    title: typeof body.title === 'string' ? body.title : undefined,
    text: body.text
  };
};

const buildPricedOperation = (operation: ExtractionOperation): PricedOperation => ({
  operation,
  price: PRICE_BY_OPERATION[operation]
});

const buildMockPaymentResponse = (payment: PaymentAcceptedResult) => payment;

const buildGatewayPaymentResponse = (payment: GatewayPaymentMetadata) => ({
  mode: 'gateway' as const,
  status: 'paid' as const,
  payer: payment.payer,
  amount: payment.amount,
  network: payment.network,
  transaction: payment.transaction
});

const buildCallLogEntry = (
  requestId: string,
  operation: ExtractionOperation,
  pricedOperation: PricedOperation,
  payment: PaymentAcceptedResult,
  resultKind: ExtractionResult['kind']
) : CallLogEntry => {
  const baseEntry: CallLogEntry = {
    requestId,
    operation,
    price: pricedOperation.price,
    paymentMode: payment.mode,
    paymentStatus: payment.status,
    resultKind,
    createdAt: new Date().toISOString()
  };

  if (payment.mode === 'gateway') {
    return {
      ...baseEntry,
      paymentAmount: payment.amount,
      paymentNetwork: payment.network,
      paymentPayer: payment.payer,
      paymentTransaction: payment.transaction
    };
  }

  return baseEntry;
};

const buildPaidResponse = (
  requestId: string,
  pricedOperation: PricedOperation,
  result: unknown,
  payment: PaymentAcceptedResult
) => ({
  requestId,
  pricedOperation,
  result,
  payment
});

export const createExtractRouter = (options: CreateExtractRouterOptions) => {
  const router = Router();
  const requestIdFactory = options.requestIdFactory ?? randomUUID;

  const register = (path: `/${ExtractionOperation}`, operation: ExtractionOperation) => {
    const handler = async (request: { body: unknown; headers: Record<string, string | undefined> }, response: any) => {
      const extractionRequest = parseRequest(request.body as Record<string, unknown>);

      if (!extractionRequest) {
        response.status(400).json({ error: 'Invalid extraction request.' });
        return;
      }

      const requestIdHeader = request.headers['x-request-id'];
      const requestId =
        typeof requestIdHeader === 'string' && requestIdHeader.trim().length > 0 ? requestIdHeader : requestIdFactory();
      const pricedOperation = buildPricedOperation(operation);
      const result = await options.extractionProvider.extract(operation, extractionRequest);

      return {
        requestId,
        pricedOperation,
        result
      };
    };

    if (options.gatewayMiddleware) {
      router.post(path, options.gatewayMiddleware.require(PRICE_BY_OPERATION[operation]), async (request, response) => {
        const context = await handler(
          request as {
            body: unknown;
            headers: Record<string, string | undefined>;
          },
          response
        );

        if (!context) {
          return;
        }

        const gatewayPayment = (request as { payment?: GatewayPaymentMetadata }).payment;

        if (!gatewayPayment) {
          response.status(500).json({ error: 'Gateway payment metadata missing.' });
          return;
        }

        const payment = buildGatewayPaymentResponse(gatewayPayment);

        await options.callLogStore.append(buildCallLogEntry(context.requestId, operation, context.pricedOperation, payment, context.result.kind));

        response.status(200).json(buildPaidResponse(context.requestId, context.pricedOperation, context.result, payment));
      });
      return;
    }

    router.post(path, async (request, response) => {
      const extractionRequest = parseRequest(request.body as Record<string, unknown>);

      if (!extractionRequest) {
        response.status(400).json({ error: 'Invalid extraction request.' });
        return;
      }

      const requestIdHeader = request.headers['x-request-id'];
      const requestId =
        typeof requestIdHeader === 'string' && requestIdHeader.trim().length > 0 ? requestIdHeader : requestIdFactory();
      const pricedOperation = buildPricedOperation(operation);

      if (!options.paymentAdapter) {
        response.status(500).json({ error: 'Payment adapter is not configured.' });
        return;
      }

      const paymentResult = await options.paymentAdapter.authorize({
        headers: request.headers as Record<string, string | undefined>,
        pricedOperation
      });

      if (!paymentResult.approved) {
        response.status(402).json({
          requestId,
          pricedOperation,
          payment: paymentResult.payment
        });
        return;
      }

      const result = await options.extractionProvider.extract(operation, extractionRequest);

      await options.callLogStore.append(buildCallLogEntry(requestId, operation, pricedOperation, paymentResult.payment, result.kind));

      response.status(200).json(buildPaidResponse(requestId, pricedOperation, result, buildMockPaymentResponse(paymentResult.payment)));
    });
  };

  register('/summary', 'summary');
  register('/entities', 'entities');
  register('/relations', 'relations');

  return router;
};
