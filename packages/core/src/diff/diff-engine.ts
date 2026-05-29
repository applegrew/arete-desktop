import type { SurfaceModel } from '@a2ui/web_core/v0_9';
import type { ContentDiff } from '../types/diff';
import { deepEqual } from '../util/deep-equal';

interface Snapshot {
  id: string;
  type: string;
  properties: Record<string, unknown>;
}

function snapshot(surface: SurfaceModel | undefined): Map<string, Snapshot> {
  const out = new Map<string, Snapshot>();
  if (!surface) return out;
  for (const [id, comp] of surface.componentsModel.entries) {
    out.set(id, { id, type: comp.type, properties: comp.properties });
  }
  return out;
}

/**
 * Compute a content diff from a live and shadow surface. Either may be `undefined`
 * (e.g. a freshly-created surface has no live counterpart yet).
 *
 * Algorithm:
 *  - liveIds vs shadowIds set difference → added / removed
 *  - common IDs: deepEqual on (type, properties) → if not equal → changed
 *  - `moved` is not detected at the component-snapshot level (no parent index in ComponentModel public API).
 */
export function computeContentDiff(
  surfaceId: string,
  live: SurfaceModel | undefined,
  shadow: SurfaceModel | undefined,
): ContentDiff {
  const liveSnap = snapshot(live);
  const shadowSnap = snapshot(shadow);

  const added: string[] = [];
  const removed: string[] = [];
  const moved: string[] = [];
  const changed: string[] = [];

  for (const id of shadowSnap.keys()) {
    if (!liveSnap.has(id)) added.push(id);
  }
  for (const id of liveSnap.keys()) {
    if (!shadowSnap.has(id)) removed.push(id);
  }
  for (const id of shadowSnap.keys()) {
    const s = shadowSnap.get(id)!;
    const l = liveSnap.get(id);
    if (!l) continue;
    if (s.type !== l.type || !deepEqual(s.properties, l.properties)) {
      changed.push(id);
    }
  }

  return { kind: 'content', surfaceId, added, removed, moved, changed };
}

export function diffIsEmpty(d: ContentDiff): boolean {
  return (
    d.added.length === 0 && d.removed.length === 0 && d.moved.length === 0 && d.changed.length === 0
  );
}
