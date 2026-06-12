use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

use super::log::log_llm;
use super::mcp::{self, McpUiResource};
use super::ollama::Ollama;
use super::prompt::build_system_prompt;
use super::schema::envelope_schema;
use super::skills::{load_skills, render_skills_for_prompt};
use crate::server::state::AppState;

/// Max corrective re-asks (shared budget across parse + domain failures).
const MAX_CORRECTIONS: usize = 2;
/// Max MCP tool-calling rounds in the pre-step (matches Node's `stepCountIs(4)`).
const MAX_TOOL_ROUNDS: usize = 4;
const BASIC_CATALOG_ID: &str = "https://a2ui.org/specification/v0_9/basic_catalog.json";

/// A tool the agent called during a turn (surfaced as AG-UI TOOL_CALL events).
pub struct ToolCallRecord {
    pub id: String,
    pub name: String,
    pub result: Option<String>,
    pub is_error: bool,
}

/// A successful turn's result (mirrors AgentOutcome::ok).
pub struct Outcome {
    pub validated: Vec<Value>,
    pub rationale: Option<String>,
    pub reply: Option<String>,
    pub tool_calls: Vec<ToolCallRecord>,
}

/// Error: (http status, body). Mirrors AgentOutcome::err.
pub type TurnError = (u16, Value);

/// Run one agent turn end-to-end: discover MCP tools → system prompt (+skills) →
/// optional MCP pre-step → structured emission + correction loop → MCP-UI embeds.
pub async fn run_agent_turn(
    state: &AppState,
    body: &Value,
    ollama: &Ollama,
) -> Result<Outcome, TurnError> {
    let prompt = body.get("prompt").and_then(|p| p.as_str()).unwrap_or("");
    if prompt.is_empty() {
        return Err((400, json!({ "error": "Missing prompt" })));
    }
    let empty_ctx = default_context();
    let ctx = body.get("context").filter(|c| c.is_object()).unwrap_or(&empty_ctx);

    // Discover MCP tools BEFORE building the prompt so the model knows what's available.
    mcp::ensure(state).await;
    let tool_infos = mcp::tool_infos(state).await;

    let skills = render_skills_for_prompt(&load_skills(&state.skills_dir()));
    let system = format!("{}{}", build_system_prompt(ctx, &tool_infos), skills);

    let history_len = body.get("messages").and_then(|m| m.as_array()).map(|a| a.len()).unwrap_or(0);
    log_llm(json!({
        "phase": "turn.start", "model": ollama.model,
        "promptChars": prompt.len(), "historyLen": history_len, "tools": tool_infos.len(),
    }));

    // Thread prior conversation (history) + current prompt; system passed separately.
    let mut convo: Vec<Value> = vec![json!({ "role": "system", "content": system })];
    if let Some(msgs) = body.get("messages").and_then(|m| m.as_array()) {
        for m in msgs {
            let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
            let content = m.get("content").and_then(|c| c.as_str()).unwrap_or("");
            if role == "user" || role == "assistant" {
                convo.push(json!({ "role": role, "content": content }));
            }
        }
    }
    convo.push(json!({ "role": "user", "content": prompt }));

    // MCP tool pre-step (failure-tolerant; skipped when no tools).
    let mut tool_calls: Vec<ToolCallRecord> = Vec::new();
    let mut ui_resources: Vec<McpUiResource> = Vec::new();
    if !tool_infos.is_empty() {
        pre_step(state, ollama, &tool_infos, &mut convo, &mut tool_calls, &mut ui_resources).await;
    }

    match run_with_correction(ollama, convo, ctx).await {
        Ok(mut outcome) => {
            // Compile-check emitted widget handlers; drop any that don't parse so a
            // malformed local-model script never gets persisted/attached.
            let mut kept = Vec::with_capacity(outcome.validated.len());
            for em in outcome.validated.into_iter() {
                if em.get("kind").and_then(|k| k.as_str()) == Some("widgetScript") {
                    let code = em.get("code").and_then(|c| c.as_str()).unwrap_or("");
                    if let Err(e) = super::widget::compile_check(code).await {
                        log_llm(json!({ "phase": "widget.compile_error", "event": em.get("event"), "error": e }));
                        continue;
                    }
                }
                kept.push(em);
            }
            outcome.validated = kept;

            // Render captured MCP-UI resources as their own surfaces (framework-driven).
            for r in &ui_resources {
                outcome.validated.push(build_embed_emission(r));
            }
            outcome.tool_calls = tool_calls;
            log_llm(json!({
                "phase": "turn.ok", "emissions": outcome.validated.len(),
                "toolCalls": outcome.tool_calls.len(), "uiResources": ui_resources.len(),
            }));
            Ok(outcome)
        }
        Err((status, body)) => {
            log_llm(json!({ "phase": "turn.failed", "status": status, "body": body }));
            Err((status, body))
        }
    }
}

