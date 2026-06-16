//! Sync-safe row projections + the SQL that reads them out of the local DB.
//!
//! The credential/secret boundary is structural here: these SELECTs simply
//! never read vault, encrypted, or device-local-key columns. In particular:
//!   - `personas.model_profile` / `notification_channels` are AES-encrypted at
//!     rest with a per-device key → omitted (they'd be undecryptable ciphertext
//!     cloud-side anyway).
//!   - `persona_events.payload` is synced as a *sanitized* projection (v2):
//!     decrypted locally, secret-scrubbed, and size-bounded (see
//!     `project_event_payload`). The raw `payload_iv` is never synced.
//!   - The entire credential/vault table family is never touched.
//!
//! Field names are snake_case to match the Supabase columns 1:1, so the upsert
//! body needs no renaming. `user_id` is intentionally absent — the Supabase
//! column defaults to `auth.uid()` and RLS enforces it. `device_id` is stamped
//! after mapping (same for every row in a pass).

use rusqlite::{params, Row};
use serde::Serialize;

use crate::db::DbPool;
use crate::engine::crypto;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Event-payload sanitization (v2)
// ---------------------------------------------------------------------------
//
// Phase-1 synced event metadata only (payload = null). v2 pushes a sanitized
// body so the dashboard can show what an event carried — but never a secret.
// The boundary is defense-in-depth: only structured JSON is synced (opaque
// blobs are dropped), values under secret-looking keys are redacted, values
// that *look* like tokens are redacted regardless of key, and the whole thing
// is size-bounded so a large payload can't bloat the projection.

/// Max serialized payload pushed to the cloud; larger → a bounded marker.
const MAX_PAYLOAD_BYTES: usize = 4096;

/// Key substrings (case-insensitive) whose values are always redacted.
const SECRET_KEY_NEEDLES: &[&str] = &[
    "token", "secret", "password", "passwd", "api_key", "apikey", "authorization",
    "credential", "cookie", "private_key", "access_key", "client_secret", "bearer",
];

fn key_is_secret(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    SECRET_KEY_NEEDLES.iter().any(|n| k.contains(n))
}

/// A string value that looks like a credential even under an innocuous key:
/// known token prefixes, or a long whitespace-free high-base64/hex-density run.
fn value_looks_secret(s: &str) -> bool {
    const PREFIXES: &[&str] = &[
        "sk-", "sk_", "ghp_", "gho_", "ghs_", "github_pat_", "glpat-", "xox", "AKIA",
        "ASIA", "eyJ", "Bearer ", "-----BEGIN",
    ];
    if PREFIXES.iter().any(|p| s.starts_with(p)) {
        return true;
    }
    if s.len() >= 60 && !s.chars().any(|c| c.is_whitespace()) {
        let dense = s
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '-' | '_' | '='))
            .count();
        if dense * 100 / s.len() >= 90 {
            return true;
        }
    }
    false
}

fn redact_secrets(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            for (k, val) in map.iter_mut() {
                if key_is_secret(k) {
                    *val = serde_json::Value::String("[redacted]".into());
                } else {
                    redact_secrets(val);
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for val in arr.iter_mut() {
                redact_secrets(val);
            }
        }
        serde_json::Value::String(s) => {
            if value_looks_secret(s) {
                *s = "[redacted]".into();
            }
        }
        _ => {}
    }
}

