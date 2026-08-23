use std::sync::LazyLock;
use std::time::Duration;

use crate::error::AppError;

/// Module-scoped HTTP client shared across all `ZapierClient` instances.
///
/// Zapier's catch-hook validation uses a fixed 15-second timeout and no
/// per-instance builder config, so a single process-scoped client is safe.
/// All clones share the same connection pool, TLS sessions, and DNS cache.
///
/// Built SSRF-safe (cleanup, not a vulnerability fix): `hook_url` is
/// LLM-authored, and while `assert_safe_url` pre-flights it, only the client's
/// own resolver closes the DNS-rebinding window between check and connect, and
/// only its redirect policy re-checks a `Location` hop.
static ZAPIER_HTTP: LazyLock<reqwest::Client> =
    LazyLock::new(|| crate::engine::url_safety::build_ssrf_safe_client(Duration::from_secs(15)));

/// Minimal Zapier client -- Zapier has no public API for creating Zaps,
/// so we just validate that a catch hook URL is reachable.
pub struct ZapierClient {
    http: reqwest::Client,
}

impl ZapierClient {
    pub fn new() -> Result<Self, AppError> {
        Ok(Self {
            http: ZAPIER_HTTP.clone(),
        })
    }

    /// Validate a Zapier catch hook URL by sending a test POST.
    /// Returns true if the hook responded with a 2xx status.
    ///
    /// `hook_url` originates from LLM-generated design output (`catch_hook_url`
    /// / `webhook_url`), so it's untrusted: enforce https and reject hosts that
    /// resolve to loopback/private/link-local addresses before making the
    /// request (same SSRF discipline as the `http_get` built-in).
    pub async fn validate_catch_hook(&self, hook_url: &str) -> Result<bool, AppError> {
        Self::assert_safe_url(hook_url).await?;

        let resp = self
            .http
            .post(hook_url)
            .header("Content-Type", "application/json")
            .body(r#"{"test": true, "source": "personas-desktop"}"#)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    AppError::Execution(format!("Zapier hook timed out: {hook_url}"))
                } else if e.is_connect() {
                    AppError::Execution(format!("Cannot reach Zapier hook: {hook_url}"))
                } else {
                    AppError::Execution(format!("Zapier hook request failed: {e}"))
                }
            })?;

        Ok(resp.status().is_success())
    }

    /// Reject non-https URLs and URLs whose host resolves to a
    /// loopback/private/link-local address, before the caller ever POSTs to
    /// them. `hook_url` is untrusted (LLM-authored design output).
    ///
    /// Delegates to `url_safety::validate_url_safety` — which also covers CGNAT
    /// (`100.64.0.0/10`), the RFC 5737 documentation ranges and the
    /// cloud-metadata hostname list. The hand-rolled resolve loop that stood
    /// here called `http_engine::is_blocked_ip`, a private fork that covered
    /// none of those; it was deleted on 2026-08-22.
    async fn assert_safe_url(hook_url: &str) -> Result<(), AppError> {
        let url = reqwest::Url::parse(hook_url)
            .map_err(|e| AppError::Validation(format!("Invalid Zapier hook URL: {e}")))?;
        if url.scheme() != "https" {
            return Err(AppError::Validation(
                "Zapier catch hook URL must use https://".into(),
            ));
        }

        // `validate_url_safety` resolves DNS; keep it off the async runtime. The
        // handle is bound and inspected — a detached validation task would
        // report neither a panic nor a verdict.
        let raw = hook_url.to_string();
        let verdict = tokio::task::spawn_blocking(move || {
            crate::engine::url_safety::validate_url_safety(&raw)
        })
        .await
        .map_err(|e| AppError::Execution(format!("Zapier hook resolve task failed: {e}")))?;
        verdict.map_err(|reason| AppError::Validation(format!("Zapier catch hook URL: {reason}")))
    }
}
