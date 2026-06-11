//! MCP tool definitions and handlers for the Personas MCP server.

use std::path::{Component, Path, PathBuf};

use serde_json::{json, Value};

use super::db::McpDbPool;
use super::vault::{snippet_for, tfidf_scores, tokenize, walk_vault};

// ─────────────────────────────────────────────────────────────────────────────
// Drive tool helpers
//
// When the Personas runner spawns a persona-scoped Claude CLI, it exports
// `PERSONAS_DRIVE_ROOT` into the child environment. The CLI inherits that env
// when it in turn spawns this MCP server as a stdio sub-subprocess, so the
// tools below resolve the sandbox root from that single variable — no Tauri
// handle, no app-state lookup. Path-safety mirrors `commands::drive`
// (`resolve_safe`): reject absolute paths, `..` traversal, and anything that
// canonicalises outside the root.
// ─────────────────────────────────────────────────────────────────────────────

const DRIVE_MAX_READ_BYTES: u64 = 50 * 1024 * 1024;
const DRIVE_MAX_WRITE_BYTES: usize = 50 * 1024 * 1024;

fn drive_root() -> Result<PathBuf, String> {
    let raw = std::env::var_os("PERSONAS_DRIVE_ROOT")
        .map(PathBuf::from)
        .ok_or_else(|| {
            "PERSONAS_DRIVE_ROOT is not set — this MCP server was not launched inside a persona \
             execution. Drive tools are only available during a persona run."
                .to_string()
        })?;
    // Canonicalise so downstream `strip_prefix` comparisons (which get a
    // canonicalised path from `resolve_drive_path`) succeed. On Windows this
    // also resolves the `\\?\` extended-length prefix consistently.
    std::fs::canonicalize(&raw).map_err(|e| format!("PERSONAS_DRIVE_ROOT canonicalize failed: {e}"))
}

fn resolve_drive_path(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.trim_start_matches('/').trim_start_matches('\\');
    if rel.is_empty() || rel == "." {
        return Ok(root.to_path_buf());
    }
    let candidate = PathBuf::from(rel);
    if candidate.is_absolute() {
        return Err("Drive paths must be relative to the managed root".into());
    }
    for comp in candidate.components() {
        match comp {
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir => {
                return Err("Drive paths may not contain '..'".into());
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("Drive paths must be relative".into());
            }
        }
    }
    let joined = root.join(&candidate);
    // If the target exists, canonicalise to catch symlink escapes. For writes
    // (target does not exist), canonicalise the parent and re-append the
    // basename so `drive_write_text("new/file.txt", ...)` still works.
    let canonical = if joined.exists() {
        std::fs::canonicalize(&joined).map_err(|e| format!("canonicalize failed: {e}"))?
    } else {
        let parent = joined
            .parent()
            .ok_or_else(|| "Drive path has no parent directory".to_string())?;
        std::fs::create_dir_all(parent).map_err(|e| format!("create_dir_all failed: {e}"))?;
        let parent_canonical = std::fs::canonicalize(parent)
            .map_err(|e| format!("canonicalize parent failed: {e}"))?;
        let basename = joined
            .file_name()
            .ok_or_else(|| "Drive path missing basename".to_string())?;
        parent_canonical.join(basename)
    };
    let root_canonical =
        std::fs::canonicalize(root).map_err(|e| format!("canonicalize root failed: {e}"))?;
    if !canonical.starts_with(&root_canonical) {
        return Err("Resolved path escapes the drive sandbox".into());
    }
    Ok(canonical)
}

fn rel_of(root: &Path, abs: &Path) -> String {
    abs.strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| abs.to_string_lossy().to_string())
}


/// Offload a simple, self-contained subtask to the local delegate model
/// (mixed engine — docs/plans/mixed-engine-byom.md). The delegate sees only
/// the provided input: no tools, no files, no conversation context. Errors
/// surface as tool errors so the orchestrator simply does the work itself —
/// a mixed run must never fail because the local model did.
fn handle_llm_delegate(args: &Value) -> Result<String, String> {
    let task = args
        .get("task")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or("'task' is required (one-line instruction)")?;
    let input = args
        .get("input")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or("'input' is required (the self-contained content to process)")?;
    let format = args.get("format").and_then(|v| v.as_str()).unwrap_or("plain");
    let base_url = std::env::var("PERSONAS_DELEGATE_BASE_URL")
        .unwrap_or_else(|_| "http://localhost:11434".to_string());
    let model_pref =
        std::env::var("PERSONAS_DELEGATE_MODEL").unwrap_or_else(|_| "auto".to_string());

    let system = match format {
        "json" => "You are a precise text-processing assistant. Respond ONLY with valid JSON \u{2014} no prose, no code fences.",
        "markdown" => "You are a precise text-processing assistant. Respond in clean Markdown only \u{2014} no preamble.",
        _ => "You are a precise text-processing assistant. Respond with the result only \u{2014} no preamble, no commentary.",
    };

    let started = std::time::Instant::now();
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("runtime build failed: {e}"))?;
    let base = base_url.trim_end_matches('/').to_string();
    let outcome: Result<(String, String, u64, u64), String> = rt.block_on(async {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| format!("client build failed: {e}"))?;
        // "auto" keeps the setting optional: first installed model wins.
        let model = if model_pref == "auto" {
            let tags: Value = client
                .get(format!("{base}/api/tags"))
                .send()
                .await
                .map_err(|e| format!("local delegate unreachable at {base}: {e}"))?
                .json()
                .await
                .map_err(|e| format!("delegate /api/tags unreadable: {e}"))?;
            tags.get("models")
                .and_then(|m| m.as_array())
                .and_then(|a| a.first())
                .and_then(|m| m.get("name"))
                .and_then(|n| n.as_str())
                .map(String::from)
                .ok_or_else(|| {
                    "no local models installed (run `ollama pull <model>`)".to_string()
                })?
        } else {
            model_pref.clone()
        };
        let body = json!({
            "model": model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": format!("{task}\n\n---\n\n{input}") }
            ],
            "stream": false,
            "options": { "temperature": 0.2 }
        });
        let resp = client
            .post(format!("{base}/api/chat"))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("delegate request failed: {e}"))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| format!("delegate response unreadable: {e}"))?;
        if !status.is_success() {
            let excerpt: String = text.chars().take(300).collect();
            return Err(format!("delegate returned {status}: {excerpt}"));
        }
        let v: Value = serde_json::from_str(&text)
            .map_err(|_| "delegate response is not JSON".to_string())?;
        let content = v
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();
        if content.trim().is_empty() {
            return Err("delegate returned an empty response".to_string());
        }
        let prompt_tokens = v.get("prompt_eval_count").and_then(|x| x.as_u64()).unwrap_or(0);
        let eval_tokens = v.get("eval_count").and_then(|x| x.as_u64()).unwrap_or(0);
        Ok((model, content, prompt_tokens, eval_tokens))
    });
    let duration_ms = started.elapsed().as_millis() as u64;

    // Best-effort JSONL audit \u{2014} the comparison harness reads this; never fatal.
    if let Ok(audit_path) = std::env::var("PERSONAS_DELEGATE_AUDIT") {
        let line = match &outcome {
            Ok((model, _content, pt, et)) => json!({
                "ts": chrono::Utc::now().to_rfc3339(),
                "ok": true, "model": model, "task": task,
                "prompt_tokens": pt, "eval_tokens": et, "duration_ms": duration_ms,
            }),
            Err(e) => json!({
                "ts": chrono::Utc::now().to_rfc3339(),
                "ok": false, "task": task, "error": e, "duration_ms": duration_ms,
            }),
        };
        if let Some(parent) = std::path::Path::new(&audit_path).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        use std::io::Write as _;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&audit_path) {
            let _ = writeln!(f, "{line}");
        }
    }

    let (model, content, pt, et) = outcome?;
    Ok(format!(
        "{content}\n\n---\ndelegate-meta: model={model} prompt_tokens={pt} eval_tokens={et} duration_ms={duration_ms}"
    ))
}

fn handle_drive_write_text(args: &Value) -> Result<String, String> {
    let rel_path = args
        .get("rel_path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required argument: rel_path".to_string())?;
    let content = args
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required argument: content".to_string())?;
    if content.len() > DRIVE_MAX_WRITE_BYTES {
        return Err(format!(
            "Payload too large ({} bytes, cap {})",
            content.len(),
            DRIVE_MAX_WRITE_BYTES
        ));
    }
    let root = drive_root()?;
    let abs = resolve_drive_path(&root, rel_path)?;
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create_dir_all failed: {e}"))?;
    }
    std::fs::write(&abs, content).map_err(|e| format!("write failed: {e}"))?;
    let rel = rel_of(&root, &abs);
    Ok(serde_json::json!({
        "success": true,
        "path": rel,
        "bytes": content.len(),
    })
    .to_string())
}

