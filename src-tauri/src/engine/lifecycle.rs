//! Typestate lifecycle enums for triggers, automations, and rotation entries.
//!
//! Each enum defines explicit transition methods that return
//! `Result<NextState, InvalidTransition>`, making illegal state transitions
//! unrepresentable at compile time where possible and enforced at runtime
//! where DB roundtrips are involved.
//!
//! Modelled after [`ExecutionState`](super::types::ExecutionState) which
//! already proves this pattern in the codebase.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// =============================================================================
// Error type
// =============================================================================

/// Returned when a caller attempts a state transition that is not allowed.
#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)]
pub struct InvalidTransition {
    pub entity: &'static str,
    pub from: String,
    pub to: String,
}

impl fmt::Display for InvalidTransition {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Invalid {} transition: '{}' -> '{}'",
            self.entity, self.from, self.to
        )
    }
}

impl std::error::Error for InvalidTransition {}

// =============================================================================
// TriggerStatus
// =============================================================================

/// Lifecycle states for a persona trigger.
///
/// Valid transitions:
///   Active  -> Paused | Errored | Disabled
///   Paused  -> Active | Disabled
///   Errored -> Active | Paused | Disabled
///   Disabled -> Active
///
/// The DB stores `enabled INTEGER` (0|1). For backwards compatibility,
/// use [`TriggerStatus::from_enabled`] / [`TriggerStatus::is_enabled`]
/// to bridge the gap until a full migration adds a status column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum TriggerStatus {
    Active,
    Paused,
    Errored,
    Disabled,
}

#[allow(dead_code)]
impl TriggerStatus {
    /// Check whether transitioning from `self` to `target` is valid.
    pub fn can_transition_to(&self, target: TriggerStatus) -> bool {
        matches!(
            (self, target),
            // Active can pause, error, or disable
            (TriggerStatus::Active, TriggerStatus::Paused)
                | (TriggerStatus::Active, TriggerStatus::Errored)
                | (TriggerStatus::Active, TriggerStatus::Disabled)
                // Paused can resume or disable
                | (TriggerStatus::Paused, TriggerStatus::Active)
                | (TriggerStatus::Paused, TriggerStatus::Disabled)
                // Errored can recover, pause, or disable
                | (TriggerStatus::Errored, TriggerStatus::Active)
                | (TriggerStatus::Errored, TriggerStatus::Paused)
                | (TriggerStatus::Errored, TriggerStatus::Disabled)
                // Disabled can only be re-activated
                | (TriggerStatus::Disabled, TriggerStatus::Active)
        )
    }

    /// Attempt a state transition, returning the new state or an error.
    pub fn transition_to(self, target: TriggerStatus) -> Result<TriggerStatus, InvalidTransition> {
        if self == target {
            return Ok(self);
        }
        if self.can_transition_to(target) {
            Ok(target)
        } else {
            Err(InvalidTransition {
                entity: "trigger",
                from: self.as_str().to_string(),
                to: target.as_str().to_string(),
            })
        }
    }

    /// Bridge from the legacy `enabled` boolean column.
    pub fn from_enabled(enabled: bool) -> Self {
        if enabled {
            TriggerStatus::Active
        } else {
            TriggerStatus::Disabled
        }
    }

    /// Whether this status maps to `enabled = true` in the DB.
    pub fn is_enabled(&self) -> bool {
        matches!(self, TriggerStatus::Active)
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            TriggerStatus::Active => "active",
            TriggerStatus::Paused => "paused",
            TriggerStatus::Errored => "errored",
            TriggerStatus::Disabled => "disabled",
        }
    }
}

impl fmt::Display for TriggerStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for TriggerStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "active" => Ok(TriggerStatus::Active),
            "paused" => Ok(TriggerStatus::Paused),
            "errored" => Ok(TriggerStatus::Errored),
            "disabled" => Ok(TriggerStatus::Disabled),
            other => Err(format!("Unknown trigger status: '{other}'")),
        }
    }
}

// =============================================================================
// AutomationDeployStatus
// =============================================================================

