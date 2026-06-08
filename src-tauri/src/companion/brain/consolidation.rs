//! Manual on-demand consolidation. Reads recent episodes + existing
//! facts, asks Claude (in a *separate*, ephemeral CLI session — not
//! Athena's chat) to propose semantic-fact updates, and persists the
//! proposals as `companion_consolidation_item` rows for the user to
//! review one-by-one. Nothing lands automatically.
//!
//! Why a separate session: the chat session is a continuous narrative
//! Athena uses to talk to Michal. A consolidation pass returns a JSON
//! envelope, which would pollute that narrative if it ran in-band. The
//! ephemeral call uses the same Claude CLI binary but with no `--resume`
//! and a focused system prompt — it's a *different mode* of the same
//! brain.
//!
//! Scheduled/automatic consolidation is out of scope. The user is
//! always in the loop because consolidation is a high-stakes step: a
//! bad fact distillation can poison every future retrieval. We make
//! reviewing fast, not silent.

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;
use uuid::Uuid;

use crate::companion::brain::{episodic, semantic};
use crate::companion::session::{base_cli_invocation, DEFAULT_SESSION_ID};
use crate::db::UserDbPool;
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;

/// Episodes to feed into the consolidation prompt. More = better
/// recall, but the prompt grows quadratically with context. 80 is a
/// generous slice — about a week of normal use.
const EPISODE_WINDOW: u32 = 80;

/// Max wall-clock for a consolidation pass. Opus is slow; the prompt
/// is large; 5 minutes is plenty.
const CONSOLIDATION_TIMEOUT: Duration = Duration::from_secs(300);

/// Importance decay applied at the end of a consolidation pass to
/// facts that haven't been touched in `DECAY_THRESHOLD_DAYS`. Floor 1.
const DECAY_THRESHOLD_DAYS: i64 = 30;
const DECAY_DECREMENT: i32 = 1;

/// Hard cap on active facts per scope. Time-based decay alone doesn't
/// bound disk/vec0 size — facts that get touched periodically never
/// fall below importance 1 even if the brain has thousands of them. Above
/// this cap, lowest-value entries (importance ASC, last_seen_at ASC) are
/// demoted to importance=0 — mirroring the supersedes pattern. Markdown
/// stays as historical record, SQL row stays for the FK chain
/// (provenance), and retrieval naturally filters importance > 0.
///
/// Sized for ~50K-token corpora at ~100 tokens/fact (typed key + value +
/// frontmatter). Three scopes × 500 = 1500 facts ≈ 150KB markdown on disk
/// and a vec0 corpus that searches in <50ms.
const MAX_FACTS_PER_SCOPE: usize = 500;

