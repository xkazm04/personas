//! The ONE autonomy model — the single front door for "may this autonomous
//! action run (for this project)?"
//!
//! # Why this module exists
//!
//! The app grew two overlapping autonomy control surfaces:
//!
//! 1. ~15 **global** `autonomous_*` booleans in [`crate::db::settings_keys`]
//!    (opt-in toggles surfaced in the Limits/Admin UI). Each gates one
//!    background subscription (goal advancement, idea scan, Athena reactions, …).
//! 2. A **per-project** `autopilot_mode:<project_id>` enum
//!    ([`crate::engine::autopilot`]) documented as *overriding* the legacy global
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
//!   [`crate::db::settings_keys::validate_value`]; this only hardens against a
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
//! [`crate::commands::companion::chat::autonomous_mode_enabled`] (used by the
//! companion proactive tick, fleet bridge, message/exec triage). It reads the
//! same [`Action::CompanionMaster`] key; kept as a thin wrapper for callers that
//! only have a `DbPool` and want the master bool directly.
//!
//! # Legacy keys (quarantined, no longer read)
//!
//! `autonomous_message_triage` and `autonomous_review_triage` were folded into
//! the master toggle and are **not** consulted anywhere. They stay allow-listed
//! so existing rows / external writers stay harmless, but setting them emits a
//! deprecation warning (see [`crate::db::settings_keys::deprecated_replacement`]).

use std::collections::HashMap;

use crate::db::settings_keys;
use crate::db::DbPool;
use crate::engine::autopilot::{self, AutopilotMode, Capability};

// `autonomy` is the single front door: re-export the per-project primitives from
// `autopilot` so callers import mode-loading and the "any project opted in"
// early-out from here alongside [`is_allowed`] / [`global_enabled`].
pub use crate::engine::autopilot::{any_enabled, load_modes};

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
}

/// Read an action's **global** flag as a bool (`"true"` → on). The chokepoint
/// that replaces the repeated `settings::get(..).as_deref() == Some("true")`
/// boilerplate at every subscription tick.
pub fn global_enabled(pool: &DbPool, action: Action) -> bool {
    crate::db::repos::core::settings::get(pool, action.global_key())
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
        assert!(!is_allowed(&m, "p_measure", true, Action::KpiGoalDerivation));
        // UNSET project → follow the global flag in both directions (legacy).
        assert!(is_allowed(&m, "p_unset", true, Action::GoalAdvancement));
        assert!(!is_allowed(&m, "p_unset", false, Action::GoalAdvancement));
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