/// Lifecycle states for automation deployment.
///
/// Valid transitions:
///   Draft  -> Active | Error
///   Active -> Paused | Error
///   Paused -> Active | Draft | Error
///   Error  -> Draft | Active
///
/// Stored in `deployment_status TEXT` column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum AutomationDeployStatus {
    Draft,
    Active,
    Paused,
    Error,
}

#[allow(dead_code)]
impl AutomationDeployStatus {
    pub fn can_transition_to(&self, target: AutomationDeployStatus) -> bool {
        matches!(
            (self, target),
            // Draft deploys to active, or errors during deploy
            (AutomationDeployStatus::Draft, AutomationDeployStatus::Active)
                | (AutomationDeployStatus::Draft, AutomationDeployStatus::Error)
                // Active can be paused or error
                | (AutomationDeployStatus::Active, AutomationDeployStatus::Paused)
                | (AutomationDeployStatus::Active, AutomationDeployStatus::Error)
                // Paused can resume, revert to draft, or error
                | (AutomationDeployStatus::Paused, AutomationDeployStatus::Active)
                | (AutomationDeployStatus::Paused, AutomationDeployStatus::Draft)
                | (AutomationDeployStatus::Paused, AutomationDeployStatus::Error)
                // Error can be fixed back to draft or re-deployed
                | (AutomationDeployStatus::Error, AutomationDeployStatus::Draft)
                | (AutomationDeployStatus::Error, AutomationDeployStatus::Active)
        )
    }

    /// Attempt a state transition, returning the new state or an error.
    pub fn transition_to(
        self,
        target: AutomationDeployStatus,
    ) -> Result<AutomationDeployStatus, InvalidTransition> {
        if self == target {
            return Ok(self);
        }
        if self.can_transition_to(target) {
            Ok(target)
        } else {
            Err(InvalidTransition {
                entity: "automation",
                from: self.as_str().to_string(),
                to: target.as_str().to_string(),
            })
        }
    }

    /// Whether this status allows execution (only Active automations can run).
    pub fn is_runnable(&self) -> bool {
        matches!(self, AutomationDeployStatus::Active)
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            AutomationDeployStatus::Draft => "draft",
            AutomationDeployStatus::Active => "active",
            AutomationDeployStatus::Paused => "paused",
            AutomationDeployStatus::Error => "error",
        }
    }
}

impl fmt::Display for AutomationDeployStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for AutomationDeployStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "draft" => Ok(AutomationDeployStatus::Draft),
            "active" => Ok(AutomationDeployStatus::Active),
            "paused" => Ok(AutomationDeployStatus::Paused),
            "error" => Ok(AutomationDeployStatus::Error),
            other => Err(format!("Unknown automation deploy status: '{other}'")),
        }
    }
}

// =============================================================================
// RotationEntryStatus
// =============================================================================

/// Outcome status for a credential rotation attempt.
///
/// This is a terminal status (no further transitions) -- each rotation
/// attempt produces exactly one status when it completes.
///
/// Stored in `credential_rotation_history.status TEXT`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum RotationEntryStatus {
    Success,
    Failed,
    Skipped,
}

#[allow(dead_code)]
impl RotationEntryStatus {
    pub fn is_failure(&self) -> bool {
        matches!(self, RotationEntryStatus::Failed)
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            RotationEntryStatus::Success => "success",
            RotationEntryStatus::Failed => "failed",
            RotationEntryStatus::Skipped => "skipped",
        }
    }
}

