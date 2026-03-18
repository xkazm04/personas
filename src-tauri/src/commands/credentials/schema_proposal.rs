use std::sync::Arc;

use tauri::{Emitter, State};
use tokio_util::sync::CancellationToken;

use serde::Serialize;

use crate::background_job::BackgroundJobManager;
use crate::commands::design::n8n_transform::run_claude_prompt_text_inner;
use crate::engine::db_query;
use crate::engine::prompt;
use crate::error::AppError;
use crate::ipc_auth::require_privileged;
use crate::AppState;

// -- Job-specific extra state --------------------------------------------

#[derive(Clone, Default)]
pub struct SchemaProposalExtra {
    pub proposed_sql: Option<String>,
    pub explanation: Option<String>,
}

/// Schema proposal-specific extras flattened into BackgroundTaskSnapshot.
#[derive(Clone, Serialize)]
struct SchemaProposalSnapshotExtras {
    proposed_sql: Option<String>,
    explanation: Option<String>,
}

// -- Static job manager --------------------------------------------------

static SCHEMA_PROPOSAL_JOBS: BackgroundJobManager<SchemaProposalExtra> =
    BackgroundJobManager::new(
        "schema proposal job lock",
        "schema-proposal-status",
        "schema-proposal-output",
    );

/// List all schema proposal job snapshots (for unified workflows view).
pub fn list_schema_proposal_jobs() -> Vec<crate::background_job::JobSnapshot> {
    SCHEMA_PROPOSAL_JOBS.list_snapshots()
}

/// Cancel a schema proposal job (called from unified workflows dispatcher).
pub fn cancel_schema_proposal_job(app: &tauri::AppHandle, proposal_id: &str) -> Result<(), AppError> {
    SCHEMA_PROPOSAL_JOBS.cancel(app, proposal_id)
}

// -- Tauri commands ------------------------------------------------------

#[tauri::command]
pub async fn start_schema_proposal(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    proposal_id: String,
    template_name: String,
    template_context: String,
    existing_tables: Vec<String>,
    database_type: Option<String>,
) -> Result<(), AppError> {
    require_privileged(&state, "start_schema_proposal").await?;
    SCHEMA_PROPOSAL_JOBS.ensure_not_running(&proposal_id)?;

    let cancel_token = CancellationToken::new();
    SCHEMA_PROPOSAL_JOBS.insert_running(
        proposal_id.clone(),
        cancel_token.clone(),
        SchemaProposalExtra::default(),
    )?;
    SCHEMA_PROPOSAL_JOBS.set_status(&app, &proposal_id, "running", None);

    let pool = state.db.clone();
    let user_db = state.user_db.clone();

    tokio::spawn(async move {
        run_schema_proposal(RunParams {
            app,
            pool,
            user_db,
            proposal_id,
            template_name,
            template_context,
            existing_tables,
            database_type,
            cancel_token,
        })
        .await;
    });

    Ok(())
}

#[tauri::command]
pub async fn get_schema_proposal_snapshot(
    state: State<'_, Arc<AppState>>,
    proposal_id: String,
) -> Result<serde_json::Value, AppError> {
    require_privileged(&state, "get_schema_proposal_snapshot").await?;

    let snapshot = SCHEMA_PROPOSAL_JOBS.get_task_snapshot(&proposal_id, |extra| {
        SchemaProposalSnapshotExtras {
            proposed_sql: extra.proposed_sql.clone(),
            explanation: extra.explanation.clone(),
        }
    });

    Ok(match snapshot {
        Some(s) => serde_json::to_value(s).unwrap_or_else(|_| serde_json::json!({})),
        None => serde_json::json!({
            "job_id": proposal_id,
            "status": "idle",
            "error": null,
            "lines": [],
            "proposed_sql": null,
            "explanation": null,
        }),
    })
}

#[tauri::command]
pub async fn cancel_schema_proposal(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    proposal_id: String,
) -> Result<(), AppError> {
    require_privileged(&state, "cancel_schema_proposal").await?;
    SCHEMA_PROPOSAL_JOBS.cancel_or_preempt(&app, &proposal_id, SchemaProposalExtra::default())
}

