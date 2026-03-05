use std::time::Duration;

use crate::error::AppError;

/// Minimal Zapier client — Zapier has no public API for creating Zaps,
/// so we just validate that a catch hook URL is reachable.
pub struct ZapierClient {
    http: reqwest::Client,
}

impl ZapierClient {
    pub fn new() -> Result<Self, AppError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| AppError::Internal(format!("Failed to create HTTP client: {e}")))?;
        Ok(Self { http })
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
