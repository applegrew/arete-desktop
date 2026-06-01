import express from 'express';
import cors from 'cors';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentRouter, loadMcpConfig } from '@arete-ui/agent';
import { pagesRouter } from './routes/pages';
import { surfacesRouter } from './routes/surfaces';
import { chatRouter } from './routes/chat';
import { stateRouter } from './routes/state';
import { createSettingsRouter } from './routes/settings';
import { getStore } from './db';
import { defaultSettings, resolveSettings, settingsToRuntimeOptions } from './settings';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8787;

app.use(cors());
app.use(express.json({ limit: '4mb' }));

// Seed settings from env + mcp.json on first boot so behavior matches prior defaults.
const seedMcp = loadMcpConfig();
const store = getStore();
if (!store.getSettings()) store.saveSettings(defaultSettings(seedMcp) as unknown as Record<string, unknown>);

app.use('/api/pages', pagesRouter);
app.use('/api/surfaces', surfacesRouter);
app.use('/api/chat', chatRouter);
app.use('/api/state', stateRouter);
app.use('/api/settings', createSettingsRouter(seedMcp));
// Stateless agent loop (AG-UI SSE + /health) from @arete-ui/agent. Model + enabled
// MCP servers are resolved live from settings on every turn (no restart needed).
app.use(
  '/api/agui',
  createAgentRouter({
    skillsDir: join(__dirname, '..', 'skills'),
    resolveOptions: () => settingsToRuntimeOptions(resolveSettings(store, seedMcp)),
  }),
);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[arete-chat-server] listening on http://localhost:${PORT}`);
});
