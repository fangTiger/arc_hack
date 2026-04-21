import express from 'express';
import { join } from 'node:path';

import { MockKnowledgeExtractionProvider } from './domain/extraction/mock-provider.js';
import { MockPaymentAdapter } from './domain/payment/mock-payment.js';
import { createExtractRouter } from './routes/extract.js';
import { createOpsRouter } from './routes/ops.js';
import { FileCallLogStore } from './store/call-log-store.js';

export const app = express();
const callLogStore = new FileCallLogStore(join(process.cwd(), 'artifacts', 'call-log.jsonl'));

app.use(express.json());
app.use(
  '/api/extract',
  createExtractRouter({
    extractionProvider: new MockKnowledgeExtractionProvider(),
    paymentAdapter: new MockPaymentAdapter()
  })
);
app.use('/ops', createOpsRouter({ callLogStore }));

app.get('/healthz', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});
