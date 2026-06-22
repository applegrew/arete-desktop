mod server;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

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

            // Rotating LLM interaction logs live alongside the DB.
            server::agent::log::set_log_dir(data_dir.join("llm-logs"));

            let state = server::state::AppState::new(&db_path).expect("failed to init database");

            // Bind a free OS-assigned port synchronously so we know the backend origin
            // BEFORE the window loads — then inject it for the frontend. Avoids any
            // fixed-port conflict (multiple instances, a stray dev server, etc.).
            let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("failed to bind a port");
            let port = listener.local_addr().expect("failed to read bound port").port();
            let api_base = format!("http://127.0.0.1:{port}");
            eprintln!("[arete-chat] backend on {api_base}");

            std::thread::spawn(move || {
                let rt = match tokio::runtime::Runtime::new() {
                    Ok(rt) => rt,
                    Err(e) => {
                        eprintln!("[arete-chat] failed to start tokio runtime: {e}");
                        std::process::exit(1);
                    }
                };
                rt.block_on(async move {
                    if let Err(e) = server::serve(listener, state).await {
                        eprintln!("[arete-chat] server error: {e}");
                    }
                });
                // The backend is meant to run for the app's whole lifetime. If serve()
                // ever returns, the /api the window depends on is dead — exit so the
                // failure is visible (process closes) instead of a live window with a
                // silently-dead backend.
                eprintln!("[arete-chat] backend exited unexpectedly; shutting down");
                std::process::exit(1);
            });

            // Create the window, injecting the API origin before any page script runs.
            // WebviewUrl::App resolves to the vite devUrl in dev and the bundled assets
            // in release; both read window.__ARETE_API_BASE__ for absolute /api calls.
            let init_script = format!("window.__ARETE_API_BASE__ = \"{api_base}\";");
            WebviewWindowBuilder::new(app.handle(), "main", WebviewUrl::App("index.html".into()))
                .title("Arete Chat")
                .inner_size(1400.0, 900.0)
                .resizable(true)
                .initialization_script(&init_script)
                .build()
                .expect("failed to create main window");

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