/// Let the model call MCP tools (multi-step) before the envelope step. Any error
/// skips the pre-step cleanly (matches `run-turn.ts`).
async fn pre_step(
    state: &AppState,
    ollama: &Ollama,
    tool_infos: &[Value],
    convo: &mut Vec<Value>,
    tool_calls: &mut Vec<ToolCallRecord>,
    ui: &mut Vec<McpUiResource>,
) {
    for _ in 0..MAX_TOOL_ROUNDS {
        let step = match ollama.chat_with_tools(convo, tool_infos).await {
            Ok(s) => s,
            Err(e) => {
                log_llm(json!({ "phase": "prestep.error", "error": e }));
                return;
            }
        };
        if step.tool_calls.is_empty() {
            convo.push(step.message); // final assistant text → keep for context
            return;
        }
        convo.push(step.message); // assistant message carrying the tool_calls
        for tc in step.tool_calls {
            let outcome = mcp::call(state, &tc.name, tc.arguments.clone()).await;
            log_llm(json!({ "phase": "prestep.tool", "tool": tc.name, "isError": outcome.is_error }));
            convo.push(json!({ "role": "tool", "content": outcome.text.clone(), "tool_name": tc.name.clone() }));
            tool_calls.push(ToolCallRecord {
                id: tc.id,
                name: tc.name,
                result: Some(outcome.text),
                is_error: outcome.is_error,
            });
            ui.extend(outcome.ui);
        }
    }
}

