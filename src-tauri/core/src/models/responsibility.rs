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
use crate::models::recipe::{
    CharterConnectorBinding, RecipeActivity, RecipeDescription, RecipeRef,
};

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
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
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
    /// Measurement window in days — stays far under 2^53, so the JS
    /// `number` pin is lossless (persisted-model-struct).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "number")]
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
    /// Minutes between attention passes — stays far under 2^53, so the JS
    /// `number` pin is lossless (persisted-model-struct).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "number")]
    pub interval_minutes: Option<i64>,
    /// e.g. "22:00-07:00" — no attention runs inside this window.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub quiet_hours: Option<String>,
    /// Daily run cap — stays far under 2^53, so the JS `number` pin is
    /// lossless (persisted-model-struct).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "number")]
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
    /// Days between tenure reviews — stays far under 2^53, so the JS
    /// `number` pin is lossless (persisted-model-struct).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "number")]
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

/// Post-error escalation routing for a charter (the legacy use case's
/// `error_policy` / `error_handling`): where unrecovered failures go.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ResponsibilityErrorPolicy {
    /// Open an Incidents-inbox entry when a failure cannot auto-recover.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub incident: Option<bool>,
    /// Queue the charter for improvement in the Lab when failures recur.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub lab: Option<bool>,
    /// Escalate only after this many consecutive failures — stays far under
    /// 2^53, so the JS `number` pin is lossless (persisted-model-struct).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    #[ts(type = "number")]
    pub escalate_after: Option<i64>,
}

/// Coverage memory the App Master decision lane writes back on every wake —
/// how a persona remembers, between wakes, which of its charters it has
/// already looked at and what it decided to leave for next time.
///
/// Lives on the charter's `spec` (a JSON column) rather than in a new table
/// or the attention ledger on purpose: the ledger records *dispatches*, and a
/// charter the decision deliberately DEFERRED writes no ledger row at all, so
/// the ledger cannot answer "when did I last consider this?". These three
/// stamps can, and they travel with the charter through export/import like the
/// rest of the spec.
///
/// Every field is written by the loop, never by the operator — treat them as
/// the loop's own bookkeeping, not as authored configuration.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ResponsibilityPacing {
    /// When the decision lane last CONSIDERED this charter (dispatched or
    /// deferred). Distinct from `last_dispatched_at`: a charter deferred four
    /// wakes running was considered four times and dispatched zero.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_decided_at: Option<String>,
    /// When the decision lane last DISPATCHED work for this charter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_dispatched_at: Option<String>,
    /// The plan's note to its own next wake (≤ 300 chars, bounded at the
    /// parse). Rendered back into the next decision prompt so coverage is a
    /// memory rather than a fresh guess each tick.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub coverage_note: Option<String>,
    /// How long the persona itself chose to sleep before its next wake, in
    /// minutes — the decision lane's answer to *when* as well as *what*.
    ///
    /// Written on every charter the decision considered (it is the persona's
    /// choice, not the charter's), bounded at the parse to 10..=240, and read
    /// back by the admission ladder's interval floor. `None` means the persona
    /// said nothing this wake, and the previous choice — or the declared
    /// cadence — stands; it never means "as fast as possible".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub next_wake_minutes: Option<u32>,
}

