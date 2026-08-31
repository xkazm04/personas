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
//!
//! # The anchorless decision
//!
//! `persona_manual_reviews.execution_id` is NOT NULL with an FK onto
//! `persona_executions`, so a probation review needs a run to hang off. An App
//! master whose nights dispatched nothing has **no run** — which is a
//! legitimate probation state (and, read honestly, a poor one), not a missing
//! prerequisite. In production that mandate defers, because filing a review
//! against a fabricated execution would be a lie on the audit trail. In
//! headless mode it is decided **without a review row** from the same backbone
//! the packet would have embedded ([`anchorless_probation_allowed`]) — the
//! alternative is a bench where every probation returns no decision at all.

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

/// What a headless probation decision was anchored to. Reported on every
/// outcome so a bench can tell the two paths apart without inferring it from a
/// null review id.
pub const ANCHOR_REVIEW: &str = "review";
pub const ANCHOR_NONE: &str = "none";

/// May the headless bridge decide this mandate **with no manual-review row**?
///
/// Every clause is a refusal the production path keeps:
///
/// * `headless_enabled` — outside the bridge this behaviour does not exist.
///   A real operator's inbox is the only place a probation is decided, and a
///   decision with no review row would leave nothing for them to have read.
/// * `!has_review_row` — a raised packet is answered through the review path,
///   which marks the row and synthesises the learned memory.
/// * `!has_execution` — a persona that HAS run can be anchored, so it must be:
///   the anchorless path exists only for the case the FK makes impossible.
/// * `force_due || window_closed` — the bench's `forceProbation`, or a
///   probation window that genuinely closed. Never a live window.
pub fn anchorless_probation_allowed(
    headless_enabled: bool,
    force_due: bool,
    window_closed: bool,
    has_review_row: bool,
    has_execution: bool,
) -> bool {
    headless_enabled && !has_review_row && !has_execution && (force_due || window_closed)
}

/// The note carried onto the mandate's kp `probation_review` lifecycle event
/// when the decision was taken with no review row. It says what was skipped and
/// why, in the record itself — a lifecycle event that read like every other one
/// would claim a review happened.
pub fn anchorless_probation_note(decision_outcome: &str, verdict: &str) -> String {
    format!(
        "{decision_outcome} by `{ACTOR}` from a `{verdict}` backbone verdict, taken WITHOUT a \
         manual review row: the persona has never executed, and \
         `persona_manual_reviews.execution_id` requires an execution to anchor to. No human \
         read this."
    )
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

// ---------------------------------------------------------------------------
// The ideation night (§13.13): author first, and run the night at a mode the
// tick names rather than the one the project stores
// ---------------------------------------------------------------------------
//
// A rung-0 ideation night is a night that PROPOSES and dispatches nothing. Two
// things stood in the way of running one over this bridge, and both are here:
//
//  1. The tick only ever triaged ideas that already existed. Authoring lives in
//     the `idea_replenish` subscription, on a 900s timer behind a 20h
//     per-project cooldown, which a compressed night never reaches — so a fresh
//     tenure's first night could only re-triage the deck it inherited.
//  2. A project left on autopilot `full` DISPATCHES every accepted idea as a
//     fleet session. For a night whose whole product is a list, that is not a
//     stronger run, it is the wrong run — and flipping the stored mode to get a
//     quiet night would leave the project changed after the bench went home.

/// The autopilot modes a tick may name. Same four words `AutopilotMode::parse`
/// accepts — spelled out here so the refusal message can list them, exactly as
/// [`TICK_PHASES`] does for phases.
pub const AUTOPILOT_MODES: [&str; 4] = ["off", "measure", "suggest", "full"];

/// Resolve a tick's `autopilot` override.
///
/// `None` ⇒ no override: the night runs at the project's stored mode, which is
/// what every production caller gets. `Some(word)` ⇒ that mode, **for this tick
/// only** — the caller applies it to the night and writes nothing back, so a
/// bench that asked for one quiet night leaves the project exactly as it found
/// it.
///
/// An unknown word is an `Err`, never a silent fallback to the stored mode, for
/// the same reason an unknown phase name is a 400: a driver that typed
/// `"sugest"` and got a 200 would read a full dispatching night as the quiet one
/// it asked for — and that mistake costs money.
pub fn select_autopilot_override(
    requested: Option<&str>,
) -> Result<Option<crate::autopilot::AutopilotMode>, String> {
    let Some(raw) = requested else {
        return Ok(None);
    };
    let word = raw.trim();
    crate::autopilot::AutopilotMode::parse(word)
        .map(Some)
        .ok_or_else(|| word.to_string())
}

/// Whether the tick should run the idea scanner before it triages, and if not,
/// why not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdeationDecision {
    /// The tick did not ask to ideate. Nothing is reported: a night that was
    /// never asked to author must not carry an ideation reading at all.
    NotRequested,
    /// Asked for, and refused before anything was spent.
    Blocked(&'static str),
    /// Run the scanner for the tick's project.
    Run,
}

/// Refusal: `ideate` without a project to ideate for.
///
/// An unscoped tick runs the night for **every** eligible project; ideating
/// unscoped would spawn a paid scan agent per project off one flag. The tick
/// still runs — this is reported, not raised.
pub const IDEATION_NEEDS_PROJECT: &str =
    "ideation needs a projectId — an unscoped tick would spend one scan agent per eligible project";

/// Refusal: the provider quota cooldown is open.
///
/// **The one guard a test tick does not get to wave away.** The 20h per-project
/// scan cooldown is a pacing rule for an unattended 900s loop and a test tick is
/// neither unattended nor paced, so the tick bypasses it deliberately. A quota
/// cooldown is a different animal: it says the account is at or over a real
/// spend limit right now. That is true whoever is asking, and a bench that
/// spent through it would be measuring the wrong thing anyway.
pub const IDEATION_QUOTA_BLOCKED: &str =
    "quota cooldown active — a spend guard is not a test artefact, so the tick did not scan";

/// The gate, as a pure function, so the one decision that matters (which guard
/// a test tick honours and which it bypasses) can be read and tested without a
/// Tauri handle, a pool or a paid agent.
///
/// Note what is **absent** from the arguments: the `dev_scans` 20h cooldown and
/// the default-OFF `autonomous_idea_scan` setting. Both gate the *unattended*
/// replenish loop — "don't do this on your own initiative, and not more than
/// once a day" — and a tick carrying `ideate: true` is precisely an operator
/// asking on purpose. They are not consulted, and that is the bypass this
/// function exists to make legible.
pub fn ideation_decision(
    requested: bool,
    has_project: bool,
    quota_cooldown: bool,
) -> IdeationDecision {
    if !requested {
        return IdeationDecision::NotRequested;
    }
    if !has_project {
        return IdeationDecision::Blocked(IDEATION_NEEDS_PROJECT);
    }
    if quota_cooldown {
        return IdeationDecision::Blocked(IDEATION_QUOTA_BLOCKED);
    }
    IdeationDecision::Run
}

/// What the tick's authoring half did, reported on the `overnight` phase.
///
/// Present exactly when the tick asked to ideate, absent otherwise — the same
/// rule the two backlog lists follow (§13.12): a phase that never attempted
/// something must not report a zero for it.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ideation {
    /// **True only when the scan finished inside this tick**, so the ideas it
    /// authored are in the very backlog this same phase goes on to triage and
    /// report. A scan that was launched and then errored or outran the wait is
    /// `false` with `blocked` saying which — "it started" is not the claim a
    /// reader of a night's proposal list needs.
    pub ran: bool,
    /// The lenses the scan ran, comma-joined — the lane's own spelling
    /// (`dev_scans.scan_type` stores a comma-joined list). `null` when no scan
    /// was ever launched.
    pub lens: Option<String>,
    /// Ideas the scan created, from the completed scan row's own count.
    /// **`null` is "unmeasured", never zero**: a scan that errored may well have
    /// written rows before it failed, and a tick that stopped waiting knows
    /// nothing about what landed after.
    pub authored: Option<i64>,
    /// Why this night has no authored ideas it can vouch for; `null` when the
    /// scan completed. Ideation never fails the tick — a blocked or broken scan
    /// is a reading, and the night still ran.
    pub blocked: Option<String>,
}