async fn run_with_correction(
    ollama: &Ollama,
    mut convo: Vec<Value>,
    ctx: &Value,
) -> Result<Outcome, TurnError> {
    let mut corrections = 0usize;
    loop {
        log_llm(json!({ "phase": "envelope.request", "attempt": corrections }));
        let envelope = match ollama.generate_object(&convo, envelope_schema()).await {
            Ok(v) if v.is_object() => {
                log_llm(json!({ "phase": "envelope.response", "attempt": corrections, "envelope": v }));
                v
            }
            Ok(v) => {
                if corrections < MAX_CORRECTIONS {
                    corrections += 1;
                    convo.push(json!({ "role": "assistant", "content": v.to_string() }));
                    convo.push(json!({ "role": "user", "content": parse_retry_msg("expected a JSON object") }));
                    continue;
                }
                return Err((502, json!({ "error": "Agent did not return a JSON object" })));
            }
            Err(pe) => {
                log_llm(json!({ "phase": "envelope.parse_error", "attempt": corrections, "cause": pe.message }));
                if corrections < MAX_CORRECTIONS {
                    corrections += 1;
                    let raw = pe.raw.clone().unwrap_or_default();
                    let asst = if raw.trim().is_empty() {
                        "(previous output was not valid JSON)".to_string()
                    } else {
                        raw
                    };
                    convo.push(json!({ "role": "assistant", "content": asst }));
                    convo.push(json!({ "role": "user", "content": parse_retry_msg(&pe.message) }));
                    continue;
                }
                return Err((
                    502,
                    json!({ "error": format!("Agent did not return valid JSON after {MAX_CORRECTIONS} correction attempts: {}", pe.message) }),
                ));
            }
        };

        let emissions: Vec<Value> = envelope
            .get("emissions")
            .and_then(|e| e.as_array())
            .cloned()
            .unwrap_or_default();
        let result = process_emissions(&emissions, ctx);

        if !result.issues.is_empty() {
            log_llm(json!({ "phase": "validation.issues", "attempt": corrections, "issues": result.issues }));
            if corrections < MAX_CORRECTIONS {
                corrections += 1;
                convo.push(json!({ "role": "assistant", "content": envelope.to_string() }));
                convo.push(json!({ "role": "user", "content": format!(
                    "Your previous response had these issues:\n- {}\n\nFix every issue and resend the corrected JSON only. Same schema, no commentary.",
                    result.issues.join("\n- ")
                ) }));
                continue;
            }
            return Err((
                422,
                json!({ "error": format!("Agent produced an invalid response after {MAX_CORRECTIONS} correction attempts"), "issues": result.issues }),
            ));
        }

        if !result.noops.is_empty() {
            log_llm(json!({ "phase": "validation.noops", "attempt": corrections, "noops": result.noops }));
            if corrections < MAX_CORRECTIONS {
                corrections += 1;
                convo.push(json!({ "role": "assistant", "content": envelope.to_string() }));
                convo.push(json!({ "role": "user", "content": format!(
                    "Your updateComponents for surface(s) [{}] is identical to what is already rendered — it changes nothing. Do NOT claim you changed or fixed it. If the user's request cannot be satisfied by changing the component spec (e.g. it concerns how the component renders, which you do not control), say so briefly and honestly in \"reply\" and return an empty emissions array. Otherwise, emit a genuinely different spec that addresses the request.",
                    result.noops.join(", ")
                ) }));
                continue;
            }
            let noop_set: HashSet<&str> = result.noops.iter().map(|s| s.as_str()).collect();
            let cleaned: Vec<Value> = result
                .validated
                .into_iter()
                .filter(|v| {
                    !(v.get("kind").and_then(|k| k.as_str()) == Some("a2ui")
                        && v.get("targetSurfaceId")
                            .and_then(|t| t.as_str())
                            .map(|t| noop_set.contains(t))
                            .unwrap_or(false))
                })
                .collect();
            return Ok(Outcome {
                validated: cleaned,
                rationale: env_str(&envelope, "rationale"),
                reply: env_str(&envelope, "reply"),
                tool_calls: Vec::new(),
            });
        }

        return Ok(Outcome {
            validated: result.validated,
            rationale: env_str(&envelope, "rationale"),
            reply: env_str(&envelope, "reply"),
            tool_calls: Vec::new(),
        });
    }
}

/// Wrap an MCP-UI resource into an A2UI emission rendering a sandboxed Embed surface.
fn build_embed_emission(r: &McpUiResource) -> Value {
    let sid = mint_surface_id();
    let mut embed = json!({ "id": "root", "component": "Embed", "title": r.tool });
    if let Some(h) = &r.html {
        embed["html"] = json!(h);
    }
    if let Some(u) = &r.url {
        embed["url"] = json!(u);
    }
    if let Some(m) = &r.mime_type {
        embed["mimeType"] = json!(m);
    }
    if let Some(uri) = &r.uri {
        embed["uri"] = json!(uri);
    }
    json!({
        "kind": "a2ui",
        "targetSurfaceId": sid,
        "messages": [
            { "version": "v0.9", "createSurface": { "surfaceId": sid, "catalogId": BASIC_CATALOG_ID, "sendDataModel": true } },
            { "version": "v0.9", "updateComponents": { "surfaceId": sid, "components": [embed] } }
        ]
    })
}

fn parse_retry_msg(cause: &str) -> String {
    format!(
        "Your previous response could not be parsed: {cause}. Respond again with ONLY a single valid JSON object matching the schema {{ reply, rationale, emissions }} — no markdown fences, no prose outside the JSON."
    )
}

fn env_str(envelope: &Value, key: &str) -> Option<String> {
    envelope
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
}

pub(crate) struct ProcessResult {
    pub validated: Vec<Value>,
    pub issues: Vec<String>,
    pub noops: Vec<String>,
}

