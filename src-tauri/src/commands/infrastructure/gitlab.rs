use std::sync::Arc;

use tauri::State;

use crate::db::repos::core::personas;
use crate::db::repos::resources::tools;
use crate::error::AppError;
use crate::gitlab;
use crate::gitlab::client::GitLabClient;
use crate::gitlab::types::*;
use crate::AppState;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
#[tauri::command]
pub async fn gitlab_connect(
    state: State<'_, Arc<AppState>>,
    token: String,
) -> Result<GitLabUser, AppError> {
    if token.trim().is_empty() {
        return Err(AppError::GitLab("GitLab token must not be empty".into()));
    }

    let client = Arc::new(GitLabClient::new(
        "https://gitlab.com".to_string(),
        token.trim().to_string(),
    ));

    let user = client.validate_token().await.map_err(|e| {
        AppError::GitLab(format!("Failed to validate GitLab token: {e}"))
    })?;

    gitlab::config::store_gitlab_config(token.trim())
        .map_err(|e| AppError::GitLab(format!("Failed to store GitLab config: {e}")))?;

    *state.gitlab_client.lock().await = Some(client);

    tracing::info!(username = %user.username, "Connected to GitLab");
    Ok(user)
}

/// Disconnect from GitLab. Clears keyring and drops in-memory client.
#[tauri::command]
pub async fn gitlab_disconnect(
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
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
    let guard = state.gitlab_client.lock().await;
    match &*guard {
        Some(client) => {
            match client.validate_token().await {
                Ok(user) => Ok(Some(GitLabConfig {
                    base_url: "https://gitlab.com".to_string(),
                    is_connected: true,
                    username: user.username,
                })),
                Err(_) => Ok(Some(GitLabConfig {
                    base_url: "https://gitlab.com".to_string(),
                    is_connected: false,
                    username: String::new(),
                })),
            }
        }
        None => {
            if gitlab::config::load_gitlab_config().is_some() {
                Ok(Some(GitLabConfig {
                    base_url: "https://gitlab.com".to_string(),
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
    match client.create_duo_agent(project_id, &definition).await {
        Ok(agent) => {
            tracing::info!(
                persona_id = %persona_id,
                project_id = project_id,
                agent_id = %agent.id,
                "Deployed persona as Duo Agent via API"
            );
            Ok(GitLabDeployResult {
                agent_id: Some(agent.id),
                web_url: agent.web_url,
                method: "api".to_string(),
                credentials_provisioned,
            })
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

            Ok(GitLabDeployResult {
                agent_id: None,
                web_url: Some(format!(
                    "{}/blob/{}/AGENTS.md",
                    project.web_url, branch
                )),
                method: "agents_md".to_string(),
                credentials_provisioned,
            })
        }
    }
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
    let client = get_gitlab_client(&state).await?;
    match client.list_duo_agents(project_id).await {
        Ok(agents) => Ok(agents),
        Err(_) => {
            // Duo Agent API not available — return empty list
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
    let client = get_gitlab_client(&state).await?;
    client.delete_duo_agent(project_id, &agent_id).await?;
    tracing::info!(
        project_id = project_id,
        agent_id = %agent_id,
        "Undeployed Duo Agent"
    );
    Ok(())
}
