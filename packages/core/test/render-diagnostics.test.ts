import { describe, it, expect, vi } from 'vitest';
import { RenderDiagnosticsStore } from '../src/diagnostics/RenderDiagnosticsStore';
import { ChatStore } from '../src/chat/ChatStore';
import { ActionHarness } from '../src/action/ActionHarness';
import { buildAgentContext } from '../src/agent/context';

describe('RenderDiagnosticsStore', () => {
  it('reports, aggregates, and filters by surface', () => {
    const s = new RenderDiagnosticsStore();
    s.report('sfc-1', 'root', [
      { surfaceId: 'sfc-1', componentId: 'root', severity: 'warning', code: 'a', message: 'x' },
    ]);
    s.report('sfc-2', 'root', [
      { surfaceId: 'sfc-2', componentId: 'root', severity: 'info', code: 'b', message: 'y' },
    ]);
    expect(s.getAll()).toHaveLength(2);
    expect(s.getBySurface('sfc-1').map((d) => d.code)).toEqual(['a']);
  });

  it('replaces diagnostics for a component and clears on empty', () => {
    const s = new RenderDiagnosticsStore();
    s.report('sfc-1', 'root', [
      { surfaceId: 'sfc-1', componentId: 'root', severity: 'warning', code: 'a', message: 'x' },
    ]);
    s.report('sfc-1', 'root', []); // empty clears
    expect(s.getAll()).toEqual([]);
  });

  it('notifies subscribers on change', () => {
    const s = new RenderDiagnosticsStore();
    const cb = vi.fn();
    s.subscribe(cb);
    s.report('sfc-1', 'root', [
      { surfaceId: 'sfc-1', componentId: 'root', severity: 'error', code: 'a', message: 'x' },
    ]);
    expect(cb).toHaveBeenCalledOnce();
  });
});

describe('buildAgentContext — diagnostics + componentHints', () => {
  it('includes current diagnostics and passes component hints through', () => {
    const renderDiagnostics = new RenderDiagnosticsStore();
    renderDiagnostics.report('sfc-1', 'root', [
      { surfaceId: 'sfc-1', componentId: 'root', severity: 'warning', code: 'chart.x', message: 'm' },
    ]);

    const ctx = buildAgentContext({
      chatStore: new ChatStore(),
      actionHarness: new ActionHarness(),
      renderDiagnostics,
      surfaces: {},
      pages: {},
      componentHints: { Chart: 'bar charts have no per-bar legend' },
    });

    expect(ctx.diagnostics.map((d) => d.code)).toEqual(['chart.x']);
    expect(ctx.componentHints?.Chart).toContain('legend');
  });

  it('defaults diagnostics to empty when no store is provided', () => {
    const ctx = buildAgentContext({
      chatStore: new ChatStore(),
      actionHarness: new ActionHarness(),
      surfaces: {},
      pages: {},
    });
    expect(ctx.diagnostics).toEqual([]);
  });
});
