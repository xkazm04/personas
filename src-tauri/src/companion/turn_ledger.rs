//! Athena turn ledger — durable per-turn usage accounting (`companion_turn`).
//!
//! Direction 6 / Phase A1 of `docs/plans/athena-value-expansion.md`.
//!
//! Every Claude CLI spawn Athena makes — a chat turn, an autonomous
//! continuation, a proactive reasoning turn, or one of the cheap headless
//! decision legs (execution triage, message triage, channel reactions, review
//! resolution) — streams a terminal `{"type":"result", …}` event carrying the
//! turn's real `total_cost_usd`, token `usage`, and `duration_ms`. Until now
//! that data was drained and dropped: Athena could triage the *fleet's* spend
//! while her own was invisible. This module records one row per turn so the
//! Overview dashboards (Phase A3/A4) can finally show what Athena costs and for
//! what kind of work.
//!
//! Capture is **best-effort and never blocks a turn.** A missing or unparseable
//! `result` event records a row with NULL usage fields (the turn still
//! happened); an insert failure is a `tracing::warn!` and nothing more.
//!
//! The table lives in the companion user DB (`personas_data.db`) next to the
//! other `companion_*` tables, so Athena's own `operations`/`personas_database`
//! introspection can reach it with no extra wiring.

use rusqlite::params;
use serde_json::Value;
use uuid::Uuid;

use crate::db::UserDbPool;
use crate::error::AppError;

/// Usage extracted from the CLI's terminal `result` stream-json event.
///
/// All fields are optional: older CLIs (or a turn that errored before the
/// `result` line) simply leave them `None`. Field names mirror the CLI's
/// `result` payload (`total_cost_usd`, `usage.cache_read_input_tokens`, …).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CliUsage {
    pub cost_usd: Option<f64>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_read_tokens: Option<i64>,
    pub cache_creation_tokens: Option<i64>,
    pub duration_ms: Option<i64>,
    pub num_turns: Option<i64>,
    pub is_error: bool,
}

impl CliUsage {
    /// Parse a stream-json line as a `result` event. Returns `None` when the
    /// line isn't a `result` (so callers can blindly feed every stdout line).
    /// Tolerant of missing sub-fields — anything absent stays `None`.
    pub fn from_result_event(value: &Value) -> Option<CliUsage> {
        if value.get("type").and_then(Value::as_str) != Some("result") {
            return None;
        }
        let usage = value.get("usage");
        let tok = |key: &str| -> Option<i64> {
            usage.and_then(|u| u.get(key)).and_then(Value::as_i64)
        };
        Some(CliUsage {
            cost_usd: value.get("total_cost_usd").and_then(Value::as_f64),
            input_tokens: tok("input_tokens"),
            output_tokens: tok("output_tokens"),
            cache_read_tokens: tok("cache_read_input_tokens"),
            cache_creation_tokens: tok("cache_creation_input_tokens"),
            duration_ms: value.get("duration_ms").and_then(Value::as_i64),
            num_turns: value.get("num_turns").and_then(Value::as_i64),
            is_error: value
                .get("is_error")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        })
    }

    /// Try to parse a raw stdout line as a `result` event. Convenience for the
    /// streaming loops that hold the line as a `&str`.
    pub fn from_line(line: &str) -> Option<CliUsage> {
        serde_json::from_str::<Value>(line)
            .ok()
            .and_then(|v| Self::from_result_event(&v))
    }
}

/// One row destined for `companion_turn`. Most fields are best-effort.
#[derive(Debug, Clone, Default)]
pub struct TurnRecord {
    /// `chat` | `autonomous` | `proactive` | `external` | `headless`.
    pub origin: String,
    /// Proactive trigger kind, or the headless leg label
    /// (`exec_triage` | `msg_triage` | `reaction` | `reaction_batch` |
    /// `review_resolution` | …). `None` for a plain chat turn.
    pub trigger_kind: Option<String>,
    pub model: Option<String>,
    pub usage: Option<CliUsage>,
    pub voice: bool,
    pub assistant_episode_id: Option<String>,
    /// Per-origin JSON blob — dispatcher side-effect counts for full turns,
    /// verdict counts for triage legs. Versionless; consumers tolerate gaps.
    pub outcome_json: Option<String>,
}

