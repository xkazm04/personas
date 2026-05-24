//! Keyring-backed storage for the Langfuse plugin config.
//!
//! Mirrors `gitlab::config`: secrets and small config fields each live in
//! their own keyring entry under the shared `personas-desktop` service. On
//! mobile builds (no `desktop` feature) every function is a no-op.

#[cfg(feature = "desktop")]
use keyring::Entry;

#[cfg(feature = "desktop")]
const SERVICE: &str = "personas-desktop";

#[cfg(feature = "desktop")]
const KEY_HOST: &str = "langfuse-host";
#[cfg(feature = "desktop")]
const KEY_PUBLIC_KEY: &str = "langfuse-public-key";
#[cfg(feature = "desktop")]
const KEY_SECRET_KEY: &str = "langfuse-secret-key";
#[cfg(feature = "desktop")]
const KEY_REDACT: &str = "langfuse-redact-content";
#[cfg(feature = "desktop")]
const KEY_ENABLED: &str = "langfuse-enabled";
#[cfg(feature = "desktop")]
const KEY_LAST_TESTED_AT: &str = "langfuse-last-tested-at";
#[cfg(feature = "desktop")]
const KEY_LAST_TEST_OUTCOME: &str = "langfuse-last-test-outcome";
#[cfg(feature = "desktop")]
const KEY_MANAGED: &str = "langfuse-managed";
#[cfg(feature = "desktop")]
const KEY_ADMIN_EMAIL: &str = "langfuse-admin-email";
#[cfg(feature = "desktop")]
const KEY_ADMIN_PASSWORD: &str = "langfuse-admin-password";
#[cfg(feature = "desktop")]
const KEY_PREFERRED_PORT: &str = "langfuse-preferred-port";
#[cfg(feature = "desktop")]
const KEY_PROJECT_ID: &str = "langfuse-project-id";
#[cfg(feature = "desktop")]
const KEY_PUSH_LAB_SCORES: &str = "langfuse-push-lab-scores";

#[cfg(feature = "desktop")]
fn put(name: &str, value: &str) -> Result<(), String> {
    Entry::new(SERVICE, name)
        .map_err(|e| format!("keyring entry error: {e}"))?
        .set_password(value)
        .map_err(|e| format!("Failed to store {name}: {e}"))
}

#[cfg(feature = "desktop")]
fn get(name: &str) -> Option<String> {
    let raw = Entry::new(SERVICE, name).ok()?.get_password().ok()?;
    if raw.is_empty() {
        None
    } else {
        Some(raw)
    }
}

#[cfg(feature = "desktop")]
fn drop_key(name: &str) {
    if let Ok(entry) = Entry::new(SERVICE, name) {
        let _ = entry.delete_credential();
    }
}

// ---------------------------------------------------------------------------
// Desktop-feature implementations
// ---------------------------------------------------------------------------

#[cfg(feature = "desktop")]
pub fn store_host(host: &str) -> Result<(), String> {
    put(KEY_HOST, host)
}
#[cfg(not(feature = "desktop"))]
pub fn store_host(_host: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(feature = "desktop")]
pub fn load_host() -> Option<String> {
    get(KEY_HOST)
}
#[cfg(not(feature = "desktop"))]
pub fn load_host() -> Option<String> {
    None
}

#[cfg(feature = "desktop")]
pub fn store_public_key(key: &str) -> Result<(), String> {
    put(KEY_PUBLIC_KEY, key)
}
#[cfg(not(feature = "desktop"))]
pub fn store_public_key(_key: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(feature = "desktop")]
pub fn load_public_key() -> Option<String> {
    get(KEY_PUBLIC_KEY)
}
#[cfg(not(feature = "desktop"))]
pub fn load_public_key() -> Option<String> {
    None
}

#[cfg(feature = "desktop")]
pub fn store_secret_key(key: &str) -> Result<(), String> {
    put(KEY_SECRET_KEY, key)
}
#[cfg(not(feature = "desktop"))]
pub fn store_secret_key(_key: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(feature = "desktop")]
pub fn load_secret_key() -> Option<String> {
    get(KEY_SECRET_KEY)
}
#[cfg(not(feature = "desktop"))]
pub fn load_secret_key() -> Option<String> {
    None
}

#[cfg(feature = "desktop")]
pub fn store_redact(redact: bool) -> Result<(), String> {
    put(KEY_REDACT, if redact { "true" } else { "false" })
}
#[cfg(not(feature = "desktop"))]
pub fn store_redact(_redact: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(feature = "desktop")]
pub fn load_redact() -> bool {
    matches!(get(KEY_REDACT).as_deref(), Some("true"))
}
#[cfg(not(feature = "desktop"))]
pub fn load_redact() -> bool {
    false
}

#[cfg(feature = "desktop")]
pub fn store_push_lab_scores(push: bool) -> Result<(), String> {
    put(KEY_PUSH_LAB_SCORES, if push { "true" } else { "false" })
}
#[cfg(not(feature = "desktop"))]
pub fn store_push_lab_scores(_push: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(feature = "desktop")]
pub fn load_push_lab_scores() -> bool {
    matches!(get(KEY_PUSH_LAB_SCORES).as_deref(), Some("true"))
}
#[cfg(not(feature = "desktop"))]
pub fn load_push_lab_scores() -> bool {
    false
}

