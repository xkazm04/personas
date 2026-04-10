//! Context Map generation via Claude CLI.
//!
//! Spawns a Claude CLI process with a codebase analysis prompt. The LLM
//! analyzes the project's file structure, identifies business-feature contexts,
//! and creates DevContextGroup + DevContext entries via protocol messages.
//! Progress is streamed to the frontend via Tauri events.

use std::sync::Arc;

use serde::Serialize;
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
struct ContextGenExtra;

static CONTEXT_GEN_JOBS: BackgroundJobManager<ContextGenExtra> = BackgroundJobManager::new(
    "context-generation lock poisoned",
    event_name::CONTEXT_GEN_STATUS,
    event_name::CONTEXT_GEN_OUTPUT,
);

// =============================================================================
// Prompt
// =============================================================================

fn build_context_generation_prompt(
    project_id: &str,
    project_name: &str,
    root_path: &str,
    existing_context_summary: Option<&str>,
) -> String {
    let mode_section = if let Some(summary) = existing_context_summary {
        format!(
            r#"
## RESCAN MODE — Existing Context Map

This project already has a context map. Review the existing contexts below and
**intelligently update** them rather than creating everything from scratch:

{summary}

### Rescan Rules
- Keep groups/contexts whose files still exist and mapping is still accurate
- Update file lists if new files appeared or old files were removed/renamed
- Add new contexts for newly discovered features
- Remove contexts whose files no longer exist
- Update descriptions if the code's purpose has evolved
- Output protocol messages ONLY for changes (new groups, new contexts, updated contexts)

To update an existing context, use:
```
{{"context_map_update": {{"context_id": "<id>", "description": "...", "file_paths": [...], "keywords": [...]}}}}
```
"#
        )
    } else {
        String::new()
    };

    format!(
        r#"# Context Map Generator

You are analyzing a codebase to create a **Context Map** — a structured inventory of business-feature contexts that maps the codebase into logical, domain-driven groups.

## Project Information
- **Project ID**: {project_id}
- **Project Name**: {project_name}
- **Root Path**: {root_path}
{mode_section}
## Your Task

1. **Explore the codebase** at the root path using the file system tools available to you.
2. **Identify business-feature contexts** — NOT architectural layers. Group by what the code DOES (e.g., "User Authentication", "Payment Processing", "Dashboard Analytics"), not by code structure (e.g., "components", "utils", "hooks").
3. **Create Context Groups** using the protocol messages below.
4. **Create Contexts** within each group, listing the relevant files, entry points, keywords, and tech stack.

## Context Group Guidelines
- Create 4-10 groups representing major **business domains** (not layers)
- **Naming**: Use Title Case, domain-oriented names (e.g., "User Authentication", "Payment Processing", "Analytics Dashboard"). Never use technical layer names like "Components", "Hooks", "Utils"
- Each group should have a color from: red, orange, amber, emerald, blue, indigo, violet, pink
- Groups should be mutually exclusive (a file should belong to only one context)

## Context Guidelines
- **Granularity**: Each context should contain **5-15 related files** (prefer smaller, focused contexts over large catch-alls). If a context exceeds 15 files, split it into sub-contexts
- **Naming**: Use kebab-style descriptive names (e.g., "login-flow", "invoice-generation", "metric-aggregation")
- **Description (REQUIRED)**: Write 2-3 sentences explaining: (1) what business problem this code solves, (2) how it works at a high level, (3) key dependencies or data flows
- **file_paths**: JSON array of relative paths. Be precise — list individual files, not directories
- **entry_points**: The 1-3 files a developer would read first to understand this context
- **keywords**: 5-10 domain terms that would help search (e.g., "oauth", "jwt", "session", "login", "2fa")
- **db_tables**: If this context reads/writes database tables, list them (e.g., ["users", "sessions", "auth_tokens"])
- **api_surface**: If this context exposes or consumes APIs, describe them briefly (e.g., "POST /api/auth/login, GET /api/auth/session")
- **cross_refs**: List other context names this code depends on or is depended on by (e.g., ["user-profile", "notification-service"])

## Protocol Messages

Output these JSON objects on their own lines in your response:

To create a context group:
```
{{"context_map_group": {{"project_id": "{project_id}", "name": "Group Name", "color": "amber"}}}}
```

To create a context within a group:
```
{{"context_map_context": {{"project_id": "{project_id}", "group_name": "Group Name", "name": "context-name", "description": "2-3 sentence description of business purpose, how it works, and key dependencies", "file_paths": ["src/foo.ts", "src/bar.ts"], "entry_points": ["src/foo.ts"], "keywords": ["authentication", "login"], "db_tables": ["users", "sessions"], "api_surface": "POST /api/auth/login", "cross_refs": ["user-profile"], "tech_stack": ["React", "TypeScript"]}}}}
```

At the end, output a summary:
```
{{"context_map_summary": {{"groups_created": N, "contexts_created": N, "files_mapped": N}}}}
```

## Process
1. First, list the top-level directory structure
2. Read key files (package.json, Cargo.toml, README, etc.) to understand the project
3. Explore each major directory to understand its purpose
4. Design the context map groups
5. Output the group and context creation protocol messages
6. Output the summary

## Quality Rules
- Be thorough but efficient — read directory listings before diving into individual files
- Focus on source code directories, skip node_modules, target, dist, build, .git
- Each file should appear in exactly one context
- Prefer business-domain grouping over technical-layer grouping
- The file_paths in each context should be relative to the project root
- Every context MUST have a description — no empty or placeholder descriptions
- If a context has more than 15 files, split it into focused sub-contexts
- For each context, populate db_tables if it touches a database, api_surface if it exposes/calls APIs, and cross_refs for dependencies between contexts
- Use kebab-case for context names (e.g., "user-auth-flow" not "User Auth Flow")
- Use Title Case for group names (e.g., "User Management" not "user-management")

Begin by exploring the codebase structure."#
    )
}

