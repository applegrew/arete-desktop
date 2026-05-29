import { describe, it, expect, vi } from 'vitest';
import { ActionHarness } from '../src/action/ActionHarness';
import type { UserAction } from '../src/types/hooks';

function makeAction(name: string, extras: Partial<UserAction> = {}): UserAction {
  return {
    name,
    timestamp: new Date().toISOString(),
    context: {},
    ...extras,
  };
}

describe('ActionHarness', () => {
  it('records actions and exposes them newest-first via getRecent', () => {
    const h = new ActionHarness();
    h.record(makeAction('a'));
    h.record(makeAction('b'));
    h.record(makeAction('c'));
    const recent = h.getRecent();
    expect(recent.map((a) => a.name)).toEqual(['c', 'b', 'a']);
  });

  it('limits history to a bounded ring buffer of 50', () => {
    const h = new ActionHarness();
    for (let i = 0; i < 60; i += 1) {
      h.record(makeAction(`a${i}`));
    }
    const recent = h.getRecent();
    expect(recent).toHaveLength(50);
    // Newest first → a59 ... a10
    expect(recent[0]?.name).toBe('a59');
    expect(recent[49]?.name).toBe('a10');
  });

  it('respects an explicit limit on getRecent', () => {
    const h = new ActionHarness();
    h.record(makeAction('a'));
    h.record(makeAction('b'));
    h.record(makeAction('c'));
    expect(h.getRecent(2).map((a) => a.name)).toEqual(['c', 'b']);
  });

  it('notifies subscribers on record + clear', () => {
    const h = new ActionHarness();
    const listener = vi.fn();
    h.subscribe(listener);
    h.record(makeAction('x'));
    h.record(makeAction('y'));
    h.clear();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(h.getRecent()).toEqual([]);
  });

  it('clear is a no-op when history is empty', () => {
    const h = new ActionHarness();
    const listener = vi.fn();
    h.subscribe(listener);
    h.clear();
    expect(listener).not.toHaveBeenCalled();
  });

  it('fires the wired onUserAction hook on record', () => {
    const h = new ActionHarness();
    const onUserAction = vi.fn();
    h.setHooks({ onUserAction });
    const a = makeAction('drillDown', {
      surfaceId: 's-1',
      sourceComponentId: 'root',
      context: { label: 'Open', value: 12, index: 0 },
    });
    h.record(a);
    expect(onUserAction).toHaveBeenCalledTimes(1);
    expect(onUserAction).toHaveBeenCalledWith(a);
  });

  it('unsubscribe stops further notifications', () => {
    const h = new ActionHarness();
    const listener = vi.fn();
    const unsub = h.subscribe(listener);
    h.record(makeAction('a'));
    unsub();
    h.record(makeAction('b'));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