/// Record a turn and return its generated id. Best-effort: an insert failure
/// logs and returns `None` so the ledger can never break a real turn. The id
/// lets the headless triage legs attach verdict counts via [`update_outcome`]
/// once they've parsed the decision.
pub fn record_turn(pool: &UserDbPool, rec: &TurnRecord) -> Option<String> {
    match try_record_turn(pool, rec) {
        Ok(id) => Some(id),
        Err(e) => {
            tracing::warn!(error = %e, origin = %rec.origin, "companion: turn-ledger insert failed");
            None
        }
    }
}

fn try_record_turn(pool: &UserDbPool, rec: &TurnRecord) -> Result<String, AppError> {
    let id = format!("turn_{}", short_uuid());
    let u = rec.usage.clone().unwrap_or_default();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_turn
           (id, origin, trigger_kind, model, input_tokens, output_tokens,
            cache_read_tokens, cache_creation_tokens, cost_usd, duration_ms,
            num_turns, is_error, voice, assistant_episode_id, outcome_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            id,
            rec.origin,
            rec.trigger_kind,
            rec.model,
            u.input_tokens,
            u.output_tokens,
            u.cache_read_tokens,
            u.cache_creation_tokens,
            u.cost_usd,
            u.duration_ms,
            u.num_turns,
            u.is_error as i64,
            rec.voice as i64,
            rec.assistant_episode_id,
            rec.outcome_json,
        ],
    )?;
    Ok(id)
}

/// Best-effort: set the `outcome_json` on an existing ledger row. The headless
/// triage legs call this after parsing their decision so the health funnel
/// (A4) can report the drop / digest / attention / deep-dive distribution. A
/// no-op if the original insert failed (`turn_id` won't exist).
pub fn update_outcome(pool: &UserDbPool, turn_id: &str, outcome_json: &str) {
    let res = (|| -> Result<(), AppError> {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE companion_turn SET outcome_json = ?1 WHERE id = ?2",
            params![outcome_json, turn_id],
        )?;
        Ok(())
    })();
    if let Err(e) = res {
        tracing::warn!(error = %e, turn_id, "companion: turn-ledger outcome update failed");
    }
}

/// Delete ledger rows older than the retention window. Usage history earns a
/// longer window than the 30-day background-job retention. Mirrors
/// `jobs::prune_terminal_jobs`'s string-prefix cutoff comparison (the
/// `YYYY-MM-DD` prefix orders correctly across the `datetime('now')` /
/// RFC3339 separator difference).
pub fn prune_old_turns(pool: &UserDbPool) -> Result<usize, AppError> {
    const RETENTION_DAYS: i64 = 90;
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(RETENTION_DAYS)).to_rfc3339();
    let conn = pool.get()?;
    let n = conn.execute(
        "DELETE FROM companion_turn WHERE created_at < ?1",
        params![cutoff],
    )?;
    if n > 0 {
        tracing::info!(
            pruned = n,
            retention_days = RETENTION_DAYS,
            "companion: pruned old turn-ledger rows"
        );
    }
    Ok(n)
}

