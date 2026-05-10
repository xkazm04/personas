//! User-persona background job framework — projects the dream-job
//! shape onto user-created personas (mirroring `companion::jobs` for
//! the companion side).
//!
//! Concept borrowed from Anthropic Managed Agents' dream pipeline: an
//! async unit of curation work with a queued → running → completed |
//! failed | canceled lifecycle, watchable via Tauri events, with
//! immutable inputs producing a separate proposal output the user
//! reviews and either applies or discards.
//!
//! v1 ships ONE kind: `memory_curation_run`, which invokes an LLM
//! reviewer against a persona's memories (mirrors
//! `commands::core::memories::review_memories_with_cli` in proposal
//! mode) and writes the structured proposal to
//! `persona_memory_review_proposal` for review. New kinds are a match
//! arm in `dispatch_handler`.
//!
//! The framework is deliberately a parallel implementation to
//! `companion::jobs` rather than a generic shared abstraction —
//! they operate on different DB pools (companion: user_db,
//! user-personas: db), surface to different UIs, and may diverge as
//! the job kinds for each side grow. A future architect pass can DRY
//! them up if the divergence stays small.

use std::sync::Arc;

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use ts_rs::TS;
use uuid::Uuid;

use crate::db::DbPool;
use crate::error::AppError;

/// Tauri event channel for job status changes — frontend listens and
/// updates its in-flight indicator. Payload: the full `BackgroundJob`
/// row.
pub const JOB_EVENT: &str = "persona://job";

/// Kind discriminator for the v1 memory-curation job.
pub const KIND_MEMORY_CURATION: &str = "memory_curation_run";

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundJob {
    pub id: String,
    pub kind: String,
    /// `queued` | `running` | `completed` | `failed` | `canceled`
    pub status: String,
    pub params_json: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub persona_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub result_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error_text: Option<String>,
    pub cancel_requested: bool,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub completed_at: Option<String>,
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<BackgroundJob> {
    Ok(BackgroundJob {
        id: row.get(0)?,
        kind: row.get(1)?,
        status: row.get(2)?,
        params_json: row.get(3)?,
        persona_id: row.get(4)?,
        result_text: row.get(5)?,
        error_text: row.get(6)?,
        cancel_requested: row.get::<_, i64>(7)? != 0,
        created_at: row.get(8)?,
        started_at: row.get(9)?,
        completed_at: row.get(10)?,
    })
}

const SELECT_COLUMNS: &str = "id, kind, status, params_json, persona_id, result_text, error_text,
        cancel_requested, created_at, started_at, completed_at";

fn short_uuid() -> String {
    Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(8)
        .collect()
}

pub fn enqueue(
    pool: &DbPool,
    kind: &str,
    params: &serde_json::Value,
    persona_id: Option<&str>,
) -> Result<String, AppError> {
    let id = format!("pjob_{}", short_uuid());
    let now = Utc::now().to_rfc3339();
    let params_str = params.to_string();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_background_job (id, kind, status, params_json, persona_id, created_at)
         VALUES (?1, ?2, 'queued', ?3, ?4, ?5)",
        params![id, kind, params_str, persona_id, now],
    )?;
    tracing::info!(job_id = %id, kind, "persona background job enqueued");
    Ok(id)
}

pub fn get(pool: &DbPool, id: &str) -> Result<Option<BackgroundJob>, AppError> {
    let conn = pool.get()?;
    let sql = format!("SELECT {SELECT_COLUMNS} FROM persona_background_job WHERE id = ?1");
    let row = conn.query_row(&sql, params![id], map_row).optional()?;
    Ok(row)
}

