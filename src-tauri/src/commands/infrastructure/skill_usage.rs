//! Skill usage telemetry (Brainiac-adoption P1 — docs/plans/brainiac-adoption-
//! skills-memory-docs.md).
//!
//! Brainiac's library thesis, localized: the anti-rot mechanism for reusable
//! skills is TELEMETRY — a skill nobody invokes goes visibly dormant. The
//! local-first substitute for Brainiac's server-side usage counting is the
//! Claude Code transcript store (`~/.claude/projects/<encoded-cwd>/*.jsonl`),
//! which records every `Skill` tool invocation and every `/slash` command the
//! user typed. This module:
//!
//!   • reconciles a `skill_registry` (identity + content-hash history) from the
//!     filesystem truth (`~/.claude/skills` + each dev project's
//!     `.claude/skills`) — the registry supplies `first_seen_at` for the
//!     age-guarded dormancy rule ("a skill added yesterday with no uses is
//!     NEW, not dead");
//!   • mines transcripts INCREMENTALLY (per-file byte watermark in
//!     `skill_scan_state`, bounded per call) into an append-only
//!     `skill_usage_events` log, deduped by (session, skill, timestamp);
//!   • serves `skill_usage_overview` — per-skill 30-day invoke counts,
//!     last-invoked timestamps and the dormancy verdict the passport cell,
//!     Skills modal and the `skill_dormant` finding emitter all read.
//!
//! Honesty rules carried over from Brainiac: events are append-only (repos
//! expose insert+select only); slash-command names that aren't registry skills
//! (built-ins like /model) are recorded but never surface — aggregation joins
//! the registry; there is NO fake "fetch denominator" locally (Claude Code
//! loads skills silently), so the overview reports invocations only.

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

use super::dev_tools::encode_claude_project_dir;
use super::skill_files::{global_skills_dir, hash_skill_dir, scan_skills_dir};

/// Dormancy window (days): a skill older than this with zero invokes inside it
/// reads dormant. Mirrors Brainiac's `LIBRARY_DORMANT_DAYS`.
const DORMANT_DAYS: i64 = 30;
/// Transcript files whose mtime is older than this are never mined — the
/// 30-day dormancy question doesn't need deep history, and first-run cost
/// stays bounded.
const MAX_FILE_AGE_DAYS: u64 = 90;
/// Per-call read budget. A call that exhausts it reports `exhausted: true`;
/// watermarks make the next call resume where this one stopped.
const MAX_BYTES_PER_SCAN: u64 = 48 * 1024 * 1024;

#[derive(Debug, Default, Serialize)]
pub struct SkillUsageScanSummary {
    pub files_scanned: u32,
    pub files_skipped: u32,
    pub events_added: u32,
    pub bytes_read: u64,
    pub registry_new: u32,
    pub registry_changed: u32,
    /// The byte budget ran out — call again to continue mining.
    pub exhausted: bool,
}

#[derive(Debug, Serialize)]
pub struct SkillUsageRow {
    pub name: String,
    /// 'global' | 'project'.
    pub scope: String,
    pub project_id: Option<String>,
    pub content_hash: Option<String>,
    pub description: Option<String>,
    pub first_seen_at: String,
    pub last_changed_at: String,
    /// Set when the skill vanished from disk — such rows are history, never
    /// dormancy signals.
    pub missing_since: Option<String>,
    /// Project rows count their own project's events; global rows count the
    /// name across ALL projects (any invocation anywhere keeps a library
    /// skill alive).
    pub invokes_30d: i64,
    pub last_invoked_at: Option<String>,
    /// Age-guarded: older than the window AND zero invokes inside it.
    pub dormant: bool,
}

// ============================================================================
// Registry reconcile — filesystem truth → identity + hash history
// ============================================================================

fn sha256_file(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let mut h = Sha256::new();
    h.update(&bytes);
    Some(format!("{:x}", h.finalize()))
}

fn skill_content_hash(entry_path: &str) -> Option<String> {
    let p = Path::new(entry_path);
    if p.is_dir() {
        hash_skill_dir(p)
    } else {
        sha256_file(p)
    }
}