/// Validate + normalize raw emissions: mint/inject surfaceIds, check the component
/// graph, detect no-ops, resolve pageOp placeholders. Port of `processEmissions`.
pub(crate) fn process_emissions(emissions: &[Value], ctx: &Value) -> ProcessResult {
    let mut validated: Vec<Value> = Vec::new();
    let mut issues: Vec<String> = Vec::new();
    let mut noops: Vec<String> = Vec::new();
    let mut last_surface_id: Option<String> = None;

    let known_surfaces: HashSet<String> = ctx
        .get("surfaces")
        .and_then(|s| s.as_object())
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();

    for em in emissions {
        let kind = em.get("kind").and_then(|k| k.as_str()).unwrap_or("");
        if kind == "a2ui" {
            let declared = em.get("targetSurfaceId").and_then(|t| t.as_str()).unwrap_or("");
            let is_placeholder = declared.is_empty() || declared == "<PLACEHOLDER>";
            let a2ui_msgs: Vec<Value> = em
                .get("messages")
                .and_then(|m| m.as_array())
                .cloned()
                .unwrap_or_default();
            let has_create = a2ui_msgs.iter().any(|m| m.get("createSurface").is_some());

            if !is_placeholder && !has_create && !known_surfaces.contains(declared) {
                let mut known: Vec<&str> = known_surfaces.iter().map(|s| s.as_str()).collect();
                known.sort_unstable();
                let known_str = if known.is_empty() { "(none)".to_string() } else { known.join(", ") };
                issues.push(format!(
                    "Emission targets unknown surface \"{declared}\". Known surfaces: [{known_str}]. To create a new surface use targetSurfaceId=\"<PLACEHOLDER>\" with a createSurface message; to modify an existing one use one of the known ids verbatim."
                ));
                continue;
            }

            let target_id = if is_placeholder { mint_surface_id() } else { declared.to_string() };
            last_surface_id = Some(target_id.clone());
            let processed: Vec<Value> =
                a2ui_msgs.iter().map(|m| inject_surface_id(m, &target_id)).collect();
            issues.extend(validate_component_references(&processed));
            validated.push(json!({ "kind": "a2ui", "targetSurfaceId": target_id, "messages": processed }));

            if !is_placeholder && !has_create && known_surfaces.contains(declared) {
                let live = ctx
                    .get("surfaces")
                    .and_then(|s| s.get(declared))
                    .and_then(|s| s.get("components"));
                let updates: Vec<&Value> =
                    processed.iter().filter(|m| m.get("updateComponents").is_some()).collect();
                let all_noop = !updates.is_empty()
                    && updates.iter().all(|m| {
                        let comps = m.get("updateComponents").and_then(|uc| uc.get("components"));
                        same_component_set(live, comps)
                    });
                if all_noop {
                    noops.push(declared.to_string());
                }
            }
        } else if kind == "pageOp" {
            let raw_op = em.get("op").cloned().unwrap_or_else(|| json!({}));
            let op_issues = validate_page_op(&raw_op, ctx);
            if !op_issues.is_empty() {
                issues.extend(op_issues);
                continue;
            }
            let op = resolve_placeholders(&raw_op, ctx, last_surface_id.as_deref());
            validated.push(json!({ "kind": "pageOp", "op": op }));
        } else if kind == "widgetScript" {
            // A JS action handler attached to a surface. Resolve the target like a2ui.
            let declared = em.get("targetSurfaceId").and_then(|t| t.as_str()).unwrap_or("");
            let is_placeholder = declared.is_empty() || declared == "<PLACEHOLDER>";
            let sid = if is_placeholder {
                match &last_surface_id {
                    Some(s) => s.clone(),
                    None => {
                        issues.push("widgetScript has no target surface — set targetSurfaceId to the surface's id, or attach it in the same turn that creates the surface.".to_string());
                        continue;
                    }
                }
            } else {
                declared.to_string()
            };
            let event = em.get("event").and_then(|e| e.as_str()).unwrap_or("");
            let code = em.get("code").and_then(|c| c.as_str()).unwrap_or("");
            let runtime = match em.get("runtime").and_then(|r| r.as_str()) {
                Some("client") => "client",
                _ => "server",
            };
            if event.is_empty() || code.is_empty() {
                issues.push(format!("widgetScript needs non-empty \"event\" and \"code\". Got: {em}."));
                continue;
            }
            validated.push(json!({
                "kind": "widgetScript", "targetSurfaceId": sid,
                "event": event, "runtime": runtime, "code": code,
            }));
        }
    }

    ProcessResult { validated, issues, noops }
}

