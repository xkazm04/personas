use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::json;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::io::{AsyncReadExt};
use tokio::process::Command;
use tokio::net::TcpListener;
use url::Url;

use crate::db::repos::connectors as connector_repo;
use crate::engine::credential_design;
use crate::engine::parser::parse_stream_line;
use crate::engine::types::StreamLineType;
use crate::engine::prompt;
use crate::error::AppError;
use crate::AppState;

const CREDENTIAL_TASK_MODEL: &str = "claude-sonnet-4-6";
const GOOGLE_OAUTH_SESSION_TTL_SECS: u64 = 10 * 60;

#[derive(Clone, Serialize)]
struct GoogleCredentialOAuthSession {
    status: String,
    refresh_token: Option<String>,
    access_token: Option<String>,
    scope: Option<String>,
    error: Option<String>,
    created_at: u64,
}

static GOOGLE_CREDENTIAL_OAUTH_SESSIONS: OnceLock<Mutex<HashMap<String, GoogleCredentialOAuthSession>>> = OnceLock::new();

fn google_oauth_sessions() -> &'static Mutex<HashMap<String, GoogleCredentialOAuthSession>> {
    GOOGLE_CREDENTIAL_OAUTH_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn cleanup_google_oauth_sessions() {
    let now = now_unix_secs();
    let mut sessions = google_oauth_sessions().lock().unwrap();
    sessions.retain(|_, session| now.saturating_sub(session.created_at) <= GOOGLE_OAUTH_SESSION_TTL_SECS);
}

// ── Event payloads ──────────────────────────────────────────────

#[derive(Clone, Serialize)]
struct CredentialDesignOutputEvent {
    design_id: String,
    line: String,
}

#[derive(Clone, Serialize)]
struct CredentialDesignStatusEvent {
    design_id: String,
    status: String,
    result: Option<serde_json::Value>,
    error: Option<String>,
}

// ── Commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_credential_design(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    instruction: String,
) -> Result<serde_json::Value, AppError> {
    let connectors = connector_repo::get_all(&state.db)?;

    let design_prompt = credential_design::build_credential_design_prompt(
        &instruction,
        &connectors,
    );

    let cli_args = build_credential_cli_args();

    let design_id = uuid::Uuid::new_v4().to_string();
    let active_id = state.active_credential_design_id.clone();

    {
        let mut guard = active_id.lock().unwrap();
        *guard = Some(design_id.clone());
    }

    let design_id_clone = design_id.clone();

    tokio::spawn(async move {
        run_credential_design(CredentialDesignRunParams {
            app,
            design_id: design_id_clone,
            prompt_text: design_prompt,
            cli_args,
            active_design_id: active_id,
        })
        .await;
    });

    Ok(json!({ "design_id": design_id }))
}

#[tauri::command]
pub fn cancel_credential_design(
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    let mut guard = state.active_credential_design_id.lock().unwrap();
    *guard = None;
    Ok(())
}