/// Persisted summary of a consolidation run.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsolidationSummary {
    pub id: String,
    pub status: String,
    pub triggered_at: String,
    pub completed_at: Option<String>,
    pub episodes_count: i32,
    pub items_total: i32,
    pub items_pending: i32,
    pub items_applied: i32,
    pub items_rejected: i32,
    pub summary: Option<String>,
    pub error_text: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsolidationItem {
    pub id: String,
    pub consolidation_id: String,
    pub kind: String,
    pub scope: String,
    pub fact_key: String,
    pub proposed_value: String,
    pub sources: Vec<String>,
    pub importance: i32,
    pub confidence: f32,
    pub supersedes_id: Option<String>,
    pub rationale: Option<String>,
    pub status: String,
    pub fact_id: Option<String>,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProposalEnvelope {
    #[serde(default)]
    summary: Option<String>,
    proposals: Vec<RawProposal>,
}

#[derive(Debug, Deserialize)]
struct RawProposal {
    /// "add" | "update" | "contradict"
    kind: String,
    scope: String,
    key: String,
    value: String,
    sources: Vec<String>,
    #[serde(default = "default_importance")]
    importance: i32,
    #[serde(default = "default_confidence")]
    confidence: f32,
    #[serde(default)]
    supersedes_id: Option<String>,
    #[serde(default)]
    rationale: Option<String>,
}

fn default_importance() -> i32 {
    3
}
fn default_confidence() -> f32 {
    0.7
}

/// Run a consolidation pass end-to-end. Creates the
/// `companion_consolidation` row in `running`, calls the CLI, parses
/// the JSON envelope, persists each proposal as an item row, and
/// finishes by setting the run to `review` (or `failed`). The user
/// then walks the items in the review UI.
///
/// `instructions` is optional natural-language steering (≤4096 chars)
/// folded into the prompt as an "Additional guidance from operator"
/// block. Mirrors the concept of Anthropic Managed Agents' dream
/// `instructions` field, applied to personas's existing curation
/// pipeline. Validation happens at the IPC boundary, not here.
pub async fn run_consolidation(
    pool: &UserDbPool,
    instructions: Option<&str>,
) -> Result<String, AppError> {
    let id = format!("cons_{}", short_uuid());
    let now = Utc::now().to_rfc3339();

    // Insert the run row in `running` so the UI can show progress
    // immediately. We update to `review` when the JSON envelope lands.
    {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO companion_consolidation (id, triggered_at, status)
             VALUES (?1, ?2, 'running')",
            params![id, now],
        )?;
    }

    // Build the prompt: existing facts (so Claude can recommend
    // supersedes / contradiction) + recent episodes (the source
    // material). We hand-build the prompt rather than reusing
    // `prompt::build_system_prompt` because consolidation needs a
    // *different mindset* — analytical, not conversational.
    let episodes = episodic::list_recent(pool, DEFAULT_SESSION_ID, EPISODE_WINDOW)?;
    let episodes_count = episodes.len() as i32;
    let existing_facts = semantic::list_facts(pool, None, false, 200)?;

    // Persist the count so the UI badge can show "reviewed N episodes"
    // even before the LLM call returns.
    {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE companion_consolidation SET episodes_count = ?1 WHERE id = ?2",
            params![episodes_count, id],
        )?;
    }

    let prompt = build_consolidation_prompt(&episodes, &existing_facts, instructions);

    let envelope_result = call_claude_oneshot(&prompt).await;

    let envelope = match envelope_result {
        Ok(e) => e,
        Err(err) => {
            mark_failed(pool, &id, &err.to_string())?;
            return Err(err);
        }
    };

    // Parse and persist proposals.
    let mut items_total = 0;
    {
        let conn = pool.get()?;
        let tx = conn.unchecked_transaction()?;
        for raw in &envelope.proposals {
            if !is_valid_kind(&raw.kind) {
                tracing::warn!(kind = %raw.kind, "skipping consolidation proposal: invalid kind");
                continue;
            }
            if !is_valid_scope(&raw.scope) {
                tracing::warn!(scope = %raw.scope, "skipping consolidation proposal: invalid scope");
                continue;
            }
            if raw.sources.is_empty() {
                tracing::warn!(key = %raw.key, "skipping consolidation proposal: empty sources");
                continue;
            }
            if raw.value.trim().is_empty() {
                continue;
            }
            let item_id = format!("citem_{}", short_uuid());
            let sources_json =
                serde_json::to_string(&raw.sources).unwrap_or_else(|_| "[]".to_string());
            tx.execute(
                "INSERT INTO companion_consolidation_item
                 (id, consolidation_id, kind, scope, fact_key, proposed_value, sources_json,
                  importance, confidence, supersedes_id, rationale, status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'pending')",
                params![
                    item_id,
                    id,
                    raw.kind,
                    raw.scope,
                    raw.key,
                    raw.value,
                    sources_json,
                    raw.importance.clamp(1, 5),
                    raw.confidence.clamp(0.0, 1.0),
                    raw.supersedes_id,
                    raw.rationale,
                ],
            )?;
            items_total += 1;
        }
        let summary_text = envelope.summary.clone();
        let now2 = Utc::now().to_rfc3339();
        tx.execute(
            "UPDATE companion_consolidation
             SET status = 'review', completed_at = ?1, summary = ?2
             WHERE id = ?3",
            params![now2, summary_text, id],
        )?;
        tx.commit()?;
    }

    tracing::info!(consolidation_id = %id, items = items_total, "consolidation pass completed");

    Ok(id)
}

