//! The ONE autonomy model — the single front door for "may this autonomous
//! action run (for this project)?"
//!
//! # Why this module exists
//!
//! The app grew two overlapping autonomy control surfaces:
//!
//! 1. ~15 **global** `autonomous_*` booleans in [`personas_db::settings_keys`]
//!    (opt-in toggles surfaced in the Limits/Admin UI). Each gates one
//!    background subscription (goal advancement, idea scan, Athena reactions, …).
//! 2. A **per-project** `autopilot_mode:<project_id>` enum
//!    ([`crate::autopilot`]) documented as *overriding* the legacy global
//!    flags for the KPI → goal → team loop.
//!
//! That left "who wins where?" ambiguous at every read site — each subscription
//! re-derived precedence inline. This module encodes the precedence **once** so
//! no call site has to, and enumerates every read site below so the surface is
//! auditable in one place.
//!
//! # Precedence (the single rule)
//!
//! For a given [`Action`] and (optional) project:
//!
//! - If the action is **project-scoped** (it maps to an [`autopilot::Capability`]):
//!   an **explicit** `autopilot_mode:<project_id>` row wins **in both directions**
//!   — a project can opt IN while the global flag is off, or opt OUT while it is
//!   on. With **no** row, fall back to the legacy global flag. This is exactly
//!   [`autopilot::cap_enabled`]; see [`Action::capability`].
//! - If the action is **global-only** (no per-project override is wired yet —
//!   the discovery loop, assignment retry, review triage, etc.): the global flag
//!   is authoritative and the project id is ignored.
//!
//! Conservative tie-breaks (this is a safety gate — fail closed):
//! - **Unset** per-project mode → follow the global flag (legacy behavior, no
//!   change for existing global-on users).
//! - **Unknown / corrupt** per-project enum value → treated as the **most
//!   restrictive** mode (`off`) by [`load_modes`], so a garbled row can never
//!   *widen* autonomy beyond what the global flag alone would grant. (Writes of
//!   unknown enum values are already rejected by
//!   [`personas_db::settings_keys::validate_value`]; this only hardens against a
//!   row that bypassed validation.)
//!
//! # Read-site registry (every consumer routes through here)
//!
//! Project-scoped (via [`is_allowed`] + [`load_modes`]/[`any_enabled`]):
//! - `engine::subscription` GoalAdvance tick → [`Action::GoalAdvancement`]
//! - `engine::subscription` KpiGoalDerivation tick → [`Action::KpiGoalDerivation`]
//! - `engine::subscription` KpiEvaluation tick → [`Action::KpiEvaluation`]
//! - `engine::subscription` FleetStall watchdog → `any_full` over [`load_modes`]
//!
//! Global-only (via [`global_enabled`]):
//! - `engine::subscription` AssignmentAutoResume → [`Action::AssignmentRetry`]
//! - `engine::subscription` ManualReviewAutoTriage (master gate) →
//!   [`Action::CompanionMaster`]; high-severity opt-in → [`Action::ReviewTriageHigh`]
//! - `engine::subscription` BacklogToGoal → [`Action::BacklogToGoal`]
//! - `engine::subscription` IdeaReplenish → [`Action::IdeaScan`]
//! - `engine::subscription` BacklogTriage → [`Action::BacklogTriage`]
//! - `engine::subscription` DirectorStorm → [`Action::DirectorStorm`]
//! - `engine::subscription` AthenaChannelReaction → [`Action::AthenaReactions`]
//!   + review resolution opt-in → [`Action::AthenaReviewResolution`]
//! - `engine::deliberation` tick → [`Action::Deliberation`]
//!
//! The companion-side master toggle also has the convenience reader
//! `commands::companion::chat::autonomous_mode_enabled` (used by the
//! companion proactive tick, fleet bridge, message/exec triage). It reads the
//! same [`Action::CompanionMaster`] key; kept as a thin wrapper for callers that
//! only have a `DbPool` and want the master bool directly.
//!
//! # Legacy keys (quarantined, no longer read)
//!
//! `autonomous_message_triage` and `autonomous_review_triage` were folded into
//! the master toggle and are **not** consulted anywhere. They stay allow-listed
//! so existing rows / external writers stay harmless, but setting them emits a
//! deprecation warning (see [`personas_db::settings_keys::deprecated_replacement`]).

