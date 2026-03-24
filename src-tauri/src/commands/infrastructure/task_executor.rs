//! Task execution engine -- executes dev-tools tasks via Claude CLI.
//!
//! Follows the same BackgroundJobManager pattern as idea_scanner.rs:
//! spawns CLI process, streams output via Tauri events, updates DB.

use std::sync::Arc;

use serde_json::json;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::background_job::BackgroundJobManager;
use crate::commands::design::analysis::extract_display_text;
use crate::db::repos::dev_tools as repo;
use crate::engine::event_registry::event_name;
use crate::engine::parser::parse_stream_line;
use crate::engine::prompt;
use crate::engine::types::StreamLineType;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

// =============================================================================
// Job state
// =============================================================================

#[derive(Clone, Default)]
struct TaskExecExtra;

static TASK_EXEC_JOBS: BackgroundJobManager<TaskExecExtra> = BackgroundJobManager::new(
    "task-executor lock poisoned",
    event_name::TASK_EXEC_STATUS,
    event_name::TASK_EXEC_OUTPUT,
);

// =============================================================================
// Prompt construction
// =============================================================================

fn build_task_prompt(
    task_title: &str,
    task_description: Option<&str>,
    idea_context: Option<String>,
    goal_context: Option<String>,
    codebase_context: Option<String>,
) -> String {
    let mut prompt = String::new();

    prompt.push_str("You are an expert software engineer. Execute the following task:\n\n");
    prompt.push_str(&format!("## Task: {task_title}\n"));
    if let Some(desc) = task_description {
        prompt.push_str(desc);
        prompt.push('\n');
    }
    prompt.push('\n');

    if let Some(idea) = idea_context {
        prompt.push_str("## Background\n");
        prompt.push_str(&idea);
        prompt.push('\n');
    }

    if let Some(goal) = goal_context {
        prompt.push_str("## Goal Context\n");
        prompt.push_str(&goal);
        prompt.push('\n');
    }

    if let Some(codebase) = codebase_context {
        prompt.push_str("## Codebase Context\n");
        prompt.push_str(&codebase);
        prompt.push('\n');
    }

    prompt.push_str("\nWork in the project directory. Make all necessary code changes.\n");
    prompt.push_str("When done, output a brief summary of what was accomplished.\n");

    prompt
}

// =============================================================================
// Tauri commands
// =============================================================================

