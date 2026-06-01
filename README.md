# arete-ui

> **A minimal, agent-driven Generative UI shell for enterprise apps — built on Google's A2UI v0.9 protocol.**

---

## Executive Summary

**arete-ui** is a React framework that lets end-users reshape their enterprise application UI through natural-language conversation with an agent, with every change gated by a visual diff before it commits. It is deliberately small: arete-ui ships an app **Shell**, a multi-surface **Page** workspace, a **Chat** panel, a **Visual Diff Engine**, and a **Page Operations Harness** that gives the agent typed, structural control of the workspace. Everything else — components, theming, the agent, auth, data, persistence — is plugged in from outside. The first reference plug-in uses PrimeReact, but arete-ui core has no dependency on it.

arete-ui builds on Google's **A2UI** (Agent-to-User Interface) v0.9 protocol and reuses A2UI's renderer and agent SDKs unchanged. Its net-new contribution is the shell pattern, the diff engine, and the structural-operation harness — none of which A2UI provides on its own.

---

## The Problem

Enterprise apps (ERP, CRM, ITSM) are dense, rigid, and built for the median of many personas at once. The result is familiar:

- **One-size-fits-none layouts.** A page tuned for everyone is optimal for no one. Cognitive load rises, throughput drops.
- **High mutation cost.** Changing a layout, adding a panel, surfacing a new data stream all require frontend work, design review, and regression risk.
- **Administrative chokepoints.** Layout flexibility is gated behind admin roles. Power users get a handful of templates, never a workspace tuned to their actual day.

The result is a frozen UI that can't keep up with how individuals actually work.

---

## The Solution

arete-ui shifts UI customization from an engineering ticket to a conversational act. A user says what they want — *"give me a panel of overdue approvals grouped by urgency"*, *"pin this widget to the Tickets page"*, *"make Reports a 3×3 grid"* — and an agent emits the change. Before anything mutates, the user sees a **visual diff**: green outlines on added components, red on removed, yellow on moved. One click commits; one click rejects.

```
[User intent] → [Agent] → [Shadow Surface + Diff Overlay] → [User approves] → [Live UI]
```

Three properties make this safe enough for enterprise use:

1. **Diff-gated by default.** The agent never silently mutates the user's workspace. Every structural and content change passes through the same approve/reject pipeline.
2. **Per-surface granularity.** Multiple pending diffs across multiple surfaces resolve independently — no all-or-nothing commits.
3. **Deterministic guardrails.** Lifecycle hooks let host apps reject, rewrite, or audit any agent-proposed change before it can paint, including RBAC and data-resolution policy.

---

## Architectural Scope

arete-ui is intentionally narrow. It owns the **shell, the workspace, the chat, the diff, and the structural-op harness** — and nothing else.

| In scope (core) | Out of scope (plugged from outside) |
|---|---|
| App shell with left tab rail, top-bar slot, dockable chat | Authentication, RBAC enforcement, business-data persistence |
| Multi-surface page workspace with configurable regions | The catalog of UI components (consumer plugs in any A2UI v0.9 catalog) |
| Visual Diff Engine (shadow surface + overlay highlights + approve/reject) | The agent runtime and LLM transport (consumer supplies the message stream) |
| Page Operations Harness (typed structural ops the agent can invoke) | Long-term persistence of layout / conversation / approval history |
| Lifecycle hooks (onBeforeApply, resolveDataPath, onUserAction, onPrompt, onPageOp) | Domain-specific components (ERP, CRM, ITSM widgets live in adapters, not core) |

For every out-of-scope concern, arete-ui exposes a clean hook or pluggable interface; it never bundles policy.

---

## Technical Foundation

### Protocol target: A2UI v0.9

v0.9 is the current published, feature-complete A2UI specification with renderer support across React, Angular, Lit, and Flutter. v0.8 is closed legacy; v0.10 is in draft and v1.0 is roadmapped for Q4 2026. arete-ui v1 targets v0.9 and tracks v0.10 evolution without implementing it until v0.10 closes.

### Dependencies and reuse (we do not rebuild A2UI)

arete-ui consumes A2UI's existing primitives as-is:

