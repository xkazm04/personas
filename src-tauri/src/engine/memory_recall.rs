//! Token-budgeted, decay-scored memory recall + forgetting.
//!
//! Memory Engine v2 (docs/plans/memory-service.md) replaces the blind
//! "importance DESC then truncate at N chars" injection with an explicit
//! value model shared by two consumers:
//!
//! - **recall** — [`pack_by_budget`] re-ranks the active-tier candidate set
//!   by [`decay_score`] and greedy-packs whole entries into a character
//!   budget, so the *most valuable* memories survive the cut rather than
//!   whichever sorted first (the previous truncation could drop a fresh
//!   high-importance memory because an old, often-accessed one padded the
//!   budget first).
//! - **forgetting** — [`run_decay_forgetting`] archives active-tier rows
//!   whose decayed value has fallen below a floor, replacing the binary
//!   "30 days + zero access" rule with category-aware half-lives
//!   (constraints barely decay; session context decays in weeks).
//!
//! The scoring function is deliberately pure and deterministic — it is the
//! local reference implementation of the `recall`/`forget` verbs the
//! external memory service (phase 2) exposes over HTTP, so the two must
//! stay behaviourally aligned.

use std::collections::HashMap;

use chrono::{DateTime, Utc};

use crate::db::models::PersonaMemory;
use crate::db::repos::core::memories as repo;
use crate::db::DbPool;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Task-recall runtime registry (ml builds)
//
// The runner (`engine::runner::run_execution`) receives only the main `DbPool`;
// the embedder and the vec-registered user-DB pool live in `AppState`.
// Threading them through `ExecutionEngine` → `run_execution_with_ceiling` →
// `run_execution` would touch every execution entry point for one optional
// enhancement, so instead app setup (`lib.rs`) registers them here once and
// the recall/write paths look them up. `OnceLock` = set-once, lock-free reads;
// if setup never registers (tests, headless), every consumer silently keeps
// the value-only behavior.
// ---------------------------------------------------------------------------

#[cfg(feature = "ml")]
#[allow(clippy::type_complexity)]
static TASK_RECALL_RUNTIME: std::sync::OnceLock<(
    crate::db::UserDbPool,
    std::sync::Arc<crate::engine::embedder::EmbeddingManager>,
)> = std::sync::OnceLock::new();

/// Register the embedding runtime for task-relevant recall + embed-on-write.
/// Called once from app setup after the user DB pool and `EmbeddingManager`
/// exist. Subsequent calls are no-ops.
#[cfg(feature = "ml")]
pub fn init_task_recall_runtime(
    vec_pool: crate::db::UserDbPool,
    embedder: std::sync::Arc<crate::engine::embedder::EmbeddingManager>,
) {
    let _ = TASK_RECALL_RUNTIME.set((vec_pool, embedder));
}

/// The registered embedding runtime, if app setup provided one.
#[cfg(feature = "ml")]
pub fn task_recall_runtime() -> Option<(
    crate::db::UserDbPool,
    std::sync::Arc<crate::engine::embedder::EmbeddingManager>,
)> {
    TASK_RECALL_RUNTIME.get().cloned()
}

/// Flatten an execution's `input_data` JSON into embeddable task text: object
/// keys and string leaves in document order, whitespace-joined, capped at 2000
/// bytes (on a char boundary). Numbers/bools/nulls carry no semantic signal
/// for MiniLM and are skipped. Returns an empty string for `None`/no strings —
/// the task-aware pack treats that as "no task signal" and falls back to the
/// value-only ranking. Pure + feature-gate neutral so the non-ml build can
/// unit-test it identically.
#[cfg_attr(not(feature = "ml"), allow(dead_code))] // runtime caller (runner) is ml-gated; non-ml exercises it via tests
pub fn task_context_from_input(input: Option<&serde_json::Value>) -> String {
    fn walk(v: &serde_json::Value, out: &mut String) {
        match v {
            serde_json::Value::String(s) => {
                if !s.trim().is_empty() {
                    out.push_str(s);
                    out.push(' ');
                }
            }
            serde_json::Value::Array(a) => a.iter().for_each(|x| walk(x, out)),
            serde_json::Value::Object(m) => m.iter().for_each(|(k, x)| {
                // Skip runner-internal control keys (`_use_case`, `_ops`, …) —
                // metadata, not task semantics.
                if !k.starts_with('_') {
                    out.push_str(k);
                    out.push(' ');
                    walk(x, out);
                }
            }),
            _ => {}
        }
    }
    let mut out = String::new();
    if let Some(v) = input {
        walk(v, &mut out);
    }
    const CAP: usize = 2000;
    if out.len() > CAP {
        let mut cut = CAP;
        while cut > 0 && !out.is_char_boundary(cut) {
            cut -= 1;
        }
        out.truncate(cut);
    }
    out.trim_end().to_string()
}