/// The skill's REAL age: filesystem creation time (modified as fallback),
/// SQLite-datetime formatted. Without this, every registry row is born "today"
/// and the 30-day dormancy age-guard can't fire for a month even though the
/// skill has sat unused on disk since spring.
fn fs_first_seen(entry_path: &str) -> Option<String> {
    let meta = std::fs::metadata(entry_path).ok()?;
    let t = meta.created().or_else(|_| meta.modified()).ok()?;
    let dt: chrono::DateTime<chrono::Utc> = t.into();
    Some(dt.format("%Y-%m-%d %H:%M:%S").to_string())
}

fn reconcile_scope(
    conn: &rusqlite::Connection,
    scope: &str,
    project_id: Option<&str>,
    dir: &Path,
    summary: &mut SkillUsageScanSummary,
) -> Result<(), AppError> {
    let entries = scan_skills_dir(dir);
    let pid_key = project_id.unwrap_or("");
    let mut seen: Vec<String> = Vec::with_capacity(entries.len());

    for e in &entries {
        seen.push(e.name.clone());
        let hash = skill_content_hash(&e.path);
        // First ~200 chars of the description are plenty for list surfaces.
        let desc: Option<String> = e
            .description
            .as_deref()
            .map(|d| d.chars().take(200).collect());

        let existing: Option<(String, Option<String>)> = conn
            .query_row(
                "SELECT id, content_hash FROM skill_registry
                 WHERE name = ?1 AND scope = ?2 AND COALESCE(project_id,'') = ?3",
                rusqlite::params![e.name, scope, pid_key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();

        let first_seen = fs_first_seen(&e.path);
        match existing {
            None => {
                let id = uuid::Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO skill_registry
                       (id, name, scope, project_id, content_hash, description, first_seen_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE(?7, datetime('now')))",
                    rusqlite::params![id, e.name, scope, project_id, hash, desc, first_seen],
                )?;
                conn.execute(
                    "INSERT INTO skill_revisions (skill_id, rev, content_hash) VALUES (?1, 1, ?2)",
                    rusqlite::params![id, hash],
                )?;
                summary.registry_new += 1;
            }
            Some((id, old_hash)) => {
                // Re-seen: clear missing marker; on hash change, record a revision.
                if old_hash != hash {
                    conn.execute(
                        "UPDATE skill_registry
                         SET content_hash = ?2, description = ?3,
                             last_changed_at = datetime('now'), missing_since = NULL
                         WHERE id = ?1",
                        rusqlite::params![id, hash, desc],
                    )?;
                    conn.execute(
                        "INSERT INTO skill_revisions (skill_id, rev, content_hash)
                         VALUES (?1, (SELECT COALESCE(MAX(rev),0)+1 FROM skill_revisions WHERE skill_id = ?1), ?2)",
                        rusqlite::params![id, hash],
                    )?;
                    summary.registry_changed += 1;
                } else {
                    conn.execute(
                        "UPDATE skill_registry SET missing_since = NULL, description = ?2 WHERE id = ?1",
                        rusqlite::params![id, desc],
                    )?;
                }
                // Converge first_seen_at DOWN to the filesystem's knowledge —
                // heals rows born before this stamp existed. Monotonic, so a
                // copied/reinstalled file can never make a skill look older
                // than the registry already knows.
                conn.execute(
                    "UPDATE skill_registry SET first_seen_at = ?2
                     WHERE id = ?1 AND ?2 IS NOT NULL AND ?2 < first_seen_at",
                    rusqlite::params![id, first_seen],
                )?;
            }
        }
    }

    // Rows of this scope no longer on disk become history (stamped once) — a
    // removed skill must never read as "dormant", it reads as gone.
    let placeholders = if seen.is_empty() {
        "''".to_string()
    } else {
        seen.iter().map(|_| "?").collect::<Vec<_>>().join(",")
    };
    let sql = format!(
        "UPDATE skill_registry SET missing_since = COALESCE(missing_since, datetime('now'))
         WHERE scope = ?1 AND COALESCE(project_id,'') = ?2 AND name NOT IN ({placeholders})"
    );
    let mut params: Vec<Box<dyn rusqlite::ToSql>> =
        vec![Box::new(scope.to_string()), Box::new(pid_key.to_string())];
    for n in &seen {
        params.push(Box::new(n.clone()));
    }
    conn.execute(&sql, rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())))?;

    Ok(())
}