fn handle_drive_read_text(args: &Value) -> Result<String, String> {
    let rel_path = args
        .get("rel_path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required argument: rel_path".to_string())?;
    let root = drive_root()?;
    let abs = resolve_drive_path(&root, rel_path)?;
    let meta = std::fs::metadata(&abs).map_err(|e| format!("stat failed: {e}"))?;
    if meta.len() > DRIVE_MAX_READ_BYTES {
        return Err(format!(
            "File too large to read in full ({} bytes, cap {})",
            meta.len(),
            DRIVE_MAX_READ_BYTES
        ));
    }
    let bytes = std::fs::read(&abs).map_err(|e| format!("read failed: {e}"))?;
    let text = String::from_utf8(bytes).map_err(|e| format!("File is not valid UTF-8: {e}"))?;
    Ok(text)
}

fn handle_drive_list(args: &Value) -> Result<String, String> {
    let rel_path = args.get("rel_path").and_then(|v| v.as_str()).unwrap_or("");
    let root = drive_root()?;
    let dir = resolve_drive_path(&root, rel_path)?;
    if !dir.is_dir() {
        return Err(format!("Not a directory: {rel_path}"));
    }
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| format!("read_dir failed: {e}"))? {
        let entry = entry.map_err(|e| format!("read_dir entry failed: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".DS_Store" || name == "Thumbs.db" || name == "desktop.ini" {
            continue;
        }
        let ft = entry
            .file_type()
            .map_err(|e| format!("file_type failed: {e}"))?;
        let kind = if ft.is_dir() { "folder" } else { "file" };
        let size = entry.metadata().ok().map(|m| m.len()).unwrap_or(0);
        entries.push(json!({
            "name": name,
            "path": rel_of(&root, &entry.path()),
            "kind": kind,
            "size": size,
        }));
    }
    entries.sort_by(|a, b| {
        let ka = a.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        let kb = b.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        match (ka, kb) {
            ("folder", "file") => std::cmp::Ordering::Less,
            ("file", "folder") => std::cmp::Ordering::Greater,
            _ => {
                let na = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let nb = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
                na.to_lowercase().cmp(&nb.to_lowercase())
            }
        }
    });
    serde_json::to_string_pretty(&entries).map_err(|e| format!("Serialize error: {e}"))
}

// ─────────────────────────────────────────────────────────────────────────────
// Codebase context tools — read-only access to the `dev_contexts` map produced
// by `dev_tools_scan_codebase`. Lets external assistants (and personas itself
// when running through Claude Code) query the live context map directly
// instead of parsing the .claude/codebase-context.md snapshot, which goes
// stale between scans. Read-only because the in-process MCP only carries a
// SQLite handle, not AppState — mutations stay on the Tauri command surface.
// Inspired by graphify's `serve.py` (graph.json exposed as MCP); personas's
// equivalent of graph.json is the dev_contexts table.
// ─────────────────────────────────────────────────────────────────────────────

/// Resolve a project_id, in priority order:
///   1. `PERSONAS_DEV_PROJECT_ID` env — the executing persona's pinned
///      `design_context.dev_project_id`, injected per-run by the runner into
///      the personas-mcp sidecar's env (see `cli_mcp_config::install_mcp_sidecar`).
///      AUTHORITATIVE: a persona bound to repo X must read repo X, so the pin
///      wins over any project_id/root the model happens to pass. If the pinned
///      project no longer exists we ignore it and fall through (stale-pin safety,
///      mirroring the twin connector).
///   2. explicit `project_id` arg.
///   3. explicit `project_root` arg → resolve to its id.
///   4. fallback: first project in the table (single-project installs).
fn resolve_context_project(conn: &rusqlite::Connection, args: &Value) -> Result<String, String> {
    if let Ok(pinned) = std::env::var("PERSONAS_DEV_PROJECT_ID") {
        let pinned = pinned.trim();
        if !pinned.is_empty() {
            let exists: bool = conn
                .query_row(
                    "SELECT 1 FROM dev_projects WHERE id = ?1",
                    rusqlite::params![pinned],
                    |_| Ok(true),
                )
                .unwrap_or(false);
            if exists {
                return Ok(pinned.to_string());
            }
            // stale pin (deleted project) → fall through to the normal resolution
        }
    }
    if let Some(pid) = args.get("project_id").and_then(|v| v.as_str()) {
        return Ok(pid.to_string());
    }
    if let Some(root) = args.get("project_root").and_then(|v| v.as_str()) {
        return conn
            .query_row(
                "SELECT id FROM dev_projects WHERE root_path = ?1",
                rusqlite::params![root],
                |row| row.get::<_, String>(0),
            )
            .map_err(|e| format!("No project with root_path={root}: {e}"));
    }
    conn.query_row(
        "SELECT id FROM dev_projects ORDER BY created_at LIMIT 1",
        [],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| format!("No projects registered: {e}"))
}

fn handle_context_list_groups(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let conn = pool.get()?;
    let project_id = resolve_context_project(&conn, args)?;
    let mut stmt = conn
        .prepare(
            "SELECT g.id, g.project_id, p.name, g.name, g.color, g.group_type, g.position,
                    (SELECT COUNT(*) FROM dev_contexts c WHERE c.group_id = g.id) AS context_count
             FROM dev_context_groups g
             JOIN dev_projects p ON p.id = g.project_id
             WHERE g.project_id = ?1
             ORDER BY g.position ASC, g.name ASC",
        )
        .map_err(|e| format!("Query error: {e}"))?;
    let rows = stmt
        .query_map(rusqlite::params![project_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "project_id": row.get::<_, String>(1)?,
                "project_name": row.get::<_, String>(2)?,
                "name": row.get::<_, String>(3)?,
                "color": row.get::<_, String>(4)?,
                "group_type": row.get::<_, Option<String>>(5)?,
                "position": row.get::<_, i64>(6)?,
                "context_count": row.get::<_, i64>(7)?,
            }))
        })
        .map_err(|e| format!("Query error: {e}"))?;
    let groups: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    serde_json::to_string_pretty(&groups).map_err(|e| format!("Serialize error: {e}"))
}

fn handle_context_search_by_keyword(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let query = args
        .get("query")
        .and_then(|v| v.as_str())
        .ok_or("query is required")?;
    if query.trim().is_empty() {
        return Err("query must not be empty".into());
    }
    let limit = args
        .get("limit")
        .and_then(|v| v.as_i64())
        .unwrap_or(20)
        .clamp(1, 100);

    let conn = pool.get()?;
    let project_id = resolve_context_project(&conn, args)?;

    // Match against name, description, and the JSON-stringified keywords column.
    // LIKE on the JSON blob is fine for this scale (dozens of contexts per
    // project) — no FTS table needed, and the JSON contains tokens verbatim.
    let pattern = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.name, c.description, c.file_paths, c.keywords,
                    c.entry_points, c.api_surface, c.cross_refs, c.tech_stack,
                    g.name AS group_name, g.color AS group_color
             FROM dev_contexts c
             LEFT JOIN dev_context_groups g ON g.id = c.group_id
             WHERE c.project_id = ?1
               AND (c.name LIKE ?2 ESCAPE '\\'
                    OR c.description LIKE ?2 ESCAPE '\\'
                    OR c.keywords LIKE ?2 ESCAPE '\\')
             ORDER BY c.name ASC
             LIMIT ?3",
        )
        .map_err(|e| format!("Query error: {e}"))?;
    let rows = stmt
        .query_map(rusqlite::params![project_id, pattern, limit], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "description": row.get::<_, Option<String>>(2)?,
                "file_paths": row.get::<_, Option<String>>(3)?,
                "keywords": row.get::<_, Option<String>>(4)?,
                "entry_points": row.get::<_, Option<String>>(5)?,
                "api_surface": row.get::<_, Option<String>>(6)?,
                "cross_refs": row.get::<_, Option<String>>(7)?,
                "tech_stack": row.get::<_, Option<String>>(8)?,
                "group_name": row.get::<_, Option<String>>(9)?,
                "group_color": row.get::<_, Option<String>>(10)?,
            }))
        })
        .map_err(|e| format!("Query error: {e}"))?;
    let matches: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    serde_json::to_string_pretty(&matches).map_err(|e| format!("Serialize error: {e}"))
}

fn handle_context_get_by_file_path(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let file_path = args
        .get("file_path")
        .and_then(|v| v.as_str())
        .ok_or("file_path is required")?;
    if file_path.trim().is_empty() {
        return Err("file_path must not be empty".into());
    }
    let conn = pool.get()?;
    let project_id = resolve_context_project(&conn, args)?;

    // Match the JSON array element exactly: the column stores e.g.
    // `["src/foo.ts","src/bar.ts"]`, so a quoted-string LIKE is anchored by
    // the surrounding double-quotes. Avoids matching "src/foo.ts.bak".
    let needle = format!(
        "%\"{}\"%",
        file_path
            .replace('\\', "/")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.name, c.description, c.file_paths, c.keywords,
                    g.name AS group_name, g.color AS group_color
             FROM dev_contexts c
             LEFT JOIN dev_context_groups g ON g.id = c.group_id
             WHERE c.project_id = ?1 AND c.file_paths LIKE ?2 ESCAPE '\\'
             ORDER BY c.name ASC",
        )
        .map_err(|e| format!("Query error: {e}"))?;
    let rows = stmt
        .query_map(rusqlite::params![project_id, needle], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "description": row.get::<_, Option<String>>(2)?,
                "file_paths": row.get::<_, Option<String>>(3)?,
                "keywords": row.get::<_, Option<String>>(4)?,
                "group_name": row.get::<_, Option<String>>(5)?,
                "group_color": row.get::<_, Option<String>>(6)?,
            }))
        })
        .map_err(|e| format!("Query error: {e}"))?;
    let matches: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    serde_json::to_string_pretty(&matches).map_err(|e| format!("Serialize error: {e}"))
}

