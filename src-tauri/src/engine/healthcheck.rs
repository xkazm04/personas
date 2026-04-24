use std::collections::HashMap;
use std::net::IpAddr;
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;
use tracing;

use crate::db::repos::resources::audit_log;
use crate::db::repos::resources::connectors as connector_repo;
use crate::db::repos::resources::credentials as cred_repo;
use crate::db::DbPool;
use crate::error::AppError;
use crate::utils::sanitization::sanitize_secrets;

use super::connector_strategy;
#[cfg(feature = "desktop")]
use super::desktop_discovery;

/// Result of a credential healthcheck.
#[derive(Debug, serde::Serialize)]
pub struct HealthcheckResult {
    pub success: bool,
    pub message: String,
}

/// Inspect a credential's stored metadata JSON for `source == "cli"` so the
/// healthcheck path can route CLI-owned credentials to the CLI verify helper
/// instead of the HTTP path.
fn is_cli_sourced(metadata: &Option<String>) -> bool {
    let Some(raw) = metadata.as_deref() else { return false };
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|v| v.get("source").and_then(|s| s.as_str()).map(str::to_string))
        .is_some_and(|s| s == "cli")
}

// ---------------------------------------------------------------------------
// CLI-based healthcheck for locally-installed tools
// ---------------------------------------------------------------------------

/// CLI probe definition for healthcheck purposes.
struct CliHealthProbe {
    service_type: &'static str,
    cmd: &'static str,
    args: &'static [&'static str],
    tool_name: &'static str,
}

/// Known CLI tools that can be probed to verify installation and authentication.
/// Mirrors the detection probes in `auth_detect.rs`.
const CLI_HEALTH_PROBES: &[CliHealthProbe] = &[
    CliHealthProbe {
        service_type: "github",
        cmd: "gh",
        args: &["auth", "status"],
        tool_name: "GitHub CLI (gh)",
    },
    CliHealthProbe {
        service_type: "aws_cloud",
        cmd: "aws",
        args: &["sts", "get-caller-identity", "--output", "text", "--query", "Arn"],
        tool_name: "AWS CLI (aws)",
    },
    CliHealthProbe {
        service_type: "gcp_cloud",
        cmd: "gcloud",
        args: &["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"],
        tool_name: "Google Cloud CLI (gcloud)",
    },
    CliHealthProbe {
        service_type: "azure_cloud",
        cmd: "az",
        args: &["account", "show", "--query", "user.name", "-o", "tsv"],
        tool_name: "Azure CLI (az)",
    },
    CliHealthProbe {
        service_type: "docker",
        cmd: "docker",
        args: &["info", "--format", "{{.ID}}"],
        tool_name: "Docker CLI (docker)",
    },
    CliHealthProbe {
        service_type: "kubernetes",
        cmd: "kubectl",
        args: &["config", "current-context"],
        tool_name: "Kubernetes CLI (kubectl)",
    },
    CliHealthProbe {
        service_type: "heroku",
        cmd: "heroku",
        args: &["auth:whoami"],
        tool_name: "Heroku CLI (heroku)",
    },
    CliHealthProbe {
        service_type: "vercel",
        cmd: "vercel",
        args: &["whoami"],
        tool_name: "Vercel CLI (vercel)",
    },
    CliHealthProbe {
        service_type: "netlify",
        cmd: "netlify",
        args: &["status"],
        tool_name: "Netlify CLI (netlify)",
    },
];

