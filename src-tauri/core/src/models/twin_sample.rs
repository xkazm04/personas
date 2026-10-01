//! Twin learn-from-sample - wire types (spark `twin-portable-blueprint`).
//!
//! A sample is a piece of the user's OWN writing captured from the browser
//! (a highlighted selection, the clipboard) or handed over by the forge when a
//! new twin is created from one. A background analysis turns it into
//! [`TwinSampleProposal`]s that the user accepts in the Hub; self-facts go to
//! the existing pending-memory queue instead (channel `sample`).
//!
//! Strings stay strings on the wire; each field's vocabulary is named in its
//! doc comment and enforced by a CHECK in migration `e55_twin_samples` - keep
//! the two identical. Optionals serialize as `null` (TS `T | null`).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One captured writing sample and the state of its analysis.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TwinSample {
    pub id: String,
    pub twin_id: String,
    pub text: String,
    /// The tone channel the analysis assigned (`email`, `slack`, ...); `null`
    /// until the analysis has run.
    pub channel: Option<String>,
    /// `selection` | `clipboard` | `forge`.
    pub source_kind: String,
    /// The page host the sample came from, when it came from a page.
    pub source_host: Option<String>,
    /// `analyzing` | `ready` | `failed` | `refused`.
    pub status: String,
    /// Why it failed, or why it was refused (e.g. it matches a draft the twin
    /// itself placed, or it is not the user's own writing).
    pub error: Option<String>,
    pub created_at: String,
    pub analyzed_at: Option<String>,
}

/// One change a sample proposed. Nothing is written until it is accepted.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TwinSampleProposal {
    pub id: String,
    pub sample_id: String,
    pub twin_id: String,
    /// `exemplar` | `voice` | `constraint` | `length` | `dims`.
    pub kind: String,
    /// The tone channel the change targets.
    pub channel: String,
    /// The proposed value: verbatim text for `exemplar`, the directive /
    /// constraint / length hint text otherwise, and a JSON `TwinStyleDims`
    /// object for `dims`.
    pub value: String,
    /// A few words on why the analysis proposed it.
    pub reason: Option<String>,
    /// `open` | `accepted` | `edited` | `dismissed`.
    pub status: String,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

/// Payload of `twin-sample-updated` (`event_name::TWIN_SAMPLE_UPDATED`): a
/// sample's analysis changed state. Carries no sample text.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TwinSampleUpdatedEvent {
    pub twin_id: String,
    pub sample_id: String,
    /// The sample's new `status` (see [`TwinSample::status`]).
    pub status: String,
    /// Open proposals this sample produced (0 until `ready`).
    pub proposals: u32,
}

/// What the browser's `page_selection` hand read from the focused tab.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PageSelection {
    /// The selected text, capped at the hand's `SELECTION_CAP`; `""` when
    /// nothing is selected.
    pub text: String,
    pub title: Option<String>,
    pub url: Option<String>,
    pub host: Option<String>,
    /// The selection was longer than the cap and was cut.
    pub truncated: bool,
}
