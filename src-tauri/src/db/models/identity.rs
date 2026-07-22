use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::serde_util::double_option;
use crate::error::AppError;

// -- Enums ---------------------------------------------------------------

/// Authoritative trust state for a row in `trusted_peers`.
///
/// # Why three variants
///
/// `Manual` and `Revoked` are both currently set by code paths
/// ([`crate::db::repos::resources::identity::add_trusted_peer`] hardcodes
/// `Manual`; [`revoke_peer_trust`] sets `Revoked`). `Verified` is
/// **aspirational** — the variant exists so the type system is ready for
/// the planned signed-challenge / QR-fingerprint verification flow
/// without a future schema migration that would have to touch every
/// `Trusted*` consumer. It is intentionally NOT dead code.
///
/// # State machine
///
/// ```text
///                         add_trusted_peer
///                                │
///                                ▼
///                        ┌──────────────┐
///                        │    Manual    │ ◀─── (re-import after revoke
///                        │              │       requires explicit
///                        │              │       update_trusted_peer call;
///                        │              │       see add_trusted_peer)
///                        └───┬──────┬───┘
///   verify_signed_challenge  │      │  revoke_peer_trust
///   (future, planned)        │      │
///                            ▼      ▼
///                  ┌──────────┐   ┌──────────┐
///                  │ Verified │──▶│ Revoked  │ (terminal until DELETE
///                  │          │   │          │  via delete_trusted_peer)
///                  └──────────┘   └──────────┘
///                       │              ▲
///                       └──────────────┘
///                       revoke_peer_trust
/// ```
///
/// Allowed transitions:
/// - `<none>` → `Manual` via [`add_trusted_peer`] (user imports an
///   identity card out-of-band, e.g. file/QR/copy-paste)
/// - `Manual` → `Verified` via [`update_trusted_peer`] with
///   `trust_level: Some(Verified)`. **No code path performs this
///   transition automatically yet.** The intended trigger is a
///   signed-challenge/handshake flow that proves the peer holds the
///   matching private key (and surfaces a fingerprint match to the
///   user). Until that flow ships, the `Verified` state is reachable
///   only by manual user action via the same `update_trusted_peer`
///   command (e.g. an "I confirmed this fingerprint over a side
///   channel" toggle).
/// - `Manual` | `Verified` → `Revoked` via [`revoke_peer_trust`]
/// - Re-import of a `Revoked` peer is rejected at the repo layer; the
///   user must explicitly call [`update_trusted_peer`] to reset the
///   level before re-running [`add_trusted_peer`].
///
/// # Relationship to `discovered_peers.trust_status`
///
/// `trusted_peers.trust_level` and `discovered_peers.trust_status` are
/// **two distinct vocabularies** for two distinct concepts:
///
/// | Column | Vocabulary | Authoritative? | Set by |
/// |---|---|---|---|
/// | `trusted_peers.trust_level` | `manual` / `verified` / `revoked` | yes — user-managed | `add/update/revoke_trusted_peer` |
/// | `discovered_peers.trust_status` | `unknown` / `unverified` / `trusted` | derived | `mdns::validate_peer_announcement` |
///
/// The mapping is:
/// - `discovered_peers.trust_status = "trusted"` iff a non-revoked
///   `trusted_peers` row exists for that `peer_id`. (Both `Manual` and
///   `Verified` map to `"trusted"` — the discovered-peers UI does not
///   distinguish them.)
/// - `discovered_peers.trust_status = "unverified"` for any discovered
///   peer that does NOT have a non-revoked `trusted_peers` row. The
///   advertised peer_id has not been proven via Hello/HelloAck handshake
///   yet.
/// - `discovered_peers.trust_status = "unknown"` is the column default
///   for rows inserted before classification (transient — should be
///   overwritten by the next mDNS reconciliation tick).
///
/// In short: **`trusted_peers` is the source of truth for trust;
/// `discovered_peers.trust_status` is a UI-friendly projection of it
/// joined with the LAN discovery state.**
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum TrustLevel {
    /// User explicitly imported the peer's identity card via an
    /// out-of-band channel (file, QR, paste). The cryptographic
    /// identity is correct (peer_id matches public key), but the
    /// **identity-to-person binding** is only as strong as the channel
    /// the user used. Default starting state.
    Manual,
    /// User has confirmed the peer's identity via a fingerprint match
    /// or signed-challenge handshake — i.e. the peer has demonstrably
    /// proved control of the private key matching the imported public
    /// key. **Currently set only by manual user action via
    /// `update_trusted_peer`; the planned automatic verification flow
    /// is not yet wired**. See the state-machine section above.
    Verified,
    /// Trust has been withdrawn. Rows in this state are excluded from
    /// `list_trusted_peers` and `discovered_peers.trust_status` will
    /// stay `"unverified"`. Re-import requires an explicit
    /// `update_trusted_peer` call to a non-revoked level first.
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
    #[serde(default, deserialize_with = "double_option")]
    pub notes: Option<Option<String>>,
}
