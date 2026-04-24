//! Credential resolution + env-var injection for a persona execution.
//!
//! Two entry points called by `run_execution` (in `super::mod`):
//!   · [`resolve_credential_env_vars`] — tool-driven match: for each tool the
//!     persona has, find a connector whose `services` JSON lists that tool,
//!     fall back to `requires_credential_type` matching, fall back again to
//!     direct service_type lookup.
//!   · [`inject_design_context_credentials`] — post-processing pass: pick up
//!     any connector named in the persona's design_context JSON that wasn't
//!     already covered by the tool match above. Keeps generic tools
//!     (`http_request`, …) able to reach connector creds.
//!
//! Both funnel into [`inject_connector_credentials`] → [`inject_credential`],
//! which decrypts the credential, refreshes its OAuth token if one is
//! present, and pushes every non-skipped field as an env var with the
//! `{CONNECTOR_UPPER}_{FIELD_UPPER}` naming convention. OAuth refresh is
//! serialised per credential via [`super::env::credential_refresh_lock`] so
//! two concurrent executions don't race and burn each other's grant.
//!
//! Every injected env var name passes through
//! [`super::env::sanitize_env_name`] before reaching the spawn map — the
//! denylist there is the final barrier against credential-driven env
//! hijacking of the child process.

use std::collections::HashMap;

use crate::db::models::PersonaToolDefinition;
use crate::db::repos::resources::{
    audit_log, connectors as connector_repo, credentials as cred_repo,
};
use crate::db::DbPool;

use super::env::{credential_refresh_lock, sanitize_env_name};

/// Resolve credentials for a persona's tools and return env var mappings + prompt hints.
///
/// Resolution strategy (per tool):
/// 1. **Primary**: Find connectors whose `services` JSON array lists this tool by name.
/// 2. **Fallback**: If no connector services match, use `tool.requires_credential_type`
///    to match against connector names or credential `service_type` values.
///
/// Each credential field is mapped to an env var: `{CONNECTOR_NAME_UPPER}_{FIELD_KEY_UPPER}`.
/// For OAuth credentials with a refresh_token, automatically refreshes the access_token.
/// Returns `(env_vars, hints, decryption_failures)`. If `decryption_failures`
/// is non-empty, the caller should abort execution and surface the names.
pub(crate) async fn resolve_credential_env_vars(
    pool: &DbPool,
    tools: &[PersonaToolDefinition],
    persona_id: &str,
    persona_name: &str,
) -> (Vec<(String, String)>, Vec<String>, Vec<String>, Vec<String>) {
    let mut env_vars: Vec<(String, String)> = Vec::new();
    let mut hints: Vec<String> = Vec::new();
    let mut failures: Vec<String> = Vec::new();
    // Names of connectors that had credentials successfully injected for this
    // execution. Deduped by connector.name. Used downstream to load
    // `metadata.llm_usage_hint` for the prompt's Connector Usage Reference
    // section.
    let mut injected_connector_names: Vec<String> = Vec::new();
    let mut seen_connectors: std::collections::HashSet<String> = std::collections::HashSet::new();

    let connectors = match connector_repo::get_all(pool) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Failed to load connectors for credential injection: {}", e);
            return (env_vars, hints, failures, injected_connector_names);
        }
    };

    for tool in tools {
        // -- Primary: match tool name in connector services --
        let mut matched_connector = false;
        for connector in &connectors {
            let services: Vec<serde_json::Value> =
                serde_json::from_str(&connector.services).unwrap_or_default();
            let tool_listed = services.iter().any(|s| {
                s.get("toolName")
                    .and_then(|v| v.as_str())
                    .map(|name| name == tool.name)
                    .unwrap_or(false)
            });

            if !tool_listed || !seen_connectors.insert(connector.name.clone()) {
                continue;
            }

            match inject_connector_credentials(
                pool,
                connector,
                &mut env_vars,
                &mut hints,
                persona_id,
                persona_name,
            ).await {
                Ok(true) => {
                    matched_connector = true;
                    injected_connector_names.push(connector.name.clone());
                }
                Ok(false) => {}
                Err(name) => { failures.push(name); }
            }
        }

        // -- Fallback: match via requires_credential_type --
        if !matched_connector {
            if let Some(ref cred_type) = tool.requires_credential_type {
                // Try matching connector by name (e.g. "google" -> connector named "google")
                // or by name prefix/substring for common patterns
                for connector in &connectors {
                    if !seen_connectors.insert(connector.name.clone()) {
                        continue;
                    }

                    let connector_matches = connector.name == *cred_type
                        || connector.name.starts_with(cred_type)
                        || cred_type.starts_with(&connector.name);

                    if !connector_matches {
                        continue;
                    }

                    match inject_connector_credentials(
                        pool,
                        connector,
                        &mut env_vars,
                        &mut hints,
                        persona_id,
                        persona_name,
                    ).await {
                        Ok(true) => {
                            matched_connector = true;
                            injected_connector_names.push(connector.name.clone());
                            break;
                        }
                        Ok(false) => {}
                        Err(name) => { failures.push(name); }
                    }
                }

                // Last resort: query credentials directly by service_type
                if !matched_connector {
                    if let Ok(creds) = cred_repo::get_by_service_type(pool, cred_type) {
                        if let Some(cred) = creds.first() {
                            if let Err(name) = inject_credential(
                                pool,
                                cred,
                                cred_type,
                                cred_type,
                                &mut env_vars,
                                &mut hints,
                                persona_id,
                                persona_name,
                            ).await {
                                failures.push(name);
                            }
                        }
                    }
                }
            }
        }
    }

    (env_vars, hints, failures, injected_connector_names)
}

