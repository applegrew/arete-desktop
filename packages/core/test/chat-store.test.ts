import { describe, it, expect } from 'vitest';
import { ChatStore } from '../src/chat/ChatStore';

describe('ChatStore.removeBySurfaceId', () => {
  it('removes entries whose surfaceId matches', () => {
    const s = new ChatStore();
    s.push({ role: 'agent', text: 'hi' });
    s.push({ role: 'agent', text: 'card a', surfaceId: 'sfc-1' });
    s.push({ role: 'agent', text: 'card b', surfaceId: 'sfc-2' });
    s.removeBySurfaceId('sfc-1');
    const remaining = s.getSnapshot();
    expect(remaining.map((e) => e.surfaceId)).toEqual([undefined, 'sfc-2']);
  });

  it('no-ops when no entry matches', () => {
    const s = new ChatStore();
    s.push({ role: 'agent', text: 'card a', surfaceId: 'sfc-1' });
    const before = s.getSnapshot();
    s.removeBySurfaceId('sfc-missing');
    expect(s.getSnapshot()).toBe(before);
  });

  it('notifies subscribers when something is removed', () => {
    const s = new ChatStore();
    s.push({ role: 'agent', text: 'card', surfaceId: 'sfc-1' });
    let calls = 0;
    s.subscribe(() => {
      calls += 1;
    });
    s.removeBySurfaceId('sfc-1');
    expect(calls).toBe(1);
  });
});

describe('ChatStore.upsertSurface', () => {
  const placeholders = (s: ChatStore) => s.getSnapshot().filter((e) => e.role === 'surface-moved');

  it('does not accumulate placeholders across repeated streaming updates (R1)', () => {
    const s = new ChatStore();
    s.upsertSurface('sfc-1', { role: 'agent', text: 'card' });
    s.push({ role: 'agent', text: 'reply below' }); // something now sits below the surface
    // Stream several updates to the same surface.
    for (let i = 0; i < 5; i++) s.upsertSurface('sfc-1', { role: 'agent', text: `card v${i}` });
    // At most one placeholder for the moved surface — not one per update.
    expect(placeholders(s).filter((e) => e.surfaceId === 'sfc-1')).toHaveLength(1);
  });

  it('upserts the real surface entry, never a placeholder (R4)', () => {
    const s = new ChatStore();
    const first = s.upsertSurface('sfc-1', { role: 'agent', text: 'card' });
    s.push({ role: 'agent', text: 'reply below' });
    const moved = s.upsertSurface('sfc-1', { role: 'agent', text: 'card v2' });
    // Same logical surface entry id is preserved, content updated, placeholder points to it.
    expect(moved.id).toBe(first.id);
    expect(moved.text).toBe('card v2');
    const ph = placeholders(s).find((e) => e.surfaceId === 'sfc-1');
    expect(ph?.movedToEntryId).toBe(moved.id);
    // The real surface entry is the last entry, not a placeholder.
    const snap = s.getSnapshot();
    expect(snap[snap.length - 1]!.id).toBe(moved.id);
  });

  it('leaves no placeholder when the surface is already last (streaming hot path)', () => {
    const s = new ChatStore();
    s.upsertSurface('sfc-1', { role: 'agent', text: 'card' });
    s.upsertSurface('sfc-1', { role: 'agent', text: 'card v2' });
    expect(placeholders(s)).toHaveLength(0);
  });
});
