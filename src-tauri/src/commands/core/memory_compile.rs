//! Memory compile/flush — synthesize raw episodic memories into structured
//! "wiki article" memories that pin durable knowledge.
//!
//! Inspired by Karpathy-style LLM knowledge bases (research run 2026-04-08):
//! the daily-log → wiki promotion idea, applied to persona memories. The
//! existing `review_memories_with_cli` command *prunes* memories; this one
//! *synthesizes* them. The two are complementary — review keeps the floor
//! clean, compile builds the ceiling.
//!
//! Pattern is intentionally a near-mirror of `review_memories_with_cli` so
//! the spawn/timeout/IPC-auth wiring is consistent and reviewable.

use std::sync::Arc;

use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use ts_rs::TS;
use uuid::Uuid;

use crate::db::models::{CreatePersonaMemoryInput, Json, PersonaMemory};
use crate::db::repos::core::memories as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Upper bound on how many raw memories a single compile pass will read.
/// Guards against unbounded prompts that would blow Tauri IPC, the CLI stdin
/// pipe, and the model's input token window.
const MAX_SOURCE_LIMIT: i64 = 200;

/// Default source_limit when the caller omits one.
const DEFAULT_SOURCE_LIMIT: i64 = 50;

/// Hard cap on prompt byte size sent to the Claude CLI. 512 KB is well under
/// any plausible stdin/token-window budget while still fitting 200 memories
/// of typical size.
const MAX_PROMPT_BYTES: usize = 512 * 1024;

#[derive(Debug, serde::Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCompileResult {
    /// How many raw memories were fed into the compile pass.
    pub source_count: usize,
    /// How many wiki-article memories were synthesized and inserted.
    pub created: usize,
    /// IDs of newly inserted memories.
    pub created_ids: Vec<String>,
    /// Titles of synthesized articles, for surfacing in the UI.
    pub titles: Vec<String>,
}

