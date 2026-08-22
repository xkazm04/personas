//! Orchestration: the entry points, the LLM seam the two legs call through,
//! and the counters/notes a cycle accumulates as it walks.
//!
//! Moved verbatim out of the former single-file `sleep_cycle.rs`.

use std::time::Duration;

use serde::Serialize;

use super::admission::{admit, AdmittedCycle, CycleAdmission, CycleOutcome};
use super::limits::{PHASE_COMPRESS, PHASE_RECONCILE};
use super::phases::{phase_compress, phase_reconcile};
use super::report::render_report;
use crate::companion::brain::{cycle_report, episodic, oneshot};
use crate::companion::model_routing;
use crate::db::UserDbPool;
use crate::error::AppError;

/// Run one sleep cycle end to end, or report why it did not.
///
/// The one-call form. Both shipped callers take the two-step
/// [`admit`] → [`run_admitted`] path instead, because each needs the cycle id
/// before the phases start: the manual trigger answers with it, and the
/// night-shift tick gates its spawn on the (synchronous, cheap) admission
/// rather than spawning a task per tick that would only skip. This stays as the
/// obvious entry point for a caller that wants neither — a job, a CLI, a test.
#[allow(dead_code)]
pub async fn run_sleep_cycle(pool: &UserDbPool, force: bool) -> Result<CycleOutcome, AppError> {
    match admit(pool, force)? {
        CycleAdmission::Skipped(reason) => Ok(CycleOutcome::Skipped { reason }),
        CycleAdmission::Admitted(admitted) => run_admitted(pool, admitted).await,
    }
}

/// Run a cycle that has already been admitted. The scheduler and the manual
/// trigger both take this path so they can report the cycle id first and do the
/// work after.
pub async fn run_admitted(
    pool: &UserDbPool,
    admitted: AdmittedCycle,
) -> Result<CycleOutcome, AppError> {
    let llm = MeteredLegs { pool };
    run_admitted_with(pool, &llm, admitted).await
}

// ── The LLM seam ───────────────────────────────────────────────────────────

/// The cycle's one dependency on a model.
///
/// Narrow on purpose: a leg name, a prompt, a timeout, and text back. Every
/// decision the cycle makes about that text — parsing, validating, capping,
/// writing — is on this side of the seam and therefore testable without a
/// process spawn. In production the implementation is [`MeteredLegs`], which is
/// `oneshot::call_claude_text` and nothing else, so the cycle's cost lands in
/// `companion_turn` with `origin='maintenance'` for free (L1a, `c7249280c`).
#[async_trait::async_trait]
pub trait CycleLlm: Send + Sync {
    async fn call(&self, leg: &str, prompt: &str, timeout: Duration) -> Result<String, AppError>;
}

/// Production implementation: the metered one-shot legs.
pub struct MeteredLegs<'a> {
    pub pool: &'a UserDbPool,
}

#[async_trait::async_trait]
impl CycleLlm for MeteredLegs<'_> {
    async fn call(&self, leg: &str, prompt: &str, timeout: Duration) -> Result<String, AppError> {
        oneshot::call_claude_text(self.pool, prompt, model_routing::ASIDE.model, leg, timeout).await
    }
}

// ── Stats + notes ──────────────────────────────────────────────────────────

/// Everything the cycle counted. Serialised verbatim into
/// `companion_cycle.stats_json`; consumers tolerate unknown keys, same
/// versionless contract as `companion_turn.outcome_json`.
#[derive(Debug, Default, Serialize)]
pub(super) struct CycleStats {
    /// Episodes actually fed to the compress leg.
    pub(super) episodes_in: usize,
    /// Episodes that existed in the window — larger than `episodes_in` when a
    /// cap bit.
    pub(super) episodes_available: usize,
    pub(super) chars_in: usize,
    /// True when a cap dropped episodes or excerpted a body.
    pub(super) truncated: bool,
    /// Exclusive `created_at` boundary this cycle's window started AFTER —
    /// the previous completed cycle's `consumed_through`.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub(super) window_start: String,
    /// **The hand-off.** `created_at` of the newest episode this cycle actually
    /// fed to compress; the next cycle's window starts strictly after it and
    /// its pressure is measured from it.
    ///
    /// Absent on a cycle that read nothing (the boundary must not move) and on
    /// every pre-L1c cycle, which is why [`boundary_for`] keeps a `started_at`
    /// fallback.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) consumed_through: Option<String>,
    pub(super) facts_applied: usize,
    pub(super) facts_dropped: usize,
    pub(super) facts_dropped_over_cap: usize,
    pub(super) procedurals_applied: usize,
    pub(super) procedurals_dropped: usize,
    pub(super) procedurals_dropped_over_cap: usize,
    pub(super) unknown_tags_dropped: usize,
    pub(super) staged_consumed: usize,
    pub(super) staged_malformed: usize,
    pub(super) supersedes_applied: usize,
    pub(super) supersedes_dropped: usize,
    pub(super) tags_proposed: usize,
    pub(super) prune_candidates: usize,
    pub(super) contradictions: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) error: Option<String>,
}