/// Try a CLI-based healthcheck for services that have local CLI tools.
///
/// Returns `Some(result)` if a CLI probe exists for this service type,
/// `None` if no probe is defined (caller should fall back to skip behaviour).
async fn try_cli_healthcheck(service_type: &str) -> Option<HealthcheckResult> {
    let probe = CLI_HEALTH_PROBES.iter().find(|p| p.service_type == service_type)?;

    tracing::debug!(
        service_type = %service_type,
        cmd = %probe.cmd,
        "running CLI healthcheck probe"
    );

    let result = timeout(Duration::from_secs(5), async {
        let mut cmd = Command::new(probe.cmd);
        cmd.args(probe.args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        // Prevent empty console windows flashing on Windows.
        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        cmd.spawn()
            .ok()?
            .wait_with_output()
            .await
            .ok()
    })
    .await;

    match result {
        Ok(Some(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let combined = format!("{}\n{}", stdout, stderr).trim().to_string();

            if output.status.success() && !combined.is_empty() {
                Some(HealthcheckResult {
                    success: true,
                    message: format!("{} is installed and authenticated", probe.tool_name),
                })
            } else if combined.is_empty() && !output.status.success() {
                // Command found but returned error with no output — not authenticated
                Some(HealthcheckResult {
                    success: false,
                    message: format!(
                        "{} is installed but not authenticated — run `{} auth` or equivalent",
                        probe.tool_name, probe.cmd,
                    ),
                })
            } else {
                // Command ran but exited non-zero — likely not authenticated
                Some(HealthcheckResult {
                    success: false,
                    message: format!(
                        "{} is installed but not authenticated — run `{} auth` or equivalent",
                        probe.tool_name, probe.cmd,
                    ),
                })
            }
        }
        Ok(None) => {
            // spawn() returned None — command not found on PATH
            Some(HealthcheckResult {
                success: false,
                message: format!("{} is not installed — install it and try again", probe.tool_name),
            })
        }
        Err(_) => {
            // Timeout
            Some(HealthcheckResult {
                success: false,
                message: format!("{} timed out — the tool may be unresponsive", probe.tool_name),
            })
        }
    }
}

// ---------------------------------------------------------------------------
// Desktop-app healthcheck (binary presence detection)
// ---------------------------------------------------------------------------

/// Desktop connector names that map to `desktop_discovery` app entries.
const DESKTOP_CONNECTOR_MAP: &[(&str, &str)] = &[
    ("desktop_docker", "Docker"),
    ("desktop_obsidian", "Obsidian"),
    ("desktop_browser", "Browser (Chrome/Edge)"),
];

/// Try a desktop-app-based healthcheck by verifying the app binary is installed.
///
/// Returns `Some(result)` if the service_type is a known desktop connector,
/// `None` otherwise.
fn try_desktop_healthcheck(service_type: &str) -> Option<HealthcheckResult> {
    let (connector_name, label) = DESKTOP_CONNECTOR_MAP
        .iter()
        .find(|(name, _)| *name == service_type)?;

    // Without the `desktop` feature the discovery helper isn't compiled; report
    // installation as unknown so the caller falls back to its other strategies
    // (CLI probes, HTTP pings). Keeps non-desktop builds linkable.
    #[cfg(feature = "desktop")]
    let (installed, binary_path) = desktop_discovery::is_desktop_app_installed(connector_name);
    #[cfg(not(feature = "desktop"))]
    let (installed, binary_path): (bool, Option<String>) = (false, None);

    if installed {
        let path_info = binary_path
            .map(|p| format!(" ({})", p))
            .unwrap_or_default();
        Some(HealthcheckResult {
            success: true,
            message: format!("{label} is installed{path_info}"),
        })
    } else {
        Some(HealthcheckResult {
            success: false,
            message: format!("{label} is not installed — install it and try again"),
        })
    }
}

/// Race CLI and desktop healthcheck probes concurrently.
///
/// When both a CLI probe and a desktop probe exist for a service type, they are
/// run in parallel via `tokio::select!`. The first successful result wins.  If
/// neither probe exists, returns `None` so the caller can fall back to a
/// generic "stored" message.
async fn race_local_probes(service_type: &str) -> Option<HealthcheckResult> {
    let has_cli = CLI_HEALTH_PROBES.iter().any(|p| p.service_type == service_type);
    let has_desktop = DESKTOP_CONNECTOR_MAP.iter().any(|(n, _)| *n == service_type);

    match (has_cli, has_desktop) {
        (true, true) => {
            // Race both probes concurrently -- return first success or last failure
            tokio::select! {
                Some(cli) = try_cli_healthcheck(service_type) => {
                    if cli.success {
                        return Some(cli);
                    }
                    // CLI failed, still check desktop
                    try_desktop_healthcheck(service_type).or(Some(cli))
                }
                // Desktop check is synchronous and instant; wrap in async block
                desktop = async { try_desktop_healthcheck(service_type) } => {
                    if desktop.as_ref().is_some_and(|r| r.success) {
                        return desktop;
                    }
                    // Desktop failed or absent, wait for CLI
                    match try_cli_healthcheck(service_type).await {
                        Some(cli) => Some(cli),
                        None => desktop,
                    }
                }
            }
        }
        (true, false) => try_cli_healthcheck(service_type).await,
        (false, true) => try_desktop_healthcheck(service_type),
        (false, false) => None,
    }
}

/// Run a healthcheck for a stored credential.
///
/// 1. Load credential from DB
/// 2. Decrypt credential data
/// 3. Find matching connector with healthcheck_config
/// 4. Send HTTP request with auth
/// 5. Return success/failure
pub async fn run_healthcheck(
    pool: &DbPool,
    credential_id: &str,
) -> Result<HealthcheckResult, AppError> {
    // Load credential
    let cred = cred_repo::get_by_id(pool, credential_id)?;

    // Credentials captured via CLI carry `metadata.source = "cli"`. Their
    // stored field values are short-lived access tokens that won't satisfy
    // HTTP healthcheck contracts, so re-run the CLI verify step instead.
    if is_cli_sourced(&cred.metadata) {
        let verify = crate::commands::credentials::cli_capture::run_verify(&cred.service_type).await;
        return Ok(HealthcheckResult {
            success: verify.authenticated,
            message: verify.message,
        });
    }

    let fields = cred_repo::get_decrypted_fields(pool, &cred)?;

    if let Err(e) = audit_log::log_decrypt(pool, credential_id, &cred.name, "healthcheck", None, None) {
        tracing::warn!(credential_id, error = %e, "Failed to write audit log for credential decrypt");
    }

    let (connector, hc_config) = resolve_connector_healthcheck(pool, &cred.service_type, Some(&fields))?;

    // If the matched variant says to skip HTTP healthcheck, race CLI + desktop probes
    if hc_config.skip {
        if let Some(result) = race_local_probes(&cred.service_type).await {
            tracing::debug!(
                credential_id = %credential_id,
                service_type = %cred.service_type,
                success = result.success,
                "healthcheck via local probe (CLI or desktop)"
            );
            return Ok(result);
        }
        tracing::debug!(
            credential_id = %credential_id,
            service_type = %cred.service_type,
            "healthcheck skipped: no HTTP, CLI, or desktop healthcheck available"
        );
        return Ok(HealthcheckResult {
            success: true,
            message: "Connection type does not support HTTP healthcheck -- credentials stored".into(),
        });
    }

    // Resolve auth token via connector strategy.
    // For OAuth credentials, acquire a per-credential lock to prevent concurrent
    // token exchanges with the background refresh tick (see oauth_refresh_lock).
    let strategy = connector_strategy::registry()?.get(&cred.service_type, connector.metadata.as_deref());
    let (token, fields) = if strategy.is_oauth(&fields) {
        let _lock = super::oauth_refresh_lock::acquire(credential_id).await;
        // Re-read fields inside the lock — a concurrent refresh may have already
        // persisted a fresh access_token while we were waiting.
        let fresh_fields = cred_repo::get_decrypted_fields(pool, &cred)?;
        if let Err(e) = audit_log::log_decrypt(pool, credential_id, &cred.name, "healthcheck_locked", None, None) {
            tracing::warn!(credential_id, error = %e, "Failed to write audit log for credential decrypt");
        }
        let token = strategy.resolve_auth_token(connector.metadata.as_deref(), &fresh_fields).await?
            .map(|r| r.token);
        (token, fresh_fields)
    } else {
        let token = strategy.resolve_auth_token(connector.metadata.as_deref(), &fields).await?
            .map(|r| r.token);
        (token, fields)
    };

    execute_healthcheck_request_with_strategy(
        strategy, &hc_config, &fields, token,
        credential_id, &cred.service_type,
    ).await
}

pub async fn run_healthcheck_with_fields(
    pool: &DbPool,
    service_type: &str,
    fields: &HashMap<String, String>,
) -> Result<HealthcheckResult, AppError> {
    let (connector, hc_config) = resolve_connector_healthcheck(pool, service_type, Some(fields))?;

    // If the matched variant says to skip HTTP healthcheck, race CLI + desktop probes
    if hc_config.skip {
        if let Some(result) = race_local_probes(service_type).await {
            tracing::debug!(
                service_type = %service_type,
                success = result.success,
                "healthcheck via local probe (CLI or desktop)"
            );
            return Ok(result);
        }
        tracing::debug!(
            service_type = %service_type,
            "healthcheck skipped: no HTTP, CLI, or desktop healthcheck available"
        );
        return Ok(HealthcheckResult {
            success: true,
            message: "Connection type does not support HTTP healthcheck -- credentials stored".into(),
        });
    }

    let strategy = connector_strategy::registry()?.get(service_type, connector.metadata.as_deref());
    let token = strategy.resolve_auth_token(connector.metadata.as_deref(), fields).await?
        .map(|r| r.token);

    execute_healthcheck_request_with_strategy(
        strategy, &hc_config, fields, token,
        "", service_type,
    ).await
}

/// Try to find a matching auth_variant for the given fields and return its
/// healthcheck_config if present.  Falls back to the connector-level config.
fn resolve_connector_healthcheck(
    pool: &DbPool,
    service_type: &str,
    fields: Option<&HashMap<String, String>>,
) -> Result<(crate::db::models::ConnectorDefinition, HealthcheckConfig), AppError> {
    let connectors = connector_repo::get_all(pool)?;
    let connector = connectors
        .iter()
        .find(|c| c.name == service_type)
        .cloned();

    let connector = match connector {
        Some(c) => c,
        None => {
            return Err(AppError::NotFound(format!(
                "No connector definition found for '{service_type}'"
            )));
        }
    };

    // -- Try per-variant healthcheck first ------------------------------
    if let (Some(flds), Some(meta_json)) = (fields, connector.metadata.as_deref()) {
        if let Some(hc) = resolve_variant_healthcheck(meta_json, flds) {
            return Ok((connector, hc));
        }
    }

    // -- Fall back to connector-level healthcheck config ----------------
    let hc_config = match &connector.healthcheck_config {
        Some(json_str) => parse_healthcheck_config(json_str),
        None => None,
    };

    // If no connector-level config, try OAuth provider fallback
    let hc_config = match hc_config {
        Some(hc) => hc,
        None => {
            // Check if credential fields or connector metadata indicate an OAuth provider
            let provider = fields
                .and_then(|f| f.get("oauth_provider").or_else(|| f.get("oauth_scope").and(None)))
                .cloned()
                .or_else(|| {
                    connector.metadata.as_deref()
                        .and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok())
                        .and_then(|v| v.get("oauth_type").and_then(|t| t.as_str().map(String::from)))
                });

            match provider.as_deref().and_then(resolve_oauth_provider_healthcheck) {
                Some(hc) => {
                    return Ok((connector, hc));
                }
                None => {
                    // No healthcheck configured -- return a skip-flagged config
                    // so callers treat it as a non-error success.
                    return Ok((connector, HealthcheckConfig {
                        endpoint: String::new(),
                        method: None,
                        headers: HashMap::new(),
                        body: None,
                        skip: true,
                    }));
                }
            }
        }
    };

    Ok((connector, hc_config))
}

/// Match the supplied field values to an auth_variant and return its
/// variant-specific healthcheck config if present.
fn resolve_variant_healthcheck(
    metadata_json: &str,
    fields: &HashMap<String, String>,
) -> Option<HealthcheckConfig> {
    let meta: serde_json::Value = serde_json::from_str(metadata_json).ok()?;
    let variants = meta.get("auth_variants")?.as_array()?;
    if variants.is_empty() {
        return None;
    }

    // Score each variant: how many of its declared fields have non-empty values
    let mut best: Option<(&serde_json::Value, usize)> = None;
    for v in variants {
        let vf = match v.get("fields").and_then(|f| f.as_array()) {
            Some(a) => a,
            None => continue,
        };
        let filled = vf.iter().filter(|k| {
            k.as_str()
                .map(|s| fields.get(s).is_some_and(|val| !val.is_empty()))
                .unwrap_or(false)
        }).count();
        if filled == 0 { continue; }
        // Prefer the variant where ALL declared fields are filled
        if filled == vf.len() {
            // Exact match -- check for variant-level healthcheck
            if v.get("healthcheck_skip").and_then(|s| s.as_bool()).unwrap_or(false) {
                return Some(HealthcheckConfig {
                    endpoint: String::new(),
                    method: None,
                    headers: HashMap::new(),
                    body: None,
                    skip: true,
                });
            }
            if let Some(hc_val) = v.get("healthcheck_config") {
                if let Ok(hc_str) = serde_json::to_string(hc_val) {
                    return parse_healthcheck_config(&hc_str);
                }
            }
            // Variant matched but has no variant-level healthcheck -- fall through
            // to connector-level config.
            return None;
        }
        // Track partial best match
        match &best {
            Some((_, score)) if filled <= *score => {}
            _ => { best = Some((v, filled)); }
        }
    }

    // If no exact match, try best partial match
    if let Some((v, _)) = best {
        if v.get("healthcheck_skip").and_then(|s| s.as_bool()).unwrap_or(false) {
            return Some(HealthcheckConfig {
                endpoint: String::new(),
                method: None,
                headers: HashMap::new(),
                body: None,
                skip: true,
            });
        }
        if let Some(hc_val) = v.get("healthcheck_config") {
            if let Ok(hc_str) = serde_json::to_string(hc_val) {
                return parse_healthcheck_config(&hc_str);
            }
        }
    }

    None
}

/// Built-in healthcheck endpoints for known OAuth providers.
/// Used as fallback when a connector has no explicit healthcheck_config
/// but the credential was created via provider OAuth.
fn resolve_oauth_provider_healthcheck(provider: &str) -> Option<HealthcheckConfig> {
    let (endpoint, method, headers, body) = match provider.to_lowercase().as_str() {
        "github" => (
            "https://api.github.com/user",
            "GET",
            vec![("User-Agent", "Personas-Desktop/1.0")],
            None,
        ),
        "slack" => (
            "https://slack.com/api/auth.test",
            "POST",
            vec![],
            None,
        ),
        "microsoft" => (
            "https://graph.microsoft.com/v1.0/me",
            "GET",
            vec![],
            None,
        ),
        "atlassian" => (
            "https://api.atlassian.com/me",
            "GET",
            vec![],
            None,
        ),
        "discord" => (
            "https://discord.com/api/v10/users/@me",
            "GET",
            vec![],
            None,
        ),
        "linear" => (
            "https://api.linear.app/graphql",
            "POST",
            vec![("Content-Type", "application/json")],
            Some(r#"{"query":"{ viewer { id } }"}"#),
        ),
        "notion" => (
            "https://api.notion.com/v1/users/me",
            "GET",
            vec![("Notion-Version", "2022-06-28")],
            None,
        ),
        "spotify" => (
            "https://api.spotify.com/v1/me",
            "GET",
            vec![],
            None,
        ),
        _ => return None,
    };

    let header_map: HashMap<String, String> = headers
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();

    Some(HealthcheckConfig {
        endpoint: endpoint.to_string(),
        method: Some(method.to_string()),
        headers: header_map,
        body: body.map(|s| s.to_string()),
        skip: false,
    })
}

/// Execute a healthcheck request using a connector strategy for auth dispatch.
async fn execute_healthcheck_request_with_strategy(
    strategy: &dyn connector_strategy::ConnectorStrategy,
    hc_config: &HealthcheckConfig,
    fields: &HashMap<String, String>,
    token: Option<String>,
    credential_id: &str,
    service_type: &str,
) -> Result<HealthcheckResult, AppError> {
    let mut resolved_values = fields.clone();
    if let Some(ref tok) = token {
        if !resolved_values.contains_key("access_token") {
            resolved_values.insert("access_token".into(), tok.clone());
        }
        if !resolved_values.contains_key("accessToken") {
            resolved_values.insert("accessToken".into(), tok.clone());
        }
        if !resolved_values.contains_key("token") {
            resolved_values.insert("token".into(), tok.clone());
        }
    }

    // Pre-resolution SSRF defense: reject templates with placeholders in host
    validate_template_url(&hc_config.endpoint)?;
    validate_field_values(&resolved_values)?;

    let resolved_endpoint = resolve_template(&hc_config.endpoint, &resolved_values);

    // Post-resolution SSRF defense: reject private/internal addresses
    validate_healthcheck_url(&resolved_endpoint)?;

    // Build and send the request. 10s accommodates providers like Sentry's
    // /organizations/{slug}/ endpoint which routinely takes 3-6 seconds on
    // cold cache, especially when multiple credentials are probed in
    // parallel during the daily bulk sweep.
    //
    // SSRF defense-in-depth: `validate_healthcheck_url` above only inspects
    // the URL string — it cannot catch DNS rebinding, where a hostname
    // resolves to a public IP at validate time but to a private IP at
    // connection time. `SsrfSafeDnsResolver` wraps reqwest's own DNS lookup
    // and rejects private/loopback/link-local/metadata addresses at the
    // moment that actually matters.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .dns_resolver(std::sync::Arc::new(
            crate::engine::ssrf_safe_dns::SsrfSafeDnsResolver,
        ))
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client error: {e}")))?;

    let method = hc_config
        .method
        .as_deref()
        .unwrap_or("GET")
        .to_uppercase();

    let mut request = match method.as_str() {
        "POST" => client.post(&resolved_endpoint),
        "PUT" => client.put(&resolved_endpoint),
        "PATCH" => client.patch(&resolved_endpoint),
        "DELETE" => client.delete(&resolved_endpoint),
        _ => client.get(&resolved_endpoint),
    };

    let mut has_auth_header = false;
    for (header_name, header_template) in &hc_config.headers {
        let header_value = resolve_template(header_template, &resolved_values);
        if header_name.eq_ignore_ascii_case("authorization") && !header_value.contains("{{") {
            has_auth_header = true;
        }
        request = request.header(header_name, header_value);
    }

    // Delegate auth application to the connector strategy
    if let Some(ref tok) = token {
        if !has_auth_header {
            request = strategy.apply_auth(request, tok);
        }
    }

    // Attach body if configured (needed for GraphQL healthchecks)
    if let Some(ref body_template) = hc_config.body {
        let resolved_body = resolve_template(body_template, &resolved_values);
        request = request.body(resolved_body);
    }

    let start = std::time::Instant::now();

    match request.send().await {
        Ok(resp) => {
            let status = resp.status();
            let latency_ms = start.elapsed().as_millis() as u64;
            if status.is_success() {
                tracing::info!(
                    credential_id = %credential_id,
                    service_type = %service_type,
                    http_status = status.as_u16(),
                    latency_ms = latency_ms,
                    success = true,
                    "healthcheck passed"
                );
                Ok(HealthcheckResult {
                    success: true,
                    message: format!("Connection successful (HTTP {})", status.as_u16()),
                })
            } else {
                tracing::warn!(
                    credential_id = %credential_id,
                    service_type = %service_type,
                    http_status = status.as_u16(),
                    latency_ms = latency_ms,
                    success = false,
                    "healthcheck failed: HTTP error"
                );
                let msg = format!("Service returned HTTP {}", status.as_u16());
                Ok(HealthcheckResult {
                    success: false,
                    message: sanitize_secrets(&msg),
                })
            }
        }
        Err(e) => {
            let latency_ms = start.elapsed().as_millis() as u64;
            tracing::warn!(
                credential_id = %credential_id,
                service_type = %service_type,
                latency_ms = latency_ms,
                success = false,
                error = %e,
                "healthcheck failed: connection error"
            );
            let msg = format!("Connection failed: {e}");
            Ok(HealthcheckResult {
                success: false,
                message: sanitize_secrets(&msg),
            })
        }
    }
}