fn handle_context_neighbors(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let context_name = args.get("context_name").and_then(|v| v.as_str());
    let context_id = args.get("context_id").and_then(|v| v.as_str());
    if context_name.is_none() && context_id.is_none() {
        return Err("Either context_name or context_id is required".into());
    }

    let conn = pool.get()?;
    let project_id = resolve_context_project(&conn, args)?;

    // 1. Resolve the source context.
    let (src_id, src_name, cross_refs_json): (String, String, Option<String>) =
        if let Some(id) = context_id {
            conn.query_row(
                "SELECT id, name, cross_refs FROM dev_contexts WHERE id = ?1 AND project_id = ?2",
                rusqlite::params![id, project_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .map_err(|e| format!("Context {id} not found: {e}"))?
        } else {
            let n = context_name.unwrap();
            conn.query_row(
                "SELECT id, name, cross_refs FROM dev_contexts WHERE name = ?1 AND project_id = ?2",
                rusqlite::params![n, project_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .map_err(|e| format!("Context name='{n}' not found: {e}"))?
        };

    // 2. Parse cross_refs (JSON array of context names).
    let neighbor_names: Vec<String> = cross_refs_json
        .as_deref()
        .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
        .unwrap_or_default();

    // 3. Hydrate each neighbor name into a context summary. Names that don't
    // match a real context (LLM hallucinations are common in the cross_refs
    // field) are flagged with `resolved: false` so the caller can see them.
    let mut neighbors: Vec<Value> = Vec::with_capacity(neighbor_names.len());
    for name in &neighbor_names {
        match conn.query_row(
            "SELECT c.id, c.name, c.description, c.file_paths, g.name AS group_name, g.color
             FROM dev_contexts c
             LEFT JOIN dev_context_groups g ON g.id = c.group_id
             WHERE c.name = ?1 AND c.project_id = ?2",
            rusqlite::params![name, project_id],
            |row| {
                Ok(json!({
                    "resolved": true,
                    "id": row.get::<_, String>(0)?,
                    "name": row.get::<_, String>(1)?,
                    "description": row.get::<_, Option<String>>(2)?,
                    "file_paths": row.get::<_, Option<String>>(3)?,
                    "group_name": row.get::<_, Option<String>>(4)?,
                    "group_color": row.get::<_, Option<String>>(5)?,
                }))
            },
        ) {
            Ok(v) => neighbors.push(v),
            Err(_) => neighbors.push(json!({
                "resolved": false,
                "name": name,
                "note": "cross_ref points at a context that does not exist (likely LLM hallucination)",
            })),
        }
    }

    Ok(serde_json::to_string_pretty(&json!({
        "self": { "id": src_id, "name": src_name },
        "neighbors": neighbors,
    }))
    .map_err(|e| format!("Serialize error: {e}"))?)
}

/// Return the list of available MCP tools with their schemas.
pub fn list_tools() -> Vec<Value> {
    let mut tools = vec![
        json!({
            "name": "personas_list",
            "description": "List all personas (AI agents) in the system. Returns name, description, status, trust level, and configuration.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "enabled_only": { "type": "boolean", "description": "Only return enabled personas (default: false)" },
                    "group_id": { "type": "string", "description": "Filter by group/folder ID" }
                }
            }
        }),
        json!({
            "name": "personas_get",
            "description": "Get detailed information about a specific persona including its structured prompt, tools, triggers, and trust metadata.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "persona_id": { "type": "string", "description": "The persona UUID" }
                },
                "required": ["persona_id"]
            }
        }),
        json!({
            "name": "personas_execute",
            "description": "Trigger an execution of a persona with the given input data. Returns an execution ID for status polling.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "persona_id": { "type": "string", "description": "The persona UUID to execute" },
                    "input": { "type": "object", "description": "Input data to pass to the persona" }
                },
                "required": ["persona_id"]
            }
        }),
        json!({
            "name": "personas_status",
            "description": "Get the status of an execution (queued, running, completed, failed, cancelled).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "execution_id": { "type": "string", "description": "The execution UUID" }
                },
                "required": ["execution_id"]
            }
        }),
        json!({
            "name": "personas_result",
            "description": "Get the result of a completed execution including output, cost, duration, and tool usage.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "execution_id": { "type": "string", "description": "The execution UUID" }
                },
                "required": ["execution_id"]
            }
        }),
        json!({
            "name": "personas_knowledge_search",
            "description": "Search the knowledge base for learned patterns, annotations, and insights across all personas.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "scope_type": { "type": "string", "enum": ["persona", "tool", "connector", "global"], "description": "Scope to search" },
                    "scope_id": { "type": "string", "description": "Specific tool/connector name to search within" },
                    "limit": { "type": "number", "description": "Max results (default: 20)" }
                }
            }
        }),
        json!({
            "name": "personas_annotate",
            "description": "Add a knowledge annotation that will be shared across personas. Useful for recording API quirks, tool tips, or operational insights.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "scope": { "type": "string", "description": "Scope format: 'tool:name', 'connector:type', 'global', or 'persona'" },
                    "note": { "type": "string", "description": "The annotation text" },
                    "persona_id": { "type": "string", "description": "Attribution persona ID (uses first available if omitted)" }
                },
                "required": ["scope", "note"]
            }
        }),
        json!({
            "name": "personas_health",
            "description": "Get system health status: active personas count, recent executions, knowledge entries, and scheduler state.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
        json!({
            "name": "personas_search_executions",
            "description": "Search past persona executions by FTS5 full-text query against input/output/error_message. Returns highlighted snippets with >>>...<<< delimiters around matches, plus metadata (status, model, cost, duration). Use to recall prior runs by content (e.g. 'failed connector errors last week', 'executions that wrote to S3', 'runs mentioning rate limit').",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "FTS5 query string. Supports prefix wildcards (rate*), phrase queries (\"rate limit\"), AND/OR/NOT operators, and column filters (output_data:error)." },
                    "persona_id": { "type": "string", "description": "Optional — restrict to one persona's executions" },
                    "status": { "type": "string", "enum": ["queued", "running", "completed", "failed", "cancelled"], "description": "Optional — filter by execution status" },
                    "since": { "type": "string", "description": "Optional ISO-8601 timestamp — only executions created at-or-after this time" },
                    "limit": { "type": "number", "description": "Max results (default 20, max 100)" }
                },
                "required": ["query"]
            }
        }),
        json!({
            "name": "personas_list_templates",
            "description": "Browse the template catalog with quality scores and adoption metrics.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "category": { "type": "string", "description": "Filter by template category" },
                    "limit": { "type": "number", "description": "Max results (default: 20)" }
                }
            }
        }),
        json!({
            "name": "arena_list_models",
            "description": "List the model contenders that can be passed to an arena run (Anthropic + local Ollama). Headless callers should consult this rather than hardcoding model ids.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "arena_list_runs",
            "description": "List arena runs for a persona, newest first. Returns the run rows used by the desktop chronicle (status, models_tested, scenarios_count, created_at).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "persona_id": { "type": "string", "description": "The persona UUID" },
                    "limit": { "type": "number", "description": "Max results (default: 10)" }
                },
                "required": ["persona_id"]
            }
        }),
        json!({
            "name": "arena_run_status",
            "description": "Progress snapshot for an arena run — run row plus per-status result counts. Use to poll until status is 'completed', 'failed', or 'cancelled'.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "run_id": { "type": "string", "description": "Arena run UUID" }
                },
                "required": ["run_id"]
            }
        }),
        json!({
            "name": "arena_get_results",
            "description": "Fetch every per-scenario, per-model result row for an arena run (scores, tokens, cost, duration, rationale).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "run_id": { "type": "string", "description": "Arena run UUID" }
                },
                "required": ["run_id"]
            }
        }),
        json!({
            "name": "drive_write_text",
            "description": "Write a UTF-8 text file into the persona's local drive (paths relative to the managed root). The drive location is resolved from PERSONAS_DRIVE_ROOT. Creates parent directories as needed. Returns the written path.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "rel_path": { "type": "string", "description": "Path relative to the drive root (no '..' traversal; no absolute paths)" },
                    "content": { "type": "string", "description": "UTF-8 text content to write" }
                },
                "required": ["rel_path", "content"]
            }
        }),
        json!({
            "name": "drive_read_text",
            "description": "Read a UTF-8 text file from the persona's local drive. Paths relative to the managed root. Fails if the file is not valid UTF-8 or exceeds the 50MB cap.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "rel_path": { "type": "string", "description": "Path relative to the drive root" }
                },
                "required": ["rel_path"]
            }
        }),
        json!({
            "name": "drive_list",
            "description": "List entries (files and folders) under a relative path in the persona's local drive. Returns JSON array of {name, path, kind, size} objects sorted folders-first.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "rel_path": { "type": "string", "description": "Folder path relative to drive root (empty string for root)" }
                }
            }
        }),
        json!({
            "name": "context_list_groups",
            "description": "List the codebase context groups for a registered dev project (output of dev_tools_scan_codebase). Use this before context_search_by_keyword to orient on the project's domain decomposition.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_id": { "type": "string", "description": "Optional dev project UUID. If omitted, project_root is used; if both are omitted, the first registered project is used." },
                    "project_root": { "type": "string", "description": "Optional absolute path to the project root (must match dev_projects.root_path)." }
                }
            }
        }),
        json!({
            "name": "context_search_by_keyword",
            "description": "Search the codebase context map by keyword across name, description, and keywords fields. Returns matching contexts with file_paths, entry_points, and group info. Prefer this over grep for architecture questions.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search term (matched as substring against name, description, and keywords)" },
                    "project_id": { "type": "string", "description": "Optional dev project UUID." },
                    "project_root": { "type": "string", "description": "Optional absolute path to the project root." },
                    "limit": { "type": "integer", "description": "Max contexts to return (1-100, default 20)" }
                },
                "required": ["query"]
            }
        }),
        json!({
            "name": "context_get_by_file_path",
            "description": "Find which context(s) own a given file path. Useful for orienting before editing — answers 'what feature does this file belong to?'. Returns an empty array if no context claims the file.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "file_path": { "type": "string", "description": "Project-relative file path (forward slashes, e.g. 'src/features/agents/sub_chat/ChatTab.tsx')" },
                    "project_id": { "type": "string", "description": "Optional dev project UUID." },
                    "project_root": { "type": "string", "description": "Optional absolute path to the project root." }
                },
                "required": ["file_path"]
            }
        }),
        json!({
            "name": "context_neighbors",
            "description": "Resolve a context's cross_refs into full context summaries. Cross_refs is an LLM-inferred list of related context names; this tool hydrates them and flags unresolvable entries as likely hallucinations. Pass either context_id or context_name.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "context_id": { "type": "string", "description": "Optional context UUID — preferred if known." },
                    "context_name": { "type": "string", "description": "Context name (kebab-case, e.g. 'agent-chat-interface'). Used when context_id is omitted." },
                    "project_id": { "type": "string", "description": "Optional dev project UUID (used when resolving by context_name)." },
                    "project_root": { "type": "string", "description": "Optional absolute path to the project root." }
                }
            }
        }),
        json!({
            "name": "gmail_list_messages",
            "description": "List recent Gmail messages from the user's connected Gmail account (via the vault credential — no interactive auth needed). Returns the Gmail API JSON ({messages:[{id,threadId}], resultSizeEstimate}). Use gmail_get_message to read a specific message. Requires a Gmail connector in the vault.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Optional Gmail search query (same syntax as the Gmail search box, e.g. 'newer_than:7d from:noreply')." },
                    "max_results": { "type": "integer", "description": "Max messages to return (1-100, default 10)." },
                    "credential_id": { "type": "string", "description": "Optional specific Gmail credential UUID. If omitted, the first Gmail credential in the vault is used." }
                }
            }
        }),
        json!({
            "name": "gmail_get_message",
            "description": "Fetch a single Gmail message by id (full payload incl. headers + body) from the user's connected Gmail account via the vault credential. Requires a Gmail connector in the vault.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "message_id": { "type": "string", "description": "The Gmail message id (from gmail_list_messages)." },
                    "format": { "type": "string", "description": "Gmail format: 'full' (default), 'metadata', 'minimal', or 'raw'." },
                    "credential_id": { "type": "string", "description": "Optional specific Gmail credential UUID." }
                },
                "required": ["message_id"]
            }
        }),
        json!({
            "name": "gdrive_list_files",
            "description": "List files in the user's connected Google Drive (via the vault credential — no interactive auth). Returns Drive API JSON ({files:[{id,name,mimeType,modifiedTime,size,webViewLink}], nextPageToken}). Requires a Google Drive connector in the vault.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Optional Drive query (Drive 'q' syntax, e.g. \"name contains 'invoice' and mimeType='application/pdf'\")." },
                    "page_size": { "type": "integer", "description": "Max files to return (1-1000, default 20)." },
                    "credential_id": { "type": "string", "description": "Optional specific Google Drive credential UUID." }
                }
            }
        }),
        json!({
            "name": "gdrive_get_file",
            "description": "Get a Google Drive file's metadata, or its raw content with download:true (via the vault credential). Requires a Google Drive connector in the vault.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "file_id": { "type": "string", "description": "The Drive file id (from gdrive_list_files)." },
                    "download": { "type": "boolean", "description": "If true, return raw file content (alt=media) instead of metadata." },
                    "credential_id": { "type": "string", "description": "Optional specific Google Drive credential UUID." }
                },
                "required": ["file_id"]
            }
        }),
        json!({
            "name": "gcalendar_list_events",
            "description": "List upcoming events from the user's connected Google Calendar (via the vault credential — no interactive auth). Defaults to events from now, ordered by start time. Returns Calendar API JSON ({items:[{id,summary,start,end,...}]}). Requires a Google Calendar connector in the vault.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "calendar_id": { "type": "string", "description": "Calendar id (default 'primary')." },
                    "max_results": { "type": "integer", "description": "Max events (1-250, default 10)." },
                    "time_min": { "type": "string", "description": "RFC3339 lower bound (default: now)." },
                    "time_max": { "type": "string", "description": "Optional RFC3339 upper bound." },
                    "credential_id": { "type": "string", "description": "Optional specific Google Calendar credential UUID." }
                }
            }
        }),
        json!({
            "name": "obsidian_vault_search",
            "description": "Search the user's Obsidian vault for notes relevant to a query (TF-IDF over titles + bodies). Use to pull specific cases, prior analysis, or background from the user's own notes. Requires the Athena Brain vault-access toggle (Obsidian Brain → Setup) with a configured vault.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search query" },
                    "limit": { "type": "number", "description": "Max results (default 10, max 50)" }
                },
                "required": ["query"]
            }
        }),
        json!({
            "name": "obsidian_vault_write_note",
            "description": "Write a durable analysis or finding as a markdown note into the user's Obsidian vault (Athena folder). Use sparingly, for results worth keeping. Requires the Athena Brain vault-access toggle with a configured vault.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "Note title (becomes the filename)" },
                    "content": { "type": "string", "description": "Markdown body" }
                },
                "required": ["title", "content"]
            }
        }),
    ];

    // Mixed engine (docs/plans/mixed-engine-byom.md): the delegate tool is
    // advertised only when the runner armed it via env — non-mixed runs never
    // see it, so the orchestrator is never tempted off-doctrine.
    if std::env::var("PERSONAS_DELEGATE_BASE_URL").is_ok()
        || std::env::var("PERSONAS_DELEGATE_MODEL").is_ok()
    {
        tools.push(json!({
            "name": "llm_delegate",
            "description": "Offload a SIMPLE, self-contained subtask to a fast LOCAL model (summarize, extract fields, classify, reformat, draft boilerplate text). The local model sees ONLY what you pass in `input` \u{2014} no conversation context, no tools, no files. Do NOT use for reasoning, planning, code edits, or anything requiring judgment or context you cannot paste into `input`. If this tool errors, do the subtask yourself.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task": { "type": "string", "description": "One-line instruction, e.g. 'Summarize into 5 bullets' or 'Extract all error codes as a JSON array'" },
                    "input": { "type": "string", "description": "The full, self-contained content to process" },
                    "format": { "type": "string", "enum": ["plain", "json", "markdown"], "description": "Expected output shape (default plain)" }
                },
                "required": ["task", "input"]
            }
        }));
    }
    tools
}

