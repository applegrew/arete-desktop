import { describe, it, expect, vi } from 'vitest';
import { PageOpsHarness } from '../src/harness/PageOpsHarness';
import { applyPinSurface } from '../src/harness/ops/pinSurface';
import { applySetPageLayout } from '../src/harness/ops/setPageLayout';
import { applyUnpinSurface } from '../src/harness/ops/unpinSurface';
import { applyMoveSurface } from '../src/harness/ops/moveSurface';
import { applySetPageRegion } from '../src/harness/ops/setPageRegion';
import type { LayoutDescriptor } from '../src/page/layout-descriptor';
import type { PageMapping } from '../src/types/diff';

type State = { layout: LayoutDescriptor; mapping: PageMapping };

const twoByTwo: LayoutDescriptor = {
  kind: 'grid',
  rows: 2,
  cols: 2,
  regions: [{ id: 'tl' }, { id: 'tr' }, { id: 'bl' }, { id: 'br' }],
};

describe('applyPinSurface', () => {
  it('places into first empty region when none specified', () => {
    const r = applyPinSurface(
      { layout: twoByTwo, mapping: {} },
      { name: 'pinSurface', surfaceId: 's1', pageId: 'p' },
    );
    expect(r.mapping).toEqual({ s1: 'tl' });
  });

  it('honors explicit region when free', () => {
    const r = applyPinSurface(
      { layout: twoByTwo, mapping: { sX: 'tl' } },
      { name: 'pinSurface', surfaceId: 's1', pageId: 'p', region: 'br' },
    );
    expect(r.mapping).toEqual({ sX: 'tl', s1: 'br' });
  });

  it('throws when explicit region is occupied', () => {
    expect(() =>
      applyPinSurface(
        { layout: twoByTwo, mapping: { sX: 'tl' } },
        { name: 'pinSurface', surfaceId: 's1', pageId: 'p', region: 'tl' },
      ),
    ).toThrow(/occupied/);
  });
});

describe('applySetPageLayout', () => {
  it('keeps surviving regions and remaps displaced surfaces to free regions', () => {
    const r = applySetPageLayout(
      { layout: twoByTwo, mapping: { s1: 'tl', s2: 'br' } },
      {
        name: 'setPageLayout',
        pageId: 'p',
        layout: { kind: 'grid', rows: 1, cols: 2, regions: [{ id: 'tl' }, { id: 'right' }] },
      },
    );
    // s1 keeps 'tl' (still exists); s2's 'br' is gone → remapped to free 'right'.
    expect(r.mapping).toEqual({ s1: 'tl', s2: 'right' });
  });

  it('preserves all widgets when switching grid → row (no shared region ids)', () => {
    const row: LayoutDescriptor = { kind: 'row', regions: [{ id: 'left' }, { id: 'right' }] };
    const r = applySetPageLayout(
      { layout: twoByTwo, mapping: { s1: 'tl', s2: 'tr' } },
      { name: 'setPageLayout', pageId: 'p', layout: row },
    );
    // Both surfaces preserved, in visual order → left, right.
    expect(r.mapping).toEqual({ s1: 'left', s2: 'right' });
  });

  it('parks overflow in the last region rather than losing it', () => {
    const dock: LayoutDescriptor = { kind: 'dock', regions: [{ id: 'main' }] };
    const r = applySetPageLayout(
      { layout: twoByTwo, mapping: { s1: 'tl', s2: 'tr', s3: 'bl' } },
      { name: 'setPageLayout', pageId: 'p', layout: dock },
    );
    // Every surface retained (none dropped); overflow parked in 'main'.
    expect(Object.keys(r.mapping).sort()).toEqual(['s1', 's2', 's3']);
    expect(Object.values(r.mapping).every((rid) => rid === 'main')).toBe(true);
  });
});

