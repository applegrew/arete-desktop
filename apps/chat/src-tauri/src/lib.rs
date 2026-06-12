mod server;

use tauri::Manager;

/// Tauri entry point. Resolves the per-OS app-data dir, opens the SQLite DB, and
/// spawns the embedded axum server on 127.0.0.1:8787 before the window loads.
/// The React frontend talks to it over HTTP at `/api` exactly as it did the Node server.
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir).ok();
            let db_path = data_dir.join("arete-chat.db");

            let state = server::state::AppState::new(&db_path).expect("failed to init database");

            // axum runs on its own tokio runtime in a background thread; loopback only.
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().expect("failed to start tokio runtime");
                rt.block_on(async move {
                    if let Err(e) = server::run("127.0.0.1:8787", state).await {
                        eprintln!("[arete-chat] server error: {e}");
                    }
                });
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
