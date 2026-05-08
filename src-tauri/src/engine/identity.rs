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

/// Cached local identity. Mutable so `reinitialize_identity` can atomically
/// publish the new identity to in-flight callers (mDNS register, Hello
/// handshake, get_network_status) without requiring a process restart.
static IDENTITY_CACHE: std::sync::RwLock<Option<PeerIdentity>> = std::sync::RwLock::new(None);

/// Cached signing key (loaded from keyring once, cleared on reinitialize).
static SIGNING_KEY_CACHE: std::sync::RwLock<Option<SigningKey>> = std::sync::RwLock::new(None);

/// Serializes identity *write* paths (first-launch generation and explicit
/// re-initialization) so concurrent callers can never produce two keypairs
/// and a desync between the keyring private key and the database public
/// key.
///
/// Why this exists: on a fresh install, mDNS startup and the first
/// front-end IPC call both reach `get_or_create_identity` within
/// milliseconds of each other. Without serialization, both threads miss
/// the cache, both find an empty DB, both call `SigningKey::generate`,
/// both write the keyring entry (the second write wins) and both upsert
/// `local_identity` (the second peer_id wins) — and there's no
/// guarantee the surviving keyring private key matches the surviving DB
/// public key. The next `sign_message` call then fails with
/// `AppError::KeyringLost` because the verifying_key derived from the
/// stored private key no longer matches the persisted public key. The
/// user sees an inexplicable post-fresh-install hang.
///
/// Steady-state reads (cache hit) never touch this lock. The DB-fast-path
/// also avoids it. Only the create / reinit paths take it. After
/// acquisition we re-check the cache and re-read the DB so a racing
/// caller observes the just-created identity instead of generating a
/// duplicate.
///
/// `std::sync::Mutex<()>` rather than `OnceLock<PeerIdentity>` because
/// the cache must be invalidatable in place by `reinitialize_identity` —
/// `OnceLock` is one-shot.
static IDENTITY_WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Helper: acquire the write lock or convert the (rare) poison error
/// into an `AppError::Internal`. Poisoning means a previous holder
/// panicked while writing identity state; the safest move is to surface
/// the failure to the user rather than silently retry on potentially
/// torn state.
fn acquire_write_lock() -> Result<std::sync::MutexGuard<'static, ()>, AppError> {
    IDENTITY_WRITE_LOCK
        .lock()
        .map_err(|e| AppError::Internal(format!("Identity write lock poisoned: {e}")))
}

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
/// On subsequent calls: returns the cached in-memory identity.
///
/// **Concurrency**: this function is safe to call from many threads
/// simultaneously even on first launch. See [`IDENTITY_WRITE_LOCK`] for
/// the contract — only one keypair is ever generated, regardless of how
/// many callers race the create branch.
pub fn get_or_create_identity(pool: &DbPool) -> Result<PeerIdentity, AppError> {
    // Fast path 1: cache hit (lock-free read).
    if let Some(cached) = IDENTITY_CACHE.read().unwrap().as_ref() {
        return Ok(cached.clone());
    }

    // Fast path 2: DB hit (no write lock). Returning users — DB has the
    // identity but the in-process cache is cold (post-restart, post-HMR,
    // post-reinit) — never block on the write mutex.
    if let Some(existing) = identity_repo::get_local_identity(pool)? {
        *IDENTITY_CACHE.write().unwrap() = Some(existing.clone());
        return Ok(existing);
    }

    // Slow path: first-launch create. Serialize so two racing callers
    // (e.g. mDNS register + first IPC) cannot both generate keypairs.
    let _guard = acquire_write_lock()?;

    // Double-check: a racing caller may have created the identity
    // between our DB read above and our lock acquisition. Re-check both
    // cache and DB so we observe the just-created identity instead of
    // generating a duplicate.
    if let Some(cached) = IDENTITY_CACHE.read().unwrap().as_ref() {
        return Ok(cached.clone());
    }
    if let Some(existing) = identity_repo::get_local_identity(pool)? {
        *IDENTITY_CACHE.write().unwrap() = Some(existing.clone());
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

    *IDENTITY_CACHE.write().unwrap() = Some(identity.clone());
    tracing::info!(peer_id = %peer_id, "New identity created");
    Ok(identity)
}

/// Store the Ed25519 private key in the OS keyring.
fn store_private_key(signing_key: &SigningKey) -> Result<(), AppError> {
    let mut key_bytes = signing_key.to_bytes();
    #[allow(unused_variables)]
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
        return Err(AppError::Internal(
            "Cannot persist identity key: OS keyring is not available in non-desktop builds. \
             Identity features require a desktop build with keyring support."
                .into(),
        ));
    }

    #[allow(unreachable_code)]
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
        let mut key_bytes = B64.decode(&encoded).map_err(|e| {
            AppError::Internal(format!("Base64 decode of identity key failed: {e}"))
        })?;
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
///
/// Returns `AppError::KeyringLost` if the OS keyring entry is missing or the
/// stored key no longer matches the database identity.  Callers should surface
/// this to the user and direct them to call [`reinitialize_identity`] to
/// explicitly regenerate the keypair (which invalidates all existing trust
/// relationships).
pub fn sign_message(pool: &DbPool, message: &[u8]) -> Result<String, AppError> {
    // Try cached signing key first
    {
        let cache = SIGNING_KEY_CACHE.read().unwrap();
        if let Some(ref key) = *cache {
            let signature = key.sign(message);
            return Ok(B64.encode(signature.to_bytes()));
        }
    }

    let signing_key = load_private_key().map_err(|_| {
        AppError::KeyringLost(
            "OS keyring entry for identity key is missing. \
             Run identity re-initialization to generate a new keypair."
                .into(),
        )
    })?;

    // Verify the loaded key matches the identity stored in the database.
    if let Some(db_identity) = identity_repo::get_local_identity(pool)? {
        let pk_bytes = B64
            .decode(&db_identity.public_key_b64)
            .map_err(|e| AppError::Internal(format!("Corrupt public key in DB: {e}")))?;
        let db_public_key = VerifyingKey::try_from(pk_bytes.as_slice())
            .map_err(|e| AppError::Internal(format!("Invalid Ed25519 public key in DB: {e}")))?;

        if signing_key.verifying_key() != db_public_key {
            return Err(AppError::KeyringLost(
                "Keyring private key does not match the database identity. \
                 The OS credential store may have been reset. \
                 Run identity re-initialization to generate a new keypair."
                    .into(),
            ));
        }
    }

    // Cache the verified signing key for future calls
    *SIGNING_KEY_CACHE.write().unwrap() = Some(signing_key.clone());

    let signature = signing_key.sign(message);
    Ok(B64.encode(signature.to_bytes()))
}

/// Explicitly regenerate the local identity keypair after a keyring loss.
///
/// This generates a fresh Ed25519 keypair, stores the private key in the OS
/// keyring, and updates the database identity with the new peer_id and
/// public_key.  **All existing trust relationships will be invalidated** —
/// peers that imported the old public key must re-import the new identity card.
///
/// Returns the new `PeerIdentity`.
pub fn reinitialize_identity(pool: &DbPool) -> Result<PeerIdentity, AppError> {
    // Take the same lock as the create branch so a `get_or_create_identity`
    // call racing a user-initiated reinit can't observe a torn state where
    // the keyring has the new key but the DB still has the old peer_id
    // (or vice versa).
    let _guard = acquire_write_lock()?;

    tracing::warn!("Re-initializing identity — generating new Ed25519 keypair (old trust relationships will be invalidated)");

    let mut csprng = rand::rngs::OsRng;
    let signing_key = SigningKey::generate(&mut csprng);
    let verifying_key = signing_key.verifying_key();
    let peer_id = public_key_to_peer_id(&verifying_key);

    // Store new private key in OS keyring
    store_private_key(&signing_key)?;

    // Preserve display_name if an old identity exists, otherwise derive one
    let display_name = identity_repo::get_local_identity(pool)?
        .map(|old| old.display_name)
        .unwrap_or_else(|| format!("User-{}", &peer_id[..8]));

    // Upsert overwrites the old peer_id + public_key
    let identity = identity_repo::upsert_local_identity(
        pool,
        &peer_id,
        verifying_key.as_bytes(),
        &display_name,
    )?;

    // Atomically publish the fresh identity and invalidate the cached signing
    // key so mDNS register, Hello handshake, and get_network_status all see
    // the new peer_id on the next call.
    *IDENTITY_CACHE.write().unwrap() = Some(identity.clone());
    *SIGNING_KEY_CACHE.write().unwrap() = None;

    tracing::info!(peer_id = %peer_id, "Identity re-initialized with new keypair");
    Ok(identity)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use std::sync::{Arc, Barrier};
    use std::thread;

    /// Tests in this module share the global `IDENTITY_CACHE` and
    /// `IDENTITY_WRITE_LOCK` statics. cargo runs tests in parallel by
    /// default — without serialization, one test's reset_identity_caches
    /// race-overlaps with another's pre-populated cache and they see
    /// each other's identity. Take this top-level mutex at the start of
    /// every test so tests in this module run strictly sequentially
    /// regardless of `--test-threads`.
    static TESTS_SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// Reset the in-process identity caches so tests don't bleed state
    /// into each other. The write lock is taken to flush any racing
    /// writer that's mid-create.
    fn reset_identity_caches() {
        let _g = IDENTITY_WRITE_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *IDENTITY_CACHE.write().unwrap() = None;
        *SIGNING_KEY_CACHE.write().unwrap() = None;
    }

    /// Pin the cache-fill race contract: many concurrent callers, all
    /// hitting `get_or_create_identity` against a DB that already has
    /// the local_identity row but with a cold in-process cache, must
    /// all observe the same identity (the persisted one) without one
    /// of them producing a divergent view.
    ///
    /// This is the most common version of the race in practice — fresh
    /// app launch with persisted identity from a prior session, mDNS
    /// startup and the first IPC call both arriving before the cache
    /// has been warmed.
    #[test]
    fn concurrent_get_or_create_returns_same_identity_with_warm_db() {
        let _serial = TESTS_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_identity_caches();
        let pool = Arc::new(init_test_db().unwrap());

        // Pre-populate the DB so every thread takes the DB-fast path or
        // the post-lock re-check path; nothing exercises the keyring
        // (which is unavailable in test builds without `desktop`).
        let signing_key = SigningKey::generate(&mut rand::rngs::OsRng);
        let verifying_key = signing_key.verifying_key();
        let peer_id = public_key_to_peer_id(&verifying_key);
        let display_name = format!("User-{}", &peer_id[..8]);
        identity_repo::upsert_local_identity(
            &pool,
            &peer_id,
            verifying_key.as_bytes(),
            &display_name,
        )
        .unwrap();

        const N: usize = 16;
        let barrier = Arc::new(Barrier::new(N));
        let mut handles = Vec::with_capacity(N);
        for _ in 0..N {
            let pool = pool.clone();
            let barrier = barrier.clone();
            handles.push(thread::spawn(move || {
                barrier.wait();
                get_or_create_identity(&pool).expect("identity must succeed under contention")
            }));
        }

        let results: Vec<PeerIdentity> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        for r in &results {
            assert_eq!(
                r.peer_id, peer_id,
                "all racing callers must observe the persisted peer_id"
            );
            assert_eq!(r.public_key_b64, results[0].public_key_b64);
        }

        // Cache must be populated and consistent with what was returned.
        let cached = IDENTITY_CACHE.read().unwrap().clone();
        let cached = cached.expect("cache must be warm after concurrent get_or_create");
        assert_eq!(cached.peer_id, peer_id);
    }

    /// Pin the lock-acquisition contract: when the cache is warm, the
    /// fast path must NOT take the write lock. We assert this by
    /// holding the lock externally while a concurrent caller hits
    /// `get_or_create_identity` against a cache already populated. If
    /// the function tried to take the lock it would block, and the
    /// short-bounded `recv_timeout` would expire.
    #[test]
    fn cache_hit_path_does_not_take_write_lock() {
        let _serial = TESTS_SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        reset_identity_caches();
        let pool = Arc::new(init_test_db().unwrap());

        // Warm the cache directly without going through the create
        // path (no keyring dependency).
        let signing_key = SigningKey::generate(&mut rand::rngs::OsRng);
        let verifying_key = signing_key.verifying_key();
        let peer_id = public_key_to_peer_id(&verifying_key);
        let pre = identity_repo::upsert_local_identity(
            &pool,
            &peer_id,
            verifying_key.as_bytes(),
            "User-test",
        )
        .unwrap();
        *IDENTITY_CACHE.write().unwrap() = Some(pre.clone());

        // Hold the write lock from another thread for 250ms. If
        // `get_or_create_identity` takes the lock during cache-hit, our
        // call would block until that thread releases.
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let lock_holder = thread::spawn(move || {
            let _g = IDENTITY_WRITE_LOCK.lock().unwrap();
            // Signal acquisition.
            tx.send(()).unwrap();
            thread::sleep(std::time::Duration::from_millis(250));
        });
        rx.recv().unwrap();

        // While the writer holds the lock, the cache-hit path must
        // return promptly.
        let started = std::time::Instant::now();
        let got = get_or_create_identity(&pool).unwrap();
        let elapsed = started.elapsed();
        assert_eq!(got.peer_id, peer_id);
        assert!(
            elapsed < std::time::Duration::from_millis(100),
            "cache-hit path must not block on the write lock; took {elapsed:?}",
        );

        lock_holder.join().unwrap();
    }
}