describe('PageOpsHarness', () => {
  it('creates pending diff and approves into committed state', () => {
    const harness = new PageOpsHarness();
    let state: State = { layout: twoByTwo, mapping: { s1: 'tl' } };
    harness.registerPage('p', {
      getState: () => state,
      setState: (next) => {
        state = next;
      },
    });
    const onProposed = vi.fn();
    const onApprove = vi.fn();
    harness.setHooks({ onProposed, onApprove });

    harness.apply({ name: 'pinSurface', surfaceId: 's2', pageId: 'p' });
    expect(harness.hasPending('p')).toBe(true);
    expect(onProposed).toHaveBeenCalledOnce();
    expect(state.mapping).toEqual({ s1: 'tl' }); // not yet committed

    harness.approve('p');
    expect(harness.hasPending('p')).toBe(false);
    expect(onApprove).toHaveBeenCalledOnce();
    expect(state.mapping).toEqual({ s1: 'tl', s2: 'tr' });
  });

  it('reject leaves state untouched and fires onReject', () => {
    const harness = new PageOpsHarness();
    let state: State = { layout: twoByTwo, mapping: {} };
    harness.registerPage('p', { getState: () => state, setState: (n) => { state = n; } });
    const onReject = vi.fn();
    harness.setHooks({ onReject });

    harness.apply({ name: 'pinSurface', surfaceId: 's1', pageId: 'p' });
    harness.reject('p');
    expect(harness.hasPending('p')).toBe(false);
    expect(onReject).toHaveBeenCalledOnce();
    expect(state.mapping).toEqual({});
  });

  it('autoApprove skips pending and commits immediately', () => {
    const harness = new PageOpsHarness();
    let state: State = { layout: twoByTwo, mapping: {} };
    harness.registerPage('p', {
      getState: () => state,
      setState: (n) => { state = n; },
      autoApprove: true,
    });
    const onProposed = vi.fn();
    const onApprove = vi.fn();
    harness.setHooks({ onProposed, onApprove });

    harness.apply({ name: 'pinSurface', surfaceId: 's1', pageId: 'p' });
    expect(onProposed).not.toHaveBeenCalled();
    expect(onApprove).toHaveBeenCalledOnce();
    expect(state.mapping).toEqual({ s1: 'tl' });
  });
});

describe('PageOpsHarness — activation for inactive pages', () => {
  it('throws for an unregistered page when nothing can activate it', () => {
    const harness = new PageOpsHarness();
    expect(() => harness.apply({ name: 'pinSurface', surfaceId: 's1', pageId: 'p' })).toThrow(
      /No page registered/,
    );
  });

  it('queues the op, requests activation, and flushes when the page registers', () => {
    const harness = new PageOpsHarness();
    const onProposed = vi.fn();
    harness.setHooks({ onProposed });

    const activations: string[] = [];
    harness.subscribeActivation((pageId) => activations.push(pageId));

    // Page 'p' isn't mounted yet → op is deferred, activation requested.
    harness.apply({ name: 'pinSurface', surfaceId: 's1', pageId: 'p' });
    expect(activations).toEqual(['p']);
    expect(harness.hasPending('p')).toBe(false);
    expect(onProposed).not.toHaveBeenCalled();

    // Simulate the tab switch mounting the page → registration flushes the op.
    let state: State = { layout: twoByTwo, mapping: {} };
    harness.registerPage('p', { getState: () => state, setState: (n) => { state = n; } });

    expect(onProposed).toHaveBeenCalledOnce();
    expect(harness.hasPending('p')).toBe(true);
    harness.approve('p');
    expect(state.mapping).toEqual({ s1: 'tl' });
  });

  it('keeps a pending diff when the page unmounts and shows it on remount (StrictMode-safe)', () => {
    const harness = new PageOpsHarness();
    let state: State = { layout: twoByTwo, mapping: {} };
    const reg = { getState: () => state, setState: (n: State) => { state = n; } };

    harness.registerPage('p', reg);
    harness.apply({ name: 'pinSurface', surfaceId: 's1', pageId: 'p' });
    expect(harness.hasPending('p')).toBe(true);

    // Unmount (e.g. StrictMode cleanup or tab switch) must NOT drop the pending.
    const unregister = harness.registerPage('p', reg); // re-register handle
    unregister();
    expect(harness.hasPending('p')).toBe(true);

    // Remount → still pending → can be approved.
    harness.registerPage('p', reg);
    harness.approve('p');
    expect(state.mapping).toEqual({ s1: 'tl' });
  });

  it('does not crash when a malformed op targets a region the layout lacks (live apply)', () => {
    const harness = new PageOpsHarness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let state: State = { layout: twoByTwo, mapping: {} };
    harness.registerPage('p', { getState: () => state, setState: (n) => { state = n; } });
    const onProposed = vi.fn();
    harness.setHooks({ onProposed });

    // Region "main" doesn't exist on the 2x2 grid — must be dropped, not thrown.
    expect(() =>
      harness.apply({ name: 'setPageRegion', pageId: 'p', regionId: 'main', surfaceId: 's1' }),
    ).not.toThrow();
    expect(harness.hasPending('p')).toBe(false);
    expect(onProposed).not.toHaveBeenCalled();
    expect(state.mapping).toEqual({});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not crash when a malformed queued op flushes on registration', () => {
    const harness = new PageOpsHarness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    harness.subscribeActivation(() => {});

    // Deferred while the page is unmounted (mirrors the agent emitting a bad
    // setPageRegion for an inactive tab), then flushed during registration —
    // the path that previously crashed the app during render.
    harness.apply({ name: 'setPageRegion', pageId: 'logs', regionId: 'main', surfaceId: 's1' });
    let state: State = { layout: twoByTwo, mapping: {} };
    expect(() =>
      harness.registerPage('logs', { getState: () => state, setState: (n) => { state = n; } }),
    ).not.toThrow();
    expect(harness.hasPending('logs')).toBe(false);
    expect(state.mapping).toEqual({});
    warn.mockRestore();
  });

  it('ignores a malformed op (no target page) — no activation, no throw, no state change', () => {
    const harness = new PageOpsHarness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const activations: string[] = [];
    harness.subscribeActivation((pageId) => activations.push(pageId));
    let state: State = { layout: twoByTwo, mapping: {} };
    harness.registerPage('p', { getState: () => state, setState: (n) => { state = n; } });

    // Empty op (mirrors a small model emitting {kind:'pageOp', op:{}}): must NOT
    // trigger activation (which would switch the Shell to a non-existent tab).
    expect(() => harness.apply({} as never)).not.toThrow();
    expect(activations).toEqual([]);
    expect(harness.hasPending('p')).toBe(false);
    expect(state.mapping).toEqual({});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not request activation when the page is already registered', () => {
    const harness = new PageOpsHarness();
    let state: State = { layout: twoByTwo, mapping: {} };
    harness.registerPage('p', { getState: () => state, setState: (n) => { state = n; } });
    const activations: string[] = [];
    harness.subscribeActivation((pageId) => activations.push(pageId));

    harness.apply({ name: 'pinSurface', surfaceId: 's1', pageId: 'p' });
    expect(activations).toEqual([]);
    expect(harness.hasPending('p')).toBe(true);
  });
});

