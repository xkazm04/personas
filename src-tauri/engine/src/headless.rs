//! **Headless bridge (test mode)** — the gate, the actor, and the deterministic
//! policies the unattended kp→Personas loop runs on.
//!
//! Both kp and Personas are pre-production. Proving the App-master hire end to
//! end needs *mass* unattended loops of pair → hire → night → reconcile →
//! report → probation, and every one of those loops currently stops at a human
//! click (the pairing modal, the approval card, the probation review). This
//! module is the switch that removes those clicks — and the reason it is
//! written as a module of its own, rather than as three `if` statements spread
//! across the call sites, is that the switch must be **one** thing an operator
//! can reason about.
//!
//! # The gate
//!
//! `PERSONAS_HEADLESS_BRIDGE=1` in the process environment. Read **once**, at
//! the first call, and latched for the life of the process
//! ([`enabled`]) — setting the variable later cannot turn the mode on, so a
//! running production app can never be flipped into it by a stray `set_var`
//! from a plugin, a test helper or a connector.
//!
//! When the gate is off, every behaviour that reads it is **absent**: no
//! auto-approval, no auto-hire, no auto-probation, and the routes that exist
//! only for this mode are never added to the router at all (they 404 rather
//! than 403, because there is nothing there).
//!
//! > **This mode must never be enabled on a machine other people can reach.**
//! > A `POST /pair/request` from any origin mints a real, working management
//! > key with no human in the loop. On a shared or port-forwarded box that is
//! > a remote-code-execution path, not a test convenience.
//!
//! # The actor
//!
//! Everything this mode decides is recorded as [`ACTOR`] — `headless_bridge` —
//! on the row that carries the decision. An audit trail that said "approved"
//! with no actor would be a *true* row telling a *false* story: that a human
//! looked at it.
//!
//! # The verdict port
//!
//! [`backbone_verdict`] is a **verdict-only port** of kp's
//! `pipeline/jobfit/appmaster.py::backbone_score` (and its line-for-line
//! TypeScript mirror `app/_lib/app-master/backbone.ts`). The weights and the
//! per-rule contributions are deliberately NOT ported: nothing here renders a
//! score, and a second implementation of the arithmetic would be a second thing
//! to keep in sync. What *is* ported is the part the automatic probation
//! decision hangs on, exactly as kp writes it:
//!
//! * a failed **gate** (any forbidden-class violation) ⇒ `fail`, and it is
//!   never averaged away;
//! * otherwise **any unmeasured rule** ⇒ `incomplete` — unmeasured is a
//!   coverage gap, never a zero;
//! * otherwise ⇒ `pass`.
//!
//! # Why the loop terminates
//!
//! `incomplete` maps to *extend the probation*, which in an unattended loop is
//! the one decision that does not end anything. A **second consecutive**
//! `incomplete` therefore retires instead
//! ([`headless_probation_decision`]) — a driver that compresses a hundred
//! nights into a hundred ticks must not produce a hundred extensions.

use std::sync::atomic::{AtomicU8, Ordering};

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/// The one environment variable that enables the whole mode.
pub const HEADLESS_ENV: &str = "PERSONAS_HEADLESS_BRIDGE";

/// Scope added to every auto-minted pairing key, and the scope the on-demand
/// tick endpoint demands. A key without it cannot drive the loop even while
/// the mode is on.
pub const TEST_SCOPE: &str = "personas:test";

/// The actor recorded on every decision this mode takes instead of a human.
pub const ACTOR: &str = "headless_bridge";

const UNRESOLVED: u8 = 0;
const OFF: u8 = 1;
const ON: u8 = 2;

static STATE: AtomicU8 = AtomicU8::new(UNRESOLVED);

fn env_says_on() -> bool {
    std::env::var(HEADLESS_ENV)
        .map(|v| v.trim() == "1")
        .unwrap_or(false)
}

/// Is the headless bridge test mode on for this process?
///
/// Latched: the environment is consulted at the first call and the answer is
/// frozen. "Set at process start" is therefore enforced rather than merely
/// documented.
pub fn enabled() -> bool {
    match STATE.load(Ordering::Relaxed) {
        ON => true,
        OFF => false,
        _ => {
            let on = env_says_on();
            // A benign race between two first-callers resolves to the same
            // value: both read the same environment.
            STATE.store(if on { ON } else { OFF }, Ordering::Relaxed);
            on
        }
    }
}

