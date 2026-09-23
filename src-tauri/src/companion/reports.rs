//! Layer-two reports and reply-shape stats (layered voice).
//!
//! A report is what a `show_report` op leaves behind when the detail does not
//! belong in the layer-one reply: a `companion_chat_card` row with
//! `kind = 'report'`, `config_json = {"summary": …, "body": …}` and
//! `status = 'unread' | 'read'`. The reply links to it as
//! `[<phrase>](ref:report/<id>)`.
//!
//! This module owns the row: the insert the dispatcher's `show_report` arm
//! calls, the read side, and the reply-shape stats over the turn ledger.
//!
//! Contract: `docs/features/companion/layered-voice.md`.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::UserDbPool;
use crate::error::AppError;

/// `companion_chat_card.kind` of a report row.
pub const REPORT_KIND: &str = "report";

/// Report statuses. A report is minted `unread`; opening it marks it `read`.
pub const REPORT_STATUS_UNREAD: &str = "unread";
pub const REPORT_STATUS_READ: &str = "read";

/// Caps from the `show_report` op contract (chars).
pub const MAX_REPORT_TITLE_CHARS: usize = 80;
pub const MAX_REPORT_SUMMARY_CHARS: usize = 240;
pub const MAX_REPORT_BODY_CHARS: usize = 12_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CompanionReport {
    pub id: String,
    pub title: String,
    pub summary: Option<String>,
    /// Markdown.
    pub body: String,
    /// `unread` | `read`.
    pub status: String,
    pub created_at: String,
}

/// How Athena's replies have been shaped over a window. Every measure is
/// `null` when it was not measured (no rows carrying the key), never `0`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ReplyShapeStats {
    #[ts(type = "number")]
    pub days: u32,
    /// Layer-one turns (origin chat, autonomous or proactive) in the window:
    /// the population the other fields are measured over.
    #[ts(type = "number")]
    pub turns: u32,
    #[ts(type = "number | null")]
    pub median_words: Option<f64>,
    #[ts(type = "number | null")]
    pub p90_words: Option<f64>,
    /// Share of measured replies with at least one bare id (0..1).
    #[ts(type = "number | null")]
    pub id_rate: Option<f64>,
    /// Share of measured replies with at least one ref link (0..1).
    #[ts(type = "number | null")]
    pub ref_rate: Option<f64>,
    #[ts(type = "number | null")]
    pub reports_per_day: Option<f64>,
}

/// The `config_json` shape of a report row.
#[derive(Debug, Deserialize)]
struct ReportConfig {
    summary: Option<String>,
    #[serde(default)]
    body: String,
}

/// One report by id. `NotFound` when there is no such row or it is not a report.
pub fn get_report(pool: &UserDbPool, id: &str) -> Result<CompanionReport, AppError> {
    let conn = pool.get()?;
    let row: Option<(String, Option<String>, String, String, String)> = conn
        .query_row(
            "SELECT id, title, config_json, status, created_at
               FROM companion_chat_card
              WHERE id = ?1 AND kind = ?2",
            params![id, REPORT_KIND],
            |r| {
                Ok((
                    r.get("id")?,
                    r.get("title")?,
                    r.get("config_json")?,
                    r.get("status")?,
                    r.get("created_at")?,
                ))
            },
        )
        .optional()?;
    let Some((id, title, config_json, status, created_at)) = row else {
        return Err(AppError::NotFound(format!("report `{id}` not found")));
    };
    let config: ReportConfig = serde_json::from_str(&config_json)?;
    Ok(CompanionReport {
        id,
        title: title.unwrap_or_default(),
        summary: config.summary.filter(|s| !s.trim().is_empty()),
        body: config.body,
        status,
        created_at,
    })
}

/// Mark a report read. Idempotent; `NotFound` when there is no such report.
pub fn mark_report_read(pool: &UserDbPool, id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    let changed = conn.execute(
        "UPDATE companion_chat_card
            SET status = ?3,
                resolved_at = COALESCE(resolved_at, datetime('now'))
          WHERE id = ?1 AND kind = ?2",
        params![id, REPORT_KIND, REPORT_STATUS_READ],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("report `{id}` not found")));
    }
    Ok(())
}

