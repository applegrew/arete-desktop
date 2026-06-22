import type { SurfaceModel } from '@a2ui/web_core/v0_9';
import type { ContentDiff } from '../types/diff';
import { deepEqual } from '../util/deep-equal';

interface Snapshot {
  id: string;
  type: string;
  properties: Record<string, unknown>;
}

function clone<T>(v: T): T {
  if (v == null || typeof v !== 'object') return v;
  try {
    return structuredClone(v);
  } catch {
    // Fall back for values structuredClone can't handle (functions, etc.).
    return JSON.parse(JSON.stringify(v)) as T;
  }
}

function snapshot(surface: SurfaceModel | undefined): Map<string, Snapshot> {
  const out = new Map<string, Snapshot>();
  if (!surface) return out;
  for (const [id, comp] of surface.componentsModel.entries) {
    // Deep-clone properties so the snapshot is an immutable point-in-time copy:
    // capturing by reference would let a later in-place mutation of the live model
    // retroactively alter the baseline and hide a real change.
    out.set(id, { id, type: comp.type, properties: clone(comp.properties) });
  }
  return out;
}

/**
 * Compute a content diff from a live and shadow surface. Either may be `undefined`
 * (e.g. a freshly-created surface has no live counterpart yet).
 *
 * Algorithm:
 *  - liveIds vs shadowIds set difference → added / removed
 *  - common IDs with changed (type, properties) → changed
 *  - common IDs whose content is unchanged but whose parent changed → moved
 *    (reparented). Parents are derived by scanning each component's properties for
 *    references to other component ids; keyed on parent only (not index) so adding
 *    a sibling doesn't spuriously flag everything after it as moved.
 */
export function computeContentDiff(
  surfaceId: string,
  live: SurfaceModel | undefined,
  shadow: SurfaceModel | undefined,
): ContentDiff {
  const liveSnap = snapshot(live);
  const shadowSnap = snapshot(shadow);
  const liveParent = parentMap(liveSnap);
  const shadowParent = parentMap(shadowSnap);

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
    } else if (liveParent.get(id) !== shadowParent.get(id)) {
      moved.push(id);
    }
  }

  return { kind: 'content', surfaceId, added, removed, moved, changed };
}

/** Map each component id → the id of the component that references it (its parent). */
function parentMap(snap: Map<string, Snapshot>): Map<string, string> {
  const ids = new Set(snap.keys());
  const parent = new Map<string, string>();
  for (const [pid, comp] of snap) {
    for (const childId of collectIdRefs(comp.properties, ids)) {
      if (childId !== pid && !parent.has(childId)) parent.set(childId, pid);
    }
  }
  return parent;
}

/** Collect property values that are strings matching a known component id. */
function collectIdRefs(v: unknown, ids: Set<string>, acc: string[] = []): string[] {
  if (typeof v === 'string') {
    if (ids.has(v)) acc.push(v);
  } else if (Array.isArray(v)) {
    for (const x of v) collectIdRefs(x, ids, acc);
  } else if (v && typeof v === 'object') {
    for (const x of Object.values(v as Record<string, unknown>)) collectIdRefs(x, ids, acc);
  }
  return acc;
}

export function diffIsEmpty(d: ContentDiff): boolean {
  return (
    d.added.length === 0 && d.removed.length === 0 && d.moved.length === 0 && d.changed.length === 0
  );
}
