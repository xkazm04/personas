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
