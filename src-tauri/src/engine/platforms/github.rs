use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::engine::inflight_guard::InflightGuard;
use crate::error::AppError;

/// Validate that a GitHub owner or repository name is safe to interpolate into
/// API URL paths. GitHub logins and repo names are limited to ASCII
/// alphanumerics plus `.`, `_`, and `-`. Rejecting anything else stops path
/// separators and dot-segments (`../..`) that URL normalization would collapse
/// into a *different* `api.github.com` endpoint under the user's PAT.
fn validate_repo_segment(field: &str, value: &str) -> Result<(), AppError> {
    if value.is_empty() {
        return Err(AppError::Validation(format!(
            "GitHub {field} must not be empty"
        )));
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err(AppError::Validation(format!(
            "Invalid GitHub {field} '{value}': only letters, digits, '.', '_', and '-' are allowed"
        )));
    }
    Ok(())
}

/// Validate that a git ref (branch / tag / commit-ish) is safe to interpolate
/// into API URL paths. Rejects values that could alter the target endpoint:
/// dot-segments (`..`), query/fragment markers (`?`, `#`), backslashes,
/// whitespace, control characters, a leading `/`, and the empty string. All of
/// these are already forbidden in real git ref names, so no legitimate ref is
/// rejected.
fn validate_git_ref(field: &str, value: &str) -> Result<(), AppError> {
    if value.is_empty() {
        return Err(AppError::Validation(format!(
            "GitHub {field} must not be empty"
        )));
    }
    if value.starts_with('/')
        || value.contains("..")
        || value
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '?' | '#' | '\\'))
    {
        return Err(AppError::Validation(format!(
            "Invalid GitHub {field} '{value}': must not be empty, start with '/', or contain '..', '?', '#', '\\\\', whitespace, or control characters"
        )));
    }
    Ok(())
}

