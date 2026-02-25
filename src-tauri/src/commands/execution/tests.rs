use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::db::models::{Persona, PersonaTestResult, PersonaTestRun, PersonaToolDefinition};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::test_runs as repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::engine::{parser, prompt};
use crate::engine::test_runner::{self, TestModelConfig};
use crate::engine::types::StreamLineType;
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub async fn start_test_run(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    models: Vec<serde_json::Value>,
    use_case_filter: Option<String>,
) -> Result<PersonaTestRun, AppError> {
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
    let tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;

    // Parse model configs from frontend
    let mut model_configs: Vec<TestModelConfig> = Vec::new();
    for v in models {
        match serde_json::from_value(v.clone()) {
            Ok(config) => model_configs.push(config),
            Err(e) => return Err(AppError::Validation(format!("Invalid model config: {}", e))),
        }
    }

    if model_configs.is_empty() {
        return Err(AppError::Validation("No valid models provided".into()));
    }

    let models_json = serde_json::to_string(
        &model_configs.iter().map(|m| &m.id).collect::<Vec<_>>(),
    )
    .unwrap_or_default();

    let run = repo::create_run(&state.db, &persona_id, &models_json)?;
    let run_id = run.id.clone();

    let pool = state.db.clone();
    let log_dir = state
        .engine
        .child_pids
        .lock()
        .await;
    drop(log_dir); // just used to verify engine is alive

    // Create cancellation flag and register in AppState
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut flags = state.active_test_run_cancelled.lock().unwrap();
        flags.insert(run_id.clone(), cancelled.clone());
    }

    let cancelled_clone = cancelled.clone();
    let run_id_for_cancel = run_id.clone();
    let state_arc = state.inner().clone();

    tokio::spawn(async move {
        test_runner::run_test(
            app,
            pool,
            run_id_for_cancel.clone(),
            persona,
            tools,
            model_configs,
            std::env::temp_dir(),
            cancelled_clone,
            use_case_filter,
        )
        .await;

        // Clean up cancellation flag
        if let Ok(mut flags) = state_arc.active_test_run_cancelled.lock() {
            flags.remove(&run_id_for_cancel);
        }
    });

    Ok(run)
}

#[tauri::command]
pub fn list_test_runs(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
) -> Result<Vec<PersonaTestRun>, AppError> {
    repo::get_runs_by_persona(&state.db, &persona_id, limit)
}

#[tauri::command]
pub fn get_test_results(
    state: State<'_, Arc<AppState>>,
    test_run_id: String,
) -> Result<Vec<PersonaTestResult>, AppError> {
    repo::get_results_by_run(&state.db, &test_run_id)
}

#[tauri::command]
pub fn delete_test_run(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    repo::delete_run(&state.db, &id)
}

#[tauri::command]
pub fn cancel_test_run(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    // Set cancellation flag — the test runner checks this between iterations
    if let Ok(flags) = state.active_test_run_cancelled.lock() {
        if let Some(flag) = flags.get(&id) {
            flag.store(true, std::sync::atomic::Ordering::Release);
        }
    }

    // Update DB status immediately
    let now = chrono::Utc::now().to_rfc3339();
    repo::update_run_status(&state.db, &id, "cancelled", None, None, None, Some(&now))?;

    Ok(())
}

// ── Draft Validation & Streaming Test ──────────────────────────

#[derive(Deserialize)]
struct DraftToolInput {
    name: String,
    category: String,
    description: String,
    script_path: Option<String>,
    input_schema: Option<serde_json::Value>,
    requires_credential_type: Option<String>,
    implementation_guide: Option<String>,
}

#[derive(Deserialize)]
struct DraftInput {
    name: Option<String>,
    system_prompt: String,
    structured_prompt: Option<serde_json::Value>,
    description: Option<String>,
    model_profile: Option<String>,
    max_budget_usd: Option<f64>,
    design_context: Option<String>,
    tools: Option<Vec<DraftToolInput>>,
}

#[derive(Serialize)]
pub struct ToolIssue {
    tool_name: String,
    issue: String,
}

#[derive(Serialize)]
pub struct DraftValidationResult {
    passed: bool,
    error: Option<String>,
    output_preview: Option<String>,
    tool_issues: Vec<ToolIssue>,
}

