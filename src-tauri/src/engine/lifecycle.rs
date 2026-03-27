//! Universal FSM framework for lifecycle enums.
//!
//! The [`declare_lifecycle!`] macro generates a complete state machine from a
//! declarative transition table: enum definition, `can_transition_to`,
//! `transition_to`, `as_str`, `Display`, and `FromStr` -- eliminating the
//! boilerplate that was previously duplicated across every status enum.
//!
//! For enums that need extra methods (e.g. `is_enabled`, `is_runnable`),
//! add a regular `impl` block after the macro invocation.

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
// declare_lifecycle! macro
// =============================================================================

/// Declare a lifecycle enum with compile-time transition table.
///
/// Generates:
/// - The enum with `Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS`
/// - `can_transition_to(&self, target) -> bool`
/// - `transition_to(self, target) -> Result<Self, InvalidTransition>`
/// - `as_str(&self) -> &'static str`
/// - `fmt::Display` (delegates to `as_str`)
/// - `FromStr` (inverse of `as_str`)
/// - `ALL_VARIANTS` constant array
///
/// # Example
///
/// ```ignore
/// declare_lifecycle! {
///     /// Doc comment for the enum.
///     pub enum MyStatus, entity = "my_thing" {
///         Active("active") => [Paused, Error],
///         Paused("paused") => [Active],
///         Error("error")   => [Active],
///     }
/// }
/// ```
#[macro_export]
macro_rules! declare_lifecycle {
    (
        $(#[$meta:meta])*
        pub enum $Name:ident, entity = $entity:literal {
            $(
                $(#[$var_meta:meta])*
                $Variant:ident ( $str:literal ) => [ $( $Target:ident ),* $(,)? ]
            ),+ $(,)?
        }
    ) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
        #[serde(rename_all = "lowercase")]
        #[ts(export)]
        pub enum $Name {
            $(
                $(#[$var_meta])*
                $Variant,
            )+
        }

        #[allow(dead_code)]
        impl $Name {
            /// All variants of this lifecycle enum.
            pub const ALL_VARIANTS: &'static [$Name] = &[
                $( $Name::$Variant, )+
            ];

            /// Check whether transitioning from `self` to `target` is valid.
            pub fn can_transition_to(&self, target: $Name) -> bool {
                matches!(
                    (self, target),
                    $(
                        $( ($Name::$Variant, $Name::$Target) )|*
                    )|+
                )
            }

            /// Attempt a state transition, returning the new state or an error.
            pub fn transition_to(self, target: $Name) -> Result<$Name, $crate::engine::lifecycle::InvalidTransition> {
                if self == target {
                    return Ok(self);
                }
                if self.can_transition_to(target) {
                    Ok(target)
                } else {
                    Err($crate::engine::lifecycle::InvalidTransition {
                        entity: $entity,
                        from: self.as_str().to_string(),
                        to: target.as_str().to_string(),
                    })
                }
            }

            /// String representation (matches serde serialization).
            pub fn as_str(&self) -> &'static str {
                match self {
                    $( $Name::$Variant => $str, )+
                }
            }
        }

        impl std::fmt::Display for $Name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(self.as_str())
            }
        }

        impl std::str::FromStr for $Name {
            type Err = String;

            fn from_str(s: &str) -> Result<Self, Self::Err> {
                match s {
                    $( $str => Ok($Name::$Variant), )+
                    other => Err(format!("Unknown {} status: '{}'", $entity, other)),
                }
            }
        }
    };
}

// =============================================================================
// TriggerStatus
// =============================================================================

declare_lifecycle! {
    /// Lifecycle states for a persona trigger.
    ///
    /// Valid transitions:
    ///   Active   -> Paused | Errored | Disabled
    ///   Paused   -> Active | Disabled
    ///   Errored  -> Active | Paused | Disabled
    ///   Disabled -> Active
    ///
    /// Persisted in the `status TEXT` column on `persona_triggers`.
    /// The legacy `enabled INTEGER` column is kept in sync for backwards
    /// compatibility with queries that filter on `enabled = 1`.
    pub enum TriggerStatus, entity = "trigger" {
        Active("active")     => [Paused, Errored, Disabled],
        Paused("paused")     => [Active, Disabled],
        Errored("errored")   => [Active, Paused, Disabled],
        Disabled("disabled") => [Active],
    }
}

#[allow(dead_code)]
impl TriggerStatus {
    /// Bridge from the legacy `enabled` boolean column.
    /// Only used as a fallback when the `status TEXT` column is missing or
    /// contains an unrecognised value.
    pub fn from_enabled(enabled: bool) -> Self {
        if enabled {
            TriggerStatus::Active
        } else {
            TriggerStatus::Disabled
        }
    }

    /// The value to write into the legacy `enabled INTEGER` column so that
    /// existing `WHERE enabled = 1` queries keep working.
    /// Only `Active` is considered enabled for scheduling purposes.
    pub fn is_enabled(&self) -> bool {
        matches!(self, TriggerStatus::Active)
    }
}

// =============================================================================
// AutomationDeployStatus
// =============================================================================

declare_lifecycle! {
    /// Lifecycle states for automation deployment.
    ///
    /// Valid transitions:
    ///   Draft  -> Active | Error
    ///   Active -> Paused | Error
    ///   Paused -> Active | Draft | Error
    ///   Error  -> Draft | Active
    ///
    /// Stored in `deployment_status TEXT` column.
    pub enum AutomationDeployStatus, entity = "automation" {
        Draft("draft")   => [Active, Error],
        Active("active") => [Paused, Error],
        Paused("paused") => [Active, Draft, Error],
        Error("error")   => [Draft, Active],
    }
}

#[allow(dead_code)]
impl AutomationDeployStatus {
    /// Whether this status allows execution (only Active automations can run).
    pub fn is_runnable(&self) -> bool {
        matches!(self, AutomationDeployStatus::Active)
    }
}

// =============================================================================
// RotationEntryStatus (terminal -- no transitions)
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

impl rusqlite::types::FromSql for RotationEntryStatus {
    fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        let s = value.as_str()?;
        Self::from_str(s).map_err(|e| rusqlite::types::FromSqlError::Other(e.into()))
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

    #[test]
    fn trigger_all_variants_complete() {
        assert_eq!(TriggerStatus::ALL_VARIANTS.len(), 4);
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

    #[test]
    fn automation_all_variants_complete() {
        assert_eq!(AutomationDeployStatus::ALL_VARIANTS.len(), 4);
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
