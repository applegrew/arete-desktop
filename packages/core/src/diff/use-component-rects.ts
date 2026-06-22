import { useEffect, useRef, useState, type RefObject } from 'react';

export interface ComponentRects {
  /** Rects measured after the latest render (i.e. after shadow paints). */
  current: Map<string, DOMRect>;
  /** Rects captured before the most recent pending diff appeared. Used for removed components. */
  prev: Map<string, DOMRect>;
}

/**
 * Track DOMRects for every `[data-a2ui-component-id]` element inside `containerRef`.
 *
 * Returns a stable object whose `current` map reflects the live DOM and whose `prev`
 * map is a snapshot from just before `pendingKey` changed. Use `prev` to draw outlines
 * for removed components (which are no longer in the DOM).
 *
 * `pendingKey` is any value that flips when a new pending diff arrives — typically
 * `pending ? pending.surfaceId + ':' + pending.timestamp : null`. When it changes,
 * we snapshot current → prev *before* React re-renders the children with the shadow.
 */
export function useComponentRects(
  containerRef: RefObject<HTMLElement | null>,
  pendingKey: string | null,
): ComponentRects {
  const [rects, setRects] = useState<ComponentRects>(() => ({
    current: new Map(),
    prev: new Map(),
  }));
  const prevPendingKey = useRef<string | null>(null);

  // Snapshot current → prev whenever a NEW (different) pending diff appears, before
  // its shadow paints. Triggering on any key change — not just null→non-null — keeps
  // `prev` fresh across diff→diff transitions (a second/re-based diff on the same
  // surface), so "removed" outlines aren't drawn against rects from before the first.
  if (pendingKey !== null && pendingKey !== prevPendingKey.current) {
    rects.prev = new Map(rects.current);
  }
  prevPendingKey.current = pendingKey;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const map = new Map<string, DOMRect>();
      el.querySelectorAll<HTMLElement>('[data-a2ui-component-id]').forEach((node) => {
        const id = node.getAttribute('data-a2ui-component-id');
        if (id != null) map.set(id, node.getBoundingClientRect());
      });
      setRects((prev) => ({ current: map, prev: prev.prev }));
    };

    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    const mutate = new MutationObserver(measure);
    mutate.observe(el, { childList: true, subtree: true, attributes: true });

    return () => {
      resize.disconnect();
      mutate.disconnect();
    };
    // We deliberately re-run on pendingKey so the measurement reflects the latest paint
     
  }, [containerRef, pendingKey]);

  return rects;
}
