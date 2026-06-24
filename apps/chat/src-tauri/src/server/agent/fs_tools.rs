//! Built-in, folder-gated filesystem tools for the agent.
//!
//! These run locally (not via MCP) inside the turn pre-step. The security model is
//! a user-managed allowlist: `settings.allowedFolders` lists absolute folder paths,
//! and every tool may only touch paths that resolve inside one of those folders or a
//! subdirectory. When the allowlist is empty the tools are not advertised at all, so
//! the model never sees them.

use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

use serde_json::{json, Value};

use super::mcp::ToolOutcome;
use crate::server::settings;
use crate::server::state::AppState;

/// Cap returned file contents so a huge file can't blow the context window.
const READ_CAP_BYTES: usize = 256 * 1024;

const TOOL_NAMES: [&str; 7] =
    ["read_file", "list_dir", "create_file", "update_file", "delete_file", "mkdir", "rmdir"];

fn is_fs_tool(name: &str) -> bool {
    TOOL_NAMES.contains(&name)
}

/// The user-authorized absolute folder paths from live settings.
pub fn allowed_folders(state: &AppState) -> Vec<String> {
    let conn = state.db_lock();
    let s = settings::resolve_settings(&conn).unwrap_or_else(|_| json!({}));
    s.get("allowedFolders")
        .and_then(|a| a.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

/// Tool descriptors advertised to the model. Flat `{name, description, parameters}`
/// shape — that's what `ollama::chat_with_tools` and `prompt::render_mcp_tools`
/// actually read. Empty when no folders are authorized.
pub fn schemas(allowed: &[String]) -> Vec<Value> {
    if allowed.is_empty() {
        return vec![];
    }
    let path_prop = json!({ "type": "string", "description": "Absolute path inside an authorized folder." });
    vec![
        json!({
            "name": "read_file",
            "description": "Read and return the UTF-8 contents of a file. Large files are truncated.",
            "parameters": { "type": "object", "properties": { "path": path_prop }, "required": ["path"] }
        }),
        json!({
            "name": "list_dir",
            "description": "List the contents of a directory (like `ls`). Returns each entry's name, type (dir/file) and size.",
            "parameters": { "type": "object", "properties": { "path": path_prop }, "required": ["path"] }
        }),
        json!({
            "name": "create_file",
            "description": "Create a new file with the given contents. Fails if the file already exists; parent directories are created as needed.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": path_prop,
                    "content": { "type": "string", "description": "Full contents of the new file." }
                },
                "required": ["path", "content"]
            }
        }),
        json!({
            "name": "update_file",
            "description": "Modify an existing file. mode \"overwrite\" replaces the whole file; mode \"append\" adds to the end. Fails if the file does not exist.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": path_prop,
                    "content": { "type": "string", "description": "Text to write (full file for overwrite, or the chunk to append)." },
                    "mode": { "type": "string", "enum": ["overwrite", "append"], "description": "Defaults to overwrite." }
                },
                "required": ["path", "content"]
            }
        }),
        json!({
            "name": "delete_file",
            "description": "Delete a single file (not a directory).",
            "parameters": { "type": "object", "properties": { "path": path_prop }, "required": ["path"] }
        }),
        json!({
            "name": "mkdir",
            "description": "Create a directory, including any missing parent directories.",
            "parameters": { "type": "object", "properties": { "path": path_prop }, "required": ["path"] }
        }),
        json!({
            "name": "rmdir",
            "description": "Remove an empty directory. Fails if the directory is not empty.",
            "parameters": { "type": "object", "properties": { "path": path_prop }, "required": ["path"] }
        }),
    ]
}

/// Execute a filesystem tool. Returns `None` when `name` is not one of ours, so the
/// caller falls through to MCP dispatch.
pub async fn dispatch(state: &AppState, name: &str, args: &Value) -> Option<ToolOutcome> {
    if !is_fs_tool(name) {
        return None;
    }
    let roots = allowed_folders(state);
    let outcome = match name {
        "read_file" => read_file(args, &roots).await,
        "list_dir" => list_dir(args, &roots).await,
        "create_file" => create_file(args, &roots).await,
        "update_file" => update_file(args, &roots).await,
        "delete_file" => delete_file(args, &roots).await,
        "mkdir" => mkdir(args, &roots).await,
        "rmdir" => rmdir(args, &roots).await,
        _ => unreachable!(),
    };
    Some(outcome)
}

// ── handlers ─────────────────────────────────────────────────────────────────