#[tauri::command]
pub async fn test_credential_design_healthcheck(
    _state: State<'_, Arc<AppState>>,
    instruction: String,
    connector: serde_json::Value,
    field_values: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    let values_map: HashMap<String, String> = serde_json::from_value(field_values)
        .map_err(|e| AppError::Validation(format!("Invalid field values: {}", e)))?;

    let field_keys: Vec<String> = values_map.keys().cloned().collect();
    let prompt_text = credential_design::build_credential_healthcheck_prompt(
        &instruction,
        &connector,
        &field_keys,
    );

    let cli_args = build_credential_cli_args();
    let output_text = run_claude_prompt(prompt_text, &cli_args)
        .await
        .map_err(AppError::Internal)?;

    let config = credential_design::extract_healthcheck_config_result(&output_text)
        .ok_or_else(|| AppError::Internal("Failed to extract healthcheck config from Claude output".into()))?;

    if config
        .get("skip")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        let reason = config
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("No reliable test endpoint available");
        return Ok(json!({
            "success": false,
            "message": format!("Claude skipped automatic healthcheck: {}", reason),
            "healthcheck_config": config,
        }));
    }

    let endpoint = config
        .get("endpoint")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("Claude did not provide a valid healthcheck endpoint".into()))?;

    let method = config
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("GET")
        .to_uppercase();

    let expected_status = config
        .get("expected_status")
        .and_then(|v| v.as_u64())
        .map(|v| v as u16);

    let resolved_endpoint = resolve_template(endpoint, &values_map);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client error: {}", e)))?;

    let mut request = match method.as_str() {
        "POST" => client.post(&resolved_endpoint),
        "PUT" => client.put(&resolved_endpoint),
        "PATCH" => client.patch(&resolved_endpoint),
        _ => client.get(&resolved_endpoint),
    };

    if let Some(headers_obj) = config.get("headers").and_then(|v| v.as_object()) {
        for (key, val) in headers_obj {
            if let Some(raw) = val.as_str() {
                let resolved = resolve_template(raw, &values_map);
                request = request.header(key, resolved);
            }
        }
    }

    let response = request.send().await;

    match response {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let success = expected_status.map(|exp| exp == status).unwrap_or(resp.status().is_success());
            let message = if success {
                format!("Claude healthcheck passed (HTTP {})", status)
            } else if let Some(exp) = expected_status {
                format!("Claude healthcheck failed (HTTP {}, expected {})", status, exp)
            } else {
                format!("Claude healthcheck failed (HTTP {})", status)
            };

            Ok(json!({
                "success": success,
                "message": message,
                "healthcheck_config": config,
            }))
        }
        Err(e) => Ok(json!({
            "success": false,
            "message": format!("Claude healthcheck request failed: {}", e),
            "healthcheck_config": config,
        })),
    }
}