/// Resolve the gate and shout about it. Called once, at boot, before anything
/// else can read the flag — a mode that removes every human gate must not be
/// discoverable only by noticing that a modal never appeared.
pub fn warn_at_boot() {
    if enabled() {
        tracing::warn!(
            headless_bridge = true,
            "HEADLESS BRIDGE TEST MODE IS ON ({HEADLESS_ENV}=1). Pairing requests are \
             AUTO-APPROVED, kp hire requests are AUTO-EXECUTED, and App master probation \
             reviews are AUTO-DECIDED — with no human in the loop, recorded as actor \
             `{ACTOR}`. Anyone who can reach this machine's management port can mint a \
             working key and hire an agent against your repositories. NEVER enable this on \
             a machine reachable by others."
        );
    } else {
        tracing::debug!("headless bridge test mode is off");
    }
}

/// Test-only override of the latched gate, serialised against itself so two
/// tests cannot see each other's setting, and restored on drop.
///
/// `#[cfg(test)]` — it does not exist in any build that ships, which is the
/// point: the production answer to "is the mode on" has exactly one input.
#[cfg(test)]
pub(crate) mod test_gate {
    use super::{Ordering, OFF, ON, STATE};
    use std::sync::{Mutex, MutexGuard};

    static LOCK: Mutex<()> = Mutex::new(());

    pub(crate) struct Guard {
        _lock: MutexGuard<'static, ()>,
        previous: u8,
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            STATE.store(self.previous, Ordering::Relaxed);
        }
    }

    /// Force the gate on/off for the lifetime of the returned guard.
    pub(crate) fn force(on: bool) -> Guard {
        let lock = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let previous = STATE.load(Ordering::Relaxed);
        STATE.store(if on { ON } else { OFF }, Ordering::Relaxed);
        Guard {
            _lock: lock,
            previous,
        }
    }
}

// ---------------------------------------------------------------------------
// The backbone verdict (verdict-only port of kp's `backbone_score`)
// ---------------------------------------------------------------------------

/// kp's three-valued verdict over the App-master performance backbone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackboneVerdict {
    /// Every rule had a reading and no gate failed.
    Pass,
    /// A gate failed. Gates are never averaged away.
    Fail,
    /// No gate failed, but at least one rule had no reading at all.
    Incomplete,
}

impl BackboneVerdict {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pass => "pass",
            Self::Fail => "fail",
            Self::Incomplete => "incomplete",
        }
    }
}

/// One objective's movement, as the rollup reports it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct KpiDeltaReading {
    pub measured: bool,
    pub baseline: Option<f64>,
    pub current: Option<f64>,
    pub target: Option<f64>,
    /// kp's vocabulary: `gte` or `lte`.
    pub direction: String,
}

/// The six-rule backbone, as kp's `backboneFromRollup` normalises it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BackboneReading {
    pub proposals_opened: i64,
    pub proposals_merged: i64,
    pub proposals_reverted: i64,
    pub gate_pass_rate: Option<f64>,
    pub forbidden_class_violations: i64,
    pub kpi_deltas: Vec<KpiDeltaReading>,
    pub budget_reserved_usd: f64,
    pub budget_settled_usd: f64,
    pub budget_unmeasured: bool,
    pub ledger_consistent: bool,
}

/// Did this objective move toward its target? `None` = cannot tell, which is a
/// coverage gap and not a miss. Port of kp's `kpiMoved`.
pub fn kpi_moved(d: &KpiDeltaReading) -> Option<bool> {
    if !d.measured {
        return None;
    }
    let current = finite(d.current)?;
    let target = finite(d.target)?;
    let baseline = finite(d.baseline);
    if d.direction == "gte" {
        if current >= target {
            return Some(true);
        }
        return Some(match baseline {
            Some(b) => current > b,
            None => false,
        });
    }
    if current <= target {
        return Some(true);
    }
    Some(match baseline {
        Some(b) => current < b,
        None => false,
    })
}

fn finite(v: Option<f64>) -> Option<f64> {
    v.filter(|x| x.is_finite())
}

