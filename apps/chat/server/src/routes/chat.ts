import { Router } from 'express';
import { getStore, type ChatEntryRecord } from '../db';

export const chatRouter = Router();

chatRouter.get('/', (_req, res) => {
  res.json(getStore().getChat());
});

chatRouter.post('/', (req, res) => {
  getStore().saveChat((req.body ?? []) as ChatEntryRecord[]);
  res.json({ ok: true });
});
