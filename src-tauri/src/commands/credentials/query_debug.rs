use std::sync::Arc;

use tauri::{Emitter, State};
use tokio_util::sync::CancellationToken;

use crate::background_job::BackgroundJobManager;
use crate::commands::design::n8n_transform::run_claude_prompt_text_inner;
use crate::db::repos::resources::audit_log;
use crate::engine::ai_helpers;
use crate::engine::db_query;
use crate::engine::event_registry::event_name;
use crate::engine::prompt;
use crate::error::AppError;
use crate::ipc_auth::require_privileged;
use crate::AppState;

// -- Debug output sanitization -----------------------------------------
//
// The query debug feature emits events to the frontend webview. To prevent
// schema/data leakage (CVSS 6.8), we:
//   1. Redact values in columns whose names suggest sensitive data
//   2. Cap the number of result rows sent to the frontend
//   3. Replace raw database errors with generic messages (full detail logged server-side)

/// Maximum rows included in the debug result event sent to the frontend.
const DEBUG_MAX_RESULT_ROWS: usize = 5;

/// Column names (lowercase) that indicate sensitive data requiring redaction.
const SENSITIVE_COLUMNS: &[&str] = &[
    "password", "passwd", "pass", "secret", "token", "api_key", "apikey",
    "access_key", "private_key", "credential", "auth", "authorization",
    "ssn", "credit_card", "card_number", "cvv", "encrypted", "hash",
    "salt", "iv", "tag", "encrypted_data", "service_role_key", "anon_key",
    "connection_string", "database_url", "redis_rest_token",
];

/// Redaction placeholder shown in place of sensitive values.
const REDACTED: &str = "[REDACTED]";

/// Sanitize a `QueryResult` before emitting it to the frontend:
/// - Redact values in sensitive columns
/// - Limit the number of rows
fn sanitize_query_result(result: &crate::db::models::QueryResult) -> serde_json::Value {
    // Identify which column indices are sensitive
    let sensitive_indices: Vec<bool> = result
        .columns
        .iter()
        .map(|col| {
            let lower = col.to_lowercase();
            SENSITIVE_COLUMNS.iter().any(|s| lower.contains(s))
        })
        .collect();

    let capped_rows: Vec<Vec<serde_json::Value>> = result
        .rows
        .iter()
        .take(DEBUG_MAX_RESULT_ROWS)
        .map(|row| {
            row.iter()
                .enumerate()
                .map(|(i, val)| {
                    if sensitive_indices.get(i).copied().unwrap_or(false) {
                        serde_json::Value::String(REDACTED.to_string())
                    } else {
                        // Truncate long string values to prevent data exfiltration
                        truncate_value(val, 200)
                    }
                })
                .collect()
        })
        .collect();

    let rows_omitted = result.row_count.saturating_sub(DEBUG_MAX_RESULT_ROWS);

    serde_json::json!({
        "columns": result.columns,
        "rows": capped_rows,
        "row_count": result.row_count,
        "duration_ms": result.duration_ms,
        "truncated": result.truncated || rows_omitted > 0,
        "rows_omitted": rows_omitted,
    })
}

/// Truncate a JSON value's string content if it exceeds `max_len` characters.
/// Uses char_indices to find a safe UTF-8 boundary instead of slicing at byte
/// offsets, which would panic on multi-byte characters (emoji, CJK, accented).
fn truncate_value(val: &serde_json::Value, max_len: usize) -> serde_json::Value {
    match val {
        serde_json::Value::String(s) if s.chars().count() > max_len => {
            let byte_end = s
                .char_indices()
                .nth(max_len)
                .map(|(i, _)| i)
                .unwrap_or(s.len());
            serde_json::Value::String(format!("{}...[truncated]", &s[..byte_end]))
        }
        other => other.clone(),
    }
}

