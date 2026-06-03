import { describe, it, expect } from 'vitest';
import { processEmissions } from '../src/run-turn';
import type { AgentContext } from '../src/prompt';

type A2uiEm = {
  targetSurfaceId: string;
  messages: Array<{ createSurface?: { surfaceId: string }; updateComponents?: { surfaceId: string } }>;
};
type PageOpEm = { op: { name: string; surfaceId?: string } };
const a2ui = (v: unknown) => v as A2uiEm;
const pageOp = (v: unknown) => v as PageOpEm;

function ctx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    chatSurfaceIds: [],
    pages: {},
    surfaces: {},
    recentSurfaceIds: [],
    recentActions: [],
    recentPinnedSurfaceId: null,
    mostRecentSurfaceId: null,
    activeTabId: 'chat',
    diagnostics: [],
    ...overrides,
  };
}

describe('processEmissions', () => {
  it('mints a unique surfaceId for placeholder a2ui emissions and injects it', () => {
    const r = processEmissions(
      [
        {
          kind: 'a2ui',
          targetSurfaceId: '<PLACEHOLDER>',
          messages: [
            { version: 'v0.9', createSurface: { surfaceId: '<PLACEHOLDER>' } },
            { version: 'v0.9', updateComponents: { surfaceId: '<PLACEHOLDER>', components: [{ id: 'root', component: 'Text', text: 'hi' }] } },
          ],
        },
      ],
      ctx(),
    );
    expect(r.issues).toEqual([]);
    const em = a2ui(r.validated[0]);
    expect(em.targetSurfaceId).toMatch(/^agent-sfc-[0-9a-f]{8}$/);
    // surfaceId injected into both messages
    expect(em.messages[0]!.createSurface!.surfaceId).toBe(em.targetSurfaceId);
    expect(em.messages[1]!.updateComponents!.surfaceId).toBe(em.targetSurfaceId);
  });

  it('mints distinct ids across emissions (no collision)', () => {
    const mk = () => ({
      kind: 'a2ui',
      targetSurfaceId: '<PLACEHOLDER>',
      messages: [{ version: 'v0.9', createSurface: { surfaceId: '<PLACEHOLDER>' } },
                 { version: 'v0.9', updateComponents: { surfaceId: '<PLACEHOLDER>', components: [{ id: 'root', component: 'Text', text: 'x' }] } }],
    });
    const r = processEmissions([mk(), mk()], ctx());
    const a = a2ui(r.validated[0]).targetSurfaceId;
    const b = a2ui(r.validated[1]).targetSurfaceId;
    expect(a).not.toBe(b);
  });

  it('flags an a2ui emission targeting an unknown surface with no createSurface', () => {
    const r = processEmissions(
      [{ kind: 'a2ui', targetSurfaceId: 'missing-sfc', messages: [{ version: 'v0.9', updateComponents: { surfaceId: 'missing-sfc', components: [{ id: 'root', component: 'Text', text: 'x' }] } }] }],
      ctx(),
    );
    expect(r.issues.join(' ')).toMatch(/unknown surface "missing-sfc"/);
  });

  it('detects a no-op updateComponents identical to the live surface', () => {
    const components = [{ id: 'root', component: 'Chart', type: 'bar', labels: ['A'], data: [1] }];
    const r = processEmissions(
      [{ kind: 'a2ui', targetSurfaceId: 'sfc-1', messages: [{ version: 'v0.9', updateComponents: { surfaceId: 'sfc-1', components } }] }],
      ctx({ surfaces: { 'sfc-1': { components, dataModel: {}, visibleOnActivePage: false } } }),
    );
    expect(r.issues).toEqual([]);
    expect(r.noops).toEqual(['sfc-1']);
  });

  it('flags an empty/nameless pageOp so the model self-corrects', () => {
    const r = processEmissions([{ kind: 'pageOp', op: {} }], ctx({ activeTabId: 'logs' }));
    expect(r.validated).toEqual([]);
    expect(r.issues.join(' ')).toMatch(/missing a valid "name"/);
    // Nudges toward the active page id.
    expect(r.issues.join(' ')).toContain('logs');
  });

  it('flags a pageOp missing required fields (setPageLayout without layout)', () => {
    const r = processEmissions([{ kind: 'pageOp', op: { name: 'setPageLayout', pageId: 'logs' } }], ctx());
    expect(r.validated).toEqual([]);
    expect(r.issues.join(' ')).toMatch(/missing required field\(s\): layout/);
  });

  it('passes a well-formed pageOp through', () => {
    const r = processEmissions(
      [{ kind: 'pageOp', op: { name: 'setPageLayout', pageId: 'logs', layout: { kind: 'row', regions: [{ id: 'left' }, { id: 'right' }] } } }],
      ctx(),
    );
    expect(r.issues).toEqual([]);
    expect(pageOp(r.validated[0]).op.name).toBe('setPageLayout');
  });

  it('passes pageOps through and resolves <PLACEHOLDER> surfaceId to the last minted surface', () => {
    const r = processEmissions(
      [
        { kind: 'a2ui', targetSurfaceId: '<PLACEHOLDER>', messages: [{ version: 'v0.9', createSurface: { surfaceId: '<PLACEHOLDER>' } }, { version: 'v0.9', updateComponents: { surfaceId: '<PLACEHOLDER>', components: [{ id: 'root', component: 'Text', text: 'x' }] } }] },
        { kind: 'pageOp', op: { name: 'setPageRegion', pageId: 'reports', regionId: 'top-left', surfaceId: '<PLACEHOLDER>' } },
      ],
      ctx(),
    );
    const minted = a2ui(r.validated[0]).targetSurfaceId;
    const op = pageOp(r.validated[1]).op;
    expect(op.surfaceId).toBe(minted);
  });
});
