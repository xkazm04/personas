<<<<<<< HEAD
#[cfg(feature = "desktop")]
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
use keyring::Entry;

const SERVICE: &str = "personas-desktop";
const KEY_TOKEN: &str = "gitlab-token";
<<<<<<< HEAD
#[cfg(feature = "desktop")]
const KEY_PROJECT: &str = "gitlab-project-id";

/// Store GitLab PAT in the OS keyring.
#[cfg(feature = "desktop")]
=======
const KEY_PROJECT: &str = "gitlab-project-id";

/// Store GitLab PAT in the OS keyring.
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
pub fn store_gitlab_config(token: &str) -> Result<(), String> {
    Entry::new(SERVICE, KEY_TOKEN)
        .map_err(|e| format!("keyring entry error: {e}"))?
        .set_password(token)
        .map_err(|e| format!("Failed to store GitLab token: {e}"))?;
    Ok(())
}

<<<<<<< HEAD
/// Store GitLab PAT (no-op on mobile).
#[cfg(not(feature = "desktop"))]
pub fn store_gitlab_config(_token: &str) -> Result<(), String> {
    Ok(())
}

/// Load GitLab PAT from OS keyring. Returns None if not configured.
#[cfg(feature = "desktop")]
=======
/// Load GitLab PAT from OS keyring. Returns None if not configured.
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
pub fn load_gitlab_config() -> Option<String> {
    let token = Entry::new(SERVICE, KEY_TOKEN).ok()?.get_password().ok()?;
    if token.is_empty() {
        return None;
    }
    Some(token)
}

<<<<<<< HEAD
/// Load GitLab PAT (no keyring on mobile, always returns None).
#[cfg(not(feature = "desktop"))]
pub fn load_gitlab_config() -> Option<String> {
    None
}

/// Clear GitLab credentials from OS keyring.
#[cfg(feature = "desktop")]
=======
/// Clear GitLab credentials from OS keyring.
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
pub fn clear_gitlab_config() {
    if let Ok(entry) = Entry::new(SERVICE, KEY_TOKEN) {
        let _ = entry.delete_credential();
    }
    if let Ok(entry) = Entry::new(SERVICE, KEY_PROJECT) {
        let _ = entry.delete_credential();
    }
}
<<<<<<< HEAD

/// Clear GitLab credentials (no-op on mobile).
#[cfg(not(feature = "desktop"))]
pub fn clear_gitlab_config() {}
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
