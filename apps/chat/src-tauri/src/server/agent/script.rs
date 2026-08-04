//! Sandboxed JS runtime (boa_engine) for `buildScript` agent emissions.
//!
//! The agent emits a compact script; this module executes it synchronously (ES5,
//! no await) and captures all surface mutations. State is stored in a thread-local
//! to avoid boa_engine GC requirements.

use boa_engine::{
    object::ObjectInitializer,
    property::Attribute,
    string::JsString,
    Context, JsResult, JsValue, NativeFunction, Source,
};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::HashMap;

const BASIC_CATALOG: &str = "https://a2ui.org/specification/v0_9/basic_catalog.json";

/// Output captured from one `buildScript` execution.
pub struct BuildScriptOutput {
    pub messages: Vec<Value>,
    pub logs: Vec<String>,
    pub created_surfaces: Vec<String>,
}

/// Pre-step tool-call record fed to the script as `context.toolCalls`.
pub struct ToolCallRecord {
    pub name: String,
    pub args: Value,
    pub result: Value,
}

// Thread-local state accessed by host functions. Since scripts run synchronously
// and single-threaded, there's no contention.
thread_local! {
    static MESSAGES: RefCell<Vec<Value>> = RefCell::new(Vec::new());
    static LOGS: RefCell<Vec<String>> = RefCell::new(Vec::new());
    static CREATED: RefCell<Vec<String>> = RefCell::new(Vec::new());
    static TOOL_RESULTS: RefCell<HashMap<String, Value>> = RefCell::new(HashMap::new());
    static TOOL_CALLS: RefCell<Vec<ToolCallRec>> = RefCell::new(Vec::new());
}

/// A simple owned clone of ToolCallRecord that can live in a thread-local.
#[derive(Clone)]
struct ToolCallRec {
    name: String,
    args: Value,
    result: Value,
}

/// Serialize a `serde_json::Value` into a `boa_engine::JsValue`.
fn json_to_js(ctx: &mut Context, v: &Value) -> JsValue {
    match v {
        Value::Null => JsValue::null(),
        Value::Bool(b) => JsValue::Boolean(*b),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                JsValue::Integer(i as i32)
            } else if let Some(f) = n.as_f64() {
                JsValue::Rational(f)
            } else {
                JsValue::undefined()
            }
        }
        Value::String(s) => JsValue::String(JsString::from(s.as_str())),
        Value::Array(arr) => {
            let elements: Vec<JsValue> = arr.iter().map(|v| json_to_js(ctx, v)).collect();
            boa_engine::object::builtins::JsArray::from_iter(elements, ctx).into()
        }
        Value::Object(obj) => {
            let entries: Vec<(JsString, JsValue)> = obj.iter().map(|(k, v)| {
                (JsString::from(k.as_str()), json_to_js(ctx, v))
            }).collect();
            let mut init = ObjectInitializer::new(ctx);
            for (k, v) in entries {
                init.property(k, v, Attribute::all());
            }
            init.build().into()
        }
    }
}

/// Convert a `JsValue` (via `to_json()`) back to `serde_json::Value`.
fn js_to_json(v: &JsValue, ctx: &mut Context) -> Result<Value, String> {
    v.to_json(ctx).map_err(|e| format!("js→json: {e}"))
}

/// Extract a string from a JsValue argument.
fn arg_str(args: &[JsValue], idx: usize, ctx: &mut Context) -> Result<String, String> {
    args.get(idx)
        .ok_or_else(|| format!("missing argument {idx}"))
        .and_then(|a| a.to_string(ctx).map(|s| s.to_std_string_escaped()).map_err(|e| format!("arg {idx}: {e}")))
}

/// Build the `context` global object and register it.
fn register_context(ctx: &mut Context) -> Result<(), String> {
    // Build JS values first (before creating ObjectInitializer) to avoid
    // double-borrowing ctx.
    let entries: Vec<(JsString, JsValue)> = TOOL_RESULTS.with(|r| {
        r.borrow().iter().map(|(name, result)| {
            (JsString::from(name.as_str()), json_to_js(ctx, result))
        }).collect()
    });
    let data_obj = {
        let mut data_init = ObjectInitializer::new(ctx);
        for (name, value) in entries {
            data_init.property(name, value, Attribute::all());
        }
        data_init.build()
    };

    // context.toolCalls — pre-build JS values to avoid double-borrow
    let call_entries: Vec<[JsValue; 3]> = TOOL_CALLS.with(|calls| {
        calls.borrow().iter().map(|tc| {
            [
                JsValue::String(tc.name.clone().into()),
                json_to_js(ctx, &tc.args),
                json_to_js(ctx, &tc.result),
            ]
        }).collect()
    });
    let calls: Vec<JsValue> = {
        call_entries.into_iter().map(|[name, args, result]| {
            let mut init = ObjectInitializer::new(ctx);
            init.property(JsString::from("name"), name, Attribute::all());
            init.property(JsString::from("args"), args, Attribute::all());
            init.property(JsString::from("result"), result, Attribute::all());
            init.build().into()
        }).collect()
    };
    let calls_arr = boa_engine::object::builtins::JsArray::from_iter(calls, ctx);

    // Assemble the top-level context object
    let context_obj = {
        let mut init = ObjectInitializer::new(ctx);
        init.property(JsString::from("data"), data_obj, Attribute::all());
        init.property(JsString::from("toolCalls"), calls_arr, Attribute::all());
        init.build()
    };
    ctx.register_global_property(JsString::from("context"), context_obj, Attribute::all())
        .map_err(|e| format!("register context: {e}"))?;
    Ok(())
}

