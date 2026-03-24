#[cfg(feature = "desktop")]
use keyring::Entry;

const SERVICE: &str = "personas-desktop";
const KEY_TOKEN: &str = "gitlab-token";
const KEY_INSTANCE_URL: &str = "gitlab-instance-url";
#[cfg(feature = "desktop")]
const KEY_PROJECT: &str = "gitlab-project-id";

/// Store GitLab PAT in the OS keyring.
#[cfg(feature = "desktop")]
pub fn store_gitlab_config(token: &str) -> Result<(), String> {
    Entry::new(SERVICE, KEY_TOKEN)
        .map_err(|e| format!("keyring entry error: {e}"))?
        .set_password(token)
        .map_err(|e| format!("Failed to store GitLab token: {e}"))?;
    Ok(())
}

/// Store GitLab instance URL in the OS keyring.
#[cfg(feature = "desktop")]
pub fn store_gitlab_instance_url(url: &str) -> Result<(), String> {
    Entry::new(SERVICE, KEY_INSTANCE_URL)
        .map_err(|e| format!("keyring entry error: {e}"))?
        .set_password(url)
        .map_err(|e| format!("Failed to store GitLab instance URL: {e}"))?;
    Ok(())
}

/// Store GitLab instance URL (no-op on mobile).
#[cfg(not(feature = "desktop"))]
pub fn store_gitlab_instance_url(_url: &str) -> Result<(), String> {
    Ok(())
}

/// Load GitLab instance URL from OS keyring. Returns None if not configured (defaults to gitlab.com).
#[cfg(feature = "desktop")]
pub fn load_gitlab_instance_url() -> Option<String> {
    let url = Entry::new(SERVICE, KEY_INSTANCE_URL).ok()?.get_password().ok()?;
    if url.is_empty() {
        return None;
    }
    Some(url)
}

/// Load GitLab instance URL (no keyring on mobile, always returns None).
#[cfg(not(feature = "desktop"))]
pub fn load_gitlab_instance_url() -> Option<String> {
    None
}

/// Store GitLab PAT (no-op on mobile).
#[cfg(not(feature = "desktop"))]
pub fn store_gitlab_config(_token: &str) -> Result<(), String> {
    Ok(())
}

/// Load GitLab PAT from OS keyring. Returns None if not configured.
#[cfg(feature = "desktop")]
pub fn load_gitlab_config() -> Option<String> {
    let token = Entry::new(SERVICE, KEY_TOKEN).ok()?.get_password().ok()?;
    if token.is_empty() {
        return None;
    }
    Some(token)
}

/// Load GitLab PAT (no keyring on mobile, always returns None).
#[cfg(not(feature = "desktop"))]
pub fn load_gitlab_config() -> Option<String> {
    None
}

/// Clear GitLab credentials from OS keyring.
#[cfg(feature = "desktop")]
pub fn clear_gitlab_config() {
    if let Ok(entry) = Entry::new(SERVICE, KEY_TOKEN) {
        let _ = entry.delete_credential();
    }
    if let Ok(entry) = Entry::new(SERVICE, KEY_INSTANCE_URL) {
        let _ = entry.delete_credential();
    }
    if let Ok(entry) = Entry::new(SERVICE, KEY_PROJECT) {
        let _ = entry.delete_credential();
    }
}

/// Clear GitLab credentials (no-op on mobile).
#[cfg(not(feature = "desktop"))]
pub fn clear_gitlab_config() {}
