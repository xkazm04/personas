//! Project Memory Ledger — graph-shaped project working memory
//! (docs/plans/skill-memory-unification.md P0).
//!
//! Dispatched Fleet sessions have no DB access, so they write append-only
//! JSONL to `<repo>/.personas/memory-outbox.jsonl`; this module is the only
//! door into `memory_nodes`/`memory_edges` and validates everything it lets
//! through (the kpi-sim result-file doctrine, generalized):
//!
//! - `dev_tools_memory_ingest`   — parse + dedupe the outbox into the ledger,
//!   delete the file on success. Wired to session-exit on the frontend and
//!   safe to call any time (missing outbox = zero-work success).
//! - `dev_tools_memory_list`     — fresh-first active nodes (optionally
//!   context-filtered) for MEMORY BLOCK composition + future UI.
//! - `dev_tools_memory_coverage` — how many of the project's dev_contexts
//!   have fresh (≤30d) memory — the coverage instrument.
//!
//! Dedupe is content-hash based: re-ingesting an identical note refreshes its
//! `updated_at` (keeps coverage honest) instead of duplicating it.
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Coverage freshness window (operator decision 2026-07-26).
const FRESH_DAYS: i64 = 30;
/// Outbox sanity caps — anything bigger is a malformed producer, not memory.
const MAX_OUTBOX_BYTES: u64 = 524_288;
const MAX_OUTBOX_LINES: usize = 200;
const MAX_TITLE_CHARS: usize = 200;
const MAX_BODY_CHARS: usize = 4_000;
const NODE_KINDS: [&str; 5] = ["fact", "progress", "decision", "gotcha", "map"];
const EDGE_RELS: [&str; 5] = ["relates", "supersedes", "blocks", "covers", "derived_from"];
/// List cap — the MEMORY BLOCK carries at most 8; UI readers stay bounded too.
const MAX_LIST: i64 = 50;

// ── outbox line shape (lenient: unknown fields ignored, bad lines counted) ──

