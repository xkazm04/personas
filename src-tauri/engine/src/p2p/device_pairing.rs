//! Device pairing ceremony — turning two *authenticated* peers into two rows in
//! each other's `owned_devices` registry.
//!
//! Pairing sits strictly on top of the v2 signed handshake
//! ([`super::protocol`]): by the time a `PairRequest` is sent, both ends have
//! already proven possession of the Ed25519 key behind their claimed peer_id.
//! What pairing adds is the *human* half — a short code both devices derive
//! independently, so the person can confirm that the device answering is the
//! device in front of them and not a machine-in-the-middle.
//!
//! ## The ceremony
//!
//! ```text
//!  A (initiator)                                  B (responder)
//!  pair_request(peer_id=B)
//!    session_nonce := random 32B
//!    fingerprint   := F(A, B, session_nonce)
//!    ── PairRequest{session_nonce, group_A, name_A, at_stake_A} ──▶
//!                                        fingerprint := F(B, A, session_nonce)
//!                                        (same value — F sorts its peer ids)
//!    ◀── PairPending ──                  emit DEVICE_PAIRING_REQUESTED
//!  shows "042-917"                       shows "042-917"  ← human compares
//!                                        pair_confirm(peer_id=A)
//!                                          resolve surviving group
//!                                          write owned_devices[A]
//!    ◀── PairResponse{accepted, surviving_group, name_B, pk_B} ──
//!  join surviving_group (re-checked locally)
//!  write owned_devices[B]
//! ```
//!
//! `PairPending` is a receipt, not an acceptance: the responder never auto-
//! accepts, because the entire point of the fingerprint is that a human looked
//! at it. Confirmation happens on the *receiving* device and writes the
//! `owned_devices` row on both sides.
//!
//! ## Group semantics — one surviving group, decided by who has anything to lose
//!
//! Both devices must end up in ONE group, and re-anchoring never rewrites the
//! `owned_devices` rows a machine already holds — so whichever side moves strands
//! whatever it was already paired with. The ceremony therefore resolves toward
//! the side that has devices at stake:
//!
//! | initiator has devices | responder has devices | outcome |
//! |---|---|---|
//! | no  | no  | responder adopts the initiator's group (the deterministic tie-break: the offer on the wire wins) |
//! | yes | no  | responder adopts the initiator's group |
//! | no  | yes | **counter-offer** — the responder KEEPS its group and returns it as the surviving group; the initiator adopts it |
//! | yes | yes | [`AppError::DeviceGroupConflict`] before anything is written, naming the devices that would be stranded and telling the operator to unpair on one side first |
//!
//! Same group on both sides stays idempotent. The counter-offer is what makes a
//! THIRD device addable: an established machine acting as responder used to have
//! to refuse every newcomer, because it could not tell "the initiator has nothing
//! to lose" from "the initiator has devices to lose". `PairRequest.devices_at_stake`
//! is what tells it apart.
//!
//! ### Why a lying peer cannot strand your devices
//!
//! `devices_at_stake` is an unauthenticated claim, and the surviving group id in
//! `PairResponse` is too. Neither is ever the thing that authorizes a re-anchor.
//! Each side answers "may *I* leave my group?" from its own registry — the claim
//! only picks between counter-offering and refusing — and every write on both
//! sides goes through [`owned_devices_repo::join_device_group`], which re-checks
//! that predicate. A peer claiming a falsely empty group gets a counter-offer,
//! not a move; a peer claiming a falsely populated one only denies itself the
//! pairing. See [`owned_devices_repo::resolve_pairing_group`] for the exact
//! predicate, including why the peer being paired with never counts.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use ts_rs::TS;

use personas_core::error::AppError;
use personas_db::models::OwnedDevice;
use personas_db::repos::resources::owned_devices as owned_devices_repo;
use personas_db::DbPool;

use super::connection::ConnectionManager;
use super::protocol::{self, Message};
use crate::event_registry::{emit_event, event_name};

