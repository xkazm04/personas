//! Lens-scan doors - wire types for reading a product's lens-scan store and
//! for the two store.mjs writes (decide, triage) plus the run start
//! (spark one-control, Stage 2, WP2).
//!
//! Two naming conventions meet here on purpose:
//!
//! - Types Personas invents (`LensScanProduct`, the snapshot envelope, the
//!   start request/result, the commit diff) are `camelCase` like every other
//!   command payload.
//! - Types that are lens-scan's own answers (`LensScanDecideResult`,
//!   `LensScanTriageResult`, `LensScanSkipped`) keep the STORE's field names
//!   (`packs_triaged`, `packs_reopened`) so they equal `src/lib/lensScan/wire.ts`
//!   (ported from bp) name for name, and a store.mjs answer passes through
//!   unchanged.
//!
//! The snapshot ROWS are a named deviation from the typed-payload rule: the
//! store schema is owned by lens-scan and moved twice on 2026-10-15 (v2 at
//! 12:37, v3 at 18:52). Each row travels as a JSON map keyed by the store's own
//! column names, NULL columns omitted, JSON columns parsed; `src/api/lensScan.ts`
//! narrows them to `wire.ts` types and states the invariant there.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use ts_rs::TS;

/// A release not yet `tagged` (its row in the store's `releases` table).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LensScanOpenRelease {
    pub id: String,
    pub status: String,
}

/// One product: a code `dev_projects` row whose root holds
/// `.ai/lens-scan/scan.db`. A store that failed to open is still listed, with
/// `error` set, so the card can say why instead of the product vanishing.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LensScanProduct {
    pub project_id: String,
    pub name: String,
    pub root: String,
    /// `PRAGMA user_version` of the store (1, 2 or 3 today); 0 when it did not open.
    pub store_version: u32,
    /// Proposal status -> count.
    #[ts(type = "Record<string, number>")]
    pub counts: BTreeMap<String, u32>,
    /// Items `done` or `failed` in packs whose status is `open`
    /// (bp `compare.ts awaitingTriage` over `packGroups`).
    pub awaiting_triage: u32,
    /// `accepted` items with no `release_id`.
    pub unreleased_accepted: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub open_release: Option<LensScanOpenRelease>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_run_at: Option<String>,
    /// Why the store could not be read, when it could not.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
}

/// The store's tables as wire rows (see the module note for the deviation).
/// Every table is present; a table the file does not have is `[]`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LensScanRows {
    #[ts(type = "Array<Record<string, unknown>>")]
    pub runs: Vec<Map<String, Value>>,
    #[ts(type = "Array<Record<string, unknown>>")]
    pub measurements: Vec<Map<String, Value>>,
    #[ts(type = "Array<Record<string, unknown>>")]
    pub proposals: Vec<Map<String, Value>>,
    /// The LAST 200 rows by id, oldest first.
    #[ts(type = "Array<Record<string, unknown>>")]
    pub activity: Vec<Map<String, Value>>,
    #[ts(type = "Array<Record<string, unknown>>")]
    pub shots: Vec<Map<String, Value>>,
    #[ts(type = "Array<Record<string, unknown>>")]
    pub coverage: Vec<Map<String, Value>>,
    /// v2 (empty on a v1 store).
    #[ts(type = "Array<Record<string, unknown>>")]
    pub packs: Vec<Map<String, Value>>,
    /// v2, oldest first (empty on a v1 store).
    #[ts(type = "Array<Record<string, unknown>>")]
    pub releases: Vec<Map<String, Value>>,
}

/// `BlueprintData` minus `product`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LensScanSnapshot {
    /// `app-structure.json`, parsed; `null` while the product has no map yet.
    #[ts(type = "unknown")]
    pub structure: Value,
    /// `events.jsonl`, raw text (`""` when absent).
    pub events: String,
    pub scan: LensScanRows,
    pub store_version: u32,
}

/// Who signs a write: `user:<gh login>` from `gh`, else `user:personas`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LensScanIdentity {
    pub by: String,
    /// `gh` | `fallback`.
    pub source: String,
}

/// An item a store.mjs write left as it was.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
// The store's own field names, verbatim (they ARE snake_case); stated rather than defaulted.
#[serde(rename_all = "snake_case")]
pub struct LensScanSkipped {
    pub id: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason: Option<String>,
}

/// What store.mjs `decide` answers, with the store's own field names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
// The store's own field names, verbatim (they ARE snake_case); stated rather than defaulted.
#[serde(rename_all = "snake_case")]
pub struct LensScanDecideResult {
    /// `approved` | `declined`.
    pub decision: String,
    pub by: String,
    pub decided: Vec<String>,
    #[serde(default)]
    pub skipped: Vec<LensScanSkipped>,
}

/// What store.mjs `triage` answers, with the store's own field names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
// The store's own field names, verbatim (they ARE snake_case); stated rather than defaulted.
#[serde(rename_all = "snake_case")]
pub struct LensScanTriageResult {
    /// `accepted` | `rework` | `descoped` | `reopened`.
    pub decision: String,
    pub by: String,
    pub triaged: Vec<String>,
    #[serde(default)]
    pub skipped: Vec<LensScanSkipped>,
    #[serde(default)]
    pub packs_triaged: Vec<String>,
    /// v3, reopen only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub packs_reopened: Option<Vec<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum LensScanDecideDecision {
    Approve,
    Decline,
}

impl LensScanDecideDecision {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Approve => "approve",
            Self::Decline => "decline",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum LensScanTriageDecision {
    Accept,
    Rework,
    Descope,
    Reopen,
}

impl LensScanTriageDecision {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Accept => "accept",
            Self::Rework => "rework",
            Self::Descope => "descope",
            Self::Reopen => "reopen",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum LensScanStartAction {
    Execute,
    Measure,
    Propagate,
}

/// A run Personas starts for a product. Mirrors `StartRequest` in
/// `src/features/decision-center/blueprint/source.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LensScanStartRequest {
    pub action: LensScanStartAction,
    pub lens: String,
    /// `execute`: the approved items to build.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ids: Option<Vec<String>>,
    /// `measure`: the features to cover (drive.mjs has no feature filter yet).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub features: Option<Vec<String>>,
    /// `propagate`: the standard to spread (drive.mjs has no propagate verb yet).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub standard: Option<String>,
}

/// What starting a run answers. `label` is `personas:<uuid>`; every fleet
/// session drive.mjs opens afterwards carries it in its run label.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LensScanStartResult {
    pub label: String,
    /// The exact command line started, for the dock console.
    pub command: String,
    /// drive.mjs's pid.
    pub pid: u32,
}

/// One file of a commit diff.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LensScanCommitFile {
    pub path: String,
    #[ts(type = "number")]
    pub add: u64,
    #[ts(type = "number")]
    pub del: u64,
}

/// One item commit, as bp's commits route returns it (`CommitDiff` in wire.ts).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LensScanCommitDiff {
    pub sha: String,
    pub message: String,
    pub stat: String,
    pub files: Vec<LensScanCommitFile>,
    pub patch: String,
    /// The full patch line count (`patch` is cut at 2000 lines).
    #[ts(type = "number")]
    pub lines: u64,
    pub truncated: bool,
}