/// Sanitize a plaintext event payload for the cloud projection. Returns `None`
/// for non-JSON input (we never push opaque/unstructured blobs).
fn sanitize_event_payload(plaintext: &str) -> Option<String> {
    let mut value: serde_json::Value = serde_json::from_str(plaintext).ok()?;
    redact_secrets(&mut value);
    let out = serde_json::to_string(&value).ok()?;
    if out.len() > MAX_PAYLOAD_BYTES {
        return Some(format!(r#"{{"_truncated":true,"bytes":{}}}"#, out.len()));
    }
    Some(out)
}

/// Decrypt (if encrypted at rest) then sanitize an event's stored payload.
/// `iv` present + non-empty → AES-GCM ciphertext; otherwise the column is
/// already plaintext (per `repos::communication::events`). Decrypt failure →
/// `None` (never leak ciphertext).
fn project_event_payload(raw: Option<String>, iv: Option<String>) -> Option<String> {
    let plaintext = match (raw, iv) {
        (Some(ct), Some(iv)) if !iv.is_empty() => crypto::decrypt_from_db(&ct, &iv).ok()?,
        (Some(pt), _) => pt,
        _ => return None,
    };
    sanitize_event_payload(&plaintext)
}

// ---------------------------------------------------------------------------
// Row structs (snake_case == Supabase columns)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct SyncedDeviceRow {
    pub device_id: String,
    pub name: Option<String>,
    pub platform: Option<String>,
    pub app_version: Option<String>,
    pub last_seen_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SyncedPersonaRow {
    pub id: String,
    pub device_id: Option<String>,
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub system_prompt: String,
    pub structured_prompt: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub enabled: bool,
    pub max_concurrent: i64,
    pub timeout_ms: i64,
    pub max_budget_usd: Option<f64>,
    pub max_turns: Option<i64>,
    pub design_context: Option<String>,
    pub home_team_id: Option<String>,
    pub template_category: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct SyncedExecutionRow {
    pub id: String,
    pub device_id: Option<String>,
    pub persona_id: String,
    pub trigger_id: Option<String>,
    pub status: String,
    pub input_data: Option<String>,
    pub output_data: Option<String>,
    pub claude_session_id: Option<String>,
    pub model_used: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub error_message: Option<String>,
    pub duration_ms: Option<i64>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct SyncedEventRow {
    pub id: String,
    pub device_id: Option<String>,
    pub project_id: String,
    pub event_type: String,
    pub source_type: String,
    pub source_id: Option<String>,
    pub target_persona_id: Option<String>,
    /// Sanitized event body (v2). Decrypted locally, secret-scrubbed, and
    /// size-bounded — see [`project_event_payload`]. `None` when there was no
    /// payload, decryption failed, or it wasn't structured JSON.
    pub payload: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub processed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct SyncedReviewRow {
    pub id: String,
    pub device_id: Option<String>,
    pub execution_id: String,
    pub persona_id: String,
    pub title: String,
    pub description: Option<String>,
    pub severity: String,
    pub context_data: Option<String>,
    pub suggested_actions: Option<String>,
    pub status: String,
    pub reviewer_notes: Option<String>,
    pub resolved_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct SyncedMessageRow {
    pub id: String,
    pub device_id: Option<String>,
    pub persona_id: String,
    pub execution_id: Option<String>,
    pub title: Option<String>,
    pub content: String,
    pub content_type: String,
    pub priority: String,
    pub is_read: bool,
    pub metadata: Option<String>,
    pub thread_id: Option<String>,
    pub created_at: String,
    pub read_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SyncedMetricsRow {
    pub id: String,
    pub device_id: Option<String>,
    pub persona_id: String,
    pub snapshot_date: String,
    pub total_executions: i64,
    pub successful_executions: i64,
    pub failed_executions: i64,
    pub total_cost_usd: f64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub avg_duration_ms: f64,
    pub events_emitted: i64,
    pub events_consumed: i64,
    pub messages_sent: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct SyncedToolUsageRow {
    pub id: String,
    pub device_id: Option<String>,
    pub execution_id: String,
    pub persona_id: String,
    pub tool_name: String,
    pub invocation_count: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct SyncedHealingIssueRow {
    pub id: String,
    pub device_id: Option<String>,
    pub persona_id: String,
    pub execution_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub severity: String,
    pub category: String,
    pub suggested_fix: Option<String>,
    pub auto_fixed: bool,
    pub is_circuit_breaker: bool,
    pub status: String,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SyncedTriggerRow {
    pub id: String,
    pub device_id: Option<String>,
    pub persona_id: String,
    pub trigger_type: String,
    // NOTE: `config` is intentionally NOT synced — webhook triggers can store a
    // secret token in their config JSON. Upcoming-routines only needs the type
    // + schedule timing, so the secret never has a column to ride on.
    pub enabled: bool,
    pub last_triggered_at: Option<String>,
    pub next_trigger_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ---------------------------------------------------------------------------
// Device heartbeat row
// ---------------------------------------------------------------------------

pub fn device_row(device_id: &str) -> SyncedDeviceRow {
    SyncedDeviceRow {
        device_id: device_id.to_string(),
        name: None,
        platform: Some(std::env::consts::OS.to_string()),
        app_version: Some(env!("CARGO_PKG_VERSION").to_string()),
        last_seen_at: Some(chrono::Utc::now().to_rfc3339()),
    }
}

// ---------------------------------------------------------------------------
// Row mappers (column order matches each SELECT below)
// ---------------------------------------------------------------------------

fn row_to_persona(row: &Row) -> rusqlite::Result<SyncedPersonaRow> {
    let enabled: i64 = row.get(8)?;
    Ok(SyncedPersonaRow {
        id: row.get(0)?,
        device_id: None,
        project_id: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        system_prompt: row.get(4)?,
        structured_prompt: row.get(5)?,
        icon: row.get(6)?,
        color: row.get(7)?,
        enabled: enabled != 0,
        max_concurrent: row.get(9)?,
        timeout_ms: row.get(10)?,
        max_budget_usd: row.get(11)?,
        max_turns: row.get(12)?,
        design_context: row.get(13)?,
        home_team_id: row.get(14)?,
        template_category: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
    })
}

fn row_to_execution(row: &Row) -> rusqlite::Result<SyncedExecutionRow> {
    Ok(SyncedExecutionRow {
        id: row.get(0)?,
        device_id: None,
        persona_id: row.get(1)?,
        trigger_id: row.get(2)?,
        status: row.get(3)?,
        input_data: row.get(4)?,
        output_data: row.get(5)?,
        claude_session_id: row.get(6)?,
        model_used: row.get(7)?,
        input_tokens: row.get(8)?,
        output_tokens: row.get(9)?,
        cost_usd: row.get(10)?,
        error_message: row.get(11)?,
        duration_ms: row.get(12)?,
        started_at: row.get(13)?,
        completed_at: row.get(14)?,
        created_at: row.get(15)?,
    })
}

fn row_to_event(row: &Row) -> rusqlite::Result<SyncedEventRow> {
    let raw_payload: Option<String> = row.get(6)?;
    let payload_iv: Option<String> = row.get(7)?;
    Ok(SyncedEventRow {
        id: row.get(0)?,
        device_id: None,
        project_id: row.get(1)?,
        event_type: row.get(2)?,
        source_type: row.get(3)?,
        source_id: row.get(4)?,
        target_persona_id: row.get(5)?,
        payload: project_event_payload(raw_payload, payload_iv),
        status: row.get(8)?,
        error_message: row.get(9)?,
        processed_at: row.get(10)?,
        created_at: row.get(11)?,
    })
}

fn row_to_review(row: &Row) -> rusqlite::Result<SyncedReviewRow> {
    Ok(SyncedReviewRow {
        id: row.get(0)?,
        device_id: None,
        execution_id: row.get(1)?,
        persona_id: row.get(2)?,
        title: row.get(3)?,
        description: row.get(4)?,
        severity: row.get(5)?,
        context_data: row.get(6)?,
        suggested_actions: row.get(7)?,
        status: row.get(8)?,
        reviewer_notes: row.get(9)?,
        resolved_at: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn row_to_message(row: &Row) -> rusqlite::Result<SyncedMessageRow> {
    let is_read: i64 = row.get(7)?;
    Ok(SyncedMessageRow {
        id: row.get(0)?,
        device_id: None,
        persona_id: row.get(1)?,
        execution_id: row.get(2)?,
        title: row.get(3)?,
        content: row.get(4)?,
        content_type: row.get(5)?,
        priority: row.get(6)?,
        is_read: is_read != 0,
        metadata: row.get(8)?,
        thread_id: row.get(9)?,
        created_at: row.get(10)?,
        read_at: row.get(11)?,
    })
}

fn row_to_metrics(row: &Row) -> rusqlite::Result<SyncedMetricsRow> {
    Ok(SyncedMetricsRow {
        id: row.get(0)?,
        device_id: None,
        persona_id: row.get(1)?,
        snapshot_date: row.get(2)?,
        total_executions: row.get(3)?,
        successful_executions: row.get(4)?,
        failed_executions: row.get(5)?,
        total_cost_usd: row.get(6)?,
        total_input_tokens: row.get(7)?,
        total_output_tokens: row.get(8)?,
        avg_duration_ms: row.get(9)?,
        events_emitted: row.get(10)?,
        events_consumed: row.get(11)?,
        messages_sent: row.get(12)?,
        created_at: row.get(13)?,
    })
}

fn row_to_tool_usage(row: &Row) -> rusqlite::Result<SyncedToolUsageRow> {
    Ok(SyncedToolUsageRow {
        id: row.get(0)?,
        device_id: None,
        execution_id: row.get(1)?,
        persona_id: row.get(2)?,
        tool_name: row.get(3)?,
        invocation_count: row.get(4)?,
        created_at: row.get(5)?,
    })
}

// ---------------------------------------------------------------------------
// Fetch functions: rows changed since the cursor (+ optional resync window for
// append tables whose rows mutate in place — status/read transitions).
// Signature matches `mod::sync_table`'s generic `fetch` parameter.
// ---------------------------------------------------------------------------

const PERSONA_COLS: &str = "id, project_id, name, description, system_prompt, structured_prompt, \
    icon, color, enabled, max_concurrent, timeout_ms, max_budget_usd, max_turns, design_context, \
    home_team_id, template_category, created_at, updated_at";

const EXECUTION_COLS: &str = "id, persona_id, trigger_id, status, input_data, output_data, \
    claude_session_id, model_used, input_tokens, output_tokens, cost_usd, error_message, \
    duration_ms, started_at, completed_at, created_at";

const EVENT_COLS: &str = "id, project_id, event_type, source_type, source_id, target_persona_id, \
    payload, payload_iv, status, error_message, processed_at, created_at";

const REVIEW_COLS: &str = "id, execution_id, persona_id, title, description, severity, \
    context_data, suggested_actions, status, reviewer_notes, resolved_at, created_at, updated_at";

const MESSAGE_COLS: &str = "id, persona_id, execution_id, title, content, content_type, priority, \
    is_read, metadata, thread_id, created_at, read_at";

const METRICS_COLS: &str = "id, persona_id, snapshot_date, total_executions, successful_executions, \
    failed_executions, total_cost_usd, total_input_tokens, total_output_tokens, avg_duration_ms, \
    events_emitted, events_consumed, messages_sent, created_at";

const TOOL_USAGE_COLS: &str = "id, execution_id, persona_id, tool_name, invocation_count, created_at";

/// Run the changed-since query and stamp `device_id` on every row. `cursor_col`
/// is the watermark column; when `resync_floor` is set, rows whose `created_at`
/// is within the resync window are also re-read (to capture in-place mutations).
/// Runs the changed-since query and returns the mapped rows alongside the
/// **maximum `cursor_col` value actually present in the result set** (or `None`
/// if empty). The caller advances the sync cursor to that observed max, never
/// to wall-clock `now()`: `now()` skipped any row committed *after* the SELECT's
/// read snapshot but stamped before the pass started, permanently losing it,
/// whereas the observed max can never be ahead of a row this pass didn't read.
/// The watermark column is selected under a stable `__cursor_val` alias so it is
/// readable regardless of whether `cols` projects it (mappers use positional
/// indices, so the appended column doesn't disturb them).
fn fetch<T, M>(
    pool: &DbPool,
    table: &str,
    cols: &str,
    cursor_col: &str,
    cursor_prev: &str,
    resync_floor: Option<&str>,
    mapper: M,
) -> Result<(Vec<T>, Option<String>), AppError>
where
    M: Fn(&Row) -> rusqlite::Result<T>,
{
    let conn = pool.get()?;
    let pairs: Vec<(T, String)> = if let Some(floor) = resync_floor {
        let sql = format!(
            "SELECT {cols}, {cursor_col} AS __cursor_val FROM {table} \
             WHERE datetime({cursor_col}) > datetime(?1) OR datetime(created_at) > datetime(?2)"
        );
        let mut stmt = conn.prepare(&sql)?;
        let it = stmt.query_map(params![cursor_prev, floor], |r| {
            let mapped = mapper(r)?;
            let cursor_val: String = r.get("__cursor_val")?;
            Ok((mapped, cursor_val))
        })?;
        it.collect::<Result<Vec<(T, String)>, _>>()?
    } else {
        let sql = format!(
            "SELECT {cols}, {cursor_col} AS __cursor_val FROM {table} \
             WHERE datetime({cursor_col}) > datetime(?1)"
        );
        let mut stmt = conn.prepare(&sql)?;
        let it = stmt.query_map(params![cursor_prev], |r| {
            let mapped = mapper(r)?;
            let cursor_val: String = r.get("__cursor_val")?;
            Ok((mapped, cursor_val))
        })?;
        it.collect::<Result<Vec<(T, String)>, _>>()?
    };
    let max_cursor = pairs.iter().map(|(_, c)| c.clone()).max();
    let rows = pairs.into_iter().map(|(t, _)| t).collect();
    Ok((rows, max_cursor))
}

macro_rules! stamp {
    ($rows:expr, $device:expr) => {{
        let mut out = $rows;
        for r in &mut out {
            r.device_id = Some($device.clone());
        }
        out
    }};
}

pub fn fetch_personas(
    pool: &DbPool,
    cursor_prev: String,
    _resync_floor: Option<String>,
    device_id: String,
) -> Result<(Vec<SyncedPersonaRow>, Option<String>), AppError> {
    let (rows, max_cursor) = fetch(pool, "personas", PERSONA_COLS, "updated_at", &cursor_prev, None, row_to_persona)?;
    Ok((stamp!(rows, device_id), max_cursor))
}

pub fn fetch_executions(
    pool: &DbPool,
    cursor_prev: String,
    resync_floor: Option<String>,
    device_id: String,
) -> Result<(Vec<SyncedExecutionRow>, Option<String>), AppError> {
    let (rows, max_cursor) = fetch(
        pool, "persona_executions", EXECUTION_COLS, "created_at", &cursor_prev,
        resync_floor.as_deref(), row_to_execution,
    )?;
    Ok((stamp!(rows, device_id), max_cursor))
}

pub fn fetch_events(
    pool: &DbPool,
    cursor_prev: String,
    resync_floor: Option<String>,
    device_id: String,
) -> Result<(Vec<SyncedEventRow>, Option<String>), AppError> {
    let (rows, max_cursor) = fetch(
        pool, "persona_events", EVENT_COLS, "created_at", &cursor_prev,
        resync_floor.as_deref(), row_to_event,
    )?;
    Ok((stamp!(rows, device_id), max_cursor))
}

pub fn fetch_reviews(
    pool: &DbPool,
    cursor_prev: String,
    _resync_floor: Option<String>,
    device_id: String,
) -> Result<(Vec<SyncedReviewRow>, Option<String>), AppError> {
    let (rows, max_cursor) = fetch(
        pool, "persona_manual_reviews", REVIEW_COLS, "updated_at", &cursor_prev, None, row_to_review,
    )?;
    Ok((stamp!(rows, device_id), max_cursor))
}

pub fn fetch_messages(
    pool: &DbPool,
    cursor_prev: String,
    resync_floor: Option<String>,
    device_id: String,
) -> Result<(Vec<SyncedMessageRow>, Option<String>), AppError> {
    let (rows, max_cursor) = fetch(
        pool, "persona_messages", MESSAGE_COLS, "created_at", &cursor_prev,
        resync_floor.as_deref(), row_to_message,
    )?;
    Ok((stamp!(rows, device_id), max_cursor))
}

pub fn fetch_metrics(
    pool: &DbPool,
    cursor_prev: String,
    resync_floor: Option<String>,
    device_id: String,
) -> Result<(Vec<SyncedMetricsRow>, Option<String>), AppError> {
    let (rows, max_cursor) = fetch(
        pool, "persona_metrics_snapshots", METRICS_COLS, "created_at", &cursor_prev,
        resync_floor.as_deref(), row_to_metrics,
    )?;
    Ok((stamp!(rows, device_id), max_cursor))
}

pub fn fetch_tool_usage(
    pool: &DbPool,
    cursor_prev: String,
    _resync_floor: Option<String>,
    device_id: String,
) -> Result<(Vec<SyncedToolUsageRow>, Option<String>), AppError> {
    let (rows, max_cursor) = fetch(
        pool, "persona_tool_usage", TOOL_USAGE_COLS, "created_at", &cursor_prev, None, row_to_tool_usage,
    )?;
    Ok((stamp!(rows, device_id), max_cursor))
}

// ---------------------------------------------------------------------------
// Knowledge: persona memories + learned execution patterns
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct SyncedMemoryRow {
    pub id: String,
    pub device_id: Option<String>,
    pub persona_id: String,
    pub title: String,
    pub content: String,
    pub category: Option<String>,
    pub source_execution_id: Option<String>,
    pub importance: Option<i64>,
    pub tags: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct SyncedKnowledgePatternRow {
    pub id: String,
    pub device_id: Option<String>,
    pub persona_id: String,
    pub use_case_id: Option<String>,
    pub knowledge_type: String,
    pub pattern_key: String,
    pub pattern_data: String,
    pub success_count: i64,
    pub failure_count: i64,
    pub avg_cost_usd: f64,
    pub avg_duration_ms: f64,
    pub confidence: f64,
    pub last_execution_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn row_to_memory(row: &Row) -> rusqlite::Result<SyncedMemoryRow> {
    Ok(SyncedMemoryRow {
        id: row.get(0)?,
        device_id: None,
        persona_id: row.get(1)?,
        title: row.get(2)?,
        content: row.get(3)?,
        category: row.get(4)?,
        source_execution_id: row.get(5)?,
        importance: row.get(6)?,
        tags: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn row_to_knowledge(row: &Row) -> rusqlite::Result<SyncedKnowledgePatternRow> {
    Ok(SyncedKnowledgePatternRow {
        id: row.get(0)?,
        device_id: None,
        persona_id: row.get(1)?,
        use_case_id: row.get(2)?,
        knowledge_type: row.get(3)?,
        pattern_key: row.get(4)?,
        pattern_data: row.get(5)?,
        success_count: row.get(6)?,
        failure_count: row.get(7)?,
        avg_cost_usd: row.get(8)?,
        avg_duration_ms: row.get(9)?,
        confidence: row.get(10)?,
        last_execution_id: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

const MEMORY_COLS: &str = "id, persona_id, title, content, category, source_execution_id, \
    importance, tags, created_at, updated_at";

const KNOWLEDGE_COLS: &str = "id, persona_id, use_case_id, knowledge_type, pattern_key, \
    pattern_data, success_count, failure_count, avg_cost_usd, avg_duration_ms, confidence, \
    last_execution_id, created_at, updated_at";

pub fn fetch_memories(
    pool: &DbPool,
    cursor_prev: String,
    _resync_floor: Option<String>,
    device_id: String,
) -> Result<(Vec<SyncedMemoryRow>, Option<String>), AppError> {
    let (rows, max_cursor) = fetch(
        pool, "persona_memories", MEMORY_COLS, "updated_at", &cursor_prev, None, row_to_memory,
    )?;
    Ok((stamp!(rows, device_id), max_cursor))
}

pub fn fetch_knowledge_patterns(
    pool: &DbPool,
    cursor_prev: String,
    _resync_floor: Option<String>,
    device_id: String,
) -> Result<(Vec<SyncedKnowledgePatternRow>, Option<String>), AppError> {
    let (rows, max_cursor) = fetch(
        pool, "execution_knowledge", KNOWLEDGE_COLS, "updated_at", &cursor_prev, None, row_to_knowledge,
    )?;
    Ok((stamp!(rows, device_id), max_cursor))
}

// ---------------------------------------------------------------------------
// Healing issues (overview health surface) + triggers (upcoming routines)
// ---------------------------------------------------------------------------

const HEALING_COLS: &str = "id, persona_id, execution_id, title, description, severity, category, \
    suggested_fix, auto_fixed, is_circuit_breaker, status, created_at, resolved_at";

const TRIGGER_COLS: &str = "id, persona_id, trigger_type, enabled, last_triggered_at, \
    next_trigger_at, created_at, updated_at";

fn row_to_healing(row: &Row) -> rusqlite::Result<SyncedHealingIssueRow> {
    let auto_fixed: i64 = row.get(8)?;
    let is_cb: i64 = row.get(9)?;
    Ok(SyncedHealingIssueRow {
        id: row.get(0)?,
        device_id: None,
        persona_id: row.get(1)?,
        execution_id: row.get(2)?,
        title: row.get(3)?,
        description: row.get(4)?,
        severity: row.get(5)?,
        category: row.get(6)?,
        suggested_fix: row.get(7)?,
        auto_fixed: auto_fixed != 0,
        is_circuit_breaker: is_cb != 0,
        status: row.get(10)?,
        created_at: row.get(11)?,
        resolved_at: row.get(12)?,
    })
}

fn row_to_trigger(row: &Row) -> rusqlite::Result<SyncedTriggerRow> {
    let enabled: i64 = row.get(3)?;
    Ok(SyncedTriggerRow {
        id: row.get(0)?,
        device_id: None,
        persona_id: row.get(1)?,
        trigger_type: row.get(2)?,
        enabled: enabled != 0,
        last_triggered_at: row.get(4)?,
        next_trigger_at: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

pub fn fetch_healing_issues(
    pool: &DbPool,
    cursor_prev: String,
    resync_floor: Option<String>,
    device_id: String,
) -> Result<(Vec<SyncedHealingIssueRow>, Option<String>), AppError> {
    // created_at watermark + resync window: healing issues mutate in place
    // (status open→resolved, auto_fixed flips), so re-pull recent rows.
    let (rows, max_cursor) = fetch(
        pool, "persona_healing_issues", HEALING_COLS, "created_at", &cursor_prev,
        resync_floor.as_deref(), row_to_healing,
    )?;
    Ok((stamp!(rows, device_id), max_cursor))
}

pub fn fetch_triggers(
    pool: &DbPool,
    cursor_prev: String,
    _resync_floor: Option<String>,
    device_id: String,
) -> Result<(Vec<SyncedTriggerRow>, Option<String>), AppError> {
    let (rows, max_cursor) = fetch(
        pool, "persona_triggers", TRIGGER_COLS, "updated_at", &cursor_prev, None, row_to_trigger,
    )?;
    Ok((stamp!(rows, device_id), max_cursor))
}

// ---------------------------------------------------------------------------
// Tombstones (v2 delete propagation)
// ---------------------------------------------------------------------------

/// A local persona deletion to propagate to the cloud projection.
#[derive(Debug, Clone)]
pub struct Tombstone {
    pub persona_id: String,
    pub deleted_at: String,
}

/// Persona deletions recorded after `cursor_prev` (RFC3339), oldest first.
/// `persona_tombstones` is persona-scoped; the sync writer cascades each delete
/// across the synced child tables (mirroring the local `ON DELETE CASCADE`).
pub fn fetch_tombstones(pool: &DbPool, cursor_prev: &str) -> Result<Vec<Tombstone>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT persona_id, deleted_at FROM persona_tombstones \
         WHERE datetime(deleted_at) > datetime(?1) ORDER BY deleted_at ASC",
    )?;
    let it = stmt.query_map(params![cursor_prev], |r| {
        Ok(Tombstone { persona_id: r.get(0)?, deleted_at: r.get(1)? })
    })?;
    it.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(v: &serde_json::Value) -> Vec<String> {
        v.as_object()
            .expect("row serializes to a JSON object")
            .keys()
            .cloned()
            .collect()
    }

    #[test]
    fn sanitizer_redacts_secret_keys_keeps_benign() {
        let out = sanitize_event_payload(
            r#"{"repo":"acme/web","apiKey":"abc123","branch":"main","authorization":"Bearer x"}"#,
        )
        .expect("structured json sanitizes");
        assert!(out.contains("acme/web"), "benign value kept");
        assert!(out.contains("\"branch\":\"main\""), "benign value kept");
        assert!(out.contains("[redacted]"), "secret value redacted");
        assert!(!out.contains("abc123"), "apiKey value must not survive");
    }

    #[test]
    fn sanitizer_redacts_tokenish_values_under_innocuous_keys() {
        let out = sanitize_event_payload(r#"{"note":"sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"}"#)
            .expect("structured json sanitizes");
        assert!(!out.contains("sk-ABCDEF"), "token-prefixed value redacted even under a benign key");
        assert!(out.contains("[redacted]"));
    }

    #[test]
    fn sanitizer_drops_non_json() {
        // Opaque/unstructured payloads are never pushed.
        assert_eq!(sanitize_event_payload("not json at all"), None);
        assert_eq!(sanitize_event_payload(""), None);
    }

    #[test]
    fn sanitizer_bounds_size() {
        let big = format!(r#"{{"blob":"{}"}}"#, "x ".repeat(5000)); // spaces → not "secret"
        let out = sanitize_event_payload(&big).expect("valid json");
        assert!(out.len() <= MAX_PAYLOAD_BYTES + 64);
        assert!(out.contains("_truncated"), "oversized payload replaced with bounded marker");
    }

    #[test]
    fn plaintext_payload_without_iv_is_projected() {
        // No IV → column is plaintext at rest; should sanitize + pass through.
        let out = project_event_payload(Some(r#"{"x":1}"#.into()), None);
        assert_eq!(out.as_deref(), Some(r#"{"x":1}"#));
        // Empty IV is treated as no-IV (plaintext), not a decrypt attempt.
        let out2 = project_event_payload(Some(r#"{"y":2}"#.into()), Some(String::new()));
        assert_eq!(out2.as_deref(), Some(r#"{"y":2}"#));
    }

    /// The credentials-stay-local guarantee: a synced persona row must never
    /// carry the AES-encrypted or device-local columns. This is enforced
    /// structurally (the struct has no such field) — assert it so a future
    /// field addition can't silently leak one.
    #[test]
    fn persona_row_excludes_secret_and_local_columns() {
        let row = SyncedPersonaRow {
            id: "p1".into(),
            device_id: Some("d1".into()),
            project_id: "default".into(),
            name: "n".into(),
            description: None,
            system_prompt: "s".into(),
            structured_prompt: None,
            icon: None,
            color: None,
            enabled: true,
            max_concurrent: 1,
            timeout_ms: 1,
            max_budget_usd: None,
            max_turns: None,
            design_context: None,
            home_team_id: None,
            template_category: None,
            created_at: "t".into(),
            updated_at: "t".into(),
        };
        let k = keys(&serde_json::to_value(&row).unwrap());
        for forbidden in [
            "model_profile",
            "notification_channels",
            "sensitive",
            "last_design_result",
            "last_test_report",
        ] {
            assert!(!k.contains(&forbidden.to_string()), "persona row leaked `{forbidden}`");
        }
    }

    /// Event payloads are AES-encrypted at rest (`payload`/`payload_iv`). v2
    /// syncs a *sanitized* payload (decrypted + secret-scrubbed), but the raw
    /// IV is never part of the projection.
    #[test]
    fn event_row_carries_sanitized_payload_not_iv() {
        let row = SyncedEventRow {
            id: "e1".into(),
            device_id: None,
            project_id: "default".into(),
            event_type: "x".into(),
            source_type: "y".into(),
            source_id: None,
            target_persona_id: None,
            payload: Some(r#"{"ok":true}"#.into()),
            status: "pending".into(),
            error_message: None,
            processed_at: None,
            created_at: "t".into(),
        };
        let k = keys(&serde_json::to_value(&row).unwrap());
        // v2: a *sanitized* payload IS synced (decrypted + secret-scrubbed in
        // project_event_payload). The raw IV must NEVER ride along — syncing it
        // would let the cloud reconstruct ciphertext context.
        assert!(k.contains(&"payload".to_string()), "v2 syncs a sanitized payload");
        assert!(!k.contains(&"payload_iv".to_string()), "event row must never carry payload_iv");
    }

    /// user_id is never sent on the wire — Supabase fills it from auth.uid()
    /// via the column default, and RLS enforces it. Sending it would be a
    /// (harmless but wrong) attempt to set another user's scope.
    #[test]
    fn rows_never_send_user_id() {
        let exec = SyncedExecutionRow {
            id: "x1".into(),
            device_id: None,
            persona_id: "p1".into(),
            trigger_id: None,
            status: "completed".into(),
            input_data: None,
            output_data: None,
            claude_session_id: None,
            model_used: None,
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: 0.0,
            error_message: None,
            duration_ms: None,
            started_at: None,
            completed_at: None,
            created_at: "t".into(),
        };
        let k = keys(&serde_json::to_value(&exec).unwrap());
        assert!(!k.contains(&"user_id".to_string()), "exec row should not send user_id");
        // Spot-check the execution projection also omits device-local plumbing.
        for forbidden in ["log_file_path", "execution_flows", "claimed_by_instance", "claim_expires_at"] {
            assert!(!k.contains(&forbidden.to_string()), "exec row leaked `{forbidden}`");
        }
    }
}
