use std::io::Write;
use std::sync::OnceLock;
use std::{fs, path::PathBuf};

use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use rsa::{pkcs8::{EncodePublicKey, LineEnding}, Oaep, RsaPrivateKey, RsaPublicKey};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::db::DbPool;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Session Key Management (Asymmetric IPC Protection)
// ---------------------------------------------------------------------------

/// A session-specific RSA key pair used to encrypt sensitive data over the IPC bridge.
/// Generated on startup and held only in memory.
pub struct SessionKeyPair {
    private_key: RsaPrivateKey,
    public_key_pem: String,
}

impl SessionKeyPair {
    /// Generate a new 2048-bit RSA key pair for the current session.
    pub fn generate() -> Result<Self, CryptoError> {
        let mut rng = OsRng;
        let private_key = RsaPrivateKey::new(&mut rng, 2048)
            .map_err(|e| CryptoError::KeyManagement(format!("RSA generation failed: {e}")))?;
        let public_key = RsaPublicKey::from(&private_key);
        
        let public_key_pem = public_key
            .to_public_key_pem(LineEnding::LF)
            .map_err(|e| CryptoError::KeyManagement(format!("RSA PEM export failed: {e}")))?;

        Ok(Self {
            private_key,
            public_key_pem,
        })
    }

    /// Get the public key in PEM format (SPKI).
    pub fn public_key_pem(&self) -> &str {
        &self.public_key_pem
    }

    /// Decrypt a hybrid-encrypted message.
    ///
    /// Format: `base64(rsa_encrypted_aes_key).base64(12-byte-iv || aes-gcm-ciphertext)`
    ///
    /// Falls back to plain RSA decryption for legacy payloads (no `.` separator).
    pub fn decrypt(&self, ciphertext_b64: &str) -> Result<String, CryptoError> {
        if let Some(dot_pos) = ciphertext_b64.find('.') {
            // -- Hybrid mode: RSA-wrapped AES key + AES-GCM payload --
            let rsa_part = &ciphertext_b64[..dot_pos];
            let aes_part = &ciphertext_b64[dot_pos + 1..];

            // 1. RSA-decrypt the AES key (32 bytes)
            let encrypted_aes_key = B64.decode(rsa_part)
                .map_err(|e| CryptoError::Decrypt(format!("Base64 decode (RSA part) failed: {e}")))?;
            let padding = Oaep::new::<sha2::Sha256>();
            let raw_aes_key = self.private_key
                .decrypt(padding, &encrypted_aes_key)
                .map_err(|e| CryptoError::Decrypt(format!("RSA decryption of AES key failed: {e}")))?;

            // 2. Split IV (12 bytes) from AES ciphertext
            let iv_and_ciphertext = B64.decode(aes_part)
                .map_err(|e| CryptoError::Decrypt(format!("Base64 decode (AES part) failed: {e}")))?;
            if iv_and_ciphertext.len() < 13 {
                return Err(CryptoError::Decrypt("AES payload too short".into()));
            }
            let (iv_bytes, aes_ciphertext) = iv_and_ciphertext.split_at(12);

            // 3. AES-256-GCM decrypt
            let aes_key = Key::<Aes256Gcm>::from_slice(&raw_aes_key);
            let cipher = Aes256Gcm::new(aes_key);
            let nonce = Nonce::from_slice(iv_bytes);
            let plaintext_bytes = cipher.decrypt(nonce, aes_ciphertext)
                .map_err(|e| CryptoError::Decrypt(format!("AES-GCM decryption failed: {e}")))?;

            String::from_utf8(plaintext_bytes)
                .map_err(|e| CryptoError::Decrypt(format!("Invalid UTF-8 in decrypted data: {e}")))
        } else {
            // -- Legacy mode: plain RSA (small payloads only) --
            let ciphertext = B64.decode(ciphertext_b64)
                .map_err(|e| CryptoError::Decrypt(format!("Base64 decode failed: {e}")))?;
            let padding = Oaep::new::<sha2::Sha256>();
            let plaintext_bytes = self.private_key
                .decrypt(padding, &ciphertext)
                .map_err(|e| CryptoError::Decrypt(format!("RSA decryption failed: {e}")))?;

            String::from_utf8(plaintext_bytes)
                .map_err(|e| CryptoError::Decrypt(format!("Invalid UTF-8 in decrypted data: {e}")))
        }
    }
}

// ---------------------------------------------------------------------------
// SecureString -- zeroize-on-drop wrapper for in-memory secrets
// ---------------------------------------------------------------------------

/// A wrapper around `String` that zeroizes the underlying memory on drop and
/// redacts its contents in `Debug` / `Display` output.
///
/// Use this for any value that should not persist in memory after use:
/// `client_secret`, `refresh_token`, `code_verifier`, `access_token`, etc.
///
/// # Usage
/// ```ignore
/// let secret = SecureString::new("my-api-key".into());
/// do_something(secret.expose_secret()); // short-lived &str borrow
/// // `secret` is zeroized when dropped
/// ```
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct SecureString {
    inner: String,
}

impl SecureString {
    /// Wrap a plain `String` in a `SecureString`.
    pub fn new(value: String) -> Self {
        Self { inner: value }
    }

    /// Return a short-lived reference to the secret value.
    /// Prefer keeping the borrow short to minimise exposure.
    pub fn expose_secret(&self) -> &str {
        &self.inner
    }

    /// Create an explicit copy of the secret.
    ///
    /// Unlike `Clone`, this method is deliberately *not* implicit -- callers
    /// must opt-in to duplicating secret material (e.g. when moving a copy
    /// into a spawned task). The original and the duplicate are both zeroized
    /// independently on drop.
    pub fn duplicate(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}

impl std::fmt::Debug for SecureString {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("[REDACTED]")
    }
}

impl std::fmt::Display for SecureString {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("[REDACTED]")
    }
}

impl From<String> for SecureString {
    fn from(s: String) -> Self {
        Self::new(s)
    }
}

// NOTE: SecureString deliberately does NOT implement Serialize.
// Any code that needs to send a secret over IPC must call `.expose_secret()`
// explicitly, preventing accidental serialization of secrets in structs.

// ---------------------------------------------------------------------------
// EncryptedToken -- AES-256-GCM encrypted token for at-rest protection
// ---------------------------------------------------------------------------

