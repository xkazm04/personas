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

/// Resolve Google OAuth client ID and secret from compile-time env, runtime env,
/// or `.env` files.
///
/// Returns `(client_id, client_secret)` on success.
pub fn resolve_google_oauth_env_credentials(
) -> Result<(String, String), crate::error::AppError> {
    let client_id = option_env!("GCP_CLIENT_ID")
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .or_else(|| {
            env_var_first_nonempty(&[
                "GCP_CLIENT_ID",
                "GOOGLE_OAUTH_CLIENT_ID",
                "GOOGLE_CLIENT_ID",
            ])
        })
        .or_else(|| {
            dotenv_var_first_nonempty(&[
                "GCP_CLIENT_ID",
                "GOOGLE_OAUTH_CLIENT_ID",
                "GOOGLE_CLIENT_ID",
            ])
        });

    let client_secret = option_env!("GCP_CLIENT_SECRET")
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .or_else(|| {
            env_var_first_nonempty(&[
                "GCP_CLIENT_SECRET",
                "GOOGLE_OAUTH_CLIENT_SECRET",
                "GOOGLE_CLIENT_SECRET",
            ])
        })
        .or_else(|| {
            dotenv_var_first_nonempty(&[
                "GCP_CLIENT_SECRET",
                "GOOGLE_OAUTH_CLIENT_SECRET",
                "GOOGLE_CLIENT_SECRET",
            ])
        });

    match (client_id, client_secret) {
        (Some(id), Some(secret)) => Ok((id, secret)),
        _ => Err(crate::error::AppError::Validation(
            "Google OAuth client credentials are missing. Set GCP_CLIENT_ID and GCP_CLIENT_SECRET in app env/.env (or pass client credentials explicitly).".into(),
        )),
    }
}
