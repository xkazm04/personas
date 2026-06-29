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
    tier: Option<String>,
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
        tier.as_deref(),
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
    tier: Option<String>,
) -> Result<i64, AppError> {
    require_auth_sync(&state)?;
    repo::get_total_count(
        &state.db,
        persona_id.as_deref(),
        category.as_deref(),
        search.as_deref(),
        tier.as_deref(),
    )
}

#[tauri::command]
pub fn get_memory_stats(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    category: Option<String>,
    search: Option<String>,
    tier: Option<String>,
) -> Result<repo::MemoryStats, AppError> {
    require_auth_sync(&state)?;
    repo::get_stats(
        &state.db,
        persona_id.as_deref(),
        category.as_deref(),
        search.as_deref(),
        tier.as_deref(),
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn list_memories_with_stats(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    category: Option<String>,
    search: Option<String>,
    tier: Option<String>,
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
        tier.as_deref(),
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
pub fn delete_all_memories(state: State<'_, Arc<AppState>>) -> Result<usize, AppError> {
    require_auth_sync(&state)?;
    repo::delete_all(&state.db)
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

/// Patch title + content + importance + tags on an existing memory row.
/// Used by the message-rating upsert flow so re-rating updates rather
/// than duplicates.
#[tauri::command]
pub fn update_memory_content(
    state: State<'_, Arc<AppState>>,
    id: String,
    title: String,
    content: String,
    importance: i32,
    tags: Option<Vec<String>>,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::update_content(
        &state.db,
        &id,
        &title,
        &content,
        importance,
        tags.as_deref(),
    )
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

// -- Shared memory-review pipeline helper ----------------------------------
//
// Used by:
//   - `review_memories_with_cli` (IPC command, sync auto_apply path or
//     proposal-mode path)
//   - `engine::persona_jobs::memory_curation_run` (background-job worker
//     that always uses proposal mode)
//
// Concept: fetch memories + (optionally) recent executions → build a
// scoring prompt → spawn the Claude CLI → parse the JSON output →
// classify into deletes / importance bumps / detail rows. Returns a
// `MemoryReviewPipeline` the caller branches on.
//
// Returns `Ok(None)` when no memories exist for the persona/scope —
// callers treat this as "nothing to do" rather than an error.

pub(crate) struct MemoryReviewPipelineOpts<'a> {
    pub persona_id: Option<&'a str>,
    pub threshold: i32,
    pub instructions: Option<&'a str>,
    /// F-SESSIONS: include up to N recent executions for the persona as
    /// session context in the prompt. `None` = no executions (legacy
    /// behavior, used by the IPC command). `Some(n)` = prepend a
    /// "Recent agent executions" section with up to n executions,
    /// each clamped to ~1KB of input + ~1KB of output.
    pub include_recent_executions: Option<usize>,
}

pub(crate) struct MemoryReviewPipeline {
    pub reviews_count: usize,
    pub entries: Vec<ProposalEntry>,
    pub details: Vec<MemoryReviewDetail>,
    pub ids_to_delete: Vec<String>,
    pub importance_updates: Vec<(String, i32)>,
}

// Score→importance mapping for the LLM memory review.
//
// The curator CLI scores each kept memory 1–10; these constants translate
// that into the 1–5 `importance` scale (see MEMORY CONTRACT (4) for the
// bounds). They are only ever used to RAISE a memory's importance
// (`new = max(existing, mapped)`) and are skipped entirely for user-pinned
// `core`-tier rows — so an LLM re-score can promote a neglected memory but
// can never silently erode deliberately-curated importance, which is the
// PRIMARY injection sort key (`get_for_injection_v2 ORDER BY importance DESC`).
const REVIEW_IMPORTANCE_SCORE_7: i32 = 3; // "useful context"
const REVIEW_IMPORTANCE_SCORE_8: i32 = 4; // "meaningfully aids performance"
const REVIEW_IMPORTANCE_SCORE_9_10: i32 = 5; // "critical operational knowledge"
const REVIEW_IMPORTANCE_DEFAULT: i32 = 3; // any other kept score (low thresholds)

/// Map a CLI relevance score (1–10) to the proposed 1–5 importance value.
/// Used only as a *ceiling candidate*: the caller still applies the
/// only-raise / skip-core rules before writing anything.
fn score_to_importance(score: i32) -> i32 {
    match score {
        7 => REVIEW_IMPORTANCE_SCORE_7,
        8 => REVIEW_IMPORTANCE_SCORE_8,
        9..=10 => REVIEW_IMPORTANCE_SCORE_9_10,
        _ => REVIEW_IMPORTANCE_DEFAULT,
    }
}

/// Run the LLM-driven memory review pipeline. See module-level comment
/// for the contract. Caller responsible for downstream apply / write-
/// proposal work.
pub(crate) async fn run_memory_review_pipeline(
    pool: &crate::db::DbPool,
    opts: MemoryReviewPipelineOpts<'_>,
) -> Result<Option<MemoryReviewPipeline>, AppError> {
    use crate::db::repos::execution::executions as executions_repo;

    let MemoryReviewPipelineOpts {
        persona_id,
        threshold,
        instructions,
        include_recent_executions,
    } = opts;

    // 1. Fetch memories.
    let memories = repo::get_all(pool, persona_id, None, None, None, Some(200), Some(0), None, None)?;
    if memories.is_empty() {
        return Ok(None);
    }

    // 1b. F-SESSIONS: optionally fetch recent executions as session context.
    //
    // Anthropic's dreams take a memory store + up to 100 sessions. Personas's
    // analog: feed the curator recent execution traces so it can spot
    // memories that are stale relative to what the agent actually did.
    // Only meaningful when persona_id is set (workspace-wide curation
    // would mix execution traces from many personas, which the LLM
    // can't sensibly correlate to memory entries).
    //
    // Per-execution clamps prevent prompt blowup: input_data and
    // output_data are each truncated to 1024 chars with a `…[truncated]`
    // marker; error_message stays as-is (typically short).
    let executions_block = match (include_recent_executions, persona_id) {
        (Some(n), Some(pid)) if n > 0 => {
            let execs = executions_repo::get_by_persona_id(pool, pid, Some(n as i64))?;
            if execs.is_empty() {
                String::new()
            } else {
                let mut block = String::from("\n\n## Recent agent executions (oldest first)\n\n");
                // Reverse to oldest-first so the LLM reads them in chronological
                // order, matching how a human would scan a session log.
                for ex in execs.iter().rev() {
                    block.push_str(&format!(
                        "### {created} — status: {status}\n",
                        created = ex.created_at,
                        status = ex.status,
                    ));
                    if let Some(input) = ex.input_data.as_deref() {
                        block.push_str("**input:** ");
                        block.push_str(&truncate_for_prompt(input, 1024));
                        block.push('\n');
                    }
                    if let Some(output) = ex.output_data.as_deref() {
                        block.push_str("**output:** ");
                        block.push_str(&truncate_for_prompt(output, 1024));
                        block.push('\n');
                    }
                    if let Some(err) = ex.error_message.as_deref() {
                        block.push_str("**error:** ");
                        block.push_str(err);
                        block.push('\n');
                    }
                    block.push('\n');
                }
                block
            }
        }
        _ => String::new(),
    };

    // 2. Build prompt.
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
{guidance_block}{executions_block}
Memories to review:
{memories_json}"#
    );

    // 3. Build CLI args (shared resolver — verified absolute claude.cmd).
    let (program, mut args) = crate::engine::cli_process::claude_cli_invocation();
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

    // 4. Spawn CLI.
    let mut cmd = Command::new(&program);
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
    // Evaluation runs on the Claude monthly subscription only — never bill the
    // API account (strip any inherited/injected ANTHROPIC_* auth).
    for key in crate::engine::cli_process::CLI_SUBSCRIPTION_RESERVED_ENV {
        cmd.env_remove(key);
    }
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
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| AppError::Internal(format!("Failed to write prompt to CLI stdin: {e}")))?;
        stdin
            .shutdown()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to close CLI stdin: {e}")))?;
    }

    // 5. Read stdout.
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("No stdout".into()))?;
    let mut reader = BufReader::new(stdout);
    let mut full_output = String::new();
    let cli_timeout = std::time::Duration::from_secs(180);
    let read_result = tokio::time::timeout(cli_timeout, async {
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

    // 6. Parse JSON array from output.
    let json_str = extract_json_array(&full_output)
        .ok_or_else(|| AppError::Internal("Failed to parse review output as JSON".into()))?;
    let reviews: Vec<serde_json::Value> = serde_json::from_str(&json_str)
        .map_err(|e| AppError::Internal(format!("Invalid JSON in review output: {e}")))?;

    // 7. Classify into deletes / importance bumps / details / proposal entries.
    let mut ids_to_delete = Vec::new();
    let mut importance_updates = Vec::new();
    let mut details = Vec::new();
    let mut entries: Vec<ProposalEntry> = Vec::new();

    let title_map: std::collections::HashMap<&str, &str> = memories
        .iter()
        .map(|m| (m.id.as_str(), m.title.as_str()))
        .collect();
    // Existing (importance, tier) for each fetched memory. Used to enforce
    // the only-raise rule and to skip user-pinned `core` rows so the review
    // never lowers a deliberately-curated importance.
    let meta_map: std::collections::HashMap<&str, (i32, &str)> = memories
        .iter()
        .map(|m| (m.id.as_str(), (m.importance, m.tier.as_str())))
        .collect();

    for review in &reviews {
        let id = review.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if id.is_empty() {
            continue;
        }
        let title = match title_map.get(id) {
            Some(t) => t.to_string(),
            None => continue,
        };
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
                title: title.clone(),
                score,
                reason: reason.clone(),
                action: "deleted".to_string(),
                error: None,
            });
            entries.push(ProposalEntry {
                memory_id: id.to_string(),
                title,
                score,
                reason,
                action: "delete".to_string(),
                new_importance: None,
            });
        } else {
            // The memory is KEPT either way. We only constrain the importance
            // mutation: never lower a value, and never auto-touch a user-pinned
            // `core`-tier row. (existing, tier) come from the fetched row.
            let (existing_importance, tier) =
                meta_map.get(id).copied().unwrap_or((0, "active"));
            let mapped = score_to_importance(score);
            // Only RAISE (new = max(existing, mapped) => write iff mapped >
            // existing) and skip importance writes entirely for `core`.
            let should_raise = tier != "core" && mapped > existing_importance;

            details.push(MemoryReviewDetail {
                id: id.to_string(),
                title: title.clone(),
                score,
                reason: reason.clone(),
                action: "kept".to_string(),
                error: None,
            });
            if should_raise {
                importance_updates.push((id.to_string(), mapped));
                entries.push(ProposalEntry {
                    memory_id: id.to_string(),
                    title,
                    score,
                    reason,
                    action: "update_importance".to_string(),
                    new_importance: Some(mapped),
                });
            } else {
                // Keep as-is: no importance write (would lower the value or
                // touch a core row). Recorded as a no-op so the proposal/apply
                // path leaves the user's importance untouched.
                entries.push(ProposalEntry {
                    memory_id: id.to_string(),
                    title,
                    score,
                    reason,
                    action: "keep".to_string(),
                    new_importance: None,
                });
            }
        }
    }

    Ok(Some(MemoryReviewPipeline {
        reviews_count: reviews.len(),
        entries,
        details,
        ids_to_delete,
        importance_updates,
    }))
}

