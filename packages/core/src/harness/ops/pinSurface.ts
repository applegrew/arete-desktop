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
 *   1. `op.region` if explicitly provided — which MUST exist and be free, otherwise
 *      throws (consistent with moveSurface: an explicit target is a hard request).
 *   2. otherwise the first EMPTY region in `layout.regions` order
 *   3. otherwise the first region (displacing its occupant — last resort for a
 *      single-region dock where there is no empty region to fall back to)
 *
 * Throws if the layout has no regions, or if an explicit region is missing/occupied.
 * Layout is unchanged.
 */
export function applyPinSurface(input: PinSurfaceInput, op: PinSurfaceOp): PinSurfaceResult {
  const used = new Set(Object.values(input.mapping));
  if (op.region) {
    // Explicit target: don't silently displace — fail loudly like moveSurface so
    // chained ops compose predictably and nothing is silently knocked off the page.
    if (!input.layout.regions.some((r) => r.id === op.region)) {
      throw new Error(`Region "${op.region}" does not exist on page "${op.pageId}"`);
    }
    const occupant = Object.entries(input.mapping).find(
      ([sid, rid]) => rid === op.region && sid !== op.surfaceId,
    );
    if (occupant) {
      throw new Error(`Region "${op.region}" is already occupied on page "${op.pageId}"`);
    }
  }
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
