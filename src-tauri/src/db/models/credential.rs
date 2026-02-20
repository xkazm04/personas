use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Credentials
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaCredential {
    pub id: String,
    pub name: String,
    pub service_type: String,
    pub encrypted_data: String,
    pub iv: String,
    pub metadata: Option<String>,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateCredentialInput {
    pub name: String,
    pub service_type: String,
    pub encrypted_data: String,
    pub iv: String,
    pub metadata: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateCredentialInput {
    pub name: Option<String>,
    pub service_type: Option<String>,
    pub encrypted_data: Option<String>,
    pub iv: Option<String>,
    pub metadata: Option<Option<String>>,
}

// ============================================================================
// Credential Events
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CredentialEvent {
    pub id: String,
    pub credential_id: String,
    pub event_template_id: String,
    pub name: String,
    pub config: Option<String>,
    pub enabled: bool,
    pub last_polled_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateCredentialEventInput {
    pub credential_id: String,
    pub event_template_id: String,
    pub name: String,
    pub config: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateCredentialEventInput {
    pub name: Option<String>,
    pub config: Option<String>,
    pub enabled: Option<bool>,
    pub last_polled_at: Option<String>,
}
