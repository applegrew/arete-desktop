import { Router } from 'express';
import { getStore } from '../db';

export const stateRouter = Router();

stateRouter.get('/', (_req, res) => {
  res.json(getStore().getState());
});

stateRouter.post('/', (req, res) => {
  getStore().setState((req.body ?? {}) as Record<string, unknown>);
  res.json({ ok: true });
});
