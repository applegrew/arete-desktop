import { describe, it, expect } from 'vitest';
import type { SurfaceModel } from '@a2ui/web_core/v0_9';
import { deriveSurfaceLabel, describeContentChange } from '../src/diff/describe';
import type { ContentDiff } from '../src/types/diff';

/** Duck-typed surface — the describe helpers only read `componentsModel.entries`. */
function surface(comps: Array<{ id: string; type: string; properties?: Record<string, unknown> }>): SurfaceModel {
  return {
    componentsModel: { entries: comps.map((c) => [c.id, { type: c.type, properties: c.properties ?? {} }]) },
  } as unknown as SurfaceModel;
}

const diff = (d: Partial<ContentDiff>): ContentDiff => ({
  kind: 'content',
  surfaceId: 's',
  added: [],
  removed: [],
  moved: [],
  changed: [],
  ...d,
});

describe('deriveSurfaceLabel', () => {
  it('uses an explicit title prop', () => {
    expect(deriveSurfaceLabel(surface([{ id: 'root', type: 'DataTable', properties: { title: 'Tickets Overview' } }]))).toBe(
      "'Tickets Overview'",
    );
  });

  it('falls back to a heading Text', () => {
    expect(
      deriveSurfaceLabel(surface([{ id: 'root', type: 'Text', properties: { text: 'Quarterly Report' } }])),
    ).toBe("'Quarterly Report'");
  });

  it('falls back to a content noun when no title/heading', () => {
    expect(deriveSurfaceLabel(surface([{ id: 'root', type: 'Chart', properties: {} }]))).toBe('the chart');
  });

  it('returns "this view" for an empty/undefined surface', () => {
    expect(deriveSurfaceLabel(undefined)).toBe('this view');
    expect(deriveSurfaceLabel(surface([{ id: 'root', type: 'Column' }]))).toBe('this view');
  });
});

describe('describeContentChange', () => {
  it('names an added content component by type', () => {
    const shadow = surface([{ id: 'root', type: 'DataTable' }]);
    expect(describeContentChange(diff({ added: ['root'] }), undefined, shadow)).toBe('Add a table');
  });

  it('treats structural-only changes as layout rework', () => {
    const shadow = surface([{ id: 'root', type: 'Column' }]);
    expect(describeContentChange(diff({ changed: ['root'] }), shadow, shadow)).toBe('Rework the layout');
  });

  it('combines add + layout rework (list → table conversion)', () => {
    const shadow = surface([
      { id: 'root', type: 'Column' },
      { id: 't', type: 'DataTable' },
    ]);
    expect(describeContentChange(diff({ added: ['t'], changed: ['root'] }), shadow, shadow)).toBe(
      'Add a table, rework the layout',
    );
  });

  it('pluralizes same-type removals', () => {
    const live = surface([
      { id: 'a', type: 'Text' },
      { id: 'b', type: 'Text' },
      { id: 'c', type: 'Text' },
    ]);
    expect(describeContentChange(diff({ removed: ['a', 'b', 'c'] }), live, undefined)).toBe('Remove 3 texts');
  });

  it('reports no visible changes for an empty diff', () => {
    expect(describeContentChange(diff({}), undefined, undefined)).toBe('No visible changes');
  });
});
