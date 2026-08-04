use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

use super::display_hints::{self, DisplayHint};
use super::fs_tools;
use super::log::log_llm;
use super::mcp::{self, McpUiResource, ToolOutcome};
use super::llm::LlmClient;
use super::prompt::build_system_prompt;
use super::schema::envelope_schema;
use super::script;
use super::skills::{load_skills, render_skills_for_prompt};
use super::sse::Sink;
use crate::server::db;
use crate::server::state::AppState;

/// Max corrective re-asks (shared budget across parse + domain failures).
const MAX_CORRECTIONS: usize = 2;
/// Max MCP tool-calling rounds in the pre-step (matches Node's `stepCountIs(4)`).
const MAX_TOOL_ROUNDS: usize = 4;
const BASIC_CATALOG_ID: &str = "https://a2ui.org/specification/v0_9/basic_catalog.json";

/// A successful turn's result (mirrors AgentOutcome::ok).
pub struct Outcome {
    pub validated: Vec<Value>,
    pub rationale: Option<String>,
    pub reply: Option<String>,
    /// Optional discovery chips ({label, prompt}) the agent suggests for next steps.
    pub discovery_chips: Vec<Value>,
}

/// Error: (http status, body). Mirrors AgentOutcome::err.
pub type TurnError = (u16, Value);