describe('applyUnpinSurface', () => {
  it('removes a pinned surface from the mapping', () => {
    const r = applyUnpinSurface(
      { layout: twoByTwo, mapping: { s1: 'tl', s2: 'br' } },
      { name: 'unpinSurface', surfaceId: 's1', pageId: 'p' },
    );
    expect(r.mapping).toEqual({ s2: 'br' });
  });

  it('is a no-op when the surface is not pinned', () => {
    const r = applyUnpinSurface(
      { layout: twoByTwo, mapping: { s2: 'br' } },
      { name: 'unpinSurface', surfaceId: 's1', pageId: 'p' },
    );
    expect(r.mapping).toEqual({ s2: 'br' });
  });

  it('leaves layout unchanged', () => {
    const r = applyUnpinSurface(
      { layout: twoByTwo, mapping: { s1: 'tl' } },
      { name: 'unpinSurface', surfaceId: 's1', pageId: 'p' },
    );
    expect(r.layout).toBe(twoByTwo);
  });
});

describe('applyMoveSurface', () => {
  it('moves a surface to a different free region', () => {
    const r = applyMoveSurface(
      { layout: twoByTwo, mapping: { s1: 'tl', s2: 'br' } },
      { name: 'moveSurface', surfaceId: 's1', pageId: 'p', targetRegion: 'tr' },
    );
    expect(r.mapping).toEqual({ s1: 'tr', s2: 'br' });
  });

  it('no-ops when moving to the same region', () => {
    const r = applyMoveSurface(
      { layout: twoByTwo, mapping: { s1: 'tl' } },
      { name: 'moveSurface', surfaceId: 's1', pageId: 'p', targetRegion: 'tl' },
    );
    expect(r.mapping).toEqual({ s1: 'tl' });
  });

  it('throws when surface is not pinned on the page', () => {
    expect(() =>
      applyMoveSurface(
        { layout: twoByTwo, mapping: {} },
        { name: 'moveSurface', surfaceId: 's1', pageId: 'p', targetRegion: 'tr' },
      ),
    ).toThrow(/not pinned/);
  });

  it('throws when target region does not exist', () => {
    expect(() =>
      applyMoveSurface(
        { layout: twoByTwo, mapping: { s1: 'tl' } },
        { name: 'moveSurface', surfaceId: 's1', pageId: 'p', targetRegion: 'nowhere' },
      ),
    ).toThrow(/does not exist/);
  });

  it('throws when target region is occupied', () => {
    expect(() =>
      applyMoveSurface(
        { layout: twoByTwo, mapping: { s1: 'tl', s2: 'br' } },
        { name: 'moveSurface', surfaceId: 's1', pageId: 'p', targetRegion: 'br' },
      ),
    ).toThrow(/occupied/);
  });
});

