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
//! **Failed turns are rows too.** A turn that never reached its reply — the CLI
//! failed to spawn, the 25-minute timeout fired, a stale `--resume` retry gave
//! up — records a row with `is_error = 1` and an `error_reason` token
//! (`session::FailedTurnCtx` drives this). Without it every error exit returned
//! before the ledger write and `is_error` was 0 on every row ever written, so
//! the health surface reported a flawless error rate *by construction*. Cost
//! capture stays best-effort on that path: a failed turn with unknown usage is
//! still a recorded failed turn.
//!
//! The table lives in the companion user DB (`personas_data.db`) next to the
//! other `companion_*` tables, so Athena's own `operations`/`personas_database`
//! introspection can reach it with no extra wiring.

use rusqlite::params;
use serde_json::Value;

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
    /// `{"constitution": 5123, "identity": 812, …}` — per-block char counts
    /// of the system prompt this turn was given (see
    /// `prompt::PromptBlockSizes`). `None` for the headless legs, which
    /// compose their own one-shot prompts rather than the full assembly.
    pub prompt_blocks_json: Option<String>,
    /// `{"constitution": "8f3a1c…", …}` — FNV-1a-64 hex of each block's exact
    /// bytes for the same turn (see `prompt::PromptBlockSizes::hashes_json`).
    /// Same population rule as `prompt_blocks_json`: set on tracked full
    /// turns, `None` on the headless legs.
    ///
    /// Sizes answer "how big"; only this answers "did it change". A block can
    /// hold its char count to the byte and still be rewritten every turn,
    /// which is what invalidates the prompt cache — the growth this exists to
    /// find (`cache_creation_tokens` 239,852 → 305,401 across chat turns) is
    /// invisible to the size column alone.
    pub prompt_block_hashes_json: Option<String>,
    /// Real `system_prompt.len()`. Pairs with `prompt_blocks_json` so a
    /// growth trend is one query, not a JSON parse per row.
    pub total_prompt_chars: Option<u32>,
    /// The turn did not complete. ORed with the CLI's own `result.is_error`
    /// when the row is written, so a turn is flagged whether the CLI reported
    /// the failure itself or the turn died before the CLI could.
    ///
    /// Until this existed, every error exit in `session::send_turn` returned
    /// *before* the ledger write, so `is_error` was 0 on every row ever
    /// written — the health surface reported a perfect error rate by
    /// construction. See `session::FailedTurnCtx`.
    pub failed: bool,
    /// Low-cardinality failure token (`timeout`, `spawn_failed`,
    /// `cli_nonzero_exit`, …) so `GROUP BY error_reason` stays useful. The raw
    /// message goes to `outcome_json.error` for diagnosis. `None` on a turn
    /// that ran.
    pub error_reason: Option<String>,
}

