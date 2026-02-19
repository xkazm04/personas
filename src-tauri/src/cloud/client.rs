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

#[allow(dead_code)]
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
    // Health & Status
    // --------------------------------------------------------------------

    /// `GET /health` -- basic health check.
    pub async fn health(&self) -> Result<CloudHealthResponse, AppError> {
        let url = format!("{}/health", self.base_url);
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(cloud_err)?
            .error_for_status()
            .map_err(cloud_err)?;

        resp.json::<CloudHealthResponse>().await.map_err(cloud_err)
    }

    /// `GET /api/status` -- orchestrator status including worker counts and OAuth state.
    pub async fn status(&self) -> Result<CloudStatusResponse, AppError> {
        let url = format!("{}/api/status", self.base_url);
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(cloud_err)?
            .error_for_status()
            .map_err(cloud_err)?;

        resp.json::<CloudStatusResponse>().await.map_err(cloud_err)
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
        let url = format!("{}/api/execute", self.base_url);
        let body = SubmitExecutionBody {
            prompt,
            persona_id,
            timeout_ms,
        };

        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(cloud_err)?
            .error_for_status()
            .map_err(cloud_err)?;

        resp.json::<CloudSubmitResponse>().await.map_err(cloud_err)
    }

    /// `GET /api/executions/{id}?offset={offset}` -- poll execution progress.
    pub async fn poll_execution(
        &self,
        execution_id: &str,
        offset: u32,
    ) -> Result<CloudExecutionPoll, AppError> {
        let url = format!(
            "{}/api/executions/{}?offset={}",
            self.base_url, execution_id, offset
        );

        let resp = self
            .http
            .get(&url)
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(cloud_err)?
            .error_for_status()
            .map_err(cloud_err)?;

        resp.json::<CloudExecutionPoll>().await.map_err(cloud_err)
    }

    /// `POST /api/executions/{id}/cancel` -- cancel a running execution.
    pub async fn cancel_execution(&self, execution_id: &str) -> Result<(), AppError> {
        let url = format!(
            "{}/api/executions/{}/cancel",
            self.base_url, execution_id
        );

        self.http
            .post(&url)
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(cloud_err)?
            .error_for_status()
            .map_err(cloud_err)?;

        Ok(())
    }

    // --------------------------------------------------------------------
    // OAuth
    // --------------------------------------------------------------------

    /// `POST /api/oauth/authorize` -- initiate OAuth authorization flow.
    pub async fn oauth_authorize(&self) -> Result<CloudOAuthAuthorizeResponse, AppError> {
        let url = format!("{}/api/oauth/authorize", self.base_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(cloud_err)?
            .error_for_status()
            .map_err(cloud_err)?;

        resp.json::<CloudOAuthAuthorizeResponse>()
            .await
            .map_err(cloud_err)
    }

    /// `POST /api/oauth/callback` -- exchange authorization code for tokens.
    pub async fn oauth_callback(
        &self,
        code: &str,
        state: &str,
    ) -> Result<serde_json::Value, AppError> {
        let url = format!("{}/api/oauth/callback", self.base_url);
        let body = OAuthCallbackBody { code, state };

        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(cloud_err)?
            .error_for_status()
            .map_err(cloud_err)?;

        resp.json::<serde_json::Value>().await.map_err(cloud_err)
    }

    /// `GET /api/oauth/status` -- check current OAuth connection status.
    pub async fn oauth_status(&self) -> Result<CloudOAuthStatusResponse, AppError> {
        let url = format!("{}/api/oauth/status", self.base_url);
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(cloud_err)?
            .error_for_status()
            .map_err(cloud_err)?;

        resp.json::<CloudOAuthStatusResponse>()
            .await
            .map_err(cloud_err)
    }

    /// `POST /api/oauth/refresh` -- refresh the OAuth token.
    pub async fn oauth_refresh(&self) -> Result<serde_json::Value, AppError> {
        let url = format!("{}/api/oauth/refresh", self.base_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(cloud_err)?
            .error_for_status()
            .map_err(cloud_err)?;

        resp.json::<serde_json::Value>().await.map_err(cloud_err)
    }

    /// `DELETE /api/oauth/disconnect` -- disconnect the OAuth integration.
    pub async fn oauth_disconnect(&self) -> Result<(), AppError> {
        let url = format!("{}/api/oauth/disconnect", self.base_url);

        self.http
            .delete(&url)
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(cloud_err)?
            .error_for_status()
            .map_err(cloud_err)?;

        Ok(())
    }
}