/// Which of the six rules had a reading, in kp's order. Exposed so a caller can
/// report *which* readings are missing rather than only that some are.
pub fn unmeasured_rules(b: &BackboneReading) -> Vec<&'static str> {
    let mut out: Vec<&'static str> = Vec::new();

    // 1. delivery — merged / opened.
    let opened = b.proposals_opened.max(0);
    let merged = b.proposals_merged.max(0);
    if opened == 0 {
        out.push("delivery");
    }
    // 2. durability — merged proposals that were not reverted.
    if merged == 0 {
        out.push("durability");
    }
    // 3. gates — the repository's own declared gate commands.
    if finite(b.gate_pass_rate).is_none() {
        out.push("gates");
    }
    // 4. objectives — the value ledger.
    if !b.kpi_deltas.iter().any(|d| kpi_moved(d).is_some()) {
        out.push("objectives");
    }
    // 5. budget — an unmetered window is not a cheap one.
    let reserved = b.budget_reserved_usd.max(0.0);
    let settled = b.budget_settled_usd.max(0.0);
    if b.budget_unmeasured || (reserved <= 0.0 && settled <= 0.0) {
        out.push("budget");
    }
    // 6. ledger — always measured (an absent report reads as "no dispute").
    out
}

/// The verdict, exactly as kp computes it.
pub fn backbone_verdict(b: &BackboneReading) -> BackboneVerdict {
    if b.forbidden_class_violations.max(0) > 0 {
        return BackboneVerdict::Fail;
    }
    if unmeasured_rules(b).is_empty() {
        BackboneVerdict::Pass
    } else {
        BackboneVerdict::Incomplete
    }
}

/// Read a stored rollup's JSON (the camelCase wire shape Personas ships and the
/// probation packet embeds under `backbone`) into a [`BackboneReading`].
///
/// Port of kp's `backboneFromRollup`, including the two asymmetries it calls
/// out: absent **counts** become `0` (a count nobody reported is zero
/// proposals), but an absent `gatePassRate` stays `None` and an absent budget
/// reading becomes `budget_unmeasured: true` — never a perfect $0 window.
pub fn backbone_reading_from_json(v: &serde_json::Value) -> BackboneReading {
    let count = |key: &str| -> i64 {
        v.get(key)
            .and_then(serde_json::Value::as_f64)
            .filter(|x| x.is_finite() && *x >= 0.0)
            .map(|x| x.round() as i64)
            .unwrap_or(0)
    };
    let money = |key: &str| -> f64 {
        v.get(key)
            .and_then(serde_json::Value::as_f64)
            .filter(|x| x.is_finite() && *x >= 0.0)
            .unwrap_or(0.0)
    };
    let has_number = |key: &str| -> bool {
        v.get(key)
            .and_then(serde_json::Value::as_f64)
            .is_some_and(f64::is_finite)
    };

    let kpi_deltas = v
        .get("kpiDeltas")
        .and_then(serde_json::Value::as_array)
        .map(|rows| {
            rows.iter()
                .map(|d| KpiDeltaReading {
                    measured: d
                        .get("measured")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false),
                    baseline: d.get("baseline").and_then(serde_json::Value::as_f64),
                    current: d.get("current").and_then(serde_json::Value::as_f64),
                    target: d.get("target").and_then(serde_json::Value::as_f64),
                    direction: d
                        .get("direction")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("gte")
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    BackboneReading {
        proposals_opened: count("proposalsOpened"),
        proposals_merged: count("proposalsMerged"),
        proposals_reverted: count("proposalsReverted"),
        gate_pass_rate: v
            .get("gatePassRate")
            .and_then(serde_json::Value::as_f64)
            .filter(|x| x.is_finite()),
        forbidden_class_violations: count("forbiddenClassViolations"),
        kpi_deltas,
        budget_reserved_usd: money("budgetReservedUsd"),
        budget_settled_usd: money("budgetSettledUsd"),
        budget_unmeasured: v
            .get("budgetUnmeasured")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or_else(|| {
                !(has_number("budgetReservedUsd") || has_number("budgetSettledUsd"))
            }),
        ledger_consistent: v
            .get("ledgerConsistent")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true),
    }
}

// ---------------------------------------------------------------------------
// The probation policy
// ---------------------------------------------------------------------------

/// What the headless bridge decides at a probation review.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbationDecision {
    Activate,
    Extend,
    Retire,
}

impl ProbationDecision {
    /// The review-card action string the human path uses, so the decision goes
    /// through `react_to_app_master_probation` unchanged.
    pub fn action(&self) -> &'static str {
        match self {
            Self::Activate => "activate",
            Self::Extend => "extend_30",
            Self::Retire => "retire",
        }
    }

    /// The outcome word the mandate record and the kp lifecycle event carry.
    pub fn outcome(&self) -> &'static str {
        match self {
            Self::Activate => "activated",
            Self::Extend => "extended",
            Self::Retire => "retired",
        }
    }
}

