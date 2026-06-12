/**
 * Conversation-transcript scaffold.
 *
 * arete-desktop owns the chat transcript (via {@link ChatStore}) but NOT the agent
 * loop or transport. This module turns the stored {@link ChatEntry} list into a
 * transport-agnostic message list a consumer's agent loop can thread into any
 * framework (Vercel AI SDK, LangChain, a raw fetch, …) as conversation history.
 */
import type { ChatEntry, ChatRole } from '../chat/ChatStore';

/** Transport-agnostic message role, matching the common LLM chat convention. */
export type AgentRole = 'user' | 'assistant' | 'system';

/**
 * One conversation turn in a shape any chat-completion API accepts.
 * `surfaceId` is carried through for turns that emitted/own a surface.
 */
export interface AgentMessage {
  role: AgentRole;
  content: string;
  surfaceId?: string;
}

export interface TranscriptOptions {
  /** Keep only the most-recent N messages (after mapping). Omit for all. */
  limit?: number;
  /**
   * Include `thought` entries (the agent's internal "thinking" text) as
   * assistant turns. Off by default — thoughts are internal reasoning, not
   * part of the user-facing dialogue.
   */
  includeThoughts?: boolean;
}

/** Maps an arete chat role to a transport role, or `null` to drop the entry. */
function mapRole(role: ChatRole, includeThoughts: boolean): AgentRole | null {
  switch (role) {
    case 'user':
      return 'user';
    case 'action':
      // A user action (button/row click) is user intent → threaded as a user turn.
      return 'user';
    case 'agent':
      return 'assistant';
    case 'system':
      return 'system';
    case 'thought':
      return includeThoughts ? 'assistant' : null;
    default:
      return null;
  }
}

/**
 * Converts chat entries (oldest-first, as stored) into an `AgentMessage[]`.
 *
 * - Roles are mapped: user→user, agent→assistant, system→system, thought→
 *   assistant only when `includeThoughts`.
 * - An agent entry with no text but a `surfaceId` (a rendered surface emission)
 *   becomes a placeholder so the model knows a surface was produced that turn.
 * - Entries with neither text nor surfaceId are dropped.
 * - `limit` keeps the last N resulting messages.
 */
export function entriesToTranscript(
  entries: ChatEntry[],
  opts: TranscriptOptions = {},
): AgentMessage[] {
  const includeThoughts = opts.includeThoughts ?? false;
  const out: AgentMessage[] = [];

  for (const entry of entries) {
    const role = mapRole(entry.role, includeThoughts);
    if (role === null) continue;

    const text = entry.text?.trim();
    let content: string;
    if (text) {
      content = text;
    } else if (entry.surfaceId) {
      content = `[rendered surface ${entry.surfaceId}]`;
    } else {
      continue;
    }

    const msg: AgentMessage = { role, content };
    if (entry.surfaceId) msg.surfaceId = entry.surfaceId;
    out.push(msg);
  }

  if (opts.limit != null && opts.limit >= 0 && out.length > opts.limit) {
    return out.slice(out.length - opts.limit);
  }
  return out;
}
