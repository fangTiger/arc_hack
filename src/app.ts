import express from 'express';
import { join } from 'node:path';

import { MockKnowledgeExtractionProvider } from './domain/extraction/mock-provider.js';
import { GatewayPaymentAdapter } from './domain/payment/circle-gateway.js';
import { MockPaymentAdapter } from './domain/payment/mock-payment.js';
import type { PaymentAdapter } from './domain/payment/types.js';
import { createExtractRouter } from './routes/extract.js';
import { createOpsRouter } from './routes/ops.js';
import { FileCallLogStore } from './store/call-log-store.js';
import { env } from './config/env.js';

export const app = express();
const callLogStore = new FileCallLogStore(join(process.cwd(), 'artifacts', 'call-log.jsonl'));
const paymentAdapter: PaymentAdapter =
  env.paymentMode === 'gateway'
    ? new GatewayPaymentAdapter({
        sellerAddress: env.circleSellerAddress ?? '0xSELLER'
      })
    : new MockPaymentAdapter();

app.use(express.json());
app.use(
  '/api/extract',
  createExtractRouter({
    extractionProvider: new MockKnowledgeExtractionProvider(),
    paymentAdapter
  })
);
app.use('/ops', createOpsRouter({ callLogStore }));

app.get('/healthz', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});
