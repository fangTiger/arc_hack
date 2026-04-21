import express from 'express';

import { env, type RuntimeEnv } from './config/env.js';
import type { KnowledgeExtractionProvider } from './domain/extraction/provider.js';
import { MockKnowledgeExtractionProvider } from './domain/extraction/mock-provider.js';
import { RealKnowledgeExtractionProvider } from './domain/extraction/real-provider.js';
import { GatewayPaymentAdapter } from './domain/payment/circle-gateway.js';
import { MockPaymentAdapter } from './domain/payment/mock-payment.js';
import type { PaymentAdapter } from './domain/payment/types.js';
import { createExtractRouter } from './routes/extract.js';
import { createOpsRouter } from './routes/ops.js';
import { FileCallLogStore } from './store/call-log-store.js';

type CreateAppOptions = {
  runtimeEnv?: RuntimeEnv;
  extractionProvider?: KnowledgeExtractionProvider;
  paymentAdapter?: PaymentAdapter;
  callLogStore?: FileCallLogStore;
  requestIdFactory?: () => string;
};

export const createExtractionProvider = (runtimeEnv: Pick<RuntimeEnv, 'aiMode' | 'llmBaseUrl' | 'llmApiKey' | 'llmModel'>) => {
  if (runtimeEnv.aiMode === 'mock') {
    return new MockKnowledgeExtractionProvider();
  }

  if (!runtimeEnv.llmBaseUrl || !runtimeEnv.llmModel) {
    throw new Error('AI_MODE=real requires LLM_BASE_URL and LLM_MODEL.');
  }

  return new RealKnowledgeExtractionProvider({
    baseUrl: runtimeEnv.llmBaseUrl,
    model: runtimeEnv.llmModel,
    apiKey: runtimeEnv.llmApiKey
  });
};

export const createPaymentAdapter = (runtimeEnv: Pick<RuntimeEnv, 'paymentMode' | 'circleSellerAddress'>): PaymentAdapter => {
  if (runtimeEnv.paymentMode === 'gateway') {
    return new GatewayPaymentAdapter({
      sellerAddress: runtimeEnv.circleSellerAddress ?? '0xSELLER'
    });
  }

  return new MockPaymentAdapter();
};

export const createApp = (options: CreateAppOptions = {}) => {
  const runtimeEnv = options.runtimeEnv ?? env;
  const callLogStore = options.callLogStore ?? new FileCallLogStore(runtimeEnv.callLogPath);
  const paymentAdapter = options.paymentAdapter ?? createPaymentAdapter(runtimeEnv);
  const extractionProvider = options.extractionProvider ?? createExtractionProvider(runtimeEnv);
  const app = express();

  app.use(express.json());
  app.use(
    '/api/extract',
    createExtractRouter({
      extractionProvider,
      paymentAdapter,
      callLogStore,
      requestIdFactory: options.requestIdFactory
    })
  );
  app.use('/ops', createOpsRouter({ callLogStore }));

  app.get('/healthz', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  return app;
};

export const app = createApp();