/// Required fields per page op (beyond `name`).
fn page_op_required(name: &str) -> Option<&'static [&'static str]> {
    Some(match name {
        "createPage" => &["pageId", "title"],
        "deletePage" => &["pageId"],
        "setPageProps" => &["pageId"],
        "setPageLayout" => &["pageId", "layout"],
        "pinSurface" => &["surfaceId", "pageId"],
        "unpinSurface" => &["surfaceId", "pageId"],
        "moveSurface" => &["surfaceId", "pageId", "targetRegion"],
        "setPageRegion" => &["pageId", "regionId"],
        _ => return None,
    })
}

fn validate_page_op(op: &Value, ctx: &Value) -> Vec<String> {
    let name = op.get("name").and_then(|n| n.as_str()).unwrap_or("");
    let required = match page_op_required(name) {
        Some(r) => r,
        None => {
            let known = "createPage, deletePage, setPageProps, setPageLayout, pinSurface, unpinSurface, moveSurface, setPageRegion";
            let active_id = ctx.get("activeTabId").and_then(|a| a.as_str()).unwrap_or("");
            let active = if !active_id.is_empty() && active_id != "chat" {
                format!(" The active page is \"{active_id}\".")
            } else {
                String::new()
            };
            return vec![format!(
                "pageOp is missing a valid \"name\" — use one of [{known}].{active} For \"change the layout\", emit {{\"kind\":\"pageOp\",\"op\":{{\"name\":\"setPageLayout\",\"pageId\":\"<activePageId>\",\"layout\":{{\"kind\":\"row\",\"regions\":[{{\"id\":\"left\"}},{{\"id\":\"right\"}}]}}}}}}. Got: {}.",
                op
            )];
        }
    };

    let mut missing: Vec<String> = required
        .iter()
        .filter(|f| {
            let v = op.get(**f);
            v.is_none()
                || v == Some(&Value::Null)
                || v.and_then(|x| x.as_str()) == Some("")
        })
        .map(|f| f.to_string())
        .collect();
    // setPageRegion.surfaceId may legitimately be null (clear a region).
    if name == "setPageRegion" && op.get("surfaceId").is_none() {
        missing.push("surfaceId".to_string());
    }
    if !missing.is_empty() {
        return vec![format!(
            "pageOp \"{name}\" is missing required field(s): {}. Got: {}.",
            missing.join(", "),
            op
        )];
    }
    Vec::new()
}

/// Id-keyed deep comparison of two A2UI component arrays (order-independent).
fn same_component_set(prev: Option<&Value>, next: Option<&Value>) -> bool {
    let (prev, next) = match (prev.and_then(|p| p.as_array()), next.and_then(|n| n.as_array())) {
        (Some(p), Some(n)) => (p, n),
        _ => return false,
    };
    let by_id = |arr: &[Value]| -> HashMap<String, Value> {
        let mut m = HashMap::new();
        for c in arr {
            if let Some(id) = c.get("id") {
                m.insert(value_to_id(id), c.clone());
            }
        }
        m
    };
    let a = by_id(prev);
    let b = by_id(next);
    if a.len() != b.len() {
        return false;
    }
    for (id, comp) in &a {
        match b.get(id) {
            Some(other) if other == comp => {}
            _ => return false,
        }
    }
    true
}