impl Ideation {
    /// Refused before anything was launched.
    pub fn blocked(reason: impl Into<String>) -> Self {
        Self {
            ran: false,
            lens: None,
            authored: None,
            blocked: Some(reason.into()),
        }
    }

    /// The scan completed and its count is the row's own.
    pub fn authored(lens: impl Into<String>, authored: i64) -> Self {
        Self {
            ran: true,
            lens: Some(lens.into()),
            authored: Some(authored),
            blocked: None,
        }
    }

    /// Launched, but this tick cannot say what it produced (it errored, or the
    /// wait ran out). The lens is still known and still reported.
    pub fn unmeasured(lens: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            ran: false,
            lens: Some(lens.into()),
            authored: None,
            blocked: Some(reason.into()),
        }
    }
}

/// How long the tick waits for the scan it launched, in seconds.
pub const IDEATION_TIMEOUT_ENV: &str = "PERSONAS_HEADLESS_IDEATION_TIMEOUT_SECS";

/// Default wait: 20 minutes. An idea scan spawns a paid CLI agent per lens and
/// the replenish loop budgets ~6 minutes for one; two lenses plus a slow
/// provider fits inside this, and a night that needs longer reports
/// `blocked` rather than holding the driver's HTTP call open indefinitely.
pub const IDEATION_TIMEOUT_DEFAULT_SECS: u64 = 1_200;

/// Parse the wait override. Anything unreadable — a non-number, or a `0` that
/// would turn the wait into "don't wait" while still spending on the scan —
/// falls back to the default rather than being obeyed.
pub fn parse_ideation_timeout_secs(raw: Option<&str>) -> u64 {
    raw.and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(IDEATION_TIMEOUT_DEFAULT_SECS)
}

