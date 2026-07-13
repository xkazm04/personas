//! Chain stop reasons — the structured audit of *why a chain relay did not
//! continue* at each non-continuation path in the cascade evaluator.
//!
//! Before this table, every non-continuation was silent: a suppressed handoff,
//! a runtime cycle skip, the depth ceiling, an unmet predicate, a quarantined
//! trigger, or (Direction 3) a hit cost ceiling all just ended the relay with
//! zero surfaced signal. Each is now recorded as a row keyed by
//! `chain_trace_id`, so the Chain tab can render the end-of-chain reason and an
//! operator can answer "why did this chain stop?" per distributed trace.
//!
//! Written best-effort from [`crate::engine::chain::evaluate_chain_triggers`]
//! (a failed write never fails the cascade); read via
//! `get_chain_stop_reasons` for a given chain trace.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::DbPool;
use crate::error::AppError;

/// One recorded reason a chain relay did not continue past a given link.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChainStopReason {
    /// Unique row id.
    pub id: String,
    /// Distributed chain trace this stop belongs to.
    pub chain_trace_id: String,
    /// The SOURCE execution whose completion evaluated (and did not continue)
    /// this chain link.
    pub link_execution_id: String,
    /// The chain trigger that did not fire (None for whole-cascade halts such
    /// as the depth or budget ceiling, which are not tied to one trigger).
    pub trigger_id: Option<String>,
    /// The persona that would have run had the link fired (None when unknown).
    pub target_persona_id: Option<String>,
    /// Machine token for the reason — resolve to a label via
    /// `status_tokens.chain_stop` on the frontend. See
    /// [`crate::engine::chain::stop_reason`] for the vocabulary.
    pub reason_token: String,
    /// Human-readable specifics (e.g. the depth reached, the cost vs ceiling).
    pub detail: Option<String>,
    /// The chain depth at which the stop occurred.
    #[ts(type = "number")]
    pub chain_depth: u32,
    /// When the stop was recorded (RFC3339).
    pub created_at: String,
}

/// Borrowed input for [`record`] — avoids allocating owned strings at each of
/// the many call sites inside the cascade evaluator.
pub struct ChainStopReasonInput<'a> {
    pub chain_trace_id: &'a str,
    pub link_execution_id: &'a str,
    pub trigger_id: Option<&'a str>,
    pub target_persona_id: Option<&'a str>,
    pub reason_token: &'a str,
    pub detail: Option<String>,
    pub chain_depth: u32,
}

/// Record a single chain stop reason. Best-effort: the caller logs and
/// continues on error (a lost audit row must never fail a cascade).
pub fn record(pool: &DbPool, input: ChainStopReasonInput) -> Result<(), AppError> {
    timed_query!("chain_stop_reasons", "chain_stop_reasons::record", {
        let id = uuid::Uuid::new_v4().to_string();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO chain_stop_reasons
                (id, chain_trace_id, link_execution_id, trigger_id, target_persona_id,
                 reason_token, detail, chain_depth, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                input.chain_trace_id,
                input.link_execution_id,
                input.trigger_id,
                input.target_persona_id,
                input.reason_token,
                input.detail,
                input.chain_depth as i64,
                chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    })
}

/// All stop reasons for a chain trace, oldest first (chain order).
pub fn get_by_chain_trace_id(
    pool: &DbPool,
    chain_trace_id: &str,
) -> Result<Vec<ChainStopReason>, AppError> {
    timed_query!(
        "chain_stop_reasons",
        "chain_stop_reasons::get_by_chain_trace_id",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT id, chain_trace_id, link_execution_id, trigger_id, target_persona_id,
                        reason_token, detail, chain_depth, created_at
                 FROM chain_stop_reasons WHERE chain_trace_id = ?1 ORDER BY created_at ASC",
            )?;
            let rows = stmt.query_map(params![chain_trace_id], |row| {
                Ok(ChainStopReason {
                    id: row.get("id")?,
                    chain_trace_id: row.get("chain_trace_id")?,
                    link_execution_id: row.get("link_execution_id")?,
                    trigger_id: row.get("trigger_id")?,
                    target_persona_id: row.get("target_persona_id")?,
                    reason_token: row.get("reason_token")?,
                    detail: row.get("detail")?,
                    chain_depth: row.get::<_, i64>("chain_depth")? as u32,
                    created_at: row.get("created_at")?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::engine::chain::stop_reason;

    fn input<'a>(
        chain: &'a str,
        link: &'a str,
        token: &'a str,
        depth: u32,
    ) -> ChainStopReasonInput<'a> {
        ChainStopReasonInput {
            chain_trace_id: chain,
            link_execution_id: link,
            trigger_id: None,
            target_persona_id: None,
            reason_token: token,
            detail: None,
            chain_depth: depth,
        }
    }

    #[test]
    fn record_and_query_by_chain_trace_id() {
        let pool = init_test_db().unwrap();
        record(&pool, input("chain-A", "exec-1", stop_reason::CYCLE_DETECTED, 1)).unwrap();
        record(
            &pool,
            ChainStopReasonInput {
                trigger_id: Some("trig-9"),
                target_persona_id: Some("p-target"),
                detail: Some("chain depth 8 reached limit 8".into()),
                ..input("chain-A", "exec-2", stop_reason::DEPTH_LIMIT, 8)
            },
        )
        .unwrap();
        // A different chain is not returned.
        record(&pool, input("chain-B", "exec-3", stop_reason::PREDICATE_UNMET, 0)).unwrap();

        let rows = get_by_chain_trace_id(&pool, "chain-A").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].reason_token, stop_reason::CYCLE_DETECTED);
        assert_eq!(rows[1].reason_token, stop_reason::DEPTH_LIMIT);
        assert_eq!(rows[1].trigger_id.as_deref(), Some("trig-9"));
        assert_eq!(rows[1].target_persona_id.as_deref(), Some("p-target"));
        assert_eq!(rows[1].chain_depth, 8);
        assert!(rows[1].detail.as_deref().unwrap().contains("limit 8"));
    }

    #[test]
    fn empty_when_no_rows() {
        let pool = init_test_db().unwrap();
        assert!(get_by_chain_trace_id(&pool, "nope").unwrap().is_empty());
    }
}