#[tauri::command]
pub async fn start_google_credential_oauth(
    _state: State<'_, Arc<AppState>>,
    client_id: String,
    client_secret: String,
    connector_name: String,
    extra_scopes: Option<Vec<String>>,
) -> Result<serde_json::Value, AppError> {
    let (resolved_client_id, resolved_client_secret, credential_source) =
        resolve_google_oauth_client_credentials(client_id, client_secret)?;

    cleanup_google_oauth_sessions();

    let session_id = format!("goauth_{}_{}", now_unix_secs(), uuid::Uuid::new_v4());

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| AppError::Internal(format!("Failed to start OAuth callback server: {}", e)))?;
    let port = listener
        .local_addr()
        .map_err(|e| AppError::Internal(format!("Failed to resolve callback port: {}", e)))?
        .port();

    {
        let mut sessions = google_oauth_sessions().lock().unwrap();
        sessions.insert(
            session_id.clone(),
            GoogleCredentialOAuthSession {
                status: "pending".into(),
                refresh_token: None,
                access_token: None,
                scope: None,
                error: None,
                created_at: now_unix_secs(),
            },
        );
    }

    let redirect_uri = format!("http://127.0.0.1:{}", port);

    let default_scopes = default_google_scopes_for_connector(&connector_name);
    let mut scopes = default_scopes;
    if let Some(extra) = extra_scopes {
        scopes.extend(extra.into_iter().filter(|s| !s.trim().is_empty()));
    }
    scopes.push("openid".into());
    scopes.push("https://www.googleapis.com/auth/userinfo.email".into());
    scopes.sort();
    scopes.dedup();

    let mut auth_url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth")
        .map_err(|e| AppError::Internal(format!("Failed to build auth URL: {}", e)))?;
    {
        let mut query = auth_url.query_pairs_mut();
        query.append_pair("client_id", resolved_client_id.trim());
        query.append_pair("redirect_uri", &redirect_uri);
        query.append_pair("response_type", "code");
        query.append_pair("scope", &scopes.join(" "));
        query.append_pair("access_type", "offline");
        query.append_pair("prompt", "consent");
    }

    let session_id_clone = session_id.clone();
    let client_id_clone = resolved_client_id.clone();
    let client_secret_clone = resolved_client_secret.clone();
    let redirect_uri_clone = redirect_uri.clone();

    tokio::spawn(async move {
        let accept_result = tokio::time::timeout(
            std::time::Duration::from_secs(GOOGLE_OAUTH_SESSION_TTL_SECS),
            listener.accept(),
        )
        .await;

        match accept_result {
            Ok(Ok((mut socket, _addr))) => {
                let mut buffer = [0_u8; 8192];
                let read_n = socket.read(&mut buffer).await.unwrap_or(0);
                let request_text = String::from_utf8_lossy(&buffer[..read_n]).to_string();
                let first_line = request_text.lines().next().unwrap_or("");
                let path_part = first_line
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("/");

                let parsed_url = Url::parse(&format!("http://127.0.0.1{}", path_part));
                let mut status = "error".to_string();
                let mut refresh_token = None;
                let mut access_token = None;
                let mut scope = None;
                let mut error = None;

                match parsed_url {
                    Ok(url) => {
                        let code = url.query_pairs().find_map(|(k, v)| (k == "code").then(|| v.into_owned()));
                        let oauth_error = url.query_pairs().find_map(|(k, v)| (k == "error").then(|| v.into_owned()));

                        if let Some(err) = oauth_error {
                            error = Some(format!("Google OAuth error: {}", err));
                        } else if let Some(code_value) = code {
                            match exchange_google_oauth_code_for_tokens(
                                &client_id_clone,
                                &client_secret_clone,
                                &code_value,
                                &redirect_uri_clone,
                            )
                            .await
                            {
                                Ok(tokens) => {
                                    status = "success".into();
                                    refresh_token = tokens.refresh_token;
                                    access_token = tokens.access_token;
                                    scope = tokens.scope;
                                    if refresh_token.is_none() {
                                        status = "error".into();
                                        error = Some("No refresh token returned by Google. Re-authorize with prompt=consent or revoke prior app access and retry.".into());
                                    }
                                }
                                Err(e) => {
                                    error = Some(e);
                                }
                            }
                        } else {
                            error = Some("No authorization code was returned by Google".into());
                        }
                    }
                    Err(e) => {
                        error = Some(format!("Failed parsing callback URL: {}", e));
                    }
                }

                {
                    let mut sessions = google_oauth_sessions().lock().unwrap();
                    if let Some(existing) = sessions.get_mut(&session_id_clone) {
                        existing.status = status.clone();
                        existing.refresh_token = refresh_token.clone();
                        existing.access_token = access_token.clone();
                        existing.scope = scope.clone();
                        existing.error = error.clone();
                    }
                }

                let html = if status == "success" {
                    "<html><body style=\"font-family: sans-serif; padding: 24px;\"><h2>Authorization successful</h2><p>You can close this tab and return to Personas.</p></body></html>"
                } else {
                    "<html><body style=\"font-family: sans-serif; padding: 24px;\"><h2>Authorization failed</h2><p>Please return to Personas and retry.</p></body></html>"
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    html.len(),
                    html
                );
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.shutdown().await;
            }
            Ok(Err(e)) => {
                let mut sessions = google_oauth_sessions().lock().unwrap();
                if let Some(existing) = sessions.get_mut(&session_id_clone) {
                    existing.status = "error".into();
                    existing.error = Some(format!("OAuth callback server failed: {}", e));
                }
            }
            Err(_) => {
                let mut sessions = google_oauth_sessions().lock().unwrap();
                if let Some(existing) = sessions.get_mut(&session_id_clone) {
                    existing.status = "error".into();
                    existing.error = Some("OAuth callback timed out".into());
                }
            }
        }
    });

    Ok(json!({
        "session_id": session_id,
        "auth_url": auth_url.to_string(),
        "redirect_uri": redirect_uri,
        "credential_source": credential_source,
    }))
}

#[tauri::command]
pub fn get_google_credential_oauth_status(
    _state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<serde_json::Value, AppError> {
    cleanup_google_oauth_sessions();
    let sessions = google_oauth_sessions().lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        return Ok(json!({
            "status": session.status,
            "refresh_token": session.refresh_token,
            "access_token": session.access_token,
            "scope": session.scope,
            "error": session.error,
        }));
    }

    Ok(json!({
        "status": "not_found",
        "refresh_token": null,
        "access_token": null,
        "scope": null,
        "error": "OAuth session not found or expired",
    }))
}

// ── Credential design runner ────────────────────────────────────

struct CredentialDesignRunParams {
    app: tauri::AppHandle,
    design_id: String,
    prompt_text: String,
    cli_args: crate::engine::types::CliArgs,
    active_design_id: Arc<Mutex<Option<String>>>,
}