/// Apply a single pending consolidation item — writes the underlying
/// fact and marks the item `applied`. `edits` (optional) lets the user
/// tweak the proposal in the review UI before it lands.
#[derive(Debug, Default)]
pub struct ItemEdits {
    pub value: Option<String>,
    pub key: Option<String>,
    pub scope: Option<String>,
    pub importance: Option<i32>,
    pub confidence: Option<f32>,
}

#[cfg(feature = "ml")]
pub async fn apply_item(
    pool: &UserDbPool,
    embedder: Option<&Arc<EmbeddingManager>>,
    item_id: &str,
    edits: &ItemEdits,
) -> Result<String, AppError> {
    let item = load_item(pool, item_id)?;
    if item.status != "pending" {
        return Err(AppError::Internal(format!(
            "consolidation item `{item_id}` is `{}`, not pending",
            item.status
        )));
    }
    let scope_str = edits.scope.as_deref().unwrap_or(&item.scope);
    let scope = semantic::FactScope::parse(scope_str)?;
    let key = edits.key.as_deref().unwrap_or(&item.fact_key);
    let value = edits.value.as_deref().unwrap_or(&item.proposed_value);
    let importance = edits.importance.unwrap_or(item.importance);
    let confidence = edits.confidence.unwrap_or(item.confidence);
    let supersedes = item.supersedes_id.as_deref();

    let input = semantic::FactInput {
        scope,
        key,
        value,
        sources: &item.sources,
        importance,
        confidence,
        supersedes_id: supersedes,
        contradicts_id: None,
    };

    let fact_id = match embedder {
        Some(emb) => {
            // Fuzzy dedup: if Athena's proposal closely matches an existing
            // fact in the same scope, fold the new evidence into the
            // existing entry instead of writing a redundant row. Skip when
            // the user marked this as supersedes — that's a deliberate
            // replacement, not a duplicate. Best-effort: any failure in the
            // dedup pipeline (embedder, vec0, SQL) falls through to a normal
            // write so the consolidation pass never breaks because of a
            // dedup failure.
            let folded_into: Option<String> = if supersedes.is_none() {
                match semantic::find_near_duplicate(pool, emb, scope, value).await {
                    Ok(Some(existing)) => {
                        if let Err(e) = semantic::reinforce_fact(pool, &existing, &item.sources) {
                            tracing::warn!(
                                error = %e,
                                "consolidation: reinforce_fact failed; falling through to normal write"
                            );
                            None
                        } else {
                            tracing::info!(
                                item_id = %item_id,
                                existing_fact_id = %existing,
                                "consolidation: folded near-duplicate into existing fact"
                            );
                            Some(existing)
                        }
                    }
                    Ok(None) => None,
                    Err(e) => {
                        tracing::warn!(
                            error = %e,
                            "consolidation: fuzzy dedup check failed; falling through"
                        );
                        None
                    }
                }
            } else {
                None
            };
            match folded_into {
                Some(id) => id,
                None => semantic::write_fact_and_embed(pool, emb, &input).await?,
            }
        }
        None => semantic::write_fact(pool, &input)?,
    };

    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE companion_consolidation_item
         SET status = 'applied', resolved_at = ?1, fact_id = ?2
         WHERE id = ?3",
        params![now, fact_id, item_id],
    )?;
    Ok(fact_id)
}

