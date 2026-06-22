//! API-key resolution + OS-keyring storage for the remote HTTP engine.
//!
//! The Qwen key is never returned to callers; `qwen_key_configured` only reports
//! presence. Resolution order for execution: profile override → OS keyring → env.

use crate::engine::types::ModelProfile;

#[cfg(feature = "desktop")]
fn load_keyring_qwen_key() -> Option<String> {
    let v = keyring::Entry::new("personas-desktop", "qwen-api-key")
        .ok()?
        .get_password()
        .ok()?;
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

#[cfg(not(feature = "desktop"))]
fn load_keyring_qwen_key() -> Option<String> {
    None
}

/// Store the Qwen API key in the OS keyring. (no-op on mobile)
#[cfg(feature = "desktop")]
pub fn store_qwen_api_key(api_key: &str) -> Result<(), String> {
    keyring::Entry::new("personas-desktop", "qwen-api-key")
        .map_err(|e| format!("keyring entry error: {e}"))?
        .set_password(api_key)
        .map_err(|e| format!("failed to store qwen api key: {e}"))
}

#[cfg(not(feature = "desktop"))]
pub fn store_qwen_api_key(_api_key: &str) -> Result<(), String> {
    Ok(())
}

/// Remove the stored Qwen API key from the OS keyring. (no-op on mobile)
#[cfg(feature = "desktop")]
pub fn clear_qwen_api_key() {
    if let Ok(entry) = keyring::Entry::new("personas-desktop", "qwen-api-key") {
        let _ = entry.delete_credential();
    }
}

#[cfg(not(feature = "desktop"))]
pub fn clear_qwen_api_key() {}

/// Whether a Qwen API key is configured (keyring or env) — never reveals it.
pub fn qwen_key_configured() -> bool {
    load_keyring_qwen_key().is_some()
        || std::env::var("QWEN_API_KEY").is_ok_and(|v| !v.is_empty())
        || std::env::var("DASHSCOPE_API_KEY").is_ok_and(|v| !v.is_empty())
}

/// Resolve the provider API key: profile override → OS keyring → env.
pub(super) fn resolve_api_key(model_profile: &ModelProfile) -> Option<String> {
    if let Some(t) = model_profile.auth_token.as_deref() {
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    if let Some(k) = load_keyring_qwen_key() {
        return Some(k);
    }
    for var in ["QWEN_API_KEY", "DASHSCOPE_API_KEY"] {
        if let Ok(v) = std::env::var(var) {
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    None
}