/// Half-life, in days, of a memory's value per category. After one
/// half-life with no access, a memory counts for half its importance.
/// Categories that encode durable rules decay slowly; ephemeral context
/// decays fast. Unknown categories get the `learned` default.
fn category_half_life_days(category: &str) -> f64 {
    match category {
        "constraint" => 365.0,
        "instruction" => 180.0,
        "preference" => 120.0,
        "fact" => 90.0,
        "learned" => 60.0,
        "context" => 21.0,
        _ => 60.0,
    }
}

/// Parse an RFC3339 / `datetime('now')`-style timestamp, tolerating both
/// forms present in the table (`create` writes RFC3339; SQLite defaults
/// write `YYYY-MM-DD HH:MM:SS`).
fn parse_ts(ts: &str) -> Option<DateTime<Utc>> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(ts) {
        return Some(dt.with_timezone(&Utc));
    }
    chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|n| n.and_utc())
}

/// Decayed value of a memory at `now`.
///
/// `score = importance × 0.5^(age / half_life(category)) × access_boost`
///
/// - `age` is measured from `last_accessed_at` when set (a memory that
///   keeps getting injected stays fresh), else `created_at`.
/// - `access_boost = 1 + 0.25·ln(1 + access_count)` — repeated real use
///   raises value, logarithmically so a hot counter can't dominate.
/// - Unparseable timestamps score as age 0 (never punish a row for a
///   malformed timestamp).
pub fn decay_score(m: &PersonaMemory, now: DateTime<Utc>) -> f64 {
    let anchor = m
        .last_accessed_at
        .as_deref()
        .and_then(parse_ts)
        .or_else(|| parse_ts(&m.created_at));
    let age_days = anchor
        .map(|a| (now - a).num_seconds().max(0) as f64 / 86_400.0)
        .unwrap_or(0.0);
    let half_life = category_half_life_days(&m.category);
    let decay = 0.5_f64.powf(age_days / half_life);
    let access_boost = 1.0 + 0.25 * ((1.0 + m.access_count.max(0) as f64).ln());
    (m.importance as f64) * decay * access_boost
}

/// Chars this memory will occupy in the injected prompt section. Mirrors
/// the line format in `engine::runner` ("- **title** [category]
/// (importance: N): content\n") plus fixed markup overhead.
pub fn entry_chars(m: &PersonaMemory) -> usize {
    m.title.len() + m.category.len() + m.content.len() + 40
}

/// Result of a budgeted pack: the selected memories (best-value first)
/// and how many candidates were left out.
pub struct PackedRecall {
    pub selected: Vec<PersonaMemory>,
    pub omitted: usize,
}

/// Greedy-pack active-tier candidates into `char_budget`, best
/// [`decay_score`] first. Always admits at least one entry (a single
/// over-budget memory is better than an empty section). Entries that
/// don't fit are skipped rather than truncated — a partial memory is
/// worse than none — and packing continues so smaller entries can still
/// use the remaining budget.
pub fn pack_by_budget(
    mut candidates: Vec<PersonaMemory>,
    char_budget: usize,
    now: DateTime<Utc>,
) -> PackedRecall {
    candidates.sort_by(|a, b| {
        decay_score(b, now)
            .partial_cmp(&decay_score(a, now))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    });
    let total = candidates.len();
    let mut used = 0usize;
    let mut selected: Vec<PersonaMemory> = Vec::new();
    for m in candidates {
        let cost = entry_chars(&m);
        if used + cost > char_budget && !selected.is_empty() {
            continue;
        }
        used += cost;
        selected.push(m);
    }
    PackedRecall {
        omitted: total - selected.len(),
        selected,
    }
}