// =============================================================================
// Protocol message parsing
// =============================================================================

#[derive(Debug)]
enum ContextMapProtocol {
    Group {
        project_id: String,
        name: String,
        color: String,
    },
    Context {
        project_id: String,
        group_name: String,
        name: String,
        description: Option<String>,
        file_paths: Vec<String>,
        entry_points: Vec<String>,
        keywords: Vec<String>,
        db_tables: Vec<String>,
        api_surface: Option<String>,
        cross_refs: Vec<String>,
        tech_stack: Vec<String>,
    },
    #[allow(dead_code)]
    Update {
        context_id: String,
        description: Option<String>,
        file_paths: Option<Vec<String>>,
        keywords: Option<Vec<String>>,
    },
    Summary {
        groups_created: i32,
        contexts_created: i32,
        files_mapped: i32,
    },
}

fn parse_context_map_protocol(text: &str) -> Option<ContextMapProtocol> {
    let val: serde_json::Value = serde_json::from_str(text).ok()?;

    if let Some(group) = val.get("context_map_group") {
        return Some(ContextMapProtocol::Group {
            project_id: group.get("project_id")?.as_str()?.to_string(),
            name: group.get("name")?.as_str()?.to_string(),
            color: group
                .get("color")
                .and_then(|c| c.as_str())
                .unwrap_or("amber")
                .to_string(),
        });
    }

    if let Some(ctx) = val.get("context_map_context") {
        let arr_to_vec = |key: &str| -> Vec<String> {
            ctx.get(key)
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default()
        };

        return Some(ContextMapProtocol::Context {
            project_id: ctx.get("project_id")?.as_str()?.to_string(),
            group_name: ctx.get("group_name")?.as_str()?.to_string(),
            name: ctx.get("name")?.as_str()?.to_string(),
            description: ctx
                .get("description")
                .and_then(|d| d.as_str())
                .map(|s| s.to_string()),
            file_paths: arr_to_vec("file_paths"),
            entry_points: arr_to_vec("entry_points"),
            keywords: arr_to_vec("keywords"),
            db_tables: arr_to_vec("db_tables"),
            api_surface: ctx.get("api_surface").and_then(|v| v.as_str()).map(|s| s.to_string()),
            cross_refs: arr_to_vec("cross_refs"),
            tech_stack: arr_to_vec("tech_stack"),
        });
    }

    if let Some(upd) = val.get("context_map_update") {
        let opt_arr = |key: &str| -> Option<Vec<String>> {
            upd.get(key).and_then(|v| v.as_array()).map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
        };
        return Some(ContextMapProtocol::Update {
            context_id: upd.get("context_id")?.as_str()?.to_string(),
            description: upd
                .get("description")
                .and_then(|d| d.as_str())
                .map(|s| s.to_string()),
            file_paths: opt_arr("file_paths"),
            keywords: opt_arr("keywords"),
        });
    }

    if let Some(summary) = val.get("context_map_summary") {
        return Some(ContextMapProtocol::Summary {
            groups_created: summary
                .get("groups_created")
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32,
            contexts_created: summary
                .get("contexts_created")
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32,
            files_mapped: summary
                .get("files_mapped")
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32,
        });
    }

    None
}