use std::collections::HashMap;

use crate::app_master::{self, MandateRecord, MandateRefusal, RUNG_BRANCH, RUNG_READ, RUNG_RETRY};
use crate::autopilot::{self, AutopilotMode, Capability};
use personas_db::settings_keys;
use personas_db::DbPool;

// `autonomy` is the single front door: re-export the per-project primitives from
// `autopilot` so callers import mode-loading and the "any project opted in"
// early-out from here alongside [`is_allowed`] / [`global_enabled`].
pub use crate::autopilot::{any_enabled, load_modes};

/// Every gate-able autonomous action, mapped to its global settings key and
/// (where wired) its per-project [`autopilot::Capability`]. Adding a per-project
/// override for a currently global-only action is a one-line change here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    // --- Project-scoped (autopilot_mode overrides the global flag where set) ---
    /// Advance a goal-linked team's active goal unattended.
    GoalAdvancement,
    /// Derive a goal for an off-track KPI.
    KpiGoalDerivation,
    /// Measure due KPIs on cadence.
    KpiEvaluation,
    // --- Global-only (no per-project override wired yet) ---
    /// Master companion autonomy toggle (implies message + review triage).
    CompanionMaster,
    /// Resume a soft-paused team assignment after a retryable failure.
    AssignmentRetry,
    /// Also auto-approve HIGH/critical technical-status reviews (riskier opt-in).
    ReviewTriageHigh,
    /// Promote the best pending backlog idea into a goal for an idling project.
    BacklogToGoal,
    /// Replenish a fully-idle project's backlog via an idea scan.
    IdeaScan,
    /// Rank / reject the pending-idea queue (Product Strategist pass).
    BacklogTriage,
    /// Run a focused Director coaching pass on a storming persona.
    DirectorStorm,
    /// Post reasoned Athena reactions into a team channel.
    AthenaReactions,
    /// Let Athena RESOLVE a parked `awaiting_review` cap-out (approve/incident/escalate).
    AthenaReviewResolution,
    /// Advance an open team deliberation unattended.
    Deliberation,
}

