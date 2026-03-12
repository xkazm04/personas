use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::AppError;

// -- Enums ---------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum TrustLevel {
    Manual,
    Verified,
    Revoked,
}

impl fmt::Display for TrustLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl TrustLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Verified => "verified",
            Self::Revoked => "revoked",
        }
    }

    pub fn is_revoked(&self) -> bool {
        matches!(self, Self::Revoked)
    }
}

impl FromStr for TrustLevel {
    type Err = AppError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "manual" => Ok(Self::Manual),
            "verified" => Ok(Self::Verified),
            "revoked" => Ok(Self::Revoked),
            _ => Err(AppError::Validation(format!(
                "Invalid trust_level '{s}': must be 'manual', 'verified', or 'revoked'"
            ))),
        }
    }
}

// -- Local Identity ------------------------------------------------------

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

// -- Trusted Peers -------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TrustedPeer {
    pub peer_id: String,
    pub public_key_b64: String,
    pub display_name: String,
    pub trust_level: TrustLevel,
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
    pub trust_level: Option<TrustLevel>,
    pub notes: Option<Option<String>>,
}
