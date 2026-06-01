import { Router } from 'express';
import type { McpConfig } from '@arete-ui/agent';
import { getStore } from '../db';
import { resolveSettings } from '../settings';

/** GET/PUT /api/settings — the full settings object (merged over defaults). PUT shallow-merges. */
export function createSettingsRouter(seedMcp: McpConfig): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(resolveSettings(getStore(), seedMcp));
  });

  router.put('/', (req, res) => {
    getStore().saveSettings((req.body ?? {}) as Record<string, unknown>);
    res.json(resolveSettings(getStore(), seedMcp));
  });

  return router;
}