/// Sanitize a database error message for frontend display.
/// Strips internal details (table names, column names, SQL fragments) and returns
/// a generic message. The full error is returned for server-side logging only.
fn sanitize_db_error(err: &str) -> String {
    // Return a generic error that doesn't leak schema details
    let lower = err.to_lowercase();
    if lower.contains("syntax") {
        "Query syntax error. Check the query and try again.".to_string()
    } else if lower.contains("permission") || lower.contains("denied") {
        "Permission denied. The database user may lack required privileges.".to_string()
    } else if lower.contains("timeout") || lower.contains("timed out") {
        "Query timed out. Try simplifying the query or adding limits.".to_string()
    } else if lower.contains("not exist") || lower.contains("not found") || lower.contains("unknown") {
        "Referenced object not found. Check table and column names.".to_string()
    } else if lower.contains("connection") || lower.contains("connect") {
        "Database connection error. Check credentials and network.".to_string()
    } else if lower.contains("duplicate") || lower.contains("unique") || lower.contains("conflict") {
        "Duplicate value conflict. The query violates a uniqueness constraint.".to_string()
    } else {
        "Query execution failed. See application logs for details.".to_string()
    }
}

// -- Static job manager --------------------------------------------------

static QUERY_DEBUG_JOBS: BackgroundJobManager<()> =
    BackgroundJobManager::new("query debug job lock", event_name::QUERY_DEBUG_STATUS, event_name::QUERY_DEBUG_OUTPUT);

/// Maximum number of fix-and-retry cycles.
const MAX_RETRIES: usize = 3;

/// List all query debug job snapshots (for unified workflows view).
pub fn list_query_debug_jobs() -> Vec<crate::background_job::JobSnapshot> {
    QUERY_DEBUG_JOBS.list_snapshots()
}

/// Cancel a query debug job.
pub fn cancel_query_debug_job(app: &tauri::AppHandle, debug_id: &str) -> Result<(), crate::error::AppError> {
    QUERY_DEBUG_JOBS.cancel(app, debug_id)
}

// -- Tauri commands ------------------------------------------------------

#[tauri::command]
pub async fn start_query_debug(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    credential_id: String,
    query_text: String,
    error_context: Option<String>,
    service_type: String,
    debug_id: String,
    allow_mutations: Option<bool>,
) -> Result<(), AppError> {
    require_privileged(&state, "start_query_debug").await?;
    QUERY_DEBUG_JOBS.ensure_not_running(&debug_id)?;

    let cancel_token = CancellationToken::new();
    QUERY_DEBUG_JOBS.insert_running(debug_id.clone(), cancel_token.clone(), ())?;
    QUERY_DEBUG_JOBS.set_status(&app, &debug_id, "running", None);

    // Gather schema context (best-effort -- don't fail if introspection errors)
    let schema_context = ai_helpers::build_schema_context(&state.db, &credential_id, None).await;

    let pool = state.db.clone();
    let cred_id = credential_id.clone();
    let allow_mutations = allow_mutations.unwrap_or(false);

    tokio::spawn(async move {
        run_query_debug(RunParams {
            app,
            pool,
            credential_id: cred_id,
            query_text,
            error_context,
            service_type,
            debug_id,
            schema_context,
            cancel_token,
            allow_mutations,
        })
        .await;
    });

    Ok(())
}

#[tauri::command]
pub async fn cancel_query_debug(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    debug_id: String,
) -> Result<(), AppError> {
    require_privileged(&state, "cancel_query_debug").await?;
    QUERY_DEBUG_JOBS.cancel_or_preempt(&app, &debug_id, ())
}

// -- Internal logic ------------------------------------------------------

struct RunParams {
    app: tauri::AppHandle,
    pool: crate::db::DbPool,
    credential_id: String,
    query_text: String,
    error_context: Option<String>,
    service_type: String,
    debug_id: String,
    schema_context: String,
    cancel_token: CancellationToken,
    allow_mutations: bool,
}

