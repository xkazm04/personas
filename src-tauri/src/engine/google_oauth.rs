use std::collections::HashMap;
use std::path::PathBuf;

/// Return the first non-empty value from the given environment variable keys.
pub fn env_var_first_nonempty(keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// Return the first non-empty value from the given keys found in `.env` files.
///
/// Searches `.env`, `../.env`, and `../../.env` relative to the working directory.
pub fn dotenv_var_first_nonempty(keys: &[&str]) -> Option<String> {
    let candidates = [
        PathBuf::from(".env"),
        PathBuf::from("../.env"),
        PathBuf::from("../../.env"),
    ];

    for path in candidates {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let mut map = HashMap::<String, String>::new();
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                if let Some((k, v)) = trimmed.split_once('=') {
                    map.insert(
                        k.trim().to_string(),
                        v.trim().trim_matches('"').trim_matches('\'').to_string(),
                    );
                }
            }

            for key in keys {
                if let Some(value) = map.get(*key) {
                    if !value.trim().is_empty() {
                        return Some(value.trim().to_string());
                    }
                }
            }
        }
    }

    None
}

/// Resolve an env value by checking compile-time embed, then runtime env vars,
/// then `.env` files. The `compile_time` parameter should come from `option_env!()`.
fn resolve_env_value(compile_time: Option<&str>, runtime_keys: &[&str]) -> Option<String> {
    compile_time
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .or_else(|| env_var_first_nonempty(runtime_keys))
        .or_else(|| dotenv_var_first_nonempty(runtime_keys))
}

/// Resolve Google OAuth client ID and secret from compile-time env, runtime env,
/// or `.env` files.
///
/// Returns `(client_id, client_secret)` on success.
pub fn resolve_google_oauth_env_credentials(
) -> Result<(String, String), crate::error::AppError> {
    let client_id = resolve_env_value(
        option_env!("GCP_CLIENT_ID"),
        &["GCP_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_CLIENT_ID"],
    );

    let client_secret = resolve_env_value(
        option_env!("GCP_CLIENT_SECRET"),
        &["GCP_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"],
    );

    match (client_id, client_secret) {
        (Some(id), Some(secret)) => Ok((id, secret)),
        _ => Err(crate::error::AppError::Validation(
            "Google OAuth client credentials are missing. Set GCP_CLIENT_ID and GCP_CLIENT_SECRET in app env/.env (or pass client credentials explicitly).".into(),
        )),
    }
}

/// Resolve Google OAuth **Desktop** client credentials for connector OAuth flows.
///
/// Desktop-type clients allow loopback redirect URIs (`http://127.0.0.1:{port}`)
/// which are required for the local callback server used during credential setup.
///
/// Falls back to the standard Web client credentials if no Desktop-specific
/// credentials are configured — this preserves backward compatibility but will
/// fail with `redirect_uri_mismatch` unless the Web client also permits
/// loopback redirects.
pub fn resolve_google_desktop_oauth_credentials(
) -> Result<(String, String), crate::error::AppError> {
    // Try Desktop-specific credentials first
    let desktop_id = resolve_env_value(
        option_env!("GCP_DESKTOP_CLIENT_ID"),
        &["GCP_DESKTOP_CLIENT_ID"],
    );

    let desktop_secret = resolve_env_value(
        option_env!("GCP_DESKTOP_CLIENT_SECRET"),
        &["GCP_DESKTOP_CLIENT_SECRET"],
    );

    if let (Some(id), Some(secret)) = (desktop_id, desktop_secret) {
        return Ok((id, secret));
    }

    // Fall back to standard credentials
    resolve_google_oauth_env_credentials()
}

/// Resolve Microsoft OAuth client credentials from compile-time env, runtime env,
/// or `.env` files.
///
/// Returns `(client_id, client_secret)` on success.
pub fn resolve_microsoft_oauth_credentials(
) -> Result<(String, String), crate::error::AppError> {
    let client_id = resolve_env_value(
        option_env!("MICROSOFT_CLIENT_ID"),
        &["MICROSOFT_CLIENT_ID"],
    );

    let client_secret = resolve_env_value(
        option_env!("MICROSOFT_CLIENT_SECRET"),
        &["MICROSOFT_CLIENT_SECRET"],
    );

    match (client_id, client_secret) {
        (Some(id), Some(secret)) => Ok((id, secret)),
        _ => Err(crate::error::AppError::Validation(
            "Microsoft OAuth client credentials are missing. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.".into(),
        )),
    }
}