impl fmt::Display for RotationEntryStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for RotationEntryStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "success" => Ok(RotationEntryStatus::Success),
            "failed" => Ok(RotationEntryStatus::Failed),
            "skipped" => Ok(RotationEntryStatus::Skipped),
            other => Err(format!("Unknown rotation entry status: '{other}'")),
        }
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -- TriggerStatus --

    #[test]
    fn trigger_active_can_pause() {
        assert!(TriggerStatus::Active.can_transition_to(TriggerStatus::Paused));
        assert_eq!(
            TriggerStatus::Active.transition_to(TriggerStatus::Paused),
            Ok(TriggerStatus::Paused)
        );
    }

    #[test]
    fn trigger_paused_cannot_error() {
        // Paused triggers shouldn't enter errored without being active first
        assert!(!TriggerStatus::Paused.can_transition_to(TriggerStatus::Errored));
        assert!(TriggerStatus::Paused
            .transition_to(TriggerStatus::Errored)
            .is_err());
    }

    #[test]
    fn trigger_disabled_can_only_activate() {
        assert!(TriggerStatus::Disabled.can_transition_to(TriggerStatus::Active));
        assert!(!TriggerStatus::Disabled.can_transition_to(TriggerStatus::Paused));
        assert!(!TriggerStatus::Disabled.can_transition_to(TriggerStatus::Errored));
    }

    #[test]
    fn trigger_same_state_is_noop() {
        assert_eq!(
            TriggerStatus::Active.transition_to(TriggerStatus::Active),
            Ok(TriggerStatus::Active)
        );
    }

    #[test]
    fn trigger_from_enabled_roundtrips() {
        assert_eq!(TriggerStatus::from_enabled(true), TriggerStatus::Active);
        assert_eq!(TriggerStatus::from_enabled(false), TriggerStatus::Disabled);
        assert!(TriggerStatus::Active.is_enabled());
        assert!(!TriggerStatus::Disabled.is_enabled());
        assert!(!TriggerStatus::Paused.is_enabled());
    }

    #[test]
    fn trigger_from_str_roundtrips() {
        for status in [
            TriggerStatus::Active,
            TriggerStatus::Paused,
            TriggerStatus::Errored,
            TriggerStatus::Disabled,
        ] {
            assert_eq!(TriggerStatus::from_str(status.as_str()), Ok(status));
        }
    }

    // -- AutomationDeployStatus --

    #[test]
    fn automation_draft_can_activate() {
        assert_eq!(
            AutomationDeployStatus::Draft.transition_to(AutomationDeployStatus::Active),
            Ok(AutomationDeployStatus::Active)
        );
    }

    #[test]
    fn automation_draft_cannot_pause() {
        assert!(AutomationDeployStatus::Draft
            .transition_to(AutomationDeployStatus::Paused)
            .is_err());
    }

    #[test]
    fn automation_active_cannot_revert_to_draft() {
        assert!(!AutomationDeployStatus::Active
            .can_transition_to(AutomationDeployStatus::Draft));
    }

    #[test]
    fn automation_error_can_recover() {
        assert!(AutomationDeployStatus::Error
            .can_transition_to(AutomationDeployStatus::Draft));
        assert!(AutomationDeployStatus::Error
            .can_transition_to(AutomationDeployStatus::Active));
    }

    #[test]
    fn automation_only_active_is_runnable() {
        assert!(AutomationDeployStatus::Active.is_runnable());
        assert!(!AutomationDeployStatus::Draft.is_runnable());
        assert!(!AutomationDeployStatus::Paused.is_runnable());
        assert!(!AutomationDeployStatus::Error.is_runnable());
    }

    #[test]
    fn automation_from_str_roundtrips() {
        for status in [
            AutomationDeployStatus::Draft,
            AutomationDeployStatus::Active,
            AutomationDeployStatus::Paused,
            AutomationDeployStatus::Error,
        ] {
            assert_eq!(
                AutomationDeployStatus::from_str(status.as_str()),
                Ok(status)
            );
        }
    }

    // -- RotationEntryStatus --

    #[test]
    fn rotation_from_str_roundtrips() {
        for status in [
            RotationEntryStatus::Success,
            RotationEntryStatus::Failed,
            RotationEntryStatus::Skipped,
        ] {
            assert_eq!(
                RotationEntryStatus::from_str(status.as_str()),
                Ok(status)
            );
        }
    }

    #[test]
    fn rotation_failure_detection() {
        assert!(RotationEntryStatus::Failed.is_failure());
        assert!(!RotationEntryStatus::Success.is_failure());
        assert!(!RotationEntryStatus::Skipped.is_failure());
    }

    // -- InvalidTransition --

    #[test]
    fn invalid_transition_display() {
        let err = InvalidTransition {
            entity: "trigger",
            from: "disabled".into(),
            to: "paused".into(),
        };
        assert_eq!(
            err.to_string(),
            "Invalid trigger transition: 'disabled' -> 'paused'"
        );
    }
}