// ---------------------------------------------------------------------------
// Task-relevant recall (MEMORY CONTRACT (7)) — semantic blend
//
// `pack_by_budget` above ranks purely by decayed VALUE (importance × category
// half-life × access boost). That is TASK-BLIND: a run about invoices injects
// the same "most valuable" memories as a run about tweets. The functions below
// blend a per-memory semantic `similarity` to the run's task context so
// relevance can REORDER memories of comparable value while importance/core
// semantics stay dominant. They are pure and deterministic — the ml recall
// path (embedding + KNN + distance floor) lives in the caller (the runner),
// which hands this module a ready `similarity` map. Under a non-ml build the
// caller has no embedder, passes no map, and keeps calling `pack_by_budget`,
// so the value-only fallback is byte-for-byte unchanged.
// ---------------------------------------------------------------------------

/// Default weight of the semantic term in [`blended_value`]. Chosen so a fully
/// on-topic memory (similarity 1.0) is worth at most `1 + 0.6 = 1.6×` its value
/// score: enough to lift a relevant memory over a comparably-valued irrelevant
/// one, but bounded so a memory cannot be promoted past a peer worth more than
/// `1.6×` on value alone. Importance therefore keeps the last word across wide
/// value gaps; relevance only settles ties and near-ties.
#[cfg_attr(not(feature = "ml"), allow(dead_code))] // runtime consumers are ml-gated; non-ml exercises via tests
pub const DEFAULT_RELEVANCE_WEIGHT: f64 = 0.6;

/// Map a vector distance to a similarity in `[0, 1]`.
///
/// The shared retrieval lane returns L2 distance over fastembed-normalized
/// 384-d MiniLM vectors and drops anything past `max_distance`
/// ([`crate::retrieval::MAX_VECTOR_DISTANCE`]) via
/// [`crate::retrieval::filter_by_distance_floor`]. We linearly invert the
/// SURVIVING range: distance 0 → similarity 1.0 (identical), distance AT the
/// floor → 0.0 (barely related, no lift). A distance beyond the floor (which
/// the floor filter should already have removed) clamps to 0.0, so an
/// off-topic hit can never add relevance. `max_distance <= 0` is treated as
/// "no meaningful range" → 0.0.
#[cfg_attr(not(feature = "ml"), allow(dead_code))] // runtime consumers are ml-gated; non-ml exercises via tests
pub fn similarity_from_distance(distance: f32, max_distance: f32) -> f64 {
    if max_distance <= 0.0 {
        return 0.0;
    }
    let s = (max_distance - distance) / max_distance;
    (s as f64).clamp(0.0, 1.0)
}

/// Blend a decayed `value_score` with a semantic `similarity` in `[0, 1]`:
///
/// `final = value_score × (1 + relevance_weight × similarity)`
///
/// Properties (load-bearing — see MEMORY CONTRACT (7)):
/// - **similarity 0 is a no-op:** an un-embedded, off-topic, or below-floor
///   memory scores exactly `value_score`, so it ranks precisely as
///   `pack_by_budget` would today. Relevance can only PROMOTE, never demote.
/// - **bounded lift:** the multiplier is `[1, 1 + relevance_weight]`, so a
///   memory cannot overtake a peer worth more than `(1 + relevance_weight)×`
///   on value alone — importance stays dominant across real value gaps.
#[cfg_attr(not(feature = "ml"), allow(dead_code))] // runtime consumers are ml-gated; non-ml exercises via tests
pub fn blended_value(value_score: f64, similarity: f64, relevance_weight: f64) -> f64 {
    value_score * (1.0 + relevance_weight * similarity.clamp(0.0, 1.0))
}

