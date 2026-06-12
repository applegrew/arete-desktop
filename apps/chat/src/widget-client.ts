import { getQuickJS, type QuickJSContext } from 'quickjs-emscripten';

/**
 * Run a `runtime:"client"` widget handler in a QuickJS (WASM) sandbox — instant,
 * offline, no LLM. Client handlers are SYNCHRONOUS and pure-UI: they get `ctx`,
 * `surface`, `render(target, components, opts)`, and `history.back()`. They CANNOT
 * call tools (those need the server). No DOM/network/timers are exposed.
 */
export interface ClientHooks {
  render: (target: string, components: unknown, opts: Record<string, unknown>) => void;
  back: () => void;
}

export async function runClientHandler(
  code: string,
  ctxObj: unknown,
  surfaceObj: unknown,
  hooks: ClientHooks,
): Promise<void> {
  const QuickJS = await getQuickJS();
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

    const backFn = vm.newFunction('__back', () => {
      hooks.back();
    });
    vm.setProp(vm.global, '__back', backFn);
    backFn.dispose();

    const prelude = `
      globalThis.ctx = JSON.parse(__ctx_json);
      globalThis.surface = JSON.parse(__surface_json);
      globalThis.render = function (target, components, opts) {
        __render(
          String(target == null ? 'self' : target),
          JSON.stringify(components == null ? [] : components),
          JSON.stringify(opts == null ? {} : opts),
        );
      };
      globalThis.history = { back: function () { __back(); } };
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
