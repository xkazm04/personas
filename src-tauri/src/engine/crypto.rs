use std::sync::OnceLock;
use std::{fs, path::PathBuf};

use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;

use crate::db::DbPool;
use crate::error::AppError;

static MASTER_KEY: OnceLock<[u8; 32]> = OnceLock::new();

/// Error type for crypto operations.
#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("Encryption failed: {0}")]
    Encrypt(String),
    #[error("Decryption failed: {0}")]
    Decrypt(String),
    #[error("Key management error: {0}")]
    KeyManagement(String),
    #[error("Base64 decode error: {0}")]
    Base64(#[from] base64::DecodeError),
}

impl From<CryptoError> for AppError {
    fn from(e: CryptoError) -> Self {
        AppError::Internal(e.to_string())
    }
}

// ---------------------------------------------------------------------------
// Key Management
// ---------------------------------------------------------------------------

/// Get or create the 32-byte master key. Cached in OnceLock after first call.
/// Always succeeds because we fall back to PBKDF2 if the OS keychain is unavailable.
pub fn get_master_key() -> Result<&'static [u8; 32], CryptoError> {
    Ok(MASTER_KEY.get_or_init(|| {
        match try_keychain() {
            Ok(key) => key,
            Err(e) => {
                tracing::warn!("Keychain unavailable ({}), using fallback key derivation", e);
                derive_fallback_key()
            }
        }
    }))
}

/// Try to load or create the master key via OS keychain.
fn try_keychain() -> Result<[u8; 32], CryptoError> {
    let entry = keyring::Entry::new("personas-desktop", "credential-master-key")
        .map_err(|e| CryptoError::KeyManagement(format!("Keychain entry error: {}", e)))?;

    // Try to get existing key
    match entry.get_password() {
        Ok(encoded) => {
            let bytes = B64.decode(&encoded)?;
            if bytes.len() != 32 {
                return Err(CryptoError::KeyManagement(format!(
                    "Stored key has wrong length: {} (expected 32)",
                    bytes.len()
                )));
            }
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            tracing::info!("Master key loaded from OS keychain");
            Ok(key)
        }
        Err(keyring::Error::NoEntry) => {
            // Keychain has no entry; try local persisted key first to avoid churn across rebuilds.
            if let Some(local_key) = load_local_fallback_key()? {
                if let Err(e) = entry.set_password(&B64.encode(local_key)) {
                    tracing::warn!("Failed to backfill keychain from local fallback key: {}", e);
                }
                tracing::info!("Master key loaded from local fallback key file");
                return Ok(local_key);
            }

            // Generate a new key, persist locally, and try keychain.
            let mut key = [0u8; 32];
            OsRng.fill_bytes(&mut key);

            save_local_fallback_key(&key)?;

            let encoded = B64.encode(key);
            match entry.set_password(&encoded) {
                Ok(_) => tracing::info!("New master key generated and stored in OS keychain"),
                Err(e) => tracing::warn!("Failed to store new master key in OS keychain: {}", e),
            }
            Ok(key)
        }
        Err(e) => Err(CryptoError::KeyManagement(format!(
            "Keychain access failed: {}",
            e
        ))),
    }
}

/// Generate or load a random fallback key when the OS keychain is unavailable
/// (e.g., in CI, headless environments, or tests).
fn derive_fallback_key() -> [u8; 32] {
    // Try to load a previously persisted random key first.
    if let Ok(Some(existing)) = load_local_fallback_key() {
        tracing::warn!(
            "OS keychain unavailable — using fallback key from local file. \
             Credential encryption is less protected than with a keychain."
        );
        return existing;
    }

    // Generate a new random key and persist it.
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);

    if let Err(e) = save_local_fallback_key(&key) {
        tracing::error!("Failed to persist fallback key to local file: {}", e);
    }

    tracing::warn!(
        "OS keychain unavailable — generated new random fallback key. \
         Credential encryption is less protected than with a keychain."
    );
    key
}