/// Task-relevant sibling of [`pack_by_budget`]: greedy-packs `candidates` into
/// `char_budget`, but ranks by [`blended_value`] of each memory's
/// [`decay_score`] and its semantic `similarity` to the task (keyed by memory
/// id). A memory absent from `relevance` is treated as similarity 0 — i.e.
/// ranked exactly as the value-only pack would rank it, so a partially-embedded
/// corpus degrades gracefully. Packing/omission/always-admit-one semantics and
/// the char budget are identical to [`pack_by_budget`]; only the sort key
/// changes.
#[cfg_attr(not(feature = "ml"), allow(dead_code))] // runtime caller (task-aware pack) is ml-gated; non-ml exercises via tests
pub fn pack_by_budget_relevance(
    mut candidates: Vec<PersonaMemory>,
    char_budget: usize,
    now: DateTime<Utc>,
    relevance: &HashMap<String, f64>,
    relevance_weight: f64,
) -> PackedRecall {
    let score = |m: &PersonaMemory| -> f64 {
        let sim = relevance.get(&m.id).copied().unwrap_or(0.0);
        blended_value(decay_score(m, now), sim, relevance_weight)
    };
    candidates.sort_by(|a, b| {
        score(b)
            .partial_cmp(&score(a))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    });
    let total = candidates.len();
    let mut used = 0usize;
    let mut selected: Vec<PersonaMemory> = Vec::new();
    for m in candidates {
        let cost = entry_chars(&m);
        if used + cost > char_budget && !selected.is_empty() {
            continue;
        }
        used += cost;
        selected.push(m);
    }
    PackedRecall {
        omitted: total - selected.len(),
        selected,
    }
}

/// Task-aware recall orchestrator (ml builds): the one-call composition the
/// runner swaps in for [`pack_by_budget`] when it has an embedder + the
/// vec-registered user-DB pool at hand.
///
/// Flow (MEMORY CONTRACT (7)):
/// 1. embed `task_context` (the same task/capability text the runner already
///    assembles for the prompt) and KNN over `persona_memory_embedding`
///    ([`repo::search_similar_memories`]),
/// 2. drop off-topic hits via the shared lane's floor
///    ([`crate::retrieval::filter_by_distance_floor`] at
///    [`crate::retrieval::MAX_VECTOR_DISTANCE`]),
/// 3. convert surviving distances to similarities
///    ([`similarity_from_distance`]) keyed by memory id,
/// 4. blend-rank + greedy-pack via [`pack_by_budget_relevance`].
///
/// Degrades to the value-only [`pack_by_budget`] — byte-identical behavior —
/// whenever the task context is empty or the embedding search fails (embedder
/// poisoned, vec table unavailable): task-aware recall is an enhancement,
/// never a new failure mode for prompt assembly. The KNN result is
/// intersected with `candidates` implicitly (hit ids not in the candidate set
/// have no row to lift), so orphaned or foreign-persona embeddings can't
/// inject anything — SQL scoping still decides WHAT is eligible; relevance
/// only decides WHICH eligible entries win the budget.
#[cfg(feature = "ml")]
pub async fn pack_by_budget_task_aware(
    candidates: Vec<PersonaMemory>,
    char_budget: usize,
    now: DateTime<Utc>,
    task_context: &str,
    vec_pool: &crate::db::UserDbPool,
    embedder: &std::sync::Arc<crate::engine::embedder::EmbeddingManager>,
) -> PackedRecall {
    if candidates.is_empty() || task_context.trim().is_empty() {
        return pack_by_budget(candidates, char_budget, now);
    }
    // KNN wide enough that every candidate CAN receive a similarity: the vec
    // table spans all personas, so k must exceed the candidate count by a
    // margin or this persona's near hits could be crowded out of the top-k
    // by other personas' rows.
    let k = candidates.len().saturating_mul(4).max(128);
    let hits = match repo::search_similar_memories(vec_pool, embedder, task_context, k).await {
        Ok(h) => h,
        Err(e) => {
            tracing::warn!(
                error = %e,
                "task-aware recall: embedding search failed; falling back to value-only pack"
            );
            return pack_by_budget(candidates, char_budget, now);
        }
    };
    let (kept, dropped_far) =
        crate::retrieval::filter_by_distance_floor(&hits, crate::retrieval::MAX_VECTOR_DISTANCE);
    let relevance: HashMap<String, f64> = kept
        .iter()
        .map(|(id, d)| {
            (
                id.clone(),
                similarity_from_distance(*d, crate::retrieval::MAX_VECTOR_DISTANCE),
            )
        })
        .collect();
    tracing::debug!(
        hits = hits.len(),
        kept = kept.len(),
        dropped_far,
        "task-aware recall: similarity map built"
    );
    pack_by_budget_relevance(
        candidates,
        char_budget,
        now,
        &relevance,
        DEFAULT_RELEVANCE_WEIGHT,
    )
}