/// Execute an MCP tool call and return the result.
pub fn call_tool(name: &str, args: &Value, pool: &McpDbPool) -> Value {
    let result = match name {
        "personas_list" => handle_personas_list(args, pool),
        "personas_get" => handle_personas_get(args, pool),
        "personas_execute" => handle_personas_execute(args, pool),
        "personas_status" => handle_personas_status(args, pool),
        "personas_result" => handle_personas_result(args, pool),
        "personas_knowledge_search" => handle_knowledge_search(args, pool),
        "personas_annotate" => handle_annotate(args, pool),
        "personas_health" => handle_health(args, pool),
        "personas_search_executions" => handle_search_executions(args, pool),
        "personas_list_templates" => handle_list_templates(args, pool),
        "arena_list_models" => handle_arena_list_models(args),
        "arena_list_runs" => handle_arena_list_runs(args, pool),
        "arena_run_status" => handle_arena_run_status(args, pool),
        "arena_get_results" => handle_arena_get_results(args, pool),
        "llm_delegate" => handle_llm_delegate(args),
        "drive_write_text" => handle_drive_write_text(args),
        "drive_read_text" => handle_drive_read_text(args),
        "drive_list" => handle_drive_list(args),
        "context_list_groups" => handle_context_list_groups(args, pool),
        "context_search_by_keyword" => handle_context_search_by_keyword(args, pool),
        "context_get_by_file_path" => handle_context_get_by_file_path(args, pool),
        "context_neighbors" => handle_context_neighbors(args, pool),
        "gmail_list_messages" => handle_gmail_list_messages(args, pool),
        "gmail_get_message" => handle_gmail_get_message(args, pool),
        "gdrive_list_files" => handle_gdrive_list_files(args, pool),
        "gdrive_get_file" => handle_gdrive_get_file(args, pool),
        "gcalendar_list_events" => handle_gcalendar_list_events(args, pool),
        "obsidian_vault_search" => handle_obsidian_vault_search(args, pool),
        "obsidian_vault_write_note" => handle_obsidian_vault_write_note(args, pool),
        _ => Err(format!("Unknown tool: {name}")),
    };

    match result {
        Ok(content) => json!({
            "content": [{ "type": "text", "text": content }],
            "isError": false
        }),
        Err(err) => json!({
            "content": [{ "type": "text", "text": err }],
            "isError": true
        }),
    }
}

