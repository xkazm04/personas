//! Paired controllers: the trust anchor of the mobile command plane
//! (PHASE2-SPEC section 3, owner decisions D1 / M9 / M17).
//!
//! A *controller* is a phone (a browser on `personas.so`) that the operator
//! paired from this desktop's Settings. Its credential is an **Ed25519 key
//! pair whose private half never leaves the phone**: the cloud only ever
//! carries signatures, so a stolen web session (JWT) can read synced data but
//! cannot forge a paired command.
//!
//! This module owns three things and nothing else:
//!
//! 1. **The trust list** - the `cloud_controllers` settings row, a JSON array
//!    of [`Controller`] (`{controllerId, name, publicKey, createdAt, revoked}`).
//!    It is the authoritative list, it holds **no secret**, it is capped at
//!    [`MAX_CONTROLLERS`] active entries, and it is an **operator-only** key:
//!    the generic settings writers (the settings IPC, the Athena import, the
//!    management API) refuse it, because it decides which remote commands run
//!    without a click at this desk.
//! 2. **[`check`]** - the per-command verdict, in the spec's order (3.3):
//!    unsigned -> unknown controller -> revoked -> signature -> envelope fields
//!    -> timing. The command is parsed FROM the signed envelope text, never from
//!    the row's columns (jsonb reorders keys, so the columns cannot round-trip
//!    the signed form).
//! 3. **Revocation** (3.4) - see below. How a controller ENTERS the list is
//!    the pairing ceremony (3.2), which lives in `cloud::pairing`.
//!
//! Revocation is local-first: the flag is set here immediately and the
//! cloud row is PATCHed best-effort. A web-side `revoke_requested_at` is
//! honoured at the next command poll ([`honour_web_revocations`]).

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use chrono::{DateTime, Utc};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::cloud::sync::client::SyncClient;
use crate::db::repos::core::settings;
use crate::db::settings_keys;
use crate::db::DbPool;
use crate::error::AppError;

/// Hard cap on simultaneously ACTIVE controllers. Pairing a ninth is refused
/// until one is revoked - the same human-enumerable bound as the LAN
/// companion (`commands::fleet::pairing::MAX_DEVICES`).
pub const MAX_CONTROLLERS: usize = 8;

/// Revoked entries kept for the settings list (most recent first). Older ones
/// are dropped so the row cannot grow without bound.
const KEEP_REVOKED: usize = 8;

/// Tolerance for this desktop's clock against the phone's (spec 3.3 step 6).
pub const CLOCK_SKEW_SECS: i64 = 30;

/// An envelope whose `iat` is older than this is stale (spec 3.3 step 6).
pub const MAX_ENVELOPE_AGE_SECS: i64 = 5 * 60;

/// Refusal reasons, written verbatim to `pending_commands.error_message` so the
/// web can render "Refused: {reason}" from a closed vocabulary.
pub mod reason {
    pub const NOT_PAIRED: &str = "controller_not_paired";
    pub const REVOKED: &str = "controller_revoked";
    pub const BAD_SIGNATURE: &str = "bad_signature";
    pub const ENVELOPE_MISMATCH: &str = "envelope_mismatch";
    /// A signed command this desktop already claimed came back as `pending`.
    /// Only a writer other than this desktop can do that (the user's JWT may
    /// update the row's `status`), so it is refused, never run twice.
    pub const REPLAYED: &str = "replayed";
}

// ── the trust list ──────────────────────────────────────────────────────

/// One paired phone, as persisted. Contains NO secret: `public_key` is the
/// verifying half of a key whose signing half never leaves the phone.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Controller {
    /// Canonical lowercase UUID, minted by the phone.
    pub controller_id: String,
    /// Display name ("iPhone - Safari"), from the phone's row.
    pub name: String,
    /// base64url (no padding) raw 32-byte Ed25519 public key.
    pub public_key: String,
    /// RFC3339, when this desktop accepted the pairing.
    pub created_at: String,
    #[serde(default)]
    pub revoked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revoked_at: Option<String>,
}

