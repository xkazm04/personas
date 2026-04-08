use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// External API Keys (auth tokens for the management HTTP API)
// ============================================================================

/// Persisted external API key record. The plaintext token itself is **never**
/// stored — only its SHA-256 hash. Returned from `list()` and other read paths
/// without leaking secret material.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExternalApiKey {
    pub id: String,
    pub name: String,
    /// SHA-256 hex hash of the token. Never sent to the frontend.
    #[serde(skip_serializing)]
    #[ts(skip)]
    pub key_hash: String,
    /// First several chars of the token (e.g. "pk_a1b2c3"); safe to display.
    pub key_prefix: String,
    /// JSON-encoded array of scope strings (e.g. ["personas:read","personas:execute"]).
    pub scopes: String,
    pub enabled: bool,
    pub created_at: String,
    pub last_used_at: Option<String>,
    pub revoked_at: Option<String>,
}

impl ExternalApiKey {
    /// Parse the JSON-encoded `scopes` column into a vector of strings.
    /// Returns an empty vec on parse failure.
    pub fn parsed_scopes(&self) -> Vec<String> {
        serde_json::from_str(&self.scopes).unwrap_or_default()
    }
}

/// Response returned only from `create_external_api_key`. Contains the freshly
/// generated plaintext token — this is the **only** time it ever leaves the
/// backend.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateApiKeyResponse {
    pub record: ExternalApiKey,
    pub plaintext_token: String,
}
