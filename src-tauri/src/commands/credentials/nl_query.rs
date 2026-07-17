use std::sync::Arc;

use tauri::{Emitter, State};
use tokio_util::sync::CancellationToken;

use serde::Serialize;

use crate::background_job::BackgroundJobManager;
use crate::engine::ai_helpers;
use crate::engine::db_query;
use crate::engine::event_registry::event_name;
use crate::error::AppError;
use crate::AppState;
use personas_macros::requires;

// -- Job-specific extra state --------------------------------------------

#[derive(Clone, Default)]
pub struct NlQueryExtra {
    pub generated_sql: Option<String>,
    pub explanation: Option<String>,
}

#[derive(Clone, Serialize)]
struct NlQuerySnapshotExtras {
    generated_sql: Option<String>,
    explanation: Option<String>,
}

// -- Static job manager --------------------------------------------------

static NL_QUERY_JOBS: BackgroundJobManager<NlQueryExtra> = BackgroundJobManager::new(
    "nl query job lock",
    event_name::NL_QUERY_STATUS,
    event_name::NL_QUERY_OUTPUT,
);

/// List all NL query job snapshots (for unified workflows view).
#[allow(dead_code)]
pub fn list_nl_query_jobs() -> Vec<crate::background_job::JobSnapshot> {
    NL_QUERY_JOBS.list_snapshots()
}

/// Cancel an NL query job (called from unified workflows dispatcher).
#[allow(dead_code)]
pub fn cancel_nl_query_job(app: &tauri::AppHandle, query_id: &str) -> Result<(), AppError> {
    NL_QUERY_JOBS.cancel(app, query_id)
}

// -- Tauri commands ------------------------------------------------------

#[tauri::command]
#[requires(privileged)]
pub async fn start_nl_query(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    query_id: String,
    credential_id: String,
    question: String,
    conversation_history: Option<Vec<ConversationTurn>>,
    database_type: Option<String>,
) -> Result<(), AppError> {
    NL_QUERY_JOBS.ensure_not_running(&query_id)?;

    let cancel_token = CancellationToken::new();
    NL_QUERY_JOBS.insert_running(
        query_id.clone(),
        cancel_token.clone(),
        NlQueryExtra::default(),
    )?;
    NL_QUERY_JOBS.set_status(&app, &query_id, "running", None);

    let pool = state.db.clone();
    let user_db = state.user_db.clone();

    tokio::spawn(async move {
        run_nl_query(RunParams {
            app,
            pool,
            user_db,
            query_id,
            credential_id,
            question,
            conversation_history: conversation_history.unwrap_or_default(),
            database_type,
            cancel_token,
        })
        .await;
    });

    Ok(())
}

#[tauri::command]
#[requires(privileged)]
pub async fn get_nl_query_snapshot(
    state: State<'_, Arc<AppState>>,
    query_id: String,
) -> Result<serde_json::Value, AppError> {

    let snapshot = NL_QUERY_JOBS.get_task_snapshot(&query_id, |extra| NlQuerySnapshotExtras {
        generated_sql: extra.generated_sql.clone(),
        explanation: extra.explanation.clone(),
    });

    Ok(match snapshot {
        Some(s) => serde_json::to_value(s).unwrap_or_else(|_| serde_json::json!({})),
        None => serde_json::json!({
            "job_id": query_id,
            "status": "idle",
            "error": null,
            "lines": [],
            "generated_sql": null,
            "explanation": null,
        }),
    })
}

#[tauri::command]
#[requires(privileged)]
pub async fn cancel_nl_query(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    query_id: String,
) -> Result<(), AppError> {
    NL_QUERY_JOBS.cancel_or_preempt(&app, &query_id, NlQueryExtra::default())
}

// -- Types ---------------------------------------------------------------

#[derive(Clone, serde::Deserialize, Serialize)]
pub struct ConversationTurn {
    pub role: String,    // "user" or "assistant"
    pub content: String, // the message text
}

// -- Internal logic ------------------------------------------------------

struct RunParams {
    app: tauri::AppHandle,
    pool: crate::db::DbPool,
    user_db: crate::db::UserDbPool,
    query_id: String,
    credential_id: String,
    question: String,
    conversation_history: Vec<ConversationTurn>,
    database_type: Option<String>,
    cancel_token: CancellationToken,
}