describe('applySetPageRegion', () => {
  it('places a surface in the specified region', () => {
    const r = applySetPageRegion(
      { layout: twoByTwo, mapping: {} },
      { name: 'setPageRegion', pageId: 'p', regionId: 'tl', surfaceId: 's1' },
    );
    expect(r.mapping).toEqual({ s1: 'tl' });
  });

  it('replaces an existing surface in the region', () => {
    const r = applySetPageRegion(
      { layout: twoByTwo, mapping: { s1: 'tl' } },
      { name: 'setPageRegion', pageId: 'p', regionId: 'tl', surfaceId: 's2' },
    );
    expect(r.mapping).toEqual({ s2: 'tl' });
  });

  it('removes old entry when repinning the same surface to a new region', () => {
    const r = applySetPageRegion(
      { layout: twoByTwo, mapping: { s1: 'tl', s2: 'br' } },
      { name: 'setPageRegion', pageId: 'p', regionId: 'tr', surfaceId: 's2' },
    );
    expect(r.mapping).toEqual({ s1: 'tl', s2: 'tr' });
  });

  it('clears a region when surfaceId is null', () => {
    const r = applySetPageRegion(
      { layout: twoByTwo, mapping: { s1: 'tl', s2: 'br' } },
      { name: 'setPageRegion', pageId: 'p', regionId: 'tl', surfaceId: null },
    );
    expect(r.mapping).toEqual({ s2: 'br' });
  });

  it('no-ops when clearing an already-empty region', () => {
    const r = applySetPageRegion(
      { layout: twoByTwo, mapping: { s2: 'br' } },
      { name: 'setPageRegion', pageId: 'p', regionId: 'tl', surfaceId: null },
    );
    expect(r.mapping).toEqual({ s2: 'br' });
  });

  it('throws when region does not exist', () => {
    expect(() =>
      applySetPageRegion(
        { layout: twoByTwo, mapping: {} },
        { name: 'setPageRegion', pageId: 'p', regionId: 'nowhere', surfaceId: 's1' },
      ),
    ).toThrow(/does not exist/);
  });

  it('leaves layout unchanged', () => {
    const r = applySetPageRegion(
      { layout: twoByTwo, mapping: {} },
      { name: 'setPageRegion', pageId: 'p', regionId: 'tl', surfaceId: 's1' },
    );
    expect(r.layout).toBe(twoByTwo);
  });
});

describe('PageOpsHarness with new ops', () => {
  it('approves unpinSurface through pending cycle', () => {
    const harness = new PageOpsHarness();
    let state: State = { layout: twoByTwo, mapping: { s1: 'tl', s2: 'br' } };
    harness.registerPage('p', {
      getState: () => state,
      setState: (next) => { state = next; },
    });
    harness.apply({ name: 'unpinSurface', surfaceId: 's1', pageId: 'p' });
    expect(harness.hasPending('p')).toBe(true);
    expect(state.mapping).toEqual({ s1: 'tl', s2: 'br' });
    harness.approve('p');
    expect(state.mapping).toEqual({ s2: 'br' });
  });

  it('approves moveSurface through pending cycle', () => {
    const harness = new PageOpsHarness();
    let state: State = { layout: twoByTwo, mapping: { s1: 'tl', s2: 'br' } };
    harness.registerPage('p', {
      getState: () => state,
      setState: (next) => { state = next; },
    });
    harness.apply({ name: 'moveSurface', surfaceId: 's1', pageId: 'p', targetRegion: 'tr' });
    harness.approve('p');
    expect(state.mapping).toEqual({ s1: 'tr', s2: 'br' });
  });

  it('approves setPageRegion through pending cycle', () => {
    const harness = new PageOpsHarness();
    let state: State = { layout: twoByTwo, mapping: {} };
    harness.registerPage('p', {
      getState: () => state,
      setState: (next) => { state = next; },
    });
    harness.apply({ name: 'setPageRegion', pageId: 'p', regionId: 'tl', surfaceId: 's1' });
    harness.approve('p');
    expect(state.mapping).toEqual({ s1: 'tl' });
  });

  it('rejects unpinSurface and leaves state unchanged', () => {
    const harness = new PageOpsHarness();
    let state: State = { layout: twoByTwo, mapping: { s1: 'tl' } };
    harness.registerPage('p', {
      getState: () => state,
      setState: (next) => { state = next; },
    });
    harness.apply({ name: 'unpinSurface', surfaceId: 's1', pageId: 'p' });
    harness.reject('p');
    expect(state.mapping).toEqual({ s1: 'tl' });
  });
});