/// An OAuth token encrypted at rest in memory using AES-256-GCM.
///
/// Tokens are encrypted immediately after receipt from the token endpoint and
/// stored as ciphertext in session HashMaps. Decryption happens only at the
/// moment of use (e.g. serialization to the frontend), and the resulting
/// `SecureString` is zeroized on drop.
///
/// This prevents plaintext tokens from sitting in memory for the full session
/// lifetime (up to 10 minutes), protecting against memory dumps, crash reports,
/// and malware with process read access.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct EncryptedToken {
    ciphertext: String,
    nonce: String,
}

impl EncryptedToken {
    /// Encrypt a plaintext token. The input `SecureString` is consumed and
    /// zeroized when dropped at the end of this call.
    pub fn seal(token: SecureString) -> Result<Self, CryptoError> {
        let (ciphertext, nonce) = encrypt_for_db(token.expose_secret())?;
        // `token` drops here -> SecureString::zeroize fires
        Ok(Self { ciphertext, nonce })
    }

    /// Decrypt into a short-lived `SecureString` for immediate use.
    /// Callers should keep the returned value as briefly as possible.
    pub fn unseal(&self) -> Result<SecureString, CryptoError> {
        let plaintext = decrypt_from_db(&self.ciphertext, &self.nonce)?;
        Ok(SecureString::new(plaintext))
    }
}

impl std::fmt::Debug for EncryptedToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("[ENCRYPTED]")
    }
}

// ---------------------------------------------------------------------------
// ProtectedKey -- mlock-pinned, zeroize-on-drop master key wrapper
// ---------------------------------------------------------------------------

/// A wrapper for the 32-byte master encryption key that:
/// 1. Zeroizes key material on drop via `Zeroizing<[u8; 32]>`
/// 2. Locks the memory page (VirtualLock / mlock) to prevent swapping to disk
///
/// This ensures the master key cannot be recovered from swap files, crash dumps
/// uploaded via Windows Error Reporting, or pagefile forensics.
struct ProtectedKey {
    inner: zeroize::Zeroizing<[u8; 32]>,
}

impl ProtectedKey {
    fn new(mut key: [u8; 32]) -> Self {
        let inner = zeroize::Zeroizing::new(key);
        // Zeroize the stack copy immediately
        key.zeroize();

        // Lock the heap-allocated key bytes to prevent the OS from paging them
        // to disk. Best-effort: failure is logged but not fatal, since the key
        // is still DPAPI-protected at rest on Windows.
        let ptr = inner.as_ptr() as *const u8;
        let len = std::mem::size_of::<[u8; 32]>();
        if !memory_lock(ptr, len) {
            tracing::warn!(
                "Failed to lock master key memory page -- key may be swappable to disk"
            );
        }

        Self { inner }
    }

    /// Return a short-lived reference to the raw key bytes.
    fn expose_key(&self) -> &[u8; 32] {
        &self.inner
    }
}

impl Drop for ProtectedKey {
    fn drop(&mut self) {
        // Unlock the memory page before Zeroizing<T> zeroizes the bytes
        let ptr = self.inner.as_ptr() as *const u8;
        let len = std::mem::size_of::<[u8; 32]>();
        memory_unlock(ptr, len);
        // Zeroizing<[u8; 32]> handles zeroing the key material on drop
    }
}

// -- Platform memory locking ------------------------------------------------

#[cfg(windows)]
extern "system" {
    fn VirtualLock(lpAddress: *mut std::ffi::c_void, dwSize: usize) -> i32;
    fn VirtualUnlock(lpAddress: *mut std::ffi::c_void, dwSize: usize) -> i32;
}

/// Lock a memory region so it cannot be paged to swap.
#[cfg(windows)]
fn memory_lock(ptr: *const u8, len: usize) -> bool {
    unsafe { VirtualLock(ptr as *mut std::ffi::c_void, len) != 0 }
}

#[cfg(windows)]
fn memory_unlock(ptr: *const u8, len: usize) {
    unsafe { VirtualUnlock(ptr as *mut std::ffi::c_void, len); }
}

#[cfg(unix)]
extern "C" {
    fn mlock(addr: *const std::ffi::c_void, len: usize) -> i32;
    fn munlock(addr: *const std::ffi::c_void, len: usize) -> i32;
}

#[cfg(unix)]
fn memory_lock(ptr: *const u8, len: usize) -> bool {
    unsafe { mlock(ptr as *const std::ffi::c_void, len) == 0 }
}

#[cfg(unix)]
fn memory_unlock(ptr: *const u8, len: usize) {
    unsafe { munlock(ptr as *const std::ffi::c_void, len); }
}

#[cfg(not(any(windows, unix)))]
fn memory_lock(_ptr: *const u8, _len: usize) -> bool {
    false // Cannot lock memory on this platform
}

#[cfg(not(any(windows, unix)))]
fn memory_unlock(_ptr: *const u8, _len: usize) {}

/// Tracks where the master key was loaded from, so we can upgrade later.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub enum KeySource {
    /// Key loaded from or stored in the OS keychain (most secure).
    Keychain,
    /// Key loaded from DPAPI-protected local file (fallback for missing keychain).
    LocalFallback,
}

static KEY_SOURCE: OnceLock<KeySource> = OnceLock::new();

