use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::error::AppError;

/// Module-scoped HTTP client shared across all `GitHubClient` instances.
///
/// The builder config is entirely static (30-second timeout, no default
/// headers). The per-user bearer token is added on each request via
/// `self.headers()`, so a process-scoped client does not leak per-user state.
static GITHUB_HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("Failed to build GitHub HTTP client")
});

/// GitHub API client for repository and workflow management.
pub struct GitHubClient {
    token: String,
    http: reqwest::Client,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepo {
    pub id: i64,
    pub name: String,
    pub full_name: String,
    pub private: bool,
    pub default_branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPermissions {
    pub has_repo: bool,
    pub has_workflow: bool,
    pub scopes: Vec<String>,
}

/// Raw GitHub API repo response (subset of fields).
#[derive(Debug, Deserialize)]
struct GhRepoRaw {
    id: i64,
    name: String,
    full_name: String,
    private: bool,
    default_branch: String,
}

impl GitHubClient {
    /// Create from decrypted credential fields (`personal_access_token`).
    pub fn from_fields(fields: &HashMap<String, String>) -> Result<Self, AppError> {
        let token = fields
            .get("personal_access_token")
            .ok_or_else(|| {
                AppError::Validation("GitHub credential missing 'personal_access_token' field".into())
            })?
            .clone();

        let http = GITHUB_HTTP.clone();

        Ok(Self { token, http })
    }

    fn headers(&self) -> reqwest::header::HeaderMap {
        let mut h = reqwest::header::HeaderMap::new();
        h.insert(
            "Authorization",
            format!("Bearer {}", self.token).parse().unwrap(),
        );
        h.insert(
            "Accept",
            "application/vnd.github+json".parse().unwrap(),
        );
        h.insert("User-Agent", "personas-desktop".parse().unwrap());
        h.insert("X-GitHub-Api-Version", "2022-11-28".parse().unwrap());
        h
    }

    /// List repositories accessible to the authenticated user.
    pub async fn list_repos(&self) -> Result<Vec<GitHubRepo>, AppError> {
        let url = "https://api.github.com/user/repos?sort=updated&per_page=100";
        let resp = self
            .http
            .get(url)
            .headers(self.headers())
            .send()
            .await
            .map_err(|e| AppError::Execution(format!("GitHub API request failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Execution(format!(
                "GitHub API returned HTTP {status}: {body}"
            )));
        }

        let raw: Vec<GhRepoRaw> = resp
            .json()
            .await
            .map_err(|e| AppError::Execution(format!("Failed to parse GitHub repos: {e}")))?;

        Ok(raw
            .into_iter()
            .map(|r| GitHubRepo {
                id: r.id,
                name: r.name,
                full_name: r.full_name,
                private: r.private,
                default_branch: r.default_branch,
            })
            .collect())
    }

    /// Check PAT permissions by inspecting the X-OAuth-Scopes header.
    pub async fn check_permissions(&self) -> Result<GitHubPermissions, AppError> {
        let resp = self
            .http
            .get("https://api.github.com/user")
            .headers(self.headers())
            .send()
            .await
            .map_err(|e| AppError::Execution(format!("GitHub API request failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Execution(format!(
                "GitHub API returned HTTP {status}: {body}"
            )));
        }

        let scopes_header = resp
            .headers()
            .get("x-oauth-scopes")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let scopes: Vec<String> = scopes_header
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let has_repo = scopes.iter().any(|s| s == "repo");
        let has_workflow = scopes.iter().any(|s| s == "workflow");

        Ok(GitHubPermissions {
            has_repo,
            has_workflow,
            scopes,
        })
    }

    /// Trigger a repository dispatch event.
    pub async fn create_repository_dispatch(
        &self,
        owner: &str,
        repo: &str,
        event_type: &str,
        client_payload: &Value,
    ) -> Result<(), AppError> {
        let url = format!(
            "https://api.github.com/repos/{owner}/{repo}/dispatches"
        );
        let body = serde_json::json!({
            "event_type": event_type,
            "client_payload": client_payload,
        });

        let resp = self
            .http
            .post(&url)
            .headers(self.headers())
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Execution(format!("GitHub dispatch failed: {e}")))?;

        // GitHub returns 204 No Content on success
        if resp.status().as_u16() == 204 {
            return Ok(());
        }

        let status = resp.status().as_u16();
        let resp_body = resp.text().await.unwrap_or_default();
        Err(AppError::Execution(format!(
            "GitHub dispatch returned HTTP {status}: {resp_body}"
        )))
    }
}

/// Build a GitHub client from credential ID by loading and decrypting fields.
pub fn build_client_from_credential(
    pool: &crate::db::DbPool,
    credential_id: &str,
) -> Result<GitHubClient, AppError> {
    use crate::db::repos::resources::credentials as cred_repo;

    let credential = cred_repo::get_by_id(pool, credential_id)?;
    let fields = cred_repo::get_decrypted_fields(pool, &credential)?;
    if let Err(e) = crate::db::repos::resources::audit_log::log_decrypt(pool, credential_id, &credential.name, "platform:github", None, None) {
        tracing::warn!(credential_id, error = %e, "Failed to write audit log for credential decrypt");
    }
    GitHubClient::from_fields(&fields)
}
