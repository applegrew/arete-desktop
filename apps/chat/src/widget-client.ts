import { newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSWASMModule } from 'quickjs-emscripten';
import variant from '@jitl/quickjs-singlefile-browser-release-sync';

// Single-file variant: the WASM is inlined as base64 in the JS bundle, so there
// is NO separate .wasm fetch. The default `getQuickJS()` fetches a .wasm URL,
// which under vite / the Tauri webview resolves to index.html — yielding
// "WebAssembly.Module doesn't parse at byte 0". The inlined variant avoids that.
let modPromise: Promise<QuickJSWASMModule> | null = null;
function getModule(): Promise<QuickJSWASMModule> {
  return (modPromise ??= newQuickJSWASMModuleFromVariant(variant));
}

/**
 * Run a `runtime:"client"` widget handler in a QuickJS (WASM) sandbox — instant,
 * offline, no LLM. Client handlers are SYNCHRONOUS and pure-UI: they get `ctx`,
 * `surface` (which includes `surface.history` — the generic per-surface state
 * timeline), and `render(target, components, opts)`. They CANNOT call tools (those
 * need the server). No DOM/network/timers are exposed. "Back" is not a primitive —
 * a handler restores a prior view by rendering an entry from `surface.history`.
 */
export interface ClientHooks {
  render: (target: string, components: unknown, opts: Record<string, unknown>) => void;
}

export async function runClientHandler(
  code: string,
  ctxObj: unknown,
  surfaceObj: unknown,
  hooks: ClientHooks,
): Promise<void> {
  const QuickJS = await getModule();
  const vm = QuickJS.newContext();
  try {
    setStr(vm, '__ctx_json', JSON.stringify(ctxObj ?? {}));
    setStr(vm, '__surface_json', JSON.stringify(surfaceObj ?? {}));

    const renderFn = vm.newFunction('__render', (t, c, o) => {
      const target = vm.getString(t);
      const components = safeParse(vm.getString(c), []);
      const opts = safeParse(vm.getString(o), {}) as Record<string, unknown>;
      hooks.render(target, components, opts);
    });
    vm.setProp(vm.global, '__render', renderFn);
    renderFn.dispose();

    const prelude = `
      globalThis.ctx = JSON.parse(__ctx_json);
      globalThis.surface = JSON.parse(__surface_json);
      if (!globalThis.surface.history) globalThis.surface.history = [];
      globalThis.render = function (target, components, opts) {
        __render(
          String(target == null ? 'self' : target),
          JSON.stringify(components == null ? [] : components),
          JSON.stringify(opts == null ? {} : opts),
        );
      };
    `;
    evalOrThrow(vm, prelude);
    // Synchronous body — client handlers don't await (no async host fns).
    evalOrThrow(vm, `(() => {\n${code}\n})()`);
  } finally {
    vm.dispose();
  }
}

function setStr(vm: QuickJSContext, name: string, val: string): void {
  const s = vm.newString(val);
  vm.setProp(vm.global, name, s);
  s.dispose();
}

function safeParse(s: string, fallback: unknown): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function evalOrThrow(vm: QuickJSContext, code: string): void {
  const r = vm.evalCode(code);
  if (r.error) {
    const dumped = vm.dump(r.error);
    r.error.dispose();
    throw new Error(typeof dumped === 'string' ? dumped : JSON.stringify(dumped));
  }
  r.value.dispose();
}
