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
        Ok(Self { http: ZAPIER_HTTP.clone() })
    }

    /// Validate a Zapier catch hook URL by sending a test POST.
    /// Returns true if the hook responded with a 2xx status.
    pub async fn validate_catch_hook(&self, hook_url: &str) -> Result<bool, AppError> {
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
}
