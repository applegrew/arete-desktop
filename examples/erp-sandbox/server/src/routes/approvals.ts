import { Router } from 'express';
import { getDb } from '../db';

export const approvalsRouter = Router();

approvalsRouter.get('/', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = getDb()
      .prepare('SELECT * FROM approvals ORDER BY created_at DESC LIMIT ?')
      .all(limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

approvalsRouter.post('/', (req, res) => {
  try {
    const { kind, surfaceId, pageId, opName, decision, diffJson, createdAt } = req.body;
    const db = getDb();
    const result = db
      .prepare(
        'INSERT INTO approvals (kind, surface_id, page_id, op_name, decision, diff_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        kind ?? null,
        surfaceId ?? null,
        pageId ?? null,
        opName ?? null,
        decision,
        JSON.stringify(diffJson),
        createdAt ?? Date.now(),
      );
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
