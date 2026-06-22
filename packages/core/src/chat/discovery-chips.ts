import type { DiscoveryChip } from './ChatStore';

/**
 * Minimal page shape the chip predicates need. Consumers pass their current page
 * roster; we only read `id`/`title` so any page-like object works.
 */
export interface DiscoveryPageInfo {
  id: string;
  title: string;
}

export interface DiscoveryChipContext {
  pages: DiscoveryPageInfo[];
}

/**
 * A curated, always-available discovery chip. `visibleWhen`, when present, gates
 * the chip on current app state (e.g. hide "create a dashboard" once one exists).
 * A chip is *only* prompt-injection — clicking it submits `prompt` as if typed.
 */
export interface StaticDiscoveryChip extends DiscoveryChip {
  visibleWhen?: (ctx: DiscoveryChipContext) => boolean;
}

/**
 * Well-known identity for the dashboard page. Page creation (the trusted
 * `CreatePageButton` → `SystemActions.createPage`) and the "create a dashboard"
 * chip's visibility predicate both key off this so they stay in agreement.
 * Matched by id/title (no page-model `kind` field — per design decision).
 */
export const DASHBOARD_PAGE_ID = 'dashboard';
export const DASHBOARD_PAGE_TITLE = 'Dashboard';

/** True if a dashboard page already exists in the roster (matched by id or title). */
export function isDashboardPage(p: DiscoveryPageInfo): boolean {
  return p.id === DASHBOARD_PAGE_ID || p.title.trim().toLowerCase() === DASHBOARD_PAGE_TITLE.toLowerCase();
}

/**
 * The static half of the hybrid chip set. The dynamic half arrives per-turn from
 * the agent via `discoveryChips` (CUSTOM `arete.discoveryChips`).
 */
export const STATIC_DISCOVERY_CHIPS: StaticDiscoveryChip[] = [
  {
    label: 'Create a dashboard page',
    prompt: 'Create a dashboard page where I can pin widgets to track over time.',
    visibleWhen: ({ pages }) => !pages.some(isDashboardPage),
  },
  {
    label: 'What custom views can you build?',
    prompt: 'What kinds of custom views, pages, and tracking widgets can you build for me?',
  },
];

/** Resolve the visible static chips for the given context (strips `visibleWhen`). */
export function resolveStaticChips(ctx: DiscoveryChipContext): DiscoveryChip[] {
  return STATIC_DISCOVERY_CHIPS.filter((c) => (c.visibleWhen ? c.visibleWhen(ctx) : true)).map(
    ({ label, prompt }) => ({ label, prompt }),
  );
}