fn short_uuid() -> String {
    Uuid::new_v4().simple().to_string().chars().take(12).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;
    use serde_json::json;

    /// In-memory user pool with just the `companion_turn` table — mirrors the
    /// inline-pool idiom in `dispatcher.rs`'s tests (shared-cache file::memory:
    /// so every pooled connection sees the same tables).
    fn test_pool() -> UserDbPool {
        let manager = SqliteConnectionManager::file("file::memory:?cache=shared").with_flags(
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
                | rusqlite::OpenFlags::SQLITE_OPEN_CREATE
                | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        );
        let pool = Pool::builder()
            .max_size(2)
            .build(manager)
            .expect("build in-memory pool");
        pool.get()
            .expect("get conn")
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS companion_turn (
                    id TEXT PRIMARY KEY,
                    origin TEXT NOT NULL,
                    trigger_kind TEXT,
                    model TEXT,
                    input_tokens INTEGER,
                    output_tokens INTEGER,
                    cache_read_tokens INTEGER,
                    cache_creation_tokens INTEGER,
                    cost_usd REAL,
                    duration_ms INTEGER,
                    num_turns INTEGER,
                    is_error INTEGER NOT NULL DEFAULT 0,
                    voice INTEGER NOT NULL DEFAULT 0,
                    assistant_episode_id TEXT,
                    outcome_json TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );",
            )
            .expect("apply schema");
        pool
    }

    #[test]
    fn parses_full_result_event() {
        let line = json!({
            "type": "result",
            "subtype": "success",
            "is_error": false,
            "duration_ms": 4200,
            "num_turns": 3,
            "total_cost_usd": 0.1234,
            "usage": {
                "input_tokens": 1500,
                "output_tokens": 320,
                "cache_read_input_tokens": 8000,
                "cache_creation_input_tokens": 200
            }
        })
        .to_string();
        let u = CliUsage::from_line(&line).expect("should parse a result event");
        assert_eq!(u.cost_usd, Some(0.1234));
        assert_eq!(u.input_tokens, Some(1500));
        assert_eq!(u.output_tokens, Some(320));
        assert_eq!(u.cache_read_tokens, Some(8000));
        assert_eq!(u.cache_creation_tokens, Some(200));
        assert_eq!(u.duration_ms, Some(4200));
        assert_eq!(u.num_turns, Some(3));
        assert!(!u.is_error);
    }

    #[test]
    fn ignores_non_result_events() {
        for line in [
            r#"{"type":"system","session_id":"abc"}"#,
            r#"{"type":"assistant","message":{"content":[]}}"#,
            "not json at all",
        ] {
            assert_eq!(CliUsage::from_line(line), None, "line: {line}");
        }
    }

    #[test]
    fn tolerates_missing_usage_fields() {
        let line = r#"{"type":"result","is_error":true}"#;
        let u = CliUsage::from_line(line).expect("a bare result still parses");
        assert!(u.is_error);
        assert_eq!(u.cost_usd, None);
        assert_eq!(u.input_tokens, None);
        assert_eq!(u.num_turns, None);
    }

    #[test]
    fn records_and_prunes_against_in_memory_db() {
        let pool = test_pool();
        let id = record_turn(
            &pool,
            &TurnRecord {
                origin: "chat".into(),
                trigger_kind: None,
                model: Some("claude-opus-4-8".into()),
                usage: Some(CliUsage {
                    cost_usd: Some(0.42),
                    input_tokens: Some(100),
                    output_tokens: Some(50),
                    ..Default::default()
                }),
                voice: true,
                assistant_episode_id: Some("ep_xyz".into()),
                outcome_json: Some(r#"{"approvals":1}"#.into()),
            },
        )
        .expect("insert should return an id");
        let conn = pool.get().unwrap();
        let (origin, cost, voice): (String, f64, i64) = conn
            .query_row(
                "SELECT origin, cost_usd, voice FROM companion_turn LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(origin, "chat");
        assert!((cost - 0.42).abs() < 1e-9);
        assert_eq!(voice, 1);

        // update_outcome attaches verdict counts to the existing row.
        update_outcome(&pool, &id, r#"{"groups":3,"drop":2}"#);
        let outcome: String = conn
            .query_row(
                "SELECT outcome_json FROM companion_turn WHERE id = ?1",
                [&id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(outcome, r#"{"groups":3,"drop":2}"#);

        // Nothing older than the retention window yet → prune is a no-op.
        assert_eq!(prune_old_turns(&pool).unwrap(), 0);
    }
}
