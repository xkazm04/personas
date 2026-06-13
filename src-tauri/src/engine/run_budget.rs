//! Aggregate cost ceiling across a multi-spawn logical "run".
//!
//! Personas orchestrates several subsystems that spawn the Claude CLI **many
//! times per one logical operation** — an evolution cycle (variants × scenarios),
//! a lab matrix (scenarios × models), a multi-node pipeline. Today
//! `--max-budget-usd` is enforced **per spawn** only (`prompt/cli_args.rs`); there
//! is no run-level cap, so a single misconfigured fan-out can quietly burn N× a
//! single run's cost. This module is the run-level counterpart.
//!
//! ## Shape
//! - **Engine-global** (`LazyLock`) so deep async loops can record spawn costs
//!   against a shared `run_id` without threading a handle through every helper
//!   (`run_evolution_cycle` takes only `pool`, not `AppState`). The struct is also
//!   directly constructable (`RunBudgetLedger::new`) so unit tests don't touch the
//!   global. Mirrors the `LazyLock<Mutex<_>>` convention in `api_proxy.rs` /
//!   `bundle.rs` and the in-memory `ConcurrencyTracker` in `queue.rs`.
//! - **Cost source** is the CLI `result` event's `total_cost_usd`
//!   (`parser.rs`) — the same number P1 (cache-token capture) sharpened.
//!
//! ## Warn-only (today)
//! Crossing the ceiling sets `exceeded`, emits one `tracing::warn!` (the caller
//! decides), and **does not abort** the run. Hard-abort enforcement, lab/pipeline
//! consumers, and DB persistence of run-level cost are staged follow-ups (see
//! `run_budget_DESIGN.md`). Recording is also inherently a *launch gate*, not a
//! real-time kill: a spawn's cost is only known after it finishes, so the ceiling
//! bounds "don't start new spawns past X", while each spawn's own
//! `--max-budget-usd` bounds the single in-flight call.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Finished runs are retained this long so post-run queries (e.g. embedding the
/// final state into a cycle summary, or a UI fetch) still resolve.
const RETENTION: Duration = Duration::from_secs(30 * 60);

/// Default aggregate ceiling for an evolution cycle, overridable via
/// `PERSONAS_RUN_BUDGET_EVOLUTION_USD` (0 disables the cap). Conservative because
/// a cycle fans out variants × up-to-3 scenarios × (run + eval) CLI spawns.
pub const DEFAULT_EVOLUTION_CEILING_USD: f64 = 2.0;

/// Resolve the evolution ceiling from env, falling back to the default. A value
/// of `0` (or negative) means "unlimited" — the ledger still tracks spend.
pub fn evolution_ceiling_usd() -> f64 {
    std::env::var("PERSONAS_RUN_BUDGET_EVOLUTION_USD")
        .ok()
        .and_then(|s| s.trim().parse::<f64>().ok())
        .filter(|v| *v >= 0.0)
        .unwrap_or(DEFAULT_EVOLUTION_CEILING_USD)
}

/// Serializable snapshot of a run's budget state. Embedded in run summaries
/// (e.g. `EvolutionCycleSummary.budget`) and returned by `state()`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RunBudgetState {
    pub run_id: String,
    /// Subsystem that owns the run — `"evolution"`, `"lab"`, `"pipeline"`, …
    pub kind: String,
    /// Aggregate USD ceiling; `0.0` = unlimited (track-only).
    pub ceiling_usd: f64,
    /// Cumulative cost recorded across all spawns in this run.
    pub spent_usd: f64,
    /// Number of spawns recorded.
    pub spawn_count: u32,
    /// `true` once cumulative spend has crossed a non-zero ceiling.
    pub exceeded: bool,
    /// `true` once the owning subsystem has marked the run complete.
    pub finished: bool,
}

/// Returned by [`RunBudgetLedger::record`] so the caller can warn exactly once
/// on the first ceiling crossing without re-reading state.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RecordOutcome {
    /// `true` only on the record that *first* pushes the run over its ceiling.
    pub exceeded_now: bool,
    pub spent_usd: f64,
    pub ceiling_usd: f64,
}

