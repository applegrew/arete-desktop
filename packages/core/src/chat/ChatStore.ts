import { useSyncExternalStore } from 'react';
import { uid } from '../util/id';
import {
  entriesToTranscript,
  type AgentMessage,
  type TranscriptOptions,
} from '../agent/transcript';

export type ChatRole = 'user' | 'agent' | 'system' | 'thought' | 'tool' | 'action' | 'script-diff' | 'surface-moved';

export type { DiscoveryChip } from '../types/hooks';

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
  /** Fields for role === 'script-diff': old vs new handler code. */
  oldCode?: string;
  newCode?: string;
  scriptEvent?: string;
  /** When role === 'surface-moved', the id of the entry the surface was moved to. */
  movedToEntryId?: string;
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
      // role === 'script-diff' carries the handler code to review; role ===
      // 'surface-moved' carries the move target. These were previously dropped,
      // leaving an empty (unreviewable) script-diff card.
      oldCode: entry.oldCode,
      newCode: entry.newCode,
      scriptEvent: entry.scriptEvent,
      movedToEntryId: entry.movedToEntryId,
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
    // Keep script-diff cards: they borrow the surfaceId but are pending approvals,
    // not part of the surface's render that's being cleared.
    const next = this.entries.filter((e) => e.surfaceId !== surfaceId || e.role === 'script-diff');
    if (next.length === this.entries.length) return;
    this.entries = next;
    this.emit();
  }

  /** Move an existing surface entry to the end of the list (or push a new one). Returns the entry. */
  upsertSurface(surfaceId: string, patch: Omit<ChatEntry, 'id' | 'createdAt' | 'surfaceId'>): ChatEntry {
    // Match the real surface entry only — never a `surface-moved` placeholder, which
    // shares this surfaceId and would otherwise be picked up by findIndex.
    const isPlaceholderFor = (e: ChatEntry) => e.role === 'surface-moved' && e.surfaceId === surfaceId;
    // A script-diff entry carries the *target* surfaceId (so "locate" can find the
    // surface) but is NOT the surface's render entry — never treat it as one, or
    // re-rendering the surface would clobber the pending approval card.
    const idx = this.entries.findIndex(
      (e) => e.surfaceId === surfaceId && e.role !== 'surface-moved' && e.role !== 'script-diff',
    );
    if (idx < 0) {
      // No live surface entry. Drop any stale placeholder for it before pushing fresh.
      const cleaned = this.entries.filter((e) => !isPlaceholderFor(e));
      if (cleaned.length !== this.entries.length) {
        this.entries = cleaned;
      }
      return this.push({ ...patch, surfaceId });
    }

    const existing = this.entries[idx]!;
    const moved: ChatEntry = {
      id: existing.id,
      role: patch.role,
      text: patch.text,
      surfaceId,
      toolName: patch.toolName,
      toolResult: patch.toolResult,
      toolError: patch.toolError,
      actionLabel: patch.actionLabel,
      pending: patch.pending,
      createdAt: Date.now(),
    };

    // Is the surface already the last *real* entry? If so it isn't moving anywhere
    // (hot streaming path): update in place and keep any existing placeholder that
    // already marks where it moved from — don't add a new one.
    const isAlreadyLast = !this.entries
      .slice(idx + 1)
      .some((e) => e.role !== 'surface-moved' && e.role !== 'script-diff');

    if (isAlreadyLast) {
      this.entries = this.entries.map((e, i) => (i === idx ? moved : e));
    } else {
      // Displacing the surface to the end: drop any prior placeholder for it and
      // leave exactly one where it used to be, so placeholders never accumulate.
      const rest = this.entries.filter((e, i) => i !== idx && !isPlaceholderFor(e));
      const placeholder: ChatEntry = {
        id: uid('mvd'),
        role: 'surface-moved',
        text: 'Moved below',
        surfaceId,
        movedToEntryId: moved.id,
        createdAt: Date.now(),
      };
      const beforeCount = this.entries.slice(0, idx).filter((e) => !isPlaceholderFor(e)).length;
      this.entries = [...rest.slice(0, beforeCount), placeholder, ...rest.slice(beforeCount), moved];
    }
    this.emit();
    return moved;
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