/// Mark appended to a report body cut at [`MAX_REPORT_BODY_CHARS`].
pub const REPORT_TRUNCATED_MARKER: &str = "\n\n*(report truncated)*";

/// Persist one report and return its id. The write side of `show_report`:
/// the dispatcher calls it BEFORE the chat-card event goes out, so the card
/// and every `ref:report/<id>` link point at a row that already exists.
///
/// Reports need their own insert rather than `chat_cards::insert_card`: that
/// one mints `status = 'pending'`, which is the "waiting on you" state, and a
/// report is never waiting on anyone. `unread` keeps it out of every
/// pending-card query by construction.
///
/// Validation is the caller's (the dispatcher's) job; this only refuses what
/// the row itself cannot hold.
pub fn insert_report(
    pool: &UserDbPool,
    conversation_id: &str,
    episode_id: Option<&str>,
    title: &str,
    summary: Option<&str>,
    body: &str,
) -> Result<String, AppError> {
    let conversation_id = conversation_id.trim();
    personas_core::validation::require_non_empty("report conversation id", conversation_id)?;
    personas_core::validation::require_non_empty("report title", title)?;
    let config_json = serde_json::json!({
        "summary": summary.map(str::trim).filter(|s| !s.is_empty()),
        "body": body,
    })
    .to_string();
    let id = uuid::Uuid::new_v4().to_string();
    pool.get()?.execute(
        "INSERT INTO companion_chat_card
             (id, conversation_id, episode_id, kind, title, config_json, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            conversation_id,
            episode_id,
            REPORT_KIND,
            title.trim(),
            config_json,
            REPORT_STATUS_UNREAD
        ],
    )?;
    Ok(id)
}

/// Stamp the assistant episode onto reports minted before it existed (the
/// dispatcher runs before the reply is persisted). Only fills a missing
/// episode; best-effort, since a report without its episode still opens.
pub fn attach_episode(pool: &UserDbPool, report_ids: &[String], episode_id: &str) {
    let Ok(conn) = pool.get() else {
        return;
    };
    for id in report_ids {
        if let Err(e) = conn.execute(
            "UPDATE companion_chat_card SET episode_id = ?2
              WHERE id = ?1 AND kind = ?3 AND episode_id IS NULL",
            params![id, episode_id, REPORT_KIND],
        ) {
            tracing::warn!(report_id = %id, error = %e, "report: episode stamp failed");
        }
    }
}

/// Turn origins the reply-shape stats read. `external` (remote devices, the
/// bench) and the headless rows are not layer-one replies to him.
const SHAPE_ORIGINS_SQL: &str = "('chat', 'autonomous', 'proactive')";

/// Nearest-rank percentile over a sorted slice, the same rule as
/// `scripts/test/lib/reply-shape.mjs` `percentile`.
fn percentile(sorted: &[f64], p: f64) -> Option<f64> {
    if sorted.is_empty() {
        return None;
    }
    let idx = ((p / 100.0) * sorted.len() as f64).floor() as usize;
    Some(sorted[idx.min(sorted.len() - 1)])
}

