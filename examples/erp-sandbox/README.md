# erp-sandbox

A walking-skeleton demo of `@arete-ui/core` driving Google's A2UI v0.9.

This is **not** part of the published library — it exists to demonstrate the full plug-in surface end-to-end with a mock agent.

## Run it

From the repo root:

```bash
nvm use 24      # or any Node >= 20
pnpm install
pnpm build      # builds @arete-ui/core
pnpm dev        # starts vite on http://localhost:5173
```

## What's in the demo

- **Shell** with three tabs in the left rail: Chat (💬), Tickets (🎫), Reports (📊).
- **Dockable Chat** — full-page on the chat tab, docked to the right on Tickets/Reports, collapsible to a vertical rail strip via the ▶ button.
- **Two `<Page>` workspaces** — Tickets is a 2×2 grid; Reports is a 1×2 split.
- **A real A2UI `MessageProcessor`** with the `basicCatalog` from `@a2ui/react/v0_9`. Agent surfaces render via `<A2uiSurface>`.
- **DiffRouter** — content-diff gating with a shadow `MessageProcessor`. Toggle "Gate content diffs" in the top bar; while gated, every new surface lands in a shadow first and a green/yellow/red diff bar appears.
- **PageOpsHarness** — `pinSurface` and `setPageLayout` ops, both diff-gated at the page level with a ghost preview + page-level approve/reject bar.

## Demo script (covers verification items 1, 3–8 from `CLAUDE.md` + the routing rule)

1. **Shell** — click each of the three rail icons. The main area swaps. (item 1)
2. **Chat** — on the Chat tab the chat fills the main area. Switch to Tickets — the same Chat instance is now docked on the right. Click ▶ to collapse to a rail; click ◀ to re-expand. Type a message on Chat tab, switch to Tickets, return — history is preserved. (items 2–3)
3. **Page topology** — switch to Tickets. Four empty regions render in a 2×2 grid even with no surfaces. (item 4)
4. **Routing rule + chat-first surfaces**:
   - Make sure "Gate content diffs" is checked in the top bar.
   - Click **Add an outstanding-invoices panel**. The surface lands in the **chat scroll** (not on Tickets), wrapped in a green-bordered DiffOverlay with `+N ~0 −0 · proposed` and Approve/Reject. Tickets stays empty. The agent never silently mutates a page.
   - Click **Approve** in the chat entry → border disappears, the rendered card stays in chat scroll.
   - Click **Show KPI summary**, then **Reject** in chat → the pending shadow is dropped. (items 5, content diff loop)
5. **Per-surface isolation** — fire **invoices** and **KPI** back to back. Two chat entries with two independent Approve/Reject bars. Approve one; the other is still pending. (item 6)
6. **Lifecycle hooks** — open dev console. Each agent message triggers `[arete-ui] onBeforeApply` and each page op triggers `[arete-ui] onPageOp`. The chat scroll shows `proposed: …`, `✓ approved …`, `✕ rejected …` lines from `onProposed`/`onApprove`/`onReject`. (item 7)
7. **`pinSurface` page op (promotes from chat scroll → page)**:
   - With at least one chat surface, click **Pin first chat surface → Tickets**.
   - The Tickets page dims its current layout and shows a dashed-yellow ghost grid labelled with the proposed new mapping plus a page-level Approve/Reject bar.
   - Approve → the surface promotes from chat into a Tickets region AND the chat entry is removed. Reject → both chat and Tickets unchanged.
8. **`setPageLayout` page op** — switch to Reports. Click **Make Reports a 3x3 grid**. A 3×3 ghost grid overlays the current 1×2. Approve → the layout commits. (item 8)
9. **Schemas published** — in the dev console: `harness.schemas` prints JSON schemas for all 5 page ops (the 3 unimplemented ones still have schemas).

## Known walking-skeleton simplifications

- **Per-component DOM outlines** are not drawn. A2UI's React renderer does not currently emit `data-a2ui-component-id` attributes, so DiffOverlay summarises the diff in a header bar instead of outlining individual changed components. Upgrading this requires wrapping every basic-catalog component with `createComponentImplementation` to inject an ID-bearing wrapper.
- **Re-gating after pin** — once a chat surface is approved and pinned to a page, subsequent `updateComponents` against that same surface land directly in live (not in shadow). The "swap KPI card with sparkline" fixture from the README is not wired yet — it requires the App to re-gate the surface before sending follow-up messages.
- **No SQLite persistence** — Shell state, chat history, and approval log are all in-memory only. The README's `better-sqlite3` demo is a v1 enhancement.
- **`unpinSurface`, `moveSurface`, `setPageRegion`** are stubs that throw "not implemented". Their schemas are published.
- **`onUserAction` and `resolveDataPath`** are not exercised by the demo (no A2UI actions are wired in the fixtures), but defaults are in place and the hook plumbing is verified by the typecheck.
