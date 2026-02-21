use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::AppError;

// ============================================================================
// Helper
// ============================================================================

/// Convert any displayable error into `AppError::Cloud`.
fn cloud_err(e: impl std::fmt::Display) -> AppError {
    AppError::Cloud(e.to_string())
}

// ============================================================================
// Response / request types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CloudWorkerCounts {
    pub idle: u32,
    pub executing: u32,
    pub disconnected: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CloudOAuthState {
    pub connected: bool,
    pub scopes: Option<Vec<String>>,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatusResponse {
    pub worker_counts: CloudWorkerCounts,
    pub queue_length: u32,
    pub active_executions: u32,
    pub has_claude_token: bool,
    pub oauth: Option<CloudOAuthState>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CloudSubmitResponse {
    pub execution_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CloudExecutionPoll {
    pub execution_id: String,
    pub status: String,
    pub output: Vec<String>,
    pub output_lines: u32,
    pub duration_ms: Option<u64>,
    pub cost_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CloudOAuthAuthorizeResponse {
    pub auth_url: String,
    pub state: String,
    pub instructions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CloudOAuthStatusResponse {
    pub connected: bool,
    pub scopes: Option<Vec<String>>,
    pub expires_at: Option<String>,
    pub is_expired: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CloudHealthResponse {
    pub status: String,
    pub workers: Option<CloudWorkerCounts>,
}

// ============================================================================
// Internal request bodies (not exported to TS)
// ============================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SubmitExecutionBody<'a> {
    prompt: &'a str,
    persona_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OAuthCallbackBody<'a> {
    code: &'a str,
    state: &'a str,
}

// ============================================================================
// CloudClient
// ============================================================================

/// HTTP client that wraps all dac-cloud orchestrator endpoints.
pub struct CloudClient {
    http: reqwest::Client,
    base_url: String,
    api_key: String,
}

impl CloudClient {
    /// Create a new `CloudClient` with the given orchestrator base URL and API key.
    ///
    /// The underlying `reqwest::Client` is configured with a 30-second timeout.
    pub fn new(base_url: String, api_key: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("failed to build reqwest client");

        Self {
            http,
            base_url,
            api_key,
        }
    }

    // --------------------------------------------------------------------
    // Private HTTP helpers
    // --------------------------------------------------------------------

    /// Build an authenticated request to the given endpoint path.
    fn authed(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method, format!("{}{}", self.base_url, path))
            .bearer_auth(&self.api_key)
    }

    /// Send a request, check the status code, and deserialize the JSON response.
    async fn send_json<T: DeserializeOwned>(
        &self,
        req: reqwest::RequestBuilder,
    ) -> Result<T, AppError> {
        req.send()
            .await
            .map_err(cloud_err)?
            .error_for_status()
            .map_err(cloud_err)?
            .json()
            .await
            .map_err(cloud_err)
    }

    /// Send a request, check the status code, and discard the response body.
    async fn send_ok(&self, req: reqwest::RequestBuilder) -> Result<(), AppError> {
        req.send()
            .await
            .map_err(cloud_err)?
            .error_for_status()
            .map_err(cloud_err)?;
        Ok(())
    }

    // --------------------------------------------------------------------
    // Health & Status
    // --------------------------------------------------------------------

    /// `GET /health` -- basic health check.
    pub async fn health(&self) -> Result<CloudHealthResponse, AppError> {
        self.send_json(self.authed(reqwest::Method::GET, "/health")).await
    }

    /// `GET /api/status` -- orchestrator status including worker counts and OAuth state.
    pub async fn status(&self) -> Result<CloudStatusResponse, AppError> {
        self.send_json(self.authed(reqwest::Method::GET, "/api/status")).await
    }

    // --------------------------------------------------------------------
    // Execution lifecycle
    // --------------------------------------------------------------------

    /// `POST /api/execute` -- submit a new execution to the orchestrator.
    pub async fn submit_execution(
        &self,
        prompt: &str,
        persona_id: &str,
        timeout_ms: Option<u64>,
    ) -> Result<CloudSubmitResponse, AppError> {
        let req = self
            .authed(reqwest::Method::POST, "/api/execute")
            .json(&SubmitExecutionBody { prompt, persona_id, timeout_ms });
        self.send_json(req).await
    }

    /// `GET /api/executions/{id}?offset={offset}` -- poll execution progress.
    pub async fn poll_execution(
        &self,
        execution_id: &str,
        offset: u32,
    ) -> Result<CloudExecutionPoll, AppError> {
        let path = format!("/api/executions/{}?offset={}", execution_id, offset);
        self.send_json(self.authed(reqwest::Method::GET, &path)).await
    }

    /// `POST /api/executions/{id}/cancel` -- cancel a running execution.
    pub async fn cancel_execution(&self, execution_id: &str) -> Result<(), AppError> {
        let path = format!("/api/executions/{}/cancel", execution_id);
        self.send_ok(self.authed(reqwest::Method::POST, &path)).await
    }

    // --------------------------------------------------------------------
    // OAuth
    // --------------------------------------------------------------------

    /// `POST /api/oauth/authorize` -- initiate OAuth authorization flow.
    pub async fn oauth_authorize(&self) -> Result<CloudOAuthAuthorizeResponse, AppError> {
        self.send_json(self.authed(reqwest::Method::POST, "/api/oauth/authorize")).await
    }

    /// `POST /api/oauth/callback` -- exchange authorization code for tokens.
    pub async fn oauth_callback(
        &self,
        code: &str,
        state: &str,
    ) -> Result<serde_json::Value, AppError> {
        let req = self
            .authed(reqwest::Method::POST, "/api/oauth/callback")
            .json(&OAuthCallbackBody { code, state });
        self.send_json(req).await
    }

    /// `GET /api/oauth/status` -- check current OAuth connection status.
    pub async fn oauth_status(&self) -> Result<CloudOAuthStatusResponse, AppError> {
        self.send_json(self.authed(reqwest::Method::GET, "/api/oauth/status")).await
    }

    /// `POST /api/oauth/refresh` -- refresh the OAuth token.
    pub async fn oauth_refresh(&self) -> Result<serde_json::Value, AppError> {
        self.send_json(self.authed(reqwest::Method::POST, "/api/oauth/refresh")).await
    }

    /// `DELETE /api/oauth/disconnect` -- disconnect the OAuth integration.
    pub async fn oauth_disconnect(&self) -> Result<(), AppError> {
        self.send_ok(self.authed(reqwest::Method::DELETE, "/api/oauth/disconnect")).await
    }
}
