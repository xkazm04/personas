//! HTTP API proxy engine for credential-authenticated requests.
//!
//! Proxies arbitrary HTTP requests through a credential's auth strategy,
//! resolving base URLs and applying authentication automatically.
//! Enforces per-credential token-bucket rate limiting to prevent runaway
//! API consumption from compromised or misconfigured automations.
//!
//! Maintains per-credential aggregate metrics (latency percentiles, error
//! rates) via an in-memory ring buffer, exposed through
//! [`get_all_proxy_metrics`].

use std::collections::{HashMap, VecDeque};
use std::sync::LazyLock;
use std::time::Instant;

use tokio::sync::Mutex;
use ts_rs::TS;

use crate::db::models::ConnectorDefinition;
use crate::db::repos::resources::audit_log;
use crate::db::repos::resources::connectors as connector_repo;
use crate::db::repos::resources::credentials as cred_repo;
use crate::db::DbPool;
use crate::error::AppError;

use super::connector_strategy;
use super::healthcheck::{validate_field_values, validate_healthcheck_url};

// ---------------------------------------------------------------------------
// Connector list cache (avoids hitting DB on every proxied request)
// ---------------------------------------------------------------------------

/// TTL for the cached connector list (seconds).
const CONNECTOR_CACHE_TTL_SECS: f64 = 30.0;

struct ConnectorCache {
    connectors: Vec<ConnectorDefinition>,
    fetched_at: Instant,
}

static CONNECTOR_CACHE: LazyLock<std::sync::Mutex<Option<ConnectorCache>>> =
    LazyLock::new(|| std::sync::Mutex::new(None));

/// Return the full connector list, reusing a cached copy when fresh.
fn get_all_connectors_cached(pool: &DbPool) -> Result<Vec<ConnectorDefinition>, AppError> {
    let mut cache = CONNECTOR_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(ref entry) = *cache {
        if entry.fetched_at.elapsed().as_secs_f64() < CONNECTOR_CACHE_TTL_SECS {
            return Ok(entry.connectors.clone());
        }
    }
    let connectors = connector_repo::get_all(pool)?;
    *cache = Some(ConnectorCache {
        connectors: connectors.clone(),
        fetched_at: Instant::now(),
    });
    Ok(connectors)
}

/// Invalidate the connector cache (call after connector CRUD operations).
pub fn invalidate_connector_cache() {
    let mut cache = CONNECTOR_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    *cache = None;
}

// ---------------------------------------------------------------------------
// Per-credential token-bucket rate limiter
// ---------------------------------------------------------------------------

/// Default rate limit: 60 requests per 60 seconds (1 req/sec sustained).
const DEFAULT_RATE_LIMIT: u32 = 60;
/// Window size in seconds for the token bucket refill.
const RATE_LIMIT_WINDOW_SECS: f64 = 60.0;
/// Evict buckets idle longer than this (seconds).
const BUCKET_IDLE_EVICTION_SECS: f64 = 600.0;
/// Minimum interval between eviction sweeps (seconds).
const EVICTION_SWEEP_INTERVAL_SECS: f64 = 60.0;
/// Hard cap on the number of tracked buckets.
const MAX_BUCKET_ENTRIES: usize = 1024;

/// A simple token-bucket that refills linearly over a 60-second window.
struct TokenBucket {
    tokens: f64,
    max_tokens: f64,
    last_refill: Instant,
    last_used: Instant,
    refill_rate: f64, // tokens per second
}

impl TokenBucket {
    fn new(max_tokens: u32) -> Self {
        let max = max_tokens as f64;
        let now = Instant::now();
        Self {
            tokens: max,
            max_tokens: max,
            last_refill: now,
            last_used: now,
            refill_rate: max / RATE_LIMIT_WINDOW_SECS,
        }
    }

    /// Try to consume one token. Returns `Ok(())` on success, or
    /// `Err(retry_after_secs)` if the bucket is empty.
    fn try_acquire(&mut self) -> Result<(), u64> {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_refill).as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.refill_rate).min(self.max_tokens);
        self.last_refill = now;
        self.last_used = now;

        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            Ok(())
        } else {
            // How long until 1 token is available
            let wait = (1.0 - self.tokens) / self.refill_rate;
            Err(wait.ceil() as u64)
        }
    }
}