/// [`parse_ideation_timeout_secs`] over [`IDEATION_TIMEOUT_ENV`].
pub fn ideation_timeout_secs() -> u64 {
    parse_ideation_timeout_secs(std::env::var(IDEATION_TIMEOUT_ENV).ok().as_deref())
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
// The night's product: a proposal list and a decline log (§13.12)
// ---------------------------------------------------------------------------
//
// kp's bench is being rebuilt around rung-0 "ideation nights", whose whole
// product is *what the night proposed* and *what it turned down*. Until this
// existed the tick summary carried only counts and prose — a `blockedReason`
// reading "mode suggest triages but does not dispatch (1 accepted idea(s) left
// for the morning)" names a number and never the idea, so no reader downstream
// could grade the night's judgement. These two lists ARE the reading.

/// The closed vocabulary a decline is reported in.
///
/// The backlog lane has no such vocabulary of its own: `dev_ideas.status` is
/// `pending | accepted | rejected | archived` and `rejection_reason` is **free
/// text** (a human's sentence, or the mechanical `"Auto-rejected by triage rule
/// '<name>'"`). So this is a *projection*, and a lossy one on purpose — see
/// [`decline_reason`].
pub const DECLINE_REASONS: [&str; 4] = [
    "low-value",
    "outside-mandate",
    "already-done",
    "needs-human",
];

/// Cap on each of the two lists, independently. A tick response is read by a
/// driver, not paged through; a backlog of thousands would bury the night's own
/// work under the archaeology of every night before it.
pub const MAX_TICK_BACKLOG_ITEMS: i64 = 50;

/// The closed vocabulary a proposal's **value axis** is reported in: what kind
/// of value the change moves — `time` (time or money saved), `risk` (a failure
/// or exposure avoided), `gate` (a buyer / compliance gate opened).
///
/// A word outside this set is not an axis. It is reported as `null`, never
/// passed through — see [`stated_axis`].
pub const VALUE_AXES: [&str; 3] = ["time", "risk", "gate"];

/// The block every idea-generating prompt appends, so the holder states the
/// journey and the axis **itself** instead of a reader inferring them from the
/// lane's plumbing (`scan_type` is a lens, not a value axis; `use_case_id` is a
/// link scanner-raised ideas never carry).
///
/// It lives here, beside [`VALUE_AXES`] and the readers that parse it back
/// ([`stated_journey`] / [`stated_axis`]), so the writer and the reader have
/// **one spelling** — the same reason the decline vocabulary and its projection
/// share this module. It is prose the model reads, not a format string: it
/// carries no `{}` placeholders, and interpolating it into one is safe.
pub const VALUE_LITERACY_INSTRUCTION: &str = r#"## Value literacy — every idea names what it moves

End the `reasoning` string with these two marker lines, each on its own line, in
exactly this form (they are read mechanically, so the labels and the vocabulary
are fixed):

Journey: <the user journey of THIS product the idea moves, e.g. role-to-schedule>
Axis: <time|risk|gate>

- **Journey** — the journey a user of the product walks, named in that product's
  own words. An idea that moves NO user journey writes `Journey: none` and says
  so; never invent a journey to fill the line. Unmeasured is not zero, and an
  invented journey reads downstream as a value claim nobody made.
- **Axis** — exactly ONE of `time` (time or money saved), `risk` (a failure,
  defect or exposure avoided) or `gate` (a buyer, compliance or contractual gate
  opened). There is no fourth word: an idea that moves none of the three writes
  `Axis: none`, which is read as "no axis stated" rather than passed through.
"#;

/// One proposal the night left on the table.
///
/// `journey`, `axis`, `size` and `confidence` are all optional because the lane
/// genuinely may not hold them — an idea carries what its emitter filled in.
/// **`confidence` is always `None` today**: nothing in `dev_ideas` records one
/// (there are `effort`, `impact`, `risk` and a triage `priority`, none of which
/// is a confidence), and deriving one from those would be inventing a number.
/// Unmeasured is not zero — the field exists so the absence is *stated*.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NightProposal {
    pub title: String,
    /// What the proposal is against: the context's name when the idea names
    /// one, else the project's name, else its id. Never blank.
    pub target: String,
    /// The idea's `reasoning`, falling back to its `description`.
    pub why: Option<String>,
    /// The journey the idea moves, as the HOLDER stated it in its own text
    /// (`Journey:`), falling back to the use case the idea is linked to
    /// (`dev_ideas.use_case_id`), by name. `None` when neither exists — or when
    /// the holder honestly answered `Journey: none`.
    pub journey: Option<String>,
    /// The value axis the idea moves, one of [`VALUE_AXES`], as the HOLDER
    /// stated it (`Axis:`). A stated word outside that set reports `None` and
    /// never falls back — see [`StatedAxis::OffVocabulary`]. When no axis was
    /// stated at all this carries the lane's lens instead (`dev_ideas.scan_type`
    /// falling back to `category`), which is what it carried before holders
    /// were asked: a lens is not a value axis, and a reader grading value
    /// literacy should count only the ones inside [`VALUE_AXES`].
    pub axis: Option<String>,
    /// `xs | s | m | l | xl`, projected from `effort` — see [`proposal_size`].
    pub size: Option<String>,
    /// Always `None`. See the type docs.
    pub confidence: Option<f64>,
    /// `dev_ideas.created_at`, **carried verbatim** — never reformatted.
    ///
    /// It is here because these two lists select by STATE and by design carry
    /// no time window (see [`night_backlog`]): a project that held an operator's
    /// deck before a tenure began reports that deck as the night's proposals,
    /// and only the row's own age can tell a reader which ideas the current
    /// holder actually authored. The window belongs to the reader, so the reader
    /// is given the stamp.
    ///
    /// **Verbatim, and two forms exist.** Every idea a scanner raises is written
    /// by `dev_ideas::create_idea` / `create_finding` with
    /// `chrono::Utc::now().to_rfc3339()`, so a holder's proposals carry RFC3339
    /// UTC. A handful of older doors write SQLite's `datetime('now')`
    /// (`"YYYY-MM-DD HH:MM:SS"`, UTC, no zone marker). Normalising the second
    /// into the first would mean stamping a zone onto a value that does not
    /// carry one — so the column is passed through as stored and a reader that
    /// parses it must accept both. Reporting what the row says is not the same
    /// as making it prettier.
    pub created_at: String,
    /// `dev_ideas.origin`, **verbatim**: which sensor raised the idea (one of
    /// `personas_db::models::FINDING_ORIGINS`), or `null` for a classic
    /// Idea-Scanner idea.
    ///
    /// Paired with `createdAt` for the same reason: state alone cannot say
    /// whether a proposal came from the night's own reasoning or from a
    /// mechanical sensor sweep, and a bench grading a holder's judgement is
    /// asking exactly that. `null` is a real answer here, not a gap.
    pub origin: Option<String>,
}

/// One idea the night turned down.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NightDecline {
    pub title: String,
    /// One of [`DECLINE_REASONS`], or `null` when the stored reason does not
    /// map onto one. Never guessed.
    pub reason: Option<&'static str>,
    /// `dev_ideas.created_at`, **carried verbatim** — the same rule and the same
    /// reason as [`NightProposal::created_at`], which documents both forms.
    pub created_at: String,
    /// `dev_ideas.origin`, **verbatim** — see [`NightProposal::origin`].
    pub origin: Option<String>,
}

/// The two lists an overnight phase reports. Both are always present — empty is
/// a finding ("the night produced nothing"), missing is a gap in the reporting.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
pub struct NightBacklog {
    pub proposals: Vec<NightProposal>,
    pub declines: Vec<NightDecline>,
}

/// Project `dev_ideas.effort` onto a size word.
///
/// The ladder is the emitter's own, documented where the scanner prompt defines
/// it (`idea_scanner.rs`: 1=trivial … 10=epic) — folded in pairs, not invented:
/// 1-2 `xs`, 3-4 `s`, 5-6 `m`, 7-8 `l`, 9-10 `xl`. An absent or out-of-range
/// effort is `None`; a size no emitter stated is not a size.
pub fn proposal_size(effort: Option<i32>) -> Option<&'static str> {
    match effort? {
        1..=2 => Some("xs"),
        3..=4 => Some("s"),
        5..=6 => Some("m"),
        7..=8 => Some("l"),
        9..=10 => Some("xl"),
        _ => None,
    }
}

/// The words a marker line uses to say "this moves none" — an honest null, not
/// a value. Kept separate from [`VALUE_AXES`]: saying nothing and saying
/// *nothing moves* must not read the same as inventing an answer.
const STATED_NONE: [&str; 5] = ["none", "n/a", "na", "null", "-"];

/// Read one `Label: value` marker line out of an idea's free text.
///
/// **Conservative by construction.** The label must open its own line (after
/// the bullet / emphasis punctuation a model tends to wrap it in) and be
/// followed by a colon; the first such line wins. Nothing else in the text is
/// looked at, and there is no guessing: an idea that did not state a marker
/// reports as not having stated one, which is the reading the C1 exam wants.
fn marker_value(text: &str, label: &str) -> Option<String> {
    for line in text.lines() {
        let line = line
            .trim()
            .trim_start_matches(|c: char| matches!(c, '-' | '*' | '•' | '>' | '#' | ' ' | '\t'));
        let Some(head) = line.get(..label.len()) else {
            continue;
        };
        if !head.eq_ignore_ascii_case(label) {
            continue;
        }
        let Some(value) = line[label.len()..].trim_start().strip_prefix(':') else {
            continue;
        };
        let value = value
            .trim()
            .trim_end_matches(|c: char| matches!(c, '*' | '.' | ',' | ';' | '`'))
            .trim();
        if value.is_empty() {
            continue;
        }
        return Some(value.to_string());
    }
    None
}

