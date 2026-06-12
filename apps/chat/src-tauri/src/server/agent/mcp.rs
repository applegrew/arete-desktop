use reqwest::header::{HeaderName, HeaderValue};
use rmcp::model::CallToolRequestParams;
use rmcp::service::RunningService;
use rmcp::transport::streamable_http_client::{
    StreamableHttpClientTransport, StreamableHttpClientTransportConfig,
};
use rmcp::{RoleClient, ServiceExt};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::server::state::AppState;

type ClientService = RunningService<RoleClient, ()>;

/// A discovered MCP tool (name → which connected server, plus schema for the prompt).
struct McpToolDef {
    name: String,
    description: String,
    input_schema: Value,
    server: usize,
}

/// A UI resource emitted by an MCP tool (MCP-UI / MCP Apps), rendered as a surface.
pub struct McpUiResource {
    pub tool: String,
    pub uri: Option<String>,
    pub mime_type: Option<String>,
    pub html: Option<String>,
    pub url: Option<String>,
}

/// Result of executing one MCP tool call.
pub struct ToolOutcome {
    pub text: String,
    pub is_error: bool,
    pub ui: Vec<McpUiResource>,
}

/// Memoized MCP state on AppState. Rebuilt when the server config key changes.
#[derive(Default)]
pub struct McpCache {
    key: String,
    initialized: bool,
    services: Vec<ClientService>,
    tools: Vec<McpToolDef>,
    statuses: Vec<Value>,
}

/// Resolve enabled MCP servers from settings → [(name, entry)].
fn resolve_servers(state: &AppState) -> Vec<(String, Value)> {
    let conn = state.db.lock().unwrap();
    let settings = super::super::settings::resolve_settings(&conn).unwrap_or_else(|_| json!({}));
    let arr = settings
        .get("mcpServers")
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default();
    let mut out = Vec::new();
    for s in arr {
        let enabled = s.get("enabled").and_then(|e| e.as_bool()).unwrap_or(false);
        let name = s.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
        let entry = s.get("entry").cloned();
        if enabled && !name.is_empty() {
            if let Some(entry) = entry {
                out.push((name, entry));
            }
        }
    }
    out
}

fn transport_label(entry: &Value) -> &'static str {
    if entry.get("url").is_some() {
        match entry.get("transport").and_then(|t| t.as_str()) {
            Some("sse") => "sse",
            _ => "streamable-http",
        }
    } else {
        "stdio"
    }
}

fn config_key(servers: &[(String, Value)]) -> String {
    let mut items: Vec<Value> = servers
        .iter()
        .map(|(n, e)| json!({ "name": n, "entry": e }))
        .collect();
    items.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
    Value::Array(items).to_string()
}

/// Connect to one server (stdio or streamable-http) and list its tools. Legacy
/// `sse` is not supported (rmcp 1.x has no standalone SSE client; use streamable-http).
async fn connect_and_list(entry: &Value) -> Result<(ClientService, Vec<Value>), String> {
    if entry.get("url").is_some() {
        let transport = entry.get("transport").and_then(|t| t.as_str()).unwrap_or("streamable-http");
        if transport == "sse" {
            return Err("legacy 'sse' MCP transport is not supported — use 'streamable-http'".into());
        }
        return connect_http(entry).await;
    }
    connect_stdio(entry).await
}

async fn connect_stdio(entry: &Value) -> Result<(ClientService, Vec<Value>), String> {
    let command = entry
        .get("command")
        .and_then(|c| c.as_str())
        .ok_or_else(|| "stdio server missing \"command\"".to_string())?;

    let mut cmd = tokio::process::Command::new(command);
    if let Some(args) = entry.get("args").and_then(|a| a.as_array()) {
        for a in args {
            if let Some(s) = a.as_str() {
                cmd.arg(s);
            }
        }
    }
    if let Some(env) = entry.get("env").and_then(|e| e.as_object()) {
        for (k, v) in env {
            if let Some(s) = v.as_str() {
                cmd.env(k, s);
            }
        }
    }

    let transport = rmcp::transport::TokioChildProcess::new(cmd).map_err(|e| format!("{e}"))?;
    let service = ().serve(transport).await.map_err(|e| format!("{e}"))?;
    list_and_pack(service).await
}