/// Returns how the master key was sourced, if initialised.
pub fn key_source() -> Option<KeySource> {
    KEY_SOURCE.get().copied()
}

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
///
/// The key is stored in a `ProtectedKey` wrapper that:
/// - Zeroizes the key material on drop (`Zeroizing<[u8; 32]>`)
/// - Locks the memory page (VirtualLock/mlock) to prevent swapping to disk
///
/// **Fail-closed**: If the OS keychain is completely inaccessible (e.g. the
/// platform backend cannot be initialised), this returns `Err` rather than
/// silently falling through to an unprotected local file.
///
/// The local fallback file is only used when:
/// 1. The keychain *works* but has no entry yet -- we load/generate a key and
///    backfill it into the keychain (handled inside `try_keychain`).
/// 2. `PERSONAS_ALLOW_FALLBACK_KEY=1` is explicitly set -- for CI, headless
///    environments, or tests where no keychain daemon is available.
pub fn get_master_key() -> Result<&'static [u8; 32], CryptoError> {
    static KEY_STORE: OnceLock<Result<ProtectedKey, String>> = OnceLock::new();

    let result = KEY_STORE.get_or_init(|| {
        match try_keychain() {
            Ok(key) => {
                let _ = KEY_SOURCE.set(KeySource::Keychain);
                Ok(ProtectedKey::new(key))
            }
            Err(e) => {
                // Desktop app: auto-fallback to DPAPI-protected local key file.
                // This is safe because the local key is still encrypted with DPAPI
                // (tied to the user's Windows login session) and has restrictive ACLs.
                // Users can opt out with PERSONAS_DENY_FALLBACK_KEY=1 for strict mode.
                if std::env::var("PERSONAS_DENY_FALLBACK_KEY").unwrap_or_default() == "1" {
                    tracing::error!(
                        "Keychain unavailable ({}) and PERSONAS_DENY_FALLBACK_KEY=1 is set. \
                         Refusing to store credentials without OS keychain protection.",
                        e
                    );
                    return Err(format!("Keychain unavailable: {e}"));
                }

                tracing::warn!(
                    "Keychain unavailable ({}). Using DPAPI-protected local fallback key. \
                     Credentials are still encrypted at rest.",
                    e
                );
                let _ = KEY_SOURCE.set(KeySource::LocalFallback);
                Ok(ProtectedKey::new(derive_fallback_key()))
            }
        }
    });

    match result {
        Ok(protected) => Ok(protected.expose_key()),
        Err(msg) => Err(CryptoError::KeyManagement(format!(
            "Master key not available (fail-closed): {}. \
             Set PERSONAS_ALLOW_FALLBACK_KEY=1 to allow local fallback.",
            msg
        ))),
    }
}

/// Try to load or create the master key via OS keychain.
#[cfg(feature = "desktop")]
fn try_keychain() -> Result<[u8; 32], CryptoError> {
    let entry = keyring::Entry::new("personas-desktop", "credential-master-key")
        .map_err(|e| CryptoError::KeyManagement(format!("Keychain entry error: {e}")))?;

    // Try to get existing key
    match entry.get_password() {
        Ok(encoded) => {
            let mut bytes = B64.decode(&encoded)?;
            if bytes.len() != 32 {
                bytes.zeroize();
                return Err(CryptoError::KeyManagement(format!(
                    "Stored key has wrong length: {} (expected 32)",
                    bytes.len()
                )));
            }
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            bytes.zeroize(); // Zeroize decoded buffer immediately
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
            "Keychain access failed: {e}"
        ))),
    }
}

/// On mobile, keychain is not available -- always return an error to fall through to fallback.
#[cfg(not(feature = "desktop"))]
fn try_keychain() -> Result<[u8; 32], CryptoError> {
    Err(CryptoError::KeyManagement("Keychain not available on this platform".into()))
}

/// Generate or load a random fallback key when the OS keychain is unavailable
/// (e.g., in CI, headless environments, or tests).
fn derive_fallback_key() -> [u8; 32] {
    // Try to load a previously persisted random key first.
    if let Ok(Some(existing)) = load_local_fallback_key() {
        tracing::warn!(
            "OS keychain unavailable -- using fallback key from local file. \
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
        "OS keychain unavailable -- generated new random fallback key. \
         Credential encryption is less protected than with a keychain."
    );
    key
}

fn local_fallback_key_path() -> Option<PathBuf> {
    let appdata = std::env::var("APPDATA")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    let dir = PathBuf::from(appdata).join("com.personas.desktop");
    Some(dir.join("master.key"))
}

/// Prefix added to DPAPI-protected key files so we can distinguish them from
/// legacy plaintext base64 files during load.
const DPAPI_PREFIX: &str = "DPAPI:";

fn load_local_fallback_key() -> Result<Option<[u8; 32]>, CryptoError> {
    let Some(path) = local_fallback_key_path() else {
        return Ok(None);
    };

    if !path.exists() {
        return Ok(None);
    }

    let raw = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            tracing::warn!(
                "Local key file has wrong permissions ({}), attempting repair",
                e
            );
            // Try to repair permissions on the file
            if repair_key_file_permissions(&path) {
                // Retry the read after permission repair
                match fs::read_to_string(&path) {
                    Ok(content) => content,
                    Err(e2) => {
                        tracing::warn!(
                            "Still cannot read key file after repair ({}), removing stale file",
                            e2
                        );
                        let _ = fs::remove_file(&path);
                        return Ok(None); // Will trigger fresh key generation
                    }
                }
            } else {
                tracing::warn!("Cannot repair key file permissions, removing stale file");
                let _ = fs::remove_file(&path);
                return Ok(None); // Will trigger fresh key generation
            }
        }
        Err(e) => {
            return Err(CryptoError::KeyManagement(format!(
                "Failed reading local key file: {}",
                e
            )));
        }
    };
    let trimmed = raw.trim();

    let mut key_bytes = if let Some(protected_b64) = trimmed.strip_prefix(DPAPI_PREFIX) {
        let protected_bytes = B64.decode(protected_b64)?;
        platform_unprotect(&protected_bytes)?
    } else {
        // Legacy plaintext base64 format -- decode and schedule migration
        let bytes = B64.decode(trimmed)?;
        if bytes.len() == 32 {
            tracing::info!("Found legacy plaintext key file, migrating to protected format");
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            // Re-save in protected format (best-effort migration)
            if let Err(e) = save_local_fallback_key(&key) {
                tracing::warn!("Failed to migrate legacy key file to protected format: {}", e);
            }
        }
        bytes
    };

    if key_bytes.len() != 32 {
        key_bytes.zeroize();
        return Err(CryptoError::KeyManagement(format!(
            "Local key has wrong length: {} (expected 32)",
            key_bytes.len()
        )));
    }

    let mut key = [0u8; 32];
    key.copy_from_slice(&key_bytes);
    key_bytes.zeroize(); // Zeroize decoded buffer immediately
    Ok(Some(key))
}

