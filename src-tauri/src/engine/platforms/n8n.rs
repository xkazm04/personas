use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::error::AppError;

/// Lightweight n8n API client for managing workflows.
pub struct N8nClient {
    base_url: String,
    api_key: String,
    http: reqwest::Client,
}

/// Summary of an n8n workflow (subset of full API response).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct N8nWorkflow {
    pub id: String,
    pub name: String,
    pub active: bool,
    #[serde(default)]
    pub tags: Vec<N8nTag>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct N8nTag {
    pub id: String,
    pub name: String,
}

/// Result of activating/deactivating a workflow.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct N8nActivateResult {
    pub id: String,
    pub active: bool,
}

/// Wrapper for the n8n API list response.
#[derive(Debug, Deserialize)]
struct N8nListResponse {
    data: Vec<N8nWorkflow>,
}

impl N8nClient {
    /// Check that an HTTP response indicates success, returning the response on
    /// success or a descriptive `AppError::Execution` on failure.
    async fn check_response(
        resp: reqwest::Response,
        context: &str,
    ) -> Result<reqwest::Response, AppError> {
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Execution(format!(
                "{context} returned HTTP {status}: {body}"
            )));
        }
        Ok(resp)
    }

    /// Create from decrypted credential fields (`base_url` and `api_key`).
    pub fn from_fields(fields: &HashMap<String, String>) -> Result<Self, AppError> {
        let base_url = fields
            .get("base_url")
            .ok_or_else(|| AppError::Validation("n8n credential missing 'base_url' field".into()))?
            .trim_end_matches('/')
            .to_string();

        let api_key = fields
            .get("api_key")
            .ok_or_else(|| AppError::Validation("n8n credential missing 'api_key' field".into()))?
            .clone();

        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| AppError::Internal(format!("Failed to create HTTP client: {e}")))?;

        Ok(Self { base_url, api_key, http })
    }

    /// List all workflows.
    pub async fn list_workflows(&self) -> Result<Vec<N8nWorkflow>, AppError> {
        let url = format!("{}/api/v1/workflows", self.base_url);
        let resp = self
            .http
            .get(&url)
            .header("X-N8N-API-KEY", &self.api_key)
            .send()
            .await
            .map_err(|e| AppError::Execution(format!("n8n API request failed: {e}")))?;

        let resp = Self::check_response(resp, "n8n API").await?;

        let list: N8nListResponse = resp
            .json()
            .await
            .map_err(|e| AppError::Execution(format!("Failed to parse n8n workflow list: {e}")))?;

        Ok(list.data)
    }

    /// Get a single workflow by ID.
    #[allow(dead_code)]
    pub async fn get_workflow(&self, id: &str) -> Result<Value, AppError> {
        let url = format!("{}/api/v1/workflows/{}", self.base_url, id);
        let resp = self
            .http
            .get(&url)
            .header("X-N8N-API-KEY", &self.api_key)
            .send()
            .await
            .map_err(|e| AppError::Execution(format!("n8n API request failed: {e}")))?;

        let resp = Self::check_response(resp, "n8n API").await?;

        resp.json::<Value>()
            .await
            .map_err(|e| AppError::Execution(format!("Failed to parse n8n workflow: {e}")))
    }

    /// Activate a workflow.
    pub async fn activate_workflow(&self, id: &str) -> Result<N8nActivateResult, AppError> {
        self.set_workflow_active(id, true).await
    }

    /// Deactivate a workflow.
    pub async fn deactivate_workflow(&self, id: &str) -> Result<N8nActivateResult, AppError> {
        self.set_workflow_active(id, false).await
    }

    /// Create a new workflow from a JSON definition.
    pub async fn create_workflow(&self, definition: &Value) -> Result<Value, AppError> {
        let url = format!("{}/api/v1/workflows", self.base_url);
        let resp = self
            .http
            .post(&url)
            .header("X-N8N-API-KEY", &self.api_key)
            .json(definition)
            .send()
            .await
            .map_err(|e| AppError::Execution(format!("n8n create workflow failed: {e}")))?;

        let resp = Self::check_response(resp, "n8n create workflow").await?;

        resp.json::<Value>()
            .await
            .map_err(|e| AppError::Execution(format!("Failed to parse n8n response: {e}")))
    }

    /// Trigger a webhook URL with a JSON body.
    pub async fn trigger_webhook(&self, webhook_url: &str, body: &Value) -> Result<Value, AppError> {
        let parsed_webhook = url::Url::parse(webhook_url)
            .map_err(|e| AppError::Validation(format!("Invalid webhook URL: {e}")))?;
        let parsed_base = url::Url::parse(&self.base_url)
            .map_err(|e| AppError::Validation(format!("Invalid base URL: {e}")))?;

        let scheme = parsed_webhook.scheme();
        if scheme != "https" && !(scheme == "http" && parsed_webhook.host_str() == Some("localhost")) {
            return Err(AppError::Validation("Webhook URL must use https (or http for localhost)".into()));
        }

        if parsed_webhook.host_str() != parsed_base.host_str() {
            return Err(AppError::Validation("Webhook URL host must match the n8n instance base URL".into()));
        }

        let resp = self
            .http
            .post(webhook_url)
            .header("X-N8N-API-KEY", &self.api_key)
            .json(body)
            .send()
            .await
            .map_err(|e| AppError::Execution(format!("n8n webhook trigger failed: {e}")))?;

        let resp = Self::check_response(resp, "n8n webhook").await?;

        resp.json::<Value>()
            .await
            .or_else(|_| Ok(Value::Null))
    }

    /// Internal helper to PATCH workflow active state.
    async fn set_workflow_active(&self, id: &str, active: bool) -> Result<N8nActivateResult, AppError> {
        let url = format!("{}/api/v1/workflows/{}", self.base_url, id);
        let resp = self
            .http
            .patch(&url)
            .header("X-N8N-API-KEY", &self.api_key)
            .json(&serde_json::json!({ "active": active }))
            .send()
            .await
            .map_err(|e| AppError::Execution(format!("n8n activate/deactivate failed: {e}")))?;

        let resp = Self::check_response(resp, "n8n API").await?;

        let wf: Value = resp
            .json()
            .await
            .map_err(|e| AppError::Execution(format!("Failed to parse n8n response: {e}")))?;

        Ok(N8nActivateResult {
            id: wf["id"].as_str().unwrap_or(id).to_string(),
            active: wf["active"].as_bool().unwrap_or(active),
        })
    }
}

/// Build an n8n client from credential ID by loading and decrypting fields.
pub fn build_client_from_credential(
    pool: &crate::db::DbPool,
    credential_id: &str,
) -> Result<N8nClient, AppError> {
    use crate::db::repos::resources::credentials as cred_repo;

    let credential = cred_repo::get_by_id(pool, credential_id)?;
    let fields = cred_repo::get_decrypted_fields(pool, &credential)?;
    let _ = crate::db::repos::resources::audit_log::log_decrypt(pool, credential_id, &credential.name, "platform:n8n", None, None);
    N8nClient::from_fields(&fields)
}