// ============================================================================
// Transcript mining — JSONL → append-only usage events
// ============================================================================

/// One observed invocation, pre-insert.
struct MinedEvent {
    skill_name: String,
    session_id: String,
    occurred_at: String,
}

/// Extract skill invocations from one COMPLETE transcript line. Two shapes:
/// `tool_use` blocks named `Skill` (agent-invoked, `input.skill`) and
/// `<command-name>/x</command-name>` markers (user-typed slash commands —
/// built-ins included; aggregation filters them via the registry join).
fn mine_line(line: &str, fallback_session: &str, out: &mut Vec<MinedEvent>) {
    let has_tool = line.contains("\"name\":\"Skill\"");
    let has_cmd = line.contains("<command-name>");
    if !has_tool && !has_cmd {
        return;
    }
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
        return;
    };
    let Some(ts) = v.get("timestamp").and_then(|t| t.as_str()) else {
        return;
    };
    let session = v
        .get("sessionId")
        .and_then(|s| s.as_str())
        .unwrap_or(fallback_session)
        .to_string();

    if has_tool {
        if let Some(content) = v
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array())
        {
            for block in content {
                if block.get("type").and_then(|t| t.as_str()) == Some("tool_use")
                    && block.get("name").and_then(|n| n.as_str()) == Some("Skill")
                {
                    if let Some(skill) = block
                        .get("input")
                        .and_then(|i| i.get("skill"))
                        .and_then(|s| s.as_str())
                    {
                        out.push(MinedEvent {
                            skill_name: skill.to_string(),
                            session_id: session.clone(),
                            occurred_at: ts.to_string(),
                        });
                    }
                }
            }
        }
    }

    if has_cmd {
        // The markers sit inside JSON-encoded text; substring extraction on the
        // raw line is deliberate — no need to walk every content shape.
        let mut rest = line;
        while let Some(start) = rest.find("<command-name>") {
            rest = &rest[start + "<command-name>".len()..];
            let Some(end) = rest.find("</command-name>") else { break };
            let name = rest[..end].trim().trim_start_matches('/');
            if !name.is_empty() && name.len() <= 64 && !name.contains('<') {
                out.push(MinedEvent {
                    skill_name: name.to_string(),
                    session_id: session.clone(),
                    occurred_at: ts.to_string(),
                });
            }
            rest = &rest[end..];
        }
    }
}

