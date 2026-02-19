use std::collections::HashMap;

use crate::db::repos::connectors as connector_repo;
use crate::db::repos::credentials as cred_repo;
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

    // Decrypt credential data
    let plaintext = if crypto::is_plaintext(&cred.iv) {
        cred.encrypted_data.clone()
    } else {
        crypto::decrypt_from_db(&cred.encrypted_data, &cred.iv)
            .map_err(|e| AppError::Internal(format!("Decryption failed: {}", e)))?
    };

    let fields: HashMap<String, String> = serde_json::from_str(&plaintext)
        .map_err(|e| AppError::Internal(format!("Invalid credential data JSON: {}", e)))?;

    // Find connector for this service_type
    let connectors = connector_repo::get_all(pool)?;
    let connector = connectors
        .iter()
        .find(|c| c.name == cred.service_type);

    let connector = match connector {
        Some(c) => c,
        None => {
            return Ok(HealthcheckResult {
                success: false,
                message: format!("No connector definition found for '{}'", cred.service_type),
            });
        }
    };

    // Parse healthcheck config
    let hc_config = match &connector.healthcheck_config {
        Some(json_str) => match parse_healthcheck_config(json_str) {
            Some(config) => config,
            None => {
                return Ok(HealthcheckResult {
                    success: false,
                    message: "No healthcheck configured for this connector".into(),
                });
            }
        },
        None => {
            return Ok(HealthcheckResult {
                success: false,
                message: "No healthcheck configured for this connector".into(),
            });
        }
    };

    // Find a token in credential fields
    let token = find_auth_token(&fields);

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
        "POST" => client.post(&hc_config.endpoint),
        "PUT" => client.put(&hc_config.endpoint),
        _ => client.get(&hc_config.endpoint),
    };

    if let Some(ref tok) = token {
        request = request.bearer_auth(tok);
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct HealthcheckConfig {
    endpoint: String,
    method: Option<String>,
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
    Some(HealthcheckConfig { endpoint, method })
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
}