#[tauri::command]
pub async fn dev_tools_execute_task(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    task_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;

    let task = repo::get_task_by_id(&state.db, &task_id)?;
    let project_id = task
        .project_id
        .as_deref()
        .ok_or_else(|| AppError::Validation("Task has no project_id".into()))?;
    let project = repo::get_project_by_id(&state.db, project_id)?;

    // Build context from linked idea
    let idea_context = task
        .source_idea_id
        .as_deref()
        .and_then(|idea_id| repo::get_idea_by_id(&state.db, idea_id).ok())
        .map(|idea| {
            let mut s = String::new();
            if let Some(desc) = &idea.description {
                s.push_str(desc);
                s.push('\n');
            }
            if let Some(reasoning) = &idea.reasoning {
                s.push_str(reasoning);
                s.push('\n');
            }
            s
        });

    // Build context from linked goal
    let goal_context = task
        .goal_id
        .as_deref()
        .and_then(|goal_id| repo::get_goal_by_id(&state.db, goal_id).ok())
        .map(|goal| {
            let mut s = goal.title.to_string();
            if let Some(desc) = &goal.description {
                s.push_str(&format!(": {desc}"));
            }
            s.push('\n');
            s
        });

    // Build codebase context from project's contexts
    let codebase_context = {
        let contexts = repo::list_contexts_by_project(&state.db, project_id, None)
            .unwrap_or_default();
        if contexts.is_empty() {
            None
        } else {
            let mut s = String::new();
            for ctx in &contexts {
                s.push_str(&format!("### {}\n", ctx.name));
                if let Some(desc) = &ctx.description {
                    s.push_str(&format!("{desc}\n"));
                }
                s.push_str(&format!("Files: {}\n\n", ctx.file_paths));
            }
            Some(s)
        }
    };

    let prompt_text = build_task_prompt(
        &task.title,
        task.description.as_deref(),
        idea_context,
        goal_context,
        codebase_context,
    );

    // Mark task as running
    let now = chrono::Utc::now().to_rfc3339();
    let _ = repo::update_task(
        &state.db,
        &task_id,
        None,          // title
        None,          // description
        Some("running"),
        None,          // session_id
        Some(0),       // progress_pct
        None,          // output_lines
        None,          // error
        Some(Some(&now)), // started_at
        None,          // completed_at
    );

    let cancel_token = CancellationToken::new();
    TASK_EXEC_JOBS.insert_running(task_id.clone(), cancel_token.clone(), TaskExecExtra)?;
    TASK_EXEC_JOBS.set_status(&app, &task_id, "running", None);

    let app_handle = app.clone();
    let pool = state.db.clone();
    let task_id_for_spawn = task_id.clone();
    let token_for_task = cancel_token;
    let root_path = project.root_path.clone();
    let project_name = project.name.clone();
    let goal_id = task.goal_id.clone();

    tokio::spawn(async move {
        let result = tokio::select! {
            _ = token_for_task.cancelled() => {
                Err(AppError::Internal("Task execution cancelled by user".into()))
            }
            res = run_task_execution(
                &app_handle,
                &task_id_for_spawn,
                &pool,
                &root_path,
                prompt_text,
            ) => res
        };

        let completed_now = chrono::Utc::now().to_rfc3339();

        match result {
            Ok(line_count) => {
                let _ = repo::update_task(
                    &pool,
                    &task_id_for_spawn,
                    None,
                    None,
                    Some("completed"),
                    None,
                    Some(100),
                    Some(line_count),
                    None,
                    None,
                    Some(Some(&completed_now)),
                );
                TASK_EXEC_JOBS.set_status(&app_handle, &task_id_for_spawn, "completed", None);
                let _ = app_handle.emit(
                    event_name::TASK_EXEC_COMPLETE,
                    json!({ "task_id": task_id_for_spawn, "output_lines": line_count }),
                );
                crate::notifications::send(
                    &app_handle,
                    "Task Complete",
                    &format!("{project_name}: task finished with {line_count} output lines."),
                );

                // Record goal signal if task has a goal_id
                if let Some(ref gid) = goal_id {
                    let _ = repo::create_goal_signal(
                        &pool,
                        gid,
                        "task_completed",
                        Some(&task_id_for_spawn),
                        Some(10),
                        Some("Task completed successfully"),
                    );
                }
            }
            Err(e) => {
                let msg = format!("{e}");
                let _ = repo::update_task(
                    &pool,
                    &task_id_for_spawn,
                    None,
                    None,
                    Some("failed"),
                    None,
                    None,
                    None,
                    Some(Some(&msg)),
                    None,
                    Some(Some(&completed_now)),
                );
                TASK_EXEC_JOBS.set_status(
                    &app_handle,
                    &task_id_for_spawn,
                    "failed",
                    Some(msg.clone()),
                );
                TASK_EXEC_JOBS.emit_line(
                    &app_handle,
                    &task_id_for_spawn,
                    format!("[Error] {msg}"),
                );
                crate::notifications::send(
                    &app_handle,
                    "Task Failed",
                    &format!("{project_name}: {msg}"),
                );

                // Record goal signal for failure
                if let Some(ref gid) = goal_id {
                    let _ = repo::create_goal_signal(
                        &pool,
                        gid,
                        "task_failed",
                        Some(&task_id_for_spawn),
                        None,
                        Some(&msg),
                    );
                }
            }
        }
    });

    Ok(json!({ "task_id": task_id }))
}