async fn run_nl_query(params: RunParams) {
    let RunParams {
        app,
        pool,
        user_db,
        query_id,
        credential_id,
        question,
        conversation_history,
        database_type,
        cancel_token,
    } = params;

    emit_line(&app, &query_id, "> Analyzing your question...");

    // 1. Introspect the database schema for context
    let schema_context = build_db_schema_context(&pool, &user_db, &credential_id).await;

    if cancel_token.is_cancelled() {
        emit_line(&app, &query_id, "> Cancelled.");
        return;
    }

    let db_type = database_type.as_deref().unwrap_or("sql");

    emit_line(
        &app,
        &query_id,
        "> Generating query from your description...",
    );

    // 2. Build the AI prompt
    let system_prompt = build_nl_prompt(&question, &conversation_history, &schema_context, db_type);

    // 3. Run the AI helper (fast model, single turn -- shared scaffold)
    let app_clone = app.clone();
    let id_clone = query_id.clone();
    let on_line = move |line: &str| {
        NL_QUERY_JOBS.emit_line(&app_clone, &id_clone, line);
    };

    let cli_result = ai_helpers::run_single_turn_prompt(system_prompt, Some(&on_line)).await;

    if cancel_token.is_cancelled() {
        emit_line(&app, &query_id, "> Cancelled.");
        return;
    }

    match cli_result {
        Ok((output, _session_id)) => {
            let sql = ai_helpers::extract_fenced_block(&output, "sql");
            let explanation = ai_helpers::extract_explanation(&output);

            match sql {
                Some(generated_sql) => {
                    emit_line(&app, &query_id, "> Query generated successfully.");

                    NL_QUERY_JOBS.update_extra(&query_id, |extra| {
                        extra.generated_sql = Some(generated_sql.clone());
                        extra.explanation = explanation.clone();
                    });

                    let _ = app.emit(
                        event_name::NL_QUERY_STATUS,
                        serde_json::json!({
                            "job_id": query_id,
                            "status": "completed",
                            "error": null,
                            "generated_sql": generated_sql,
                            "explanation": explanation,
                        }),
                    );

                    if let Ok(mut jobs) = NL_QUERY_JOBS.lock() {
                        if let Some(job) = jobs.get_mut(&query_id) {
                            job.status = "completed".into();
                        }
                    }
                }
                None => {
                    emit_line(
                        &app,
                        &query_id,
                        "[ERROR] Could not extract a query from the AI response.",
                    );
                    NL_QUERY_JOBS.set_status(
                        &app,
                        &query_id,
                        "failed",
                        Some("No SQL block found in AI response".into()),
                    );
                }
            }
        }
        Err(e) => {
            tracing::warn!(query_id = %query_id, "NL query CLI failed: {}", e);
            emit_line(
                &app,
                &query_id,
                "[ERROR] AI query generation failed. See application logs.",
            );
            NL_QUERY_JOBS.set_status(
                &app,
                &query_id,
                "failed",
                Some("AI query generation failed".into()),
            );
        }
    }
}

// -- Helpers --------------------------------------------------------------

fn emit_line(app: &tauri::AppHandle, query_id: &str, line: &str) {
    NL_QUERY_JOBS.emit_line(app, query_id, line);
}

fn build_nl_prompt(
    question: &str,
    conversation_history: &[ConversationTurn],
    schema_context: &str,
    database_type: &str,
) -> String {
    let mut prompt = format!(
        "You are a database query assistant. Given a natural language question, generate an optimized \
         {database_type} query that answers it. You have access to the database schema below.\n\n"
    );

    if !schema_context.is_empty() {
        prompt.push_str("## Database Schema\n");
        prompt.push_str(schema_context);
        prompt.push_str("\n\n");
    }

    prompt.push_str(&format!(
        "## Instructions\n\
         1. Analyze the user's question and map it to the available tables and columns\n\
         2. Generate a correct, optimized {database_type} query\n\
         3. Output the query in a single ```sql code block\n\
         4. After the code block, provide a brief plain-English explanation of what the query does\n\
         5. If the question is ambiguous, make reasonable assumptions and note them in the explanation\n\
         6. Use table aliases for readability when joining multiple tables\n\
         7. Prefer readable column names in the output (use AS for computed columns)\n\
         8. Add ORDER BY when the result ordering matters for the question\n\
         9. Use LIMIT when the question asks for \"top N\" or similar bounded results\n\
         10. If the question cannot be answered with the available schema, explain why\n\n"
    ));

    // Include conversation history for context
    if !conversation_history.is_empty() {
        prompt.push_str("## Conversation History\n");
        for turn in conversation_history {
            let role_label = if turn.role == "user" {
                "User"
            } else {
                "Assistant"
            };
            prompt.push_str(&format!("**{role_label}**: {}\n\n", turn.content));
        }
    }

    prompt.push_str("## Current Question\n");
    prompt.push_str(question);
    prompt.push('\n');

    prompt
}

/// Build a text summary of all tables and columns for the target database.
async fn build_db_schema_context(
    pool: &crate::db::DbPool,
    user_db: &crate::db::UserDbPool,
    credential_id: &str,
) -> String {
    let tables_result = match db_query::introspect_tables(pool, credential_id, Some(user_db)).await
    {
        Ok(r) => r,
        Err(_) => return String::new(),
    };

    let name_idx = match tables_result.columns.iter().position(|c| c == "table_name") {
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
        let cols = match db_query::introspect_columns(
            pool,
            credential_id,
            table_name,
            Some(user_db),
        )
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

