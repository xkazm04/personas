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

use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::companion::brain::oneshot::{self, call_claude_text, extract_json_span, preview};
use crate::companion::brain::util;
use crate::companion::brain::{episodic, semantic};
use crate::companion::session::DEFAULT_SESSION_ID;
use crate::db::UserDbPool;
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;
#[cfg(feature = "ml")]
use std::sync::Arc;

/// Episodes to feed into the consolidation prompt. More = better
/// recall, but the prompt grows quadratically with context. 80 is a
/// generous slice — about a week of normal use.
const EPISODE_WINDOW: u32 = 80;

/// Max wall-clock for a consolidation pass. Opus is slow; the prompt
/// is large; 5 minutes is plenty.
const CONSOLIDATION_TIMEOUT: Duration = Duration::from_secs(300);

/// Importance decay applied at the end of a consolidation pass to
/// facts that haven't been touched in `DECAY_THRESHOLD_DAYS`. Floor 1 —
/// decay lowers salience and never crosses the retrieval gate on its own.
/// Aging out is the separate, slower step below.
const DECAY_THRESHOLD_DAYS: i64 = 30;
const DECAY_DECREMENT: i32 = 1;

/// How long a fact must sit unrecalled before it stops being retrievable.
///
/// Decay alone could never reach this: it floors at 1 and the recall gate is
/// `importance > 0` (`keyword.rs`), so before 2026-09-03 **no fact could ever
/// age out of Athena's memory**, and the size cap was the only thing that
/// could demote one — a cap of 500 per scope against a real corpus of 113.
/// The README said forgetting happened. Nothing did.
///
/// Measured on the operator's own brain, 2026-09-03: 113 facts, 97 of them
/// retrievable, and the entire tail older than 90 days is six `fleet_*_14d`
/// rows — statistics about a fortnight that ended in May, still eligible to be
/// recited as current. That is the shape of the harm, and it is why the
/// horizon is a season rather than a year: a fact nothing has recalled in
/// three months is either wrong or was never load-bearing.
///
/// Aging out is a **demotion to importance 0 through the same statement a
/// supersede uses** (`semantic::demote_superseded`) — never a delete. The
/// markdown stays on disk, the row stays for the provenance chain, the
/// tombstone machinery is untouched, and a fact that becomes relevant again
/// can be rewritten. User-initiated forgetting (Memory Engine v2 tombstones)
/// is a different mechanism entirely and is not involved here.
const AGE_OUT_DAYS: i64 = 90;

/// The same horizon for `user`-scope facts, deliberately four times longer.
///
/// `last_seen_at` is bumped by *recall*, so it measures how often a fact is
/// retrieved — not how true it is. That is a fair proxy for a project fact
/// (a stale build statistic stops matching queries because the work moved on)
/// and a bad one for a user fact: "prefers readable ids", "does not want code
/// review as the primary lens" are the things that make Athena his rather
/// than generic, and they are load-bearing on turns where no query happens to
/// pull them. Forgetting one costs far more than carrying it, and the corpus
/// is 12 rows — there is no budget argument on the other side. A year is long
/// enough that anything aging out under this rule genuinely is not in use.
const AGE_OUT_DAYS_USER: i64 = 365;

/// The `companion_night_event.kind` a completed lifecycle sweep records.
///
/// The sweep needed somewhere durable to say what it did, and the two obvious
/// tables both refuse it for good reasons: `companion_cycle` is read by
/// `sleep_cycle::admission` through `cycle_report::last_completed`, so a sweep
/// row marked `completed` would suppress the next real sleep cycle; and
/// `companion_consolidation` is the LLM proposal-pass ledger the Brain viewer
/// lists, where a sweep would read as a consolidation that never ran.
/// `companion_night_event` is the tree's one append-only, kind-discriminated,
/// free-payload ledger of autonomous acts, and a row with `plan_id = NULL` is
/// invisible to `night_shift::events_for_plan` — the only reader — so the
/// morning report cannot pick it up. Its *name* is now narrower than its role;
/// widening that is a Director call, because it lives in `src-tauri/db`.
pub const EVENT_MEMORY_LIFECYCLE_SWEEP: &str = "memory_lifecycle_sweep";

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
    // Conversation only. Fleet correlator rows were 57% of episodic memory,
    // so the previous read handed Claude a window that was mostly machine
    // chatter — which is how the brain ended up holding 30 "facts" that are
    // 70-day-old fleet statistics. Facts should be distilled from the
    // conversation; fleet state is already live in the observability digest.
    let episodes = episodic::list_recent_conversation(pool, DEFAULT_SESSION_ID, EPISODE_WINDOW)?;
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

    let envelope_result = call_claude_oneshot(pool, &prompt).await;

    let envelope = match envelope_result {
        Ok(e) => e,
        Err(err) => {
            mark_failed(pool, &id, &err.to_string())?;
            return Err(err);
        }
    };

    // Parse and persist proposals.
    let persisted = {
        let conn = pool.get()?;
        let tx = conn.unchecked_transaction()?;
        let persisted = persist_proposals(&tx, &id, &envelope.proposals)?;
        let summary_text = envelope.summary.clone();
        let now2 = Utc::now().to_rfc3339();
        tx.execute(
            "UPDATE companion_consolidation
             SET status = 'review', completed_at = ?1, summary = ?2
             WHERE id = ?3",
            params![now2, summary_text, id],
        )?;
        tx.commit()?;
        persisted
    };

    tracing::info!(
        consolidation_id = %id,
        items = persisted.inserted,
        skipped_rejected = persisted.skipped_rejected,
        "consolidation pass completed"
    );

    Ok(id)
}

/// What one persist pass did: how many proposals became `pending` items,
/// and how many were dropped because the operator had already rejected
/// that exact proposal.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Persisted {
    pub inserted: usize,
    pub skipped_rejected: usize,
}