/// Replace `{{key}}` placeholders in a template string with values from the map.
pub(crate) fn resolve_template(template: &str, values: &HashMap<String, String>) -> String {
    let mut resolved = template.to_string();
    for (key, value) in values {
        resolved = resolved.replace(&format!("{{{{{key}}}}}"), value);
    }
    resolved
}

/// Validate that a URL template does not contain `{{...}}` placeholders in the
/// scheme or host/authority portion.
///
/// This prevents SSRF attacks where an AI-generated template looks benign
/// (e.g. `https://{{base_url}}/api/me`) but user-provided field values inject
/// private network addresses into the host position.
///
/// Allowed: `https://api.example.com/v1/{{resource_id}}`
/// Allowed: `{{project_url}}/rest/v1/` (entire URL from field -- validated post-resolution)
/// Blocked: `https://{{base_url}}/api`, `{{scheme}}://api.example.com`
pub(crate) fn validate_template_url(template: &str) -> Result<(), AppError> {
    // If the template starts with `{{` and the placeholder spans past the `://`
    // position, the entire URL origin comes from a field value
    // (e.g. `{{project_url}}/rest/v1/`).  This is legitimate for connectors that
    // store full URLs as fields.  Post-resolution validation
    // (`validate_healthcheck_url`) will still catch SSRF on the resolved URL.
    //
    // But `{{scheme}}://host` is NOT allowed -- the placeholder only controls the
    // scheme, so we check if `://` appears INSIDE or after the closing `}}`.
    if template.starts_with("{{") {
        if let Some(close) = template.find("}}") {
            let after_close = &template[close + 2..];
            // If `://` is NOT the first thing after the placeholder close,
            // the placeholder encompasses the scheme+host (safe pattern).
            if !after_close.starts_with("://") {
                return Ok(());
            }
            // Otherwise falls through: `{{scheme}}://host` is still blocked.
        }
    }

    // Find the scheme separator
    let after_scheme = match template.find("://") {
        Some(idx) => {
            let scheme_part = &template[..idx];
            if scheme_part.contains("{{") {
                return Err(AppError::Validation(
                    "Healthcheck URL template contains a placeholder in the scheme -- \
                     user-provided values must not control the URL scheme"
                        .into(),
                ));
            }
            &template[idx + 3..]
        }
        None => {
            return Err(AppError::Validation(
                "Healthcheck URL template must include a scheme (http:// or https://)".into(),
            ));
        }
    };

    // Extract the authority: everything before the first '/', '?', or '#'
    // after the scheme://
    let authority_end = after_scheme
        .find('/')
        .or_else(|| after_scheme.find('?'))
        .or_else(|| after_scheme.find('#'))
        .unwrap_or(after_scheme.len());
    let authority = &after_scheme[..authority_end];

    if authority.contains("{{") {
        return Err(AppError::Validation(
            "Healthcheck URL template contains a placeholder in the host/authority -- \
             user-provided values must not control the target host"
                .into(),
        ));
    }

    Ok(())
}