/// Global registry of per-credential token buckets.
struct RateLimiterRegistry {
    buckets: HashMap<String, TokenBucket>,
    last_sweep: Instant,
}

impl RateLimiterRegistry {
    fn new() -> Self {
        Self {
            buckets: HashMap::new(),
            last_sweep: Instant::now(),
        }
    }

    /// Remove buckets that haven't been used within the idle threshold.
    /// Runs at most once per `EVICTION_SWEEP_INTERVAL_SECS`.
    fn sweep_stale(&mut self) {
        let now = Instant::now();
        if now.duration_since(self.last_sweep).as_secs_f64() < EVICTION_SWEEP_INTERVAL_SECS {
            return;
        }
        self.last_sweep = now;
        self.buckets
            .retain(|_, b| now.duration_since(b.last_used).as_secs_f64() < BUCKET_IDLE_EVICTION_SECS);
    }
}

static RATE_LIMITERS: LazyLock<Mutex<RateLimiterRegistry>> =
    LazyLock::new(|| Mutex::new(RateLimiterRegistry::new()));

/// Extract `rate_limit_rpm` from connector metadata JSON, if present.
fn parse_rate_limit_from_metadata(metadata_json: Option<&str>) -> u32 {
    metadata_json
        .and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok())
        .and_then(|v| v.get("rate_limit_rpm")?.as_u64())
        .map(|v| v.clamp(1, 10_000) as u32)
        .unwrap_or(DEFAULT_RATE_LIMIT)
}

/// Check the per-credential rate limit. Returns `Ok(())` if allowed, or an
/// `AppError::RateLimited` with retry-after information when the bucket is empty.
async fn check_rate_limit(
    credential_id: &str,
    connector_metadata: Option<&str>,
) -> Result<(), AppError> {
    let limit = parse_rate_limit_from_metadata(connector_metadata);
    let mut registry = RATE_LIMITERS.lock().await;

    // Periodically evict idle buckets to prevent unbounded growth.
    registry.sweep_stale();

    // Enforce hard capacity: if at the limit and this is a new credential,
    // evict the least-recently-used entry to make room.
    if registry.buckets.len() >= MAX_BUCKET_ENTRIES
        && !registry.buckets.contains_key(credential_id)
    {
        if let Some(oldest_key) = registry
            .buckets
            .iter()
            .min_by_key(|(_, b)| b.last_used)
            .map(|(k, _)| k.clone())
        {
            registry.buckets.remove(&oldest_key);
        }
    }

    let bucket = registry
        .buckets
        .entry(credential_id.to_string())
        .or_insert_with(|| TokenBucket::new(limit));

    // If the configured limit changed (e.g. connector metadata was updated),
    // adjust the bucket capacity without resetting current tokens.
    let new_max = limit as f64;
    if (bucket.max_tokens - new_max).abs() > f64::EPSILON {
        bucket.max_tokens = new_max;
        bucket.refill_rate = new_max / RATE_LIMIT_WINDOW_SECS;
        bucket.tokens = bucket.tokens.min(new_max);
    }

    match bucket.try_acquire() {
        Ok(()) => Ok(()),
        Err(retry_after) => Err(AppError::RateLimited(format!(
            "Credential {} exceeded rate limit ({} req/min). Retry after {} second(s).",
            credential_id, limit, retry_after
        ))),
    }
}

// ---------------------------------------------------------------------------
// Per-credential aggregate metrics ring buffer
// ---------------------------------------------------------------------------

/// Number of recent requests to keep per credential.
const METRICS_RING_BUFFER_SIZE: usize = 50;
/// Evict metric buffers idle longer than this (seconds).
const METRICS_IDLE_EVICTION_SECS: f64 = 1800.0;

/// A single recorded request outcome.
struct MetricsEntry {
    timestamp: chrono::DateTime<chrono::Utc>,
    status_code: u16,
    duration_ms: u64,
}

/// Per-credential ring buffer of recent request outcomes.
struct CredentialMetricsBuffer {
    entries: VecDeque<MetricsEntry>,
    service_type: String,
}

impl CredentialMetricsBuffer {
    fn new(service_type: String) -> Self {
        Self {
            entries: VecDeque::with_capacity(METRICS_RING_BUFFER_SIZE),
            service_type,
        }
    }

