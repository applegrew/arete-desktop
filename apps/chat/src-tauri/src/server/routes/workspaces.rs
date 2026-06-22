use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

use crate::server::{db, models::ApiWorkspace, short_uuid, state::AppState, AppError};

/// GET /api/workspaces → `{ workspaces, activeWorkspaceId }`.
pub async fn list(State(st): State<AppState>) -> Result<Json<Value>, AppError> {
    let conn = st.db_lock();
    let workspaces = serde_json::to_value(db::list_workspaces(&conn)?)?;
    let active = db::get_active_workspace_id(&conn)?;
    Ok(Json(json!({
        "workspaces": workspaces,
        "activeWorkspaceId": active.map(Value::String).unwrap_or(Value::Null),
    })))
}

/// POST /api/workspaces `{ name? }` → create an EMPTY workspace (no pages/surfaces/chat).
pub async fn create(
    State(st): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<ApiWorkspace>, AppError> {
    let conn = st.db_lock();
    let name = body
        .get("name")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Workspace {}", db::count_workspaces(&conn).unwrap_or(0) + 1));
    let id = format!("ws-{}", short_uuid());
    Ok(Json(db::create_workspace(&conn, &id, &name)?))
}

/// PATCH /api/workspaces/:id `{ name?, activeTabId?, chatDockState? }`.
pub async fn update(
    State(st): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Response, AppError> {
    let conn = st.db_lock();
    let name = body.get("name").and_then(|v| v.as_str());
    let active_tab = body.get("activeTabId").and_then(|v| v.as_str());
    let dock = body.get("chatDockState").and_then(|v| v.as_str());
    match db::update_workspace(&conn, &id, name, active_tab, dock)? {
        Some(w) => Ok(Json(w).into_response()),
        None => Ok((StatusCode::NOT_FOUND, Json(json!({ "error": "workspace not found" }))).into_response()),
    }
}

/// DELETE /api/workspaces/:id → delete the workspace + its content. Refuses the last
/// one; if it was active, activates a neighbor. Returns the (possibly new) active id.
pub async fn remove(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let mut conn = st.db_lock();
    if db::count_workspaces(&conn)? <= 1 {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "cannot delete the last workspace" })),
        )
            .into_response());
    }
    let was_active = db::get_active_workspace_id(&conn)?.as_deref() == Some(id.as_str());
    db::delete_workspace(&mut conn, &id)?;
    let active = if was_active {
        let next = db::list_workspaces(&conn)?.first().map(|w| w.id.clone());
        if let Some(ref nid) = next {
            db::set_active_workspace_id(&conn, nid)?;
        }
        next
    } else {
        db::get_active_workspace_id(&conn)?
    };
    Ok(Json(json!({ "ok": true, "activeWorkspaceId": active.map(Value::String).unwrap_or(Value::Null) })).into_response())
}

/// POST /api/workspaces/:id/activate → set the global active workspace.
pub async fn activate(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let conn = st.db_lock();
    if db::get_workspace(&conn, &id)?.is_none() {
        return Ok((StatusCode::NOT_FOUND, Json(json!({ "error": "workspace not found" }))).into_response());
    }
    db::set_active_workspace_id(&conn, &id)?;
    Ok(Json(json!({ "ok": true, "activeWorkspaceId": id })).into_response())
}