/// Validate that user-provided field values cannot be used to manipulate URL
/// resolution into targeting internal services.
///
/// Blocks values containing:
/// - IP addresses in private, loopback, or link-local ranges
/// - Known internal hostnames (localhost, .local, .internal)
///
/// Note: URL-type field values (containing `://`) are allowed because many
/// connectors legitimately store full URLs (e.g. Supabase `project_url`).
/// Post-resolution validation via `validate_healthcheck_url` catches SSRF on
/// the final resolved URL.
pub(crate) fn validate_field_values(
    values: &HashMap<String, String>,
) -> Result<(), AppError> {
    for (key, value) in values {
        let lower = value.to_lowercase();

        // If the value is a URL, extract the host portion for private-IP checks
        let check_target = if let Some(after_scheme) = lower.find("://").map(|i| &value[i + 3..]) {
            let host_end = after_scheme.find('/').unwrap_or(after_scheme.len());
            let authority = &after_scheme[..host_end];
            // Strip port if present
            authority.split(':').next().unwrap_or(authority).to_string()
        } else {
            // Non-URL value: check the whole value
            value.split(&[':', '/', '?', '#'][..])
                .next()
                .unwrap_or(value)
                .to_string()
        };

        // Block private/internal IP addresses
        if let Ok(ip) = check_target.parse::<IpAddr>() {
            if is_private_ip(&ip) {
                return Err(AppError::Validation(format!(
                    "Field '{key}' contains a private or internal network address ({ip})"
                )));
            }
        }

        // Block known internal hostnames
        let ct_lower = check_target.to_lowercase();
        if ct_lower == "localhost"
            || ct_lower.ends_with(".local")
            || ct_lower.ends_with(".internal")
            || ct_lower.contains("metadata.google.internal")
        {
            return Err(AppError::Validation(format!(
                "Field '{key}' contains a private or internal hostname"
            )));
        }
    }

    Ok(())
}

