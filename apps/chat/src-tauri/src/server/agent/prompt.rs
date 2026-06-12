use serde_json::Value;

/// Port of @arete-desktop/agent's `buildSystemPrompt`. `ctx` is the AgentContext the
/// client sends (a JSON object); we render its fields into the prompt verbatim.
/// `tools` is reserved for MCP (none yet) — passed empty, so the MCP section is omitted.
pub fn build_system_prompt(ctx: &Value, tools: &[Value]) -> String {
    let tmpl = include_str!("prompt_template.txt");
    tmpl.replace("%%COMPONENT_HINTS%%", &render_component_hints(ctx.get("componentHints")))
        .replace("%%MCP_TOOLS%%", &render_mcp_tools(tools))
        .replace("%%ACTIVE_TAB%%", &str_or(ctx, "activeTabId", "(unknown)"))
        .replace("%%MOST_RECENT%%", &str_or(ctx, "mostRecentSurfaceId", "(none)"))
        .replace("%%RECENT_SURFACE_IDS%%", &join_strs(ctx.get("recentSurfaceIds"), "(none)"))
        .replace("%%CHAT_SURFACE_IDS%%", &join_strs(ctx.get("chatSurfaceIds"), "(none)"))
        .replace("%%RECENT_PINNED%%", &str_or(ctx, "recentPinnedSurfaceId", "(none)"))
        .replace("%%PAGES%%", &render_pages(ctx.get("pages")))
        .replace("%%SURFACES%%", &render_surfaces(ctx.get("surfaces")))
        .replace("%%RECENT_ACTIONS%%", &render_recent_actions(ctx.get("recentActions")))
        .replace("%%DIAGNOSTICS%%", &render_diagnostics(ctx.get("diagnostics")))
}

fn str_or(ctx: &Value, key: &str, default: &str) -> String {
    ctx.get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(default)
        .to_string()
}

fn join_strs(v: Option<&Value>, empty: &str) -> String {
    let items: Vec<String> = v
        .and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect())
        .unwrap_or_default();
    if items.is_empty() {
        empty.to_string()
    } else {
        items.join(", ")
    }
}

fn render_component_hints(hints: Option<&Value>) -> String {
    let obj = match hints.and_then(|h| h.as_object()) {
        Some(o) if !o.is_empty() => o,
        _ => return String::new(),
    };
    let lines: Vec<String> = obj
        .iter()
        .map(|(k, v)| format!("- {}: {}", k, v.as_str().unwrap_or("")))
        .collect();
    format!(
        "\nComponent rendering notes (how these components actually render — use them to avoid specs that render wrong):\n{}\n",
        lines.join("\n")
    )
}

fn render_mcp_tools(tools: &[Value]) -> String {
    if tools.is_empty() {
        return String::new();
    }
    let lines: Vec<String> = tools
        .iter()
        .map(|t| {
            let name = t.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let desc = t.get("description").and_then(|d| d.as_str()).unwrap_or(name);
            let params = t
                .get("parameters")
                .map(|p| format!("({})", p))
                .unwrap_or_default();
            format!("- {name}{params}: {desc}")
        })
        .collect();
    format!(
        "\nAvailable MCP tools (use these to fetch live data BEFORE building any chart/surface that needs real numbers — the pre-step lets you call tools before emitting UI):\n{}\n",
        lines.join("\n")
    )
}

fn render_pages(pages: Option<&Value>) -> String {
    let obj = match pages.and_then(|p| p.as_object()) {
        Some(o) if !o.is_empty() => o,
        _ => return "  (no pages)".to_string(),
    };
    obj.iter()
        .map(|(page_id, p)| {
            let layout = p.get("layout").cloned().unwrap_or(Value::Null);
            let mapping = p.get("mapping").cloned().unwrap_or(Value::Null);
            format!(
                "- {}: layout {}\n    mapping (surfaceId -> regionId): {}",
                page_id, layout, mapping
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn render_surfaces(surfaces: Option<&Value>) -> String {
    let obj = match surfaces.and_then(|s| s.as_object()) {
        Some(o) if !o.is_empty() => o,
        _ => return "(none yet)".to_string(),
    };
    let mut visible: Vec<String> = Vec::new();
    let mut chat: Vec<String> = Vec::new();
    for (sid, snap) in obj {
        let components = snap.get("components").cloned().unwrap_or(Value::Null).to_string();
        let dm = snap.get("dataModel").cloned().unwrap_or_else(|| serde_json::json!({}));
        let dm_str = dm.to_string();
        let dm_line = if dm_str != "{}" {
            format!("\n      data model: {}", dm_str)
        } else {
            String::new()
        };
        if snap.get("visibleOnActivePage").and_then(|b| b.as_bool()).unwrap_or(false) {
            let region = snap.get("region").and_then(|r| r.as_str()).unwrap_or("?");
            visible.push(format!("  region \"{}\" {}: {}{}", region, sid, components, dm_line));
        } else {
            chat.push(format!("  {}: {}{}", sid, components, dm_line));
        }
    }
    let mut out: Vec<String> = Vec::new();
    out.push("ACTIVE PAGE — what the user is currently looking at:".to_string());
    out.push(if visible.is_empty() {
        "  (no surfaces pinned on the active page)".to_string()
    } else {
        visible.join("\n")
    });
    out.push(String::new());
    out.push("CHAT SCROLL surfaces (not pinned, but recently emitted):".to_string());
    out.push(if chat.is_empty() { "  (none)".to_string() } else { chat.join("\n") });
    out.join("\n")
}

fn render_recent_actions(actions: Option<&Value>) -> String {
    let arr = match actions.and_then(|a| a.as_array()) {
        Some(a) if !a.is_empty() => a,
        _ => return "(none)".to_string(),
    };
    arr.iter()
        .map(|a| {
            let ts = a.get("timestamp").map(|v| v.to_string()).unwrap_or_default();
            let name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let sid = a.get("surfaceId").and_then(|v| v.as_str()).unwrap_or("?");
            let cid = a.get("sourceComponentId").and_then(|v| v.as_str()).unwrap_or("?");
            let context = a.get("context").cloned().unwrap_or(Value::Null);
            format!("  {}  \"{}\" on {} ({}): {}", ts, name, sid, cid, context)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn render_diagnostics(diags: Option<&Value>) -> String {
    let arr = match diags.and_then(|d| d.as_array()) {
        Some(a) if !a.is_empty() => a,
        _ => return "(none)".to_string(),
    };
    arr.iter()
        .map(|d| {
            let sev = d.get("severity").and_then(|v| v.as_str()).unwrap_or("");
            let sid = d.get("surfaceId").and_then(|v| v.as_str()).unwrap_or("?");
            let cid = d.get("componentId").and_then(|v| v.as_str()).unwrap_or("?");
            let code = d.get("code").and_then(|v| v.as_str()).unwrap_or("");
            let msg = d.get("message").and_then(|v| v.as_str()).unwrap_or("");
            format!("  [{}] {}/{} ({}): {}", sev, sid, cid, code, msg)
        })
        .collect::<Vec<_>>()
        .join("\n")
}
