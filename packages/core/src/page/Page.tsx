import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { A2uiSurface, type ReactComponentImplementation } from '@a2ui/react/v0_9';
import type { MessageProcessor, SurfaceModel } from '@a2ui/web_core/v0_9';
import { RegionLayout } from './RegionLayout';
import type { LayoutDescriptor } from './layout-descriptor';
import { DiffOverlay } from '../diff/DiffOverlay';
import type { DiffRouter } from '../diff/diff-router';
import type { PageOpsHarness } from '../harness/PageOpsHarness';
import type { PageMapping } from '../types/diff';
import { SurfaceIdProvider } from '../action/ActionHarnessContext';

export interface PageProps {
  pageId: string;
  layout: LayoutDescriptor;
  /** Initial surfaceId → regionId mapping. After mount, mapping changes via harness ops. */
  initialMapping?: Record<string, string>;
  /** Externally controlled mapping (when omitted, Page owns it internally). */
  mapping?: Record<string, string>;
  onMappingChange?: (next: Record<string, string>) => void;
  externalLayout?: LayoutDescriptor;
  onLayoutChange?: (next: LayoutDescriptor) => void;
  /** When provided, surfaces are wrapped in `<DiffOverlay>` and reflect any pending diffs. */
  router?: DiffRouter;
  /** Required when `router` is omitted. Direct-ingest mode (no diff gating). */
  processor?: MessageProcessor<ReactComponentImplementation>;
  /** When provided, the Page registers with the harness so page ops can target it. */
  harness?: PageOpsHarness;
  /** Surface to briefly highlight (halo) — e.g. when locating a surface moved here from chat. */
  highlightSurfaceId?: string | null;
}