/// Inject credentials for connectors referenced in the persona's design_context.
/// This ensures that generic tools (http_request, etc.) have access to all
/// connector credentials even when tool-name-based matching fails.
pub(super) async fn inject_design_context_credentials(
    pool: &DbPool,
    persona: &crate::db::models::Persona,
    env_vars: &mut Vec<(String, String)>,
    hints: &mut Vec<String>,
    injected_connector_names: &mut Vec<String>,
    persona_id: &str,
    persona_name: &str,
) {
    // Extract connector names from design_context JSON
    let dc = match &persona.design_context {
        Some(dc) => dc,
        None => return,
    };
    let parsed: serde_json::Value = match serde_json::from_str(dc) {
        Ok(v) => v,
        Err(_) => return,
    };

    // Connector names may be in useCases[].connectors or a top-level connectors/summary field
    let mut connector_names: Vec<String> = Vec::new();

    // Check useCases[].connectors (common pattern from promote)
    if let Some(use_cases) = parsed.get("useCases").and_then(|v| v.as_array()) {
        for uc in use_cases {
            if let Some(conns) = uc.get("connectors").and_then(|v| v.as_array()) {
                for c in conns {
                    if let Some(name) = c.get("name").and_then(|v| v.as_str()) {
                        connector_names.push(name.to_string());
                    }
                }
            }
        }
    }

    // Check summary.connectors (alternate pattern)
    if let Some(summary) = parsed.get("summary") {
        if let Some(conns) = summary.get("connectors").and_then(|v| v.as_array()) {
            for c in conns {
                if let Some(name) = c.as_str() {
                    connector_names.push(name.to_string());
                } else if let Some(name) = c.get("name").and_then(|v| v.as_str()) {
                    connector_names.push(name.to_string());
                }
            }
        }
    }

    // Also check last_design_result for required_connectors/suggested_connectors
    if let Some(ref ldr) = persona.last_design_result {
        if let Ok(dr) = serde_json::from_str::<serde_json::Value>(ldr) {
            for key in &["required_connectors", "suggested_connectors"] {
                if let Some(conns) = dr.get(key).and_then(|v| v.as_array()) {
                    for c in conns {
                        // Handle both string ("gmail") and object ({"name": "gmail"}) formats
                        if let Some(name) = c.as_str() {
                            connector_names.push(name.to_string());
                        } else if let Some(name) = c.get("name").and_then(|v| v.as_str()) {
                            connector_names.push(name.to_string());
                        }
                    }
                }
            }
        }
    }

    if connector_names.is_empty() { return; }

    // Deduplicate and skip connectors already injected
    let existing_prefixes: std::collections::HashSet<String> = env_vars.iter()
        .filter_map(|(k, _)| k.split('_').next().map(|p| p.to_lowercase()))
        .collect();

    let connectors = match connector_repo::get_all(pool) {
        Ok(c) => c,
        Err(_) => return,
    };

    for name in &connector_names {
        let name_lower = name.to_lowercase();
        // Skip if we already injected env vars for this connector
        if existing_prefixes.contains(&name_lower) { continue; }

        // Try to find a matching connector definition
        if let Some(conn) = connectors.iter().find(|c| c.name.to_lowercase() == name_lower) {
            if let Ok(true) = inject_connector_credentials(pool, conn, env_vars, hints, persona_id, persona_name).await {
                injected_connector_names.push(conn.name.clone());
            }
        } else {
            // Direct service_type lookup as fallback
            if let Ok(creds) = cred_repo::get_by_service_type(pool, name) {
                if let Some(cred) = creds.first() {
                    if inject_credential(pool, cred, name, name, env_vars, hints, persona_id, persona_name).await.is_ok() {
                        injected_connector_names.push(name.clone());
                    }
                }
            }
        }
    }
}

