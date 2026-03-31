use std::sync::Arc;

use serde::Serialize;
use tauri::{Emitter, State};
use tokio::io::AsyncBufReadExt;
use ts_rs::TS;

use crate::db::models::{LabRunStatus, PersonaTestResult, PersonaTestRun};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::test_runs as repo;
use crate::db::repos::execution::test_suites as suite_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::engine::{eval, parser, prompt};
use crate::engine::cli_process::CliProcessDriver;
use crate::engine::event_registry::event_name;
use crate::engine::test_runner::{self, parse_model_configs, TestScenario};
use crate::engine::types::{EphemeralPersona, StreamLineType};
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

#[tauri::command]
pub async fn start_test_run(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    models: Vec<serde_json::Value>,
    use_case_filter: Option<String>,
    suite_id: Option<String>,
    fixture_inputs: Option<String>,
) -> Result<PersonaTestRun, AppError> {
    require_auth(&state).await?;
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
    let tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;
    let ephemeral = EphemeralPersona::from_persisted(persona, tools);

    // Parse model configs from frontend
    let model_configs = parse_model_configs(models)?;

    // If a suite_id is provided, load the saved scenarios
    let preloaded_scenarios: Option<Vec<TestScenario>> = if let Some(ref sid) = suite_id {
        let suite = suite_repo::get_by_id(&state.db, sid)?;
        let scenarios: Vec<TestScenario> = serde_json::from_str(&suite.scenarios)
            .map_err(|e| AppError::Validation(format!("Failed to parse suite scenarios: {e}")))?;
        Some(scenarios)
    } else {
        None
    };

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

    // Register cancellation flag in process registry.
    // The guard ensures unregister_run is called even if the task panics.
    let (cancelled, run_guard) =
        state.process_registry.register_run_guarded("test", &run_id);

    let cancelled_clone = cancelled.clone();
    let run_id_for_cancel = run_id.clone();

    tokio::spawn(async move {
        let _guard = run_guard;
        test_runner::run_test(
            app,
            pool,
            run_id_for_cancel.clone(),
            ephemeral,
            model_configs,
            std::env::temp_dir(),
            cancelled_clone,
            use_case_filter,
            preloaded_scenarios,
            fixture_inputs,
        )
        .await;
    });

    Ok(run)
}

#[tauri::command]
pub fn list_test_runs(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
) -> Result<Vec<PersonaTestRun>, AppError> {
    require_auth_sync(&state)?;
    repo::get_runs_by_persona(&state.db, &persona_id, limit)
}

#[tauri::command]
pub fn get_test_results(
    state: State<'_, Arc<AppState>>,
    test_run_id: String,
) -> Result<Vec<PersonaTestResult>, AppError> {
    require_auth_sync(&state)?;
    repo::get_results_by_run(&state.db, &test_run_id)
}

#[tauri::command]
pub async fn delete_test_run(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;

    // If the run is still active, cancel it and wait briefly for the background task to wind down.
    if state.process_registry.is_run_registered("test", &id) {
        state.process_registry.cancel_run("test", &id);
        // Give the background task up to 500ms to notice cancellation and unregister.
        for _ in 0..10 {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            if !state.process_registry.is_run_registered("test", &id) {
                break;
            }
        }
        // Force-unregister if it didn't stop in time — the task will no-op on next DB write.
        state.process_registry.unregister_run("test", &id);
    }

    repo::delete_run(&state.db, &id)
}

#[tauri::command]
pub fn cancel_test_run(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    // Set cancellation flag -- the test runner checks this between iterations
    state.process_registry.cancel_run("test", &id);

    // Update DB status immediately
    let now = chrono::Utc::now().to_rfc3339();
    repo::update_run_status(&state.db, &id, LabRunStatus::Cancelled, None, None, None, Some(&now))?;

    Ok(())
}

// -- Draft Validation & Streaming Test --------------------------

#[derive(Serialize, TS)]
#[ts(export)]
pub struct ToolIssue {
    tool_name: String,
    issue: String,
}

#[derive(Serialize, TS)]
#[ts(export)]
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

