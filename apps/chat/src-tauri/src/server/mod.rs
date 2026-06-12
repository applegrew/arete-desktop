pub mod agent;
pub mod db;
pub mod models;
pub mod settings;
pub mod state;

mod routes;

use anyhow::Result;
use axum::{
    extract::DefaultBodyLimit,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use serde_json::{json, Value};
use tower_http::cors::CorsLayer;

use state::AppState;

/// Build the axum app mirroring the legacy Express `/api` contract. The frontend
/// (vite in dev, the bundled asset protocol in release) calls these endpoints at
/// the injected absolute origin (`window.__ARETE_API_BASE__`), so CORS is permissive.
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/api/pages", get(routes::pages::list).post(routes::pages::create))
        .route(
            "/api/pages/:id",
            axum::routing::patch(routes::pages::update).delete(routes::pages::remove),
        )
        .route("/api/surfaces", get(routes::surfaces::list).put(routes::surfaces::replace))
        .route("/api/chat", get(routes::chat::list).post(routes::chat::save))
        .route("/api/state", get(routes::app_state::get).post(routes::app_state::post))
        .route("/api/settings", get(routes::settings::get).put(routes::settings::put))
        .route("/api/health", get(health))
        // Agent loop: Ollama-backed turn streamed as AG-UI SSE, MCP tools, skills.
        .route("/api/agui", post(agent::run_turn))
        .route("/api/widget-action", post(agent::run_widget_action))
        .route("/api/agui/health", get(agent::health))
        .route("/api/agui/mcp-status", get(agent::mcp_status))
        .route("/api/agui/mcp-reconnect", post(agent::mcp_reconnect))
        .layer(DefaultBodyLimit::max(4 * 1024 * 1024))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

/// Serve on an already-bound listener (the caller binds a free port synchronously
/// so it can inject the resulting origin into the webview before it loads).
pub async fn serve(listener: std::net::TcpListener, state: AppState) -> Result<()> {
    listener.set_nonblocking(true)?;
    let listener = tokio::net::TcpListener::from_std(listener)?;
    axum::serve(listener, build_router(state)).await?;
    Ok(())
}

async fn health() -> axum::Json<Value> {
    axum::Json(json!({ "ok": true }))
}

// ---- shared helpers ------------------------------------------------------

/// Any DB/serialization failure becomes a 500. Routes return explicit statuses
/// (e.g. 404) by returning a `Response` directly.
pub struct AppError(anyhow::Error);

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (StatusCode::INTERNAL_SERVER_ERROR, self.0.to_string()).into_response()
    }
}

impl<E> From<E> for AppError
where
    E: Into<anyhow::Error>,
{
    fn from(e: E) -> Self {
        Self(e.into())
    }
}

pub fn default_layout() -> Value {
    json!({
        "kind": "grid",
        "rows": 2,
        "cols": 2,
        "regions": [
            { "id": "top-left" },
            { "id": "top-right" },
            { "id": "bottom-left" },
            { "id": "bottom-right" }
        ]
    })
}

pub fn short_uuid() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..8].to_string()
}
