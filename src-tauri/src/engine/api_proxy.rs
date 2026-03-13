//! HTTP API proxy engine for credential-authenticated requests.
//!
//! Proxies arbitrary HTTP requests through a credential's auth strategy,
//! resolving base URLs and applying authentication automatically.

use std::collections::HashMap;
use std::time::Instant;

use ts_rs::TS;

use crate::db::repos::resources::connectors as connector_repo;
use crate::db::repos::resources::credentials as cred_repo;
use crate::db::DbPool;
use crate::error::AppError;

use super::connector_strategy;
use super::healthcheck::{validate_field_values, validate_healthcheck_url};

/// Well-known API base URLs for connectors that have fixed endpoints.
fn well_known_base_url(service_type: &str) -> Option<&'static str> {
    match service_type {
        "github" | "github_actions" => Some("https://api.github.com"),
        "slack" => Some("https://slack.com/api"),
        "discord" => Some("https://discord.com/api/v10"),
        "airtable" => Some("https://api.airtable.com"),
        "notion" => Some("https://api.notion.com"),
        "clickup" => Some("https://api.clickup.com/api/v2"),
        "cal_com" => Some("https://api.cal.com"),
        "calendly" => Some("https://api.calendly.com"),
        "leonardo_ai" => Some("https://cloud.leonardo.ai/api/rest/v1"),
        "betterstack" => Some("https://uptime.betterstack.com"),
        "mixpanel" => Some("https://mixpanel.com"),
        "twilio_segment" => Some("https://api.segment.io"),
        "monday" | "monday_com" => Some("https://api.monday.com"),
        "linear" => Some("https://api.linear.app"),
        "circleci" => Some("https://circleci.com/api/v2"),
        "buffer" => Some("https://api.bufferapp.com"),
        "sendgrid" => Some("https://api.sendgrid.com"),
        "resend" => Some("https://api.resend.com"),
        "vercel" => Some("https://api.vercel.com"),
        "netlify" => Some("https://api.netlify.com"),
        "cloudflare" => Some("https://api.cloudflare.com/client/v4"),
        "figma" => Some("https://api.figma.com"),
        "hubspot" => Some("https://api.hubapi.com"),
        "neon" => Some("https://console.neon.tech/api/v2"),
        "planetscale" => Some("https://api.planetscale.com"),
        "dropbox" => Some("https://api.dropboxapi.com"),
        "twilio_sms" => Some("https://api.twilio.com"),
        "zapier" => Some("https://api.zapier.com"),
        "asana" => Some("https://app.asana.com/api/1.0"),
        "canva" => Some("https://api.canva.com/rest/v1"),
        "attio" => Some("https://api.attio.com/v2"),
        "crisp" => Some("https://api.crisp.chat/v1"),
        "lemonsqueezy" => Some("https://api.lemonsqueezy.com/v1"),
        "novu" => Some("https://api.novu.co/v1"),
        "knock" => Some("https://api.knock.app/v1"),
        "linkedin" => Some("https://api.linkedin.com"),
        "sentry" => Some("https://sentry.io"),
        "google_workspace_oauth_template" => Some("https://www.googleapis.com"),
        "google_sheets" => Some("https://sheets.googleapis.com"),
        "gmail" => Some("https://gmail.googleapis.com"),
        _ => None,
    }
}

/// Build a dynamic base URL for connectors that embed credential fields in the URL.
fn dynamic_base_url(service_type: &str, fields: &HashMap<String, String>) -> Option<String> {
    match service_type {
        "telegram" => {
            let token = fields.get("bot_token")?;
            Some(format!("https://api.telegram.org/bot{token}"))
        }
        _ => None,
    }
}

/// Maximum request body size: 10 MB.
const MAX_REQUEST_BODY_BYTES: usize = 10 * 1024 * 1024;

/// Headers that must not be overridden via user-supplied custom_headers.
/// Auth headers are applied exclusively through the connector strategy.
const BLOCKED_HEADERS: &[&str] = &["authorization", "cookie", "host", "proxy-authorization"];

/// Result of a proxied API request.
#[derive(Debug, serde::Serialize, TS)]
#[ts(export)]
pub struct ApiProxyResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub duration_ms: u64,
    pub content_type: Option<String>,
}

