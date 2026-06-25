import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import { A2uiSurface, MarkdownContext, type ReactComponentImplementation } from '@a2ui/react/v0_9';
import { renderMarkdown } from '@a2ui/markdown-it';
import {
  Shell,
  Page,
  ChatStore,
  DiffRouter,
  DiffOverlay,
  SurfaceBoundary,
  SurfaceIdProvider,
  SystemActionsProvider,
  PageOpsHarness,
  ActionHarness,
  RenderDiagnosticsStore,
  resolveStaticChips,
  type RenderDiagnostic,
  type SystemActions,
  type DiscoveryChip,
  withComponentIds,
  buildAgentContext,
  deriveSurfaceLabel,
  describeContentChange,
  deepEqual,
  uid,
  type ShellTab,
  type ShellState,
  type LayoutDescriptor,
  type Diff,
  type UserAction,
  type OpError,
  type SurfaceSnapshot,
  type ChatRole,
} from '@arete-desktop/core';
import { primeReactCatalog, componentAgentHints } from '@arete-desktop/adapter-primereact';
import { streamAgent, callMcpTool } from './agui-client';
import { WidgetManager } from './widget-manager';
import { runClientHandler, validateHandler } from './widget-client';
import type { WidgetHandler, TimelineEntry } from './persistence';

const MAX_TIMELINE_PER_SURFACE = 25;
import {
  loadPages,
  createPage,
  updatePage,
  deletePage,
  loadSurfaces,
  saveSurfaces,
  loadChat,
  saveChat,
  updateWorkspace,
  loadWorkspaces,
  createWorkspace,
  deleteWorkspace,
  activateWorkspace,
  getAgentHealth,
  loadSettings,
  saveSettings,
  type ApiPage,
  type ApiWorkspace,
  type AgentSettings,
} from './persistence';
import { SettingsPanel } from './SettingsPanel';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

const DEFAULT_LAYOUT: LayoutDescriptor = {
  kind: 'grid',
  rows: 2,
  cols: 2,
  regions: [{ id: 'top-left' }, { id: 'top-right' }, { id: 'bottom-left' }, { id: 'bottom-right' }],
};

/** The synthesized `[USER ACTION]` prompt sent to the agent for a dispatched action. */
function buildActionSynth(action: UserAction, repeatCount: number): string {
  const contextStr = JSON.stringify(action.context);
  const surfaceClause = action.surfaceId ? ` on surface ${action.surfaceId}` : '';
  const componentClause = action.sourceComponentId ? ` (component ${action.sourceComponentId})` : '';
  let synth = `[USER ACTION] event "${action.name}"${surfaceClause}${componentClause}; context: ${contextStr}`;
  if (repeatCount > 1) {
    synth +=
      ` [repeated ${repeatCount}× in quick succession while the previous action on this surface was still ` +
      `processing — decide whether this is a single retry or ${repeatCount} intended repeats]`;
  }
  return synth;
}

/** Two actions coalesce only if they're the same event from the same component with the same context. */
function sameUserAction(a: UserAction, b: UserAction): boolean {
  return a.name === b.name && a.sourceComponentId === b.sourceComponentId && deepEqual(a.context, b.context);
}

/**
 * Compact, depth-limited description of a value's SHAPE (keys/types, not values).
 * When a widget handler throws, we feed this back to the agent so it can see what a
 * tool ACTUALLY returned — the usual cause of handler bugs is a wrong assumption
 * about the result shape (e.g. reading `t.data.tickets` when the tool returns
 * `{ results: [...] }`), which the agent otherwise can't observe.
 */
function describeShape(v: unknown, depth = 0): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) {
    if (v.length === 0) return 'array(0)';
    return `array(${v.length}) of ${depth < 2 ? describeShape(v[0], depth + 1) : '…'}`;
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>);
    if (depth >= 2) return `{ …${keys.length} keys }`;
    const shown = keys.slice(0, 12);
    const body = shown
      .map((k) => `${k}: ${describeShape((v as Record<string, unknown>)[k], depth + 1)}`)
      .join(', ');
    return `{ ${body}${keys.length > shown.length ? `, …${keys.length - shown.length} more` : ''} }`;
  }
  return typeof v;
}

/**
 * One workspace's full state + UI. Keyed by `workspaceId` in <App>, so switching
 * workspaces REMOUNTS this fresh — all singletons/refs re-initialize and the
 * hydration effect reloads for the new workspace. No manual cross-workspace reset.
 */
interface WorkspaceViewProps {
  workspaceId: string;
  /** Per-workspace UI state from the workspace record (seeds shellState). */
  initialActiveTabId?: string;
  initialChatDockState?: string;
  /** The workspace switcher (global), composed into the top bar by this view. */
  switcherSlot: ReactNode;
}

