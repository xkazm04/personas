#[cfg(feature = "desktop")]
use keyring::Entry;

const SERVICE: &str = "personas-desktop";
const KEY_URL: &str = "cloud-orchestrator-url";
const KEY_API: &str = "cloud-api-key";

/// Store cloud orchestrator URL and API key in the OS keyring.
#[cfg(feature = "desktop")]
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

/// Store cloud orchestrator URL and API key (no-op on mobile).
#[cfg(not(feature = "desktop"))]
pub fn store_cloud_config(_url: &str, _api_key: &str) -> Result<(), String> {
    Ok(())
}

/// Load cloud config from OS keyring. Returns None if not configured.
#[cfg(feature = "desktop")]
pub fn load_cloud_config() -> Option<(String, String)> {
    let url = Entry::new(SERVICE, KEY_URL).ok()?.get_password().ok()?;
    let key = Entry::new(SERVICE, KEY_API).ok()?.get_password().ok()?;
    if url.is_empty() || key.is_empty() {
        return None;
    }
    Some((url, key))
}

/// Load cloud config (no keyring on mobile, always returns None).
#[cfg(not(feature = "desktop"))]
pub fn load_cloud_config() -> Option<(String, String)> {
    None
}

/// Keyring entries a disconnect removes. Only the secret: the orchestrator URL
/// is not a credential, and keeping it is what lets the app still name the
/// orchestrator where budgeted deployments and cloud triggers keep running
/// (and billing) after the local client lets go.
const KEYS_CLEARED_ON_DISCONNECT: &[&str] = &[KEY_API];

/// Clear the cloud API key from the OS keyring (the URL is kept).
///
/// A failed delete is an error: reporting success while the key is still in
/// the keyring tells the user they disconnected when the secret is still
/// there for the next reconnect. An entry that is already absent is success.
#[cfg(feature = "desktop")]
pub fn clear_cloud_config() -> Result<(), String> {
    clear_keys_with(|key| match Entry::new(SERVICE, key) {
        Ok(entry) => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        },
        Err(e) => Err(format!("keyring entry error: {e}")),
    })
}

/// Clear cloud config (no-op on mobile).
#[cfg(not(feature = "desktop"))]
pub fn clear_cloud_config() -> Result<(), String> {
    Ok(())
}

/// Delete every key in [`KEYS_CLEARED_ON_DISCONNECT`] through `delete`,
/// attempting all of them and returning the failures joined.
#[cfg_attr(not(feature = "desktop"), allow(dead_code))]
fn clear_keys_with(mut delete: impl FnMut(&str) -> Result<(), String>) -> Result<(), String> {
    let failures: Vec<String> = KEYS_CLEARED_ON_DISCONNECT
        .iter()
        .filter_map(|key| delete(key).err().map(|e| format!("{key}: {e}")))
        .collect();
    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Failed to delete cloud credentials from the OS keyring ({})",
            failures.join("; ")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disconnect_clears_the_secret_and_keeps_the_url() {
        assert!(KEYS_CLEARED_ON_DISCONNECT.contains(&KEY_API));
        assert!(!KEYS_CLEARED_ON_DISCONNECT.contains(&KEY_URL));
    }

    #[test]
    fn keyring_delete_failure_is_reported_not_swallowed() {
        let err = clear_keys_with(|_| Err("access denied".into())).unwrap_err();
        assert!(err.contains("access denied"), "{err}");
        assert!(err.contains(KEY_API), "{err}");

        let mut deleted = Vec::new();
        clear_keys_with(|key| {
            deleted.push(key.to_string());
            Ok(())
        })
        .unwrap();
        assert_eq!(deleted, vec![KEY_API.to_string()]);
    }
}
