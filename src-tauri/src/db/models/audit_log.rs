use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A single entry in the immutable credential audit log.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CredentialAuditEntry {
    pub id: String,
    pub credential_id: String,
    pub credential_name: String,
    /// Operation type: "decrypt", "create", "update", "delete", "healthcheck"
    pub operation: String,
    pub persona_id: Option<String>,
    pub persona_name: Option<String>,
    pub detail: Option<String>,
    pub created_at: String,
}

/// Aggregated usage stats for a single credential.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CredentialUsageStats {
    pub credential_id: String,
    pub total_accesses: u32,
    pub distinct_personas: u32,
    pub last_accessed_at: Option<String>,
    pub first_accessed_at: Option<String>,
    /// Accesses in the last 24 hours.
    pub accesses_last_24h: u32,
    /// Accesses in the last 7 days.
    pub accesses_last_7d: u32,
}

/// A persona (or team) that depends on a credential.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CredentialDependent {
    pub persona_id: String,
    pub persona_name: String,
    /// How the dependency was determined: "tool_connector" or "audit_log"
    pub link_type: String,
    /// The connector/service name bridging the dependency.
    pub via_connector: Option<String>,
    pub last_used_at: Option<String>,
}