#[cfg(not(feature = "ml"))]
pub async fn apply_item(
    pool: &UserDbPool,
    item_id: &str,
    edits: &ItemEdits,
) -> Result<String, AppError> {
    let item = load_item(pool, item_id)?;
    if item.status != "pending" {
        return Err(AppError::Internal(format!(
            "consolidation item `{item_id}` is `{}`, not pending",
            item.status
        )));
    }
    let scope_str = edits.scope.as_deref().unwrap_or(&item.scope);
    let scope = semantic::FactScope::parse(scope_str)?;
    let key = edits.key.as_deref().unwrap_or(&item.fact_key);
    let value = edits.value.as_deref().unwrap_or(&item.proposed_value);
    let importance = edits.importance.unwrap_or(item.importance);
    let confidence = edits.confidence.unwrap_or(item.confidence);
    let supersedes = item.supersedes_id.as_deref();

    let input = semantic::FactInput {
        scope,
        key,
        value,
        sources: &item.sources,
        importance,
        confidence,
        supersedes_id: supersedes,
        contradicts_id: None,
    };

    let fact_id = semantic::write_fact(pool, &input)?;
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE companion_consolidation_item
         SET status = 'applied', resolved_at = ?1, fact_id = ?2
         WHERE id = ?3",
        params![now, fact_id, item_id],
    )?;
    Ok(fact_id)
}

/// Mark an item rejected — no fact is written. Status persists so the
/// summary view can show "reviewed: 12 applied, 3 rejected".
pub fn reject_item(pool: &UserDbPool, item_id: &str) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let updated = conn.execute(
        "UPDATE companion_consolidation_item
         SET status = 'rejected', resolved_at = ?1
         WHERE id = ?2 AND status = 'pending'",
        params![now, item_id],
    )?;
    if updated == 0 {
        return Err(AppError::Internal(format!(
            "consolidation item `{item_id}` not found or already resolved"
        )));
    }
    Ok(())
}

/// Discard a whole consolidation run: reject every still-pending item
/// and mark the run as `discarded`. Mirrors Anthropic Managed Agents'
/// "discard the dream output store" gesture at batch granularity —
/// per-item review via `apply_item`/`reject_item` already exists; this
/// is the batch-level version for users who decide the entire pass
/// isn't worth walking item-by-item.
///
/// Already-applied items are left alone (their facts are live in the
/// brain). Already-rejected items stay rejected. Returns the number of
/// previously-pending items now rejected.
///
/// Idempotent — re-discarding a run with no pending items returns 0
/// and leaves the status at `discarded`.
pub fn discard_run(pool: &UserDbPool, run_id: &str) -> Result<i64, AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let tx = conn.unchecked_transaction()?;

    let run_exists: i64 = tx.query_row(
        "SELECT COUNT(*) FROM companion_consolidation WHERE id = ?1",
        params![run_id],
        |r| r.get(0),
    )?;
    if run_exists == 0 {
        return Err(AppError::Internal(format!(
            "consolidation run `{run_id}` not found"
        )));
    }

    let rejected = tx.execute(
        "UPDATE companion_consolidation_item
         SET status = 'rejected', resolved_at = ?1
         WHERE consolidation_id = ?2 AND status = 'pending'",
        params![now, run_id],
    )? as i64;

    tx.execute(
        "UPDATE companion_consolidation
         SET status = 'discarded'
         WHERE id = ?1",
        params![run_id],
    )?;

    tx.commit()?;
    tracing::info!(run_id = %run_id, rejected, "consolidation run discarded");
    Ok(rejected)
}

/// After a user-driven consolidation lands, decay importance for facts
/// that haven't been recalled in a while. Floor of 1 — we never delete
/// via decay, only reduce salience. Returns the number of facts touched.
pub fn decay_unused_facts(pool: &UserDbPool) -> Result<i64, AppError> {
    let now = Utc::now().to_rfc3339();
    let cutoff = (Utc::now() - chrono::Duration::days(DECAY_THRESHOLD_DAYS)).to_rfc3339();
    let conn = pool.get()?;
    let updated = conn.execute(
        "UPDATE companion_node
         SET importance = MAX(1, importance - ?1), updated_at = ?2
         WHERE id IN (
             SELECT n.id FROM companion_node n
             JOIN companion_fact f ON f.id = n.id
             WHERE n.kind = 'fact'
               AND n.importance > 1
               AND f.last_seen_at < ?3
         )",
        params![DECAY_DECREMENT, now, cutoff],
    )?;
    // Mark them as decayed so the next pass doesn't double-decay
    // (we'd need to reinforce by recall to restart the clock).
    if updated > 0 {
        conn.execute(
            "UPDATE companion_fact
             SET last_decayed_at = ?1
             WHERE id IN (
                 SELECT id FROM companion_node WHERE kind = 'fact' AND updated_at = ?1
             )",
            params![now],
        )?;
    }
    Ok(updated as i64)
}