function WorkspaceView({ workspaceId, initialActiveTabId, initialChatDockState, switcherSlot }: WorkspaceViewProps) {
  // These are STATEFUL singletons (they hold surfaces, handlers, diffs, chat…), not
  // derived values — so create them with useState lazy-init, NOT useMemo. Vite Fast
  // Refresh preserves useState/useRef across an edit but DISCARDS useMemo, which
  // would silently reset the live processor + WidgetManager to empty (blank surfaces,
  // and the debounced save then wipes the persisted handlers). useState keeps them.
  const [currentCatalog] = useState(() => withComponentIds(primeReactCatalog));
  const catalogId = useMemo(() => (currentCatalog as { id: string }).id, [currentCatalog]);

  const [liveProcessor] = useState(() => new MessageProcessor<ReactComponentImplementation>([currentCatalog]));
  const [shadowProcessor] = useState(() => new MessageProcessor<ReactComponentImplementation>([currentCatalog]));
  const [router] = useState(() => new DiffRouter(liveProcessor, shadowProcessor));
  const [harness] = useState(() => new PageOpsHarness());
  const [actionHarness] = useState(() => new ActionHarness());
  const [renderDiagnostics] = useState(() => new RenderDiagnosticsStore());
  const [chatStore] = useState(() => new ChatStore());

  const [diffsGated, setDiffsGated] = useState(true);
  // Gates all persistence writes until the initial DB restore completes, so the
  // empty/default mount state never overwrites persisted chat/pages/state.
  const [hydrated, setHydrated] = useState(false);
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pages, setPages] = useState<ApiPage[]>([]);
  const pagesRef = useRef<ApiPage[]>([]);
  pagesRef.current = pages;
  const commitPages = useCallback((next: ApiPage[]) => {
    pagesRef.current = next;
    setPages(next);
  }, []);

  const pinnedSurfaceIdsRef = useRef<Set<string>>(new Set());
  const surfaceContentsRef = useRef<Record<string, unknown[]>>({});
  // Generic per-surface, globally-ordered state timeline — every render of a
  // surface is appended here (NOT a back-specific stack). Exposed to handlers as
  // `surface.history` and to the LLM via the getSurfaceHistory tool, so either can
  // study prior states and restore/derive from them. `seq` orders entries across
  // all surfaces; capped per surface to bound memory + payload.
  const surfaceTimelineRef = useRef<Record<string, TimelineEntry[]>>({});
  const timelineSeqRef = useRef(0);
  // Assigned after recordTimeline is defined; lets handlePrompt (defined earlier)
  // append agent-driven renders to the timeline.
  const recordTimelineRef = useRef<(surfaceId: string, trigger: string) => void>(() => {});
  const recentSurfaceIdsRef = useRef<string[]>([]);
  // Deferred agent feedback: failures that happen OUTSIDE an agent turn — page-op
  // failures (e.g. pinSurface with no region) and widget-handler runtime errors.
  // Buffered here, drained into the NEXT turn's diagnostics so the agent gets
  // accurate feedback (like a tool error) and can correct — never failing silently.
  const pageOpErrorsRef = useRef<RenderDiagnostic[]>([]);
  const handlePromptRef = useRef<(text: string, fromUserAction?: boolean) => void | Promise<void>>(() => {});

  // Per-surface user-action serialization. While a surface's action turn is
  // in-flight, further actions from THAT surface queue (coalescing consecutive
  // identical ones into a repeat count); other surfaces stay concurrent. This
  // prevents racing turns and lets the agent disambiguate retry vs. intentional
  // repeats. Typed prompts (onPrompt) are NOT serialized.
  const actionQueuesRef = useRef<
    Map<string, { inFlight: boolean; queue: Array<{ action: UserAction; repeatCount: number }> }>
  >(new Map());
  const runUserActionRef = useRef<(sid: string, item: { action: UserAction; repeatCount: number }) => void>(
    () => {},
  );
  // Dispatches one action: a Widget Manager handler if registered, else the LLM.
  // Assigned later (after widgetManager + runWidgetAction exist).
  const dispatchActionRef = useRef<(item: { action: UserAction; repeatCount: number }) => Promise<void>>(
    async () => {},
  );
  runUserActionRef.current = (sid, item) => {
    Promise.resolve(dispatchActionRef.current(item)).finally(() => {
      const st = actionQueuesRef.current.get(sid);
      if (!st) return;
      const next = st.queue.shift();
      if (next) runUserActionRef.current(sid, next);
      else st.inFlight = false;
    });
  };
  const enqueueUserAction = useCallback((action: UserAction) => {
    const sid = action.surfaceId ?? '__global__';
    let st = actionQueuesRef.current.get(sid);
    if (!st) {
      st = { inFlight: false, queue: [] };
      actionQueuesRef.current.set(sid, st);
    }
    if (!st.inFlight) {
      st.inFlight = true;
      runUserActionRef.current(sid, { action, repeatCount: 1 });
    } else {
      const tail = st.queue[st.queue.length - 1];
      if (tail && sameUserAction(tail.action, action)) tail.repeatCount += 1;
      else st.queue.push({ action, repeatCount: 1 });
    }
  }, []);

  // Busy = at least one agent turn in-flight; toggles the chat Send button to Cancel.
  const [busyCount, setBusyCount] = useState(0);
  // Agent-suggested discovery chips from the latest turn. When empty, the chip bar
  // falls back to the curated static set (reactive to the current page roster).
  const [agentChips, setAgentChips] = useState<DiscoveryChip[]>([]);
  const abortControllersRef = useRef<Set<AbortController>>(new Set());
  const cancelPrompt = useCallback(() => {
    for (const c of abortControllersRef.current) c.abort();
    abortControllersRef.current.clear();
    // Cancel means stop: also drop any queued (not-yet-dispatched) user actions.
    actionQueuesRef.current.clear();
  }, []);

  // Agent-authored widget action handlers (server-run scripts that replace LLM turns).
  const [widgetManager] = useState(() => new WidgetManager());

  // Pending widgetScript emissions awaiting user approval. Keyed by entry id.
  // Each holds the full emission so approve can apply it; reject discards.
  const pendingScriptsRef = useRef<
    Map<string, { targetSurfaceId: string; event: string; code: string }>
  >(new Map());

  const [shellState, setShellState] = useState<ShellState>({
    activeTabId: initialActiveTabId ?? 'chat',
    chatDockState: (initialChatDockState as ShellState['chatDockState']) ?? 'dock',
  });

  // Transient halo target — set when locating a surface moved to a page; auto-clears.
  const [highlightedSurfaceId, setHighlightedSurfaceId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locateSurface = useCallback((surfaceId: string, pageId: string) => {
    setShellState((s) => (s.activeTabId === pageId ? s : { ...s, activeTabId: pageId }));
    setHighlightedSurfaceId(surfaceId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedSurfaceId(null), 2400);
  }, []);

  const handleApproveScript = useCallback(
    (entryId: string) => {
      const pending = pendingScriptsRef.current.get(entryId);
      if (!pending) return;
      try {
        validateHandler(pending.code);
        widgetManager.set(pending.targetSurfaceId, pending.event, { code: pending.code });
        chatStore.push({
          role: 'system',
          text: `Learned a handler for "${pending.event}" — future clicks run instantly.`,
        });
      } catch (e) {
        chatStore.push({
          role: 'system',
          text: `Handler for "${pending.event}" was invalid: ${(e as Error).message}`,
        });
      }
      chatStore.remove(entryId);
      pendingScriptsRef.current.delete(entryId);
    },
    [widgetManager, chatStore],
  );

  const handleRejectScript = useCallback(
    (entryId: string) => {
      const pending = pendingScriptsRef.current.get(entryId);
      if (!pending) return;
      chatStore.remove(entryId);
      chatStore.push({
        role: 'system',
        text: `Discarded handler for "${pending.event}".`,
      });
      pendingScriptsRef.current.delete(entryId);
    },
    [chatStore],
  );

  const handleLocateSurface = useCallback(
    (surfaceId: string) => {
      const hostPage = pagesRef.current.find((p) =>
        Object.prototype.hasOwnProperty.call(p.mapping, surfaceId),
      );
      if (hostPage) {
        locateSurface(surfaceId, hostPage.id);
      }
    },
    [locateSurface],
  );

  // Bumped on any change that should trigger a debounced save (chat push,
  // surface capture). NOT driven off routerTick — the router only ticks for
  // GATED diffs, but ungated chat surfaces + harness pins also need persisting.
  const [persistTick, setPersistTick] = useState(0);
  const bumpPersist = useCallback(() => setPersistTick((n) => n + 1), []);

  const captureSurfaceContents = useCallback((messages: unknown[]) => {
    let changed = false;
    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue;
      const m = msg as Record<string, unknown>;
      if (m.updateComponents && typeof m.updateComponents === 'object') {
        const uc = m.updateComponents as Record<string, unknown>;
        const sid = typeof uc.surfaceId === 'string' ? uc.surfaceId : null;
        const comps = Array.isArray(uc.components) ? uc.components : null;
        if (sid && comps) {
          surfaceContentsRef.current[sid] = comps;
          recentSurfaceIdsRef.current = [sid, ...recentSurfaceIdsRef.current.filter((x) => x !== sid)].slice(0, 10);
          changed = true;
        }
      }
      if (m.deleteSurface && typeof m.deleteSurface === 'object') {
        const ds = m.deleteSurface as Record<string, unknown>;
        const sid = typeof ds.surfaceId === 'string' ? ds.surfaceId : null;
        if (sid) {
          delete surfaceContentsRef.current[sid];
          recentSurfaceIdsRef.current = recentSurfaceIdsRef.current.filter((x) => x !== sid);
          changed = true;
        }
      }
    }
    if (changed) bumpPersist();
  }, [bumpPersist]);

  // Bump persist on chat changes too (drives the debounced chat save).
  useEffect(() => chatStore.subscribe(bumpPersist), [chatStore, bumpPersist]);

  const [routerTick, setRouterTick] = useState(0);
  const [harnessTick, setHarnessTick] = useState(0);
  useEffect(() => {
    const a = router.subscribe(() => setRouterTick((n) => n + 1));
    const b = harness.subscribe(() => setHarnessTick((n) => n + 1));
    return () => {
      a();
      b();
    };
  }, [router, harness]);

  // --- dynamic page roster -------------------------------------------------
  const createPageLocal = useCallback(
    (opts: { id?: string; title?: string; layout?: LayoutDescriptor; icon?: string; color?: string }): string => {
      const id = opts.id || uid('page');
      if (pagesRef.current.some((p) => p.id === id)) return id;
      const now = Date.now();
      const page: ApiPage = {
        id,
        title: opts.title || 'New page',
        icon: opts.icon,
        color: opts.color,
        layout: opts.layout || DEFAULT_LAYOUT,
        mapping: {},
        position: pagesRef.current.length,
        createdAt: now,
        updatedAt: now,
      };
      commitPages([...pagesRef.current, page]);
      createPage(workspaceId, page).catch(() => {});
      return id;
    },
    [commitPages, workspaceId],
  );

  // Trusted, user-initiated page creation routed from <CreatePageButton>. The agent
  // CANNOT create pages itself (it would let it silently mutate the workspace), so this
  // is the only path: a real click lands here, never the LLM. Optionally pins a result
  // surface into the new page, switches to it, then informs the agent so it can guide
  // the next step (e.g. suggest widgets to add).
  const handleCreatePage = useCallback<SystemActions['createPage']>(
    async ({ id, title, icon, color, pinSurfaceId }) => {
      const pageId = createPageLocal({ id, title, icon, color });
      if (pinSurfaceId && router.getLiveSurface(pinSurfaceId)) {
        try {
          await harness.apply(
            { name: 'pinSurface', surfaceId: pinSurfaceId, pageId, region: DEFAULT_LAYOUT.regions[0]!.id },
            { autoApprove: true },
          );
        } catch {
          /* pin is best-effort; the page is still created */
        }
      }
      setShellState((s) => ({ ...s, activeTabId: pageId }));
      const pageTitle = title || 'New page';
      chatStore.push({ role: 'system', text: `Created page “${pageTitle}”.` });
      // Inform the agent so it can confirm and suggest next steps (e.g. discoveryChips).
      void handlePromptRef.current(
        `[SYSTEM] The user just created the page "${pageTitle}"${pinSurfaceId ? ' and pinned a surface into it' : ''}. Briefly confirm, and if useful suggest a few discoveryChips for widgets they could add to this page.`,
        true,
      );
      return pageId;
    },
    [createPageLocal, harness, chatStore, router],
  );

  const systemActions = useMemo<SystemActions>(() => ({ createPage: handleCreatePage }), [handleCreatePage]);

  // Chips shown above the chat input: the agent's latest suggestions when present,
  // else the curated static set (conditional chips react to the current page roster).
  const discoveryChips = useMemo<DiscoveryChip[]>(
    () =>
      agentChips.length > 0
        ? agentChips
        : resolveStaticChips({ pages: pages.map((p) => ({ id: p.id, title: p.title })) }),
    [agentChips, pages],
  );

  const updatePageLocal = useCallback(
    (id: string, patch: Partial<ApiPage>) => {
      commitPages(pagesRef.current.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)));
      updatePage(id, patch).catch(() => {});
    },
    [commitPages],
  );

  const deletePageLocal = useCallback(
    (id: string) => {
      commitPages(pagesRef.current.filter((p) => p.id !== id));
      deletePage(id).catch(() => {});
      setShellState((s) => (s.activeTabId === id ? { ...s, activeTabId: 'chat' } : s));
    },
    [commitPages],
  );

  const handleSaveSettings = useCallback((next: AgentSettings) => {
    setSettings(next);
    setDiffsGated(next.gateDiffs);
    saveSettings(workspaceId, next).then((merged) => {
      if (merged) setSettings(merged);
    });
  }, [workspaceId]);

  const pendingByTabId = useMemo<Record<string, boolean>>(() => {
    const p: Record<string, boolean> = {};
    const sidToPage: Record<string, string> = {};
    for (const pg of pages) for (const sid of Object.keys(pg.mapping)) sidToPage[sid] = pg.id;
    for (const sid of router.pendingSurfaceIds()) {
      const pid = sidToPage[sid];
      if (pid) p[pid] = true;
      else p['chat'] = true;
    }
    for (const pg of pages) if (harness.hasPending(pg.id)) p[pg.id] = true;
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerTick, harnessTick, pages]);

  const inMotionSurfaceIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (const pg of pagesRef.current) {
      const pending = harness.getPending(pg.id);
      for (const op of pending?.ops ?? []) if (op.name === 'pinSurface') ids.add(op.surfaceId);
    }
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harnessTick]);

  // --- hooks (audit + approval + user-action → prompt) ---------------------
  useEffect(() => {
    const sharedHooks = {
      onProposed: (d: Diff) =>
        chatStore.push({
          role: 'system',
          text:
            d.kind === 'content'
              ? `Agent proposes changes to ${deriveSurfaceLabel(router.getShadowSurface(d.surfaceId) ?? router.getLiveSurface(d.surfaceId))}: ${describeContentChange(d, router.getLiveSurface(d.surfaceId), router.getShadowSurface(d.surfaceId))}. Review below.`
              : `Agent proposed ${d.op.name} on page ${d.pageId}. Review below.`,
        }),
      onApprove: (d: Diff) => {
        chatStore.push({
          role: 'agent',
          text:
            d.kind === 'content'
              ? `Applied changes to ${deriveSurfaceLabel(router.getLiveSurface(d.surfaceId))}.`
              : `approved ${d.op.name}`,
        });
        if (d.kind === 'content') {
          // Approving a gated diff commits the buffered messages straight into the
          // live model — but surfaceContentsRef + the timeline are only fed by the
          // emission/handler paths, so without this they keep the PRE-approval spec.
          // That stale snapshot is what `back`/restore (and the agent's context) read,
          // so e.g. an approved Chart `action` would vanish on restore. Re-snapshot
          // from the now-committed live surface so restores and context stay accurate.
          const committed = router.liveComponents(d.surfaceId);
          if (committed) {
            surfaceContentsRef.current[d.surfaceId] = committed;
            recordTimelineRef.current(d.surfaceId, 'agent');
          }
        }
        if (d.kind === 'page-op') {
          // A batch may pin/place several surfaces. Track each surface placed on a
          // page so future agent edits to it are gated; the chat entry stays and
          // renderChatSurface turns it into a "moved to <page>" placeholder.
          for (const op of d.ops) {
            const sid =
              op.name === 'pinSurface' || op.name === 'moveSurface' || op.name === 'setPageRegion'
                ? op.surfaceId
                : undefined;
            if (typeof sid === 'string') {
              pinnedSurfaceIdsRef.current.add(sid);
              if (diffsGated) router.gateSurface(sid);
            }
          }
        }
      },
      onReject: (d: Diff) => {
        chatStore.push({
          role: 'system',
          text:
            d.kind === 'content'
              ? `Discarded changes to ${deriveSurfaceLabel(router.getLiveSurface(d.surfaceId))}.`
              : `Layout changes rejected.`,
        });
      },
      onOpError: ({ pageId, op, message }: OpError) => {
        // User sees it...
        chatStore.push({ role: 'system', text: `Couldn't apply ${op.name} on page "${pageId}": ${message}` });
        // ...and the agent gets it next turn (drained into context.diagnostics).
        const sid = 'surfaceId' in op ? (op as { surfaceId?: string }).surfaceId : undefined;
        pageOpErrorsRef.current.push({
          surfaceId: sid,
          severity: 'error',
          code: `pageop.${op.name}.failed`,
          message: `Page op "${op.name}" on page "${pageId}" failed: ${message}. Re-issue it differently (e.g. a valid region/page) or tell the user it can't be done.`,
        });
      },
      onBeforeApply: (messages: unknown[]) => messages as never,
      onPageOp: (op: unknown) => op as never,
      onUserAction: (action: UserAction) => {
        // Show a compact, PERSISTENT chip (raw synth kept in `text` for agent
        // history/hover). NOTE: no surfaceId — otherwise removeBySurfaceId (fired
        // when the origin surface is pinned) would delete this notification.
        chatStore.push({ role: 'action', text: buildActionSynth(action, 1), actionLabel: action.name });
        // Serialize per-surface: dispatch now or queue behind an in-flight turn.
        // fromUserAction=true so resulting surface edits apply un-gated.
        enqueueUserAction(action);
      },
    };
    router.setHooks(sharedHooks);
    harness.setHooks(sharedHooks);
    actionHarness.setHooks(sharedHooks);
  }, [router, harness, actionHarness, chatStore, diffsGated, enqueueUserAction]);

  // --- load / restore on mount (once; StrictMode double-invokes effects) ---
  const didLoadRef = useRef(false);
  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    (async () => {
      // 0. Settings → seed gate-diffs before we gate any pinned surfaces below.
      const loadedSettings = await loadSettings(workspaceId);
      const gate = loadedSettings?.gateDiffs ?? true;
      if (loadedSettings) {
        setSettings(loadedSettings);
        setDiffsGated(gate);
      }

      // 1. Surfaces → replay into the live processor (createSurface → update → dataModel).
      const surfaces = await loadSurfaces(workspaceId);
      for (const s of surfaces) {
        const msgs: unknown[] = [
          { version: 'v0.9', createSurface: { surfaceId: s.surfaceId, catalogId, sendDataModel: true } },
          { version: 'v0.9', updateComponents: { surfaceId: s.surfaceId, components: s.components } },
        ];
        if (s.dataModel && Object.keys(s.dataModel).length > 0) {
          msgs.push({ version: 'v0.9', updateDataModel: { surfaceId: s.surfaceId, contents: s.dataModel } });
        }
        try {
          liveProcessor.processMessages(msgs as never);
          surfaceContentsRef.current[s.surfaceId] = s.components;
          widgetManager.loadSurface(s.surfaceId, s.handlers);
          // TEMP DIAGNOSTIC: what handlers does this surface load with?
          fetch(`${(window as { __ARETE_API_BASE__?: string }).__ARETE_API_BASE__ ?? ''}/api/__dbg`, {
            method: 'POST',
            body: JSON.stringify({
              probe: 'loadSurface',
              ws: workspaceId,
              surfaceId: s.surfaceId,
              handlerEvents: s.handlers ? Object.keys(s.handlers) : null,
            }),
          }).catch(() => {});
          if (Array.isArray(s.history) && s.history.length) {
            surfaceTimelineRef.current[s.surfaceId] = s.history;
            const maxSeq = s.history.reduce((m, e) => Math.max(m, e.seq ?? 0), 0);
            if (maxSeq > timelineSeqRef.current) timelineSeqRef.current = maxSeq;
          }
        } catch {
          /* skip malformed persisted surface */
        }
      }
      recentSurfaceIdsRef.current = surfaces.map((s) => s.surfaceId).slice(0, 10);

      // 2. Pages → roster (tabs). Mark pinned surfaces + gate.
      const ps = await loadPages(workspaceId);
      commitPages(ps);
      for (const pg of ps) {
        for (const sid of Object.keys(pg.mapping)) {
          pinnedSurfaceIdsRef.current.add(sid);
          if (gate) router.gateSurface(sid);
        }
      }
      setRouterTick((n) => n + 1);

      // 3. Chat transcript. Re-derive the action chip label from the persisted
      //    synthetic text so restored action entries stay masked (not raw).
      const chat = await loadChat(workspaceId);
      for (const e of chat) {
        const actionLabel =
          e.role === 'action' ? (/event "([^"]+)"/.exec(e.text ?? '')?.[1] ?? 'action') : undefined;
        chatStore.push({
          role: e.role as ChatRole,
          text: e.text,
          surfaceId: e.surfaceId,
          id: e.id,
          createdAt: e.createdAt,
          actionLabel,
          scriptEvent: e.scriptEvent,
          oldCode: e.oldCode,
          newCode: e.newCode,
        });
        // Rebuild the in-memory pending map so a restored (still-unresolved)
        // script-diff card can be approved/rejected after a restart.
        if (e.role === 'script-diff' && e.scriptEvent && typeof e.newCode === 'string') {
          pendingScriptsRef.current.set(e.id, {
            targetSurfaceId: e.surfaceId ?? '',
            event: e.scriptEvent,
            code: e.newCode,
          });
        }
      }

      // 4. Per-workspace UI state (active tab + chat dock) is seeded into shellState
      //    from the workspace record via props — no separate load needed.
      getAgentHealth()
        .then((h) => setAvailableModels(h.available ?? []))
        .catch(() => {});
    })()
      .catch(() => {})
      .finally(() => setHydrated(true)); // enable persistence only after restore
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- debounced saves (gated on hydration; see {@link hydrated}) ----------
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      const entries = chatStore.getSnapshot().map((e) => ({
        id: e.id,
        role: e.role,
        text: e.text ?? '',
        surfaceId: e.surfaceId,
        createdAt: e.createdAt,
        // Persist the under-review state for pending script-diff cards.
        scriptEvent: e.scriptEvent,
        oldCode: e.oldCode,
        newCode: e.newCode,
      }));
      saveChat(workspaceId, entries).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [chatStore, persistTick, hydrated, workspaceId]);

  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      const recs = Object.entries(surfaceContentsRef.current).map(([surfaceId, components]) => {
        let dataModel: Record<string, unknown> = {};
        try {
          const dm = liveProcessor.model.getSurface(surfaceId)?.dataModel?.get('/');
          if (dm && typeof dm === 'object') dataModel = dm as Record<string, unknown>;
        } catch {
          /* ignore */
        }
        return {
          surfaceId,
          components: components as unknown[],
          dataModel,
          updatedAt: Date.now(),
          handlers: widgetManager.forSurface(surfaceId),
          history: surfaceTimelineRef.current[surfaceId] ?? [],
        };
      });
      saveSurfaces(workspaceId, recs).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [persistTick, liveProcessor, hydrated, workspaceId]);

  // Persist per-workspace UI state (active tab + chat dock) onto the workspace record.
  useEffect(() => {
    if (!hydrated) return;
    updateWorkspace(workspaceId, {
      activeTabId: shellState.activeTabId ?? undefined,
      chatDockState: shellState.chatDockState,
    }).catch(() => {});
  }, [shellState, hydrated, workspaceId]);

  // On workspace switch (this view unmounts), abort any in-flight agent turns so
  // their streams don't keep running against the torn-down state.
  useEffect(() => {
    const controllers = abortControllersRef.current;
    return () => {
      for (const c of controllers) c.abort();
    };
  }, []);

  // --- prompt → AG-UI stream → diff pipeline -------------------------------
  const handlePrompt = useCallback(
    async (text: string, fromUserAction = false) => {
      const activePage = pagesRef.current.find((p) => p.id === shellState.activeTabId);
      const activeMapping = activePage?.mapping ?? {};
      const surfacesPayload: Record<string, SurfaceSnapshot> = {};
      for (const [sid, components] of Object.entries(surfaceContentsRef.current)) {
        let dataModel: Record<string, unknown> = {};
        try {
          const dm = liveProcessor.model.getSurface(sid)?.dataModel?.get('/');
          if (dm && typeof dm === 'object') dataModel = dm as Record<string, unknown>;
        } catch {
          /* ignore */
        }
        const region = activeMapping[sid];
        // Last few timeline entries so the LLM's getSurfaceHistory tool can study
        // recent prior states without bloating the request with the full history.
        const tl = surfaceTimelineRef.current[sid] ?? [];
        const history = tl.slice(-8);
        surfacesPayload[sid] = { components, dataModel, visibleOnActivePage: region != null, region, history };
      }

      const pagesCtx: Record<string, { layout: LayoutDescriptor; mapping: Record<string, string> }> = {};
      for (const p of pagesRef.current) {
        // Keep the agent's page view ACCURATE: omit mapping entries whose surface
        // isn't actually live (e.g. a stale/deleted surface), so it never reasons
        // about a phantom occupant and sees the region as genuinely free.
        const mapping: Record<string, string> = {};
        for (const [sid, region] of Object.entries(p.mapping)) {
          if (liveProcessor.model.getSurface(sid) != null) mapping[sid] = region;
        }
        pagesCtx[p.id] = { layout: p.layout, mapping };
      }

      const { messages: allMessages, ...agentContext } = buildAgentContext({
        chatStore,
        actionHarness,
        renderDiagnostics,
        componentHints: componentAgentHints,
        surfaces: surfacesPayload,
        pages: pagesCtx,
        activeTabId: shellState.activeTabId,
        recentSurfaceIds: recentSurfaceIdsRef.current,
        recentPinnedSurfaceId: [...pinnedSurfaceIdsRef.current].pop() ?? null,
        chatSurfaceIds: chatStore.getSnapshot().filter((e) => e.surfaceId != null).map((e) => e.surfaceId!),
      });
      // Fold any buffered page-op failures into this turn's diagnostics (then clear,
      // so the agent is told once and they age out — like a tool error in history).
      if (pageOpErrorsRef.current.length) {
        agentContext.diagnostics = [...agentContext.diagnostics, ...pageOpErrorsRef.current];
        pageOpErrorsRef.current = [];
      }
      const last = allMessages[allMessages.length - 1];
      const priorMessages =
        last && last.role === 'user' && last.content === text ? allMessages.slice(0, -1) : allMessages;

      // Track the turn so the chat input can show Cancel and abort the fetch.
      const controller = new AbortController();
      abortControllersRef.current.add(controller);
      setBusyCount((c) => c + 1);
      // Clear last turn's agent chips; this turn may emit fresh ones, else the chip
      // bar falls back to the static set.
      setAgentChips([]);

      const askingEntry = chatStore.push({ role: 'system', text: 'Asking the agent', pending: true });
      let cleared = false;
      const clearAsking = () => {
        if (cleared) return;
        cleared = true;
        chatStore.remove(askingEntry.id);
      };
      try {
        await streamAgent(text, priorMessages, agentContext, {
          onToolCallStart: ({ toolCallName, toolCallId }) => {
            chatStore.push({ role: 'tool', toolName: toolCallName, id: toolCallId });
          },
          onToolResult: ({ toolCallId, content, isError }) => {
            // Attach the result to the existing tool row (created on start) by id.
            chatStore.update(toolCallId, { toolResult: content, toolError: isError });
          },
          onTextEnd: ({ messageId, text: msgText }) => {
            clearAsking();
            if (!msgText) return;
            chatStore.push({ role: messageId.startsWith('thinking:') ? 'thought' : 'agent', text: msgText });
          },
          onEmission: (emission) => {
            clearAsking();
            if (emission.kind === 'a2ui') {
              const targetId = emission.targetSurfaceId;
              let messages = emission.messages as unknown[];
              const hasCreate = messages.some((m) => !!m && typeof m === 'object' && 'createSurface' in (m as object));
              const isExisting =
                !!targetId &&
                (surfaceContentsRef.current[targetId] !== undefined || liveProcessor.model.getSurface(targetId) != null);
              // Robustness: a brand-new surface needs a createSurface before its
              // updateComponents, or the processor has nothing to render (the surface
              // renders empty — "where's the widget?"). Local models sometimes emit
              // updateComponents-only to a new id; synthesize the createSurface here.
              if (targetId && !isExisting && !hasCreate) {
                messages = [
                  { version: 'v0.9', createSurface: { surfaceId: targetId, catalogId, sendDataModel: true } },
                  ...messages,
                ];
              }
              // Gate only MODIFICATIONS to an existing surface, and only when NOT
              // triggered by a user action (those apply directly). Brand-new
              // surfaces (createSurface) render straight into the chat scroll.
              const isModification = isExisting && !hasCreate;
              if (diffsGated && isModification && !fromUserAction) router.gateSurface(targetId);
              // Only capture components that are applied to the LIVE model (not gated to
              // shadow). Otherwise the agent context shows gated changes as "already present"
              // and the validator marks re-emits as no-ops — but the user hasn't approved yet.
              if (!(diffsGated && isModification && !fromUserAction)) {
                captureSurfaceContents(messages);
              }
              // User-action edits apply straight to live even if the target surface is
              // gated (e.g. pinned) — those changes are the user's own doing.
              router.route(messages as never, { bypassGate: fromUserAction });
              // Record the agent-driven state in the generic timeline. Gated diffs
              // are recorded only once approved (router ticks), so skip while gated.
              if (targetId && !(diffsGated && isModification && !fromUserAction)) {
                recordTimelineRef.current(targetId, fromUserAction ? 'user-action' : 'agent');
              }
              chatStore.upsertSurface(targetId, { role: 'agent' });
            } else if (emission.kind === 'pageOp') {
              const op = emission.op as { name?: string; pageId?: string; title?: string; icon?: string; color?: string; layout?: LayoutDescriptor };
              if (!op || typeof op.name !== 'string') {
                // Malformed op (e.g. empty {}) — never route it (would switch to a
                // non-existent tab); tell the user instead of failing silently.
                chatStore.push({ role: 'system', text: 'Agent emitted an invalid page operation — ignored.' });
              } else if (op.name === 'createPage' || op.name === 'deletePage') {
                // Page lifecycle (create/delete tabs) is a USER-only action — the agent
                // has no way to add or remove pages. Refuse the op and feed the refusal
                // back to the agent so it re-plans onto an existing page or the chat.
                chatStore.push({
                  role: 'system',
                  text: `Agent tried to ${op.name === 'createPage' ? 'create' : 'delete'} a page — not allowed. Only the user can add or remove pages.`,
                });
                pageOpErrorsRef.current.push({
                  surfaceId: undefined,
                  severity: 'error',
                  code: `pageop.${op.name}.forbidden`,
                  message: `"${op.name}" is not available to the agent — only the user can create or delete pages. Place surfaces on an EXISTING page (setPageRegion/pinSurface/moveSurface) or leave them in the chat scroll instead.`,
                });
              } else if (op.name === 'setPageProps' && op.pageId) {
                const patch: Record<string, unknown> = {};
                if (op.title !== undefined) patch.title = op.title;
                if (op.icon !== undefined) patch.icon = op.icon;
                if (op.color !== undefined) patch.color = op.color;
                if (Object.keys(patch).length) updatePageLocal(op.pageId, patch);
              } else {
                // User-action page ops auto-apply (no approval gate), matching content edits.
                harness.apply(op as never, { autoApprove: fromUserAction });
              }
            } else if (emission.kind === 'widgetScript') {
              // Gate widgetScript changes: show a unified code diff for
              // approval BEFORE registering the handler on the surface.
              try {
                validateHandler(emission.code);
              } catch (e) {
                chatStore.push({
                  role: 'system',
                  text: `Ignored an invalid "${emission.event}" handler: ${(e as Error).message}`,
                });
                return;
              }
              const oldHandler = widgetManager.handlerFor(emission.targetSurfaceId, emission.event);
              const diffEntryId = uid('scd');
              const diffEntry = chatStore.push({
                id: diffEntryId,
                role: 'script-diff',
                surfaceId: emission.targetSurfaceId,
                scriptEvent: emission.event,
                oldCode: oldHandler?.code ?? '',
                newCode: emission.code,
              });
              pendingScriptsRef.current.set(diffEntryId, {
                targetSurfaceId: emission.targetSurfaceId,
                event: emission.event,
                code: emission.code,
              });
            }
          },
          onDiscoveryChips: (chips) => {
            clearAsking();
            setAgentChips(chips);
          },
          onRunError: ({ message }) => {
            clearAsking();
            chatStore.push({ role: 'system', text: `Agent error: ${message}` });
          },
        }, controller.signal);
        clearAsking();
      } catch (err) {
        clearAsking();
        if (controller.signal.aborted) {
          chatStore.push({ role: 'system', text: 'Cancelled.' });
        } else {
          chatStore.push({ role: 'system', text: `Agent error: ${(err as Error).message}` });
        }
      } finally {
        abortControllersRef.current.delete(controller);
        setBusyCount((c) => c - 1);
      }
    },
    [
      chatStore,
      diffsGated,
      router,
      harness,
      actionHarness,
      renderDiagnostics,
      liveProcessor,
      captureSurfaceContents,
      createPageLocal,
      updatePageLocal,
      deletePageLocal,
      shellState.activeTabId,
      widgetManager,
      catalogId,
    ],
  );

  useEffect(() => {
    handlePromptRef.current = handlePrompt;
  }, [handlePrompt]);

  // --- Generic surface-state timeline ---------------------------------------
  // Append the current state of `surfaceId` to its timeline. Called after a render
  // is applied (any source: agent, user-action, handler, restore). `trigger` is a
  // human/LLM-readable label. The latest entry == the surface's current view.
  const recordTimeline = useCallback(
    (surfaceId: string, trigger: string) => {
      const components = surfaceContentsRef.current[surfaceId];
      if (!components) return;
      let dataModel: Record<string, unknown> | undefined;
      try {
        const dm = liveProcessor.model.getSurface(surfaceId)?.dataModel?.get('/');
        if (dm && typeof dm === 'object') dataModel = dm as Record<string, unknown>;
      } catch {
        /* ignore */
      }
      const entry: TimelineEntry = {
        seq: ++timelineSeqRef.current,
        ts: Date.now(),
        trigger,
        components: JSON.parse(JSON.stringify(components)) as unknown[],
        dataModel,
      };
      const list = (surfaceTimelineRef.current[surfaceId] ??= []);
      list.push(entry);
      if (list.length > MAX_TIMELINE_PER_SURFACE) list.splice(0, list.length - MAX_TIMELINE_PER_SURFACE);
      bumpPersist();
    },
    [liveProcessor, bumpPersist],
  );
  recordTimelineRef.current = recordTimeline;

  // Apply a flat component array to a surface (used by handlers / restores) and
  // record it in the timeline.
  const applyComponents = useCallback(
    (surfaceId: string, components: unknown[], trigger: string) => {
      const messages = [{ version: 'v0.9', updateComponents: { surfaceId, components } }];
      captureSurfaceContents(messages);
      router.route(messages as never, { bypassGate: true });
      recordTimeline(surfaceId, trigger);
    },
    [captureSurfaceContents, router, recordTimeline],
  );

  // Build the read-only `surface` object handed to a handler sandbox: current
  // components + dataModel, plus the generic `history` timeline so a handler can
  // restore/derive from a prior state (e.g. Back = render history[len-2]).
  const buildSurfacePayload = useCallback((surfaceId: string) => {
    const components = surfaceContentsRef.current[surfaceId] ?? [];
    let dataModel: Record<string, unknown> = {};
    try {
      const dm = liveProcessor.model.getSurface(surfaceId)?.dataModel?.get('/');
      if (dm && typeof dm === 'object') dataModel = dm as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    return { components, dataModel, history: surfaceTimelineRef.current[surfaceId] ?? [] };
  }, [liveProcessor]);

  // Run a surface's agent-authored handler in the webview's native JS engine (ONE
  // runtime, no LLM). `render` applies edits to the live surface; `tools.<name>()`
  // proxies to the backend MCP endpoint (auth stays server-side). On any failure,
  // fall back to a normal LLM turn so the journey still works.
  const runWidget = useCallback(
    async (action: UserAction, handler: WidgetHandler) => {
      const surfaceId = action.surfaceId;
      if (!surfaceId) return;
      const trigger = `handler:${action.name}`;
      const controller = new AbortController();
      abortControllersRef.current.add(controller);
      setBusyCount((c) => c + 1);
      // Record the SHAPE of each tool's result as the handler runs, so a failure can
      // tell the agent what the tool actually returned (the agent never sees tool
      // OUTPUT schemas, so it guesses field paths — the #1 source of handler bugs).
      const toolShapes = new Map<string, string>();
      const tools = new Proxy(
        {},
        {
          get: (_t, name: string | symbol) => {
            // Don't return a callable for `then`/symbol/internal probes: otherwise the
            // proxy looks thenable and any accidental `await tools` (or a handler that
            // returns it) fires a spurious backend call with name "then". Returning
            // undefined makes such access a normal no-op / ReferenceError instead.
            if (typeof name !== 'string' || name === 'then' || name === 'catch' || name === 'finally') {
              return undefined;
            }
            return async (args?: unknown) => {
              const result = await callMcpTool(name, args, controller.signal);
              toolShapes.set(name, describeShape(result));
              return result;
            };
          },
        },
      ) as Record<string, (args?: unknown) => Promise<unknown>>;
      const toolShapeHint = () =>
        toolShapes.size
          ? ` The tools it called returned these shapes (read fields accordingly): ${[...toolShapes]
              .map(([n, s]) => `${n} → ${s}`)
              .join('; ')}.`
          : '';
      // Live indicator: a pending breadcrumb (animated) so the user can see the script
      // is RUNNING (its tool calls hit the network); updated to a done state on success.
      const pendingEntry = chatStore.push({ role: 'system', text: `Auto-handling "${action.name}"`, pending: true });
      try {
        await runClientHandler(handler.code, action.context ?? {}, buildSurfacePayload(surfaceId), {
          render: (target, comps) => {
            const sid = !target || target === 'self' ? surfaceId : target;
            applyComponents(sid, comps as unknown[], trigger);
          },
          tools,
        });
        // Done: settle the breadcrumb (no longer pending/animated).
        chatStore.update(pendingEntry.id, {
          text: `⚡ Auto-handled "${action.name}" with a learned script — no agent turn.`,
          pending: false,
        });
        // The handler may run WITHOUT throwing yet still render a structurally-broken
        // surface (e.g. a DataTable whose data came out undefined → empty, no pages).
        // Components report an error-severity diagnostic for that; detect it after the
        // render commits and treat it like a failure — feed it back + ask the agent to
        // fix the handler. (setTimeout: let React commit + the diagnostic effect run.)
        const sid = surfaceId;
        const ev = action.name;
        setTimeout(() => {
          if (controller.signal.aborted) return;
          const errs = renderDiagnostics.getBySurface(sid).filter((d) => d.severity === 'error');
          if (!errs.length) return;
          chatStore.push({
            role: 'system',
            text: `The "${ev}" script ran but rendered a broken surface (${errs[0]?.message ?? 'render error'}) — asking the agent to fix it.`,
          });
          // renderDiagnostics are already folded into the next turn's context, so the
          // agent sees the specifics and can re-emit a corrected handler. Add the tool
          // result shapes so it can see whether it read the wrong field path.
          pageOpErrorsRef.current.push({
            surfaceId: sid,
            severity: 'error',
            code: `widget.${ev}.broken-render`,
            message: `The "${ev}" handler ran but produced a broken surface (${errs[0]?.message ?? 'render error'}).${toolShapeHint()} Re-emit a corrected widgetScript handler for "${ev}" that reads the fields shown above.`,
          });
          void handlePromptRef.current(buildActionSynth(action, 1), true);
        }, 0);
      } catch (err) {
        chatStore.remove(pendingEntry.id); // drop the in-progress indicator
        if (!controller.signal.aborted) {
          const msg = err instanceof Error ? err.message : String(err);
          chatStore.push({ role: 'system', text: `Widget action failed: ${msg}` });
          // Feed the runtime failure back to the agent so the fallback turn can
          // re-emit a CORRECTED handler. The usual cause is a wrong assumption about a
          // tool's RESULT shape (reading the wrong field path) — so include the shapes
          // the tools actually returned this run, which the agent can't otherwise see.
          pageOpErrorsRef.current.push({
            surfaceId,
            severity: 'error',
            code: `widget.${action.name}.failed`,
            message: `The attached "${action.name}" handler threw at runtime: ${msg}. This is usually a wrong field path on a tool's result or a missing null-check.${toolShapeHint()} Handle this action now AND re-emit a corrected widgetScript handler for "${action.name}" that reads the fields shown above so it works next time.`,
          });
          await handlePromptRef.current(buildActionSynth(action, 1), true);
        }
      } finally {
        abortControllersRef.current.delete(controller);
        setBusyCount((c) => c - 1);
      }
    },
    [applyComponents, buildSurfacePayload, chatStore, renderDiagnostics],
  );

  // Decide per action: a registered Widget Manager handler (run in the webview) or the LLM.
  dispatchActionRef.current = (item) => {
    const h = widgetManager.handlerFor(item.action.surfaceId, item.action.name);
    // TEMP DIAGNOSTIC: why does a toggle round-trip to the agent?
    fetch(`${(window as { __ARETE_API_BASE__?: string }).__ARETE_API_BASE__ ?? ''}/api/__dbg`, {
      method: 'POST',
      body: JSON.stringify({
        probe: 'dispatch',
        actionSurfaceId: item.action.surfaceId,
        actionName: item.action.name,
        found: !!h,
      }),
    }).catch(() => {});
    if (h) return runWidget(item.action, h);
    return Promise.resolve(handlePromptRef.current(buildActionSynth(item.action, item.repeatCount), true));
  };

  const renderChatSurface = useCallback(
    (surfaceId: string) => {
      // If this surface has been placed on a page, replace the (redundant) chat
      // copy with a compact "moved to <page>" placeholder that locates it.
      const hostPage = pages.find((p) => Object.prototype.hasOwnProperty.call(p.mapping, surfaceId));
      if (hostPage) {
        const hasPendingDiff = router.hasPending(surfaceId);
        return (
          <button
            type="button"
            onClick={() => locateSurface(surfaceId, hostPage.id)}
            title={`Show on ${hostPage.title}${hasPendingDiff ? ' — pending changes need approval' : ''}`}
            style={{
              marginTop: 8,
              width: '100%',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: hasPendingDiff ? 'rgba(251,191,36,0.12)' : 'rgba(124,131,255,0.10)',
              border: hasPendingDiff
                ? '1.5px solid rgba(251,191,36,0.5)'
                : '1px dashed var(--glass-border-2, rgba(124,131,255,0.35))',
              borderRadius: 12,
              padding: '10px 12px',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              fontSize: 12.5,
            }}
          >
            <span aria-hidden style={{ fontSize: 14 }}>{hasPendingDiff ? '🟡' : '📌'}</span>
            <span>
              {hasPendingDiff ? (
                <><strong style={{ color: '#fbbf24' }}>Review changes</strong> on </>
              ) : (
                'Moved to '
              )}
              <strong style={{ color: 'var(--text)' }}>{hostPage.icon || '📄'} {hostPage.title}</strong>
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ color: hasPendingDiff ? '#fbbf24' : 'var(--accent-2, #22d3ee)' }}>
              {hasPendingDiff ? 'Review ↗' : 'Show ↗'}
            </span>
          </button>
        );
      }
      const liveSurface = liveProcessor.model.getSurface(surfaceId);
      const inMotion = inMotionSurfaceIds.has(surfaceId);
      return (
        <div
          style={{
            marginTop: 8,
            background: 'rgba(8,9,22,0.45)',
            backdropFilter: 'var(--blur)',
            WebkitBackdropFilter: 'var(--blur)',
            padding: 10,
            borderRadius: 12,
            border: inMotion ? '1.5px solid #fbbf24' : '1px solid var(--glass-border)',
            boxShadow: inMotion
              ? '0 0 22px -4px rgba(251,191,36,0.5)'
              : 'inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          <DiffOverlay router={router} surfaceId={surfaceId} placement="inline">
            {liveSurface ? (
              <SurfaceIdProvider surfaceId={surfaceId}>
                <SurfaceBoundary resetKey={surfaceId} label={surfaceId}>
                  <A2uiSurface surface={liveSurface} />
                </SurfaceBoundary>
              </SurfaceIdProvider>
            ) : null}
          </DiffOverlay>
        </div>
      );
    },
    [router, liveProcessor, inMotionSurfaceIds, pages, locateSurface],
  );

  const tabs: ShellTab[] = pages.map((p) => ({
    id: p.id,
    label: p.title,
    icon: <span>{p.icon || '📄'}</span>,
    color: p.color,
    render: () => (
      <Page
        pageId={p.id}
        layout={p.layout}
        mapping={p.mapping}
        externalLayout={p.layout}
        onLayoutChange={(l) => updatePageLocal(p.id, { layout: l })}
        onMappingChange={(m) => updatePageLocal(p.id, { mapping: m })}
        router={router}
        harness={harness}
        highlightSurfaceId={highlightedSurfaceId}
      />
    ),
  }));

  const btnStyle: React.CSSProperties = {
    background: 'var(--glass-2)',
    color: 'var(--text)',
    border: '1px solid var(--glass-border)',
    borderRadius: 999,
    padding: '6px 14px',
    fontSize: 12.5,
    fontWeight: 500,
    cursor: 'pointer',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
    transition: 'background 0.18s ease, border-color 0.18s ease',
  };

  return (
    <MarkdownContext.Provider value={renderMarkdown}>
      <SystemActionsProvider value={systemActions}>
      <Shell
        tabs={tabs}
        state={shellState}
        onStateChange={setShellState}
        harness={harness}
        renderDiagnostics={renderDiagnostics}
        chatTab={{
          tab: { id: 'chat', label: 'Chat', icon: <span>💬</span> },
          renderSurface: renderChatSurface,
          onApproveScript: handleApproveScript,
          onRejectScript: handleRejectScript,
          onLocateSurface: handleLocateSurface,
        }}
        topBar={
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: 19,
                letterSpacing: -0.3,
                background: 'linear-gradient(120deg, #fff 10%, var(--accent) 60%, var(--accent-2) 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              arete
            </span>
            {switcherSlot}
            <span style={{ color: 'var(--text-faint)', fontSize: 12, letterSpacing: 0.2 }}>
              chat · agent-mutable pages
            </span>
            <div style={{ flex: 1 }} />
            <button type="button" style={btnStyle} onClick={() => setSettingsOpen(true)} aria-label="Settings">
              ⚙️ Settings
            </button>
            {shellState.activeTabId !== 'chat' && (
              <button type="button" style={btnStyle} onClick={() => deletePageLocal(shellState.activeTabId as string)}>
                Delete page
              </button>
            )}
            <button
              type="button"
              style={{
                ...btnStyle,
                background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))',
                border: '1px solid rgba(124,131,255,0.5)',
                color: '#fff',
                fontWeight: 600,
                boxShadow: '0 6px 18px -8px rgba(124,131,255,0.7), inset 0 1px 0 rgba(255,255,255,0.3)',
              }}
              onClick={() => {
                const id = createPageLocal({ title: `Page ${pagesRef.current.length + 1}` });
                setShellState((s) => ({ ...s, activeTabId: id }));
              }}
            >
              + New page
            </button>
          </div>
        }
        hooks={{ onPrompt: handlePrompt, busy: busyCount > 0, onCancelPrompt: cancelPrompt, discoveryChips }}
        chatStore={chatStore}
        pendingByTabId={pendingByTabId}
        actionHarness={actionHarness}
      />
      {settings && (
        <SettingsPanel
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          settings={settings}
          availableModels={availableModels}
          onSave={handleSaveSettings}
        />
      )}
      </SystemActionsProvider>
    </MarkdownContext.Provider>
  );
}

