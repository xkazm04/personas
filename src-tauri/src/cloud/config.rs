use keyring::Entry;

const SERVICE: &str = "personas-desktop";
const KEY_URL: &str = "cloud-orchestrator-url";
const KEY_API: &str = "cloud-api-key";

/// Store cloud orchestrator URL and API key in the OS keyring.
pub fn store_cloud_config(url: &str, api_key: &str) -> Result<(), String> {
    Entry::new(SERVICE, KEY_URL)
        .map_err(|e| format!("keyring entry error: {e}"))?
        .set_password(url)
        .map_err(|e| format!("Failed to store cloud URL: {e}"))?;

    Entry::new(SERVICE, KEY_API)
        .map_err(|e| format!("keyring entry error: {e}"))?
        .set_password(api_key)
        .map_err(|e| format!("Failed to store cloud API key: {e}"))?;

    Ok(())
}

/// Load cloud config from OS keyring. Returns None if not configured.
pub fn load_cloud_config() -> Option<(String, String)> {
    let url = Entry::new(SERVICE, KEY_URL).ok()?.get_password().ok()?;
    let key = Entry::new(SERVICE, KEY_API).ok()?.get_password().ok()?;
    if url.is_empty() || key.is_empty() {
        return None;
    }
    Some((url, key))
}

/// Clear cloud config from OS keyring.
pub fn clear_cloud_config() {
    if let Ok(entry) = Entry::new(SERVICE, KEY_URL) {
        let _ = entry.delete_credential();
    }
    if let Ok(entry) = Entry::new(SERVICE, KEY_API) {
        let _ = entry.delete_credential();
    }
}