/// Load the trust list. Missing -> empty; unparseable -> empty and warned.
/// Failing to read the list fails CLOSED: no controller, so no auto-run.
pub fn load_controllers(pool: &DbPool) -> Vec<Controller> {
    match settings::get(pool, settings_keys::CLOUD_CONTROLLERS) {
        Ok(Some(raw)) => match serde_json::from_str::<Vec<Controller>>(&raw) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(error = %e, "cloud trust: controller list unparseable - trusting nobody");
                Vec::new()
            }
        },
        Ok(None) => Vec::new(),
        Err(e) => {
            tracing::warn!(error = %e, "cloud trust: controller list read failed - trusting nobody");
            Vec::new()
        }
    }
}

fn save_controllers(pool: &DbPool, list: &[Controller]) -> Result<(), AppError> {
    let json = serde_json::to_string(list)
        .map_err(|e| AppError::Internal(format!("cloud trust: serialize controller list: {e}")))?;
    settings::set_operator_only(pool, settings_keys::CLOUD_CONTROLLERS, &json)
}

/// True when at least one non-revoked controller exists. Drives the adaptive
/// command poll and the revocation check.
pub fn any_active(pool: &DbPool) -> bool {
    load_controllers(pool).iter().any(|c| !c.revoked)
}

pub(crate) fn active_count(list: &[Controller]) -> usize {
    list.iter().filter(|c| !c.revoked).count()
}

/// Add an accepted controller. Refuses past the cap; a re-pair of the same id
/// replaces the old entry.
pub fn add_controller(pool: &DbPool, controller: Controller) -> Result<(), AppError> {
    let mut list = load_controllers(pool);
    list.retain(|c| c.controller_id != controller.controller_id);
    if active_count(&list) >= MAX_CONTROLLERS {
        return Err(AppError::Validation(format!(
            "Phone limit reached ({MAX_CONTROLLERS}). Revoke a phone before pairing another."
        )));
    }
    list.push(controller);
    save_controllers(pool, &list)
}

/// Remove a controller entirely. Used only to roll back a pairing whose cloud
/// activation failed, so the local list never trusts a phone that was never
/// told it is paired.
pub fn remove_controller(pool: &DbPool, controller_id: &str) -> Result<(), AppError> {
    let mut list = load_controllers(pool);
    let before = list.len();
    list.retain(|c| c.controller_id != controller_id);
    if list.len() == before {
        return Ok(());
    }
    save_controllers(pool, &list)
}

/// Mark controllers revoked, locally and immediately. `None` revokes every
/// active controller. Returns the ids that were newly revoked (already-revoked
/// ones are not re-stamped). Keeps only the [`KEEP_REVOKED`] most recent
/// revoked entries.
pub fn revoke_local(
    pool: &DbPool,
    which: Option<&str>,
    now: DateTime<Utc>,
) -> Result<Vec<String>, AppError> {
    let mut list = load_controllers(pool);
    let stamp = now.to_rfc3339();
    let mut newly = Vec::new();
    for c in list.iter_mut() {
        let selected = match which {
            None => true,
            Some(id) => same_uuid(id, &c.controller_id),
        };
        if selected && !c.revoked {
            c.revoked = true;
            c.revoked_at = Some(stamp.clone());
            newly.push(c.controller_id.clone());
        }
    }
    if newly.is_empty() {
        return Ok(newly);
    }
    // Prune old revoked entries: keep every active one and the newest revoked.
    let mut revoked: Vec<Controller> = list.iter().filter(|c| c.revoked).cloned().collect();
    revoked.sort_by(|a, b| b.revoked_at.cmp(&a.revoked_at));
    revoked.truncate(KEEP_REVOKED);
    let mut kept: Vec<Controller> = list.into_iter().filter(|c| !c.revoked).collect();
    kept.extend(revoked);
    save_controllers(pool, &kept)?;
    Ok(newly)
}

// ── envelope + verdict ──────────────────────────────────────────────────

/// The signed command (spec 3.3). Parsed from `pending_commands.envelope`, the
/// exact text the phone signed.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Envelope {
    pub v: u32,
    pub id: String,
    pub dev: String,
    #[serde(rename = "type")]
    pub command_type: String,
    #[serde(default)]
    pub persona: Option<String>,
    #[serde(default)]
    pub params: serde_json::Value,
    pub iat: String,
    pub exp: String,
    pub ctl: String,
}

