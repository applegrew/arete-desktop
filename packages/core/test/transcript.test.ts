import { describe, it, expect } from 'vitest';
import { ChatStore } from '../src/chat/ChatStore';
import { entriesToTranscript } from '../src/agent/transcript';
import type { ChatEntry } from '../src/chat/ChatStore';

function entry(partial: Partial<ChatEntry> & Pick<ChatEntry, 'role'>): ChatEntry {
  return {
    id: partial.id ?? 'id',
    role: partial.role,
    text: partial.text,
    surfaceId: partial.surfaceId,
    createdAt: partial.createdAt ?? 0,
  };
}

describe('entriesToTranscript', () => {
  it('maps arete roles to transport roles', () => {
    const out = entriesToTranscript([
      entry({ role: 'system', text: 'sys' }),
      entry({ role: 'user', text: 'hi' }),
      entry({ role: 'agent', text: 'hello' }),
    ]);
    expect(out).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('excludes thought entries by default but includes them when asked', () => {
    const entries = [
      entry({ role: 'user', text: 'q' }),
      entry({ role: 'thought', text: 'thinking…' }),
      entry({ role: 'agent', text: 'a' }),
    ];
    expect(entriesToTranscript(entries).map((m) => m.content)).toEqual(['q', 'a']);
    const withThoughts = entriesToTranscript(entries, { includeThoughts: true });
    expect(withThoughts).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'thinking…' },
      { role: 'assistant', content: 'a' },
    ]);
  });

  it('synthesizes a placeholder for textless surface emissions', () => {
    const out = entriesToTranscript([
      entry({ role: 'agent', surfaceId: 'agent-sfc-1' }),
    ]);
    expect(out).toEqual([
      { role: 'assistant', content: '[rendered surface agent-sfc-1]', surfaceId: 'agent-sfc-1' },
    ]);
  });

  it('drops entries with neither text nor surfaceId', () => {
    const out = entriesToTranscript([
      entry({ role: 'agent', text: '   ' }),
      entry({ role: 'user', text: 'real' }),
    ]);
    expect(out).toEqual([{ role: 'user', content: 'real' }]);
  });

  it('carries surfaceId through when text is present', () => {
    const out = entriesToTranscript([
      entry({ role: 'agent', text: 'card', surfaceId: 'sfc-9' }),
    ]);
    expect(out[0]).toEqual({ role: 'assistant', content: 'card', surfaceId: 'sfc-9' });
  });

  it('windows to the last N messages', () => {
    const entries = ['a', 'b', 'c', 'd'].map((t) => entry({ role: 'user', text: t }));
    expect(entriesToTranscript(entries, { limit: 2 }).map((m) => m.content)).toEqual(['c', 'd']);
  });
});

describe('ChatStore.toTranscript', () => {
  it('delegates to entriesToTranscript over stored entries', () => {
    const s = new ChatStore();
    s.push({ role: 'user', text: 'hi' });
    s.push({ role: 'agent', text: 'hello' });
    expect(s.toTranscript()).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });
});