#[cfg(feature = "desktop")]
pub fn store_enabled(enabled: bool) -> Result<(), String> {
    put(KEY_ENABLED, if enabled { "true" } else { "false" })
}
#[cfg(not(feature = "desktop"))]
pub fn store_enabled(_enabled: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(feature = "desktop")]
pub fn load_enabled() -> bool {
    matches!(get(KEY_ENABLED).as_deref(), Some("true"))
}
#[cfg(not(feature = "desktop"))]
pub fn load_enabled() -> bool {
    false
}

#[cfg(feature = "desktop")]
pub fn store_last_test(timestamp: i64, outcome: &str) -> Result<(), String> {
    put(KEY_LAST_TESTED_AT, &timestamp.to_string())?;
    put(KEY_LAST_TEST_OUTCOME, outcome)
}
#[cfg(not(feature = "desktop"))]
pub fn store_last_test(_timestamp: i64, _outcome: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(feature = "desktop")]
pub fn load_last_test() -> (Option<i64>, Option<String>) {
    let ts = get(KEY_LAST_TESTED_AT).and_then(|s| s.parse::<i64>().ok());
    let outcome = get(KEY_LAST_TEST_OUTCOME);
    (ts, outcome)
}
#[cfg(not(feature = "desktop"))]
pub fn load_last_test() -> (Option<i64>, Option<String>) {
    (None, None)
}

#[cfg(feature = "desktop")]
pub fn store_managed(managed: bool) -> Result<(), String> {
    put(KEY_MANAGED, if managed { "true" } else { "false" })
}
#[cfg(not(feature = "desktop"))]
pub fn store_managed(_managed: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(feature = "desktop")]
pub fn load_managed() -> bool {
    matches!(get(KEY_MANAGED).as_deref(), Some("true"))
}
#[cfg(not(feature = "desktop"))]
pub fn load_managed() -> bool {
    false
}

#[cfg(feature = "desktop")]
pub fn store_admin_credentials(email: &str, password: &str) -> Result<(), String> {
    put(KEY_ADMIN_EMAIL, email)?;
    put(KEY_ADMIN_PASSWORD, password)
}
#[cfg(not(feature = "desktop"))]
pub fn store_admin_credentials(_email: &str, _password: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(feature = "desktop")]
pub fn load_admin_credentials() -> Option<(String, String)> {
    let email = get(KEY_ADMIN_EMAIL)?;
    let password = get(KEY_ADMIN_PASSWORD)?;
    Some((email, password))
}
#[cfg(not(feature = "desktop"))]
pub fn load_admin_credentials() -> Option<(String, String)> {
    None
}

/// Preferred port for the local stack. Defaults to 3000 when unset. The
/// actual port may differ on a given start if the preferred port was busy
/// — see `pick_port` in templates.rs for the scan policy.
pub const DEFAULT_PREFERRED_PORT: u16 = 3000;

/// Project id baked into the managed compose template. Used as the default
/// `LangfuseConfig.project_id` for the managed stack so "Open in Langfuse"
/// works without user input.
pub const MANAGED_PROJECT_ID: &str = "personas-default";

#[cfg(feature = "desktop")]
pub fn store_project_id(project_id: Option<&str>) -> Result<(), String> {
    match project_id {
        Some(s) if !s.is_empty() => put(KEY_PROJECT_ID, s),
        _ => {
            drop_key(KEY_PROJECT_ID);
            Ok(())
        }
    }
}
#[cfg(not(feature = "desktop"))]
pub fn store_project_id(_project_id: Option<&str>) -> Result<(), String> {
    Ok(())
}

#[cfg(feature = "desktop")]
pub fn load_project_id() -> Option<String> {
    get(KEY_PROJECT_ID)
}
#[cfg(not(feature = "desktop"))]
pub fn load_project_id() -> Option<String> {
    None
}

#[cfg(feature = "desktop")]
pub fn store_preferred_port(port: u16) -> Result<(), String> {
    put(KEY_PREFERRED_PORT, &port.to_string())
}
#[cfg(not(feature = "desktop"))]
pub fn store_preferred_port(_port: u16) -> Result<(), String> {
    Ok(())
}

#[cfg(feature = "desktop")]
pub fn load_preferred_port() -> u16 {
    get(KEY_PREFERRED_PORT)
        .and_then(|s| s.parse::<u16>().ok())
        .filter(|&p| p > 0)
        .unwrap_or(DEFAULT_PREFERRED_PORT)
}
#[cfg(not(feature = "desktop"))]
pub fn load_preferred_port() -> u16 {
    DEFAULT_PREFERRED_PORT
}

#[cfg(feature = "desktop")]
pub fn clear_all() {
    for key in [
        KEY_HOST,
        KEY_PUBLIC_KEY,
        KEY_SECRET_KEY,
        KEY_REDACT,
        KEY_ENABLED,
        KEY_LAST_TESTED_AT,
        KEY_LAST_TEST_OUTCOME,
        KEY_MANAGED,
        KEY_ADMIN_EMAIL,
        KEY_ADMIN_PASSWORD,
        KEY_PREFERRED_PORT,
        KEY_PROJECT_ID,
        KEY_PUSH_LAB_SCORES,
    ] {
        drop_key(key);
    }
}
#[cfg(not(feature = "desktop"))]
pub fn clear_all() {}
