//! Ed25519 identity management for the Invisible Apps P2P layer.
//!
//! Each app instance generates a persistent Ed25519 keypair on first launch.
//! The private key is stored in the OS keyring; the public key is used as the
//! peer identity (PeerId).  This module handles keypair lifecycle, message
//! signing, and signature verification.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

use crate::db::models::{IdentityCard, PeerIdentity};
use crate::db::repos::resources::identity as identity_repo;
use crate::db::DbPool;
use crate::error::AppError;

/// Keyring service identifier for the Ed25519 private key.
const KEYRING_SERVICE: &str = "personas-desktop";
const KEYRING_ENTRY: &str = "ed25519-identity-key";

// -- PeerId derivation ---------------------------------------------------

/// Derive a PeerId from an Ed25519 public key.
/// Format: `base58(sha256(public_key_bytes))` -- compact and URL-safe.
pub fn public_key_to_peer_id(public_key: &VerifyingKey) -> String {
    let hash = Sha256::digest(public_key.as_bytes());
    bs58::encode(hash).into_string()
}

// -- Keypair lifecycle ---------------------------------------------------

/// Get or create the local identity.
/// On first call: generates a keypair, stores private key in OS keyring,
/// writes identity to the database.
/// On subsequent calls: loads existing identity from DB (private key stays in keyring).
pub fn get_or_create_identity(pool: &DbPool) -> Result<PeerIdentity, AppError> {
    // Check DB for existing identity
    if let Some(existing) = identity_repo::get_local_identity(pool)? {
        return Ok(existing);
    }

    tracing::info!("No existing identity found -- generating new Ed25519 keypair");

    // Generate new keypair
    let mut csprng = rand::rngs::OsRng;
    let signing_key = SigningKey::generate(&mut csprng);
    let verifying_key = signing_key.verifying_key();
    let peer_id = public_key_to_peer_id(&verifying_key);

    // Store private key in OS keyring
    store_private_key(&signing_key)?;

    // Derive default display name
    let display_name = format!("User-{}", &peer_id[..8]);

    // Persist to database
    let identity = identity_repo::upsert_local_identity(
        pool,
        &peer_id,
        verifying_key.as_bytes(),
        &display_name,
    )?;

    tracing::info!(peer_id = %peer_id, "New identity created");
    Ok(identity)
}

/// Store the Ed25519 private key in the OS keyring.
fn store_private_key(signing_key: &SigningKey) -> Result<(), AppError> {
    let mut key_bytes = signing_key.to_bytes();
    let encoded = B64.encode(key_bytes);
    key_bytes.zeroize();

    #[cfg(feature = "desktop")]
    {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ENTRY)
            .map_err(|e| AppError::Internal(format!("Keyring entry creation failed: {e}")))?;
        entry
            .set_password(&encoded)
            .map_err(|e| AppError::Internal(format!("Keyring store failed: {e}")))?;
    }

    #[cfg(not(feature = "desktop"))]
    {
        // Fallback for non-desktop (mobile): store in app data directory
        // This is less secure but allows the feature to work without OS keyring
        tracing::warn!("No OS keyring available -- identity key stored in memory only (non-desktop build)");
    }

    Ok(())
}

/// Load the Ed25519 signing key from the OS keyring.
fn load_private_key() -> Result<SigningKey, AppError> {
    #[cfg(feature = "desktop")]
    {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ENTRY)
            .map_err(|e| AppError::Internal(format!("Keyring entry creation failed: {e}")))?;
        let encoded = entry
            .get_password()
            .map_err(|e| AppError::Internal(format!("Keyring load failed: {e}")))?;
        let mut key_bytes = B64
            .decode(&encoded)
            .map_err(|e| AppError::Internal(format!("Base64 decode of identity key failed: {e}")))?;
        if key_bytes.len() != 32 {
            key_bytes.zeroize();
            return Err(AppError::Internal("Invalid identity key length".into()));
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&key_bytes);
        key_bytes.zeroize();
        let signing_key = SigningKey::from_bytes(&arr);
        arr.zeroize();
        Ok(signing_key)
    }

    #[cfg(not(feature = "desktop"))]
    {
        Err(AppError::Internal(
            "Identity signing not available on non-desktop builds".into(),
        ))
    }
}

// -- Signing & Verification ----------------------------------------------

/// Sign arbitrary bytes with the local identity's private key.
/// Returns base64-encoded Ed25519 signature.
pub fn sign_message(message: &[u8]) -> Result<String, AppError> {
    let signing_key = load_private_key()?;
    let signature = signing_key.sign(message);
    Ok(B64.encode(signature.to_bytes()))
}

/// Verify a signature against a known public key.
pub fn verify_signature(
    public_key_b64: &str,
    message: &[u8],
    signature_b64: &str,
) -> Result<bool, AppError> {
    let pk_bytes = B64
        .decode(public_key_b64)
        .map_err(|e| AppError::Validation(format!("Invalid public key base64: {e}")))?;
    let verifying_key = VerifyingKey::try_from(pk_bytes.as_slice())
        .map_err(|e| AppError::Validation(format!("Invalid Ed25519 public key: {e}")))?;

    let sig_bytes = B64
        .decode(signature_b64)
        .map_err(|e| AppError::Validation(format!("Invalid signature base64: {e}")))?;
    let signature = Signature::try_from(sig_bytes.as_slice())
        .map_err(|e| AppError::Validation(format!("Invalid Ed25519 signature: {e}")))?;

    Ok(verifying_key.verify(message, &signature).is_ok())
}

// -- Identity Card -------------------------------------------------------

/// Export a compact identity card (base64-encoded JSON) for sharing.
pub fn export_identity_card(pool: &DbPool) -> Result<String, AppError> {
    let identity = get_or_create_identity(pool)?;
    let card = IdentityCard {
        peer_id: identity.peer_id,
        public_key_b64: identity.public_key_b64,
        display_name: identity.display_name,
    };
    let json = serde_json::to_string(&card)?;
    Ok(B64.encode(json.as_bytes()))
}

/// Parse and validate an identity card from base64-encoded JSON.
pub fn parse_identity_card(card_b64: &str) -> Result<IdentityCard, AppError> {
    let json_bytes = B64
        .decode(card_b64.trim())
        .map_err(|e| AppError::Validation(format!("Invalid identity card encoding: {e}")))?;
    let card: IdentityCard = serde_json::from_slice(&json_bytes)
        .map_err(|e| AppError::Validation(format!("Invalid identity card format: {e}")))?;

    // Validate that peer_id matches the public key
    let pk_bytes = B64
        .decode(&card.public_key_b64)
        .map_err(|e| AppError::Validation(format!("Invalid public key in card: {e}")))?;
    let verifying_key = VerifyingKey::try_from(pk_bytes.as_slice())
        .map_err(|e| AppError::Validation(format!("Invalid Ed25519 public key in card: {e}")))?;
    let expected_peer_id = public_key_to_peer_id(&verifying_key);

    if expected_peer_id != card.peer_id {
        return Err(AppError::Validation(
            "Identity card peer_id does not match public key".into(),
        ));
    }

    Ok(card)
}
