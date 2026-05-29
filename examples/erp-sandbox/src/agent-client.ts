import type { AgentMessage, AgentResponse, Emission } from '@arete-ui/core';

export type { AgentMessage, AgentResponse, Emission };

export interface AgentHealth {
  ok: boolean;
  model?: string;
  available?: string[];
}

export async function getAgentHealth(): Promise<AgentHealth> {
  try {
    const res = await fetch('/api/agui/health');
    return res.json();
  } catch {
    return { ok: false };
  }
}

export async function postAgent(
  prompt: string,
  context: Record<string, unknown>,
  messages: AgentMessage[] = [],
): Promise<AgentResponse> {
  const res = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, messages, context }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: String(res.status) }));
    throw new Error((err as { error: string }).error);
  }
  return res.json();
}
