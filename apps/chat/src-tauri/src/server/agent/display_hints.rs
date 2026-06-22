//! Deterministic field classifier that scans MCP tool results and produces
//! display recommendations — which fields to show in tables/forms, which are
//! images, badges, chart dimensions, and which to hide. Feeds into the agent
//! prompt so it builds richer UI without guessing.

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayHint {
    pub tool_name: String,
    pub is_list: bool,
    pub row_count: usize,
    pub columns: Vec<ColumnHint>,
    pub detail_fields: Vec<String>,
    pub image_fields: Vec<String>,
    pub badge_fields: Vec<String>,
    pub chart_dimensions: Vec<String>,
    pub hide_fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnHint {
    pub field: String,
    pub width: ColumnWidth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ColumnWidth {
    Narrow,
    Normal,
    Wide,
}

// ---- lazy-compiled regexes -----------------------------------------------

fn re_image() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)(_url$|_image$|_photo$|^avatar_|^image_|_thumbnail$|_icon$|_logo$|_src$)").unwrap())
}

fn re_badge() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(status|state|type|category|stage|phase|priority)$").unwrap())
}

fn re_metric() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(price|cost|amount|total|count|quantity|weight|size|score|rating|value|capacity)$").unwrap())
}

fn re_wide() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(description|body|content|message|comment|overview)$").unwrap())
}

fn re_detail() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(_text$|_html$|_notes$|_details$|^specification|biography|_blob$)").unwrap())
}

fn re_date() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(_at$|_date$|timestamp$|^created$|^updated$|^due$|due_by$|^start$|^end$|_time$)").unwrap())
}

fn re_contact() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(email|phone|address|url|website|link|_link)$").unwrap())
}

fn re_hide() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"^_$|^\.|^id$|_id$|_ids$|token$|_token$|hash$|_hash$|key$|_key$|^source$|^spam$|^deleted$|^is_|^has_|^can_|^should_|^was_|_flag$|escalated$|^cc_|^bcc_|^fwd_|^reply_|^to_emails$|^from_email$|custom_fields|custom_attributes|^metadata$|raw_|internal_|dependency$|_dependency$|workspace_id|department_id|group_id|email_config_id|responder_id|requested_for_id|tasks_dependency|signature$|_signature$|secret$|_secret$|key_hash"
        )
        .unwrap()
    })
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum FieldAction {
    Primary,
    Image,
    Badge,
    Metric,
    Wide,
    Detail,
    Date,
    Contact,
    Hide,
    Normal,
}

fn classify_field(field_name: &str) -> FieldAction {
    let f = field_name.to_lowercase();

    if matches!(f.as_str(), "name" | "subject" | "title" | "label" | "summary") {
        return FieldAction::Primary;
    }
    if re_image().is_match(&f) {
        return FieldAction::Image;
    }
    if re_badge().is_match(&f) {
        return FieldAction::Badge;
    }
    if re_metric().is_match(&f) {
        return FieldAction::Metric;
    }
    if re_wide().is_match(&f) {
        return FieldAction::Wide;
    }
    if re_detail().is_match(&f) {
        return FieldAction::Detail;
    }
    if re_date().is_match(&f) {
        return FieldAction::Date;
    }
    if re_contact().is_match(&f) {
        return FieldAction::Contact;
    }
    if re_hide().is_match(&f) {
        return FieldAction::Hide;
    }
    FieldAction::Normal
}

// ---- main classifier -----------------------------------------------------

/// Parse the MCP tool result text (JSON string), scan the structure, and
/// produce a DisplayHint with field-level recommendations. Returns None if the
/// result isn't parseable JSON or contains no fields to classify.
pub fn classify_tool_result(tool_name: &str, result_text: &str) -> Option<DisplayHint> {
    let root: Value = serde_json::from_str(result_text).ok()?;

    match &root {
        // Array of records: classify fields from the first element.
        Value::Array(arr) if !arr.is_empty() => {
            let first = &arr[0];
            if let Value::Object(obj) = first {
                Some(classify_from_obj(tool_name, true, arr.len(), obj))
            } else {
                None
            }
        }
        // Single object: try to find an array inside (common API wrappers like
        // { results: [...] } or { data: { tickets: [...] } }), falling back to
        // classifying the object's own keys if no array is found.
        Value::Object(obj) => {
            if obj.is_empty() {
                return None;
            }
            classify_object(tool_name, obj)
        }
        _ => None,
    }
}

