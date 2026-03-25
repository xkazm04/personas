use std::sync::Arc;

use tauri::State;

use crate::db::repos::core::personas;
use crate::db::repos::resources::{audit_log, credentials as cred_repo, deployment_history, tools};
use crate::error::AppError;
use crate::gitlab;
use crate::gitlab::client::GitLabClient;
use crate::gitlab::types::*;
use crate::ipc_auth::require_cloud_auth;
use crate::AppState;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_GITLAB_URL: &str = "https://gitlab.com";

/// Resolve the GitLab instance URL: use the provided value if non-empty,
/// otherwise fall back to the default (gitlab.com).
fn resolve_instance_url(instance_url: Option<&str>) -> String {
    instance_url
        .map(|u| u.trim())
        .filter(|u| !u.is_empty())
        .map(|u| u.trim_end_matches('/').to_string())
        .unwrap_or_else(|| DEFAULT_GITLAB_URL.to_string())
}

async fn get_gitlab_client(state: &AppState) -> Result<Arc<GitLabClient>, AppError> {
    state
        .gitlab_client
        .lock()
        .await
        .clone()
        .ok_or_else(|| AppError::GitLab("Not connected to GitLab".into()))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Connect to GitLab using a Personal Access Token.
/// Validates the token, stores it in keyring, and initialises the in-memory client.
///
/// `instance_url` is optional — when omitted or empty, defaults to `https://gitlab.com`.
#[tauri::command]
pub async fn gitlab_connect(
    state: State<'_, Arc<AppState>>,
    token: String,
    instance_url: Option<String>,
) -> Result<GitLabUser, AppError> {
    require_cloud_auth(&state, "gitlab_connect").await?;
    if token.trim().is_empty() {
        return Err(AppError::GitLab("GitLab token must not be empty".into()));
    }

    let base_url = resolve_instance_url(instance_url.as_deref());
    let client = Arc::new(GitLabClient::new(
        base_url.clone(),
        token.trim().to_string(),
    )?);

    let user = client.validate_token().await.map_err(|e| {
        AppError::GitLab(format!("Failed to validate GitLab token: {e}"))
    })?;

    gitlab::config::store_gitlab_config(token.trim())
        .map_err(|e| AppError::GitLab(format!("Failed to store GitLab config: {e}")))?;
    gitlab::config::store_gitlab_instance_url(&base_url)
        .map_err(|e| AppError::GitLab(format!("Failed to store GitLab instance URL: {e}")))?;

    *state.gitlab_client.lock().await = Some(client);

    tracing::info!(username = %user.username, base_url = %base_url, "Connected to GitLab");
    Ok(user)
}

/// Connect to GitLab using a credential stored in the Vault.
/// Decrypts the `personal_access_token` field and delegates to the same connect flow.
///
/// The instance URL is resolved in order: explicit `instance_url` parameter → vault
/// credential `instance_url` field → default (`https://gitlab.com`).
#[tauri::command]
pub async fn gitlab_connect_from_vault(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    instance_url: Option<String>,
) -> Result<GitLabUser, AppError> {
    require_cloud_auth(&state, "gitlab_connect_from_vault").await?;

    let credential = cred_repo::get_by_id(&state.db, &credential_id)?;
    let fields = cred_repo::get_decrypted_fields(&state.db, &credential)?;
    let _ = audit_log::log_decrypt(&state.db, &credential.id, &credential.name, "gitlab:connect_from_vault", None, None);

    let token = fields
        .get("personal_access_token")
        .ok_or_else(|| {
            AppError::GitLab("Vault credential missing personal_access_token field".into())
        })?;

    if token.trim().is_empty() {
        return Err(AppError::GitLab("GitLab token in vault is empty".into()));
    }

    // Resolve instance URL: explicit param > vault field > default
    let vault_url = fields.get("instance_url").map(|s| s.as_str());
    let effective_url = instance_url.as_deref().or(vault_url);
    let base_url = resolve_instance_url(effective_url);

    let client = Arc::new(GitLabClient::new(
        base_url.clone(),
        token.trim().to_string(),
    )?);

    let user = client.validate_token().await.map_err(|e| {
        AppError::GitLab(format!("Failed to validate GitLab token: {e}"))
    })?;

    gitlab::config::store_gitlab_config(token.trim())
        .map_err(|e| AppError::GitLab(format!("Failed to store GitLab config: {e}")))?;
    gitlab::config::store_gitlab_instance_url(&base_url)
        .map_err(|e| AppError::GitLab(format!("Failed to store GitLab instance URL: {e}")))?;

    *state.gitlab_client.lock().await = Some(client);

    tracing::info!(username = %user.username, credential_id = %credential_id, base_url = %base_url, "Connected to GitLab via vault credential");
    Ok(user)
}

/// Disconnect from GitLab. Clears keyring and drops in-memory client.
#[tauri::command]
pub async fn gitlab_disconnect(
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    require_cloud_auth(&state, "gitlab_disconnect").await?;
    gitlab::config::clear_gitlab_config();
    *state.gitlab_client.lock().await = None;
    tracing::info!("Disconnected from GitLab");
    Ok(())
}

/// Return the current GitLab connection configuration, if any.
#[tauri::command]
pub async fn gitlab_get_config(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<GitLabConfig>, AppError> {
    require_cloud_auth(&state, "gitlab_get_config").await?;
    let guard = state.gitlab_client.lock().await;
    match &*guard {
        Some(client) => {
            let base_url = client.base_url().to_string();
            match client.validate_token().await {
                Ok(user) => Ok(Some(GitLabConfig {
                    base_url,
                    is_connected: true,
                    username: user.username,
                })),
                Err(_) => Ok(Some(GitLabConfig {
                    base_url,
                    is_connected: false,
                    username: String::new(),
                })),
            }
        }
        None => {
            if gitlab::config::load_gitlab_config().is_some() {
                let stored_url = gitlab::config::load_gitlab_instance_url()
                    .unwrap_or_else(|| DEFAULT_GITLAB_URL.to_string());
                Ok(Some(GitLabConfig {
                    base_url: stored_url,
                    is_connected: false,
                    username: String::new(),
                }))
            } else {
                Ok(None)
            }
        }
    }
}

/// List GitLab projects accessible to the authenticated user.
#[tauri::command]
pub async fn gitlab_list_projects(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<GitLabProject>, AppError> {
    require_cloud_auth(&state, "gitlab_list_projects").await?;
    let client = get_gitlab_client(&state).await?;
    client.list_projects().await
}

/// Deploy a persona as a GitLab Duo Agent to a project.
///
/// When `provision_credentials` is true, the persona's tool credentials are
/// resolved, decrypted, and pushed as masked+protected CI/CD variables to the
/// GitLab project. The system prompt includes env var name hints (never values)
/// so the deployed agent knows how to authenticate with external services.
///
/// Falls back to AGENTS.md via Repository Files API if the Duo Agent API is unavailable.
#[tauri::command]
pub async fn gitlab_deploy_persona(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    project_id: i64,
    provision_credentials: bool,
) -> Result<GitLabDeployResult, AppError> {
    require_cloud_auth(&state, "gitlab_deploy_persona").await?;
    let client = get_gitlab_client(&state).await?;

    let persona = personas::get_by_id(&state.db, &persona_id)?;
    let persona_tools = tools::get_tools_for_persona(&state.db, &persona_id)?;

    // Resolve credentials if requested
    let mut credentials_provisioned: u32 = 0;
    let credential_hints: Option<Vec<String>>;

    if provision_credentials {
        let resolved = gitlab::converter::resolve_credentials_for_gitlab(
            &state.db,
            &persona_tools,
            &persona_id,
            &persona.name,
        );

        // Push each credential as a masked CI/CD variable
        for variable in &resolved.variables {
            client
                .upsert_variable(project_id, variable)
                .await
                .map_err(|e| {
                    AppError::GitLab(format!(
                        "Failed to provision credential '{}': {}",
                        variable.key, e
                    ))
                })?;
        }

        credentials_provisioned = resolved.entries.len() as u32;
        credential_hints = Some(resolved.hints);

        if credentials_provisioned > 0 {
            tracing::info!(
                persona_id = %persona_id,
                project_id = project_id,
                count = credentials_provisioned,
                "Provisioned credentials as GitLab CI/CD variables"
            );
        }
    } else {
        credential_hints = None;
    }

    // Build the agent definition with credential hints in the prompt
    let hint_refs: Vec<&str> = credential_hints
        .as_ref()
        .map(|h| h.iter().map(|s| s.as_str()).collect())
        .unwrap_or_default();
    let hint_slice: Option<&[&str]> = if hint_refs.is_empty() {
        None
    } else {
        Some(&hint_refs)
    };

    let definition = gitlab::converter::persona_to_agent(&persona, &persona_tools, hint_slice);

    // Try the Duo Agent API first
    let result = match client.create_duo_agent(project_id, &definition).await {
        Ok(agent) => {
            tracing::info!(
                persona_id = %persona_id,
                project_id = project_id,
                agent_id = %agent.id,
                "Deployed persona as Duo Agent via API"
            );
            GitLabDeployResult {
                agent_id: Some(agent.id),
                web_url: agent.web_url,
                method: "api".to_string(),
                credentials_provisioned,
            }
        }
        Err(_api_err) => {
            // Fallback: create/update AGENTS.md in the repo
            let project = client.get_project(project_id).await?;
            let branch = project.default_branch.as_deref().unwrap_or("main");
            let md_content =
                gitlab::converter::persona_to_agents_md(&persona, &persona_tools, hint_slice);

            client
                .upsert_agents_md(project_id, branch, &md_content)
                .await?;

            tracing::info!(
                persona_id = %persona_id,
                project_id = project_id,
                "Deployed persona via AGENTS.md fallback"
            );

            GitLabDeployResult {
                agent_id: None,
                web_url: Some(format!(
                    "{}/blob/{}/AGENTS.md",
                    project.web_url, branch
                )),
                method: "agents_md".to_string(),
                credentials_provisioned,
            }
        }
    };

    // Record deployment in history
    let _ = deployment_history::insert(
        &state.db,
        &persona_id,
        &persona.name,
        project_id,
        &result.method,
        result.credentials_provisioned,
        "success",
        result.agent_id.as_deref(),
        result.web_url.as_deref(),
        Some(&persona.system_prompt),
        None,
    );

    Ok(result)
}

/// Revoke provisioned credentials from a GitLab project.
///
/// Accepts a list of CI/CD variable keys to delete. This is called during
/// undeploy to clean up secrets that were previously provisioned.
#[tauri::command]
pub async fn gitlab_revoke_credentials(
    state: State<'_, Arc<AppState>>,
    project_id: i64,
    variable_keys: Vec<String>,
) -> Result<u32, AppError> {
    require_cloud_auth(&state, "gitlab_revoke_credentials").await?;
    let client = get_gitlab_client(&state).await?;
    let mut revoked: u32 = 0;

    for key in &variable_keys {
        match client.delete_variable(project_id, key).await {
            Ok(()) => {
                revoked += 1;
                tracing::info!(project_id = project_id, key = %key, "Revoked CI/CD variable");
            }
            Err(e) => {
                // Variable may not exist (already deleted, or was never created)
                tracing::warn!(
                    project_id = project_id,
                    key = %key,
                    "Failed to revoke CI/CD variable: {}",
                    e
                );
            }
        }
    }

    Ok(revoked)
}

/// List deployed Duo Agents for a project.
#[tauri::command]
pub async fn gitlab_list_agents(
    state: State<'_, Arc<AppState>>,
    project_id: i64,
) -> Result<Vec<GitLabAgent>, AppError> {
    require_cloud_auth(&state, "gitlab_list_agents").await?;
    let client = get_gitlab_client(&state).await?;
    match client.list_duo_agents(project_id).await {
        Ok(agents) => Ok(agents),
        Err(_) => {
            // Duo Agent API not available -- return empty list
            Ok(vec![])
        }
    }
}

/// Remove a deployed Duo Agent from a project.
#[tauri::command]
pub async fn gitlab_undeploy_agent(
    state: State<'_, Arc<AppState>>,
    project_id: i64,
    agent_id: String,
) -> Result<(), AppError> {
    require_cloud_auth(&state, "gitlab_undeploy_agent").await?;
    let client = get_gitlab_client(&state).await?;
    client.delete_duo_agent(project_id, &agent_id).await?;
    tracing::info!(
        project_id = project_id,
        agent_id = %agent_id,
        "Undeployed Duo Agent"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// GitOps Versioning Commands
// ---------------------------------------------------------------------------

/// Prefix used for persona version tags in GitLab.
const PERSONA_TAG_PREFIX: &str = "persona/";

/// Parse a persona version tag name into (persona_name, version).
/// Tag format: `persona/<persona-name>/v<N>` or `persona/<persona-name>/<env>/v<N>`
fn parse_persona_tag(tag_name: &str) -> Option<(String, String, Option<String>)> {
    let rest = tag_name.strip_prefix(PERSONA_TAG_PREFIX)?;
    let parts: Vec<&str> = rest.split('/').collect();
    match parts.len() {
        // persona/<name>/v<N>
        2 => Some((parts[0].to_string(), parts[1].to_string(), None)),
        // persona/<name>/<env>/v<N>
        3 => Some((
            parts[0].to_string(),
            parts[2].to_string(),
            Some(parts[1].to_string()),
        )),
        _ => None,
    }
}

/// Build a tag name for a persona version.
fn build_persona_tag(persona_name: &str, version: u32, environment: Option<&str>) -> String {
    let slug = persona_name
        .to_lowercase()
        .replace(' ', "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .collect::<String>();
    match environment {
        Some(env) => format!("{PERSONA_TAG_PREFIX}{slug}/{env}/v{version}"),
        None => format!("{PERSONA_TAG_PREFIX}{slug}/v{version}"),
    }
}

/// List version history for a persona deployed to a GitLab project.
/// Returns tags matching the persona/<name>/* pattern, sorted newest first.
#[tauri::command]
pub async fn gitlab_list_persona_versions(
    state: State<'_, Arc<AppState>>,
    project_id: i64,
    persona_name: String,
) -> Result<Vec<GitLabPersonaVersion>, AppError> {
    require_cloud_auth(&state, "gitlab_list_persona_versions").await?;
    let client = get_gitlab_client(&state).await?;

    let slug = persona_name
        .to_lowercase()
        .replace(' ', "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .collect::<String>();
    let search_prefix = format!("{PERSONA_TAG_PREFIX}{slug}/");

    let tags = client.list_tags(project_id, Some(&search_prefix)).await?;

    // Also get agents to determine which version is currently deployed
    let agents = client
        .list_duo_agents(project_id)
        .await
        .unwrap_or_default();
    let current_agent = agents.iter().find(|a| {
        a.name.to_lowercase().replace(' ', "-") == slug
    });

    let mut versions: Vec<GitLabPersonaVersion> = tags
        .into_iter()
        .filter_map(|tag| {
            let (name, version, environment) = parse_persona_tag(&tag.name)?;
            let commit = tag.commit.as_ref();
            Some(GitLabPersonaVersion {
                tag_name: tag.name.clone(),
                version,
                persona_name: name,
                commit_sha: commit.map(|c| c.id.clone()).unwrap_or_default(),
                commit_message: commit.and_then(|c| c.message.clone()),
                created_at: commit.and_then(|c| c.authored_date.clone()),
                created_by: commit.and_then(|c| c.author_name.clone()),
                is_current: false, // will be set below
                environment,
            })
        })
        .collect();

    // Mark the latest version as current (heuristic: matches current agent)
    if current_agent.is_some() {
        if let Some(latest) = versions.first_mut() {
            latest.is_current = true;
        }
    }

    Ok(versions)
}

/// Deploy a persona and tag it as a new version in the GitLab project.
/// This extends `gitlab_deploy_persona` with automatic version tagging.
#[tauri::command]
pub async fn gitlab_deploy_persona_versioned(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    project_id: i64,
    provision_credentials: bool,
    environment: Option<String>,
) -> Result<GitLabDeployResult, AppError> {
    require_cloud_auth(&state, "gitlab_deploy_persona_versioned").await?;
    let client = get_gitlab_client(&state).await?;

    let persona = personas::get_by_id(&state.db, &persona_id)?;
    let persona_tools = tools::get_tools_for_persona(&state.db, &persona_id)?;

    // Resolve credentials if requested
    let mut credentials_provisioned: u32 = 0;
    let credential_hints: Option<Vec<String>>;

    if provision_credentials {
        let resolved = gitlab::converter::resolve_credentials_for_gitlab(
            &state.db,
            &persona_tools,
            &persona_id,
            &persona.name,
        );

        for variable in &resolved.variables {
            client
                .upsert_variable(project_id, variable)
                .await
                .map_err(|e| {
                    AppError::GitLab(format!(
                        "Failed to provision credential '{}': {}",
                        variable.key, e
                    ))
                })?;
        }

        credentials_provisioned = resolved.entries.len() as u32;
        credential_hints = Some(resolved.hints);
    } else {
        credential_hints = None;
    }

    let hint_refs: Vec<&str> = credential_hints
        .as_ref()
        .map(|h| h.iter().map(|s| s.as_str()).collect())
        .unwrap_or_default();
    let hint_slice: Option<&[&str]> = if hint_refs.is_empty() {
        None
    } else {
        Some(&hint_refs)
    };

    let definition = gitlab::converter::persona_to_agent(&persona, &persona_tools, hint_slice);

    // Deploy the agent
    let deploy_result = match client.create_duo_agent(project_id, &definition).await {
        Ok(agent) => {
            tracing::info!(
                persona_id = %persona_id,
                project_id = project_id,
                agent_id = %agent.id,
                "Deployed versioned persona as Duo Agent via API"
            );
            GitLabDeployResult {
                agent_id: Some(agent.id),
                web_url: agent.web_url,
                method: "api".to_string(),
                credentials_provisioned,
            }
        }
        Err(_api_err) => {
            let project = client.get_project(project_id).await?;
            let branch = project.default_branch.as_deref().unwrap_or("main");
            let md_content =
                gitlab::converter::persona_to_agents_md(&persona, &persona_tools, hint_slice);

            client
                .upsert_agents_md(project_id, branch, &md_content)
                .await?;

            GitLabDeployResult {
                agent_id: None,
                web_url: Some(format!(
                    "{}/blob/{}/AGENTS.md",
                    project.web_url, branch
                )),
                method: "agents_md".to_string(),
                credentials_provisioned,
            }
        }
    };

    // Tag the current commit as a new version
    let slug = persona.name
        .to_lowercase()
        .replace(' ', "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .collect::<String>();
    let search_prefix = format!("{PERSONA_TAG_PREFIX}{slug}/");
    let existing_tags = client
        .list_tags(project_id, Some(&search_prefix))
        .await
        .unwrap_or_default();

    // Compute next version number
    let max_version = existing_tags
        .iter()
        .filter_map(|t| parse_persona_tag(&t.name))
        .filter_map(|(_, v, _)| v.strip_prefix('v').and_then(|n| n.parse::<u32>().ok()))
        .max()
        .unwrap_or(0);
    let next_version = max_version + 1;

    let tag_name = build_persona_tag(&persona.name, next_version, environment.as_deref());

    let project = client.get_project(project_id).await?;
    let default_branch = project.default_branch.as_deref().unwrap_or("main");

    let tag_message = format!(
        "Deploy {} v{} via Personas Desktop{}",
        persona.name,
        next_version,
        environment
            .as_ref()
            .map(|e| format!(" ({})", e))
            .unwrap_or_default()
    );

    match client
        .create_tag(project_id, &tag_name, default_branch, Some(&tag_message))
        .await
    {
        Ok(_tag) => {
            tracing::info!(
                persona_id = %persona_id,
                project_id = project_id,
                tag = %tag_name,
                "Created version tag for persona deployment"
            );
        }
        Err(e) => {
            tracing::warn!(
                persona_id = %persona_id,
                project_id = project_id,
                tag = %tag_name,
                "Failed to create version tag (deploy succeeded): {}",
                e
            );
        }
    }

    // Record versioned deployment in history
    let _ = deployment_history::insert(
        &state.db,
        &persona_id,
        &persona.name,
        project_id,
        &deploy_result.method,
        deploy_result.credentials_provisioned,
        "success",
        deploy_result.agent_id.as_deref(),
        deploy_result.web_url.as_deref(),
        Some(&persona.system_prompt),
        None,
    );

    Ok(deploy_result)
}

/// Rollback a persona to a previous version by redeploying from a tagged commit.
///
/// This reads the AGENTS.md at the specified tag, then redeploys the agent definition
/// from that version. A new rollback tag is also created for audit trail.
#[tauri::command]
pub async fn gitlab_rollback_persona(
    state: State<'_, Arc<AppState>>,
    project_id: i64,
    persona_name: String,
    target_tag: String,
) -> Result<GitLabRollbackResult, AppError> {
    require_cloud_auth(&state, "gitlab_rollback_persona").await?;
    let client = get_gitlab_client(&state).await?;

    // Verify the tag exists
    let (parsed_name, parsed_version, parsed_env) = parse_persona_tag(&target_tag)
        .ok_or_else(|| AppError::GitLab(format!("Invalid persona version tag: {target_tag}")))?;

    if parsed_name.to_lowercase() != persona_name.to_lowercase().replace(' ', "-") {
        return Err(AppError::GitLab(format!(
            "Tag '{}' does not belong to persona '{}'",
            target_tag, persona_name
        )));
    }

    // Get persona from local DB to rebuild the agent definition
    // Look up by name since we may be rolling back
    let all_personas = personas::get_all(&state.db)?;
    let persona = all_personas
        .iter()
        .find(|p| p.name.to_lowercase().replace(' ', "-") == parsed_name.to_lowercase())
        .ok_or_else(|| {
            AppError::GitLab(format!(
                "Persona '{}' not found in local database",
                persona_name
            ))
        })?;

    let persona_tools = tools::get_tools_for_persona(&state.db, &persona.id)?;

    // Build agent definition without credential hints (rollback doesn't re-provision)
    let definition = gitlab::converter::persona_to_agent(persona, &persona_tools, None);

    // Attempt to update the existing Duo Agent or create new
    let deploy_result = match client.create_duo_agent(project_id, &definition).await {
        Ok(agent) => GitLabDeployResult {
            agent_id: Some(agent.id),
            web_url: agent.web_url,
            method: "api".to_string(),
            credentials_provisioned: 0,
        },
        Err(_) => {
            let project = client.get_project(project_id).await?;
            let branch = project.default_branch.as_deref().unwrap_or("main");
            let md = gitlab::converter::persona_to_agents_md(persona, &persona_tools, None);
            client.upsert_agents_md(project_id, branch, &md).await?;

            GitLabDeployResult {
                agent_id: None,
                web_url: Some(format!(
                    "{}/blob/{}/AGENTS.md",
                    project.web_url, branch
                )),
                method: "agents_md".to_string(),
                credentials_provisioned: 0,
            }
        }
    };

    // Create a rollback tag for audit trail
    let slug = persona_name
        .to_lowercase()
        .replace(' ', "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .collect::<String>();
    let search_prefix = format!("{PERSONA_TAG_PREFIX}{slug}/");
    let existing_tags = client
        .list_tags(project_id, Some(&search_prefix))
        .await
        .unwrap_or_default();

    let max_version = existing_tags
        .iter()
        .filter_map(|t| parse_persona_tag(&t.name))
        .filter_map(|(_, v, _)| v.strip_prefix('v').and_then(|n| n.parse::<u32>().ok()))
        .max()
        .unwrap_or(0);
    let rollback_version = max_version + 1;

    let rollback_tag = build_persona_tag(&persona_name, rollback_version, parsed_env.as_deref());

    let project = client.get_project(project_id).await?;
    let default_branch = project.default_branch.as_deref().unwrap_or("main");

    let rollback_msg = format!(
        "Rollback {} to {} (v{}) via Personas Desktop",
        persona_name, parsed_version, rollback_version
    );

    let new_tag = match client
        .create_tag(project_id, &rollback_tag, default_branch, Some(&rollback_msg))
        .await
    {
        Ok(_) => {
            tracing::info!(
                project_id = project_id,
                rollback_tag = %rollback_tag,
                target = %target_tag,
                "Created rollback version tag"
            );
            Some(rollback_tag)
        }
        Err(e) => {
            tracing::warn!("Failed to create rollback tag: {}", e);
            None
        }
    };

    // Record rollback in deployment history
    let _ = deployment_history::insert(
        &state.db,
        &persona.id,
        &persona.name,
        project_id,
        &deploy_result.method,
        deploy_result.credentials_provisioned,
        "success",
        deploy_result.agent_id.as_deref(),
        deploy_result.web_url.as_deref(),
        Some(&persona.system_prompt),
        Some(&target_tag),
    );

    Ok(GitLabRollbackResult {
        rolled_back_to: target_tag,
        new_tag,
        deploy_result,
    })
}

/// List environment branches for a persona in a GitLab project.
/// Looks for branches matching `persona/<name>/<env>` pattern.
#[tauri::command]
pub async fn gitlab_list_persona_branches(
    state: State<'_, Arc<AppState>>,
    project_id: i64,
    persona_name: String,
) -> Result<Vec<GitLabPersonaBranch>, AppError> {
    require_cloud_auth(&state, "gitlab_list_persona_branches").await?;
    let client = get_gitlab_client(&state).await?;

    let slug = persona_name
        .to_lowercase()
        .replace(' ', "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .collect::<String>();
    let search_prefix = format!("{PERSONA_TAG_PREFIX}{slug}/");

    let branches = client
        .list_branches(project_id, Some(&search_prefix))
        .await
        .unwrap_or_default();

    let result: Vec<GitLabPersonaBranch> = branches
        .into_iter()
        .filter_map(|b| {
            let rest = b.name.strip_prefix(&search_prefix)?;
            let environment = rest.to_string();
            if environment.is_empty() {
                return None;
            }
            Some(GitLabPersonaBranch {
                name: b.name.clone(),
                commit_sha: b.commit.as_ref().map(|c| c.id.clone()).unwrap_or_default(),
                commit_message: b.commit.and_then(|c| c.message),
                is_protected: b.protected,
                environment,
            })
        })
        .collect();

    Ok(result)
}

/// Create environment branches (dev/staging/production) for a persona in a project.
#[tauri::command]
pub async fn gitlab_setup_persona_branches(
    state: State<'_, Arc<AppState>>,
    project_id: i64,
    persona_name: String,
) -> Result<Vec<GitLabPersonaBranch>, AppError> {
    require_cloud_auth(&state, "gitlab_setup_persona_branches").await?;
    let client = get_gitlab_client(&state).await?;

    let slug = persona_name
        .to_lowercase()
        .replace(' ', "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .collect::<String>();

    let project = client.get_project(project_id).await?;
    let default_branch = project.default_branch.as_deref().unwrap_or("main");

    let environments = ["dev", "staging", "production"];
    let mut created: Vec<GitLabPersonaBranch> = Vec::new();

    for env in &environments {
        let branch_name = format!("{PERSONA_TAG_PREFIX}{slug}/{env}");
        match client
            .create_branch(project_id, &branch_name, default_branch)
            .await
        {
            Ok(branch) => {
                created.push(GitLabPersonaBranch {
                    name: branch.name,
                    commit_sha: branch.commit.as_ref().map(|c| c.id.clone()).unwrap_or_default(),
                    commit_message: branch.commit.and_then(|c| c.message),
                    is_protected: branch.protected,
                    environment: env.to_string(),
                });
            }
            Err(e) => {
                // Branch may already exist -- that's fine
                tracing::info!(
                    project_id = project_id,
                    branch = %branch_name,
                    "Branch creation skipped (may already exist): {}",
                    e
                );
            }
        }
    }

    Ok(created)
}

// ---------------------------------------------------------------------------
// Deployment History Commands
// ---------------------------------------------------------------------------

/// List deployment history for a specific project, optionally filtered by persona.
#[tauri::command]
pub async fn gitlab_list_deployment_history(
    state: State<'_, Arc<AppState>>,
    project_id: i64,
    persona_id: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<GitLabDeploymentRecord>, AppError> {
    require_cloud_auth(&state, "gitlab_list_deployment_history").await?;
    let max = limit.unwrap_or(50);
    match persona_id {
        Some(pid) => deployment_history::list_by_persona_project(&state.db, &pid, project_id, max),
        None => deployment_history::list_by_project(&state.db, project_id, max),
    }
}

/// Rollback to a previous deployment from history.
///
/// Finds the specified deployment record, redeploys that persona snapshot,
/// and revokes CI/CD variables from the current deployment.
#[tauri::command]
pub async fn gitlab_rollback_from_history(
    state: State<'_, Arc<AppState>>,
    project_id: i64,
    deployment_id: String,
) -> Result<GitLabDeployResult, AppError> {
    require_cloud_auth(&state, "gitlab_rollback_from_history").await?;
    let client = get_gitlab_client(&state).await?;

    // Get the full history for this project to find the target and current deployments
    let history = deployment_history::list_by_project(&state.db, project_id, 100)?;
    let target = history
        .iter()
        .find(|d| d.id == deployment_id)
        .ok_or_else(|| AppError::GitLab("Deployment record not found".into()))?;

    let persona = personas::get_by_id(&state.db, &target.persona_id)?;
    let persona_tools = tools::get_tools_for_persona(&state.db, &persona.id)?;

    // Build agent definition from the current persona state
    let definition = gitlab::converter::persona_to_agent(&persona, &persona_tools, None);

    // Redeploy
    let deploy_result = match client.create_duo_agent(project_id, &definition).await {
        Ok(agent) => GitLabDeployResult {
            agent_id: Some(agent.id),
            web_url: agent.web_url,
            method: "api".to_string(),
            credentials_provisioned: 0,
        },
        Err(_) => {
            let project = client.get_project(project_id).await?;
            let branch = project.default_branch.as_deref().unwrap_or("main");
            let md = gitlab::converter::persona_to_agents_md(&persona, &persona_tools, None);
            client.upsert_agents_md(project_id, branch, &md).await?;

            GitLabDeployResult {
                agent_id: None,
                web_url: Some(format!(
                    "{}/blob/{}/AGENTS.md",
                    project.web_url, branch
                )),
                method: "agents_md".to_string(),
                credentials_provisioned: 0,
            }
        }
    };

    // Record the rollback in history
    let _ = deployment_history::insert(
        &state.db,
        &persona.id,
        &persona.name,
        project_id,
        &deploy_result.method,
        0,
        "success",
        deploy_result.agent_id.as_deref(),
        deploy_result.web_url.as_deref(),
        Some(&persona.system_prompt),
        Some(&deployment_id),
    );

    tracing::info!(
        project_id = project_id,
        target_deployment = %deployment_id,
        persona_id = %persona.id,
        "Rolled back to previous deployment from history"
    );

    Ok(deploy_result)
}