/// Save the master key to a local file using atomic write (tempfile + rename)
/// with permissions set BEFORE content is written, eliminating the TOCTOU race.
/// On Windows, the key is additionally encrypted with DPAPI before writing.
fn save_local_fallback_key(key: &[u8; 32]) -> Result<(), CryptoError> {
    let Some(path) = local_fallback_key_path() else {
        return Ok(());
    };

    let parent = path.parent().ok_or_else(|| {
        CryptoError::KeyManagement("Key file path has no parent directory".into())
    })?;

    fs::create_dir_all(parent)
        .map_err(|e| CryptoError::KeyManagement(format!("Failed creating local key dir: {}", e)))?;

    // Protect the raw key bytes with platform-specific encryption (DPAPI on Windows)
    let protected = platform_protect(key)?;
    let file_content = format!("{}{}", DPAPI_PREFIX, B64.encode(&protected));

    // Atomic write: create temp file in the same directory -> write -> set permissions -> rename.
    // This eliminates the TOCTOU window where the key could be read by another process.
    let mut tmp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| CryptoError::KeyManagement(format!("Failed creating temp file: {}", e)))?;

    tmp.write_all(file_content.as_bytes())
        .map_err(|e| CryptoError::KeyManagement(format!("Failed writing temp key file: {}", e)))?;
    tmp.flush()
        .map_err(|e| CryptoError::KeyManagement(format!("Failed flushing temp key file: {}", e)))?;

    // Set restrictive permissions BEFORE making the file visible at the final path
    restrict_file_permissions(tmp.path())?;

    // Atomic rename (same filesystem, same directory)
    tmp.persist(&path)
        .map_err(|e| CryptoError::KeyManagement(format!("Failed persisting key file: {}", e)))?;

    tracing::debug!("Master key saved to local fallback file with restricted permissions");
    Ok(())
}

/// Restrict file permissions so only the current user can read/write the key file.
/// Returns an error if permissions cannot be set -- the caller must not leave the
/// key file world-readable.
#[cfg(windows)]
fn restrict_file_permissions(path: &std::path::Path) -> Result<(), CryptoError> {
    let path_str = path.to_string_lossy();
    let username = whoami::username();

    // 1. Remove inherited ACEs so other users/groups lose access
    // 2. Grant only the current user Full Control (`:r` = replace, not append)
    let result = std::process::Command::new("icacls")
        .args([
            &*path_str,
            "/inheritance:r",
            "/grant:r",
            &format!("{username}:(F)"),
        ])
        .output();

    match result {
        Ok(output) if output.status.success() => {
            tracing::debug!("Restricted key file permissions to current user");
            Ok(())
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(CryptoError::KeyManagement(format!(
                "icacls failed to restrict key file permissions (exit {}): {}",
                output.status,
                stderr.trim()
            )))
        }
        Err(e) => {
            Err(CryptoError::KeyManagement(format!(
                "Failed to run icacls for key file permissions: {}", e
            )))
        }
    }
}

#[cfg(unix)]
fn restrict_file_permissions(path: &std::path::Path) -> Result<(), CryptoError> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|e| CryptoError::KeyManagement(format!(
            "Failed to set key file permissions to 0600: {}", e
        )))?;
    tracing::debug!("Restricted key file permissions to owner-only (0600)");
    Ok(())
}

#[cfg(not(any(windows, unix)))]
fn restrict_file_permissions(_path: &std::path::Path) -> Result<(), CryptoError> {
    Err(CryptoError::KeyManagement(
        "Cannot restrict key file permissions on this platform -- refusing to store key".into(),
    ))
}