async fn connect_http(entry: &Value) -> Result<(ClientService, Vec<Value>), String> {
    let url = entry.get("url").and_then(|u| u.as_str()).ok_or("http server missing \"url\"")?;

    // `auth_header` carries Authorization (a reserved header rmcp manages itself);
    // everything else rides as custom_headers.
    let mut config = StreamableHttpClientTransportConfig::default();
    config.uri = url.into();
    let mut custom: HashMap<HeaderName, HeaderValue> = HashMap::new();
    if let Some(headers) = entry.get("headers").and_then(|h| h.as_object()) {
        for (k, v) in headers {
            let val = match v.as_str() {
                Some(s) => s,
                None => continue,
            };
            if k.eq_ignore_ascii_case("authorization") {
                // rmcp prepends "Bearer " to `auth_header`, so store the BARE token
                // — otherwise the server receives "Bearer Bearer <token>" → invalid.
                let v = val.trim();
                let token = if v.len() >= 7 && v[..7].eq_ignore_ascii_case("bearer ") {
                    v[7..].trim_start()
                } else {
                    v
                };
                config.auth_header = Some(token.to_string());
            } else if let (Ok(name), Ok(value)) =
                (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(val))
            {
                custom.insert(name, value);
            }
        }
    }
    config.custom_headers = custom;

    let transport = StreamableHttpClientTransport::from_config(config);
    let service = ().serve(transport).await.map_err(|e| format!("{e}"))?;
    list_and_pack(service).await
}

async fn list_and_pack(service: ClientService) -> Result<(ClientService, Vec<Value>), String> {
    let tools = service.list_all_tools().await.map_err(|e| format!("{e}"))?;
    let tool_values: Vec<Value> = tools.iter().filter_map(|t| serde_json::to_value(t).ok()).collect();
    Ok((service, tool_values))
}

/// Ensure tools are discovered against the current config; rebuild on change.
pub async fn ensure(state: &AppState) {
    let servers = resolve_servers(state);
    let key = config_key(&servers);

    let mut cache = state.mcp.lock().await;
    if cache.initialized && cache.key == key {
        return;
    }
    // Rebuild: dropping old services closes their connections.
    cache.services.clear();
    cache.tools.clear();
    cache.statuses.clear();

    for (name, entry) in &servers {
        let label = transport_label(entry);
        match connect_and_list(entry).await {
            Ok((service, tool_values)) => {
                let server_idx = cache.services.len();
                let mut names: Vec<String> = Vec::new();
                let mut tool_details: Vec<Value> = Vec::new();
                for tv in &tool_values {
                    let tname = tv.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                    if tname.is_empty() {
                        continue;
                    }
                    let desc = tv
                        .get("description")
                        .and_then(|d| d.as_str())
                        .unwrap_or(&tname)
                        .to_string();
                    let schema = tv.get("inputSchema").cloned().unwrap_or_else(|| json!({}));
                    names.push(tname.clone());
                    tool_details.push(json!({ "name": tname, "description": desc }));
                    cache.tools.push(McpToolDef {
                        name: tname,
                        description: desc,
                        input_schema: schema,
                        server: server_idx,
                    });
                }
                cache.services.push(service);
                cache.statuses.push(json!({
                    "name": name, "transport": label, "connected": true,
                    "toolCount": names.len(), "tools": names, "toolDetails": tool_details,
                }));
            }
            Err(e) => {
                eprintln!("[mcp] server \"{name}\" connection failed: {e}");
                cache.statuses.push(json!({
                    "name": name, "transport": label, "connected": false,
                    "toolCount": 0, "tools": [], "error": e, "errorDetail": e,
                }));
            }
        }
    }
    cache.key = key;
    cache.initialized = true;
}

/// Force a reconnect on the next `ensure` (used by /mcp-reconnect).
pub async fn reset(state: &AppState) {
    let mut cache = state.mcp.lock().await;
    cache.services.clear();
    cache.tools.clear();
    cache.statuses.clear();
    cache.initialized = false;
    cache.key = String::new();
}

/// Per-server status (ensures discovery has run first).
pub async fn status(state: &AppState) -> Vec<Value> {
    ensure(state).await;
    state.mcp.lock().await.statuses.clone()
}

/// Tool descriptors for the system prompt + Ollama tools param: [{name, description, parameters}].
pub async fn tool_infos(state: &AppState) -> Vec<Value> {
    let cache = state.mcp.lock().await;
    cache
        .tools
        .iter()
        .map(|t| json!({ "name": t.name, "description": t.description, "parameters": t.input_schema }))
        .collect()
}

