pub mod app_state;
pub mod chat;
pub mod pages;
pub mod settings;
pub mod surfaces;
pub mod workspaces;

use crate::server::db::DEFAULT_WS;

/// `?ws=<id>` query param scoping the content routes (pages/surfaces/chat) to a
/// workspace. Defaults to the default workspace, so an omitted param is back-compat.
#[derive(serde::Deserialize)]
pub struct WsQuery {
    pub ws: Option<String>,
}

impl WsQuery {
    pub fn id(&self) -> String {
        self.ws
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| DEFAULT_WS.to_string())
    }
}