impl CycleStats {
    pub(super) fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
    }
}

/// Human-facing material collected as the cycle walks, rendered into the report
/// at the end. Separate from [`CycleStats`] because a number and a sentence
/// serve different readers: the dashboard filters on the former, the operator
/// reads the latter over coffee.
#[derive(Debug, Default)]
pub(super) struct CycleNotes {
    pub(super) learned_facts: Vec<String>,
    pub(super) learned_procedurals: Vec<String>,
    pub(super) staged: Vec<String>,
    pub(super) proposed_tags: Vec<String>,
    pub(super) supersedes: Vec<String>,
    pub(super) contradictions: Vec<String>,
    pub(super) prune_candidates: Vec<String>,
    pub(super) truncation: Option<String>,
    /// Non-fatal things that went sideways — a dropped candidate, an id that
    /// pointed at nothing. Surfaced so "dropped 3" in the stats has a why.
    pub(super) caveats: Vec<String>,
}

// ── Orchestration ──────────────────────────────────────────────────────────

pub(super) async fn run_admitted_with(
    pool: &UserDbPool,
    llm: &dyn CycleLlm,
    mut admitted: AdmittedCycle,
) -> Result<CycleOutcome, AppError> {
    let cycle_id = admitted.cycle_id.clone();
    let mut stats = CycleStats::default();
    let mut notes = CycleNotes::default();

    // `take` rather than destructure: `admitted` owns the single-flight guard
    // and must stay alive until this function returns.
    let window = Window {
        boundary: admitted.boundary.clone(),
        episodes: std::mem::take(&mut admitted.episodes),
        available: admitted.available,
    };
    let result = run_phases(pool, llm, &cycle_id, window, &mut stats, &mut notes).await;

    let status = match &result {
        Ok(()) => cycle_report::STATUS_COMPLETED,
        Err(e) => {
            stats.error = Some(e.to_string());
            cycle_report::STATUS_FAILED
        }
    };
    let report = render_report(&cycle_id, status, &stats, &notes);

    // The report write is the last thing that can fail, and if it does the
    // cycle's own status must still land — otherwise a disk error would leave a
    // `running` row that looks like a crash.
    if let Err(e) = cycle_report::finish_cycle(pool, &cycle_id, status, &stats.to_json(), &report) {
        tracing::warn!(cycle_id = %cycle_id, error = %e, "sleep_cycle: finish_cycle failed");
        return Err(e);
    }

    tracing::info!(
        cycle_id = %cycle_id,
        status,
        facts = stats.facts_applied,
        procedurals = stats.procedurals_applied,
        staged = stats.staged_consumed,
        "sleep_cycle: finished"
    );
    Ok(CycleOutcome::Ran {
        cycle_id,
        status: status.to_string(),
    })
}

/// The slice of episodic memory one cycle is responsible for, measured at
/// admission and carried into compress unchanged.
pub(super) struct Window {
    /// The exclusive boundary it was measured after. Reported so a cycle's
    /// stats say where it picked up, not just where it stopped.
    pub(super) boundary: String,
    /// Oldest-first, fetch-capped.
    pub(super) episodes: Vec<episodic::Episode>,
    /// TRUE count past the boundary — the honest denominator, which can exceed
    /// `episodes.len()` because the fetch is itself capped.
    pub(super) available: usize,
}

async fn run_phases(
    pool: &UserDbPool,
    llm: &dyn CycleLlm,
    cycle_id: &str,
    window: Window,
    stats: &mut CycleStats,
    notes: &mut CycleNotes,
) -> Result<(), AppError> {
    match phase_compress(pool, llm, cycle_id, window, stats, notes).await {
        Ok(detail) => {
            cycle_report::record_phase(pool, cycle_id, PHASE_COMPRESS, "completed", &detail)?
        }
        Err(e) => {
            // Record before propagating: a phase that failed is a phase that
            // happened, and the audit trail is the only place that says which
            // one broke.
            let _ = cycle_report::record_phase(
                pool,
                cycle_id,
                PHASE_COMPRESS,
                "failed",
                &e.to_string(),
            );
            return Err(e);
        }
    }

    match phase_reconcile(pool, llm, cycle_id, stats, notes).await {
        Ok(detail) => {
            cycle_report::record_phase(pool, cycle_id, PHASE_RECONCILE, "completed", &detail)?
        }
        Err(e) => {
            let _ = cycle_report::record_phase(
                pool,
                cycle_id,
                PHASE_RECONCILE,
                "failed",
                &e.to_string(),
            );
            return Err(e);
        }
    }
    Ok(())
}