/// Persist the model's proposals as `pending` review items.
///
/// **A proposal the operator already rejected is not asked again.** Before
/// this check the pass had no memory of its own verdicts: `reject_item`
/// only flipped a status, and the next pass - reading the same episodes
/// under the same prompt - re-derived the same fact and put it back in the
/// inbox, so a rejection lasted exactly one pass. The check is keyed on
/// `(scope, fact_key, proposed_value)`: the VALUE is part of the identity on
/// purpose. Rejecting "home_city = Brno" must not become "never propose
/// home_city again" - a different value for the same key is a new question,
/// and asking it once more costs one click, whereas silently dropping it
/// costs a true fact.
///
/// Split out of `run_consolidation` so the rule is testable without an LLM
/// call. Nothing here is validated beyond what the loop always checked; the
/// review UI still decides what lands.
fn persist_proposals(
    tx: &rusqlite::Transaction<'_>,
    consolidation_id: &str,
    proposals: &[RawProposal],
) -> Result<Persisted, AppError> {
    let mut out = Persisted::default();
    for raw in proposals {
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
        let rejected_before: bool = tx.query_row(
            "SELECT EXISTS(
                 SELECT 1 FROM companion_consolidation_item
                  WHERE status = 'rejected'
                    AND scope = ?1 AND fact_key = ?2 AND proposed_value = ?3)",
            params![raw.scope, raw.key, raw.value],
            |r| r.get(0),
        )?;
        if rejected_before {
            tracing::info!(
                key = %raw.key,
                scope = %raw.scope,
                "skipping consolidation proposal: the operator rejected this exact proposal before"
            );
            out.skipped_rejected += 1;
            continue;
        }
        let item_id = format!("citem_{}", short_uuid());
        let sources_json = serde_json::to_string(&raw.sources).unwrap_or_else(|_| "[]".to_string());
        tx.execute(
            "INSERT INTO companion_consolidation_item
             (id, consolidation_id, kind, scope, fact_key, proposed_value, sources_json,
              importance, confidence, supersedes_id, rationale, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'pending')",
            params![
                item_id,
                consolidation_id,
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
        out.inserted += 1;
    }
    Ok(out)
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

/// The model's `supersedes_id` is untrusted input — validate it refers to a
/// live fact (`kind='fact'`, `importance>0`) in the same scope before
/// letting `apply_item` demote anything. Without this, a hallucinated or
/// unrelated id would silently zero out an arbitrary fact's importance,
/// defeating the human-review step `apply_item` is meant to gate.
fn validate_supersedes(
    pool: &UserDbPool,
    item_id: &str,
    prior_id: &str,
    scope_str: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let prior_scope: Option<String> = conn
        .query_row(
            "SELECT f.scope FROM companion_fact f
             JOIN companion_node n ON n.id = f.id
             WHERE f.id = ?1 AND n.kind = 'fact' AND n.importance > 0",
            params![prior_id],
            |r| r.get(0),
        )
        .optional()?;
    match prior_scope {
        Some(s) if s == scope_str => Ok(()),
        Some(_) => Err(AppError::Validation(format!(
            "consolidation item `{item_id}`: supersedes_id `{prior_id}` is in a different scope"
        ))),
        None => Err(AppError::Validation(format!(
            "consolidation item `{item_id}`: supersedes_id `{prior_id}` does not refer to a live fact"
        ))),
    }
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
    if let Some(prior_id) = supersedes {
        validate_supersedes(pool, item_id, prior_id, scope_str)?;
    }

    let input = semantic::FactInput {
        scope,
        key,
        value,
        sources: &item.sources,
        importance,
        confidence,
        supersedes_id: supersedes,
        contradicts_id: None,
        expires_at: None,
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
    if let Some(prior_id) = supersedes {
        validate_supersedes(pool, item_id, prior_id, scope_str)?;
    }

    let input = semantic::FactInput {
        scope,
        key,
        value,
        sources: &item.sources,
        importance,
        confidence,
        supersedes_id: supersedes,
        contradicts_id: None,
        expires_at: None,
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

/// After a user-driven consolidation lands, decay importance for facts
/// that haven't been recalled in a while. Floor of 1 — we never delete
/// via decay, only reduce salience. Returns the number of facts touched.
pub fn decay_unused_facts(pool: &UserDbPool) -> Result<i64, AppError> {
    let now = Utc::now().to_rfc3339();
    let cutoff = (Utc::now() - chrono::Duration::days(DECAY_THRESHOLD_DAYS)).to_rfc3339();
    let conn = pool.get()?;
    // Guard on last_decayed_at so a fact decays at most once per
    // DECAY_THRESHOLD_DAYS window even if consolidation is re-run sooner
    // (decay itself doesn't bump last_seen_at, so without this guard the
    // same stale fact would be decremented again on every pass). Resolve
    // the id set up front so the follow-up "mark as decayed" write targets
    // exactly the rows just decremented, rather than re-selecting by
    // `updated_at = ?1` (which could also catch an unrelated fact touched
    // at the same RFC3339 instant) or by `importance > 1` (which would miss
    // rows that were decremented down to the floor of 1 by this very pass).
    let mut stmt = conn.prepare(
        "SELECT n.id FROM companion_node n
         JOIN companion_fact f ON f.id = n.id
         WHERE n.kind = 'fact'
           AND n.importance > 1
           AND f.last_seen_at < ?1
           AND (f.last_decayed_at IS NULL OR f.last_decayed_at < ?1)",
    )?;
    let ids: Vec<String> = stmt
        .query_map(params![cutoff], |r| r.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);
    if ids.is_empty() {
        return Ok(0);
    }
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let node_sql = format!(
        "UPDATE companion_node SET importance = MAX(1, importance - ?1), updated_at = ?2
         WHERE id IN ({placeholders})"
    );
    let mut node_params: Vec<&dyn rusqlite::ToSql> = vec![&DECAY_DECREMENT, &now];
    node_params.extend(ids.iter().map(|id| id as &dyn rusqlite::ToSql));
    let updated = conn.execute(&node_sql, node_params.as_slice())?;

    let fact_sql =
        format!("UPDATE companion_fact SET last_decayed_at = ?1 WHERE id IN ({placeholders})");
    let mut fact_params: Vec<&dyn rusqlite::ToSql> = vec![&now];
    fact_params.extend(ids.iter().map(|id| id as &dyn rusqlite::ToSql));
    conn.execute(&fact_sql, fact_params.as_slice())?;

    Ok(updated as i64)
}

/// The horizon for one scope. Split out so the tests and the doc comments
/// above cannot disagree with the query.
fn age_out_horizon_days(scope: &str) -> i64 {
    match scope {
        "user" => AGE_OUT_DAYS_USER,
        _ => AGE_OUT_DAYS,
    }
}

/// The facts [`age_out_dormant_facts`] would demote right now: still
/// retrievable, already decayed to the floor, and unrecalled past their
/// scope's horizon. Reads only.
///
/// Requiring `importance = 1` rather than any low value is what makes this a
/// ladder instead of a cliff. A fact written at 3 has to survive two decay
/// windows before it is even a candidate, so the sweep's first visible effect
/// on a neglected corpus is small and its second is smaller — which is the
/// right shape for a process nobody watches.
pub fn dormant_fact_candidates(pool: &UserDbPool) -> Result<Vec<PruneCandidate>, AppError> {
    let conn = pool.get()?;
    let mut out = Vec::new();
    for scope in ["user", "project", "world"] {
        let cutoff =
            (Utc::now() - chrono::Duration::days(age_out_horizon_days(scope))).to_rfc3339();
        let mut stmt = conn.prepare(
            "SELECT n.id, f.scope, f.fact_key, n.importance, f.last_seen_at
             FROM companion_node n
             JOIN companion_fact f ON f.id = n.id
             WHERE n.kind = 'fact'
               AND n.importance = 1
               AND f.scope = ?1
               AND f.last_seen_at < ?2
             ORDER BY f.last_seen_at ASC",
        )?;
        let rows = stmt
            .query_map(params![scope, cutoff], |r| {
                Ok(PruneCandidate {
                    id: r.get(0)?,
                    scope: r.get(1)?,
                    key: r.get(2)?,
                    importance: r.get(3)?,
                    last_seen_at: r.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        out.extend(rows);
    }
    Ok(out)
}

/// Demote every dormant fact to importance 0 — the retrieval gate — through
/// the shared supersede statement. Returns how many were aged out.
///
/// This is the half of forgetting that was missing. `decay_unused_facts`
/// lowers salience and stops at 1; this crosses the line, on a horizon four
/// times longer for `user` scope. Nothing is deleted: markdown, row and
/// provenance all survive, exactly as for a supersede or a size-cap prune.
/// Idempotent — a second run finds nothing, because the candidates it just
/// demoted no longer satisfy `importance = 1`.
pub fn age_out_dormant_facts(pool: &UserDbPool) -> Result<i64, AppError> {
    let candidates = dormant_fact_candidates(pool)?;
    if candidates.is_empty() {
        return Ok(0);
    }
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let mut total = 0i64;
    for c in &candidates {
        total += semantic::demote_superseded(&conn, &c.id, &now)? as i64;
    }
    if total > 0 {
        tracing::info!(
            aged_out = total,
            "companion: aged dormant facts out of retrieval"
        );
    }
    Ok(total)
}

/// Retire facts whose own stated validity window has closed.
///
/// The third exit from the store, and the only one that needs no judgment.
/// [`decay_unused_facts`] asks whether an item still *matters*; supersedence
/// at the consolidation layer asks whether something *replaced* it. A fact
/// that said "until October" answered both when it was written, and neither
/// mechanism can see it:
///
/// - Supersedence never fires, because nothing arrives to supersede. October
///   produces no replacement fact; the world moves past the claim and files no
///   notice.
/// - Decay never fires, because on every input the score reads the row looks
///   healthy — recent, well-grounded, confident. Worse, `last_seen_at`
///   actively protects it: a claim about the current quarter is exactly what
///   queries about the current quarter match, so a time-boxed fact banks
///   recency during the window in which it is true and spends it staying alive
///   afterwards. Retrieval keeps the store's most confidently wrong rows in
///   the recall set.
///
/// Demotion, not deletion: importance 0 is retrieval-ineligible while the SQL
/// row, the markdown body and the provenance survive for audit — the same
/// posture [`prune_low_value_facts`] takes, for the same reason.
///
/// One rule for whoever adds an operator-issued "forget this" lane later: an
/// expiry must NOT be recorded through it. A deliberate forget is the one
/// signal that has to suppress re-derivation of a key, or the next cycle reads
/// the same episodes and reverses the correction. An expiry is the opposite —
/// "on leave until October" closing is precisely the moment a fresh fact under
/// that key becomes learnable again. Two different forget semantics with two
/// different downstream obligations; collapsing them makes every expiry
/// permanent and every expired key unlearnable.
///
/// Comparison is `expires_at < today` on `YYYY-MM-DD` strings, so a fact
/// survives through the whole of the last day it named. Idempotent: rows
/// already at importance 0 are excluded, so a re-run matches nothing.
pub fn retire_expired_facts(pool: &UserDbPool) -> Result<i64, AppError> {
    let conn = pool.get()?;
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let now = Utc::now().to_rfc3339();
    let n = conn.execute(
        "UPDATE companion_node SET importance = 0, updated_at = ?1
           WHERE kind = 'fact'
             AND importance > 0
             AND id IN (SELECT id FROM companion_fact
                         WHERE expires_at IS NOT NULL AND expires_at < ?2)",
        params![now, today],
    )?;
    Ok(n as i64)
}

/// Wall-clock timestamp of this process's last lifecycle sweep, 0 = never.
/// Process-local rather than persisted on purpose: [`decay_unused_facts`] is
/// already idempotent within its own `DECAY_THRESHOLD_DAYS` window (it guards
/// on `last_decayed_at`), so a restart re-running the sweep costs one cheap
/// query and changes nothing. That makes a schema-free throttle correct.
static LAST_LIFECYCLE_SWEEP: AtomicI64 = AtomicI64::new(0);

/// How often the recall path is allowed to run the lifecycle sweep.
const LIFECYCLE_SWEEP_MIN_INTERVAL_SECS: i64 = 6 * 3600;

/// Run the memory-lifecycle pass (time-decay, then size-cap) if it hasn't run
/// recently in this process. Called from the recall path — **the path that
/// actually runs.**
///
/// Both halves existed and neither had ever executed: `decay_unused_facts` and
/// `prune_low_value_facts` are reachable only from the manual
/// `companion_decay_unused_facts` / `companion_prune_low_value_facts` commands
/// and from the tail of a consolidation run, and `companion_consolidation` had
/// **0 rows** — consolidation had not run in 77 days. So every fact carried
/// `last_decayed_at = NULL`, and 70-day-old fleet statistics were being recited
/// as current in every prompt. Forgetting that only happens when a human
/// remembers to press a button is not forgetting.
///
/// Cost is one indexed SELECT plus at most two small UPDATEs, at most once per
/// [`LIFECYCLE_SWEEP_MIN_INTERVAL_SECS`] per process, on a table capped at
/// [`MAX_FACTS_PER_SCOPE`] rows per scope. Best-effort: a failure is logged and
/// never blocks a turn.
///
/// Safety of the three actions: aging out demotes to importance 0 — the
/// retrieval gate — but only a fact already at the decay floor that nothing
/// has recalled in [`AGE_OUT_DAYS`] (four times that for `user` scope), and it
/// demotes through the same statement a supersede uses, so nothing is deleted.
/// Decay decrements `importance` by 1 with a floor of 1: it lowers salience
/// and cannot cross the gate by itself. Pruning demotes to 0 as well, but only
/// for rows *above* the per-scope cap, and is a no-op on a brain under it.
///
/// **Age-out runs FIRST, against the pre-decay importances.** Run last it
/// would compound with the same pass's decrement — a fact at 2 would drop to 1
/// and be aged out in the same breath, collapsing the ladder the horizon
/// exists to create. Run first, a fact has to spend a whole sweep at the floor
/// before it can leave.
///
/// The outcome is persisted, not just logged: one
/// [`EVENT_MEMORY_LIFECYCLE_SWEEP`] row per sweep, **including sweeps that
/// changed nothing**. "It ran and there was nothing to do" and "it never ran"
/// are different facts, and this pass exists precisely because the second one
/// went unnoticed for 77 days.
pub fn maybe_run_lifecycle_sweep(pool: &UserDbPool) {
    let now = Utc::now().timestamp();
    let last = LAST_LIFECYCLE_SWEEP.load(Ordering::Relaxed);
    if last != 0 && now.saturating_sub(last) < LIFECYCLE_SWEEP_MIN_INTERVAL_SECS {
        return;
    }
    // Claim the slot before doing the work so two concurrent turns can't both
    // run the sweep.
    if LAST_LIFECYCLE_SWEEP
        .compare_exchange(last, now, Ordering::Relaxed, Ordering::Relaxed)
        .is_err()
    {
        return;
    }

    let mut errors: Vec<String> = Vec::new();

    // Expiry runs FIRST. It is the cheapest and least arguable of the exits,
    // and running it ahead of decay keeps a self-dated fact from spending
    // another window's worth of recency on staying alive.
    let expired = match retire_expired_facts(pool) {
        Ok(n) => {
            if n > 0 {
                tracing::info!(
                    retired = n,
                    "companion: lifecycle sweep retired expired facts"
                );
            }
            n
        }
        Err(e) => {
            tracing::warn!(error = %e, "companion: fact expiry failed (continuing)");
            errors.push(format!("expiry: {e}"));
            0
        }
    };

    let aged_out = match age_out_dormant_facts(pool) {
        Ok(n) => n,
        Err(e) => {
            tracing::warn!(error = %e, "companion: fact age-out failed (continuing)");
            errors.push(format!("age_out: {e}"));
            0
        }
    };
    let decayed = match decay_unused_facts(pool) {
        Ok(n) => {
            if n > 0 {
                tracing::info!(
                    decayed = n,
                    "companion: lifecycle sweep decayed unused facts"
                );
            }
            n
        }
        Err(e) => {
            tracing::warn!(error = %e, "companion: fact decay failed (continuing)");
            errors.push(format!("decay: {e}"));
            0
        }
    };
    let pruned = match prune_low_value_facts(pool) {
        Ok(n) => n,
        Err(e) => {
            tracing::warn!(error = %e, "companion: fact prune failed (continuing)");
            errors.push(format!("prune: {e}"));
            0
        }
    };

    record_lifecycle_sweep(pool, expired, aged_out, decayed, pruned, &errors);
}

/// Persist one sweep's outcome to the audit ledger. Best-effort by design —
/// failing to record a sweep must not be worse than not sweeping — but the
/// failure is logged loudly, because a silent ledger is the exact condition
/// this whole pass was written to end.
fn record_lifecycle_sweep(
    pool: &UserDbPool,
    expired: i64,
    aged_out: i64,
    decayed: i64,
    pruned: i64,
    errors: &[String],
) {
    let payload = serde_json::json!({
        "expired": expired,
        "aged_out": aged_out,
        "decayed": decayed,
        "pruned": pruned,
        "age_out_days": AGE_OUT_DAYS,
        "age_out_days_user": AGE_OUT_DAYS_USER,
        "decay_threshold_days": DECAY_THRESHOLD_DAYS,
        "max_facts_per_scope": MAX_FACTS_PER_SCOPE,
        "errors": errors,
    });
    if let Err(e) = crate::companion::night_shift::record_event(
        pool,
        None,
        EVENT_MEMORY_LIFECYCLE_SWEEP,
        None,
        None,
        &payload,
    ) {
        tracing::warn!(error = %e, "companion: could not record the lifecycle sweep");
    }
}

/// One fact the size-cap policy would forget, and why it is on the list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PruneCandidate {
    pub id: String,
    pub scope: String,
    pub key: String,
    pub importance: i32,
    pub last_seen_at: String,
}

/// The facts [`prune_low_value_facts`] WOULD demote right now, per scope,
/// lowest-value first (importance ASC, then last_seen_at ASC). Reads only.
///
/// This is the single definition of the size-cap criteria, and it exists
/// because two callers need the same answer for opposite reasons: the
/// enforcing pass below demotes exactly this list, and the sleep cycle's
/// reconcile phase *reports* it without touching anything (forgetting is
/// report-only until the approval inbox lands — `docs/plans/athena-longevity.md`
/// Part II, approval posture). Had the cycle re-expressed the criteria, "what
/// we said we'd forget" and "what we forgot" would be free to drift, and the
/// report would be describing a policy that no longer exists.
///
/// Empty on a brain under the cap, which is the normal state.
pub fn low_value_prune_candidates(pool: &UserDbPool) -> Result<Vec<PruneCandidate>, AppError> {
    let conn = pool.get()?;
    let cap = MAX_FACTS_PER_SCOPE as i64;
    let mut out = Vec::new();

    for scope in ["user", "project", "world"] {
        let active_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM companion_fact f
             JOIN companion_node n ON n.id = f.id
             WHERE n.kind = 'fact' AND n.importance > 0 AND f.scope = ?1",
            params![scope],
            |r| r.get(0),
        )?;
        if active_count <= cap {
            continue;
        }
        let to_demote = active_count - cap;
        let mut stmt = conn.prepare(
            "SELECT n.id, f.scope, f.fact_key, n.importance, f.last_seen_at
             FROM companion_node n
             JOIN companion_fact f ON f.id = n.id
             WHERE n.kind = 'fact' AND n.importance > 0 AND f.scope = ?1
             ORDER BY n.importance ASC, f.last_seen_at ASC
             LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![scope, to_demote], |r| {
                Ok(PruneCandidate {
                    id: r.get(0)?,
                    scope: r.get(1)?,
                    key: r.get(2)?,
                    importance: r.get(3)?,
                    last_seen_at: r.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        out.extend(rows);
    }
    Ok(out)
}

/// Demote facts above the per-scope cap (importance → 0). Lowest-value
/// first: order by importance ASC, then last_seen_at ASC. Markdown and
/// SQL rows stay; only retrieval-eligibility flips. Idempotent — re-running
/// when the brain is under-cap is a no-op. Returns the number of facts
/// demoted. The pair `decay_unused_facts` + `prune_low_value_facts` is
/// the lifecycle pass: time-decay first, size-cap second.
///
/// The *selection* lives in [`low_value_prune_candidates`]; this function is
/// only the act of demoting them, through the shared
/// [`semantic::demote_superseded`] statement so a size-cap demotion and a
/// supersede demotion are literally the same write.
pub fn prune_low_value_facts(pool: &UserDbPool) -> Result<i64, AppError> {
    let candidates = low_value_prune_candidates(pool)?;
    if candidates.is_empty() {
        return Ok(0);
    }
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let mut total_demoted = 0i64;
    for c in &candidates {
        total_demoted += semantic::demote_superseded(&conn, &c.id, &now)? as i64;
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
///
/// Spawn/stream/timeout plumbing lives in
/// [`oneshot::call_claude_text`](crate::companion::brain::oneshot::call_claude_text);
/// this wrapper owns only the consolidation-specific model choice and
/// typed envelope parsing.
async fn call_claude_oneshot(
    pool: &UserDbPool,
    prompt: &str,
) -> Result<ProposalEnvelope, AppError> {
    let text = call_claude_text(
        pool,
        prompt,
        "claude-opus-4-8",
        oneshot::leg::CONSOLIDATION,
        CONSOLIDATION_TIMEOUT,
    )
    .await?;
    parse_envelope(&text)
}

/// Parse the assembled assistant text. Tolerant of code-fenced replies
/// (Claude sometimes wraps despite explicit instructions) and trailing
/// commentary — find the first `{` and the matching last `}`.
fn parse_envelope(text: &str) -> Result<ProposalEnvelope, AppError> {
    let json = extract_json_span(text, "consolidation reply")?;
    serde_json::from_str(json).map_err(|e| {
        AppError::Internal(format!(
            "consolidation reply not valid JSON: {e}; got: {}",
            preview(json, 400)
        ))
    })
}

fn short_uuid() -> String {
    util::short_id(10)
}

#[cfg(test)]
mod tests {
    //! First tests for this module (976 lines, zero coverage until
    //! 2026-09-03), aimed at the one thing it claimed to do and could not:
    //! forget.
    //!
    //! The pre-change arithmetic, stated once so a future reader can check it
    //! against the code: `decay_unused_facts` floors at `MAX(1, importance-1)`
    //! and `keyword.rs` gates recall on `importance > 0`. One is a floor of
    //! one, the other is a gate at zero, and no path connected them — so on the
    //! operator's real brain decay had fired exactly once (all sixteen
    //! `last_decayed_at` values identical), the size cap could not fire at 113
    //! facts against a 500-per-scope cap, and nothing had ever aged out.
    //!
    //! Pool checkouts propagate rather than unwrap, for the reason
    //! `pool-get-unwrapped` counts fixtures at all.

    use super::*;
    use crate::companion::brain::episodic::{self, EpisodeRole};
    use crate::companion::brain::semantic::{FactInput, FactScope};
    use crate::companion::brain::test_home::TestHome;

    /// The sweep's throttle is a process-global atomic, so the tests that
    /// drive it must not run concurrently with each other.
    static SWEEP_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    struct Brain {
        pool: UserDbPool,
        _home: TestHome,
    }

    fn brain() -> Result<Brain, AppError> {
        let home = TestHome::new("consolidation");
        Ok(Brain {
            pool: crate::db::init_test_user_db()?,
            _home: home,
        })
    }

    /// Write a fact through the real writer, then backdate its `last_seen_at`
    /// and set its importance — the two inputs every lifecycle rule reads.
    /// Going through `write_fact` keeps the fixture honest about the schema
    /// (both rows, the provenance chain, the markdown on disk); the two
    /// UPDATEs afterwards are simply time travel, which the writer has no API
    /// for.
    fn seed_fact(
        b: &Brain,
        scope: FactScope,
        key: &str,
        importance: i32,
        days_ago: i64,
    ) -> Result<String, AppError> {
        let ep = episodic::append_episode(&b.pool, "s1", EpisodeRole::User, "context for a fact")?;
        let id = crate::companion::brain::semantic::write_fact(
            &b.pool,
            &FactInput {
                scope,
                key,
                value: "a fact worth remembering for a while",
                sources: std::slice::from_ref(&ep),
                importance,
                confidence: 0.9,
                supersedes_id: None,
                contradicts_id: None,
                // The age-out fixture is about DORMANCY, not expiry: the fact
                // must reach the gate through disuse, so it names no validity
                // window that the peer's retire_expired_facts could close first.
                expires_at: None,
            },
        )?;
        let seen = (Utc::now() - chrono::Duration::days(days_ago)).to_rfc3339();
        let conn = b.pool.get()?;
        conn.execute(
            "UPDATE companion_fact SET last_seen_at = ?1, last_decayed_at = NULL WHERE id = ?2",
            params![seen, id],
        )?;
        conn.execute(
            "UPDATE companion_node SET importance = ?1 WHERE id = ?2",
            params![importance, id],
        )?;
        Ok(id)
    }

    fn importance(b: &Brain, id: &str) -> Result<i32, AppError> {
        let conn = b.pool.get()?;
        Ok(conn.query_row(
            "SELECT importance FROM companion_node WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )?)
    }

    // ── decay ───────────────────────────────────────────────────────────

    /// Decay lowers salience by one per window and **stops at 1**. This is the
    /// floor that made forgetting impossible on its own; the test pins it so a
    /// future change to the age-out horizon cannot be made by quietly moving
    /// the floor instead.
    #[test]
    fn decay_stops_at_the_floor_and_never_reaches_the_retrieval_gate() -> Result<(), AppError> {
        let b = brain()?;
        let id = seed_fact(&b, FactScope::Project, "stale_build_stat", 1, 400)?;
        assert_eq!(
            decay_unused_facts(&b.pool)?,
            0,
            "a fact already at the floor is not a decay candidate"
        );
        assert_eq!(importance(&b, &id)?, 1);

        let id2 = seed_fact(&b, FactScope::Project, "older_build_stat", 3, 400)?;
        decay_unused_facts(&b.pool)?;
        assert_eq!(importance(&b, &id2)?, 2);
        Ok(())
    }

    /// A fact seen inside the window is not touched, however low its
    /// importance. Decay is about disuse, not about being unimportant.
    #[test]
    fn a_recently_seen_fact_does_not_decay() -> Result<(), AppError> {
        let b = brain()?;
        let id = seed_fact(&b, FactScope::Project, "fresh", 3, 1)?;
        assert_eq!(decay_unused_facts(&b.pool)?, 0);
        assert_eq!(importance(&b, &id)?, 3);
        Ok(())
    }

    /// The `last_decayed_at` guard: two passes inside one window decrement
    /// once. Without it every recall-path sweep would strip a fact.
    #[test]
    fn decay_is_idempotent_within_its_own_window() -> Result<(), AppError> {
        let b = brain()?;
        let id = seed_fact(&b, FactScope::Project, "twice", 3, 400)?;
        decay_unused_facts(&b.pool)?;
        decay_unused_facts(&b.pool)?;
        assert_eq!(importance(&b, &id)?, 2, "one window, one decrement");
        Ok(())
    }

    // ── age-out ─────────────────────────────────────────────────────────

    /// The gap this direction closes: a fact CAN now reach 0, which is the
    /// value `keyword.rs` gates recall on. Run against the pre-change module
    /// there is no function that makes this assertion pass.
    #[test]
    fn a_dormant_fact_ages_out_to_the_retrieval_gate() -> Result<(), AppError> {
        let b = brain()?;
        let id = seed_fact(
            &b,
            FactScope::Project,
            "fleet_14d_snapshot",
            1,
            AGE_OUT_DAYS + 5,
        )?;
        assert_eq!(age_out_dormant_facts(&b.pool)?, 1);
        assert_eq!(
            importance(&b, &id)?,
            0,
            "aged out means retrieval-ineligible"
        );

        // Never a delete: both rows and the provenance survive.
        let conn = b.pool.get()?;
        let rows: i64 = conn.query_row(
            "SELECT COUNT(*) FROM companion_fact f JOIN companion_node n ON n.id = f.id \
             WHERE f.id = ?1",
            params![id],
            |r| r.get(0),
        )?;
        assert_eq!(rows, 1, "aging out demotes; it must never delete");
        Ok(())
    }

    /// Only from the floor. A fact still at 2 has not served its decay ladder
    /// and must not skip it, however old it is.
    #[test]
    fn age_out_only_takes_facts_that_reached_the_decay_floor() -> Result<(), AppError> {
        let b = brain()?;
        let id = seed_fact(
            &b,
            FactScope::Project,
            "not_yet_floored",
            2,
            AGE_OUT_DAYS * 4,
        )?;
        // A second fact that IS at the floor, so this cannot pass merely
        // because nothing ages out at all — which is exactly what it would
        // have proved against the pre-change module.
        let floored = seed_fact(&b, FactScope::Project, "floored", 1, AGE_OUT_DAYS * 4)?;
        assert_eq!(age_out_dormant_facts(&b.pool)?, 1);
        assert_eq!(importance(&b, &id)?, 2);
        assert_eq!(importance(&b, &floored)?, 0);
        Ok(())
    }

    /// The scope asymmetry, which is the one product judgement in this
    /// direction: a user-scope fact at the same age survives, because
    /// `last_seen_at` measures recall frequency and user facts are
    /// load-bearing on turns that never query them.
    #[test]
    fn user_scope_facts_get_the_longer_horizon() -> Result<(), AppError> {
        let b = brain()?;
        let user = seed_fact(
            &b,
            FactScope::User,
            "prefers_readable_ids",
            1,
            AGE_OUT_DAYS + 5,
        )?;
        let world = seed_fact(&b, FactScope::World, "some_world_fact", 1, AGE_OUT_DAYS + 5)?;
        assert_eq!(age_out_dormant_facts(&b.pool)?, 1);
        assert_eq!(
            importance(&b, &user)?,
            1,
            "a user fact is kept four times longer"
        );
        assert_eq!(importance(&b, &world)?, 0);

        let ancient = seed_fact(&b, FactScope::User, "long_gone", 1, AGE_OUT_DAYS_USER + 5)?;
        assert_eq!(age_out_dormant_facts(&b.pool)?, 1);
        assert_eq!(
            importance(&b, &ancient)?,
            0,
            "the longer horizon is a horizon, not an exemption"
        );
        Ok(())
    }

    /// Idempotent: the second run finds nothing, because what it demoted no
    /// longer satisfies `importance = 1`.
    #[test]
    fn age_out_is_idempotent() -> Result<(), AppError> {
        let b = brain()?;
        seed_fact(&b, FactScope::World, "gone", 1, AGE_OUT_DAYS + 5)?;
        assert_eq!(age_out_dormant_facts(&b.pool)?, 1);
        assert_eq!(age_out_dormant_facts(&b.pool)?, 0);
        Ok(())
    }

    // ── prune (size cap) ────────────────────────────────────────────────

    /// A brain under the cap is the normal state and the pass must be a
    /// no-op there — on the operator's real corpus (113 facts against
    /// 3 x 500) the cap has never once been able to fire.
    #[test]
    fn prune_is_a_no_op_under_the_cap() -> Result<(), AppError> {
        let b = brain()?;
        seed_fact(&b, FactScope::Project, "one", 3, 1)?;
        assert!(low_value_prune_candidates(&b.pool)?.is_empty());
        assert_eq!(prune_low_value_facts(&b.pool)?, 0);
        Ok(())
    }

    /// Over the cap, the excess is demoted lowest-value first. Seeded with
    /// direct row inserts rather than `write_fact`: the cap is 500 per scope
    /// and going through the real writer would put 501 markdown files on disk
    /// for one assertion. The columns written here are exactly the ones the
    /// selection reads.
    #[test]
    fn prune_demotes_the_excess_above_the_cap_lowest_value_first() -> Result<(), AppError> {
        let b = brain()?;
        let over = MAX_FACTS_PER_SCOPE + 3;
        {
            let conn = b.pool.get()?;
            let now = Utc::now().to_rfc3339();
            for i in 0..over {
                let id = format!("fact_seed_{i:04}");
                // The three oldest carry importance 1 so the ordering
                // (importance ASC, last_seen_at ASC) has something to sort on.
                let imp = if i < 3 { 1 } else { 3 };
                let seen =
                    (Utc::now() - chrono::Duration::days(over as i64 - i as i64)).to_rfc3339();
                conn.execute(
                    "INSERT INTO companion_node (id, kind, file_path, content_hash, importance, body_excerpt, created_at, updated_at)
                     VALUES (?1, 'fact', ?2, 'sha256:x', ?3, 'x', ?4, ?4)",
                    params![id, format!("semantic/world/{id}.md"), imp, now],
                )?;
                conn.execute(
                    "INSERT INTO companion_fact (id, scope, fact_key, confidence, last_seen_at)
                     VALUES (?1, 'world', ?2, 0.9, ?3)",
                    params![id, format!("k{i}"), seen],
                )?;
            }
        }
        let candidates = low_value_prune_candidates(&b.pool)?;
        assert_eq!(
            candidates.len(),
            3,
            "exactly the overflow, not the whole tail"
        );
        assert!(
            candidates.iter().all(|c| c.importance == 1),
            "lowest value first: {candidates:?}"
        );
        assert_eq!(prune_low_value_facts(&b.pool)?, 3);
        assert!(low_value_prune_candidates(&b.pool)?.is_empty());
        Ok(())
    }

    // ── the sweep ───────────────────────────────────────────────────────

    fn sweep_rows(b: &Brain) -> Result<Vec<String>, AppError> {
        let conn = b.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT payload_json FROM companion_night_event
             WHERE kind = ?1 ORDER BY created_at, id",
        )?;
        let rows = stmt
            .query_map(params![EVENT_MEMORY_LIFECYCLE_SWEEP], |r| {
                r.get::<_, String>(0)
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// The sweep now leaves a record. Before this, `maybe_run_lifecycle_sweep`
    /// logged its counts to `tracing` and persisted nothing — so on a machine
    /// where it had never fired, and on one where it had fired a hundred times
    /// and found nothing, the database looked identical.
    #[test]
    fn the_sweep_persists_its_outcome_even_when_it_changes_nothing() -> Result<(), AppError> {
        let _serial = SWEEP_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let b = brain()?;
        LAST_LIFECYCLE_SWEEP.store(0, Ordering::Relaxed);

        maybe_run_lifecycle_sweep(&b.pool);
        let rows = sweep_rows(&b)?;
        assert_eq!(
            rows.len(),
            1,
            "an empty sweep is still a sweep that happened"
        );
        let v: serde_json::Value = serde_json::from_str(&rows[0])
            .map_err(|e| AppError::Internal(format!("payload is not json: {e}")))?;
        assert_eq!(v["aged_out"], 0);
        assert_eq!(v["decayed"], 0);
        assert_eq!(v["pruned"], 0);
        assert_eq!(v["age_out_days"], AGE_OUT_DAYS);
        assert_eq!(v["age_out_days_user"], AGE_OUT_DAYS_USER);
        assert_eq!(v["errors"].as_array().map(|a| a.len()), Some(0));
        Ok(())
    }

    /// The throttle: a second sweep inside the interval does nothing at all,
    /// including writing a second ledger row.
    #[test]
    fn the_sweep_throttles_itself_within_the_interval() -> Result<(), AppError> {
        let _serial = SWEEP_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let b = brain()?;
        LAST_LIFECYCLE_SWEEP.store(0, Ordering::Relaxed);

        maybe_run_lifecycle_sweep(&b.pool);
        maybe_run_lifecycle_sweep(&b.pool);
        assert_eq!(
            sweep_rows(&b)?.len(),
            1,
            "throttled sweeps must not log a run that did not happen"
        );

        // Pretend the interval elapsed, and it runs again.
        LAST_LIFECYCLE_SWEEP.store(
            Utc::now().timestamp() - LIFECYCLE_SWEEP_MIN_INTERVAL_SECS - 1,
            Ordering::Relaxed,
        );
        maybe_run_lifecycle_sweep(&b.pool);
        assert_eq!(sweep_rows(&b)?.len(), 2);
        Ok(())
    }

    /// End to end, through the entry point the recall path actually calls: a
    /// dormant fact goes from retrievable to not, and the ledger says so.
    #[test]
    fn a_full_sweep_ages_a_dormant_fact_out_and_records_it() -> Result<(), AppError> {
        let _serial = SWEEP_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let b = brain()?;
        LAST_LIFECYCLE_SWEEP.store(0, Ordering::Relaxed);

        let dormant = seed_fact(
            &b,
            FactScope::Project,
            "fleet_f8a981a8_14d",
            1,
            AGE_OUT_DAYS + 10,
        )?;
        let live = seed_fact(&b, FactScope::Project, "current_work", 3, 2)?;

        maybe_run_lifecycle_sweep(&b.pool);

        assert_eq!(importance(&b, &dormant)?, 0);
        assert_eq!(importance(&b, &live)?, 3, "a fact in use is untouched");
        let v: serde_json::Value = serde_json::from_str(&sweep_rows(&b)?[0])
            .map_err(|e| AppError::Internal(format!("payload is not json: {e}")))?;
        assert_eq!(v["aged_out"], 1);
        Ok(())
    }

    /// Age-out runs against the PRE-decay importances. A fact at 2 that is
    /// also past its horizon decays to 1 in this sweep and ages out in the
    /// next one — one step per sweep, never two.
    #[test]
    fn the_sweep_does_not_decay_and_age_out_the_same_fact_in_one_pass() -> Result<(), AppError> {
        let _serial = SWEEP_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let b = brain()?;
        LAST_LIFECYCLE_SWEEP.store(0, Ordering::Relaxed);

        let id = seed_fact(&b, FactScope::World, "two_steps_away", 2, AGE_OUT_DAYS + 10)?;
        maybe_run_lifecycle_sweep(&b.pool);
        assert_eq!(importance(&b, &id)?, 1, "decayed, not aged out");

        LAST_LIFECYCLE_SWEEP.store(0, Ordering::Relaxed);
        maybe_run_lifecycle_sweep(&b.pool);
        assert_eq!(importance(&b, &id)?, 0, "the second sweep takes it out");
        Ok(())
    }

    /// A rejected proposal is not asked again - and a new value for the
    /// rejected key still is (block on the whole triple, never on the key
    /// alone).
    ///
    /// Arm A is the pre-change behaviour and lives inside the test: the first
    /// pass MUST insert, so a harness that inserted nothing for both arms
    /// fails here instead of passing. Arm B is the rule under test.
    #[test]
    fn a_rejected_proposal_is_not_asked_again() -> Result<(), AppError> {
        let b = brain()?;
        let ep = episodic::append_episode(&b.pool, "s1", EpisodeRole::User, "I moved to Brno")?;
        let proposal = |value: &str| RawProposal {
            kind: "add".to_string(),
            scope: "user".to_string(),
            key: "home_city".to_string(),
            value: value.to_string(),
            sources: vec![ep.clone()],
            importance: 3,
            confidence: 0.9,
            supersedes_id: None,
            rationale: None,
        };
        let run = |pool: &UserDbPool, id: &str| -> Result<(), AppError> {
            let conn = pool.get()?;
            conn.execute(
                "INSERT INTO companion_consolidation (id, triggered_at, status)
                 VALUES (?1, ?2, 'running')",
                params![id, Utc::now().to_rfc3339()],
            )?;
            Ok(())
        };
        let persist =
            |pool: &UserDbPool, id: &str, p: &RawProposal| -> Result<Persisted, AppError> {
                let conn = pool.get()?;
                let tx = conn.unchecked_transaction()?;
                let out = persist_proposals(&tx, id, std::slice::from_ref(p))?;
                tx.commit()?;
                Ok(out)
            };

        // Arm A: the first pass proposes it (the old behaviour, kept as the
        // known-positive so the harness proves it can insert at all).
        run(&b.pool, "cons_a")?;
        let a = persist(&b.pool, "cons_a", &proposal("Brno"))?;
        assert_eq!(
            a,
            Persisted {
                inserted: 1,
                skipped_rejected: 0
            }
        );

        // The operator says no.
        let item_id: String = b.pool.get()?.query_row(
            "SELECT id FROM companion_consolidation_item WHERE consolidation_id = 'cons_a'",
            [],
            |r| r.get(0),
        )?;
        reject_item(&b.pool, &item_id)?;

        // Arm B: the next pass re-derives the same fact and is not allowed to ask.
        run(&b.pool, "cons_b")?;
        let b_same = persist(&b.pool, "cons_b", &proposal("Brno"))?;
        assert_eq!(
            b_same,
            Persisted {
                inserted: 0,
                skipped_rejected: 1
            }
        );

        // A different value for the rejected key is a new question.
        let b_new = persist(&b.pool, "cons_b", &proposal("Prague"))?;
        assert_eq!(
            b_new,
            Persisted {
                inserted: 1,
                skipped_rejected: 0
            }
        );

        let pending: i64 = b.pool.get()?.query_row(
            "SELECT COUNT(*) FROM companion_consolidation_item WHERE status = 'pending'",
            [],
            |r| r.get(0),
        )?;
        assert_eq!(pending, 1, "only the new value waits for review");
        Ok(())
    }
}