#[tauri::command]
pub async fn validate_db_schema(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    expected_tables: Vec<String>,
) -> Result<serde_json::Value, AppError> {
    require_privileged(&state, "validate_db_schema").await?;

    let tables_result = db_query::introspect_tables(
        &state.db,
        &credential_id,
        Some(&state.user_db),
    )
    .await?;

    let name_idx = tables_result
        .columns
        .iter()
        .position(|c| c == "table_name")
        .unwrap_or(0);

    let existing: Vec<String> = tables_result
        .rows
        .iter()
        .filter_map(|row| row.get(name_idx).and_then(|v| v.as_str()).map(String::from))
        .collect();

    let mut missing: Vec<String> = Vec::new();
    let mut found: Vec<String> = Vec::new();
    for table in &expected_tables {
        let lower = table.to_lowercase();
        if existing.iter().any(|e| e.to_lowercase() == lower) {
            found.push(table.clone());
        } else {
            missing.push(table.clone());
        }
    }

    Ok(serde_json::json!({
        "valid": missing.is_empty(),
        "found": found,
        "missing": missing,
        "all_tables": existing,
    }))
}

// -- Internal logic ------------------------------------------------------

struct RunParams {
    app: tauri::AppHandle,
    pool: crate::db::DbPool,
    user_db: crate::db::UserDbPool,
    proposal_id: String,
    template_name: String,
    template_context: String,
    existing_tables: Vec<String>,
    database_type: Option<String>,
    cancel_token: CancellationToken,
}

async fn run_schema_proposal(params: RunParams) {
    let RunParams {
        app,
        pool,
        user_db,
        proposal_id,
        template_name,
        template_context,
        existing_tables,
        database_type,
        cancel_token,
    } = params;

    emit_line(&app, &proposal_id, "> Starting schema proposal...");

    // Build schema context from existing tables
    let schema_context = build_schema_context(&pool, &user_db).await;

    if cancel_token.is_cancelled() {
        emit_line(&app, &proposal_id, "> Cancelled.");
        return;
    }

    emit_line(
        &app,
        &proposal_id,
        &format!("> Analyzing template: {template_name}"),
    );

    // Build the AI prompt
    let system_prompt = build_prompt(
        &template_name,
        &template_context,
        &existing_tables,
        &schema_context,
        database_type.as_deref().unwrap_or("sqlite"),
    );

    // Build CLI args (no persona, default provider, fast model)
    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("1".to_string());

    let app_clone = app.clone();
    let id_clone = proposal_id.clone();
    let on_line = move |line: &str| {
        SCHEMA_PROPOSAL_JOBS.emit_line(&app_clone, &id_clone, line);
    };

    emit_line(&app, &proposal_id, "> Generating schema with AI...");

    let cli_result = run_claude_prompt_text_inner(
        system_prompt,
        &cli_args,
        Some(&on_line),
        None,
        None,
        120,
    )
    .await;

    if cancel_token.is_cancelled() {
        emit_line(&app, &proposal_id, "> Cancelled.");
        return;
    }

    match cli_result {
        Ok((output, _session_id, _)) => {
            // Extract SQL from code block
            let sql = extract_sql_block(&output);
            let explanation = extract_explanation(&output);

            match sql {
                Some(proposed_sql) => {
                    emit_line(
                        &app,
                        &proposal_id,
                        "> Schema proposal generated successfully.",
                    );

                    SCHEMA_PROPOSAL_JOBS.update_extra(&proposal_id, |extra| {
                        extra.proposed_sql = Some(proposed_sql.clone());
                        extra.explanation = explanation.clone();
                    });

                    // Emit completed status with data
                    let _ = app.emit(
                        "schema-proposal-status",
                        serde_json::json!({
                            "job_id": proposal_id,
                            "status": "completed",
                            "error": null,
                            "proposed_sql": proposed_sql,
                            "explanation": explanation,
                        }),
                    );

                    if let Ok(mut jobs) = SCHEMA_PROPOSAL_JOBS.lock() {
                        if let Some(job) = jobs.get_mut(&proposal_id) {
                            job.status = "completed".into();
                        }
                    }
                }
                None => {
                    emit_line(
                        &app,
                        &proposal_id,
                        "[ERROR] Could not extract SQL from AI response.",
                    );
                    SCHEMA_PROPOSAL_JOBS.set_status(
                        &app,
                        &proposal_id,
                        "failed",
                        Some("No SQL block found in AI response".into()),
                    );
                }
            }
        }
        Err(e) => {
            tracing::warn!(proposal_id = %proposal_id, "Schema proposal CLI failed: {}", e);
            emit_line(
                &app,
                &proposal_id,
                "[ERROR] AI schema proposal failed. See application logs.",
            );
            SCHEMA_PROPOSAL_JOBS.set_status(
                &app,
                &proposal_id,
                "failed",
                Some("AI schema proposal failed".into()),
            );
        }
    }
}

