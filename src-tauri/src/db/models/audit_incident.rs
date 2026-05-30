use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Audit Incidents — cross-source incidents inbox
// ============================================================================
//
// See `src/features/overview/sub_incidents/DESIGN.md` for the architecture
// and the per-source promotion rules. The model stores rows promoted from
// 7 existing audit-shaped tables under one triage lifecycle.
//
// Severity vocabulary is normalized at promotion time via
// `db::repos::execution::audit_incidents::normalize_severity()` so the inbox
// has a single severity scale across heterogeneous sources.

/// Status lifecycle for an audit incident.
///
/// Strings (not the enum) are stored in SQLite. Convert via
/// `IncidentStatus::from_str` / `as_str` at the repo boundary. The enum exists
/// for typed UI surfaces and for the lifecycle transition guards in the repo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
// snake_case (NOT lowercase): single-word variants are unchanged
// (open/acknowledged/resolved/dismissed) but the two-word InProgress must
// serialize to "in_progress" to match the DB strings + the manual
// as_str/from_str at the repo boundary. With "lowercase" it would become
// "inprogress" and silently never match stored rows / the frontend type.
#[serde(rename_all = "snake_case")]
pub enum IncidentStatus {
    Open,
    Acknowledged,
    /// Someone is actively working the incident (the "In Progress" state from
    /// the escalation spec). Distinct from `Acknowledged` (seen-but-not-started):
    /// the user/Athena has committed to fixing it. `open → in_progress → resolved`
    /// is the primary escalation lifecycle.
    InProgress,
    Resolved,
    Dismissed,
}

impl IncidentStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            IncidentStatus::Open => "open",
            IncidentStatus::Acknowledged => "acknowledged",
            IncidentStatus::InProgress => "in_progress",
            IncidentStatus::Resolved => "resolved",
            IncidentStatus::Dismissed => "dismissed",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "open" => Some(IncidentStatus::Open),
            "acknowledged" => Some(IncidentStatus::Acknowledged),
            "in_progress" => Some(IncidentStatus::InProgress),
            "resolved" => Some(IncidentStatus::Resolved),
            "dismissed" => Some(IncidentStatus::Dismissed),
            _ => None,
        }
    }
}

/// Severity scale — normalized across all source streams.
///
/// Source severities (`warning`, implicit-error, etc.) are mapped here via
/// `normalize_severity()`. Storing the normalized value means the inbox can
/// filter / sort by severity without per-source `CASE WHEN` ladders.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum IncidentSeverity {
    Low,
    Medium,
    High,
    Critical,
}

impl IncidentSeverity {
    pub fn as_str(self) -> &'static str {
        match self {
            IncidentSeverity::Low => "low",
            IncidentSeverity::Medium => "medium",
            IncidentSeverity::High => "high",
            IncidentSeverity::Critical => "critical",
        }
    }
}

/// A single promoted incident.
///
/// `dedup_key = "{source_table}:{source_id}"` is UNIQUE; promoter callers use
/// `INSERT OR IGNORE` so a second promotion of the same source row is a safe
/// no-op (no concurrent-insert coordination needed under SQLite WAL).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AuditIncident {
    pub id: String,
    /// Which audit table this incident was promoted from.
    /// One of: `fired_alerts`, `tool_execution_audit_log`,
    /// `credential_audit_log`, `healing_audit_log`, `provider_audit_log`,
    /// `policy_events`, `persona_healing_issues`.
    pub source_table: String,
    /// `id` of the row in `source_table`. Lets the UI link back to the
    /// source-specific deep-dive view (e.g. HealingIssueModal for
    /// `persona_healing_issues` rows).
    pub source_id: String,
    /// `{source_table}:{source_id}` — UNIQUE, drives idempotent promotion.
    pub dedup_key: String,
    pub persona_id: Option<String>,
    /// Denormalized at promotion time so the list query is a single-table
    /// scan (no join). Stable name; if a persona is renamed after promotion,
    /// the historical incident keeps the old name — acceptable.
    pub persona_name: Option<String>,
    pub execution_id: Option<String>,
    /// Normalized severity (see `IncidentSeverity`).
    pub severity: String,
    /// Short machine token describing the incident class
    /// (e.g. `tool_error`, `credential_decrypt_failure`, `provider_failover`).
    /// Used for icon mapping and i18n lookup; not user-facing prose.
    pub kind: String,
    /// One-line human summary captured at promotion time.
    pub title: String,
    /// Optional longer payload (free text or JSON) for the detail modal.
    pub detail: Option<String>,
    /// One of `open` / `acknowledged` / `resolved` / `dismissed`. See
    /// `IncidentStatus`.
    pub status: String,
    pub acknowledged_at: Option<String>,
    /// Currently always `"user"` (single-user app). Reserved for future
    /// auto-triage attribution.
    pub acknowledged_by: Option<String>,
    pub resolved_at: Option<String>,
    pub resolution_note: Option<String>,
    pub created_at: String,
}

/// Input shape for promoting a source row into an incident.
///
/// `dedup_key` is computed by the caller as `format!("{source_table}:{source_id}")`
/// — the repo does NOT compute it, so the caller can guarantee the key is
/// stable across retries.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateAuditIncidentInput {
    pub source_table: String,
    pub source_id: String,
    pub persona_id: Option<String>,
    pub persona_name: Option<String>,
    pub execution_id: Option<String>,
    pub severity: String,
    pub kind: String,
    pub title: String,
    pub detail: Option<String>,
}

/// Aggregated KPIs surfaced by the inbox header tiles.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AuditIncidentSummary {
    pub open: i64,
    pub acknowledged: i64,
    pub resolved: i64,
    pub dismissed: i64,
    /// (severity, count) for `status='open'` only.
    pub open_by_severity: Vec<(String, i64)>,
    /// (source_table, count) for `status='open'` only.
    pub open_by_source: Vec<(String, i64)>,
}

/// Filter shape for `list_audit_incidents`. All fields are optional;
/// omitting a field means "no constraint on this dimension."
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct IncidentFilters {
    /// Multi-select on `status`. Empty/None means all statuses.
    pub statuses: Option<Vec<String>>,
    /// Multi-select on `severity`. Empty/None means all severities.
    pub severities: Option<Vec<String>>,
    /// Multi-select on `source_table`. Empty/None means all sources.
    pub source_tables: Option<Vec<String>>,
    /// Single-persona filter; None means all personas.
    pub persona_id: Option<String>,
    /// ISO 8601 lower bound on `created_at`. None means no lower bound.
    pub since: Option<String>,
}