/// Classify a top-level object. First try to find an array of records inside
/// (breadth-first up to depth 2), falling back to the object's own keys.
fn classify_object(tool_name: &str, obj: &serde_json::Map<String, Value>) -> Option<DisplayHint> {
    // Collect every candidate array-of-objects (depth 1 and depth 2) and pick the
    // richest one, rather than the alphabetically-first. Map iteration is sorted
    // (BTreeMap), so "first" would deterministically but wrongly prefer e.g.
    // `attachments` over `results`. Rank by row count, then field count.
    let mut candidates: Vec<(usize, usize, &serde_json::Map<String, Value>)> = Vec::new();

    // Depth 1: direct array children.
    for (_, v) in obj {
        if let Value::Array(arr) = v {
            if let Some(Value::Object(first)) = arr.first() {
                candidates.push((arr.len(), first.len(), first));
            }
        }
    }
    // Depth 2: `{ key: { key: [...] } }`.
    for (_, v) in obj {
        if let Value::Object(inner) = v {
            for (_, vv) in inner {
                if let Value::Array(arr) = vv {
                    if let Some(Value::Object(first)) = arr.first() {
                        candidates.push((arr.len(), first.len(), first));
                    }
                }
            }
        }
    }

    if let Some(&(rows, _, first)) = candidates.iter().max_by_key(|(rows, fields, _)| (*rows, *fields)) {
        return Some(classify_from_obj(tool_name, true, rows, first));
    }

    // No array found — classify the object's own keys (single-record result).
    Some(classify_from_obj(tool_name, false, 1, obj))
}

fn classify_from_obj(
    tool_name: &str,
    is_list: bool,
    row_count: usize,
    obj: &serde_json::Map<String, Value>,
) -> DisplayHint {
    let mut columns = Vec::new();
    let mut detail_fields = Vec::new();
    let mut image_fields = Vec::new();
    let mut badge_fields = Vec::new();
    let mut chart_dimensions = Vec::new();
    let mut hide_fields = Vec::new();

    // Sort keys for stable output; put primary fields first.
    let mut keys: Vec<&String> = obj.keys().collect();
    keys.sort_by(|a, b| {
        let pa = classify_field(a);
        let pb = classify_field(b);
        field_priority(pa).cmp(&field_priority(pb))
    });

    for key in keys {
        let action = classify_field(key);

        match action {
            FieldAction::Hide => hide_fields.push(key.clone()),
            FieldAction::Image => {
                image_fields.push(key.clone());
                columns.push(ColumnHint { field: key.clone(), width: ColumnWidth::Narrow });
            }
            FieldAction::Primary => {
                columns.push(ColumnHint { field: key.clone(), width: ColumnWidth::Normal });
                detail_fields.push(key.clone());
            }
            FieldAction::Badge => {
                badge_fields.push(key.clone());
                columns.push(ColumnHint { field: key.clone(), width: ColumnWidth::Narrow });
                chart_dimensions.push(key.clone());
            }
            FieldAction::Metric => {
                columns.push(ColumnHint { field: key.clone(), width: ColumnWidth::Narrow });
                chart_dimensions.push(key.clone());
                detail_fields.push(key.clone());
            }
            FieldAction::Wide => {
                columns.push(ColumnHint { field: key.clone(), width: ColumnWidth::Wide });
                detail_fields.push(key.clone());
            }
            FieldAction::Detail => {
                detail_fields.push(key.clone());
            }
            FieldAction::Date | FieldAction::Contact => {
                columns.push(ColumnHint { field: key.clone(), width: ColumnWidth::Narrow });
                detail_fields.push(key.clone());
            }
            FieldAction::Normal => {
                columns.push(ColumnHint { field: key.clone(), width: ColumnWidth::Normal });
            }
        }
    }

    DisplayHint {
        tool_name: tool_name.to_string(),
        is_list,
        row_count,
        columns,
        detail_fields,
        image_fields,
        badge_fields,
        chart_dimensions,
        hide_fields,
    }
}

