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
 * Pure reducer. Replaces the layout. Any pinned surface whose region is not present
 * in the new layout becomes unpinned (removed from mapping). The agent can re-pin
 * separately if needed.
 */
export function applySetPageLayout(
  input: SetPageLayoutInput,
  op: SetPageLayoutOp,
): SetPageLayoutResult {
  const nextRegionIds = new Set(op.layout.regions.map((r) => r.id));
  const nextMapping: PageMapping = {};
  for (const [surfaceId, regionId] of Object.entries(input.mapping)) {
    if (nextRegionIds.has(regionId)) {
      nextMapping[surfaceId] = regionId;
    }
  }
  return { layout: op.layout, mapping: nextMapping };
}
