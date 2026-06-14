import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { A2uiSurface, type ReactComponentImplementation } from '@a2ui/react/v0_9';
import type { MessageProcessor, SurfaceModel } from '@a2ui/web_core/v0_9';
import { RegionLayout } from './RegionLayout';
import type { LayoutDescriptor } from './layout-descriptor';
import { DiffOverlay } from '../diff/DiffOverlay';
import { SurfaceBoundary } from '../components/SurfaceBoundary';
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
      return liveSurface ? (
        <SurfaceIdProvider surfaceId={surfaceId}>
          <SurfaceBoundary resetKey={surfaceId} label={surfaceId}>
            <A2uiSurface surface={liveSurface} />
          </SurfaceBoundary>
        </SurfaceIdProvider>
      ) : null;
    }
    if (router) {
      return (
        <DiffOverlay router={router} surfaceId={surfaceId}>
          {liveSurface ? (
            <SurfaceIdProvider surfaceId={surfaceId}>
              <SurfaceBoundary resetKey={surfaceId} label={surfaceId}>
                <A2uiSurface surface={liveSurface} />
              </SurfaceBoundary>
            </SurfaceIdProvider>
          ) : null}
        </DiffOverlay>
      );
    }
    return liveSurface ? (
      <SurfaceIdProvider surfaceId={surfaceId}>
        <SurfaceBoundary resetKey={surfaceId} label={surfaceId}>
          <A2uiSurface surface={liveSurface} />
        </SurfaceBoundary>
      </SurfaceIdProvider>
    ) : null;
  };

  const pending = harness?.getPending(pageId);
  const showingGhost = pending != null && pendingPageDiff === '1';

  // Region ids whose content differs between the committed and proposed state —
  // highlighted in the preview so the user sees exactly what's being added/moved.
  const changedRegionIds = useMemo(() => {
    const set = new Set<string>();
    if (!pending) return set;
    const prevR2S = new Map<string, string>();
    for (const [sid, rid] of Object.entries(pending.prev.mapping)) prevR2S.set(rid, sid);
    const nextR2S = new Map<string, string>();
    for (const [sid, rid] of Object.entries(pending.next.mapping)) nextR2S.set(rid, sid);
    for (const r of pending.next.layout.regions) {
      if (prevR2S.get(r.id) !== nextR2S.get(r.id)) set.add(r.id);
    }
    return set;
  }, [pending]);

  // Region → surface for whichever state we're rendering (proposed while previewing).
  const previewR2S = useMemo(() => {
    const map = new Map<string, string>();
    const src = showingGhost && pending ? pending.next.mapping : mapping;
    for (const [sid, rid] of Object.entries(src)) map.set(rid, sid);
    return map;
  }, [showingGhost, pending, mapping]);

  // WYSIWYG preview of the proposed page: renders the REAL surfaces in their
  // proposed regions (no surface-id text, no overlap with the old layout), with a
  // dashed highlight on regions that changed.
  const renderRegionPreview = (regionId: string): ReactNode => {
    const surfaceId = previewR2S.get(regionId);
    const liveSurface = surfaceId ? live.model.getSurface(surfaceId) : undefined;
    const inner = liveSurface ? (
      <SurfaceIdProvider surfaceId={surfaceId!}>
        <SurfaceBoundary resetKey={surfaceId} label={surfaceId!}>
          <A2uiSurface surface={liveSurface} />
        </SurfaceBoundary>
      </SurfaceIdProvider>
    ) : (
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
    if (!changedRegionIds.has(regionId)) return inner;
    return (
      <div
        style={{
          height: '100%',
          border: '2px dashed #eab308',
          borderRadius: 8,
          padding: 4,
          boxSizing: 'border-box',
        }}
      >
        {inner}
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
      <div style={{ flex: 1, minHeight: 0 }}>
        <RegionLayout
          layout={showingGhost && pending ? pending.next.layout : layout}
          renderRegion={showingGhost ? renderRegionPreview : (rid) => renderSurfaceFor(rid, 'live')}
          highlightRegionId={highlightSurfaceId ? mapping[highlightSurfaceId] : undefined}
        />
      </div>
    </div>
  );
}