// -- Helpers --------------------------------------------------------------

fn emit_line(app: &tauri::AppHandle, proposal_id: &str, line: &str) {
    SCHEMA_PROPOSAL_JOBS.emit_line(app, proposal_id, line);
}

fn build_prompt(
    template_name: &str,
    template_context: &str,
    existing_tables: &[String],
    schema_context: &str,
    database_type: &str,
) -> String {
    let mut prompt = format!(
        "You are a database schema architect. Design the {database_type} database tables needed \
         for the \"{template_name}\" persona template.\n\n"
    );

    prompt.push_str("## Template Context\n");
    prompt.push_str(template_context);
    prompt.push_str("\n\n");

    if !existing_tables.is_empty() {
        prompt.push_str("## Existing Tables (do NOT recreate these)\n");
        for t in existing_tables {
            prompt.push_str(&format!("- {t}\n"));
        }
        prompt.push('\n');
    }

    if !schema_context.is_empty() {
        prompt.push_str("## Current Database Schema\n");
        prompt.push_str(schema_context);
        prompt.push_str("\n\n");
    }

    prompt.push_str(&format!(
        "## Instructions\n\
         1. Analyze the template context to determine what data the agent needs to persist\n\
         2. Design {database_type} CREATE TABLE statements with appropriate columns, types, and constraints\n\
         3. Use `IF NOT EXISTS` on all CREATE TABLE statements (or the {database_type} equivalent)\n\
         4. Include useful indexes for common query patterns\n\
         5. Use snake_case for all table and column names\n\
         6. Include `created_at` and `updated_at` timestamps appropriate for {database_type}\n\
         7. Output ALL SQL in a single ```sql code block\n\
         8. After the SQL block, briefly explain each table's purpose (2-3 sentences per table)\n\
         9. Do NOT recreate any tables that already exist\n\
         10. Keep the schema minimal -- only create tables the agent actually needs\n"
    ));

    prompt
}

/// Extract the SQL code block from Claude's output.
fn extract_sql_block(text: &str) -> Option<String> {
    let mut in_block = false;
    let mut is_sql = false;
    let mut content = String::new();
    let mut blocks: Vec<(String, bool)> = Vec::new();

    for line in text.lines() {
        if !in_block && line.trim_start().starts_with("```") {
            in_block = true;
            let tag = line
                .trim_start()
                .trim_start_matches('`')
                .trim()
                .to_lowercase();
            is_sql = tag.is_empty()
                || ["sql", "sqlite", "sqlite3"].iter().any(|t| tag == *t);
            continue;
        }
        if in_block {
            if line.trim_start().starts_with("```") {
                let trimmed = content.trim().to_string();
                if !trimmed.is_empty() {
                    blocks.push((trimmed, is_sql));
                }
                in_block = false;
                content.clear();
                continue;
            }
            content.push_str(line);
            content.push('\n');
        }
    }

    // Handle unclosed block
    let trimmed = content.trim().to_string();
    if in_block && !trimmed.is_empty() {
        blocks.push((trimmed, is_sql));
    }

    // Prefer SQL-tagged blocks; fall back to first block
    blocks
        .iter()
        .find(|(_, is_match)| *is_match)
        .or_else(|| blocks.first())
        .map(|(content, _)| content.clone())
}

