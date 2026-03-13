use std::collections::HashMap;
use std::time::Instant;

use crate::db::models::{AutomationRun, PersonaAutomation};
use crate::db::repos::resources::automations as repo;
use crate::db::repos::resources::credentials as cred_repo;
use crate::db::repos::resources::tool_audit_log;
use crate::db::DbPool;
use crate::error::AppError;

/// Invoke an automation by calling its webhook URL.
///
/// Creates an `AutomationRun` record, POSTs to the webhook, captures the
/// response, and updates the run record with the result.
pub async fn invoke_automation(
    pool: &DbPool,
    automation: &PersonaAutomation,
    input_json: Option<&str>,
    execution_id: Option<&str>,
) -> Result<AutomationRun, AppError> {
    // GitHub Actions uses repository dispatch instead of webhook
    if automation.platform == "github_actions" {
        return invoke_github_dispatch(pool, automation, input_json, execution_id).await;
    }

    let webhook_url = automation.webhook_url.as_deref().ok_or_else(|| {
        AppError::Validation(format!(
            "Automation '{}' has no webhook URL configured",
            automation.name
        ))
    })?;

    // SSRF protection: reject private/internal/metadata URLs
    crate::engine::url_safety::validate_url_safety(webhook_url).map_err(|reason| {
        AppError::Validation(format!(
            "Automation '{}' webhook URL blocked: {}",
            automation.name, reason
        ))
    })?;

    // Resolve auth headers BEFORE creating the run record to prevent
    // orphaned runs stuck in initial status when auth resolution fails.
    let auth_headers = resolve_auth_headers(pool, automation).await?;

    // Create run record (only after auth succeeds)
    let run = repo::create_run(pool, &automation.id, execution_id, input_json)?;

    let start = Instant::now();

    // Execute the webhook (auth_headers already resolved above)
    let method = automation.webhook_method.as_str();
    let body = input_json.unwrap_or("{}");
    let timeout_ms = automation.timeout_ms;

    let result = invoke_webhook(webhook_url, method, body, &auth_headers, timeout_ms).await;

    let duration_ms = start.elapsed().as_millis() as i64;

    let completed_run = match result {
        Ok((output, _status_code)) => {
            let completed_run = repo::complete_run(
                pool,
                &run.id,
                "completed",
                Some(&output),
                Some(duration_ms),
                None,
                automation.platform_url.as_deref(),
                None,
            )?;

            // Update automation's last trigger status
            let _ = repo::record_trigger_result(pool, &automation.id, "success", None);

            completed_run
        }
        Err(e) => {
            let error_msg = e.to_string();
            let completed_run = repo::complete_run(
                pool,
                &run.id,
                "failed",
                None,
                Some(duration_ms),
                None,
                None,
                Some(&error_msg),
            )?;

            let _ = repo::record_trigger_result(pool, &automation.id, "failed", Some(&error_msg));

            completed_run
        }
    };

    // Structured audit logging (best-effort)
    let (status, err_msg) = if completed_run.status == "completed" {
        ("success", None)
    } else {
        ("error", completed_run.error_message.as_deref())
    };
    if let Err(log_err) = tool_audit_log::insert(
        pool,
        &automation.id,
        &automation.name,
        "automation",
        None, // persona_id not available at this layer
        None,
        automation.platform_credential_id.as_deref(),
        status,
        Some(duration_ms as u64),
        err_msg,
    ) {
        tracing::warn!("Failed to write automation audit log: {log_err}");
    }

    Ok(completed_run)
}

/// Check if a header name is valid per RFC 7230 (token: alphanumeric + subset of symbols).
fn is_valid_header_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
}

/// Strip control characters (CR, LF, NUL) from header values to prevent injection.
fn sanitize_header_value(value: &str) -> String {
    value.chars().filter(|c| !c.is_control()).collect()
}

/// Resolve authentication headers from the automation's platform credential.
async fn resolve_auth_headers(
    pool: &DbPool,
    automation: &PersonaAutomation,
) -> Result<HashMap<String, String>, AppError> {
    let mut headers = HashMap::new();

    let cred_id = match automation.platform_credential_id.as_deref() {
        Some(id) if !id.is_empty() => id,
        _ => return Ok(headers),
    };

    // Load credential record, then decrypt fields.
    // Fall back to empty headers if credential is missing (e.g., public webhooks with stale ref).
    let credential = match cred_repo::get_by_id(pool, cred_id) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(
                automation = %automation.name,
                credential_id = %cred_id,
                error = %e,
                "Credential not found, proceeding without auth headers"
            );
            return Ok(headers);
        }
    };
    let fields = match cred_repo::get_decrypted_fields(pool, &credential) {
        Ok(f) => f,
        Err(e) => {
            tracing::warn!(
                automation = %automation.name,
                credential_id = %cred_id,
                error = %e,
                "Failed to decrypt credential, proceeding without auth headers"
            );
            return Ok(headers);
        }
    };

    // Common patterns for webhook auth
    if let Some(token) = fields.get("api_key").or(fields.get("access_token")).or(fields.get("token")) {
        headers.insert("Authorization".into(), sanitize_header_value(&format!("Bearer {token}")));
    }
    if let Some(header_name) = fields.get("header_name") {
        if let Some(header_value) = fields.get("header_value") {
            if !is_valid_header_name(header_name) {
                tracing::warn!(
                    automation = %automation.name,
                    header_name = %header_name,
                    "Skipping custom header with invalid name"
                );
            } else {
                headers.insert(header_name.clone(), sanitize_header_value(header_value));
            }
        }
    }

    Ok(headers)
}

