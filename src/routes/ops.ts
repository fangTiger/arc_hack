import { Router } from 'express';

import type { FileCallLogStore } from '../store/call-log-store.js';

type CreateOpsRouterOptions = {
  callLogStore: FileCallLogStore;
};

export const createOpsRouter = (options: CreateOpsRouterOptions) => {
  const router = Router();

  router.get('/stats', async (_request, response) => {
    const stats = await options.callLogStore.getStats();
    response.status(200).json(stats);
  });

  return router;
};
