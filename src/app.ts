import express from 'express';
import { join } from 'node:path';

import { getRuntimeEnv, type RuntimeEnv } from './config/env.js';
import type { KnowledgeExtractionProvider } from './domain/extraction/provider.js';
import { MockKnowledgeExtractionProvider } from './domain/extraction/mock-provider.js';
import { RealKnowledgeExtractionProvider } from './domain/extraction/real-provider.js';
import { createCircleGatewayMiddleware } from './domain/payment/circle-gateway.js';
import { MockPaymentAdapter } from './domain/payment/mock-payment.js';
import type { PaymentAdapter } from './domain/payment/types.js';
import { createReceiptWriterFromRuntimeEnv, type ReceiptWriter } from './domain/receipt/writer.js';
import { WhitelistNewsSourceImporter, type ImportedArticle } from './domain/news-import/index.js';
import { createExtractRouter } from './routes/extract.js';
import { createGraphRouter } from './routes/graph.js';
import { createLiveRouter } from './routes/live.js';
import { createOpsRouter } from './routes/ops.js';
import { LiveAgentSessionService } from './demo/live-session.js';
import { FileAgentGraphStore } from './store/agent-graph-store.js';
import { FileCallLogStore } from './store/call-log-store.js';
import { FileLiveAgentSessionStore } from './store/live-session-store.js';

type CreateAppOptions = {
  runtimeEnv?: RuntimeEnv;
  extractionProvider?: KnowledgeExtractionProvider;
  paymentAdapter?: PaymentAdapter;
  callLogStore?: FileCallLogStore;
  agentGraphStore?: FileAgentGraphStore;
  liveSessionStore?: FileLiveAgentSessionStore;
  liveSessionService?: LiveAgentSessionService;
  newsImporter?: {
    import: (articleUrl: string) => Promise<ImportedArticle>;
  };
  receiptWriter?: ReceiptWriter;
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
  return new MockPaymentAdapter();
};

export const createApp = (options: CreateAppOptions = {}) => {
  const runtimeEnv = options.runtimeEnv ?? getRuntimeEnv();
  const callLogStore = options.callLogStore ?? new FileCallLogStore(runtimeEnv.callLogPath);
  const agentGraphStore = options.agentGraphStore ?? new FileAgentGraphStore(join(process.cwd(), 'artifacts', 'agent-graph'));
  const receiptWriter = options.receiptWriter ?? createReceiptWriterFromRuntimeEnv(runtimeEnv);
  const liveSessionStore =
    options.liveSessionStore ?? new FileLiveAgentSessionStore(join(process.cwd(), 'artifacts', 'live-console'));
  const liveSessionService =
    options.liveSessionService ??
    new LiveAgentSessionService({
      runtimeEnv,
      liveSessionStore,
      receiptWriter,
      agentGraphArtifactRootDirectory: agentGraphStore.getRootDirectory()
    });
  const newsImporter = options.newsImporter ?? new WhitelistNewsSourceImporter();
  const extractionProvider = options.extractionProvider ?? createExtractionProvider(runtimeEnv);
  const paymentAdapter =
    runtimeEnv.paymentMode === 'mock' ? options.paymentAdapter ?? createPaymentAdapter(runtimeEnv) : undefined;
  const gatewayMiddleware =
    runtimeEnv.paymentMode === 'gateway'
      ? createCircleGatewayMiddleware({
          sellerAddress: runtimeEnv.circleSellerAddress ?? (() => {
            throw new Error('PAYMENT_MODE=gateway requires CIRCLE_SELLER_ADDRESS.');
          })(),
          networks: runtimeEnv.circleGatewayNetworks,
          facilitatorUrl: runtimeEnv.circleGatewayFacilitatorUrl
        })
      : undefined;
  const app = express();

  app.use(express.json());
  app.use(
    '/api/extract',
    createExtractRouter({
      extractionProvider,
      paymentAdapter,
      gatewayMiddleware,
      callLogStore,
      requestIdFactory: options.requestIdFactory
    })
  );
  app.use(
    '/demo/graph',
    createGraphRouter({
      agentGraphStore,
      runtimeEnv
    })
  );
  app.use(
    '/demo/live',
    createLiveRouter({
      liveSessionService,
      runtimeEnv,
      newsImporter
    })
  );
  app.use('/ops', createOpsRouter({ callLogStore }));

  app.get('/healthz', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  return app;
};