/// The ledger row for a turn that failed.
///
/// One construction site on purpose: the chat/background path
/// (`session::FailedTurnCtx`) and the headless decision legs
/// (`athena_reaction`) must never drift into two different failure shapes —
/// they feed the same `companion_get_health` number.
///
/// `reason` is the low-cardinality token (`session::classify_failure` is the
/// single taxonomy); the raw message rides truncated in `outcome_json.error`
/// for diagnosis. `usage` is best-effort and commonly `None` — a missing usage
/// block must never swallow the row. Callers may override `voice` after
/// construction; nothing else about a failed turn is caller-specific.
pub fn failed_turn_record(
    origin: &str,
    trigger_kind: Option<String>,
    model: Option<String>,
    reason: &str,
    raw_error: &str,
    usage: Option<CliUsage>,
) -> TurnRecord {
    TurnRecord {
        origin: origin.to_string(),
        trigger_kind,
        model,
        usage,
        voice: false,
        // A failed turn produced no reply to point at.
        assistant_episode_id: None,
        outcome_json: serde_json::to_string(&serde_json::json!({
            "error": crate::utils::text::truncate_on_char_boundary(raw_error, 500),
        }))
        .ok(),
        prompt_blocks_json: None,
        prompt_block_hashes_json: None,
        total_prompt_chars: None,
        failed: true,
        error_reason: Some(reason.to_string()),
    }
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
    let id = format!("turn_{}", crate::companion::util::short_id(12));
    let u = rec.usage.clone().unwrap_or_default();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_turn
           (id, origin, trigger_kind, model, input_tokens, output_tokens,
            cache_read_tokens, cache_creation_tokens, cost_usd, duration_ms,
            num_turns, is_error, voice, assistant_episode_id, outcome_json,
            prompt_blocks_json, total_prompt_chars, error_reason,
            prompt_block_hashes_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
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
            // Either signal flags the row: the CLI told us it errored, or the
            // turn died somewhere the CLI never got to report from.
            (u.is_error || rec.failed) as i64,
            rec.voice as i64,
            rec.assistant_episode_id,
            rec.outcome_json,
            rec.prompt_blocks_json,
            rec.total_prompt_chars,
            rec.error_reason,
            rec.prompt_block_hashes_json,
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
/// longer window than the 30-day background-job retention. `created_at` is
/// stored via `datetime('now')` (`"YYYY-MM-DD HH:MM:SS"`, space separator),
/// so the cutoff must be formatted the same way rather than as RFC3339
/// (`T` separator) — a same-day string comparison of the two encodings
/// would order every row on the boundary day as "older" regardless of
/// time-of-day.
pub fn prune_old_turns(pool: &UserDbPool) -> Result<usize, AppError> {
    const RETENTION_DAYS: i64 = 90;
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(RETENTION_DAYS))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
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

#[cfg(test)]
mod tests {
    use super::*;
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;
    use serde_json::json;

    /// In-memory user pool with just the `companion_turn` table — mirrors the
    /// inline-pool idiom in `dispatcher.rs`'s tests (shared-cache file::memory:
    /// so every pooled connection sees the same tables).
    ///
    /// `name` MUST be unique per test. libtest runs these in parallel threads
    /// and a bare `file::memory:?cache=shared` is ONE database process-wide —
    /// every test would then insert into the same `companion_turn` and the
    /// `LIMIT 1` / `SUM(is_error)` assertions below would read each other's
    /// rows. Naming the shared-cache DB per test keeps them isolated while
    /// still letting every pooled connection see the same tables.
    fn test_pool(name: &str) -> UserDbPool {
        let manager =
            SqliteConnectionManager::file(format!("file:{name}?mode=memory&cache=shared"))
                .with_flags(
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
                    prompt_blocks_json TEXT,
                    total_prompt_chars INTEGER,
                    error_reason TEXT,
                    prompt_block_hashes_json TEXT,
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
        let pool = test_pool("ledger_roundtrip");
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
                prompt_blocks_json: Some(r#"{"constitution":120,"identity":40}"#.into()),
                prompt_block_hashes_json: Some(
                    r#"{"constitution":"00000000000000aa","identity":"00000000000000bb"}"#.into(),
                ),
                total_prompt_chars: Some(1234),
                failed: false,
                error_reason: None,
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

        // The prompt-size ledger round-trips through the same row.
        let (blocks, chars, hashes): (String, i64, String) = conn
            .query_row(
                "SELECT prompt_blocks_json, total_prompt_chars, prompt_block_hashes_json
                 FROM companion_turn LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(blocks, r#"{"constitution":120,"identity":40}"#);
        assert_eq!(chars, 1234);
        // …and so does the churn half. Sizes without hashes cannot tell a
        // stable block from one that is rewritten every turn.
        assert_eq!(
            hashes,
            r#"{"constitution":"00000000000000aa","identity":"00000000000000bb"}"#
        );

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

    /// The whole point of the `failed` flag: a turn that died before the CLI
    /// could report anything still lands an `is_error = 1` row with a reason.
    /// Cost capture is best-effort — a missing usage block must NOT swallow
    /// the row (criterion 4 of "a failed turn is recorded").
    #[test]
    fn records_a_failed_turn_with_no_usage_at_all() {
        let pool = test_pool("ledger_failed_no_usage");
        record_turn(
            &pool,
            &TurnRecord {
                origin: "chat".into(),
                failed: true,
                error_reason: Some("timeout".into()),
                outcome_json: Some(r#"{"error":"Turn exceeded 25-minute timeout"}"#.into()),
                usage: None,
                ..Default::default()
            },
        )
        .expect("a failed turn with unknown cost is still a recorded failed turn");

        let conn = pool.get().unwrap();
        let (is_error, reason, cost): (i64, String, Option<f64>) = conn
            .query_row(
                "SELECT is_error, error_reason, cost_usd FROM companion_turn LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(is_error, 1, "the failure must be visible to the health query");
        assert_eq!(reason, "timeout");
        assert_eq!(cost, None, "unknown cost stays NULL rather than blocking the row");

        // And it is what `companion_get_health` actually counts.
        let errors: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(is_error), 0) FROM companion_turn",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(errors, 1);
    }

    /// A failure that DID get a `result` event keeps the CLI's real cost —
    /// best-effort capture on the failure path, not an all-or-nothing.
    #[test]
    fn a_failed_turn_keeps_whatever_usage_the_cli_reported() {
        let pool = test_pool("ledger_failed_with_usage");
        record_turn(
            &pool,
            &TurnRecord {
                origin: "external".into(),
                trigger_kind: Some("Fleet".into()),
                failed: true,
                error_reason: Some("cli_nonzero_exit".into()),
                usage: Some(CliUsage {
                    cost_usd: Some(0.07),
                    input_tokens: Some(900),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .expect("insert");
        let conn = pool.get().unwrap();
        let (is_error, cost, origin): (i64, f64, String) = conn
            .query_row(
                "SELECT is_error, cost_usd, origin FROM companion_turn LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(is_error, 1);
        assert!((cost - 0.07).abs() < 1e-9, "the spend survives the failure");
        assert_eq!(origin, "external");
    }

    /// `is_error` is the OR of both signals — the CLI reporting its own error
    /// must still flag the row on a turn we considered successful.
    #[test]
    fn cli_reported_error_flags_the_row_without_the_failed_bit() {
        let pool = test_pool("ledger_cli_reported_error");
        record_turn(
            &pool,
            &TurnRecord {
                origin: "chat".into(),
                failed: false,
                usage: Some(CliUsage {
                    is_error: true,
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .expect("insert");
        let flagged: i64 = conn_scalar(&pool, "SELECT is_error FROM companion_turn LIMIT 1");
        assert_eq!(flagged, 1);
    }

    fn conn_scalar(pool: &UserDbPool, sql: &str) -> i64 {
        pool.get()
            .unwrap()
            .query_row(sql, [], |r| r.get(0))
            .unwrap()
    }
}