/// What a proposal's own text says about the value axis it moves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatedAxis {
    /// No `Axis:` marker at all — the reader may fall back to the lane's lens.
    Unstated,
    /// A marker was stated, and it is not one of [`VALUE_AXES`]. Reports as
    /// `null`: a holder who named a word outside the closed set has not named
    /// an axis, and letting the word through would read downstream as a value
    /// claim nobody made. It is deliberately NOT the same as `Unstated` — the
    /// lens fallback must not rescue an answer the holder got wrong.
    OffVocabulary,
    /// One of [`VALUE_AXES`], stated by the holder.
    Named(&'static str),
}

/// Read the `Axis:` marker [`VALUE_LITERACY_INSTRUCTION`] asks for.
pub fn stated_axis(text: Option<&str>) -> StatedAxis {
    let Some(raw) = text.and_then(|t| marker_value(t, "axis")) else {
        return StatedAxis::Unstated;
    };
    match VALUE_AXES.into_iter().find(|a| raw.eq_ignore_ascii_case(a)) {
        Some(axis) => StatedAxis::Named(axis),
        None => StatedAxis::OffVocabulary,
    }
}

/// Read the `Journey:` marker [`VALUE_LITERACY_INSTRUCTION`] asks for.
///
/// Free text by design — a journey is named in the owned product's own words,
/// and there is no vocabulary to check it against. An explicit "none" answers
/// `None`: an idea that moves no journey saying so is the honest reading, and
/// it must not be dressed up as one that named a journey.
pub fn stated_journey(text: Option<&str>) -> Option<String> {
    let raw = text.and_then(|t| marker_value(t, "journey"))?;
    if STATED_NONE.iter().any(|n| raw.eq_ignore_ascii_case(n)) {
        return None;
    }
    Some(raw)
}

/// Project a stored `rejection_reason` onto [`DECLINE_REASONS`].
///
/// **This is a lossy projection over free text and it is allowed to fail.** The
/// lane stores whatever the rejecting hand typed, plus the mechanical
/// `"Auto-rejected by triage rule '<name>'"` — in which the only signal is the
/// rule's *name*, which an operator chose. So the match is on phrases that can
/// only mean one thing, and everything else answers `None`. A reason invented to
/// fill the field would be worse than an admitted gap: it would read downstream
/// as the night's actual judgement.
///
/// The four groups, in the order they are tested (first match wins, so the more
/// specific phrases come first):
///
/// | reason | phrases |
/// | --- | --- |
/// | `already-done` | already done/fixed/shipped/exists, duplicate, superseded, obsolete |
/// | `outside-mandate` | out of scope, outside/not in scope, outside the mandate, not our/this repo, wrong project, forbidden |
/// | `needs-human` | needs a human, needs review/discussion/decision/an owner, escalate, unclear, ambiguous, too risky |
/// | `low-value` | low value/impact/priority, not worth it, too small/minor/trivial, noise, nitpick, cosmetic |
pub fn decline_reason(raw: Option<&str>) -> Option<&'static str> {
    let text = raw?.trim().to_ascii_lowercase();
    if text.is_empty() {
        return None;
    }
    const GROUPS: [(&str, &[&str]); 4] = [
        (
            "already-done",
            &[
                "already done",
                "already fixed",
                "already shipped",
                "already exists",
                "already implemented",
                "duplicate",
                "superseded",
                "obsolete",
            ],
        ),
        (
            "outside-mandate",
            &[
                "out of scope",
                "outside scope",
                "outside the scope",
                "not in scope",
                "outside the mandate",
                "outside mandate",
                "not our repo",
                "not this repo",
                "wrong project",
                "forbidden",
            ],
        ),
        (
            "needs-human",
            &[
                "needs a human",
                "needs human",
                "needs review",
                "needs discussion",
                "needs a decision",
                "needs an owner",
                "escalate",
                "unclear",
                "ambiguous",
                "too risky",
            ],
        ),
        (
            "low-value",
            &[
                "low value",
                "low-value",
                "low impact",
                "low priority",
                "not worth",
                "too small",
                "too minor",
                "trivial",
                "noise",
                "nitpick",
                "cosmetic",
            ],
        ),
    ];
    for (reason, phrases) in GROUPS {
        if phrases.iter().any(|p| text.contains(p)) {
            // The constant is the vocabulary; this returns a member of it.
            return DECLINE_REASONS.into_iter().find(|r| *r == reason);
        }
    }
    None
}

/// Read one project's backlog as the night left it.
///
/// **Proposals** are every idea standing `accepted` (the ones a `suggest` night
/// leaves for the morning — the very ideas a `blockedReason` counts) then every
/// idea standing `pending`; **declines** are the ideas standing `rejected`. Both
/// are capped at [`MAX_TICK_BACKLOG_ITEMS`], newest first.
///
/// Deliberately *state*, not a time window: a night's blocked dispatch is about
/// the accepted ideas that exist, whichever tick accepted them, and a window
/// keyed on the run's own start would report an empty list for exactly the case
/// the reading is for. `archived` ideas appear in neither list — archiving is
/// lifecycle bookkeeping, not a decision.
///
/// Best-effort by construction: an unreadable backlog answers with what it
/// could read rather than failing the phase, because the night itself already
/// happened.
pub fn night_backlog(pool: &personas_db::DbPool, project_id: &str) -> NightBacklog {
    use personas_db::repos::dev::ideas;

    let mut names = NameCache::default();
    let mut out = NightBacklog::default();

    for status in ["accepted", "pending"] {
        if out.proposals.len() as i64 >= MAX_TICK_BACKLOG_ITEMS {
            break;
        }
        let rows = ideas::list_ideas(
            pool,
            Some(project_id),
            Some(status),
            None,
            Some(MAX_TICK_BACKLOG_ITEMS),
            None,
        )
        .unwrap_or_default();
        for idea in rows {
            if out.proposals.len() as i64 >= MAX_TICK_BACKLOG_ITEMS {
                break;
            }
            out.proposals.push(proposal_from(pool, &idea, &mut names));
        }
    }

    let rejected = ideas::list_ideas(
        pool,
        Some(project_id),
        Some("rejected"),
        None,
        Some(MAX_TICK_BACKLOG_ITEMS),
        None,
    )
    .unwrap_or_default();
    out.declines = rejected
        .into_iter()
        .map(|idea| NightDecline {
            title: idea.title,
            reason: decline_reason(idea.rejection_reason.as_deref()),
            created_at: idea.created_at,
            origin: idea.origin,
        })
        .collect();

    out
}

