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
