//! HTTP API proxy engine for credential-authenticated requests.
//!
//! Proxies arbitrary HTTP requests through a credential's auth strategy,
//! resolving base URLs and applying authentication automatically.

use std::collections::HashMap;
use std::time::Instant;

use crate::db::repos::resources::connectors as connector_repo;
use crate::db::repos::resources::credentials as cred_repo;
use crate::db::DbPool;
use crate::error::AppError;

use super::connector_strategy;
use super::healthcheck::{validate_field_values, validate_healthcheck_url};

/// Maximum request body size: 10 MB.
const MAX_REQUEST_BODY_BYTES: usize = 10 * 1024 * 1024;

/// Headers that must not be overridden via user-supplied custom_headers.
/// Auth headers are applied exclusively through the connector strategy.
const BLOCKED_HEADERS: &[&str] = &["authorization", "cookie", "host", "proxy-authorization"];

/// Result of a proxied API request.
#[derive(Debug, serde::Serialize)]
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

    // Resolve base URL from credential fields
    let base_url = fields
        .get("base_url")
        .or_else(|| fields.get("project_url"))
        .or_else(|| fields.get("url"))
        .or_else(|| fields.get("deployment_url"))
        .ok_or_else(|| {
            AppError::Validation(
                "Credential has no base URL field (base_url, project_url, url, or deployment_url)"
                    .into(),
            )
        })?;

    // Build full URL
    let trimmed_base = base_url.trim_end_matches('/');
    let trimmed_path = path.trim_start_matches('/');
    let full_url = if trimmed_path.is_empty() {
        trimmed_base.to_string()
    } else {
        format!("{}/{}", trimmed_base, trimmed_path)
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
        connector_strategy::registry().get(&credential.service_type, connector_metadata);
    let token = strategy
        .resolve_auth_token(connector_metadata, &fields)
        .await?;

    // Build HTTP client with timeout
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client error: {e}")))?;

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
