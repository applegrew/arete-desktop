import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import { A2uiSurface, MarkdownContext, type ReactComponentImplementation } from '@a2ui/react/v0_9';
import { renderMarkdown } from '@a2ui/markdown-it';
import {
  Shell,
  Page,
  ChatStore,
  DiffRouter,
  DiffOverlay,
  PageOpsHarness,
  ActionHarness,
  RenderDiagnosticsStore,
  withComponentIds,
  buildAgentContext,
  deriveSurfaceLabel,
  describeContentChange,
  uid,
  type ShellTab,
  type ShellState,
  type LayoutDescriptor,
  type Diff,
  type UserAction,
  type SurfaceSnapshot,
  type ChatRole,
} from '@arete-ui/core';
import { primeReactCatalog, componentAgentHints } from '@arete-ui/adapter-primereact';
import { streamAgent } from './agui-client';
import {
  loadPages,
  createPage,
  updatePage,
  deletePage,
  loadSurfaces,
  saveSurfaces,
  loadChat,
  saveChat,
  loadState,
  saveState,
  getAgentHealth,
  loadSettings,
  saveSettings,
  type ApiPage,
  type AgentSettings,
} from './persistence';
import { SettingsPanel } from './SettingsPanel';

const DEFAULT_LAYOUT: LayoutDescriptor = {
  kind: 'grid',
  rows: 2,
  cols: 2,
  regions: [{ id: 'top-left' }, { id: 'top-right' }, { id: 'bottom-left' }, { id: 'bottom-right' }],
};

