use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

use crate::server::{
    db, db::now_ms, default_layout, models::ApiPage, short_uuid, state::AppState, AppError,
};

pub async fn list(State(st): State<AppState>) -> Result<Json<Vec<ApiPage>>, AppError> {
    let conn = st.db.lock().unwrap();
    Ok(Json(db::list_pages(&conn)?))
}

/// Create — or upsert by provided id (lets the agent's createPage use its own slug).
pub async fn create(
    State(st): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<ApiPage>, AppError> {
    let conn = st.db.lock().unwrap();
    let b = body.as_object().cloned().unwrap_or_default();
    let now = now_ms();

    let id = b
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("page-{}", short_uuid()));

    let existing = db::get_page(&conn, &id)?;
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
            .unwrap_or_else(|| db::count_pages(&conn).unwrap_or(0)),
        created_at: existing.as_ref().map(|e| e.created_at).unwrap_or(now),
        updated_at: now,
    };
    db::upsert_page(&conn, &page)?;
    Ok(Json(page))
}

pub async fn update(
    State(st): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Response, AppError> {
    let conn = st.db.lock().unwrap();
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
    };
    db::upsert_page(&conn, &next)?;
    Ok(Json(next).into_response())
}

pub async fn remove(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let conn = st.db.lock().unwrap();
    db::delete_page(&conn, &id)?;
    Ok(Json(json!({ "ok": true })))
}