/// Emit a user-friendly progress step to the frontend.
fn emit_progress(app: &tauri::AppHandle, design_id: &str, line: &str) {
    let _ = app.emit(
        "credential-design-output",
        CredentialDesignOutputEvent {
            design_id: design_id.to_string(),
            line: line.to_string(),
        },
    );
}

/// Try to extract the response text from a stream-json "result" line.
/// The result event has a `result` field containing the full response text.
fn extract_result_text(line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    if value.get("type").and_then(|t| t.as_str()) != Some("result") {
        return None;
    }
    // The result field can be a string directly or nested content
    if let Some(text) = value.get("result").and_then(|r| r.as_str()) {
        return Some(text.to_string());
    }
    None
}

async fn run_credential_design(params: CredentialDesignRunParams) {
    let CredentialDesignRunParams {
        app,
        design_id,
        prompt_text,
        cli_args,
        active_design_id,
    } = params;

    // Emit analyzing status
    let _ = app.emit(
        "credential-design-status",
        CredentialDesignStatusEvent {
            design_id: design_id.clone(),
            status: "analyzing".into(),
            result: None,
            error: None,
        },
    );

    emit_progress(&app, &design_id, "Connecting to Claude...");

    // Spawn Claude CLI process
    let mut cmd = Command::new(&cli_args.command);
    cmd.args(&cli_args.args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    for key in &cli_args.env_removals {
        cmd.env_remove(key);
    }
    cmd.env_remove("CLAUDECODE");
    cmd.env_remove("CLAUDE_CODE");
    for (key, val) in &cli_args.env_overrides {
        cmd.env(key, val);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let error_msg = if e.kind() == std::io::ErrorKind::NotFound {
                "Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code"
                    .to_string()
            } else {
                format!("Failed to spawn Claude CLI: {}", e)
            };
            let _ = app.emit(
                "credential-design-status",
                CredentialDesignStatusEvent {
                    design_id,
                    status: "failed".into(),
                    result: None,
                    error: Some(error_msg),
                },
            );
            return;
        }
    };

    // Write prompt to stdin
    if let Some(mut stdin) = child.stdin.take() {
        let prompt_bytes = prompt_text.into_bytes();
        let _ = stdin.write_all(&prompt_bytes).await;
        let _ = stdin.shutdown().await;
    }

    // Drain stderr in background to prevent pipe deadlock and capture errors
    let stderr = child.stderr.take().expect("stderr was piped");
    let stderr_task = tokio::spawn(async move {
        let mut stderr_reader = BufReader::new(stderr);
        let mut stderr_buf = String::new();
        let _ = tokio::io::AsyncReadExt::read_to_string(&mut stderr_reader, &mut stderr_buf).await;
        stderr_buf
    });

    // Read stdout line by line, extract text content for JSON extraction
    let stdout = child.stdout.take().expect("stdout was piped");
    let mut reader = BufReader::new(stdout).lines();
    let mut text_output = String::new(); // Accumulated text content (for JSON extraction)
    let mut emitted_analyzing = false;

    let timeout_duration = std::time::Duration::from_secs(600); // 10 min
    let stream_result = tokio::time::timeout(timeout_duration, async {
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            tracing::debug!(design_id = %design_id, raw_line_len = line.len(), "stream-json line received");

            // Parse stream-json line using the existing parser
            let (line_type, _display) = parse_stream_line(&line);

            match &line_type {
                StreamLineType::SystemInit { model, .. } => {
                    emit_progress(&app, &design_id, &format!("Connected ({})", model));
                    emit_progress(&app, &design_id, "Analyzing service requirements...");
                }
                StreamLineType::AssistantText { text } => {
                    // Accumulate text content for JSON extraction
                    text_output.push_str(text);
                    text_output.push('\n');

                    // Emit a one-time progress update when Claude starts writing
                    if !emitted_analyzing {
                        emitted_analyzing = true;
                        emit_progress(&app, &design_id, "Designing connector structure...");
                    }
                }
                StreamLineType::AssistantToolUse { tool_name, .. } => {
                    emit_progress(&app, &design_id, &format!("Researching: {}", tool_name));
                }
                StreamLineType::ToolResult { .. } => {
                    // Silently accumulate — not user-relevant
                }
                StreamLineType::Result { duration_ms, total_cost_usd, .. } => {
                    // Also try to extract the response text from the result event.
                    // The result event's `result` field contains the full response text,
                    // which may be the primary/only source of Claude's text output.
                    if let Some(result_text) = extract_result_text(&line) {
                        if !result_text.is_empty() {
                            tracing::debug!(
                                design_id = %design_id,
                                result_text_len = result_text.len(),
                                "Extracted text from result event"
                            );
                            // If we didn't get assistant text events, use the result text
                            if text_output.trim().is_empty() {
                                text_output = result_text;
                            }
                        }
                    }

                    let mut msg = "Analysis complete".to_string();
                    if let Some(ms) = duration_ms {
                        let secs = *ms as f64 / 1000.0;
                        msg = format!("Analysis complete ({:.1}s", secs);
                        if let Some(cost) = total_cost_usd {
                            msg.push_str(&format!(", ${:.4}", cost));
                        }
                        msg.push(')');
                    }
                    emit_progress(&app, &design_id, &msg);
                }
                StreamLineType::Unknown => {
                    // Non-JSON line — could be plain text output, accumulate it
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        text_output.push_str(trimmed);
                        text_output.push('\n');
                    }
                }
            }
        }
    })
    .await;

    // Wait for process and collect stderr
    let exit_status = child.wait().await;
    let stderr_output = stderr_task.await.unwrap_or_default();

    if !stderr_output.trim().is_empty() {
        tracing::warn!(
            design_id = %design_id,
            stderr = %stderr_output.trim(),
            "Claude CLI stderr output"
        );
    }

    if stream_result.is_err() {
        let _ = child.kill().await;
        let _ = app.emit(
            "credential-design-status",
            CredentialDesignStatusEvent {
                design_id,
                status: "failed".into(),
                result: None,
                error: Some("Credential design timed out after 10 minutes".into()),
            },
        );
        return;
    }

    // Check process exit status
    if let Ok(status) = &exit_status {
        if !status.success() {
            let stderr_trimmed = stderr_output.trim();
            let error_msg = if !stderr_trimmed.is_empty() {
                if stderr_trimmed.contains("unset the CLAUDECODE environment variable") {
                    "Claude CLI refused to run due to a conflicting CLAUDECODE environment variable. The app now removes this automatically. Please restart the app and try again.".to_string()
                } else {
                    format!("Claude CLI exited with error: {}", stderr_trimmed.lines().last().unwrap_or("unknown error"))
                }
            } else {
                format!("Claude CLI exited with status: {}", status)
            };
            tracing::error!(design_id = %design_id, error = %error_msg, "Claude CLI failed");
            let _ = app.emit(
                "credential-design-status",
                CredentialDesignStatusEvent {
                    design_id,
                    status: "failed".into(),
                    result: None,
                    error: Some(error_msg),
                },
            );
            return;
        }
    }

    // Check if cancelled
    let is_cancelled = {
        let guard = active_design_id.lock().unwrap();
        guard.as_deref() != Some(&design_id)
    };

    if is_cancelled {
        tracing::info!(design_id = %design_id, "Credential design cancelled");
        return;
    }

    tracing::info!(
        design_id = %design_id,
        text_output_len = text_output.len(),
        text_output_preview = %text_output.chars().take(500).collect::<String>(),
        "Attempting to extract credential design from text output"
    );

    // Extract design result from the accumulated TEXT content (not raw stream-json)
    match credential_design::extract_credential_design_result(&text_output) {
        Some(result) => {
            // Clear active design ID on success
            {
                let mut guard = active_design_id.lock().unwrap();
                if guard.as_deref() == Some(&design_id) {
                    *guard = None;
                }
            }

            emit_progress(&app, &design_id, "Connector designed successfully");

            // Emit result — user will confirm and save from the frontend
            let _ = app.emit(
                "credential-design-status",
                CredentialDesignStatusEvent {
                    design_id,
                    status: "completed".into(),
                    result: Some(result),
                    error: None,
                },
            );
        }
        None => {
            // Clear active design ID on failure
            {
                let mut guard = active_design_id.lock().unwrap();
                if guard.as_deref() == Some(&design_id) {
                    *guard = None;
                }
            }

            tracing::warn!(
                design_id = %design_id,
                text_output_len = text_output.len(),
                text_output_tail = %text_output.chars().rev().take(500).collect::<String>().chars().rev().collect::<String>(),
                "Failed to extract connector design from Claude text output"
            );

            let _ = app.emit(
                "credential-design-status",
                CredentialDesignStatusEvent {
                    design_id,
                    status: "failed".into(),
                    result: None,
                    error: Some("Failed to extract connector design from Claude output. Try describing the service more specifically.".into()),
                },
            );
        }
    }
}

