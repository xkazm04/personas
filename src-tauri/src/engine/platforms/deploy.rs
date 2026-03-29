use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::db::models::{
    AutomationFallbackMode, AutomationPlatform, CreateAutomationInput, PersonaAutomation,
    UpdateAutomationInput,
};
use crate::db::repos::resources::automations as automation_repo;
use crate::db::DbPool;
use crate::error::AppError;

use super::github;
use super::n8n;
use super::zapier;

// -- Input / Output ---------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DeployAutomationInput {
    pub persona_id: String,
    pub credential_id: String,
    pub design_result: Value,
    pub github_repo: Option<String>,
    pub use_case_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DeployAutomationResult {
    pub automation: PersonaAutomation,
    pub platform_url: Option<String>,
    pub webhook_url: Option<String>,
    pub deployment_message: String,
    /// Non-fatal warning when the workflow was created but activation failed on the platform.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activation_warning: Option<String>,
}

// -- Design result shape (from LLM) ----------------------------

#[derive(Debug, Deserialize)]
struct DesignResult {
    name: String,
    #[serde(default)]
    description: String,
    platform: AutomationPlatform,
    #[serde(default)]
    webhook_url: Option<String>,
    #[serde(default)]
    input_schema: Option<String>,
    #[serde(default)]
    output_schema: Option<String>,
    /// Seconds — AI prompt and frontend use seconds; converted to ms via
    /// [`timeout_secs_to_ms`] before DB insert.
    #[serde(default = "default_timeout")]
    timeout_secs: i64,
    #[serde(default = "default_fallback")]
    fallback_mode: AutomationFallbackMode,
    #[serde(default)]
    workflow_definition: Option<Value>,
}

fn default_timeout() -> i64 { 30 }
fn default_fallback() -> AutomationFallbackMode { AutomationFallbackMode::Connector }

/// Convert seconds (from AI design output / frontend) to milliseconds (DB storage).
/// Clamps to a sane range: minimum 1 second, maximum 1 hour.
fn timeout_secs_to_ms(secs: i64) -> i64 {
    secs.clamp(1, 3600) * 1000
}

// -- Main dispatcher --------------------------------------------

pub async fn deploy_automation(
    pool: &DbPool,
    input: DeployAutomationInput,
) -> Result<DeployAutomationResult, AppError> {
    let design: DesignResult = serde_json::from_value(input.design_result.clone()).map_err(|e| {
        AppError::Validation(format!("Invalid design result: {e}"))
    })?;

    match design.platform {
        AutomationPlatform::N8n => deploy_n8n(pool, &input, &design).await,
        AutomationPlatform::GithubActions => deploy_github(pool, &input, &design).await,
        AutomationPlatform::Zapier => deploy_zapier(pool, &input, &design).await,
        AutomationPlatform::Custom => deploy_custom(pool, &input, &design).await,
    }
}

// -- n8n --------------------------------------------------------

