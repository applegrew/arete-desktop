import { useSyncExternalStore } from 'react';
import { uid } from '../util/id';
import {
  entriesToTranscript,
  type AgentMessage,
  type TranscriptOptions,
} from '../agent/transcript';

export type ChatRole = 'user' | 'agent' | 'system' | 'thought' | 'tool' | 'action';

export interface ChatEntry {
  id: string;
  role: ChatRole;
  text?: string;
  surfaceId?: string;
  /** Tool name (present when role === 'tool'). */
  toolName?: string;
  /** Tool result content (present when role === 'tool'). */
  toolResult?: string;
  /** True when the tool call failed — toolResult holds the error. */
  toolError?: boolean;
  /** Friendly label for role === 'action' (the raw synthetic prompt stays in `text`). */
  actionLabel?: string;
  /** Transient "working" status (e.g. waiting on the agent) — rendered as an animated indicator. */
  pending?: boolean;
  createdAt: number;
}

type Listener = () => void;

export class ChatStore {
  private entries: ChatEntry[] = [];
  private listeners = new Set<Listener>();

  getSnapshot = (): ChatEntry[] => this.entries;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  push(entry: Omit<ChatEntry, 'id' | 'createdAt'> & Partial<Pick<ChatEntry, 'id'>>): ChatEntry {
    const e: ChatEntry = {
      id: entry.id ?? uid('chat'),
      role: entry.role,
      text: entry.text,
      surfaceId: entry.surfaceId,
      toolName: entry.toolName,
      toolResult: entry.toolResult,
      toolError: entry.toolError,
      actionLabel: entry.actionLabel,
      pending: entry.pending,
      createdAt: Date.now(),
    };
    this.entries = [...this.entries, e];
    this.emit();
    return e;
  }

  /** Merge a patch into an existing entry by id (e.g. attach a tool result to its start row). */
  update(id: string, patch: Partial<Omit<ChatEntry, 'id'>>): void {
    let changed = false;
    this.entries = this.entries.map((e) => {
      if (e.id !== id) return e;
      changed = true;
      return { ...e, ...patch };
    });
    if (changed) this.emit();
  }

  remove(id: string): void {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.emit();
  }

  removeBySurfaceId(surfaceId: string): void {
    const next = this.entries.filter((e) => e.surfaceId !== surfaceId);
    if (next.length === this.entries.length) return;
    this.entries = next;
    this.emit();
  }

  clear(): void {
    this.entries = [];
    this.emit();
  }

  /**
   * Exports the conversation as a transport-agnostic `AgentMessage[]` for a
   * consumer's agent loop to thread as history. See {@link entriesToTranscript}.
   */
  toTranscript(opts?: TranscriptOptions): AgentMessage[] {
    return entriesToTranscript(this.entries, opts);
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}

export function useChatEntries(store: ChatStore): ChatEntry[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
