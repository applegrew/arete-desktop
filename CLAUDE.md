# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

This repository is in the **design/bootstrapping phase** — only a README exists. When implementing, scaffold according to the architecture below.

## What This Is

`arete-ui` is a React framework that adds four things on top of Google's A2UI v0.9 protocol, which A2UI itself does not provide:

1. A multi-tab application **Shell** with a dockable Chat panel
2. A persistent multi-surface **Page** workspace (A2UI samples are single-pane only)
3. A **Visual Diff Engine** — agent mutations go to a shadow model first, user approves/rejects before live state changes
4. A **Page Operations Harness** — typed structural commands (`pinSurface`, `setPageLayout`, etc.) that go through the diff pipeline

Core has **zero** fw-dew / Freshworks dependency. It is plug-in shaped: the consumer brings the catalog, the agent transport, the top-bar, and the persistence layer.

## Planned Package Structure

```
packages/
  core/                    # @arete-ui/core — Shell, Page, Chat, DiffOverlay, harness
  adapter-dew/             # @arete-ui/adapter-dew — maps @freshworks/dew-components to A2UI catalog
examples/
  erp-sandbox/             # Reference SPA (not part of core) — mock agent + SQLite persistence demo
```

## Key Dependencies (do not re-implement these)

- `@a2ui/react/v0_9` — `A2uiSurface`, `basicCatalog`, `createComponentImplementation`
- `@a2ui/web_core/v0_9` — `MessageProcessor`, `SurfaceModel`, `SurfaceGroupModel`, `DataModel`, `ComponentsModel`
- A2UI agent SDKs ship `A2uiStreamParser`, `A2uiSchemaManager`, `A2uiValidator`, `PayloadFixer`, `SendA2uiToClientToolset` — consume as-is

## Core Architecture

### Visual Diff Engine (`<DiffOverlay>`)

When an agent message (`updateComponents` / `createSurface` / `deleteSurface`) arrives for a wrapped surface, it is written to a **shadow `SurfaceModel`**, never the live one. The overlay renders green (added) / red (removed, live dimmed underneath) / yellow (moved or attribute-changed) highlights on top of the live surface. Approve flushes shadow → live via `MessageProcessor`; Reject drops the shadow. Each surface has its own independent shadow — concurrent diffs resolve independently.

### Page Operations Harness

Operations are first-class arete-ui actions — NOT A2UI messages. They have their own JSON schemas. The harness ships only schemas and implementations; consumers wire them into their agent toolset (analogous to `SendA2uiToClientToolset`). **All harness ops go through the Diff Engine by default** (consumers can mark per-op `autoApprove`). All ops emit through the same `onProposed`/`onApprove`/`onReject` stream as content diffs.

v1 operations: `pinSurface`, `unpinSurface`, `setPageLayout`, `moveSurface`, `setPageRegion`.

### Routing Rule

Agent replies always land as new surfaces in the **chat scroll** by default. A surface only promotes to a page region via an explicit `pinSurface` harness op — the agent cannot silently mutate a live page.

### Shell State

`Shell` accepts `state` + `onStateChange` props; it ships no persistence. Consumers wire to localStorage / backend / nothing.

### Lifecycle Hooks (all at Shell level, threaded everywhere)

| Hook | Purpose |
|---|---|
| `onBeforeApply(messages, ctx)` | RBAC gate — return modified messages or null to reject before shadow paints |
| `resolveDataPath(path, ctx)` | Wrap A2UI JSON Pointer resolution (tenant prefix, auth, redaction) |
| `onUserAction(action)` | Audit every A2UI action dispatch |
| `onPrompt(text)` | Consumer routes chat input to its own agent/transport — core does not own transport |
| `onPageOp(op, ctx)` | Fires for every harness op; consumers can deny, transform, or log |

## Design Constraints

- **Core has no fw-dew dependency.** Freshworks components belong in `adapter-dew` only.
- **Core ships no persistence.** Layout JSON, conversation history, approval log, undo stack — all consumer-owned via hook APIs.
- **Core ships no agent transport.** Consumers call `ingest(stream)` with their own SSE/WebSocket/A2A stream.
- **`<Page>` is optional.** Any React component can live in a Shell tab; `<Page>` is the convenience wrapper for agent-driven multi-surface workspaces.
- **Target A2UI v0.9 only.** v0.10 is in draft; do not implement until it closes.
- **React only in v1.** Angular/Lit/Flutter adapters are out of scope.

## A2UI Reference Files (inside the A2UI SDK, not this repo)

When implementing against A2UI, the canonical reference files are:
- Renderer: `renderers/react/src/v0_9/`
- Message processor: `renderers/web_core/src/v0_9/processing/message-processor.ts`
- State models: `renderers/web_core/src/v0_9/state/`
- Conformance suites: `agent_sdks/conformance/suites/`
- Spec: `specification/v0_9/docs/a2ui_protocol.md`
- Agent SDK guide: `agent_sdks/agent_sdk_guide.md`

## Verification Checklist (implementation milestones)

When implementing, verify these in order:

1. Shell chrome: ≥3 tab icons in left rail; click switches active tab; top-bar slot accepts arbitrary consumer React
2. Chat full-page: vertical surface list + sticky input renders in main area
3. Chat dock: switching tabs moves same Chat instance to right edge; minimize collapses to rail strip; history preserved
4. Page topology: named docked regions accept surfaces by surfaceId→region mapping; empty regions still render
5. Shadow-diff loop: `updateComponents` → overlay → Approve mutates live → Reject does not; same for `createSurface` / `deleteSurface`
6. Per-surface diff isolation: two concurrent shadows resolve independently
7. Lifecycle hooks: `onBeforeApply` rejection blocks shadow; `resolveDataPath` prefix injection works end-to-end; `onApprove` fires with committed diff
8. `pinSurface`: preview in target region → approve promotes from chat to page; reject leaves untouched
9. `setPageLayout` with 3×3 grid descriptor: preview → approve commits; reject leaves untouched
10. Harness JSON schemas published; wrapping into an ADK toolset is mechanical from schema alone