fn build_credential_cli_args() -> crate::engine::types::CliArgs {
    let mut cli_args = prompt::build_default_cli_args();
    if !cli_args.args.iter().any(|arg| arg == "--model") {
        cli_args.args.push("--model".to_string());
        cli_args.args.push(CREDENTIAL_TASK_MODEL.to_string());
    }
    cli_args
}

fn resolve_template(template: &str, values: &HashMap<String, String>) -> String {
    let mut resolved = template.to_string();
    for (key, value) in values {
        let needle = format!("{{{{{}}}}}", key);
        resolved = resolved.replace(&needle, value);
    }
    resolved
}

fn default_google_scopes_for_connector(connector_name: &str) -> Vec<String> {
    match connector_name {
        "gmail" => vec![
            "https://www.googleapis.com/auth/gmail.modify".into(),
            "https://www.googleapis.com/auth/gmail.send".into(),
            "https://www.googleapis.com/auth/gmail.readonly".into(),
        ],
        "google_calendar" => vec![
            "https://www.googleapis.com/auth/calendar.events".into(),
            "https://www.googleapis.com/auth/calendar.readonly".into(),
        ],
        "google_drive" => vec![
            "https://www.googleapis.com/auth/drive.file".into(),
            "https://www.googleapis.com/auth/drive.readonly".into(),
        ],
        _ => vec![
            "https://www.googleapis.com/auth/gmail.modify".into(),
            "https://www.googleapis.com/auth/calendar.events".into(),
            "https://www.googleapis.com/auth/drive.file".into(),
        ],
    }
}

