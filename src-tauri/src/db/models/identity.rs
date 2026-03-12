use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ── Local Identity ──────────────────────────────────────────────────────

/// The local app instance's persistent cryptographic identity.
/// Exactly one row ever exists in the `local_identity` table.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LocalIdentity {
    pub peer_id: String,
    pub display_name: String,
    pub created_at: String,
}

/// Full identity with public key (returned by get_local_identity command).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PeerIdentity {
    pub peer_id: String,
    pub public_key_b64: String,
    pub display_name: String,
    pub created_at: String,
}

/// Compact identity card for sharing with other users.
/// Base64-encoded JSON that can be copied, pasted, or embedded in QR codes.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct IdentityCard {
    pub peer_id: String,
    pub public_key_b64: String,
    pub display_name: String,
}

// ── Trusted Peers ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TrustedPeer {
    pub peer_id: String,
    pub public_key_b64: String,
    pub display_name: String,
    pub trust_level: String,
    pub added_at: String,
    pub last_seen: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ImportTrustedPeerInput {
    pub identity_card: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateTrustedPeerInput {
    pub display_name: Option<String>,
    pub trust_level: Option<String>,
    pub notes: Option<Option<String>>,
}