/// Demote facts above the per-scope cap (importance → 0). Lowest-value
/// first: order by importance ASC, then last_seen_at ASC. Markdown and
/// SQL rows stay; only retrieval-eligibility flips. Idempotent — re-running
/// when the brain is under-cap is a no-op. Returns the number of facts
/// demoted. The pair `decay_unused_facts` + `prune_low_value_facts` is
/// the lifecycle pass: time-decay first, size-cap second.
pub fn prune_low_value_facts(pool: &UserDbPool) -> Result<i64, AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let mut total_demoted = 0i64;

    for scope in ["user", "project", "world"] {
        let active_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM companion_fact f
             JOIN companion_node n ON n.id = f.id
             WHERE n.kind = 'fact' AND n.importance > 0 AND f.scope = ?1",
            params![scope],
            |r| r.get(0),
        )?;
        let cap = MAX_FACTS_PER_SCOPE as i64;
        if active_count <= cap {
            continue;
        }
        let to_demote = active_count - cap;
        let updated = conn.execute(
            "UPDATE companion_node
             SET importance = 0, updated_at = ?1
             WHERE id IN (
                 SELECT n.id FROM companion_node n
                 JOIN companion_fact f ON f.id = n.id
                 WHERE n.kind = 'fact' AND n.importance > 0 AND f.scope = ?2
                 ORDER BY n.importance ASC, f.last_seen_at ASC
                 LIMIT ?3
             )",
            params![now, scope, to_demote],
        )?;
        total_demoted += updated as i64;
    }

    if total_demoted > 0 {
        tracing::info!(
            demoted = total_demoted,
            "companion: pruned low-value facts above scope cap"
        );
    }
    Ok(total_demoted)
}

pub fn list_runs(pool: &UserDbPool, limit: u32) -> Result<Vec<ConsolidationSummary>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, status, triggered_at, completed_at, episodes_count, summary, error_text
         FROM companion_consolidation
         ORDER BY triggered_at DESC
         LIMIT ?1",
    )?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(ConsolidationSummary {
                id: row.get(0)?,
                status: row.get(1)?,
                triggered_at: row.get(2)?,
                completed_at: row.get::<_, Option<String>>(3)?,
                episodes_count: row.get(4)?,
                items_total: 0,
                items_pending: 0,
                items_applied: 0,
                items_rejected: 0,
                summary: row.get::<_, Option<String>>(5)?,
                error_text: row.get::<_, Option<String>>(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    // Hydrate counts with a second query (one per run; the table is small).
    let mut out = Vec::with_capacity(rows.len());
    for mut r in rows {
        let counts: (i32, i32, i32, i32) = conn
            .query_row(
                "SELECT
                    COUNT(*),
                    SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END)
                 FROM companion_consolidation_item
                 WHERE consolidation_id = ?1",
                params![r.id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get::<_, Option<i32>>(1)?.unwrap_or(0),
                        row.get::<_, Option<i32>>(2)?.unwrap_or(0),
                        row.get::<_, Option<i32>>(3)?.unwrap_or(0),
                    ))
                },
            )
            .unwrap_or((0, 0, 0, 0));
        r.items_total = counts.0;
        r.items_pending = counts.1;
        r.items_applied = counts.2;
        r.items_rejected = counts.3;
        out.push(r);
    }
    Ok(out)
}