/// The runtime envelope a charter carries beyond its governance fields — the
/// half of a legacy design-context use case that was never about *what the
/// persona holds* but about *how a run of it is shaped* (input schema, engine
/// mode, notification routing, fixtures, recipe provenance). Stored as the
/// `persona_responsibilities.spec` JSON column (migration
/// `e19_agent_manifest`); every field is optional so a charter authored by
/// hand carries `{}` and a migrated one carries only what its use case had.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ResponsibilitySpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub input_schema: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sample_input: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model_override: Option<String>,
    /// The legacy use case's `execution_mode`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub engine_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub notification_channels: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub event_subscriptions: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error_policy: Option<ResponsibilityErrorPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub time_filter: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub test_fixtures: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source_recipe_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source_recipe_version: Option<String>,
    /// The design-context use case this charter was minted from by the
    /// one-way migration — the migration's idempotency key, and the pointer
    /// the trigger remap (`persona_triggers.responsibility_id`) followed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub migrated_from_use_case_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub memory_policy: Option<serde_json::Value>,
    /// Human-gate policy carried from the source use case / recipe seed
    /// (`{mode}`: `auto_triage` skips the review queue). Slotted rather than
    /// dropped: a charter minted from a recipe has no use case to fall back
    /// on, and silently losing this is a SAFETY regression, not a cosmetic
    /// one — the same class of defect the legacy `DesignUseCase` struct had,
    /// where review/memory/error fell off every Rust round-trip.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub review_policy: Option<serde_json::Value>,
    /// v3 generation envelope (`memories`/`reviews`/`events`/`event_aliases`)
    /// — the preferred source when present; `memory_policy`/`review_policy`
    /// are the older fallbacks the prompt path already resolves in that order.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub generation_settings: Option<serde_json::Value>,
    /// Free-prose error guidance from the recipe seed (299/299 carry prose,
    /// none carry a structured policy). Deliberately NOT synthesized into
    /// `error_policy` — inferring booleans from prose is fabrication.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error_handling: Option<String>,
    /// Tool identifiers the source declared; the legacy connector inference
    /// read these when no explicit connector list existed.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tool_hints: Option<Vec<String>>,
    /// Why the source chose its model — authored context, never a directive.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model_rationale: Option<String>,
    /// Whether the source shipped this capability on by default; the charter's
    /// own `status` governs at runtime.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub enabled_by_default: Option<bool>,
    // ---- Recipe v3 adoption provenance -----------------------------------
    // The charter is the ADOPTED instance of a recipe. These four fields are
    // what adoption copies off the `RecipeSpec` so the charter can be read,
    // drawn and improved without re-fetching the registry artifact.
    /// The recipe this charter was minted from, so a lesson learned here can
    /// be proposed back into the registry artifact (slug + version).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub recipe_ref: Option<RecipeRef>,
    /// The recipe's four-field description (need / input / core action /
    /// output), copied at adoption.
    ///
    /// Structured rather than folded into `procedure` because the prompt
    /// renderer labels the four lines and the roster shows `core_action` on
    /// its own; flattening them into prose here would make both of those
    /// string-scraping, which is how the v1 `description` blob got unreadable
    /// in the first place.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<RecipeDescription>,
    /// The recipe's coarse activity sequence, copied at adoption for display.
    /// A COPY on purpose: the charter must still render after the recipe moves
    /// or its version is superseded.
    ///
    /// `Option<Vec<_>>` rather than a `Vec` with `skip_serializing_if`, and the
    /// same for the three v3 lists below. The wire rule is that an unadopted
    /// field must be ABSENT, never `[]` — and a bare `Vec` would still export
    /// as a REQUIRED TypeScript array while being omitted from the JSON, i.e.
    /// a binding that promises the frontend something the wire does not
    /// deliver. The `Option` makes the generated type `activities?: …`, which
    /// is what is actually true.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub activities: Option<Vec<RecipeActivity>>,
    /// The connector CATEGORIES the recipe declared — what this charter was
    /// adopted from, kept whole. The bound instances live on the charter's own
    /// `connectors`; which role got which instance is
    /// [`Self::connector_bindings`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub connector_types: Option<Vec<String>>,
    /// One entry per connector ROLE the recipe declared, with the concrete
    /// connector adoption bound to it or `None` for "nobody bound this yet".
    ///
    /// This is the readable answer to "what does this charter still need?",
    /// and it is why an unbound role is stored rather than dropped: the flat
    /// pair (`connector_types`, `connectors`) cannot express two roles of the
    /// same type, nor tell an empty allowlist ("whatever the persona holds")
    /// apart from an unanswered question.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub connector_bindings: Option<Vec<CharterConnectorBinding>>,
    /// Things that must be installed or verified before the first run.
    /// RECORDED here, never installed by the mint — see the adoption path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub dependencies: Option<Vec<String>>,
    // ---- App Master decision lane ----------------------------------------
    /// Operator-declared priority, **1 = highest .. 5 = lowest**. Validated at
    /// the charter intake door (`personas_engine::responsibility::validate`).
    ///
    /// `None` is not "priority 3" — it explicitly means *the persona decides*,
    /// and the decision prompt says so. Charters that DO carry a priority are
    /// stable-sorted ahead of the ones that do not, so declaring a priority on
    /// one charter cannot silently demote the rest into a made-up order.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub priority: Option<u8>,
    /// Coverage memory written back by the decision lane after every wake —
    /// never authored by the operator. See [`ResponsibilityPacing`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pacing: Option<ResponsibilityPacing>,
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
    /// Who authored the charter ('operator' | 'kp-hire' | 'migration' |
    /// 'agent-proposed'; DB CHECK-enforced).
    pub source: String,
    /// Connector ids the charter's runs may reach (the legacy use case's
    /// `connectors`); `[]` = whatever the persona holds.
    #[serde(default)]
    pub connectors: Vec<String>,
    /// How the persona carries the charter out — the operating procedure
    /// (legacy: capability summary + description).
    #[serde(default)]
    pub procedure: String,
    /// Runtime envelope (input schema, engine mode, routing, provenance).
    #[serde(default)]
    pub spec: ResponsibilitySpec,
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
    #[serde(default)]
    pub connectors: Vec<String>,
    #[serde(default)]
    pub procedure: String,
    #[serde(default)]
    pub spec: ResponsibilitySpec,
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
    pub connectors: Option<Vec<String>>,
    pub procedure: Option<String>,
    pub spec: Option<ResponsibilitySpec>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The pacing block is a JSON column the loop merges into, so its wire
    /// shape is load-bearing: camelCase keys, and an absent field that stays
    /// absent rather than serializing a `null` the next merge would read back
    /// as "the persona chose nothing" over a value it did choose.
    #[test]
    fn pacing_round_trips_its_self_paced_wake_in_camel_case() {
        let pacing = ResponsibilityPacing {
            last_decided_at: Some("2026-09-07T10:00:00+00:00".into()),
            next_wake_minutes: Some(45),
            ..Default::default()
        };
        let json = serde_json::to_string(&pacing).expect("serializes");
        assert!(json.contains("\"nextWakeMinutes\":45"), "{json}");
        assert!(
            !json.contains("coverageNote") && !json.contains("lastDispatchedAt"),
            "an absent field is absent, not null: {json}"
        );
        assert_eq!(
            serde_json::from_str::<ResponsibilityPacing>(&json).expect("parses"),
            pacing
        );
    }

    /// A pacing block written before self-pacing existed still reads, with the
    /// new field absent rather than the whole spec failing to parse.
    #[test]
    fn pacing_without_a_wake_choice_still_parses() {
        let legacy = "{\"lastDecidedAt\":\"2026-09-06T10:00:00+00:00\",\
                      \"coverageNote\":\"docs deferred twice\"}";
        let pacing: ResponsibilityPacing = serde_json::from_str(legacy).expect("parses");
        assert_eq!(pacing.next_wake_minutes, None);
        assert_eq!(pacing.coverage_note.as_deref(), Some("docs deferred twice"));
    }
}
