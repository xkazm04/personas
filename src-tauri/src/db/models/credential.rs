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
    /// Never sent to the frontend — only used internally for crypto operations.
    #[serde(skip_serializing)]
    #[ts(skip)]
    pub encrypted_data: String,
    /// Never sent to the frontend — only used internally for crypto operations.
    #[serde(skip_serializing)]
    #[ts(skip)]
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
    /// Derived from encryption — never set by callers.
    /// skip_deserializing ensures this is always None from IPC input;
    /// the command layer sets it from the encryption result.
    #[serde(skip_deserializing, default)]
    pub iv: Option<String>,
    pub metadata: Option<Option<String>>,
}

// ============================================================================
// Credential Fields (field-level storage replacing monolithic blob)
// ============================================================================

/// A single credential field stored and encrypted independently.
/// Non-sensitive fields (like base URLs, project names) can be stored as
/// plaintext (iv = "") for queryability. Sensitive fields get their own
/// AES-256-GCM nonce so individual fields can be rotated without touching
/// the rest.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialField {
    pub id: String,
    pub credential_id: String,
    pub field_key: String,
    /// Encrypted value (or plaintext if `is_sensitive` is false).
    #[serde(skip_serializing)]
    pub encrypted_value: String,
    /// Per-field nonce. Empty string for non-sensitive plaintext fields.
    #[serde(skip_serializing)]
    pub iv: String,
    /// Hint for the field type (e.g. "api_key", "url", "token", "secret").
    pub field_type: String,
    /// Whether this field is sensitive (encrypted) or queryable plaintext.
    pub is_sensitive: bool,
    pub created_at: String,
    pub updated_at: String,
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

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateCredentialEventInput {
    pub name: Option<String>,
    pub config: Option<String>,
    pub enabled: Option<bool>,
    pub last_polled_at: Option<String>,
}
