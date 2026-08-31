//! Living-agent responsibilities — the standing charters a persona holds.
//!
//! Typed mirror of the `persona_responsibilities` table (migration
//! `e16_living_agent`). The JSON columns (`outcomes`, `objectives`,
//! `refusal_classes`, `approval_gates`, `cadence`, `tenure`) parse leniently
//! at the repo layer: bad JSON degrades to the type's default with a warn,
//! never an error — a corrupt charter must not make the roster unreadable.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::AppError;

/// Lifecycle of a responsibility — the typed twin of the DB CHECK on
/// `persona_responsibilities.status`. The transition door
/// (`repos::core::responsibilities::set_status`) takes THIS, not a string, so
/// an illegal state fails in the caller's lap instead of at the constraint.
/// Deliberately NOT ts-exported: the wire carries the lowercase string on the
/// row, same as `Persona.lifecycle`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ResponsibilityStatus {
    Draft,
    #[default]
    Active,
    Suspended,
    Retired,
}

impl ResponsibilityStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Active => "active",
            Self::Suspended => "suspended",
            Self::Retired => "retired",
        }
    }
}

impl fmt::Display for ResponsibilityStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for ResponsibilityStatus {
    type Err = AppError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "draft" => Ok(Self::Draft),
            "active" => Ok(Self::Active),
            "suspended" => Ok(Self::Suspended),
            "retired" => Ok(Self::Retired),
            _ => Err(AppError::Validation(format!(
                "Invalid responsibility status '{s}': must be 'draft', 'active', 'suspended', or 'retired'"
            ))),
        }
    }
}

/// One outcome a responsibility exists to produce, with its acceptance bar.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ResponsibilityOutcome {
    pub id: String,
    /// What "done well" produces, stated as a claim about the world.
    pub statement: String,
    /// How anyone can tell the outcome held.
    #[serde(default)]
    pub success_criteria: Vec<String>,
}

/// One measurable objective under a responsibility (baseline → target).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ResponsibilityObjective {
    pub key: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub baseline: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub target: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub unit: Option<String>,
    /// 'up' | 'down' — which way the metric should move.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub direction: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub window_days: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_measured_at: Option<String>,
    /// Where the measurement comes from (a KPI id, a command, prose).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source: Option<String>,
}

/// When and how often the responsibility's attention loop runs.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ResponsibilityCadence {
    /// Master switch for the attention loop on this responsibility.
    #[serde(default)]
    pub attention_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub interval_minutes: Option<i64>,
    /// e.g. "22:00-07:00" — no attention runs inside this window.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub quiet_hours: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_runs_per_day: Option<i64>,
}

/// Employment-shaped lifecycle data for a responsibility.
///
/// The four `probation*`/`headless*` fields are the probation-review
/// bookkeeping the legacy `app_master::MandateRecord` carried on its
/// `app_settings` row. They live here because the responsibility table is now
/// the mandate's storage (WP3) and the round-trip
/// `MandateRecord` -> `PersonaResponsibility` -> `MandateRecord` must be
/// lossless — dropping them would let the probation tick raise a duplicate
/// review for a hire that was already decided.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ResponsibilityTenure {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub hired_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub probation_ends_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub review_cadence_days: Option<i64>,
    /// Conditions under which the responsibility should be retired.
    #[serde(default)]
    pub retire_criteria: Vec<String>,
    /// RFC-3339 instant the probation review was decided ('activated' or
    /// 'retired'); `None` while undecided (extending is not a decision).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub probation_decided_at: Option<String>,
    /// 'activated' | 'extended' | 'retired' — the decision that was taken.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub probation_decision: Option<String>,
    /// The raised-but-unanswered probation review, so the lifecycle tick
    /// raises exactly one packet per hire.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub probation_review_id: Option<String>,
    /// Consecutive `incomplete` probation verdicts the headless bridge has
    /// already answered with an extension (see `MandateRecord`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub headless_incomplete_streak: Option<u32>,
}

/// One row of `persona_responsibilities` — a standing charter a persona holds.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaResponsibility {
    pub id: String,
    pub persona_id: String,
    pub title: String,
    /// Coarse area label, e.g. 'general', 'engineering', 'support'.
    pub domain: String,
    pub outcomes: Vec<ResponsibilityOutcome>,
    pub objectives: Vec<ResponsibilityObjective>,
    /// Autonomy rung 0..n — how far the persona may act without approval.
    pub scope_rung: u8,
    /// Classes of request the persona must refuse under this charter.
    pub refusal_classes: Vec<String>,
    /// Actions that always require operator approval.
    pub approval_gates: Vec<String>,
    /// Human accountable for the responsibility ('' = the operator).
    pub owner: String,
    pub cadence: ResponsibilityCadence,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub budget_monthly_usd: Option<f64>,
    pub tenure: ResponsibilityTenure,
    /// 'draft' | 'active' | 'suspended' | 'retired' (DB CHECK-enforced).
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub project_id: Option<String>,
    /// Who authored the charter ('operator' | 'template' | 'athena' | ...).
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Wire input for the operator's create door (`create_persona_responsibility`).
///
/// `source` is deliberately absent: this shape only ever enters through the
/// operator command, which stamps `source = 'operator'` itself — the kp-hire
/// and migration writers have their own doors in `personas-engine`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreatePersonaResponsibilityInput {
    pub persona_id: String,
    pub title: String,
    /// Defaults to 'general' when omitted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub domain: Option<String>,
    #[serde(default)]
    pub outcomes: Vec<ResponsibilityOutcome>,
    #[serde(default)]
    pub objectives: Vec<ResponsibilityObjective>,
    #[serde(default)]
    pub scope_rung: u8,
    #[serde(default)]
    pub refusal_classes: Vec<String>,
    #[serde(default)]
    pub approval_gates: Vec<String>,
    #[serde(default)]
    pub owner: String,
    #[serde(default)]
    pub cadence: ResponsibilityCadence,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub budget_monthly_usd: Option<f64>,
    #[serde(default)]
    pub tenure: ResponsibilityTenure,
    /// 'draft' | 'active' | 'suspended' | 'retired'; defaults to 'active'.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub project_id: Option<String>,
}

/// Wire input for the operator's partial-update door
/// (`update_persona_responsibility`). `None` = leave unchanged; the two
/// double-`Option` fields clear with an explicit JSON `null`. Status moves
/// through `retire_persona_responsibility` / the repo's `set_status`, never
/// here.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePersonaResponsibilityInput {
    pub title: Option<String>,
    pub domain: Option<String>,
    pub outcomes: Option<Vec<ResponsibilityOutcome>>,
    pub objectives: Option<Vec<ResponsibilityObjective>>,
    pub scope_rung: Option<u8>,
    pub refusal_classes: Option<Vec<String>>,
    pub approval_gates: Option<Vec<String>>,
    pub owner: Option<String>,
    pub cadence: Option<ResponsibilityCadence>,
    #[serde(default, deserialize_with = "crate::models::serde_util::double_option")]
    pub budget_monthly_usd: Option<Option<f64>>,
    pub tenure: Option<ResponsibilityTenure>,
    #[serde(default, deserialize_with = "crate::models::serde_util::double_option")]
    pub project_id: Option<Option<String>>,
}