    fn push(&mut self, entry: MetricsEntry) {
        if self.entries.len() >= METRICS_RING_BUFFER_SIZE {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
    }
}

/// Global registry of per-credential metrics buffers.
struct MetricsRegistry {
    buffers: HashMap<String, CredentialMetricsBuffer>,
}

impl MetricsRegistry {
    fn new() -> Self {
        Self {
            buffers: HashMap::new(),
        }
    }

    /// Evict buffers that haven't received a request in a long time.
    fn sweep_stale(&mut self) {
        let now = chrono::Utc::now();
        self.buffers.retain(|_, buf| {
            buf.entries
                .back()
                .map(|e| (now - e.timestamp).num_seconds() < METRICS_IDLE_EVICTION_SECS as i64)
                .unwrap_or(false)
        });
    }
}

static METRICS_REGISTRY: LazyLock<Mutex<MetricsRegistry>> =
    LazyLock::new(|| Mutex::new(MetricsRegistry::new()));

/// Record a request outcome in the per-credential metrics buffer.
async fn record_metric(credential_id: &str, service_type: &str, status_code: u16, duration_ms: u64) {
    let mut registry = METRICS_REGISTRY.lock().await;
    registry.sweep_stale();

    let buf = registry
        .buffers
        .entry(credential_id.to_string())
        .or_insert_with(|| CredentialMetricsBuffer::new(service_type.to_string()));

    buf.push(MetricsEntry {
        timestamp: chrono::Utc::now(),
        status_code,
        duration_ms,
    });
}

/// Metrics summary for a single credential.
#[derive(Debug, Clone, serde::Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ApiProxyCredentialMetrics {
    pub credential_id: String,
    pub service_type: String,
    pub request_count: usize,
    pub error_count_4xx: usize,
    pub error_count_5xx: usize,
    pub error_rate: f64,
    pub latency_p50_ms: u64,
    pub latency_p95_ms: u64,
    pub latency_p99_ms: u64,
    pub latency_avg_ms: u64,
    pub last_request_at: Option<String>,
}

fn percentile(sorted: &[u64], p: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let idx = ((p / 100.0) * (sorted.len() as f64 - 1.0)).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

/// Return aggregate metrics for all credentials that have buffered data.
pub async fn get_all_proxy_metrics() -> Vec<ApiProxyCredentialMetrics> {
    let registry = METRICS_REGISTRY.lock().await;
    let mut results = Vec::with_capacity(registry.buffers.len());

    for (cred_id, buf) in &registry.buffers {
        let count = buf.entries.len();
        if count == 0 {
            continue;
        }

        let errors_4xx = buf.entries.iter().filter(|e| (400..500).contains(&e.status_code)).count();
        let errors_5xx = buf.entries.iter().filter(|e| e.status_code >= 500).count();
        let total_errors = errors_4xx + errors_5xx;
        let error_rate = total_errors as f64 / count as f64;

        let mut latencies: Vec<u64> = buf.entries.iter().map(|e| e.duration_ms).collect();
        latencies.sort_unstable();

        let avg = latencies.iter().sum::<u64>() / count as u64;
        let last_ts = buf.entries.back().map(|e| e.timestamp.to_rfc3339());

        results.push(ApiProxyCredentialMetrics {
            credential_id: cred_id.clone(),
            service_type: buf.service_type.clone(),
            request_count: count,
            error_count_4xx: errors_4xx,
            error_count_5xx: errors_5xx,
            error_rate,
            latency_p50_ms: percentile(&latencies, 50.0),
            latency_p95_ms: percentile(&latencies, 95.0),
            latency_p99_ms: percentile(&latencies, 99.0),
            latency_avg_ms: avg,
            last_request_at: last_ts,
        });
    }

    results
}

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
        "elevenlabs" => Some("https://api.elevenlabs.io/v1"),
        "leonardo_ai" => Some("https://cloud.leonardo.ai/api/rest/v1"),
        "google_gemini" => Some("https://generativelanguage.googleapis.com"),
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
        // azure_devops_org: org-aware variant. Base URL is org-agnostic; the
        // org lives in scoped_resources.organizations[0].id and agents inject
        // it via the §4.1 from_scope auto-fill, producing calls like
        // `/{org}/_apis/projects?…`. The §5 enforce regex on the
        // `organizations` resource validates the picked org appears in path.
        // (The narrow `azure_devops` connector takes the org from a credential
        //  field instead — see dynamic_base_url below.)
        "azure_devops_org" => Some("https://dev.azure.com"),
        "canva" => Some("https://api.canva.com/rest/v1"),
        "attio" => Some("https://api.attio.com/v2"),
        "crisp" => Some("https://api.crisp.chat/v1"),
        "lemonsqueezy" => Some("https://api.lemonsqueezy.com/v1"),
        "ramp" => Some("https://api.ramp.com/developer/v1"),
        "novu" => Some("https://api.novu.co/v1"),
        "knock" => Some("https://api.knock.app/v1"),
        "clockify" => Some("https://api.clockify.me/api/v1"),
        "toggl" => Some("https://api.track.toggl.com/api/v9"),
        "harvest" => Some("https://api.harvestapp.com/v2"),
        "linkedin" => Some("https://api.linkedin.com"),
        "reddit" => Some("https://oauth.reddit.com"),
        "apify" => Some("https://api.apify.com/v2"),
        "x_twitter" | "twitter" => Some("https://api.twitter.com/2"),
        "youtube_data" => Some("https://www.googleapis.com/youtube/v3"),
        "deepgram" => Some("https://api.deepgram.com/v1"),
        "sentry" => Some("https://sentry.io"),
        "alpha_vantage" => Some("https://www.alphavantage.co"),
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
        // Narrow Azure DevOps: org is a credential field, baked into the
        // base URL so agents can call `path = "/_apis/projects/..."` without
        // knowing the org. Sibling `azure_devops_org` connector takes the
        // org from scoped picks instead — see well_known_base_url above.
        "azure_devops" => {
            let org = fields.get("organization")?;
            Some(format!("https://dev.azure.com/{org}"))
        }
        _ => None,
    }
}

