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

use super::types::{LangfuseTestResult, LangfuseTraceSummary};

const PROBE_PATH: &str = "/api/public/projects";
const TRACES_PATH: &str = "/api/public/traces";
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
const TRACES_TIMEOUT: Duration = Duration::from_secs(15);

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

    // Use the SSRF-safe DNS resolver so a hostname that looks public but
    // resolves to a private/loopback IP at request time (DNS rebinding) is
    // blocked at the transport layer. The host-string validation in the
    // command layer covers the static cases (file://, http remote, etc.);
    // this covers the dynamic ones.
    let client = match reqwest::Client::builder()
        .timeout(PROBE_TIMEOUT)
        .dns_resolver(std::sync::Arc::new(
            crate::engine::ssrf_safe_dns::SsrfSafeDnsResolver,
        ))
        .build()
    {
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
                format!(
                    "Connection to {host} timed out after {}s.",
                    PROBE_TIMEOUT.as_secs()
                )
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
        s if (500..600).contains(&s) => {
            format!("Langfuse returned {s}. Try again or check the host status.")
        }
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

/// Fetch the last `limit` traces from a Langfuse instance.
///
/// Hits `GET /api/public/traces?limit=<n>` with HTTP Basic auth, using the
/// same SSRF-safe DNS resolver as `probe`. Returns a friendly error string
/// (never panics) so the command layer can wrap it in `AppError::Langfuse`
/// for the toast.
pub async fn fetch_recent_traces(
    host: &str,
    public_key: &str,
    secret_key: &str,
    limit: u32,
) -> Result<Vec<LangfuseTraceSummary>, String> {
    let host = host.trim().trim_end_matches('/');
    if host.is_empty() {
        return Err("Host URL is required.".to_string());
    }
    if public_key.trim().is_empty() || secret_key.trim().is_empty() {
        return Err("Both public and secret keys are required.".to_string());
    }
    let limit = limit.clamp(1, 100);
    let url = format!("{host}{TRACES_PATH}?limit={limit}");
    let auth = B64.encode(format!("{}:{}", public_key.trim(), secret_key.trim()));

    let client = reqwest::Client::builder()
        .timeout(TRACES_TIMEOUT)
        .dns_resolver(std::sync::Arc::new(
            crate::engine::ssrf_safe_dns::SsrfSafeDnsResolver,
        ))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .get(&url)
        .header("Authorization", format!("Basic {auth}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                format!(
                    "Connection to {host} timed out after {}s.",
                    TRACES_TIMEOUT.as_secs()
                )
            } else if e.is_connect() {
                format!("Could not reach {host}. Is Langfuse running?")
            } else {
                format!("Request failed: {e}")
            }
        })?;

    let status = resp.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => "Authentication failed. Re-test the connection.".to_string(),
            404 => "Traces endpoint not found at this host.".to_string(),
            s if (500..600).contains(&s) => format!("Langfuse returned {s}."),
            s => format!("Langfuse returned HTTP {s}."),
        });
    }

    let body = resp
        .json::<Value>()
        .await
        .map_err(|e| format!("Could not parse Langfuse response: {e}"))?;
    Ok(parse_trace_list(&body))
}

fn parse_trace_list(v: &Value) -> Vec<LangfuseTraceSummary> {
    let Some(arr) = v.get("data").and_then(|d| d.as_array()) else {
        return Vec::new();
    };
    arr.iter().filter_map(parse_trace_summary).collect()
}

fn parse_trace_summary(v: &Value) -> Option<LangfuseTraceSummary> {
    let id = v.get("id").and_then(|x| x.as_str())?.to_string();
    let str_field = |key: &str| {
        v.get(key)
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
    };
    let f64_field = |key: &str| v.get(key).and_then(|x| x.as_f64());
    Some(LangfuseTraceSummary {
        id,
        name: str_field("name"),
        timestamp: str_field("timestamp"),
        session_id: str_field("sessionId"),
        user_id: str_field("userId"),
        project_id: str_field("projectId"),
        // Langfuse expresses latency in seconds (floating point) on this endpoint.
        latency_seconds: f64_field("latency"),
        total_cost: f64_field("totalCost"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_trace_list_extracts_summaries() {
        let body: Value = serde_json::from_str(
            r#"{
                "data": [
                    {
                        "id": "trace-1",
                        "name": "execution.run",
                        "timestamp": "2026-05-16T11:00:00Z",
                        "sessionId": "sess-1",
                        "userId": "persona-7",
                        "projectId": "personas-default",
                        "latency": 1.42,
                        "totalCost": 0.0034
                    },
                    {
                        "id": "trace-2",
                        "timestamp": "2026-05-16T10:59:00Z"
                    }
                ]
            }"#,
        )
        .unwrap();
        let traces = parse_trace_list(&body);
        assert_eq!(traces.len(), 2);
        assert_eq!(traces[0].id, "trace-1");
        assert_eq!(traces[0].name.as_deref(), Some("execution.run"));
        assert_eq!(traces[0].latency_seconds, Some(1.42));
        assert_eq!(traces[1].id, "trace-2");
        assert_eq!(traces[1].name, None);
    }

    #[test]
    fn parse_trace_list_handles_missing_data_field() {
        let body: Value = serde_json::from_str(r#"{"meta": {}}"#).unwrap();
        assert!(parse_trace_list(&body).is_empty());
    }
}