/// The deterministic probation decision.
///
/// `pass` activates, `fail` retires, `incomplete` extends **once** —
/// `prior_incomplete_streak` is how many consecutive `incomplete` reviews this
/// hire has already been extended for, so the second one retires and the loop
/// terminates.
pub fn headless_probation_decision(
    verdict: BackboneVerdict,
    prior_incomplete_streak: u32,
) -> ProbationDecision {
    match verdict {
        BackboneVerdict::Pass => ProbationDecision::Activate,
        BackboneVerdict::Fail => ProbationDecision::Retire,
        BackboneVerdict::Incomplete if prior_incomplete_streak >= 1 => ProbationDecision::Retire,
        BackboneVerdict::Incomplete => ProbationDecision::Extend,
    }
}

// ---------------------------------------------------------------------------
// The on-demand tick
// ---------------------------------------------------------------------------

/// The phases `POST /api/kp/test/tick` runs, **in the order they must run in**.
///
/// The order is a data dependency, not a preference: Overnight authors the
/// branches the reconciler observes, the reconciler writes the gate and merge
/// rows the reporter reads, and the reporter's rollup is the backbone the
/// probation packet embeds. A caller that lists them in another order gets them
/// in this one anyway — running `probation` before `report` would produce a
/// review about the night before last, and silently obeying that would be worse
/// than refusing it.
pub const TICK_PHASES: [&str; 4] = ["overnight", "reconcile", "report", "probation"];

/// Resolve the requested phase list.
///
/// `None` ⇒ all four. Unknown names are an **error**, not a skip: a driver that
/// asked for `"reconciile"` and got a 200 with three phases would read the typo
/// as a passing run.
pub fn select_tick_phases(requested: Option<&[String]>) -> Result<Vec<&'static str>, Vec<String>> {
    let Some(list) = requested else {
        return Ok(TICK_PHASES.to_vec());
    };
    let unknown: Vec<String> = list
        .iter()
        .filter(|name| !TICK_PHASES.contains(&name.trim()))
        .map(|name| name.trim().to_string())
        .collect();
    if !unknown.is_empty() {
        return Err(unknown);
    }
    Ok(TICK_PHASES
        .into_iter()
        .filter(|phase| list.iter().any(|name| name.trim() == *phase))
        .collect())
}

