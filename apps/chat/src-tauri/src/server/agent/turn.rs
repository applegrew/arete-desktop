use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

use super::ollama::{ChatMessage, Ollama};
use super::prompt::build_system_prompt;
use super::schema::envelope_schema;

/// Max corrective re-asks (shared budget across parse + domain failures).
const MAX_CORRECTIONS: usize = 2;
const BASIC_CATALOG_ID: &str = "https://a2ui.org/specification/v0_9/basic_catalog.json";

/// A successful turn's result (mirrors AgentOutcome::ok).
pub struct Outcome {
    pub validated: Vec<Value>,
    pub rationale: Option<String>,
    pub reply: Option<String>,
}

/// Error: (http status, body). Mirrors AgentOutcome::err.
pub type TurnError = (u16, Value);

/// Run one agent turn end-to-end. MCP/tools are not yet wired (Phase 3), so the
/// pre-step is skipped — the model creates surfaces from its own knowledge.
pub async fn run_agent_turn(body: &Value, ollama: &Ollama) -> Result<Outcome, TurnError> {
    let prompt = body.get("prompt").and_then(|p| p.as_str()).unwrap_or("");
    if prompt.is_empty() {
        return Err((400, json!({ "error": "Missing prompt" })));
    }
    let empty_ctx = default_context();
    let ctx = body.get("context").filter(|c| c.is_object()).unwrap_or(&empty_ctx);

    let system = build_system_prompt(ctx, &[]);

    // Thread prior conversation (history) + current prompt; system is passed separately,
    // so drop any system turns from the transcript.
    let mut convo: Vec<ChatMessage> = Vec::new();
    convo.push(ChatMessage::system(system));
    if let Some(msgs) = body.get("messages").and_then(|m| m.as_array()) {
        for m in msgs {
            let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
            let content = m.get("content").and_then(|c| c.as_str()).unwrap_or("");
            match role {
                "user" => convo.push(ChatMessage::user(content)),
                "assistant" => convo.push(ChatMessage::assistant(content)),
                _ => {}
            }
        }
    }
    convo.push(ChatMessage::user(prompt));

    run_with_correction(ollama, convo, ctx).await
}

async fn run_with_correction(
    ollama: &Ollama,
    mut convo: Vec<ChatMessage>,
    ctx: &Value,
) -> Result<Outcome, TurnError> {
    let mut corrections = 0usize;
    loop {
        let envelope = match ollama.generate_object(&convo, envelope_schema()).await {
            Ok(v) if v.is_object() => v,
            Ok(v) => {
                // Parsed JSON but not an object — treat like a parse failure.
                if corrections < MAX_CORRECTIONS {
                    corrections += 1;
                    convo.push(ChatMessage::assistant(v.to_string()));
                    convo.push(ChatMessage::user(parse_retry_msg("expected a JSON object")));
                    continue;
                }
                return Err((502, json!({ "error": "Agent did not return a JSON object" })));
            }
            Err(pe) => {
                if corrections < MAX_CORRECTIONS {
                    corrections += 1;
                    let raw = pe.raw.clone().unwrap_or_default();
                    let asst = if raw.trim().is_empty() {
                        "(previous output was not valid JSON)".to_string()
                    } else {
                        raw
                    };
                    convo.push(ChatMessage::assistant(asst));
                    convo.push(ChatMessage::user(parse_retry_msg(&pe.message)));
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
            if corrections < MAX_CORRECTIONS {
                corrections += 1;
                convo.push(ChatMessage::assistant(envelope.to_string()));
                convo.push(ChatMessage::user(format!(
                    "Your previous response had these issues:\n- {}\n\nFix every issue and resend the corrected JSON only. Same schema, no commentary.",
                    result.issues.join("\n- ")
                )));
                continue;
            }
            return Err((
                422,
                json!({ "error": format!("Agent produced an invalid response after {MAX_CORRECTIONS} correction attempts"), "issues": result.issues }),
            ));
        }

        if !result.noops.is_empty() {
            if corrections < MAX_CORRECTIONS {
                corrections += 1;
                convo.push(ChatMessage::assistant(envelope.to_string()));
                convo.push(ChatMessage::user(format!(
                    "Your updateComponents for surface(s) [{}] is identical to what is already rendered — it changes nothing. Do NOT claim you changed or fixed it. If the user's request cannot be satisfied by changing the component spec (e.g. it concerns how the component renders, which you do not control), say so briefly and honestly in \"reply\" and return an empty emissions array. Otherwise, emit a genuinely different spec that addresses the request.",
                    result.noops.join(", ")
                )));
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
            });
        }

        return Ok(Outcome {
            validated: result.validated,
            rationale: env_str(&envelope, "rationale"),
            reply: env_str(&envelope, "reply"),
        });
    }
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

struct ProcessResult {
    validated: Vec<Value>,
    issues: Vec<String>,
    noops: Vec<String>,
}

/// Validate + normalize raw emissions: mint/inject surfaceIds, check the component
/// graph, detect no-ops, resolve pageOp placeholders. Port of `processEmissions`.
fn process_emissions(emissions: &[Value], ctx: &Value) -> ProcessResult {
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

/// Catalog id (unused until MCP-UI embeds land in Phase 3); kept for parity.
#[allow(dead_code)]
pub const CATALOG_ID: &str = BASIC_CATALOG_ID;
