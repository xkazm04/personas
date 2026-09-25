//! Lifecycle v2 - Athena's proposal card.
//!
//! Athena never writes a lifecycle. She reads it (`describe_lifecycle`) and
//! proposes the FULL next step list (`show_lifecycle_proposal`); the dispatcher
//! validates it against the project's current document and persists this card
//! as a durable `companion_chat_card` (kind `lifecycle_proposal`). The operator
//! unticks the changes he does not want and confirms through
//! `companion_apply_lifecycle_proposal`, which applies only the ticked changes
//! on top of the version the card was computed from (`fromVersion`).
//!
//! The wire vocabulary (`LifecycleDoc`, `LifecycleStep`, `LifecyclePreset`) is
//! owned by [`super::lifecycle`]; this file only adds the diff shape.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::lifecycle::{LifecycleDoc, LifecyclePreset, LifecycleStep};

/// What one change does to the current document. `preset` is the one change
/// that is not about a step: its `stepId` is the literal `"preset"` and both
/// `before` and `after` are `null`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleChangeKind {
    Added,
    Changed,
    Removed,
    Preset,
}

/// One toggleable row of the proposal card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleChange {
    pub kind: LifecycleChangeKind,
    /// The step id, or `"preset"` for a preset change. This is the id the
    /// confirm command's `acceptedStepIds` names.
    pub step_id: String,
    /// The step as it is now (`null` for `added` and `preset`).
    pub before: Option<LifecycleStep>,
    /// The step as proposed (`null` for `removed` and `preset`).
    pub after: Option<LifecycleStep>,
}

/// The config of a `lifecycle_proposal` chat card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleProposalCard {
    pub project_id: String,
    pub project_name: String,
    /// The version the diff was computed against (0 = implicit Solo default).
    /// Confirm refuses when the project has moved past it.
    #[ts(type = "number")]
    pub from_version: i64,
    /// The proposed preset (equal to the current one unless `changes` holds a
    /// `preset` row).
    pub preset: LifecyclePreset,
    pub change_note: String,
    /// The whole proposed document, validated.
    pub proposed: LifecycleDoc,
    /// Non-empty; proposal order (preset first, then steps as proposed, then
    /// removals in their current order).
    pub changes: Vec<LifecycleChange>,
}