/// Single-flight per `owner/repo` for patch-release cuts. Concurrent CICD runs
/// would otherwise both read the same latest release, compute the same next
/// tag, and race two create calls — the loser hits GitHub's 422 "tag already
/// exists". Serializing makes the second run observe the first's new release as
/// latest and correctly no-op (commits_since == 0).
static PATCH_RELEASE_INFLIGHT: LazyLock<InflightGuard> = LazyLock::new(InflightGuard::new);

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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPullRequest {
    pub number: i64,
    pub html_url: String,
    pub head_branch: String,
    pub base_branch: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRelease {
    pub id: i64,
    pub tag_name: String,
    pub name: String,
    pub html_url: String,
    pub draft: bool,
    pub prerelease: bool,
    pub created_at: String,
}

/// Result of an automated patch-release attempt.
///
/// `created == false` with `new_tag == Some(..)` means a release *would* be
/// cut (either a dry-run, or skipped only because the run was a dry-run).
/// `created == false` with `new_tag == None` means there was nothing to
/// release (no new commits on the default branch since the last release).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PatchReleaseOutcome {
    pub created: bool,
    pub previous_tag: Option<String>,
    pub new_tag: Option<String>,
    pub commits_since: i64,
    pub release_url: Option<String>,
    pub dry_run: bool,
    pub reason: String,
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

/// Raw GitHub API pull-request response (subset of fields).
#[derive(Debug, Deserialize)]
struct GhPullRequestRaw {
    number: i64,
    html_url: String,
    state: String,
    head: GhRefRaw,
    base: GhRefRaw,
}

#[derive(Debug, Deserialize)]
struct GhRefRaw {
    #[serde(rename = "ref")]
    ref_name: String,
}

/// Raw GitHub API release response (subset of fields).
#[derive(Debug, Deserialize)]
struct GhReleaseRaw {
    id: i64,
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    created_at: String,
}

impl From<GhReleaseRaw> for GitHubRelease {
    fn from(r: GhReleaseRaw) -> Self {
        let tag_name = r.tag_name;
        GitHubRelease {
            id: r.id,
            // GitHub allows a null release name — fall back to the tag.
            name: r.name.filter(|n| !n.is_empty()).unwrap_or_else(|| tag_name.clone()),
            tag_name,
            html_url: r.html_url,
            draft: r.draft,
            prerelease: r.prerelease,
            created_at: r.created_at,
        }
    }
}

/// Raw GitHub API compare response (only the field we need).
#[derive(Debug, Deserialize)]
struct GhCompareRaw {
    ahead_by: i64,
}

impl GitHubClient {
    /// Create from decrypted credential fields (`personal_access_token`).
    pub fn from_fields(fields: &HashMap<String, String>) -> Result<Self, AppError> {
        let token = fields
            .get("personal_access_token")
            .ok_or_else(|| {
                AppError::Validation(
                    "GitHub credential missing 'personal_access_token' field".into(),
                )
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
        h.insert("Accept", "application/vnd.github+json".parse().unwrap());
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

    /// Open a pull request from `head` into `base` on `{owner}/{repo}`.
    ///
    /// `head` accepts the canonical GitHub forms: a branch name on the same
    /// repo (`feature/x`), or a cross-repo reference (`other-user:branch`).
    /// On success returns the typed `GitHubPullRequest` projection of the
    /// API response.
    ///
    /// GitHub returns 422 when the PR already exists for the same head/base
    /// pair — callers that want to be idempotent should treat that as a
    /// recoverable signal and look the existing PR up via list endpoints.
    pub async fn create_pull_request(
        &self,
        owner: &str,
        repo: &str,
        head: &str,
        base: &str,
        title: &str,
        body: Option<&str>,
    ) -> Result<GitHubPullRequest, AppError> {
        validate_repo_segment("owner", owner)?;
        validate_repo_segment("repo", repo)?;
        let url = format!("https://api.github.com/repos/{owner}/{repo}/pulls");
        let payload = serde_json::json!({
            "title": title,
            "head": head,
            "base": base,
            "body": body.unwrap_or(""),
        });

        let resp = self
            .http
            .post(&url)
            .headers(self.headers())
            .json(&payload)
            .send()
            .await
            .map_err(|e| AppError::Execution(format!("GitHub PR create failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let resp_body = resp.text().await.unwrap_or_default();
            return Err(AppError::Execution(format!(
                "GitHub PR create returned HTTP {status}: {resp_body}"
            )));
        }

        let raw: GhPullRequestRaw = resp.json().await.map_err(|e| {
            AppError::Execution(format!("Failed to parse GitHub PR response: {e}"))
        })?;

        Ok(GitHubPullRequest {
            number: raw.number,
            html_url: raw.html_url,
            head_branch: raw.head.ref_name,
            base_branch: raw.base.ref_name,
            state: raw.state,
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
        validate_repo_segment("owner", owner)?;
        validate_repo_segment("repo", repo)?;
        let url = format!("https://api.github.com/repos/{owner}/{repo}/dispatches");
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

    // ---- Releases (app-native CICD) ----

    /// Fetch the latest published (non-draft, non-prerelease) release.
    ///
    /// Returns `Ok(None)` when the repo has no releases yet (GitHub 404).
    pub async fn get_latest_release(
        &self,
        owner: &str,
        repo: &str,
    ) -> Result<Option<GitHubRelease>, AppError> {
        validate_repo_segment("owner", owner)?;
        validate_repo_segment("repo", repo)?;
        let url = format!("https://api.github.com/repos/{owner}/{repo}/releases/latest");
        let resp = self
            .http
            .get(&url)
            .headers(self.headers())
            .send()
            .await
            .map_err(|e| AppError::Execution(format!("GitHub latest-release request failed: {e}")))?;

        if resp.status().as_u16() == 404 {
            return Ok(None);
        }
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Execution(format!(
                "GitHub latest-release returned HTTP {status}: {body}"
            )));
        }

        let raw: GhReleaseRaw = resp
            .json()
            .await
            .map_err(|e| AppError::Execution(format!("Failed to parse GitHub release: {e}")))?;
        Ok(Some(raw.into()))
    }

    /// Number of commits `head` is ahead of `base` (a tag, branch, or SHA).
    pub async fn compare_commits(
        &self,
        owner: &str,
        repo: &str,
        base: &str,
        head: &str,
    ) -> Result<i64, AppError> {
        validate_repo_segment("owner", owner)?;
        validate_repo_segment("repo", repo)?;
        validate_git_ref("compare base", base)?;
        validate_git_ref("compare head", head)?;
        let url = format!("https://api.github.com/repos/{owner}/{repo}/compare/{base}...{head}");
        let resp = self
            .http
            .get(&url)
            .headers(self.headers())
            .send()
            .await
            .map_err(|e| AppError::Execution(format!("GitHub compare request failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Execution(format!(
                "GitHub compare returned HTTP {status}: {body}"
            )));
        }

        let raw: GhCompareRaw = resp
            .json()
            .await
            .map_err(|e| AppError::Execution(format!("Failed to parse GitHub compare: {e}")))?;
        Ok(raw.ahead_by)
    }

    /// Create a release. GitHub creates the underlying tag from
    /// `target_commitish` (defaults to the repo's default branch) if it does
    /// not already exist.
    pub async fn create_release(
        &self,
        owner: &str,
        repo: &str,
        tag_name: &str,
        name: &str,
        body: &str,
        target_commitish: Option<&str>,
    ) -> Result<GitHubRelease, AppError> {
        validate_repo_segment("owner", owner)?;
        validate_repo_segment("repo", repo)?;
        let url = format!("https://api.github.com/repos/{owner}/{repo}/releases");
        let mut payload = serde_json::json!({
            "tag_name": tag_name,
            "name": name,
            "body": body,
            "draft": false,
            "prerelease": false,
        });
        if let Some(t) = target_commitish {
            payload["target_commitish"] = serde_json::json!(t);
        }

        let resp = self
            .http
            .post(&url)
            .headers(self.headers())
            .json(&payload)
            .send()
            .await
            .map_err(|e| AppError::Execution(format!("GitHub release create failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let resp_body = resp.text().await.unwrap_or_default();
            return Err(AppError::Execution(format!(
                "GitHub release create returned HTTP {status}: {resp_body}"
            )));
        }

        let raw: GhReleaseRaw = resp.json().await.map_err(|e| {
            AppError::Execution(format!("Failed to parse GitHub release response: {e}"))
        })?;
        Ok(raw.into())
    }

    /// The CICD primitive: if the default branch has advanced since the last
    /// release (a merge landed), cut a new release with the PATCH number
    /// incremented. No-op when there are no new commits. `dry_run` reports
    /// what it would do without creating anything.
    pub async fn create_patch_release(
        &self,
        owner: &str,
        repo: &str,
        base_branch: &str,
        dry_run: bool,
    ) -> Result<PatchReleaseOutcome, AppError> {
        // Validate every caller-supplied path component up front (the trust
        // boundary) so an invalid `owner`/`repo`/`base_branch` can never reach
        // URL construction — including the no-prior-release path where
        // `base_branch` would otherwise only flow into a JSON body. The
        // per-builder guards below remain as defense in depth for other callers.
        validate_repo_segment("owner", owner)?;
        validate_repo_segment("repo", repo)?;
        validate_git_ref("base_branch", base_branch)?;

        // Serialize real (non-dry) runs per repo so two concurrent CICD cuts
        // can't both create the same next tag. Dry runs create nothing, so they
        // skip the guard (and never block a real run). Released on return.
        let _inflight = if dry_run {
            None
        } else {
            Some(
                PATCH_RELEASE_INFLIGHT
                    .guard(&format!("{owner}/{repo}"))
                    .ok_or_else(|| {
                        AppError::RateLimited(format!(
                            "A patch release for {owner}/{repo} is already in progress"
                        ))
                    })?,
            )
        };

        let latest = self.get_latest_release(owner, repo).await?;
        let previous_tag = latest.as_ref().map(|r| r.tag_name.clone());

        // Detect new commits on the default branch since the last release.
        let commits_since = match previous_tag.as_deref() {
            Some(tag) => self.compare_commits(owner, repo, tag, base_branch).await?,
            None => 0,
        };

        if previous_tag.is_some() && commits_since == 0 {
            return Ok(PatchReleaseOutcome {
                created: false,
                previous_tag,
                new_tag: None,
                commits_since: 0,
                release_url: None,
                dry_run,
                reason: "No new commits on the default branch since the last release — nothing to release.".into(),
            });
        }

        let new_tag = match previous_tag.as_deref() {
            Some(t) => bump_patch(t)?,
            None => "v0.0.1".to_string(),
        };

        if dry_run {
            return Ok(PatchReleaseOutcome {
                created: false,
                previous_tag: previous_tag.clone(),
                new_tag: Some(new_tag.clone()),
                commits_since,
                release_url: None,
                dry_run: true,
                reason: format!(
                    "Dry run: would create release {new_tag} ({commits_since} new commit(s) since {})",
                    previous_tag.as_deref().unwrap_or("the initial commit")
                ),
            });
        }

        let body = format!(
            "Automated patch release cut by Personas.\n\n{} new commit(s) since {}.",
            commits_since,
            previous_tag.as_deref().unwrap_or("the initial commit"),
        );
        let release = self
            .create_release(owner, repo, &new_tag, &new_tag, &body, Some(base_branch))
            .await?;

        Ok(PatchReleaseOutcome {
            created: true,
            previous_tag,
            new_tag: Some(release.tag_name.clone()),
            commits_since,
            release_url: Some(release.html_url),
            dry_run: false,
            reason: format!("Created release {} on {owner}/{repo}.", release.tag_name),
        })
    }
}

/// Increment the PATCH component of a `MAJOR.MINOR.PATCH` semver tag,
/// preserving an optional leading `v`/`V`. A two-part `MAJOR.MINOR` is
/// treated as `MAJOR.MINOR.0`. Pre-release / build-metadata suffixes are not
/// supported (returns a `Validation` error) — release tags here are plain.
pub fn bump_patch(tag: &str) -> Result<String, AppError> {
    let trimmed = tag.trim();
    let (prefix, rest) = match trimmed.strip_prefix(['v', 'V']) {
        Some(stripped) => ("v", stripped),
        None => ("", trimmed),
    };
    let mut parts: Vec<u64> = rest
        .split('.')
        .map(|p| p.parse::<u64>())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| {
            AppError::Validation(format!("Cannot parse a MAJOR.MINOR.PATCH version from tag '{tag}'"))
        })?;
    if parts.is_empty() || parts.len() > 3 {
        return Err(AppError::Validation(format!(
            "Tag '{tag}' is not a MAJOR.MINOR.PATCH version"
        )));
    }
    while parts.len() < 3 {
        parts.push(0);
    }
    parts[2] += 1;
    Ok(format!("{prefix}{}.{}.{}", parts[0], parts[1], parts[2]))
}

#[cfg(test)]
mod tests {
    use super::bump_patch;

    #[test]
    fn bumps_patch_preserving_v_prefix() {
        assert_eq!(bump_patch("v0.0.1").unwrap(), "v0.0.2");
        assert_eq!(bump_patch("v1.2.9").unwrap(), "v1.2.10");
    }

    #[test]
    fn bumps_patch_without_prefix() {
        assert_eq!(bump_patch("0.1.2").unwrap(), "0.1.3");
    }

    #[test]
    fn pads_two_part_version() {
        assert_eq!(bump_patch("v2.5").unwrap(), "v2.5.1");
    }

    #[test]
    fn tolerates_surrounding_whitespace() {
        assert_eq!(bump_patch("  v3.0.0  ").unwrap(), "v3.0.1");
    }

    #[test]
    fn rejects_non_semver() {
        assert!(bump_patch("latest").is_err());
        assert!(bump_patch("v1.2.3-rc.1").is_err());
        assert!(bump_patch("1.2.3.4").is_err());
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
    if let Err(e) = crate::db::repos::resources::audit_log::log_decrypt(
        pool,
        credential_id,
        &credential.name,
        "platform:github",
        None,
        None,
    ) {
        tracing::warn!(credential_id, error = %e, "Failed to write audit log for credential decrypt");
    }
    GitHubClient::from_fields(&fields)
}