/// Build a summary of existing contexts for rescan mode.
fn build_existing_context_summary(pool: &crate::db::DbPool, project_id: &str) -> Option<String> {
    let groups = repo::list_context_groups(pool, project_id).ok()?;
    let contexts = repo::list_contexts_by_project(pool, project_id, None).ok()?;
    if groups.is_empty() && contexts.is_empty() {
        return None;
    }

    let mut summary = String::new();
    for group in &groups {
        summary.push_str(&format!(
            "\n### Group: {} (id: {}, color: {})\n",
            group.name, group.id, group.color
        ));
        let group_ctxs: Vec<_> = contexts
            .iter()
            .filter(|c| c.group_id.as_deref() == Some(&group.id))
            .collect();
        for ctx in group_ctxs {
            summary.push_str(&format!(
                "- **{}** (id: {}): {} | files: {}\n",
                ctx.name,
                ctx.id,
                ctx.description.as_deref().unwrap_or("no description"),
                ctx.file_paths,
            ));
        }
    }

    let ungrouped: Vec<_> = contexts.iter().filter(|c| c.group_id.is_none()).collect();
    if !ungrouped.is_empty() {
        summary.push_str("\n### Ungrouped Contexts\n");
        for ctx in ungrouped {
            summary.push_str(&format!(
                "- **{}** (id: {}): {} | files: {}\n",
                ctx.name,
                ctx.id,
                ctx.description.as_deref().unwrap_or("no description"),
                ctx.file_paths,
            ));
        }
    }

    Some(summary)
}

// =============================================================================
// Tauri commands
// =============================================================================

#[derive(Clone, Serialize)]
struct ContextGenSummary {
    scan_id: String,
    groups_created: i32,
    contexts_created: i32,
    files_mapped: i32,
    status: String,
    error: Option<String>,
}