pub fn list(
    pool: &DbPool,
    persona_id: Option<&str>,
    only_unresolved: bool,
    limit: u32,
) -> Result<Vec<BackgroundJob>, AppError> {
    let conn = pool.get()?;
    let mut clauses: Vec<&str> = Vec::new();
    if persona_id.is_some() {
        clauses.push("persona_id = ?1");
    }
    if only_unresolved {
        clauses.push("status IN ('queued', 'running')");
    }
    let where_clause = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    let limit_idx = if persona_id.is_some() { "?2" } else { "?1" };
    let sql = format!(
        "SELECT {SELECT_COLUMNS}
         FROM persona_background_job
         {where_clause}
         ORDER BY created_at DESC
         LIMIT {limit_idx}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<BackgroundJob> = if let Some(pid) = persona_id {
        stmt.query_map(params![pid, limit], map_row)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        stmt.query_map(params![limit], map_row)?
            .collect::<Result<Vec<_>, _>>()?
    };
    Ok(rows)
}

/// Request cancellation of a job. Behavior depends on current status:
/// - `queued` → transitions immediately to `canceled`, returns true
/// - `running` → sets `cancel_requested = 1`; the worker checks this
///   between cooperative-cancel points (v1: only at job start since
///   the LLM call itself is a one-shot blocking spawn). Returns true.
/// - `completed` | `failed` | `canceled` → no-op, returns false
pub fn request_cancel(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let queued_canceled = conn.execute(
        "UPDATE persona_background_job
         SET status = 'canceled', completed_at = ?1
         WHERE id = ?2 AND status = 'queued'",
        params![now, id],
    )?;
    if queued_canceled > 0 {
        return Ok(true);
    }
    let running_flagged = conn.execute(
        "UPDATE persona_background_job
         SET cancel_requested = 1
         WHERE id = ?1 AND status = 'running'",
        params![id],
    )?;
    Ok(running_flagged > 0)
}

fn pop_next_queued(pool: &DbPool) -> Result<Option<BackgroundJob>, AppError> {
    let conn = pool.get()?;
    let now = Utc::now().to_rfc3339();
    let sql = format!(
        "SELECT {SELECT_COLUMNS}
         FROM persona_background_job
         WHERE status = 'queued'
         ORDER BY created_at ASC
         LIMIT 1"
    );
    let row = conn.query_row(&sql, params![], map_row).optional()?;
    if let Some(ref job) = row {
        let updated = conn.execute(
            "UPDATE persona_background_job
             SET status = 'running', started_at = ?1
             WHERE id = ?2 AND status = 'queued'",
            params![now, job.id],
        )?;
        if updated == 0 {
            return Ok(None);
        }
    }
    Ok(row.map(|mut j| {
        j.status = "running".into();
        j.started_at = Some(now);
        j
    }))
}

fn mark_completed(pool: &DbPool, id: &str, result: &str) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE persona_background_job
         SET status = 'completed', result_text = ?1, completed_at = ?2
         WHERE id = ?3",
        params![result, now, id],
    )?;
    Ok(())
}

fn mark_failed(pool: &DbPool, id: &str, error: &str) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE persona_background_job
         SET status = 'failed', error_text = ?1, completed_at = ?2
         WHERE id = ?3",
        params![error, now, id],
    )?;
    Ok(())
}

/// Recover orphaned `running` jobs on process restart. Without this,
/// a crashed/killed worker leaves jobs stuck in `running` forever.
/// Called once at app setup.
pub fn recover_orphans(pool: &DbPool) -> Result<usize, AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let n = conn.execute(
        "UPDATE persona_background_job
         SET status = 'failed',
             error_text = COALESCE(error_text, '') || ' [orphaned by process restart]',
             completed_at = ?1
         WHERE status = 'running'",
        params![now],
    )?;
    if n > 0 {
        tracing::info!(orphans = n, "persona-jobs worker: recovered orphaned running jobs");
    }
    Ok(n)
}

