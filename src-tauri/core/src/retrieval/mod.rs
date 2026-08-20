//! Unified retrieval lane — shared, pure retrieval primitives.
//!
//! Phase 1 of the retrieval unification: the mature retrieval mechanics that
//! grew up inside `companion::brain::retrieval` (vector-distance relevance
//! floor, hybrid per-kind lane ranking, excerpt-vs-full-body decision) are
//! extracted here so they can be tested in isolation and, later, consumed by
//! persona-memory injection (`db::repos::core::memories::get_for_injection_v2`)
//! without depending on companion types.
//!
//! Design constraints:
//! - **Pure.** No DB pool, no disk, no async, no companion/engine types in any
//!   signature — inputs are `(id, distance)` tuples, kind maps, and strings.
//!   This is what makes the primitives unit-testable and consumer-agnostic.
//! - **Feature-gate neutral.** Nothing here needs `ml`: the vector *search*
//!   stays with the caller (it is the part that needs an embedder); this
//!   module only post-processes scored hits. The module therefore compiles
//!   identically under `desktop` (lite) and `desktop-full`.
//! - **Behavior-preserving.** Every function is a verbatim extraction of the
//!   logic previously inlined in `companion/brain/retrieval.rs` /
//!   `companion/brain/episodic.rs`; the companion consumes these with zero
//!   behavior change.
//!
//! ## Seam: persona-memory injection (future phase)
//!
//! Persona memories (`persona_memories`) currently rank by the SQL formula in
//! MEMORY CONTRACT (6) with no semantic component. Once persona-memory
//! embeddings exist, `get_for_injection_v2` can join this lane with no new
//! machinery:
//!
//! 1. caller embeds the execution context / task prompt (ml-gated, its side),
//! 2. runs a KNN search over persona-memory embeddings → `Vec<(id, distance)>`,
//! 3. applies [`filter_by_distance_floor`] with [`MAX_VECTOR_DISTANCE`],
//! 4. buckets by tier via [`rank_into_lanes`] (kinds = tiers, caps = the
//!    existing core/active limits),
//! 5. merges with the SQL importance/recency ranking.
//!
//! Nothing in that flow requires changing this module — that is the seam.

use std::collections::{HashMap, HashSet};

/// Relevance floor for vector-matched recall. The companion embedding store is
/// L2 over fastembed-normalized 384-d MiniLM vectors, so distance maps to
/// cosine as `L2² = 2(1 − cos)`: ~1.0 ≈ cos 0.5 (related), ~1.41 ≈ orthogonal
/// (noise). Without this floor, retrieval was pure top-K-by-rank, so an
/// off-topic turn still got padded with the least-irrelevant rows — the
/// "mixing unrelated data" failure. Hits beyond this distance are dropped,
/// letting a lane return *empty* when nothing is actually close. Conservative
/// on purpose (keeps cos ≳ 0.15); calibrate against a populated brain via the
/// `recall_distance` debug log if it proves too loose/tight.
pub const MAX_VECTOR_DISTANCE: f32 = 1.30;

/// Byte cap used when persisting an episode `body_excerpt` (see
/// `companion::brain::episodic::excerpt_500`). Shared here because the
/// excerpt-vs-full-body decision ([`excerpt_holds_full_body`]) must agree with
/// the writer's cap.
pub const EPISODE_EXCERPT_CAP: usize = 500;

/// Drop hits whose distance exceeds `max_distance` (strictly greater — a hit
/// AT the floor is kept, matching the original inline `if dist > MAX` skip).
/// Preserves the input rank order of the survivors. Returns the kept hits and
/// the number dropped (the companion logs this as `dropped_far`).
pub fn filter_by_distance_floor(
    hits: &[(String, f32)],
    max_distance: f32,
) -> (Vec<(String, f32)>, usize) {
    let mut kept = Vec::with_capacity(hits.len());
    let mut dropped = 0usize;
    for (id, dist) in hits {
        if *dist > max_distance {
            dropped += 1;
        } else {
            kept.push((id.clone(), *dist));
        }
    }
    (kept, dropped)
}