fn value_to_id(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn mint_surface_id() -> String {
    format!("agent-sfc-{}", &uuid::Uuid::new_v4().simple().to_string()[..8])
}

fn validate_component_references(messages: &[Value]) -> Vec<String> {
    let mut issues: Vec<String> = Vec::new();
    for msg in messages {
        let uc = match msg.get("updateComponents") {
            Some(uc) => uc,
            None => continue,
        };
        let components: Vec<Value> = uc
            .get("components")
            .and_then(|c| c.as_array())
            .cloned()
            .unwrap_or_default();
        let defined: HashSet<String> = components
            .iter()
            .filter_map(|c| c.get("id").map(value_to_id))
            .filter(|s| !s.is_empty())
            .collect();
        if !defined.contains("root") {
            let mut ids: Vec<&str> = defined.iter().map(|s| s.as_str()).collect();
            ids.sort_unstable();
            let id_str = if ids.is_empty() { "(none)".to_string() } else { ids.join(", ") };
            issues.push(format!(
                "Missing required component with id=\"root\". Defined ids: [{id_str}]."
            ));
        }
        for c in &components {
            let id = c.get("id").map(value_to_id).unwrap_or_default();
            if let Some(child) = c.get("child").and_then(|v| v.as_str()) {
                if !defined.contains(child) {
                    issues.push(format!(
                        "Component \"{id}\" references child \"{child}\" but no component with that id is defined."
                    ));
                }
            }
            if let Some(children) = c.get("children").and_then(|v| v.as_array()) {
                for r in children {
                    if let Some(rs) = r.as_str() {
                        if !defined.contains(rs) {
                            issues.push(format!(
                                "Component \"{id}\" references child \"{rs}\" but no component with that id is defined."
                            ));
                        }
                    }
                }
            }
            if let Some(action) = c.get("action") {
                if !action.is_null() {
                    let ev = action.get("event");
                    let name_ok = ev
                        .and_then(|e| e.get("name"))
                        .and_then(|n| n.as_str())
                        .map(|s| !s.is_empty())
                        .unwrap_or(false);
                    if !name_ok {
                        issues.push(format!(
                            "Component \"{id}\" has malformed action. Expected {{ event: {{ name: string, context?: object }} }}; got {action}."
                        ));
                    } else if let Some(context) = ev.and_then(|e| e.get("context")) {
                        if !context.is_object() {
                            issues.push(format!(
                                "Component \"{id}\" action.event.context must be an object (got {context})."
                            ));
                        }
                    }
                }
            }
        }
    }
    issues
}

/// Inject the resolved surfaceId into createSurface/updateComponents/deleteSurface/updateDataModel.
fn inject_surface_id(msg: &Value, surface_id: &str) -> Value {
    let mut m: Map<String, Value> = msg.as_object().cloned().unwrap_or_default();
    if let Some(cs) = m.get("createSurface").cloned() {
        let mut obj = Map::new();
        obj.insert("sendDataModel".into(), Value::Bool(true));
        if let Some(existing) = cs.as_object() {
            for (k, v) in existing {
                obj.insert(k.clone(), v.clone());
            }
        }
        obj.insert("surfaceId".into(), json!(surface_id));
        m.insert("createSurface".into(), Value::Object(obj));
    }
    for key in ["updateComponents", "deleteSurface", "updateDataModel"] {
        if let Some(existing) = m.get(key).cloned() {
            let mut obj = existing.as_object().cloned().unwrap_or_default();
            obj.insert("surfaceId".into(), json!(surface_id));
            m.insert(key.into(), Value::Object(obj));
        }
    }
    Value::Object(m)
}

fn resolve_placeholders(op: &Value, ctx: &Value, last_surface_id: Option<&str>) -> Value {
    let mut resolved = op.as_object().cloned().unwrap_or_default();
    let sid = resolved.get("surfaceId").and_then(|s| s.as_str()).map(String::from);
    if sid.as_deref() == Some("<PLACEHOLDER>") {
        if let Some(last) = last_surface_id {
            resolved.insert("surfaceId".into(), json!(last));
        }
    }
    let sid2 = resolved.get("surfaceId").and_then(|s| s.as_str());
    let falsy = sid2.is_none() || sid2 == Some("") || sid2 == Some("<PLACEHOLDER>");
    if falsy {
        if let Some(pinned) = ctx.get("recentPinnedSurfaceId").and_then(|p| p.as_str()) {
            resolved.insert("surfaceId".into(), json!(pinned));
        }
    }
    Value::Object(resolved)
}

fn default_context() -> Value {
    json!({
        "chatSurfaceIds": [],
        "pages": {},
        "surfaces": {},
        "recentSurfaceIds": [],
        "recentActions": [],
        "recentPinnedSurfaceId": null,
        "mostRecentSurfaceId": null,
        "activeTabId": "chat",
        "diagnostics": []
    })
}
