import type { LayoutDescriptor } from '../../page/layout-descriptor';
import type { PinSurfaceOp } from '../../types/page-ops';
import type { PageMapping } from '../../types/diff';

export interface PinSurfaceInput {
  layout: LayoutDescriptor;
  mapping: PageMapping;
}

export interface PinSurfaceResult {
  layout: LayoutDescriptor;
  mapping: PageMapping;
}

/**
 * Pure reducer. Returns the next mapping with the surface placed at:
 *   1. `op.region` if explicitly provided
 *   2. otherwise the first EMPTY region in `layout.regions` order
 *   3. otherwise the first region (replacing its occupant)
 *
 * Pin intent wins: if the chosen region is already occupied by a DIFFERENT surface,
 * that surface is displaced (unpinned — it falls back to the chat scroll) rather
 * than the pin being dropped. This matches "add it to page" on a single-region dock
 * page, where there is no empty region to fall back to. Throws only if the layout
 * has no regions at all. Layout is unchanged.
 */
export function applyPinSurface(input: PinSurfaceInput, op: PinSurfaceOp): PinSurfaceResult {
  const used = new Set(Object.values(input.mapping));
  const target =
    op.region ??
    input.layout.regions.find((r) => !used.has(r.id))?.id ??
    input.layout.regions[0]?.id;
  if (!target) {
    throw new Error(`Page "${op.pageId}" has no regions to pin into`);
  }
  const nextMapping: PageMapping = { ...input.mapping };
  // Displace whatever currently occupies the target region (it becomes unpinned),
  // and remove this surface's own prior position if it was pinned elsewhere.
  for (const [sid, rid] of Object.entries(nextMapping)) {
    if (rid === target) delete nextMapping[sid];
  }
  delete nextMapping[op.surfaceId];
  nextMapping[op.surfaceId] = target;
  return { layout: input.layout, mapping: nextMapping };
}
