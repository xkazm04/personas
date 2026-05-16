//! OTLP/HTTP-JSON exporter that ships finalized execution traces to Langfuse.
//!
//! Phase 1b. The exporter is a globally-installed singleton driven by a
//! bounded MPSC channel and a tokio worker task:
//!
//! - `install(host, pk, sk)` swaps in a fresh exporter (replaces any previous).
//! - `uninstall()` drops the current exporter; the worker exits when the
//!   channel closes.
//! - `init_from_config()` is called on app startup to restore the exporter
//!   from saved keyring config (no-op if `enabled=false` or not configured).
//! - `export_trace(ExecutionTrace)` is the fire-and-forget hook called by
//!   `engine::runner` after `TraceCollector::finalize`. No-op when nothing is
//!   installed; never blocks the execution path.
//!
//! The wire format is OTLP/HTTP-JSON to `<host>/api/public/otel/v1/traces`
//! with HTTP Basic auth (base64(pk:sk)). Langfuse-specific semantics are
//! expressed via span attributes:
//!   - `langfuse.session.id` → `ExecutionTrace.chain_trace_id`
//!   - `langfuse.observation.type=generation` on `CliSpawn` spans (LLM call)
//!   - `langfuse.observation.type=tool` on `ToolCall` spans
//!   - `gen_ai.usage.input_tokens` / `output_tokens` from `TraceSpan` fields
//!
//! `redact_content` is honored at POST time (read from keyring per-export)
//! so the user can toggle it without restarting the exporter. When redacted
//! we drop the per-span `metadata` attribute since that's where prompt
//! / completion text would land if a span carries it.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;

use crate::engine::trace::{ExecutionTrace, SpanType, TraceSpan};
use crate::langfuse::config;

/// Bound on the export queue. Each entry is one finalized trace; a desktop
/// user is unlikely to ever fill this. Overflow drops the oldest with a warn.
const QUEUE_DEPTH: usize = 64;

/// Per-export HTTP timeout. Generous because a self-hosted Langfuse on the
/// same machine is fast but we'd rather log a slow POST than fail.
const POST_TIMEOUT: Duration = Duration::from_secs(15);

static EXPORTER: OnceLock<RwLock<Option<Arc<LangfuseExporter>>>> = OnceLock::new();
/// Snapshot of the active Langfuse endpoint + auth header. Kept in sync with
/// [`EXPORTER`] so non-trace API calls (Scores etc.) can reach Langfuse
/// without the channel ceremony the trace path uses.
static HTTP_CONFIG: OnceLock<RwLock<Option<HttpConfig>>> = OnceLock::new();
/// Process-lifetime rolling stats so the plugin page can render an honest
/// "is this thing actually working?" view without round-tripping to Langfuse.
static EXPORT_STATS: OnceLock<Mutex<ExportStatsInner>> = OnceLock::new();

/// Cap on stored recent-success timestamps. A desktop user driving real
/// executions will not exceed this in an hour; cap keeps RAM bounded if
/// they do.
const RECENT_SUCCESS_CAP: usize = 1000;
const ONE_HOUR_SECS: i64 = 3600;

#[derive(Default)]
struct ExportStatsInner {
    success_total: u64,
    failure_total: u64,
    last_export_at: Option<i64>,
    last_error_at: Option<i64>,
    last_error: Option<String>,
    recent_success_ts: VecDeque<i64>,
}

fn stats_cell() -> &'static Mutex<ExportStatsInner> {
    EXPORT_STATS.get_or_init(|| Mutex::new(ExportStatsInner::default()))
}

fn unix_secs_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn record_export_success() {
    let now = unix_secs_now();
    let mut g = match stats_cell().lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    g.success_total = g.success_total.saturating_add(1);
    g.last_export_at = Some(now);
    if g.recent_success_ts.len() >= RECENT_SUCCESS_CAP {
        g.recent_success_ts.pop_front();
    }
    g.recent_success_ts.push_back(now);
}

fn record_export_failure(msg: impl Into<String>) {
    let now = unix_secs_now();
    let mut g = match stats_cell().lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    g.failure_total = g.failure_total.saturating_add(1);
    g.last_error_at = Some(now);
    let s = msg.into();
    g.last_error = Some(s.chars().take(200).collect());
}

