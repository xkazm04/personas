use std::sync::LazyLock;
use std::time::Duration;

use crate::error::AppError;

/// Module-scoped HTTP client shared across all `ZapierClient` instances.
///
/// Zapier's catch-hook validation uses a fixed 15-second timeout and no
/// per-instance builder config, so a single process-scoped client is safe.
/// All clones share the same connection pool, TLS sessions, and DNS cache.
static ZAPIER_HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .expect("Failed to build Zapier HTTP client")
});

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
    async fn assert_safe_url(hook_url: &str) -> Result<(), AppError> {
        let url = reqwest::Url::parse(hook_url)
            .map_err(|e| AppError::Validation(format!("Invalid Zapier hook URL: {e}")))?;
        if url.scheme() != "https" {
            return Err(AppError::Validation(
                "Zapier catch hook URL must use https://".into(),
            ));
        }
        let host = url
            .host_str()
            .ok_or_else(|| AppError::Validation("Zapier catch hook URL has no host".into()))?
            .to_string();
        let port = url.port_or_known_default().unwrap_or(443);

        let addrs = tokio::task::spawn_blocking(move || {
            use std::net::ToSocketAddrs;
            (host.as_str(), port)
                .to_socket_addrs()
                .map(|it| it.map(|s| s.ip()).collect::<Vec<_>>())
        })
        .await
        .map_err(|e| AppError::Execution(format!("Zapier hook resolve task failed: {e}")))?
        .map_err(|e| AppError::Validation(format!("Zapier hook DNS resolution failed: {e}")))?;

        if addrs.is_empty() {
            return Err(AppError::Validation(
                "Zapier catch hook URL did not resolve".into(),
            ));
        }
        if addrs
            .iter()
            .any(crate::engine::http_engine::is_blocked_ip)
        {
            return Err(AppError::Validation(
                "Zapier catch hook URL resolves to a private/internal address (blocked)".into(),
            ));
        }
        Ok(())
    }
}
