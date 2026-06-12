import { AgUiDecoder, type AgUiHandlers } from '@arete-desktop/agui';
import type { AgentMessage } from '@arete-desktop/core';

/**
 * Thin AG-UI client: POST the turn to the agent's `/api/agui` endpoint, read the
 * SSE event stream, and feed each event into an `AgUiDecoder`. The transport is
 * consumer-owned (arete-desktop ships no transport); the decoder hands normalized
 * results to `handlers`, which route them through the Diff Engine / harness.
 */
export async function streamAgent(
  prompt: string,
  messages: AgentMessage[],
  context: Record<string, unknown>,
  handlers: AgUiHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const decoder = new AgUiDecoder(handlers);
  const apiOrigin =
    (typeof window !== 'undefined' && (window as { __ARETE_API_BASE__?: string }).__ARETE_API_BASE__) || '';
  const res = await fetch(`${apiOrigin}/api/agui`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, messages, context }),
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