/// Context/use-case/project names, looked up once each. A night's backlog is
/// dozens of rows over a handful of contexts.
#[derive(Default)]
struct NameCache {
    contexts: std::collections::HashMap<String, Option<String>>,
    use_cases: std::collections::HashMap<String, Option<String>>,
    projects: std::collections::HashMap<String, Option<String>>,
}

impl NameCache {
    fn context(&mut self, pool: &personas_db::DbPool, id: &str) -> Option<String> {
        self.contexts
            .entry(id.to_string())
            .or_insert_with(|| {
                personas_db::repos::dev::contexts::get_context_by_id(pool, id)
                    .ok()
                    .map(|c| c.name)
            })
            .clone()
    }
    fn use_case(&mut self, pool: &personas_db::DbPool, id: &str) -> Option<String> {
        self.use_cases
            .entry(id.to_string())
            .or_insert_with(|| {
                personas_db::repos::dev::use_cases::get_use_case(pool, id)
                    .ok()
                    .map(|u| u.name)
            })
            .clone()
    }
    fn project(&mut self, pool: &personas_db::DbPool, id: &str) -> Option<String> {
        self.projects
            .entry(id.to_string())
            .or_insert_with(|| {
                personas_db::repos::dev::projects::get_project_by_id(pool, id)
                    .ok()
                    .map(|p| p.name)
            })
            .clone()
    }
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn proposal_from(
    pool: &personas_db::DbPool,
    idea: &personas_db::models::DevIdea,
    names: &mut NameCache,
) -> NightProposal {
    let project_id = idea.project_id.clone().unwrap_or_default();
    // Never blank: a proposal whose target could not be named still says what
    // it is against, even if only by id.
    let target = idea
        .context_id
        .as_deref()
        .and_then(|id| names.context(pool, id))
        .or_else(|| {
            (!project_id.is_empty())
                .then(|| names.project(pool, &project_id))
                .flatten()
        })
        .unwrap_or_else(|| project_id.clone());
    // What the holder said about its own proposal, carried through the lane's
    // free-text fields (the lane has no column for either) — `reasoning` first,
    // then `description`, first marker line wins.
    let stated = [idea.reasoning.as_deref(), idea.description.as_deref()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("\n");
    let stated = non_empty(Some(&stated));
    NightProposal {
        title: idea.title.clone(),
        target,
        why: non_empty(idea.reasoning.as_deref())
            .or_else(|| non_empty(idea.description.as_deref())),
        journey: stated_journey(stated.as_deref()).or_else(|| {
            idea.use_case_id
                .as_deref()
                .and_then(|id| names.use_case(pool, id))
        }),
        axis: match stated_axis(stated.as_deref()) {
            StatedAxis::Named(axis) => Some(axis.to_string()),
            // Stated and wrong: `null`, never the word, and never the lens —
            // the fallback exists for a holder that said nothing, not for one
            // that answered off the vocabulary.
            StatedAxis::OffVocabulary => None,
            StatedAxis::Unstated => {
                non_empty(Some(&idea.scan_type)).or_else(|| non_empty(Some(&idea.category)))
            }
        },
        size: proposal_size(idea.effort).map(str::to_string),
        confidence: None,
        // Verbatim, both of them. Everything else on this struct is a
        // projection the module had to argue for; these two are the row's own
        // words, and the argument for them is that a reader grading a tenure
        // needs to know which proposals predate it.
        created_at: idea.created_at.clone(),
        origin: idea.origin.clone(),
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

    // -- the anchorless decision --------------------------------------------

    #[test]
    fn an_anchorless_probation_is_decided_only_inside_the_headless_bridge() {
        // The exact live case: never executed, nothing raised, forced due.
        assert!(anchorless_probation_allowed(
            true, true, false, false, false
        ));
        // Production sees the same mandate and must still defer.
        assert!(
            !anchorless_probation_allowed(false, true, false, false, false),
            "deciding a probation with no review row outside headless mode would leave an \
             audit trail with nothing a human could have read"
        );
    }

    #[test]
    fn an_anchorless_probation_waits_for_the_window_unless_it_is_forced() {
        // Not forced and the window is still open — nothing to decide.
        assert!(!anchorless_probation_allowed(
            true, false, false, false, false
        ));
        // Not forced but the window genuinely closed — decide.
        assert!(anchorless_probation_allowed(
            true, false, true, false, false
        ));
    }

    #[test]
    fn a_persona_that_has_executed_still_goes_through_the_review_path() {
        // An execution exists, so the FK can be satisfied and a real review row
        // must be raised and answered instead.
        assert!(!anchorless_probation_allowed(
            true, true, false, false, true
        ));
        assert!(!anchorless_probation_allowed(
            true, false, true, false, true
        ));
        // And a packet already raised is always the review path's business.
        assert!(!anchorless_probation_allowed(
            true, true, false, true, false
        ));
    }

    #[test]
    fn the_anchorless_path_terminates_on_the_second_incomplete_too() {
        // The streak policy is shared, so the anchorless loop cannot extend
        // forever either: first incomplete extends, second retires.
        assert!(anchorless_probation_allowed(
            true, true, false, false, false
        ));
        assert_eq!(
            headless_probation_decision(BackboneVerdict::Incomplete, 0),
            ProbationDecision::Extend
        );
        // The extension clears `probationReviewId` and leaves the persona still
        // unexecuted, so the next forced tick reaches this same gate…
        assert!(anchorless_probation_allowed(
            true, true, false, false, false
        ));
        // …and this time it ends.
        assert_eq!(
            headless_probation_decision(BackboneVerdict::Incomplete, 1),
            ProbationDecision::Retire
        );
    }

    #[test]
    fn the_anchorless_note_says_what_was_skipped_and_why() {
        let note = anchorless_probation_note(ProbationDecision::Extend.outcome(), "incomplete");
        assert!(note.contains("extended"), "{note}");
        assert!(note.contains("incomplete"), "{note}");
        assert!(note.contains("WITHOUT a manual review row"), "{note}");
        assert!(note.contains("never executed"), "{note}");
        assert!(note.contains(ACTOR), "{note}");
        assert!(note.contains("No human read this"), "{note}");
    }

    #[test]
    fn a_never_executed_app_master_reads_incomplete_not_pass() {
        // What the anchorless path will actually see: an App master whose
        // nights dispatched nothing has no rollup worth the name. It must not
        // fall through to `pass` on a backbone of absences.
        let empty = backbone_reading_from_json(&serde_json::json!({}));
        assert_eq!(backbone_verdict(&empty), BackboneVerdict::Incomplete);
        assert!(unmeasured_rules(&empty).contains(&"delivery"));
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

    // -- the night's proposal list and decline log --------------------------

    #[test]
    fn a_decline_reason_is_mapped_only_when_the_text_can_mean_one_thing() {
        for (raw, expected) in [
            ("Already fixed in #412", "already-done"),
            ("duplicate of the earlier finding", "already-done"),
            ("out of scope for this repo", "outside-mandate"),
            (
                "Auto-rejected by triage rule 'Outside the mandate'",
                "outside-mandate",
            ),
            ("needs a human to decide the tradeoff", "needs-human"),
            ("unclear what the caller expects", "needs-human"),
            ("low impact, not worth a night", "low-value"),
            ("Cosmetic", "low-value"),
        ] {
            let got = decline_reason(Some(raw));
            assert_eq!(got, Some(expected), "{raw}");
            assert!(
                DECLINE_REASONS.contains(&expected),
                "{expected} is outside the vocabulary"
            );
        }

        // Unmeasured is not zero: a reason that means nothing in this
        // vocabulary — and no reason at all — are BOTH `null`, never a guess.
        assert_eq!(decline_reason(None), None);
        assert_eq!(decline_reason(Some("   ")), None);
        assert_eq!(
            decline_reason(Some("Auto-rejected by triage rule 'Nightly sweep'")),
            None,
            "a rule name that says nothing about WHY must not be projected onto a reason"
        );
    }

    #[test]
    fn a_proposal_size_folds_the_emitters_own_effort_ladder() {
        assert_eq!(proposal_size(None), None);
        assert_eq!(proposal_size(Some(1)), Some("xs"));
        assert_eq!(proposal_size(Some(2)), Some("xs"));
        assert_eq!(proposal_size(Some(4)), Some("s"));
        assert_eq!(proposal_size(Some(5)), Some("m"));
        assert_eq!(proposal_size(Some(8)), Some("l"));
        assert_eq!(proposal_size(Some(10)), Some("xl"));
        // Out of the emitter's stated 1..=10 range is not a size.
        assert_eq!(proposal_size(Some(0)), None);
        assert_eq!(proposal_size(Some(11)), None);
    }

    fn backlog_pool() -> personas_db::DbPool {
        personas_db::init_test_db().expect("migrated test db")
    }

    fn backlog_project(pool: &personas_db::DbPool, name: &str) -> String {
        personas_db::repos::dev::projects::create_project(
            pool,
            name,
            &format!("/tmp/{name}"),
            None,
            None,
            None,
            None,
            None,
        )
        .expect("create project")
        .id
    }

    #[test]
    fn a_night_that_produced_nothing_reports_two_empty_lists_not_two_missing_ones() {
        let pool = backlog_pool();
        let project_id = backlog_project(&pool, "quiet-night");

        let backlog = night_backlog(&pool, &project_id);
        assert!(backlog.proposals.is_empty());
        assert!(backlog.declines.is_empty());

        // The distinction the whole reading depends on: the keys are THERE and
        // hold `[]`. A consumer that cannot tell "nothing happened" from
        // "nothing was reported" is back where the prose-only summary left it.
        let json = serde_json::to_value(&backlog).unwrap();
        assert_eq!(json["proposals"], serde_json::json!([]));
        assert_eq!(json["declines"], serde_json::json!([]));
    }

    #[test]
    fn the_night_reports_the_ideas_themselves_not_just_how_many() {
        use personas_db::repos::dev::ideas;

        let pool = backlog_pool();
        let project_id = backlog_project(&pool, "loud-night");

        let accepted = ideas::create_idea(
            &pool,
            Some(&project_id),
            None,
            "stabilize",
            Some("technical"),
            "Close the decode seam",
            Some("the shape is generated but never enforced"),
            Some("two call sites already disagree"),
            Some("accepted"),
            Some(4),
            Some(7),
            Some(2),
            None,
            None,
        )
        .expect("accepted idea");
        ideas::create_idea(
            &pool,
            Some(&project_id),
            None,
            "develop",
            Some("user"),
            "A second pass nobody asked for",
            None,
            None,
            Some("pending"),
            None,
            None,
            None,
            None,
            None,
        )
        .expect("pending idea");
        let declined = ideas::create_idea(
            &pool,
            Some(&project_id),
            None,
            "optimize",
            Some("technical"),
            "Rewrite the renderer",
            None,
            None,
            Some("pending"),
            Some(9),
            Some(3),
            Some(9),
            None,
            None,
        )
        .expect("idea to decline");
        ideas::update_idea(
            &pool,
            &declined.id,
            None,
            None,
            Some("rejected"),
            None,
            None,
            None,
            None,
            Some(Some("out of scope for this mandate")),
        )
        .expect("decline it");

        let backlog = night_backlog(&pool, &project_id);

        // Accepted first — those are the ones a `suggest` night leaves for the
        // morning, and the ones a `blockedReason` counts without naming.
        assert_eq!(backlog.proposals.len(), 2, "{:?}", backlog.proposals);
        let first = &backlog.proposals[0];
        assert_eq!(first.title, "Close the decode seam");
        assert_eq!(
            first.target, "loud-night",
            "no context on the idea ⇒ the project it is against, by name"
        );
        assert_eq!(
            first.why.as_deref(),
            Some("two call sites already disagree")
        );
        assert_eq!(first.axis.as_deref(), Some("stabilize"));
        assert_eq!(first.size.as_deref(), Some("s"));
        assert_eq!(first.journey, None, "this idea names no use case");
        assert_eq!(
            first.confidence, None,
            "the lane records no confidence — the field states the absence"
        );
        assert_eq!(first.title, accepted.title);

        // The pending one is a proposal too, and it carries what it has.
        let second = &backlog.proposals[1];
        assert_eq!(second.title, "A second pass nobody asked for");
        assert_eq!(second.why, None);
        assert_eq!(second.size, None);

        // The decline log, with the reason projected onto the closed set.
        assert_eq!(backlog.declines.len(), 1);
        assert_eq!(backlog.declines[0].title, "Rewrite the renderer");
        assert_eq!(backlog.declines[0].reason, Some("outside-mandate"));
        // A rejected idea is a decline, never a proposal.
        assert!(!backlog
            .proposals
            .iter()
            .any(|p| p.title == "Rewrite the renderer"));
    }

    #[test]
    fn a_proposal_names_the_context_and_the_journey_when_the_idea_does() {
        use personas_db::repos::dev::{contexts, ideas, use_cases};

        let pool = backlog_pool();
        let project_id = backlog_project(&pool, "named-night");
        let context = contexts::create_context(
            &pool,
            &project_id,
            "Decode seam",
            None,
            None,
            Some("[\"app/decode.ts\"]"),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .expect("create context");
        let use_case = use_cases::create_use_case(
            &pool,
            &project_id,
            "Role to schedule",
            None,
            "user_flow",
            None,
            &[],
            None,
            "user",
            None,
        )
        .expect("create use case");

        // `create_finding` is the door that carries BOTH links — a sensor-raised
        // idea is exactly the shape whose target and journey are already known.
        let idea = ideas::create_finding(
            &pool,
            &project_id,
            "standards_finding",
            "Enforce the shape at the seam",
            None,
            Some("technical"),
            Some(&context.id),
            Some(&use_case.id),
            None,
            "seam:decode",
            Some(6),
            Some(6),
            Some(2),
        )
        .expect("finding")
        .expect("a fresh dedup key writes a row");
        ideas::update_idea(
            &pool,
            &idea.id,
            None,
            None,
            Some("accepted"),
            None,
            None,
            None,
            None,
            None,
        )
        .expect("accept it");

        let backlog = night_backlog(&pool, &project_id);
        assert_eq!(backlog.proposals.len(), 1);
        assert_eq!(
            backlog.proposals[0].target, "Decode seam",
            "an idea that names a context is against THAT, not the whole repo"
        );
        assert_eq!(
            backlog.proposals[0].journey.as_deref(),
            Some("Role to schedule")
        );
        assert_eq!(
            backlog.proposals[0].axis.as_deref(),
            Some("standards_finding")
        );
        assert_eq!(backlog.proposals[0].size.as_deref(), Some("m"));
    }

    #[test]
    fn a_proposal_carries_the_axis_and_journey_the_holder_stated_and_nulls_one_it_invented() {
        use personas_db::repos::dev::ideas;

        let pool = backlog_pool();
        let project_id = backlog_project(&pool, "literate-night");

        // What VALUE_LITERACY_INSTRUCTION asks the holder to write: the two
        // marker lines at the end of `reasoning`, since the lane has no column
        // for either.
        ideas::create_idea(
            &pool,
            Some(&project_id),
            None,
            "stabilize",
            Some("technical"),
            "Pin the salary anchor",
            None,
            Some(
                "three analyses in the sample anchored on the wrong figure\n\
                 Journey: cv-analysis\n\
                 Axis: risk",
            ),
            Some("accepted"),
            Some(3),
            Some(7),
            Some(2),
            None,
            None,
        )
        .expect("literate idea");

        // A holder that answered off the vocabulary has not named an axis, and
        // honestly said it moves no journey.
        ideas::create_idea(
            &pool,
            Some(&project_id),
            None,
            "stabilize",
            Some("technical"),
            "Rename an internal helper",
            None,
            Some("nobody outside the module sees this\nJourney: none\nAxis: banana"),
            Some("accepted"),
            Some(1),
            Some(2),
            Some(1),
            None,
            None,
        )
        .expect("illiterate idea");

        let backlog = night_backlog(&pool, &project_id);
        let by_title = |t: &str| {
            backlog
                .proposals
                .iter()
                .find(|p| p.title == t)
                .unwrap_or_else(|| panic!("{t} is missing from {:?}", backlog.proposals))
        };

        let stated = by_title("Pin the salary anchor");
        assert_eq!(
            stated.axis.as_deref(),
            Some("risk"),
            "an axis inside VALUE_AXES beats the `stabilize` lens fallback"
        );
        assert_eq!(stated.journey.as_deref(), Some("cv-analysis"));

        let invented = by_title("Rename an internal helper");
        assert_eq!(
            invented.axis, None,
            "`banana` is not an axis — null, never the word, and never the lens \
             the fallback would have supplied"
        );
        assert_eq!(
            invented.journey, None,
            "`Journey: none` is an honest null, not a journey"
        );
    }

    // =========================================================================
    // The ideation night (§13.13)
    // =========================================================================

    #[test]
    fn an_absent_autopilot_override_leaves_the_projects_own_mode_alone() {
        assert_eq!(select_autopilot_override(None), Ok(None));
    }

    #[test]
    fn every_stored_autopilot_word_is_accepted_as_an_override() {
        use crate::autopilot::AutopilotMode;
        for word in AUTOPILOT_MODES {
            let parsed = select_autopilot_override(Some(word)).expect("known mode");
            assert_eq!(
                parsed.map(AutopilotMode::as_str),
                Some(word),
                "the override vocabulary and the stored vocabulary must be the same four words"
            );
        }
        // Whitespace is the driver's, not a different mode.
        assert_eq!(
            select_autopilot_override(Some("  suggest ")),
            Ok(Some(AutopilotMode::Suggest))
        );
    }

    #[test]
    fn an_unknown_autopilot_word_is_refused_rather_than_ignored() {
        // Silently falling back to the stored mode would run a `full`,
        // dispatching, money-spending night for a driver that asked for a quiet
        // one and read a 200 as confirmation.
        assert_eq!(
            select_autopilot_override(Some("sugest")),
            Err("sugest".to_string())
        );
        assert_eq!(select_autopilot_override(Some("")), Err(String::new()));
    }

    #[test]
    fn ideation_runs_only_when_asked_and_only_for_a_named_project() {
        assert_eq!(
            ideation_decision(false, true, false),
            IdeationDecision::NotRequested,
            "a night nobody asked to author reports no ideation reading at all"
        );
        assert_eq!(
            ideation_decision(true, false, false),
            IdeationDecision::Blocked(IDEATION_NEEDS_PROJECT)
        );
        assert_eq!(ideation_decision(true, true, false), IdeationDecision::Run);
    }

    #[test]
    fn a_test_tick_bypasses_the_pacing_cooldown_but_never_the_spend_guard() {
        // The whole point of the flag: the 20h `dev_scans` cooldown and the
        // default-OFF subscription switch are not arguments to this function,
        // because an explicit tick is exactly the case they were written to
        // exclude. The quota cooldown IS an argument, and it wins.
        assert_eq!(
            ideation_decision(true, true, true),
            IdeationDecision::Blocked(IDEATION_QUOTA_BLOCKED)
        );
        // And it is reported, never raised — a blocked scan still leaves a night
        // that ran.
        let reading = Ideation::blocked(IDEATION_QUOTA_BLOCKED);
        assert!(!reading.ran);
        assert_eq!(reading.authored, None, "unmeasured is not zero");
    }

    #[test]
    fn an_ideation_reading_says_which_of_the_three_answers_it_is() {
        let ran = serde_json::to_value(Ideation::authored("architecture-analyst,ux-reviewer", 7))
            .unwrap();
        assert_eq!(
            ran,
            serde_json::json!({
                "ran": true,
                "lens": "architecture-analyst,ux-reviewer",
                "authored": 7,
                "blocked": null,
            })
        );

        let refused = serde_json::to_value(Ideation::blocked(IDEATION_QUOTA_BLOCKED)).unwrap();
        assert_eq!(refused["ran"], serde_json::json!(false));
        assert_eq!(refused["lens"], serde_json::Value::Null);
        assert_eq!(refused["authored"], serde_json::Value::Null);
        assert_eq!(
            refused["blocked"],
            serde_json::json!(IDEATION_QUOTA_BLOCKED)
        );

        // Launched, then unreadable: the lens is known, the count is not, and
        // `ran` does not claim the night's ideas are in the backlog below it.
        let broken = serde_json::to_value(Ideation::unmeasured(
            "security-auditor",
            "scan sc-1 ended `error`: provider refused",
        ))
        .unwrap();
        assert_eq!(broken["ran"], serde_json::json!(false));
        assert_eq!(broken["lens"], serde_json::json!("security-auditor"));
        assert_eq!(broken["authored"], serde_json::Value::Null);
        assert!(broken["blocked"].as_str().unwrap().contains("sc-1"));
    }

    #[test]
    fn the_ideation_wait_refuses_an_override_that_would_not_wait_at_all() {
        assert_eq!(
            parse_ideation_timeout_secs(None),
            IDEATION_TIMEOUT_DEFAULT_SECS
        );
        assert_eq!(parse_ideation_timeout_secs(Some(" 90 ")), 90);
        // A zero wait would spend on the scan and then report nothing about it.
        assert_eq!(
            parse_ideation_timeout_secs(Some("0")),
            IDEATION_TIMEOUT_DEFAULT_SECS
        );
        assert_eq!(
            parse_ideation_timeout_secs(Some("soon")),
            IDEATION_TIMEOUT_DEFAULT_SECS
        );
    }

    #[test]
    fn every_row_says_when_it_was_raised_and_by_which_sensor() {
        use personas_db::repos::dev::ideas;

        let pool = backlog_pool();
        let project_id = backlog_project(&pool, "dated-night");

        let scanned = ideas::create_idea(
            &pool,
            Some(&project_id),
            None,
            "stabilize",
            Some("technical"),
            "Close the decode seam",
            Some("the shape is generated but never enforced"),
            Some("two call sites already disagree"),
            Some("accepted"),
            Some(4),
            Some(7),
            Some(2),
            None,
            None,
        )
        .expect("scanner idea");
        let sensed = ideas::create_finding(
            &pool,
            &project_id,
            "standards_finding",
            "Enforce the shape at the seam",
            None,
            Some("technical"),
            None,
            None,
            None,
            "seam:decode",
            Some(6),
            Some(6),
            Some(2),
        )
        .expect("finding")
        .expect("a fresh dedup key writes a row");
        let declined = ideas::create_idea(
            &pool,
            Some(&project_id),
            None,
            "stabilize",
            Some("technical"),
            "Rewrite the renderer",
            None,
            None,
            Some("rejected"),
            Some(9),
            Some(2),
            Some(8),
            None,
            None,
        )
        .expect("declined idea");

        let backlog = night_backlog(&pool, &project_id);
        let proposal = |t: &str| {
            backlog
                .proposals
                .iter()
                .find(|p| p.title == t)
                .unwrap_or_else(|| panic!("{t} missing"))
        };

        // Verbatim, both of them.
        assert_eq!(
            proposal("Close the decode seam").created_at,
            scanned.created_at
        );
        assert_eq!(
            proposal("Close the decode seam").origin,
            None,
            "a classic Idea-Scanner idea has no sensor, and null says so"
        );
        assert_eq!(
            proposal("Enforce the shape at the seam").created_at,
            sensed.created_at
        );
        assert_eq!(
            proposal("Enforce the shape at the seam").origin.as_deref(),
            Some("standards_finding")
        );
        assert_eq!(backlog.declines.len(), 1);
        assert_eq!(backlog.declines[0].created_at, declined.created_at);
        assert_eq!(backlog.declines[0].origin, None);

        // Additive, and the addition is checked as such: the seven fields a
        // driver already deep-scans are still there, spelled the same way, on
        // the same rows.
        let json = serde_json::to_value(&backlog).unwrap();
        let row = json["proposals"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["title"] == serde_json::json!("Close the decode seam"))
            .unwrap();
        assert_eq!(row["title"], serde_json::json!("Close the decode seam"));
        assert_eq!(row["target"], serde_json::json!("dated-night"));
        assert_eq!(
            row["why"],
            serde_json::json!("two call sites already disagree")
        );
        assert_eq!(row["journey"], serde_json::Value::Null);
        assert_eq!(row["axis"], serde_json::json!("stabilize"));
        assert_eq!(row["size"], serde_json::json!("s"));
        assert_eq!(row["confidence"], serde_json::Value::Null);
        assert_eq!(row["createdAt"], serde_json::json!(scanned.created_at));
        assert_eq!(row["origin"], serde_json::Value::Null);
        assert_eq!(
            row.as_object().unwrap().len(),
            9,
            "seven original fields plus the two added — nothing renamed, nothing dropped"
        );

        let decline = &json["declines"][0];
        assert_eq!(decline["title"], serde_json::json!("Rewrite the renderer"));
        assert_eq!(decline["reason"], serde_json::Value::Null);
        assert_eq!(decline["createdAt"], serde_json::json!(declined.created_at));
        assert_eq!(decline["origin"], serde_json::Value::Null);
        assert_eq!(decline.as_object().unwrap().len(), 4);
    }
}