// ── Obsidian vault tools (Athena vault access) ──────────────────────────────
// Surface the user's Obsidian vault as a read/write tool for the AI, gated on
// the Athena Brain vault-access toggle + a configured vault. The sidecar can't
// use the app's pool, so it reads config from app_settings via raw SQL and
// reuses the pure path-based graph helpers + the filesystem directly.

const VAULT_DISABLED: &str =
    "Obsidian vault access is not enabled. Turn on Athena Brain in Obsidian Brain → Setup (with a configured vault).";

/// Resolve (vault_path, athena_folder) when Athena vault access is enabled,
/// else None so the tool reports it's disabled.
fn obsidian_athena_target(conn: &rusqlite::Connection) -> Option<(String, String)> {
    let read_json = |key: &str| -> Option<Value> {
        conn.query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            [key],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
    };
    let mirror = read_json("obsidian_mirror_config")?;
    if !mirror.get("athena").and_then(|v| v.as_bool()).unwrap_or(false) {
        return None;
    }
    let cfg = read_json("obsidian_brain_config")?;
    let vault_path = cfg.get("vaultPath").and_then(|v| v.as_str()).unwrap_or("");
    if vault_path.is_empty() {
        return None;
    }
    let folder = cfg
        .get("folderMapping")
        .and_then(|m| m.get("athenaFolder"))
        .and_then(|v| v.as_str())
        .unwrap_or("Athena");
    Some((vault_path.to_string(), folder.to_string()))
}

fn handle_obsidian_vault_search(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let target = {
        let conn = pool.get()?;
        obsidian_athena_target(&conn)
    };
    let (vault_path, _) = target.ok_or_else(|| VAULT_DISABLED.to_string())?;
    let query = args
        .get("query")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if query.is_empty() {
        return Err("query is required".into());
    }
    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10).min(50) as usize;
    let query_lc = query.to_lowercase();
    let terms = tokenize(&query_lc);
    if terms.is_empty() {
        return Ok("[]".into());
    }
    let notes = walk_vault(Path::new(&vault_path));
    let scores = tfidf_scores(&notes, &terms);
    let mut scored: Vec<(f32, Value)> = notes
        .iter()
        .enumerate()
        .filter_map(|(i, n)| {
            let s = scores[i];
            if s <= 0.0 {
                return None;
            }
            Some((
                s,
                json!({
                    "path": n.path.to_string_lossy(),
                    "title": n.title,
                    "snippet": snippet_for(&n.body, &query_lc),
                    "score": (s * 100.0).round() / 100.0,
                }),
            ))
        })
        .collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit);
    let hits: Vec<Value> = scored.into_iter().map(|(_, v)| v).collect();
    serde_json::to_string(&hits).map_err(|e| e.to_string())
}

fn handle_obsidian_vault_write_note(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let target = {
        let conn = pool.get()?;
        obsidian_athena_target(&conn)
    };
    let (vault_path, athena_folder) = target.ok_or_else(|| VAULT_DISABLED.to_string())?;
    let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("").trim();
    let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
    if title.is_empty() || content.is_empty() {
        return Err("title and content are required".into());
    }
    let slug = slugify(title);
    if slug.is_empty() {
        return Err("title produced an empty filename".into());
    }
    let rel = format!("{athena_folder}/{slug}.md");
    let full = Path::new(&vault_path).join(&rel);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create dir: {e}"))?;
    }
    let body = format!(
        "---\ntype: athena_note\ntitle: \"{}\"\n---\n\n{}\n",
        title.replace('"', "'"),
        content,
    );
    std::fs::write(&full, body).map_err(|e| format!("write {}: {e}", full.display()))?;
    Ok(format!("Wrote note to {rel}"))
}

/// Lowercase, hyphenate non-alphanumerics, collapse repeats. Filesystem-safe.
fn slugify(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_dash = false;
    for c in s.chars() {
        if c.is_alphanumeric() {
            out.extend(c.to_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

// ── Vault connector bridge (Gmail) ──────────────────────────────────────────
// The sidecar cannot decrypt vault credentials (the AES master key is tied to the
// desktop app's keychain session). So Google connector tools resolve nothing
// locally — they look up the credential id (a non-secret read) and POST to the
// desktop app's credential proxy (`/api/proxy/{id}` on :9420), which resolves the
// OAuth token + forwards to the Google API. The bridge URL + system API key are
// injected via env by cli_mcp_config when the run is spawned.

/// Resolve which vault credential to use for a Google service: an explicit
/// `credential_id` arg, else the first credential of that service_type. Reading
/// the id needs no decryption (the desktop proxy does the decrypt + token work).
fn vault_credential_id(
    args: &Value,
    pool: &McpDbPool,
    service_type: &str,
    label: &str,
) -> Result<String, String> {
    if let Some(id) = args.get("credential_id").and_then(|v| v.as_str()) {
        return Ok(id.to_string());
    }
    let conn = pool.get()?;
    conn.query_row(
        "SELECT id FROM persona_credentials WHERE service_type = ?1 LIMIT 1",
        [service_type],
        |r| r.get::<_, String>(0),
    )
    .map_err(|_| {
        format!("No {label} credential found in the vault. Connect {label} in Settings → Connectors.")
    })
}

/// Forward an HTTP request through the desktop app's credential proxy, which
/// resolves the credential's auth (OAuth refresh included) and calls the API.
fn bridge_proxy(credential_id: &str, method: &str, path: &str) -> Result<String, String> {
    let bridge =
        std::env::var("PERSONAS_BRIDGE_URL").unwrap_or_else(|_| "http://127.0.0.1:9420".to_string());
    let api_key = std::env::var("PERSONAS_API_KEY").map_err(|_| {
        "Connector bridge unavailable for this run (PERSONAS_API_KEY not set).".to_string()
    })?;
    let url = format!("{}/api/proxy/{}", bridge.trim_end_matches('/'), credential_id);
    let payload = json!({ "method": method, "path": path, "headers": {}, "body": null });
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("runtime build failed: {e}"))?;
    rt.block_on(async move {
        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .bearer_auth(&api_key)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("bridge request failed: {e}"))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| format!("bridge read failed: {e}"))?;
        if !status.is_success() {
            return Err(format!("bridge returned {status}: {text}"));
        }
        Ok(text)
    })
}

fn handle_gmail_list_messages(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let cred = vault_credential_id(args, pool, "gmail", "Gmail")?;
    let max = args
        .get("max_results")
        .and_then(|v| v.as_u64())
        .unwrap_or(10)
        .clamp(1, 100);
    let mut u = reqwest::Url::parse("https://gmail.googleapis.com/gmail/v1/users/me/messages")
        .map_err(|e| format!("url build failed: {e}"))?;
    u.query_pairs_mut()
        .append_pair("maxResults", &max.to_string());
    if let Some(q) = args
        .get("query")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        u.query_pairs_mut().append_pair("q", q);
    }
    let path = match u.query() {
        Some(q) => format!("{}?{}", u.path(), q),
        None => u.path().to_string(),
    };
    bridge_proxy(&cred, "GET", &path)
}

fn handle_gmail_get_message(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let cred = vault_credential_id(args, pool, "gmail", "Gmail")?;
    let msg_id = args
        .get("message_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "message_id is required".to_string())?;
    let format = args
        .get("format")
        .and_then(|v| v.as_str())
        .unwrap_or("full");
    let mut u = reqwest::Url::parse(&format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}"
    ))
    .map_err(|e| format!("url build failed: {e}"))?;
    u.query_pairs_mut().append_pair("format", format);
    let path = format!("{}?{}", u.path(), u.query().unwrap_or(""));
    bridge_proxy(&cred, "GET", &path)
}

