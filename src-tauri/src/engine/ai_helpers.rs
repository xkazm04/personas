//! Shared utilities for AI-assisted features.
//!
//! Provides reusable primitives for extracting fenced code blocks from LLM
//! output and building schema context strings for database-related AI prompts.

use crate::engine::db_query;

// ---------------------------------------------------------------------------
// Fenced code block extraction
// ---------------------------------------------------------------------------

/// Language tag matching configuration for [`extract_fenced_block`].
///
/// Determines which fenced code block tags are considered a "match" for the
/// requested language, and which tags should be explicitly excluded.
struct LangMatcher<'a> {
    /// Tags that count as a match (in addition to an empty/bare tag).
    accept: &'a [&'a str],
    /// Tags that are explicitly *not* a match even if they would otherwise be
    /// accepted (e.g. `"javascript"` when looking for SQL).
    reject: &'a [&'a str],
}

impl<'a> LangMatcher<'a> {
    fn for_language(language: &str) -> LangMatcher<'static> {
        match language {
            "sql" => LangMatcher {
                accept: &[
                    "sql",
                    "postgresql",
                    "postgres",
                    "mysql",
                    "pgsql",
                    "sqlite",
                    "sqlite3",
                ],
                reject: &[
                    "javascript",
                    "typescript",
                    "js",
                    "ts",
                    "python",
                    "py",
                    "rust",
                    "go",
                ],
            },
            "redis" => LangMatcher {
                accept: &["redis"],
                reject: &[],
            },
            "mongodb" => LangMatcher {
                accept: &["mongodb", "mongo", "js", "javascript"],
                reject: &[],
            },
            _ => LangMatcher {
                accept: &[],
                reject: &[],
            },
        }
    }

    /// Returns `true` if `tag` (already lowercased) is considered a match.
    fn matches(&self, tag: &str) -> bool {
        if tag.is_empty() {
            return true;
        }
        if self.reject.contains(&tag) {
            return false;
        }
        self.accept.contains(&tag) || tag == "sql" // bare "sql" always matches sql-family
    }
}