/// Execute a tool by name. Mirrors `adaptTool`: join text content, treat isError as
/// failure, and extract MCP-UI resources.
pub async fn call(state: &AppState, name: &str, args: Value) -> ToolOutcome {
    let cache = state.mcp.lock().await;
    let def = match cache.tools.iter().find(|t| t.name == name) {
        Some(d) => d,
        None => {
            return ToolOutcome { text: format!("unknown tool \"{name}\""), is_error: true, ui: vec![] }
        }
    };
    let service = &cache.services[def.server];
    // CallToolRequestParams is #[non_exhaustive]; build it via serde to stay version-robust.
    let args_val = if args.is_object() { args } else { json!({}) };
    let params: CallToolRequestParams =
        match serde_json::from_value(json!({ "name": name, "arguments": args_val })) {
            Ok(p) => p,
            Err(e) => {
                return ToolOutcome { text: format!("bad tool arguments: {e}"), is_error: true, ui: vec![] }
            }
        };
    match service.call_tool(params).await {
        Ok(res) => {
            let v = serde_json::to_value(&res).unwrap_or_else(|_| json!({}));
            parse_tool_result(name, &v)
        }
        Err(e) => ToolOutcome { text: format!("{e}"), is_error: true, ui: vec![] },
    }
}

/// Parse a serialized CallToolResult (`{ content: [...], isError }`) like the Node code.
fn parse_tool_result(name: &str, v: &Value) -> ToolOutcome {
    let content = v.get("content").and_then(|c| c.as_array()).cloned().unwrap_or_default();
    let text = content
        .iter()
        .filter(|c| c.get("type").and_then(|t| t.as_str()) == Some("text"))
        .filter_map(|c| c.get("text").and_then(|t| t.as_str()))
        .collect::<Vec<_>>()
        .join("\n");
    let is_error = v.get("isError").and_then(|e| e.as_bool()).unwrap_or(false);
    let ui = extract_ui_resources(name, &content);

    if is_error {
        return ToolOutcome {
            text: if text.is_empty() { format!("MCP tool \"{name}\" failed") } else { text },
            is_error: true,
            ui,
        };
    }
    let final_text = if !text.is_empty() {
        text
    } else {
        let ui_count = content
            .iter()
            .filter(|c| {
                let ty = c.get("type").and_then(|t| t.as_str());
                ty == Some("resource") || ty == Some("resource_link")
            })
            .count();
        if ui_count > 0 {
            format!("[Tool returned {ui_count} UI resource(s), rendered in the workspace.]")
        } else {
            String::new()
        }
    };
    ToolOutcome { text: final_text, is_error: false, ui }
}

fn is_html_mime(m: Option<&str>) -> bool {
    m.map(|s| s.starts_with("text/html")).unwrap_or(false)
}

/// Pull MCP-UI resources out of a tool result's content array (port of `extractUiResources`).
fn extract_ui_resources(tool: &str, content: &[Value]) -> Vec<McpUiResource> {
    let mut out = Vec::new();
    for c in content {
        let ty = c.get("type").and_then(|t| t.as_str());
        if ty == Some("resource") {
            if let Some(r) = c.get("resource").filter(|r| r.is_object()) {
                let uri = r.get("uri").and_then(|u| u.as_str());
                let text = r.get("text").and_then(|t| t.as_str());
                let mime = r.get("mimeType").and_then(|m| m.as_str());
                let is_ui_uri = uri.map(|u| u.starts_with("ui://")).unwrap_or(false);
                if let Some(text) = text {
                    if is_html_mime(mime) || (is_ui_uri && mime.is_none()) {
                        out.push(McpUiResource {
                            tool: tool.to_string(),
                            uri: uri.map(String::from),
                            mime_type: Some(mime.unwrap_or("text/html").to_string()),
                            html: Some(text.to_string()),
                            url: None,
                        });
                    } else if mime == Some("text/uri-list") {
                        if let Some(url) = text
                            .lines()
                            .map(|s| s.trim())
                            .find(|s| !s.is_empty() && !s.starts_with('#'))
                        {
                            out.push(McpUiResource {
                                tool: tool.to_string(),
                                uri: uri.map(String::from),
                                mime_type: Some("text/uri-list".to_string()),
                                html: None,
                                url: Some(url.to_string()),
                            });
                        }
                    }
                }
            }
        } else if ty == Some("resource_link") {
            let uri = c.get("uri").and_then(|u| u.as_str());
            let mime = c.get("mimeType").and_then(|m| m.as_str());
            if let Some(uri) = uri {
                if is_html_mime(mime) {
                    out.push(McpUiResource {
                        tool: tool.to_string(),
                        uri: Some(uri.to_string()),
                        mime_type: mime.map(String::from),
                        html: None,
                        url: Some(uri.to_string()),
                    });
                }
            }
        }
    }
    out
}
