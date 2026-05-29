import { Router } from 'express';
import { getStore, type SurfaceRecord } from '../db';

export const surfacesRouter = Router();

// All rendered surfaces (global). Replayed into the live processor on app load.
surfacesRouter.get('/', (_req, res) => {
  res.json(getStore().listSurfaces());
});

// Bulk replace — the client sends the full current surface set on each save.
surfacesRouter.put('/', (req, res) => {
  const surfaces = (req.body ?? []) as SurfaceRecord[];
  getStore().replaceSurfaces(surfaces);
  res.json({ ok: true });
});