/// Maximum request body size: 10 MB.
const MAX_REQUEST_BODY_BYTES: usize = 10 * 1024 * 1024;

/// Headers that must not be overridden via user-supplied custom_headers.
/// Auth headers are applied exclusively through the connector strategy.
const BLOCKED_HEADERS: &[&str] = &["authorization", "cookie", "host", "proxy-authorization"];

/// Validate that a header name conforms to RFC 7230 §3.2.6 token syntax.
///
/// ```text
/// token  = 1*tchar
/// tchar  = "!" / "#" / "$" / "%" / "&" / "'" / "*" / "+"
///         / "-" / "." / "^" / "_" / "`" / "|" / "~"
///         / DIGIT / ALPHA
/// ```
///
/// Rejects empty names and any character outside the allowed set, including
/// CRLF sequences, null bytes, colons, and other delimiters that could enable
/// HTTP request smuggling or response splitting.
fn validate_header_name(name: &str) -> Result<(), AppError> {
    if name.is_empty() {
        return Err(AppError::Validation(
            "Invalid header name: must not be empty".into(),
        ));
    }
    for byte in name.bytes() {
        let valid = matches!(byte,
            b'!' | b'#' | b'$' | b'%' | b'&' | b'\'' | b'*' | b'+' |
            b'-' | b'.' | b'^' | b'_' | b'`' | b'|' | b'~' |
            b'0'..=b'9' | b'A'..=b'Z' | b'a'..=b'z'
        );
        if !valid {
            return Err(AppError::Validation(format!(
                "Invalid header name '{}': contains character 0x{:02X} which is not \
                 permitted by RFC 7230. Header names may only contain letters, digits, \
                 and the tokens !#$%&'*+-.^_`|~",
                name, byte,
            )));
        }
    }
    Ok(())
}

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
    pub truncated: bool,
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

    if let Err(e) = audit_log::log_decrypt(pool, &credential.id, &credential.name, "api_proxy", None, None) {
        tracing::warn!(credential_id = %credential.id, error = %e, "Failed to write audit log for credential decrypt");
    }

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

    // Resolve auth via connector strategy (uses short-lived cache to avoid DB hit per request)
    let connectors = get_all_connectors_cached(pool)?;
    let connector = connectors
        .iter()
        .find(|c| c.name == credential.service_type);
    let connector_metadata = connector.and_then(|c| c.metadata.as_deref());

    // §5 — runtime scope enforcement. Block (or warn) if the request operates
    // on a resource the user did not pick during scoping. Pure pass-through
    // when the credential is broad-scoped or the connector declares no
    // `enforce` rules. Mode comes from the credential's metadata
    // (`scope_enforcement: "block"` flips warn-only to hard reject).
    let enforcement_mode = super::scope_enforcement::EnforcementMode::from_metadata(
        credential.metadata.as_deref(),
    );
    let connector_resources = connector.and_then(|c| c.resources.as_deref());
    let outcome = super::scope_enforcement::evaluate(
        connector_resources,
        credential.scoped_resources.as_deref(),
        path,
        enforcement_mode,
    )?;
    use super::scope_enforcement::EnforcementOutcome;
    match outcome {
        EnforcementOutcome::Allow => {}
        EnforcementOutcome::WarnOnly { resource, attempted_id } => {
            tracing::warn!(
                credential_id = %credential.id,
                service_type = %credential.service_type,
                resource = %resource,
                attempted_id = %attempted_id,
                path = %path,
                "scope_enforcement: out-of-scope request (warn-only mode)"
            );
        }
        EnforcementOutcome::Block { resource, attempted_id } => {
            tracing::warn!(
                credential_id = %credential.id,
                service_type = %credential.service_type,
                resource = %resource,
                attempted_id = %attempted_id,
                path = %path,
                "scope_enforcement: blocked out-of-scope request"
            );
            return Err(AppError::Forbidden(format!(
                "Credential is scoped to a subset of {resource}; request targets '{attempted_id}' which is not in scope. \
                 Add it via the credential's Scope picker, or set scope_enforcement=warn to allow with a log entry."
            )));
        }
    }

    // Per-credential rate limiting (token-bucket, default 60 req/min)
    check_rate_limit(credential_id, connector_metadata).await?;

    let strategy =
        connector_strategy::registry()?.get(&credential.service_type, connector_metadata);

    // For OAuth credentials, acquire a per-credential lock to prevent concurrent
    // token exchanges with the background refresh tick (see oauth_refresh_lock).
    let (_lock, fields) = if strategy.is_oauth(&fields) {
        let lock = super::oauth_refresh_lock::acquire(credential_id).await;
        // Re-read fields inside the lock — a concurrent refresh may have persisted
        // a fresh access_token while we were waiting.
        let fresh = cred_repo::get_decrypted_fields(pool, &credential)?;
        if let Err(e) = audit_log::log_decrypt(pool, credential_id, &credential.name, "api_proxy_locked", None, None) {
            tracing::warn!(credential_id, error = %e, "Failed to write audit log for credential decrypt");
        }
        (Some(lock), fresh)
    } else {
        (None, fields)
    };
    let token = strategy
        .resolve_auth_token(connector_metadata, &fields)
        .await?
        .map(|r| r.token);

    // Use the SSRF-safe HTTP client which validates resolved IPs at
    // connection time, preventing DNS rebinding attacks.
    let client = crate::SSRF_SAFE_HTTP.clone();

    let start = Instant::now();

    let upper_method = method.to_uppercase();
    let mut request = match upper_method.as_str() {
        "GET" => client.get(&full_url),
        "POST" => client.post(&full_url),
        "PUT" => client.put(&full_url),
        "PATCH" => client.patch(&full_url),
        "DELETE" => client.delete(&full_url),
        "HEAD" => client.head(&full_url),
        "OPTIONS" => client.request(reqwest::Method::OPTIONS, &full_url),
        other => {
            return Err(AppError::Validation(format!(
                "Unsupported HTTP method '{}'. Supported methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
                other,
            )));
        }
    };

    // Apply custom headers, validating names and blocking sensitive ones
    for (k, v) in &custom_headers {
        validate_header_name(k)?;
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

    let mut resp = request
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

    // Limit response body to 2MB to prevent memory issues.
    // Read in chunks so we never buffer more than the limit, even if the
    // upstream sends a multi-gigabyte response.
    const MAX_RESPONSE_BODY_BYTES: usize = 2_000_000;
    let mut body_buf = Vec::new();
    let mut truncated = false;

    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read response body: {e}")))?
    {
        if body_buf.len() + chunk.len() > MAX_RESPONSE_BODY_BYTES {
            truncated = true;
            break;
        }
        body_buf.extend_from_slice(&chunk);
    }

    let body = String::from_utf8_lossy(&body_buf).to_string();

    // Record aggregate metrics for this credential
    record_metric(credential_id, &credential.service_type, status, duration_ms).await;

    Ok(ApiProxyResponse {
        status,
        status_text,
        headers: resp_headers,
        body,
        duration_ms,
        content_type,
        truncated,
    })
}