// ── Google Drive (base https://www.googleapis.com/drive/v3) ──
fn handle_gdrive_list_files(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let cred = vault_credential_id(args, pool, "google_drive", "Google Drive")?;
    let max = args
        .get("page_size")
        .and_then(|v| v.as_u64())
        .unwrap_or(20)
        .clamp(1, 1000);
    // base already includes /drive/v3, so the path is relative to that.
    let mut path = format!("files?pageSize={max}&fields=files(id,name,mimeType,modifiedTime,size,webViewLink),nextPageToken");
    if let Some(q) = args
        .get("query")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        // q is a Drive query string (e.g. "name contains 'invoice'"); percent-encode it.
        let enc: String = reqwest::Url::parse("https://x/")
            .map(|mut u| {
                u.query_pairs_mut().append_pair("q", q);
                u.query().unwrap_or("").to_string()
            })
            .unwrap_or_default();
        path = format!("{path}&{enc}");
    }
    bridge_proxy(&cred, "GET", &path)
}

fn handle_gdrive_get_file(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let cred = vault_credential_id(args, pool, "google_drive", "Google Drive")?;
    let file_id = args
        .get("file_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "file_id is required".to_string())?;
    // alt=media downloads content; default returns file metadata.
    let path = if args.get("download").and_then(|v| v.as_bool()).unwrap_or(false) {
        format!("files/{file_id}?alt=media")
    } else {
        format!("files/{file_id}?fields=id,name,mimeType,modifiedTime,size,webViewLink")
    };
    bridge_proxy(&cred, "GET", &path)
}

// ── Google Calendar (base https://www.googleapis.com/calendar/v3) ──
fn handle_gcalendar_list_events(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let cred = vault_credential_id(args, pool, "google_calendar", "Google Calendar")?;
    let cal = args
        .get("calendar_id")
        .and_then(|v| v.as_str())
        .unwrap_or("primary");
    let max = args
        .get("max_results")
        .and_then(|v| v.as_u64())
        .unwrap_or(10)
        .clamp(1, 250);
    // base already includes /calendar/v3 — build only the query here, then
    // prepend the relative path (avoid double-prefixing the version segment).
    let time_min = args
        .get("time_min")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    let mut u = reqwest::Url::parse("https://x/").map_err(|e| format!("url build failed: {e}"))?;
    {
        let mut qp = u.query_pairs_mut();
        qp.append_pair("maxResults", &max.to_string());
        qp.append_pair("singleEvents", "true");
        qp.append_pair("orderBy", "startTime");
        qp.append_pair("timeMin", &time_min);
        if let Some(tmax) = args.get("time_max").and_then(|v| v.as_str()) {
            qp.append_pair("timeMax", tmax);
        }
    }
    let path = format!("calendars/{cal}/events?{}", u.query().unwrap_or(""));
    bridge_proxy(&cred, "GET", &path)
}

fn handle_personas_list(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let conn = pool.get()?;
    let enabled_only = args
        .get("enabled_only")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let group_id = args.get("group_id").and_then(|v| v.as_str());

    let sql = if enabled_only {
        "SELECT id, name, description, enabled, trust_level, trust_origin, icon, color FROM personas WHERE enabled = 1 ORDER BY name"
    } else {
        "SELECT id, name, description, enabled, trust_level, trust_origin, icon, color FROM personas ORDER BY name"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| format!("Query error: {e}"))?;
    let rows = stmt.query_map([], |row| {
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "name": row.get::<_, String>(1)?,
            "description": row.get::<_, Option<String>>(2)?,
            "enabled": row.get::<_, i32>(3)? != 0,
            "trust_level": row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "verified".to_string()),
            "trust_origin": row.get::<_, Option<String>>(5)?.unwrap_or_else(|| "builtin".to_string()),
            "icon": row.get::<_, Option<String>>(6)?,
            "color": row.get::<_, Option<String>>(7)?,
        }))
    }).map_err(|e| format!("Query error: {e}"))?;

    let mut personas: Vec<Value> = rows.filter_map(|r| r.ok()).collect();

    if let Some(gid) = group_id {
        personas.retain(|p| p.get("group_id").and_then(|g| g.as_str()) == Some(gid));
    }

    serde_json::to_string_pretty(&personas).map_err(|e| format!("Serialize error: {e}"))
}

fn handle_personas_get(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let persona_id = args
        .get("persona_id")
        .and_then(|v| v.as_str())
        .ok_or("persona_id is required")?;
    let conn = pool.get()?;

    let persona = conn.query_row(
        "SELECT id, name, description, system_prompt, structured_prompt, enabled, trust_level, trust_origin,
                max_concurrent, timeout_ms, max_budget_usd, max_turns, icon, color
         FROM personas WHERE id = ?1",
        rusqlite::params![persona_id],
        |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "description": row.get::<_, Option<String>>(2)?,
                "system_prompt": row.get::<_, String>(3)?,
                "has_structured_prompt": row.get::<_, Option<String>>(4)?.is_some(),
                "enabled": row.get::<_, i32>(5)? != 0,
                "trust_level": row.get::<_, Option<String>>(6)?.unwrap_or_else(|| "verified".to_string()),
                "trust_origin": row.get::<_, Option<String>>(7)?.unwrap_or_else(|| "builtin".to_string()),
                "max_concurrent": row.get::<_, i32>(8)?,
                "timeout_ms": row.get::<_, i32>(9)?,
                "max_budget_usd": row.get::<_, Option<f64>>(10)?,
                "max_turns": row.get::<_, Option<i32>>(11)?,
                "icon": row.get::<_, Option<String>>(12)?,
                "color": row.get::<_, Option<String>>(13)?,
            }))
        },
    ).map_err(|e| format!("Persona not found: {e}"))?;

    // Get assigned tools
    let mut tool_stmt = conn.prepare(
        "SELECT name, description, category FROM persona_tool_definitions WHERE persona_id = ?1",
    ).map_err(|e| format!("Query error: {e}"))?;
    let tools: Vec<Value> = tool_stmt
        .query_map(rusqlite::params![persona_id], |row| {
            Ok(json!({
                "name": row.get::<_, String>(0)?,
                "description": row.get::<_, String>(1)?,
                "category": row.get::<_, String>(2)?,
            }))
        })
        .map_err(|e| format!("Query error: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    let mut result = persona;
    result["tools"] = json!(tools);

    serde_json::to_string_pretty(&result).map_err(|e| format!("Serialize error: {e}"))
}

fn handle_personas_execute(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let persona_id = args
        .get("persona_id")
        .and_then(|v| v.as_str())
        .ok_or("persona_id is required")?;
    let input = args.get("input").cloned().unwrap_or(json!({}));
    let conn = pool.get()?;

    // Verify persona exists and is enabled
    let enabled: bool = conn
        .query_row(
            "SELECT enabled FROM personas WHERE id = ?1",
            rusqlite::params![persona_id],
            |row| Ok(row.get::<_, i32>(0)? != 0),
        )
        .map_err(|e| format!("Persona not found: {e}"))?;

    if !enabled {
        return Err("Persona is disabled".to_string());
    }

    // Create a queued execution record
    let exec_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let input_json = serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_string());

    conn.execute(
        "INSERT INTO persona_executions (id, persona_id, input_data, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'queued', ?4, ?4)",
        rusqlite::params![exec_id, persona_id, input_json, now],
    ).map_err(|e| format!("Failed to queue execution: {e}"))?;

    // Publish an event so the main app's background loop picks it up
    let event_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO persona_events (id, project_id, event_type, source_type, source_id, target_persona_id, payload, status, created_at)
         VALUES (?1, 'default', 'mcp_execute', 'mcp', 'personas-mcp', ?2, ?3, 'pending', ?4)",
        rusqlite::params![event_id, persona_id, json!({"execution_id": exec_id}).to_string(), now],
    ).map_err(|e| format!("Failed to publish event: {e}"))?;

    Ok(json!({
        "execution_id": exec_id,
        "status": "queued",
        "message": "Execution queued. Use personas_status to poll for completion."
    })
    .to_string())
}

fn handle_personas_status(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let execution_id = args
        .get("execution_id")
        .and_then(|v| v.as_str())
        .ok_or("execution_id is required")?;
    let conn = pool.get()?;

    let result = conn
        .query_row(
            "SELECT id, persona_id, status, duration_ms, cost_usd, created_at, updated_at
         FROM persona_executions WHERE id = ?1",
            rusqlite::params![execution_id],
            |row| {
                Ok(json!({
                    "execution_id": row.get::<_, String>(0)?,
                    "persona_id": row.get::<_, String>(1)?,
                    "status": row.get::<_, String>(2)?,
                    "duration_ms": row.get::<_, Option<i64>>(3)?,
                    "cost_usd": row.get::<_, Option<f64>>(4)?,
                    "created_at": row.get::<_, String>(5)?,
                    "updated_at": row.get::<_, String>(6)?,
                }))
            },
        )
        .map_err(|e| format!("Execution not found: {e}"))?;

    serde_json::to_string_pretty(&result).map_err(|e| format!("Serialize error: {e}"))
}

