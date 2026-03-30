use std::collections::HashMap;
use std::time::Instant;

use crate::db::models::{
    AutomationFallbackMode, AutomationPlatform, AutomationRun, AutomationRunStatus,
    PersonaAutomation,
};
use crate::db::repos::resources::audit_log;
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
    if automation.platform == AutomationPlatform::GithubActions {
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
    let auth_resolution = resolve_auth_headers(pool, automation).await?;
    let mut warnings = auth_resolution.warnings;

    // Create run record (only after auth succeeds)
    let run = repo::create_run(pool, &automation.id, execution_id, input_json)?;

    let start = Instant::now();

    // Execute the webhook with retries for transient failures
    let method = automation.webhook_method.as_str();
    let body = input_json.unwrap_or("{}");
    let timeout_ms = automation.timeout_ms;
    let max_attempts = (automation.retry_count.max(1)) as u32;

    let mut result = invoke_webhook(webhook_url, method, body, &auth_resolution.headers, timeout_ms).await;

    // Retry on transient errors with exponential backoff
    if max_attempts > 1 {
        let mut attempt = 1u32;
        while attempt < max_attempts && is_retryable_error(&result) {
            let backoff = std::time::Duration::from_millis(1000 * 2u64.pow(attempt - 1));
            tracing::info!(
                automation = %automation.name,
                attempt = attempt + 1,
                max_attempts = max_attempts,
                backoff_ms = backoff.as_millis() as u64,
                "Retrying webhook after transient failure"
            );
            tokio::time::sleep(backoff).await;
            result = invoke_webhook(webhook_url, method, body, &auth_resolution.headers, timeout_ms).await;
            attempt += 1;
        }
        if attempt > 1 {
            if result.is_ok() {
                warnings.push(format!("Succeeded on attempt {attempt}/{max_attempts}"));
            } else {
                warnings.push(format!("Failed after {attempt}/{max_attempts} attempts"));
            }
        }
    }

    let duration_ms = start.elapsed().as_millis() as i64;

    // Collect webhook-level warnings (e.g. method fallback)
    if let Ok((_, _, ref webhook_warnings)) = result {
        warnings.extend(webhook_warnings.iter().cloned());
    }

    let completed_run = finalize_run(
        pool,
        &run.id,
        &automation.id,
        result
            .map(|(output, _status, _warnings)| (output, automation.platform_url.clone()))
            .map_err(|e| e.to_string()),
        duration_ms,
        &warnings,
    )?;

    // Structured audit logging (best-effort)
    let (status, err_msg) = if completed_run.status == AutomationRunStatus::Completed {
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

/// Result of resolving auth headers: the headers themselves plus any warnings
/// that should be surfaced to the user in the run record.
struct AuthResolution {
    headers: HashMap<String, String>,
    warnings: Vec<String>,
}

/// Resolve authentication headers from the automation's platform credential.
///
/// Returns headers alongside user-visible warnings when credentials are
/// missing or cannot be decrypted (instead of silently proceeding).
async fn resolve_auth_headers(
    pool: &DbPool,
    automation: &PersonaAutomation,
) -> Result<AuthResolution, AppError> {
    let mut headers = HashMap::new();
    let mut warnings = Vec::new();

    let cred_id = match automation.platform_credential_id.as_deref() {
        Some(id) if !id.is_empty() => id,
        _ => return Ok(AuthResolution { headers, warnings }),
    };

    // Load credential record, then decrypt fields.
    // If the automation explicitly references a credential, it MUST resolve —
    // proceeding without auth would send unauthenticated requests and produce
    // misleading 401 errors that hide the real cause (missing/corrupt credential).
    let credential = cred_repo::get_by_id(pool, cred_id).map_err(|e| {
        tracing::error!(
            automation = %automation.name,
            credential_id = %cred_id,
            error = %e,
            "Credential not found — aborting automation to prevent unauthenticated request"
        );
        AppError::Validation(format!(
            "Automation '{}' references credential '{cred_id}' which could not be found. \
             Remove the credential reference or restore the credential. Error: {e}",
            automation.name
        ))
    })?;
    let fields = cred_repo::get_decrypted_fields(pool, &credential).map_err(|e| {
        tracing::error!(
            automation = %automation.name,
            credential_id = %cred_id,
            error = %e,
            "Failed to decrypt credential — aborting automation to prevent unauthenticated request"
        );
        AppError::Validation(format!(
            "Automation '{}' failed to decrypt credential '{}' ({cred_id}). \
             The credential may be corrupted — try re-saving it. Error: {e}",
            automation.name, credential.name
        ))
    })?;

    let _ = audit_log::log_decrypt(
        pool, cred_id, &credential.name,
        &format!("automation_runner:{}", automation.name),
        None, None,
    );

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
                warnings.push(format!(
                    "Skipped custom auth header with invalid name '{header_name}'"
                ));
            } else {
                headers.insert(header_name.clone(), sanitize_header_value(header_value));
            }
        }
    }

    Ok(AuthResolution { headers, warnings })
}

