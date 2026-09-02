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
    // NOTE: kept as a `//` comment, not a doc comment. ts-rs copies a `///` on
    // this field straight into `src/lib/bindings/DeployAutomationResult.ts`, so
    // editing the doc alone dirties a generated file for no type change.
    //
    // The contract is wider than the line below says: TWO shapes use this field.
    // (1) The workflow was created on the platform but activation failed (n8n).
    // (2) The platform side was never touched at all and the user has manual
    //     work left to do (GitHub Actions -- see `github_manual_setup_warning`).
    // `AutomationReviewStep.tsx` branches on it being non-null, rendering the
    // amber headline + caveat box instead of the green "deployed" one -- which
    // is the only lever this backend has to stop the UI asserting a remote state
    // nothing confirmed.
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

fn default_timeout() -> i64 {
    30
}
fn default_fallback() -> AutomationFallbackMode {
    AutomationFallbackMode::Connector
}

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
    let design: DesignResult = serde_json::from_value(input.design_result.clone())
        .map_err(|e| AppError::Validation(format!("Invalid design result: {e}")))?;

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
    let fields = crate::db::repos::resources::credentials::get_decrypted_fields(pool, &cred)?;
    if let Err(e) = crate::db::repos::resources::audit_log::log_decrypt(
        pool,
        &cred.id,
        &cred.name,
        "platform:deploy",
        None,
        None,
    ) {
        tracing::warn!(credential_id = %cred.id, error = %e, "Failed to write audit log for credential decrypt");
    }
    let base_url = fields.get("base_url").cloned().unwrap_or_default();

    let platform_url = if base_url.is_empty() {
        None
    } else {
        Some(format!(
            "{}/workflow/{}",
            base_url.trim_end_matches('/'),
            workflow_id
        ))
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
        // `persona_triggers` has no `name` column — verified against the live
        // PRAGMA and against every `ALTER TABLE persona_triggers` in the tree.
        // This INSERT named one anyway and `?`-propagated the error, so GitHub
        // deploy failed 100% of the time. The compiler cannot see it: the
        // column name is a word inside a string literal.
        "INSERT INTO persona_triggers
         (id, persona_id, trigger_type, config, enabled, created_at, updated_at)
         VALUES (?1, ?2, 'webhook', ?3, 1, ?4, ?4)",
        rusqlite::params![
            trigger_id,
            input.persona_id,
            trigger_config.to_string(),
            now,
        ],
    )?;

    // The local webhook bridge address for this trigger. It is NOT handed to
    // GitHub and is NOT stored as the automation's `webhook_url`: the bridge
    // binds `127.0.0.1` (`engine::webhook::start_webhook_server`), so nothing
    // outside this machine -- GitHub's dispatcher least of all -- can reach it.
    // The port is read rather than hardcoded, because `PERSONAS_WEBHOOK_PORT`
    // moves it whenever a second instance runs on the same device.
    let local_bridge_url = format!(
        "http://127.0.0.1:{}/webhook/{trigger_id}",
        crate::engine::webhook::webhook_port()
    );

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
        // No `webhook_url`: GitHub is never given a callback target by this
        // path, and `automation_runner::invoke_github_dispatch` reads only
        // `credential_mapping`, so storing the unreachable localhost URL here
        // only ever misled a reader.
        None,
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
        webhook_url: None,
        deployment_message: github_deployment_message(
            repo_full,
            &event_type,
            &design.name,
            &local_bridge_url,
        ),
        activation_warning: Some(github_manual_setup_warning(repo_full)),
    })
}

/// What the GitHub Actions path actually accomplished, and what the user still
/// has to do. Pure so it can be asserted on without a network or a token.
///
/// # Why this reads like the Custom path
///
/// Until 2026-09-02 this said *"GitHub Actions integration configured for
/// {repo}. Dispatch event type: '{t}'. Local webhook endpoint ready at port
/// 9420."* Every clause of that was either unearned or wrong:
///
///   * **"integration configured"** on the repo side: nothing was created,
///     pushed or verified in the repository. The deploy checks token scopes,
///     writes one local `persona_triggers` row and one local `automations` row.
///     A repo with no workflow listening for the dispatch is indistinguishable
///     from one that works, and the user was told it was done.
///   * **"Local webhook endpoint ready"**: nothing ever checked that the bridge
///     was listening. The claim was asserted, never confirmed.
///   * The `webhook_url` handed back was `http://localhost:9420/webhook/{id}`,
///     presented beside GitHub as if it were the callback GitHub would call.
///     The bridge binds `127.0.0.1`; GitHub cannot reach it, and this app has
///     no public-ingress or tunnel concept (grepped: none).
///
/// What IS real, and is what the message now claims: the outbound half. The
/// automation is active and `automation_runner::invoke_github_dispatch` will
/// POST a `repository_dispatch` of `event_type` to the repo using the stored
/// credential. That half needs a workflow in the repo that listens for it,
/// which only the user can add -- exactly the shape the Custom path already
/// states plainly ("saved as draft, complete the setup manually").
///
/// **Creating and verifying a real workflow file on GitHub is a separate,
/// larger direction and is deliberately NOT built here.** It needs a contents
/// write to a branch, a commit, and a read-back that confirms the workflow
/// parsed and registered -- a different failure surface (branch protection,
/// existing file conflicts, default-branch detection) than a message fix.
fn github_deployment_message(
    repo_full: &str,
    event_type: &str,
    name: &str,
    local_bridge_url: &str,
) -> String {
    format!(
        "'{name}' is configured locally to send a GitHub 'repository_dispatch' of type '{event_type}' to {repo_full}. Nothing was created in the repository. To make it do something, add a workflow to {repo_full} with 'on: repository_dispatch: types: [{event_type}]'. A local-only callback endpoint was also registered at {local_bridge_url} - it is bound to this machine and is NOT reachable from GitHub."
    )
}