pub fn list_items(
    pool: &UserDbPool,
    consolidation_id: &str,
) -> Result<Vec<ConsolidationItem>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, consolidation_id, kind, scope, fact_key, proposed_value, sources_json,
                importance, confidence, supersedes_id, rationale, status, fact_id,
                created_at, resolved_at
         FROM companion_consolidation_item
         WHERE consolidation_id = ?1
         ORDER BY
            CASE status WHEN 'pending' THEN 0 WHEN 'applied' THEN 1 ELSE 2 END,
            created_at",
    )?;
    let rows = stmt
        .query_map(params![consolidation_id], |row| {
            let sources_json: String = row.get(6)?;
            let sources: Vec<String> = serde_json::from_str(&sources_json).unwrap_or_default();
            Ok(ConsolidationItem {
                id: row.get(0)?,
                consolidation_id: row.get(1)?,
                kind: row.get(2)?,
                scope: row.get(3)?,
                fact_key: row.get(4)?,
                proposed_value: row.get(5)?,
                sources,
                importance: row.get(7)?,
                confidence: row.get(8)?,
                supersedes_id: row.get(9)?,
                rationale: row.get(10)?,
                status: row.get(11)?,
                fact_id: row.get(12)?,
                created_at: row.get(13)?,
                resolved_at: row.get(14)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

// ── helpers ─────────────────────────────────────────────────────────────

fn load_item(pool: &UserDbPool, item_id: &str) -> Result<ConsolidationItem, AppError> {
    let conn = pool.get()?;
    let row: Option<ConsolidationItem> = conn
        .query_row(
            "SELECT id, consolidation_id, kind, scope, fact_key, proposed_value, sources_json,
                    importance, confidence, supersedes_id, rationale, status, fact_id,
                    created_at, resolved_at
             FROM companion_consolidation_item
             WHERE id = ?1",
            params![item_id],
            |row| {
                let sources_json: String = row.get(6)?;
                let sources: Vec<String> = serde_json::from_str(&sources_json).unwrap_or_default();
                Ok(ConsolidationItem {
                    id: row.get(0)?,
                    consolidation_id: row.get(1)?,
                    kind: row.get(2)?,
                    scope: row.get(3)?,
                    fact_key: row.get(4)?,
                    proposed_value: row.get(5)?,
                    sources,
                    importance: row.get(7)?,
                    confidence: row.get(8)?,
                    supersedes_id: row.get(9)?,
                    rationale: row.get(10)?,
                    status: row.get(11)?,
                    fact_id: row.get(12)?,
                    created_at: row.get(13)?,
                    resolved_at: row.get(14)?,
                })
            },
        )
        .optional()?;
    row.ok_or_else(|| AppError::Internal(format!("consolidation item `{item_id}` not found")))
}

fn mark_failed(pool: &UserDbPool, id: &str, err: &str) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE companion_consolidation
         SET status = 'failed', completed_at = ?1, error_text = ?2
         WHERE id = ?3",
        params![now, err, id],
    )?;
    Ok(())
}

fn is_valid_kind(s: &str) -> bool {
    matches!(s, "add" | "update" | "contradict")
}

fn is_valid_scope(s: &str) -> bool {
    matches!(s, "user" | "project" | "world")
}

fn build_consolidation_prompt(
    episodes: &[episodic::Episode],
    facts: &[semantic::Fact],
    instructions: Option<&str>,
) -> String {
    let mut p = String::new();
    p.push_str(
        "You are running a memory consolidation pass for Athena, a long-term \
         conversational companion. Your job is to read the recent conversation \
         and propose updates to her semantic memory — distilled facts about the \
         user, his projects, and the world.\n\n",
    );
    p.push_str(
        "RULES — non-negotiable:\n\
        1. Every proposal must cite at least one source episode_id from the \
           list below. If you can't cite, you can't propose.\n\
        2. Don't restate facts that already exist verbatim. Only propose `add` \
           when there's something new.\n\
        3. When the user's view of something has clearly changed, propose \
           `update` with `supersedes_id` set to the old fact's id. Don't \
           silently overwrite.\n\
        4. When two existing facts now appear contradictory in light of new \
           context, propose `contradict` and explain in `rationale` which \
           direction the resolution probably goes.\n\
        5. Do NOT include conversational ephemera as facts. \"User asked X \
           today\" is an episode, not a fact. Facts are durable: preferences, \
           project state, relationships, constraints.\n\
        6. Importance scale: 5 = core identity (his primary work, etc.); \
           3 = typical preference; 1 = incidental detail. Be honest.\n\
        7. Confidence scale: 0.9+ for direct claims, 0.6-0.8 for inferred \
           patterns, below 0.5 don't propose at all (too speculative).\n\n",
    );
    p.push_str(
        "OUTPUT FORMAT — return ONLY valid JSON, nothing else, no prose, \
         no fencing. Schema:\n\n",
    );
    p.push_str(
        "{\n\
          \"summary\": \"<one short sentence summarizing the pass>\",\n\
          \"proposals\": [\n\
            {\n\
              \"kind\": \"add\" | \"update\" | \"contradict\",\n\
              \"scope\": \"user\" | \"project\" | \"world\",\n\
              \"key\": \"short_slug\",\n\
              \"value\": \"<one paragraph fact>\",\n\
              \"sources\": [\"ep_<id>\", \"ep_<id>\"],\n\
              \"importance\": 1-5,\n\
              \"confidence\": 0.0-1.0,\n\
              \"supersedes_id\": \"fact_<id>\" | null,\n\
              \"rationale\": \"<why this proposal makes sense>\"\n\
            }\n\
          ]\n\
        }\n\n",
    );

    p.push_str("# Existing facts (do not duplicate):\n\n");
    if facts.is_empty() {
        p.push_str("(none yet — empty memory)\n\n");
    } else {
        for f in facts {
            p.push_str(&format!(
                "- `{id}` [{scope}/{key}, imp {imp}, conf {conf:.2}] {value}\n",
                id = f.id,
                scope = f.scope,
                key = f.key,
                imp = f.importance,
                conf = f.confidence,
                value = f
                    .value
                    .replace('\n', " ")
                    .chars()
                    .take(280)
                    .collect::<String>(),
            ));
        }
        p.push('\n');
    }

    p.push_str("# Recent conversation episodes (oldest first):\n\n");
    if episodes.is_empty() {
        p.push_str("(no episodes — nothing to consolidate)\n");
    } else {
        for ep in episodes {
            p.push_str(&format!(
                "## {role} — `{id}` — {created}\n\n{content}\n\n",
                role = ep.role,
                id = ep.id,
                created = ep.created_at,
                content = ep.content.trim(),
            ));
        }
    }

    if let Some(extra) = instructions.map(str::trim).filter(|s| !s.is_empty()) {
        p.push_str("\n# Additional guidance from operator\n\n");
        p.push_str(extra);
        p.push('\n');
    }

    p.push_str(
        "\n# Now: emit ONLY the JSON envelope above. \
         Empty proposals array is valid (means: nothing to consolidate). \
         No prose, no markdown, no code fences. Start with `{` and end with `}`.\n",
    );
    p
}

/// Spawn a one-shot Claude CLI call, pipe `prompt` as stdin, collect
/// stdout, parse the JSON envelope. No `--resume`, no system-prompt
/// file (we put everything in the user prompt for total control), no
/// stream events to the UI — this is a backend computation.
async fn call_claude_oneshot(prompt: &str) -> Result<ProposalEnvelope, AppError> {
    let cwd = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
    let (cmd_program, mut argv) = base_cli_invocation();
    argv.extend([
        "-p".into(),
        "-".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--dangerously-skip-permissions".into(),
        "--exclude-dynamic-system-prompt-sections".into(),
        "--model".into(),
        "claude-opus-4-8".into(),
    ]);

    let mut cmd = Command::new(&cmd_program);
    cmd.args(&argv)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1");
    // No console window on Windows (desktop-heap / 0xC0000142 guard).
    crate::companion::session::apply_no_console_window(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Internal(format!("spawn claude (consolidation): {e}")))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| AppError::Internal(format!("write stdin: {e}")))?;
        drop(stdin);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("claude stdout missing".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Internal("claude stderr missing".into()))?;

    let stderr_buf = Arc::new(tokio::sync::Mutex::new(String::new()));
    let stderr_handle = {
        let buf = stderr_buf.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut g = buf.lock().await;
                if !g.is_empty() {
                    g.push('\n');
                }
                g.push_str(&line);
            }
        })
    };

    // Reuse the streaming JSON parser to extract assistant text deltas.
    let mut assistant_text = String::new();
    let mut reader = BufReader::new(stdout).lines();

    let collect = async {
        while let Some(line) = reader
            .next_line()
            .await
            .map_err(|e| AppError::Internal(format!("read stdout: {e}")))?
        {
            if let Some(delta) = extract_assistant_text(&line) {
                assistant_text.push_str(&delta);
            }
        }
        Ok::<(), AppError>(())
    };

    timeout(CONSOLIDATION_TIMEOUT, collect)
        .await
        .map_err(|_| {
            AppError::Internal(format!(
                "consolidation timed out after {:?}",
                CONSOLIDATION_TIMEOUT
            ))
        })??;

    let _ = stderr_handle.await;
    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Internal(format!("await claude: {e}")))?;
    if !status.success() {
        let err = stderr_buf.lock().await.clone();
        return Err(AppError::Internal(format!(
            "claude consolidation exited {}: {}",
            status.code().map(|c| c.to_string()).unwrap_or("?".into()),
            err
        )));
    }

    parse_envelope(&assistant_text)
}

