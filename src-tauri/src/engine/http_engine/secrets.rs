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

/// The stored provider secret (OS keyring, then env), independent of endpoint.
fn load_stored_key() -> Option<String> {
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

/// Whether the STORED provider secret (keyring `qwen-api-key`, or
/// `QWEN_API_KEY`/`DASHSCOPE_API_KEY`) may be attached to `base_url`.
///
/// That secret is scoped to the provider it was issued by. `base_url`, however,
/// replaces the endpoint wholesale — scheme and authority — and it does not
/// always come from the user: it is copied verbatim out of an imported
/// portability bundle and lifted verbatim out of an adopted template's
/// `persona_meta`. Attaching a keyring-resolved credential to an endpoint the
/// user never configured hands the user's real API key to whoever authored that
/// JSON.
///
/// Two endpoints are trusted, and deliberately no others:
///
/// * the provider's own host (the [`DEFAULT_BASE_URL`] authority) — the key was
///   issued for it;
/// * a **provably** local host — an IP literal in a private/loopback range, or
///   the reserved name `localhost` — because a local Ollama / LM Studio / vLLM
///   at `http://127.0.0.1:11434/v1` is the headline BYOM use case and such a
///   request cannot leave the machine or the LAN.
///
/// "Provably" is doing real work. The obvious implementation — reuse
/// `url_safety::is_url_target_private` — is WRONG here, and was written that way
/// first: that predicate answers "should this request be BLOCKED", so its list
/// includes the `.internal` / `.local` / `.localhost` *domain suffixes*, and
/// `metadata.google.internal` is a member. Used in the allow direction it would
/// have handed the user's stored key to the cloud-metadata endpoint — the exact
/// destination the other half of this change exists to keep traffic away from.
/// A block-list and an allow-list are not each other's complement; only an
/// address that needs no DNS to resolve can be *proved* local.
///
/// Anything else must bring its own `auth_token`, which is an explicit act by
/// whoever set the endpoint. This is a check on the CREDENTIAL, not on the
/// request: it deliberately does NOT use `validate_url_safety`, which rejects
/// loopback and would break local BYOM outright.
pub(super) fn stored_key_allowed_for(base_url: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(base_url) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };

    // The provider's own endpoint.
    if let Ok(default) = reqwest::Url::parse(super::config::DEFAULT_BASE_URL) {
        if default
            .host_str()
            .is_some_and(|d| d.eq_ignore_ascii_case(host))
        {
            return true;
        }
    }

    // A local inference server. IP LITERALS ONLY, plus the RFC 6761 reserved
    // name `localhost` — never a domain suffix (see the doc comment).
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    // `host_str()` keeps the brackets on an IPv6 literal; strip them to parse.
    match host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<std::net::IpAddr>()
    {
        Ok(ip) => crate::engine::url_safety::is_private_ip(ip),
        Err(_) => false,
    }
}

/// Resolve the provider API key for `base_url`: profile override → stored
/// secret, the latter only for an endpoint the user actually configured.
///
/// Returns `Err(reason)` — a user-facing message — rather than `None`, because
/// "no key configured" and "there is a key but this endpoint must not have it"
/// need different remedies.
pub(super) fn resolve_api_key(
    model_profile: &ModelProfile,
    base_url: &str,
) -> Result<String, String> {
    // An explicit per-profile token is the endpoint's OWN credential: whoever
    // set the endpoint set the token beside it, and it is not the user's stored
    // secret. Honoured for any endpoint.
    if let Some(t) = model_profile.auth_token.as_deref() {
        if !t.is_empty() {
            return Ok(t.to_string());
        }
    }

    match load_stored_key() {
        Some(k) if stored_key_allowed_for(base_url) => Ok(k),
        Some(_) => Err(format!(
            "Refusing to send the stored provider API key to '{base_url}': it is neither the \
             configured provider endpoint ({}) nor a local inference server. If you set this \
             endpoint on purpose, give this persona's model profile its own auth token. If you \
             did not, it arrived with an imported bundle or an adopted template — clear it.",
            super::config::DEFAULT_BASE_URL
        )),
        None => Err(
            "No API key for the remote provider. Set it in the keyring (qwen-api-key) or \
             QWEN_API_KEY/DASHSCOPE_API_KEY."
                .to_string(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile_with_token(token: Option<&str>) -> ModelProfile {
        ModelProfile {
            model: None,
            provider: Some("qwen".into()),
            base_url: None,
            auth_token: token.map(String::from),
            prompt_cache_policy: None,
            effort: None,
        }
    }

    #[test]
    fn stored_key_travels_to_the_provider_endpoint() {
        assert!(stored_key_allowed_for(
            super::super::config::DEFAULT_BASE_URL
        ));
        // Same authority, different path/scheme casing.
        assert!(stored_key_allowed_for(
            "https://DASHSCOPE-INTL.aliyuncs.com/compatible-mode/v1"
        ));
    }

    /// The headline BYOM case. If this ever fails, local Ollama/LM Studio is
    /// broken and the fix is wrong.
    #[test]
    fn stored_key_travels_to_a_local_inference_server() {
        for url in [
            "http://127.0.0.1:11434/v1",
            "http://localhost:1234/v1",
            "http://[::1]:11434/v1",
            "http://192.168.1.50:8000/v1",
            "http://10.0.0.4:8000/v1",
        ] {
            assert!(stored_key_allowed_for(url), "{url} must stay usable");
        }
    }

    #[test]
    fn stored_key_never_travels_to_an_unconfigured_host() {
        for url in [
            "https://attacker.tld/v1",
            "https://dashscope-intl.aliyuncs.com.attacker.tld/v1",
            "http://8.8.8.8/v1",
            "not a url",
            // A hostname is never PROVABLY local. `.internal` in particular is
            // the cloud-metadata suffix — `is_url_target_private` calls it
            // private (correctly, for blocking) and an earlier draft of this
            // function therefore allowed the stored key to travel to it.
            "http://metadata.google.internal/v1",
            "http://ollama.local:11434/v1",
            "http://box.lan:11434/v1",
        ] {
            assert!(!stored_key_allowed_for(url), "{url} must be refused");
        }
    }

    #[test]
    fn explicit_profile_token_is_honoured_anywhere() {
        let got = resolve_api_key(
            &profile_with_token(Some("sk-explicit")),
            "https://attacker.tld/v1",
        )
        .expect("an explicit profile token is the endpoint's own credential");
        assert_eq!(got, "sk-explicit");
    }

    #[test]
    fn refusal_names_the_endpoint_and_the_remedy() {
        // Guarantee a stored key exists for this process regardless of the dev
        // box's keyring state.
        std::env::set_var("QWEN_API_KEY", "sk-stored-secret");
        let err = resolve_api_key(&profile_with_token(None), "https://attacker.tld/v1")
            .expect_err("a stored key must not reach an unconfigured endpoint");
        assert!(err.contains("attacker.tld"), "{err}");
        assert!(
            !err.contains("sk-stored-secret"),
            "must not echo the secret: {err}"
        );

        // ...and the same profile still works against a local BYOM endpoint.
        let ok = resolve_api_key(&profile_with_token(None), "http://127.0.0.1:11434/v1");
        assert!(ok.is_ok(), "local BYOM must still resolve a key: {ok:?}");
    }
}
