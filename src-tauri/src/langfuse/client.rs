//! Lightweight Langfuse HTTP probe used by the connection form.
//!
//! Phase 1a only needs to validate that a (host, public_key, secret_key)
//! triple actually authenticates against a Langfuse instance. We do this by
//! GET-ing `/api/public/projects` with HTTP Basic auth — the canonical
//! "are these keys valid" endpoint. The full OTLP exporter path lives in
//! Phase 1b.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Value};
use std::time::Duration;

use super::types::{LangfuseTestResult, LangfuseTraceSummary};

const PROBE_PATH: &str = "/api/public/projects";
const TRACES_PATH: &str = "/api/public/traces";
const OTLP_TRACES_PATH: &str = "/api/public/otel/v1/traces";
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
const TRACES_TIMEOUT: Duration = Duration::from_secs(15);
const SMOKE_TIMEOUT: Duration = Duration::from_secs(15);

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

/// Send a minimal one-span OTLP/JSON trace synchronously and return its
/// 32-hex trace id on success. Used by the "Send test trace" UX so the
/// user can verify export end-to-end without running a real persona.
///
/// Hits `/api/public/otel/v1/traces` with HTTP Basic auth + the SSRF-safe
/// DNS resolver — identical security posture to `probe`.
pub async fn send_smoke_trace(
    host: &str,
    public_key: &str,
    secret_key: &str,
) -> Result<String, String> {
    let host = host.trim().trim_end_matches('/');
    if host.is_empty() {
        return Err("Host URL is required.".to_string());
    }
    if public_key.trim().is_empty() || secret_key.trim().is_empty() {
        return Err("Both public and secret keys are required.".to_string());
    }

    let trace_id = uuid_to_32_hex(&uuid::Uuid::new_v4().to_string());
    let span_id = uuid_to_16_hex(&uuid::Uuid::new_v4().to_string());

    // Span ends "now"; covers the last 100 ms so Langfuse renders a real bar.
    let now_ns = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let start_ns = now_ns.saturating_sub(100_000_000);

    let payload = json!({
        "resourceSpans": [{
            "resource": {
                "attributes": [
                    { "key": "service.name", "value": { "stringValue": "personas-desktop" } },
                    { "key": "personas.kind", "value": { "stringValue": "smoke_trace" } },
                ]
            },
            "scopeSpans": [{
                "scope": { "name": "personas-desktop", "version": env!("CARGO_PKG_VERSION") },
                "spans": [{
                    "traceId": trace_id,
                    "spanId": span_id,
                    "name": "Personas smoke trace",
                    "kind": 1,
                    "startTimeUnixNano": format!("{start_ns}"),
                    "endTimeUnixNano": format!("{now_ns}"),
                    "attributes": [
                        { "key": "personas.span_type", "value": { "stringValue": "smoke" } },
                        { "key": "langfuse.observation.type", "value": { "stringValue": "event" } },
                    ],
                    "status": { "code": 1 }
                }]
            }]
        }]
    });

    let url = format!("{host}{OTLP_TRACES_PATH}");
    let auth = B64.encode(format!("{}:{}", public_key.trim(), secret_key.trim()));

    let client = reqwest::Client::builder()
        .timeout(SMOKE_TIMEOUT)
        .dns_resolver(std::sync::Arc::new(
            crate::engine::ssrf_safe_dns::SsrfSafeDnsResolver,
        ))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .post(&url)
        .header("Authorization", format!("Basic {auth}"))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                format!("POST to {host} timed out after {}s.", SMOKE_TIMEOUT.as_secs())
            } else if e.is_connect() {
                format!("Could not reach {host}. Is Langfuse running?")
            } else {
                format!("Request failed: {e}")
            }
        })?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(200).collect();
        return Err(match status.as_u16() {
            401 | 403 => "Authentication failed. Re-test the connection.".to_string(),
            404 => "OTLP endpoint not found at this host.".to_string(),
            s => format!("Langfuse returned HTTP {s}: {snippet}"),
        });
    }
    Ok(trace_id)
}

fn uuid_to_32_hex(uuid: &str) -> String {
    let stripped: String = uuid.chars().filter(|c| *c != '-').collect();
    let mut s = stripped.to_lowercase();
    while s.len() < 32 {
        s.push('0');
    }
    s.truncate(32);
    s
}

fn uuid_to_16_hex(uuid: &str) -> String {
    let stripped: String = uuid.chars().filter(|c| *c != '-').collect();
    let mut s = stripped.to_lowercase();
    while s.len() < 16 {
        s.push('0');
    }
    s.truncate(16);
    s
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

    #[test]
    fn uuid_to_32_hex_strips_dashes_and_lowercases() {
        let out = uuid_to_32_hex("ABCDEF12-3456-7890-1234-567890ABCDEF");
        assert_eq!(out.len(), 32);
        assert!(out.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(out, "abcdef12345678901234567890abcdef");
    }

    #[test]
    fn uuid_to_16_hex_truncates() {
        let out = uuid_to_16_hex("aabbccdd-eeff-0011-2233-445566778899");
        assert_eq!(out.len(), 16);
        assert_eq!(out, "aabbccddeeff0011");
    }
}
