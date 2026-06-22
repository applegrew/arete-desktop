import { useEffect, useRef, useSyncExternalStore, useState, type ReactNode } from 'react';
import { A2uiSurface } from '@a2ui/react/v0_9';
import type { DiffRouter } from './diff-router';
import { useComponentRects } from './use-component-rects';
import { injectDiffStyles } from './style-injector';
import { diffPalette, liveDim, transitions } from './visual-tokens';
import { ApprovalBar, type ApprovalBarPlacement } from './ApprovalBar';
import { deriveSurfaceLabel, describeContentChange, formatContentDiffMessage } from './describe';
import { SurfaceIdProvider } from '../action/ActionHarnessContext';

export interface DiffOverlayProps {
  router: DiffRouter;
  surfaceId: string;
  /** Optional display name for the surface in approval-bar copy. */
  title?: string;
  /**
   * Where to render the approval bar. `overlay` (default) floats the bar over the surface;
   * use `inline` for short surface cards (e.g. chat scroll items) where floating would occlude content.
   */
  placement?: ApprovalBarPlacement;
  /** Render slot when there is no pending diff. Typically `<A2uiSurface surface={liveSurface} />`. */
  children?: ReactNode;
}

export function DiffOverlay({ router, surfaceId, title, placement = 'overlay', children }: DiffOverlayProps) {
  // Inject styles as a commit-time side effect, not during render (render must be
  // pure). injectDiffStyles is idempotent, so this stays a no-op after the first.
  useEffect(() => {
    injectDiffStyles();
  }, []);

  useSyncExternalStore(
    (cb) => router.subscribe(cb),
    () => router.hasPending(surfaceId).toString(),
  );

  const pending = router.getPending(surfaceId);
  const shadowSurface = router.getShadowSurface(surfaceId);

  const containerRef = useRef<HTMLDivElement>(null);
  const pendingKey = pending ? `${pending.surfaceId}:${pending.bufferedMessages.length}` : null;
  const rects = useComponentRects(containerRef, pendingKey);

  // Track fade-out on transition pending → none for the rejection animation (Mockup 5).
  const [fadeOut, setFadeOut] = useState(false);
  const prevHadPending = useRef(false);
  useEffect(() => {
    if (prevHadPending.current && !pending) {
      setFadeOut(true);
      const t = setTimeout(() => setFadeOut(false), transitions.rejectFadeMs);
      return () => clearTimeout(t);
    }
    prevHadPending.current = !!pending;
  }, [pending]);

  // Compute container rect for converting page-relative DOMRects to local coords.
  const containerRect = containerRef.current?.getBoundingClientRect();

  return (
    <SurfaceIdProvider surfaceId={surfaceId}>
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: placement === 'overlay' ? '100%' : 'auto',
        boxSizing: 'border-box',
        display: placement === 'inline' ? 'flex' : undefined,
        flexDirection: placement === 'inline' ? 'column' : undefined,
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: placement === 'overlay' ? '100%' : 'auto',
          opacity: pending ? liveDim.contentPending : 1,
          transition: `opacity ${transitions.rejectFadeMs}ms ease`,
        }}
      >
        {pending && shadowSurface ? <A2uiSurface surface={shadowSurface} /> : children}
      </div>

      {pending && containerRect && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            opacity: fadeOut ? 0 : 1,
            transition: `opacity ${transitions.rejectFadeMs}ms ease`,
          }}
        >
          {pending.diff.added.map((id) => (
            <ComponentBox
              key={`a-${id}`}
              rect={rects.current.get(id)}
              containerRect={containerRect}
              kind="added"
            />
          ))}
          {pending.diff.changed.map((id) => (
            <ComponentBox
              key={`c-${id}`}
              rect={rects.current.get(id)}
              containerRect={containerRect}
              kind="changed"
            />
          ))}
          {pending.diff.moved.map((id) => (
            <ComponentBox
              key={`m-${id}`}
              rect={rects.current.get(id)}
              containerRect={containerRect}
              kind="moved"
            />
          ))}
          {pending.diff.removed.map((id) => (
            <ComponentBox
              key={`r-${id}`}
              rect={rects.prev.get(id)}
              containerRect={containerRect}
              kind="removed"
            />
          ))}
        </div>
      )}

      {pending && (
        <ApprovalBar
          variant="content"
          placement={placement}
          message={formatContentDiffMessage(
            title ?? deriveSurfaceLabel(shadowSurface ?? router.getLiveSurface(surfaceId)),
            describeContentChange(pending.diff, router.getLiveSurface(surfaceId), shadowSurface),
          )}
          onApprove={() => router.approve(surfaceId)}
          onReject={() => router.reject(surfaceId)}
        />
      )}
    </div>
    </SurfaceIdProvider>
  );
}

interface ComponentBoxProps {
  rect: DOMRect | undefined;
  containerRect: DOMRect;
  kind: 'added' | 'changed' | 'removed' | 'moved';
}

function ComponentBox({ rect, containerRect, kind }: ComponentBoxProps) {
  if (!rect) return null;
  const palette = diffPalette[kind];
  const borderStyle = kind === 'added' || kind === 'moved' ? 'dashed' : 'solid';
  const isChanged = kind === 'changed';
  return (
    <div
      className={isChanged ? 'arete-diff-box-changed' : undefined}
      style={{
        position: 'absolute',
        top: rect.top - containerRect.top,
        left: rect.left - containerRect.left,
        width: rect.width,
        height: rect.height,
        background: hexAlpha(palette.bg, 0.4),
        border: `2px ${borderStyle} ${palette.border}`,
        borderRadius: 4,
        boxSizing: 'border-box',
      }}
    />
  );
}

/** Convert a hex colour and alpha (0..1) to rgba() for a translucent fill. */
function hexAlpha(hex: string, alpha: number): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