/// Validate that a healthcheck URL targets a public endpoint and is not an SSRF vector.
///
/// Blocks:
/// - Non-HTTP(S) schemes
/// - Localhost / loopback addresses (127.x.x.x, ::1)
/// - Private network ranges (10.x, 172.16-31.x, 192.168.x, fc00::/7)
/// - Link-local addresses (169.254.x.x, fe80::/10) -- includes cloud metadata endpoints
/// - URLs with unresolved template placeholders (`{{...}}`)
pub(crate) fn validate_healthcheck_url(url: &str) -> Result<(), AppError> {
    // Reject unresolved template placeholders
    if url.contains("{{") {
        return Err(AppError::Validation(
            "Healthcheck URL contains unresolved template placeholders".into(),
        ));
    }

    let parsed = url::Url::parse(url).map_err(|e| {
        AppError::Validation(format!("Invalid healthcheck URL: {e}"))
    })?;

    // Only allow HTTP and HTTPS schemes
    match parsed.scheme() {
        "http" | "https" => {}
        scheme => {
            return Err(AppError::Validation(format!(
                "Healthcheck URL scheme '{scheme}' is not allowed (only http/https)"
            )));
        }
    }

    let host = parsed
        .host()
        .ok_or_else(|| AppError::Validation("Healthcheck URL has no host".into()))?;

    match &host {
        url::Host::Ipv4(v4) => {
            if is_private_ip(&IpAddr::V4(*v4)) {
                return Err(AppError::Validation(format!(
                    "Healthcheck URL targets a private/internal address ({v4})"
                )));
            }
        }
        url::Host::Ipv6(v6) => {
            if is_private_ip(&IpAddr::V6(*v6)) {
                return Err(AppError::Validation(format!(
                    "Healthcheck URL targets a private/internal address ({v6})"
                )));
            }
        }
        url::Host::Domain(domain) => {
            let lower = domain.to_lowercase();
            if lower == "localhost"
                || lower.ends_with(".local")
                || lower.ends_with(".internal")
                || lower == "metadata.google.internal"
            {
                return Err(AppError::Validation(format!(
                    "Healthcheck URL targets a private/internal hostname ({domain})"
                )));
            }
        }
    }

    Ok(())
}

