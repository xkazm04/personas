//! Director memory curation — the Director archives a persona's useless or
//! duplicate memories so recall context stays clean.
//!
//! Two passes, both reversible (`tier = 'archive'`; never deletes, never touches
//! `core`):
//!   1. **Dedup sweep** — deterministic, no LLM. Groups the persona's
//!      non-core/non-archive memories by normalized content and archives all but
//!      the keeper of each duplicate group (extends the 24h write-time dedup
//!      across all time).
//!   2. **"Won't-use" pass** — bounded LLM judgment. Runs the Director persona in
//!      MEMORY CLEANUP MODE over the stalest candidates and archives the ones it
//!      is confident won't inform a future run. Skipped entirely when there are
//!      no candidates (cost guard).
//!
//! Invoked per-persona inside `run_director_cycle_for` (after the review) and on
//! demand via the `run_director_memory_cleanup` command. Archived memories stop
//! reaching personas (`get_for_injection_v2` excludes the archive tier) but stay
//! searchable + restorable from the Memories UI.

use std::collections::HashSet;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::PersonaMemory;
use crate::db::repos::core::{memories, personas};
use crate::error::AppError;
use crate::AppState;

use super::director::{await_execution_terminal, get_director_persona_id};

const ARCHIVE_MARKER: &str = "DIRECTOR_MEMORY_ARCHIVE:";
/// Hard cap on LLM-proposed archives per run (the deterministic dedup sweep is
/// uncapped — duplicates are always safe to collapse).
const MAX_ARCHIVES_PER_RUN: usize = 40;
/// How many stale candidates to show the LLM in one cleanup pass.
const CANDIDATE_LIMIT: i64 = 60;
/// Content truncation for the cleanup payload (keep tokens bounded).
const MEMORY_SNIPPET_CHARS: usize = 200;

/// Outcome of one persona's memory cleanup. Surfaced to the UI.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCleanupReport {
    /// Candidate memories the pass examined (active/working set, bounded).
    #[ts(type = "number")]
    pub scanned: i64,
    /// Archived as exact/near duplicates (deterministic sweep).
    #[ts(type = "number")]
    pub deduped: i64,
    /// Archived by the LLM "won't-use" judgment.
    #[ts(type = "number")]
    pub llm_archived: i64,
    /// Ids actually archived (empty on dry runs).
    pub archived_ids: Vec<String>,
    pub dry_run: bool,
}

#[derive(Debug, Deserialize)]
struct RawArchive {
    id: String,
    #[serde(default)]
    #[allow(dead_code)] // reason is for the model's benefit / logs, not persisted
    reason: String,
}

/// Parse every `DIRECTOR_MEMORY_ARCHIVE: {json}` line. Mirrors `parse_wins`:
/// malformed lines skipped, capped at `MAX_ARCHIVES_PER_RUN`. Only ids present
/// in `valid_ids` are accepted (guards against hallucinated ids / archiving
/// memories that weren't offered, e.g. core).
pub(super) fn parse_memory_archives(output: &str, valid_ids: &HashSet<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for line in output.lines() {
        let trimmed = line.trim();
        let Some(idx) = trimmed.find(ARCHIVE_MARKER) else {
            continue;
        };
        let json_part = trimmed[idx + ARCHIVE_MARKER.len()..].trim();
        if json_part.is_empty() {
            continue;
        }
        match serde_json::from_str::<RawArchive>(json_part) {
            Ok(raw) if valid_ids.contains(&raw.id) && seen.insert(raw.id.clone()) => {
                out.push(raw.id);
            }
            Ok(_) => {} // unknown/duplicate id — drop silently
            Err(e) => {
                tracing::warn!(error = %e, line = %json_part, "Director: skipping malformed memory-archive line");
            }
        }
        if out.len() >= MAX_ARCHIVES_PER_RUN {
            break;
        }
    }
    out
}

/// Build the MEMORY CLEANUP MODE payload: a numbered, bounded list of the
/// candidate memories with the signals the model needs to judge reuse value.
fn build_cleanup_payload(persona_name: &str, candidates: &[&PersonaMemory]) -> String {
    let now = chrono::Utc::now();
    let mut s = String::from("MEMORY CLEANUP MODE\n\n");
    s.push_str(&format!(
        "Curate the stored memories for the persona \"{persona_name}\". Archive only \
         what will not help future runs (duplicates, one-off run results, obsolete \
         or too-vague notes). Keep durable preferences, stable facts, and lessons. \
         Emit one DIRECTOR_MEMORY_ARCHIVE line per memory to archive.\n\nMemories:\n",
    ));
    for m in candidates {
        let age_days = chrono::DateTime::parse_from_rfc3339(&m.created_at)
            .map(|d| (now - d.with_timezone(&chrono::Utc)).num_days())
            .unwrap_or(0);
        let snippet: String = m.content.chars().take(MEMORY_SNIPPET_CHARS).collect();
        let snippet = snippet.replace('\n', " ");
        s.push_str(&format!(
            "- id={} | importance={} | accessed={} | age={}d | [{}] {}: {}\n",
            m.id, m.importance, m.access_count, age_days, m.category, m.title, snippet,
        ));
    }
    s
}