/// Tauri event emitted for each line of CLI output during a draft test.
#[derive(Clone, Serialize)]
struct N8nTestOutputEvent {
    test_id: String,
    line: String,
}

/// Tauri event emitted when a draft test changes status.
#[derive(Clone, Serialize)]
struct N8nTestStatusEvent {
    test_id: String,
    status: String, // "running" | "completed" | "failed"
    error: Option<String>,
    passed: Option<bool>,
}

/// Build a temporary Persona + tools from draft JSON (shared by validate and test).
fn build_draft_persona_and_tools(
    draft_json: &str,
) -> Result<(Persona, Vec<PersonaToolDefinition>), AppError> {
    let draft: DraftInput = serde_json::from_str(draft_json)
        .map_err(|e| AppError::Validation(format!("Invalid draft JSON: {}", e)))?;

    let now = chrono::Utc::now().to_rfc3339();
    let persona = Persona {
        id: format!("draft-validate-{}", uuid::Uuid::new_v4()),
        project_id: "default".to_string(),
        name: draft.name.unwrap_or_else(|| "Draft Validation".to_string()),
        description: draft.description,
        system_prompt: draft.system_prompt,
        structured_prompt: draft.structured_prompt.map(|v| v.to_string()),
        icon: None,
        color: None,
        enabled: false,
        max_concurrent: 1,
        timeout_ms: 30_000,
        notification_channels: None,
        last_design_result: None,
        model_profile: draft.model_profile,
        max_budget_usd: draft.max_budget_usd,
        max_turns: Some(1),
        design_context: draft.design_context,
        group_id: None,
        created_at: now.clone(),
        updated_at: now,
    };

    let tools: Vec<PersonaToolDefinition> = draft
        .tools
        .unwrap_or_default()
        .into_iter()
        .map(|t| {
            let tool_now = chrono::Utc::now().to_rfc3339();
            PersonaToolDefinition {
                id: format!("draft-tool-{}", uuid::Uuid::new_v4()),
                name: t.name.clone(),
                category: t.category,
                description: t.description,
                // Empty string = use Bash tool via prompt (n8n-imported tools).
                // Non-empty = real script path.
                script_path: t.script_path.unwrap_or_default(),
                input_schema: t.input_schema.map(|v| v.to_string()),
                output_schema: None,
                requires_credential_type: t.requires_credential_type,
                implementation_guide: t.implementation_guide,
                is_builtin: false,
                created_at: tool_now.clone(),
                updated_at: tool_now,
            }
        })
        .collect();

    Ok((persona, tools))
}

/// Static-only validation: checks tool script paths without spawning CLI.
/// Used for quick pre-checks. Returns immediately.
#[tauri::command]
pub async fn validate_n8n_draft(
    draft_json: String,
) -> Result<DraftValidationResult, AppError> {
    let (_persona, tools) = build_draft_persona_and_tools(&draft_json)?;

    // Check for tools with non-empty script_path pointing to missing files
    let mut tool_issues: Vec<ToolIssue> = Vec::new();
    for tool in &tools {
        let script = &tool.script_path;
        if script.is_empty() {
            continue; // Empty = uses Bash tool, no script needed
        }
        let path = std::path::Path::new(script);
        if path.is_absolute() {
            if !path.exists() {
                tool_issues.push(ToolIssue {
                    tool_name: tool.name.clone(),
                    issue: format!("Script not found: {}", script),
                });
            }
        } else {
            // Relative path — no mechanism creates these
            tool_issues.push(ToolIssue {
                tool_name: tool.name.clone(),
                issue: format!("Script '{}' does not exist.", script),
            });
        }
    }

    if !tool_issues.is_empty() {
        let names: Vec<&str> = tool_issues.iter().map(|t| t.tool_name.as_str()).collect();
        return Ok(DraftValidationResult {
            passed: false,
            error: Some(format!(
                "{} tool(s) reference missing scripts: {}.",
                tool_issues.len(),
                names.join(", ")
            )),
            output_preview: None,
            tool_issues,
        });
    }

    Ok(DraftValidationResult {
        passed: true,
        error: None,
        output_preview: None,
        tool_issues: vec![],
    })
}

