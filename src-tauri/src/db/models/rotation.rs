use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Credential Rotation Policy
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CredentialRotationPolicy {
    pub id: String,
    pub credential_id: String,
    pub enabled: bool,
    pub rotation_interval_days: i32,
    pub policy_type: String,
    pub last_rotated_at: Option<String>,
    pub next_rotation_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateRotationPolicyInput {
    pub credential_id: String,
    pub rotation_interval_days: Option<i32>,
    pub policy_type: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateRotationPolicyInput {
    pub enabled: Option<bool>,
    pub rotation_interval_days: Option<i32>,
}

// ============================================================================
// Credential Rotation History
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CredentialRotationEntry {
    pub id: String,
    pub credential_id: String,
    pub rotation_type: String,
    pub status: String,
    pub detail: Option<String>,
    pub created_at: String,
}
