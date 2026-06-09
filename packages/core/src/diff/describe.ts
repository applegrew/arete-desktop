import type { SurfaceModel } from '@a2ui/web_core/v0_9';
import type { ContentDiff } from '../types/diff';

/**
 * Human-friendly copy for content diffs — used by the approval bar and the chat
 * proposal/approve/reject messages. Surfaces are identified by a derived label
 * (a title prop, a heading, or a content noun) rather than their internal id,
 * and changes are described by the component TYPES involved rather than raw
 * "N components updated" counts.
 */

/** Structural/container components — less meaningful to name in change copy. */
const LAYOUT_TYPES = new Set(['Row', 'Column', 'Card', 'Divider']);

/** Friendly nouns for content component types. */
const TYPE_NOUNS: Record<string, string> = {
  DataTable: 'table',
  Chart: 'chart',
  Image: 'image',
  TextField: 'form field',
  CheckBox: 'checkbox',
  Button: 'button',
  Embed: 'embed',
  Text: 'text',
};

function typeMap(surface: SurfaceModel | undefined): Map<string, string> {
  const m = new Map<string, string>();
  if (!surface) return m;
  for (const [id, comp] of surface.componentsModel.entries) m.set(id, comp.type);
  return m;
}

/** Pull a displayable string from a `title` / `text` prop (flat or {literalString}). */
function textProp(p: Record<string, unknown>, key: 'title' | 'text'): string | undefined {
  const v = p[key];
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as { literalString?: unknown }).literalString === 'string') {
    return (v as { literalString: string }).literalString;
  }
  return undefined;
}

/**
 * A human label for a surface: an explicit `title` prop, else a heading Text,
 * else a noun for the dominant content component, else "this view". Never the id.
 */
export function deriveSurfaceLabel(surface: SurfaceModel | undefined): string {
  if (surface) {
    let heading: string | undefined;
    let noun: string | undefined;
    for (const [, comp] of surface.componentsModel.entries) {
      const p = comp.properties as Record<string, unknown>;
      const title = textProp(p, 'title');
      if (title && title.trim()) return `'${title.trim().slice(0, 48)}'`;
      if (comp.type === 'Text' && !heading) heading = textProp(p, 'text');
      if (!noun && !LAYOUT_TYPES.has(comp.type) && TYPE_NOUNS[comp.type]) noun = TYPE_NOUNS[comp.type];
    }
    if (heading && heading.trim()) return `'${heading.trim().slice(0, 48)}'`;
    if (noun) return `the ${noun}`;
  }
  return 'this view';
}

function listTypes(types: string[]): string {
  if (types.length === 1) return `a ${TYPE_NOUNS[types[0]!] ?? types[0]!}`;
  const uniq = [...new Set(types)];
  if (uniq.length === 1) return `${types.length} ${TYPE_NOUNS[uniq[0]!] ?? uniq[0]!}s`;
  return `${types.length} components`;
}

function phraseFor(verb: string, types: Array<string | undefined>): string | undefined {
  const all = types.filter((t): t is string => !!t);
  if (all.length === 0) return undefined;
  const content = all.filter((t) => !LAYOUT_TYPES.has(t));
  if (content.length === 0) {
    // Only structural components touched.
    return verb === 'update' ? 'rework the layout' : `${verb} the layout`;
  }
  return `${verb} ${listTypes(content)}`;
}

/** A type-aware sentence describing a content diff, e.g. "Add a table, rework the layout". */
export function describeContentChange(
  diff: ContentDiff,
  live: SurfaceModel | undefined,
  shadow: SurfaceModel | undefined,
): string {
  const liveT = typeMap(live);
  const shadowT = typeMap(shadow);
  const phrases = [
    phraseFor('add', diff.added.map((id) => shadowT.get(id))),
    phraseFor('update', diff.changed.map((id) => shadowT.get(id))),
    phraseFor('remove', diff.removed.map((id) => liveT.get(id))),
  ].filter((p): p is string => !!p);
  if (phrases.length === 0) return 'No visible changes';
  const s = phrases.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Approve changes to <label>? <summary>." */
export function formatContentDiffMessage(label: string, summary: string): string {
  return `Approve changes to ${label}? ${summary}.`;
}