/// The caveat shown beside the deploy result. Its presence is what flips the
/// review step from the green "deployed" headline to the amber one, so the UI
/// stops asserting a remote state that was never confirmed.
fn github_manual_setup_warning(repo_full: &str) -> String {
    format!(
        "No workflow file was created or verified in {repo_full}. Until you add one that listens for this dispatch, the automation will send events that nothing receives."
    )
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

// =============================================================================
// Tests -- the deploy dispatcher (honest-deployment-contract)
// =============================================================================
//
// First tests in `engine/platforms/` (1,343 lines, zero coverage before
// 2026-09-02). Scope is deliberately what is reachable WITHOUT a network: the
// three platform clients each own a concrete `reqwest::Client` with no
// injection point and there is no HTTP-mock dev-dependency in the workspace, so
// asserting on a live n8n/GitHub call would need a client refactor well beyond
// this change. The gap is recorded in the module docs rather than papered over
// with a test that proves nothing.

#[cfg(test)]
mod tests {
    use super::*;
    use personas_db::init_test_db;

    const REPO: &str = "acme/reports";
    const EVENT: &str = "personas-daily-digest";

    fn github_message() -> String {
        github_deployment_message(
            REPO,
            EVENT,
            "Daily Digest",
            "http://127.0.0.1:9420/webhook/abc-123",
        )
    }

    #[test]
    fn the_github_message_never_claims_a_remote_deployment() {
        let msg = github_message().to_lowercase();
        for claim in [
            "deployed",
            "integration configured for",
            "endpoint ready",
            "workflow created",
            "active on github",
        ] {
            assert!(
                !msg.contains(claim),
                "the GitHub message must not claim '{claim}': {msg}"
            );
        }
    }

    #[test]
    fn the_github_message_states_what_the_user_must_do_and_where() {
        let msg = github_message();
        assert!(msg.contains(REPO), "names the repository: {msg}");
        assert!(msg.contains(EVENT), "names the dispatch event type: {msg}");
        assert!(
            msg.contains("Nothing was created in the repository"),
            "states that the repo side was not touched: {msg}"
        );
        assert!(
            msg.contains("on: repository_dispatch: types: ["),
            "states the concrete workflow trigger to add: {msg}"
        );
    }

    #[test]
    fn the_localhost_url_is_never_presented_as_githubs_target() {
        let msg = github_message();
        assert!(
            msg.contains("NOT reachable from GitHub"),
            "the local bridge address must carry its reachability caveat: {msg}"
        );
        // And it is labelled local-only rather than sitting bare beside GitHub.
        assert!(msg.contains("local-only callback endpoint"), "{msg}");
    }

    #[test]
    fn the_manual_setup_warning_is_present_so_the_ui_stops_showing_a_green_tick() {
        // `AutomationReviewStep.tsx` branches on `activationWarning` being
        // non-null; this is the whole mechanism.
        let warning = github_manual_setup_warning(REPO);
        assert!(warning.contains(REPO));
        assert!(
            warning.contains("No workflow file was created or verified"),
            "{warning}"
        );
    }

    #[tokio::test]
    async fn github_without_a_repository_is_rejected_before_anything_is_written() {
        let pool = init_test_db().unwrap();
        let input = DeployAutomationInput {
            persona_id: "p-1".into(),
            credential_id: "c-1".into(),
            design_result: serde_json::json!({
                "name": "Daily Digest",
                "platform": "github_actions",
            }),
            github_repo: None,
            use_case_id: None,
        };
        let err = deploy_automation(&pool, input).await.unwrap_err();
        assert!(
            matches!(err, AppError::Validation(ref m) if m.contains("GitHub repository is required")),
            "expected a Validation error naming the missing repo, got: {err:?}"
        );
    }

    #[tokio::test]
    async fn the_n8n_error_path_is_preserved_when_its_credential_is_missing() {
        // The n8n leg resolves its credential BEFORE any HTTP call and before
        // any DB write, so a missing credential must fail cleanly and leave no
        // automation row behind. This is the n8n failure the dispatcher can be
        // held to without a mockable client.
        let pool = init_test_db().unwrap();
        let input = DeployAutomationInput {
            persona_id: "p-1".into(),
            credential_id: "does-not-exist".into(),
            design_result: serde_json::json!({
                "name": "Nightly Sync",
                "platform": "n8n",
            }),
            github_repo: None,
            use_case_id: None,
        };
        assert!(
            deploy_automation(&pool, input).await.is_err(),
            "a missing n8n credential must surface as an error, not a success"
        );
    }

    #[test]
    fn a_malformed_design_result_is_a_validation_error_not_a_panic() {
        let err = serde_json::from_value::<DesignResult>(serde_json::json!({
            "platform": "n8n"
        }))
        .unwrap_err();
        assert!(err.to_string().contains("name"), "{err}");
    }

    #[test]
    fn owner_repo_parsing_rejects_what_would_reach_a_different_endpoint() {
        assert_eq!(
            parse_owner_repo("acme/reports").unwrap(),
            ("acme", "reports")
        );
        for bad in ["acme", "/reports", "acme/", ""] {
            assert!(
                parse_owner_repo(bad).is_err(),
                "'{bad}' must not parse as owner/repo"
            );
        }
    }

    #[test]
    fn timeouts_are_clamped_before_they_reach_the_database() {
        assert_eq!(timeout_secs_to_ms(30), 30_000);
        assert_eq!(timeout_secs_to_ms(0), 1_000);
        assert_eq!(timeout_secs_to_ms(-5), 1_000);
        assert_eq!(timeout_secs_to_ms(999_999), 3_600_000);
    }
}