/// Check if an IP address is in a private, loopback, or link-local range.
pub(crate) fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()             // 127.0.0.0/8
                || v4.is_private()        // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
                || v4.is_link_local()     // 169.254.0.0/16 (cloud metadata!)
                || v4.is_unspecified()    // 0.0.0.0
                || v4.is_broadcast()      // 255.255.255.255
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()             // ::1
                || v6.is_unspecified()    // ::
                || is_ipv6_private(v6)
        }
    }
}

/// Check IPv6 private/internal ranges: ULA (fc00::/7) and link-local (fe80::/10).
fn is_ipv6_private(v6: &std::net::Ipv6Addr) -> bool {
    let segments = v6.segments();
    let first = segments[0];
    // fc00::/7 -- Unique Local Addresses
    (first & 0xfe00) == 0xfc00
    // fe80::/10 -- Link-Local
    || (first & 0xffc0) == 0xfe80
}


// Auth token resolution and OAuth token exchange are now handled by
// connector strategies in `connector_strategy.rs`.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct HealthcheckConfig {
    endpoint: String,
    method: Option<String>,
    headers: HashMap<String, String>,
    body: Option<String>,
    /// When true, skip HTTP healthcheck entirely (e.g. pooler connection strings).
    skip: bool,
}

fn parse_healthcheck_config(json: &str) -> Option<HealthcheckConfig> {
    let val: serde_json::Value = serde_json::from_str(json).ok()?;
    let endpoint = val
        .get("endpoint")
        .and_then(|v| v.as_str())
        .or_else(|| val.get("url").and_then(|v| v.as_str()))?
        .to_string();
    if endpoint.is_empty() {
        return None;
    }
    let method = val
        .get("method")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut headers = HashMap::new();
    if let Some(map) = val.get("headers").and_then(|v| v.as_object()) {
        for (k, v) in map {
            if let Some(text) = v.as_str() {
                headers.insert(k.to_string(), text.to_string());
            }
        }
    }

    let body = val
        .get("body")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Some(HealthcheckConfig {
        endpoint,
        method,
        headers,
        body,
        skip: false,
    })
}

/// Look for an auth token in credential fields by checking common key names.
#[cfg(test)]
fn find_auth_token(fields: &HashMap<String, String>) -> Option<String> {
    const TOKEN_KEYS: &[&str] = &[
        "token",
        "api_key",
        "bot_token",
        "access_token",
        "api_token",
        "apiKey",
        "apiToken",
        "accessToken",
        "botToken",
        "bearer_token",
    ];
    for key in TOKEN_KEYS {
        if let Some(val) = fields.get(*key) {
            if !val.is_empty() {
                return Some(val.clone());
            }
        }
    }
    None
}

