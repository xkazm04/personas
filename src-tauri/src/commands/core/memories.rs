use std::sync::Arc;
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::db::models::{CreatePersonaMemoryInput, PersonaMemory};
use crate::db::repos::core::memories as repo;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

#[tauri::command]
pub fn list_memories(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    category: Option<String>,
    search: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<PersonaMemory>, AppError> {
    require_auth_sync(&state)?;
    repo::get_all(&state.db, persona_id.as_deref(), category.as_deref(), search.as_deref(), limit, offset)
}

#[tauri::command]
pub fn create_memory(
    state: State<'_, Arc<AppState>>,
    input: CreatePersonaMemoryInput,
) -> Result<PersonaMemory, AppError> {
    require_auth_sync(&state)?;
    repo::create(&state.db, input)
}

#[tauri::command]
pub fn get_memory_count(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    category: Option<String>,
    search: Option<String>,
) -> Result<i64, AppError> {
    require_auth_sync(&state)?;
    repo::get_total_count(&state.db, persona_id.as_deref(), category.as_deref(), search.as_deref())
}

#[tauri::command]
pub fn get_memory_stats(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    category: Option<String>,
    search: Option<String>,
) -> Result<repo::MemoryStats, AppError> {
    require_auth_sync(&state)?;
    repo::get_stats(&state.db, persona_id.as_deref(), category.as_deref(), search.as_deref())
}

#[tauri::command]
pub fn list_memories_by_execution(
    state: State<'_, Arc<AppState>>,
    execution_id: String,
) -> Result<Vec<PersonaMemory>, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_execution(&state.db, &execution_id)
}

#[tauri::command]
pub fn delete_memory(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete(&state.db, &id)
}

#[tauri::command]
pub fn update_memory_importance(
    state: State<'_, Arc<AppState>>,
    id: String,
    importance: i32,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::update_importance(&state.db, &id, importance)
}

#[tauri::command]
pub fn batch_delete_memories(
    state: State<'_, Arc<AppState>>,
    ids: Vec<String>,
) -> Result<i64, AppError> {
    require_auth_sync(&state)?;
    repo::batch_delete(&state.db, &ids)
}

// ── LLM CLI Memory Review ──────────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
pub struct MemoryReviewDetail {
    pub id: String,
    pub title: String,
    pub score: i32,
    pub reason: String,
    pub action: String,
}

#[derive(Debug, serde::Serialize)]
pub struct MemoryReviewResult {
    pub reviewed: usize,
    pub deleted: usize,
    pub updated: usize,
    pub details: Vec<MemoryReviewDetail>,
}

#[tauri::command]
pub async fn review_memories_with_cli(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    threshold: Option<i32>,
) -> Result<MemoryReviewResult, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    let threshold = threshold.unwrap_or(7);

    // 1. Fetch memories
    let memories = repo::get_all(
        &db,
        persona_id.as_deref(),
        None,
        None,
        Some(200),
        Some(0),
    )?;

    if memories.is_empty() {
        return Ok(MemoryReviewResult {
            reviewed: 0,
            deleted: 0,
            updated: 0,
            details: vec![],
        });
    }

    // 2. Build prompt
    let memory_entries: Vec<serde_json::Value> = memories
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
        r#"You are reviewing agent memories from Personas, an AI agent management platform where autonomous agents execute tasks, use tools, handle events, and store memories to retain knowledge across executions.

Evaluate each memory for relevance to agent operations. Score 1-10:
- 9-10: Critical operational knowledge essential for agent tasks
- 7-8: Useful context that meaningfully aids agent performance
- 4-6: Marginal value, possibly outdated or vague
- 1-3: Noise, trivial, redundant, or no longer applicable

Respond with ONLY a JSON array. No markdown fences, no explanation, no surrounding text.
Example: [{{"id":"abc-123","score":8,"reason":"Core operational context"}}]

Memories to review:
{memories_json}"#
    );

    // 3. Build CLI args
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

    // 4. Spawn CLI
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

    // Write prompt to stdin
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(prompt.as_bytes()).await;
        let _ = stdin.shutdown().await;
    }

    // Read stdout
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
            "Memory review timed out after 3 minutes".into(),
        ));
    }

    let _ = child.wait().await;

    if full_output.trim().is_empty() {
        return Err(AppError::Internal("CLI produced no output".into()));
    }

    // 5. Parse JSON from output
    let json_str = extract_json_array(&full_output)
        .ok_or_else(|| AppError::Internal("Failed to parse review output as JSON".into()))?;

    let reviews: Vec<serde_json::Value> = serde_json::from_str(&json_str)
        .map_err(|e| AppError::Internal(format!("Invalid JSON in review output: {e}")))?;

    // 6. Apply changes
    let mut deleted_count = 0usize;
    let mut updated_count = 0usize;
    let mut details = Vec::new();

    let title_map: std::collections::HashMap<&str, &str> = memories
        .iter()
        .map(|m| (m.id.as_str(), m.title.as_str()))
        .collect();

    for review in &reviews {
        let id = review.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let score = review.get("score").and_then(|v| v.as_i64()).unwrap_or(5) as i32;
        let reason = review
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let title = title_map.get(id).unwrap_or(&"Unknown").to_string();

        if id.is_empty() {
            continue;
        }

        if score < threshold {
            let _ = repo::delete(&db, id);
            deleted_count += 1;
            details.push(MemoryReviewDetail {
                id: id.to_string(),
                title,
                score,
                reason,
                action: "deleted".to_string(),
            });
        } else {
            // Map 7-10 to importance 3-5
            let new_importance = match score {
                7 => 3,
                8 => 4,
                9..=10 => 5,
                _ => 3,
            };
            let _ = repo::update_importance(&db, id, new_importance);
            updated_count += 1;
            details.push(MemoryReviewDetail {
                id: id.to_string(),
                title,
                score,
                reason,
                action: "kept".to_string(),
            });
        }
    }

    Ok(MemoryReviewResult {
        reviewed: reviews.len(),
        deleted: deleted_count,
        updated: updated_count,
        details,
    })
}

/// Extract the first top-level JSON array from mixed text output.
fn extract_json_array(text: &str) -> Option<String> {
    let start = text.find('[')?;
    let mut depth = 0i32;
    for (i, ch) in text[start..].char_indices() {
        match ch {
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
