//! The card signature (SPEC.md 10): Ed25519 over the RFC 8785 canonical form
//! of the WHOLE card with the `signature` member removed.
//!
//! The key is the device identity the `.persona` bundle signs with
//! (`engine::identity`: `get_or_create_identity` + `sign_message`, the private
//! key in the OS keyring). That module, and the Ed25519 crate under it, exist
//! only in a `p2p` build (`desktop-full`, what ships). A `desktop` (lite)
//! build therefore writes cards unsigned, never fails an export over it, and
//! cannot check a signature it reads: it reports that card `unsigned` with a
//! warning saying why, because `invalid` would accuse an honest file and
//! `valid` would vouch for one nothing checked (the operator's condition:
//! unsigned is never invalid).

#[cfg(feature = "p2p")]
use base64::engine::general_purpose::STANDARD as B64;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use base64::Engine;
use serde_json::Value;

use super::canonical::canonical_json;
use super::types::Signature;
use crate::db::DbPool;
use crate::error::AppError;

const ALG: &str = "Ed25519";

/// Returns the raw 64-byte Ed25519 signature of a message.
pub(super) type SignFn = Box<dyn Fn(&[u8]) -> Result<Vec<u8>, AppError> + Send + Sync>;

/// Signs canonical card bytes with one Ed25519 key.
pub(super) struct CardSigner {
    /// `signature.key_id`: the device's peer id.
    pub key_id: String,
    /// The raw 32-byte Ed25519 public key.
    pub public_key: Vec<u8>,
    pub sign: SignFn,
}

/// Whether an export can sign. Without a key the card is written unsigned
/// and the result's `signed: false` says so.
pub(super) enum Signing {
    /// Only a `p2p` build (or a test) has a key to sign with.
    #[cfg_attr(not(feature = "p2p"), allow(dead_code))]
    Key(CardSigner),
    /// This build has no device identity (no `p2p`). The export dialog
    /// already says "no device identity is available", so no warning
    /// repeats it.
    #[cfg_attr(feature = "p2p", allow(dead_code))]
    NoIdentity,
    /// The device identity exists but could not sign (a reset keyring, say):
    /// the reason travels as a warning. Only a `p2p` build has an identity
    /// that can fail.
    #[cfg_attr(not(feature = "p2p"), allow(dead_code))]
    Failed(String),
}

/// The state SPEC.md 10 asks a reader to report, plus the one a lite build
/// can reach and the spec has no word for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SignatureState {
    /// Only a `p2p` build has the Ed25519 verifier that can say so.
    #[cfg_attr(not(feature = "p2p"), allow(dead_code))]
    Valid,
    Invalid,
    Unsigned,
    /// Signed, but this build has no Ed25519 verifier. Reported on the wire
    /// as `unsigned` with a warning. Only a lite build reaches it.
    #[cfg_attr(feature = "p2p", allow(dead_code))]
    Unverifiable,
}

impl SignatureState {
    /// The `TwinCardInspection.signature` string.
    pub(super) fn wire(self) -> &'static str {
        match self {
            SignatureState::Valid => "valid",
            SignatureState::Invalid => "invalid",
            SignatureState::Unsigned | SignatureState::Unverifiable => "unsigned",
        }
    }
}

/// The bytes a signature covers: the canonical card without `signature`.
pub(super) fn signed_bytes(card: &Value) -> Vec<u8> {
    let mut unsigned = card.clone();
    if let Some(map) = unsigned.as_object_mut() {
        map.remove("signature");
    }
    canonical_json(&unsigned).into_bytes()
}

/// Sign `card` (which must not carry a signature yet).
pub(super) fn sign_card(card: &Value, signer: &CardSigner) -> Result<Signature, AppError> {
    let value = (signer.sign)(&signed_bytes(card))?;
    Ok(Signature {
        alg: ALG.to_string(),
        key_id: signer.key_id.clone(),
        public_key: B64URL.encode(&signer.public_key),
        value: B64URL.encode(value),
    })
}

/// Check the card's signature against the key it embeds. A signature proves
/// which key wrote the file, not who the person is (SPEC.md 10).
pub(super) fn verify_card(card: &Value) -> SignatureState {
    let Some(signature) = card.get("signature") else {
        return SignatureState::Unsigned;
    };
    let field = |name: &str| signature.get(name).and_then(Value::as_str);
    if field("alg") != Some(ALG) {
        return SignatureState::Invalid;
    }
    let (Some(public_key), Some(value)) = (
        field("public_key").and_then(decode_b64url),
        field("value").and_then(decode_b64url),
    ) else {
        return SignatureState::Invalid;
    };
    verify(&public_key, &signed_bytes(card), &value)
}

/// base64url as SPEC.md 10 writes it; padded input is tolerated.
fn decode_b64url(text: &str) -> Option<Vec<u8>> {
    B64URL.decode(text.trim_end_matches('=')).ok()
}

#[cfg(feature = "p2p")]
fn verify(public_key: &[u8], message: &[u8], value: &[u8]) -> SignatureState {
    match crate::engine::identity::verify_signature(
        &B64.encode(public_key),
        message,
        &B64.encode(value),
    ) {
        Ok(true) => SignatureState::Valid,
        // A malformed key or signature is a signature that does not verify.
        Ok(false) | Err(_) => SignatureState::Invalid,
    }
}

#[cfg(not(feature = "p2p"))]
fn verify(_public_key: &[u8], _message: &[u8], _value: &[u8]) -> SignatureState {
    SignatureState::Unverifiable
}

/// The device identity as a card signer. Creating the identity on first use
/// is what the `.persona` bundle export does too (`engine::bundle`).
#[cfg(feature = "p2p")]
pub(super) fn device_signing(pool: &DbPool) -> Signing {
    use crate::engine::identity;
    let identity = match identity::get_or_create_identity(pool) {
        Ok(identity) => identity,
        Err(e) => return Signing::Failed(unavailable(&e.to_string())),
    };
    let public_key = match B64.decode(&identity.public_key_b64) {
        Ok(bytes) => bytes,
        Err(e) => return Signing::Failed(unavailable(&e.to_string())),
    };
    let pool = pool.clone();
    Signing::Key(CardSigner {
        key_id: identity.peer_id,
        public_key,
        sign: Box::new(move |message| {
            let encoded = identity::sign_message(&pool, message)?;
            B64.decode(encoded)
                .map_err(|e| AppError::Internal(format!("twin card sign: signature encoding: {e}")))
        }),
    })
}

/// A lite build has no device identity.
#[cfg(not(feature = "p2p"))]
pub(super) fn device_signing(_pool: &DbPool) -> Signing {
    Signing::NoIdentity
}

#[cfg(feature = "p2p")]
fn unavailable(reason: &str) -> String {
    format!("The device identity could not sign this card ({reason}), so it is unsigned.")
}

#[cfg(test)]
pub(super) mod test_keys {
    //! A throwaway signer for tests: the device identity writes the OS
    //! keyring, which a test must never touch.
    use super::*;

    #[cfg(feature = "p2p")]
    pub(in super::super) fn signing() -> Signing {
        use ed25519_dalek::{Signer, SigningKey};
        let key = SigningKey::generate(&mut rand::rngs::OsRng);
        let public_key = key.verifying_key().as_bytes().to_vec();
        Signing::Key(CardSigner {
            key_id: "test-key".into(),
            public_key,
            sign: Box::new(move |message| Ok(key.sign(message).to_bytes().to_vec())),
        })
    }

    #[cfg(not(feature = "p2p"))]
    pub(in super::super) fn signing() -> Signing {
        Signing::NoIdentity
    }
}