fn resolve_google_oauth_client_credentials(
    provided_client_id: String,
    provided_client_secret: String,
) -> Result<(String, String, String), AppError> {
    let provided_id = Some(provided_client_id)
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string());
    let provided_secret = Some(provided_client_secret)
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string());

    if let (Some(id), Some(secret)) = (provided_id, provided_secret) {
        return Ok((id, secret, "user_provided".into()));
    }

    let env_client_id = option_env!("GCP_CLIENT_ID")
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .or_else(|| env_var_first_nonempty(&["GCP_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_CLIENT_ID"]))
        .or_else(|| dotenv_var_first_nonempty(&["GCP_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_CLIENT_ID"]));

    let env_client_secret = option_env!("GCP_CLIENT_SECRET")
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .or_else(|| env_var_first_nonempty(&["GCP_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"]))
        .or_else(|| dotenv_var_first_nonempty(&["GCP_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"]));

    match (env_client_id, env_client_secret) {
        (Some(id), Some(secret)) => {
            Ok((id, secret, "app_managed".into()))
        }
        _ => Err(AppError::Validation(
            "Google OAuth client credentials are missing. Set GCP_CLIENT_ID and GCP_CLIENT_SECRET in app env/.env (or pass client credentials explicitly).".into(),
        )),
    }
}

fn env_var_first_nonempty(keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn dotenv_var_first_nonempty(keys: &[&str]) -> Option<String> {
    let candidates = [
        PathBuf::from(".env"),
        PathBuf::from("../.env"),
        PathBuf::from("../../.env"),
    ];

    for path in candidates {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let mut map = HashMap::<String, String>::new();
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                if let Some((k, v)) = trimmed.split_once('=') {
                    map.insert(k.trim().to_string(), v.trim().trim_matches('"').trim_matches('\'').to_string());
                }
            }

            for key in keys {
                if let Some(value) = map.get(*key) {
                    if !value.trim().is_empty() {
                        return Some(value.trim().to_string());
                    }
                }
            }
        }
    }

    None
}