/// The trust-relevant columns of one `pending_commands` row.
#[derive(Debug, Clone, Copy)]
pub struct SignedRow<'a> {
    pub id: &'a str,
    pub command_type: &'a str,
    pub persona_id: Option<&'a str>,
    pub controller_id: Option<&'a str>,
    pub envelope: Option<&'a str>,
    pub signature: Option<&'a str>,
}

/// A command that passed every check. The envelope, not the row, is what the
/// executor reads.
#[derive(Debug, Clone, PartialEq)]
pub struct Verified {
    pub controller_id: String,
    pub envelope: Envelope,
    /// The last instant [`check`] still accepts this envelope. A replay of
    /// it is only possible until then, so that is how long the desktop must
    /// remember having run it.
    pub valid_until: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Trust {
    /// No `controller_id`: a legacy / unpaired request.
    Unsigned,
    /// Signed by an active paired controller, and every check passed.
    Paired(Box<Verified>),
    /// One of [`reason`]'s values.
    Refused(&'static str),
    /// The envelope's `exp` passed, or its `iat` is too old.
    Expired,
}

/// Decode base64url, tolerating `=` padding (WebCrypto callers differ).
pub(crate) fn b64url(s: &str) -> Option<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(s.trim().trim_end_matches('=')).ok()
}

/// Ed25519 over the exact UTF-8 bytes of `envelope`. Strict verification:
/// rejects non-canonical signatures and small-order keys.
pub fn verify_signature(public_key_b64: &str, envelope: &str, signature_b64: &str) -> bool {
    let Some(key) = b64url(public_key_b64) else {
        return false;
    };
    let Ok(key) = <[u8; 32]>::try_from(key.as_slice()) else {
        return false;
    };
    let Ok(key) = VerifyingKey::from_bytes(&key) else {
        return false;
    };
    let Some(sig) = b64url(signature_b64) else {
        return false;
    };
    let Ok(sig) = <[u8; 64]>::try_from(sig.as_slice()) else {
        return false;
    };
    let sig = Signature::from_bytes(&sig);
    key.verify_strict(envelope.as_bytes(), &sig).is_ok()
}

fn same_uuid(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

fn parse_time(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|t| t.with_timezone(&Utc))
}

/// The per-command verdict, checks in the spec's order (3.3).
pub fn check(
    controllers: &[Controller],
    row: &SignedRow<'_>,
    own_device: &str,
    now: DateTime<Utc>,
) -> Trust {
    // 1. No controller -> unsigned (legacy path, decided by the caller).
    let Some(ctl) = row.controller_id.filter(|c| !c.trim().is_empty()) else {
        return Trust::Unsigned;
    };
    // 2. Unknown controller.
    let Some(controller) = controllers
        .iter()
        .find(|c| same_uuid(&c.controller_id, ctl))
    else {
        return Trust::Refused(reason::NOT_PAIRED);
    };
    // 3. Revoked.
    if controller.revoked {
        return Trust::Refused(reason::REVOKED);
    }
    // 4. Signature over the exact stored text.
    let (Some(text), Some(sig)) = (row.envelope, row.signature) else {
        return Trust::Refused(reason::BAD_SIGNATURE);
    };
    if !verify_signature(&controller.public_key, text, sig) {
        return Trust::Refused(reason::BAD_SIGNATURE);
    }
    // 5. The signed fields must agree with the row and with this desktop. A
    //    signed text that is not a v1 envelope is a mismatch too.
    let Ok(env) = serde_json::from_str::<Envelope>(text) else {
        return Trust::Refused(reason::ENVELOPE_MISMATCH);
    };
    let agrees = env.v == 1
        && same_uuid(&env.id, row.id)
        && env.dev == own_device
        && env.command_type == row.command_type
        && env.persona.as_deref() == row.persona_id
        && same_uuid(&env.ctl, ctl);
    if !agrees {
        return Trust::Refused(reason::ENVELOPE_MISMATCH);
    }
    // 6. Timing, with +-30 s for this desktop's clock.
    let (Some(iat), Some(exp)) = (parse_time(&env.iat), parse_time(&env.exp)) else {
        return Trust::Refused(reason::ENVELOPE_MISMATCH);
    };
    let skew = chrono::Duration::seconds(CLOCK_SKEW_SECS);
    let max_age = chrono::Duration::seconds(MAX_ENVELOPE_AGE_SECS);
    //    A signed envelope may not claim an `iat` in this desktop's future
    //    beyond the skew, nor a lifetime longer than the cap: either would
    //    let a stale signed row outlive the window the web promises.
    if iat > now + skew || exp > iat + max_age {
        return Trust::Refused(reason::ENVELOPE_MISMATCH);
    }
    //    Expired once `exp` passed or `iat` is more than 5 min old, whichever
    //    comes first.
    let valid_until = exp.min(iat + max_age) + skew;
    if now > valid_until {
        return Trust::Expired;
    }
    // 7. Paired.
    Trust::Paired(Box::new(Verified {
        controller_id: controller.controller_id.clone(),
        envelope: env,
        valid_until,
    }))
}

// ── revocation ──────────────────────────────────────────────────────────

/// Revoke locally (authoritative, immediate), then PATCH the cloud rows
/// best-effort. A failed PATCH leaves the cloud row `active` but this desktop
/// already refuses the controller's commands.
pub async fn revoke(
    pool: &DbPool,
    client: Option<&SyncClient>,
    which: Option<&str>,
) -> Result<usize, AppError> {
    let now = Utc::now();
    let ids = revoke_local(pool, which, now)?;
    if let Some(client) = client {
        for id in &ids {
            if let Err(e) = client
                .patch(
                    &format!("command_controllers?controller_id=eq.{id}"),
                    &json!({ "status": "revoked", "revoked_at": now.to_rfc3339() }),
                )
                .await
            {
                tracing::warn!(error = %e, "cloud trust: revoke PATCH failed (local revoke stands)");
            }
        }
    }
    Ok(ids.len())
}

#[derive(Debug, Deserialize)]
struct RevokeRequestRow {
    controller_id: String,
}

/// Honour web-side "Unpair this phone" (`revoke_requested_at` set). Called by
/// the command poll before it judges any signed command, so a revocation the
/// web requested is in force for the very next command.
pub async fn honour_web_revocations(pool: &DbPool, client: &SyncClient) -> Result<usize, AppError> {
    let active: Vec<String> = load_controllers(pool)
        .into_iter()
        .filter(|c| !c.revoked)
        .map(|c| c.controller_id)
        .collect();
    if active.is_empty() {
        return Ok(0);
    }
    // Every id came out of `accept_row`, which only admits a parsed UUID.
    let rows: Vec<RevokeRequestRow> = client
        .get(&format!(
            "command_controllers?controller_id=in.({})&revoke_requested_at=not.is.null&select=controller_id",
            active.join(",")
        ))
        .await?;
    let mut n = 0;
    for r in rows {
        if let Some(id) = active.iter().find(|a| same_uuid(a, &r.controller_id)) {
            n += revoke(pool, Some(client), Some(id.as_str())).await?;
        }
    }
    Ok(n)
}

/// Stamp `last_command_at` on the cloud row (spec 3.3 step 7). Best-effort and
/// cloud-only: a per-command write to the audited settings row would flood the
/// Settings History tab.
pub async fn stamp_last_command(client: &SyncClient, controller_id: &str) {
    if uuid::Uuid::parse_str(controller_id).is_err() {
        return;
    }
    let _ = client
        .patch(
            &format!("command_controllers?controller_id=eq.{controller_id}"),
            &json!({ "last_command_at": Utc::now().to_rfc3339() }),
        )
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    /// The shared test vector (PHASE2-SPEC 7 item 1), byte-identical to
    /// `personas-web/fixtures/command-envelope-v1.json`.
    const FIXTURE: &str = include_str!("../../../fixtures/command-envelope-v1.json");

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Vector {
        seed_hex: String,
        public_key: String,
        envelope: String,
        signature: String,
        tampered_envelope: String,
    }

    fn vector() -> Vector {
        serde_json::from_str(FIXTURE).expect("fixture parses")
    }

    fn at(s: &str) -> DateTime<Utc> {
        parse_time(s).expect("time")
    }

    const DEV: &str = "test-device-0001";
    const PERSONA: &str = "persona-test-0001";
    const ID: &str = "6f1d2c3b-4a59-4e68-9d7c-0b1a2c3d4e5f";
    const CTL: &str = "0c2b9a8f-7e6d-4c5b-8a49-3827160f5e4d";

    fn fixture_controller(v: &Vector) -> Controller {
        Controller {
            controller_id: CTL.into(),
            name: "Test phone".into(),
            public_key: v.public_key.clone(),
            created_at: "2026-10-06T11:00:00Z".into(),
            revoked: false,
            revoked_at: None,
        }
    }

    fn row<'a>(v: &'a Vector, envelope: &'a str) -> SignedRow<'a> {
        SignedRow {
            id: ID,
            command_type: "pause_persona",
            persona_id: Some(PERSONA),
            controller_id: Some(CTL),
            envelope: Some(envelope),
            signature: Some(&v.signature),
        }
    }

    #[test]
    fn shared_vector_verifies_with_its_public_key() {
        let v = vector();
        assert!(verify_signature(&v.public_key, &v.envelope, &v.signature));
    }

    #[test]
    fn shared_vector_rejects_the_tampered_envelope() {
        let v = vector();
        assert_ne!(v.envelope, v.tampered_envelope);
        assert!(!verify_signature(
            &v.public_key,
            &v.tampered_envelope,
            &v.signature
        ));
    }

    /// The seed in the vector derives the vector's public key and reproduces
    /// its signature: Ed25519 is deterministic, so desktop and web agree on
    /// the bytes, not merely on "a valid signature".
    #[test]
    fn shared_vector_seed_reproduces_key_and_signature() {
        let v = vector();
        let seed: [u8; 32] = hex::decode(&v.seed_hex)
            .expect("hex")
            .try_into()
            .expect("32 bytes");
        let sk = SigningKey::from_bytes(&seed);
        assert_eq!(
            URL_SAFE_NO_PAD.encode(sk.verifying_key().to_bytes()),
            v.public_key
        );
        let sig = sk.sign(v.envelope.as_bytes());
        assert_eq!(URL_SAFE_NO_PAD.encode(sig.to_bytes()), v.signature);
    }

    #[test]
    fn shared_vector_passes_the_full_check_inside_its_window() {
        let v = vector();
        let t = check(
            &[fixture_controller(&v)],
            &row(&v, &v.envelope),
            DEV,
            at("2026-10-06T12:00:30Z"),
        );
        let Trust::Paired(ok) = t else {
            panic!("expected Paired, got {t:?}")
        };
        assert_eq!(ok.controller_id, CTL);
        assert_eq!(ok.envelope.command_type, "pause_persona");
        assert_eq!(ok.envelope.persona.as_deref(), Some(PERSONA));
        assert_eq!(ok.envelope.params, json!({}));
        // exp (12:01:00) comes before iat + 5 min, plus 30 s of skew.
        assert_eq!(ok.valid_until, at("2026-10-06T12:01:30Z"));
    }

    #[test]
    fn unsigned_row_is_unsigned() {
        let v = vector();
        let mut r = row(&v, &v.envelope);
        r.controller_id = None;
        assert_eq!(check(&[], &r, DEV, Utc::now()), Trust::Unsigned);
    }

    #[test]
    fn unknown_controller_is_not_paired() {
        let v = vector();
        let t = check(&[], &row(&v, &v.envelope), DEV, at("2026-10-06T12:00:30Z"));
        assert_eq!(t, Trust::Refused(reason::NOT_PAIRED));
    }

    #[test]
    fn revoked_controller_is_refused_before_the_signature_is_read() {
        let v = vector();
        let mut c = fixture_controller(&v);
        c.revoked = true;
        let t = check(
            &[c],
            &row(&v, &v.tampered_envelope),
            DEV,
            at("2026-10-06T12:00:30Z"),
        );
        assert_eq!(t, Trust::Refused(reason::REVOKED));
    }

    #[test]
    fn tampered_envelope_is_bad_signature() {
        let v = vector();
        let t = check(
            &[fixture_controller(&v)],
            &row(&v, &v.tampered_envelope),
            DEV,
            at("2026-10-06T12:00:30Z"),
        );
        assert_eq!(t, Trust::Refused(reason::BAD_SIGNATURE));
        let mut r = row(&v, &v.envelope);
        r.signature = None;
        assert_eq!(
            check(&[fixture_controller(&v)], &r, DEV, Utc::now()),
            Trust::Refused(reason::BAD_SIGNATURE)
        );
    }

    #[test]
    fn other_desktop_is_envelope_mismatch() {
        let v = vector();
        let t = check(
            &[fixture_controller(&v)],
            &row(&v, &v.envelope),
            "another-desktop",
            at("2026-10-06T12:00:30Z"),
        );
        assert_eq!(t, Trust::Refused(reason::ENVELOPE_MISMATCH));
    }

    #[test]
    fn row_columns_that_disagree_with_the_envelope_are_a_mismatch() {
        let v = vector();
        let now = at("2026-10-06T12:00:30Z");
        let ctl = [fixture_controller(&v)];
        let mut r = row(&v, &v.envelope);
        r.command_type = "resume_persona";
        assert_eq!(
            check(&ctl, &r, DEV, now),
            Trust::Refused(reason::ENVELOPE_MISMATCH)
        );
        let mut r = row(&v, &v.envelope);
        r.persona_id = Some("someone-else");
        assert_eq!(
            check(&ctl, &r, DEV, now),
            Trust::Refused(reason::ENVELOPE_MISMATCH)
        );
        let mut r = row(&v, &v.envelope);
        r.id = "11111111-1111-4111-8111-111111111111";
        assert_eq!(
            check(&ctl, &r, DEV, now),
            Trust::Refused(reason::ENVELOPE_MISMATCH)
        );
    }

    #[test]
    fn timing_honours_exp_iat_and_thirty_seconds_of_skew() {
        let v = vector();
        let ctl = [fixture_controller(&v)];
        let r = row(&v, &v.envelope);
        // exp is 12:01:00. 29 s past it is inside the skew, 31 s is not.
        assert!(matches!(
            check(&ctl, &r, DEV, at("2026-10-06T12:01:29Z")),
            Trust::Paired(_)
        ));
        assert_eq!(
            check(&ctl, &r, DEV, at("2026-10-06T12:01:31Z")),
            Trust::Expired
        );
        // A desktop clock 25 s BEHIND the phone still accepts a fresh envelope.
        assert!(matches!(
            check(&ctl, &r, DEV, at("2026-10-06T11:59:35Z")),
            Trust::Paired(_)
        ));
    }

    #[test]
    fn iat_older_than_five_minutes_is_expired_at_the_lifetime_cap() {
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let pk = URL_SAFE_NO_PAD.encode(sk.verifying_key().to_bytes());
        let env = format!(
            r#"{{"v":1,"id":"{ID}","dev":"{DEV}","type":"pause_persona","persona":"{PERSONA}","params":{{}},"iat":"2026-10-06T12:00:00.000Z","exp":"2026-10-06T12:05:00.000Z","ctl":"{CTL}"}}"#
        );
        let sig = URL_SAFE_NO_PAD.encode(sk.sign(env.as_bytes()).to_bytes());
        let c = Controller {
            public_key: pk,
            ..fixture_controller(&vector())
        };
        let r = SignedRow {
            id: ID,
            command_type: "pause_persona",
            persona_id: Some(PERSONA),
            controller_id: Some(CTL),
            envelope: Some(&env),
            signature: Some(&sig),
        };
        assert!(matches!(
            check(
                std::slice::from_ref(&c),
                &r,
                DEV,
                at("2026-10-06T12:05:29Z")
            ),
            Trust::Paired(_)
        ));
        assert_eq!(
            check(&[c], &r, DEV, at("2026-10-06T12:05:31Z")),
            Trust::Expired
        );
    }

    /// Sign an envelope with the given iat/exp and run it through `check`.
    fn check_timed(iat: &str, exp: &str, now: &str) -> Trust {
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let pk = URL_SAFE_NO_PAD.encode(sk.verifying_key().to_bytes());
        let env = format!(
            r#"{{"v":1,"id":"{ID}","dev":"{DEV}","type":"pause_persona","persona":"{PERSONA}","params":{{}},"iat":"{iat}","exp":"{exp}","ctl":"{CTL}"}}"#
        );
        let sig = URL_SAFE_NO_PAD.encode(sk.sign(env.as_bytes()).to_bytes());
        let c = Controller {
            public_key: pk,
            ..fixture_controller(&vector())
        };
        let r = SignedRow {
            id: ID,
            command_type: "pause_persona",
            persona_id: Some(PERSONA),
            controller_id: Some(CTL),
            envelope: Some(&env),
            signature: Some(&sig),
        };
        check(&[c], &r, DEV, at(now))
    }

    #[test]
    fn an_envelope_dated_in_the_future_is_refused() {
        // iat 10 min ahead of this desktop's clock, exp inside the cap.
        assert_eq!(
            check_timed(
                "2026-10-06T12:10:00.000Z",
                "2026-10-06T12:11:00.000Z",
                "2026-10-06T12:00:00Z"
            ),
            Trust::Refused(reason::ENVELOPE_MISMATCH)
        );
    }

    #[test]
    fn an_envelope_with_a_lifetime_over_the_cap_is_refused() {
        assert_eq!(
            check_timed(
                "2026-10-06T12:00:00.000Z",
                "2026-10-06T13:00:00.000Z",
                "2026-10-06T12:00:10Z"
            ),
            Trust::Refused(reason::ENVELOPE_MISMATCH)
        );
    }

    #[test]
    fn an_honest_sixty_second_envelope_still_verifies() {
        assert!(matches!(
            check_timed(
                "2026-10-06T12:00:00.000Z",
                "2026-10-06T12:01:00.000Z",
                "2026-10-06T12:00:10Z"
            ),
            Trust::Paired(_)
        ));
        // iat 20 s ahead of a slow desktop clock is inside the skew.
        assert!(matches!(
            check_timed(
                "2026-10-06T12:00:20.000Z",
                "2026-10-06T12:01:20.000Z",
                "2026-10-06T12:00:00Z"
            ),
            Trust::Paired(_)
        ));
    }

    fn ctl_n(i: u8) -> Controller {
        Controller {
            controller_id: format!("00000000-0000-4000-8000-0000000000{i:02}"),
            name: format!("Phone {i}"),
            public_key: "k".into(),
            created_at: "2026-10-06T00:00:00Z".into(),
            revoked: false,
            revoked_at: None,
        }
    }

    #[test]
    fn store_caps_active_controllers_at_eight_and_revokes_locally() {
        let pool = crate::db::init_test_db().expect("db");
        for i in 0..8 {
            add_controller(&pool, ctl_n(i)).expect("add");
        }
        assert!(add_controller(&pool, ctl_n(8)).is_err(), "ninth refused");
        assert!(
            crate::cloud::pairing::begin_pairing(&pool).is_err(),
            "no QR at the cap"
        );
        let id = ctl_n(3).controller_id;
        assert_eq!(
            revoke_local(&pool, Some(&id), Utc::now()).expect("revoke"),
            vec![id.clone()]
        );
        assert!(
            revoke_local(&pool, Some(&id), Utc::now())
                .expect("again")
                .is_empty(),
            "idempotent"
        );
        add_controller(&pool, ctl_n(8)).expect("room again");
        let all = revoke_local(&pool, None, Utc::now()).expect("revoke all");
        assert_eq!(all.len(), 8);
        assert!(!any_active(&pool));
        assert!(
            load_controllers(&pool).len() <= KEEP_REVOKED,
            "revoked entries pruned"
        );
    }

    #[test]
    fn revoke_local_matches_the_id_case_insensitively() {
        let pool = crate::db::init_test_db().expect("db");
        let mut c = ctl_n(1);
        c.controller_id = "0c2b9a8f-7e6d-4c5b-8a49-3827160f5e4d".into();
        add_controller(&pool, c.clone()).expect("add");
        let upper = c.controller_id.to_ascii_uppercase();
        let revoked = revoke_local(&pool, Some(&upper), Utc::now()).expect("revoke");
        assert_eq!(revoked, vec![c.controller_id.clone()]);
        assert!(!any_active(&pool), "an upper-cased id must still revoke");
    }

    #[test]
    fn the_trust_list_is_operator_only() {
        let pool = crate::db::init_test_db().expect("db");
        let err = settings::set(&pool, settings_keys::CLOUD_CONTROLLERS, "[]");
        assert!(
            err.is_err(),
            "the generic writer must refuse the trust list"
        );
    }
}