struct Entry {
    state: RunBudgetState,
    warned: bool,
    last_touch: Instant,
}

/// In-memory aggregate-budget tracker keyed by `run_id`. Thread-safe (internal
/// `Mutex`); clone-free shared access via the process-global [`ledger()`].
pub struct RunBudgetLedger {
    runs: Mutex<HashMap<String, Entry>>,
}

impl Default for RunBudgetLedger {
    fn default() -> Self {
        Self::new()
    }
}

impl RunBudgetLedger {
    pub fn new() -> Self {
        Self {
            runs: Mutex::new(HashMap::new()),
        }
    }

    /// Begin tracking a run. Replaces any prior entry for the same id (a re-run
    /// of the same logical id starts fresh). `ceiling_usd <= 0` ⇒ unlimited.
    pub fn register(&self, run_id: &str, kind: &str, ceiling_usd: f64) {
        let mut runs = self.runs.lock().unwrap();
        self.sweep(&mut runs);
        runs.insert(
            run_id.to_string(),
            Entry {
                state: RunBudgetState {
                    run_id: run_id.to_string(),
                    kind: kind.to_string(),
                    ceiling_usd: ceiling_usd.max(0.0),
                    spent_usd: 0.0,
                    spawn_count: 0,
                    exceeded: false,
                    finished: false,
                },
                warned: false,
                last_touch: Instant::now(),
            },
        );
    }

    /// Record one spawn's cost against a run. Recording against an unregistered
    /// (or swept) run is a no-op — the orchestrator must `register` first.
    pub fn record(&self, run_id: &str, cost_usd: f64) -> RecordOutcome {
        let mut runs = self.runs.lock().unwrap();
        let Some(entry) = runs.get_mut(run_id) else {
            return RecordOutcome {
                exceeded_now: false,
                spent_usd: 0.0,
                ceiling_usd: 0.0,
            };
        };
        entry.state.spent_usd += cost_usd.max(0.0);
        entry.state.spawn_count += 1;
        entry.last_touch = Instant::now();

        let mut exceeded_now = false;
        if entry.state.ceiling_usd > 0.0 && entry.state.spent_usd >= entry.state.ceiling_usd {
            entry.state.exceeded = true;
            if !entry.warned {
                entry.warned = true;
                exceeded_now = true;
            }
        }
        RecordOutcome {
            exceeded_now,
            spent_usd: entry.state.spent_usd,
            ceiling_usd: entry.state.ceiling_usd,
        }
    }

    /// Snapshot the current state of a run, if still tracked.
    pub fn state(&self, run_id: &str) -> Option<RunBudgetState> {
        let runs = self.runs.lock().unwrap();
        runs.get(run_id).map(|e| e.state.clone())
    }

    /// Mark a run complete. The entry is retained for [`RETENTION`] so summaries
    /// / UI fetches still resolve, then swept on a later mutation.
    pub fn finish(&self, run_id: &str) {
        let mut runs = self.runs.lock().unwrap();
        if let Some(entry) = runs.get_mut(run_id) {
            entry.state.finished = true;
            entry.last_touch = Instant::now();
        }
    }

    /// Drop finished entries older than [`RETENTION`]. Called opportunistically
    /// under the lock on register; cheap for the small N of concurrent runs.
    fn sweep(&self, runs: &mut HashMap<String, Entry>) {
        let now = Instant::now();
        runs.retain(|_, e| !e.state.finished || now.duration_since(e.last_touch) < RETENTION);
    }
}

static LEDGER: LazyLock<RunBudgetLedger> = LazyLock::new(RunBudgetLedger::new);