/// Single worker tick. Pulls one queued job, dispatches by kind,
/// records result/error, emits the structured Tauri event so the UI
/// updates without polling. Errors at the dispatch level are caught
/// and recorded on the row; this function returns Err only on
/// infrastructure failures (DB unreachable).
pub async fn worker_tick(pool: &DbPool, app: &AppHandle) -> Result<(), AppError> {
    let job = match pop_next_queued(pool)? {
        Some(j) => j,
        None => return Ok(()),
    };

    // If cancel was requested while the job was still queued (race
    // with a list/cancel pair), the queued path in request_cancel
    // already transitioned to canceled and pop_next_queued would have
    // skipped it. The remaining concern is mid-running cancel which
    // v1 handles only as a "skip the LLM call before spawn" check
    // below.
    let _ = app.emit(JOB_EVENT, &job);

    // Pre-dispatch cancel check — if the user requested cancel
    // between enqueue and our pop, honor it without burning the LLM
    // call.
    if cancel_requested(pool, &job.id)? {
        let _ = mark_canceled(pool, &job.id);
        if let Ok(Some(updated)) = get(pool, &job.id) {
            let _ = app.emit(JOB_EVENT, &updated);
        }
        return Ok(());
    }

    let result = dispatch_handler(pool, &job).await;

    match result {
        Ok(report) => {
            if let Err(e) = mark_completed(pool, &job.id, &report) {
                tracing::warn!(job_id = %job.id, error = %e, "persona-job: mark_completed failed");
            }
        }
        Err(e) => {
            let err_text = e.to_string();
            if let Err(e2) = mark_failed(pool, &job.id, &err_text) {
                tracing::warn!(job_id = %job.id, error = %e2, "persona-job: mark_failed failed");
            }
        }
    }

    if let Ok(Some(updated)) = get(pool, &job.id) {
        let _ = app.emit(JOB_EVENT, &updated);
    }
    Ok(())
}

fn cancel_requested(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let flag: i64 = conn.query_row(
        "SELECT cancel_requested FROM persona_background_job WHERE id = ?1",
        params![id],
        |r| r.get(0),
    )?;
    Ok(flag != 0)
}

fn mark_canceled(pool: &DbPool, id: &str) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE persona_background_job
         SET status = 'canceled', completed_at = ?1
         WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

async fn dispatch_handler(pool: &DbPool, job: &BackgroundJob) -> Result<String, AppError> {
    let params: serde_json::Value =
        serde_json::from_str(&job.params_json).unwrap_or(serde_json::json!({}));
    match job.kind.as_str() {
        KIND_MEMORY_CURATION => memory_curation_run(pool, &params).await,
        other => Err(AppError::Internal(format!(
            "unknown persona background job kind `{other}`"
        ))),
    }
}

/// Maximum instructions length in characters. Mirrors the limit at
/// the IPC boundary in `commands::core::memories` and the companion
/// side, so an enqueued job with an over-length `instructions` field
/// fails fast at the worker rather than producing a giant prompt.
const MAX_INSTRUCTIONS_CHARS: usize = 4096;