/// How long an unconfirmed pairing stays live before it is pruned. Public so
/// the `/mesh` door can state `expiresAtMs` without keeping a second copy.
pub const PAIRING_TTL: Duration = Duration::from_secs(300);
/// Cap on simultaneous pending pairings (anti-spam for the responder side).
const MAX_PENDING: usize = 16;
/// Fixed penalty before a failed [`DevicePairing::confirm_with_code`] answers,
/// the same 350 ms the phone companion's auth applies: it makes a serial guess
/// loop glacial without a lockout table.
const CODE_FAIL_DELAY: Duration = Duration::from_millis(350);
/// Wrong codes one pending pairing tolerates. The delay alone does not stop a
/// caller that guesses in PARALLEL, so the entry is withdrawn (and the
/// initiator told) on the last allowed miss; a human who mistyped five times
/// starts the ceremony again with a fresh code.
pub const MAX_CODE_ATTEMPTS: u32 = 5;

/// Why [`DevicePairing::confirm_with_code`] did not pair.
#[derive(Debug)]
pub enum PairCodeError {
    /// No pairing request from that peer is waiting for THIS device to confirm.
    NoPending,
    /// The typed code is not the one this device derived. The entry stays,
    /// so the human can retype within the TTL, unless `withdrawn` (the last
    /// allowed attempt was spent and the ceremony was cancelled).
    Mismatch { attempts_left: u32, withdrawn: bool },
    /// The code matched and the existing confirm path failed.
    Confirm(AppError),
}

impl std::fmt::Display for PairCodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoPending => write!(f, "No pairing request from that device is waiting here"),
            Self::Mismatch {
                withdrawn: true, ..
            } => write!(
                f,
                "That code does not match, and that was the last attempt: the pairing was \
                 cancelled. Start it again on the other device for a new code"
            ),
            Self::Mismatch { attempts_left, .. } => write!(
                f,
                "That code does not match the one this device shows ({attempts_left} attempts left)"
            ),
            Self::Confirm(e) => write!(f, "{e}"),
        }
    }
}

/// The digits of a typed code, any human spelling: `042-917`, `042 917` and
/// `042917` are one code. Everything that is not an ASCII digit is dropped.
pub fn code_digits(raw: &str) -> String {
    raw.chars().filter(char::is_ascii_digit).collect()
}

/// Compare two codes without an early return on the first differing byte.
/// The length is folded in as a full `usize`, so it cannot wrap to equal.
fn codes_match(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff = a.len() ^ b.len();
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        diff |= usize::from(x ^ y);
    }
    diff == 0
}

/// Which side of the ceremony this device is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum PairingRole {
    /// We called `pair_request`.
    Initiator,
    /// A peer asked us to pair; we owe a confirm/cancel.
    Responder,
}

/// Frontend-safe view of a pairing in flight. Carries the fingerprint both
/// devices must display, never the raw session nonce.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DevicePairingRequest {
    pub peer_id: String,
    pub display_name: String,
    /// The six-digit code (`NNN-NNN`) the user compares across both screens.
    pub fingerprint: String,
    pub role: PairingRole,
    pub requested_at: String,
}

struct Pending {
    display_name: String,
    fingerprint: String,
    /// The device group proposed by the initiator.
    device_group_id: String,
    /// Responder side only: how many devices the initiator CLAIMS are at stake
    /// in its group. Untrusted — see the module doc.
    peer_devices_at_stake: u32,
    /// The peer's handshake-proven public key.
    public_key_b64: String,
    role: PairingRole,
    created: Instant,
    requested_at: String,
    /// Wrong codes typed against this entry through [`DevicePairing::confirm_with_code`].
    code_failures: u32,
}

impl Pending {
    fn view(&self, peer_id: &str) -> DevicePairingRequest {
        DevicePairingRequest {
            peer_id: peer_id.to_string(),
            display_name: self.display_name.clone(),
            fingerprint: self.fingerprint.clone(),
            role: self.role,
            requested_at: self.requested_at.clone(),
        }
    }
}

/// Owns the in-flight pairing state and drives the wire exchange.
pub struct DevicePairing {
    pool: DbPool,
    connections: Arc<ConnectionManager>,
    pending: RwLock<HashMap<String, Pending>>,
    app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
}

impl DevicePairing {
    pub fn new(
        pool: DbPool,
        connections: Arc<ConnectionManager>,
        app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
    ) -> Self {
        Self {
            pool,
            connections,
            pending: RwLock::new(HashMap::new()),
            app_handle,
        }
    }

    fn prune(map: &mut HashMap<String, Pending>) {
        let now = Instant::now();
        map.retain(|_, p| now.duration_since(p.created) < PAIRING_TTL);
    }

