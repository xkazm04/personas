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

use chrono::{DateTime, Utc};

use crate::db::models::PersonaMemory;
use crate::db::repos::core::memories as repo;
use crate::db::DbPool;
use crate::error::AppError;

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
