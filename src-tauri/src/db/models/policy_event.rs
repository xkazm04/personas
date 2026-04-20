use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// PolicyEvent — audit trail for silent generation-policy enforcement
// ============================================================================
//
// `engine::dispatch` silently drops protocol messages that violate the
// capability's declared `review_policy` / `memory_policy` / events policy.
// Historically those drops left only a trace log line. Users couldn't
// verify that a persona's declared policies actually fired — or prove
// that a capability declared `review_policy: always` was in fact sending
// reviews.
//
// Each drop / auto-resolve now persists a row here. The per-execution list
// is exposed over IPC and rendered in the Execution Detail "Policy Events"
// tab so authors can audit enforcement behaviour after the fact.

/// A single policy-enforcement event captured during execution dispatch.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PolicyEvent {
    pub id: String,
    pub execution_id: String,
    pub persona_id: String,
    /// Optional — set when the dispatch context knew which UC was firing.
    pub use_case_id: Option<String>,
    /// Kind of policy that tripped. Conventional values:
    ///   - `"review.off"`              — manual_review dropped silently
    ///   - `"review.trust_llm"`        — review created but auto-resolved
    ///   - `"memory.off"`              — emit_memory blocked
    ///   - `"event.off"`               — persona_action / custom event dropped
    ///   - `"event.aliased"`           — event renamed by policy
    pub policy_kind: String,
    /// What happened. Conventional values: `"dropped"`, `"auto_resolved"`,
    /// `"aliased"`.
    pub action: String,
    /// Short title of the affected payload (review title, memory title,
    /// event type). Useful for the UI to let the user identify what was
    /// dropped without expanding the full row.
    pub payload_title: Option<String>,
    /// Free-form reason string. Today mirrors the `[POLICY]` log line
    /// content so the audit tab reads like the trace log.
    pub reason: Option<String>,
    pub created_at: String,
}
