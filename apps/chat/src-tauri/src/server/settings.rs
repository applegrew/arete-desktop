use anyhow::Result;
use rusqlite::Connection;
use serde_json::{json, Map, Value};

use super::db;

/// Baseline settings. MCP servers default to empty (the boot-time mcp.json seed
/// belongs to the deferred agent port); `gateDiffs` defaults on.
pub fn default_settings() -> Value {
    let model = std::env::var("OLLAMA_MODEL").unwrap_or_else(|_| "gemma4:31b-cloud".to_string());
    let ollama_url =
        std::env::var("OLLAMA_URL").unwrap_or_else(|_| "http://localhost:11434".to_string());
    json!({
        "model": model,
        "ollamaUrl": ollama_url,
        "mcpServers": [],
        "gateDiffs": true,
        "allowedFolders": [],
    })
}

/// Stored settings merged (field-by-field, type-guarded) over defaults — always
/// returns a complete object even after partial saves.
pub fn resolve_settings(conn: &Connection) -> Result<Value> {
    let base = default_settings();
    let base_obj = base.as_object().cloned().unwrap_or_default();
    let stored = match db::get_settings(conn)? {
        Some(s) => s,
        None => return Ok(Value::Object(base_obj)),
    };

    let mut out = Map::new();
    out.insert(
        "model".into(),
        guard_string(&stored, "model", &base_obj),
    );
    out.insert(
        "ollamaUrl".into(),
        guard_string(&stored, "ollamaUrl", &base_obj),
    );
    out.insert(
        "mcpServers".into(),
        match stored.get("mcpServers") {
            Some(v @ Value::Array(_)) => v.clone(),
            _ => base_obj.get("mcpServers").cloned().unwrap_or_else(|| json!([])),
        },
    );
    out.insert(
        "gateDiffs".into(),
        match stored.get("gateDiffs") {
            Some(v @ Value::Bool(_)) => v.clone(),
            _ => base_obj.get("gateDiffs").cloned().unwrap_or(Value::Bool(true)),
        },
    );
    out.insert(
        "allowedFolders".into(),
        match stored.get("allowedFolders") {
            Some(v @ Value::Array(_)) => v.clone(),
            _ => base_obj.get("allowedFolders").cloned().unwrap_or_else(|| json!([])),
        },
    );
    Ok(Value::Object(out))
}

fn guard_string(stored: &Map<String, Value>, key: &str, base: &Map<String, Value>) -> Value {
    match stored.get(key) {
        Some(v @ Value::String(_)) => v.clone(),
        _ => base.get(key).cloned().unwrap_or(Value::Null),
    }
}
