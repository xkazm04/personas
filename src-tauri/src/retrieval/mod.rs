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
        assert_eq!(role_from_episode_path("episodes/2026/07/10/norole.md"), None);
        assert_eq!(role_from_episode_path("episodes/2026/07/10/trailing_.md"), None);
    }
}