/// Build auth header value from credential data (exported for testing).
#[cfg(test)]
pub fn build_auth_header(fields: &HashMap<String, String>) -> Option<String> {
    find_auth_token(fields).map(|t| format!("Bearer {t}"))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_healthcheck_no_config() {
        // No healthcheck_config -> should return None
        assert!(parse_healthcheck_config("{}").is_none());
        assert!(parse_healthcheck_config(r#"{"description":"test"}"#).is_none());
        assert!(parse_healthcheck_config(r#"{"endpoint":""}"#).is_none());
    }

    #[test]
    fn test_healthcheck_parse_config() {
        let json = r#"{"endpoint":"https://api.example.com/v1/me","method":"GET","description":"Check API access"}"#;
        let config = parse_healthcheck_config(json).unwrap();
        assert_eq!(config.endpoint, "https://api.example.com/v1/me");
        assert_eq!(config.method.as_deref(), Some("GET"));
    }

    #[test]
    fn test_build_auth_header() {
        let mut fields = HashMap::new();
        fields.insert("username".into(), "admin".into());
        fields.insert("api_key".into(), "sk-test-123".into());

        let header = build_auth_header(&fields).unwrap();
        assert_eq!(header, "Bearer sk-test-123");

        // No token fields
        let mut fields2 = HashMap::new();
        fields2.insert("username".into(), "admin".into());
        fields2.insert("password".into(), "secret".into());
        assert!(build_auth_header(&fields2).is_none());
    }

    #[test]
    fn test_validate_url_allows_public_https() {
        assert!(validate_healthcheck_url("https://api.example.com/v1/me").is_ok());
        assert!(validate_healthcheck_url("https://slack.com/api/auth.test").is_ok());
        assert!(validate_healthcheck_url("http://api.github.com/user").is_ok());
    }

    #[test]
    fn test_validate_url_blocks_localhost() {
        assert!(validate_healthcheck_url("http://localhost:8080/admin").is_err());
        assert!(validate_healthcheck_url("https://localhost/secret").is_err());
        assert!(validate_healthcheck_url("http://127.0.0.1:3000").is_err());
        assert!(validate_healthcheck_url("http://127.0.0.2/path").is_err());
    }

    #[test]
    fn test_validate_url_blocks_private_networks() {
        assert!(validate_healthcheck_url("http://10.0.0.1/admin").is_err());
        assert!(validate_healthcheck_url("http://172.16.0.1/api").is_err());
        assert!(validate_healthcheck_url("http://192.168.1.1/").is_err());
    }

    #[test]
    fn test_validate_url_blocks_cloud_metadata() {
        // AWS/GCP/Azure metadata endpoint
        assert!(validate_healthcheck_url("http://169.254.169.254/latest/meta-data/").is_err());
        assert!(validate_healthcheck_url("http://metadata.google.internal/computeMetadata/v1/").is_err());
    }

    #[test]
    fn test_validate_url_blocks_non_http_schemes() {
        assert!(validate_healthcheck_url("file:///etc/passwd").is_err());
        assert!(validate_healthcheck_url("ftp://internal.server/data").is_err());
        assert!(validate_healthcheck_url("gopher://evil.com/").is_err());
    }

    #[test]
    fn test_validate_url_blocks_unresolved_templates() {
        assert!(validate_healthcheck_url("https://api.example.com/{{api_key}}/test").is_err());
    }

    #[test]
    fn test_validate_url_blocks_ipv6_loopback() {
        assert!(validate_healthcheck_url("http://[::1]:8080/admin").is_err());
    }

    #[test]
    fn test_validate_url_blocks_internal_hostnames() {
        assert!(validate_healthcheck_url("http://myservice.local/api").is_err());
        assert!(validate_healthcheck_url("http://db.internal/health").is_err());
    }

    #[test]
    fn test_validate_url_blocks_unspecified() {
        assert!(validate_healthcheck_url("http://0.0.0.0/").is_err());
    }

    // ---- validate_template_url tests ----

    #[test]
    fn test_template_allows_placeholders_in_path() {
        assert!(validate_template_url("https://api.example.com/v1/{{resource_id}}").is_ok());
        assert!(validate_template_url("https://api.example.com/{{org}}/repos").is_ok());
    }

    #[test]
    fn test_template_allows_full_url_from_field() {
        // When the entire URL comes from a field value (e.g. Supabase project_url)
        assert!(validate_template_url("{{project_url}}/rest/v1/").is_ok());
        assert!(validate_template_url("{{base_url}}/api/v1/me").is_ok());
    }

    #[test]
    fn test_template_allows_placeholders_in_query() {
        assert!(validate_template_url("https://api.example.com/v1?key={{api_key}}").is_ok());
    }

    #[test]
    fn test_template_blocks_placeholders_in_scheme() {
        assert!(validate_template_url("{{scheme}}://api.example.com/v1").is_err());
    }

    #[test]
    fn test_template_blocks_placeholders_in_host() {
        assert!(validate_template_url("https://{{base_url}}/api/me").is_err());
        assert!(validate_template_url("https://{{subdomain}}.example.com/api").is_err());
        assert!(validate_template_url("https://{{host}}:8080/api").is_err());
    }

    #[test]
    fn test_template_blocks_missing_scheme() {
        assert!(validate_template_url("api.example.com/v1").is_err());
    }

    // ---- validate_field_values tests ----

    #[test]
    fn test_field_values_allows_normal_values() {
        let mut values = HashMap::new();
        values.insert("api_key".into(), "sk-test-123".into());
        values.insert("org_id".into(), "my-org".into());
        values.insert("workspace".into(), "prod".into());
        assert!(validate_field_values(&values).is_ok());
    }

    #[test]
    fn test_field_values_allows_public_urls() {
        let mut values = HashMap::new();
        values.insert("project_url".into(), "https://xxxx.supabase.co".into());
        assert!(validate_field_values(&values).is_ok());
    }

    #[test]
    fn test_field_values_blocks_private_url() {
        let mut values = HashMap::new();
        values.insert("base_url".into(), "http://169.254.169.254/latest".into());
        assert!(validate_field_values(&values).is_err());
    }

    #[test]
    fn test_field_values_blocks_private_ips() {
        let mut values = HashMap::new();
        values.insert("host".into(), "10.0.0.1".into());
        assert!(validate_field_values(&values).is_err());

        let mut values2 = HashMap::new();
        values2.insert("host".into(), "192.168.1.1".into());
        assert!(validate_field_values(&values2).is_err());

        let mut values3 = HashMap::new();
        values3.insert("host".into(), "127.0.0.1".into());
        assert!(validate_field_values(&values3).is_err());
    }

    #[test]
    fn test_field_values_blocks_private_ip_with_port() {
        let mut values = HashMap::new();
        values.insert("endpoint".into(), "10.0.0.1:8080".into());
        assert!(validate_field_values(&values).is_err());
    }

    #[test]
    fn test_field_values_blocks_localhost() {
        let mut values = HashMap::new();
        values.insert("host".into(), "localhost".into());
        assert!(validate_field_values(&values).is_err());
    }

    #[test]
    fn test_field_values_blocks_internal_hostnames() {
        let mut values = HashMap::new();
        values.insert("host".into(), "myservice.local".into());
        assert!(validate_field_values(&values).is_err());

        let mut values2 = HashMap::new();
        values2.insert("host".into(), "db.internal".into());
        assert!(validate_field_values(&values2).is_err());
    }

    #[test]
    fn test_field_values_blocks_cloud_metadata() {
        let mut values = HashMap::new();
        values.insert("url".into(), "metadata.google.internal".into());
        assert!(validate_field_values(&values).is_err());
    }

    #[test]
    fn test_field_values_allows_public_ips() {
        let mut values = HashMap::new();
        values.insert("host".into(), "8.8.8.8".into());
        assert!(validate_field_values(&values).is_ok());
    }

    // ---- Combined attack scenario tests ----

    #[test]
    fn test_ssrf_via_base_url_injection() {
        // Attack: template looks safe but {{base_url}} in host position
        // allows injecting private addresses
        assert!(validate_template_url("https://{{base_url}}/api/me").is_err());
    }

    #[test]
    fn test_ssrf_via_field_value_with_private_url() {
        // Attack: field value contains a URL targeting cloud metadata
        let mut values = HashMap::new();
        values.insert("url".into(), "http://169.254.169.254/latest/meta-data/".into());
        assert!(validate_field_values(&values).is_err());
    }

    #[test]
    fn test_ssrf_via_localhost_url() {
        let mut values = HashMap::new();
        values.insert("url".into(), "http://localhost:8080/admin".into());
        assert!(validate_field_values(&values).is_err());
    }

    #[test]
    fn test_ssrf_triple_defense() {
        // Even if template validation passes (placeholder in path),
        // field value validation catches private IPs, and post-resolution
        // URL validation catches anything that slips through
        assert!(validate_template_url("https://api.example.com/{{path}}").is_ok());

        let mut values = HashMap::new();
        values.insert("path".into(), "normal-resource".into());
        assert!(validate_field_values(&values).is_ok());

        let resolved = resolve_template("https://api.example.com/{{path}}", &values);
        assert!(validate_healthcheck_url(&resolved).is_ok());
    }

    // ---- Variant healthcheck resolution tests ----

    #[test]
    fn test_variant_healthcheck_exact_match() {
        let meta = r#"{"auth_variants":[
            {"id":"anon","fields":["project_url","anon_key"],
             "healthcheck_config":{"endpoint":"{{project_url}}/rest/v1/","method":"GET","headers":{"apikey":"{{anon_key}}"}}},
            {"id":"service_role","fields":["project_url","service_role_key"],
             "healthcheck_config":{"endpoint":"{{project_url}}/rest/v1/","method":"GET","headers":{"apikey":"{{service_role_key}}"}}}
        ]}"#;

        // Anon variant match
        let mut fields = HashMap::new();
        fields.insert("project_url".into(), "https://xxx.supabase.co".into());
        fields.insert("anon_key".into(), "eyJ_test".into());
        let hc = resolve_variant_healthcheck(meta, &fields).unwrap();
        assert!(hc.headers.contains_key("apikey"));
        assert!(hc.headers["apikey"].contains("anon_key"));

        // Service role variant match
        let mut fields2 = HashMap::new();
        fields2.insert("project_url".into(), "https://xxx.supabase.co".into());
        fields2.insert("service_role_key".into(), "eyJ_admin".into());
        let hc2 = resolve_variant_healthcheck(meta, &fields2).unwrap();
        assert!(hc2.headers["apikey"].contains("service_role_key"));
    }

    #[test]
    fn test_variant_healthcheck_skip() {
        let meta = r#"{"auth_variants":[
            {"id":"pooler","fields":["pooler_url"],"healthcheck_skip":true}
        ]}"#;

        let mut fields = HashMap::new();
        fields.insert("pooler_url".into(), "postgresql://xxx".into());
        let hc = resolve_variant_healthcheck(meta, &fields).unwrap();
        assert!(hc.skip);
    }

    #[test]
    fn test_variant_healthcheck_no_match_returns_none() {
        let meta = r#"{"auth_variants":[
            {"id":"anon","fields":["project_url","anon_key"],
             "healthcheck_config":{"endpoint":"test","method":"GET","headers":{}}}
        ]}"#;

        let mut fields = HashMap::new();
        fields.insert("something_else".into(), "value".into());
        assert!(resolve_variant_healthcheck(meta, &fields).is_none());
    }

    #[test]
    fn test_supabase_full_healthcheck_flow() {
        // Simulate the full Supabase anon key healthcheck template resolution
        let template = "{{project_url}}/rest/v1/";
        assert!(validate_template_url(template).is_ok());

        let mut values = HashMap::new();
        values.insert("project_url".into(), "https://xxxx.supabase.co".into());
        values.insert("anon_key".into(), "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9".into());
        assert!(validate_field_values(&values).is_ok());

        let resolved = resolve_template(template, &values);
        assert_eq!(resolved, "https://xxxx.supabase.co/rest/v1/");
        assert!(validate_healthcheck_url(&resolved).is_ok());
    }
}