fn local_fallback_key_path() -> Option<PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    let dir = PathBuf::from(appdata).join("com.personas.desktop");
    Some(dir.join("master.key"))
}

fn load_local_fallback_key() -> Result<Option<[u8; 32]>, CryptoError> {
    let Some(path) = local_fallback_key_path() else {
        return Ok(None);
    };

    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(&path)
        .map_err(|e| CryptoError::KeyManagement(format!("Failed reading local key file: {}", e)))?;
    let bytes = B64.decode(raw.trim())?;
    if bytes.len() != 32 {
        return Err(CryptoError::KeyManagement(format!(
            "Local key has wrong length: {} (expected 32)",
            bytes.len()
        )));
    }

    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(Some(key))
}

fn save_local_fallback_key(key: &[u8; 32]) -> Result<(), CryptoError> {
    let Some(path) = local_fallback_key_path() else {
        return Ok(());
    };

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| CryptoError::KeyManagement(format!("Failed creating local key dir: {}", e)))?;
    }

    fs::write(&path, B64.encode(key))
        .map_err(|e| CryptoError::KeyManagement(format!("Failed writing local key file: {}", e)))?;
    Ok(())
}

/// Returns the key source: "keychain" or "fallback".
pub fn key_source() -> &'static str {
    // Try the keychain probe — if we can access it, the key came from there.
    let entry = keyring::Entry::new("personas-desktop", "credential-master-key");
    match entry {
        Ok(e) => match e.get_password() {
            Ok(_) => "keychain",
            Err(_) => "fallback",
        },
        Err(_) => "fallback",
    }
}

// ---------------------------------------------------------------------------
// Core Encryption / Decryption
// ---------------------------------------------------------------------------

/// Encrypt plaintext string, returning `(base64_ciphertext, base64_nonce)` for DB storage.
pub fn encrypt_for_db(plaintext: &str) -> Result<(String, String), CryptoError> {
    let key = get_master_key()?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| CryptoError::Encrypt(e.to_string()))?;

    Ok((B64.encode(ciphertext), B64.encode(nonce_bytes)))
}

/// Decrypt from DB columns (base64 ciphertext + base64 nonce) back to plaintext.
pub fn decrypt_from_db(ciphertext_b64: &str, nonce_b64: &str) -> Result<String, CryptoError> {
    let key = get_master_key()?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));

    let ciphertext = B64.decode(ciphertext_b64)?;
    let nonce_bytes = B64.decode(nonce_b64)?;

    if nonce_bytes.len() != 12 {
        return Err(CryptoError::Decrypt(format!(
            "Invalid nonce length: {} (expected 12)",
            nonce_bytes.len()
        )));
    }

    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|e| CryptoError::Decrypt(e.to_string()))?;

    String::from_utf8(plaintext)
        .map_err(|e| CryptoError::Decrypt(format!("Invalid UTF-8 in decrypted data: {}", e)))
}

/// Check if a credential row stores legacy plaintext data (iv is empty).
pub fn is_plaintext(iv: &str) -> bool {
    iv.is_empty()
}

// ---------------------------------------------------------------------------
// Migration: encrypt legacy plaintext credentials
// ---------------------------------------------------------------------------

