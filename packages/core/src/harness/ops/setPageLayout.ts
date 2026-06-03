import type { LayoutDescriptor } from '../../page/layout-descriptor';
import type { SetPageLayoutOp } from '../../types/page-ops';
import type { PageMapping } from '../../types/diff';

export interface SetPageLayoutInput {
  layout: LayoutDescriptor;
  mapping: PageMapping;
}

export interface SetPageLayoutResult {
  layout: LayoutDescriptor;
  mapping: PageMapping;
}

/**
 * Pure reducer. Replaces the layout and **remaps pinned surfaces** so they are
 * preserved across a layout change (a 2×2 grid and a row share no region ids, so
 * naively keeping region ids would lose every widget). Strategy:
 *  - A surface whose region id still exists keeps that region.
 *  - Otherwise it moves to the next free region in the new layout, in the
 *    surfaces' original visual order.
 *  - If there are more surfaces than regions, the overflow is parked in the last
 *    region (retained in the mapping, never dropped) so nothing is lost.
 */
export function applySetPageLayout(
  input: SetPageLayoutInput,
  op: SetPageLayoutOp,
): SetPageLayoutResult {
  const newRegions = op.layout.regions.map((r) => r.id);
  const newRegionSet = new Set(newRegions);

  // Pinned surfaces in their current visual order (by old-layout region order).
  const oldOrder = input.layout.regions.map((r) => r.id);
  const pinned = Object.entries(input.mapping).sort(
    (a, b) => oldOrder.indexOf(a[1]) - oldOrder.indexOf(b[1]),
  );

  const nextMapping: PageMapping = {};
  const occupied = new Set<string>();
  const overflow: string[] = [];

  // 1. Keep surfaces whose region survives (one per region).
  for (const [surfaceId, regionId] of pinned) {
    if (newRegionSet.has(regionId) && !occupied.has(regionId)) {
      nextMapping[surfaceId] = regionId;
      occupied.add(regionId);
    } else {
      overflow.push(surfaceId);
    }
  }

  // 2. Place displaced surfaces into the next free new regions; park any
  //    remaining overflow in the last region so they survive the change.
  let ri = 0;
  for (const surfaceId of overflow) {
    while (ri < newRegions.length && occupied.has(newRegions[ri]!)) ri++;
    if (ri < newRegions.length) {
      const region = newRegions[ri]!;
      nextMapping[surfaceId] = region;
      occupied.add(region);
      ri++;
    } else if (newRegions.length > 0) {
      nextMapping[surfaceId] = newRegions[newRegions.length - 1]!;
    } else {
      nextMapping[surfaceId] = input.mapping[surfaceId]!; // degenerate: no regions
    }
  }

  return { layout: op.layout, mapping: nextMapping };
}