/// Finalize an automation run by recording the result in the run record and
/// updating the automation's last trigger status.
///
/// On success, `output` and `platform_url` are written to the run.
/// On failure, the error message is recorded instead.
/// Any collected `warnings` are serialized as a JSON array into the run record.
fn finalize_run(
    pool: &DbPool,
    run_id: &str,
    automation_id: &str,
    result: Result<(String, Option<String>), String>,
    duration_ms: i64,
    warnings: &[String],
) -> Result<AutomationRun, AppError> {
    let warnings_json = if warnings.is_empty() {
        None
    } else {
        Some(serde_json::to_string(warnings).unwrap_or_default())
    };

    match result {
        Ok((output, platform_url)) => {
            let completed = repo::complete_run(
                pool,
                run_id,
                AutomationRunStatus::Completed,
                Some(&output),
                Some(duration_ms),
                None,
                platform_url.as_deref(),
                None,
                warnings_json.as_deref(),
            )?;
            let _ = repo::record_trigger_result(pool, automation_id, "success", None);
            Ok(completed)
        }
        Err(error_msg) => {
            let completed = repo::complete_run(
                pool,
                run_id,
                AutomationRunStatus::Failed,
                None,
                Some(duration_ms),
                None,
                None,
                Some(&error_msg),
                warnings_json.as_deref(),
            )?;
            let _ = repo::record_trigger_result(pool, automation_id, "failed", Some(&error_msg));
            Ok(completed)
        }
    }
}

/// Check if a webhook error is transient and worth retrying.
///
/// Retryable: timeouts, connection failures, 5xx server errors.
/// Non-retryable: 4xx client errors, response too large, validation errors.
fn is_retryable_error(result: &Result<(String, u16, Vec<String>), AppError>) -> bool {
    match result {
        Ok(_) => false,
        Err(AppError::Execution(msg)) => {
            msg.contains("timed out")
                || msg.contains("Failed to connect")
                || msg.contains("HTTP 5")
        }
        _ => false,
    }
}