/// Extract the best fenced code block from LLM output.
///
/// Prefers blocks tagged with a matching language over generic or non-matching
/// blocks. Falls back to the first block if no match is found.
///
/// # Arguments
/// * `text`     – the raw LLM output
/// * `language` – desired language hint: `"sql"`, `"redis"`, `"mongodb"`, or a
///   custom tag. An empty string matches any bare block.
pub fn extract_fenced_block(text: &str, language: &str) -> Option<String> {
    let matcher = LangMatcher::for_language(language);

    let mut blocks: Vec<(String, bool)> = Vec::new(); // (content, language_matches)
    let mut in_block = false;
    let mut current_matches = false;
    let mut content = String::new();

    for line in text.lines() {
        if !in_block && line.trim_start().starts_with("```") {
            in_block = true;
            let tag = line
                .trim_start()
                .trim_start_matches('`')
                .trim()
                .to_lowercase();
            current_matches = matcher.matches(&tag);
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
        .map(|(c, _)| c.clone())
}

/// Extract the explanation text that comes after the (first) fenced code block.
///
/// Shared by the DB-query AI flows (nl_query, schema_proposal) which all ask
/// the model for "```sql ... ``` <plain-English explanation>" and need the
/// trailing prose separated from the code.
pub fn extract_explanation(text: &str) -> Option<String> {
    let mut found_code_block = false;
    let mut in_block = false;
    let mut explanation_lines: Vec<&str> = Vec::new();

    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            if in_block {
                in_block = false;
                found_code_block = true;
                continue;
            }
            in_block = true;
            continue;
        }

        if found_code_block && !in_block {
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

// ---------------------------------------------------------------------------
// Single-turn AI-CLI helper scaffold
// ---------------------------------------------------------------------------

/// Call class of the single-turn DB-query AI helper flows (nl_query,
/// schema_proposal, query_debug): write a query from a question and a schema.
/// The model and effort come from the class table (`personas_core::model_class`).
pub const SINGLE_TURN_CLASS: personas_core::model_class::CallClass =
    personas_core::model_class::CallClass::Sql;

/// Build the CLI args shared by the single-turn DB-query AI helper flows:
/// default persona/provider, on `route`'s model and effort, capped at a single
/// turn.
pub fn build_single_turn_cli_args(
    route: personas_core::model_class::ClassRoute,
) -> crate::engine::types::CliArgs {
    crate::engine::cli_process::headless_claude_args(
        route.model,
        route.effort,
        &["--max-turns".to_string(), "1".to_string()],
    )
}

/// Run a single-turn AI helper prompt on [`SINGLE_TURN_CLASS`], with the
/// shared turn limit and timeout used by the DB-query AI flows.
///
/// `validate` is the caller's own check on the raw output (e.g. "has a fenced
/// SQL block"); when it rejects, the call escalates ONCE to the class's
/// `escalate_to` route. Returns `(validated, output_text, claude_session_id)`.
/// An output rejected on every route comes back as `AppError::Validation`;
/// a spawn/timeout/empty-output failure as `AppError::Internal`.
///
/// Callers that need to resume the session (e.g. query_debug's fix-and-retry
/// loop) should use [`build_single_turn_cli_args`] directly alongside
/// `crate::engine::prompt::build_resume_cli_args`.
pub async fn run_single_turn_prompt<T, V>(
    prompt_text: String,
    on_line: Option<&(dyn Fn(&str) + Send + Sync)>,
    validate: V,
) -> Result<(T, String, Option<String>), crate::error::AppError>
where
    V: Fn(&str) -> Result<T, String>,
{
    use crate::engine::cli_process::{with_escalation, AttemptError};

    let validate = &validate;
    with_escalation(SINGLE_TURN_CLASS, |route| {
        let prompt_text = prompt_text.clone();
        async move {
            let cli_args = build_single_turn_cli_args(route);
            let (text, session_id, _) =
                crate::commands::design::n8n_transform::run_claude_prompt_text_inner(
                    prompt_text,
                    &cli_args,
                    on_line,
                    None,
                    None,
                    120,
                )
                .await
                .map_err(|e| AttemptError::Fatal(crate::error::AppError::Internal(e)))?;
            let validated = validate(&text).map_err(AttemptError::BadOutput)?;
            Ok((validated, text, session_id))
        }
    })
    .await
}

// ---------------------------------------------------------------------------
// Schema context builder
// ---------------------------------------------------------------------------

/// Build a text summary of available tables and columns for use in AI prompts.
///
/// The `credential_id` selects which database to introspect. `user_db` is
/// passed through to introspection calls that may need it (e.g. SQLite).
///
/// Returns an empty string on any introspection error (best-effort).
pub async fn build_schema_context(
    pool: &crate::db::DbPool,
    credential_id: &str,
    user_db: Option<&crate::db::UserDbPool>,
) -> String {
    let tables_result = match db_query::introspect_tables(pool, credential_id, user_db).await {
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
        let cols =
            match db_query::introspect_columns(pool, credential_id, table_name, user_db).await {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -- extract_fenced_block: SQL ----------------------------------------

    #[test]
    fn sql_tagged_block() {
        let text = "Here's the fix:\n```sql\nSELECT * FROM users LIMIT 10;\n```\nDone.";
        assert_eq!(
            extract_fenced_block(text, "sql"),
            Some("SELECT * FROM users LIMIT 10;".into()),
        );
    }

    #[test]
    fn bare_block_matches_redis() {
        let text = "```\nGET mykey\n```";
        assert_eq!(
            extract_fenced_block(text, "redis"),
            Some("GET mykey".into()),
        );
    }

    #[test]
    fn no_block_returns_none() {
        assert_eq!(extract_fenced_block("No code block here.", "sql"), None);
    }

    #[test]
    fn multiline_sql() {
        let text = "```sql\nSELECT id,\n       name\nFROM users\nWHERE active = true;\n```";
        let result = extract_fenced_block(text, "sql").unwrap();
        assert!(result.contains("SELECT id,"));
        assert!(result.contains("WHERE active = true;"));
    }

    #[test]
    fn unclosed_block() {
        let text = "```sql\nSELECT * FROM users;";
        assert_eq!(
            extract_fenced_block(text, "sql"),
            Some("SELECT * FROM users;".into()),
        );
    }

    #[test]
    fn prefers_sql_over_js() {
        let text = "JS:\n```javascript\nconst { data } = await supabase.from('users').select('*');\n```\n\nSQL:\n```sql\nSELECT * FROM users LIMIT 100;\n```";
        assert_eq!(
            extract_fenced_block(text, "sql"),
            Some("SELECT * FROM users LIMIT 100;".into()),
        );
    }

    #[test]
    fn falls_back_to_first_block() {
        let text = "```python\nprint('hello')\n```";
        assert_eq!(
            extract_fenced_block(text, "sql"),
            Some("print('hello')".into()),
        );
    }

    // -- extract_fenced_block: schema proposal SQL flavours ---------------

    #[test]
    fn sqlite_tag_matches_sql() {
        let text = "```sqlite\nCREATE TABLE foo (id INTEGER PRIMARY KEY);\n```";
        assert_eq!(
            extract_fenced_block(text, "sql"),
            Some("CREATE TABLE foo (id INTEGER PRIMARY KEY);".into()),
        );
    }

    #[test]
    fn prefers_sql_tag_over_js() {
        let text = "```javascript\nconsole.log('hi');\n```\n\n```sql\nCREATE TABLE t (x INT);\n```";
        assert_eq!(
            extract_fenced_block(text, "sql"),
            Some("CREATE TABLE t (x INT);".into()),
        );
    }

    // -- extract_explanation ------------------------------------------------

    #[test]
    fn extract_explanation_after_block() {
        let text = "Here:\n```sql\nCREATE TABLE t (id INT);\n```\n\nThe `t` table stores items.";
        let explanation = extract_explanation(text).unwrap();
        assert!(explanation.contains("The `t` table stores items."));
    }

    #[test]
    fn extract_explanation_none_when_only_whitespace() {
        let text = "```sql\nCREATE TABLE t (id INT);\n```";
        assert_eq!(extract_explanation(text), None);
    }

    // -- single-turn scaffold: class route ---------------------------------

    #[test]
    fn single_turn_args_carry_the_sql_route_once() {
        let route = SINGLE_TURN_CLASS.route();
        assert_eq!(
            SINGLE_TURN_CLASS,
            personas_core::model_class::CallClass::Sql
        );
        let args = build_single_turn_cli_args(route).args;
        let value_of = |flag: &str| {
            let hits: Vec<_> = args
                .windows(2)
                .filter(|w| w[0] == flag)
                .map(|w| w[1].clone())
                .collect();
            assert_eq!(hits.len(), 1, "{flag} must appear exactly once: {args:?}");
            hits[0].clone()
        };
        assert_eq!(value_of("--model"), route.model);
        assert_eq!(value_of("--effort"), route.effort);
        assert_eq!(value_of("--max-turns"), "1");
    }
}
