use std::collections::HashMap;
use std::net::IpAddr;

use crate::db::repos::resources::connectors as connector_repo;
use crate::db::repos::resources::credentials as cred_repo;
use crate::db::DbPool;
use crate::error::AppError;

use super::crypto;

/// Result of a credential healthcheck.
#[derive(Debug, serde::Serialize)]
pub struct HealthcheckResult {
    pub success: bool,
    pub message: String,
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

    let fields = parse_credential_fields(&cred.encrypted_data, &cred.iv)?;

    let (connector, hc_config) = resolve_connector_healthcheck(pool, &cred.service_type)?;

    // Find a token in credential fields
    let token = resolve_auth_token(&cred.service_type, connector.metadata.as_deref(), &fields).await?;

    execute_healthcheck_request(&cred.service_type, &hc_config, &fields, token).await
}

pub async fn run_healthcheck_with_fields(
    pool: &DbPool,
    service_type: &str,
    fields: &HashMap<String, String>,
) -> Result<HealthcheckResult, AppError> {
    let (connector, hc_config) = resolve_connector_healthcheck(pool, service_type)?;
    let token = resolve_auth_token(service_type, connector.metadata.as_deref(), fields).await?;

    execute_healthcheck_request(service_type, &hc_config, fields, token).await
}

fn resolve_connector_healthcheck(
    pool: &DbPool,
    service_type: &str,
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
                "No connector definition found for '{}'",
                service_type
            )));
        }
    };

    let hc_config = match &connector.healthcheck_config {
        Some(json_str) => parse_healthcheck_config(json_str),
        None => None,
    }
    .ok_or_else(|| AppError::Validation("No healthcheck configured for this connector".into()))?;

    Ok((connector, hc_config))
}

async fn execute_healthcheck_request(
    service_type: &str,
    hc_config: &HealthcheckConfig,
    fields: &HashMap<String, String>,
    token: Option<String>,
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

    let resolved_endpoint = resolve_template(&hc_config.endpoint, &resolved_values);

    // Validate the URL to prevent SSRF against internal/private endpoints
    validate_healthcheck_url(&resolved_endpoint)?;

    // Build and send the request
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client error: {}", e)))?;

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

    if let Some(ref tok) = token {
        if !has_auth_header {
            if service_type.contains("clickup") {
                request = request.header("Authorization", tok);
            } else {
                request = request.bearer_auth(tok);
            }
        }
    }

    // Attach body if configured (needed for GraphQL healthchecks)
    if let Some(ref body_template) = hc_config.body {
        let resolved_body = resolve_template(body_template, &resolved_values);
        request = request.body(resolved_body);
    }

    match request.send().await {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                Ok(HealthcheckResult {
                    success: true,
                    message: format!("Connection successful (HTTP {})", status.as_u16()),
                })
            } else {
                Ok(HealthcheckResult {
                    success: false,
                    message: format!("Service returned HTTP {}", status.as_u16()),
                })
            }
        }
        Err(e) => Ok(HealthcheckResult {
            success: false,
            message: format!("Connection failed: {}", e),
        }),
    }
}

/// Replace `{{key}}` placeholders in a template string with values from the map.
pub(crate) fn resolve_template(template: &str, values: &HashMap<String, String>) -> String {
    let mut resolved = template.to_string();
    for (key, value) in values {
        resolved = resolved.replace(&format!("{{{{{}}}}}", key), value);
    }
    resolved
}

/// Validate that a healthcheck URL targets a public endpoint and is not an SSRF vector.
///
/// Blocks:
/// - Non-HTTP(S) schemes
/// - Localhost / loopback addresses (127.x.x.x, ::1)
/// - Private network ranges (10.x, 172.16-31.x, 192.168.x, fc00::/7)
/// - Link-local addresses (169.254.x.x, fe80::/10) — includes cloud metadata endpoints
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
fn is_private_ip(ip: &IpAddr) -> bool {
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
    // fc00::/7 — Unique Local Addresses
    (first & 0xfe00) == 0xfc00
    // fe80::/10 — Link-Local
    || (first & 0xffc0) == 0xfe80
}

fn parse_credential_fields(
    encrypted_data: &str,
    iv: &str,
) -> Result<HashMap<String, String>, AppError> {
    if crypto::is_plaintext(iv) {
        return serde_json::from_str(encrypted_data)
            .map_err(|e| AppError::Internal(format!("Invalid credential data JSON: {}", e)));
    }

    match crypto::decrypt_from_db(encrypted_data, iv) {
        Ok(plaintext) => serde_json::from_str(&plaintext)
            .map_err(|e| AppError::Internal(format!("Invalid credential data JSON: {}", e))),
        Err(_) => {
            if let Ok(fields) = serde_json::from_str::<HashMap<String, String>>(encrypted_data) {
                return Ok(fields);
            }
            Err(AppError::Internal(
                "Decryption failed: credential data cannot be read with the current vault key. Re-save this credential and retry.".into(),
            ))
        }
    }
}

async fn resolve_auth_token(
    service_type: &str,
    connector_metadata: Option<&str>,
    fields: &HashMap<String, String>,
) -> Result<Option<String>, AppError> {
    if !is_google_oauth_connector(service_type, connector_metadata, fields) {
        return Ok(find_auth_token(fields));
    }

    if let Some(access_token) = find_nonempty(fields, &["access_token", "accessToken"]) {
        return Ok(Some(access_token));
    }

    let refresh_token = find_nonempty(fields, &["refresh_token", "refreshToken"])
        .ok_or_else(|| AppError::Validation("Google credential is missing refresh_token".into()))?;

    let (client_id, client_secret) = super::google_oauth::resolve_google_oauth_env_credentials()?;
    let access_token = exchange_refresh_for_access_token(&client_id, &client_secret, &refresh_token).await?;
    Ok(Some(access_token))
}

fn is_google_oauth_connector(
    service_type: &str,
    connector_metadata: Option<&str>,
    _fields: &HashMap<String, String>,
) -> bool {
    if service_type.contains("google") {
        return true;
    }

    if let Some(metadata_json) = connector_metadata {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(metadata_json) {
            if value
                .get("oauth_type")
                .and_then(|v| v.as_str())
                .is_some_and(|v| v == "google")
            {
                return true;
            }
        }
    }

    false
}

async fn exchange_refresh_for_access_token(
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<String, AppError> {
    let response = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Google token refresh request failed: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_else(|_| "<no body>".into());
        return Err(AppError::Internal(format!(
            "Google token refresh failed ({}): {}",
            status, body
        )));
    }

    let value = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| AppError::Internal(format!("Invalid Google token response JSON: {}", e)))?;

    value
        .get("access_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Internal("Google token refresh did not return access_token".into()))
}

fn find_nonempty(fields: &HashMap<String, String>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = fields.get(*key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct HealthcheckConfig {
    endpoint: String,
    method: Option<String>,
    headers: HashMap<String, String>,
    body: Option<String>,
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
    })
}

/// Look for an auth token in credential fields by checking common key names.
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
    find_auth_token(fields).map(|t| format!("Bearer {}", t))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_healthcheck_no_config() {
        // No healthcheck_config → should return None
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
}