/**
 * Root: owns the workspace list + the globally-active workspace, and mounts ONE
 * <WorkspaceView> keyed by the active id. Switching the active id remounts it, so
 * each workspace is a clean, isolated thread (its own pages/surfaces/chat). The
 * workspace switcher is rendered here and injected into the view's top bar.
 */
export function App() {
  const [workspaces, setWorkspaces] = useState<ApiWorkspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { workspaces: ws, activeWorkspaceId: active } = await loadWorkspaces();
    setWorkspaces(ws);
    setActiveWorkspaceId((cur) => cur ?? active ?? ws[0]?.id ?? null);
    return ws;
  }, []);

  // Bootstrap: load workspaces, and AUTO-CREATE a first one if none exist (e.g. a
  // brand-new install) so the app always has a workspace to open.
  useEffect(() => {
    (async () => {
      let { workspaces: ws, activeWorkspaceId: active } = await loadWorkspaces();
      if (ws.length === 0) {
        const w = await createWorkspace('Workspace 1').catch(() => null);
        if (w) {
          ws = [w];
          active = w.id;
        }
      }
      setWorkspaces(ws);
      setActiveWorkspaceId(active ?? ws[0]?.id ?? null);
    })().catch(() => {});
  }, []);

  const switchWorkspace = useCallback((id: string) => {
    setActiveWorkspaceId(id); // instant remount
    activateWorkspace(id).catch(() => {}); // persist active (background)
  }, []);

  const handleCreate = useCallback(
    async (name: string) => {
      const w = await createWorkspace(name);
      await refresh();
      switchWorkspace(w.id);
    },
    [refresh, switchWorkspace],
  );

  const handleRename = useCallback(
    async (id: string, name: string) => {
      await updateWorkspace(id, { name });
      await refresh();
    },
    [refresh],
  );

  const handleDelete = useCallback(async (id: string) => {
    const res = await deleteWorkspace(id).catch(() => null);
    const { workspaces: ws } = await loadWorkspaces();
    setWorkspaces(ws);
    if (res?.activeWorkspaceId) setActiveWorkspaceId(res.activeWorkspaceId);
    else setActiveWorkspaceId((cur) => (ws.some((w) => w.id === cur) ? cur : ws[0]?.id ?? null));
  }, []);

  if (!activeWorkspaceId) {
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center', color: 'var(--text-faint, #888)' }}>
        Loading…
      </div>
    );
  }

  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  return (
    <WorkspaceView
      key={activeWorkspaceId}
      workspaceId={activeWorkspaceId}
      initialActiveTabId={active?.activeTabId}
      initialChatDockState={active?.chatDockState}
      switcherSlot={
        <WorkspaceSwitcher
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSwitch={switchWorkspace}
          onCreate={handleCreate}
          onRename={handleRename}
          onDelete={handleDelete}
        />
      }
    />
  );
}