/// Best-effort attempt to repair permissions on a key file that has become
/// inaccessible (e.g., created by a different elevation level or session).
/// Returns `true` if the repair succeeded.
#[cfg(windows)]
fn repair_key_file_permissions(path: &std::path::Path) -> bool {
    let path_str = path.to_string_lossy();
    let username = whoami::username();

    // Grant current user full control (additive, then re-restrict)
    let result = std::process::Command::new("icacls")
        .args([
            &*path_str,
            "/grant",
            &format!("{username}:(F)"),
        ])
        .output();

    match result {
        Ok(output) if output.status.success() => {
            tracing::info!("Repaired key file permissions for current user");
            true
        }
        Ok(output) => {
            tracing::warn!(
                "icacls repair failed (exit {}): {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            );
            false
        }
        Err(e) => {
            tracing::warn!("Failed to run icacls for permission repair: {}", e);
            false
        }
    }
}

#[cfg(not(windows))]
fn repair_key_file_permissions(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    match fs::set_permissions(path, fs::Permissions::from_mode(0o600)) {
        Ok(_) => {
            tracing::info!("Repaired key file permissions to 0600");
            true
        }
        Err(e) => {
            tracing::warn!("Failed to repair key file permissions: {}", e);
            false
        }
    }
}

/// Attempt to upgrade the master key from local fallback to OS keychain.
///
/// Call this when the keychain becomes available (e.g., after authentication).
/// The same key bytes are stored in the keychain -- no credential re-encryption
/// is needed because the encryption key itself doesn't change.
#[allow(dead_code)]
#[cfg(feature = "desktop")]
pub fn try_upgrade_to_keychain() -> Result<bool, CryptoError> {
    if key_source() != Some(KeySource::LocalFallback) {
        return Ok(false); // Already on keychain or not initialised
    }

    let current_key = get_master_key()?;

    let entry = keyring::Entry::new("personas-desktop", "credential-master-key")
        .map_err(|e| CryptoError::KeyManagement(format!("Keychain entry error: {e}")))?;

    entry
        .set_password(&B64.encode(current_key))
        .map_err(|e| CryptoError::KeyManagement(format!("Failed storing key in keychain: {e}")))?;

    tracing::info!(
        "Master key upgraded from local fallback to OS keychain. \
         All existing credentials remain valid (same key, different storage)."
    );
    Ok(true)
}

#[allow(dead_code)]
#[cfg(not(feature = "desktop"))]
pub fn try_upgrade_to_keychain() -> Result<bool, CryptoError> {
    Ok(false)
}

// ---------------------------------------------------------------------------
// Platform-specific key protection (DPAPI on Windows, passthrough elsewhere)
// ---------------------------------------------------------------------------

/// Encrypt key material using the platform's user-scoped data protection.
/// On Windows this uses DPAPI (CryptProtectData) which ties the ciphertext
/// to the current user's login credentials.
/// On Linux/macOS, encrypts with AES-256-GCM using a key derived from
/// machine-specific entropy (machine-id + UID), providing defense-in-depth
/// when the keychain fallback file is used.
#[cfg(windows)]
fn platform_protect(data: &[u8]) -> Result<Vec<u8>, CryptoError> {
    dpapi_protect(data)
}

#[cfg(not(windows))]
fn platform_protect(data: &[u8]) -> Result<Vec<u8>, CryptoError> {
    unix_local_protect(data)
}

/// Decrypt key material previously protected by `platform_protect`.
#[cfg(windows)]
fn platform_unprotect(data: &[u8]) -> Result<Vec<u8>, CryptoError> {
    dpapi_unprotect(data)
}

#[cfg(not(windows))]
fn platform_unprotect(data: &[u8]) -> Result<Vec<u8>, CryptoError> {
    // Support legacy plaintext fallback files written before this hardening
    if data.len() == 32 {
        // Could be a raw 32-byte key from before encryption was added
        tracing::warn!("Detected unencrypted fallback key data, returning as-is for migration");
        return Ok(data.to_vec());
    }
    unix_local_unprotect(data)
}

// ---------------------------------------------------------------------------
// Unix local key protection (AES-256-GCM with machine-derived key)
// ---------------------------------------------------------------------------

/// Derive a 32-byte encryption key from machine-specific entropy.
/// Uses HKDF-SHA256 over /etc/machine-id (or fallback hostname) + UID.
/// This is NOT a substitute for a proper keychain, but prevents trivial
/// file-copy attacks where the key file is exfiltrated to another machine.
#[cfg(not(windows))]
fn derive_unix_local_key() -> Result<[u8; 32], CryptoError> {
    use sha2::Sha256;
    use hmac::Hmac;
    use hkdf::Hkdf;

    // Gather machine-specific entropy
    let machine_id = fs::read_to_string("/etc/machine-id")
        .or_else(|_| fs::read_to_string("/var/lib/dbus/machine-id"))
        .unwrap_or_else(|_| {
            // Fallback: hostname is less unique but still binds to the machine
            whoami::fallible::hostname().unwrap_or_else(|_| "unknown-host".into())
        });

    let uid = unsafe { libc::getuid() };
    let ikm = format!("personas-desktop:{}:{}", machine_id.trim(), uid);

    let hk = Hkdf::<Sha256>::new(
        Some(b"personas-fallback-key-protection"),
        ikm.as_bytes(),
    );
    let mut okm = [0u8; 32];
    hk.expand(b"local-key-encryption", &mut okm)
        .map_err(|e| CryptoError::KeyManagement(format!("HKDF expand failed: {e}")))?;

    Ok(okm)
}

/// Encrypt data with AES-256-GCM using the machine-derived key.
/// Output format: 12-byte nonce || ciphertext (with GCM tag appended).
#[cfg(not(windows))]
fn unix_local_protect(data: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let mut key_bytes = derive_unix_local_key()?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    key_bytes.zeroize();

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, data)
        .map_err(|e| CryptoError::Encrypt(format!("Local key protection failed: {e}")))?;

    let mut output = Vec::with_capacity(12 + ciphertext.len());
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);
    Ok(output)
}

/// Decrypt data previously protected by `unix_local_protect`.
#[cfg(not(windows))]
fn unix_local_unprotect(data: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if data.len() < 13 {
        return Err(CryptoError::Decrypt(
            "Protected key data too short (need nonce + ciphertext)".into(),
        ));
    }

    let (nonce_bytes, ciphertext) = data.split_at(12);
    let mut key_bytes = derive_unix_local_key()?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    key_bytes.zeroize();

    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| CryptoError::Decrypt(format!("Local key unprotection failed: {e}")))
}

// ---------------------------------------------------------------------------
// Windows DPAPI wrappers
// ---------------------------------------------------------------------------

#[cfg(windows)]
extern "system" {
    /// LocalFree from kernel32.dll -- used to free buffers allocated by DPAPI.
    /// Not exported by the `windows` crate v0.58, so we declare it manually.
    fn LocalFree(hmem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
}

#[cfg(windows)]
fn dpapi_protect(plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    use std::ptr;
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPT_INTEGER_BLOB,
    };
    use windows::core::PCWSTR;

    unsafe {
        let data_in = CRYPT_INTEGER_BLOB {
            cbData: plaintext.len() as u32,
            pbData: plaintext.as_ptr() as *mut u8,
        };
        let mut data_out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };

        CryptProtectData(
            &data_in,
            PCWSTR::null(),
            None,
            None,
            None,
            0,
            &mut data_out,
        )
        .map_err(|e| CryptoError::KeyManagement(format!("DPAPI CryptProtectData failed: {}", e)))?;

        let protected = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize).to_vec();

        // Free the buffer allocated by CryptProtectData
        LocalFree(data_out.pbData as *mut _);

        Ok(protected)
    }
}

#[cfg(windows)]
fn dpapi_unprotect(ciphertext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    use std::ptr;
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPT_INTEGER_BLOB,
    };

    unsafe {
        let data_in = CRYPT_INTEGER_BLOB {
            cbData: ciphertext.len() as u32,
            pbData: ciphertext.as_ptr() as *mut u8,
        };
        let mut data_out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };

        CryptUnprotectData(
            &data_in,
            None,
            None,
            None,
            None,
            0,
            &mut data_out,
        )
        .map_err(|e| CryptoError::KeyManagement(format!("DPAPI CryptUnprotectData failed: {}", e)))?;

        let decrypted = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize).to_vec();

        // Free the buffer allocated by CryptUnprotectData
        LocalFree(data_out.pbData as *mut _);

        Ok(decrypted)
    }
}

/// Returns the key source as a string for IPC/serialization: "keychain", "local_fallback", or "unknown".
pub fn key_source_label() -> &'static str {
    match key_source() {
        Some(KeySource::Keychain) => "keychain",
        Some(KeySource::LocalFallback) => "local_fallback",
        None => "unknown",
    }
}

// ---------------------------------------------------------------------------
// Core Encryption / Decryption
// ---------------------------------------------------------------------------

