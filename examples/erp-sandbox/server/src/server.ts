import express from 'express';
import cors from 'cors';
import { stateRouter } from './routes/state';
import { chatRouter } from './routes/chat';
import { approvalsRouter } from './routes/approvals';
import { agentRouter } from './routes/agent';
import { aguiRouter } from './routes/agui';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8787;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api/state', stateRouter);
app.use('/api/chat', chatRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/agent', agentRouter);
app.use('/api/agui', aguiRouter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`[arete-sandbox-server] listening on http://localhost:${PORT}`);
});