/// Snapshot of the in-process exporter stats. Returned by
/// `langfuse_get_export_stats`; intentionally narrow so the wire payload
/// stays small.
pub fn snapshot_stats() -> ExportStatsSnapshot {
    let cutoff = unix_secs_now() - ONE_HOUR_SECS;
    let g = match stats_cell().lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    let success_last_hour = g
        .recent_success_ts
        .iter()
        .filter(|t| **t >= cutoff)
        .count() as u64;
    ExportStatsSnapshot {
        success_total: g.success_total,
        failure_total: g.failure_total,
        success_last_hour,
        last_export_at: g.last_export_at,
        last_error_at: g.last_error_at,
        last_error: g.last_error.clone(),
    }
}

/// Plain-data flat view of [`ExportStatsInner`] for the IPC layer.
#[derive(Debug, Clone)]
pub struct ExportStatsSnapshot {
    pub success_total: u64,
    pub failure_total: u64,
    pub success_last_hour: u64,
    pub last_export_at: Option<i64>,
    pub last_error_at: Option<i64>,
    pub last_error: Option<String>,
}

fn cell() -> &'static RwLock<Option<Arc<LangfuseExporter>>> {
    EXPORTER.get_or_init(|| RwLock::new(None))
}

fn http_cell() -> &'static RwLock<Option<HttpConfig>> {
    HTTP_CONFIG.get_or_init(|| RwLock::new(None))
}

#[derive(Clone)]
struct HttpConfig {
    host: String,
    auth_header: String,
}

struct LangfuseExporter {
    sender: mpsc::Sender<ExecutionTrace>,
}

impl LangfuseExporter {
    fn spawn(host: String, public_key: String, secret_key: String) -> Self {
        let (tx, mut rx) = mpsc::channel::<ExecutionTrace>(QUEUE_DEPTH);
        let url = format!("{}/api/public/otel/v1/traces", host.trim_end_matches('/'));
        let auth_header = format!("Basic {}", B64.encode(format!("{public_key}:{secret_key}")));

        // `tauri::async_runtime::spawn` rather than `tokio::spawn` —
        // this exporter is constructed during Tauri's setup hook, where
        // there's no current tokio runtime in scope yet. Calling
        // `tokio::spawn` panics with "no reactor running" and crashes
        // the app on launch. Tauri's wrapper schedules onto the
        // runtime it manages internally and works in both contexts.
        tauri::async_runtime::spawn(async move {
            let client = match reqwest::Client::builder().timeout(POST_TIMEOUT).build() {
                Ok(c) => c,
                Err(e) => {
                    tracing::error!(error = %e, "Langfuse exporter: failed to build HTTP client");
                    return;
                }
            };

            while let Some(trace) = rx.recv().await {
                let redact = config::load_redact();
                let payload = match serde_json::to_vec(&serialize_otlp(&trace, redact)) {
                    Ok(p) => p,
                    Err(e) => {
                        tracing::warn!(
                            trace_id = %trace.trace_id,
                            error = %e,
                            "Langfuse exporter: failed to serialize trace; dropping"
                        );
                        continue;
                    }
                };

                let result = client
                    .post(&url)
                    .header("Authorization", &auth_header)
                    .header("Content-Type", "application/json")
                    .body(payload)
                    .send()
                    .await;

                match result {
                    Ok(resp) if resp.status().is_success() => {
                        record_export_success();
                        tracing::debug!(
                            trace_id = %trace.trace_id,
                            execution_id = %trace.execution_id,
                            "Exported trace to Langfuse"
                        );
                    }
                    Ok(resp) => {
                        let status = resp.status();
                        let body = resp.text().await.unwrap_or_default();
                        let snippet: String = body.chars().take(200).collect();
                        record_export_failure(format!("HTTP {status}: {snippet}"));
                        tracing::warn!(
                            trace_id = %trace.trace_id,
                            status = %status,
                            body = %snippet,
                            "Langfuse rejected trace"
                        );
                    }
                    Err(e) => {
                        record_export_failure(format!("Transport error: {e}"));
                        tracing::warn!(
                            trace_id = %trace.trace_id,
                            error = %e,
                            "Failed to POST trace to Langfuse"
                        );
                    }
                }
            }
            tracing::debug!("Langfuse exporter worker exiting (channel closed)");
        });

        Self { sender: tx }
    }