fn field_priority(action: FieldAction) -> usize {
    match action {
        FieldAction::Primary => 0,
        FieldAction::Badge => 1,
        FieldAction::Normal => 2,
        FieldAction::Metric => 3,
        FieldAction::Image => 4,
        FieldAction::Date => 5,
        FieldAction::Contact => 6,
        FieldAction::Wide => 7,
        FieldAction::Detail => 8,
        FieldAction::Hide => 9,
    }
}

// ---- prompt formatting ---------------------------------------------------

/// Format a set of display hints as a compact text block for injection into
/// the agent's system prompt (or post-tool-call system message).
pub fn format_hints_prompt(hints: &HashMap<String, DisplayHint>) -> String {
    if hints.is_empty() {
        return String::new();
    }

    let mut lines: Vec<String> = Vec::new();
    lines.push(
        "Display hints for known tools — which fields to show when building DataTable, \
         Form, Card, or Chart components from tool results:\n"
            .to_string(),
    );

    // Sort by tool name so the injected block is stable across turns/runs
    // (HashMap iteration order is randomized, which would defeat prompt-prefix
    // caching and make LLM logs non-reproducible).
    let mut names: Vec<&String> = hints.keys().collect();
    names.sort();
    for name in names {
        let h = &hints[name];
        lines.push(format!("- {}:", name));

        if h.is_list {
            let col_desc: Vec<String> = h
                .columns
                .iter()
                .map(|c| {
                    let w = match c.width {
                        ColumnWidth::Narrow => "",
                        ColumnWidth::Normal => "",
                        ColumnWidth::Wide => " (wide)",
                    };
                    if h.badge_fields.contains(&c.field) {
                        format!("{}(badge){}", c.field, w)
                    } else if h.image_fields.contains(&c.field) {
                        format!("{}(image){}", c.field, w)
                    } else {
                        format!("{}{}", c.field, w)
                    }
                })
                .collect();
            lines.push(format!(
                "  list columns ({} rows, {} fields): {}",
                h.row_count,
                h.columns.len(),
                col_desc.join(", ")
            ));
        }

        if !h.detail_fields.is_empty() {
            lines.push(format!("  detail fields: {}", h.detail_fields.join(", ")));
        }

        if !h.image_fields.is_empty() && !h.is_list {
            lines.push(format!("  image: {}", h.image_fields.join(", ")));
        }

        if !h.badge_fields.is_empty() {
            lines.push(format!(
                "  badge: {} — use colored chips or short highlighted labels",
                h.badge_fields.join(", ")
            ));
        }

        if !h.chart_dimensions.is_empty() {
            lines.push(format!("  chart by: {}", h.chart_dimensions.join(", ")));
        }

        if !h.hide_fields.is_empty() {
            lines.push(format!(
                "  hide: {} — technical/internal fields, do NOT show",
                h.hide_fields.join(", ")
            ));
        }
    }

    lines.join("\n")
}

/// Format hints as a compact system message for injection AFTER tool calls in
/// the pre-step (this turn's fresh hints that the agent sees immediately).
pub fn format_hints_turn(hints: &HashMap<String, DisplayHint>) -> Option<String> {
    if hints.is_empty() {
        return None;
    }
    let mut s = format_hints_prompt(hints);
    s.insert_str(
        0,
        "[SYSTEM] Display hints for the data you JUST fetched — use these to decide which \
         fields to show in DataTable columns, Form fields, Card layouts, and Chart dimensions. \
         Prefer image/badge/wide fields; hide technical fields.\n",
    );
    Some(s)
}

// ---- persistence helpers (serialize to/from JSON Value) ------------------

/// `app_state` key under which the accumulated per-tool display hints are stored.
pub const HINTS_STATE_KEY: &str = "displayHints";

pub fn hints_to_value(hints: &HashMap<String, DisplayHint>) -> Value {
    let obj: serde_json::Map<String, Value> = hints
        .iter()
        .map(|(k, v)| (k.clone(), serde_json::to_value(v).unwrap_or_default()))
        .collect();
    Value::Object(obj)
}