/// Synthesize a small set of "wiki article" memories from a persona's recent
/// episodic memories. Each article groups related raw entries under a
/// concept and adds cross-references in the body.
///
/// Behavior:
/// - Reads up to `source_limit` recent memories for the persona (default 50,
///   clamped to `MAX_SOURCE_LIMIT = 200`; negatives/zero are rejected).
/// - Skips if there are fewer than 3 sources (nothing meaningful to compile).
/// - Asks the Claude CLI to extract 1-5 concept articles, each with a title,
///   summary body, and the IDs of the source memories that informed it.
/// - Inserts each article as a new memory with category="fact",
///   importance=4, tags=["compiled", "wiki"]. The body cross-references the
///   source memory IDs so the agent can drill down.
#[tauri::command]
pub async fn compile_persona_memories(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    source_limit: Option<i64>,
) -> Result<MemoryCompileResult, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    let limit = match source_limit {
        Some(n) if n < 1 => {
            return Err(AppError::Validation(format!(
                "source_limit must be >= 1 (got {n})"
            )));
        }
        Some(n) => n.min(MAX_SOURCE_LIMIT),
        None => DEFAULT_SOURCE_LIMIT,
    };

    // 1. Fetch recent raw memories for this persona.
    let memories = repo::get_all(
        &db,
        Some(persona_id.as_str()),
        None,
        None,
        Some(limit),
        Some(0),
        None,
        None,
    )?;

    if memories.len() < 3 {
        return Ok(MemoryCompileResult {
            source_count: memories.len(),
            created: 0,
            created_ids: vec![],
            titles: vec![],
        });
    }

    // Skip already-compiled wiki articles — we don't want to recursively
    // re-compile our own output.
    let raw: Vec<&PersonaMemory> = memories
        .iter()
        .filter(|m| {
            m.tags
                .as_ref()
                .map(|t| !t.0.iter().any(|tag| tag == "compiled"))
                .unwrap_or(true)
        })
        .collect();

    if raw.len() < 3 {
        return Ok(MemoryCompileResult {
            source_count: raw.len(),
            created: 0,
            created_ids: vec![],
            titles: vec![],
        });
    }

    // 2. Build the prompt.
    let memory_entries: Vec<serde_json::Value> = raw
        .iter()
        .map(|m| {
            serde_json::json!({
                "id": m.id,
                "title": m.title,
                "content": m.content,
                "category": m.category,
                "importance": m.importance,
            })
        })
        .collect();

    let memories_json = serde_json::to_string_pretty(&memory_entries)
        .map_err(|e| AppError::Internal(format!("Serialize: {e}")))?;

    let prompt = format!(
        r#"You are compiling a structured knowledge wiki from raw agent memories belonging to one persona in Personas, an AI agent management platform.

The raw memories below are episodic notes the agent has accumulated across executions: preferences, learned facts, constraints, instructions. Your job is to synthesize them into 1-5 higher-level "wiki articles" that group related entries under a single concept. Each article should:

- Have a clear, durable title (e.g. "API rate limit policy", not "rate limit on the third API call last Tuesday").
- Have a body that distills the relevant raw memories into 3-8 concise sentences.
- Cross-reference the source memory IDs that informed the article in a "Sources: id1, id2, …" line at the end of the body.
- Cover only patterns supported by AT LEAST 2 source memories. Do not invent.

Skip topics that only appear once — single-source observations belong in episodic memory, not the wiki.

Respond with ONLY a JSON array. No markdown fences, no explanation, no surrounding text.
Example:
[
  {{
    "title": "API rate limit policy",
    "body": "External APIs are limited to 100 req/min. Use exponential backoff with 1s/2s/4s delays. Sources: abc-123, def-456",
    "source_ids": ["abc-123", "def-456"]
  }}
]

Raw memories:
{memories_json}"#
    );

    if prompt.len() > MAX_PROMPT_BYTES {
        return Err(AppError::Validation(format!(
            "Compile prompt is {} bytes, exceeds max of {} bytes. Lower source_limit or trim memory contents.",
            prompt.len(),
            MAX_PROMPT_BYTES
        )));
    }

    // 3. Build CLI args (mirrors review_memories_with_cli).
    let (command, mut args) = if cfg!(windows) {
        (
            "cmd".to_string(),
            vec!["/C".to_string(), "claude.cmd".to_string()],
        )
    } else {
        ("claude".to_string(), vec![])
    };
    args.extend(
        [
            "-p",
            "-",
            "--max-turns",
            "1",
            "--dangerously-skip-permissions",
        ]
        .iter()
        .map(|s| s.to_string()),
    );

    // 4. Spawn the CLI.
    let mut cmd = Command::new(&command);
    cmd.args(&args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    cmd.env_remove("CLAUDECODE");
    cmd.env_remove("CLAUDE_CODE");

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::Internal(
                "Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code"
                    .into(),
            )
        } else {
            AppError::Internal(format!("Failed to spawn CLI: {e}"))
        }
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes()).await.map_err(|e| {
            AppError::Internal(format!("Failed to write prompt to CLI stdin: {e}"))
        })?;
        stdin
            .shutdown()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to close CLI stdin: {e}")))?;
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("No stdout".into()))?;
    let mut reader = BufReader::new(stdout);
    let mut full_output = String::new();

    let timeout = std::time::Duration::from_secs(180);
    let read_result = tokio::time::timeout(timeout, async {
        let mut line = String::new();
        while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
            full_output.push_str(&line);
            line.clear();
        }
    })
    .await;

    if read_result.is_err() {
        let _ = child.kill().await;
        let _ = child.wait().await;
        return Err(AppError::Internal(
            "Memory compile timed out after 3 minutes".into(),
        ));
    }

    let _ = child.wait().await;

    if full_output.trim().is_empty() {
        return Err(AppError::Internal("CLI produced no output".into()));
    }

    // 5. Parse the JSON array out of the response.
    let json_str = extract_json_array(&full_output)
        .ok_or_else(|| AppError::Internal("Failed to parse compile output as JSON".into()))?;

    let articles: Vec<serde_json::Value> = serde_json::from_str(&json_str)
        .map_err(|e| AppError::Internal(format!("Invalid JSON in compile output: {e}")))?;

    // 6. Validate + insert. Reject hallucinated source IDs.
    let valid_ids: std::collections::HashSet<&str> =
        raw.iter().map(|m| m.id.as_str()).collect();

    let mut created_ids = Vec::new();
    let mut titles = Vec::new();

    for article in &articles {
        let title = match article.get("title").and_then(|v| v.as_str()) {
            Some(t) if !t.trim().is_empty() => t.trim().to_string(),
            _ => continue,
        };
        let body = match article.get("body").and_then(|v| v.as_str()) {
            Some(b) if !b.trim().is_empty() => b.trim().to_string(),
            _ => continue,
        };

        // Filter source_ids to only those that actually exist.
        let source_ids: Vec<String> = article
            .get("source_ids")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .filter(|id| valid_ids.contains(id))
                    .map(|s| s.to_string())
                    .collect()
            })
            .unwrap_or_default();

        // The constraint says "supported by AT LEAST 2 source memories" — enforce
        // it on our side too, in case the model relaxed it.
        if source_ids.len() < 2 {
            continue;
        }

        let input = CreatePersonaMemoryInput {
            persona_id: persona_id.clone(),
            title: title.clone(),
            content: body,
            category: Some("fact".to_string()),
            source_execution_id: None,
            importance: Some(4),
            tags: Some(Json(vec![
                "compiled".to_string(),
                "wiki".to_string(),
            ])),
            use_case_id: None,
        };

        match repo::create(&db, input) {
            Ok(memory) => {
                created_ids.push(memory.id.clone());
                titles.push(title);
                // Note: We don't currently link source IDs back into a separate
                // table — the cross-references live inside the body text per the
                // prompt instructions. A future enhancement could persist the
                // links into a `memory_compilation_sources` table.
                let _ = Uuid::new_v4(); // reserved for future link-table id
            }
            Err(_) => continue,
        }
    }

    Ok(MemoryCompileResult {
        source_count: raw.len(),
        created: created_ids.len(),
        created_ids,
        titles,
    })
}

/// Extract the first top-level JSON array from mixed text output.
/// Mirror of the helper in `commands::core::memories` — kept here to avoid
/// reaching across modules and to keep this file self-contained.
fn extract_json_array(text: &str) -> Option<String> {
    let start = text.find('[')?;
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escape_next = false;
    for (i, ch) in text[start..].char_indices() {
        if escape_next {
            escape_next = false;
            continue;
        }
        if in_string {
            match ch {
                '\\' => escape_next = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    return Some(text[start..start + i + 1].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_json_array_handles_compile_payload() {
        let input = r#"
[
  {"title": "T1", "body": "B1", "source_ids": ["a", "b"]},
  {"title": "T2", "body": "B2", "source_ids": ["c", "d"]}
]
"#;
        let extracted = extract_json_array(input).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&extracted).unwrap();
        assert_eq!(parsed.as_array().unwrap().len(), 2);
    }
}
