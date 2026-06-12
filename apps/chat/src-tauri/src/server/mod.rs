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

/// Build the axum app mirroring the legacy Express `/api` contract. In release
/// builds it also serves the embedded SPA (same-origin), so the bundled app's
/// relative `/api` fetches work without the dev vite proxy.
pub fn build_router(state: AppState) -> Router {
    #[allow(unused_mut)]
    let mut router = Router::new()
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
        .route("/api/agui/health", get(agent::health))
        .route("/api/agui/mcp-status", get(agent::mcp_status))
        .route("/api/agui/mcp-reconnect", post(agent::mcp_reconnect));

    // Release: serve the embedded SPA for any non-/api path (SPA fallback).
    // Dev keeps vite+HMR at :5173 (no fallback mounted).
    #[cfg(not(debug_assertions))]
    {
        router = router.fallback(spa::handler);
    }

    router
        .layer(DefaultBodyLimit::max(4 * 1024 * 1024))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

/// Embedded built frontend (release only). `../dist` is produced by the
/// `beforeBuildCommand` (vite build) before the Rust release compile.
#[cfg(not(debug_assertions))]
mod spa {
    use axum::http::{header, StatusCode, Uri};
    use axum::response::{IntoResponse, Response};
    use rust_embed::RustEmbed;

    #[derive(RustEmbed)]
    #[folder = "../dist"]
    struct Assets;

    pub async fn handler(uri: Uri) -> Response {
        let path = uri.path().trim_start_matches('/');
        let path = if path.is_empty() { "index.html" } else { path };
        if let Some(content) = Assets::get(path) {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            return ([(header::CONTENT_TYPE, mime.as_ref())], content.data.into_owned()).into_response();
        }
        // Unknown path → index.html (client-side routing).
        match Assets::get("index.html") {
            Some(c) => ([(header::CONTENT_TYPE, "text/html")], c.data.into_owned()).into_response(),
            None => (StatusCode::NOT_FOUND, "not found").into_response(),
        }
    }
}

/// Bind and serve (loopback only). Signals `ready` once the listener is bound —
/// or on bind failure (another instance may already serve `addr`), so the release
/// window can still navigate to it.
pub async fn run(addr: &str, state: AppState, ready: std::sync::mpsc::Sender<()>) -> Result<()> {
    match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => {
            eprintln!("[arete-chat] axum listening on http://{addr}");
            let _ = ready.send(());
            axum::serve(listener, build_router(state)).await?;
            Ok(())
        }
        Err(e) => {
            eprintln!("[arete-chat] failed to bind {addr}: {e} (another instance already running?)");
            let _ = ready.send(());
            Err(e.into())
        }
    }
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
