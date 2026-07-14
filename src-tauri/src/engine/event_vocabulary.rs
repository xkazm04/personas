//! Event-type vocabulary registry.
//!
//! `persona_events.event_type` is a free-form, LLM-emitted string. A subscription
//! or trigger listening for a *typo'd* type silently never matches — forever. The
//! canonical matcher in [`crate::engine::bus`] only reconciles separator style
//! (`code_review.completed` ≡ `code-review.completed`); it cannot rescue an
//! actual misspelling (`code_reveiw.completed`) or a semantically-wrong name.
//!
//! This module is a **known-vocabulary registry**: it does NOT change the column
//! type (still a string) and NEVER rejects a publish. It provides:
//!
//! 1. A curated seed of well-known bus event types ([`BUILTIN_EVENT_TYPES`]) —
//!    a discovery aid, not an exhaustive contract.
//! 2. Publish-time validation ([`validate_and_warn`]): an unknown type logs a
//!    `tracing::warn` with the nearest canonical suggestion, so a typo surfaces
//!    in observability instead of vanishing.
//! 3. A merged live vocabulary ([`list_vocabulary`]) = curated seed ∪ types
//!    actually observed in the DB, consumed by the events UI type filter and
//!    available for trigger/listener creation.

use std::collections::HashSet;
use std::sync::OnceLock;

use rusqlite::params;

use crate::db::repos::utils::collect_rows;
use crate::db::DbPool;
use crate::engine::bus::canonical_event_type;
use crate::error::AppError;

/// Provenance token: shipped in the curated seed.
pub const SOURCE_BUILTIN: &str = "builtin";
/// Provenance token: discovered from a real `persona_events` row, not seeded.
pub const SOURCE_OBSERVED: &str = "observed";

/// A single entry in the event-type vocabulary surfaced to the frontend
/// (type filter + trigger/listener creation).
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EventVocabularyEntry {
    /// The event type exactly as it should be emitted / matched.
    pub event_type: String,
    /// Loose grouping for UI organization (e.g. `execution`, `review`).
    pub category: String,
    /// `builtin` (curated seed) or `observed` (seen in the DB only).
    pub source: String,
}

/// Curated seed of well-known bus event types, each tagged with a loose
/// category. This is intentionally NOT exhaustive — the fleet emits arbitrary
/// LLM-authored types — but it captures the stable, code-referenced vocabulary
/// so the nearest-suggestion heuristic has a high-signal target set and the UI
/// has sensible defaults before any event has ever been published.
///
/// Sources: `engine::event_registry` (bus-published names), `engine::dispatch`
/// orchestration verdicts, `engine::failover` circuit-breaker signals, and the
/// dev-seed templates in `commands::communication::mock_seed`.
const BUILTIN_EVENT_TYPES: &[(&str, &str)] = &[
    // Execution lifecycle
    ("execution.queued", "execution"),
    ("execution.stage", "execution"),
    ("execution.finished", "execution"),
    ("execution.failed", "execution"),
    ("execution_completed", "execution"),
    // Review / approval
    ("code_review.completed", "review"),
    ("ux_review.completed", "review"),
    ("review_submitted", "review"),
    ("review_decision.approved", "review"),
    ("review_decision.rejected", "review"),
    ("review_decision.resolved", "review"),
    // Team orchestration verdicts
    ("qa.pr.approved", "orchestration"),
    ("qa.pr.changes_requested", "orchestration"),
    ("goal.progress", "orchestration"),
    ("incident_resolved", "orchestration"),
    // Trading / signal (representative recipe contract)
    ("stock.signal.buy", "signal"),
    ("stock.signal.sell", "signal"),
    ("stock.signal.strong_buy", "signal"),
    // Build session
    ("build.completed", "build"),
    ("build_complete", "build"),
    // Healing / reliability
    ("health_check_failed", "healing"),
    ("auto_rollback", "healing"),
    ("circuit_breaker.global.opened", "healing"),
    ("circuit_breaker.global.closed", "healing"),
    ("circuit_breaker.provider.opened", "healing"),
    ("circuit_breaker.provider.closed", "healing"),
    ("circuit_breaker.provider.half_open", "healing"),
    // Credentials
    ("credential_rotated", "credential"),
    ("credential_rotation", "credential"),
    // Deployment
    ("deployment_started", "deployment"),
    ("deploy_started", "deployment"),
    ("prompt_deployment", "deployment"),
    // Memory / knowledge
    ("memory_created", "memory"),
    // Digest / calendar
    ("email.digest.ready", "digest"),
    ("email.digest.published", "digest"),
    ("email.digest.error", "digest"),
    ("calendar.day.start", "digest"),
    // Dev tools
    ("dev_tools.context_scan_started", "dev_tools"),
    ("dev_tools.context_scan_completed", "dev_tools"),
    // Ingress / triggers
    ("webhook_received", "ingress"),
    ("trigger_fired", "ingress"),
    ("file_changed", "ingress"),
    ("context_rule_match", "ingress"),
];