/// Exclude KNN hits whose recorded embedding model is incompatible with the
/// currently-loaded embedder. `model_of` maps a hit id to the model name its
/// vector was written under; an id ABSENT from the map (legacy / unstamped) is
/// treated as current-compatible and KEPT.
///
/// The grandfathering is deliberate and load-bearing for "zero behavior change
/// at the current model": every pre-stamp vector was produced by whatever model
/// was current when it was written, and the app has only ever shipped one
/// embedder (`AllMiniLML6V2Q`), so an unstamped row IS a current-model row. A
/// STAMPED id whose model != `current_model` is dropped — a future embedder swap
/// leaves the old rows semantically incompatible even though they still share
/// the physical vec0 dimension (same 384-d width, different vector space), which
/// silent mixing would answer from the wrong neighbours rather than error.
///
/// Preserves the input rank order of the survivors. Returns
/// `(kept, excluded_count)`; the caller surfaces `excluded_count` (log + a
/// process counter) rather than hiding it.
#[cfg_attr(not(feature = "ml"), allow(dead_code))] // runtime callers (companion + memory KNN) are ml-gated; non-ml exercises via tests
pub fn filter_by_model(
    hits: &[(String, f32)],
    current_model: &str,
    model_of: &HashMap<String, String>,
) -> (Vec<(String, f32)>, usize) {
    let mut kept = Vec::with_capacity(hits.len());
    let mut excluded = 0usize;
    for (id, dist) in hits {
        match model_of.get(id) {
            Some(m) if m != current_model => excluded += 1,
            _ => kept.push((id.clone(), *dist)),
        }
    }
    (kept, excluded)
}

/// One per-kind selection lane for [`rank_into_lanes`]: collect up to `cap`
/// ids of `kind`, skipping anything already present in `exclude` (e.g. ids
/// surfaced by a recency query or an always-include list) and never selecting
/// the same id twice.
pub struct Lane<'a> {
    pub kind: &'a str,
    pub cap: usize,
    /// Ids already surfaced elsewhere — never re-selected by this lane.
    pub exclude: HashSet<String>,
    /// Output: selected ids in hit-rank order. At most `cap` entries.
    pub selected: Vec<String>,
}

impl<'a> Lane<'a> {
    pub fn new(kind: &'a str, cap: usize, exclude: HashSet<String>) -> Self {
        Self {
            kind,
            cap,
            exclude,
            selected: Vec::new(),
        }
    }
}

