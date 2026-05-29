import { describe, it, expect } from 'vitest';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import { basicCatalog, type ReactComponentImplementation } from '@a2ui/react/v0_9';
import { computeContentDiff, diffIsEmpty } from '../src/diff/diff-engine';

function freshProcessor() {
  return new MessageProcessor<ReactComponentImplementation>([basicCatalog]);
}

describe('computeContentDiff', () => {
  it('returns empty diff when both surfaces are undefined', () => {
    const d = computeContentDiff('sfc', undefined, undefined);
    expect(diffIsEmpty(d)).toBe(true);
  });

  it('reports adds when shadow has components live does not', () => {
    const live = freshProcessor();
    const shadow = freshProcessor();
    const sid = 'sfc-1';
    shadow.processMessages([
      { version: 'v0.9', createSurface: { surfaceId: sid, catalogId: basicCatalog.id } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: sid,
          components: [{ component: 'Text', id: 'c1', componentProperties: { text: { literalString: 'hi' } } }],
        },
      },
    ]);
    const d = computeContentDiff(sid, live.model.getSurface(sid), shadow.model.getSurface(sid));
    expect(d.added).toContain('c1');
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it('reports changes when shadow component differs from live', () => {
    const live = freshProcessor();
    const shadow = freshProcessor();
    const sid = 'sfc-2';
    const create = { version: 'v0.9' as const, createSurface: { surfaceId: sid, catalogId: basicCatalog.id } };
    const v1 = {
      version: 'v0.9' as const,
      updateComponents: {
        surfaceId: sid,
        components: [
          { component: 'Text', id: 'c1', componentProperties: { text: { literalString: 'before' } } },
        ],
      },
    };
    const v2 = {
      version: 'v0.9' as const,
      updateComponents: {
        surfaceId: sid,
        components: [
          { component: 'Text', id: 'c1', componentProperties: { text: { literalString: 'after' } } },
        ],
      },
    };
    live.processMessages([create, v1]);
    shadow.processMessages([create, v2]);
    const d = computeContentDiff(sid, live.model.getSurface(sid), shadow.model.getSurface(sid));
    expect(d.changed).toContain('c1');
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });
});