async fn run_query_debug(params: RunParams) {
    let RunParams {
        app,
        pool,
        credential_id,
        query_text,
        error_context,
        service_type,
        debug_id,
        schema_context,
        cancel_token,
        allow_mutations,
    } = params;

    let language = match service_type.as_str() {
        "upstash" | "redis" => "redis",
        "mongodb" => "mongodb",
        _ => "sql",
    };

    let connector_family = match service_type.as_str() {
        "supabase" | "neon" => "PostgreSQL",
        "planetscale" => "MySQL/Vitess",
        "upstash" | "redis" => "Redis",
        other => other,
    };

    // Build the initial prompt
    let prompt = build_prompt(
        connector_family,
        &service_type,
        language,
        &schema_context,
        &query_text,
        error_context.as_deref(),
    );

    emit_line(&app, &debug_id, &format!("> Analyzing query for {connector_family} ({service_type})..."));

    // Build CLI args (no persona, default provider)
    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("1".to_string());

    let app_clone = app.clone();
    let debug_id_clone = debug_id.clone();
    let on_line = move |line: &str| {
        QUERY_DEBUG_JOBS.emit_line(&app_clone, &debug_id_clone, line);
    };

    // Run the initial prompt
    let cli_result = run_claude_prompt_text_inner(
        prompt,
        &cli_args,
        Some(&on_line),
        None,
        None,
        120,
    )
    .await;

    let (mut output, mut session_id) = match cli_result {
        Ok((text, sid, _)) => (text, sid),
        Err(e) => {
            tracing::warn!(debug_id = %debug_id, "Claude CLI failed: {}", e);
            emit_line(&app, &debug_id, "[ERROR] AI analysis failed. See application logs for details.");
            QUERY_DEBUG_JOBS.set_status(&app, &debug_id, "failed", Some("AI analysis failed".into()));
            return;
        }
    };

    // Retry loop: extract query, execute, retry on failure
    for attempt in 0..MAX_RETRIES {
        if cancel_token.is_cancelled() {
            emit_line(&app, &debug_id, "> Cancelled.");
            return;
        }

        let extracted = ai_helpers::extract_fenced_block(&output, language);
        let query_to_run = match extracted {
            Some(q) => q,
            None => {
                emit_line(&app, &debug_id, "[ERROR] Could not extract a query from AI response.");
                QUERY_DEBUG_JOBS.set_status(
                    &app,
                    &debug_id,
                    "failed",
                    Some("No code block found in AI response".into()),
                );
                return;
            }
        };

        emit_line(&app, &debug_id, &format!("> Attempt {} -- executing extracted query...", attempt + 1));

        // Audit log the query execution (log a length fingerprint, not raw query text)
        let query_fingerprint = format!("len={}, attempt={}", query_to_run.len(), attempt + 1);
        let is_mutation = db_query::is_mutation(&query_to_run);
        let mutation_label = if is_mutation { "mutation" } else { "read" };
        audit_log::insert_warn(&pool, &credential_id, &credential_id, "db_query_execute", Some(&format!("{mutation_label}, {query_fingerprint}")));

        // Block mutations unless the user explicitly opted in
        if is_mutation && !allow_mutations {
            emit_line(&app, &debug_id, "[ERROR] AI suggested a mutation query (INSERT/UPDATE/DELETE/DROP) but mutations are not allowed. Enable 'Allow mutations' to permit this.");
            QUERY_DEBUG_JOBS.set_status(
                &app,
                &debug_id,
                "failed",
                Some("Mutation blocked: enable allow_mutations to permit write queries".into()),
            );
            return;
        }

        // Execute the extracted query
        match db_query::execute_query(&pool, &credential_id, &query_to_run, None, allow_mutations).await {
            Ok(result) => {
                let summary = format!(
                    "> Query succeeded: {} row{} in {}ms",
                    result.row_count,
                    if result.row_count != 1 { "s" } else { "" },
                    result.duration_ms,
                );
                emit_line(&app, &debug_id, &summary);

                // Emit sanitized result -- redact sensitive columns, cap rows
                let sanitized_result = sanitize_query_result(&result);
                let _ = app.emit(
                    event_name::QUERY_DEBUG_STATUS,
                    serde_json::json!({
                        "job_id": debug_id,
                        "status": "completed",
                        "error": serde_json::Value::Null,
                        "result": sanitized_result,
                        "corrected_query": query_to_run,
                    }),
                );

                if let Ok(mut jobs) = QUERY_DEBUG_JOBS.lock() {
                    if let Some(job) = jobs.get_mut(&debug_id) {
                        job.status = "completed".into();
                    }
                }
                return;
            }
            Err(exec_err) => {
                let err_msg = format!("{}", exec_err);
                let safe_msg = sanitize_db_error(&err_msg);
                // Log full error server-side only
                tracing::warn!(debug_id = %debug_id, "Query debug execution failed: {}", err_msg);
                emit_line(&app, &debug_id, &format!("[ERROR] {}", safe_msg));

                if attempt + 1 >= MAX_RETRIES {
                    emit_line(&app, &debug_id, &format!("> Max retries ({MAX_RETRIES}) reached."));
                    QUERY_DEBUG_JOBS.set_status(
                        &app,
                        &debug_id,
                        "failed",
                        Some(format!("Query failed after {} attempts: {}", MAX_RETRIES, safe_msg)),
                    );
                    return;
                }

                // Resume Claude session with the error for another attempt
                emit_line(&app, &debug_id, "> Resuming AI session with error context...");

                let resume_prompt = format!(
                    "The query you suggested failed with this error:\n\n{safe_msg}\n\n\
                     Please fix the query and output the corrected version in a single ```{language} code block.",
                );

                let resume_result = if let Some(ref sid) = session_id {
                    let mut resume_args = prompt::build_resume_cli_args(sid);
                    resume_args.args.push("--max-turns".to_string());
                    resume_args.args.push("1".to_string());

                    run_claude_prompt_text_inner(
                        resume_prompt,
                        &resume_args,
                        Some(&on_line),
                        None,
                        None,
                        120,
                    )
                    .await
                } else {
                    // No session ID -- make a fresh call with full context
                    let fresh_prompt = build_prompt(
                        connector_family,
                        &service_type,
                        language,
                        &schema_context,
                        &query_to_run,
                        Some(&safe_msg),
                    );
                    run_claude_prompt_text_inner(
                        fresh_prompt,
                        &cli_args,
                        Some(&on_line),
                        None,
                        None,
                        120,
                    )
                    .await
                };

                match resume_result {
                    Ok((text, sid, _)) => {
                        output = text;
                        if sid.is_some() {
                            session_id = sid;
                        }
                    }
                    Err(e) => {
                        tracing::warn!(debug_id = %debug_id, "AI retry failed: {}", e);
                        emit_line(&app, &debug_id, "[ERROR] AI retry failed. See application logs for details.");
                        QUERY_DEBUG_JOBS.set_status(&app, &debug_id, "failed", Some("AI retry failed".into()));
                        return;
                    }
                }
            }
        }
    }
}

