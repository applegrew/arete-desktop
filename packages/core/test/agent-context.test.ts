import { describe, it, expect } from 'vitest';
import { ChatStore } from '../src/chat/ChatStore';
import { ActionHarness } from '../src/action/ActionHarness';
import { buildAgentContext } from '../src/agent/context';
import type { PageContextEntry, SurfaceSnapshot } from '../src/agent/context';
import type { UserAction } from '../src/types/hooks';

const ticketsPage: PageContextEntry = {
  layout: { kind: 'grid', rows: 2, cols: 2, regions: [{ id: 'top-left' }] },
  mapping: { 'agent-sfc-1': 'top-left' },
};

const surfaces: Record<string, SurfaceSnapshot> = {
  'agent-sfc-1': { components: [], dataModel: {}, visibleOnActivePage: true, region: 'top-left' },
};

function action(name: string): UserAction {
  return { name, timestamp: new Date(0).toISOString(), context: {} };
}

describe('buildAgentContext', () => {
  it('assembles transcript, actions, surfaces and pages', () => {
    const chatStore = new ChatStore();
    chatStore.push({ role: 'user', text: 'add a chart' });
    chatStore.push({ role: 'agent', text: 'done', surfaceId: 'agent-sfc-1' });

    const actionHarness = new ActionHarness();
    actionHarness.record(action('drillDown'));

    const ctx = buildAgentContext({
      chatStore,
      actionHarness,
      surfaces,
      pages: { tickets: ticketsPage },
      activeTabId: 'tickets',
      recentSurfaceIds: ['agent-sfc-1'],
      chatSurfaceIds: ['agent-sfc-1'],
    });

    expect(ctx.messages).toEqual([
      { role: 'user', content: 'add a chart' },
      { role: 'assistant', content: 'done', surfaceId: 'agent-sfc-1' },
    ]);
    expect(ctx.recentActions.map((a) => a.name)).toEqual(['drillDown']);
    expect(ctx.surfaces).toBe(surfaces);
    expect(ctx.pages.tickets).toBe(ticketsPage);
    expect(ctx.activeTabId).toBe('tickets');
  });

  it('derives mostRecentSurfaceId from the head of recentSurfaceIds', () => {
    const ctx = buildAgentContext({
      chatStore: new ChatStore(),
      actionHarness: new ActionHarness(),
      surfaces: {},
      pages: {},
      recentSurfaceIds: ['sfc-newest', 'sfc-older'],
    });
    expect(ctx.mostRecentSurfaceId).toBe('sfc-newest');
  });

  it('defaults mostRecentSurfaceId to null when no recent surfaces', () => {
    const ctx = buildAgentContext({
      chatStore: new ChatStore(),
      actionHarness: new ActionHarness(),
      surfaces: {},
      pages: {},
    });
    expect(ctx.mostRecentSurfaceId).toBeNull();
    expect(ctx.recentSurfaceIds).toEqual([]);
    expect(ctx.chatSurfaceIds).toEqual([]);
  });

  it('applies transcript and action windowing', () => {
    const chatStore = new ChatStore();
    for (let i = 0; i < 5; i++) chatStore.push({ role: 'user', text: `m${i}` });
    const actionHarness = new ActionHarness();
    for (let i = 0; i < 5; i++) actionHarness.record(action(`a${i}`));

    const ctx = buildAgentContext({
      chatStore,
      actionHarness,
      surfaces: {},
      pages: {},
      transcriptLimit: 2,
      actionLimit: 2,
    });

    expect(ctx.messages.map((m) => m.content)).toEqual(['m3', 'm4']);
    // getRecent returns newest-first.
    expect(ctx.recentActions.map((a) => a.name)).toEqual(['a4', 'a3']);
  });
});
