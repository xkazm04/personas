use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Credentials
// ============================================================================

/// A user credential. Field-level rows in `credential_fields` are the
/// authoritative source of truth for secrets — `encrypted_data` and `iv`
/// on this row are LEGACY-ONLY blobs left over from before the per-field
/// migration.
///
/// **Invariant (post-migration):** for every credential that has at least
/// one `credential_fields` row, `encrypted_data == ''` AND `iv == ''`.
/// Readers must NOT consult `encrypted_data` when field rows exist; doing
/// so reintroduces the dual-source-of-truth bug the migration was meant
/// to eliminate. The invariant is enforced two ways:
///
///  1. The `clear_legacy_credential_blobs` migration step empties the
///     blob columns on every row that has been split into fields.
///  2. `assert_credential_blob_invariant` runs at startup and emits a
///     `tracing::error!` for any row that violates the rule, so a future
///     regression that re-populates `encrypted_data` is loud.
///
/// New rows written by `create_credential` always set both blob columns
/// to the empty string. The fields-table is the only place secrets live.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PersonaCredential {
    pub id: String,
    pub name: String,
    pub service_type: String,
    /// LEGACY blob, retained only for migration reads. Authoritative source
    /// of truth for secrets is `credential_fields`. Post-migration this is
    /// always `""` for any row whose fields have been split — see the
    /// invariant on the type-level doc.
    #[serde(skip_serializing)]
    #[ts(skip)]
    pub encrypted_data: String,
    /// LEGACY nonce, paired with `encrypted_data`. Post-migration always
    /// `""` for split rows. See type-level invariant.
    #[serde(skip_serializing)]
    #[ts(skip)]
    pub iv: String,
    pub metadata: Option<String>,
    pub last_used_at: Option<String>,
    /// JSON object of user-picked sub-resources (repos, projects, folders, …).
    /// Shape: `{ "<resource_id>": [{ "id", "label", "meta"? }, ...] }`.
    /// NULL = broad scope; empty object = picker was opened and skipped.
    /// Identifiers are not secrets — stored plaintext. Auth fields that grant
    /// access to these resources live in credential_fields (encrypted).
    pub scoped_resources: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CreateCredentialInput {
    pub name: String,
    pub service_type: String,
    pub encrypted_data: String,
    pub iv: String,
    pub metadata: Option<String>,
    pub session_encrypted_data: Option<String>,
    /// When true, persist an initial healthcheck_last_success=true on creation
    /// (used by catalog flows where the credential was tested before saving).
    #[serde(default)]
    pub healthcheck_passed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateCredentialInput {
    pub name: Option<String>,
    pub service_type: Option<String>,
    pub encrypted_data: Option<String>,
    /// Derived from encryption -- never set by callers.
    /// skip_deserializing ensures this is always None from IPC input;
    /// the command layer sets it from the encryption result.
    #[serde(skip_deserializing, default)]
    pub iv: Option<String>,
    pub metadata: Option<Option<String>>,
    pub session_encrypted_data: Option<String>,
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