fn handle_personas_result(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let execution_id = args
        .get("execution_id")
        .and_then(|v| v.as_str())
        .ok_or("execution_id is required")?;
    let conn = pool.get()?;

    let result = conn
        .query_row(
            "SELECT id, persona_id, status, output_data, duration_ms, cost_usd,
                input_tokens, output_tokens, model_used, tool_steps
         FROM persona_executions WHERE id = ?1",
            rusqlite::params![execution_id],
            |row| {
                Ok(json!({
                    "execution_id": row.get::<_, String>(0)?,
                    "persona_id": row.get::<_, String>(1)?,
                    "status": row.get::<_, String>(2)?,
                    "output": row.get::<_, Option<String>>(3)?,
                    "duration_ms": row.get::<_, Option<i64>>(4)?,
                    "cost_usd": row.get::<_, Option<f64>>(5)?,
                    "input_tokens": row.get::<_, Option<i64>>(6)?,
                    "output_tokens": row.get::<_, Option<i64>>(7)?,
                    "model_used": row.get::<_, Option<String>>(8)?,
                    "tool_steps": row.get::<_, Option<String>>(9)?,
                }))
            },
        )
        .map_err(|e| format!("Execution not found: {e}"))?;

    serde_json::to_string_pretty(&result).map_err(|e| format!("Serialize error: {e}"))
}

fn handle_knowledge_search(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let conn = pool.get()?;
    let scope_type = args.get("scope_type").and_then(|v| v.as_str());
    let scope_id = args.get("scope_id").and_then(|v| v.as_str());
    let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(20);

    let (sql, params): (&str, Vec<Box<dyn rusqlite::types::ToSql>>) = match (scope_type, scope_id) {
        (Some(st), Some(sid)) => (
            "SELECT * FROM execution_knowledge WHERE scope_type = ?1 AND scope_id = ?2 ORDER BY confidence DESC LIMIT ?3",
            vec![Box::new(st.to_string()), Box::new(sid.to_string()), Box::new(limit)],
        ),
        (Some(st), None) => (
            "SELECT * FROM execution_knowledge WHERE scope_type = ?1 ORDER BY confidence DESC LIMIT ?2",
            vec![Box::new(st.to_string()), Box::new(limit)],
        ),
        _ => (
            "SELECT * FROM execution_knowledge ORDER BY confidence DESC LIMIT ?1",
            vec![Box::new(limit)],
        ),
    };

    let mut stmt = conn.prepare(sql).map_err(|e| format!("Query error: {e}"))?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "persona_id": row.get::<_, String>(1)?,
            "knowledge_type": row.get::<_, String>(3)?,
            "pattern_key": row.get::<_, String>(4)?,
            "confidence": row.get::<_, f64>(10)?,
            "scope_type": row.get::<_, Option<String>>(14)?.unwrap_or_else(|| "persona".to_string()),
            "scope_id": row.get::<_, Option<String>>(15)?,
            "annotation_text": row.get::<_, Option<String>>(16)?,
            "is_verified": row.get::<_, Option<bool>>(18)?.unwrap_or(false),
        }))
    }).map_err(|e| format!("Query error: {e}"))?;

    let entries: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    serde_json::to_string_pretty(&entries).map_err(|e| format!("Serialize error: {e}"))
}

fn handle_annotate(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let scope = args
        .get("scope")
        .and_then(|v| v.as_str())
        .ok_or("scope is required")?;
    let note = args
        .get("note")
        .and_then(|v| v.as_str())
        .ok_or("note is required")?;

    let conn = pool.get()?;

    // Resolve persona_id -- use provided or pick first available
    let persona_id = if let Some(pid) = args.get("persona_id").and_then(|v| v.as_str()) {
        pid.to_string()
    } else {
        conn.query_row("SELECT id FROM personas LIMIT 1", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|_| "No personas available for attribution")?
    };

    // Parse scope
    let (scope_type, scope_id) = if let Some(rest) = scope.strip_prefix("tool:") {
        ("tool", Some(rest))
    } else if let Some(rest) = scope.strip_prefix("connector:") {
        ("connector", Some(rest))
    } else if scope == "global" {
        ("global", None)
    } else {
        ("persona", None)
    };

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let knowledge_type = "agent_annotation";
    let pattern_key = format!("{}:{}:mcp", scope_type, scope_id.unwrap_or("_global"));

    conn.execute(
        "INSERT INTO execution_knowledge
            (id, persona_id, knowledge_type, pattern_key, pattern_data,
             success_count, failure_count, avg_cost_usd, avg_duration_ms,
             confidence, created_at, updated_at,
             scope_type, scope_id, annotation_text, annotation_source, is_verified)
         VALUES (?1, ?2, ?3, ?4, '{}', 1, 0, 0.0, 0.0, 0.5, ?5, ?5,
                 ?6, ?7, ?8, 'mcp', 0)
         ON CONFLICT(persona_id, knowledge_type, pattern_key) DO UPDATE SET
            annotation_text = ?8, updated_at = ?5, success_count = success_count + 1",
        rusqlite::params![
            id,
            persona_id,
            knowledge_type,
            pattern_key,
            now,
            scope_type,
            scope_id,
            note
        ],
    )
    .map_err(|e| format!("Failed to store annotation: {e}"))?;

    Ok(json!({
        "status": "stored",
        "scope": scope,
        "note": note
    })
    .to_string())
}

fn handle_health(_args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let conn = pool.get()?;

    let persona_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM personas", [], |row| row.get(0))
        .unwrap_or(0);
    let enabled_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM personas WHERE enabled = 1",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let recent_executions: i64 = conn.query_row(
        "SELECT COUNT(*) FROM persona_executions WHERE created_at >= datetime('now', '-24 hours')",
        [], |row| row.get(0),
    ).unwrap_or(0);
    let knowledge_entries: i64 = conn
        .query_row("SELECT COUNT(*) FROM execution_knowledge", [], |row| {
            row.get(0)
        })
        .unwrap_or(0);

    Ok(json!({
        "status": "healthy",
        "personas": { "total": persona_count, "enabled": enabled_count },
        "executions_24h": recent_executions,
        "knowledge_entries": knowledge_entries,
    })
    .to_string())
}

fn handle_list_templates(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let conn = pool.get()?;
    let category = args.get("category").and_then(|v| v.as_str());
    let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(20);

    let sql = if category.is_some() {
        "SELECT id, test_case_name, instruction, status, structural_score, semantic_score, adoption_count, category
         FROM persona_design_reviews WHERE status = 'passed' AND category = ?1
         ORDER BY adoption_count DESC LIMIT ?2"
    } else {
        "SELECT id, test_case_name, instruction, status, structural_score, semantic_score, adoption_count, category
         FROM persona_design_reviews WHERE status = 'passed'
         ORDER BY adoption_count DESC LIMIT ?1"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| format!("Query error: {e}"))?;

    let row_mapper = |row: &rusqlite::Row| {
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "name": row.get::<_, String>(1)?,
            "instruction": row.get::<_, String>(2)?,
            "status": row.get::<_, String>(3)?,
            "structural_score": row.get::<_, Option<i32>>(4)?,
            "semantic_score": row.get::<_, Option<i32>>(5)?,
            "adoption_count": row.get::<_, i32>(6)?,
            "category": row.get::<_, Option<String>>(7)?,
        }))
    };

    let templates: Vec<Value> = if let Some(cat) = category {
        stmt.query_map(rusqlite::params![cat, limit], row_mapper)
            .map_err(|e| format!("Query error: {e}"))?
            .filter_map(|r| r.ok())
            .collect()
    } else {
        stmt.query_map(rusqlite::params![limit], row_mapper)
            .map_err(|e| format!("Query error: {e}"))?
            .filter_map(|r| r.ok())
            .collect()
    };
    serde_json::to_string_pretty(&templates).map_err(|e| format!("Serialize error: {e}"))
}

// ─────────────────────────────────────────────────────────────────────────────
// Arena tools — read-only mirror so personas in execution can introspect lab
// runs without going through HTTP. Mutation (start, cancel, delete) lives on
// the Node MCP / management API surface; the in-process MCP intentionally
// stays read-only because it only has a SQLite handle, not AppState.
// ─────────────────────────────────────────────────────────────────────────────