impl Action {
    /// The `app_settings` key holding this action's global on/off flag.
    pub fn global_key(self) -> &'static str {
        match self {
            Self::GoalAdvancement => settings_keys::AUTONOMOUS_GOAL_ADVANCEMENT,
            Self::KpiGoalDerivation => settings_keys::AUTONOMOUS_KPI_GOAL_DERIVATION,
            Self::KpiEvaluation => settings_keys::AUTONOMOUS_KPI_EVALUATION,
            Self::CompanionMaster => settings_keys::COMPANION_AUTONOMOUS_MODE,
            Self::AssignmentRetry => settings_keys::AUTONOMOUS_ASSIGNMENT_RETRY,
            Self::ReviewTriageHigh => settings_keys::AUTONOMOUS_REVIEW_TRIAGE_HIGH,
            Self::BacklogToGoal => settings_keys::AUTONOMOUS_BACKLOG_TO_GOAL,
            Self::IdeaScan => settings_keys::AUTONOMOUS_IDEA_SCAN,
            Self::BacklogTriage => settings_keys::AUTONOMOUS_BACKLOG_TRIAGE,
            Self::DirectorStorm => settings_keys::AUTONOMOUS_DIRECTOR_STORM,
            Self::AthenaReactions => settings_keys::AUTONOMOUS_ATHENA_REACTIONS,
            Self::AthenaReviewResolution => settings_keys::AUTONOMOUS_ATHENA_REVIEW_RESOLUTION,
            Self::Deliberation => settings_keys::AUTONOMOUS_DELIBERATION,
        }
    }

    /// The per-project [`autopilot::Capability`] this action maps to, or `None`
    /// when it is a global-only action (autopilot does not govern it yet).
    pub fn capability(self) -> Option<Capability> {
        match self {
            Self::GoalAdvancement => Some(Capability::GoalAdvancement),
            Self::KpiGoalDerivation => Some(Capability::KpiGoalDerivation),
            Self::KpiEvaluation => Some(Capability::KpiEvaluation),
            _ => None,
        }
    }

    /// The **App master scope rung** this action needs (`0 read · 1 retry ·
    /// 2 open branch/PR`; see [`crate::app_master`]).
    ///
    /// The mapping asks one question per action: *what does running this
    /// actually do to the repository?* Reading, ranking and measuring are
    /// rung 0 no matter how much they cost; re-running work that already
    /// exists is rung 1; anything that authors a change is rung 2.
    ///
    /// This is a **second, independent** gate. Autopilot mode answers "is this
    /// project on autopilot for this capability"; the rung answers "is the
    /// holder of this project allowed to go this far at all". A project can be
    /// on `full` autopilot and still be refused by a rung-0 mandate — which is
    /// exactly the state a probationary read-only App master is in.
    pub fn required_rung(self) -> u8 {
        match self {
            // Observe, measure, rank, report. No write reaches the repo.
            Self::KpiEvaluation
            | Self::BacklogTriage
            | Self::IdeaScan
            | Self::DirectorStorm
            | Self::AthenaReactions
            | Self::ReviewTriageHigh
            | Self::AthenaReviewResolution
            | Self::CompanionMaster => RUNG_READ,
            // Re-run existing work; no new change is authored.
            Self::AssignmentRetry => RUNG_RETRY,
            // These author work: a derived goal, an advanced goal, a resolved
            // deliberation and a promoted backlog idea all end in a session
            // that edits the checkout.
            Self::KpiGoalDerivation
            | Self::GoalAdvancement
            | Self::BacklogToGoal
            | Self::Deliberation => RUNG_BRANCH,
        }
    }
}

/// Read an action's **global** flag as a bool (`"true"` → on). The chokepoint
/// that replaces the repeated `settings::get(..).as_deref() == Some("true")`
/// boilerplate at every subscription tick.
pub fn global_enabled(pool: &DbPool, action: Action) -> bool {
    personas_db::repos::core::settings::get(pool, action.global_key())
        .ok()
        .flatten()
        .as_deref()
        == Some("true")
}

/// Resolve whether `action` runs for `project_id` this tick, given the
/// pre-loaded `modes` map and the action's `global` flag. Encodes the whole
/// precedence rule (see module docs): project-scoped actions honor an explicit
/// autopilot mode in both directions; global-only actions follow `global`.
pub fn is_allowed(
    modes: &HashMap<String, AutopilotMode>,
    project_id: &str,
    global: bool,
    action: Action,
) -> bool {
    match action.capability() {
        Some(cap) => autopilot::cap_enabled(modes, project_id, global, cap),
        None => global,
    }
}

// ---------------------------------------------------------------------------
// App master mandate — the second gate (P4)
// ---------------------------------------------------------------------------

/// Load every project's App master mandate for this tick. Mirrors
/// [`load_modes`]: one prefix query, absent = unmandated.
pub use crate::app_master::load_mandates;

/// Does this project's App master mandate permit `action`?
///
/// `Ok(())` for **every project that carries no mandate** — this gate is
/// strictly additive, so nothing about an ordinary project's behaviour
/// changes. For a mandated project the rung ladder decides, and a refusal is
/// [`MandateRefusal::AboveRung`]: typed, naming the action, both rungs and the
/// owner to escalate to.
///
/// Deliberately separate from [`is_allowed`] rather than folded into it.
/// `is_allowed` answers a *configuration* question and a `false` is a
/// no-op-this-tick; a mandate refusal is a *governance* answer that must be
/// reported, counted and escalated. Collapsing them into one `bool` would
/// throw away the reason at the exact call site that needs it.
pub fn mandate_permits(
    mandates: &HashMap<String, MandateRecord>,
    project_id: &str,
    action: Action,
) -> Result<(), MandateRefusal> {
    let Some(record) = mandates.get(project_id) else {
        return Ok(());
    };
    record
        .mandate
        .permits_rung(action.required_rung(), action.label())
}