pub fn hints_from_value(v: &Value) -> HashMap<String, DisplayHint> {
    let mut out = HashMap::new();
    if let Value::Object(obj) = v {
        for (k, val) in obj {
            if let Ok(hint) = serde_json::from_value::<DisplayHint>(val.clone()) {
                out.insert(k.clone(), hint);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_tickets() {
        let result = r#"[
            {"id":1,"subject":"Printer broken","status":"open","priority":2,"requester_name":"Alice","cc_emails":[],"created_at":"2024-01-01","group_id":5,"source":"web","spam":false,"escalated":false,"description":"The printer...","custom_fields":{}}
        ]"#;
        let hint = classify_tool_result("fetchTickets", result).unwrap();
        assert!(hint.is_list);
        assert_eq!(hint.row_count, 1);
        // id should be hidden
        assert!(hint.hide_fields.contains(&"id".to_string()));
        // subject is primary
        assert!(hint.columns.iter().any(|c| c.field == "subject"));
        // status is badge
        assert!(hint.badge_fields.contains(&"status".to_string()));
        // cc_emails, group_id, source, spam, escalated, custom_fields hidden
        assert!(hint.hide_fields.iter().any(|f| f == "cc_emails"));
        assert!(hint.hide_fields.iter().any(|f| f == "group_id"));
        assert!(hint.hide_fields.iter().any(|f| f == "spam"));
        assert!(hint.hide_fields.iter().any(|f| f == "escalated"));
        // description is wide
        assert!(hint.columns.iter().any(|c| c.field == "description" && matches!(c.width, ColumnWidth::Wide)));
        // priority is badge
        assert!(hint.badge_fields.contains(&"priority".to_string()));
    }

    #[test]
    fn test_classify_catalog_item() {
        let result = r#"{"name":"Widget","image_url":"https://img","description":"A widget.","price":9.99,"category":"tools","status":"active","workspace_id":1,"department_id":2,"internal_product_id":"SKU-123"}"#;
        let hint = classify_tool_result("fetchCatalogItem", result).unwrap();
        assert!(!hint.is_list);
        assert!(hint.image_fields.contains(&"image_url".to_string()));
        assert!(hint.detail_fields.contains(&"description".to_string()));
        assert!(hint.hide_fields.iter().any(|f| f == "workspace_id"));
        assert!(hint.hide_fields.iter().any(|f| f == "department_id"));
        assert!(hint.hide_fields.iter().any(|f| f == "internal_product_id"));
        assert!(hint.badge_fields.contains(&"status".to_string()));
        assert!(hint.chart_dimensions.contains(&"category".to_string()));
    }

    #[test]
    fn test_classify_wrapped_results() {
        // Common pattern: { results: [{...}, {...}] }
        let result = r#"{"results":[{"id":1,"name":"Widget","status":"active","description":"A widget","created_at":"2024-01-01","workspace_id":5}]}"#;
        let hint = classify_tool_result("fetchItems", result).unwrap();
        assert!(hint.is_list);
        assert_eq!(hint.row_count, 1);
        // should dive into results array, not classify the wrapper key "results"
        assert!(hint.columns.iter().any(|c| c.field == "name"));
        assert!(hint.badge_fields.contains(&"status".to_string()));
        assert!(hint.hide_fields.iter().any(|f| f == "id"));
        assert!(hint.hide_fields.iter().any(|f| f == "workspace_id"));
        assert!(hint.detail_fields.contains(&"description".to_string()));
    }

    #[test]
    fn test_classify_deeply_nested_results() {
        // Common pattern: { data: { tickets: [...] } }
        let result = r#"{"data":{"tickets":[{"id":1,"subject":"Bug","status":"open","priority":2}]}}"#;
        let hint = classify_tool_result("fetchTickets", result).unwrap();
        assert!(hint.is_list);
        assert_eq!(hint.row_count, 1);
        assert!(hint.columns.iter().any(|c| c.field == "subject"));
        assert!(hint.badge_fields.contains(&"status".to_string()));
        assert!(hint.badge_fields.contains(&"priority".to_string()));
        assert!(hint.hide_fields.iter().any(|f| f == "id"));
    }

    #[test]
    fn test_classify_envelope_with_extra_keys() {
        // Pattern: { success: true, count: 5, data: [...] }
        let result = r#"{"success":true,"count":5,"data":[{"id":1,"name":"Foo","price":9.99}]}"#;
        let hint = classify_tool_result("search", result).unwrap();
        assert!(hint.is_list);
        assert_eq!(hint.row_count, 1);
        assert!(hint.columns.iter().any(|c| c.field == "name"));
        assert!(hint.chart_dimensions.contains(&"price".to_string()));
    }
}