/// console.log(...args) — captures each call.
fn log_fn(_this: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let parts: Vec<String> = args
        .iter()
        .map(|a| a.to_string(ctx).map(|s| s.to_std_string_escaped()).unwrap_or_default())
        .collect();
    LOGS.with(|l| l.borrow_mut().push(parts.join(" ")));
    Ok(JsValue::undefined())
}

/// createSurface(catalogId) → string
fn create_surface_fn(_this: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let catalog_id = arg_str(args, 0, ctx).unwrap_or_else(|_| BASIC_CATALOG.to_string());
    let new_id = format!(
        "agent-scr-{}",
        uuid::Uuid::new_v4().simple().to_string()[..8].to_string()
    );
    CREATED.with(|c| c.borrow_mut().push(new_id.clone()));
    MESSAGES.with(|m| {
        m.borrow_mut().push(json!({
            "createSurface": {
                "surfaceId": new_id,
                "catalogId": catalog_id,
            },
            "version": "v0.9",
        }))
    });
    Ok(JsValue::String(new_id.into()))
}

/// handle.update(components) — reads surface id from this.id
fn update_fn(this: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let sid = match this {
        JsValue::Object(obj) => obj
            .get(JsString::from("id"), ctx)?
            .to_string(ctx)
            .map(|s| s.to_std_string_escaped())
            .unwrap_or_default(),
        _ => String::new(),
    };
    let comps = args.get(0).cloned().unwrap_or(JsValue::undefined());
    let comps_json = js_to_json(&comps, ctx).unwrap_or(Value::Array(vec![]));
    MESSAGES.with(|m| {
        m.borrow_mut().push(json!({
            "updateComponents": {
                "surfaceId": sid,
                "components": comps_json,
            },
            "version": "v0.9",
        }))
    });
    Ok(JsValue::undefined())
}

/// handle.emit(messages) — reads surface id from this.id
fn emit_fn(_this: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let raw = args.get(0).cloned().unwrap_or(JsValue::undefined());
    let raw_json = js_to_json(&raw, ctx).unwrap_or(Value::Array(vec![]));
    if let Some(arr) = raw_json.as_array() {
        MESSAGES.with(|m| {
            for msg in arr {
                m.borrow_mut().push(msg.clone());
            }
        })
    }
    Ok(JsValue::undefined())
}

/// surface(id) → handle with .id, .update(), .emit()
fn surface_fn(_this: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let id = arg_str(args, 0, ctx).unwrap_or_default();
    let mut init = ObjectInitializer::new(ctx);
    init.property(JsString::from("id"), JsValue::String(id.into()), Attribute::all());
    init.function(NativeFunction::from_fn_ptr(update_fn), JsString::from("update"), 1);
    init.function(NativeFunction::from_fn_ptr(emit_fn), JsString::from("emit"), 1);
    Ok(init.build().into())
}

/// Execute a `buildScript` in a boa_engine sandbox. Synchronous ES5 only.
pub fn execute(
    code: &str,
    tool_results: &HashMap<String, Value>,
    tool_calls: &[ToolCallRecord],
) -> Result<BuildScriptOutput, String> {
    // Seed thread-locals with tool data.
    TOOL_RESULTS.with(|r| {
        *r.borrow_mut() = tool_results.clone();
    });
    TOOL_CALLS.with(|c| {
        *c.borrow_mut() = tool_calls.iter().map(|tc| ToolCallRec {
            name: tc.name.clone(),
            args: tc.args.clone(),
            result: tc.result.clone(),
        }).collect();
    });

    let mut ctx = Context::default();

    // Register host functions using fn pointers (Copy + 'static).
    let _ = ctx.register_global_callable(
        JsString::from("createSurface"),
        1,
        NativeFunction::from_fn_ptr(create_surface_fn),
    );
    let _ = ctx.register_global_callable(
        JsString::from("surface"),
        1,
        NativeFunction::from_fn_ptr(surface_fn),
    );

    // console object
    {
        let console_obj = {
            let mut init = ObjectInitializer::new(&mut ctx);
            init.function(NativeFunction::from_fn_ptr(log_fn), JsString::from("log"), 0);
            init.build()
        };
        ctx.register_global_property(JsString::from("console"), console_obj, Attribute::all())
            .map_err(|e| format!("register console: {e}"))?;
    }

    // context object
    register_context(&mut ctx)?;

    // Execute
    ctx.eval(Source::from_bytes(code))
        .map_err(|e| {
            format!("buildScript failed: {}", e.to_string())
        })?;

    // Collect output
    let messages = MESSAGES.with(|m| m.take());
    let logs = LOGS.with(|l| l.take());
    let created_surfaces = CREATED.with(|c| c.take());

    Ok(BuildScriptOutput { messages, logs, created_surfaces })
}
