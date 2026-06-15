//! Per-project **autopilot** — one legible switch that owns whether a project's
//! KPI → goal → team loop runs unattended, so the cockpit (Teams › KPIs /
//! Factory) can drive autonomy per project instead of the user hunting a dozen
//! global `autonomous_*` setting keys (docs/plans/kpi-driven-orchestration.md,
//! direction D2).
//!
//! ## Storage + back-compat
//!
//! A project's mode is an `app_settings` row keyed `autopilot_mode:<project_id>`,
//! value ∈ {`off`, `measure`, `suggest`, `full`}. A project with **no row**
//! falls back to the legacy global `autonomous_*` flags (existing global-on
//! users are unaffected). An **explicit** mode is authoritative for that project
//! and overrides the global flag in BOTH directions — a project can opt IN while
//! the global flag is off, or opt OUT while it is on. This is what lets the
//! Factory turn a single project onto autopilot without touching global state.
//!
//! ## Mode → capability
//!
//! Only the **wired** capabilities are modeled here. The discovery loop
//! (backlog-to-goal, idea scan, backlog triage, Athena reactions) still rides
//! its own global flags and folds into Suggest/Full in a follow-up — keeping
//! this enum honest about what the modes actually gate today.
//!
//! ```text
//!   off      → nothing
//!   measure  → KpiEvaluation
//!   suggest  → KpiEvaluation, KpiGoalDerivation        (goals derived, not advanced)
//!   full     → KpiEvaluation, KpiGoalDerivation, GoalAdvancement
//! ```

use std::collections::HashMap;

use crate::db::DbPool;

/// `app_settings` key prefix; full key is `autopilot_mode:<project_id>`. Mirrors
/// the per-persona prefixes (`auto_rollback:`, …) and is allow-listed in
/// `settings_keys::ALLOWED_PREFIXES`.
pub const AUTOPILOT_MODE_PREFIX: &str = "autopilot_mode:";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutopilotMode {
    Off,
    Measure,
    Suggest,
    Full,
}

/// The autonomy capabilities a mode can grant. Extend as more subscriptions are
/// brought under per-project control.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Capability {
    KpiEvaluation,
    KpiGoalDerivation,
    GoalAdvancement,
}

impl AutopilotMode {
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim() {
            "off" => Some(Self::Off),
            "measure" => Some(Self::Measure),
            "suggest" => Some(Self::Suggest),
            "full" => Some(Self::Full),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Measure => "measure",
            Self::Suggest => "suggest",
            Self::Full => "full",
        }
    }

    /// Whether this mode grants `cap`. The single source of truth for the
    /// mode→capability matrix (kept in sync with the module doc + the UI copy).
    pub fn allows(self, cap: Capability) -> bool {
        use Capability::*;
        match self {
            Self::Off => false,
            Self::Measure => matches!(cap, KpiEvaluation),
            Self::Suggest => matches!(cap, KpiEvaluation | KpiGoalDerivation),
            Self::Full => true,
        }
    }
}

/// The full per-project key for a project's autopilot mode.
pub fn setting_key(project_id: &str) -> String {
    format!("{AUTOPILOT_MODE_PREFIX}{project_id}")
}

/// Load every project's EXPLICIT autopilot mode in one query (project_id → mode).
/// Projects with no row are absent (→ the caller falls back to the global flag).
pub fn load_modes(pool: &DbPool) -> HashMap<String, AutopilotMode> {
    let mut map = HashMap::new();
    if let Ok(rows) = crate::db::repos::core::settings::get_by_prefix(pool, AUTOPILOT_MODE_PREFIX) {
        for (key, val) in rows {
            if let Some(pid) = key.strip_prefix(AUTOPILOT_MODE_PREFIX) {
                if let Some(mode) = AutopilotMode::parse(&val) {
                    map.insert(pid.to_string(), mode);
                }
            }
        }
    }
    map
}

/// True when ANY project has opted into autopilot (explicit, non-off). Lets a
/// subscription keep its cheap "fully off → no-op" early-out: when the global
/// flag is off AND no project opted in, the tick does nothing — exactly as
/// before this feature existed.
pub fn any_enabled(modes: &HashMap<String, AutopilotMode>) -> bool {
    modes.values().any(|m| *m != AutopilotMode::Off)
}

/// Resolve whether `cap` runs for `project_id` this tick. An explicit per-project
/// mode wins (in both directions); otherwise fall back to the legacy global flag.
pub fn cap_enabled(
    modes: &HashMap<String, AutopilotMode>,
    project_id: &str,
    global: bool,
    cap: Capability,
) -> bool {
    match modes.get(project_id) {
        Some(mode) => mode.allows(cap),
        None => global,
    }
}

#[cfg(test)]
mod tests {
    use super::Capability::*;
    use super::*;

    #[test]
    fn matrix_is_monotonic() {
        assert!(!AutopilotMode::Off.allows(KpiEvaluation));
        assert!(AutopilotMode::Measure.allows(KpiEvaluation));
        assert!(!AutopilotMode::Measure.allows(KpiGoalDerivation));
        assert!(AutopilotMode::Suggest.allows(KpiGoalDerivation));
        assert!(!AutopilotMode::Suggest.allows(GoalAdvancement));
        assert!(AutopilotMode::Full.allows(GoalAdvancement));
    }

    #[test]
    fn parse_round_trips() {
        for m in [
            AutopilotMode::Off,
            AutopilotMode::Measure,
            AutopilotMode::Suggest,
            AutopilotMode::Full,
        ] {
            assert_eq!(AutopilotMode::parse(m.as_str()), Some(m));
        }
        assert_eq!(AutopilotMode::parse("bogus"), None);
    }

    #[test]
    fn explicit_mode_overrides_global_both_ways() {
        let mut modes = HashMap::new();
        modes.insert("p_full".to_string(), AutopilotMode::Full);
        modes.insert("p_off".to_string(), AutopilotMode::Off);

        // Global OFF, but a project opted into Full → its caps run.
        assert!(cap_enabled(&modes, "p_full", false, GoalAdvancement));
        // Global ON, but a project opted Off → nothing runs for it.
        assert!(!cap_enabled(&modes, "p_off", true, KpiEvaluation));
        // No explicit mode → follow the global flag (legacy behavior).
        assert!(cap_enabled(&modes, "p_unset", true, KpiEvaluation));
        assert!(!cap_enabled(&modes, "p_unset", false, KpiEvaluation));
    }

    #[test]
    fn any_enabled_ignores_off() {
        let mut modes = HashMap::new();
        modes.insert("a".to_string(), AutopilotMode::Off);
        assert!(!any_enabled(&modes));
        modes.insert("b".to_string(), AutopilotMode::Measure);
        assert!(any_enabled(&modes));
    }
}