#[tauri::command]
pub async fn dev_tools_start_batch(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    task_ids: Vec<String>,
    max_parallel: Option<usize>,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;

    let batch_id = uuid::Uuid::new_v4().to_string();
    let max_parallel = max_parallel.unwrap_or(2);
    let semaphore = Arc::new(tokio::sync::Semaphore::new(max_parallel));
    let started = task_ids.len();

    for tid in task_ids {
        let sem = semaphore.clone();
        let app_handle = app.clone();
        let pool = state.db.clone();

        tokio::spawn(async move {
            let _permit = sem.acquire().await;

            // Read task to get project info
            let task = match repo::get_task_by_id(&pool, &tid) {
                Ok(t) => t,
                Err(e) => {
                    TASK_EXEC_JOBS.emit_line(
                        &app_handle,
                        &tid,
                        format!("[Error] Failed to read task: {e}"),
                    );
                    return;
                }
            };

            let project_id = match task.project_id.as_deref() {
                Some(pid) => pid.to_string(),
                None => {
                    TASK_EXEC_JOBS.emit_line(
                        &app_handle,
                        &tid,
                        "[Error] Task has no project_id".to_string(),
                    );
                    return;
                }
            };

            let project = match repo::get_project_by_id(&pool, &project_id) {
                Ok(p) => p,
                Err(e) => {
                    TASK_EXEC_JOBS.emit_line(
                        &app_handle,
                        &tid,
                        format!("[Error] Failed to read project: {e}"),
                    );
                    return;
                }
            };

            // Build context from linked idea
            let idea_context = task
                .source_idea_id
                .as_deref()
                .and_then(|idea_id| repo::get_idea_by_id(&pool, idea_id).ok())
                .map(|idea| {
                    let mut s = String::new();
                    if let Some(desc) = &idea.description {
                        s.push_str(desc);
                        s.push('\n');
                    }
                    if let Some(reasoning) = &idea.reasoning {
                        s.push_str(reasoning);
                        s.push('\n');
                    }
                    s
                });

            let goal_context = task
                .goal_id
                .as_deref()
                .and_then(|goal_id| repo::get_goal_by_id(&pool, goal_id).ok())
                .map(|goal| {
                    let mut s = goal.title.to_string();
                    if let Some(desc) = &goal.description {
                        s.push_str(&format!(": {desc}"));
                    }
                    s.push('\n');
                    s
                });

            let codebase_context = {
                let contexts = repo::list_contexts_by_project(&pool, &project_id, None)
                    .unwrap_or_default();
                if contexts.is_empty() {
                    None
                } else {
                    let mut s = String::new();
                    for ctx in &contexts {
                        s.push_str(&format!("### {}\n", ctx.name));
                        if let Some(desc) = &ctx.description {
                            s.push_str(&format!("{desc}\n"));
                        }
                        s.push_str(&format!("Files: {}\n\n", ctx.file_paths));
                    }
                    Some(s)
                }
            };

            let prompt_text = build_task_prompt(
                &task.title,
                task.description.as_deref(),
                idea_context,
                goal_context,
                codebase_context,
            );

            // Mark task as running
            let now = chrono::Utc::now().to_rfc3339();
            let _ = repo::update_task(
                &pool,
                &tid,
                None,
                None,
                Some("running"),
                None,
                Some(0),
                None,
                None,
                Some(Some(&now)),
                None,
            );

            let cancel_token = CancellationToken::new();
            if TASK_EXEC_JOBS
                .insert_running(tid.clone(), cancel_token.clone(), TaskExecExtra)
                .is_err()
            {
                return;
            }
            TASK_EXEC_JOBS.set_status(&app_handle, &tid, "running", None);

            let result = tokio::select! {
                _ = cancel_token.cancelled() => {
                    Err(AppError::Internal("Task execution cancelled by user".into()))
                }
                res = run_task_execution(
                    &app_handle,
                    &tid,
                    &pool,
                    &project.root_path,
                    prompt_text,
                ) => res
            };

            let completed_now = chrono::Utc::now().to_rfc3339();
            let goal_id = task.goal_id.clone();

            match result {
                Ok(line_count) => {
                    let _ = repo::update_task(
                        &pool,
                        &tid,
                        None,
                        None,
                        Some("completed"),
                        None,
                        Some(100),
                        Some(line_count),
                        None,
                        None,
                        Some(Some(&completed_now)),
                    );
                    TASK_EXEC_JOBS.set_status(&app_handle, &tid, "completed", None);
                    let _ = app_handle.emit(
                        event_name::TASK_EXEC_COMPLETE,
                        json!({ "task_id": tid, "output_lines": line_count }),
                    );

                    if let Some(ref gid) = goal_id {
                        let _ = repo::create_goal_signal(
                            &pool,
                            gid,
                            "task_completed",
                            Some(&tid),
                            Some(10),
                            Some("Task completed successfully"),
                        );
                    }
                }
                Err(e) => {
                    let msg = format!("{e}");
                    let _ = repo::update_task(
                        &pool,
                        &tid,
                        None,
                        None,
                        Some("failed"),
                        None,
                        None,
                        None,
                        Some(Some(&msg)),
                        None,
                        Some(Some(&completed_now)),
                    );
                    TASK_EXEC_JOBS.set_status(&app_handle, &tid, "failed", Some(msg.clone()));
                    TASK_EXEC_JOBS.emit_line(&app_handle, &tid, format!("[Error] {msg}"));

                    if let Some(ref gid) = goal_id {
                        let _ = repo::create_goal_signal(
                            &pool,
                            gid,
                            "task_failed",
                            Some(&tid),
                            None,
                            Some(&msg),
                        );
                    }
                }
            }
        });
    }

    Ok(json!({ "batch_id": batch_id, "started": started }))
}