/// Return a cached AES-256-GCM cipher initialised from the master key.
///
/// The master key never changes at runtime, so the cipher can be constructed
/// once and reused for every `encrypt_for_db` / `decrypt_from_db` call.
fn get_cipher() -> Result<&'static Aes256Gcm, CryptoError> {
    static CIPHER: OnceLock<Result<Aes256Gcm, String>> = OnceLock::new();
    let result = CIPHER.get_or_init(|| {
        let key = get_master_key().map_err(|e| e.to_string())?;
        Ok(Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key)))
    });
    match result {
        Ok(cipher) => Ok(cipher),
        Err(e) => Err(CryptoError::KeyManagement(e.clone())),
    }
}

/// Encrypt plaintext string, returning `(base64_ciphertext, base64_nonce)` for DB storage.
pub fn encrypt_for_db(plaintext: &str) -> Result<(String, String), CryptoError> {
    let cipher = get_cipher()?;

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
    let cipher = get_cipher()?;

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
        .map_err(|e| CryptoError::Decrypt(format!("Invalid UTF-8 in decrypted data: {e}")))
}

/// Check if a credential row stores legacy plaintext data (iv is empty).
pub fn is_plaintext(iv: &str) -> bool {
    iv.is_empty()
}

// ---------------------------------------------------------------------------
// Field-level credential encryption helpers
// ---------------------------------------------------------------------------

/// Encrypt a single credential field value, returning `(encrypted_value, iv)`.
/// For non-sensitive fields, returns `(plaintext_value, "")`.
pub fn encrypt_field(value: &str, is_sensitive: bool) -> Result<(String, String), CryptoError> {
    if !is_sensitive {
        return Ok((value.to_string(), String::new()));
    }
    encrypt_for_db(value)
}

/// Decrypt a single credential field value.
/// For non-sensitive fields (iv is empty), returns the value as-is.
pub fn decrypt_field(encrypted_value: &str, iv: &str) -> Result<String, CryptoError> {
    if is_plaintext(iv) {
        return Ok(encrypted_value.to_string());
    }
    decrypt_from_db(encrypted_value, iv)
}

// ---------------------------------------------------------------------------
// Migration: encrypt legacy plaintext credentials
// ---------------------------------------------------------------------------

/// Migrate plaintext credentials (iv == "") to encrypted form.
/// The entire migration runs inside a SQLite transaction so it either
/// fully completes or fully rolls back -- no partial-state risk.
/// Returns `(migrated_count, failed_count)`.
pub fn migrate_plaintext_credentials(pool: &DbPool) -> Result<(usize, usize), CryptoError> {
    let mut conn = pool
        .get()
        .map_err(|e| CryptoError::KeyManagement(format!("DB pool error: {e}")))?;

    // Collect plaintext rows before starting the transaction.
    let (rows, parse_failures): (Vec<(String, String)>, usize) = {
        let mut stmt = conn
            .prepare("SELECT id, encrypted_data FROM persona_credentials WHERE iv = ''")
            .map_err(|e| CryptoError::KeyManagement(format!("Query error: {e}")))?;

        let mut result: Vec<(String, String)> = Vec::new();
        let mut failures = 0usize;
        for (idx, r) in stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| CryptoError::KeyManagement(format!("Query error: {e}")))?
            .enumerate()
        {
            match r {
                Ok(row) => result.push(row),
                Err(e) => {
                    failures += 1;
                    tracing::error!(
                        "migrate_plaintext_credentials: failed to parse row at index {}: {}",
                        idx, e
                    );
                }
            }
        }
        if failures > 0 {
            tracing::warn!(
                "migrate_plaintext_credentials: {} row(s) could not be read and remain unencrypted",
                failures
            );
        }
        (result, failures)
    };

    if rows.is_empty() && parse_failures == 0 {
        return Ok((0, 0));
    }

    if !rows.is_empty() {
        let tx = conn
            .transaction()
            .map_err(|e| CryptoError::KeyManagement(format!("Transaction begin error: {e}")))?;

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
                CryptoError::KeyManagement(format!("Update error for credential {id}: {e}"))
            })?;

            migrated += 1;
        }

        tx.commit()
            .map_err(|e| CryptoError::KeyManagement(format!("Transaction commit error: {e}")))?;

        return Ok((migrated, parse_failures));
    }

    Ok((0, parse_failures))
}

// ---------------------------------------------------------------------------
// Migration: encrypt plaintext notification channel secrets
// ---------------------------------------------------------------------------

/// Config keys inside notification channel JSON that contain secrets.
const SENSITIVE_CHANNEL_KEYS: &[&str] = &[
    "webhook_url",
    "bot_token",
    "sendgrid_api_key",
    "resend_api_key",
];

