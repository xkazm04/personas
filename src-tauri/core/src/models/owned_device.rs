//! A peer the user has paired as one of their own devices (cross-device sync).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A peer registered as one of the user's own devices, grouped under a shared
/// `device_group_id`. This is the device-ownership primitive from ADR
/// 2026-05-24-cross-device-persona-continuity: the workspace-sync loop exchanges
/// snapshots only with peers in this registry, and a pairing flow (these
/// commands, or the fleet `/friend` QR-pairing UI) is its writer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OwnedDevice {
    /// The peer's stable identity (base58 peer_id), matching `discovered_peers`.
    pub peer_id: String,
    /// Shared anchor marking this peer as belonging to the same user as us.
    pub device_group_id: String,
    pub display_name: String,
    pub added_at: String,
    pub last_synced_at: Option<String>,
    /// True for the single device the user nominates as their "home" machine.
    /// At most one owned device carries this flag (enforced by a partial unique
    /// index and by `set_device_home`).
    #[serde(default)]
    pub is_home: bool,
    /// When the pairing ceremony completed, if this row came from one. `None`
    /// for rows registered manually via `register_owned_device`.
    pub paired_at: Option<String>,
    /// The peer's Ed25519 public key (base64) as proven during the signed
    /// handshake at pairing time. `None` for manually registered rows.
    pub public_key: Option<String>,
}
