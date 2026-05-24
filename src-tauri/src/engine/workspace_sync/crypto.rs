//! Payload encryption for cross-device persona sync (ADR Stage 3a).
//!
//! Same-user devices share a `device_group_id` established out-of-band at pairing
//! time, so a key-agreement protocol (ECDH) is unnecessary: both ends derive the
//! same AES-256 key from that shared secret via HKDF-SHA256. This keeps the
//! highest-care crypto small, dependency-free (aes-gcm / hkdf / sha2 are already
//! base deps), and fully unit-testable without a network or a second device.
//! (This supersedes the ed25519→X25519 ECDH originally sketched in the ADR.)
//!
//! Ungated (no `p2p`): pure crypto. The Stage 3b transport layer carries the
//! [`SealedPayload`] this module produces.

use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use ts_rs::TS;
use zeroize::Zeroize;

use super::snapshot::PersonaWorkspaceSnapshot;
use crate::error::AppError;

/// HKDF domain-separation label, so this key can never collide with another HKDF
/// use of the same secret elsewhere in the app. Versioned for future rotation.
const SYNC_KEY_INFO: &[u8] = b"personas-workspace-sync-v1";

/// A derived 32-byte AES-256 key, zeroized on drop.
pub struct SyncKey([u8; 32]);

impl Drop for SyncKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl SyncKey {
    /// Derive the sync key from the shared device-group secret via HKDF-SHA256.
    /// Two devices that share `group_secret` derive byte-identical keys.
    pub fn derive(group_secret: &str) -> Self {
        let hk = Hkdf::<Sha256>::new(None, group_secret.as_bytes());
        let mut okm = [0u8; 32];
        // `expand` only errors for absurd output lengths; 32 bytes never fails.
        hk.expand(SYNC_KEY_INFO, &mut okm)
            .expect("HKDF expand of 32 bytes is infallible");
        SyncKey(okm)
    }
}

/// An AES-256-GCM-sealed snapshot, base64-encoded for transport/storage. This is
/// the shape the Stage 3b protocol message carries between devices.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SealedPayload {
    pub ciphertext_b64: String,
    pub nonce_b64: String,
}

/// Serialize + encrypt a snapshot under the derived key (random 96-bit nonce).
pub fn seal_snapshot(
    key: &SyncKey,
    snapshot: &PersonaWorkspaceSnapshot,
) -> Result<SealedPayload, AppError> {
    let plaintext = serde_json::to_vec(snapshot)
        .map_err(|e| AppError::Internal(format!("sync snapshot serialize failed: {e}")))?;

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key.0));
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| AppError::Internal(format!("sync payload encryption failed: {e}")))?;

    Ok(SealedPayload {
        ciphertext_b64: B64.encode(&ciphertext),
        nonce_b64: B64.encode(nonce_bytes),
    })
}

/// Decrypt + deserialize a sealed payload. Errors if the key is wrong or the
/// ciphertext/nonce was tampered with — the GCM auth tag guarantees integrity.
pub fn open_snapshot(
    key: &SyncKey,
    payload: &SealedPayload,
) -> Result<PersonaWorkspaceSnapshot, AppError> {
    let ciphertext = B64
        .decode(&payload.ciphertext_b64)
        .map_err(|e| AppError::Validation(format!("invalid sealed ciphertext b64: {e}")))?;
    let nonce_bytes = B64
        .decode(&payload.nonce_b64)
        .map_err(|e| AppError::Validation(format!("invalid sealed nonce b64: {e}")))?;
    if nonce_bytes.len() != 12 {
        return Err(AppError::Validation(
            "sealed nonce must be 12 bytes".into(),
        ));
    }

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key.0));
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher.decrypt(nonce, ciphertext.as_ref()).map_err(|_| {
        AppError::Validation("sync payload decryption failed (wrong key or tampered)".into())
    })?;

    serde_json::from_slice(&plaintext)
        .map_err(|e| AppError::Internal(format!("sync snapshot deserialize failed: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> PersonaWorkspaceSnapshot {
        PersonaWorkspaceSnapshot {
            id: "p1".into(),
            name: "Researcher".into(),
            description: Some("digs".into()),
            system_prompt: "You are helpful.".into(),
            structured_prompt: None,
            icon: None,
            color: None,
            enabled: true,
            headless: false,
            max_concurrent: 1,
            timeout_ms: 30_000,
            max_turns: Some(5),
            max_budget_usd: None,
            parameters: None,
            template_category: None,
            gateway_exposure: "local_only".into(),
            cli_awareness_enabled: false,
            updated_at: "2026-05-24T10:00:00Z".into(),
        }
    }

    #[test]
    fn round_trip_under_shared_secret() {
        // Two independently-derived keys from the same pairing secret interop.
        let device_a = SyncKey::derive("group-secret-xyz");
        let device_b = SyncKey::derive("group-secret-xyz");
        let sealed = seal_snapshot(&device_a, &sample()).expect("seal");
        let opened = open_snapshot(&device_b, &sealed).expect("open");
        assert_eq!(opened, sample());
    }

    #[test]
    fn nonce_is_fresh_each_seal() {
        let key = SyncKey::derive("s");
        let a = seal_snapshot(&key, &sample()).expect("seal a");
        let b = seal_snapshot(&key, &sample()).expect("seal b");
        // Same plaintext + same key must NOT produce identical ciphertext —
        // a fixed nonce would be a catastrophic GCM misuse.
        assert_ne!(a.nonce_b64, b.nonce_b64);
        assert_ne!(a.ciphertext_b64, b.ciphertext_b64);
    }

    #[test]
    fn wrong_secret_cannot_open() {
        let sealed = seal_snapshot(&SyncKey::derive("right"), &sample()).expect("seal");
        assert!(open_snapshot(&SyncKey::derive("wrong"), &sealed).is_err());
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let key = SyncKey::derive("s");
        let mut sealed = seal_snapshot(&key, &sample()).expect("seal");
        // Flip the leading base64 char to corrupt the ciphertext/auth tag.
        let first = sealed.ciphertext_b64.remove(0);
        sealed
            .ciphertext_b64
            .insert(0, if first == 'A' { 'B' } else { 'A' });
        assert!(open_snapshot(&key, &sealed).is_err());
    }

    #[test]
    fn malformed_nonce_length_is_rejected() {
        let key = SyncKey::derive("s");
        let mut sealed = seal_snapshot(&key, &sample()).expect("seal");
        sealed.nonce_b64 = B64.encode([0u8; 8]); // wrong length
        assert!(open_snapshot(&key, &sealed).is_err());
    }
}