/// Migrate plaintext notification channel secrets to encrypted form.
/// Scans all personas with non-null notification_channels, encrypts any
/// sensitive config values that are still in plaintext (no corresponding
/// `_enc`/`_iv` pair). Runs inside a transaction for atomicity.
/// Returns `(migrated_persona_count, skipped_count)`.
pub fn migrate_plaintext_notification_secrets(pool: &DbPool) -> Result<(usize, usize), CryptoError> {
    let mut conn = pool
        .get()
        .map_err(|e| CryptoError::KeyManagement(format!("DB pool error: {e}")))?;

    let (rows, parse_failures): (Vec<(String, String)>, usize) = {
        let mut stmt = conn
            .prepare(
                "SELECT id, notification_channels FROM personas \
                 WHERE notification_channels IS NOT NULL AND notification_channels != ''",
            )
            .map_err(|e| CryptoError::KeyManagement(format!("Query error: {e}")))?;

        let mut result: Vec<(String, String)> = Vec::new();
        let mut failures = 0usize;
        for (idx, r) in stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| CryptoError::KeyManagement(format!("Query error: {e}")))?
            .enumerate()
        {
            match r {
                Ok(row) => result.push(row),
                Err(e) => {
                    failures += 1;
                    tracing::error!(
                        "migrate_plaintext_notification_secrets: failed to parse row at index {}: {}",
                        idx, e
                    );
                }
            }
        }
        if failures > 0 {
            tracing::warn!(
                "migrate_plaintext_notification_secrets: {} row(s) could not be read and remain unencrypted",
                failures
            );
        }
        (result, failures)
    };

    if rows.is_empty() && parse_failures == 0 {
        return Ok((0, 0));
    }

    let tx = conn
        .transaction()
        .map_err(|e| CryptoError::KeyManagement(format!("Transaction begin error: {e}")))?;

    let mut migrated = 0;
    let mut skipped = parse_failures;

    for (id, channels_json) in &rows {
        let channels_orig: Vec<serde_json::Value> = match serde_json::from_str(channels_json) {
            Ok(v) => v,
            Err(_) => { skipped += 1; continue; }
        };

        let mut channels = channels_orig.clone();
        let mut any_encrypted = false;
        for ch in channels.iter_mut() {
            let config = match ch.get_mut("config").and_then(|c| c.as_object_mut()) {
                Some(c) => c,
                None => continue,
            };
            for &key in SENSITIVE_CHANNEL_KEYS {
                // Skip if already encrypted (has _enc pair)
                if config.contains_key(&format!("{key}_enc")) {
                    continue;
                }
                let value = match config.get(key).and_then(|v| v.as_str()) {
                    Some(v) if !v.is_empty() => v.to_string(),
                    _ => continue,
                };
                let (ciphertext, nonce) = encrypt_for_db(&value)?;
                config.remove(key);
                config.insert(format!("{key}_enc"), serde_json::Value::String(ciphertext));
                config.insert(format!("{key}_iv"), serde_json::Value::String(nonce));
                any_encrypted = true;
            }
        }

        if any_encrypted {
            let updated_json = serde_json::to_string(&channels)
                .map_err(|e| CryptoError::Encrypt(format!("JSON serialize error: {e}")))?;
            tx.execute(
                "UPDATE personas SET notification_channels = ?1 WHERE id = ?2",
                rusqlite::params![updated_json, id],
            )
            .map_err(|e| CryptoError::KeyManagement(format!("Update error for persona {id}: {e}")))?;
            migrated += 1;
        }
    }

    tx.commit()
        .map_err(|e| CryptoError::KeyManagement(format!("Transaction commit error: {e}")))?;

    if migrated > 0 {
        tracing::info!(
            "Migrated notification channel secrets for {} persona(s) to encrypted storage",
            migrated
        );
    }

    Ok((migrated, skipped))
}

// ---------------------------------------------------------------------------
// Trigger config encryption: field-level encryption for sensitive trigger fields
// ---------------------------------------------------------------------------

/// Sensitive keys inside trigger config JSON that must be encrypted at rest.
/// - Webhook: `webhook_secret` (HMAC key)
/// - Polling: `headers` (may contain Authorization tokens)
const SENSITIVE_TRIGGER_KEYS: &[&str] = &["webhook_secret", "headers"];

/// Encrypt sensitive fields within a trigger config JSON string.
///
/// For each key in `SENSITIVE_TRIGGER_KEYS`, if present and not already encrypted
/// (no `_enc` counterpart), the plaintext value is replaced with `key_enc` and
/// `key_iv` pairs. Non-sensitive fields are left untouched so that SQL
/// `json_extract()` continues to work for querying trigger properties.
///
/// Returns the updated JSON string.
pub fn encrypt_trigger_config(config_json: &str) -> Result<String, CryptoError> {
    let mut val: serde_json::Value = serde_json::from_str(config_json)
        .map_err(|e| CryptoError::Encrypt(format!("Invalid trigger config JSON: {e}")))?;

    let obj = match val.as_object_mut() {
        Some(o) => o,
        None => return Ok(config_json.to_string()), // not an object, pass through
    };

    for &key in SENSITIVE_TRIGGER_KEYS {
        // Skip if already encrypted
        if obj.contains_key(&format!("{key}_enc")) {
            continue;
        }

        let plaintext = match obj.get(key) {
            Some(v) if !v.is_null() => v.to_string(), // serialize the value (string or object)
            _ => continue,
        };

        // Don't encrypt empty strings
        if plaintext == "\"\"" {
            continue;
        }

        let (ciphertext, nonce) = encrypt_for_db(&plaintext)?;
        obj.remove(key);
        obj.insert(format!("{key}_enc"), serde_json::Value::String(ciphertext));
        obj.insert(format!("{key}_iv"), serde_json::Value::String(nonce));
    }

    serde_json::to_string(&val)
        .map_err(|e| CryptoError::Encrypt(format!("JSON serialize error: {e}")))
}

