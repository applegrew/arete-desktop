use rquickjs::prelude::{Async, Func};
use rquickjs::{async_with, AsyncContext, AsyncRuntime, Function, Promise};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::mcp;
use crate::server::state::AppState;

const MEM_LIMIT: usize = 64 * 1024 * 1024; // 64 MB
const STACK_LIMIT: usize = 512 * 1024; // 512 KB
const TIME_LIMIT: Duration = Duration::from_secs(20);

/// Run a sandboxed widget handler script. The script gets a curated host API —
/// `ctx` (the action context), `surface` (current components/dataModel + the
/// generic `surface.history` state timeline), async
/// `tools.<name>(args)` (→ MCP), and `render(target, components, opts)` — and
/// produces a2ui emissions (collected from `render` calls). NO file/network/system
/// access beyond the exposed `tools`. Memory/stack/time limited.
///
/// Returns the raw a2ui emissions, or an error string (caller falls back to the LLM).
pub async fn run_handler(
    state: AppState,
    code: &str,
    ctx_json: Value,
    surface_json: Value,
    self_id: String,
) -> Result<Vec<Value>, String> {
    let rt = AsyncRuntime::new().map_err(|e| e.to_string())?;
    rt.set_memory_limit(MEM_LIMIT).await;
    rt.set_max_stack_size(STACK_LIMIT).await;
    let deadline = Instant::now() + TIME_LIMIT;
    rt.set_interrupt_handler(Some(Box::new(move || Instant::now() >= deadline))).await;
    let context = AsyncContext::full(&rt).await.map_err(|e| e.to_string())?;

    let emissions: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
    let emissions_for_render = emissions.clone();
    let ctx_str = ctx_json.to_string();
    let surface_str = surface_json.to_string();

    let result: Result<(), String> = async_with!(context => |ctx| {
        let globals = ctx.globals();
        globals.set("__ctx_json", ctx_str).map_err(|e| e.to_string())?;
        globals.set("__surface_json", surface_str).map_err(|e| e.to_string())?;

        // tools.<name>(args) — async, bound to the MCP client.
        let tool_state = state.clone();
        let call_tool = Async(move |name: String, args: String| {
            let st = tool_state.clone();
            async move {
                let args_val: Value = serde_json::from_str(&args).unwrap_or_else(|_| json!({}));
                let outcome = mcp::call(&st, &name, args_val).await;
                rquickjs::Result::Ok(outcome.text)
            }
        });
        let call_tool_fn = Function::new(ctx.clone(), call_tool).map_err(|e| e.to_string())?;
        globals.set("__call_tool", call_tool_fn).map_err(|e| e.to_string())?;

        // render(target, components, opts) — collect an a2ui updateComponents emission.
        let buf = emissions_for_render;
        let self_id2 = self_id.clone();
        let render = move |target: String, components: String, opts: String| -> rquickjs::Result<()> {
            let comps: Value = serde_json::from_str(&components).unwrap_or_else(|_| json!([]));
            let o: Value = serde_json::from_str(&opts).unwrap_or_else(|_| json!({}));
            let sid = if target == "self" || target.is_empty() { self_id2.clone() } else { target };
            let mut em = json!({
                "kind": "a2ui",
                "targetSurfaceId": sid,
                "messages": [ { "version": "v0.9", "updateComponents": { "surfaceId": sid, "components": comps } } ],
            });
            if o.get("pushHistory").and_then(|b| b.as_bool()).unwrap_or(false) {
                em["pushHistory"] = json!(true);
            }
            if let Ok(mut b) = buf.lock() {
                b.push(em);
            }
            Ok(())
        };
        globals.set("__render", Func::from(render)).map_err(|e| e.to_string())?;

        // Prelude: ctx/surface objects, the tools proxy, and render().
        let prelude = r#"
            globalThis.ctx = JSON.parse(__ctx_json);
            globalThis.surface = JSON.parse(__surface_json);
            if (!globalThis.surface.history) globalThis.surface.history = [];
            globalThis.tools = new Proxy({}, {
                get: (_t, name) => (args) =>
                    __call_tool(String(name), JSON.stringify(args === undefined ? {} : args))
                        .then((r) => { try { return JSON.parse(r); } catch (e) { return r; } }),
            });
            globalThis.render = function (target, components, opts) {
                __render(
                    String(target == null ? 'self' : target),
                    JSON.stringify(components == null ? [] : components),
                    JSON.stringify(opts == null ? {} : opts),
                );
            };
        "#;
        ctx.eval::<(), _>(prelude).map_err(|e| e.to_string())?;

        // Run the handler body as an async IIFE and await its promise.
        let wrapped = format!("(async () => {{\n{code}\n}})()");
        let promise: Promise = ctx.eval(wrapped).map_err(|e| e.to_string())?;
        promise.into_future::<()>().await.map_err(|e| e.to_string())?;
        Ok(())
    })
    .await;

    rt.idle().await;
    result?;
    let out = emissions.lock().map(|b| b.clone()).unwrap_or_default();
    Ok(out)
}

/// Quick syntax/compile check of an emitted handler script (no execution), so a
/// malformed local-model script never gets persisted. Returns Ok or an error msg.
pub async fn compile_check(code: &str) -> Result<(), String> {
    let rt = AsyncRuntime::new().map_err(|e| e.to_string())?;
    rt.set_memory_limit(MEM_LIMIT).await;
    let context = AsyncContext::full(&rt).await.map_err(|e| e.to_string())?;
    let wrapped = format!("(async () => {{\n{code}\n}})");
    async_with!(context => |ctx| {
        // Compile only (define the function, don't call it).
        ctx.eval::<rquickjs::Value, _>(wrapped).map(|_| ()).map_err(|e| e.to_string())
    })
    .await
}