/// Strip stream-json wrapping and pull text deltas. Matches the
/// extractor on the frontend (extractAssistantText in CompanionPanel).
fn extract_assistant_text(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let blocks = v.get("message")?.get("content")?.as_array()?;
    let mut out = String::new();
    for b in blocks {
        if b.get("type").and_then(|x| x.as_str()) == Some("text") {
            if let Some(t) = b.get("text").and_then(|x| x.as_str()) {
                out.push_str(t);
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Parse the assembled assistant text. Tolerant of code-fenced replies
/// (Claude sometimes wraps despite explicit instructions) and trailing
/// commentary — find the first `{` and the matching last `}`.
fn parse_envelope(text: &str) -> Result<ProposalEnvelope, AppError> {
    let trimmed = text.trim();
    let raw = if let Some(stripped) = strip_code_fence(trimmed) {
        stripped
    } else {
        trimmed
    };
    // Find the first '{' and last '}' to be tolerant of preface/suffix.
    let start = raw.find('{').ok_or_else(|| {
        AppError::Internal(format!(
            "consolidation reply missing JSON object; got: {}",
            preview(raw, 200)
        ))
    })?;
    let end = raw.rfind('}').ok_or_else(|| {
        AppError::Internal(format!(
            "consolidation reply missing closing `}}`; got: {}",
            preview(raw, 200)
        ))
    })?;
    if end <= start {
        return Err(AppError::Internal(format!(
            "consolidation reply has no valid JSON span; got: {}",
            preview(raw, 200)
        )));
    }
    let json = &raw[start..=end];
    serde_json::from_str(json).map_err(|e| {
        AppError::Internal(format!(
            "consolidation reply not valid JSON: {e}; got: {}",
            preview(json, 400)
        ))
    })
}

fn strip_code_fence(s: &str) -> Option<&str> {
    let mut s = s;
    if let Some(rest) = s.strip_prefix("```json") {
        s = rest;
    } else if let Some(rest) = s.strip_prefix("```") {
        s = rest;
    } else {
        return None;
    }
    let s = s.trim_start_matches('\n');
    if let Some(end) = s.rfind("```") {
        Some(s[..end].trim())
    } else {
        Some(s.trim())
    }
}

fn preview(s: &str, n: usize) -> String {
    if s.len() <= n {
        s.to_string()
    } else {
        let mut end = n;
        while !s.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        format!("{}…", &s[..end])
    }
}

fn short_uuid() -> String {
    Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(10)
        .collect()
}