/// One-shot variant for call sites that hold a pool and a single project (the
/// overnight tick, the diff chokepoint) rather than a pre-loaded map.
pub fn mandate_permits_for(
    pool: &DbPool,
    project_id: &str,
    action: Action,
) -> Result<(), MandateRefusal> {
    let Some(record) = app_master::get_mandate(pool, project_id) else {
        return Ok(());
    };
    record
        .mandate
        .permits_rung(action.required_rung(), action.label())
}

impl Action {
    /// Human label used in refusal messages and review packets.
    pub fn label(self) -> &'static str {
        match self {
            Self::GoalAdvancement => "advance a goal",
            Self::KpiGoalDerivation => "derive a goal from an off-track KPI",
            Self::KpiEvaluation => "measure due KPIs",
            Self::CompanionMaster => "companion autonomy",
            Self::AssignmentRetry => "retry a failed assignment",
            Self::ReviewTriageHigh => "auto-triage a high-severity review",
            Self::BacklogToGoal => "promote a backlog idea into a goal",
            Self::IdeaScan => "scan for ideas",
            Self::BacklogTriage => "triage the backlog",
            Self::DirectorStorm => "run a Director coaching pass",
            Self::AthenaReactions => "post channel reactions",
            Self::AthenaReviewResolution => "resolve a parked review",
            Self::Deliberation => "advance a deliberation",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn modes(pairs: &[(&str, AutopilotMode)]) -> HashMap<String, AutopilotMode> {
        pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    }

    #[test]
    fn global_only_action_ignores_modes_and_follows_global() {
        // A project on Full autopilot must NOT flip a global-only action on.
        let m = modes(&[("p", AutopilotMode::Full)]);
        assert!(!is_allowed(&m, "p", false, Action::IdeaScan));
        assert!(is_allowed(&m, "p", true, Action::IdeaScan));
        // Project with no capability mapping → project id is irrelevant.
        assert_eq!(Action::AssignmentRetry.capability(), None);
        assert_eq!(Action::CompanionMaster.capability(), None);
    }

    #[test]
    fn project_scoped_matrix_set_and_unset_x_global_on_off() {
        let m = modes(&[
            ("p_full", AutopilotMode::Full),
            ("p_off", AutopilotMode::Off),
            ("p_measure", AutopilotMode::Measure),
        ]);
        // Explicit Full opts IN even when global is off.
        assert!(is_allowed(&m, "p_full", false, Action::GoalAdvancement));
        // Explicit Off opts OUT even when global is on.
        assert!(!is_allowed(&m, "p_off", true, Action::KpiEvaluation));
        // Measure grants KpiEvaluation but not KpiGoalDerivation, regardless of global.
        assert!(is_allowed(&m, "p_measure", false, Action::KpiEvaluation));
        assert!(!is_allowed(
            &m,
            "p_measure",
            true,
            Action::KpiGoalDerivation
        ));
        // UNSET project → follow the global flag in both directions (legacy).
        assert!(is_allowed(&m, "p_unset", true, Action::GoalAdvancement));
        assert!(!is_allowed(&m, "p_unset", false, Action::GoalAdvancement));
    }

    // -- App master mandate gate (P4) ----------------------------------------

    fn all_actions() -> [Action; 13] {
        [
            Action::GoalAdvancement,
            Action::KpiGoalDerivation,
            Action::KpiEvaluation,
            Action::CompanionMaster,
            Action::AssignmentRetry,
            Action::ReviewTriageHigh,
            Action::BacklogToGoal,
            Action::IdeaScan,
            Action::BacklogTriage,
            Action::DirectorStorm,
            Action::AthenaReactions,
            Action::AthenaReviewResolution,
            Action::Deliberation,
        ]
    }

    fn record(project_id: &str, rung: u8) -> MandateRecord {
        MandateRecord {
            persona_id: "p1".into(),
            project_id: project_id.into(),
            mandate: crate::app_master::Mandate {
                scope_rung: rung,
                owner: "ana@example.com".into(),
                ..Default::default()
            },
            probation_ends_at: "2026-09-22T00:00:00Z".into(),
            review_cadence_days: 30,
            retire_criteria: Vec::new(),
            probation_decided_at: None,
            probation_decision: None,
            probation_review_id: None,
            headless_incomplete_streak: 0,
        }
    }

    #[test]
    fn an_unmandated_project_is_never_refused() {
        let mandates: HashMap<String, MandateRecord> = HashMap::new();
        for a in all_actions() {
            assert!(
                mandate_permits(&mandates, "any-project", a).is_ok(),
                "the mandate gate must be additive: {a:?} was refused for a project with no App master"
            );
        }
        // A mandate on a DIFFERENT project must not leak onto this one.
        let mut m = HashMap::new();
        m.insert("other".to_string(), record("other", RUNG_READ));
        assert!(mandate_permits(&m, "mine", Action::GoalAdvancement).is_ok());
    }

    #[test]
    fn a_read_only_mandate_refuses_every_authoring_action_by_name() {
        let mut m = HashMap::new();
        m.insert("p".to_string(), record("p", RUNG_READ));
        // Rung 0 still measures, ranks and reports.
        assert!(mandate_permits(&m, "p", Action::KpiEvaluation).is_ok());
        assert!(mandate_permits(&m, "p", Action::BacklogTriage).is_ok());
        // …but authors nothing, and cannot even retry.
        let refused = mandate_permits(&m, "p", Action::GoalAdvancement).unwrap_err();
        assert!(refused.to_string().contains("advance a goal"), "{refused}");
        assert!(mandate_permits(&m, "p", Action::AssignmentRetry).is_err());
        assert!(mandate_permits(&m, "p", Action::Deliberation).is_err());
    }

    #[test]
    fn rung_two_permits_every_action_v1_can_grant() {
        let mut m = HashMap::new();
        m.insert("p".to_string(), record("p", RUNG_BRANCH));
        for a in all_actions() {
            assert!(
                mandate_permits(&m, "p", a).is_ok(),
                "rung 2 is the ceiling v1 grants — {a:?} must fit under it"
            );
        }
    }

    #[test]
    fn the_mandate_gate_is_independent_of_autopilot_mode() {
        // A project on FULL autopilot whose mandate is rung 0: autopilot says
        // yes, the mandate says no. Both must be consulted; neither implies
        // the other.
        let modes = modes(&[("p", AutopilotMode::Full)]);
        let mut mandates = HashMap::new();
        mandates.insert("p".to_string(), record("p", RUNG_READ));
        assert!(is_allowed(&modes, "p", false, Action::GoalAdvancement));
        assert!(mandate_permits(&mandates, "p", Action::GoalAdvancement).is_err());
    }

    #[test]
    fn every_action_maps_to_a_grantable_rung() {
        for a in all_actions() {
            assert!(
                a.required_rung() <= crate::app_master::MAX_GRANTABLE_RUNG,
                "{a:?} requires rung {} — an action no mandate can ever permit is \
                 dead code pretending to be a gate",
                a.required_rung()
            );
            assert!(!a.label().is_empty(), "{a:?} has no refusal label");
        }
    }

    #[test]
    fn every_action_has_a_valid_global_key() {
        for a in [
            Action::GoalAdvancement,
            Action::KpiGoalDerivation,
            Action::KpiEvaluation,
            Action::CompanionMaster,
            Action::AssignmentRetry,
            Action::ReviewTriageHigh,
            Action::BacklogToGoal,
            Action::IdeaScan,
            Action::BacklogTriage,
            Action::DirectorStorm,
            Action::AthenaReactions,
            Action::AthenaReviewResolution,
            Action::Deliberation,
        ] {
            // Each mapped key must be an accepted settings key.
            assert!(
                settings_keys::validate_key(a.global_key()).is_ok(),
                "global key for {a:?} is not allow-listed"
            );
        }
    }
}
