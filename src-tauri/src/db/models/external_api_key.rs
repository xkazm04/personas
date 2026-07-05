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
    /// Hard expiry (ISO 8601). `None` = never expires (legacy keys + the
    /// process "system" key). Enforced at lookup in `find_by_token`.
    pub expires_at: Option<String>,
    /// If set, the key is only accepted when the request's `Origin` header
    /// equals this value (browser callers). `None` = no origin restriction
    /// (CLI / MCP keys that send no Origin). Set by the pairing ceremony.
    pub bound_origin: Option<String>,
    /// Optional human note surfaced in the UI (e.g. the paired app's name).
    pub label: Option<String>,
}

impl ExternalApiKey {
    /// Parse the JSON-encoded `scopes` column into a vector of strings.
    /// Returns an empty vec on parse failure.
    pub fn parsed_scopes(&self) -> Vec<String> {
        serde_json::from_str(&self.scopes).unwrap_or_default()
    }

    /// True when the key has a hard expiry that is at or before `now`.
    /// A malformed `expires_at` is treated as **expired** (fail closed).
    pub fn is_expired_at(&self, now: chrono::DateTime<chrono::Utc>) -> bool {
        match self.expires_at.as_deref() {
            None => false,
            Some(raw) => match chrono::DateTime::parse_from_rfc3339(raw) {
                Ok(ts) => ts.with_timezone(&chrono::Utc) <= now,
                Err(_) => true,
            },
        }
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

/// One recorded management-API request an external API key made. Written
/// best-effort by the `require_api_key` middleware after the route resolves, so
/// the key's owner has a per-key action trail (not just `last_used_at`).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ApiKeyAuditEntry {
    pub id: String,
    pub key_id: String,
    pub at: String,
    pub method: String,
    pub path: String,
    /// HTTP status the request returned.
    pub status: i64,
    /// Target persona id if the route named one (execute / a2a / agent-card).
    pub persona_id: Option<String>,
    /// Request `Origin` header, if any (browser callers).
    pub origin: Option<String>,
}
