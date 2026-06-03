import type { LayoutDescriptor } from '../page/layout-descriptor';
import type { PageMapping, PageDiff } from '../types/diff';
import type {
  HookContextValue,
  OnApprove,
  OnPageOp,
  OnProposed,
  OnReject,
} from '../types/hooks';
import type { PageOp } from '../types/page-ops';
import { applyPinSurface } from './ops/pinSurface';
import { applySetPageLayout } from './ops/setPageLayout';
import { applyUnpinSurface } from './ops/unpinSurface';
import { applyMoveSurface } from './ops/moveSurface';
import { applySetPageRegion } from './ops/setPageRegion';
import { pageOpSchemas } from './schemas';

export interface PageRegistration {
  getState: () => { layout: LayoutDescriptor; mapping: PageMapping };
  setState: (next: { layout: LayoutDescriptor; mapping: PageMapping }) => void;
  autoApprove?: boolean;
}

type PendingPageDiff = PageDiff;

interface HarnessHooks {
  onPageOp?: OnPageOp;
  onProposed?: OnProposed;
  onApprove?: OnApprove;
  onReject?: OnReject;
}

type Listener = () => void;
type ActivationListener = (pageId: string) => void;

export class PageOpsHarness {
  readonly schemas: Record<string, Record<string, unknown>> = pageOpSchemas;

  private registrations = new Map<string, PageRegistration>();
  private pending = new Map<string, PendingPageDiff>();
  private queued = new Map<string, PageOp[]>();
  private listeners = new Set<Listener>();
  private activationListeners = new Set<ActivationListener>();
  private hooks: HarnessHooks = {};

  setHooks(hooks: Partial<HookContextValue>): void {
    this.hooks = {
      onPageOp: hooks.onPageOp,
      onProposed: hooks.onProposed,
      onApprove: hooks.onApprove,
      onReject: hooks.onReject,
    };
  }

  registerPage(pageId: string, registration: PageRegistration): () => void {
    this.registrations.set(pageId, registration);
    // Flush ops that arrived while this page's tab was inactive (unmounted).
    const queued = this.queued.get(pageId);
    if (queued && queued.length > 0) {
      this.queued.delete(pageId);
      for (const op of queued) this.applyToRegistration(op, pageId, registration);
    }
    return () => {
      this.registrations.delete(pageId);
      // NOTE: intentionally do NOT delete `pending` here. A pending approval
      // must survive the page unmounting — both React StrictMode's dev
      // mount→unmount→mount cycle and a user switching tabs. It re-renders from
      // `pending` when the page remounts; approve/reject clear it.
    };
  }

  /**
   * Subscribe to page-activation requests. Fired when `apply()` targets a page
   * that isn't mounted yet, so the Shell can switch to the tab that hosts it
   * (which mounts the page, registers it, and flushes the queued op). Lets page
   * ops target any page regardless of the active tab — consumers don't wire it.
   */
  subscribeActivation(listener: ActivationListener): () => void {
    this.activationListeners.add(listener);
    return () => {
      this.activationListeners.delete(listener);
    };
  }

  hasPending(pageId: string): boolean {
    return this.pending.has(pageId);
  }

  getPending(pageId: string): PendingPageDiff | undefined {
    return this.pending.get(pageId);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  apply(op: PageOp): void {
    const filtered = this.hooks.onPageOp ? this.hooks.onPageOp(op, { pageId: targetPageId(op) ?? '' }) : op;
    if (!filtered) return;

    const pageId = targetPageId(filtered);
    // A malformed op (no/unknown `name`, hence no target page) must not trigger
    // activation — that would switch the Shell to a non-existent tab ("No tab
    // selected"). Ignore it defensively.
    if (!pageId) {
      console.warn('[arete] ignoring page op with no target page id:', JSON.stringify(filtered));
      return;
    }
    const reg = this.registrations.get(pageId);
    if (!reg) {
      // The target page's tab isn't active, so its <Page> hasn't mounted/
      // registered. If anything can activate it (Shell wired), queue the op and
      // request activation; registerPage() flushes it once the page mounts.
      if (this.activationListeners.size > 0) {
        const q = this.queued.get(pageId) ?? [];
        q.push(filtered);
        this.queued.set(pageId, q);
        for (const l of this.activationListeners) l(pageId);
        return;
      }
      throw new Error(`No page registered with id "${pageId}"`);
    }
    this.applyToRegistration(filtered, pageId, reg);
  }

  private applyToRegistration(op: PageOp, pageId: string, reg: PageRegistration): void {
    const prev = reg.getState();
    let next: { layout: LayoutDescriptor; mapping: PageMapping };
    try {
      next = runOp(op, prev);
    } catch (err) {
      // A malformed op (e.g. setPageRegion targeting a region the page's layout
      // doesn't have) must never crash the app — registration flush runs during
      // React render, where a throw takes down the whole tree. Drop it + warn.
      console.warn(
        `[arete] page op "${op.name}" on page "${pageId}" skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    const diff: PageDiff = {
      kind: 'page-op',
      pageId,
      op,
      prev,
      next,
    };

    if (reg.autoApprove) {
      reg.setState(next);
      this.hooks.onApprove?.(diff);
      return;
    }

    this.pending.set(pageId, diff);
    this.hooks.onProposed?.(diff);
    this.emit();
  }

  approve(pageId: string): void {
    const diff = this.pending.get(pageId);
    if (!diff) return;
    const reg = this.registrations.get(pageId);
    if (reg) reg.setState(diff.next);
    this.pending.delete(pageId);
    this.hooks.onApprove?.(diff);
    this.emit();
  }

  reject(pageId: string): void {
    const diff = this.pending.get(pageId);
    if (!diff) return;
    this.pending.delete(pageId);
    this.hooks.onReject?.(diff);
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

function targetPageId(op: PageOp): string | undefined {
  switch (op?.name) {
    case 'pinSurface':
    case 'setPageLayout':
    case 'setPageRegion':
    case 'unpinSurface':
    case 'moveSurface':
      return op.pageId;
    default:
      return undefined;
  }
}

function runOp(
  op: PageOp,
  prev: { layout: LayoutDescriptor; mapping: PageMapping },
): { layout: LayoutDescriptor; mapping: PageMapping } {
  switch (op.name) {
    case 'pinSurface':
      return applyPinSurface(prev, op);
    case 'setPageLayout':
      return applySetPageLayout(prev, op);
    case 'unpinSurface':
      return applyUnpinSurface(prev, op);
    case 'moveSurface':
      return applyMoveSurface(prev, op);
    case 'setPageRegion':
      return applySetPageRegion(prev, op);
  }
}
