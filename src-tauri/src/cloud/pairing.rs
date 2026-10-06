//! The pairing ceremony of the mobile command plane (PHASE2-SPEC 3.2).
//!
//! Desktop-initiated. Settings mints a pairing id and a 32-byte secret, held
//! **in memory only** for [`PAIRING_TTL`], and shows a QR of
//! `https://personas.so/dashboard/settings#pair=<pairing_id>.<secret>`: the
//! secret rides in the URL *fragment*, which a browser never sends to a
//! server. The phone (signed in to the same account) generates a
//! non-extractable Ed25519 key and inserts a `command_controllers` row with
//! `proof = base64url(HMAC-SHA256(secret, "<pairing_id>|<controller_id>|<public_key>"))`.
//! While the QR is up the dialog polls [`poll_pairing`] every 2 s, which
//! verifies the proof in constant time, stores the controller in the trust
//! list (`cloud::trust`), PATCHes the row `active`, and drops the secret.
//!
//! Holding the secret proves the phone saw the QR, so a stolen web session
//! cannot insert a pairing that verifies. Because the operator started the
//! ceremony at the desk, no further click is needed.
//!
//! **Wire encodings** (not fixed by the spec text; this is the desktop's half
//! of the contract): `<secret>` is base64url without padding of the 32 raw
//! bytes, and the HMAC key is those 32 decoded bytes. `proof` and
//! `public_key` are base64url (padding tolerated on read). The HMAC message
//! is the UTF-8 of the three values joined by `|`, each exactly as it appears
//! in the row.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use chrono::{DateTime, Utc};
use ed25519_dalek::VerifyingKey;
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::json;
use sha2::Sha256;

use crate::cloud::sync::client::SyncClient;
use crate::cloud::trust::{self, Controller, MAX_CONTROLLERS};
use crate::db::DbPool;
use crate::error::AppError;

/// How long a pairing secret lives in memory.
pub const PAIRING_TTL: Duration = Duration::from_secs(5 * 60);

/// The QR target. The `pair=` value is `<pairing_id>.<secret>` in the fragment.
pub const PAIRING_URL_BASE: &str = "https://personas.so/dashboard/settings#pair=";

struct PendingPairing {
    secret: [u8; 32],
    expires: Instant,
}

/// Live pairing secrets, in memory only. A `std::sync::Mutex` that is never
/// held across an `.await`.
static PENDING: LazyLock<Mutex<HashMap<String, PendingPairing>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn pending() -> std::sync::MutexGuard<'static, HashMap<String, PendingPairing>> {
    // A poisoned map of short-lived secrets is recoverable: the worst case is
    // a pairing that has to be restarted.
    PENDING.lock().unwrap_or_else(|e| e.into_inner())
}

/// A freshly minted pairing, returned once to the settings UI.
#[derive(Debug, Clone)]
pub struct PairingTicket {
    pub pairing_id: String,
    pub url: String,
}

/// The `pair=` fragment value: `<pairing_id>.<base64url(secret)>`.
pub fn pairing_url(pairing_id: &str, secret: &[u8; 32]) -> String {
    format!(
        "{PAIRING_URL_BASE}{pairing_id}.{}",
        URL_SAFE_NO_PAD.encode(secret)
    )
}

/// Mint a pairing id + 32-byte secret, held in memory for [`PAIRING_TTL`].
/// Refuses when the active cap is already reached, so the operator learns it
/// before showing a QR rather than after the phone did its half.
pub fn begin_pairing(pool: &DbPool) -> Result<PairingTicket, AppError> {
    if trust::active_count(&trust::load_controllers(pool)) >= MAX_CONTROLLERS {
        return Err(AppError::Validation(format!(
            "Phone limit reached ({MAX_CONTROLLERS}). Revoke a phone before pairing another."
        )));
    }
    let mut secret = [0u8; 32];
    {
        use rand::RngCore;
        rand::thread_rng().fill_bytes(&mut secret);
    }
    let pairing_id = uuid::Uuid::new_v4().to_string();
    let url = pairing_url(&pairing_id, &secret);
    let mut map = pending();
    let now = Instant::now();
    map.retain(|_, p| p.expires > now);
    map.insert(
        pairing_id.clone(),
        PendingPairing {
            secret,
            expires: now + PAIRING_TTL,
        },
    );
    Ok(PairingTicket { pairing_id, url })
}

/// The live secret for `pairing_id`, or `None` once it expired or ended.
fn pairing_secret(pairing_id: &str) -> Option<[u8; 32]> {
    let mut map = pending();
    let now = Instant::now();
    map.retain(|_, p| p.expires > now);
    map.get(pairing_id).map(|p| p.secret)
}