async fn read_file(args: &Value, roots: &[String]) -> ToolOutcome {
    let path = match gated_path(args, roots) {
        Ok(p) => p,
        Err(e) => return err(e),
    };
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let truncated = bytes.len() > READ_CAP_BYTES;
            let slice = if truncated { &bytes[..READ_CAP_BYTES] } else { &bytes[..] };
            let mut text = String::from_utf8_lossy(slice).into_owned();
            if truncated {
                text.push_str(&format!(
                    "\n\n[…truncated: showing first {READ_CAP_BYTES} of {} bytes]",
                    bytes.len()
                ));
            }
            ok(text)
        }
        Err(e) => err(format!("read_file failed for {}: {e}", path.display())),
    }
}

async fn list_dir(args: &Value, roots: &[String]) -> ToolOutcome {
    let path = match gated_path(args, roots) {
        Ok(p) => p,
        Err(e) => return err(e),
    };
    let mut rd = match tokio::fs::read_dir(&path).await {
        Ok(rd) => rd,
        Err(e) => return err(format!("list_dir failed for {}: {e}", path.display())),
    };
    // (is_dir, formatted line) so we can sort dirs-first like `ls`.
    let mut entries: Vec<(bool, String)> = Vec::new();
    loop {
        match rd.next_entry().await {
            Ok(Some(entry)) => {
                let name = entry.file_name().to_string_lossy().into_owned();
                let meta = entry.metadata().await.ok();
                let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
                let line = if is_dir {
                    format!("{name}/")
                } else {
                    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                    format!("{name} ({size} bytes)")
                };
                entries.push((is_dir, line));
            }
            Ok(None) => break,
            Err(e) => return err(format!("list_dir failed reading {}: {e}", path.display())),
        }
    }
    if entries.is_empty() {
        return ok(format!("{} is empty.", path.display()));
    }
    // Directories first, then case-insensitive name order.
    entries.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.to_lowercase().cmp(&b.1.to_lowercase())));
    let body: Vec<String> = entries.into_iter().map(|(_, l)| l).collect();
    ok(format!("{} ({} entries):\n{}", path.display(), body.len(), body.join("\n")))
}

async fn create_file(args: &Value, roots: &[String]) -> ToolOutcome {
    let path = match gated_path(args, roots) {
        Ok(p) => p,
        Err(e) => return err(e),
    };
    let content = args.get("content").and_then(|c| c.as_str()).unwrap_or("");
    if path.exists() {
        return err(format!("create_file: {} already exists (use update_file to modify it)", path.display()));
    }
    if let Some(parent) = path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return err(format!("create_file failed to create parent dir for {}: {e}", path.display()));
        }
    }
    match tokio::fs::write(&path, content.as_bytes()).await {
        Ok(()) => ok(format!("Created {} ({} bytes).", path.display(), content.len())),
        Err(e) => err(format!("create_file failed for {}: {e}", path.display())),
    }
}

async fn update_file(args: &Value, roots: &[String]) -> ToolOutcome {
    let path = match gated_path(args, roots) {
        Ok(p) => p,
        Err(e) => return err(e),
    };
    let content = args.get("content").and_then(|c| c.as_str()).unwrap_or("");
    let mode = args.get("mode").and_then(|m| m.as_str()).unwrap_or("overwrite");
    if !path.is_file() {
        return err(format!("update_file: {} does not exist (use create_file)", path.display()));
    }
    let result = match mode {
        "append" => {
            use tokio::io::AsyncWriteExt;
            match tokio::fs::OpenOptions::new().append(true).open(&path).await {
                Ok(mut f) => f.write_all(content.as_bytes()).await,
                Err(e) => Err(e),
            }
        }
        "overwrite" => tokio::fs::write(&path, content.as_bytes()).await,
        other => return err(format!("update_file: unknown mode \"{other}\" (use overwrite or append)")),
    };
    match result {
        Ok(()) => ok(format!("Updated {} ({mode}, {} bytes).", path.display(), content.len())),
        Err(e) => err(format!("update_file failed for {}: {e}", path.display())),
    }
}

async fn delete_file(args: &Value, roots: &[String]) -> ToolOutcome {
    let path = match gated_path(args, roots) {
        Ok(p) => p,
        Err(e) => return err(e),
    };
    if path.is_dir() {
        return err(format!("delete_file: {} is a directory (use rmdir)", path.display()));
    }
    match tokio::fs::remove_file(&path).await {
        Ok(()) => ok(format!("Deleted {}.", path.display())),
        Err(e) => err(format!("delete_file failed for {}: {e}", path.display())),
    }
}

async fn mkdir(args: &Value, roots: &[String]) -> ToolOutcome {
    let path = match gated_path(args, roots) {
        Ok(p) => p,
        Err(e) => return err(e),
    };
    match tokio::fs::create_dir_all(&path).await {
        Ok(()) => ok(format!("Created directory {}.", path.display())),
        Err(e) => err(format!("mkdir failed for {}: {e}", path.display())),
    }
}