struct GoogleTokenExchangeResult {
    refresh_token: Option<String>,
    access_token: Option<String>,
    scope: Option<String>,
}

async fn exchange_google_oauth_code_for_tokens(
    client_id: &str,
    client_secret: &str,
    code: &str,
    redirect_uri: &str,
) -> Result<GoogleTokenExchangeResult, String> {
    tracing::debug!(
        code_len = code.len(),
        redirect_uri = %redirect_uri,
        client_id_len = client_id.len(),
        client_secret_len = client_secret.len(),
        "Exchanging Google OAuth code for tokens"
    );

    let response = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code", code),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ])
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_else(|_| "<no body>".into());
        return Err(format!("Token exchange failed ({}): {}", status, body));
    }

    let value = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Invalid token response JSON: {}", e))?;

    Ok(GoogleTokenExchangeResult {
        refresh_token: value.get("refresh_token").and_then(|v| v.as_str()).map(|s| s.to_string()),
        access_token: value.get("access_token").and_then(|v| v.as_str()).map(|s| s.to_string()),
        scope: value.get("scope").and_then(|v| v.as_str()).map(|s| s.to_string()),
    })
}

async fn run_claude_prompt(
    prompt_text: String,
    cli_args: &crate::engine::types::CliArgs,
) -> Result<String, String> {
    let mut cmd = Command::new(&cli_args.command);
    cmd.args(&cli_args.args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    for key in &cli_args.env_removals {
        cmd.env_remove(key);
    }
    cmd.env_remove("CLAUDECODE");
    cmd.env_remove("CLAUDE_CODE");
    for (key, val) in &cli_args.env_overrides {
        cmd.env(key, val);
    }

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code"
                .to_string()
        } else {
            format!("Failed to spawn Claude CLI: {}", e)
        }
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(prompt_text.as_bytes()).await;
        let _ = stdin.shutdown().await;
    }

    let stderr = child.stderr.take().ok_or_else(|| "Missing stderr pipe".to_string())?;
    let stderr_task = tokio::spawn(async move {
        let mut stderr_reader = BufReader::new(stderr);
        let mut stderr_buf = String::new();
        let _ = tokio::io::AsyncReadExt::read_to_string(&mut stderr_reader, &mut stderr_buf).await;
        stderr_buf
    });

    let stdout = child.stdout.take().ok_or_else(|| "Missing stdout pipe".to_string())?;
    let mut reader = BufReader::new(stdout).lines();
    let mut text_output = String::new();

    let timeout_duration = std::time::Duration::from_secs(300);
    let stream_result = tokio::time::timeout(timeout_duration, async {
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            let (line_type, _) = parse_stream_line(&line);
            match &line_type {
                StreamLineType::AssistantText { text } => {
                    text_output.push_str(text);
                    text_output.push('\n');
                }
                StreamLineType::Result { .. } => {
                    if let Some(result_text) = extract_result_text(&line) {
                        if text_output.trim().is_empty() && !result_text.trim().is_empty() {
                            text_output = result_text;
                        }
                    }
                }
                StreamLineType::Unknown => {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        text_output.push_str(trimmed);
                        text_output.push('\n');
                    }
                }
                _ => {}
            }
        }
    })
    .await;

    let exit_status = child.wait().await.map_err(|e| format!("Failed waiting for Claude CLI: {}", e))?;
    let stderr_output = stderr_task.await.unwrap_or_default();

    if stream_result.is_err() {
        let _ = child.kill().await;
        return Err("Claude healthcheck generation timed out after 5 minutes".into());
    }

    if !exit_status.success() {
        if stderr_output.contains("unset the CLAUDECODE environment variable") {
            return Err("Claude CLI refused to run due to CLAUDECODE conflict. Restart the app and retry.".into());
        }
        let msg = stderr_output
            .trim()
            .lines()
            .last()
            .unwrap_or("unknown error")
            .to_string();
        return Err(format!("Claude CLI exited with error: {}", msg));
    }

    if text_output.trim().is_empty() {
        return Err("Claude produced no output for healthcheck generation".into());
    }

    Ok(text_output)
}
