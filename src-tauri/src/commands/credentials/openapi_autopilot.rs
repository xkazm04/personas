use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::error::AppError;
use crate::AppState;
use personas_macros::requires;

// ============================================================================
// Types — exported to TypeScript via ts-rs
// ============================================================================

/// Result of testing an endpoint in the playground.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PlaygroundTestResult {
    pub status_code: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub duration_ms: u64,
    pub success: bool,
}

// ============================================================================
// Parsing Logic
// ============================================================================

// ============================================================================
// Connector & Tool Generation
// ============================================================================

// ============================================================================
// Tauri Commands
// ============================================================================

/// Test an API endpoint in the playground.
#[tauri::command]
#[requires(privileged)]
pub async fn openapi_playground_test(
    state: State<'_, Arc<AppState>>,
    base_url: String,
    path: String,
    method: String,
    headers: HashMap<String, String>,
    query_params: HashMap<String, String>,
    body: Option<String>,
) -> Result<PlaygroundTestResult, AppError> {
    // Validate URL
    let full_url = format!("{}{}", base_url.trim_end_matches('/'), path);
    let parsed = url::Url::parse(&full_url)
        .map_err(|e| AppError::Validation(format!("Invalid URL: {}", e)))?;

    // SSRF protection: only allow HTTPS or localhost HTTP
    match parsed.scheme() {
        "https" => {}
        "http"
            if parsed
                .host_str()
                .is_some_and(|h| h == "localhost" || h == "127.0.0.1") => {}
        _ => {
            return Err(AppError::Validation(
                "Only HTTPS URLs are allowed (HTTP only for localhost)".into(),
            ))
        }
    }

    let client = &crate::SSRF_SAFE_HTTP;
    let start = std::time::Instant::now();

    let mut request = match method.to_uppercase().as_str() {
        "GET" => client.get(&full_url),
        "POST" => client.post(&full_url),
        "PUT" => client.put(&full_url),
        "PATCH" => client.patch(&full_url),
        "DELETE" => client.delete(&full_url),
        "HEAD" => client.head(&full_url),
        other => {
            return Err(AppError::Validation(format!(
                "Unsupported HTTP method: {}",
                other
            )))
        }
    };

    for (key, value) in &headers {
        request = request.header(key.as_str(), value.as_str());
    }

    if !query_params.is_empty() {
        request = request.query(&query_params.iter().collect::<Vec<_>>());
    }

    if let Some(ref body_str) = body {
        request = request
            .header("Content-Type", "application/json")
            .body(body_str.clone());
    }

    let response = request
        .send()
        .await
        .map_err(|e| AppError::Validation(format!("Request failed: {}", e)))?;

    let duration_ms = start.elapsed().as_millis() as u64;
    let status_code = response.status().as_u16();
    let success = response.status().is_success();

    let resp_headers: HashMap<String, String> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    let resp_body = response.text().await.unwrap_or_default();

    Ok(PlaygroundTestResult {
        status_code,
        headers: resp_headers,
        body: resp_body,
        duration_ms,
        success,
    })
}
