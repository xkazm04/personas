//! Layer-two reports and reply-shape stats (layered voice).
//!
//! A report is what a `show_report` op leaves behind when the detail does not
//! belong in the layer-one reply: a `companion_chat_card` row with
//! `kind = 'report'`, `config_json = {"summary": …, "body": …}` and
//! `status = 'unread' | 'read'`. The reply links to it as
//! `[<phrase>](ref:report/<id>)`.
//!
//! This module owns the READ side and the wire types. The dispatcher (the
//! `show_report` op) owns the write side.
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
    /// Chat turns in the window (the population the other fields are over).
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

/// Reply-shape stats over the last `days` days.
///
/// WP0 stub: counts the chat turns in the window and leaves every measure
/// `null`, because no row carries the `outcome_json` shape keys yet. The real
/// aggregation lands with the dispatcher work that writes those keys.
pub fn reply_shape_stats(pool: &UserDbPool, days: u32) -> Result<ReplyShapeStats, AppError> {
    let days = days.clamp(1, 365);
    let conn = pool.get()?;
    let turns: i64 = conn.query_row(
        "SELECT COUNT(*) FROM companion_turn
          WHERE origin = 'chat' AND created_at >= datetime('now', ?1)",
        params![format!("-{days} days")],
        |r| r.get(0),
    )?;
    Ok(ReplyShapeStats {
        days,
        turns: u32::try_from(turns).unwrap_or(u32::MAX),
        median_words: None,
        p90_words: None,
        id_rate: None,
        ref_rate: None,
        reports_per_day: None,
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
    fn reply_shape_stats_stub_is_null_not_zero() -> Result<(), AppError> {
        let pool = crate::db::init_test_user_db()?;
        let stats = reply_shape_stats(&pool, 7)?;
        assert_eq!(stats.days, 7);
        assert_eq!(stats.turns, 0);
        assert_eq!(stats.median_words, None);
        assert_eq!(stats.reports_per_day, None);
        Ok(())
    }
}