    fn submit(&self, trace: ExecutionTrace) {
        match self.sender.try_send(trace) {
            Ok(()) => {}
            Err(mpsc::error::TrySendError::Full(t)) => {
                tracing::warn!(
                    trace_id = %t.trace_id,
                    "Langfuse export queue full; dropping trace"
                );
            }
            Err(mpsc::error::TrySendError::Closed(t)) => {
                tracing::debug!(
                    trace_id = %t.trace_id,
                    "Langfuse exporter channel closed; trace not exported"
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Install or replace the global exporter. Drops any prior exporter; its
/// worker exits when the in-flight queue drains.
pub fn install(host: String, public_key: String, secret_key: String) {
    let auth_header = format!("Basic {}", B64.encode(format!("{public_key}:{secret_key}")));
    let exporter = Arc::new(LangfuseExporter::spawn(
        host.clone(),
        public_key,
        secret_key,
    ));
    let mut guard = match cell().write() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    *guard = Some(exporter);
    let mut http_guard = match http_cell().write() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    *http_guard = Some(HttpConfig { host, auth_header });
    tracing::info!("Langfuse exporter installed");
}

/// Is the global exporter currently installed? Useful for the health bar to
/// distinguish "config saved but not yet active" from "actively exporting."
pub fn is_installed() -> bool {
    let guard = match cell().read() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    guard.is_some()
}

/// Tear down the global exporter (no-op if none installed).
pub fn uninstall() {
    let mut guard = match cell().write() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    if guard.take().is_some() {
        tracing::info!("Langfuse exporter uninstalled");
    }
    let mut http_guard = match http_cell().write() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    *http_guard = None;
}

/// Fire-and-forget export of a finalized trace. No-op when nothing is
/// installed. Never blocks; never propagates errors to the execution path.
/// Takes a reference and clones internally so the caller can keep using the
/// trace after this returns.
pub fn export_trace(trace: &ExecutionTrace) {
    let exporter = {
        let guard = match cell().read() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        guard.clone()
    };
    if let Some(e) = exporter {
        e.submit(trace.clone());
    }
}

/// Push Lab evaluation scores to Langfuse's `/api/public/scores` endpoint.
/// Fire-and-forget; takes the fully-encoded 32-hex trace ID and the per-rubric
/// numeric values. No-op when no exporter is installed.
pub fn push_lab_scores(
    trace_id_hex: String,
    tool_accuracy: Option<i32>,
    output_quality: Option<i32>,
    protocol_compliance: Option<i32>,
    rationale: Option<String>,
) {
    let cfg = {
        let guard = match http_cell().read() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        guard.clone()
    };
    let Some(cfg) = cfg else {
        return;
    };
    let url = format!("{}/api/public/scores", cfg.host.trim_end_matches('/'));

    tokio::spawn(async move {
        let client = match reqwest::Client::builder().timeout(POST_TIMEOUT).build() {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!(error = %e, "Lab score push: HTTP client build failed");
                return;
            }
        };
        let scores = [
            ("tool_accuracy", tool_accuracy),
            ("output_quality", output_quality),
            ("protocol_compliance", protocol_compliance),
        ];
        for (name, value) in scores {
            let Some(v) = value else { continue };
            let body = serde_json::json!({
                "id": format!("personas-{}-{}", name, uuid::Uuid::new_v4()),
                "traceId": trace_id_hex,
                "name": name,
                "value": v,
                "dataType": "NUMERIC",
                "comment": rationale,
            });
            let result = client
                .post(&url)
                .header("Authorization", &cfg.auth_header)
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await;
            match result {
                Ok(r) if r.status().is_success() => {
                    tracing::debug!(trace_id = %trace_id_hex, score = name, value = v, "Pushed Lab score to Langfuse");
                }
                Ok(r) => {
                    tracing::warn!(
                        trace_id = %trace_id_hex,
                        score = name,
                        status = %r.status(),
                        "Langfuse rejected Lab score"
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        trace_id = %trace_id_hex,
                        score = name,
                        error = %e,
                        "Failed to POST Lab score"
                    );
                }
            }
        }
    });
}

/// Convert a UUID-style trace id (with or without dashes) to the 32-char
/// lowercase hex form Langfuse expects. Public so callers (test_runner)
/// can reuse the encoding when looking up an execution's trace id.
pub fn trace_id_hex(uuid: &str) -> String {
    uuid_to_trace_id_hex(uuid)
}

/// Restore the exporter from saved keyring config on app startup. No-op when
/// the integration has never been configured or `enabled=false`.
pub fn init_from_config() {
    let host = match config::load_host() {
        Some(h) => h,
        None => return,
    };
    let public_key = match config::load_public_key() {
        Some(k) => k,
        None => return,
    };
    let secret_key = match config::load_secret_key() {
        Some(k) => k,
        None => return,
    };
    if !config::load_enabled() {
        tracing::debug!("Langfuse config present but disabled; exporter not installed");
        return;
    }
    install(host, public_key, secret_key);
}

// ---------------------------------------------------------------------------
// OTLP/HTTP-JSON serialization
// ---------------------------------------------------------------------------

fn serialize_otlp(trace: &ExecutionTrace, redact: bool) -> Value {
    // Wall-clock anchor: the execution finalized at `created_at`. We rebase
    // each span's relative `start_ms` against (finalize - total_duration_ms)
    // so OTLP timestamps are real Unix nanoseconds.
    let finalize_ns = parse_iso_to_unix_ns(&trace.created_at).unwrap_or_else(now_unix_ns);
    let total_ns = trace
        .total_duration_ms
        .unwrap_or(0)
        .saturating_mul(1_000_000);
    let exec_start_ns = finalize_ns.saturating_sub(total_ns);

    let trace_id_hex = uuid_to_trace_id_hex(&trace.trace_id);

    let spans: Vec<Value> = trace
        .spans
        .iter()
        .map(|s| serialize_span(s, &trace_id_hex, exec_start_ns, redact))
        .collect();

    let mut resource_attrs = vec![
        attr_str("service.name", "personas-desktop"),
        attr_str("personas.execution_id", &trace.execution_id),
        attr_str("personas.persona_id", &trace.persona_id),
    ];
    if let Some(chain) = &trace.chain_trace_id {
        // langfuse.session.id is read by Langfuse to group traces under a
        // session — perfect for multi-persona chain executions that share a
        // chain_trace_id.
        resource_attrs.push(attr_str("langfuse.session.id", chain));
        resource_attrs.push(attr_str("personas.chain_trace_id", chain));
    }

    json!({
        "resourceSpans": [{
            "resource": { "attributes": resource_attrs },
            "scopeSpans": [{
                "scope": { "name": "personas-desktop", "version": env!("CARGO_PKG_VERSION") },
                "spans": spans,
            }],
        }]
    })
}

fn serialize_span(span: &TraceSpan, trace_id_hex: &str, exec_start_ns: u64, redact: bool) -> Value {
    let span_id_hex = uuid_to_span_id_hex(&span.span_id);
    let parent_span_id_hex = span.parent_span_id.as_ref().map(|p| uuid_to_span_id_hex(p));

    let start_ns = exec_start_ns.saturating_add(span.start_ms.saturating_mul(1_000_000));
    let end_ns = exec_start_ns.saturating_add(
        span.end_ms
            .unwrap_or(span.start_ms)
            .saturating_mul(1_000_000),
    );

    let mut attrs = vec![attr_str(
        "personas.span_type",
        span_type_str(&span.span_type),
    )];

    // Map our typed span enum to Langfuse's observation type so the trace
    // tree renders correctly in the Langfuse UI.
    if let Some(obs) = langfuse_observation_type(&span.span_type) {
        attrs.push(attr_str("langfuse.observation.type", obs));
    }

    if let Some(tokens) = span.input_tokens {
        attrs.push(attr_int("gen_ai.usage.input_tokens", tokens as i64));
    }
    if let Some(tokens) = span.output_tokens {
        attrs.push(attr_int("gen_ai.usage.output_tokens", tokens as i64));
    }
    if let Some(cost) = span.cost_usd {
        // Langfuse reads observation cost from the `usage_details` field on
        // its own ingestion API; for OTLP we surface it as a metadata
        // attribute and let the exporter compute aggregates.
        attrs.push(attr_double("personas.cost_usd", cost));
    }

    if !redact {
        if let Some(meta) = &span.metadata {
            // Flatten one level of metadata into individual attributes so
            // string/number/bool fields are queryable in Langfuse. Nested
            // objects/arrays are stringified as JSON.
            if let Some(obj) = meta.as_object() {
                for (k, v) in obj {
                    attrs.push(metadata_attr(k, v));
                }
            } else {
                attrs.push(attr_str("personas.metadata", &meta.to_string()));
            }
        }
    }

    let status = if span.error.is_some() {
        // OTLP status code: 1=Ok, 2=Error.
        json!({ "code": 2, "message": span.error.clone().unwrap_or_default() })
    } else {
        json!({ "code": 1 })
    };

    let mut span_obj = json!({
        "traceId": trace_id_hex,
        "spanId": span_id_hex,
        "name": span.name,
        // SPAN_KIND_INTERNAL = 1.
        "kind": 1,
        "startTimeUnixNano": format!("{start_ns}"),
        "endTimeUnixNano": format!("{end_ns}"),
        "attributes": attrs,
        "status": status,
    });
    if let Some(parent) = parent_span_id_hex {
        span_obj["parentSpanId"] = Value::String(parent);
    }
    span_obj
}

// ---------------------------------------------------------------------------
// Attribute helpers
// ---------------------------------------------------------------------------

fn attr_str(key: &str, value: &str) -> Value {
    json!({ "key": key, "value": { "stringValue": value } })
}
fn attr_int(key: &str, value: i64) -> Value {
    json!({ "key": key, "value": { "intValue": format!("{value}") } })
}
fn attr_double(key: &str, value: f64) -> Value {
    json!({ "key": key, "value": { "doubleValue": value } })
}
fn attr_bool(key: &str, value: bool) -> Value {
    json!({ "key": key, "value": { "boolValue": value } })
}

fn metadata_attr(key: &str, value: &Value) -> Value {
    let prefixed = format!("personas.meta.{key}");
    match value {
        Value::String(s) => attr_str(&prefixed, s),
        Value::Bool(b) => attr_bool(&prefixed, *b),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                attr_int(&prefixed, i)
            } else if let Some(f) = n.as_f64() {
                attr_double(&prefixed, f)
            } else {
                attr_str(&prefixed, &n.to_string())
            }
        }
        Value::Null => attr_str(&prefixed, ""),
        _ => attr_str(&prefixed, &value.to_string()),
    }
}

fn span_type_str(kind: &SpanType) -> &'static str {
    match kind {
        SpanType::Execution => "execution",
        SpanType::PromptAssembly => "prompt_assembly",
        SpanType::CredentialResolution => "credential_resolution",
        SpanType::CliSpawn => "cli_spawn",
        SpanType::ToolCall => "tool_call",
        SpanType::ProtocolDispatch => "protocol_dispatch",
        SpanType::ChainEvaluation => "chain_evaluation",
        SpanType::StreamProcessing => "stream_processing",
        SpanType::OutcomeAssessment => "outcome_assessment",
        SpanType::HealingAnalysis => "healing_analysis",
        SpanType::PipelineStage => "pipeline_stage",
    }
}

fn langfuse_observation_type(kind: &SpanType) -> Option<&'static str> {
    match kind {
        SpanType::CliSpawn => Some("generation"),
        SpanType::ToolCall => Some("tool"),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// ID + time helpers
// ---------------------------------------------------------------------------

fn uuid_to_trace_id_hex(uuid: &str) -> String {
    let stripped: String = uuid.chars().filter(|c| *c != '-').collect();
    if stripped.len() == 32 {
        stripped.to_lowercase()
    } else {
        // Defensive: pad/truncate to exactly 32 hex chars so OTLP doesn't reject.
        let mut s = stripped.to_lowercase();
        while s.len() < 32 {
            s.push('0');
        }
        s.truncate(32);
        s
    }
}

fn uuid_to_span_id_hex(uuid: &str) -> String {
    let stripped: String = uuid.chars().filter(|c| *c != '-').collect();
    let lower = stripped.to_lowercase();
    if lower.len() >= 16 {
        lower[..16].to_string()
    } else {
        let mut s = lower;
        while s.len() < 16 {
            s.push('0');
        }
        s
    }
}

fn parse_iso_to_unix_ns(iso: &str) -> Option<u64> {
    chrono::DateTime::parse_from_rfc3339(iso)
        .ok()
        .and_then(|dt| dt.timestamp_nanos_opt())
        .map(|n| n as u64)
}

fn now_unix_ns() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::trace::TraceSpan;

    fn fake_trace() -> ExecutionTrace {
        ExecutionTrace {
            trace_id: "11111111-2222-3333-4444-555555555555".to_string(),
            execution_id: "exec-1".to_string(),
            persona_id: "persona-1".to_string(),
            chain_trace_id: Some("chain-9".to_string()),
            spans: vec![
                TraceSpan {
                    span_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".to_string(),
                    parent_span_id: None,
                    span_type: SpanType::Execution,
                    name: "Execution".to_string(),
                    start_ms: 0,
                    end_ms: Some(1000),
                    duration_ms: Some(1000),
                    cost_usd: Some(0.001),
                    input_tokens: Some(50),
                    output_tokens: Some(120),
                    error: None,
                    metadata: None,
                },
                TraceSpan {
                    span_id: "ffffffff-0000-0000-0000-000000000001".to_string(),
                    parent_span_id: Some("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".to_string()),
                    span_type: SpanType::CliSpawn,
                    name: "CLI Spawn: claude".to_string(),
                    start_ms: 100,
                    end_ms: Some(900),
                    duration_ms: Some(800),
                    cost_usd: Some(0.001),
                    input_tokens: Some(50),
                    output_tokens: Some(120),
                    error: None,
                    metadata: Some(json!({ "model": "claude-opus", "engine": "anthropic" })),
                },
            ],
            total_duration_ms: Some(1000),
            evicted_span_count: 0,
            created_at: "2026-05-07T12:34:56Z".to_string(),
        }
    }

    #[test]
    fn trace_id_is_32_hex_chars() {
        let payload = serialize_otlp(&fake_trace(), false);
        let trace_id = payload["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["traceId"]
            .as_str()
            .unwrap();
        assert_eq!(trace_id.len(), 32);
        assert!(trace_id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn span_id_is_16_hex_chars() {
        let payload = serialize_otlp(&fake_trace(), false);
        let span_id = payload["resourceSpans"][0]["scopeSpans"][0]["spans"][1]["spanId"]
            .as_str()
            .unwrap();
        assert_eq!(span_id.len(), 16);
        assert!(span_id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn cli_spawn_is_tagged_as_generation() {
        let payload = serialize_otlp(&fake_trace(), false);
        let attrs = &payload["resourceSpans"][0]["scopeSpans"][0]["spans"][1]["attributes"];
        let has_generation = attrs.as_array().unwrap().iter().any(|a| {
            a["key"].as_str() == Some("langfuse.observation.type")
                && a["value"]["stringValue"].as_str() == Some("generation")
        });
        assert!(has_generation);
    }

    #[test]
    fn redact_drops_metadata_attributes() {
        let payload = serialize_otlp(&fake_trace(), true);
        let attrs = &payload["resourceSpans"][0]["scopeSpans"][0]["spans"][1]["attributes"];
        let has_metadata = attrs.as_array().unwrap().iter().any(|a| {
            a["key"]
                .as_str()
                .unwrap_or("")
                .starts_with("personas.meta.")
        });
        assert!(
            !has_metadata,
            "redacted export must not include metadata.* attributes"
        );
    }

    #[test]
    fn redact_keeps_token_counts() {
        let payload = serialize_otlp(&fake_trace(), true);
        let attrs = &payload["resourceSpans"][0]["scopeSpans"][0]["spans"][1]["attributes"];
        let has_tokens = attrs
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["key"].as_str() == Some("gen_ai.usage.input_tokens"));
        assert!(has_tokens);
    }

    #[test]
    fn root_span_has_no_parent() {
        let payload = serialize_otlp(&fake_trace(), false);
        let root = &payload["resourceSpans"][0]["scopeSpans"][0]["spans"][0];
        assert!(root.get("parentSpanId").is_none());
    }

    #[test]
    fn child_span_has_parent_id() {
        let payload = serialize_otlp(&fake_trace(), false);
        let child = &payload["resourceSpans"][0]["scopeSpans"][0]["spans"][1];
        assert!(child.get("parentSpanId").and_then(|v| v.as_str()).is_some());
    }

    #[test]
    fn session_id_carries_chain_trace_id() {
        let payload = serialize_otlp(&fake_trace(), false);
        let resource_attrs = &payload["resourceSpans"][0]["resource"]["attributes"];
        let has_session = resource_attrs.as_array().unwrap().iter().any(|a| {
            a["key"].as_str() == Some("langfuse.session.id")
                && a["value"]["stringValue"].as_str() == Some("chain-9")
        });
        assert!(has_session);
    }
}