    /// List pairings awaiting a decision (both roles).
    pub async fn list_pending(&self) -> Vec<DevicePairingRequest> {
        let mut map = self.pending.write().await;
        Self::prune(&mut map);
        map.iter().map(|(id, p)| p.view(id)).collect()
    }

    /// Require that the peer is currently connected — which, post-v2, means its
    /// identity was cryptographically proven — and return the key it proved.
    async fn proven_key(&self, peer_id: &str) -> Result<String, AppError> {
        self.connections
            .get_remote_public_key(peer_id)
            .await
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "Not connected to peer {peer_id}; pairing requires an authenticated connection"
                ))
            })
    }

    /// The channel binding of the live session to `peer_id`, mixed into the
    /// fingerprint so the human comparison independently detects a relay: two
    /// TLS sessions export two different values, so the two screens show two
    /// different codes.
    async fn channel_binding(&self, peer_id: &str) -> Result<String, AppError> {
        self.connections
            .channel_binding(peer_id)
            .await
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "Not connected to peer {peer_id}; pairing requires an authenticated connection"
                ))
            })
    }

    // -- Initiator ------------------------------------------------------

    /// Start a pairing with a connected peer. Returns the fingerprint to show.
    pub async fn request(&self, peer_id: &str) -> Result<DevicePairingRequest, AppError> {
        let local = crate::identity::get_or_create_identity(&self.pool)?;
        if peer_id == local.peer_id {
            return Err(AppError::Validation(
                "Cannot pair a device with itself".into(),
            ));
        }
        let public_key_b64 = self.proven_key(peer_id).await?;
        let device_group_id = owned_devices_repo::ensure_device_group_id(&self.pool)?;
        // What WE would strand by moving. The responder cannot see our registry,
        // so without this it has to assume the worst and refuse every newcomer.
        let devices_at_stake = owned_devices_repo::count_devices_at_stake(&self.pool, peer_id)?;

        let session_nonce = protocol::generate_nonce();
        let fingerprint = protocol::pairing_fingerprint(
            &local.peer_id,
            peer_id,
            &session_nonce,
            &self.channel_binding(peer_id).await?,
        );
        let remote_name = self
            .connections
            .get_remote_display_name(peer_id)
            .await
            .unwrap_or_else(|| peer_id.to_string());

        let pending = Pending {
            display_name: remote_name,
            fingerprint: fingerprint.clone(),
            device_group_id: device_group_id.clone(),
            peer_devices_at_stake: 0, // unused on the initiator side
            public_key_b64,
            role: PairingRole::Initiator,
            created: Instant::now(),
            requested_at: chrono::Utc::now().to_rfc3339(),
            code_failures: 0,
        };
        let view = pending.view(peer_id);
        {
            let mut map = self.pending.write().await;
            Self::prune(&mut map);
            map.insert(peer_id.to_string(), pending);
        }

        // Send the request and wait only for the receipt — the verdict arrives
        // later, on the responder's own stream, after a human decides.
        let send_result = async {
            let (mut send, mut recv) = self.connections.open_stream(peer_id).await?;
            protocol::write_message(
                &mut send,
                &Message::PairRequest {
                    session_nonce,
                    device_group_id,
                    display_name: local.display_name.clone(),
                    devices_at_stake,
                },
            )
            .await?;
            let reply = tokio::time::timeout(Duration::from_secs(10), protocol::decode(&mut recv))
                .await
                .map_err(|_| {
                    AppError::Internal("Pairing request timed out awaiting receipt".into())
                })??;
            match reply {
                Message::PairPending => Ok(()),
                Message::PairResponse {
                    accepted: false, ..
                } => Err(AppError::Validation(
                    "Peer declined the pairing request".into(),
                )),
                other => Err(AppError::Internal(format!(
                    "Unexpected reply to PairRequest: {other:?}"
                ))),
            }
        }
        .await;

        if let Err(e) = send_result {
            self.pending.write().await.remove(peer_id);
            return Err(e);
        }
        Ok(view)
    }

    /// Initiator side of the verdict: write our row once the responder accepts.
    pub async fn handle_response(
        &self,
        peer_id: &str,
        accepted: bool,
        device_group_id: String,
        display_name: String,
        public_key_b64: String,
    ) -> Result<(), AppError> {
        let Some(pending) = self.pending.write().await.remove(peer_id) else {
            return Err(AppError::Validation(format!(
                "No pairing in progress with {peer_id}"
            )));
        };
        if pending.role != PairingRole::Initiator {
            return Err(AppError::Validation(
                "Received a pairing verdict for a request we did not initiate".into(),
            ));
        }
        if !accepted {
            tracing::info!(peer_id = %peer_id, "Peer declined pairing");
            self.emit_pending_changed().await;
            return Ok(());
        }
        // The responder's name is its own claim: cap it like every other
        // peer-supplied name before it becomes our `owned_devices` row.
        let display_name = super::mdns::sanitise_display_name(&display_name);
        // Trust the key proven at handshake over the one echoed in the payload —
        // the payload is just a convenience, the handshake is the evidence.
        let key = if public_key_b64 == pending.public_key_b64 {
            public_key_b64
        } else {
            tracing::warn!(
                peer_id = %peer_id,
                "PairResponse public key differs from the handshake-proven key; keeping the proven one"
            );
            pending.public_key_b64
        };
        // `device_group_id` is the group the responder says survived: our own
        // offer when it joined us, or its own when it counter-offered. Either
        // way it is a claim off the network, so we adopt it only through the
        // local guard. If the responder counter-offered while WE hold devices
        // under a different group — which it can only do by our having lied
        // about `devices_at_stake`, or by a hostile peer — this refuses with the
        // same typed `DeviceGroupConflict` and writes nothing. A peer can never
        // talk us into stranding our own devices.
        let device_group_id =
            owned_devices_repo::join_device_group(&self.pool, &device_group_id, peer_id)?;
        owned_devices_repo::register_paired_device(
            &self.pool,
            peer_id,
            &device_group_id,
            &display_name,
            &key,
        )?;
        tracing::info!(peer_id = %peer_id, "Device pairing accepted; registered as an owned device");
        self.emit_pending_changed().await;
        Ok(())
    }

    // -- Responder ------------------------------------------------------

    /// Queue an incoming request for human confirmation. Returns the receipt to
    /// write back on the same stream.
    pub async fn handle_request(
        &self,
        peer_id: &str,
        session_nonce: String,
        device_group_id: String,
        display_name: String,
        devices_at_stake: u32,
    ) -> Result<Message, AppError> {
        protocol::validate_nonce(&session_nonce, "pairing session")?;
        // Shown in the confirm prompt and written to `owned_devices` on accept:
        // cap it like the mDNS name (a frame may carry up to 16 MB).
        let display_name = super::mdns::sanitise_display_name(&display_name);
        let local = crate::identity::get_or_create_identity(&self.pool)?;
        let public_key_b64 = self.proven_key(peer_id).await?;
        let fingerprint = protocol::pairing_fingerprint(
            &local.peer_id,
            peer_id,
            &session_nonce,
            &self.channel_binding(peer_id).await?,
        );

        {
            let mut map = self.pending.write().await;
            Self::prune(&mut map);
            if map.len() >= MAX_PENDING && !map.contains_key(peer_id) {
                return Err(AppError::Validation(
                    "Too many pending pairing requests".into(),
                ));
            }
            map.insert(
                peer_id.to_string(),
                Pending {
                    display_name,
                    fingerprint,
                    device_group_id,
                    peer_devices_at_stake: devices_at_stake,
                    public_key_b64,
                    role: PairingRole::Responder,
                    created: Instant::now(),
                    requested_at: chrono::Utc::now().to_rfc3339(),
                    code_failures: 0,
                },
            );
        }
        self.emit_pending_changed().await;
        Ok(Message::PairPending)
    }

    /// The `/mesh` door's confirm (decision D5): the human typed the code they
    /// read off the OTHER device, and this device checks it against the
    /// fingerprint it derived itself before pairing. The UI's
    /// [`Self::confirm`] (a click beside both codes) is unchanged.
    ///
    /// The typed code is normalised to its digits; the comparison is constant
    /// time. A match runs the existing [`Self::confirm`] path. Every failure
    /// waits [`CODE_FAIL_DELAY`] before it answers. A mismatch keeps the entry
    /// for a retype, until the [`MAX_CODE_ATTEMPTS`]th miss withdraws it.
    ///
    /// SECURITY-SENSITIVE: this is the check that turns "the human compared
    /// the codes" from a comment into a gate. It never returns the expected
    /// code, and a responder entry is the only one it will confirm.
    pub async fn confirm_with_code(
        &self,
        peer_id: &str,
        typed_code: &str,
    ) -> Result<OwnedDevice, PairCodeError> {
        let typed = code_digits(typed_code);
        // Compare and count under ONE write lock, so parallel guesses cannot
        // all read the same failure count.
        let verdict = {
            let mut map = self.pending.write().await;
            Self::prune(&mut map);
            match map.get_mut(peer_id) {
                Some(p) if p.role == PairingRole::Responder => {
                    if codes_match(&typed, &code_digits(&p.fingerprint)) {
                        None
                    } else {
                        p.code_failures += 1;
                        let attempts_left = MAX_CODE_ATTEMPTS.saturating_sub(p.code_failures);
                        Some(PairCodeError::Mismatch {
                            attempts_left,
                            withdrawn: attempts_left == 0,
                        })
                    }
                }
                _ => Some(PairCodeError::NoPending),
            }
        };
        match verdict {
            None => self.confirm(peer_id).await.map_err(PairCodeError::Confirm),
            Some(err) => {
                if let PairCodeError::Mismatch {
                    withdrawn: true, ..
                } = err
                {
                    tracing::warn!(peer_id = %peer_id, "Pairing withdrawn after too many wrong codes");
                    if let Err(e) = self.cancel(peer_id).await {
                        tracing::warn!(peer_id = %peer_id, "Withdrawing the pairing failed: {e}");
                    }
                }
                tokio::time::sleep(CODE_FAIL_DELAY).await;
                Err(err)
            }
        }
    }

    /// The human said yes on this device. Writes our own `owned_devices` row and
    /// tells the initiator to write its mirror.
    pub async fn confirm(&self, peer_id: &str) -> Result<OwnedDevice, AppError> {
        let pending = {
            let map = self.pending.read().await;
            let p = map.get(peer_id).ok_or_else(|| {
                AppError::NotFound(format!("No pairing request pending from {peer_id}"))
            })?;
            if p.role != PairingRole::Responder {
                return Err(AppError::Validation(
                    "Only the receiving device can confirm a pairing".into(),
                ));
            }
            (
                p.display_name.clone(),
                p.device_group_id.clone(),
                p.public_key_b64.clone(),
                p.peer_devices_at_stake,
            )
        };
        let (display_name, proposed_group_id, public_key_b64, peer_devices_at_stake) = pending;

        // Settle on ONE surviving group. Whichever side re-anchors strands the
        // devices it already holds, so the side with devices at stake is the one
        // that keeps its group: we adopt the initiator's offer when we have
        // nothing to lose, counter-offer our own when it does not, and refuse
        // with a typed `DeviceGroupConflict` when both sides are populated. That
        // error travels straight up through the `confirm_device_pairing` command
        // to the person who just pressed confirm. Everything here runs BEFORE any
        // write, so a refused pairing leaves the registry exactly as it was.
        //
        // `peer_devices_at_stake` is the initiator's own unauthenticated claim.
        // It can only steer us between counter-offering and refusing — whether we
        // may leave our group is read from our registry, and the adopt path still
        // goes through `join_device_group`, which re-checks it.
        let surviving_group_id = match owned_devices_repo::resolve_pairing_group(
            &self.pool,
            &proposed_group_id,
            peer_id,
            peer_devices_at_stake > 0,
        )? {
            owned_devices_repo::GroupResolution::Adopt(group) => {
                owned_devices_repo::join_device_group(&self.pool, &group, peer_id)?
            }
            owned_devices_repo::GroupResolution::Keep(group) => {
                tracing::info!(
                    peer_id = %peer_id,
                    "Counter-offering our device group; the peer reports nothing at stake"
                );
                group
            }
        };

        let local = crate::identity::get_or_create_identity(&self.pool)?;
        let device = owned_devices_repo::register_paired_device(
            &self.pool,
            peer_id,
            &surviving_group_id,
            &display_name,
            &public_key_b64,
        )?;

        let (mut send, _recv) = self.connections.open_stream(peer_id).await?;
        protocol::write_message(
            &mut send,
            &Message::PairResponse {
                accepted: true,
                device_group_id: surviving_group_id,
                display_name: local.display_name.clone(),
                public_key_b64: local.public_key_b64.clone(),
            },
        )
        .await?;

        self.pending.write().await.remove(peer_id);
        self.emit_pending_changed().await;
        tracing::info!(peer_id = %peer_id, "Confirmed device pairing");
        Ok(device)
    }

    // -- Either side ----------------------------------------------------

    /// Abandon a pairing. As responder this also tells the initiator, so its UI
    /// does not sit on a code that will never be confirmed.
    pub async fn cancel(&self, peer_id: &str) -> Result<(), AppError> {
        let Some(pending) = self.pending.write().await.remove(peer_id) else {
            return Ok(());
        };
        if pending.role == PairingRole::Responder {
            let local = crate::identity::get_or_create_identity(&self.pool)?;
            // Best-effort: the peer may already be gone, and a cancel that fails
            // to deliver must still clear local state.
            if let Ok((mut send, _recv)) = self.connections.open_stream(peer_id).await {
                let _ = protocol::write_message(
                    &mut send,
                    &Message::PairResponse {
                        accepted: false,
                        device_group_id: String::new(),
                        display_name: local.display_name.clone(),
                        public_key_b64: local.public_key_b64.clone(),
                    },
                )
                .await;
            }
        }
        self.emit_pending_changed().await;
        Ok(())
    }

    async fn emit_pending_changed(&self) {
        let views = self.list_pending().await;
        let guard = self.app_handle.read().await;
        if let Some(app) = guard.as_ref() {
            emit_event(app, event_name::DEVICE_PAIRING_REQUESTED, &views);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The role enum round-trips as camelCase over IPC, so a frontend switch on
    /// it stays stable if a variant is ever added.
    #[test]
    fn role_serializes_camel_case() {
        assert_eq!(
            serde_json::to_string(&PairingRole::Initiator).unwrap(),
            "\"initiator\""
        );
        assert_eq!(
            serde_json::to_string(&PairingRole::Responder).unwrap(),
            "\"responder\""
        );
    }

    /// Both sides derive the fingerprint from the SAME session nonce and the
    /// SAME channel binding, but from mirrored peer-id arguments. Pin that the
    /// ceremony's two call sites agree (the initiator's `request` and the
    /// responder's `handle_request` differ only in argument order).
    #[test]
    fn ceremony_call_sites_agree_on_the_code() {
        let initiator = "AAAApeer";
        let responder = "ZZZZpeer";
        let session = protocol::generate_nonce();
        // One honest QUIC session: both ends export the same binding.
        let cb = protocol::generate_nonce();
        // request(): pairing_fingerprint(local=initiator, remote=responder, n, cb)
        let shown_by_initiator = protocol::pairing_fingerprint(initiator, responder, &session, &cb);
        // handle_request(): pairing_fingerprint(local=responder, remote=initiator, n, cb)
        let shown_by_responder = protocol::pairing_fingerprint(responder, initiator, &session, &cb);
        assert_eq!(shown_by_initiator, shown_by_responder);
    }

    // -- confirm_with_code (D5) ------------------------------------------

    const PEER: &str = "InitiatorPeer0001";

    /// A pairing service with no live connection: enough for every branch
    /// that is decided before a stream is opened.
    fn pairing() -> (DevicePairing, DbPool) {
        let pool = personas_db::init_test_db().expect("test db");
        // The row the process identity would have written, so `confirm` and
        // `cancel` read it from the DB and never reach for the OS keyring.
        seed_identity(&pool).expect("seed local_identity");
        let transport = Arc::new(
            super::super::transport::QuicTransport::new("ResponderPeer0001".into())
                .expect("transport"),
        );
        let connections = Arc::new(ConnectionManager::new(
            transport,
            pool.clone(),
            "ResponderPeer0001".into(),
            "Responder".into(),
            8,
        ));
        (
            DevicePairing::new(pool.clone(), connections, Arc::new(RwLock::new(None))),
            pool,
        )
    }

    fn seed_identity(pool: &DbPool) -> Result<(), AppError> {
        let key = ed25519_dalek::SigningKey::generate(&mut rand::rngs::OsRng);
        pool.get()?.execute(
            "INSERT INTO local_identity (id, peer_id, public_key, display_name) VALUES (1, ?1, ?2, 'Responder')",
            rusqlite::params![
                crate::identity::public_key_to_peer_id(&key.verifying_key()),
                key.verifying_key().as_bytes().to_vec()
            ],
        )?;
        Ok(())
    }

    async fn hold(p: &DevicePairing, role: PairingRole, fingerprint: &str) {
        p.pending.write().await.insert(
            PEER.to_string(),
            Pending {
                display_name: "Initiator".into(),
                fingerprint: fingerprint.into(),
                device_group_id: "group-initiator".into(),
                peer_devices_at_stake: 0,
                public_key_b64: "pk".into(),
                role,
                created: Instant::now(),
                requested_at: chrono::Utc::now().to_rfc3339(),
                code_failures: 0,
            },
        );
    }

    async fn still_pending(p: &DevicePairing) -> bool {
        p.list_pending().await.iter().any(|v| v.peer_id == PEER)
    }

    #[test]
    fn a_typed_code_is_its_digits_in_any_spelling() {
        assert_eq!(code_digits("042-917"), "042917");
        assert_eq!(code_digits(" 042 917 "), "042917");
        assert_eq!(code_digits("042917"), "042917");
        assert_eq!(code_digits("O42-917"), "42917", "a letter O is not a zero");
        assert!(codes_match("042917", "042917"));
        assert!(!codes_match("042917", "042918"));
        assert!(!codes_match("04291", "042917"), "a prefix is not a match");
        assert!(!codes_match("", "042917"));
    }

    #[tokio::test]
    async fn no_pending_entry_is_no_pending_and_waits_first() {
        let (p, _) = pairing();
        let started = Instant::now();
        let err = p.confirm_with_code(PEER, "042-917").await.unwrap_err();
        assert!(matches!(err, PairCodeError::NoPending), "{err}");
        assert!(
            started.elapsed() >= CODE_FAIL_DELAY,
            "a failure answers only after the fixed delay"
        );
    }

    #[tokio::test]
    async fn an_initiator_entry_cannot_be_confirmed_by_code() {
        let (p, _) = pairing();
        hold(&p, PairingRole::Initiator, "042-917").await;
        let err = p.confirm_with_code(PEER, "042-917").await.unwrap_err();
        assert!(matches!(err, PairCodeError::NoPending), "{err}");
        assert!(
            still_pending(&p).await,
            "the initiator's own entry is untouched"
        );
    }

    #[tokio::test]
    async fn a_wrong_code_keeps_the_entry_for_a_retype() {
        let (p, pool) = pairing();
        hold(&p, PairingRole::Responder, "042-917").await;
        let err = p.confirm_with_code(PEER, "042 918").await.unwrap_err();
        assert!(
            matches!(
                err,
                PairCodeError::Mismatch {
                    attempts_left: 4,
                    withdrawn: false
                }
            ),
            "{err}"
        );
        assert!(still_pending(&p).await, "the human can retype");
        assert!(
            owned_devices_repo::get_owned_device(&pool, PEER)
                .unwrap()
                .is_none(),
            "nothing was paired"
        );
        assert!(
            !err.to_string().contains("042"),
            "an error never carries the expected code: {err}"
        );
    }

    #[tokio::test]
    async fn the_last_allowed_miss_withdraws_the_pairing() {
        let (p, _) = pairing();
        hold(&p, PairingRole::Responder, "042-917").await;
        for left in (1..MAX_CODE_ATTEMPTS).rev() {
            let err = p.confirm_with_code(PEER, "000000").await.unwrap_err();
            assert!(
                matches!(err, PairCodeError::Mismatch { attempts_left, withdrawn: false } if attempts_left == left),
                "{err}"
            );
        }
        let err = p.confirm_with_code(PEER, "000000").await.unwrap_err();
        assert!(
            matches!(
                err,
                PairCodeError::Mismatch {
                    attempts_left: 0,
                    withdrawn: true
                }
            ),
            "{err}"
        );
        assert!(!still_pending(&p).await, "withdrawn after the last miss");
        // Even the RIGHT code is too late now.
        let err = p.confirm_with_code(PEER, "042-917").await.unwrap_err();
        assert!(matches!(err, PairCodeError::NoPending), "{err}");
    }

    /// A match goes down the existing `confirm` path: it writes our
    /// `owned_devices` row, then fails only at telling the (absent) initiator.
    #[tokio::test]
    async fn the_right_code_in_any_spelling_reaches_confirm() {
        let (p, pool) = pairing();
        hold(&p, PairingRole::Responder, "042-917").await;
        let err = p.confirm_with_code(PEER, " 042917 ").await.unwrap_err();
        assert!(
            matches!(err, PairCodeError::Confirm(_)),
            "past the code check, into confirm: {err}"
        );
        assert!(
            owned_devices_repo::get_owned_device(&pool, PEER)
                .unwrap()
                .is_some(),
            "confirm registered the device before the stream failed"
        );
    }
}
