use keyring::Entry;

const SERVICE: &str = "personas-desktop";
const KEY_TOKEN: &str = "gitlab-token";
const KEY_PROJECT: &str = "gitlab-project-id";

/// Store GitLab PAT in the OS keyring.
pub fn store_gitlab_config(token: &str) -> Result<(), String> {
    Entry::new(SERVICE, KEY_TOKEN)
        .map_err(|e| format!("keyring entry error: {e}"))?
        .set_password(token)
        .map_err(|e| format!("Failed to store GitLab token: {e}"))?;
    Ok(())
}

/// Load GitLab PAT from OS keyring. Returns None if not configured.
pub fn load_gitlab_config() -> Option<String> {
    let token = Entry::new(SERVICE, KEY_TOKEN).ok()?.get_password().ok()?;
    if token.is_empty() {
        return None;
    }
    Some(token)
}

/// Clear GitLab credentials from OS keyring.
pub fn clear_gitlab_config() {
    if let Ok(entry) = Entry::new(SERVICE, KEY_TOKEN) {
        let _ = entry.delete_credential();
    }
    if let Ok(entry) = Entry::new(SERVICE, KEY_PROJECT) {
        let _ = entry.delete_credential();
    }
}