/// Migrate plaintext credentials (iv == "") to encrypted form.
/// The entire migration runs inside a SQLite transaction so it either
/// fully completes or fully rolls back — no partial-state risk.
/// Returns `(migrated_count, failed_count)`.
pub fn migrate_plaintext_credentials(pool: &DbPool) -> Result<(usize, usize), CryptoError> {
    let mut conn = pool
        .get()
        .map_err(|e| CryptoError::KeyManagement(format!("DB pool error: {}", e)))?;

    // Collect plaintext rows before starting the transaction.
    let rows: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, encrypted_data FROM persona_credentials WHERE iv = ''")
            .map_err(|e| CryptoError::KeyManagement(format!("Query error: {}", e)))?;

        let result: Vec<(String, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| CryptoError::KeyManagement(format!("Query error: {}", e)))?
            .filter_map(|r| r.ok())
            .collect();
        result
    };

    if rows.is_empty() {
        return Ok((0, 0));
    }

    let tx = conn
        .transaction()
        .map_err(|e| CryptoError::KeyManagement(format!("Transaction begin error: {}", e)))?;

    let mut migrated = 0;

    for (id, plaintext_data) in &rows {
        let (ciphertext, nonce) = encrypt_for_db(plaintext_data).map_err(|e| {
            tracing::error!("Failed to encrypt credential {}: {}", id, e);
            e
        })?;

        tx.execute(
            "UPDATE persona_credentials SET encrypted_data = ?1, iv = ?2 WHERE id = ?3",
            rusqlite::params![ciphertext, nonce, id],
        )
        .map_err(|e| {
            tracing::error!("Failed to update credential {}: {}", id, e);
            CryptoError::KeyManagement(format!("Update error for credential {}: {}", id, e))
        })?;

        migrated += 1;
    }

    tx.commit()
        .map_err(|e| CryptoError::KeyManagement(format!("Transaction commit error: {}", e)))?;

    Ok((migrated, 0))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let plaintext = "super secret api key 12345";
        let (ciphertext, nonce) = encrypt_for_db(plaintext).unwrap();
        let decrypted = decrypt_from_db(&ciphertext, &nonce).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_encrypt_produces_unique_nonces() {
        let plaintext = "same input";
        let (ct1, n1) = encrypt_for_db(plaintext).unwrap();
        let (ct2, n2) = encrypt_for_db(plaintext).unwrap();
        // Same plaintext should produce different ciphertext due to random nonces
        assert_ne!(n1, n2);
        assert_ne!(ct1, ct2);
    }

    #[test]
    fn test_decrypt_wrong_nonce_fails() {
        let (ciphertext, _) = encrypt_for_db("test data").unwrap();
        let (_, wrong_nonce) = encrypt_for_db("other data").unwrap();
        let result = decrypt_from_db(&ciphertext, &wrong_nonce);
        assert!(result.is_err());
    }

    #[test]
    fn test_decrypt_tampered_ciphertext_fails() {
        let (mut ciphertext, nonce) = encrypt_for_db("test data").unwrap();
        // Tamper with the ciphertext
        let mut bytes = B64.decode(&ciphertext).unwrap();
        if let Some(b) = bytes.first_mut() {
            *b ^= 0xFF;
        }
        ciphertext = B64.encode(&bytes);
        let result = decrypt_from_db(&ciphertext, &nonce);
        assert!(result.is_err());
    }

    #[test]
    fn test_encrypt_empty_string() {
        let (ciphertext, nonce) = encrypt_for_db("").unwrap();
        let decrypted = decrypt_from_db(&ciphertext, &nonce).unwrap();
        assert_eq!(decrypted, "");
    }

    #[test]
    fn test_encrypt_unicode() {
        let plaintext = "API密钥: 🔑 résumé naïve";
        let (ciphertext, nonce) = encrypt_for_db(plaintext).unwrap();
        let decrypted = decrypt_from_db(&ciphertext, &nonce).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_is_plaintext() {
        assert!(is_plaintext(""));
        assert!(!is_plaintext("abc123=="));
        assert!(!is_plaintext("some-nonce-value"));
    }

    #[test]
    fn test_encrypt_for_db_roundtrip() {
        // Test with a JSON-like credential payload
        let json = r#"{"client_id":"abc","client_secret":"xyz","refresh_token":"tok_123"}"#;
        let (ct, nonce) = encrypt_for_db(json).unwrap();

        // Verify they're valid base64
        assert!(B64.decode(&ct).is_ok());
        assert!(B64.decode(&nonce).is_ok());

        // Nonce should decode to exactly 12 bytes
        assert_eq!(B64.decode(&nonce).unwrap().len(), 12);

        // Roundtrip
        let decrypted = decrypt_from_db(&ct, &nonce).unwrap();
        assert_eq!(decrypted, json);
    }
}