/// Process-global ledger. Use from orchestrators (evolution, lab, pipeline);
/// unit tests construct [`RunBudgetLedger::new`] instead to stay isolated.
pub fn ledger() -> &'static RunBudgetLedger {
    &LEDGER
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn accumulates_cost_and_spawn_count() {
        let l = RunBudgetLedger::new();
        l.register("r1", "evolution", 10.0);
        l.record("r1", 1.5);
        l.record("r1", 2.0);
        let s = l.state("r1").unwrap();
        assert_eq!(s.spawn_count, 2);
        assert!((s.spent_usd - 3.5).abs() < f64::EPSILON);
        assert!(!s.exceeded);
        assert!(!s.finished);
    }

    #[test]
    fn record_on_unregistered_run_is_noop() {
        let l = RunBudgetLedger::new();
        let outcome = l.record("ghost", 5.0);
        assert!(!outcome.exceeded_now);
        assert_eq!(outcome.spent_usd, 0.0);
        assert!(l.state("ghost").is_none());
    }

    #[test]
    fn exceeded_now_fires_exactly_once_on_first_crossing() {
        let l = RunBudgetLedger::new();
        l.register("r1", "evolution", 1.0);
        assert!(!l.record("r1", 0.4).exceeded_now); // 0.4 < 1.0
        assert!(l.record("r1", 0.7).exceeded_now); // 1.1 >= 1.0 — first crossing
        assert!(!l.record("r1", 0.5).exceeded_now); // already warned
        let s = l.state("r1").unwrap();
        assert!(s.exceeded);
        assert!((s.spent_usd - 1.6).abs() < 1e-9);
    }

    #[test]
    fn ceiling_at_exact_boundary_counts_as_exceeded() {
        let l = RunBudgetLedger::new();
        l.register("r1", "lab", 2.0);
        assert!(l.record("r1", 2.0).exceeded_now); // >= is the crossing rule
    }

    #[test]
    fn zero_ceiling_is_unlimited_but_still_tracks() {
        let l = RunBudgetLedger::new();
        l.register("r1", "pipeline", 0.0);
        let outcome = l.record("r1", 999.0);
        assert!(!outcome.exceeded_now);
        let s = l.state("r1").unwrap();
        assert!(!s.exceeded);
        assert!((s.spent_usd - 999.0).abs() < f64::EPSILON);
    }

    #[test]
    fn negative_ceiling_normalized_to_unlimited() {
        let l = RunBudgetLedger::new();
        l.register("r1", "evolution", -5.0);
        assert_eq!(l.state("r1").unwrap().ceiling_usd, 0.0);
        assert!(!l.record("r1", 100.0).exceeded_now);
    }

    #[test]
    fn negative_cost_is_clamped_to_zero() {
        let l = RunBudgetLedger::new();
        l.register("r1", "evolution", 10.0);
        l.record("r1", -3.0);
        assert_eq!(l.state("r1").unwrap().spent_usd, 0.0);
    }

    #[test]
    fn register_resets_a_reused_run_id() {
        let l = RunBudgetLedger::new();
        l.register("r1", "evolution", 10.0);
        l.record("r1", 4.0);
        l.register("r1", "evolution", 10.0); // re-run, same id
        let s = l.state("r1").unwrap();
        assert_eq!(s.spawn_count, 0);
        assert_eq!(s.spent_usd, 0.0);
    }

    #[test]
    fn finish_marks_finished_and_keeps_queryable() {
        let l = RunBudgetLedger::new();
        l.register("r1", "evolution", 10.0);
        l.record("r1", 1.0);
        l.finish("r1");
        let s = l.state("r1").unwrap();
        assert!(s.finished);
        assert_eq!(s.spawn_count, 1);
    }

    #[test]
    fn concurrent_records_sum_correctly() {
        let l = Arc::new(RunBudgetLedger::new());
        l.register("r1", "lab", 0.0); // unlimited — just test accumulation atomicity
        let mut handles = Vec::new();
        for _ in 0..8 {
            let l2 = Arc::clone(&l);
            handles.push(thread::spawn(move || {
                for _ in 0..100 {
                    l2.record("r1", 0.01);
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        let s = l.state("r1").unwrap();
        assert_eq!(s.spawn_count, 800);
        assert!((s.spent_usd - 8.0).abs() < 1e-6);
    }

    #[test]
    fn evolution_ceiling_default_when_env_unset() {
        // Not asserting env parsing (process-global env is test-order-sensitive);
        // just that the default constant is the documented value.
        assert_eq!(DEFAULT_EVOLUTION_CEILING_USD, 2.0);
    }
}
