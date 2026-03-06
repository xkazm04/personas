use std::sync::Arc;

use tauri::{Emitter, State};
use tokio_util::sync::CancellationToken;

use crate::background_job::BackgroundJobManager;
use crate::commands::design::n8n_transform::run_claude_prompt_text_inner;
use crate::engine::db_query;
use crate::engine::prompt;
use crate::error::AppError;
use crate::ipc_auth::require_privileged;
use crate::AppState;

// ── Debug output sanitization ─────────────────────────────────────────
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
fn truncate_value(val: &serde_json::Value, max_len: usize) -> serde_json::Value {
    match val {
        serde_json::Value::String(s) if s.len() > max_len => {
            serde_json::Value::String(format!("{}...[truncated]", &s[..max_len]))
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

// ── Static job manager ──────────────────────────────────────────────────

static QUERY_DEBUG_JOBS: BackgroundJobManager<()> =
    BackgroundJobManager::new("query debug job lock", "query-debug-status", "query-debug-output");

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

// ── Tauri commands ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_query_debug(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    credential_id: String,
    query_text: String,
    error_context: Option<String>,
    service_type: String,
    debug_id: String,
) -> Result<(), AppError> {
    require_privileged(&state, "start_query_debug").await?;
    QUERY_DEBUG_JOBS.ensure_not_running(&debug_id)?;

    let cancel_token = CancellationToken::new();
    QUERY_DEBUG_JOBS.insert_running(debug_id.clone(), cancel_token.clone(), ())?;
    QUERY_DEBUG_JOBS.set_status(&app, &debug_id, "running", None);

    // Gather schema context (best-effort — don't fail if introspection errors)
    let schema_context = build_schema_context(&state.db, &credential_id).await;

    let pool = state.db.clone();
    let cred_id = credential_id.clone();

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

// ── Internal logic ──────────────────────────────────────────────────────

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

    emit_line(&app, &debug_id, &format!("> Analyzing query for {} ({})...", connector_family, service_type));

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

        let extracted = extract_code_block(&output, language);
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

        emit_line(&app, &debug_id, &format!("> Attempt {} — executing extracted query...", attempt + 1));

        // Execute the extracted query
        match db_query::execute_query(&pool, &credential_id, &query_to_run).await {
            Ok(result) => {
                let summary = format!(
                    "> Query succeeded: {} row{} in {}ms",
                    result.row_count,
                    if result.row_count != 1 { "s" } else { "" },
                    result.duration_ms,
                );
                emit_line(&app, &debug_id, &summary);

                // Emit sanitized result — redact sensitive columns, cap rows
                let sanitized_result = sanitize_query_result(&result);
                let _ = app.emit(
                    "query-debug-status",
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
                    emit_line(&app, &debug_id, &format!("> Max retries ({}) reached.", MAX_RETRIES));
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
                    "The query you suggested failed with this error:\n\n{}\n\n\
                     Please fix the query and output the corrected version in a single ```{} code block.",
                    err_msg, language,
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
                    // No session ID — make a fresh call with full context
                    let fresh_prompt = build_prompt(
                        connector_family,
                        &service_type,
                        language,
                        &schema_context,
                        &query_to_run,
                        Some(&err_msg),
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

// ── Helpers ──────────────────────────────────────────────────────────────

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
        "You are a database query expert. Fix and optimize the following query for a {} database ({} service).\n\n",
        connector_family, service_type,
    );

    if !schema_context.is_empty() {
        prompt.push_str("## Available Schema\n");
        prompt.push_str(schema_context);
        prompt.push_str("\n\n");
    }

    prompt.push_str(&format!("## Query\n```{}\n{}\n```\n\n", language, query_text));

    if let Some(err) = error_context {
        prompt.push_str(&format!("## Previous Error\n{}\n\n", err));
    }

    prompt.push_str(&format!(
        "## Instructions\n\
         1. Identify and fix all issues (syntax, table/column names, dialect-specific syntax)\n\
         2. Output ONLY the corrected database query in a single ```{lang} code block\n\
         3. Do NOT output JavaScript, TypeScript, or client library code — ONLY the raw {lang} query\n\
         4. Briefly explain what you fixed\n",
        lang = language,
    ));

    prompt
}

/// Extract the best fenced code block from Claude's output.
///
/// Prefers blocks tagged with a matching language (sql, redis, mongodb) over
/// generic or non-matching blocks (javascript, typescript, etc.).
fn extract_code_block(text: &str, language: &str) -> Option<String> {
    let mut blocks: Vec<(String, bool)> = Vec::new(); // (content, language_matches)
    let mut in_block = false;
    let mut current_matches = false;
    let mut content = String::new();

    // Language tags that match for SQL-family queries
    let sql_tags = ["sql", "postgresql", "postgres", "mysql", "pgsql"];
    let redis_tags = ["redis", ""];
    let mongo_tags = ["mongodb", "mongo", "js", "javascript"];

    for line in text.lines() {
        if !in_block && line.trim_start().starts_with("```") {
            in_block = true;
            let tag = line.trim_start().trim_start_matches('`').trim().to_lowercase();
            current_matches = match language {
                "sql" => tag.is_empty() || sql_tags.iter().any(|t| tag == *t),
                "redis" => tag.is_empty() || redis_tags.iter().any(|t| tag == *t),
                "mongodb" => tag.is_empty() || mongo_tags.iter().any(|t| tag == *t),
                _ => tag.is_empty() || tag == language,
            };
            // Explicitly exclude non-matching code blocks (JS in SQL context, etc.)
            if language == "sql"
                && ["javascript", "typescript", "js", "ts", "python", "py", "rust", "go"]
                    .iter()
                    .any(|t| tag == *t)
            {
                current_matches = false;
            }
            continue;
        }
        if in_block {
            if line.trim_start().starts_with("```") {
                let trimmed = content.trim().to_string();
                if !trimmed.is_empty() {
                    blocks.push((trimmed, current_matches));
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
        blocks.push((trimmed, current_matches));
    }

    // Prefer language-matching blocks; fall back to first block
    blocks
        .iter()
        .find(|(_, matches)| *matches)
        .or_else(|| blocks.first())
        .map(|(content, _)| content.clone())
}

/// Build a text summary of available tables and columns for the prompt.
async fn build_schema_context(
    pool: &crate::db::DbPool,
    credential_id: &str,
) -> String {
    let tables_result = match db_query::introspect_tables(pool, credential_id).await {
        Ok(r) => r,
        Err(_) => return String::new(),
    };

    let name_idx = tables_result.columns.iter().position(|c| c == "table_name");
    let name_idx = match name_idx {
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
        let cols = match db_query::introspect_columns(pool, credential_id, table_name).await {
            Ok(r) => r,
            Err(_) => {
                ctx.push_str(&format!("- {}\n", table_name));
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
                    Some(format!("{} {}", name, dtype))
                })
                .collect();
            ctx.push_str(&format!("- {} ({})\n", table_name, col_strs.join(", ")));
        } else {
            ctx.push_str(&format!("- {}\n", table_name));
        }
    }

    ctx
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::QueryResult;

    // ── Sanitization tests ──────────────────────────────────────────

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
        let msg = sanitize_db_error("some completely unknown error from the database driver");
        assert!(msg.contains("See application logs"));
        assert!(!msg.contains("database driver"));
    }

    // ── Code block extraction tests ─────────────────────────────────

    #[test]
    fn test_extract_code_block_sql() {
        let text = "Here's the fix:\n```sql\nSELECT * FROM users LIMIT 10;\n```\nDone.";
        assert_eq!(
            extract_code_block(text, "sql"),
            Some("SELECT * FROM users LIMIT 10;".into()),
        );
    }

    #[test]
    fn test_extract_code_block_bare() {
        let text = "```\nGET mykey\n```";
        assert_eq!(
            extract_code_block(text, "redis"),
            Some("GET mykey".into()),
        );
    }

    #[test]
    fn test_extract_code_block_none() {
        let text = "No code block here.";
        assert_eq!(extract_code_block(text, "sql"), None);
    }

    #[test]
    fn test_extract_code_block_multiline() {
        let text = "```sql\nSELECT id,\n       name\nFROM users\nWHERE active = true;\n```";
        let result = extract_code_block(text, "sql").unwrap();
        assert!(result.contains("SELECT id,"));
        assert!(result.contains("WHERE active = true;"));
    }

    #[test]
    fn test_extract_code_block_unclosed() {
        let text = "```sql\nSELECT * FROM users;";
        assert_eq!(
            extract_code_block(text, "sql"),
            Some("SELECT * FROM users;".into()),
        );
    }

    #[test]
    fn test_extract_code_block_prefers_sql_over_js() {
        let text = "Here's the JS client code:\n```javascript\nconst { data } = await supabase.from('users').select('*');\n```\n\nAnd the raw SQL:\n```sql\nSELECT * FROM users LIMIT 100;\n```";
        assert_eq!(
            extract_code_block(text, "sql"),
            Some("SELECT * FROM users LIMIT 100;".into()),
        );
    }

    #[test]
    fn test_extract_code_block_falls_back_to_first() {
        let text = "```python\nprint('hello')\n```";
        assert_eq!(
            extract_code_block(text, "sql"),
            Some("print('hello')".into()),
        );
    }
}