/// Mine one transcript file from its watermark. Returns bytes consumed (the
/// watermark advance — always ends on a line boundary).
fn mine_file(
    conn: &rusqlite::Connection,
    path: &Path,
    project_id: &str,
    budget: u64,
    summary: &mut SkillUsageScanSummary,
) -> Result<u64, AppError> {
    let key = path.to_string_lossy().to_string();
    let stored_offset: i64 = conn
        .query_row(
            "SELECT byte_offset FROM skill_scan_state WHERE file_path = ?1",
            [&key],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let meta = std::fs::metadata(path).map_err(|e| AppError::Internal(format!("stat failed: {e}")))?;
    let len = meta.len();
    // Truncated/rotated file → restart; INSERT OR IGNORE keeps events idempotent.
    let mut offset = if (stored_offset as u64) > len { 0 } else { stored_offset as u64 };
    if offset >= len {
        return Ok(0);
    }

    let to_read = (len - offset).min(budget);
    let mut file =
        std::fs::File::open(path).map_err(|e| AppError::Internal(format!("open failed: {e}")))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| AppError::Internal(format!("seek failed: {e}")))?;
    let mut buf = vec![0u8; to_read as usize];
    file.read_exact(&mut buf)
        .map_err(|e| AppError::Internal(format!("read failed: {e}")))?;

    // Only complete lines are processed; a trailing partial line waits for the
    // next call (the watermark stops at the last newline).
    let Some(last_nl) = buf.iter().rposition(|&b| b == b'\n') else {
        return Ok(0); // no complete line inside budget — try again next call
    };
    let chunk = &buf[..=last_nl];
    let consumed = (last_nl + 1) as u64;

    let fallback_session = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut events: Vec<MinedEvent> = Vec::new();
    for line in String::from_utf8_lossy(chunk).lines() {
        if !line.trim().is_empty() {
            mine_line(line, &fallback_session, &mut events);
        }
    }

    for ev in &events {
        // datetime(?) normalizes the ISO timestamp deterministically, so the
        // dedup index holds across truncation-triggered re-parses. An
        // unparseable timestamp NULLs out → skipped by the WHERE below.
        let added = conn.execute(
            "INSERT OR IGNORE INTO skill_usage_events
               (skill_name, project_id, session_id, event, source, occurred_at)
             SELECT ?1, ?2, ?3, 'invoke', 'transcript', datetime(?4)
             WHERE datetime(?4) IS NOT NULL",
            rusqlite::params![ev.skill_name, project_id, ev.session_id, ev.occurred_at],
        )?;
        summary.events_added += added as u32;
    }

    offset += consumed;
    conn.execute(
        "INSERT INTO skill_scan_state (file_path, byte_offset, updated_at)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(file_path) DO UPDATE SET byte_offset = ?2, updated_at = datetime('now')",
        rusqlite::params![key, offset as i64],
    )?;

    Ok(consumed)
}

// ============================================================================
// Commands
// ============================================================================

/// Incremental sweep: reconcile the skill registry from the filesystem, then
/// mine new transcript bytes into usage events. Idempotent; cheap after the
/// first run (watermarks). Never throws for a single bad file — vital signs
/// must not cost the caller its answer (per-file failures are warned + skipped).
#[tauri::command]
pub fn skill_usage_scan(state: State<'_, Arc<AppState>>) -> Result<SkillUsageScanSummary, AppError> {
    require_auth_sync(&state)?;
    let conn = state
        .db
        .get()
        .map_err(|e| AppError::Internal(format!("db connection failed: {e}")))?;

    let mut summary = SkillUsageScanSummary::default();

    // -- registry: global library + every registered project ------------------
    if let Some(dir) = global_skills_dir() {
        if let Err(e) = reconcile_scope(&conn, "global", None, &dir, &mut summary) {
            tracing::warn!(error = %e, "skill_usage: global registry reconcile failed");
        }
    }
    let projects: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, root_path FROM dev_projects")
            .map_err(|e| AppError::Internal(format!("prepare failed: {e}")))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| AppError::Internal(format!("query failed: {e}")))?;
        rows.flatten().collect()
    };
    for (pid, root) in &projects {
        let dir = PathBuf::from(root).join(".claude").join("skills");
        if let Err(e) = reconcile_scope(&conn, "project", Some(pid), &dir, &mut summary) {
            tracing::warn!(error = %e, project = %pid, "skill_usage: project registry reconcile failed");
        }
    }

    // -- transcripts: only dirs that map to a registered project --------------
    let Some(home) = dirs::home_dir() else {
        return Ok(summary);
    };
    let projects_dir = home.join(".claude").join("projects");
    let by_encoded: std::collections::HashMap<String, String> = projects
        .iter()
        .map(|(pid, root)| (encode_claude_project_dir(root), pid.clone()))
        .collect();

    let mut budget = MAX_BYTES_PER_SCAN;
    let max_age = std::time::Duration::from_secs(MAX_FILE_AGE_DAYS * 86_400);
    let now = std::time::SystemTime::now();

    'outer: for (encoded, pid) in &by_encoded {
        let dir = projects_dir.join(encoded);
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for entry in rd.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let fresh = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|m| now.duration_since(m).ok())
                .map(|age| age <= max_age)
                .unwrap_or(true);
            if !fresh {
                summary.files_skipped += 1;
                continue;
            }
            if budget == 0 {
                summary.exhausted = true;
                break 'outer;
            }
            match mine_file(&conn, &path, pid, budget, &mut summary) {
                Ok(consumed) => {
                    budget = budget.saturating_sub(consumed);
                    summary.bytes_read += consumed;
                    if consumed > 0 {
                        summary.files_scanned += 1;
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, file = %path.display(), "skill_usage: mining failed for file");
                    summary.files_skipped += 1;
                }
            }
        }
    }

    Ok(summary)
}

