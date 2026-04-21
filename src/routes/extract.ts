import { randomUUID } from 'node:crypto';
import { Router } from 'express';

import type { KnowledgeExtractionProvider } from '../domain/extraction/provider.js';
import type { ExtractionOperation, ExtractionRequest } from '../domain/extraction/types.js';
import type { PaymentAdapter, Price, PricedOperation } from '../domain/payment/types.js';
import type { FileCallLogStore } from '../store/call-log-store.js';

type CreateExtractRouterOptions = {
  extractionProvider: KnowledgeExtractionProvider;
  paymentAdapter: PaymentAdapter;
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

export const createExtractRouter = (options: CreateExtractRouterOptions) => {
  const router = Router();
  const requestIdFactory = options.requestIdFactory ?? randomUUID;

  const register = (path: `/${ExtractionOperation}`, operation: ExtractionOperation) => {
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

      await options.callLogStore.append({
        requestId,
        operation,
        price: pricedOperation.price,
        paymentMode: paymentResult.payment.mode,
        paymentStatus: paymentResult.payment.status,
        resultKind: result.kind,
        createdAt: new Date().toISOString()
      });

      response.status(200).json({
        requestId,
        pricedOperation,
        result,
        payment: paymentResult.payment
      });
    });
  };

  register('/summary', 'summary');
  register('/entities', 'entities');
  register('/relations', 'relations');

  return router;
};
