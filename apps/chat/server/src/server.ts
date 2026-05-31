import express from 'express';
import cors from 'cors';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentRouter, loadMcpConfig } from '@arete-ui/agent';
import { pagesRouter } from './routes/pages';
import { surfacesRouter } from './routes/surfaces';
import { chatRouter } from './routes/chat';
import { stateRouter } from './routes/state';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8787;

app.use(cors());
app.use(express.json({ limit: '4mb' }));

app.use('/api/pages', pagesRouter);
app.use('/api/surfaces', surfacesRouter);
app.use('/api/chat', chatRouter);
app.use('/api/state', stateRouter);
// Stateless agent loop (AG-UI SSE + /health) from @arete-ui/agent.
const mcpConfig = loadMcpConfig();
app.use('/api/agui', createAgentRouter({ skillsDir: join(__dirname, '..', 'skills'), model: 'gemma4:31b-cloud', mcp: mcpConfig }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[arete-chat-server] listening on http://localhost:${PORT}`);
});
