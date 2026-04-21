import express from 'express';

export const app = express();

app.use(express.json());

app.get('/healthz', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});