/// Merge `{decidedBy, decidedAt}` into a decision row's JSON payload.
///
/// The tables this mode writes to (`companion_approval`) have no actor column,
/// so the actor rides in the payload. Recording it is not decoration: a row
/// that says `approved` and nothing else claims a human looked at it.
pub fn stamp_actor(payload: &mut serde_json::Value, at: &str) {
    if let Some(obj) = payload.as_object_mut() {
        obj.insert(
            "decidedBy".into(),
            serde_json::Value::String(ACTOR.to_string()),
        );
        obj.insert(
            "decidedAt".into(),
            serde_json::Value::String(at.to_string()),
        );
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn complete() -> BackboneReading {
        BackboneReading {
            proposals_opened: 4,
            proposals_merged: 3,
            proposals_reverted: 0,
            gate_pass_rate: Some(1.0),
            forbidden_class_violations: 0,
            kpi_deltas: vec![KpiDeltaReading {
                measured: true,
                baseline: Some(10.0),
                current: Some(20.0),
                target: Some(15.0),
                direction: "gte".into(),
            }],
            budget_reserved_usd: 4.0,
            budget_settled_usd: 3.5,
            budget_unmeasured: false,
            ledger_consistent: true,
        }
    }

    #[test]
    fn a_fully_measured_clean_window_passes() {
        assert_eq!(backbone_verdict(&complete()), BackboneVerdict::Pass);
        assert!(unmeasured_rules(&complete()).is_empty());
    }

    #[test]
    fn a_forbidden_class_violation_fails_and_is_never_averaged_away() {
        let mut b = complete();
        b.forbidden_class_violations = 1;
        assert_eq!(backbone_verdict(&b), BackboneVerdict::Fail);
        // Even with EVERY other rule unmeasured, the gate still decides.
        let poisoned = BackboneReading {
            forbidden_class_violations: 2,
            ..Default::default()
        };
        assert_eq!(backbone_verdict(&poisoned), BackboneVerdict::Fail);
    }

    #[test]
    fn any_unmeasured_rule_degrades_to_incomplete() {
        let cases: [(&str, fn(&mut BackboneReading)); 5] = [
            ("delivery", |b| b.proposals_opened = 0),
            ("durability", |b| b.proposals_merged = 0),
            ("gates", |b| b.gate_pass_rate = None),
            ("objectives", |b| b.kpi_deltas.clear()),
            ("budget", |b| b.budget_unmeasured = true),
        ];
        for (label, mutate) in cases {
            let mut b = complete();
            mutate(&mut b);
            assert_eq!(
                backbone_verdict(&b),
                BackboneVerdict::Incomplete,
                "{label} unmeasured must read incomplete, not pass"
            );
            assert!(unmeasured_rules(&b).contains(&label), "{label} not listed");
        }
    }

    #[test]
    fn an_unmeasured_objective_is_not_a_missed_one() {
        let mut b = complete();
        b.kpi_deltas = vec![KpiDeltaReading {
            measured: false,
            baseline: Some(1.0),
            current: Some(0.0),
            target: Some(9.0),
            direction: "gte".into(),
        }];
        // It would be a MISS if it were read. It was not read.
        assert_eq!(kpi_moved(&b.kpi_deltas[0]), None);
        assert_eq!(backbone_verdict(&b), BackboneVerdict::Incomplete);
    }

    #[test]
    fn kpi_moved_reads_both_directions() {
        let gte = |baseline, current, target| {
            kpi_moved(&KpiDeltaReading {
                measured: true,
                baseline,
                current,
                target,
                direction: "gte".into(),
            })
        };
        assert_eq!(gte(Some(1.0), Some(9.0), Some(5.0)), Some(true)); // at target
        assert_eq!(gte(Some(1.0), Some(3.0), Some(5.0)), Some(true)); // moved up
        assert_eq!(gte(Some(4.0), Some(3.0), Some(5.0)), Some(false)); // moved down
        assert_eq!(gte(None, Some(3.0), Some(5.0)), Some(false)); // no baseline, short
        assert_eq!(gte(Some(1.0), None, Some(5.0)), None); // no reading

        let lte = |baseline, current, target| {
            kpi_moved(&KpiDeltaReading {
                measured: true,
                baseline,
                current,
                target,
                direction: "lte".into(),
            })
        };
        assert_eq!(lte(Some(9.0), Some(2.0), Some(5.0)), Some(true));
        assert_eq!(lte(Some(9.0), Some(7.0), Some(5.0)), Some(true)); // moved down
        assert_eq!(lte(Some(6.0), Some(7.0), Some(5.0)), Some(false));
    }

    #[test]
    fn an_absent_budget_reading_is_unmeasured_not_a_free_window() {
        // No budget keys at all — kp's rule: NOT a perfect $0 window.
        let b = backbone_reading_from_json(&serde_json::json!({
            "proposalsOpened": 3, "proposalsMerged": 2, "gatePassRate": 1.0,
        }));
        assert!(b.budget_unmeasured);
        assert!(unmeasured_rules(&b).contains(&"budget"));
    }

    #[test]
    fn json_read_mirrors_kps_normalisation() {
        let b = backbone_reading_from_json(&serde_json::json!({
            "proposalsOpened": 5,
            "proposalsMerged": 5,
            "proposalsReverted": 1,
            "gatePassRate": 0.75,
            "forbiddenClassViolations": 0,
            "kpiDeltas": [{ "measured": true, "baseline": 2.0, "current": 8.0, "target": 6.0, "direction": "gte" }],
            "budgetReservedUsd": 10.0,
            "budgetSettledUsd": 9.0,
            "budgetUnmeasured": false,
            "ledgerConsistent": true,
        }));
        assert_eq!(b.proposals_opened, 5);
        assert_eq!(b.gate_pass_rate, Some(0.75));
        assert!(!b.budget_unmeasured);
        assert_eq!(backbone_verdict(&b), BackboneVerdict::Pass);

        // An absent `ledgerConsistent` is "no dispute", not a failure.
        let quiet = backbone_reading_from_json(&serde_json::json!({}));
        assert!(quiet.ledger_consistent);
        // …but everything else absent still reads incomplete.
        assert_eq!(backbone_verdict(&quiet), BackboneVerdict::Incomplete);
    }

    #[test]
    fn probation_policy_maps_the_three_verdicts() {
        assert_eq!(
            headless_probation_decision(BackboneVerdict::Pass, 0),
            ProbationDecision::Activate
        );
        assert_eq!(
            headless_probation_decision(BackboneVerdict::Fail, 0),
            ProbationDecision::Retire
        );
        assert_eq!(
            headless_probation_decision(BackboneVerdict::Incomplete, 0),
            ProbationDecision::Extend
        );
    }

    #[test]
    fn a_second_consecutive_incomplete_retires_so_the_loop_terminates() {
        assert_eq!(
            headless_probation_decision(BackboneVerdict::Incomplete, 1),
            ProbationDecision::Retire
        );
        assert_eq!(
            headless_probation_decision(BackboneVerdict::Incomplete, 7),
            ProbationDecision::Retire
        );
        // A streak never turns a pass or a fail into something else.
        assert_eq!(
            headless_probation_decision(BackboneVerdict::Pass, 3),
            ProbationDecision::Activate
        );
        assert_eq!(
            headless_probation_decision(BackboneVerdict::Fail, 3),
            ProbationDecision::Retire
        );
    }

    // -- the on-demand tick -------------------------------------------------

    #[test]
    fn the_default_tick_runs_every_phase_in_dependency_order() {
        assert_eq!(
            select_tick_phases(None).unwrap(),
            vec!["overnight", "reconcile", "report", "probation"]
        );
    }

    #[test]
    fn a_subset_keeps_the_canonical_order_whatever_order_was_asked_for() {
        let asked: Vec<String> = vec!["probation".into(), "overnight".into(), "report".into()];
        assert_eq!(
            select_tick_phases(Some(&asked)).unwrap(),
            vec!["overnight", "report", "probation"],
            "probation reads the rollup the report phase pushes — asking for it first \
             must not run it first"
        );
    }

    #[test]
    fn an_unknown_phase_is_refused_rather_than_skipped() {
        let asked: Vec<String> = vec!["reconciile".into(), "report".into()];
        assert_eq!(
            select_tick_phases(Some(&asked)).unwrap_err(),
            vec!["reconciile".to_string()],
            "a typo that silently ran three of four phases would read as a passing run"
        );
    }

    #[test]
    fn phase_names_are_trimmed_and_a_single_phase_works() {
        let asked: Vec<String> = vec!["  reconcile  ".into()];
        assert_eq!(select_tick_phases(Some(&asked)).unwrap(), vec!["reconcile"]);
        let none: Vec<String> = Vec::new();
        assert!(select_tick_phases(Some(&none)).unwrap().is_empty());
    }

    #[test]
    fn the_actor_is_stamped_onto_the_decision_payload() {
        let mut payload = serde_json::json!({
            "action": "kp_hire_request",
            "params": { "requestId": "appr_1" },
            "rationale": "…",
        });
        stamp_actor(&mut payload, "2026-08-24T10:00:00+00:00");
        assert_eq!(payload["decidedBy"], serde_json::json!(ACTOR));
        assert_eq!(
            payload["decidedAt"],
            serde_json::json!("2026-08-24T10:00:00+00:00")
        );
        // Nothing else is disturbed — the executor re-reads `params` afterwards.
        assert_eq!(payload["action"], serde_json::json!("kp_hire_request"));
        assert_eq!(payload["params"]["requestId"], serde_json::json!("appr_1"));
    }

    #[test]
    fn decision_words_match_the_human_review_vocabulary() {
        assert_eq!(ProbationDecision::Activate.action(), "activate");
        assert_eq!(ProbationDecision::Extend.action(), "extend_30");
        assert_eq!(ProbationDecision::Retire.action(), "retire");
        assert_eq!(ProbationDecision::Activate.outcome(), "activated");
        assert_eq!(ProbationDecision::Extend.outcome(), "extended");
        assert_eq!(ProbationDecision::Retire.outcome(), "retired");
    }
}
