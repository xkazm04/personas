//! Sealing the personal parts (SPEC.md 11): AES-256-GCM under a key derived
//! with PBKDF2-HMAC-SHA256, a fresh salt and nonce per part, the iteration
//! count stated in the file.
//!
//! The parameters are the app's own sealing primitives
//! (`data_portability`: `PBKDF2_ITERATIONS` = 600,000, 16-byte salt,
//! 12-byte nonce, `MIN_PASSPHRASE_LEN` = 8). The KDF call is made here rather
//! than through `data_portability::derive_key` because that helper hardcodes
//! its iteration count, and a consumer MUST use the count a card states.

use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde_json::{json, Value};
use sha2::Sha256;

use super::canonical::canonical_json;
use crate::commands::core::data_portability::{MIN_PASSPHRASE_LEN, PBKDF2_ITERATIONS};
use crate::error::AppError;

const ALG: &str = "AES-256-GCM";
const KDF: &str = "PBKDF2-HMAC-SHA256";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
/// The schema's floor for a stated iteration count.
const ITERATIONS_MIN: u64 = 100_000;
/// A ceiling on what a card may ask this machine to compute before anything
/// is known about it: about 16x the app's own count. Above it the card is
/// refused rather than allowed to pin a worker for minutes.
const ITERATIONS_MAX: u64 = 10_000_000;

/// A passphrase that can seal, or the reason it cannot. `None` means "do not
/// seal" and is not an error.
pub(super) fn sealing_passphrase(passphrase: Option<&str>) -> Result<Option<&str>, AppError> {
    match passphrase {
        None => Ok(None),
        Some(p) if p.chars().count() >= MIN_PASSPHRASE_LEN => Ok(Some(p)),
        Some(_) => Err(AppError::Validation(format!(
            "The passphrase must be at least {MIN_PASSPHRASE_LEN} characters."
        ))),
    }
}

/// Whether a part's value is a sealed envelope (`{ "sealed": { ... } }`).
pub(super) fn is_sealed(value: &Value) -> bool {
    value
        .as_object()
        .is_some_and(|map| map.len() == 1 && map.get("sealed").is_some_and(Value::is_object))
}

/// Seal one part: the ciphertext is the AEAD of the part's canonical JSON.
pub(super) fn seal_part(plaintext: &Value, passphrase: &str) -> Result<Value, AppError> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce_bytes);
    let cipher = cipher_for(passphrase, &salt, PBKDF2_ITERATIONS)?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            canonical_json(plaintext).as_bytes(),
        )
        .map_err(|e| AppError::Internal(format!("twin card seal: encryption failed: {e}")))?;
    Ok(json!({ "sealed": {
        "alg": ALG,
        "kdf": KDF,
        "iterations": PBKDF2_ITERATIONS,
        "salt": B64.encode(salt),
        "nonce": B64.encode(nonce_bytes),
        "ciphertext": B64.encode(ciphertext),
    }}))
}

/// Open one sealed part. A wrong passphrase (or a tampered ciphertext: GCM
/// cannot tell the two apart) is a `Validation` error naming the part.
pub(super) fn unseal_part(sealed: &Value, passphrase: &str, part: &str) -> Result<Value, AppError> {
    let envelope = sealed
        .get("sealed")
        .ok_or_else(|| invalid(part, "it is not a sealed envelope"))?;
    let field = |name: &str| envelope.get(name).and_then(Value::as_str);
    if field("alg") != Some(ALG) || field("kdf") != Some(KDF) {
        return Err(invalid(
            part,
            "it uses a cipher or KDF this app does not know",
        ));
    }
    let iterations = envelope
        .get("iterations")
        .and_then(Value::as_u64)
        .filter(|n| (ITERATIONS_MIN..=ITERATIONS_MAX).contains(n))
        .ok_or_else(|| {
            invalid(
                part,
                &format!("its iteration count is outside {ITERATIONS_MIN}-{ITERATIONS_MAX}"),
            )
        })?;
    let decode = |name: &str| {
        field(name)
            .and_then(|text| B64.decode(text).ok())
            .ok_or_else(|| invalid(part, &format!("its {name} is not base64")))
    };
    let salt = decode("salt")?;
    let nonce_bytes = decode("nonce")?;
    let ciphertext = decode("ciphertext")?;
    if nonce_bytes.len() != NONCE_LEN {
        return Err(invalid(part, "its nonce is not 12 bytes"));
    }
    // INVARIANT: filtered to ITERATIONS_MIN..=ITERATIONS_MAX above, which fits u32.
    let iterations = u32::try_from(iterations).unwrap_or(PBKDF2_ITERATIONS);
    let cipher = cipher_for(passphrase, &salt, iterations)?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_ref())
        .map_err(|_| {
            AppError::Validation(format!(
                "Wrong passphrase: the card's {part} could not be unsealed."
            ))
        })?;
    serde_json::from_slice(&plaintext).map_err(|e| {
        invalid(
            part,
            &format!("it unsealed to something that is not JSON ({e})"),
        )
    })
}

fn cipher_for(passphrase: &str, salt: &[u8], iterations: u32) -> Result<Aes256Gcm, AppError> {
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, iterations, &mut key);
    Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Internal(format!("twin card seal: cipher init failed: {e}")))
}

fn invalid(part: &str, why: &str) -> AppError {
    AppError::Validation(format!("The card's sealed {part} cannot be read: {why}."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sealed_part_opens_with_its_passphrase_to_the_same_value() {
        let part = json!({ "memories": [], "facts": [{ "content": "Ships on Thursdays.", "importance": 4 }] });
        let sealed = seal_part(&part, "correct horse").expect("seal");
        assert!(is_sealed(&sealed));
        assert_eq!(sealed["sealed"]["iterations"], json!(PBKDF2_ITERATIONS));
        assert_eq!(
            unseal_part(&sealed, "correct horse", "knowledge").expect("unseal"),
            part
        );
    }

    #[test]
    fn a_wrong_passphrase_is_a_validation_error() {
        let sealed = seal_part(&json!({ "goals": [] }), "correct horse").expect("seal");
        let err = unseal_part(&sealed, "wrong horse", "training").expect_err("must fail");
        assert!(matches!(err, AppError::Validation(ref m) if m.contains("Wrong passphrase")));
    }

    #[test]
    fn each_seal_draws_its_own_salt_and_nonce() {
        let part = json!({ "a": 1 });
        let one = seal_part(&part, "correct horse").expect("seal");
        let two = seal_part(&part, "correct horse").expect("seal");
        assert_ne!(one["sealed"]["salt"], two["sealed"]["salt"]);
        assert_ne!(one["sealed"]["nonce"], two["sealed"]["nonce"]);
    }

    #[test]
    fn an_absurd_iteration_count_is_refused_before_any_work() {
        let mut sealed = seal_part(&json!({ "a": 1 }), "correct horse").expect("seal");
        sealed["sealed"]["iterations"] = json!(4_000_000_000u64);
        assert!(unseal_part(&sealed, "correct horse", "knowledge").is_err());
    }

    #[test]
    fn a_short_passphrase_cannot_seal() {
        assert!(sealing_passphrase(Some("short")).is_err());
        assert_eq!(sealing_passphrase(None).expect("none"), None);
        assert_eq!(
            sealing_passphrase(Some("long enough")).expect("ok"),
            Some("long enough")
        );
    }
}
