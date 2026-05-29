import { Router } from 'express';
import { getDb } from '../db';

export const chatRouter = Router();

chatRouter.get('/', (_req, res) => {
  try {
    const rows = getDb()
      .prepare('SELECT id, role, text, surface_id, created_at FROM chat_entries ORDER BY created_at ASC')
      .all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

chatRouter.post('/', (req, res) => {
  try {
    const entries = req.body as Array<{
      id: string;
      role: string;
      text?: string;
      surfaceId?: string;
      createdAt: number;
    }>;
    const db = getDb();
    const insert = db.prepare(
      'INSERT OR REPLACE INTO chat_entries (id, role, text, surface_id, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM chat_entries').run();
      for (const e of entries) {
        insert.run(e.id, e.role, e.text ?? null, e.surfaceId ?? null, e.createdAt);
      }
    });
    transaction();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