#[tauri::command]
pub async fn dev_tools_cancel_task_execution(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    task_id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;

    if let Some(token) = TASK_EXEC_JOBS.get_cancel_token(&task_id)? {
        token.cancel();
        TASK_EXEC_JOBS.set_status(&app, &task_id, "cancelled", None);
        let now = chrono::Utc::now().to_rfc3339();
        let _ = repo::update_task(
            &state.db,
            &task_id,
            None,
            None,
            Some("cancelled"),
            None,
            None,
            None,
            Some(Some("Cancelled by user")),
            None,
            Some(Some(&now)),
        );
        Ok(true)
    } else {
        Ok(false)
    }
}

// =============================================================================
// Core task execution logic
// =============================================================================

async fn run_task_execution(
    app: &tauri::AppHandle,
    task_id: &str,
    pool: &crate::db::DbPool,
    root_path: &str,
    prompt_text: String,
) -> Result<i32, AppError> {
    TASK_EXEC_JOBS.emit_line(app, task_id, "[Milestone] Starting task execution...");

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let exec_dir = std::path::PathBuf::from(root_path);
    let mut cmd = Command::new(&cli_args.command);
    cmd.args(&cli_args.args)
        .current_dir(&exec_dir)
        .kill_on_drop(true)
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
    for (key, val) in &cli_args.env_overrides {
        cmd.env(key, val);
    }

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::Internal(
                "Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code"
                    .into(),
            )
        } else {
            AppError::Internal(format!("Failed to spawn Claude CLI: {e}"))
        }
    })?;

    TASK_EXEC_JOBS.emit_line(app, task_id, "[Milestone] Claude CLI started. Executing...");

    // Write prompt to stdin in separate task to prevent pipe deadlock
    if let Some(mut stdin) = child.stdin.take() {
        let prompt_bytes = prompt_text.into_bytes();
        tokio::spawn(async move {
            let _ = stdin.write_all(&prompt_bytes).await;
            let _ = stdin.shutdown().await;
        });
    }

    // Drain stderr
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut buf = String::new();
            let _ = tokio::io::AsyncReadExt::read_to_string(&mut reader, &mut buf).await;
        });
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("Missing stdout pipe".into()))?;
    let mut reader = BufReader::new(stdout).lines();

    let mut output_lines = 0i32;

    let timeout_duration = std::time::Duration::from_secs(600); // 10 min for tasks
    let stream_result = tokio::time::timeout(timeout_duration, async {
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            if let Some(text) = extract_display_text(&line) {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    continue;
                }

                output_lines += 1;
                TASK_EXEC_JOBS.emit_line(app, task_id, trimmed.to_string());

                // Update progress estimate based on output lines
                if output_lines % 10 == 0 {
                    let progress = output_lines.min(90).min(95);
                    let _ = repo::update_task(
                        pool,
                        task_id,
                        None,
                        None,
                        None,
                        None,
                        Some(progress),
                        Some(output_lines),
                        None,
                        None,
                        None,
                    );
                }
            } else {
                let (line_type, _) = parse_stream_line(&line);
                match line_type {
                    StreamLineType::AssistantToolUse {
                        tool_name,
                        input_preview,
                    } => {
                        let preview = &input_preview[..input_preview.len().min(100)];
                        TASK_EXEC_JOBS.emit_line(
                            app,
                            task_id,
                            format!("[Tool] {tool_name}: {preview}"),
                        );
                        output_lines += 1;
                    }
                    StreamLineType::Result { .. } => {
                        TASK_EXEC_JOBS.emit_line(app, task_id, "[Milestone] Task complete.");
                    }
                    _ => {}
                }
            }
        }
    })
    .await;

    let _ = child.wait().await;

    if stream_result.is_err() {
        return Err(AppError::Internal(
            "Task execution timed out after 10 minutes".into(),
        ));
    }

    TASK_EXEC_JOBS.emit_line(
        app,
        task_id,
        format!("[Complete] Task finished with {output_lines} output lines"),
    );

    Ok(output_lines)
}
