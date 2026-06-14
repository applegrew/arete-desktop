/**
 * Run an agent-authored widget handler in the webview's OWN JS engine — no second
 * engine, no WASM. There is ONE runtime. Handlers get a curated host API: `ctx`,
 * `surface` (incl. `surface.history` — the generic state timeline), `render(target,
 * components)`, and async `tools.<name>(args)`. "Back" is not a primitive — a handler
 * restores a prior view by rendering an entry from `surface.history`.
 *
 * Sandbox: the handler runs via `new Function` with dangerous globals shadowed to
 * `undefined`. This is a SOFT sandbox (not a hard security boundary) and a runaway
 * loop can freeze the UI — acceptable because handlers are our own LLM-authored,
 * persisted, small, deterministic scripts. (Hardening to a sandboxed iframe/Worker
 * is tracked in the README todos.)
 */
export interface ClientHooks {
  /** Replace a surface's components. target "self" = the acting surface. */
  render: (target: string, components: unknown) => void;
  /** Proxy object: `tools.<name>(args)` → Promise of the tool's parsed result. */
  tools: Record<string, (args?: unknown) => Promise<unknown>>;
}

// Globals shadowed (bound to `undefined`) inside the handler scope so a script
// can't trivially reach the DOM, network, or storage. NOTE: `eval` and `arguments`
// are intentionally NOT here — they are illegal as parameter names under the
// `"use strict"` body and would throw a SyntaxError. (Soft sandbox: shadowing the
// network/DOM/storage globals covers the meaningful cases; it is not a hard boundary.)
const SHADOWED_GLOBALS = [
  'window', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket',
  'localStorage', 'sessionStorage', 'indexedDB', 'Function',
  'globalThis', 'self', 'importScripts', 'location', 'parent', 'top',
] as const;

/** Compile-check a handler (parse only, no execution). Throws on a syntax error. */
export function validateHandler(code: string): void {
  // Constructing the function parses the body; it is never invoked here.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function(...SHADOWED_GLOBALS, 'ctx', 'surface', 'render', 'tools', `"use strict";\n${code}`);
}

export async function runClientHandler(
  code: string,
  ctxObj: unknown,
  surfaceObj: unknown,
  hooks: ClientHooks,
): Promise<void> {
  const render = (target?: unknown, components?: unknown) => {
    hooks.render(target == null ? 'self' : String(target), components == null ? [] : components);
  };
  // Wrap the body in an async IIFE so handlers may `await tools.x()`; pure-UI
  // handlers simply don't await. The outer fn returns that promise to us.
  const body = `"use strict";\nreturn (async () => {\n${code}\n})();`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function(...SHADOWED_GLOBALS, 'ctx', 'surface', 'render', 'tools', body) as (
    ...args: unknown[]
  ) => Promise<void>;
  const surface = (surfaceObj && typeof surfaceObj === 'object' ? surfaceObj : {}) as Record<string, unknown>;
  if (!Array.isArray(surface.history)) surface.history = [];
  // SHADOWED_GLOBALS are passed positionally as `undefined`, then the real args.
  const shadow = SHADOWED_GLOBALS.map(() => undefined);
  await fn(...shadow, ctxObj ?? {}, surface, render, hooks.tools);
}