async fn deploy_n8n(
    pool: &DbPool,
    input: &DeployAutomationInput,
    design: &DesignResult,
) -> Result<DeployAutomationResult, AppError> {
    let client = n8n::build_client_from_credential(pool, &input.credential_id)?;

    // Get the workflow definition from the design, or build a minimal webhook workflow
    let wf_def = design.workflow_definition.clone().unwrap_or_else(|| {
        serde_json::json!({
            "name": design.name,
            "nodes": [
                {
                    "parameters": { "httpMethod": "POST", "path": slug(&design.name) },
                    "type": "n8n-nodes-base.webhook",
                    "typeVersion": 1,
                    "position": [250, 300],
                    "name": "Webhook"
                }
            ],
            "connections": {}
        })
    });

    // Create workflow on the n8n instance
    let created = client.create_workflow(&wf_def).await?;

    let workflow_id = created["id"].as_str().unwrap_or("").to_string();
    if workflow_id.is_empty() {
        return Err(AppError::Execution(
            "n8n returned a workflow without an ID".into(),
        ));
    }

    // Activate the workflow — capture failure instead of discarding it
    let activation_error = match client.activate_workflow(&workflow_id).await {
        Ok(_) => None,
        Err(e) => Some(format!("Workflow created but activation failed: {e}")),
    };

    // Resolve the base URL from credential to build platform URL
    let cred = crate::db::repos::resources::credentials::get_by_id(pool, &input.credential_id)?;
    let fields =
        crate::db::repos::resources::credentials::get_decrypted_fields(pool, &cred)?;
    let _ = crate::db::repos::resources::audit_log::log_decrypt(pool, &cred.id, &cred.name, "platform:deploy", None, None);
    let base_url = fields.get("base_url").cloned().unwrap_or_default();

    let platform_url = if base_url.is_empty() {
        None
    } else {
        Some(format!("{}/workflow/{}", base_url.trim_end_matches('/'), workflow_id))
    };

    // Extract webhook URL from the created workflow's nodes
    let webhook_url = extract_n8n_webhook_url(&created, &base_url);

    // Save to local DB — use Error status if activation failed
    let automation = if let Some(ref warn) = activation_error {
        create_with_error(
            pool,
            &input.persona_id,
            &design.name,
            &design.description,
            AutomationPlatform::N8n,
            Some(&workflow_id),
            platform_url.as_deref(),
            webhook_url.as_deref(),
            Some(&input.credential_id),
            None,
            design.input_schema.as_deref(),
            design.output_schema.as_deref(),
            design.timeout_secs,
            design.fallback_mode,
            input.use_case_id.as_deref(),
            warn,
        )?
    } else {
        create_and_activate(
            pool,
            &input.persona_id,
            &design.name,
            &design.description,
            AutomationPlatform::N8n,
            Some(&workflow_id),
            platform_url.as_deref(),
            webhook_url.as_deref(),
            Some(&input.credential_id),
            None,
            design.input_schema.as_deref(),
            design.output_schema.as_deref(),
            design.timeout_secs,
            design.fallback_mode,
            input.use_case_id.as_deref(),
        )?
    };

    let deployment_message = if activation_error.is_some() {
        format!(
            "Workflow '{}' was created on your n8n instance but could not be activated. Check the workflow configuration on n8n and activate it manually.",
            design.name
        )
    } else {
        format!(
            "Workflow '{}' created and activated on your n8n instance.",
            design.name
        )
    };

    Ok(DeployAutomationResult {
        automation,
        platform_url,
        webhook_url,
        deployment_message,
        activation_warning: activation_error,
    })
}

/// Try to extract the production webhook URL from an n8n workflow response.
fn extract_n8n_webhook_url(workflow: &Value, base_url: &str) -> Option<String> {
    let nodes = workflow["nodes"].as_array()?;
    for node in nodes {
        let node_type = node["type"].as_str().unwrap_or("");
        if node_type.contains("webhook") {
            // n8n webhook nodes have a "webhookId" field when created via API
            if let Some(wh_id) = node["webhookId"].as_str() {
                return Some(format!(
                    "{}/webhook/{}",
                    base_url.trim_end_matches('/'),
                    wh_id
                ));
            }
            // Fallback: use the path parameter
            if let Some(path) = node["parameters"]["path"].as_str() {
                return Some(format!(
                    "{}/webhook/{}",
                    base_url.trim_end_matches('/'),
                    path
                ));
            }
        }
    }
    None
}

// -- GitHub Actions ---------------------------------------------

async fn deploy_github(
    pool: &DbPool,
    input: &DeployAutomationInput,
    design: &DesignResult,
) -> Result<DeployAutomationResult, AppError> {
    let repo_full = input.github_repo.as_deref().ok_or_else(|| {
        AppError::Validation("GitHub repository is required for github_actions platform".into())
    })?;

    let (_owner, _repo) = parse_owner_repo(repo_full)?;

    let client = github::build_client_from_credential(pool, &input.credential_id)?;

    // Verify permissions
    let perms = client.check_permissions().await?;
    if !perms.has_repo {
        return Err(AppError::Validation(
            "GitHub token is missing 'repo' scope. Please update your token.".into(),
        ));
    }
    if !perms.has_workflow {
        return Err(AppError::Validation(
            "GitHub token is missing 'workflow' scope. Please update your token.".into(),
        ));
    }

    // Determine event type from workflow_definition or generate one
    let event_type = design
        .workflow_definition
        .as_ref()
        .and_then(|d| d["event_type"].as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("personas-{}", slug(&design.name)));

    // Create a webhook trigger in the local system for GitHub to call back
    let hmac_secret = uuid::Uuid::new_v4().to_string();
    let trigger_config = serde_json::json!({
        "webhook_secret": hmac_secret,
        "event_type": format!("github_dispatch_{}", slug(&design.name)),
    });

    let trigger_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_triggers
         (id, persona_id, name, trigger_type, config, enabled, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'webhook', ?4, 1, ?5, ?5)",
        rusqlite::params![
            trigger_id,
            input.persona_id,
            format!("GitHub: {}", design.name),
            trigger_config.to_string(),
            now,
        ],
    )?;

    let webhook_url = format!("http://localhost:9420/webhook/{trigger_id}");

    // Store dispatch metadata for runtime use
    let credential_mapping = serde_json::json!({
        "event_type": event_type,
        "repo": repo_full,
        "webhook_trigger_id": trigger_id,
    });

    let platform_url = format!("https://github.com/{repo_full}/actions");

    // Save automation to DB
    let automation = create_and_activate(
        pool,
        &input.persona_id,
        &design.name,
        &design.description,
        AutomationPlatform::GithubActions,
        None,
        Some(&platform_url),
        Some(&webhook_url),
        Some(&input.credential_id),
        Some(&credential_mapping.to_string()),
        design.input_schema.as_deref(),
        design.output_schema.as_deref(),
        design.timeout_secs,
        design.fallback_mode,
        input.use_case_id.as_deref(),
    )?;

    Ok(DeployAutomationResult {
        automation,
        platform_url: Some(platform_url),
        webhook_url: Some(webhook_url),
        deployment_message: format!(
            "GitHub Actions integration configured for {repo_full}. Dispatch event type: '{event_type}'. Local webhook endpoint ready at port 9420.",
        ),
        activation_warning: None,
    })
}

