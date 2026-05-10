use std::sync::Arc;
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use ts_rs::TS;

use crate::db::models::{CreatePersonaMemoryInput, MemoryCategoryInfo, PersonaMemory};
use crate::db::repos::core::memories as repo;
use crate::db::repos::core::memory_review_proposal::{
    self as proposal_repo, CreateProposalInput, MemoryReviewProposal, ProposalEntry,
};
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

#[tauri::command]
pub fn list_memory_categories(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<MemoryCategoryInfo>, AppError> {
    require_auth_sync(&state)?;
    Ok(crate::db::models::all_category_info())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn list_memories(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    category: Option<String>,
    search: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    sort_column: Option<String>,
    sort_direction: Option<String>,
) -> Result<Vec<PersonaMemory>, AppError> {
    require_auth_sync(&state)?;
    repo::get_all(
        &state.db,
        persona_id.as_deref(),
        category.as_deref(),
        search.as_deref(),
        limit,
        offset,
        sort_column.as_deref(),
        sort_direction.as_deref(),
    )
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
    repo::get_total_count(
        &state.db,
        persona_id.as_deref(),
        category.as_deref(),
        search.as_deref(),
    )
}

#[tauri::command]
pub fn get_memory_stats(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    category: Option<String>,
    search: Option<String>,
) -> Result<repo::MemoryStats, AppError> {
    require_auth_sync(&state)?;
    repo::get_stats(
        &state.db,
        persona_id.as_deref(),
        category.as_deref(),
        search.as_deref(),
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn list_memories_with_stats(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    category: Option<String>,
    search: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    sort_column: Option<String>,
    sort_direction: Option<String>,
) -> Result<repo::MemoriesWithStats, AppError> {
    require_auth_sync(&state)?;
    repo::get_all_with_stats(
        &state.db,
        persona_id.as_deref(),
        category.as_deref(),
        search.as_deref(),
        limit,
        offset,
        sort_column.as_deref(),
        sort_direction.as_deref(),
    )
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
pub fn delete_memory(state: State<'_, Arc<AppState>>, id: String) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete(&state.db, &id)
}

#[tauri::command]
pub fn merge_memories(
    state: State<'_, Arc<AppState>>,
    input: CreatePersonaMemoryInput,
    delete_id_a: String,
    delete_id_b: String,
) -> Result<PersonaMemory, AppError> {
    require_auth_sync(&state)?;
    repo::merge(&state.db, input, &delete_id_a, &delete_id_b)
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

// -- Tier Management --------------------------------------------------------

#[tauri::command]
pub fn update_memory_tier(
    state: State<'_, Arc<AppState>>,
    id: String,
    tier: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::update_tier(&state.db, &id, &tier)
}

/// Run automatic memory lifecycle transitions for a persona.
/// Returns { promoted, archived } counts.
#[tauri::command]
pub fn run_memory_lifecycle(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<MemoryLifecycleResult, AppError> {
    require_auth_sync(&state)?;
    let (promoted, archived) = repo::run_lifecycle(&state.db, &persona_id)?;
    Ok(MemoryLifecycleResult { promoted, archived })
}

#[derive(Debug, serde::Serialize, TS)]
#[ts(export)]
pub struct MemoryLifecycleResult {
    pub promoted: i64,
    pub archived: i64,
}

// -- LLM CLI Memory Review --------------------------------------------------

#[derive(Debug, serde::Serialize, TS)]
#[ts(export)]
pub struct MemoryReviewDetail {
    pub id: String,
    pub title: String,
    pub score: i32,
    pub reason: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
}

#[derive(Debug, serde::Serialize, TS)]
#[ts(export)]
pub struct MemoryReviewResult {
    pub reviewed: usize,
    pub deleted: usize,
    pub updated: usize,
    pub details: Vec<MemoryReviewDetail>,
    /// Set when the call was made in proposal mode (`auto_apply: false`).
    /// Points at a `persona_memory_review_proposal` row that the user
    /// can later apply via `apply_persona_memory_review_proposal` or
    /// discard via `discard_persona_memory_review_proposal`. `None` in
    /// auto-apply mode (the legacy direct-mutation path).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub proposal_id: Option<String>,
}

/// Maximum instructions length in characters. Mirrors Anthropic Managed
/// Agents' dream `instructions` cap; large enough for a paragraph of
/// guidance, small enough to prevent operators from stuffing whole
/// prompts into the steering field.
pub(crate) const MAX_INSTRUCTIONS_CHARS: usize = 4096;

/// Run an LLM-driven relevance review across persona memories.
///
/// Two modes, controlled by `auto_apply`:
///
/// - `auto_apply = Some(true)` (default for back-compat with existing
///   UI callers): the legacy direct-mutation path. Low-score memories
///   are deleted, high-score memories get an importance bump, the
///   `MemoryReviewResult` reports counts and per-id detail. `proposal_id`
///   is `None`.
///
/// - `auto_apply = Some(false)` (new path, mirrors Anthropic Managed
///   Agents' dream review-and-discard semantics): no live memory rows
///   are touched. The proposed (id, score, action) entries are written
///   to `persona_memory_review_proposal`. The returned result carries
///   the `proposal_id`; `deleted` and `updated` are 0. The user later
///   calls `apply_persona_memory_review_proposal` (executes the
///   proposal transactionally) or `discard_persona_memory_review_proposal`
///   (marks discarded; nothing applied).
///
/// `instructions` is optional natural-language steering (≤4096 chars)
/// folded into the LLM prompt. Validated at the IPC boundary.
#[tauri::command]
pub async fn review_memories_with_cli(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    threshold: Option<i32>,
    instructions: Option<String>,
    auto_apply: Option<bool>,
) -> Result<MemoryReviewResult, AppError> {
    require_auth(&state).await?;
    if let Some(ref s) = instructions {
        if s.chars().count() > MAX_INSTRUCTIONS_CHARS {
            return Err(AppError::Validation(format!(
                "instructions must be ≤{MAX_INSTRUCTIONS_CHARS} characters"
            )));
        }
    }
    let db = state.db.clone();
    let threshold = threshold.unwrap_or(7);
    // Default to true to preserve back-compat with existing review-button
    // UI. New callers opt into proposal mode by passing `false`.
    let auto_apply = auto_apply.unwrap_or(true);

    // 1. Fetch memories
    let memories = repo::get_all(
        &db,
        persona_id.as_deref(),
        None,
        None,
        Some(200),
        Some(0),
        None,
        None,
    )?;

    if memories.is_empty() {
        return Ok(MemoryReviewResult {
            reviewed: 0,
            deleted: 0,
            updated: 0,
            details: vec![],
            proposal_id: None,
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

    let guidance_block = instructions
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("\n\nAdditional guidance from operator:\n{s}\n"))
        .unwrap_or_default();

    let prompt = format!(
        r#"You are reviewing agent memories from Personas, an AI agent management platform where autonomous agents execute tasks, use tools, handle events, and store memories to retain knowledge across executions.

Evaluate each memory for relevance to agent operations. Score 1-10:
- 9-10: Critical operational knowledge essential for agent tasks
- 7-8: Useful context that meaningfully aids agent performance
- 4-6: Marginal value, possibly outdated or vague
- 1-3: Noise, trivial, redundant, or no longer applicable

Respond with ONLY a JSON array. No markdown fences, no explanation, no surrounding text.
Example: [{{"id":"abc-123","score":8,"reason":"Core operational context"}}]
{guidance_block}
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
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| AppError::Internal(format!("Failed to write prompt to CLI stdin: {e}")))?;
        stdin
            .shutdown()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to close CLI stdin: {e}")))?;
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

    // 6. Collect changes (deferred application — see auto_apply branch
    //    further down). In proposal mode we serialize these into a
    //    persona_memory_review_proposal row and return without
    //    mutating; in auto-apply mode we proceed to the per-id batch
    //    operations.
    let mut ids_to_delete = Vec::new();
    let mut importance_updates = Vec::new();
    let mut details = Vec::new();

    let title_map: std::collections::HashMap<&str, &str> = memories
        .iter()
        .map(|m| (m.id.as_str(), m.title.as_str()))
        .collect();

    for review in &reviews {
        let id = review.get("id").and_then(|v| v.as_str()).unwrap_or("");

        if id.is_empty() {
            continue;
        }

        // Only act on IDs that exist in the fetched batch — reject hallucinated IDs
        let title = match title_map.get(id) {
            Some(t) => t.to_string(),
            None => continue,
        };

        // Reject reviews with missing scores instead of defaulting to a low value
        let score = match review.get("score").and_then(|v| v.as_i64()) {
            Some(s) => s as i32,
            None => continue,
        };

        let reason = review
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if score < threshold {
            ids_to_delete.push(id.to_string());
            details.push(MemoryReviewDetail {
                id: id.to_string(),
                title,
                score,
                reason,
                action: "deleted".to_string(),
                error: None,
            });
        } else {
            // Map 7-10 to importance 3-5
            let new_importance = match score {
                7 => 3,
                8 => 4,
                9..=10 => 5,
                _ => 3,
            };
            importance_updates.push((id.to_string(), new_importance));
            details.push(MemoryReviewDetail {
                id: id.to_string(),
                title,
                score,
                reason,
                action: "kept".to_string(),
                error: None,
            });
        }
    }

    // 6b. Proposal-mode short-circuit. When auto_apply is false we
    // serialize the (id, score, action) entries into a row in
    // persona_memory_review_proposal and return without touching live
    // memory data. The user reviews the proposal and either applies
    // it (executes the same per-id batch operations transactionally
    // via apply_persona_memory_review_proposal) or discards it.
    if !auto_apply {
        let entries: Vec<ProposalEntry> = details
            .iter()
            .map(|d| {
                let action = if d.action == "deleted" {
                    "delete".to_string()
                } else {
                    "update_importance".to_string()
                };
                let new_importance = importance_updates
                    .iter()
                    .find(|(id, _)| id == &d.id)
                    .map(|(_, imp)| *imp);
                ProposalEntry {
                    memory_id: d.id.clone(),
                    title: d.title.clone(),
                    score: d.score,
                    reason: d.reason.clone(),
                    action,
                    new_importance,
                }
            })
            .collect();
        let summary = format!(
            "Reviewed {n} memories; proposed {p} change(s).",
            n = details.len(),
            p = ids_to_delete.len() + importance_updates.len()
        );
        let proposal_id = proposal_repo::create(
            &db,
            CreateProposalInput {
                persona_id: persona_id.as_deref(),
                threshold,
                instructions: instructions.as_deref(),
                entries: &entries,
                summary: Some(&summary),
            },
        )?;
        // Refresh details to surface the proposal action so the UI
        // can render "proposed: delete" vs "proposed: keep" without
        // assuming a deletion has already happened.
        for d in details.iter_mut() {
            if d.action == "deleted" {
                d.action = "proposed_delete".to_string();
            } else if d.action == "kept" {
                d.action = "proposed_update_importance".to_string();
            }
        }
        return Ok(MemoryReviewResult {
            reviewed: reviews.len(),
            deleted: 0,
            updated: 0,
            details,
            proposal_id: Some(proposal_id),
        });
    }

    // Apply deletes per-id so a single failure does not mask successful writes
    // and so the UI can show exactly which IDs failed (FK violation, row gone,
    // etc.) without losing partial-success reporting.
    let mut deleted_count: usize = 0;
    for id in &ids_to_delete {
        match repo::delete(&db, id) {
            Ok(true) => {
                deleted_count += 1;
            }
            Ok(false) => {
                if let Some(d) = details.iter_mut().find(|d| d.id == *id) {
                    d.action = "error".to_string();
                    d.error = Some("Memory not found (already deleted?)".to_string());
                }
            }
            Err(e) => {
                if let Some(d) = details.iter_mut().find(|d| d.id == *id) {
                    d.action = "error".to_string();
                    d.error = Some(format!("{e}"));
                }
            }
        }
    }

    // Apply importance updates per-id for the same reason.
    let mut updated_count: usize = 0;
    for (id, importance) in &importance_updates {
        match repo::update_importance(&db, id, *importance) {
            Ok(true) => {
                updated_count += 1;
            }
            Ok(false) => {
                if let Some(d) = details.iter_mut().find(|d| d.id == *id) {
                    d.action = "error".to_string();
                    d.error = Some("Memory not found (deleted since fetch?)".to_string());
                }
            }
            Err(e) => {
                if let Some(d) = details.iter_mut().find(|d| d.id == *id) {
                    d.action = "error".to_string();
                    d.error = Some(format!("{e}"));
                }
            }
        }
    }

    Ok(MemoryReviewResult {
        reviewed: reviews.len(),
        deleted: deleted_count,
        updated: updated_count,
        details,
        proposal_id: None,
    })
}

// -- Memory review proposals (review-and-discard) --------------------------------

#[derive(Debug, serde::Serialize, TS)]
#[ts(export)]
pub struct ApplyMemoryReviewProposalResult {
    pub proposal_id: String,
    pub deleted: usize,
    pub updated: usize,
    pub errors: Vec<String>,
}

/// Apply a `pending_review` memory-review proposal: delete each
/// `delete` entry and bump importance for each `update_importance`
/// entry. Marks the proposal `applied` only if the status flip
/// succeeds (idempotent — re-applying an already-applied proposal
/// returns a 0-count result without re-mutating).
#[tauri::command]
pub fn apply_persona_memory_review_proposal(
    state: State<'_, Arc<AppState>>,
    proposal_id: String,
) -> Result<ApplyMemoryReviewProposalResult, AppError> {
    require_auth_sync(&state)?;
    let proposal = proposal_repo::get(&state.db, &proposal_id)?
        .ok_or_else(|| AppError::NotFound(format!("proposal `{proposal_id}` not found")))?;
    if proposal.status != "pending_review" {
        return Ok(ApplyMemoryReviewProposalResult {
            proposal_id,
            deleted: 0,
            updated: 0,
            errors: vec![format!(
                "proposal already in status `{}` — no action taken",
                proposal.status
            )],
        });
    }

    let mut deleted = 0usize;
    let mut updated = 0usize;
    let mut errors: Vec<String> = Vec::new();

    for entry in &proposal.entries {
        match entry.action.as_str() {
            "delete" => match repo::delete(&state.db, &entry.memory_id) {
                Ok(true) => deleted += 1,
                Ok(false) => errors.push(format!(
                    "memory `{}` not found (already deleted?)",
                    entry.memory_id
                )),
                Err(e) => errors.push(format!("memory `{}` delete: {}", entry.memory_id, e)),
            },
            "update_importance" => {
                let importance = entry.new_importance.unwrap_or(3).clamp(1, 5);
                match repo::update_importance(&state.db, &entry.memory_id, importance) {
                    Ok(true) => updated += 1,
                    Ok(false) => errors.push(format!(
                        "memory `{}` not found for importance bump",
                        entry.memory_id
                    )),
                    Err(e) => errors.push(format!(
                        "memory `{}` update_importance: {}",
                        entry.memory_id, e
                    )),
                }
            }
            "keep" => {} // no-op
            other => errors.push(format!(
                "unknown action `{other}` on memory `{}`; skipped",
                entry.memory_id
            )),
        }
    }

    proposal_repo::mark_applied(&state.db, &proposal_id)?;
    Ok(ApplyMemoryReviewProposalResult {
        proposal_id,
        deleted,
        updated,
        errors,
    })
}

/// Mark a `pending_review` memory-review proposal as `discarded`. No
/// live memory data is touched. Idempotent — re-discarding an
/// already-decided proposal returns false.
#[tauri::command]
pub fn discard_persona_memory_review_proposal(
    state: State<'_, Arc<AppState>>,
    proposal_id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    proposal_repo::mark_discarded(&state.db, &proposal_id)
}

#[tauri::command]
pub fn list_persona_memory_review_proposals(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    only_pending: Option<bool>,
    limit: Option<u32>,
) -> Result<Vec<MemoryReviewProposal>, AppError> {
    require_auth_sync(&state)?;
    proposal_repo::list(
        &state.db,
        persona_id.as_deref(),
        only_pending.unwrap_or(false),
        limit.unwrap_or(50),
    )
}

#[tauri::command]
pub fn get_persona_memory_review_proposal(
    state: State<'_, Arc<AppState>>,
    proposal_id: String,
) -> Result<Option<MemoryReviewProposal>, AppError> {
    require_auth_sync(&state)?;
    proposal_repo::get(&state.db, &proposal_id)
}

// -- Dev seed: mock memory (debug builds only) -----------------------------------

#[tauri::command]
pub fn seed_mock_memory(_state: State<'_, Arc<AppState>>) -> Result<PersonaMemory, AppError> {
    #[cfg(debug_assertions)]
    {
        require_auth_sync(&_state)?;

        const MOCK_TITLES: &[&str] = &[
            "Prefers JSON responses over XML",
            "Retry failed API calls up to 3 times",
            "Use UTC timezone for all timestamps",
            "Customer prefers email over Slack",
            "Rate limit: 100 req/min on external APIs",
            "Always include correlation ID in logs",
            "Summarize long documents to under 500 words",
            "Skip weekend scheduling for notifications",
        ];
        const MOCK_CONTENTS: &[&str] = &[
            "When formatting output, always use JSON. The downstream consumers parse JSON and XML causes failures.",
            "External API calls should retry with exponential backoff. Max 3 attempts with 1s, 2s, 4s delays.",
            "All date/time values must be in UTC. Converting to local timezone happens on the frontend only.",
            "Based on past interactions, this customer responds faster to email. Slack messages are often missed.",
            "The third-party API enforces 100 requests per minute. Implement token-bucket rate limiting.",
            "Every log entry must include the X-Correlation-ID header value for distributed tracing.",
            "Long documents (>2000 words) should be summarized before processing to stay within token limits.",
            "Business notifications should only be sent Mon-Fri 9am-6pm UTC. Queue weekend events for Monday.",
        ];
        const MOCK_CATEGORIES: &[&str] = &[
            "preference",
            "instruction",
            "instruction",
            "preference",
            "constraint",
            "instruction",
            "preference",
            "constraint",
        ];
        const MOCK_TAGS: &[&str] = &[
            r#"["formatting","output"]"#,
            r#"["reliability","api"]"#,
            r#"["timezone","standard"]"#,
            r#"["communication","customer"]"#,
            r#"["api","rate-limit"]"#,
            r#"["logging","observability"]"#,
            r#"["summarization","nlp"]"#,
            r#"["scheduling","notifications"]"#,
        ];

        let personas = crate::db::repos::core::personas::get_all(&_state.db)?;
        let idx =
            (chrono::Utc::now().timestamp_millis() as usize) % std::cmp::max(personas.len(), 1);
        let persona_id = personas
            .get(idx)
            .map(|p| p.id.clone())
            .unwrap_or_else(|| "mock-persona".to_string());

        let t = (chrono::Utc::now().timestamp_millis() as usize) / 7;
        let input = CreatePersonaMemoryInput {
            persona_id,
            title: MOCK_TITLES[t % MOCK_TITLES.len()].to_string(),
            content: MOCK_CONTENTS[t % MOCK_CONTENTS.len()].to_string(),
            category: Some(MOCK_CATEGORIES[t % MOCK_CATEGORIES.len()].to_string()),
            source_execution_id: None,
            importance: Some(((t % 5) + 1) as i32),
            tags: Some(crate::db::models::Json(vec![MOCK_TAGS
                [t % MOCK_TAGS.len()]
            .to_string()])),
            use_case_id: None,
        };

        return repo::create(&_state.db, input);
    }

    #[allow(unreachable_code)]
    Err(AppError::Internal(
        "seed_mock_memory is only available in debug builds".into(),
    ))
}

/// Extract the first top-level JSON array from mixed text output.
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
    fn extract_json_array_simple() {
        let input = r#"Here is the result: [1, 2, 3] done"#;
        assert_eq!(extract_json_array(input), Some("[1, 2, 3]".to_string()));
    }

    #[test]
    fn extract_json_array_brackets_in_strings() {
        let input = r#"[{"title": "[API] Rate limit", "note": "has [brackets]"}]"#;
        assert_eq!(extract_json_array(input), Some(input.to_string()));
    }

    #[test]
    fn extract_json_array_escaped_quotes() {
        let input = r#"[{"val": "a\"]\"]b"}]"#;
        assert_eq!(extract_json_array(input), Some(input.to_string()));
    }

    #[test]
    fn extract_json_array_nested() {
        let input = r#"text [[1, 2], [3]] end"#;
        assert_eq!(extract_json_array(input), Some("[[1, 2], [3]]".to_string()));
    }

    #[test]
    fn extract_json_array_no_array() {
        assert_eq!(extract_json_array("no array here"), None);
    }

    #[test]
    fn extract_json_array_unclosed() {
        assert_eq!(extract_json_array("[1, 2"), None);
    }
}