// -- Helpers --------------------------------------------------------------

fn emit_line(app: &tauri::AppHandle, debug_id: &str, line: &str) {
    QUERY_DEBUG_JOBS.emit_line(app, debug_id, line);
}

fn build_prompt(
    connector_family: &str,
    service_type: &str,
    language: &str,
    schema_context: &str,
    query_text: &str,
    error_context: Option<&str>,
) -> String {
    let mut prompt = format!(
        "You are a database query expert. Fix and optimize the following query for a {connector_family} database ({service_type} service).\n\n",
    );

    if !schema_context.is_empty() {
        prompt.push_str("## Available Schema\n");
        prompt.push_str(schema_context);
        prompt.push_str("\n\n");
    }

    prompt.push_str(&format!("## Query\n```{language}\n{query_text}\n```\n\n"));

    if let Some(err) = error_context {
        prompt.push_str(&format!("## Previous Error\n{err}\n\n"));
    }

    prompt.push_str(&format!(
        "## Instructions\n\
         1. Identify and fix all issues (syntax, table/column names, dialect-specific syntax)\n\
         2. Output ONLY the corrected database query in a single ```{language} code block\n\
         3. Do NOT output JavaScript, TypeScript, or client library code -- ONLY the raw {language} query\n\
         4. Briefly explain what you fixed\n",
    ));

    prompt
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::QueryResult;

    // -- Sanitization tests ------------------------------------------

    #[test]
    fn test_sanitize_redacts_sensitive_columns() {
        let result = QueryResult {
            columns: vec!["id".into(), "email".into(), "password".into(), "api_key".into()],
            rows: vec![
                vec![
                    serde_json::json!(1),
                    serde_json::json!("alice@test.com"),
                    serde_json::json!("hunter2"),
                    serde_json::json!("sk-1234567890"),
                ],
            ],
            row_count: 1,
            duration_ms: 42,
            truncated: false,
        };

        let sanitized = sanitize_query_result(&result);
        let rows = sanitized["rows"].as_array().unwrap();
        assert_eq!(rows[0][0], serde_json::json!(1));          // id: not redacted
        assert_eq!(rows[0][1], serde_json::json!("alice@test.com")); // email: not redacted
        assert_eq!(rows[0][2], serde_json::json!(REDACTED));   // password: redacted
        assert_eq!(rows[0][3], serde_json::json!(REDACTED));   // api_key: redacted
    }

    #[test]
    fn test_sanitize_caps_rows() {
        let rows: Vec<Vec<serde_json::Value>> = (0..20)
            .map(|i| vec![serde_json::json!(i)])
            .collect();

        let result = QueryResult {
            columns: vec!["id".into()],
            rows,
            row_count: 20,
            duration_ms: 10,
            truncated: false,
        };

        let sanitized = sanitize_query_result(&result);
        let out_rows = sanitized["rows"].as_array().unwrap();
        assert_eq!(out_rows.len(), DEBUG_MAX_RESULT_ROWS);
        assert_eq!(sanitized["row_count"], serde_json::json!(20));
        assert_eq!(sanitized["rows_omitted"], serde_json::json!(15));
        assert_eq!(sanitized["truncated"], serde_json::json!(true));
    }

    #[test]
    fn test_sanitize_truncates_long_strings() {
        let long_val = "x".repeat(500);
        let result = QueryResult {
            columns: vec!["data".into()],
            rows: vec![vec![serde_json::json!(long_val)]],
            row_count: 1,
            duration_ms: 5,
            truncated: false,
        };

        let sanitized = sanitize_query_result(&result);
        let val = sanitized["rows"][0][0].as_str().unwrap();
        assert!(val.len() < 500);
        assert!(val.ends_with("...[truncated]"));
    }

    #[test]
    fn test_sanitize_db_error_syntax() {
        let msg = sanitize_db_error("ERROR: syntax error at or near \"SELEC\" at position 1");
        assert!(msg.contains("syntax error"));
        assert!(!msg.contains("SELEC"));
    }

    #[test]
    fn test_sanitize_db_error_not_exist() {
        let msg = sanitize_db_error("ERROR: relation \"secret_table\" does not exist");
        assert!(msg.contains("not found"));
        assert!(!msg.contains("secret_table"));
    }

    #[test]
    fn test_sanitize_db_error_generic() {
        let msg = sanitize_db_error("some completely unexpected error from the database driver");
        assert!(msg.contains("See application logs"));
        assert!(!msg.contains("database driver"));
    }

    // Code block extraction tests have moved to engine::ai_helpers::tests
}
