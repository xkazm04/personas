//! Project pulse — the consolidated picture per (project, day). One
//! row per project per day; upserted across the day's ticks. The
//! consolidator (see `consolidator.rs`) writes these.

use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db::UserDbPool;
use crate::error::AppError;

/// A consolidated pulse for one project on one day. JSON columns are
/// stored as strings in SQLite; the wrapper helpers below parse/serialize.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PulseRow {
    pub project_id: String,
    pub day: String,
    pub narrative_md: String,
    pub directions: Vec<String>,
    pub tensions: Vec<String>,
    pub commit_count: i64,
    pub run_count: i64,
    pub note_count: i64,
    pub tokens_in: i64,
    pub tokens_out: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// Read today's pulse for one project. Returns None when no pulse has
/// been written for the (project, today) pair yet (the consolidator's
/// "first tick of the day" path).
pub fn load_today(
    pool: &UserDbPool,
    project_id: &str,
) -> Result<Option<PulseRow>, AppError> {
    let day = today_iso();
    load_for_day(pool, project_id, &day)
}

/// Read a pulse row for an arbitrary day. Used by the chat-context
/// retrieval path in Phase 5.
pub fn load_for_day(
    pool: &UserDbPool,
    project_id: &str,
    day: &str,
) -> Result<Option<PulseRow>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT project_id, day, narrative_md, directions_json, tensions_json,
                commit_count, run_count, note_count, tokens_in, tokens_out,
                created_at, updated_at
         FROM engine_project_pulse
         WHERE project_id = ?1 AND day = ?2",
    )?;
    stmt.query_row(params![project_id, day], parse_row)
        .optional()
        .map_err(AppError::from)
}

/// Read the most recent N days of pulses for a project, newest first.
/// Used by Phase 5 for "what's been happening on X this week" retrieval.
pub fn list_recent(
    pool: &UserDbPool,
    project_id: &str,
    limit: u32,
) -> Result<Vec<PulseRow>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT project_id, day, narrative_md, directions_json, tensions_json,
                commit_count, run_count, note_count, tokens_in, tokens_out,
                created_at, updated_at
         FROM engine_project_pulse
         WHERE project_id = ?1
         ORDER BY day DESC
         LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![project_id, limit], parse_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Aggregates passed to [`upsert_today`] alongside the LLM output.
/// Counts come from the consolidator's tally of new events (not from a
/// fresh DB query) so the math stays consistent across upserts.
pub struct PulseUpdate<'a> {
    pub narrative_md: &'a str,
    pub directions: &'a [String],
    pub tensions: &'a [String],
    pub commit_count_delta: i64,
    pub run_count_delta: i64,
    pub note_count_delta: i64,
    pub tokens_in_delta: i64,
    pub tokens_out_delta: i64,
}

/// Upsert today's pulse: inserts a fresh row on the day's first tick,
/// updates narrative + directions + tensions on subsequent ticks while
/// accumulating the count + token deltas. The day key is the local
/// date (UTC-equivalent — close enough for a per-project rollup, and
/// cheap to compute without a TZ database).
pub fn upsert_today(
    pool: &UserDbPool,
    project_id: &str,
    update: &PulseUpdate<'_>,
) -> Result<(), AppError> {
    let day = today_iso();
    let directions_json = serde_json::to_string(update.directions)?;
    let tensions_json = serde_json::to_string(update.tensions)?;

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO engine_project_pulse
         (project_id, day, narrative_md, directions_json, tensions_json,
          commit_count, run_count, note_count, tokens_in, tokens_out)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(project_id, day) DO UPDATE SET
           narrative_md = excluded.narrative_md,
           directions_json = excluded.directions_json,
           tensions_json = excluded.tensions_json,
           commit_count = engine_project_pulse.commit_count + excluded.commit_count,
           run_count = engine_project_pulse.run_count + excluded.run_count,
           note_count = engine_project_pulse.note_count + excluded.note_count,
           tokens_in = engine_project_pulse.tokens_in + excluded.tokens_in,
           tokens_out = engine_project_pulse.tokens_out + excluded.tokens_out,
           updated_at = datetime('now')",
        params![
            project_id,
            day,
            update.narrative_md,
            directions_json,
            tensions_json,
            update.commit_count_delta,
            update.run_count_delta,
            update.note_count_delta,
            update.tokens_in_delta,
            update.tokens_out_delta,
        ],
    )?;
    Ok(())
}

fn parse_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PulseRow> {
    let directions_json: String = row.get(3)?;
    let tensions_json: String = row.get(4)?;
    Ok(PulseRow {
        project_id: row.get(0)?,
        day: row.get(1)?,
        narrative_md: row.get(2)?,
        directions: serde_json::from_str(&directions_json).unwrap_or_default(),
        tensions: serde_json::from_str(&tensions_json).unwrap_or_default(),
        commit_count: row.get(5)?,
        run_count: row.get(6)?,
        note_count: row.get(7)?,
        tokens_in: row.get(8)?,
        tokens_out: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

/// ISO-8601 date for "today" in UTC. Matches the schema's `day` column
/// shape (`YYYY-MM-DD`).
pub fn today_iso() -> String {
    Utc::now().date_naive().format("%Y-%m-%d").to_string()
}

/// Convenience for the consolidator: returns `now` for the
/// `last_pulse_at` stamping after a successful pulse write.
pub fn now() -> DateTime<Utc> {
    Utc::now()
}
