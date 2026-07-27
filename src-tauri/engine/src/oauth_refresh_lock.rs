//! Per-credential mutex to prevent concurrent OAuth token refresh races.
//!
//! When multiple code paths (proactive refresh tick, healthcheck, manual rotation)
//! trigger a token refresh for the same credential simultaneously, they can both
//! read the same refresh_token, both exchange it at the OAuth provider, and one
//! write clobbers the other. If the provider rotates the refresh_token (RFC 6749
//! Section 6), the second exchange may invalidate the token returned by the first,
//! leaving the credential permanently broken.
//!
//! This module provides a per-credential async mutex so that only one refresh
//! can be in-flight for a given credential at any time.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::Mutex as AsyncMutex;
use tokio::sync::OwnedMutexGuard;

/// Global lock map: credential_id → async mutex.
static LOCK_MAP: std::sync::OnceLock<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>> =
    std::sync::OnceLock::new();

fn map() -> &'static Mutex<HashMap<String, Arc<AsyncMutex<()>>>> {
    LOCK_MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Acquire an exclusive async lock for the given credential.
///
/// Returns an `OwnedMutexGuard` that releases the lock when dropped.
/// If another task already holds the lock for this credential, the caller
/// will `.await` until it is released.
pub async fn acquire(credential_id: &str) -> OwnedMutexGuard<()> {
    let mutex = {
        let mut m = map().lock().expect("oauth refresh lock map poisoned");
        m.entry(credential_id.to_string())
            .or_insert_with(|| Arc::new(AsyncMutex::new(())))
            .clone()
    };
    mutex.lock_owned().await
}

/// Try to acquire the lock without blocking. Returns `None` if another
/// refresh is already in progress for this credential.
#[allow(dead_code)]
pub fn try_acquire(credential_id: &str) -> Option<OwnedMutexGuard<()>> {
    let mutex = {
        let mut m = map().lock().expect("oauth refresh lock map poisoned");
        m.entry(credential_id.to_string())
            .or_insert_with(|| Arc::new(AsyncMutex::new(())))
            .clone()
    };
    mutex.try_lock_owned().ok()
}
