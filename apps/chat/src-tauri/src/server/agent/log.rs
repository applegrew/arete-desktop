use serde_json::{Map, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

// Size-rotating JSON-lines logger for every LLM interaction (port of `llm-log.ts`).
// Never panics — logging must not break an agent turn.
const MAX_BYTES: u64 = 5 * 1024 * 1024; // 5 MB per file
const MAX_FILES: usize = 10;
const PREFIX: &str = "llm-";
const EXT: &str = ".log";

static LOGGER: OnceLock<Mutex<Logger>> = OnceLock::new();

struct Logger {
    dir: PathBuf,
    current: Option<PathBuf>,
    bytes: u64,
    seq: u32,
    disabled: bool,
}

/// Point the logger at a directory (call once at startup). Disabled by `ARETE_LLM_LOG=0`.
pub fn set_log_dir(dir: PathBuf) {
    let disabled = std::env::var("ARETE_LLM_LOG").ok().as_deref() == Some("0");
    let _ = LOGGER.set(Mutex::new(Logger {
        dir,
        current: None,
        bytes: 0,
        seq: 0,
        disabled,
    }));
}

/// Append one structured log entry (`ts` is added automatically). Best-effort.
pub fn log_llm(entry: Value) {
    let cell = match LOGGER.get() {
        Some(c) => c,
        None => return,
    };
    if let Ok(mut lg) = cell.lock() {
        lg.write(entry);
    }
}

impl Logger {
    fn list_logs(&self) -> Vec<String> {
        let mut v: Vec<String> = match fs::read_dir(&self.dir) {
            Ok(rd) => rd
                .flatten()
                .filter_map(|e| {
                    let n = e.file_name().to_string_lossy().to_string();
                    (n.starts_with(PREFIX) && n.ends_with(EXT)).then_some(n)
                })
                .collect(),
            Err(_) => Vec::new(),
        };
        v.sort(); // timestamped names sort chronologically
        v
    }

    fn prune(&self, keep: usize) {
        let files = self.list_logs();
        if files.len() <= keep {
            return;
        }
        for f in &files[..files.len() - keep] {
            let _ = fs::remove_file(self.dir.join(f));
        }
    }

    fn new_file_name(&mut self) -> String {
        let ts = chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S-%3f").to_string();
        self.seq = (self.seq + 1) % 1000;
        format!("{PREFIX}{ts}-{:03}{EXT}", self.seq)
    }

    fn ensure_init(&mut self) {
        if self.current.is_some() {
            return;
        }
        if fs::create_dir_all(&self.dir).is_err() {
            self.disabled = true;
            return;
        }
        // Resume the newest file if it's still under the cap; else start fresh.
        let files = self.list_logs();
        if let Some(newest) = files.last() {
            let p = self.dir.join(newest);
            if let Ok(md) = fs::metadata(&p) {
                if md.len() < MAX_BYTES {
                    self.current = Some(p);
                    self.bytes = md.len();
                }
            }
        }
        if self.current.is_none() {
            let name = self.new_file_name();
            self.current = Some(self.dir.join(name));
            self.bytes = 0;
            self.prune(MAX_FILES - 1);
        } else {
            self.prune(MAX_FILES);
        }
    }

    fn rotate(&mut self) {
        let name = self.new_file_name();
        self.current = Some(self.dir.join(name));
        self.bytes = 0;
        self.prune(MAX_FILES - 1);
    }

    fn write(&mut self, entry: Value) {
        if self.disabled {
            return;
        }
        self.ensure_init();
        if self.disabled || self.current.is_none() {
            return;
        }

        let mut obj = Map::new();
        obj.insert("ts".into(), Value::String(chrono::Utc::now().to_rfc3339()));
        if let Value::Object(m) = entry {
            for (k, v) in m {
                obj.insert(k, v);
            }
        }
        let line = format!("{}\n", Value::Object(obj));
        let bytes = line.len() as u64;
        if self.bytes > 0 && self.bytes + bytes > MAX_BYTES {
            self.rotate();
        }
        if let Some(current) = self.current.clone() {
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&current) {
                if f.write_all(line.as_bytes()).is_ok() {
                    self.bytes += bytes;
                }
            }
        }
    }
}