/// Static-only validation: checks tool script paths without spawning CLI.
/// Used for quick pre-checks. Returns immediately.
#[tauri::command]
pub async fn validate_n8n_draft(
    state: State<'_, Arc<AppState>>,
    draft_json: String,
) -> Result<DraftValidationResult, AppError> {
    require_auth(&state).await?;
    let ephemeral = EphemeralPersona::from_draft_json(&draft_json)
        .map_err(AppError::Validation)?;
    let tools = &ephemeral.tools;

    // Check for tools with non-empty script_path pointing to missing files
    let mut tool_issues: Vec<ToolIssue> = Vec::new();
    for tool in tools {
        let script = &tool.script_path;
        if script.is_empty() {
            continue; // Empty = uses Bash tool, no script needed
        }
        let path = std::path::Path::new(script);
        if path.is_absolute() {
            if !path.exists() {
                tool_issues.push(ToolIssue {
                    tool_name: tool.name.clone(),
                    issue: format!("Script not found: {script}"),
                });
            }
        } else {
            // Relative path -- no mechanism creates these
            tool_issues.push(ToolIssue {
                tool_name: tool.name.clone(),
                issue: format!("Script '{script}' does not exist."),
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
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    test_id: String,
    draft_json: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;

    // Reject duplicate spawns: if a draft test with this test_id is already running, bail out.
    if state.process_registry.is_run_registered("draft_test", &test_id) {
        return Err(AppError::Validation(format!(
            "A draft test with id '{test_id}' is already running"
        )));
    }

    let ephemeral = EphemeralPersona::from_draft_json(&draft_json)
        .map_err(AppError::Validation)?;
    let persona = &ephemeral.persona;
    let tools = &ephemeral.tools;

    // Static pre-check: tools with non-empty script_path that don't exist
    for tool in tools {
        let script = &tool.script_path;
        if script.is_empty() {
            continue;
        }
        let path = std::path::Path::new(script);
        let missing = if path.is_absolute() { !path.exists() } else { true };
        if missing {
            let _ = app.emit(
                event_name::N8N_TEST_STATUS,
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
    let mut cli_args = prompt::build_cli_args(Some(persona), model_profile.as_ref());
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

    let prompt_text = prompt::assemble_prompt(persona, tools, None, cred_hints, None, #[cfg(feature = "desktop")] None);

    // Spawn CLI process via CliProcessDriver (with piped stderr)
    let mut driver = match CliProcessDriver::spawn_temp(&cli_args, "personas-test") {
        Ok(d) => d,
        Err(e) => {
            let _ = app.emit(
                event_name::N8N_TEST_STATUS,
                N8nTestStatusEvent {
                    test_id,
                    status: "failed".to_string(),
                    error: Some(e),
                    passed: Some(false),
                },
            );
            return Ok(());
        }
    };

    // Emit running status
    let _ = app.emit(
        event_name::N8N_TEST_STATUS,
        N8nTestStatusEvent {
            test_id: test_id.clone(),
            status: "running".to_string(),
            error: None,
            passed: None,
        },
    );

    // Write prompt to stdin
    driver.write_stdin(prompt_text.as_bytes()).await;

    // Track whether the draft has tools -- confused agents without tool use should fail
    let has_tools = !tools.is_empty();

    // Register in process registry so duplicate spawns are rejected.
    // The guard auto-unregisters on drop (task completion or panic).
    let (_cancelled, run_guard) =
        state.process_registry.register_run_guarded("draft_test", &test_id);

    // Background task: read stdout, emit events, determine result
    let test_id_bg = test_id.clone();
    let app_bg = app.clone();
    tokio::spawn(async move {
        let _guard = run_guard;
        let mut reader = match driver.take_stdout_reader() {
            Some(r) => r.lines(),
            None => {
                let _ = app_bg.emit(
                    event_name::N8N_TEST_STATUS,
                    N8nTestStatusEvent {
                        test_id: test_id_bg,
                        status: "failed".to_string(),
                        error: Some("Failed to capture stdout from CLI process".to_string()),
                        passed: Some(false),
                    },
                );
                return;
            }
        };

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
                            event_name::N8N_TEST_OUTPUT,
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

        // Emit final status -- enhanced validation with confusion detection
        let (status, passed, error) = if read_result.is_err() {
            // Timeout: kill process first, then cleanup
            driver.kill().await;
            let _ = tokio::time::timeout(
                tokio::time::Duration::from_secs(5),
                driver.wait(),
            )
            .await;
            driver.cleanup_dir();
            ("failed".to_string(), Some(false), Some("Test timed out after 60 seconds".to_string()))
        } else {
            // Normal exit: wait for process, then cleanup
            let _ = tokio::time::timeout(
                tokio::time::Duration::from_secs(5),
                driver.wait(),
            )
            .await;
            driver.cleanup_dir();

            if !saw_init {
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
                // saw_init && saw_text -- apply confusion detection via eval framework
                let actual_tools_empty: Vec<String> = Vec::new();
                let actual_tools: &[String] = if saw_tool_use { &["_tool_used".to_string()] } else { &actual_tools_empty };
                let eval_input = eval::EvalInput {
                    output: &assistant_full_text,
                    expected_behavior: None,
                    expected_tools: None,
                    actual_tools: Some(actual_tools),
                    expected_protocols: None,
                    has_tools,
                };
                let confusion_result = eval::eval_confusion_detect(&eval_input);

                if confusion_result.passed == Some(false) {
                    (
                        "failed".to_string(),
                        Some(false),
                        Some(confusion_result.explanation),
                    )
                } else {
                    ("completed".to_string(), Some(true), None)
                }
            }
        };

        let _ = app_bg.emit(
            event_name::N8N_TEST_STATUS,
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