export function App() {
  const currentCatalog = useMemo(() => withComponentIds(primeReactCatalog), []);
  const catalogId = useMemo(() => (currentCatalog as { id: string }).id, [currentCatalog]);

  const liveProcessor = useMemo(
    () => new MessageProcessor<ReactComponentImplementation>([currentCatalog]),
    [currentCatalog],
  );
  const shadowProcessor = useMemo(
    () => new MessageProcessor<ReactComponentImplementation>([currentCatalog]),
    [currentCatalog],
  );
  const router = useMemo(() => new DiffRouter(liveProcessor, shadowProcessor), [liveProcessor, shadowProcessor]);
  const harness = useMemo(() => new PageOpsHarness(), []);
  const actionHarness = useMemo(() => new ActionHarness(), []);
  const renderDiagnostics = useMemo(() => new RenderDiagnosticsStore(), []);
  const chatStore = useMemo(() => new ChatStore(), []);

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
  const recentSurfaceIdsRef = useRef<string[]>([]);
  const handlePromptRef = useRef<(text: string, fromUserAction?: boolean) => void>(() => {});
  const [shellState, setShellState] = useState<ShellState>({ activeTabId: 'chat', chatDockState: 'dock' });

  // Transient halo target — set when locating a surface moved to a page; auto-clears.
  const [highlightedSurfaceId, setHighlightedSurfaceId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locateSurface = useCallback((surfaceId: string, pageId: string) => {
    setShellState((s) => (s.activeTabId === pageId ? s : { ...s, activeTabId: pageId }));
    setHighlightedSurfaceId(surfaceId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedSurfaceId(null), 2400);
  }, []);

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
      createPage(page).catch(() => {});
      return id;
    },
    [commitPages],
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
    saveSettings(next).then((merged) => {
      if (merged) setSettings(merged);
    });
  }, []);

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
      if (pending?.op.name === 'pinSurface') ids.add(pending.op.surfaceId);
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
        if (d.kind === 'page-op' && d.op.name === 'pinSurface') {
          pinnedSurfaceIdsRef.current.add(d.op.surfaceId);
          // Keep the chat entry — renderChatSurface replaces it with a "moved to
          // <page>" placeholder once the surface is mapped onto a page.
          if (diffsGated) router.gateSurface(d.op.surfaceId);
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
      onBeforeApply: (messages: unknown[]) => messages as never,
      onPageOp: (op: unknown) => op as never,
      onUserAction: (action: UserAction) => {
        const contextStr = JSON.stringify(action.context);
        const surfaceClause = action.surfaceId ? ` on surface ${action.surfaceId}` : '';
        const componentClause = action.sourceComponentId ? ` (component ${action.sourceComponentId})` : '';
        const synth = `[USER ACTION] event "${action.name}"${surfaceClause}${componentClause}; context: ${contextStr}`;
        // Show a compact, PERSISTENT chip (raw synth kept in `text` for agent
        // history/hover). NOTE: no surfaceId — otherwise removeBySurfaceId (fired
        // when the origin surface is pinned) would delete this notification.
        // fromUserAction=true so resulting surface edits apply un-gated.
        chatStore.push({ role: 'action', text: synth, actionLabel: action.name });
        handlePromptRef.current(synth, true);
      },
    };
    router.setHooks(sharedHooks);
    harness.setHooks(sharedHooks);
    actionHarness.setHooks(sharedHooks);
  }, [router, harness, actionHarness, chatStore, diffsGated]);

  // --- load / restore on mount (once; StrictMode double-invokes effects) ---
  const didLoadRef = useRef(false);
  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    (async () => {
      // 0. Settings → seed gate-diffs before we gate any pinned surfaces below.
      const loadedSettings = await loadSettings();
      const gate = loadedSettings?.gateDiffs ?? true;
      if (loadedSettings) {
        setSettings(loadedSettings);
        setDiffsGated(gate);
      }

      // 1. Surfaces → replay into the live processor (createSurface → update → dataModel).
      const surfaces = await loadSurfaces();
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
        } catch {
          /* skip malformed persisted surface */
        }
      }
      recentSurfaceIdsRef.current = surfaces.map((s) => s.surfaceId).slice(0, 10);

      // 2. Pages → roster (tabs). Mark pinned surfaces + gate.
      const ps = await loadPages();
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
      const chat = await loadChat();
      for (const e of chat) {
        const actionLabel =
          e.role === 'action' ? (/event "([^"]+)"/.exec(e.text ?? '')?.[1] ?? 'action') : undefined;
        chatStore.push({
          role: e.role as ChatRole,
          text: e.text,
          surfaceId: e.surfaceId,
          id: e.id,
          actionLabel,
        });
      }

      // 4. App state (active tab + chat dock position).
      const st = await loadState();
      if (st) {
        setShellState((s) => ({
          ...s,
          ...(typeof st.activeTabId === 'string' ? { activeTabId: st.activeTabId } : {}),
          ...(st.chatDockState === 'page' || st.chatDockState === 'dock' || st.chatDockState === 'rail'
            ? { chatDockState: st.chatDockState }
            : {}),
        }));
      }
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
      }));
      saveChat(entries).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [chatStore, persistTick, hydrated]);

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
        return { surfaceId, components: components as unknown[], dataModel, updatedAt: Date.now() };
      });
      saveSurfaces(recs).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [persistTick, liveProcessor, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveState({ activeTabId: shellState.activeTabId, chatDockState: shellState.chatDockState }).catch(() => {});
  }, [shellState, hydrated]);

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
        surfacesPayload[sid] = { components, dataModel, visibleOnActivePage: region != null, region };
      }

      const pagesCtx: Record<string, { layout: LayoutDescriptor; mapping: Record<string, string> }> = {};
      for (const p of pagesRef.current) pagesCtx[p.id] = { layout: p.layout, mapping: p.mapping };

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
      const last = allMessages[allMessages.length - 1];
      const priorMessages =
        last && last.role === 'user' && last.content === text ? allMessages.slice(0, -1) : allMessages;

      const askingEntry = chatStore.push({ role: 'system', text: 'Asking agent...' });
      let cleared = false;
      const clearAsking = () => {
        if (cleared) return;
        cleared = true;
        chatStore.remove(askingEntry.id);
      };
      try {
        await streamAgent(text, priorMessages, agentContext, {
          onToolCallStart: ({ toolCallName, toolCallId }) => {
            clearAsking();
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
              const messages = emission.messages as unknown[];
              const hasCreate = messages.some((m) => !!m && typeof m === 'object' && 'createSurface' in (m as object));
              const isExisting =
                !!targetId &&
                (surfaceContentsRef.current[targetId] !== undefined || liveProcessor.model.getSurface(targetId) != null);
              // Gate only MODIFICATIONS to an existing surface, and only when NOT
              // triggered by a user action (those apply directly). Brand-new
              // surfaces (createSurface) render straight into the chat scroll.
              const isModification = isExisting && !hasCreate;
              if (diffsGated && isModification && !fromUserAction) router.gateSurface(targetId);
              captureSurfaceContents(messages);
              router.route(messages as never);
              chatStore.push({ role: 'agent', surfaceId: targetId });
            } else if (emission.kind === 'pageOp') {
              const op = emission.op as { name?: string; pageId?: string; title?: string; icon?: string; color?: string; layout?: LayoutDescriptor };
              if (!op || typeof op.name !== 'string') {
                // Malformed op (e.g. empty {}) — never route it (would switch to a
                // non-existent tab); tell the user instead of failing silently.
                chatStore.push({ role: 'system', text: 'Agent emitted an invalid page operation — ignored.' });
              } else if (op.name === 'createPage') {
                createPageLocal({ id: op.pageId, title: op.title, layout: op.layout, icon: op.icon, color: op.color });
              } else if (op.name === 'deletePage' && op.pageId) {
                deletePageLocal(op.pageId);
              } else if (op.name === 'setPageProps' && op.pageId) {
                const patch: Record<string, unknown> = {};
                if (op.title !== undefined) patch.title = op.title;
                if (op.icon !== undefined) patch.icon = op.icon;
                if (op.color !== undefined) patch.color = op.color;
                if (Object.keys(patch).length) updatePageLocal(op.pageId, patch);
              } else {
                harness.apply(op as never);
              }
            }
          },
          onRunError: ({ message }) => {
            clearAsking();
            chatStore.push({ role: 'system', text: `Agent error: ${message}` });
          },
        });
        clearAsking();
      } catch (err) {
        clearAsking();
        chatStore.push({ role: 'system', text: `Agent error: ${(err as Error).message}` });
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
    ],
  );

  useEffect(() => {
    handlePromptRef.current = handlePrompt;
  }, [handlePrompt]);

  const renderChatSurface = useCallback(
    (surfaceId: string) => {
      // If this surface has been placed on a page, replace the (redundant) chat
      // copy with a compact "moved to <page>" placeholder that locates it.
      const hostPage = pages.find((p) => Object.prototype.hasOwnProperty.call(p.mapping, surfaceId));
      if (hostPage) {
        return (
          <button
            type="button"
            onClick={() => locateSurface(surfaceId, hostPage.id)}
            title={`Show on ${hostPage.title}`}
            style={{
              marginTop: 8,
              width: '100%',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(124,131,255,0.10)',
              border: '1px dashed var(--glass-border-2, rgba(124,131,255,0.35))',
              borderRadius: 12,
              padding: '10px 12px',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              fontSize: 12.5,
            }}
          >
            <span aria-hidden style={{ fontSize: 14 }}>📌</span>
            <span>
              Moved to <strong style={{ color: 'var(--text)' }}>{hostPage.icon || '📄'} {hostPage.title}</strong>
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ color: 'var(--accent-2, #22d3ee)' }}>Show ↗</span>
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
            {liveSurface ? <A2uiSurface surface={liveSurface} /> : null}
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
      <Shell
        tabs={tabs}
        state={shellState}
        onStateChange={setShellState}
        harness={harness}
        renderDiagnostics={renderDiagnostics}
        chatTab={{
          tab: { id: 'chat', label: 'Chat', icon: <span>💬</span> },
          renderSurface: renderChatSurface,
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
        hooks={{ onPrompt: handlePrompt }}
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
    </MarkdownContext.Provider>
  );
}
