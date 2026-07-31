use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Incident Diagnosis — Autonomous NOC v1
// ============================================================================
//
// A root-cause summary attached to an `audit_incidents` row by the server-side
// alert evaluator (auto) or by the user clicking "Diagnose" in the incident
// detail modal (manual). One diagnosis per incident (UNIQUE incident_id).
//
// The diagnosis may PROPOSE a remediation as a pending companion approval —
// proposal only: nothing here auto-approves or expands the autopilot
// allowlist. `approval_id` is stamped at most once per incident (the
// remediation-loop cap), so a re-diagnosis can never stack proposals.

/// Root-cause diagnosis for a single audit incident.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct IncidentDiagnosis {
    pub id: String,
    /// FK to `audit_incidents.id` (UNIQUE — one diagnosis per incident).
    pub incident_id: String,
    /// One-paragraph root-cause summary (Athena voice, first person, brief).
    pub summary: String,
    /// Evidence lines gathered from healing analysis, recent failures, and
    /// the execution-knowledge graph. Stored as a JSON array in SQLite.
    pub evidence: Vec<String>,
    /// Machine token of the proposed remediation (e.g. `run_persona`), if any.
    /// The action itself lives as a PENDING `companion_approval` row.
    pub proposed_action: Option<String>,
    /// Human rationale attached to the proposal.
    pub proposed_rationale: Option<String>,
    /// `companion_approval.id` of the pending proposal. Set at most once per
    /// incident — the v1 remediation-loop cap.
    pub approval_id: Option<String>,
    /// Heuristic confidence 0..1 — earned from how much corroborating
    /// evidence was found, not from a model logit.
    pub confidence: f64,
    pub diagnosed_at: String,
}