/// Drop a pairing's secret (accepted, refused, or the dialog closed).
pub fn end_pairing(pairing_id: &str) {
    pending().remove(pairing_id);
}

/// The HMAC message the phone signs with the pairing secret:
/// `<pairing_id>|<controller_id>|<public_key>`, UTF-8, each value exactly as it
/// appears in the `command_controllers` row.
pub fn proof_message(pairing_id: &str, controller_id: &str, public_key: &str) -> String {
    format!("{pairing_id}|{controller_id}|{public_key}")
}

/// Constant-time check of `proof` = base64url(HMAC-SHA256(secret, message)).
pub fn verify_proof(
    secret: &[u8; 32],
    pairing_id: &str,
    controller_id: &str,
    public_key: &str,
    proof_b64: &str,
) -> bool {
    let Some(proof) = trust::b64url(proof_b64) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret) else {
        return false;
    };
    mac.update(proof_message(pairing_id, controller_id, public_key).as_bytes());
    // `verify_slice` compares in constant time.
    mac.verify_slice(&proof).is_ok()
}

/// A `command_controllers` row as the phone inserted it.
#[derive(Debug, Clone, Deserialize)]
pub struct ControllerRow {
    pub controller_id: String,
    pub pairing_id: String,
    pub name: String,
    pub public_key: String,
    pub proof: String,
}

/// Where a ceremony stands, for the settings dialog's 2 s poll.
#[derive(Debug, Clone, PartialEq)]
pub enum PairingOutcome {
    /// No row yet (or the phone's row is not pending).
    Waiting,
    /// Accepted and activated; carries the phone's display name.
    Paired(String),
    /// The secret's TTL passed (or the ceremony was never started here).
    Expired,
    /// A row arrived whose proof did not verify; the ceremony is over.
    Refused,
}

/// Validate a phone's row against the live secret. Pure: no I/O. Returns the
/// controller to store, or why not.
pub fn accept_row(
    secret: &[u8; 32],
    row: &ControllerRow,
    now: DateTime<Utc>,
) -> Result<Controller, &'static str> {
    // The id is interpolated into PostgREST paths later; only a UUID may pass.
    let Ok(ctl) = uuid::Uuid::parse_str(&row.controller_id) else {
        return Err("controller id is not a UUID");
    };
    let key_ok = trust::b64url(&row.public_key)
        .and_then(|k| <[u8; 32]>::try_from(k.as_slice()).ok())
        .is_some_and(|k| VerifyingKey::from_bytes(&k).is_ok());
    if !key_ok {
        return Err("public key is not a raw 32-byte Ed25519 key");
    }
    if !verify_proof(
        secret,
        &row.pairing_id,
        &row.controller_id,
        &row.public_key,
        &row.proof,
    ) {
        return Err("proof did not verify");
    }
    let name: String = row.name.trim().chars().take(80).collect();
    Ok(Controller {
        controller_id: ctl.to_string(),
        name: if name.is_empty() {
            "Phone".to_string()
        } else {
            name
        },
        public_key: row.public_key.trim().to_string(),
        created_at: now.to_rfc3339(),
        revoked: false,
        revoked_at: None,
    })
}

const CONTROLLER_SELECT: &str = "select=controller_id,pairing_id,name,public_key,proof";