/// Curate one persona's memories. Best-effort: the caller (the Director cycle)
/// logs and swallows errors so a cleanup failure never breaks the review.
pub async fn cleanup_persona_memories(
    state: &Arc<AppState>,
    app: tauri::AppHandle,
    persona_id: &str,
    dry_run: bool,
) -> Result<MemoryCleanupReport, AppError> {
    // ── Pass 1: deterministic dedup ──────────────────────────────────────
    let groups = memories::find_duplicate_groups(&state.db, persona_id)?;
    let mut dedup_ids: Vec<String> = Vec::new();
    for g in &groups {
        // group[0] is the keeper (highest importance, oldest) — archive the rest.
        for m in g.iter().skip(1) {
            dedup_ids.push(m.id.clone());
        }
    }
    let dedup_set: HashSet<String> = dedup_ids.iter().cloned().collect();

    // ── Pass 2: bounded LLM "won't-use" judgment ─────────────────────────
    let candidates = memories::get_archivable_candidates(&state.db, persona_id, CANDIDATE_LIMIT)?;
    let llm_input: Vec<&PersonaMemory> = candidates
        .iter()
        .filter(|m| !dedup_set.contains(&m.id))
        .collect();

    let mut llm_ids: Vec<String> = Vec::new();
    if !llm_input.is_empty() {
        let director_id = get_director_persona_id(&state.db)?;
        let persona_name = personas::get_by_id(&state.db, persona_id)
            .map(|p| p.name)
            .unwrap_or_else(|_| "this persona".to_string());
        let payload = build_cleanup_payload(&persona_name, &llm_input);

        match crate::commands::execution::executions::execute_persona_inner(
            state,
            app,
            director_id,
            /* trigger_id */ None,
            Some(payload),
            /* use_case_id */ None,
            /* continuation */ None,
            /* idempotency_key */ None,
            /* is_simulation */ false,
        )
        .await
        {
            Ok(spawned) => {
                if let Some(exec) = await_execution_terminal(&state.db, &spawned.id).await {
                    let output = exec.output_data.unwrap_or_default();
                    let valid: HashSet<String> =
                        llm_input.iter().map(|m| m.id.clone()).collect();
                    llm_ids = parse_memory_archives(&output, &valid);
                } else {
                    tracing::warn!(persona_id = %persona_id, "Director memory cleanup: run did not reach terminal state");
                }
            }
            Err(e) => {
                tracing::warn!(persona_id = %persona_id, error = %e, "Director memory cleanup: failed to spawn run");
            }
        }
    }

    // ── Apply (union, dedup) ─────────────────────────────────────────────
    let mut all_ids: Vec<String> = dedup_ids.clone();
    for id in &llm_ids {
        if !dedup_set.contains(id) {
            all_ids.push(id.clone());
        }
    }

    let archived_ids = if dry_run || all_ids.is_empty() {
        all_ids.clone()
    } else {
        memories::archive_by_ids(&state.db, &all_ids)?;
        all_ids.clone()
    };

    if !dry_run && !archived_ids.is_empty() {
        tracing::info!(
            persona_id = %persona_id,
            deduped = dedup_ids.len(),
            llm_archived = llm_ids.len(),
            "Director: archived memories"
        );
    }

    Ok(MemoryCleanupReport {
        scanned: candidates.len() as i64,
        deduped: dedup_ids.len() as i64,
        llm_archived: llm_ids.len() as i64,
        archived_ids,
        dry_run,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_archives_accepts_valid_ids_skips_unknown_and_malformed() {
        let valid: HashSet<String> = ["a", "b"].iter().map(|s| s.to_string()).collect();
        let output = "\
prose line\n\
DIRECTOR_MEMORY_ARCHIVE: {\"id\":\"a\",\"reason\":\"duplicate of b\"}\n\
DIRECTOR_MEMORY_ARCHIVE: {\"id\":\"zzz\",\"reason\":\"not offered\"}\n\
DIRECTOR_MEMORY_ARCHIVE: {malformed}\n\
DIRECTOR_MEMORY_ARCHIVE: {\"id\":\"b\",\"reason\":\"one-off price\"}\n\
DIRECTOR_MEMORY_ARCHIVE: {\"id\":\"a\",\"reason\":\"dup line\"}\n";
        let ids = parse_memory_archives(output, &valid);
        assert_eq!(ids, vec!["a".to_string(), "b".to_string()]); // unknown + malformed + repeat dropped
    }

    #[test]
    fn parse_archives_caps_at_max() {
        let valid: HashSet<String> = (0..100).map(|i| i.to_string()).collect();
        let mut output = String::new();
        for i in 0..100 {
            output.push_str(&format!("DIRECTOR_MEMORY_ARCHIVE: {{\"id\":\"{i}\"}}\n"));
        }
        let ids = parse_memory_archives(&output, &valid);
        assert_eq!(ids.len(), MAX_ARCHIVES_PER_RUN);
    }
}
