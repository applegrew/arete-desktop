import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getStore, type PageRecord } from '../db';

export const pagesRouter = Router();

function defaultLayout() {
  return {
    kind: 'grid',
    rows: 2,
    cols: 2,
    regions: [{ id: 'top-left' }, { id: 'top-right' }, { id: 'bottom-left' }, { id: 'bottom-right' }],
  };
}

pagesRouter.get('/', (_req, res) => {
  res.json(getStore().listPages());
});

// Create (or upsert by provided id — lets the agent's createPage use its own pageId slug).
pagesRouter.post('/', (req, res) => {
  const b = (req.body ?? {}) as Partial<PageRecord>;
  const store = getStore();
  const now = Date.now();
  const id = b.id || `page-${randomUUID().slice(0, 8)}`;
  const existing = store.getPage(id);
  const page: PageRecord = {
    id,
    title: b.title ?? 'New page',
    layout: b.layout ?? defaultLayout(),
    mapping: b.mapping ?? {},
    position: b.position ?? store.listPages().length,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  store.upsertPage(page);
  res.json(page);
});

pagesRouter.patch('/:id', (req, res) => {
  const store = getStore();
  const cur = store.getPage(req.params.id);
  if (!cur) {
    res.status(404).json({ error: 'page not found' });
    return;
  }
  const b = (req.body ?? {}) as Partial<PageRecord>;
  const next: PageRecord = {
    ...cur,
    title: b.title ?? cur.title,
    layout: b.layout ?? cur.layout,
    mapping: b.mapping ?? cur.mapping,
    position: b.position ?? cur.position,
    updatedAt: Date.now(),
  };
  store.upsertPage(next);
  res.json(next);
});

pagesRouter.delete('/:id', (req, res) => {
  getStore().deletePage(req.params.id);
  res.json({ ok: true });
});
