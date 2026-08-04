use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

use crate::server::{
    db, db::now_ms, default_layout, models::ApiPage, routes::WsQuery, short_uuid, state::AppState,
    AppError,
};

pub async fn list(
    State(st): State<AppState>,
    Query(q): Query<WsQuery>,
) -> Result<Json<Vec<ApiPage>>, AppError> {
    let conn = st.db_lock();
    Ok(Json(db::list_pages(&conn, &q.id())?))
}

/// Create — or upsert by provided id (the user's "+ New page" uses its own slug).
pub async fn create(
    State(st): State<AppState>,
    Query(q): Query<WsQuery>,
    Json(body): Json<Value>,
) -> Result<Json<ApiPage>, AppError> {
    let conn = st.db_lock();
    let ws = q.id();
    let b = body.as_object().cloned().unwrap_or_default();
    let now = now_ms();

    let requested_id = b
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    // Page ids are global in storage, but a "well-known id" (e.g. the agent's
    // dedupe id for "the dashboard") is only meaningful within one workspace.
    // If the requested id already belongs to a *different* workspace, treating
    // it as "existing" would hijack that other workspace's page — silently
    // overwriting its title/layout and vanishing it from its own workspace.
    // Fall back to a fresh id instead, exactly as if none had been requested.
    let existing = match requested_id.as_deref().map(|id| db::get_page(&conn, id)).transpose()? {
        Some(Some(e)) if e.workspace_id == ws => Some(e),
        _ => None,
    };
    let id = match &existing {
        Some(e) => e.id.clone(),
        None => match &requested_id {
            Some(id) if db::get_page(&conn, id)?.is_none() => id.clone(),
            _ => format!("page-{}", short_uuid()),
        },
    };
    let page = ApiPage {
        id: id.clone(),
        title: b
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("New page")
            .to_string(),
        icon: b.get("icon").and_then(|v| v.as_str()).map(String::from),
        color: b.get("color").and_then(|v| v.as_str()).map(String::from),
        layout: b.get("layout").cloned().unwrap_or_else(default_layout),
        mapping: b.get("mapping").cloned().unwrap_or_else(|| json!({})),
        position: b
            .get("position")
            .and_then(|v| v.as_i64())
            .unwrap_or_else(|| db::count_pages(&conn, &ws).unwrap_or(0)),
        created_at: existing.as_ref().map(|e| e.created_at).unwrap_or(now),
        updated_at: now,
        // New page → the request's workspace; existing → keep its workspace.
        workspace_id: existing.as_ref().map(|e| e.workspace_id.clone()).unwrap_or(ws),
    };
    db::upsert_page(&conn, &page)?;
    Ok(Json(page))
}

pub async fn update(
    State(st): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Response, AppError> {
    let conn = st.db_lock();
    let cur = match db::get_page(&conn, &id)? {
        Some(p) => p,
        None => {
            return Ok((StatusCode::NOT_FOUND, Json(json!({ "error": "page not found" }))).into_response())
        }
    };
    let b = body.as_object().cloned().unwrap_or_default();

    let next = ApiPage {
        id: cur.id.clone(),
        title: b
            .get("title")
            .and_then(|v| v.as_str())
            .map(String::from)
            .unwrap_or(cur.title),
        // key-presence semantics: present-but-null clears; absent keeps current.
        icon: if b.contains_key("icon") {
            b.get("icon").and_then(|v| v.as_str()).map(String::from)
        } else {
            cur.icon
        },
        color: if b.contains_key("color") {
            b.get("color").and_then(|v| v.as_str()).map(String::from)
        } else {
            cur.color
        },
        layout: b.get("layout").cloned().unwrap_or(cur.layout),
        mapping: b.get("mapping").cloned().unwrap_or(cur.mapping),
        position: b.get("position").and_then(|v| v.as_i64()).unwrap_or(cur.position),
        created_at: cur.created_at,
        updated_at: now_ms(),
        workspace_id: cur.workspace_id,
    };
    db::upsert_page(&conn, &next)?;
    Ok(Json(next).into_response())
}

pub async fn remove(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let conn = st.db_lock();
    db::delete_page(&conn, &id)?;
    Ok(Json(json!({ "ok": true })))
}