/// A memory is forgotten (archived) when its decayed value falls below
/// this floor. An importance-3 `learned` memory with no access crosses it
/// after ~2 half-lives (~4 months); an importance-5 constraint essentially
/// never does.
const FORGET_SCORE_FLOOR: f64 = 0.75;

/// Never forget a memory younger than this, whatever its score — new
/// memories haven't had a chance to earn accesses yet.
const FORGET_MIN_AGE_DAYS: f64 = 21.0;

/// Importance 4–5 memories are exempt from decay-forgetting: the operator
/// (or curator) marked them as high-value, so only an explicit review may
/// retire them.
const FORGET_MAX_IMPORTANCE: i32 = 3;

fn should_forget(m: &PersonaMemory, now: DateTime<Utc>) -> bool {
    if m.importance > FORGET_MAX_IMPORTANCE {
        return false;
    }
    let created = match parse_ts(&m.created_at) {
        Some(c) => c,
        None => return false,
    };
    let age_days = (now - created).num_seconds().max(0) as f64 / 86_400.0;
    if age_days < FORGET_MIN_AGE_DAYS {
        return false;
    }
    decay_score(m, now) < FORGET_SCORE_FLOOR
}

/// Decay-based forgetting pass: archive (reversible, never delete) every
/// `active`-tier memory whose value has decayed below the floor. `core`
/// is untouched by construction (only `active` rows are fetched, and
/// `archive_by_ids` guards core anyway). Returns the number archived.
pub fn run_decay_forgetting(pool: &DbPool, persona_id: &str) -> Result<i64, AppError> {
    let now = Utc::now();
    let candidates = repo::get_active_for_decay(pool, persona_id)?;
    let ids: Vec<String> = candidates
        .iter()
        .filter(|m| should_forget(m, now))
        .map(|m| m.id.clone())
        .collect();
    if ids.is_empty() {
        return Ok(0);
    }
    let archived = repo::archive_by_ids(pool, &ids)?;
    if archived > 0 {
        tracing::info!(
            persona_id,
            archived,
            "memory decay-forgetting archived stale active memories"
        );
    }
    Ok(archived)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn mem(id: &str, category: &str, importance: i32, age_days: i64, access: i32) -> PersonaMemory {
        let now = Utc::now();
        PersonaMemory {
            id: id.into(),
            persona_id: "p1".into(),
            title: format!("title {id}"),
            content: "content".repeat(10),
            category: category.into(),
            source_execution_id: None,
            importance,
            tags: None,
            tier: "active".into(),
            access_count: access,
            last_accessed_at: None,
            created_at: (now - Duration::days(age_days)).to_rfc3339(),
            updated_at: now.to_rfc3339(),
            use_case_id: None,
            home_team_id: None,
            derived_from: None,
        }
    }

    #[test]
    fn fresh_memory_scores_near_importance() {
        let m = mem("a", "learned", 4, 0, 0);
        let s = decay_score(&m, Utc::now());
        assert!((s - 4.0).abs() < 0.05, "fresh score should ≈ importance, got {s}");
    }

    #[test]
    fn one_half_life_halves_the_score() {
        let m = mem("a", "learned", 4, 60, 0); // learned half-life = 60d
        let s = decay_score(&m, Utc::now());
        assert!((s - 2.0).abs() < 0.1, "expected ~2.0 after one half-life, got {s}");
    }

    #[test]
    fn constraints_outlive_context() {
        let now = Utc::now();
        let constraint = mem("c", "constraint", 3, 90, 0);
        let context = mem("x", "context", 3, 90, 0);
        assert!(decay_score(&constraint, now) > decay_score(&context, now) * 2.0);
    }

    #[test]
    fn access_keeps_memories_alive() {
        let now = Utc::now();
        let mut hot = mem("h", "learned", 3, 120, 20);
        hot.last_accessed_at = Some((now - Duration::days(1)).to_rfc3339());
        let cold = mem("c", "learned", 3, 120, 0);
        // hot anchors age at last access (1d) + access boost; cold decays from creation
        assert!(decay_score(&hot, now) > decay_score(&cold, now) * 2.0);
    }

    #[test]
    fn pack_prefers_high_value_and_respects_budget() {
        let now = Utc::now();
        let fresh_important = mem("a", "constraint", 5, 1, 3);
        let stale_low = mem("b", "context", 2, 60, 0);
        let mid = mem("c", "learned", 3, 10, 1);
        let budget = entry_chars(&fresh_important) + entry_chars(&mid) + 10;
        let packed = pack_by_budget(vec![stale_low, mid, fresh_important], budget, now);
        let ids: Vec<&str> = packed.selected.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["a", "c"], "highest decayed value should win the budget");
        assert_eq!(packed.omitted, 1);
    }

    #[test]
    fn pack_always_admits_one_entry() {
        let m = mem("a", "fact", 3, 0, 0);
        let packed = pack_by_budget(vec![m], 1, Utc::now());
        assert_eq!(packed.selected.len(), 1);
        assert_eq!(packed.omitted, 0);
    }

    #[test]
    fn pack_skips_oversized_but_continues() {
        let now = Utc::now();
        let mut big = mem("big", "fact", 5, 0, 0);
        big.content = "x".repeat(5000);
        let small_a = mem("a", "fact", 4, 0, 0);
        let small_b = mem("b", "fact", 3, 0, 0);
        let budget = entry_chars(&small_a) + entry_chars(&small_b) + 10;
        // big scores highest and is admitted first (always-admit-one), then
        // smaller entries no longer fit. Flip: budget sized for smalls, big first.
        let packed = pack_by_budget(vec![small_a, big, small_b], budget, now);
        // big admitted as first entry (always ≥1), smalls skipped since big ate the budget
        assert_eq!(packed.selected.first().map(|m| m.id.as_str()), Some("big"));
    }

    // ── task-relevant recall: semantic blend (MEMORY CONTRACT (7)) ──────

    #[test]
    fn task_context_flattens_strings_and_skips_control_keys() {
        let input = serde_json::json!({
            "subject": "Invoice #123 overdue",
            "_use_case": {"id": "uc-1", "name": "hidden"},
            "count": 42,
            "items": [{"note": "second reminder"}, true]
        });
        let text = task_context_from_input(Some(&input));
        assert!(text.contains("Invoice #123 overdue"));
        assert!(text.contains("second reminder"));
        assert!(!text.contains("hidden"), "runner-internal _keys must be skipped");
        assert!(!text.contains("42"), "non-string scalars carry no signal");
        assert_eq!(task_context_from_input(None), "");
        // Cap: stays within 2000 bytes on a char boundary.
        let big = serde_json::json!({ "text": "é".repeat(3000) });
        let capped = task_context_from_input(Some(&big));
        assert!(capped.len() <= 2000);
        assert!(capped.is_char_boundary(capped.len()));
    }

    #[test]
    fn similarity_maps_distance_into_unit_range() {
        let max = crate::retrieval::MAX_VECTOR_DISTANCE;
        // identical → 1.0; at floor → 0.0; beyond floor → clamped 0.0.
        assert!((similarity_from_distance(0.0, max) - 1.0).abs() < 1e-6);
        assert!(similarity_from_distance(max, max).abs() < 1e-6);
        assert_eq!(similarity_from_distance(max + 0.5, max), 0.0);
        // halfway is monotonic and inside (0,1).
        let mid = similarity_from_distance(max / 2.0, max);
        assert!(mid > 0.0 && mid < 1.0);
    }

    #[test]
    fn blend_with_zero_similarity_is_a_noop() {
        // similarity 0 must reproduce the pure value score exactly, so an
        // un-embedded / off-topic memory ranks precisely as pack_by_budget's.
        let v = 3.7_f64;
        assert_eq!(blended_value(v, 0.0, DEFAULT_RELEVANCE_WEIGHT), v);
    }

    #[test]
    fn relevant_memory_outranks_higher_value_irrelevant_at_equal_importance() {
        let now = Utc::now();
        // Equal importance (3). `fresh` is off-topic (no relevance entry →
        // sim 0); `stale` is older (lower raw value) but strongly on-topic.
        // Relevance must reorder the on-topic one to the top WITHIN the band.
        let fresh_offtopic = mem("fresh", "learned", 3, 0, 0);
        let stale_ontopic = mem("stale", "learned", 3, 15, 0);
        // Sanity: value-only ranking prefers the fresher one.
        assert!(decay_score(&fresh_offtopic, now) > decay_score(&stale_ontopic, now));

        let mut rel = HashMap::new();
        rel.insert("stale".to_string(), 0.95);
        let budget = entry_chars(&fresh_offtopic) + entry_chars(&stale_ontopic) + 10;
        let packed = pack_by_budget_relevance(
            vec![fresh_offtopic, stale_ontopic],
            budget,
            now,
            &rel,
            DEFAULT_RELEVANCE_WEIGHT,
        );
        assert_eq!(
            packed.selected.first().map(|m| m.id.as_str()),
            Some("stale"),
            "on-topic memory should outrank the fresher off-topic one at equal importance"
        );
    }

    #[test]
    fn relevance_is_bounded_and_cannot_flip_a_wide_value_gap() {
        let now = Utc::now();
        // importance-5 fresh & irrelevant (value ≈ 5) vs importance-2 fresh &
        // fully on-topic (value ≈ 2, blended ≈ 2 × 1.6 = 3.2). The bounded
        // weight must NOT let relevance overtake the far-more-valuable memory.
        let high_value_offtopic = mem("high", "constraint", 5, 0, 0);
        let low_value_ontopic = mem("low", "constraint", 2, 0, 0);
        let mut rel = HashMap::new();
        rel.insert("low".to_string(), 1.0);
        let budget = entry_chars(&high_value_offtopic); // room for exactly one
        let packed = pack_by_budget_relevance(
            vec![low_value_ontopic, high_value_offtopic],
            budget,
            now,
            &rel,
            DEFAULT_RELEVANCE_WEIGHT,
        );
        assert_eq!(
            packed.selected.first().map(|m| m.id.as_str()),
            Some("high"),
            "importance must stay dominant across a wide value gap"
        );
    }

    #[test]
    fn empty_relevance_matches_value_only_pack() {
        let now = Utc::now();
        let a = mem("a", "constraint", 5, 1, 3);
        let b = mem("b", "context", 2, 60, 0);
        let c = mem("c", "learned", 3, 10, 1);
        let budget = entry_chars(&a) + entry_chars(&c) + 10;
        let value_only = pack_by_budget(vec![a.clone(), b.clone(), c.clone()], budget, now);
        let blended = pack_by_budget_relevance(
            vec![a, b, c],
            budget,
            now,
            &HashMap::new(),
            DEFAULT_RELEVANCE_WEIGHT,
        );
        let ids = |p: &PackedRecall| -> Vec<String> {
            p.selected.iter().map(|m| m.id.clone()).collect()
        };
        // With no similarity signal the relevance pack is the value-only pack.
        assert_eq!(ids(&value_only), ids(&blended));
        assert_eq!(value_only.omitted, blended.omitted);
    }

    #[test]
    fn forgetting_spares_young_important_and_core_paths() {
        let now = Utc::now();
        // young: below min age
        assert!(!should_forget(&mem("y", "context", 1, 5, 0), now));
        // important: exempt regardless of decay
        assert!(!should_forget(&mem("i", "context", 4, 400, 0), now));
        // stale low-importance context: forgotten
        assert!(should_forget(&mem("s", "context", 2, 90, 0), now));
        // durable constraint at same age: kept
        assert!(!should_forget(&mem("k", "constraint", 3, 90, 0), now));
    }
}