/// Extract the outermost JSON array from a string. Public for cross-module
/// reuse (worker pipeline in `engine::persona_jobs` was duplicating this
/// logic before F-DRY).
pub(crate) fn extract_json_array_from(s: &str) -> Option<String> {
    extract_json_array(s)
}

/// Clamp a free-form text field to `max_chars` characters for inclusion in
/// an LLM prompt. Char-boundary-aware so we never split a multi-byte UTF-8
/// codepoint. Adds a `…[truncated]` marker when content was clipped so the
/// model knows it's looking at a partial.
fn truncate_for_prompt(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let mut end = 0usize;
    for (i, _) in s.char_indices().take(max_chars) {
        end = i;
    }
    // `end` now points at the last kept-char's start; advance to its end.
    if let Some((next_idx, _)) = s.char_indices().nth(max_chars) {
        end = next_idx;
    } else {
        end = s.len();
    }
    format!("{}…[truncated]", &s[..end])
}

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

    // F-DRY: delegate the heavy lifting (fetch + prompt + CLI + parse +
    // classify) to the shared pipeline helper. The persona_jobs worker
    // calls the same helper with `include_recent_executions: Some(20)`.
    let pipeline = match run_memory_review_pipeline(
        &db,
        MemoryReviewPipelineOpts {
            persona_id: persona_id.as_deref(),
            threshold,
            instructions: instructions.as_deref(),
            // IPC default: no execution context. Keeps this command's
            // legacy behavior byte-identical for back-compat. The
            // worker uses Some(20) to enrich curation runs.
            include_recent_executions: None,
        },
    )
    .await?
    {
        Some(p) => p,
        None => {
            return Ok(MemoryReviewResult {
                reviewed: 0,
                deleted: 0,
                updated: 0,
                details: vec![],
                proposal_id: None,
            });
        }
    };

    let MemoryReviewPipeline {
        reviews_count,
        entries,
        mut details,
        ids_to_delete,
        importance_updates,
    } = pipeline;

    // Proposal-mode short-circuit. When auto_apply is false we
    // serialize the (id, score, action) entries into a row in
    // persona_memory_review_proposal and return without touching live
    // memory data. The user reviews the proposal and either applies
    // it (executes the same per-id batch operations transactionally
    // via apply_persona_memory_review_proposal) or discards it.
    if !auto_apply {
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
            reviewed: reviews_count,
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
        reviewed: reviews_count,
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

    // Compare-and-swap the status to `applied` BEFORE mutating: mark_applied does
    // UPDATE ... WHERE status='pending_review' and returns whether it transitioned.
    // Only the winner proceeds — a concurrent Apply / double-click / re-apply after
    // a crash gets `false` and bails, so the mutation set runs at most once (no
    // double-delete, no double importance-bump, no proposal stuck pending_review).
    if !proposal_repo::mark_applied(&state.db, &proposal_id)? {
        return Ok(ApplyMemoryReviewProposalResult {
            proposal_id,
            deleted: 0,
            updated: 0,
            errors: vec![
                "proposal was already applied by a concurrent action — no action taken".into(),
            ],
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

    // Status was already flipped to `applied` up front (CAS); entries that failed
    // are surfaced in `errors`. Full per-batch transactional rollback on a
    // mid-apply crash is a remaining follow-up.
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
    fn truncate_for_prompt_short_string_unchanged() {
        let s = "hello";
        assert_eq!(truncate_for_prompt(s, 10), "hello");
    }

    #[test]
    fn truncate_for_prompt_at_boundary_unchanged() {
        let s = "hello";
        assert_eq!(truncate_for_prompt(s, 5), "hello");
    }

    #[test]
    fn truncate_for_prompt_long_string_clipped() {
        let s = "abcdefghij";
        let out = truncate_for_prompt(s, 5);
        assert_eq!(out, "abcde…[truncated]");
    }

    #[test]
    fn truncate_for_prompt_handles_multibyte_safely() {
        // 5 grinning-face emoji = 5 chars, 20 bytes. Asking for 3 chars
        // must not split a codepoint mid-byte.
        let s = "😀😀😀😀😀";
        let out = truncate_for_prompt(s, 3);
        assert_eq!(out, "😀😀😀…[truncated]");
        // And a request equal to the char count is a pass-through.
        assert_eq!(truncate_for_prompt(s, 5), s);
    }

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
