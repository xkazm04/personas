use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::error::AppError;
use crate::gitlab::types::*;

// ============================================================================
// Helper
// ============================================================================

fn gitlab_err(e: impl std::fmt::Display) -> AppError {
    AppError::GitLab(e.to_string())
}

// ============================================================================
// Internal request types
// ============================================================================

#[derive(Serialize)]
struct CreateFileBody<'a> {
    branch: &'a str,
    content: &'a str,
    commit_message: &'a str,
}

#[derive(Serialize)]
struct UpdateFileBody<'a> {
    branch: &'a str,
    content: &'a str,
    commit_message: &'a str,
}

// ============================================================================
// GitLabClient
// ============================================================================

/// HTTP client wrapping GitLab REST API v4 endpoints.
pub struct GitLabClient {
    http: reqwest::Client,
    base_url: String,
    token: String,
}

impl GitLabClient {
    /// Create a new `GitLabClient`.
    pub fn new(base_url: String, token: String) -> Result<Self, crate::error::AppError> {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| crate::error::AppError::Internal(format!("Failed to build HTTP client: {e}")))?;

        Ok(Self {
            http,
            base_url,
            token,
        })
    }

    /// Return the base URL this client is configured for.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    // --------------------------------------------------------------------
    // Private HTTP helpers
    // --------------------------------------------------------------------

    fn authed(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method, format!("{}/api/v4{}", self.base_url, path))
            .header("PRIVATE-TOKEN", &self.token)
    }

    async fn send_json<T: DeserializeOwned>(
        &self,
        req: reqwest::RequestBuilder,
    ) -> Result<T, AppError> {
        let resp = req.send().await.map_err(gitlab_err)?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::GitLab(format!(
                "GitLab API error ({status}): {body}"
            )));
        }
        resp.json().await.map_err(gitlab_err)
    }

    async fn send_ok(&self, req: reqwest::RequestBuilder) -> Result<(), AppError> {
        let resp = req.send().await.map_err(gitlab_err)?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::GitLab(format!(
                "GitLab API error ({status}): {body}"
            )));
        }
        Ok(())
    }

    async fn send_text(&self, req: reqwest::RequestBuilder) -> Result<String, AppError> {
        let resp = req.send().await.map_err(gitlab_err)?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::GitLab(format!(
                "GitLab API error ({status}): {body}"
            )));
        }
        resp.text().await.map_err(gitlab_err)
    }

    // --------------------------------------------------------------------
    // User / Auth
    // --------------------------------------------------------------------

    /// `GET /api/v4/user` -- validate token and get current user info.
    pub async fn validate_token(&self) -> Result<GitLabUser, AppError> {
        self.send_json(self.authed(reqwest::Method::GET, "/user"))
            .await
    }

    // --------------------------------------------------------------------
    // Projects
    // --------------------------------------------------------------------

    /// `GET /api/v4/projects?membership=true&min_access_level=30`
    /// Returns projects where the user has at least Developer access.
    pub async fn list_projects(&self) -> Result<Vec<GitLabProject>, AppError> {
        let req = self
            .authed(reqwest::Method::GET, "/projects")
            .query(&[
                ("membership", "true"),
                ("min_access_level", "30"),
                ("per_page", "100"),
                ("order_by", "last_activity_at"),
            ]);
        self.send_json(req).await
    }

    /// `GET /api/v4/projects/:id`
    pub async fn get_project(&self, project_id: i64) -> Result<GitLabProject, AppError> {
        let path = format!("/projects/{project_id}");
        self.send_json(self.authed(reqwest::Method::GET, &path))
            .await
    }

    // --------------------------------------------------------------------
    // Duo Agent API
    // --------------------------------------------------------------------

    /// `POST /api/v4/projects/:id/duo/agents`
    pub async fn create_duo_agent(
        &self,
        project_id: i64,
        definition: &GitLabAgentDefinition,
    ) -> Result<GitLabAgent, AppError> {
        let path = format!("/projects/{project_id}/duo/agents");
        let req = self.authed(reqwest::Method::POST, &path).json(definition);
        self.send_json(req).await
    }

    /// `PUT /api/v4/projects/:id/duo/agents/:agent_id`
    pub async fn update_duo_agent(
        &self,
        project_id: i64,
        agent_id: &str,
        definition: &GitLabAgentDefinition,
    ) -> Result<GitLabAgent, AppError> {
        let path = format!("/projects/{project_id}/duo/agents/{agent_id}");
        let req = self.authed(reqwest::Method::PUT, &path).json(definition);
        self.send_json(req).await
    }

    /// `GET /api/v4/projects/:id/duo/agents`
    pub async fn list_duo_agents(&self, project_id: i64) -> Result<Vec<GitLabAgent>, AppError> {
        let path = format!("/projects/{project_id}/duo/agents");
        self.send_json(self.authed(reqwest::Method::GET, &path))
            .await
    }

    /// `DELETE /api/v4/projects/:id/duo/agents/:agent_id`
    pub async fn delete_duo_agent(
        &self,
        project_id: i64,
        agent_id: &str,
    ) -> Result<(), AppError> {
        let path = format!("/projects/{project_id}/duo/agents/{agent_id}");
        self.send_ok(self.authed(reqwest::Method::DELETE, &path))
            .await
    }

    // --------------------------------------------------------------------
    // AGENTS.md fallback (Repository Files API)
    // --------------------------------------------------------------------

    /// `GET /api/v4/projects/:id/repository/files/AGENTS.md/raw?ref=main`
    pub async fn get_agents_md(
        &self,
        project_id: i64,
        branch: &str,
    ) -> Result<String, AppError> {
        let path = format!(
            "/projects/{}/repository/files/{}/raw",
            project_id,
            urlencoding::encode("AGENTS.md")
        );
        let req = self.authed(reqwest::Method::GET, &path).query(&[("ref", branch)]);
        self.send_text(req).await
    }

    // --------------------------------------------------------------------
    // CI/CD Variables API (for credential provisioning)
    // --------------------------------------------------------------------

    /// `POST /api/v4/projects/:id/variables` -- create a project CI/CD variable.
    /// Variables are created as masked + protected so they never leak into logs.
    pub async fn create_variable(
        &self,
        project_id: i64,
        variable: &GitLabVariable,
    ) -> Result<(), AppError> {
        let path = format!("/projects/{project_id}/variables");
        let req = self.authed(reqwest::Method::POST, &path).json(variable);
        self.send_ok(req).await
    }

    /// `PUT /api/v4/projects/:id/variables/:key` -- update an existing CI/CD variable.
    pub async fn update_variable(
        &self,
        project_id: i64,
        variable: &GitLabVariable,
    ) -> Result<(), AppError> {
        let path = format!(
            "/projects/{}/variables/{}",
            project_id,
            urlencoding::encode(&variable.key)
        );
        let req = self.authed(reqwest::Method::PUT, &path).json(variable);
        self.send_ok(req).await
    }

    /// Create or update a CI/CD variable (upsert). Tries create first; on 409 conflict, updates.
    /// Non-conflict errors (network, auth, rate limit) are returned immediately.
    pub async fn upsert_variable(
        &self,
        project_id: i64,
        variable: &GitLabVariable,
    ) -> Result<(), AppError> {
        let path = format!("/projects/{project_id}/variables");
        let req = self.authed(reqwest::Method::POST, &path).json(variable);
        let resp = req.send().await.map_err(gitlab_err)?;
        let status = resp.status();

        if status.is_success() {
            return Ok(());
        }

        // Only fall back to update on 409 Conflict (variable already exists)
        if status == reqwest::StatusCode::CONFLICT {
            return self.update_variable(project_id, variable).await;
        }

        let body = resp.text().await.unwrap_or_default();
        Err(AppError::GitLab(format!(
            "GitLab API error ({status}): {body}"
        )))
    }

    /// `DELETE /api/v4/projects/:id/variables/:key` -- remove a CI/CD variable.
    pub async fn delete_variable(
        &self,
        project_id: i64,
        key: &str,
    ) -> Result<(), AppError> {
        let path = format!(
            "/projects/{}/variables/{}",
            project_id,
            urlencoding::encode(key)
        );
        self.send_ok(self.authed(reqwest::Method::DELETE, &path))
            .await
    }

    // --------------------------------------------------------------------
    // AGENTS.md fallback (Repository Files API)
    // --------------------------------------------------------------------

    // --------------------------------------------------------------------
    // Tags API (for version history)
    // --------------------------------------------------------------------

    /// `GET /api/v4/projects/:id/repository/tags?search=<prefix>`
    /// List tags, optionally filtered by a search prefix.
    pub async fn list_tags(
        &self,
        project_id: i64,
        search: Option<&str>,
    ) -> Result<Vec<super::types::GitLabTag>, AppError> {
        let path = format!("/projects/{project_id}/repository/tags");
        let mut req = self
            .authed(reqwest::Method::GET, &path)
            .query(&[("per_page", "100"), ("order_by", "updated")]);
        if let Some(s) = search {
            req = req.query(&[("search", s)]);
        }
        self.send_json(req).await
    }

    /// `POST /api/v4/projects/:id/repository/tags`
    /// Create a new tag pointing at a given ref (branch, commit SHA, etc.).
    pub async fn create_tag(
        &self,
        project_id: i64,
        tag_name: &str,
        ref_name: &str,
        message: Option<&str>,
    ) -> Result<super::types::GitLabTag, AppError> {
        let path = format!("/projects/{project_id}/repository/tags");
        let mut body = serde_json::json!({
            "tag_name": tag_name,
            "ref": ref_name,
        });
        if let Some(msg) = message {
            body["message"] = serde_json::Value::String(msg.to_string());
        }
        let req = self.authed(reqwest::Method::POST, &path).json(&body);
        self.send_json(req).await
    }

    // --------------------------------------------------------------------
    // Branches API (for environment management)
    // --------------------------------------------------------------------

    /// `GET /api/v4/projects/:id/repository/branches?search=<prefix>`
    pub async fn list_branches(
        &self,
        project_id: i64,
        search: Option<&str>,
    ) -> Result<Vec<super::types::GitLabBranch>, AppError> {
        let path = format!("/projects/{project_id}/repository/branches");
        let mut req = self
            .authed(reqwest::Method::GET, &path)
            .query(&[("per_page", "100")]);
        if let Some(s) = search {
            req = req.query(&[("search", s)]);
        }
        self.send_json(req).await
    }

    /// `POST /api/v4/projects/:id/repository/branches`
    pub async fn create_branch(
        &self,
        project_id: i64,
        branch_name: &str,
        ref_name: &str,
    ) -> Result<super::types::GitLabBranch, AppError> {
        let path = format!("/projects/{project_id}/repository/branches");
        let body = serde_json::json!({
            "branch": branch_name,
            "ref": ref_name,
        });
        let req = self.authed(reqwest::Method::POST, &path).json(&body);
        self.send_json(req).await
    }

    // --------------------------------------------------------------------
    // Repository Files API (read at specific ref)
    // --------------------------------------------------------------------

    /// `GET /api/v4/projects/:id/repository/files/:path/raw?ref=<ref>`
    /// Read a file at a specific git ref (tag, branch, or commit SHA).
    pub async fn get_file_at_ref(
        &self,
        project_id: i64,
        file_path: &str,
        git_ref: &str,
    ) -> Result<String, AppError> {
        let encoded_path = urlencoding::encode(file_path);
        let path = format!("/projects/{project_id}/repository/files/{encoded_path}/raw");
        let req = self
            .authed(reqwest::Method::GET, &path)
            .query(&[("ref", git_ref)]);
        self.send_text(req).await
    }

    /// Create or update AGENTS.md via Repository Files API.
    pub async fn upsert_agents_md(
        &self,
        project_id: i64,
        branch: &str,
        content: &str,
    ) -> Result<(), AppError> {
        let encoded = urlencoding::encode("AGENTS.md");
        let path = format!("/projects/{project_id}/repository/files/{encoded}");

        // Try PUT first (update); if 404, use POST (create)
        let update_req = self
            .authed(reqwest::Method::PUT, &path)
            .json(&UpdateFileBody {
                branch,
                content,
                commit_message: "Update AGENTS.md via Personas Desktop",
            });

        let resp = update_req.send().await.map_err(gitlab_err)?;
        if resp.status().is_success() {
            return Ok(());
        }

        // File doesn't exist yet -- create it
        let create_req = self
            .authed(reqwest::Method::POST, &path)
            .json(&CreateFileBody {
                branch,
                content,
                commit_message: "Create AGENTS.md via Personas Desktop",
            });

        self.send_ok(create_req).await
    }
}