export function Page(props: PageProps) {
  const {
    pageId,
    layout: layoutProp,
    initialMapping,
    mapping: mappingProp,
    onMappingChange,
    externalLayout,
    onLayoutChange,
    router,
    processor,
    harness,
    highlightSurfaceId,
  } = props;

  const live = router?.live ?? processor;
  if (!live) {
    throw new Error('<Page> requires either `router` or `processor`');
  }

  const [internalMapping, setInternalMapping] = useState<PageMapping>(initialMapping ?? {});
  const [internalLayout, setInternalLayout] = useState<LayoutDescriptor>(externalLayout ?? layoutProp);
  const mapping = mappingProp ?? internalMapping;
  const layout = externalLayout ?? internalLayout;

  // Keep a ref to current state for the harness registration's getState closure.
  const stateRef = useRef({ layout, mapping });
  stateRef.current = { layout, mapping };

  const setMapping = (next: PageMapping) => {
    if (mappingProp) onMappingChange?.(next);
    else setInternalMapping(next);
  };
  const setLayout = (next: LayoutDescriptor) => {
    if (externalLayout) onLayoutChange?.(next);
    else setInternalLayout(next);
  };

  // Re-render whenever the live processor's surface set or the router state changes.
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const subA = live.onSurfaceCreated(() => forceUpdate((n) => n + 1));
    const subB = live.onSurfaceDeleted(() => forceUpdate((n) => n + 1));
    const unsub = router?.subscribe(() => forceUpdate((n) => n + 1));
    return () => {
      subA.unsubscribe();
      subB.unsubscribe();
      unsub?.();
    };
  }, [live, router]);

  // Register with the harness so page ops can drive layout + mapping changes.
  useEffect(() => {
    if (!harness) return;
    return harness.registerPage(pageId, {
      getState: () => stateRef.current,
      setState: ({ layout: nextLayout, mapping: nextMapping }) => {
        setMapping(nextMapping);
        setLayout(nextLayout);
      },
    });
    // setMapping/setLayout are stable in walking-skeleton usage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harness, pageId]);

  // Subscribe to harness pending diff for this page.
  const pendingPageDiff = useSyncExternalStore(
    (cb) => (harness ? harness.subscribe(cb) : () => {}),
    () => (harness ? (harness.hasPending(pageId) ? '1' : '0') : '0'),
  );

  const regionToSurfaceId = useMemo(() => {
    const map = new Map<string, string>();
    for (const [surfaceId, regionId] of Object.entries(mapping)) {
      map.set(regionId, surfaceId);
    }
    return map;
  }, [mapping]);

  const renderSurfaceFor = (regionId: string, source: 'live' | 'ghost'): ReactNode => {
    const surfaceId = regionToSurfaceId.get(regionId);
    if (!surfaceId) {
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-faint, #555)',
            fontSize: 12,
            fontStyle: 'italic',
          }}
        >
          (empty)
        </div>
      );
    }
    const liveSurface: SurfaceModel<ReactComponentImplementation> | undefined =
      live.model.getSurface(surfaceId);
    if (source === 'ghost') {
      return liveSurface ? <A2uiSurface surface={liveSurface} /> : null;
    }
    if (router) {
      return (
        <DiffOverlay router={router} surfaceId={surfaceId}>
          {liveSurface ? <A2uiSurface surface={liveSurface} /> : null}
        </DiffOverlay>
      );
    }
    return liveSurface ? (
      <SurfaceIdProvider surfaceId={surfaceId}>
        <A2uiSurface surface={liveSurface} />
      </SurfaceIdProvider>
    ) : null;
  };

  const pending = harness?.getPending(pageId);
  const showingGhost = pending != null && pendingPageDiff === '1';

  const isLayoutChange = useMemo(() => {
    if (!pending) return false;
    const a = pending.prev.layout;
    const b = pending.next.layout;
    if (a.kind !== b.kind) return true;
    if (a.kind === 'grid' && b.kind === 'grid') {
      if (a.rows !== b.rows || a.cols !== b.cols) return true;
      if (a.regions.length !== b.regions.length) return true;
      const aIds = a.regions.map((r) => r.id).join(',');
      const bIds = b.regions.map((r) => r.id).join(',');
      return aIds !== bIds;
    }
    if ((a.kind === 'row' || a.kind === 'column' || a.kind === 'dock') && (b.kind === 'row' || b.kind === 'column' || b.kind === 'dock')) {
      const aIds = a.regions.map((r) => r.id).join(',');
      const bIds = b.regions.map((r) => r.id).join(',');
      return aIds !== bIds;
    }
    return false;
  }, [pending]);

  const changedRegions = useMemo(() => {
    const set = new Set<string>();
    if (!pending || isLayoutChange) return set;
    const prevR2S = new Map<string, string>();
    for (const [sid, rid] of Object.entries(pending.prev.mapping)) prevR2S.set(rid, sid);
    const nextR2S = new Map<string, string>();
    for (const [sid, rid] of Object.entries(pending.next.mapping)) nextR2S.set(rid, sid);
    const all = new Set([...prevR2S.keys(), ...nextR2S.keys()]);
    for (const rid of all) {
      if (prevR2S.get(rid) !== nextR2S.get(rid)) set.add(rid);
    }
    return set;
  }, [pending, isLayoutChange]);

  const nextRegionToSurfaceId = useMemo(() => {
    const map = new Map<string, string>();
    if (!pending) return map;
    for (const [sid, rid] of Object.entries(pending.next.mapping)) map.set(rid, sid);
    return map;
  }, [pending]);

  const renderRegionWithDiff = (regionId: string): ReactNode => {
    const isChanged = changedRegions.has(regionId);
    if (!isChanged) {
      return renderSurfaceFor(regionId, 'live');
    }
    // Region is changing — render NEXT state with a yellow dashed border + ghost styling.
    const nextSurfaceId = nextRegionToSurfaceId.get(regionId);
    const liveSurface = nextSurfaceId ? live.model.getSurface(nextSurfaceId) : undefined;
    return (
      <div
        style={{
          height: '100%',
          border: '2px dashed #eab308',
          borderRadius: 4,
          padding: 4,
          boxSizing: 'border-box',
          opacity: 0.85,
        }}
      >
        {liveSurface ? <A2uiSurface surface={liveSurface} /> : (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#eab308',
            fontSize: 12,
            fontStyle: 'italic',
          }}>
            (empty)
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      data-page-id={pageId}
      style={{
        height: '100%',
        width: '100%',
        padding: 18,
        boxSizing: 'border-box',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {showingGhost && pending && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: '#1f2937',
            color: '#eee',
            padding: '6px 10px',
            borderRadius: 4,
            fontSize: 12,
            marginBottom: 4,
            border: '1px solid #eab308',
          }}
        >
          <strong>Pending {pending.op.name}</strong>
          <span style={{ color: '#888' }}>· preview shown below</span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => harness?.approve(pageId)}
            style={{
              background: '#22c55e',
              color: '#000',
              border: 'none',
              borderRadius: 3,
              padding: '2px 10px',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => harness?.reject(pageId)}
            style={{
              background: '#ef4444',
              color: '#fff',
              border: 'none',
              borderRadius: 3,
              padding: '2px 10px',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            Reject
          </button>
        </div>
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          opacity: showingGhost && isLayoutChange ? 0.45 : 1,
        }}
      >
        <RegionLayout
          layout={layout}
          renderRegion={showingGhost ? renderRegionWithDiff : (rid) => renderSurfaceFor(rid, 'live')}
          highlightRegionId={highlightSurfaceId ? mapping[highlightSurfaceId] : undefined}
        />
      </div>
      {showingGhost && pending && isLayoutChange && (
        <div
          style={{
            position: 'absolute',
            top: 44,
            left: 8,
            right: 8,
            bottom: 8,
            pointerEvents: 'none',
            border: '2px dashed #eab308',
            borderRadius: 4,
            padding: 4,
          }}
        >
          <div style={{ height: '100%' }}>
            <RegionLayoutGhost layout={pending.next.layout} mapping={pending.next.mapping} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Cheap ghost render — region grid + surface IDs as labels, no full A2UI rendering. */
function RegionLayoutGhost({
  layout,
  mapping,
}: {
  layout: LayoutDescriptor;
  mapping: PageMapping;
}) {
  const regionToSurface = new Map<string, string>();
  for (const [sid, rid] of Object.entries(mapping)) regionToSurface.set(rid, sid);
  return (
    <RegionLayout
      layout={layout}
      renderRegion={(regionId) => (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#eab308',
            fontSize: 12,
            fontFamily: 'monospace',
          }}
        >
          {regionToSurface.get(regionId) ?? '(empty)'}
        </div>
      )}
    />
  );
}