/// Per-skill usage aggregates over the registry — what the passport cell, the
/// Skills modal and the `skill_dormant` finding emitter read.
#[tauri::command]
pub fn skill_usage_overview(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<SkillUsageRow>, AppError> {
    require_auth_sync(&state)?;
    let conn = state
        .db
        .get()
        .map_err(|e| AppError::Internal(format!("db connection failed: {e}")))?;

    let mut stmt = conn
        .prepare(
            "SELECT r.id, r.name, r.scope, r.project_id, r.content_hash, r.description,
                    r.first_seen_at, r.last_changed_at, r.missing_since,
                    (SELECT COUNT(*) FROM skill_usage_events e
                      WHERE e.skill_name = r.name
                        AND (r.scope = 'global' OR e.project_id = r.project_id)
                        AND e.occurred_at >= datetime('now', ?1)) AS invokes_30d,
                    (SELECT MAX(e.occurred_at) FROM skill_usage_events e
                      WHERE e.skill_name = r.name
                        AND (r.scope = 'global' OR e.project_id = r.project_id)) AS last_invoked_at,
                    (r.first_seen_at < datetime('now', ?1)) AS aged
             FROM skill_registry r
             ORDER BY r.scope, r.name",
        )
        .map_err(|e| AppError::Internal(format!("prepare failed: {e}")))?;

    let window = format!("-{DORMANT_DAYS} days");
    let rows = stmt
        .query_map([&window], |r| {
            let missing_since: Option<String> = r.get(8)?;
            let invokes_30d: i64 = r.get(9)?;
            let aged: bool = r.get::<_, i64>(11)? != 0;
            Ok(SkillUsageRow {
                name: r.get(1)?,
                scope: r.get(2)?,
                project_id: r.get(3)?,
                content_hash: r.get(4)?,
                description: r.get(5)?,
                first_seen_at: r.get(6)?,
                last_changed_at: r.get(7)?,
                dormant: missing_since.is_none() && aged && invokes_30d == 0,
                missing_since,
                invokes_30d,
                last_invoked_at: r.get(10)?,
            })
        })
        .map_err(|e| AppError::Internal(format!("query failed: {e}")))?;

    Ok(rows.flatten().collect())
}

#[cfg(test)]
mod tests {
    use super::mine_line;

    #[test]
    fn mines_skill_tool_use_blocks() {
        let line = r#"{"type":"assistant","timestamp":"2026-07-08T17:46:08.021Z","sessionId":"s1","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"prototype","args":"x"}}]}}"#;
        let mut out = Vec::new();
        mine_line(line, "fallback", &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].skill_name, "prototype");
        assert_eq!(out[0].session_id, "s1");
        assert_eq!(out[0].occurred_at, "2026-07-08T17:46:08.021Z");
    }

    #[test]
    fn mines_command_name_markers_stripping_slash() {
        let line = r#"{"type":"user","timestamp":"2026-07-08T10:00:00.000Z","message":{"content":"<command-name>/research</command-name> then <command-name>/model</command-name>"}}"#;
        let mut out = Vec::new();
        mine_line(line, "file-stem", &mut out);
        let names: Vec<&str> = out.iter().map(|e| e.skill_name.as_str()).collect();
        assert_eq!(names, vec!["research", "model"]);
        assert_eq!(out[0].session_id, "file-stem"); // no sessionId in entry
    }

    #[test]
    fn ignores_lines_without_markers_or_timestamp() {
        let mut out = Vec::new();
        mine_line(r#"{"type":"user","message":{"content":"plain"}}"#, "f", &mut out);
        mine_line(r#"{"message":{"content":"<command-name>/x</command-name>"}}"#, "f", &mut out); // no timestamp
        assert!(out.is_empty());
    }
}
