use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

fn empty_array() -> Value {
    json!([])
}
fn empty_object() -> Value {
    json!({})
}

/// A workspace page (tab): an arete `<Page>` with a region layout + surface mapping.
/// `layout` and `mapping` are opaque JSON, stored as text columns.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApiPage {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub layout: Value,
    pub mapping: Value,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
    /// Owning workspace. Internal (DB) only — set from the request's `?ws=`, never
    /// part of the API JSON, so the frontend contract is unchanged.
    #[serde(skip, default)]
    pub workspace_id: String,
}

/// A rendered A2UI surface, stored globally so chat-scroll AND pinned surfaces
/// re-render on reload.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApiSurface {
    pub surface_id: String,
    #[serde(default = "empty_array")]
    pub components: Value,
    #[serde(default = "empty_object")]
    pub data_model: Value,
    #[serde(default)]
    pub updated_at: i64,
    /// Agent-authored widget action handlers: `{ [event]: { runtime, code } }`.
    #[serde(default = "empty_object")]
    pub handlers: Value,
    /// Generic per-surface state timeline: `[{ seq, ts, trigger, components, dataModel? }]`.
    #[serde(default = "empty_array")]
    pub history: Value,
}

/// A workspace = one independent chat thread with its own pages + surfaces. UI state
/// (active tab, chat dock) is stored per-workspace; settings stay global.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApiWorkspace {
    pub id: String,
    pub name: String,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_tab_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat_dock_state: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApiChatEntry {
    pub id: String,
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface_id: Option<String>,
    #[serde(default)]
    pub created_at: i64,
    // Under-review state for role == "script-diff" (handler awaiting approval).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script_event: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_code: Option<String>,
}