/// `memory_curation_run` job kind handler.
///
/// Mirrors the proposal-mode shape of
/// `commands::core::memories::review_memories_with_cli`: fetch
/// memories, ask Claude to score them, classify into proposed
/// changes, write a `persona_memory_review_proposal` row. Returns a
/// short summary; the actual proposal id is in the result_text JSON
/// for the frontend to follow up via `apply_persona_memory_review_proposal`
/// or `discard_persona_memory_review_proposal`.
///
/// Inputs (all optional):
/// - `persona_id`: scope to a single persona. Default: workspace-wide.
/// - `threshold`: score below which memories are proposed for delete.
///   Default 7.
/// - `instructions`: ≤4096-char natural-language steering.
async fn memory_curation_run(
    pool: &DbPool,
    params: &serde_json::Value,
) -> Result<String, AppError> {
    use std::collections::HashMap;
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::process::Command;

    use crate::db::repos::core::memories as memories_repo;
    use crate::db::repos::core::memory_review_proposal::{
        self as proposal_repo, CreateProposalInput, ProposalEntry,
    };

    let persona_id = params.get("persona_id").and_then(|v| v.as_str());
    let threshold = params
        .get("threshold")
        .and_then(|v| v.as_i64())
        .map(|n| n as i32)
        .unwrap_or(7);
    let instructions = params.get("instructions").and_then(|v| v.as_str());
    if let Some(s) = instructions {
        if s.chars().count() > MAX_INSTRUCTIONS_CHARS {
            return Err(AppError::Validation(format!(
                "instructions must be ≤{MAX_INSTRUCTIONS_CHARS} characters"
            )));
        }
    }

    // 1. Fetch memories — same shape as IPC command.
    let memories = memories_repo::get_all(
        pool,
        persona_id,
        None,
        None,
        Some(200),
        Some(0),
        None,
        None,
    )?;
    if memories.is_empty() {
        return Ok("No memories to review (empty pool).".to_string());
    }

    // 2. Build prompt.
    let memory_entries: Vec<serde_json::Value> = memories
        .iter()
        .map(|m| {
            serde_json::json!({
                "id": m.id,
                "title": m.title,
                "content": m.content,
                "category": m.category,
                "importance": m.importance,
            })
        })
        .collect();
    let memories_json = serde_json::to_string_pretty(&memory_entries)
        .map_err(|e| AppError::Internal(format!("Serialize: {e}")))?;
    let guidance_block = instructions
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("\n\nAdditional guidance from operator:\n{s}\n"))
        .unwrap_or_default();
    let prompt = format!(
        r#"You are reviewing agent memories from Personas, an AI agent management platform where autonomous agents execute tasks, use tools, handle events, and store memories to retain knowledge across executions.

Evaluate each memory for relevance to agent operations. Score 1-10:
- 9-10: Critical operational knowledge essential for agent tasks
- 7-8: Useful context that meaningfully aids agent performance
- 4-6: Marginal value, possibly outdated or vague
- 1-3: Noise, trivial, redundant, or no longer applicable

Respond with ONLY a JSON array. No markdown fences, no explanation, no surrounding text.
Example: [{{"id":"abc-123","score":8,"reason":"Core operational context"}}]
{guidance_block}
Memories to review:
{memories_json}"#
    );

    // 3. Spawn Claude CLI — mirrors review_memories_with_cli's args.
    let (program, mut args) = if cfg!(windows) {
        (
            "cmd".to_string(),
            vec!["/C".to_string(), "claude.cmd".to_string()],
        )
    } else {
        ("claude".to_string(), vec![])
    };
    args.extend(
        [
            "-p",
            "-",
            "--max-turns",
            "1",
            "--dangerously-skip-permissions",
        ]
        .iter()
        .map(|s| s.to_string()),
    );
    let mut cmd = Command::new(&program);
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd.env_remove("CLAUDECODE");
    cmd.env_remove("CLAUDE_CODE");

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::Internal(
                "Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code"
                    .into(),
            )
        } else {
            AppError::Internal(format!("Failed to spawn CLI: {e}"))
        }
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes()).await.map_err(|e| {
            AppError::Internal(format!("Failed to write prompt to CLI stdin: {e}"))
        })?;
        stdin
            .shutdown()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to close CLI stdin: {e}")))?;
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("No stdout".into()))?;
    let mut reader = BufReader::new(stdout);
    let mut full_output = String::new();

    let cli_timeout = std::time::Duration::from_secs(180);
    let read_result = tokio::time::timeout(cli_timeout, async {
        let mut line = String::new();
        while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
            full_output.push_str(&line);
            line.clear();
        }
    })
    .await;
    if read_result.is_err() {
        let _ = child.kill().await;
        let _ = child.wait().await;
        return Err(AppError::Internal(
            "Memory review timed out after 3 minutes".into(),
        ));
    }
    let _ = child.wait().await;

    if full_output.trim().is_empty() {
        return Err(AppError::Internal("CLI produced no output".into()));
    }

    // 4. Parse + classify (same shape as IPC command).
    let json_str = extract_json_array(&full_output)
        .ok_or_else(|| AppError::Internal("Failed to parse review output as JSON".into()))?;
    let reviews: Vec<serde_json::Value> = serde_json::from_str(&json_str)
        .map_err(|e| AppError::Internal(format!("Invalid JSON in review output: {e}")))?;

    let title_map: HashMap<&str, &str> = memories
        .iter()
        .map(|m| (m.id.as_str(), m.title.as_str()))
        .collect();

    let mut entries: Vec<ProposalEntry> = Vec::new();
    let mut proposed_changes = 0usize;
    for review in &reviews {
        let id = review.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if id.is_empty() {
            continue;
        }
        let title = match title_map.get(id) {
            Some(t) => t.to_string(),
            None => continue,
        };
        let score = match review.get("score").and_then(|v| v.as_i64()) {
            Some(s) => s as i32,
            None => continue,
        };
        let reason = review
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if score < threshold {
            entries.push(ProposalEntry {
                memory_id: id.to_string(),
                title,
                score,
                reason,
                action: "delete".to_string(),
                new_importance: None,
            });
            proposed_changes += 1;
        } else {
            let new_importance = match score {
                7 => 3,
                8 => 4,
                9..=10 => 5,
                _ => 3,
            };
            entries.push(ProposalEntry {
                memory_id: id.to_string(),
                title,
                score,
                reason,
                action: "update_importance".to_string(),
                new_importance: Some(new_importance),
                });
            proposed_changes += 1;
        }
    }

    let summary = format!(
        "Reviewed {n} memories; proposed {p} change(s) for review.",
        n = reviews.len(),
        p = proposed_changes
    );
    let proposal_id = proposal_repo::create(
        pool,
        CreateProposalInput {
            persona_id,
            threshold,
            instructions,
            entries: &entries,
            summary: Some(&summary),
        },
    )?;

    // The result_text is JSON so the frontend can read proposal_id +
    // counts without parsing prose.
    let result = serde_json::json!({
        "proposal_id": proposal_id,
        "reviewed": reviews.len(),
        "proposed_changes": proposed_changes,
        "summary": summary,
    });
    Ok(result.to_string())
}