/// POST/GET to a webhook URL and return (response_body, status, warnings).
async fn invoke_webhook(
    url: &str,
    method: &str,
    body: &str,
    auth_headers: &HashMap<String, String>,
    timeout_ms: i64,
) -> Result<(String, u16, Vec<String>), AppError> {
    let mut warnings = Vec::new();
    let upper = method.to_uppercase();
    let req_method = match upper.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        other => {
            tracing::warn!(
                requested_method = %other,
                "Unrecognized HTTP method, defaulting to POST"
            );
            warnings.push(format!(
                "Method fallback: unrecognized HTTP method '{other}' defaulted to POST"
            ));
            reqwest::Method::POST
        }
    };

    let mut req = crate::SSRF_SAFE_HTTP
        .request(req_method, url)
        .timeout(std::time::Duration::from_millis(timeout_ms.max(1000) as u64));

    // Set content-type for body methods
    if upper != "GET" {
        req = req.header("Content-Type", "application/json").body(body.to_string());
    }

    // Add auth headers
    for (key, value) in auth_headers {
        req = req.header(key, value);
    }

    let mut resp = req.send().await.map_err(|e| {
        if e.is_timeout() {
            AppError::Execution(format!("Webhook timed out after {timeout_ms}ms: {url}"))
        } else if e.is_connect() {
            AppError::Execution(format!("Failed to connect to webhook: {url}"))
        } else {
            AppError::Execution(format!("Webhook request failed: {e}"))
        }
    })?;

    let status = resp.status().as_u16();

    // Limit response body to 10 MB to prevent OOM from oversized responses.
    const MAX_RESPONSE_BODY_BYTES: usize = 10 * 1024 * 1024;
    let mut body_buf = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| AppError::Execution(format!("Failed to read webhook response: {e}")))?
    {
        if body_buf.len() + chunk.len() > MAX_RESPONSE_BODY_BYTES {
            return Err(AppError::Execution(format!(
                "Webhook response exceeded {MAX_RESPONSE_BODY_BYTES} byte limit: {url}"
            )));
        }
        body_buf.extend_from_slice(&chunk);
    }
    let body = String::from_utf8_lossy(&body_buf).to_string();

    if status >= 400 {
        return Err(AppError::Execution(format!(
            "Webhook returned HTTP {}: {}",
            status,
            body.chars().take(500).collect::<String>()
        )));
    }

    Ok((body, status, warnings))
}

/// Convert an automation into a virtual `PersonaToolDefinition` for LLM consumption.
///
/// The LLM sees this as a regular tool it can call. The tool_runner routes
/// invocations back to `invoke_automation` via the "automation" category marker.
pub fn automation_to_virtual_tool(
    auto: &PersonaAutomation,
) -> crate::db::models::PersonaToolDefinition {
    let platform_label = auto.platform.label();

    let description = format!(
        "{} [Automation -- {}. Runs instantly without using your tokens.]",
        auto.description, platform_label
    );

    let fallback_note = if auto.fallback_mode == AutomationFallbackMode::Connector {
        "\nNote: If this automation fails, fall back to using the agent's direct connectors instead."
    } else {
        ""
    };

    let guide = format!(
        "This tool delegates to an external {platform_label} workflow.\n\
         It will be invoked automatically -- do NOT construct HTTP requests yourself.\n\
         Simply call this tool with the expected input JSON.{fallback_note}"
    );

    let vtid = crate::db::models::VirtualToolId::new(&auto.id);
    crate::db::models::PersonaToolDefinition {
        id: vtid.into_string(),
        name: auto.name.clone(),
        category: crate::db::models::VirtualToolId::CATEGORY.into(),
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

    // Resolve credential BEFORE creating the run record to prevent
    // orphaned runs stuck in running status when credential resolution fails.
    let client = crate::engine::platforms::github::build_client_from_credential(pool, cred_id)?;

    // Create run record (only after credential succeeds)
    let run = repo::create_run(pool, &automation.id, execution_id, input_json)?;
    let start = Instant::now();
    let payload: serde_json::Value = input_json
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(serde_json::json!({}));

    let result = client
        .create_repository_dispatch(owner, repo_name, event_type, &payload)
        .await;

    let duration_ms = start.elapsed().as_millis() as i64;

    finalize_run(
        pool,
        &run.id,
        &automation.id,
        result.map(|()| (
            serde_json::json!({"dispatched": true, "event_type": event_type}).to_string(),
            Some(format!("https://github.com/{repo}/actions")),
        )).map_err(|e| e.to_string()),
        duration_ms,
        &[], // GitHub dispatch has no auth fallback path
    )
}