- **Renderer**: `@a2ui/react/v0_9` (`A2uiSurface`, `basicCatalog`, `createComponentImplementation`) and `@a2ui/web_core/v0_9` (`MessageProcessor`, `SurfaceModel`, `SurfaceGroupModel`, `DataModel`, `ComponentsModel`).
- **Agent SDK**: A2UI's Python and Kotlin agent SDKs already ship streaming parsing (`A2uiStreamParser`), inference strategies and prompt generation (`A2uiSchemaManager`, `A2uiTemplateManager`, `InferenceStrategy`), schema validation (`A2uiValidator`), payload repair (`PayloadFixer`), and a standard agent toolset (`SendA2uiToClientToolset`). Host apps reuse these directly.
- **Theming pattern**: A2UI's CSS-variable theming via `:where(:root)` is reused. arete-ui adds no new theming abstraction.

### What arete-ui adds on top of A2UI

A2UI is a **content protocol**: surfaces, components, data, actions. It says nothing about:

- A multi-tab application shell with a dockable chat panel.
- A persistent multi-surface workspace (every A2UI sample today is a single-pane chat).
- Diffing or staging — `updateComponents` is applied immediately by the message processor.
- Structural operations on a workspace (pin a widget to a page, reshape a page's region layout).

These four gaps are exactly the surface arete-ui fills.

### Differentiation from existing A2UI tools

| Existing A2UI artifact | What it is | Why arete-ui is distinct |
|---|---|---|
| `tools/composer/` | CopilotKit-driven **designer** widget-authoring tool | arete-ui runs **inside a live app for end-users**, gates mutations through a diff, and defines an app shell |
| `tools/editor/` | One-shot single-prompt UI generator | arete-ui mutates a **persistent multi-surface, multi-page workspace incrementally** |
| `samples/client/react/shell/` | Single-pane chat → renders A2UI reply | arete-ui is **shell-shaped** (rail, tabs, dockable chat), not single-pane chat |

---

## Scope: What arete-ui Ships

arete-ui core is one React package: **four components** plus a **page-operations harness** plus a **lifecycle-hook API**.

### 1. `<Shell>` — application frame

The top-level container. Mounted once.

- **Left edge rail**: vertical column of tab icons. Consumer registers tabs as `{ id, icon, label, render }`. Click switches the active tab. Icon-only, tooltip on hover, ~48–56px wide.
- **Top-bar slot**: fully consumer-controlled (`topBar={<MyTopBar />}`). arete-ui ships no defaults for title, search, user menu — those belong to the host app.
- **Main content area**: renders the active tab's `render` output.
- **Right-edge chat dock**: optional. When `chatTab` is configured, the chat is full-page on its own tab AND simultaneously docked to the right edge on every other tab. The dock collapses to a vertical-strip rail with a chevron expand/collapse affordance. Dock state persists across tab switches.
- **State surface**: `state` + `onStateChange` lets consumers persist Shell state however they want (localStorage, backend, nothing). Core ships no persistence.

### 2. `<Page>` — multi-surface agent-driven workspace

A convenience component for tabs whose content is a multi-surface, agent-mutated workspace. **Optional** — any React component can live in a tab. `<Page>` is what consumers use when they want the agent → diff → approve loop on a multi-region layout.

- Wraps `SurfaceGroupModel` from `@a2ui/web_core/v0_9`.
- Consumer configures named docked regions; surfaces are routed to regions by surfaceId→region mapping.
- Each region renders an `A2uiSurface` from `@a2ui/react/v0_9`.
- Layout topology is serializable JSON (consumer persists it).
- Every surface inside `<Page>` is automatically wrapped in `<DiffOverlay>`.

### 3. `<Chat>` — chat panel (full-page or docked)

A single component instance powers both render modes: full-page on the chat tab, docked on other tabs.

- **Render modes**: `"page"` (full main area), `"dock"` (right edge, ~360–420px), `"rail"` (collapsed vertical strip).
- **Surface list**: each agent-emitted surface is appended chronologically. Each entry uses `<A2uiSurface>` with an optional user-prompt header. The list itself is plain React — not a new A2UI catalog widget; BasicCatalog already ships an in-surface `List`.
- **Chat input**: text + send button, plain React (not an A2UI catalog widget). On submit, calls a consumer-supplied `onPrompt(text)` callback. arete-ui does not own the agent transport.
- **Shared state**: conversation history is preserved across tab switches and dock/page/rail transitions.

### 4. `<DiffOverlay>` + Shadow Surface — Visual Diff Engine

The flagship feature. Used automatically by `<Page>`; exported as a primitive for consumers wrapping their own surfaces.

- **Shadow routing**: when an agent message (`updateComponents` / `createSurface` / `deleteSurface`) arrives for a surface wrapped by `<DiffOverlay>`, it is written to a **shadow `SurfaceModel`** instead of the live one.
- **Overlay highlights**:
  - green = added component
  - red = removed component (live still visible underneath, dimmed)
  - yellow = moved or attribute-changed component
- **Approve / Reject bar**: floating, anchor-configurable. Approve flushes shadow → live via the underlying `MessageProcessor`. Reject drops the shadow.
- **Tree-level diff**: computed using component IDs from A2UI's flat `updateComponents` list.
- **Per-surface granularity**: each surface gets its own pending shadow + approve/reject. Concurrent pending diffs resolve independently.
- **Diff hooks**: `onProposed(diff)`, `onApprove(diff)`, `onReject(diff)` — consumers wire to audit, undo, persistence.

### 5. Page Operations Harness — structural commands

A2UI's protocol mutates **surface contents** only. arete-ui adds typed structural commands the agent can invoke against the workspace itself.

Shipped operations (v1):

| Operation | Purpose |
|---|---|
| `pinSurface(surfaceId, pageId, region?)` | Promote a surface from the chat scroll into a page region |
| `unpinSurface(surfaceId)` | Return a pinned surface to the chat scroll |
| `setPageLayout(pageId, layoutDescriptor)` | Change a page's region layout (e.g. 3×3 grid, 2-column split, custom dock) |
| `moveSurface(surfaceId, targetRegion)` | Move a pinned surface between regions on the same page |
| `setPageRegion(pageId, regionId, surfaceId \| null)` | Explicit slot assignment |

Design rules:

- These operations are **first-class arete-ui actions**, not A2UI messages. arete-ui defines their JSON schemas and ships their implementations.
- Consumers expose them to their agent however they want — typically as an ADK / OpenAI / vendor toolset, analogous to A2UI's `SendA2uiToClientToolset`. arete-ui ships only the schemas and implementations, not the agent-side toolset wrappers.
- **All structural ops flow through the Diff Engine by default** — "change layout to 3×3" previews the new layout before committing. Consumers can mark specific ops as `autoApprove` per-op or per-tab.
- All ops emit through the same `onProposed` / `onApprove` / `onReject` stream as content diffs, so audit and undo are unified across content and structure.

### Lifecycle hooks

Exposed at the Shell level, threaded through every component and the harness:

| Hook | Purpose |
|---|---|
| `onBeforeApply(messages, ctx)` | Sanitize, validate, RBAC-gate agent output before it touches any shadow. Return modified messages or null to reject. |
| `resolveDataPath(path, ctx)` | Wrap JSON Pointer resolution with enterprise auth, tenant prefixing, redaction. |
| `onUserAction(action)` | Audit hook on every A2UI action dispatch. |
| `onPrompt(text)` | Consumer routes the user's chat-input prompt to its own agent/transport. |
| `onPageOp(op, ctx)` | Fires for every page-harness operation; consumers can deny, transform, or log. |

### Pluggable surface (everything else lives outside)

- **Catalog**: any A2UI v0.9 `Catalog` instance. Reference plug-in (separate package, not in core): `@arete-ui/adapter-primereact` — maps PrimeReact components to A2UI implementations via `createComponentImplementation`. arete-ui core has zero PrimeReact dependency.
- **Agent / transport**: consumer brings the A2UI message stream (SSE / WebSocket / A2A / mock). arete-ui exposes `ingest(stream)`.
- **Page roster**: consumer declares which tabs exist, their icons/labels, and what renders in each.
- **Top-bar content**: consumer-owned React.
- **Persistence**: none in core. Layout JSON, conversation history, approval log, undo stack — all consumer-owned via the hook APIs.

---

## Routing Model

How agent output finds its destination:

- **Default for agent replies with UI**: every reply lands as a new surface in the **chat scroll**. The agent cannot silently mutate an active page just because the user is looking at it.
- **Moving widgets onto a page is an explicit act**: the user says *"pin this widget to this page"* (or *"the second one"*, *"this card"*) and the agent invokes `pinSurface(...)` from the harness. The pin op flows through the Diff Engine — user approves, surface promotes from chat scroll into the page region.
- **Layout changes are agent-issued via the harness**: *"change this page into a 3×3 grid"* → `setPageLayout(pageId, gridDescriptor)` → preview overlay → approve commits.
- **Acknowledgement bubbles**: a structural op may optionally push a short text surface into the chat scroll (*"Pinned KPI panel to top-left of Reports"*). arete-ui emits a default ack; consumers can override or suppress.

---

## Reference Webapp: `examples/erp-sandbox`

A local-first React SPA that demonstrates the full plug-in surface end-to-end. **Not** part of arete-ui core.

- **Shell composition**: 1 chat tab + 2 workspace tabs (e.g., "Tickets", "Reports") using `<Page>`.
- **Catalog plug-in**: `@arete-ui/adapter-primereact`, consuming `primereact` UI components.
- **Mock agent**: emits canned `updateComponents` and page-op messages in response to a prompt fixture set:
  - *"Group approvals by urgency"*
  - *"Add an outstanding-invoices panel"*
  - *"Swap KPI card with sparkline"*
  - *"Pin the second card to Tickets"*
  - *"Make Reports a 3×3 grid"*
- **Persistence demo**: `better-sqlite3` stores Shell state, conversation history, and approval log — wiring `onStateChange` and `onApprove` to a real backend. Used only by the demo, not by core.

The sandbox demonstrates: chat full-page on chat tab; chat docked on other tabs; chat minimized to rail; agent reply lands in chat scroll; `pinSurface` op overlays target region → approve → surface promotes; `setPageLayout` op previews 3×3 grid → approve.

---

## Critical Files to Reference

- **Renderer primitives**: `renderers/react/src/v0_9/`, `renderers/web_core/src/v0_9/processing/message-processor.ts`, `renderers/web_core/src/v0_9/state/` (`SurfaceModel`, `SurfaceGroupModel`, `DataModel`, `ComponentsModel`).
- **Streaming + multi-surface reference**: `samples/client/react/shell/`.
- **Custom-component registration pattern** (for `@arete-ui/adapter-primereact`, not core): `samples/client/lit/custom-components-example/`.
- **Theming reference**: `docs/guides/theming.md`, `renderers/react/src/v0_8/styles/` (CSS-var conventions).
- **A2UI specification**: `specification/v0_9/docs/a2ui_protocol.md`, `specification/v0_9/json/client_capabilities.json`.
- **Agent SDK reference**: `agent_sdks/agent_sdk_guide.md`, `agent_sdks/python/src/a2ui/`.

---

## Out of Scope

- Authentication, RBAC enforcement, business-data persistence, raw API routing.
- ERP-specific components — those live in catalog adapters, never in core.
- Server-side LLM hosting or agent runtime.
- Layout editor UI (drag-to-rearrange panels) — agent-mediated only in v1.
- v0.10 / v1.0 A2UI support until v0.10 closes.
- Non-React framework support in v1; Angular / Lit / Flutter adapters are future work.

---

## Delivery Plan & Verification Checklist

### Workstream A: Core library (`@arete-ui/core`)

1. `<Shell>` chrome: left rail renders ≥3 tab icons; click switches active tab; top-bar slot accepts arbitrary consumer React.
2. `<Chat>` full-page mode: renders main area as vertical surface list + sticky input.
3. `<Chat>` dock mode: switching off chat tab moves the same chat instance to right edge; minimize collapses it to a vertical rail strip; conversation history preserved across switches.
4. `<Page>` topology: configure named docked regions on a non-chat tab; agent-created surfaces slot into regions per surfaceId mapping; configured regions render even when empty.
5. Shadow-diff loop: mock agent emits `updateComponents` → overlay renders with green / red / yellow outlines → Approve mutates live → Reject leaves live unchanged. Repeat for `createSurface` and `deleteSurface`.
6. Per-surface diff isolation: two surfaces with concurrent pending shadows resolve independently.
7. Lifecycle hooks: `onBeforeApply` rejecting a message stops shadow from painting; `resolveDataPath` prefix-injection resolves correctly through agent-bound paths; `onApprove` fires with the committed diff.
8. Page Operations Harness: `pinSurface` previews target region → approve promotes from chat to page. `setPageLayout` with a 3×3 grid descriptor previews → approve commits. Reject leaves state untouched in both cases.
9. Harness JSON schemas: every page op has a published JSON schema; wrapping into an ADK toolset (parallel to `SendA2uiToClientToolset`) is mechanical.
10. Conformance: any wrapped A2UI bits (`MessageProcessor` subclass etc.) pass relevant v0.9 conformance suites (`agent_sdks/conformance/suites/`).

### Workstream B: Reference plug-ins and sandbox

11. `@arete-ui/adapter-primereact` separate package: maps `primereact` components to A2UI implementations via `createComponentImplementation`.
12. Catalog plug-in proof: the same `@arete-ui/adapter-primereact` catalog is used in both the erp-sandbox and arete-chat apps without touching arete-ui core.
13. `examples/erp-sandbox`: full Shell + Page + Chat + Diff loop with the prompt fixture set above. Mock agent + SQLite persistence demonstrate the hook wiring.
14. Agent reply routing: prompt typed in docked chat on a non-chat tab — reply lands as a new surface in the chat scroll, NOT silently on the page.

---

## Todos

### Actionable components (framework + adapter)
- **More PrimeReact adapter components** — DataTable, Dialog, Calendar, Dropdown, MultiSelect, AutoComplete, TreeTable, FileUpload, TabView, Carousel, Paginator, Sidebar, Toast, Accordion, OrderList/PickList. Each wires through `useAction` from `@arete-ui/core` with the category-specific auto-context shape documented in `packages/core/src/types/action.ts`.
- **Migrate CheckBox and TextField to `useAction`** — currently use raw callable / two-way binding; align with the canonical pattern so value changes flow through `onUserAction`.
- **Action gating / approval** — for destructive actions (delete, archive), add a per-action `confirm: boolean` policy that gates dispatch through a confirm-dialog before firing the user-action hook. Mirrors the diff-approval pattern.
- **A2UI expression evaluator wiring** — resolve `{path: "/items/n/x"}` and `{call: "...", args: {...}}` in `action.event.context` so per-item bindings work end-to-end. Today we only forward literal contexts plus component auto-context.

### Page-perception extensions
- **UI-runtime state beyond data model** — focused element id, scroll position per surface, hover targets. Not canonical in A2UI v0.9; arete-ui extension via a `clientUIState` field on the per-prompt context.
- **Streaming data-model updates** — today we poll the live processor at prompt-build time. Move to the canonical A2UI `metadata.a2uiClientDataModel` attachment on every client→server message once we switch transports from HTTP polling to SSE / WebSocket.

### Agent loop quality
- **Multi-step action chains** — action → form modal → submit → next action. Requires the agent to track an action-flow state machine across turns.
- **Server-side validation depth** — schema-validate every emission's component-specific props (Chart needs `labels.length === data.length`; Calendar needs valid date ranges; etc.). Today only `id` / `children` references are validated.

### Workspace
- **Out-of-the-box catalogs beyond PrimeReact** — fw-dew adapter (Freshworks design system), MUI adapter, Ant Design adapter. Each is a new `packages/adapter-<name>` package wired to the same `@arete-ui/core` hooks.
- **Persistence reference adapter** — the chat app and sandbox each have their own SQLite layer; extract a reusable `@arete-ui/persistence-rest` adapter so consumers don't have to roll their own.
- **Agent support for deletePage** — user-driven page deletion works; agent-invoked `deletePage` page op is deferred.
- **Persist pending (un-approved) diffs across reload** — shadow surface state is ephemeral; persist to survive browser refresh.

---

## Roadmap & Vision (2026 pivot): from ERP reference app to A2UI-native chat product

> **Direction:** evolve arete-ui's flagship from the `erp-sandbox` example into a **self-hostable,
> general-purpose chat product** — UX like Claude/Gemini chat — whose differentiator is that it is
> **A2UI-based, so agents *mutate a persistent multi-surface workspace*, not just render rich inline
> components**, with **every mutation gated by arete-ui's per-surface visual diff (approve/reject)**.
> It adds **MCP** and **Skills** support via a stronger agentic loop. **The core design in this README
> (Shell, Page, Visual Diff Engine, Page Ops harness) is kept as-is and becomes the *governance layer*.**

### Why this pivot

The diff-gated, agent-mutable workspace is more broadly valuable than ERP layout customization. Packaged
as a chat product, it competes with mainstream AI chat UIs on familiarity while offering something none
of them do: the agent can restructure a *durable* workspace, and the human approves each change visually.

### Competitive cross-check (the landscape we build on, not against)

The "agent mutates UI" space converged on **three complementary layers** — we combine them:

| Layer | Standard | Role | Our stance |
|---|---|---|---|
| UI description | **A2UI** (Google, Apache-2.0) | Agent describes UI as data; client renders from a trusted catalog | **Already using** (core + adapters) |
| Agent↔frontend loop | **AG-UI** (CopilotKit; broad framework support: LangGraph, CrewAI, Mastra, MS Agent Framework, Google ADK, PydanticAI) | Event stream: streaming text, tool calls, **state patches (RFC 6902)**, lifecycle, **`INTERRUPT` (HITL)** | **Adopt as transport** |
| Tool-served UI | **MCP Apps / MCP-UI** (official MCP extension) | MCP servers return UI in sandboxed iframes | **Consume** (render in surfaces; later phase) |

Frameworks/products surveyed: **CopilotKit** (spans all three, already pairs A2UI+AG-UI+MCP — but an SDK,
not a product, and **no visual-diff governance**); **LibreChat / Open WebUI / assistant-ui / Open Canvas /
Jan** (shipped chat products with MCP + artifacts, but **inline/artifact** generative UI — **no persistent
agent-mutable workspace with approve/reject diffs**). **Skills** = **Anthropic Agent Skills (`SKILL.md`)**
open standard (folder + `SKILL.md`; adopted across 30+ tools incl. Claude Code).

**Moat:** nobody ships our exact product — a Claude/Gemini-style chat where the agent mutates a persistent
workspace **gated by per-surface visual diffs**, A2UI-based, with MCP + Skills. AG-UI's coarse `INTERRUPT`
is an action gate, not a per-surface visual shadow-diff; the **Visual Diff Engine + Page workspace remain
the uncontested differentiator.** Loop, MCP, and Skills are solved by the ecosystem — we adopt, not rebuild.

### Decisions

1. **Transport/loop:** adopt **AG-UI**; route its UI/state events through arete-ui's existing **Diff Engine**.
2. **Agent runtime:** **Vercel AI SDK** (already a dep) + an AG-UI adapter; MCP client + multi-step tool calling.
3. **Product shape:** **self-hostable OSS product** on arete-ui core (replaces `erp-sandbox` as flagship; the
   sandbox is demoted to a test fixture/example).
4. **Skills (v1):** **Anthropic Agent Skills (`SKILL.md`)** instruction/resource bundles loaded into context.

### Target architecture — AG-UI is the seam

```
arete-ui (this repo): chat product + core (UNCHANGED moat: Shell · Page · Visual Diff Engine · Page Ops)
        ▲  AG-UI client (grow the existing `ingest()` into an AG-UI ingest adapter)
        │  AG-UI event stream (SSE/WS)
        ▼
Agent runtime (v1: in-repo `packages/agent`; FUTURE: standalone `arete-agent` service)
        Vercel AI SDK loop · MCP client(s) · SKILL.md loader · emits A2UI surfaces + pageOps + state deltas
```

**AG-UI event → arete-ui pipeline** (the core technical mapping):
- `TEXT_MESSAGE_*` → chat scroll (`ChatStore`).
- A2UI surface emissions → `DiffRouter.route(...)` into the **shadow** model; pinned surfaces gated via
  `router.gateSurface(...)` → approve/reject overlay.
- Page ops → `PageOpsHarness.apply(...)` (already diff-gated; auto-switches to the target tab).
- `STATE_SNAPSHOT` / `STATE_DELTA` (RFC 6902) → workspace state, diffable before commit.
- `TOOL_CALL_*` → tool status in chat; `INTERRUPT` → mapped to an approve/reject gate.

### Phased roadmap

| Phase | Status |
|---|---|
| Phase 0 — PoC | Done |
| Phase 1 — Chat product | In progress (partial) |
| Phase 2 — MCP + Skills | In progress (MCP done; Skills upcoming) |
| Phase 3 — Standalone agent + advanced | Upcoming |

- **Phase 0 — PoC** (done): AG-UI ingest adapter in core (`@arete-ui/agui` → `AgUiDecoder`); Vercel AI SDK backend (`@arete-ui/agent` → `runAgentTurn`, `createAgentRouter`); one MCP server (in-memory `get_ticket_stats` via `@modelcontextprotocol/sdk`); one `SKILL.md` loaded into system prompt. Full loop proven: agent mutates a surface → visual diff → approve/reject.
- **Phase 1 — Chat product** (in progress): `arete-chat` flagship app (`apps/chat`) with chat-first UX, dynamic page creation via agent, SQLite persistence (`better-sqlite3`), the full arete-ui core lifecycle, and a **settings UI** (`/api/settings` + `SettingsPanel`) — model + Ollama URL, MCP server add/remove/toggle, and gate-diffs, all persisted to SQLite and applied live (the agent router reads settings per turn via `resolveOptions`; no restart). **Deferred:** multi-conversation, auth/multi-user.
- **Phase 2 — MCP + Skills as features** (MCP done; Skills upcoming):
  - MCP server connection management — **done**: config-driven external servers, live add/remove/toggle (Phase 1 settings UI), plus per-server connection status/health (`GET /api/agui/mcp-status`: connected/failed + discovered tools + error) and manual reconnect (`POST /api/agui/mcp-reconnect`), surfaced in `SettingsPanel`. Remaining: OAuth flows for remote servers.
  - Render MCP Apps / MCP-UI resources inside arete surfaces — **done**: MCP tool results carrying `resource`/`resource_link` (inline `text/html`, `ui://`, or `text/uri-list`) are captured per turn and rendered as framework-synthesized `Embed` surfaces (sandboxed iframe, no `allow-same-origin`) in the chat scroll. Remaining: bidirectional MCP-UI `postMessage` (tool calls from inside the iframe).
  - Skills management UI — install/enable/disable SKILL.md skills (today filesystem-loaded) *(upcoming)*
- **Phase 3 — Standalone agent + advanced** (upcoming):
  - Standalone `arete-agent` service (HITL and headless) consumed over AG-UI — `packages/agent` is the seam
  - Sandboxed skill script execution (beyond instruction bundles) with an exec/security model
  - Multi-agent (A2A) coordination
  - Other RDBMS store implementations (e.g. Postgres) behind the existing `Store` interface

### Seam / agent-loop polish (ongoing)

- **Token-by-token streaming** — today the reply arrives whole as START→CONTENT→END; the decoder and wire format support streaming deltas but the agent emits full replies.
- **AG-UI `STATE_SNAPSHOT` / `STATE_DELTA`** (RFC 6902) — decoder handles these events; pending: route through diff-gated workspace state.
- **AG-UI `INTERRUPT`** — pending: map to the approve/reject gate.
- **Multi-arg MCP tools** — JSON-Schema→zod conversion; the in-memory demo tool is no-arg only.

### Phase 1 product gaps (deferred)

- **Multi-conversation** — multiple chats; `threadId` field exists in AG-UI events but `ChatStore` is single-flat-list.
- **Auth / multi-user** — single-user local today; no RBAC enforcement.
- **Agent `deletePage`** — user-driven delete works; agent-invoked delete page op deferred.
- **Persist pending (un-approved) diffs across reload** — shadow surface state is ephemeral.
- **Auto-title pages/conversations** from the first prompt.

### Reuse (do not rebuild)

Moat unchanged (`shell/`, `page/`, `harness/`, `diff/`). Agent-loop scaffold already built — `agent/transcript.ts`,
`agent/contract.ts`, `agent/context.ts`, `diagnostics/*`, and the server's no-op/diagnostic/correction loop —
**migrates onto** the AG-UI backend rather than being discarded. `ingest()` remains the low-level A2UI message
entry point; `@arete-ui/agui` (`AgUiDecoder`) is the AG-UI client entry point for streaming agent runs.