fn parse_owner_repo(full: &str) -> Result<(&str, &str), AppError> {
    let parts: Vec<&str> = full.splitn(2, '/').collect();
    if parts.len() != 2 || parts[0].is_empty() || parts[1].is_empty() {
        return Err(AppError::Validation(format!(
            "Invalid repository format '{full}'. Expected 'owner/repo'."
        )));
    }
    Ok((parts[0], parts[1]))
}

// -- Zapier -----------------------------------------------------

async fn deploy_zapier(
    pool: &DbPool,
    input: &DeployAutomationInput,
    design: &DesignResult,
) -> Result<DeployAutomationResult, AppError> {
    let hook_url = design
        .workflow_definition
        .as_ref()
        .and_then(|d| d["catch_hook_url"].as_str())
        .map(|s| s.to_string())
        .or_else(|| design.webhook_url.clone());

    let hook_url = hook_url.ok_or_else(|| {
        AppError::Validation(
            "No Zapier catch hook URL provided. Please create a Zap with a 'Catch Hook' trigger in Zapier and paste the URL."
                .into(),
        )
    })?;

    // Validate the hook is reachable
    let client = zapier::ZapierClient::new()?;
    let is_valid = client.validate_catch_hook(&hook_url).await?;
    if !is_valid {
        return Err(AppError::Execution(
            "Zapier catch hook URL is not reachable or returned an error.".into(),
        ));
    }

    let automation = create_and_activate(
        pool,
        &input.persona_id,
        &design.name,
        &design.description,
        AutomationPlatform::Zapier,
        None,
        None,
        Some(&hook_url),
        Some(&input.credential_id),
        None,
        design.input_schema.as_deref(),
        design.output_schema.as_deref(),
        design.timeout_secs,
        design.fallback_mode,
        input.use_case_id.as_deref(),
    )?;

    Ok(DeployAutomationResult {
        automation,
        platform_url: None,
        webhook_url: Some(hook_url),
        deployment_message: format!(
            "Zapier automation '{}' connected and validated.",
            design.name
        ),
        activation_warning: None,
    })
}

// -- Custom -----------------------------------------------------

async fn deploy_custom(
    pool: &DbPool,
    input: &DeployAutomationInput,
    design: &DesignResult,
) -> Result<DeployAutomationResult, AppError> {
    // Custom platform -- save as draft, user handles setup manually
    let create_input = CreateAutomationInput {
        persona_id: input.persona_id.clone(),
        use_case_id: input.use_case_id.clone(),
        name: design.name.clone(),
        description: Some(design.description.clone()),
        platform: AutomationPlatform::Custom,
        platform_workflow_id: None,
        platform_url: None,
        webhook_url: design.webhook_url.clone(),
        webhook_method: None,
        platform_credential_id: Some(input.credential_id.clone()),
        credential_mapping: None,
        input_schema: design.input_schema.clone(),
        output_schema: design.output_schema.clone(),
        timeout_ms: Some(timeout_secs_to_ms(design.timeout_secs)),
        retry_count: None,
        fallback_mode: Some(design.fallback_mode),
    };

    let automation = automation_repo::create(pool, create_input)?;

    Ok(DeployAutomationResult {
        automation,
        platform_url: None,
        webhook_url: design.webhook_url.clone(),
        deployment_message: "Custom automation saved as draft. Complete the setup manually.".into(),
        activation_warning: None,
    })
}