/// Decrypt and inject all fields from a connector's first credential as env vars.
/// Returns `Ok(true)` if credentials were found and injected, `Ok(false)` if none
/// found, or `Err(name)` if decryption failed.
pub(crate) async fn inject_connector_credentials(
    pool: &DbPool,
    connector: &crate::db::models::ConnectorDefinition,
    env_vars: &mut Vec<(String, String)>,
    hints: &mut Vec<String>,
    persona_id: &str,
    persona_name: &str,
) -> Result<bool, String> {
    let creds = match cred_repo::get_by_service_type(pool, &connector.name) {
        Ok(c) => c,
        Err(_) => return Ok(false),
    };

    if let Some(cred) = creds.first() {
        inject_credential(
            pool,
            cred,
            &connector.name,
            &connector.label,
            env_vars,
            hints,
            persona_id,
            persona_name,
        ).await?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Attempt to refresh an OAuth access_token using a stored refresh_token.
/// `override_client` can supply (client_id, client_secret) when the credential
/// itself doesn't store them (e.g. `app_managed` mode).
/// Returns the new access_token on success, or None on failure.
async fn try_refresh_oauth_token(
    fields: &HashMap<String, String>,
    connector_name: &str,
    override_client: Option<(&str, &str)>,
) -> Option<String> {
    let refresh_token = fields.get("refresh_token").filter(|v| !v.is_empty())?;

    // Resolve client credentials: prefer fields, then override, then fail
    let (cid, csec) = if let (Some(id), Some(secret)) = (
        fields.get("client_id").filter(|v| !v.is_empty()),
        fields.get("client_secret").filter(|v| !v.is_empty()),
    ) {
        (id.clone(), secret.clone())
    } else if let Some((id, secret)) = override_client {
        (id.to_string(), secret.to_string())
    } else {
        tracing::debug!("No client credentials available for OAuth refresh of '{}'", connector_name);
        return None;
    };
    let client_id = &cid;
    let client_secret = &csec;

    // Determine the token endpoint based on connector type
    let token_url = match connector_name {
        n if n.starts_with("google") || n == "gmail" || n == "google_calendar" || n == "google_drive" => {
            "https://oauth2.googleapis.com/token"
        }
        "microsoft" => "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "slack" => "https://slack.com/api/oauth.v2.access",
        "github" => "https://github.com/login/oauth/access_token",
        _ => return None, // Unknown provider -- skip refresh
    };

    tracing::info!("Refreshing OAuth access token for connector '{}'", connector_name);

    let response = crate::SHARED_HTTP
        .post(token_url)
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        tracing::warn!("OAuth token refresh failed for '{}' ({}): {}", connector_name, status, body);
        return None;
    }

    let value: serde_json::Value = response.json().await.ok()?;
    let new_token = value.get("access_token")?.as_str()?.to_string();

    tracing::info!("Successfully refreshed OAuth access token for '{}'", connector_name);
    Some(new_token)
}

/// Decrypt a single credential and inject its fields as env vars.
/// For OAuth credentials, automatically refreshes expired access tokens.
/// Returns `Err` with the credential name if decryption fails.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn inject_credential(
    pool: &DbPool,
    cred: &crate::db::models::PersonaCredential,
    connector_name: &str,
    connector_label: &str,
    env_vars: &mut Vec<(String, String)>,
    hints: &mut Vec<String>,
    persona_id: &str,
    persona_name: &str,
) -> Result<(), String> {
    let mut fields: HashMap<String, String> = match cred_repo::get_decrypted_fields(pool, cred) {
        Ok(f) => f,
        Err(e) => {
            tracing::error!("Failed to decrypt credential '{}': {}", cred.name, e);
            return Err(cred.name.clone());
        }
    };
    let prefix = connector_name.to_uppercase().replace('-', "_");

    // Auto-refresh OAuth token if refresh_token is present.
    // For app_managed credentials (no client_id in fields), resolve from platform env.
    // Locked per credential ID to prevent concurrent refreshes from racing.
    if fields.get("refresh_token").is_some_and(|v| !v.is_empty()) {
        let refresh_handle = credential_refresh_lock(&cred.id);
        let _guard = refresh_handle.value.lock().await;

        // Re-read the credential inside the lock to pick up any token refreshed
        // by a concurrent execution that held the lock before us.
        if let Ok(re_read_cred) = cred_repo::get_by_id(pool, &cred.id) {
            if let Ok(fresh_fields) = cred_repo::get_decrypted_fields(pool, &re_read_cred) {
                fields = fresh_fields;
            }
        }

        let override_client = if fields.get("client_id").map_or(true, |v| v.is_empty()) {
            // Resolve platform-managed client credentials for OAuth connectors
            let is_google = connector_name.starts_with("google")
                || connector_name == "gmail"
                || connector_name == "google_calendar"
                || connector_name == "google_drive";
            let is_microsoft = connector_name.starts_with("microsoft")
                || connector_name == "onedrive"
                || connector_name == "sharepoint";
            if is_google {
                crate::engine::google_oauth::resolve_google_desktop_oauth_credentials()
                    .ok()
            } else if is_microsoft {
                crate::engine::google_oauth::resolve_microsoft_oauth_credentials()
                    .ok()
            } else {
                None
            }
        } else {
            None
        };
        let override_ref = override_client.as_ref().map(|(id, sec)| (id.as_str(), sec.as_str()));
        if let Some(fresh_token) = try_refresh_oauth_token(&fields, connector_name, override_ref).await {
            fields.insert("access_token".to_string(), fresh_token.clone());
            // Persist the refreshed token back to field-level storage
            if let Err(e) = cred_repo::save_fields(pool, &cred.id, &fields) {
                tracing::error!(credential_id = %cred.id, credential_name = %cred.name, "Failed to persist refreshed OAuth token: {e}");
            }
        }
    }

    // Internal metadata fields that shouldn't be exposed as env vars
    const SKIP_FIELDS: &[&str] = &[
        "oauth_client_mode", "client_id", "client_secret",
        "token_type", "expiry_date", "expires_in",
    ];

    for (field_key, field_val) in &fields {
        if SKIP_FIELDS.contains(&field_key.as_str()) || field_val.is_empty() {
            continue;
        }
        let raw_key = format!("{}_{}", prefix, field_key);
        let env_key = match sanitize_env_name(&raw_key) {
            Some(k) => k,
            None => continue,
        };
        env_vars.push((env_key.clone(), field_val.clone()));
        hints.push(format!(
            "`{}` (from {} credential '{}')",
            env_key, connector_label, cred.name
        ));
    }

    // Add well-known aliases for Google connectors so the CLI finds credentials
    // regardless of whether it looks for GMAIL_ACCESS_TOKEN or GOOGLE_ACCESS_TOKEN.
    let is_google_family = connector_name.starts_with("google")
        || connector_name == "gmail"
        || connector_name == "google_calendar"
        || connector_name == "google_drive"
        || connector_name == "google_sheets";
    if is_google_family && prefix != "GOOGLE" {
        if let Some(access_token) = fields.get("access_token").filter(|v| !v.is_empty()) {
            env_vars.push(("GOOGLE_ACCESS_TOKEN".to_string(), access_token.clone()));
        }
        if let Some(refresh_token) = fields.get("refresh_token").filter(|v| !v.is_empty()) {
            env_vars.push(("GOOGLE_REFRESH_TOKEN".to_string(), refresh_token.clone()));
        }
    }

    let _ = cred_repo::record_usage(pool, &cred.id);
    let _ = audit_log::insert(
        pool,
        &cred.id,
        &cred.name,
        "decrypt",
        Some(persona_id),
        Some(persona_name),
        Some(&format!("injected via connector '{connector_label}'")),
    );

    Ok(())
}
