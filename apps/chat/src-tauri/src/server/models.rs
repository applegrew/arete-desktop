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
}