// -- Helpers ----------------------------------------------------

/// Create an automation and immediately activate it.
#[allow(clippy::too_many_arguments)]
fn create_and_activate(
    pool: &DbPool,
    persona_id: &str,
    name: &str,
    description: &str,
    platform: AutomationPlatform,
    platform_workflow_id: Option<&str>,
    platform_url: Option<&str>,
    webhook_url: Option<&str>,
    credential_id: Option<&str>,
    credential_mapping: Option<&str>,
    input_schema: Option<&str>,
    output_schema: Option<&str>,
    timeout_secs: i64,
    fallback_mode: AutomationFallbackMode,
    use_case_id: Option<&str>,
) -> Result<PersonaAutomation, AppError> {
    let create_input = CreateAutomationInput {
        persona_id: persona_id.into(),
        use_case_id: use_case_id.map(|s| s.into()),
        name: name.into(),
        description: Some(description.into()),
        platform,
        platform_workflow_id: platform_workflow_id.map(|s| s.into()),
        platform_url: platform_url.map(|s| s.into()),
        webhook_url: webhook_url.map(|s| s.into()),
        webhook_method: None,
        platform_credential_id: credential_id.map(|s| s.into()),
        credential_mapping: credential_mapping.map(|s| s.into()),
        input_schema: input_schema.map(|s| s.into()),
        output_schema: output_schema.map(|s| s.into()),
        timeout_ms: Some(timeout_secs_to_ms(timeout_secs)),
        retry_count: None,
        fallback_mode: Some(fallback_mode),
    };

    let auto = automation_repo::create(pool, create_input)?;

    // Activate it immediately
    let update_input = UpdateAutomationInput {
        deployment_status: Some(crate::engine::lifecycle::AutomationDeployStatus::Active),
        name: None,
        description: None,
        use_case_id: None,
        platform_workflow_id: None,
        platform_url: None,
        webhook_url: None,
        webhook_method: None,
        platform_credential_id: None,
        credential_mapping: None,
        input_schema: None,
        output_schema: None,
        timeout_ms: None,
        retry_count: None,
        fallback_mode: None,
        error_message: None,
    };

    automation_repo::update(pool, &auto.id, update_input)
}

/// Create an automation and mark it with Error status + error message
/// (used when the workflow was created on the platform but activation failed).
#[allow(clippy::too_many_arguments)]
fn create_with_error(
    pool: &DbPool,
    persona_id: &str,
    name: &str,
    description: &str,
    platform: AutomationPlatform,
    platform_workflow_id: Option<&str>,
    platform_url: Option<&str>,
    webhook_url: Option<&str>,
    credential_id: Option<&str>,
    credential_mapping: Option<&str>,
    input_schema: Option<&str>,
    output_schema: Option<&str>,
    timeout_secs: i64,
    fallback_mode: AutomationFallbackMode,
    use_case_id: Option<&str>,
    error_msg: &str,
) -> Result<PersonaAutomation, AppError> {
    let create_input = CreateAutomationInput {
        persona_id: persona_id.into(),
        use_case_id: use_case_id.map(|s| s.into()),
        name: name.into(),
        description: Some(description.into()),
        platform,
        platform_workflow_id: platform_workflow_id.map(|s| s.into()),
        platform_url: platform_url.map(|s| s.into()),
        webhook_url: webhook_url.map(|s| s.into()),
        webhook_method: None,
        platform_credential_id: credential_id.map(|s| s.into()),
        credential_mapping: credential_mapping.map(|s| s.into()),
        input_schema: input_schema.map(|s| s.into()),
        output_schema: output_schema.map(|s| s.into()),
        timeout_ms: Some(timeout_secs_to_ms(timeout_secs)),
        retry_count: None,
        fallback_mode: Some(fallback_mode),
    };

    let auto = automation_repo::create(pool, create_input)?;

    // Mark as Error with the activation failure message
    let update_input = UpdateAutomationInput {
        deployment_status: Some(crate::engine::lifecycle::AutomationDeployStatus::Error),
        name: None,
        description: None,
        use_case_id: None,
        platform_workflow_id: None,
        platform_url: None,
        webhook_url: None,
        webhook_method: None,
        platform_credential_id: None,
        credential_mapping: None,
        input_schema: None,
        output_schema: None,
        timeout_ms: None,
        retry_count: None,
        fallback_mode: None,
        error_message: Some(Some(error_msg.into())),
    };

    automation_repo::update(pool, &auto.id, update_input)
}

/// Generate a URL-safe slug from a name.
fn slug(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}