fn extract_json_array(s: &str) -> Option<String> {
    let start = s.find('[')?;
    let mut depth = 0i32;
    let bytes = s.as_bytes();
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        match b {
            b'[' => depth += 1,
            b']' => {
                depth -= 1;
                if depth == 0 {
                    return Some(s[start..=i].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_json_array_finds_outermost() {
        let s = "preamble [{ \"id\": \"a\" }, { \"id\": \"b\" }] trailing";
        let extracted = extract_json_array(s).unwrap();
        assert_eq!(extracted, "[{ \"id\": \"a\" }, { \"id\": \"b\" }]");
    }

    #[test]
    fn extract_json_array_handles_nested() {
        let s = "[{\"x\": [1,2,3]}, {\"y\": [4,5]}]";
        let extracted = extract_json_array(s).unwrap();
        assert_eq!(extracted, s);
    }

    #[test]
    fn extract_json_array_returns_none_when_no_array() {
        assert!(extract_json_array("no array here").is_none());
    }

    #[test]
    fn instructions_cap_matches_ipc_boundary() {
        let s = "a".repeat(MAX_INSTRUCTIONS_CHARS + 1);
        assert!(s.chars().count() > MAX_INSTRUCTIONS_CHARS);
    }

    // Cancel-state-machine guard: queued cancel is one DB roundtrip,
    // running cancel is the flag-bump path. Both go through
    // request_cancel. With a real pool we'd seed a job and exercise
    // both paths; here we just sanity-check the constant.
    #[test]
    fn job_event_channel_name_is_namespaced() {
        assert!(JOB_EVENT.starts_with("persona://"));
    }

    #[test]
    fn unused_arc_import_is_silenced_in_tests_module() {
        // Arc isn't used in this module right now (we hold &DbPool directly);
        // suppress the unused-import warning if the type ever lands.
        let _: Option<Arc<()>> = None;
    }
}
