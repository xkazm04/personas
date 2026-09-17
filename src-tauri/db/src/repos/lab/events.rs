//! Per-result event stream for lab scenarios.
//!
//! Lab results in `lab_{eval,ab,arena,matrix,consensus}_results` keep only
//! aggregate scores + a flat list of tool names. The full typed event sequence
//! captured during the CLI execution lives here so the ScenarioDetailPanel can
//! render the actual conversation when a user drills into a row.

use rusqlite::{params, Row};

use crate::models::{CreateLabResultEventInput, LabResultEvent, LabResultKind};
use crate::query_builder::QueryBuilder;
use crate::DbPool;
use personas_core::error::AppError;

const PAYLOAD_PREVIEW_BYTES: usize = 2048;

fn truncate_preview(s: Option<String>) -> Option<String> {
    s.map(|mut v| {
        if v.len() > PAYLOAD_PREVIEW_BYTES {
            v.truncate(PAYLOAD_PREVIEW_BYTES);
            v.push_str("\n…[truncated]");
        }
        v
    })
}

fn row_to_event(row: &Row) -> rusqlite::Result<LabResultEvent> {
    Ok(LabResultEvent {
        id: row.get("id")?,
        result_id: row.get("result_id")?,
        result_kind: row.get("result_kind")?,
        event_index: row.get("event_index")?,
        event_type: row.get("event_type")?,
        tool_name: row.get("tool_name")?,
        tool_args_preview: row.get("tool_args_preview")?,
        tool_result_preview: row.get("tool_result_preview")?,
        text_preview: row.get("text_preview")?,
        ts_ms_relative: row.get("ts_ms_relative")?,
        created_at: row.get("created_at")?,
    })
}

/// Insert all captured events for a single lab result in one transaction.
/// Failure here is logged at the call site and does NOT fail the lab run —
/// scoring is the user-visible contract; the event log is a debugging aid.
pub fn insert_events_batch(
    pool: &DbPool,
    result_id: &str,
    kind: LabResultKind,
    events: &[CreateLabResultEventInput],
) -> Result<(), AppError> {
    if events.is_empty() {
        return Ok(());
    }
    timed_query!("lab_result_events", "lab_result_events::insert_batch", {
        let mut conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let kind_str = kind.as_str();

        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO lab_result_events
                    (id, result_id, result_kind, event_index, event_type,
                     tool_name, tool_args_preview, tool_result_preview, text_preview,
                     ts_ms_relative, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            )?;
            for ev in events {
                let id = uuid::Uuid::new_v4().to_string();
                stmt.execute(params![
                    id,
                    result_id,
                    kind_str,
                    ev.event_index,
                    ev.event_type,
                    ev.tool_name,
                    truncate_preview(ev.tool_args_preview.clone()),
                    truncate_preview(ev.tool_result_preview.clone()),
                    truncate_preview(ev.text_preview.clone()),
                    ev.ts_ms_relative,
                    now,
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    })
}

/// Read events for a result ordered by event_index ascending.
///
/// `limit`/`offset` are optional so existing callers stay unbounded. The UI
/// pages (first N + load-more) so a long CLI arena/eval cell does not dump
/// thousands of tool_use/tool_result rows in one IPC.
pub fn list_events_for_result(
    pool: &DbPool,
    result_id: &str,
    kind: LabResultKind,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<LabResultEvent>, AppError> {
    timed_query!("lab_result_events", "lab_result_events::list_for_result", {
        let conn = pool.get()?;
        let mut qb = QueryBuilder::new();
        qb.where_eq("result_id", result_id.to_string());
        qb.where_eq("result_kind", kind.as_str().to_string());
        qb.order_by("event_index", "ASC");
        if let Some(n) = limit {
            qb.limit(n);
        }
        if let Some(n) = offset {
            qb.offset(n);
        }
        let sql = qb.build_select(
            "SELECT id, result_id, result_kind, event_index, event_type,
                    tool_name, tool_args_preview, tool_result_preview, text_preview,
                    ts_ms_relative, created_at
             FROM lab_result_events",
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(qb.params_ref().as_slice(), row_to_event)
            .map_err(AppError::Database)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}
