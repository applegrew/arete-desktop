import { AgUiDecoder, type AgUiHandlers } from '@arete-desktop/agui';
import type { AgentMessage } from '@arete-desktop/core';

function apiOrigin(): string {
  return (typeof window !== 'undefined' && (window as { __ARETE_API_BASE__?: string }).__ARETE_API_BASE__) || '';
}

/** POST `body` to `path`, read the AG-UI SSE stream, feed each event to `handlers`. */
async function streamSse(
  path: string,
  body: unknown,
  handlers: AgUiHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const decoder = new AgUiDecoder(handlers);
  const res = await fetch(`${apiOrigin()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Agent stream failed: ${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const textDecoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += textDecoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const json = line.slice(line.indexOf(':') + 1).trim();
        if (!json) continue;
        try {
          decoder.handle(JSON.parse(json));
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  }
}

/**
 * Thin AG-UI client: POST the turn to the agent's `/api/agui` endpoint and stream
 * the SSE result into the decoder. Transport is consumer-owned.
 */
export function streamAgent(
  prompt: string,
  messages: AgentMessage[],
  context: Record<string, unknown>,
  handlers: AgUiHandlers,
  signal?: AbortSignal,
): Promise<void> {
  return streamSse('/api/agui', { prompt, messages, context }, handlers, signal);
}

/**
 * Execute ONE MCP tool via the backend proxy and return its parsed result. Used by
 * webview-run widget handlers — their `tools.<name>(args)` calls land here so auth,
 * MCP transport, and result parsing stay server-side. Parses the result text as JSON
 * (the common case), falling back to the raw string. Throws on tool error.
 */
const TOOL_TIMEOUT_MS = 30_000;

export async function callMcpTool(name: string, args: unknown, signal?: AbortSignal): Promise<unknown> {
  // Bound the call: a hung MCP server must NOT hang the widget handler forever
  // (which would freeze the per-surface action queue + stick the busy state). Time
  // out at 30s; also honor the caller's cancel signal.
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, TOOL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${apiOrigin()}/api/mcp-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, args: args ?? {} }),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (timedOut) throw new Error(`tool ${name} timed out after ${TOOL_TIMEOUT_MS / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  if (!res.ok) throw new Error(`tool ${name} failed: ${res.status} ${res.statusText}`);
  const { text, isError } = (await res.json()) as { text?: string; isError?: boolean };
  if (isError) throw new Error(text || `tool ${name} returned an error`);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