/// Hybrid lane ranking: walk `hits` in rank order, route each id to the lane
/// matching its kind (per `kind_of`), and let each lane collect up to its cap
/// while honoring its exclusion set. Ids with no kind entry, or a kind no lane
/// claims, are ignored (they ride their own dedicated scans — e.g. doctrine —
/// or don't ride the vector lane at all).
///
/// Verbatim extraction of the per-kind `match` loop previously inlined in
/// `companion::brain::retrieval::retrieve`. Selected ids are added to the
/// lane's exclusion set as they are picked, so duplicate hit ids can't be
/// selected twice.
pub fn rank_into_lanes(
    hits: &[(String, f32)],
    kind_of: &HashMap<String, String>,
    lanes: &mut [Lane<'_>],
) {
    for (id, _dist) in hits {
        let Some(kind) = kind_of.get(id) else {
            continue;
        };
        for lane in lanes.iter_mut() {
            if lane.kind == kind {
                if !lane.exclude.contains(id) && lane.selected.len() < lane.cap {
                    lane.selected.push(id.clone());
                    lane.exclude.insert(id.clone());
                }
                break;
            }
        }
    }
}

/// Excerpt-vs-full-body decision: does `body_excerpt` provably contain the
/// FULL original body?
///
/// The excerpt writer stores the body verbatim when `body.len() <= cap`, and
/// otherwise truncates to `cap` backing off up to 3 bytes to a UTF-8 char
/// boundary. A truncated excerpt therefore always has `len in (cap-4, cap]`,
/// so any excerpt with `len + 4 <= cap` is guaranteed complete. Excerpts in
/// the ambiguity window `(cap-4, cap]` might be either — we answer `false`
/// and let the caller hit disk (conservative: never serve a truncated body as
/// if it were whole).
pub fn excerpt_holds_full_body(body_excerpt: &str, cap: usize) -> bool {
    body_excerpt.len() + 4 <= cap
}

/// Reconstruct the episode body the DISK path would have produced, from a
/// complete `body_excerpt` (one for which [`excerpt_holds_full_body`] is
/// true). The disk path (`parse_episode_body`) returns
/// `frontmatter_body.trim_start()` — which strips the `\n\n` separator plus
/// any leading whitespace the original content had — and keeps the trailing
/// `\n` the episode writer appends after the content. Mirroring both keeps
/// the excerpt-served string byte-identical to the disk-served one (this is
/// a refactor-only lane; prompt bytes must not change).
pub fn episode_body_from_excerpt(body_excerpt: &str) -> String {
    format!("{}\n", body_excerpt.trim_start())
}

/// Recover an episode's role from its on-disk path. Episode files are written
/// as `episodes/<YYYY>/<MM>/<DD>/<id>_<role>.md` (see
/// `companion::brain::episodic::append_episode`), so the role is the segment
/// after the LAST underscore of the file stem. Returns `None` when the path
/// doesn't match that shape (caller falls back to reading the file's
/// frontmatter from disk).
pub fn role_from_episode_path(rel_path: &str) -> Option<&str> {
    let file_name = rel_path.rsplit(['/', '\\']).next()?;
    let stem = file_name.strip_suffix(".md")?;
    let (_, role) = stem.rsplit_once('_')?;
    if role.is_empty() {
        None
    } else {
        Some(role)
    }
}

/// Terms that carry no retrieval signal in an English question and would
/// otherwise OR-match a large fraction of the corpus. BM25 already discounts
/// high-document-frequency terms, so this list is about *keeping the MATCH
/// expression honest* (a query of pure stopwords must return NOTHING rather
/// than "the least irrelevant rows") — the same principle as the vector lane's
/// [`MAX_VECTOR_DISTANCE`] floor, applied to the keyword lane.
const FTS_STOPWORDS: &[&str] = &[
    "a", "about", "an", "and", "any", "are", "as", "at", "be", "been", "but", "by", "can", "did",
    "do", "does", "for", "from", "get", "had", "has", "have", "how", "i", "if", "in", "into", "is",
    "it", "its", "just", "me", "my", "no", "not", "of", "on", "or", "our", "out", "should", "so",
    "than", "that", "the", "their", "them", "then", "there", "these", "they", "this", "to", "up",
    "was", "we", "were", "what", "when", "where", "which", "who", "why", "will", "with", "would",
    "you", "your",
];

/// Minimum token length for the keyword lane. Two so short technical
/// identifiers ("ai", "ml", "db", "ts") survive; one-character noise does not.
const FTS_MIN_TERM_LEN: usize = 2;

/// Build a safe FTS5 `MATCH` expression from free-form user text.
///
/// Free-form text cannot be handed to FTS5 directly: `-`, `*`, `:`, `"`,
/// `NEAR`, `AND`/`OR`/`NOT` and unbalanced quotes are all *operators* in the
/// FTS5 query grammar, so a natural-language question either errors out or
/// silently means something other than what the user typed. This tokenizes to
/// alphanumeric runs, drops stopwords and 1-char noise, dedupes, and quotes
/// every surviving term so each is matched as a literal — then ORs them so
/// partial matches still rank (BM25 orders by how many, and how rare, matched).
///
/// Returns an EMPTY string when nothing survives; callers must treat that as
/// "no keyword lane this turn" rather than passing it to `MATCH` (an empty
/// MATCH expression is a syntax error in FTS5).
///
/// Two private forks of this shape already existed in the codebase
/// (`db::repos::execution::executions` and `commands::credentials::vector_kb`);
/// this is the unified-lane home for the pattern. Those two are untouched for
/// now — consolidating them is a separate, behavior-visible change.
pub fn build_fts5_match_query(query: &str, max_terms: usize) -> String {
    let mut seen: HashSet<String> = HashSet::new();
    let mut terms: Vec<String> = Vec::new();
    for raw in query.split(|c: char| !c.is_alphanumeric()) {
        if terms.len() >= max_terms {
            break;
        }
        let token = raw.to_lowercase();
        if token.len() < FTS_MIN_TERM_LEN {
            continue;
        }
        if FTS_STOPWORDS.contains(&token.as_str()) {
            continue;
        }
        if !seen.insert(token.clone()) {
            continue;
        }
        // Tokens are alphanumeric-only by construction, so the quote escape is
        // belt-and-suspenders — kept so the function stays correct if the
        // tokenizer is ever loosened.
        terms.push(format!("\"{}\"", token.replace('"', "\"\"")));
    }
    terms.join(" OR ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hits(pairs: &[(&str, f32)]) -> Vec<(String, f32)> {
        pairs.iter().map(|(id, d)| (id.to_string(), *d)).collect()
    }

    // ── distance floor ──────────────────────────────────────────────────

    #[test]
    fn distance_floor_drops_far_hits_and_counts_them() {
        let input = hits(&[("a", 0.4), ("b", 1.31), ("c", 1.0), ("d", 2.0)]);
        let (kept, dropped) = filter_by_distance_floor(&input, MAX_VECTOR_DISTANCE);
        assert_eq!(
            kept.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
            vec!["a", "c"]
        );
        assert_eq!(dropped, 2);
    }

    #[test]
    fn distance_floor_keeps_hit_exactly_at_floor() {
        // Original inline logic skipped only `dist > MAX` — equality is kept.
        let input = hits(&[("edge", MAX_VECTOR_DISTANCE)]);
        let (kept, dropped) = filter_by_distance_floor(&input, MAX_VECTOR_DISTANCE);
        assert_eq!(kept.len(), 1);
        assert_eq!(dropped, 0);
    }

    #[test]
    fn distance_floor_preserves_rank_order() {
        let input = hits(&[("z", 0.9), ("a", 0.1), ("m", 0.5)]);
        let (kept, _) = filter_by_distance_floor(&input, MAX_VECTOR_DISTANCE);
        // NOT re-sorted by distance: rank order in == rank order out.
        assert_eq!(
            kept.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
            vec!["z", "a", "m"]
        );
    }

    #[test]
    fn distance_floor_can_empty_a_lane() {
        // The point of the floor: off-topic turns produce NOTHING instead of
        // being padded with the least-irrelevant rows.
        let input = hits(&[("x", 1.38), ("y", 1.41)]);
        let (kept, dropped) = filter_by_distance_floor(&input, MAX_VECTOR_DISTANCE);
        assert!(kept.is_empty());
        assert_eq!(dropped, 2);
    }

    // ── model guard (shared-corpus mismatch) ────────────────────────────

    fn model_map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(id, m)| (id.to_string(), m.to_string()))
            .collect()
    }

    #[test]
    fn model_guard_is_inert_when_all_stamps_match_or_are_absent() {
        // Every hit is either stamped with the current model or unstamped
        // (legacy). Nothing is excluded — this is the "zero behavior change at
        // the current model" guarantee.
        let input = hits(&[("a", 0.1), ("b", 0.2), ("c", 0.3)]);
        let stamps = model_map(&[("a", "AllMiniLML6V2Q"), ("b", "AllMiniLML6V2Q")]);
        // "c" is absent → grandfathered as current.
        let (kept, excluded) = filter_by_model(&input, "AllMiniLML6V2Q", &stamps);
        assert_eq!(excluded, 0);
        assert_eq!(
            kept.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
            vec!["a", "b", "c"]
        );
    }

    #[test]
    fn model_guard_excludes_mismatched_and_counts_them() {
        let input = hits(&[("a", 0.1), ("stale", 0.2), ("c", 0.3)]);
        // "stale" was embedded with a since-swapped model.
        let stamps = model_map(&[
            ("a", "AllMiniLML6V2Q"),
            ("stale", "BGESmallENV15"),
            ("c", "AllMiniLML6V2Q"),
        ]);
        let (kept, excluded) = filter_by_model(&input, "AllMiniLML6V2Q", &stamps);
        assert_eq!(excluded, 1);
        assert_eq!(
            kept.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
            vec!["a", "c"],
            "mismatched vector dropped; survivors keep rank order"
        );
    }

    // ── hybrid lane ranking ─────────────────────────────────────────────

    fn kind_map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(id, k)| (id.to_string(), k.to_string()))
            .collect()
    }

    #[test]
    fn lanes_route_by_kind_and_respect_caps() {
        let input = hits(&[
            ("e1", 0.1),
            ("f1", 0.2),
            ("e2", 0.3),
            ("e3", 0.4),
            ("f2", 0.5),
        ]);
        let kinds = kind_map(&[
            ("e1", "episode"),
            ("e2", "episode"),
            ("e3", "episode"),
            ("f1", "fact"),
            ("f2", "fact"),
        ]);
        let mut lanes = [
            Lane::new("episode", 2, HashSet::new()),
            Lane::new("fact", 10, HashSet::new()),
        ];
        rank_into_lanes(&input, &kinds, &mut lanes);
        // Episode lane capped at 2, in rank order; e3 overflowed.
        assert_eq!(lanes[0].selected, vec!["e1", "e2"]);
        assert_eq!(lanes[1].selected, vec!["f1", "f2"]);
    }

    #[test]
    fn lanes_honor_exclusion_sets() {
        let input = hits(&[("e1", 0.1), ("e2", 0.2)]);
        let kinds = kind_map(&[("e1", "episode"), ("e2", "episode")]);
        let exclude: HashSet<String> = ["e1".to_string()].into_iter().collect();
        let mut lanes = [Lane::new("episode", 10, exclude)];
        rank_into_lanes(&input, &kinds, &mut lanes);
        // e1 was already surfaced by recency — not re-selected.
        assert_eq!(lanes[0].selected, vec!["e2"]);
    }

    #[test]
    fn lanes_ignore_unknown_and_unclaimed_kinds() {
        let input = hits(&[("d1", 0.1), ("g1", 0.2), ("orphan", 0.3), ("e1", 0.4)]);
        let mut kinds = kind_map(&[("d1", "doctrine"), ("g1", "goal"), ("e1", "episode")]);
        kinds.remove("orphan"); // no kind entry at all
        let mut lanes = [Lane::new("episode", 10, HashSet::new())];
        rank_into_lanes(&input, &kinds, &mut lanes);
        // Doctrine rides its own kind-scoped scan; goals don't ride the
        // vector lane; unknown ids are skipped.
        assert_eq!(lanes[0].selected, vec!["e1"]);
    }

    #[test]
    fn lanes_never_select_duplicate_ids() {
        let input = hits(&[("e1", 0.1), ("e1", 0.15), ("e2", 0.2)]);
        let kinds = kind_map(&[("e1", "episode"), ("e2", "episode")]);
        let mut lanes = [Lane::new("episode", 10, HashSet::new())];
        rank_into_lanes(&input, &kinds, &mut lanes);
        assert_eq!(lanes[0].selected, vec!["e1", "e2"]);
    }

    // ── excerpt-vs-full-body decision ───────────────────────────────────

    #[test]
    fn short_excerpt_is_provably_complete() {
        assert!(excerpt_holds_full_body("short body", EPISODE_EXCERPT_CAP));
        let at_boundary = "x".repeat(EPISODE_EXCERPT_CAP - 4);
        assert!(excerpt_holds_full_body(&at_boundary, EPISODE_EXCERPT_CAP));
    }

    #[test]
    fn ambiguous_and_full_length_excerpts_are_not_trusted() {
        // (cap-4, cap] is the char-boundary-backoff ambiguity window: a
        // truncated 501+-byte body can land anywhere in it, so it must go to
        // disk even though a genuinely short body could also produce it.
        for len in (EPISODE_EXCERPT_CAP - 3)..=EPISODE_EXCERPT_CAP {
            let excerpt = "x".repeat(len);
            assert!(
                !excerpt_holds_full_body(&excerpt, EPISODE_EXCERPT_CAP),
                "len {len} must not be trusted as complete"
            );
        }
    }

    #[test]
    fn excerpt_body_matches_disk_parse_shape() {
        // Disk parse = trim_start + writer-appended trailing newline.
        assert_eq!(episode_body_from_excerpt("hello world"), "hello world\n");
        assert_eq!(episode_body_from_excerpt("  padded"), "padded\n");
        assert_eq!(episode_body_from_excerpt("ends\n"), "ends\n\n");
    }

    // ── role from episode path ──────────────────────────────────────────

    #[test]
    fn role_parses_from_standard_episode_path() {
        assert_eq!(
            role_from_episode_path("episodes/2026/07/10/ep_ab12cd34_user.md"),
            Some("user")
        );
        assert_eq!(
            role_from_episode_path("episodes/2026/07/10/ep_ab12cd34_assistant.md"),
            Some("assistant")
        );
    }

    #[test]
    fn role_parse_rejects_nonconforming_paths() {
        assert_eq!(role_from_episode_path("episodes/2026/07/10/noext"), None);
        assert_eq!(
            role_from_episode_path("episodes/2026/07/10/norole.md"),
            None
        );
        assert_eq!(
            role_from_episode_path("episodes/2026/07/10/trailing_.md"),
            None
        );
    }

    // ── FTS5 match-expression builder ───────────────────────────────────

    #[test]
    fn fts_query_quotes_every_term_and_ors_them() {
        assert_eq!(
            build_fts5_match_query("memory decay policy", 12),
            "\"memory\" OR \"decay\" OR \"policy\""
        );
    }

    #[test]
    fn fts_query_neutralizes_fts5_operators_in_free_text() {
        // `-`, `*`, `:`, `"` and NEAR are FTS5 grammar. All must arrive as
        // ordinary quoted literals, never as operators.
        let q = build_fts5_match_query("what's the fleet-event NEAR \"state:idle\" *", 12);
        assert!(!q.contains('*'), "no bare wildcard: {q}");
        assert!(!q.contains(':'), "no bare column filter: {q}");
        assert!(q.contains("\"fleet\""), "hyphen split into terms: {q}");
        assert!(q.contains("\"event\""), "hyphen split into terms: {q}");
        assert!(
            q.contains("\"near\""),
            "NEAR is a literal, not an operator: {q}"
        );
        assert!(q.contains("\"idle\""), "colon split into terms: {q}");
        // "what" and "the" are stopwords; the apostrophe splits "what's".
        assert!(!q.contains("\"the\""), "stopword dropped: {q}");
    }

    #[test]
    fn fts_query_is_empty_when_only_noise_survives() {
        // A pure-stopword question must produce NO keyword lane rather than a
        // MATCH that pulls the least-irrelevant rows. Empty is the signal.
        assert_eq!(
            build_fts5_match_query("what is it? and so, they are", 12),
            ""
        );
        assert_eq!(build_fts5_match_query("", 12), "");
        assert_eq!(build_fts5_match_query("!!! ??? ...", 12), "");
        assert_eq!(
            build_fts5_match_query("a i x", 12),
            "",
            "1-char noise dropped"
        );
    }

    #[test]
    fn fts_query_dedupes_and_caps_terms() {
        assert_eq!(
            build_fts5_match_query("recall recall RECALL", 12),
            "\"recall\"",
            "case-folded dedupe"
        );
        let q = build_fts5_match_query("alpha beta gamma delta epsilon", 3);
        assert_eq!(q.matches(" OR ").count(), 2, "capped at 3 terms: {q}");
    }

    #[test]
    fn fts_query_keeps_short_technical_identifiers() {
        let q = build_fts5_match_query("how do I wire ml and db", 12);
        assert!(q.contains("\"ml\""), "{q}");
        assert!(q.contains("\"db\""), "{q}");
        assert!(q.contains("\"wire\""), "{q}");
    }
}