/// Proxy an HTTP request through a stored credential.
///
/// 1. Load credential and decrypt fields
/// 2. Resolve base_url from fields
/// 3. Apply SSRF protections
/// 4. Resolve auth via connector strategy
/// 5. Send request and return full response
pub async fn execute_api_request(
    pool: &DbPool,
    credential_id: &str,
    method: &str,
    path: &str,
    custom_headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<ApiProxyResponse, AppError> {
    let credential = cred_repo::get_by_id(pool, credential_id)?;
    let fields = cred_repo::get_decrypted_fields(pool, &credential)?;

    // Resolve base URL from credential fields, dynamic domain fields, or well-known defaults
    let base_url_resolved: String = if let Some(url) = fields
        .get("base_url")
        .or_else(|| fields.get("project_url"))
        .or_else(|| fields.get("url"))
        .or_else(|| fields.get("deployment_url"))
        .or_else(|| fields.get("redis_url"))
    {
        url.clone()
    } else if let Some(host) = fields.get("host") {
        // PostHog-style: host field is a full URL
        if host.starts_with("http://") || host.starts_with("https://") {
            host.clone()
        } else {
            format!("https://{host}")
        }
    } else if let Some(domain) = fields.get("domain") {
        // Jira/Confluence-style: domain field (e.g., "yoursite.atlassian.net")
        if domain.starts_with("http://") || domain.starts_with("https://") {
            domain.clone()
        } else {
            format!("https://{domain}")
        }
    } else if let Some(dynamic) = dynamic_base_url(&credential.service_type, &fields) {
        dynamic
    } else if let Some(known) = well_known_base_url(&credential.service_type) {
        known.to_string()
    } else {
        return Err(AppError::Validation(
            "Credential has no base URL field and no well-known API URL for this service. \
             Add a base_url field to the credential or contact support."
                .into(),
        ));
    };
    let base_url = &base_url_resolved;

    // Build full URL
    let trimmed_base = base_url.trim_end_matches('/');
    let trimmed_path = path.trim_start_matches('/');
    let full_url = if trimmed_path.is_empty() {
        trimmed_base.to_string()
    } else {
        format!("{trimmed_base}/{trimmed_path}")
    };

    // SSRF protection (reuse healthcheck infrastructure)
    validate_field_values(&fields)?;
    validate_healthcheck_url(&full_url)?;

    // Resolve auth via connector strategy
    let connectors = connector_repo::get_all(pool)?;
    let connector = connectors
        .iter()
        .find(|c| c.name == credential.service_type);
    let connector_metadata = connector.and_then(|c| c.metadata.as_deref());

    let strategy =
        connector_strategy::registry()?.get(&credential.service_type, connector_metadata);
    let token = strategy
        .resolve_auth_token(connector_metadata, &fields)
        .await?
        .map(|r| r.token);

    let client = crate::SHARED_HTTP.clone();

    let start = Instant::now();

    let mut request = match method.to_uppercase().as_str() {
        "POST" => client.post(&full_url),
        "PUT" => client.put(&full_url),
        "PATCH" => client.patch(&full_url),
        "DELETE" => client.delete(&full_url),
        "HEAD" => client.head(&full_url),
        "OPTIONS" => client.request(reqwest::Method::OPTIONS, &full_url),
        _ => client.get(&full_url),
    };

    // Apply custom headers, blocking sensitive names to prevent auth injection
    for (k, v) in &custom_headers {
        if BLOCKED_HEADERS.contains(&k.to_lowercase().as_str()) {
            tracing::warn!(header = %k, "Blocked sensitive header from custom_headers");
            continue;
        }
        request = request.header(k.as_str(), v.as_str());
    }

    // Apply auth from connector strategy
    if let Some(ref tok) = token {
        request = strategy.apply_auth(request, tok);
    }

    // Apply body with size limit
    if let Some(ref body_str) = body {
        if body_str.len() > MAX_REQUEST_BODY_BYTES {
            return Err(AppError::Validation(format!(
                "Request body too large: {} bytes (max {} bytes)",
                body_str.len(),
                MAX_REQUEST_BODY_BYTES,
            )));
        }
        if !custom_headers.keys().any(|k| k.to_lowercase() == "content-type") {
            request = request.header("Content-Type", "application/json");
        }
        request = request.body(body_str.clone());
    }

    let resp = request
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("API request failed: {e}")))?;

    let duration_ms = start.elapsed().as_millis() as u64;
    let status = resp.status().as_u16();
    let status_text = resp
        .status()
        .canonical_reason()
        .unwrap_or("")
        .to_string();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let mut resp_headers = HashMap::new();
    for (k, v) in resp.headers() {
        if let Ok(val) = v.to_str() {
            resp_headers.insert(k.as_str().to_string(), val.to_string());
        }
    }

    // Limit response body to 2MB to prevent memory issues
    let body_bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read response body: {e}")))?;

    let body = if body_bytes.len() > 2_000_000 {
        format!(
            "[Response truncated: {} bytes, showing first 2MB]",
            body_bytes.len()
        )
    } else {
        String::from_utf8_lossy(&body_bytes).to_string()
    };

    Ok(ApiProxyResponse {
        status,
        status_text,
        headers: resp_headers,
        body,
        duration_ms,
        content_type,
    })
}