async fn rmdir(args: &Value, roots: &[String]) -> ToolOutcome {
    let path = match gated_path(args, roots) {
        Ok(p) => p,
        Err(e) => return err(e),
    };
    match tokio::fs::remove_dir(&path).await {
        Ok(()) => ok(format!("Removed directory {}.", path.display())),
        Err(e) => err(format!("rmdir failed for {} (must be empty): {e}", path.display())),
    }
}

// ── path gating ──────────────────────────────────────────────────────────────

fn gated_path(args: &Value, roots: &[String]) -> Result<PathBuf, String> {
    let requested = args
        .get("path")
        .and_then(|p| p.as_str())
        .ok_or_else(|| "missing required \"path\" argument".to_string())?;
    resolve_in_allowed(requested, roots)
}

/// Resolve `requested` and confirm it lives inside one of `roots`. Returns the
/// symlink-resolved absolute path to use for IO, or an error string for the model.
fn resolve_in_allowed(requested: &str, roots: &[String]) -> Result<PathBuf, String> {
    if roots.is_empty() {
        return Err(
            "No folders are authorized for filesystem access. Ask the user to add a folder in Settings → File system access."
                .to_string(),
        );
    }
    let p = Path::new(requested);
    if !p.is_absolute() {
        return Err(format!("Path must be absolute: {requested}"));
    }
    let norm = normalize_lexical(p);
    // Resolve symlinks via the nearest existing ancestor — blocks `..` and symlink
    // escapes for both existing targets and not-yet-created ones.
    let resolved = resolve_existing_ancestor(&norm);

    for root in roots {
        let rp = Path::new(root);
        let canon_root = std::fs::canonicalize(rp).unwrap_or_else(|_| normalize_lexical(rp));
        if resolved.starts_with(&canon_root) {
            return Ok(resolved);
        }
    }
    Err(format!("Path is outside the authorized folders: {requested}"))
}

/// Lexically resolve `.` and `..` without touching the filesystem.
fn normalize_lexical(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in p.components() {
        match comp {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Canonicalize the longest existing prefix of `norm`, then re-append the
/// remaining (non-existent) components.
fn resolve_existing_ancestor(norm: &Path) -> PathBuf {
    let mut existing = norm.to_path_buf();
    let mut tail: Vec<OsString> = Vec::new();
    while !existing.exists() {
        match existing.file_name() {
            Some(name) => {
                tail.push(name.to_os_string());
                match existing.parent() {
                    Some(parent) => existing = parent.to_path_buf(),
                    None => break,
                }
            }
            None => break,
        }
    }
    let mut base = std::fs::canonicalize(&existing).unwrap_or(existing);
    for comp in tail.iter().rev() {
        base.push(comp);
    }
    base
}

fn ok(text: String) -> ToolOutcome {
    ToolOutcome { text, is_error: false, ui: vec![] }
}

fn err(text: String) -> ToolOutcome {
    ToolOutcome { text, is_error: true, ui: vec![] }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("arete-fs-gate-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("sub").join("f.txt"), b"hi").unwrap();
        dir
    }

    #[test]
    fn allows_paths_inside_root() {
        let root = tmp_root();
        let roots = vec![root.to_string_lossy().into_owned()];
        // existing file
        assert!(resolve_in_allowed(root.join("sub/f.txt").to_str().unwrap(), &roots).is_ok());
        // not-yet-existing file inside root
        assert!(resolve_in_allowed(root.join("sub/new.txt").to_str().unwrap(), &roots).is_ok());
    }

    #[test]
    fn rejects_dotdot_escape() {
        let root = tmp_root();
        let roots = vec![root.join("sub").to_string_lossy().into_owned()];
        // climbs out of the allowed `sub` folder back to root
        let escape = root.join("sub/../escaped.txt");
        assert!(resolve_in_allowed(escape.to_str().unwrap(), &roots).is_err());
    }

    #[test]
    fn rejects_relative_and_empty() {
        let root = tmp_root();
        let roots = vec![root.to_string_lossy().into_owned()];
        assert!(resolve_in_allowed("relative/path.txt", &roots).is_err());
        assert!(resolve_in_allowed(root.join("sub/f.txt").to_str().unwrap(), &[]).is_err());
    }

    #[test]
    fn rejects_sibling_outside_root() {
        let root = tmp_root();
        let roots = vec![root.join("sub").to_string_lossy().into_owned()];
        // a path that shares a name prefix but is a sibling, not a child
        let sibling = root.join("sub-evil/x.txt");
        assert!(resolve_in_allowed(sibling.to_str().unwrap(), &roots).is_err());
    }
}