/// Run one agent turn end-to-end: discover MCP tools → system prompt (+skills) →
/// optional MCP pre-step → structured emission + correction loop → MCP-UI embeds.
pub async fn run_agent_turn(
    state: &AppState,
    body: &Value,
    llm: &LlmClient,
    sink: &Sink,
) -> Result<Outcome, TurnError> {
    let prompt = body.get("prompt").and_then(|p| p.as_str()).unwrap_or("");
    if prompt.is_empty() {
        return Err((400, json!({ "error": "Missing prompt" })));
    }
    let empty_ctx = default_context();
    let ctx = body.get("context").filter(|c| c.is_object()).unwrap_or(&empty_ctx);

    // Discover MCP tools BEFORE building the prompt so the model knows what's available.
    mcp::ensure(state).await;
    let mut tool_infos = mcp::tool_infos(state).await;
    // Offer the built-in getSurfaceHistory tool only when some surface actually has
    // a timeline — so a fresh chat with no MCP tools pays no pre-step cost, but once
    // surfaces accumulate states the LLM can study them.
    tool_infos.extend(builtin_tools(ctx));
    // Folder-gated filesystem tools — advertised only when the user has authorized
    // at least one folder (see Settings → File system access).
    let allowed_folders = fs_tools::allowed_folders(state);
    tool_infos.extend(fs_tools::schemas(&allowed_folders));

    let skills = render_skills_for_prompt(&load_skills(&state.skills_dir()));
    // Load display hints accumulated from prior turns so the agent gets field-level
    // guidance for tools it has already called (persisted in app_state).
    let cached_hints: HashMap<String, DisplayHint> = {
        let conn = state.db_lock();
        db::get_state(&conn)
            .ok()
            .and_then(|m| m.get(display_hints::HINTS_STATE_KEY).map(display_hints::hints_from_value))
            .unwrap_or_default()
    };
    let system = format!("{}{}", build_system_prompt(ctx, &tool_infos, &cached_hints), skills);

    let history_len = body.get("messages").and_then(|m| m.as_array()).map(|a| a.len()).unwrap_or(0);
    log_llm(json!({
        "phase": "turn.start", "model": llm.model,
        "promptChars": prompt.len(), "historyLen": history_len, "tools": tool_infos.len(),
    }));

    // Thread prior conversation (history) + current prompt; system passed separately.
    let mut convo: Vec<Value> = vec![json!({ "role": "system", "content": system })];
    if !allowed_folders.is_empty() {
        convo.push(json!({
            "role": "system",
            "content": format!(
                "Filesystem tools (read_file, create_file, update_file, delete_file, mkdir, rmdir) are available. \
                 They may ONLY operate on absolute paths inside these authorized folders or their subdirectories:\n{}",
                allowed_folders.iter().map(|f| format!("- {f}")).collect::<Vec<_>>().join("\n")
            )
        }));
    }
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
    let mut ui_resources: Vec<McpUiResource> = Vec::new();
    let mut current_hints: HashMap<String, DisplayHint> = HashMap::new();
    let mut tool_records: Vec<script::ToolCallRecord> = Vec::new();
    if !tool_infos.is_empty() {
        let records = pre_step(
            state, llm, &tool_infos, ctx, &mut convo, sink,
            &mut ui_resources, &mut current_hints,
        )
        .await;
        tool_records = records;
    }

    // Inject fresh display hints as a system message so the agent sees field-level
    // guidance for the tools it just called BEFORE building the UI envelope.
    if let Some(hint_text) = display_hints::format_hints_turn(&current_hints) {
        convo.push(json!({ "role": "system", "content": hint_text }));
    }

    // Persist this turn's hints (merged over the cached set) so later turns inherit
    // field-level guidance for tools called in earlier turns.
    if !current_hints.is_empty() {
        let mut merged = cached_hints.clone();
        for (k, v) in &current_hints {
            merged.insert(k.clone(), v.clone());
        }
        let mut patch = Map::new();
        patch.insert(
            display_hints::HINTS_STATE_KEY.to_string(),
            display_hints::hints_to_value(&merged),
        );
        let mut conn = state.db_lock();
        let _ = db::set_state(&mut conn, &patch);
    }

    match run_with_correction(llm, convo, ctx, &tool_records).await {
        Ok(mut outcome) => {
            // Render captured MCP-UI resources as their own surfaces (framework-driven).
            for r in &ui_resources {
                outcome.validated.push(build_embed_emission(r));
            }
            log_llm(json!({
                "phase": "turn.ok", "emissions": outcome.validated.len(),
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
/// skips the pre-step cleanly. Tool call events are streamed to the client immediately
/// so the UI shows them incrementally, rather than all at once after the turn completes.
/// Returns tool call records for buildScript access.
async fn pre_step(
    state: &AppState,
    llm: &LlmClient,
    tool_infos: &[Value],
    ctx: &Value,
    convo: &mut Vec<Value>,
    sink: &Sink,
    ui_resources: &mut Vec<McpUiResource>,
    hints: &mut HashMap<String, DisplayHint>,
) -> Vec<script::ToolCallRecord> {
    let mut records: Vec<script::ToolCallRecord> = Vec::new();
    for _ in 0..MAX_TOOL_ROUNDS {
            let step = match llm.chat_with_tools(convo, tool_infos).await {
            Ok(s) => s,
            Err(e) => {
                log_llm(json!({ "phase": "prestep.error", "error": e }));
                return records;
            }
        };
        if step.tool_calls.is_empty() {
            convo.push(step.message); // final assistant text → keep for context
            return records;
        }
        convo.push(step.message); // assistant message carrying the tool_calls
        for tc in step.tool_calls {
            // Stream tool call events immediately so the UI sees them as they happen.
            sink.tool_call_start(&tc.id, &tc.name).await;
            // Built-in tools resolve locally against the turn's context (no MCP).
            let outcome = if tc.name == "getSurfaceHistory" {
                get_surface_history(ctx, &tc.arguments)
            } else if let Some(o) = fs_tools::dispatch(state, &tc.name, &tc.arguments).await {
                o
            } else {
                mcp::call(state, &tc.name, tc.arguments.clone()).await
            };
            log_llm(json!({ "phase": "prestep.tool", "tool": tc.name, "isError": outcome.is_error }));
            sink.tool_call_result(&tc.id, &outcome.text, outcome.is_error).await;
            sink.tool_call_end(&tc.id).await;
            // `tool_call_id` is required by OpenAI/DeepSeek (must echo the assistant's
            // tool-call id); `tool_name` is what Ollama keys on. Sending both keeps
            // the same convo valid for either provider.
            convo.push(json!({ "role": "tool", "tool_call_id": tc.id.clone(), "tool_name": tc.name.clone(), "content": outcome.text.clone() }));
            ui_resources.extend(outcome.ui);

            // Record for buildScript context access.
            records.push(script::ToolCallRecord {
                name: tc.name.clone(),
                args: tc.arguments.clone(),
                result: parse_tool_result(&outcome.text),
            });

            // Classify the tool result and collect display hints so the agent
            // gets field-level guidance (columns, badges, images, hides) for
            // building richer UI right after this turn's tool calls.
            if let Some(hint) = display_hints::classify_tool_result(&tc.name, &outcome.text) {
                hints.insert(tc.name.clone(), hint);
            }
        }
    }
    records
}

/// Built-in (non-MCP) tools offered to the model. `getSurfaceHistory` is offered
/// only when at least one surface in `ctx` carries a non-empty timeline, so turns
/// without any history pay no pre-step cost.
fn builtin_tools(ctx: &Value) -> Vec<Value> {
    let has_history = ctx
        .get("surfaces")
        .and_then(|s| s.as_object())
        .map(|surfaces| {
            surfaces.values().any(|s| {
                s.get("history").and_then(|h| h.as_array()).map(|a| !a.is_empty()).unwrap_or(false)
            })
        })
        .unwrap_or(false);
    if !has_history {
        return vec![];
    }
    vec![json!({
        "type": "function",
        "function": {
            "name": "getSurfaceHistory",
            "description": "Return a surface's saved state timeline (the prior rendered views, oldest→newest). Each entry has { seq, ts, trigger, components }. Use this to study what was shown before — e.g. when the user navigates back, fetch the history and re-render an earlier entry's components.",
            "parameters": {
                "type": "object",
                "properties": {
                    "surfaceId": { "type": "string", "description": "Which surface's history to fetch." },
                    "limit": { "type": "integer", "description": "Max most-recent entries to return (default 10)." }
                },
                "required": ["surfaceId"]
            }
        }
    })]
}

/// Resolve the getSurfaceHistory built-in tool against the turn context.
fn get_surface_history(ctx: &Value, args: &Value) -> ToolOutcome {
    let sid = args.get("surfaceId").and_then(|s| s.as_str()).unwrap_or("");
    let limit = args.get("limit").and_then(|l| l.as_u64()).unwrap_or(10) as usize;
    let entries = ctx
        .get("surfaces")
        .and_then(|s| s.get(sid))
        .and_then(|s| s.get("history"))
        .and_then(|h| h.as_array())
        .cloned()
        .unwrap_or_default();
    let n = entries.len();
    let recent: Vec<Value> = entries.into_iter().skip(n.saturating_sub(limit)).collect();
    let text = serde_json::to_string(&json!({ "surfaceId": sid, "count": recent.len(), "history": recent }))
        .unwrap_or_else(|_| "{}".to_string());
    ToolOutcome { text, is_error: false, ui: vec![] }
}

async fn run_with_correction(
    llm: &LlmClient,
    mut convo: Vec<Value>,
    ctx: &Value,
    tool_records: &[script::ToolCallRecord],
) -> Result<Outcome, TurnError> {
    let mut corrections = 0usize;
    loop {
        log_llm(json!({ "phase": "envelope.request", "attempt": corrections }));
        let envelope = match llm.generate_object(&convo, envelope_schema()).await {
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
                    let is_truncated = pe.message.contains("EOF while parsing")
                        || pe.message.contains("trailing characters");
                    let raw = pe.raw.clone().unwrap_or_default();
                    // When truncated, do NOT push the raw output back — it's malformed
                    // JSON that just wastes context window and makes the next truncation
                    // worse. Instead push a tight message suggesting buildScript.
                    if is_truncated {
                        // Trim old messages to free context window, but never orphan
                        // tool messages from their preceding tool_calls (DeepSeek requires
                        // every tool result to follow a tool_calls message).
                        trim_context(&mut convo);
                        convo.push(json!({ "role": "user", "content": parse_retry_msg(&pe.message) }));
                    } else {
                        let asst = if raw.trim().is_empty() {
                            "(previous output was not valid JSON)".to_string()
                        } else {
                            raw
                        };
                        convo.push(json!({ "role": "assistant", "content": asst }));
                        convo.push(json!({ "role": "user", "content": parse_retry_msg(&pe.message) }));
                    }
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
        let result = process_emissions(&emissions, ctx, tool_records);

        // Feed buildScript results back to the LLM so it can iterate on errors.
        for v in &result.validated {
            if v.get("kind").and_then(|k| k.as_str()) == Some("buildScriptResult") {
                let feedback = v.get("feedback").and_then(|f| f.as_str()).unwrap_or("");
                let is_error = v.get("error").and_then(|e| e.as_bool()).unwrap_or(false);
                let role = if is_error { "user" } else { "user" };
                convo.push(json!({ "role": role, "content": format!("[buildScript] {feedback}") }));
            }
        }

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
                json!({ "error": format!("Agent produced an invalid response after {MAX_CORRECTIONS} correction attempts"), "issues": result.issues, "emissions": result.validated }),
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
            // If stripping no-ops left nothing, the model failed to produce a real
            // change despite being warned. Don't pass through a reply that may still
            // claim success — reconcile it with what actually happened.
            let reply = if cleaned.is_empty() {
                log_llm(json!({ "phase": "validation.noops.all_stripped", "surfaces": result.noops }));
                Some(
                    "I couldn't produce a change different from what's already shown, so nothing was updated."
                        .to_string(),
                )
            } else {
                env_str(&envelope, "reply")
            };
            return Ok(Outcome {
                validated: cleaned,
                rationale: env_str(&envelope, "rationale"),
                reply,
                discovery_chips: env_chips(&envelope),
            });
        }

        return Ok(Outcome {
            validated: result.validated,
            rationale: env_str(&envelope, "rationale"),
            reply: env_str(&envelope, "reply"),
            discovery_chips: env_chips(&envelope),
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

/// Parse a tool result string into a Value. If the text is valid JSON, parse it;
/// otherwise keep it as a plain string.
fn parse_tool_result(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_string()))
}

/// Remove the oldest conversation messages (after the system prompt) to free
/// context window, while preserving tool_calls→tool message pairings required by
/// DeepSeek. Keeps the last user exchange + all tool-call blocks after it.
fn trim_context(convo: &mut Vec<Value>) {
    if convo.len() <= 4 {
        return; // nothing meaningful to trim
    }
    // Walk backwards from the end to find the earliest message we must preserve.
    // Every "tool" message requires its preceding "assistant" with "tool_calls".
    let mut preserve_from = convo.len();
    for i in (1..convo.len()).rev() {
        let role = convo[i].get("role").and_then(|r| r.as_str()).unwrap_or("");
        if role == "tool" {
            // Find the preceding assistant that carries tool_calls.
            for j in (1..i).rev() {
                let jr = convo[j].get("role").and_then(|r| r.as_str()).unwrap_or("");
                if jr == "assistant" && convo[j].get("tool_calls").is_some() {
                    preserve_from = preserve_from.min(j);
                    break;
                }
            }
        }
    }
    // Also keep the user message that triggered the tool-call block for context.
    if preserve_from < convo.len() {
        for j in (1..preserve_from).rev() {
            let jr = convo[j].get("role").and_then(|r| r.as_str()).unwrap_or("");
            if jr == "user" {
                preserve_from = j;
                break;
            }
        }
    }
    if preserve_from > 1 {
        convo.drain(1..preserve_from);
    }
}

fn parse_retry_msg(cause: &str) -> String {
    if cause.contains("EOF while parsing") {
        format!(
            "Your JSON output was TRUNCATED (too large for the model's output limit). \
             Use a \"buildScript\" emission instead — write a compact JavaScript loop that \
             calls surface().update() or surface().emit() to produce the component tree \
             programmatically. Schema: {{\"kind\":\"buildScript\",\"code\":\"<JS>\"}}. \
             Host API (ES5, sync only — no await): \
             console.log(...), \
             createSurface(catalogId) → string, \
             surface(id) → handle with .update(components) and .emit(messages), \
             context.data (flat dict of tool results), \
             context.toolCalls (array of {{name, args, result}}). \
             Use var, for loops, no arrow functions."
        )
    } else {
        format!(
            "Your previous response could not be parsed: {cause}. Respond again with ONLY a single valid JSON object matching the schema {{ reply, rationale, emissions }} — no markdown fences, no prose outside the JSON."
        )
    }
}

fn env_str(envelope: &Value, key: &str) -> Option<String> {
    envelope
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
}

/// Extract well-formed `discoveryChips` ({label, prompt} with non-empty strings)
/// from the envelope, dropping any malformed entries.
fn env_chips(envelope: &Value) -> Vec<Value> {
    envelope
        .get("discoveryChips")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|c| {
                    let label = c.get("label").and_then(|v| v.as_str()).filter(|s| !s.is_empty())?;
                    let prompt = c.get("prompt").and_then(|v| v.as_str()).filter(|s| !s.is_empty())?;
                    Some(json!({ "label": label, "prompt": prompt }))
                })
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) struct ProcessResult {
    pub validated: Vec<Value>,
    pub issues: Vec<String>,
    pub noops: Vec<String>,
}

/// Validate + normalize raw emissions: mint/inject surfaceIds, check the component
/// graph, detect no-ops, resolve pageOp placeholders. Port of `processEmissions`.
pub(crate) fn process_emissions(emissions: &[Value], ctx: &Value, tool_records: &[script::ToolCallRecord]) -> ProcessResult {
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
            let a2ui = json!({ "kind": "a2ui", "targetSurfaceId": target_id, "messages": processed });
            validated.push(a2ui);

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
        } else if kind == "buildScript" {
            let code = em.get("code").and_then(|c| c.as_str()).unwrap_or("");
            if code.is_empty() {
                issues.push("buildScript needs non-empty \"code\"".to_string());
                continue;
            }
            // Build context.data — last result per tool name.
            let mut tool_results: HashMap<String, Value> = HashMap::new();
            for r in tool_records {
                tool_results.insert(r.name.clone(), r.result.clone());
            }
            match script::execute(code, &tool_results, tool_records) {
                Ok(output) => {
                    // Emit the generated A2UI messages (gated normally by the client).
                    for msg in &output.messages {
                        validated.push(json!({
                            "kind": "a2ui",
                            "targetSurfaceId": msg.get("updateComponents")
                                .and_then(|uc| uc.get("surfaceId"))
                                .and_then(|s| s.as_str())
                                .or_else(|| msg.get("createSurface").and_then(|cs| cs.get("surfaceId")).and_then(|s| s.as_str()))
                                .unwrap_or(""),
                            "messages": [msg],
                        }));
                    }
                    // Emit a buildScript record for the frontend tile + LLM feedback.
                    let feedback = if output.logs.is_empty() {
                        format!("OK — {} messages, {} surfaces created",
                            output.messages.len(), output.created_surfaces.len())
                    } else {
                        format!("OK — {} messages, {} surfaces created\n  [log] {}",
                            output.messages.len(), output.created_surfaces.len(),
                            output.logs.join("\n  [log] "))
                    };
                    validated.push(json!({
                        "kind": "buildScriptResult",
                        "code": code,
                        "logs": output.logs,
                        "feedback": feedback,
                        "error": false,
                    }));
                }
                Err(e) => {
                    let feedback = format!("FAILED — {e}");
                    issues.push(format!(
                        "buildScript execution error: {e}. \
                         The script sandbox is ES5-only (no await, no java, no fetch, no require). \
                         Available APIs: surface(id).update(components), surface(id).emit(messages), \
                         createSurface(catalogId), console.log(...), context.data, context.toolCalls. \
                         Pre-fetch data via tools in the pre-step, then access it as context.data.<toolName>. \
                         If context.toolCalls is empty, the pre-step failed — use context.data instead."
                    ));
                    validated.push(json!({
                        "kind": "buildScriptResult",
                        "code": code,
                        "logs": [],
                        "feedback": feedback,
                        "error": true,
                    }));
                }
            }
        }
    }

    ProcessResult { validated, issues, noops }
}

/// Required fields per page op (beyond `name`).
fn page_op_required(name: &str) -> Option<&'static [&'static str]> {
    Some(match name {
        // createPage / deletePage are intentionally absent: page lifecycle is a
        // user-only action. They're not in the emission schema enum and are rejected
        // client-side, so they fall through to the "unknown op" branch here too.
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
            let known = "setPageProps, setPageLayout, pinSurface, unpinSurface, moveSurface, setPageRegion";
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