#[derive(Debug, Deserialize)]
struct OutboxLine {
    #[serde(rename = "type")]
    line_type: String,
    // node fields
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    body: Option<String>,
    /// Context by dev_contexts NAME (what skills see in context-map.json).
    #[serde(default)]
    context: Option<String>,
    // edge fields
    #[serde(default)]
    from: Option<String>,
    #[serde(default)]
    to: Option<String>,
    #[serde(default)]
    rel: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryIngestResult {
    pub nodes_inserted: i32,
    pub nodes_refreshed: i32,
    pub edges_inserted: i32,
    pub skipped: i32,
    /// False when no outbox file existed (nothing to do).
    pub outbox_found: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryNodeRow {
    pub id: String,
    pub project_id: String,
    pub context_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub body: Option<String>,
    pub source: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCoverage {
    /// Total dev_contexts for the project.
    pub contexts: i32,
    /// Contexts with ≥1 active node fresh within the window.
    pub covered: i32,
    pub window_days: i32,
    /// Active nodes not anchored to any context (excluded from coverage math).
    pub unanchored: i32,
}

fn outbox_path(root: &str) -> PathBuf {
    PathBuf::from(root).join(".personas").join("memory-outbox.jsonl")
}

fn content_hash(kind: &str, title: &str, body: &str, context_id: &str) -> String {
    let mut h = Sha256::new();
    h.update(kind.as_bytes());
    h.update([0]);
    h.update(title.as_bytes());
    h.update([0]);
    h.update(body.as_bytes());
    h.update([0]);
    h.update(context_id.as_bytes());
    format!("{:x}", h.finalize())
}

/// Ingest the project's memory outbox. Missing file → success with
/// `outbox_found: false`. The file is deleted only after a clean pass.
#[tauri::command]
pub fn dev_tools_memory_ingest(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<MemoryIngestResult, AppError> {
    require_auth_sync(&state)?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    let path = outbox_path(&project.root_path);

    let mut out = MemoryIngestResult {
        nodes_inserted: 0,
        nodes_refreshed: 0,
        edges_inserted: 0,
        skipped: 0,
        outbox_found: false,
    };
    let Ok(meta) = std::fs::metadata(&path) else {
        return Ok(out);
    };
    out.outbox_found = true;
    if meta.len() > MAX_OUTBOX_BYTES {
        // Refuse oversized outboxes wholesale — and remove them so a runaway
        // producer can't wedge every future ingest.
        let _ = std::fs::remove_file(&path);
        return Err(AppError::Validation(format!(
            "memory outbox exceeds {MAX_OUTBOX_BYTES} bytes — discarded"
        )));
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|e| AppError::Internal(format!("read outbox failed: {e}")))?;

    let conn = state.db.get().map_err(|e| AppError::Internal(e.to_string()))?;

    // Context NAME → id map (case-insensitive) for anchoring.
    let mut ctx_by_name = std::collections::HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, name FROM dev_contexts WHERE project_id = ?1")
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let rows = stmt
            .query_map([&project_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| AppError::Internal(e.to_string()))?;
        for row in rows.flatten() {
            ctx_by_name.insert(row.1.to_lowercase(), row.0);
        }
    }

    // Outbox-local id → real node id (nodes minted this pass), so edges in the
    // same outbox can reference their own nodes.
    let mut local_ids: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    for line in text.lines().take(MAX_OUTBOX_LINES) {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<OutboxLine>(t) else {
            out.skipped += 1;
            continue;
        };
        match parsed.line_type.as_str() {
            "node" => {
                let Some(title) = parsed.title.as_deref().map(str::trim).filter(|s| !s.is_empty())
                else {
                    out.skipped += 1;
                    continue;
                };
                let title: String = title.chars().take(MAX_TITLE_CHARS).collect();
                let kind = parsed
                    .kind
                    .as_deref()
                    .filter(|k| NODE_KINDS.contains(k))
                    .unwrap_or("fact");
                let body: Option<String> = parsed
                    .body
                    .as_deref()
                    .map(|b| b.chars().take(MAX_BODY_CHARS).collect());
                let context_id = parsed
                    .context
                    .as_deref()
                    .and_then(|n| ctx_by_name.get(&n.trim().to_lowercase()))
                    .cloned();
                let hash = content_hash(
                    kind,
                    &title,
                    body.as_deref().unwrap_or(""),
                    context_id.as_deref().unwrap_or(""),
                );
                // Identical active note → freshness touch, not a duplicate.
                let existing: Option<String> = conn
                    .query_row(
                        "SELECT id FROM memory_nodes
                         WHERE project_id = ?1 AND content_hash = ?2 AND status = 'active'",
                        rusqlite::params![project_id, hash],
                        |r| r.get(0),
                    )
                    .ok();
                if let Some(existing_id) = existing {
                    conn.execute(
                        "UPDATE memory_nodes SET updated_at = datetime('now') WHERE id = ?1",
                        [&existing_id],
                    )
                    .map_err(|e| AppError::Internal(e.to_string()))?;
                    if let Some(local) = parsed.id {
                        local_ids.insert(local, existing_id);
                    }
                    out.nodes_refreshed += 1;
                    continue;
                }
                let node_id = uuid::Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO memory_nodes (id, project_id, context_id, kind, title, body, source, content_hash)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    rusqlite::params![
                        node_id,
                        project_id,
                        context_id,
                        kind,
                        title,
                        body,
                        "skill:outbox",
                        hash
                    ],
                )
                .map_err(|e| AppError::Internal(e.to_string()))?;
                if let Some(local) = parsed.id {
                    local_ids.insert(local, node_id);
                }
                out.nodes_inserted += 1;
            }
            "edge" => {
                let (Some(from), Some(to)) = (parsed.from.as_deref(), parsed.to.as_deref()) else {
                    out.skipped += 1;
                    continue;
                };
                let rel = parsed
                    .rel
                    .as_deref()
                    .filter(|r| EDGE_RELS.contains(r))
                    .unwrap_or("relates");
                // Resolve outbox-local ids first, then accept real node ids —
                // both endpoints must exist in THIS project's ledger.
                let resolve = |raw: &str| -> Option<String> {
                    let id = local_ids.get(raw).cloned().unwrap_or_else(|| raw.to_string());
                    conn.query_row(
                        "SELECT id FROM memory_nodes WHERE id = ?1 AND project_id = ?2",
                        rusqlite::params![id, project_id],
                        |r| r.get(0),
                    )
                    .ok()
                };
                let (Some(f), Some(t2)) = (resolve(from), resolve(to)) else {
                    out.skipped += 1;
                    continue;
                };
                let n = conn
                    .execute(
                        "INSERT OR IGNORE INTO memory_edges (from_id, to_id, rel) VALUES (?1, ?2, ?3)",
                        rusqlite::params![f, t2, rel],
                    )
                    .map_err(|e| AppError::Internal(e.to_string()))?;
                out.edges_inserted += n as i32;
            }
            _ => out.skipped += 1,
        }
    }

    let _ = std::fs::remove_file(&path);
    Ok(out)
}

/// Fresh-first active nodes; `context_id` narrows to one context. Backs the
/// MEMORY BLOCK (cap 8 there) and any future ledger UI (cap 50 here).
#[tauri::command]
pub fn dev_tools_memory_list(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    context_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<MemoryNodeRow>, AppError> {
    require_auth_sync(&state)?;
    let conn = state.db.get().map_err(|e| AppError::Internal(e.to_string()))?;
    let limit = limit.unwrap_or(MAX_LIST).clamp(1, MAX_LIST);
    let mut sql = String::from(
        "SELECT id, project_id, context_id, kind, title, body, source, updated_at
         FROM memory_nodes WHERE project_id = ?1 AND status = 'active'",
    );
    if context_id.is_some() {
        sql.push_str(" AND context_id = ?2");
    }
    sql.push_str(" ORDER BY updated_at DESC LIMIT ");
    sql.push_str(&limit.to_string());

    let map_row = |r: &rusqlite::Row<'_>| -> rusqlite::Result<MemoryNodeRow> {
        Ok(MemoryNodeRow {
            id: r.get(0)?,
            project_id: r.get(1)?,
            context_id: r.get(2)?,
            kind: r.get(3)?,
            title: r.get(4)?,
            body: r.get(5)?,
            source: r.get(6)?,
            updated_at: r.get(7)?,
        })
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| AppError::Internal(e.to_string()))?;
    let rows: Vec<MemoryNodeRow> = match &context_id {
        Some(cid) => stmt
            .query_map(rusqlite::params![project_id, cid], map_row)
            .map_err(|e| AppError::Internal(e.to_string()))?
            .flatten()
            .collect(),
        None => stmt
            .query_map([&project_id], map_row)
            .map_err(|e| AppError::Internal(e.to_string()))?
            .flatten()
            .collect(),
    };
    Ok(rows)
}

/// Coverage: contexts with ≥1 fresh (≤30d) active node / all contexts.
#[tauri::command]
pub fn dev_tools_memory_coverage(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<MemoryCoverage, AppError> {
    require_auth_sync(&state)?;
    let conn = state.db.get().map_err(|e| AppError::Internal(e.to_string()))?;
    let q = |sql: &str| -> Result<i32, AppError> {
        conn.query_row(sql, [&project_id], |r| r.get::<_, i32>(0))
            .map_err(|e| AppError::Internal(e.to_string()))
    };
    let contexts = q("SELECT COUNT(*) FROM dev_contexts WHERE project_id = ?1")?;
    let covered = conn
        .query_row(
            "SELECT COUNT(DISTINCT context_id) FROM memory_nodes
             WHERE project_id = ?1 AND status = 'active' AND context_id IS NOT NULL
               AND datetime(updated_at) >= datetime('now', ?2)",
            rusqlite::params![project_id, format!("-{FRESH_DAYS} days")],
            |r| r.get::<_, i32>(0),
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let unanchored = q(
        "SELECT COUNT(*) FROM memory_nodes
         WHERE project_id = ?1 AND status = 'active' AND context_id IS NULL",
    )?;
    Ok(MemoryCoverage {
        contexts,
        covered,
        window_days: FRESH_DAYS as i32,
        unanchored,
    })
}