#[tauri::command]
pub async fn dev_tools_scan_codebase(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    project_id: String,
    root_path: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;

    let project = repo::get_project_by_id(&state.db, &project_id)?;

    let scan_id = uuid::Uuid::new_v4().to_string();
    let cancel_token = CancellationToken::new();
    CONTEXT_GEN_JOBS.insert_running(scan_id.clone(), cancel_token.clone(), ContextGenExtra)?;
    CONTEXT_GEN_JOBS.set_status(&app, &scan_id, "running", None);

    // Resolve root path
    let resolved_root = if root_path == "." || root_path.is_empty() {
        project.root_path.clone()
    } else {
        root_path
    };

    // Validate directory
    let root_dir = std::path::Path::new(&resolved_root);
    if !root_dir.is_dir() {
        CONTEXT_GEN_JOBS.set_status(
            &app,
            &scan_id,
            "failed",
            Some("Path is not a directory".to_string()),
        );
        return Err(AppError::Validation(format!(
            "Path is not a directory: {resolved_root}"
        )));
    }

    // Check for existing contexts (rescan mode)
    let existing_summary = build_existing_context_summary(&state.db, &project_id);
    let is_rescan = existing_summary.is_some();

    let app_handle = app.clone();
    let pool = state.db.clone();
    let scan_id_for_task = scan_id.clone();
    let token_for_task = cancel_token;
    let project_name = project.name.clone();

    tokio::spawn(async move {
        let result = tokio::select! {
            _ = token_for_task.cancelled() => {
                Err(AppError::Internal("Context generation cancelled by user".into()))
            }
            res = run_context_generation(
                &app_handle,
                &scan_id_for_task,
                &pool,
                &project_id,
                &project_name,
                &resolved_root,
                existing_summary.as_deref(),
            ) => res
        };

        match result {
            Ok(summary) => {
                let is_warning = summary.status == "completed_with_warning";
                let status_str = if is_warning { "completed_with_warning" } else { "completed" };
                CONTEXT_GEN_JOBS.set_status(
                    &app_handle,
                    &scan_id_for_task,
                    status_str,
                    summary.error.clone(),
                );
                let _ = app_handle.emit(event_name::CONTEXT_GEN_COMPLETE, &summary);
                // OS notification
                let title = if is_warning { "Context Map Ready (with warning)" } else { "Context Map Ready" };
                let body = if is_warning {
                    format!(
                        "{}: {} groups, {} contexts mapped (scan exceeded timeout — partial results saved).",
                        project_name, summary.groups_created, summary.contexts_created,
                    )
                } else {
                    format!(
                        "{}: {} groups, {} contexts mapped.",
                        project_name, summary.groups_created, summary.contexts_created,
                    )
                };
                crate::notifications::send(&app_handle, title, &body);
            }
            Err(e) => {
                let msg = format!("{e}");
                CONTEXT_GEN_JOBS.set_status(
                    &app_handle,
                    &scan_id_for_task,
                    "failed",
                    Some(msg.clone()),
                );
                CONTEXT_GEN_JOBS.emit_line(
                    &app_handle,
                    &scan_id_for_task,
                    format!("[Error] {msg}"),
                );
                crate::notifications::send(
                    &app_handle,
                    "Context Scan Failed",
                    &format!("{project_name}: {msg}"),
                );
            }
        }
    });

    Ok(json!({ "scan_id": scan_id, "is_rescan": is_rescan }))
}