/// Extract the explanation text that comes after the SQL code block.
fn extract_explanation(text: &str) -> Option<String> {
    let mut found_sql_block = false;
    let mut in_block = false;
    let mut explanation_lines: Vec<&str> = Vec::new();

    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            if in_block {
                in_block = false;
                found_sql_block = true;
                continue;
            }
            in_block = true;
            continue;
        }

        if found_sql_block && !in_block {
            explanation_lines.push(line);
        }
    }

    let explanation = explanation_lines.join("\n").trim().to_string();
    if explanation.is_empty() {
        None
    } else {
        Some(explanation)
    }
}

/// Build a text summary of available tables and columns for the prompt.
async fn build_schema_context(
    pool: &crate::db::DbPool,
    user_db: &crate::db::UserDbPool,
) -> String {
    // Use the built-in database credential for introspection
    let credential_id = "personas_database";

    let tables_result = match db_query::introspect_tables(pool, credential_id, Some(user_db)).await
    {
        Ok(r) => r,
        Err(_) => return String::new(),
    };

    let name_idx = match tables_result
        .columns
        .iter()
        .position(|c| c == "table_name")
    {
        Some(i) => i,
        None => return String::new(),
    };

    let table_names: Vec<String> = tables_result
        .rows
        .iter()
        .filter_map(|row| row.get(name_idx).and_then(|v| v.as_str()).map(String::from))
        .collect();

    if table_names.is_empty() {
        return String::new();
    }

    let mut ctx = String::new();

    for table_name in &table_names {
        let cols =
            match db_query::introspect_columns(pool, credential_id, table_name, Some(user_db))
                .await
            {
                Ok(r) => r,
                Err(_) => {
                    ctx.push_str(&format!("- {table_name}\n"));
                    continue;
                }
            };

        let col_name_idx = cols.columns.iter().position(|c| c == "column_name");
        let col_type_idx = cols
            .columns
            .iter()
            .position(|c| c == "data_type" || c == "column_type");

        if let (Some(ni), Some(ti)) = (col_name_idx, col_type_idx) {
            let col_strs: Vec<String> = cols
                .rows
                .iter()
                .filter_map(|row| {
                    let name = row.get(ni).and_then(|v| v.as_str())?;
                    let dtype = row.get(ti).and_then(|v| v.as_str()).unwrap_or("?");
                    Some(format!("{name} {dtype}"))
                })
                .collect();
            ctx.push_str(&format!("- {} ({})\n", table_name, col_strs.join(", ")));
        } else {
            ctx.push_str(&format!("- {table_name}\n"));
        }
    }

    ctx
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_sql_block_basic() {
        let text = "Here's the schema:\n```sql\nCREATE TABLE foo (id INTEGER PRIMARY KEY);\n```\nDone.";
        assert_eq!(
            extract_sql_block(text),
            Some("CREATE TABLE foo (id INTEGER PRIMARY KEY);".into()),
        );
    }

    #[test]
    fn test_extract_sql_block_bare() {
        let text = "```\nCREATE TABLE bar (id TEXT);\n```";
        assert_eq!(
            extract_sql_block(text),
            Some("CREATE TABLE bar (id TEXT);".into()),
        );
    }

    #[test]
    fn test_extract_sql_block_none() {
        let text = "No code blocks here.";
        assert_eq!(extract_sql_block(text), None);
    }

    #[test]
    fn test_extract_sql_block_prefers_sql_tag() {
        let text = "```javascript\nconsole.log('hi');\n```\n\n```sql\nCREATE TABLE t (x INT);\n```";
        assert_eq!(
            extract_sql_block(text),
            Some("CREATE TABLE t (x INT);".into()),
        );
    }

    #[test]
    fn test_extract_explanation() {
        let text = "Here:\n```sql\nCREATE TABLE t (id INT);\n```\n\nThe `t` table stores items.";
        let explanation = extract_explanation(text).unwrap();
        assert!(explanation.contains("The `t` table stores items."));
    }

    #[test]
    fn test_extract_explanation_none() {
        let text = "```sql\nCREATE TABLE t (id INT);\n```";
        // Only whitespace after block
        assert_eq!(extract_explanation(text), None);
    }
}
