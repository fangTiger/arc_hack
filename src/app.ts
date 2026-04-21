import express from 'express';

import { MockKnowledgeExtractionProvider } from './domain/extraction/mock-provider.js';
import { MockPaymentAdapter } from './domain/payment/mock-payment.js';
import { createExtractRouter } from './routes/extract.js';

export const app = express();

app.use(express.json());
app.use(
  '/api/extract',
  createExtractRouter({
    extractionProvider: new MockKnowledgeExtractionProvider(),
    paymentAdapter: new MockPaymentAdapter()
  })
);

app.get('/healthz', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});