#[tauri::command]
pub async fn dev_tools_cancel_scan_codebase(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    scan_id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    if let Some(token) = CONTEXT_GEN_JOBS.get_cancel_token(&scan_id)? {
        token.cancel();
        CONTEXT_GEN_JOBS.set_status(&app, &scan_id, "cancelled", None);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub fn dev_tools_get_scan_codebase_status(
    state: State<'_, Arc<AppState>>,
    scan_id: String,
) -> Result<serde_json::Value, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    let jobs = CONTEXT_GEN_JOBS.lock()?;
    if let Some(job) = jobs.get(&scan_id) {
        Ok(json!({
            "scan_id": scan_id,
            "status": job.status,
            "error": job.error,
            "lines": job.lines,
        }))
    } else {
        Ok(json!({ "scan_id": scan_id, "status": "not_found" }))
    }
}

// =============================================================================
// Core generation logic
// =============================================================================

async fn run_context_generation(
    app: &tauri::AppHandle,
    scan_id: &str,
    pool: &crate::db::DbPool,
    project_id: &str,
    project_name: &str,
    root_path: &str,
    existing_summary: Option<&str>,
) -> Result<ContextGenSummary, AppError> {
    let is_rescan = existing_summary.is_some();
    if is_rescan {
        CONTEXT_GEN_JOBS.emit_line(
            app,
            scan_id,
            "[Milestone] Rescan: clearing old context map...".to_string(),
        );
        match repo::clear_project_context_map(pool, project_id) {
            Ok((grp, ctx)) => {
                CONTEXT_GEN_JOBS.emit_line(
                    app,
                    scan_id,
                    format!("[Milestone] Cleared {grp} groups, {ctx} contexts. Regenerating fresh..."),
                );
            }
            Err(e) => {
                CONTEXT_GEN_JOBS.emit_line(
                    app,
                    scan_id,
                    format!("[Warn] Failed to clear old context map: {e}. Continuing anyway..."),
                );
            }
        }
    }

    let mode_label = if is_rescan { "Rescanning" } else { "Scanning" };
    CONTEXT_GEN_JOBS.emit_line(
        app,
        scan_id,
        format!("[Milestone] {mode_label} codebase: {project_name}..."),
    );

    // Always generate fresh — on rescan we cleared old data above, so no
    // existing_summary needed. This avoids the "Ungrouped" problem where the
    // LLM tries to reference existing group/context IDs that are gone.
    let prompt_text =
        build_context_generation_prompt(project_id, project_name, root_path, None);

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    // Spawn CLI in the project root so Claude can explore it
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

    CONTEXT_GEN_JOBS.emit_line(
        app,
        scan_id,
        "[Milestone] Claude CLI started. Analyzing codebase...",
    );

    // --- FIX: Write prompt in a separate task to prevent pipe deadlock ---
    // The stdin write MUST happen concurrently with stdout reads. If we await
    // stdin.write_all inline, large prompts can fill the pipe buffer and block
    // because the child is waiting to write stdout (which nobody is reading yet).
    // Spawning the write in a separate task allows both pipes to drain concurrently.
    if let Some(mut stdin) = child.stdin.take() {
        let prompt_bytes = prompt_text.into_bytes();
        tokio::spawn(async move {
            let _ = stdin.write_all(&prompt_bytes).await;
            let _ = stdin.shutdown().await;
            // stdin is dropped here, signalling EOF to the child process
        });
    }

    // Capture stderr in background
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut buf = String::new();
            let _ = tokio::io::AsyncReadExt::read_to_string(&mut reader, &mut buf).await;
        });
    }

    // Stream stdout line by line
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("Missing stdout pipe".into()))?;
    let mut reader = BufReader::new(stdout).lines();

    let mut group_name_to_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let mut groups_created = 0i32;
    let mut contexts_created = 0i32;
    let mut files_mapped = 0i32;

    // Extended to 30 minutes to handle large codebases.
    // If timeout fires but contexts were already committed, the scan is treated
    // as a partial success (see check below after the loop).
    let timeout_duration = std::time::Duration::from_secs(1800);
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

                // Emit display text to frontend
                CONTEXT_GEN_JOBS.emit_line(app, scan_id, trimmed.to_string());

                // Parse protocol messages from assistant output
                for proto_line in trimmed.lines() {
                    let proto_trimmed = proto_line.trim();
                    if let Some(protocol) = parse_context_map_protocol(proto_trimmed) {
                        match protocol {
                            ContextMapProtocol::Group { project_id: pid, name, color } => {
                                match repo::create_context_group(pool, &pid, &name, Some(&color), None, None) {
                                    Ok(group) => {
                                        group_name_to_id.insert(name.clone(), group.id.clone());
                                        groups_created += 1;
                                        CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!("[Created] Group: {name}"));
                                    }
                                    Err(e) => {
                                        tracing::warn!(error = %e, "Failed to create context group: {name}");
                                        CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!("[Warn] Group '{name}': {e}"));
                                    }
                                }
                            }
                            ContextMapProtocol::Context {
                                project_id: pid, group_name, name, description,
                                file_paths, entry_points, keywords, db_tables,
                                api_surface, cross_refs, tech_stack,
                            } => {
                                let group_id = group_name_to_id.get(&group_name).cloned();
                                let file_count = file_paths.len() as i32;
                                let fp_json = serde_json::to_string(&file_paths).unwrap_or_else(|_| "[]".into());
                                let ep_json = serde_json::to_string(&entry_points).unwrap_or_else(|_| "[]".into());
                                let kw_json = serde_json::to_string(&keywords).unwrap_or_else(|_| "[]".into());
                                let db_json = if db_tables.is_empty() { None } else { Some(serde_json::to_string(&db_tables).unwrap_or_else(|_| "[]".into())) };
                                let cr_json = if cross_refs.is_empty() { None } else { Some(serde_json::to_string(&cross_refs).unwrap_or_else(|_| "[]".into())) };
                                let ts_json = serde_json::to_string(&tech_stack).unwrap_or_else(|_| "[]".into());

                                match repo::create_context(
                                    pool, &pid, &name, group_id.as_deref(), description.as_deref(),
                                    Some(&fp_json), Some(&ep_json), db_json.as_deref(), Some(&kw_json), api_surface.as_deref(), cr_json.as_deref(), Some(&ts_json),
                                ) {
                                    Ok(_) => {
                                        contexts_created += 1;
                                        files_mapped += file_count;
                                        CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!("[Created] Context: {name} ({file_count} files)"));
                                    }
                                    Err(e) => {
                                        tracing::warn!(error = %e, "Failed to create context: {name}");
                                        CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!("[Warn] Context '{name}': {e}"));
                                    }
                                }
                            }
                            ContextMapProtocol::Update { context_id, description, file_paths, keywords } => {
                                let fp_json = file_paths.map(|fp| serde_json::to_string(&fp).unwrap_or_else(|_| "[]".into()));
                                let kw_json = keywords.map(|kw| serde_json::to_string(&kw).unwrap_or_else(|_| "[]".into()));
                                match repo::update_context(
                                    pool, &context_id,
                                    None, // name
                                    description.as_ref().map(|d| Some(d.as_str())),
                                    fp_json.as_deref(),
                                    None, None,
                                    kw_json.as_ref().map(|k| Some(k.as_str())),
                                    None, None, None,
                                ) {
                                    Ok(_) => {
                                        CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!("[Updated] Context: {context_id}"));
                                    }
                                    Err(e) => {
                                        tracing::warn!(error = %e, "Failed to update context: {context_id}");
                                    }
                                }
                            }
                            ContextMapProtocol::Summary { groups_created: g, contexts_created: c, files_mapped: f } => {
                                CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!("[Summary] {g} groups, {c} contexts, {f} files mapped"));
                            }
                        }
                    }
                }
            } else {
                // Surface tool usage and result events
                let (line_type, _) = parse_stream_line(&line);
                match line_type {
                    StreamLineType::AssistantToolUse { tool_name, input_preview } => {
                        let preview = &input_preview[..input_preview.len().min(100)];
                        CONTEXT_GEN_JOBS.emit_line(app, scan_id, format!("[Tool] {tool_name}: {preview}"));
                    }
                    StreamLineType::Result { .. } => {
                        CONTEXT_GEN_JOBS.emit_line(app, scan_id, "[Milestone] Analysis complete.");
                    }
                    _ => {}
                }
            }
        }
    })
    .await;

    // On timeout, kill the child explicitly to avoid zombie processes.
    if stream_result.is_err() {
        let _ = child.kill().await;
    }
    let _ = tokio::time::timeout(std::time::Duration::from_secs(5), child.wait()).await;

    let timed_out = stream_result.is_err();

    // Smart timeout handling: if any work was committed, treat the scan as a
    // partial success rather than a hard failure. The user can see the contexts
    // in the database, so reporting "failed" would be misleading.
    if timed_out {
        if groups_created > 0 || contexts_created > 0 {
            CONTEXT_GEN_JOBS.emit_line(
                app,
                scan_id,
                format!(
                    "[Warning] Scan timed out after 30 minutes but {groups_created} groups and {contexts_created} contexts were created. Treating as partial success."
                ),
            );
            return Ok(ContextGenSummary {
                scan_id: scan_id.to_string(),
                groups_created,
                contexts_created,
                files_mapped,
                status: "completed_with_warning".to_string(),
                error: Some("Scan exceeded 30-minute timeout but partial results were saved".to_string()),
            });
        }
        return Err(AppError::Internal(
            "Context generation timed out after 30 minutes with no contexts created".into(),
        ));
    }

    CONTEXT_GEN_JOBS.emit_line(
        app,
        scan_id,
        format!(
            "[Complete] Created {groups_created} groups, {contexts_created} contexts, {files_mapped} files mapped"
        ),
    );

    Ok(ContextGenSummary {
        scan_id: scan_id.to_string(),
        groups_created,
        contexts_created,
        files_mapped,
        status: "completed".to_string(),
        error: None,
    })
}