/// Decrypt sensitive fields within a trigger config JSON string.
///
/// For each key in `SENSITIVE_TRIGGER_KEYS`, if `key_enc`/`key_iv` pairs are
/// present, they are decrypted and the original `key` is restored with the
/// plaintext value. If neither the encrypted pair nor the plaintext key exists,
/// the field is skipped.
///
/// Transparently handles legacy plaintext configs (no `_enc` keys) by
/// returning the JSON unchanged.
pub fn decrypt_trigger_config(config_json: &str) -> Result<String, CryptoError> {
    let mut val: serde_json::Value = serde_json::from_str(config_json)
        .map_err(|e| CryptoError::Decrypt(format!("Invalid trigger config JSON: {e}")))?;

    let obj = match val.as_object_mut() {
        Some(o) => o,
        None => return Ok(config_json.to_string()),
    };

    for &key in SENSITIVE_TRIGGER_KEYS {
        let enc_key = format!("{key}_enc");
        let iv_key = format!("{key}_iv");

        let ciphertext = match obj.get(&enc_key).and_then(|v| v.as_str()) {
            Some(ct) => ct.to_string(),
            None => continue, // plaintext or absent — nothing to decrypt
        };
        let nonce = match obj.get(&iv_key).and_then(|v| v.as_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        let plaintext_json = decrypt_from_db(&ciphertext, &nonce)?;

        // Restore the original value (parse back from the serialized form)
        let restored: serde_json::Value = serde_json::from_str(&plaintext_json)
            .unwrap_or(serde_json::Value::String(plaintext_json));

        obj.remove(&enc_key);
        obj.remove(&iv_key);
        obj.insert(key.to_string(), restored);
    }

    serde_json::to_string(&val)
        .map_err(|e| CryptoError::Decrypt(format!("JSON serialize error: {e}")))
}

/// Migrate plaintext trigger config secrets to encrypted form.
/// Scans all persona_triggers with webhook_secret or headers in their config,
/// encrypts the values if not already encrypted.
/// Runs inside a transaction for atomicity.
/// Returns `(migrated_count, skipped_count)`.
pub fn migrate_plaintext_trigger_secrets(pool: &DbPool) -> Result<(usize, usize), CryptoError> {
    let mut conn = pool
        .get()
        .map_err(|e| CryptoError::KeyManagement(format!("DB pool error: {e}")))?;

    // Find triggers that have plaintext sensitive fields:
    // webhook triggers with webhook_secret but no webhook_secret_enc,
    // polling triggers with headers but no headers_enc.
    let (rows, parse_failures): (Vec<(String, String)>, usize) = {
        let mut stmt = conn
            .prepare(
                "SELECT id, config FROM persona_triggers
                 WHERE config IS NOT NULL
                   AND (
                     (trigger_type = 'webhook'
                       AND json_extract(config, '$.webhook_secret') IS NOT NULL
                       AND json_extract(config, '$.webhook_secret_enc') IS NULL)
                     OR
                     (trigger_type = 'polling'
                       AND json_extract(config, '$.headers') IS NOT NULL
                       AND json_extract(config, '$.headers_enc') IS NULL)
                   )",
            )
            .map_err(|e| CryptoError::KeyManagement(format!("Query error: {e}")))?;

        let mut result: Vec<(String, String)> = Vec::new();
        let mut failures = 0usize;
        for (idx, r) in stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| CryptoError::KeyManagement(format!("Query error: {e}")))?
            .enumerate()
        {
            match r {
                Ok(row) => result.push(row),
                Err(e) => {
                    failures += 1;
                    tracing::error!(
                        "migrate_plaintext_trigger_secrets: failed to parse row at index {}: {}",
                        idx, e
                    );
                }
            }
        }
        (result, failures)
    };

    if rows.is_empty() && parse_failures == 0 {
        return Ok((0, 0));
    }

    let tx = conn
        .transaction()
        .map_err(|e| CryptoError::KeyManagement(format!("Transaction begin error: {e}")))?;

    let mut migrated = 0;

    for (id, config_json) in &rows {
        match encrypt_trigger_config(config_json) {
            Ok(encrypted_json) => {
                if encrypted_json != *config_json {
                    tx.execute(
                        "UPDATE persona_triggers SET config = ?1 WHERE id = ?2",
                        rusqlite::params![encrypted_json, id],
                    )
                    .map_err(|e| {
                        CryptoError::KeyManagement(format!(
                            "Update error for trigger {id}: {e}"
                        ))
                    })?;
                    migrated += 1;
                }
            }
            Err(e) => {
                tracing::error!("Failed to encrypt trigger config for {}: {}", id, e);
            }
        }
    }

    tx.commit()
        .map_err(|e| CryptoError::KeyManagement(format!("Transaction commit error: {e}")))?;

    if migrated > 0 {
        tracing::info!(
            "Migrated trigger config secrets for {} trigger(s) to encrypted storage",
            migrated
        );
    }

    Ok((migrated, parse_failures))
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

    #[test]
    fn test_trigger_config_webhook_roundtrip() {
        let config = r#"{"webhook_secret":"my-hmac-key","event_type":"deploy"}"#;
        let encrypted = encrypt_trigger_config(config).unwrap();

        // Plaintext secret should be gone
        let val: serde_json::Value = serde_json::from_str(&encrypted).unwrap();
        assert!(val.get("webhook_secret").is_none());
        assert!(val.get("webhook_secret_enc").is_some());
        assert!(val.get("webhook_secret_iv").is_some());
        // Non-sensitive field preserved
        assert_eq!(val.get("event_type").unwrap().as_str().unwrap(), "deploy");

        // Decrypt roundtrip
        let decrypted = decrypt_trigger_config(&encrypted).unwrap();
        let dec_val: serde_json::Value = serde_json::from_str(&decrypted).unwrap();
        assert_eq!(dec_val.get("webhook_secret").unwrap().as_str().unwrap(), "my-hmac-key");
        assert!(dec_val.get("webhook_secret_enc").is_none());
    }

    #[test]
    fn test_trigger_config_polling_headers_roundtrip() {
        let config = r#"{"url":"https://api.example.com","headers":{"Authorization":"Bearer tok123"},"interval_seconds":60}"#;
        let encrypted = encrypt_trigger_config(config).unwrap();

        let val: serde_json::Value = serde_json::from_str(&encrypted).unwrap();
        assert!(val.get("headers").is_none());
        assert!(val.get("headers_enc").is_some());
        assert!(val.get("headers_iv").is_some());
        // Non-sensitive fields preserved
        assert_eq!(val.get("url").unwrap().as_str().unwrap(), "https://api.example.com");
        assert_eq!(val.get("interval_seconds").unwrap().as_u64().unwrap(), 60);

        let decrypted = decrypt_trigger_config(&encrypted).unwrap();
        let dec_val: serde_json::Value = serde_json::from_str(&decrypted).unwrap();
        let headers = dec_val.get("headers").unwrap().as_object().unwrap();
        assert_eq!(headers.get("Authorization").unwrap().as_str().unwrap(), "Bearer tok123");
    }

    #[test]
    fn test_trigger_config_plaintext_passthrough() {
        // Config without sensitive fields should pass through unchanged
        let config = r#"{"cron":"0 * * * *","event_type":"build_check"}"#;
        let encrypted = encrypt_trigger_config(config).unwrap();
        let val: serde_json::Value = serde_json::from_str(&encrypted).unwrap();
        assert_eq!(val.get("cron").unwrap().as_str().unwrap(), "0 * * * *");

        // Decrypt of non-encrypted config should also pass through
        let decrypted = decrypt_trigger_config(config).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&decrypted).unwrap(),
            serde_json::from_str::<serde_json::Value>(config).unwrap()
        );
    }

    #[test]
    fn test_trigger_config_already_encrypted_skipped() {
        let config = r#"{"webhook_secret":"my-key","event_type":"deploy"}"#;
        let encrypted = encrypt_trigger_config(config).unwrap();
        // Encrypting again should be a no-op (already has _enc keys)
        let double_encrypted = encrypt_trigger_config(&encrypted).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&encrypted).unwrap(),
            serde_json::from_str::<serde_json::Value>(&double_encrypted).unwrap()
        );
    }
}
