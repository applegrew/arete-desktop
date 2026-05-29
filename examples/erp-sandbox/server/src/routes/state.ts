import { Router } from 'express';
import { getDb } from '../db';

export const stateRouter = Router();

stateRouter.get('/', (_req, res) => {
  try {
    const rows = getDb()
      .prepare('SELECT k, v FROM shell_state')
      .all() as { k: string; v: string }[];
    const state: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        state[row.k] = JSON.parse(row.v);
      } catch {
        state[row.k] = row.v;
      }
    }
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

stateRouter.post('/', (req, res) => {
  try {
    const db = getDb();
    const upsert = db.prepare(
      'INSERT INTO shell_state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
    );
    const transaction = db.transaction((entries: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(entries)) {
        upsert.run(k, JSON.stringify(v));
      }
    });
    transaction(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
