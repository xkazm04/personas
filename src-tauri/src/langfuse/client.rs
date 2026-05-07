//! Lightweight Langfuse HTTP probe used by the connection form.
//!
//! Phase 1a only needs to validate that a (host, public_key, secret_key)
//! triple actually authenticates against a Langfuse instance. We do this by
//! GET-ing `/api/public/projects` with HTTP Basic auth — the canonical
//! "are these keys valid" endpoint. The full OTLP exporter path lives in
//! Phase 1b.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::Value;
use std::time::Duration;

use super::types::LangfuseTestResult;

const PROBE_PATH: &str = "/api/public/projects";
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// Test a (host, public_key, secret_key) triple against Langfuse.
/// Never panics; returns a structured result the frontend can render.
pub async fn probe(host: &str, public_key: &str, secret_key: &str) -> LangfuseTestResult {
    let host = host.trim().trim_end_matches('/');
    if host.is_empty() {
        return LangfuseTestResult {
            ok: false,
            http_status: None,
            message: "Host URL is required.".to_string(),
            project_name: None,
        };
    }
    if public_key.trim().is_empty() || secret_key.trim().is_empty() {
        return LangfuseTestResult {
            ok: false,
            http_status: None,
            message: "Both public and secret keys are required.".to_string(),
            project_name: None,
        };
    }

    let url = format!("{host}{PROBE_PATH}");
    let auth = B64.encode(format!("{}:{}", public_key.trim(), secret_key.trim()));

    let client = match reqwest::Client::builder().timeout(PROBE_TIMEOUT).build() {
        Ok(c) => c,
        Err(e) => {
            return LangfuseTestResult {
                ok: false,
                http_status: None,
                message: format!("Failed to build HTTP client: {e}"),
                project_name: None,
            };
        }
    };

    let resp = match client
        .get(&url)
        .header("Authorization", format!("Basic {auth}"))
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let msg = if e.is_timeout() {
                format!("Connection to {host} timed out after {}s.", PROBE_TIMEOUT.as_secs())
            } else if e.is_connect() {
                format!("Could not reach {host}. Check the host URL.")
            } else {
                format!("Request failed: {e}")
            };
            return LangfuseTestResult {
                ok: false,
                http_status: None,
                message: msg,
                project_name: None,
            };
        }
    };

    let status = resp.status();
    let http_status = Some(status.as_u16());

    if status.is_success() {
        let project_name = resp
            .json::<Value>()
            .await
            .ok()
            .and_then(|v| extract_first_project_name(&v));
        return LangfuseTestResult {
            ok: true,
            http_status,
            message: project_name
                .as_ref()
                .map(|n| format!("Connected to project \"{n}\"."))
                .unwrap_or_else(|| "Connected.".to_string()),
            project_name,
        };
    }

    let message = match status.as_u16() {
        401 | 403 => "Authentication failed. Double-check the public and secret keys.".to_string(),
        404 => "Endpoint not found at this host. Is this a Langfuse instance?".to_string(),
        s if (500..600).contains(&s) => format!("Langfuse returned {s}. Try again or check the host status."),
        s => format!("Langfuse returned HTTP {s}."),
    };

    LangfuseTestResult {
        ok: false,
        http_status,
        message,
        project_name: None,
    }
}

fn extract_first_project_name(v: &Value) -> Option<String> {
    let arr = v.get("data").and_then(|d| d.as_array())?;
    let first = arr.first()?;
    first
        .get("name")
        .and_then(|n| n.as_str())
        .map(|s| s.to_string())
}
