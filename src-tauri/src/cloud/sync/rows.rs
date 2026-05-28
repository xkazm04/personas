//! Sync-safe row projections + the SQL that reads them out of the local DB.
//!
//! The credential/secret boundary is structural here: these SELECTs simply
//! never read vault, encrypted, or device-local-key columns. In particular:
//!   - `personas.model_profile` / `notification_channels` are AES-encrypted at
//!     rest with a per-device key → omitted (they'd be undecryptable ciphertext
//!     cloud-side anyway).
//!   - `persona_events.payload` / `payload_iv` (encrypted) → omitted; only event
//!     metadata syncs (per the chosen "metadata only" policy).
//!   - The entire credential/vault table family is never touched.
//!
//! Field names are snake_case to match the Supabase columns 1:1, so the upsert
//! body needs no renaming. `user_id` is intentionally absent — the Supabase
//! column defaults to `auth.uid()` and RLS enforces it. `device_id` is stamped
//! after mapping (same for every row in a pass).

use rusqlite::{params, Row};
use serde::Serialize;

use crate::db::DbPool;
use crate::error::AppError;

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
    Ok(SyncedEventRow {
        id: row.get(0)?,
        device_id: None,
        project_id: row.get(1)?,
        event_type: row.get(2)?,
        source_type: row.get(3)?,
        source_id: row.get(4)?,
        target_persona_id: row.get(5)?,
        status: row.get(6)?,
        error_message: row.get(7)?,
        processed_at: row.get(8)?,
        created_at: row.get(9)?,
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
    status, error_message, processed_at, created_at";

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
fn fetch<T, M>(
    pool: &DbPool,
    table: &str,
    cols: &str,
    cursor_col: &str,
    cursor_prev: &str,
    resync_floor: Option<&str>,
    mapper: M,
) -> Result<Vec<T>, AppError>
where
    M: Fn(&Row) -> rusqlite::Result<T>,
{
    let conn = pool.get()?;
    let result: Vec<T> = if let Some(floor) = resync_floor {
        let sql = format!(
            "SELECT {cols} FROM {table} \
             WHERE datetime({cursor_col}) > datetime(?1) OR datetime(created_at) > datetime(?2)"
        );
        let mut stmt = conn.prepare(&sql)?;
        let it = stmt.query_map(params![cursor_prev, floor], |r| mapper(r))?;
        it.collect::<Result<Vec<T>, _>>()?
    } else {
        let sql = format!("SELECT {cols} FROM {table} WHERE datetime({cursor_col}) > datetime(?1)");
        let mut stmt = conn.prepare(&sql)?;
        let it = stmt.query_map(params![cursor_prev], |r| mapper(r))?;
        it.collect::<Result<Vec<T>, _>>()?
    };
    Ok(result)
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
) -> Result<Vec<SyncedPersonaRow>, AppError> {
    let rows = fetch(pool, "personas", PERSONA_COLS, "updated_at", &cursor_prev, None, row_to_persona)?;
    Ok(stamp!(rows, device_id))
}

pub fn fetch_executions(
    pool: &DbPool,
    cursor_prev: String,
    resync_floor: Option<String>,
    device_id: String,
) -> Result<Vec<SyncedExecutionRow>, AppError> {
    let rows = fetch(
        pool, "persona_executions", EXECUTION_COLS, "created_at", &cursor_prev,
        resync_floor.as_deref(), row_to_execution,
    )?;
    Ok(stamp!(rows, device_id))
}

pub fn fetch_events(
    pool: &DbPool,
    cursor_prev: String,
    resync_floor: Option<String>,
    device_id: String,
) -> Result<Vec<SyncedEventRow>, AppError> {
    let rows = fetch(
        pool, "persona_events", EVENT_COLS, "created_at", &cursor_prev,
        resync_floor.as_deref(), row_to_event,
    )?;
    Ok(stamp!(rows, device_id))
}

pub fn fetch_reviews(
    pool: &DbPool,
    cursor_prev: String,
    _resync_floor: Option<String>,
    device_id: String,
) -> Result<Vec<SyncedReviewRow>, AppError> {
    let rows = fetch(
        pool, "persona_manual_reviews", REVIEW_COLS, "updated_at", &cursor_prev, None, row_to_review,
    )?;
    Ok(stamp!(rows, device_id))
}

pub fn fetch_messages(
    pool: &DbPool,
    cursor_prev: String,
    resync_floor: Option<String>,
    device_id: String,
) -> Result<Vec<SyncedMessageRow>, AppError> {
    let rows = fetch(
        pool, "persona_messages", MESSAGE_COLS, "created_at", &cursor_prev,
        resync_floor.as_deref(), row_to_message,
    )?;
    Ok(stamp!(rows, device_id))
}

pub fn fetch_metrics(
    pool: &DbPool,
    cursor_prev: String,
    resync_floor: Option<String>,
    device_id: String,
) -> Result<Vec<SyncedMetricsRow>, AppError> {
    let rows = fetch(
        pool, "persona_metrics_snapshots", METRICS_COLS, "created_at", &cursor_prev,
        resync_floor.as_deref(), row_to_metrics,
    )?;
    Ok(stamp!(rows, device_id))
}

pub fn fetch_tool_usage(
    pool: &DbPool,
    cursor_prev: String,
    _resync_floor: Option<String>,
    device_id: String,
) -> Result<Vec<SyncedToolUsageRow>, AppError> {
    let rows = fetch(
        pool, "persona_tool_usage", TOOL_USAGE_COLS, "created_at", &cursor_prev, None, row_to_tool_usage,
    )?;
    Ok(stamp!(rows, device_id))
}
