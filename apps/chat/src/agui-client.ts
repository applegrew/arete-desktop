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
  // Whatever happens (normal end, abort, error), flush any assistant text the
  // decoder is still buffering so a missing TEXT_MESSAGE_END can't drop the reply.
  let ended = false;
  const endDecoder = () => {
    if (!ended) {
      ended = true;
      decoder.end();
    }
  };

  // Per SSE spec, a single event's payload may span multiple `data:` lines that
  // must be JOINED with "\n" and parsed ONCE — parsing each line separately
  // corrupts any event whose JSON spans lines (large emissions, multi-line code).
  const dispatchFrame = (frame: string) => {
    const dataLines: string[] = [];
    for (const raw of frame.split('\n')) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (!line.startsWith('data:')) continue; // skip comments / other SSE fields
      // Strip "data:" and at most one optional leading space.
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (dataLines.length === 0) return;
    const json = dataLines.join('\n').trim();
    if (!json) return;
    try {
      decoder.handle(JSON.parse(json));
    } catch {
      if (typeof console !== 'undefined') console.warn('[agui] dropped malformed SSE frame');
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += textDecoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line (handle CRLF too).
      let sep: number;
      while ((sep = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const match = buffer.slice(sep).match(/^\r?\n\r?\n/)![0];
        dispatchFrame(buffer.slice(0, sep));
        buffer = buffer.slice(sep + match.length);
      }
    }

    // Flush any bytes the streaming decoder is holding, then dispatch a final
    // frame the server didn't blank-line-terminate (otherwise the last event —
    // often RUN_FINISHED / the final emission — would be silently dropped).
    buffer += textDecoder.decode();
    if (buffer.trim().length > 0) dispatchFrame(buffer);
  } finally {
    // Normal end, abort, or error: never leave buffered assistant text undelivered.
    endDecoder();
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
