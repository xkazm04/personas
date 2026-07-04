//! Repository for the durable Athena fleet-orchestration decision ledger
//! (`fleet_decisions`). Phase 5a — persists each per-session verdict (an
//! auto-fired action or a deferred consult) so (a) she can skip re-asking a
//! screen she already acted on, even across a restart (the in-memory screen-hash
//! map in `fleet_bridge` is per-run), and (b) the user can see WHY she
//! stopped/acted on a session.
//!
//! Append-only, best-effort at the call site: a ledger write must never block or
//! fail an orchestration decision. Lives in the main app DB (`state.db`,
//! `DbPool`) alongside `dev_llm_spend`.

use rusqlite::params;

use crate::db::DbPool;
use crate::error::AppError;

/// One row to append. `outcome` is the coarse verdict (`"auto_fired"` |
/// `"deferred"`); `defer_reason` explains a defer; `confidence` /
/// `decision_class` / `rationale` are Athena's self-reported proposal fields.
#[derive(Debug, Clone)]
pub struct FleetDecisionInsert {
    pub session_id: String,
    /// Stable Claude conversation id — the cross-restart dedupe key. `None` when
    /// the session hasn't bound one yet (a fresh spawn before SessionStart).
    pub claude_session_id: Option<String>,
    /// Hex of the screen hash Athena decided on (matches `fleet_bridge`'s hash).
    pub screen_hash: String,
    pub action: String,
    pub outcome: String,
    pub confidence: Option<String>,
    pub decision_class: Option<String>,
    pub defer_reason: Option<String>,
    pub rationale: Option<String>,
}

/// One row read back (observability surface).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FleetDecision {
    pub id: String,
    pub session_id: String,
    pub claude_session_id: Option<String>,
    pub screen_hash: String,
    pub action: String,
    pub outcome: String,
    pub confidence: Option<String>,
    pub decision_class: Option<String>,
    pub defer_reason: Option<String>,
    pub rationale: Option<String>,
    pub created_at: String,
}

/// Append a decision. Returns `Err` on DB failure; callers treat it as
/// best-effort (log + continue) — a ledger miss must never fail a real decision.
pub fn insert(pool: &DbPool, d: &FleetDecisionInsert) -> Result<(), AppError> {
    timed_query!("fleet_decisions", "fleet_decisions::insert", {
        let conn = pool.get()?;
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO fleet_decisions
                (id, session_id, claude_session_id, screen_hash, action, outcome,
                 confidence, decision_class, defer_reason, rationale)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                d.session_id,
                d.claude_session_id,
                d.screen_hash,
                d.action,
                d.outcome,
                d.confidence,
                d.decision_class,
                d.defer_reason,
                d.rationale,
            ],
        )?;
        Ok(())
    })
}

/// Best-effort convenience wrapper: append a decision, logging (not propagating)
/// any DB error. Use from hot decision paths where a ledger miss must be silent.
pub fn record(pool: &DbPool, d: &FleetDecisionInsert) {
    if let Err(err) = insert(pool, d) {
        tracing::warn!(
            error = %err,
            action = %d.action,
            outcome = %d.outcome,
            "fleet_decisions: ledger insert failed",
        );
    }
}

/// Whether Athena already recorded an AUTO-FIRED decision on this exact
/// (stable conversation id, screen). Used to suppress re-waking her on a screen
/// she already acted on, even across a restart — the in-memory dedupe is per-run.
/// Only `auto_fired` outcomes suppress; a prior defer may still warrant a fresh
/// look, and an unbound (`None`) claude_session_id is never deduped by the caller.
pub fn has_prior_autofire(
    pool: &DbPool,
    claude_session_id: &str,
    screen_hash: &str,
) -> Result<bool, AppError> {
    timed_query!("fleet_decisions", "fleet_decisions::has_prior_autofire", {
        let conn = pool.get()?;
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM fleet_decisions
             WHERE claude_session_id = ?1 AND screen_hash = ?2 AND outcome = 'auto_fired'",
            params![claude_session_id, screen_hash],
            |r| r.get(0),
        )?;
        Ok(n > 0)
    })
}

/// Recent decisions, newest first — for an observability surface.
pub fn recent(pool: &DbPool, limit: u32) -> Result<Vec<FleetDecision>, AppError> {
    timed_query!("fleet_decisions", "fleet_decisions::recent", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, session_id, claude_session_id, screen_hash, action, outcome,
                    confidence, decision_class, defer_reason, rationale, created_at
             FROM fleet_decisions ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| {
            Ok(FleetDecision {
                id: r.get(0)?,
                session_id: r.get(1)?,
                claude_session_id: r.get(2)?,
                screen_hash: r.get(3)?,
                action: r.get(4)?,
                outcome: r.get(5)?,
                confidence: r.get(6)?,
                decision_class: r.get(7)?,
                defer_reason: r.get(8)?,
                rationale: r.get(9)?,
                created_at: r.get(10)?,
            })
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    })
}