/// Lazily-built set of the *canonical* forms of every builtin type, for O(1)
/// known-type checks that ignore separator style.
fn canonical_builtins() -> &'static HashSet<String> {
    static SET: OnceLock<HashSet<String>> = OnceLock::new();
    SET.get_or_init(|| {
        BUILTIN_EVENT_TYPES
            .iter()
            .map(|(name, _)| canonical_event_type(name))
            .collect()
    })
}

/// Whether `event_type` matches a curated builtin type, separator-insensitively.
pub fn is_known_builtin(event_type: &str) -> bool {
    canonical_builtins().contains(&canonical_event_type(event_type))
}

/// Case/insertion/deletion-tolerant edit distance (Levenshtein) between two
/// already-canonicalized strings. Bounded input (event types ≤ 128 chars) so
/// the O(n·m) table is cheap.
fn edit_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.is_empty() {
        return b.len();
    }
    if b.is_empty() {
        return a.len();
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0usize; b.len() + 1];
    for (i, ca) in a.iter().enumerate() {
        cur[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let cost = if ca == cb { 0 } else { 1 };
            cur[j + 1] = (prev[j + 1] + 1).min(cur[j] + 1).min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

/// The nearest curated builtin to `candidate`, if one is "close enough" to be a
/// plausible typo. Returns the builtin in its canonical seed spelling. The
/// threshold scales with length so short names need a near-exact match while
/// longer ones tolerate a couple of edits — this avoids suggesting a wildly
/// different type for a genuinely new event name.
pub fn nearest_builtin(candidate: &str) -> Option<String> {
    let canon = canonical_event_type(candidate);
    if canon.is_empty() {
        return None;
    }
    // Allow up to ~1 edit per 5 chars, capped at 3; always at least 1.
    let threshold = (canon.len() / 5).clamp(1, 3);
    let mut best: Option<(usize, &str)> = None;
    for (name, _) in BUILTIN_EVENT_TYPES {
        let d = edit_distance(&canon, &canonical_event_type(name));
        if d == 0 {
            return None; // exact canonical match — not unknown
        }
        if d <= threshold && best.map(|(bd, _)| d < bd).unwrap_or(true) {
            best = Some((d, name));
        }
    }
    best.map(|(_, name)| name.to_string())
}

/// Publish-time validation. NEVER rejects — an unknown type only emits a
/// `tracing::warn`. If a near builtin exists, the warning names it as the most
/// likely intended type so a typo is actionable in logs instead of silently
/// starving every listener.
pub fn validate_and_warn(event_type: &str) {
    if is_known_builtin(event_type) {
        return;
    }
    match nearest_builtin(event_type) {
        Some(suggestion) => tracing::warn!(
            event_type = %event_type,
            suggestion = %suggestion,
            "Publishing an event_type not in the known vocabulary; nearest known type is '{}'. \
             Listeners match on (canonical) type equality, so a typo here silently never fires — \
             verify this is intentional.",
            suggestion
        ),
        None => tracing::warn!(
            event_type = %event_type,
            "Publishing an event_type not in the known vocabulary (no near match). If this is a \
             new event type that's fine; if it's a typo, subscribers will silently never match it."
        ),
    }
}

/// The curated seed as vocabulary entries (no DB access).
pub fn builtin_vocabulary() -> Vec<EventVocabularyEntry> {
    BUILTIN_EVENT_TYPES
        .iter()
        .map(|(name, category)| EventVocabularyEntry {
            event_type: (*name).to_string(),
            category: (*category).to_string(),
            source: SOURCE_BUILTIN.to_string(),
        })
        .collect()
}

/// The full live vocabulary: curated seed ∪ distinct types actually observed in
/// `persona_events`. Observed types whose canonical form already appears in the
/// seed are folded into the builtin entry (not duplicated); genuinely new
/// observed types are appended with `source = observed` and an `unknown`
/// category. Sorted by category then name for stable UI rendering.
pub fn list_vocabulary(pool: &DbPool) -> Result<Vec<EventVocabularyEntry>, AppError> {
    let mut entries = builtin_vocabulary();
    let seen_canonical: HashSet<String> = entries
        .iter()
        .map(|e| canonical_event_type(&e.event_type))
        .collect();

    let conn = pool.get()?;
    let mut stmt = conn.prepare_cached(
        "SELECT DISTINCT event_type FROM persona_events
         WHERE event_type IS NOT NULL AND event_type <> ''",
    )?;
    let rows = stmt.query_map(params![], |row| row.get::<_, String>(0))?;
    let observed = collect_rows(rows, "event_vocabulary::list_vocabulary");

    let mut extra_seen: HashSet<String> = HashSet::new();
    for ev in observed {
        let canon = canonical_event_type(&ev);
        if canon.is_empty() || seen_canonical.contains(&canon) || !extra_seen.insert(canon) {
            continue;
        }
        entries.push(EventVocabularyEntry {
            event_type: ev,
            category: "unknown".to_string(),
            source: SOURCE_OBSERVED.to_string(),
        });
    }

    entries.sort_by(|a, b| {
        a.category
            .cmp(&b.category)
            .then_with(|| a.event_type.cmp(&b.event_type))
    });
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_builtin_is_separator_insensitive() {
        assert!(is_known_builtin("code_review.completed"));
        assert!(is_known_builtin("code-review-completed"));
        assert!(is_known_builtin("code.review.completed"));
        assert!(!is_known_builtin("totally_made_up.event"));
    }

    #[test]
    fn nearest_builtin_catches_a_typo() {
        // one transposition/substitution away from code_review.completed
        assert_eq!(
            nearest_builtin("code_review.completd").as_deref(),
            Some("code_review.completed")
        );
        // separator variant is an exact canonical match → not "unknown"
        assert_eq!(nearest_builtin("code-review.completed"), None);
    }

    #[test]
    fn nearest_builtin_ignores_genuinely_new_types() {
        // A long, distinct new event should not be coerced to a seed entry.
        assert_eq!(nearest_builtin("payments.invoice.reconciled"), None);
    }

    #[test]
    fn validate_and_warn_never_panics_on_edge_input() {
        validate_and_warn("");
        validate_and_warn("a");
        validate_and_warn("execution.queued");
        validate_and_warn("execution.queeud");
    }

    #[test]
    fn builtin_canonical_forms_are_unique() {
        // Guards against two seed entries collapsing to the same canonical form,
        // which would make one unreachable as a distinct suggestion.
        let mut set = HashSet::new();
        for (name, _) in BUILTIN_EVENT_TYPES {
            assert!(
                set.insert(canonical_event_type(name)),
                "duplicate canonical builtin: {name}"
            );
        }
    }
}
