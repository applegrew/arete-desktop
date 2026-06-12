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
 * Run a surface's agent-authored handler script server-side (NO LLM) and stream
 * the resulting surface emissions back through the same AG-UI decoder pipeline.
 */
export function streamWidgetAction(
  body: { surfaceId: string; event: string; ctx: unknown; code: string; surface: unknown },
  handlers: AgUiHandlers,
  signal?: AbortSignal,
): Promise<void> {
  return streamSse('/api/widget-action', body, handlers, signal);
}