/// Reply-shape stats over the last `days` days, from the layered-voice keys
/// the turn ledger writes into `companion_turn.outcome_json` (`replyWords`,
/// `bareIds`, `refLinks`, `reportEmitted`). A measure is `None` when no row in
/// the window carries its key: absent means not measured, never 0.
pub fn reply_shape_stats(pool: &UserDbPool, days: u32) -> Result<ReplyShapeStats, AppError> {
    let days = days.clamp(1, 365);
    let window = format!("-{days} days");
    let conn = pool.get()?;
    let turns: i64 = conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM companion_turn
              WHERE origin IN {SHAPE_ORIGINS_SQL} AND created_at >= datetime('now', ?1)"
        ),
        params![window],
        |r| r.get(0),
    )?;
    let mut stmt = conn.prepare(&format!(
        "SELECT outcome_json FROM companion_turn
          WHERE origin IN {SHAPE_ORIGINS_SQL}
            AND created_at >= datetime('now', ?1)
            AND outcome_json LIKE '%\"replyWords\"%'"
    ))?;
    let blobs = stmt
        .query_map(params![window], |r| r.get::<_, Option<String>>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    let mut words: Vec<f64> = Vec::new();
    let (mut id_rows, mut id_hits) = (0u32, 0u32);
    let (mut ref_rows, mut ref_hits) = (0u32, 0u32);
    let (mut report_rows, mut reports) = (0u32, 0u32);
    for blob in blobs.into_iter().flatten() {
        // Tolerant of shape drift: a row that does not parse is skipped, not
        // an error for the whole window.
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&blob) else {
            continue;
        };
        if let Some(w) = v.get("replyWords").and_then(|x| x.as_f64()) {
            words.push(w);
        }
        if let Some(n) = v.get("bareIds").and_then(|x| x.as_u64()) {
            id_rows += 1;
            id_hits += u32::from(n > 0);
        }
        if let Some(n) = v.get("refLinks").and_then(|x| x.as_u64()) {
            ref_rows += 1;
            ref_hits += u32::from(n > 0);
        }
        if let Some(emitted) = v.get("reportEmitted") {
            report_rows += 1;
            reports += match emitted {
                serde_json::Value::Bool(b) => u32::from(*b),
                other => other.as_u64().map_or(0, |n| n as u32),
            };
        }
    }
    words.sort_by(|a, b| a.total_cmp(b));
    let rate = |hits: u32, rows: u32| (rows > 0).then(|| f64::from(hits) / f64::from(rows));
    Ok(ReplyShapeStats {
        days,
        turns: u32::try_from(turns).unwrap_or(u32::MAX),
        median_words: percentile(&words, 50.0),
        p90_words: percentile(&words, 90.0),
        id_rate: rate(id_hits, id_rows),
        ref_rate: rate(ref_hits, ref_rows),
        reports_per_day: (report_rows > 0).then(|| f64::from(reports) / f64::from(days)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn insert_report(pool: &UserDbPool, id: &str, config_json: &str) -> Result<(), AppError> {
        pool.get()?.execute(
            "INSERT INTO companion_chat_card (id, conversation_id, kind, title, config_json, status)
             VALUES (?1, 'conv', 'report', 'Weekly spend', ?2, 'unread')",
            params![id, config_json],
        )?;
        Ok(())
    }

    #[test]
    fn report_reads_back_and_marks_read() -> Result<(), AppError> {
        let pool = crate::db::init_test_user_db()?;
        insert_report(
            &pool,
            "r1",
            r##"{"summary":"Up 12%","body":"# Spend\n..."}"##,
        )?;

        let report = get_report(&pool, "r1")?;
        assert_eq!(report.title, "Weekly spend");
        assert_eq!(report.summary.as_deref(), Some("Up 12%"));
        assert_eq!(report.body, "# Spend\n...");
        assert_eq!(report.status, REPORT_STATUS_UNREAD);

        mark_report_read(&pool, "r1")?;
        mark_report_read(&pool, "r1")?;
        assert_eq!(get_report(&pool, "r1")?.status, REPORT_STATUS_READ);
        Ok(())
    }

    #[test]
    fn report_missing_or_other_kind_is_not_found() -> Result<(), AppError> {
        let pool = crate::db::init_test_user_db()?;
        pool.get()?.execute(
            "INSERT INTO companion_chat_card (id, conversation_id, kind, config_json)
             VALUES ('c1', 'conv', 'fleet_plan', '{}')",
            [],
        )?;
        assert!(matches!(
            get_report(&pool, "c1"),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            get_report(&pool, "nope"),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            mark_report_read(&pool, "c1"),
            Err(AppError::NotFound(_))
        ));
        Ok(())
    }

    #[test]
    fn reply_shape_stats_is_null_not_zero_when_unmeasured() -> Result<(), AppError> {
        let pool = crate::db::init_test_user_db()?;
        let stats = reply_shape_stats(&pool, 7)?;
        assert_eq!(stats.days, 7);
        assert_eq!(stats.turns, 0);
        assert_eq!(stats.median_words, None);
        assert_eq!(stats.reports_per_day, None);
        Ok(())
    }
}