fn handle_arena_list_models(_args: &Value) -> Result<String, String> {
    // Mirrors `ARENA_ROSTER` in the desktop frontend (`modelCatalog.ts`).
    // Each entry is shaped to match the start_arena_test 'models' array element
    // used by the Node MCP and the Tauri lab_start_arena command.
    let catalog = json!([
        { "id": "haiku",  "provider": "anthropic", "model": "haiku",  "label": "Haiku",  "tier": "budget"   },
        { "id": "sonnet", "provider": "anthropic", "model": "sonnet", "label": "Sonnet", "tier": "balanced" },
        { "id": "opus",   "provider": "anthropic", "model": "opus",   "label": "Opus",   "tier": "quality"  },
        { "id": "ollama:gemma4",  "provider": "ollama", "model": "gemma4",  "label": "Gemma 4 (local)",  "tier": "local", "base_url": "http://localhost:11434" },
        { "id": "ollama:qwen3.5", "provider": "ollama", "model": "qwen3.5", "label": "Qwen 3.5 (local)", "tier": "local", "base_url": "http://localhost:11434" },
    ]);
    serde_json::to_string_pretty(&catalog).map_err(|e| format!("Serialize error: {e}"))
}

fn handle_arena_list_runs(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let persona_id = args
        .get("persona_id")
        .and_then(|v| v.as_str())
        .ok_or("persona_id is required")?;
    let limit = args
        .get("limit")
        .and_then(|v| v.as_i64())
        .unwrap_or(10)
        .max(1)
        .min(100);

    let conn = pool.get()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, persona_id, status, models_tested, scenarios_count, summary, error,
                    created_at, completed_at
             FROM lab_arena_runs
             WHERE persona_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2",
        )
        .map_err(|e| format!("Query error: {e}"))?;

    let rows = stmt
        .query_map(rusqlite::params![persona_id, limit], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "persona_id": row.get::<_, String>(1)?,
                "status": row.get::<_, String>(2)?,
                "models_tested": row.get::<_, String>(3)?,
                "scenarios_count": row.get::<_, i64>(4)?,
                "summary": row.get::<_, Option<String>>(5)?,
                "error": row.get::<_, Option<String>>(6)?,
                "created_at": row.get::<_, String>(7)?,
                "completed_at": row.get::<_, Option<String>>(8)?,
            }))
        })
        .map_err(|e| format!("Query error: {e}"))?;

    let runs: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    serde_json::to_string_pretty(&runs).map_err(|e| format!("Serialize error: {e}"))
}

fn handle_arena_run_status(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let run_id = args
        .get("run_id")
        .and_then(|v| v.as_str())
        .ok_or("run_id is required")?;

    let conn = pool.get()?;

    let run = conn
        .query_row(
            "SELECT id, persona_id, status, models_tested, scenarios_count, summary, error,
                    created_at, completed_at, progress_json, llm_summary
             FROM lab_arena_runs WHERE id = ?1",
            rusqlite::params![run_id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "persona_id": row.get::<_, String>(1)?,
                    "status": row.get::<_, String>(2)?,
                    "models_tested": row.get::<_, String>(3)?,
                    "scenarios_count": row.get::<_, i64>(4)?,
                    "summary": row.get::<_, Option<String>>(5)?,
                    "error": row.get::<_, Option<String>>(6)?,
                    "created_at": row.get::<_, String>(7)?,
                    "completed_at": row.get::<_, Option<String>>(8)?,
                    "progress_json": row.get::<_, Option<String>>(9)?,
                    "llm_summary": row.get::<_, Option<String>>(10)?,
                }))
            },
        )
        .map_err(|e| format!("Arena run not found: {e}"))?;

    let mut stmt = conn
        .prepare("SELECT status, COUNT(*) FROM lab_arena_results WHERE run_id = ?1 GROUP BY status")
        .map_err(|e| format!("Query error: {e}"))?;
    let counts: Vec<(String, i64)> = stmt
        .query_map(rusqlite::params![run_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| format!("Query error: {e}"))?
        .filter_map(|r| r.ok())
        .collect();
    let mut counts_map = serde_json::Map::new();
    let mut total: i64 = 0;
    let mut completed: i64 = 0;
    for (status, n) in counts {
        if status == "completed" {
            completed = n;
        }
        total += n;
        counts_map.insert(status, json!(n));
    }

    let status_str = run
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let terminal = matches!(status_str.as_str(), "completed" | "failed" | "cancelled");

    serde_json::to_string_pretty(&json!({
        "run": run,
        "result_counts": Value::Object(counts_map),
        "results_total": total,
        "results_completed": completed,
        "terminal": terminal,
    }))
    .map_err(|e| format!("Serialize error: {e}"))
}

fn handle_arena_get_results(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let run_id = args
        .get("run_id")
        .and_then(|v| v.as_str())
        .ok_or("run_id is required")?;

    let conn = pool.get()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, run_id, scenario_name, model_id, provider, status, output_preview,
                    tool_calls_expected, tool_calls_actual, tool_accuracy_score,
                    output_quality_score, protocol_compliance, input_tokens, output_tokens,
                    cost_usd, duration_ms, error_message, created_at
             FROM lab_arena_results
             WHERE run_id = ?1
             ORDER BY scenario_name, model_id",
        )
        .map_err(|e| format!("Query error: {e}"))?;

    let rows = stmt
        .query_map(rusqlite::params![run_id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "run_id": row.get::<_, String>(1)?,
                "scenario_name": row.get::<_, String>(2)?,
                "model_id": row.get::<_, String>(3)?,
                "provider": row.get::<_, String>(4)?,
                "status": row.get::<_, String>(5)?,
                "output_preview": row.get::<_, Option<String>>(6)?,
                "tool_calls_expected": row.get::<_, Option<String>>(7)?,
                "tool_calls_actual": row.get::<_, Option<String>>(8)?,
                "tool_accuracy_score": row.get::<_, Option<i64>>(9)?,
                "output_quality_score": row.get::<_, Option<i64>>(10)?,
                "protocol_compliance": row.get::<_, Option<i64>>(11)?,
                "input_tokens": row.get::<_, i64>(12)?,
                "output_tokens": row.get::<_, i64>(13)?,
                "cost_usd": row.get::<_, f64>(14)?,
                "duration_ms": row.get::<_, i64>(15)?,
                "error_message": row.get::<_, Option<String>>(16)?,
                "created_at": row.get::<_, String>(17)?,
            }))
        })
        .map_err(|e| format!("Query error: {e}"))?;

    let results: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    serde_json::to_string_pretty(&results).map_err(|e| format!("Serialize error: {e}"))
}

fn handle_search_executions(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let query = args
        .get("query")
        .and_then(|v| v.as_str())
        .ok_or("query is required")?;
    if query.trim().is_empty() {
        return Err("query must not be empty".into());
    }
    let persona_id = args.get("persona_id").and_then(|v| v.as_str());
    let status = args.get("status").and_then(|v| v.as_str());
    let since = args.get("since").and_then(|v| v.as_str());
    let limit = args
        .get("limit")
        .and_then(|v| v.as_i64())
        .unwrap_or(20)
        .clamp(1, 100);

    let mut where_clauses: Vec<String> = vec!["executions_fts MATCH ?".into()];
    let mut bound: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(query.to_string())];
    if let Some(pid) = persona_id {
        where_clauses.push("pe.persona_id = ?".into());
        bound.push(Box::new(pid.to_string()));
    }
    if let Some(st) = status {
        where_clauses.push("pe.status = ?".into());
        bound.push(Box::new(st.to_string()));
    }
    if let Some(s) = since {
        where_clauses.push("pe.created_at >= ?".into());
        bound.push(Box::new(s.to_string()));
    }
    bound.push(Box::new(limit));

    let sql = format!(
        "SELECT pe.id, pe.persona_id, pe.status, pe.model_used, pe.cost_usd, pe.duration_ms, pe.created_at, \
                snippet(executions_fts, 0, '>>>', '<<<', '…', 24) AS input_snippet, \
                snippet(executions_fts, 1, '>>>', '<<<', '…', 24) AS output_snippet, \
                snippet(executions_fts, 2, '>>>', '<<<', '…', 24) AS error_snippet \
         FROM executions_fts \
         JOIN persona_executions pe ON pe.rowid = executions_fts.rowid \
         WHERE {} \
         ORDER BY pe.created_at DESC \
         LIMIT ?",
        where_clauses.join(" AND ")
    );

    let conn = pool.get()?;
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("Query error: {e}"))?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = bound.iter().map(|p| p.as_ref()).collect();
    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(json!({
                "execution_id": row.get::<_, String>(0)?,
                "persona_id": row.get::<_, String>(1)?,
                "status": row.get::<_, String>(2)?,
                "model_used": row.get::<_, Option<String>>(3)?,
                "cost_usd": row.get::<_, Option<f64>>(4)?,
                "duration_ms": row.get::<_, Option<i64>>(5)?,
                "created_at": row.get::<_, String>(6)?,
                "input_snippet": row.get::<_, Option<String>>(7)?,
                "output_snippet": row.get::<_, Option<String>>(8)?,
                "error_snippet": row.get::<_, Option<String>>(9)?,
            }))
        })
        .map_err(|e| format!("Query error: {e}"))?;

    let results: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    serde_json::to_string_pretty(&results).map_err(|e| format!("Serialize error: {e}"))
}