/// Streaming draft test: spawns Claude CLI with --max-turns 1 in background,
/// emits real-time output events, and reports pass/fail on completion.
/// Returns immediately after spawning.
#[tauri::command]
pub async fn test_n8n_draft(
    app: tauri::AppHandle,
    test_id: String,
    draft_json: String,
) -> Result<(), AppError> {
    let (persona, tools) = build_draft_persona_and_tools(&draft_json)?;

    // Static pre-check: tools with non-empty script_path that don't exist
    for tool in &tools {
        let script = &tool.script_path;
        if script.is_empty() {
            continue;
        }
        let path = std::path::Path::new(script);
        let missing = if path.is_absolute() { !path.exists() } else { true };
        if missing {
            let _ = app.emit(
                "n8n-test-status",
                N8nTestStatusEvent {
                    test_id,
                    status: "failed".to_string(),
                    error: Some(format!("Tool '{}' references script '{}' that does not exist.", tool.name, script)),
                    passed: Some(false),
                },
            );
            return Ok(());
        }
    }

    // Build prompt and CLI args
    let model_profile = prompt::parse_model_profile(persona.model_profile.as_deref());
    let mut cli_args = prompt::build_cli_args(Some(&persona), model_profile.as_ref());
    if !cli_args.args.iter().any(|a| a == "--max-turns") {
        cli_args.args.push("--max-turns".to_string());
        cli_args.args.push("1".to_string());
    }
    // Build credential hints from tools' requires_credential_type
    let credential_hint_strings: Vec<String> = tools
        .iter()
        .filter_map(|t| t.requires_credential_type.as_ref())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .flat_map(|cred_type| {
            let prefix = cred_type.to_uppercase().replace(['-', ' '], "_");
            vec![
                format!("{}_ACCESS_TOKEN", prefix),
                format!("{}_REFRESH_TOKEN", prefix),
                format!("{}_API_KEY", prefix),
            ]
        })
        .collect();
    let credential_hint_refs: Vec<&str> = credential_hint_strings.iter().map(|s| s.as_str()).collect();
    let cred_hints = if credential_hint_refs.is_empty() {
        None
    } else {
        Some(credential_hint_refs.as_slice())
    };

    let prompt_text = prompt::assemble_prompt(&persona, &tools, None, cred_hints);

    // Create temp dir
    let exec_dir = std::env::temp_dir().join(format!("personas-test-{}", uuid::Uuid::new_v4()));
    if let Err(e) = std::fs::create_dir_all(&exec_dir) {
        let _ = app.emit(
            "n8n-test-status",
            N8nTestStatusEvent {
                test_id,
                status: "failed".to_string(),
                error: Some(format!("Failed to create temp dir: {}", e)),
                passed: Some(false),
            },
        );
        return Ok(());
    }

    // Emit running status
    let _ = app.emit(
        "n8n-test-status",
        N8nTestStatusEvent {
            test_id: test_id.clone(),
            status: "running".to_string(),
            error: None,
            passed: None,
        },
    );

    // Spawn CLI process
    let mut cmd = tokio::process::Command::new(&cli_args.command);
    cmd.args(&cli_args.args)
        .current_dir(&exec_dir)
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
    for (key, val) in &cli_args.env_overrides {
        cmd.env(key, val);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&exec_dir);
            let error_msg = if e.kind() == std::io::ErrorKind::NotFound {
                "Claude CLI not found. Install it from https://docs.anthropic.com/en/docs/claude-code".to_string()
            } else {
                format!("Failed to spawn Claude CLI: {}", e)
            };
            let _ = app.emit(
                "n8n-test-status",
                N8nTestStatusEvent {
                    test_id,
                    status: "failed".to_string(),
                    error: Some(error_msg),
                    passed: Some(false),
                },
            );
            return Ok(());
        }
    };

    // Write prompt to stdin
    if let Some(mut stdin) = child.stdin.take() {
        let prompt_bytes = prompt_text.into_bytes();
        let _ = stdin.write_all(&prompt_bytes).await;
        let _ = stdin.shutdown().await;
    }

    // Track whether the draft has tools — confused agents without tool use should fail
    let has_tools = !tools.is_empty();

    // Background task: read stdout, emit events, determine result
    let test_id_bg = test_id.clone();
    let app_bg = app.clone();
    tokio::spawn(async move {
        let stdout = child.stdout.take().expect("stdout was piped");
        let mut reader = BufReader::new(stdout).lines();

        let mut saw_init = false;
        let mut saw_text = false;
        let mut saw_tool_use = false;
        let mut assistant_full_text = String::new();
        let mut error_text = String::new();

        let timeout = tokio::time::Duration::from_secs(60);
        let read_result = tokio::time::timeout(timeout, async {
            while let Ok(Some(line)) = reader.next_line().await {
                let (line_type, display) = parser::parse_stream_line(&line);

                // Emit each display line as output event
                if let Some(ref d) = display {
                    if !d.trim().is_empty() {
                        let _ = app_bg.emit(
                            "n8n-test-output",
                            N8nTestOutputEvent {
                                test_id: test_id_bg.clone(),
                                line: d.clone(),
                            },
                        );
                    }
                }

                match line_type {
                    StreamLineType::SystemInit { .. } => {
                        saw_init = true;
                    }
                    StreamLineType::AssistantText { .. } => {
                        saw_text = true;
                        if let Some(ref d) = display {
                            assistant_full_text.push_str(d);
                            assistant_full_text.push('\n');
                        }
                    }
                    StreamLineType::AssistantToolUse { .. } => {
                        saw_text = true;
                        saw_tool_use = true;
                    }
                    _ => {
                        if let Some(ref d) = display {
                            if (d.contains("error") || d.contains("Error") || d.contains("ERROR")) && error_text.is_empty() {
                                error_text = d.clone();
                            }
                        }
                    }
                }
            }
        })
        .await;

        // Wait for process exit
        let _ = tokio::time::timeout(
            tokio::time::Duration::from_secs(5),
            child.wait(),
        )
        .await;

        // Clean up temp dir
        let _ = std::fs::remove_dir_all(&exec_dir);

        // Emit final status — enhanced validation with confusion detection
        let (status, passed, error) = if read_result.is_err() {
            let _ = child.kill().await;
            ("failed".to_string(), Some(false), Some("Test timed out after 60 seconds".to_string()))
        } else if !saw_init {
            let err = if !error_text.is_empty() {
                error_text
            } else {
                "Claude CLI failed to initialize. Check your API key and network connection.".to_string()
            };
            ("failed".to_string(), Some(false), Some(err))
        } else if !saw_text {
            let err = if !error_text.is_empty() {
                error_text
            } else {
                "Persona started but produced no output. The prompt may be invalid.".to_string()
            };
            ("failed".to_string(), Some(false), Some(err))
        } else {
            // saw_init && saw_text — now apply deeper validation
            let text_lower = assistant_full_text.to_lowercase();

            // Detect confused/lost agent
            let confusion_phrases = [
                "i don't have enough information",
                "i don't know which api",
                "unable to determine",
                "i cannot determine",
                "i'm not sure how to",
                "i don't have access to",
                "i need more information",
                "i cannot find any",
                "no api endpoint",
                "no implementation details",
                "missing credentials",
                "i don't know how to call",
                "i'm unable to proceed",
                "i cannot proceed",
            ];

            let is_confused = confusion_phrases
                .iter()
                .any(|phrase| text_lower.contains(phrase));

            if is_confused {
                (
                    "failed".to_string(),
                    Some(false),
                    Some("Agent appears confused — it could not determine how to use the tools. Check that implementation_guide fields contain API endpoints, auth headers, and curl examples.".to_string()),
                )
            } else if has_tools && !saw_tool_use {
                // Agent has tools but didn't attempt to use any of them
                (
                    "failed".to_string(),
                    Some(false),
                    Some("Agent did not attempt to use any tools. The prompt may lack actionable API details for tool execution.".to_string()),
                )
            } else {
                ("completed".to_string(), Some(true), None)
            }
        };

        let _ = app_bg.emit(
            "n8n-test-status",
            N8nTestStatusEvent {
                test_id: test_id_bg,
                status,
                error,
                passed,
            },
        );
    });

    Ok(())
}