/// POST/GET to a webhook URL and return the response body.
async fn invoke_webhook(
    url: &str,
    method: &str,
    body: &str,
    auth_headers: &HashMap<String, String>,
    timeout_ms: i64,
) -> Result<(String, u16), AppError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms.max(1000) as u64))
        .build()
        .map_err(|e| AppError::Execution(format!("Failed to create HTTP client: {e}")))?;

    let req_method = match method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        _ => reqwest::Method::POST,
    };

    let mut req = client.request(req_method, url);

    // Set content-type for body methods
    if method != "GET" {
        req = req.header("Content-Type", "application/json").body(body.to_string());
    }

    // Add auth headers
    for (key, value) in auth_headers {
        req = req.header(key, value);
    }

    let resp = req.send().await.map_err(|e| {
        if e.is_timeout() {
            AppError::Execution(format!("Webhook timed out after {timeout_ms}ms: {url}"))
        } else if e.is_connect() {
            AppError::Execution(format!("Failed to connect to webhook: {url}"))
        } else {
            AppError::Execution(format!("Webhook request failed: {e}"))
        }
    })?;

    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| {
        AppError::Execution(format!("Failed to read webhook response: {e}"))
    })?;

    if status >= 400 {
        return Err(AppError::Execution(format!(
            "Webhook returned HTTP {}: {}",
            status,
            body.chars().take(500).collect::<String>()
        )));
    }

    Ok((body, status))
}

/// Convert an automation into a virtual `PersonaToolDefinition` for LLM consumption.
///
/// The LLM sees this as a regular tool it can call. The tool_runner routes
/// invocations back to `invoke_automation` via the "automation" category marker.
pub fn automation_to_virtual_tool(
    auto: &PersonaAutomation,
) -> crate::db::models::PersonaToolDefinition {
    let platform_label = match auto.platform.as_str() {
        "n8n" => "n8n",
        "github_actions" => "GitHub Actions",
        "zapier" => "Zapier",
        _ => "External Workflow",
    };

    let description = format!(
        "{} [Automation -- {}. Runs instantly without using your tokens.]",
        auto.description, platform_label
    );

    let fallback_note = if auto.fallback_mode == "connector" {
        "\nNote: If this automation fails, fall back to using the agent's direct connectors instead."
    } else {
        ""
    };

    let guide = format!(
        "This tool delegates to an external {platform_label} workflow.\n\
         It will be invoked automatically -- do NOT construct HTTP requests yourself.\n\
         Simply call this tool with the expected input JSON.{fallback_note}"
    );

    crate::db::models::PersonaToolDefinition {
        id: format!("auto_{}", auto.id),
        name: auto.name.clone(),
        category: "automation".into(),
        description,
        script_path: String::new(),
        input_schema: auto.input_schema.clone(),
        output_schema: auto.output_schema.clone(),
        requires_credential_type: None,
        implementation_guide: Some(guide),
        is_builtin: false,
        created_at: auto.created_at.clone(),
        updated_at: auto.updated_at.clone(),
    }
}

/// Invoke a GitHub Actions automation via repository dispatch.
async fn invoke_github_dispatch(
    pool: &DbPool,
    automation: &PersonaAutomation,
    input_json: Option<&str>,
    execution_id: Option<&str>,
) -> Result<AutomationRun, AppError> {
    // Parse dispatch metadata from credential_mapping
    let mapping: serde_json::Value = automation
        .credential_mapping
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    let event_type = mapping["event_type"]
        .as_str()
        .ok_or_else(|| {
            AppError::Validation(format!(
                "Automation '{}' missing dispatch event_type in credential_mapping",
                automation.name
            ))
        })?;

    let repo = mapping["repo"]
        .as_str()
        .ok_or_else(|| {
            AppError::Validation(format!(
                "Automation '{}' missing repo in credential_mapping",
                automation.name
            ))
        })?;

    let parts: Vec<&str> = repo.splitn(2, '/').collect();
    if parts.len() != 2 {
        return Err(AppError::Validation(format!(
            "Invalid repo format '{repo}'. Expected 'owner/repo'."
        )));
    }
    let (owner, repo_name) = (parts[0], parts[1]);

    let cred_id = automation.platform_credential_id.as_deref().ok_or_else(|| {
        AppError::Validation(format!(
            "Automation '{}' has no platform credential configured",
            automation.name
        ))
    })?;

    // Create run record
    let run = repo::create_run(pool, &automation.id, execution_id, input_json)?;
    let start = Instant::now();

    // Build client and dispatch
    let client = crate::engine::platforms::github::build_client_from_credential(pool, cred_id)?;
    let payload: serde_json::Value = input_json
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(serde_json::json!({}));

    let result = client
        .create_repository_dispatch(owner, repo_name, event_type, &payload)
        .await;

    let duration_ms = start.elapsed().as_millis() as i64;

    match result {
        Ok(()) => {
            let completed_run = repo::complete_run(
                pool,
                &run.id,
                "completed",
                Some(&serde_json::json!({"dispatched": true, "event_type": event_type}).to_string()),
                Some(duration_ms),
                None,
                Some(&format!("https://github.com/{repo}/actions")),
                None,
            )?;
            let _ = repo::record_trigger_result(pool, &automation.id, "success", None);
            Ok(completed_run)
        }
        Err(e) => {
            let error_msg = e.to_string();
            let completed_run = repo::complete_run(
                pool,
                &run.id,
                "failed",
                None,
                Some(duration_ms),
                None,
                None,
                Some(&error_msg),
            )?;
            let _ = repo::record_trigger_result(pool, &automation.id, "failed", Some(&error_msg));
            Ok(completed_run)
        }
    }
}