/// One step of the ceremony: look for the phone's row, verify it, store it,
/// activate it. Called by the settings dialog every 2 s while the QR is up.
pub async fn poll_pairing(
    pool: &DbPool,
    client: &SyncClient,
    pairing_id: &str,
) -> Result<PairingOutcome, AppError> {
    // The id is our own mint, but it arrives back over IPC: re-check it is a
    // UUID before it reaches a query path.
    uuid::Uuid::parse_str(pairing_id)
        .map_err(|_| AppError::Validation("Invalid pairing id".into()))?;
    let Some(secret) = pairing_secret(pairing_id) else {
        return Ok(PairingOutcome::Expired);
    };
    let rows: Vec<ControllerRow> = client
        .get(&format!(
            "command_controllers?pairing_id=eq.{pairing_id}&status=eq.pending&{CONTROLLER_SELECT}"
        ))
        .await?;
    let Some(row) = rows.into_iter().next() else {
        return Ok(PairingOutcome::Waiting);
    };
    let controller = match accept_row(&secret, &row, Utc::now()) {
        Ok(c) => c,
        Err(why) => {
            tracing::warn!(reason = why, "cloud trust: pairing row refused");
            end_pairing(pairing_id);
            // Scope the write to the row we judged; the controller id may not
            // be a UUID here, so filter on the pairing id we minted instead.
            let _ = client
                .patch(
                    &format!("command_controllers?pairing_id=eq.{pairing_id}&status=eq.pending"),
                    &json!({ "status": "refused" }),
                )
                .await;
            return Ok(PairingOutcome::Refused);
        }
    };
    // Store first, then activate; roll the store back if activation fails, so
    // the local list never trusts a phone the cloud does not call active.
    trust::add_controller(pool, controller.clone())?;
    let activated = client
        .patch_returning_count(
            &format!(
                "command_controllers?controller_id=eq.{}&pairing_id=eq.{pairing_id}&status=eq.pending",
                controller.controller_id
            ),
            &json!({
                "status": "active",
                "activated_at": Utc::now().to_rfc3339(),
                "device_id": crate::cloud::sync::cursor::resolve_device_id(pool),
            }),
        )
        .await;
    match activated {
        Ok(n) if n > 0 => {
            end_pairing(pairing_id);
            Ok(PairingOutcome::Paired(controller.name))
        }
        Ok(_) => {
            trust::remove_controller(pool, &controller.controller_id)?;
            Ok(PairingOutcome::Waiting)
        }
        Err(e) => {
            trust::remove_controller(pool, &controller.controller_id)?;
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;

    const CTL: &str = "0c2b9a8f-7e6d-4c5b-8a49-3827160f5e4d";

    #[test]
    fn pairing_proof_round_trips_and_rejects_any_other_input() {
        let secret = [9u8; 32];
        let pid = "5b0c7f2e-2a1d-4c3b-9e8f-7a6b5c4d3e2f";
        let pk = URL_SAFE_NO_PAD.encode(
            SigningKey::from_bytes(&[3u8; 32])
                .verifying_key()
                .to_bytes(),
        );
        let mut mac = Hmac::<Sha256>::new_from_slice(&secret).expect("key");
        mac.update(proof_message(pid, CTL, &pk).as_bytes());
        let proof = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
        assert!(verify_proof(&secret, pid, CTL, &pk, &proof));
        assert!(
            verify_proof(&secret, pid, CTL, &pk, &format!("{proof}=")),
            "padding tolerated"
        );
        assert!(
            !verify_proof(&[8u8; 32], pid, CTL, &pk, &proof),
            "wrong secret"
        );
        assert!(!verify_proof(
            &secret,
            pid,
            "0c2b9a8f-7e6d-4c5b-8a49-3827160f5e4e",
            &pk,
            &proof
        ));
        let row = ControllerRow {
            controller_id: CTL.into(),
            pairing_id: pid.into(),
            name: "  iPhone · Safari  ".into(),
            public_key: pk.clone(),
            proof,
        };
        let c = accept_row(&secret, &row, Utc::now()).expect("accepted");
        assert_eq!(c.name, "iPhone · Safari");
        assert!(accept_row(&[1u8; 32], &row, Utc::now()).is_err());
        let bad_id = ControllerRow {
            controller_id: "x&status=eq.active".into(),
            ..row
        };
        assert!(accept_row(&secret, &bad_id, Utc::now()).is_err());
    }

    #[test]
    fn pairing_url_carries_the_secret_in_the_fragment_only() {
        let url = pairing_url("5b0c7f2e-2a1d-4c3b-9e8f-7a6b5c4d3e2f", &[0xAB; 32]);
        let (base, frag) = url.split_once('#').expect("fragment");
        assert_eq!(base, "https://personas.so/dashboard/settings");
        let value = frag.strip_prefix("pair=").expect("pair=");
        let (pid, secret) = value.split_once('.').expect("dot");
        assert_eq!(pid, "5b0c7f2e-2a1d-4c3b-9e8f-7a6b5c4d3e2f");
        assert_eq!(trust::b64url(secret).expect("b64"), vec![0xAB; 32]);
    }

    #[test]
    fn begin_and_end_pairing_hold_the_secret_in_memory_only() {
        let pool = crate::db::init_test_db().expect("db");
        let t = begin_pairing(&pool).expect("ticket");
        assert!(pairing_secret(&t.pairing_id).is_some());
        assert!(t.url.starts_with(PAIRING_URL_BASE));
        end_pairing(&t.pairing_id);
        assert!(pairing_secret(&t.pairing_id).is_none());
        // Nothing about the ceremony reached the settings table.
        assert!(trust::load_controllers(&pool).is_empty());
    }
}
