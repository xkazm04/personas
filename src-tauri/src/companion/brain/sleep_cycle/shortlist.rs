//! The deterministic prefilter in front of the reconcile leg.
//!
//! Before anything can be judged a duplicate or a contradiction, the entries it
//! might duplicate have to be *found*, and that step is cheap, deterministic and
//! does two jobs the expensive judgement cannot do for itself.
//!
//! **It bounds the prompt independently of the store.** The leg used to receive
//! the whole active fact set, capped at a couple of hundred entries. That is a
//! truncation, not a shortlist: the prompt grew with the store until the cap,
//! and a fixed leg timeout then started failing exactly as memory began to pay
//! off. Replayed over a simulated year, the reconcile prompt went from ~3k
//! characters at forty facts to ~33k, and 31 of 102 cycles died on the timeout.
//! A shortlist drawn per new fact costs the same at forty facts as at forty
//! thousand.
//!
//! **And it closes the coverage hole the truncation opened.** The old cap took
//! the top entries by importance then recency, so once the store passed the cap
//! the tail below it was never a candidate again — a duplicate that settled
//! there could never be retired, and nothing counted the miss. Here the seeds
//! are the facts this cycle actually wrote, plus a small rotating window that
//! advances every cycle, so every fact is revisited on a schedule rather than
//! never.
//!
//! The measure is directional on purpose. A correction is short and sharp ("we
//! moved off the shared credential") and the belief it overturns is elaborated;
//! a similarity normalised by the combined size of both texts punishes that
//! pairing for the length difference alone, which is precisely the pairing the
//! cycle most needs to catch. Normalising by the *smaller* side does not.

use std::collections::HashSet;

use super::super::procedural::Procedural;
use super::super::semantic::Fact;

/// What the prefilter needs from a memory to shortlist it, so facts and
/// procedural rules go through one implementation.
///
/// Both tiers are governed by the same leg for a reason the store made
/// obvious: a retired fact and the rule distilled from the same sentence are
/// the same belief, and retiring one while the other keeps full standing is
/// how a value the user changed comes back with more authority than it ever
/// had.
pub(super) trait Shortlistable {
    fn id(&self) -> &str;
    fn scope(&self) -> &str;
    /// The stable name of the thing this memory is about.
    fn subject(&self) -> &str;
    /// What it says about that subject.
    fn claim(&self) -> &str;
}

impl Shortlistable for Fact {
    fn id(&self) -> &str {
        &self.id
    }
    fn scope(&self) -> &str {
        &self.scope
    }
    fn subject(&self) -> &str {
        &self.key
    }
    fn claim(&self) -> &str {
        &self.value
    }
}

impl Shortlistable for Procedural {
    fn id(&self) -> &str {
        &self.id
    }
    fn scope(&self) -> &str {
        &self.scope
    }
    /// A rule's subject is its trigger: two rules that fire on the same
    /// situation are candidates to be the same rule, whatever they then do.
    fn subject(&self) -> &str {
        &self.trigger
    }
    fn claim(&self) -> &str {
        &self.behavior
    }
}

/// Tokens too common to carry a signal; matching on them makes every fact look
/// like every other fact, which is the failure mode a lexical prefilter has.
const STOPWORDS: &[&str] = &[
    "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "has", "have",
    "had", "will", "our", "their", "its", "into", "onto", "not", "but", "all", "any", "use",
    "uses", "used", "using", "now", "new", "old", "one", "two", "per", "via", "get", "set",
];

fn is_wordish(c: char) -> bool {
    c.is_alphanumeric()
}

/// Lowercase word tokens of length >= 3, stopwords removed. `_` and `-` split,
/// because this store spells keys as `quill_framework` and the project name is
/// the most discriminating token in it.
pub(super) fn tokens(text: &str) -> HashSet<String> {
    text.split(|c: char| !is_wordish(c))
        .filter(|w| w.len() >= 3)
        .map(|w| w.to_ascii_lowercase())
        .filter(|w| !STOPWORDS.contains(&w.as_str()))
        .collect()
}

/// Overlap normalised by the SMALLER side. A short correction scores high
/// against the long belief it corrects; Jaccard would score that pair near zero
/// for the length difference alone.
pub(super) fn directional_overlap(a: &HashSet<String>, b: &HashSet<String>) -> f32 {
    let smaller = a.len().min(b.len());
    if smaller == 0 {
        return 0.0;
    }
    a.intersection(b).count() as f32 / smaller as f32
}

/// One seed and the few existing memories it might duplicate or contradict.
pub(super) struct Group<'a, T> {
    pub(super) seed: &'a T,
    pub(super) candidates: Vec<&'a T>,
}

/// Rank `pool` against `seed` and keep the best `k`.
///
/// An identical subject in the same scope is the strongest duplicate signal
/// this store has — two rows agreeing on `quill_framework`, or two rules with
/// the same trigger, are about the same thing by construction — so it is
/// scored as a certainty rather than left to token overlap, which would rank a
/// long shared body above it.
pub(super) fn candidates_for<'a, T: Shortlistable>(
    seed: &T,
    pool: &[&'a T],
    k: usize,
) -> Vec<&'a T> {
    let seed_tokens = tokens(&format!("{} {}", seed.subject(), seed.claim()));
    let mut scored: Vec<(f32, &'a T)> = pool
        .iter()
        .filter(|f| f.id() != seed.id() && f.scope() == seed.scope())
        .map(|f| {
            let score = if f.subject() == seed.subject() {
                1.0
            } else {
                directional_overlap(
                    &seed_tokens,
                    &tokens(&format!("{} {}", f.subject(), f.claim())),
                )
            };
            (score, *f)
        })
        .filter(|(score, _)| *score > 0.0)
        .collect();
    // ties break on id so the shortlist is reproducible across runs: two
    // memories written in the same second must not swap places between replays
    scored.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.1.id().cmp(b.1.id()))
    });
    scored.into_iter().take(k).map(|(_, f)| f).collect()
}

/// Seeds plus their shortlists, for one tier. `written` is what this cycle
/// wrote; the sweep adds a window that advances every cycle so the quiet tail
/// is revisited on a schedule rather than never.
pub(super) fn groups_for<'a, T: Shortlistable>(
    pool: &'a [T],
    written: &[String],
    max_seeds: usize,
    sweep_width: usize,
    cycle_index: usize,
    candidates: usize,
) -> Vec<Group<'a, T>> {
    let refs: Vec<&T> = pool.iter().collect();
    let mut seed_ids: Vec<&str> = written
        .iter()
        .map(|s| s.as_str())
        .filter(|id| pool.iter().any(|f| f.id() == *id))
        .take(max_seeds)
        .collect();
    for i in sweep_window(pool.len(), cycle_index, sweep_width) {
        let id = pool[i].id();
        if !seed_ids.contains(&id) {
            seed_ids.push(id);
        }
    }
    seed_ids
        .into_iter()
        .filter_map(|id| pool.iter().find(|f| f.id() == id))
        .map(|seed| Group {
            seed,
            candidates: candidates_for(seed, &refs, candidates),
        })
        .filter(|g| !g.candidates.is_empty())
        .collect()
}

/// The rotating window that keeps the store swept.
///
/// `cycle_index` advances by one per completed cycle, so consecutive cycles
/// take adjacent windows and the whole store is covered in `len / width`
/// cycles at constant per-cycle cost. It wraps, and it is derived from a
/// counter rather than from the clock so a replay at any date picks the same
/// window.
pub(super) fn sweep_window(len: usize, cycle_index: usize, width: usize) -> Vec<usize> {
    if len == 0 || width == 0 {
        return Vec::new();
    }
    let width = width.min(len);
    let start = (cycle_index.wrapping_mul(width)) % len;
    (0..width).map(|i| (start + i) % len).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fact(id: &str, scope: &str, key: &str, value: &str) -> Fact {
        Fact {
            id: id.to_string(),
            scope: scope.to_string(),
            key: key.to_string(),
            value: value.to_string(),
            importance: 3,
            confidence: 0.8,
            sources: vec!["ep_1".to_string()],
            supersedes_id: None,
            contradicts_id: None,
            updated_at: "2025-01-01T00:00:00+00:00".to_string(),
        }
    }

    #[test]
    fn a_short_correction_outranks_a_long_unrelated_neighbour() {
        // the pairing the cycle most needs to catch is the one a symmetric
        // measure punishes: three words against forty
        let seed = fact(
            "f_new",
            "project",
            "quill_deploy",
            "deploys from a Hetzner box",
        );
        let long = fact(
            "f_long",
            "project",
            "quill_notes",
            "deploys are discussed weekly and the team keeps a long changelog about \
             hosting, boxes, providers, regions, budgets and every migration ever \
             considered including Hetzner",
        );
        let seed_t = tokens(&format!("{} {}", seed.key, seed.value));
        let long_t = tokens(&format!("{} {}", long.key, long.value));
        let directional = directional_overlap(&seed_t, &long_t);
        let jaccard =
            seed_t.intersection(&long_t).count() as f32 / seed_t.union(&long_t).count() as f32;
        assert!(
            directional > jaccard * 2.0,
            "directional {directional} should dominate jaccard {jaccard}"
        );
    }

    #[test]
    fn an_identical_key_in_the_same_scope_is_always_a_candidate() {
        let seed = fact("f_new", "project", "quill_framework", "FastAPI");
        let same_key = fact("f_old", "project", "quill_framework", "Django");
        let wordy = fact(
            "f_wordy",
            "project",
            "quill_stack",
            "FastAPI is the framework we discussed for quill at length",
        );
        let pool = vec![&same_key, &wordy];
        let picked = candidates_for(&seed, &pool, 1);
        assert_eq!(picked.len(), 1);
        assert_eq!(
            picked[0].id, "f_old",
            "the row that shares the key must outrank the row that shares words"
        );
    }

    #[test]
    fn another_scope_is_never_a_candidate() {
        let seed = fact("f_new", "project", "standup_time", "09:30");
        let other = fact("f_user", "user", "standup_time", "09:00");
        let pool = vec![&other];
        assert!(candidates_for(&seed, &pool, 4).is_empty());
    }

    #[test]
    fn the_shortlist_size_does_not_grow_with_the_store() {
        let seed = fact("f_new", "project", "quill_framework", "FastAPI");
        let mut owned = Vec::new();
        for i in 0..500 {
            owned.push(fact(
                &format!("f_{i:03}"),
                "project",
                &format!("quill_topic_{i}"),
                "quill framework related chatter",
            ));
        }
        let pool: Vec<&Fact> = owned.iter().collect();
        assert_eq!(candidates_for(&seed, &pool, 4).len(), 4);
    }

    fn rule(id: &str, scope: &str, trigger: &str, behavior: &str) -> Procedural {
        Procedural {
            id: id.to_string(),
            scope: scope.to_string(),
            trigger: trigger.to_string(),
            behavior: behavior.to_string(),
            importance: 3,
            confidence: 0.8,
            sources: vec!["ep_1".to_string()],
            supersedes_id: None,
            updated_at: "2025-01-01T00:00:00+00:00".to_string(),
            file_path: String::new(),
        }
    }

    /// The regression this tier was added for: a rule written in January that
    /// applies a value the user changed in December must be shortlisted against
    /// the rule that replaced it, or it keeps being followed.
    #[test]
    fn a_stale_rule_is_shortlisted_against_the_rule_that_replaced_it() {
        let seed = rule(
            "proc_new",
            "chat",
            "writing or formatting code for the operator without project-specific style guidance",
            "default to four-space indentation",
        );
        let stale = rule(
            "proc_old",
            "chat",
            "writing or formatting code for the operator without project-specific style guidance",
            "default to two-space indentation",
        );
        let unrelated = rule(
            "proc_other",
            "chat",
            "the operator sends casual small talk about the weather",
            "acknowledge briefly and return to the task",
        );
        let pool = vec![&stale, &unrelated];
        let picked = candidates_for(&seed, &pool, 2);
        assert_eq!(
            picked[0].id, "proc_old",
            "the rule with the same trigger must come first"
        );
    }

    #[test]
    fn groups_seed_on_what_the_cycle_wrote_and_skip_seeds_with_no_neighbour() {
        let written = vec![
            fact("f_a", "project", "quill_framework", "FastAPI"),
            fact(
                "f_lonely",
                "world",
                "unrelated_topic",
                "nothing like it exists",
            ),
        ];
        let existing = fact("f_b", "project", "quill_framework", "Django");
        let pool: Vec<Fact> = vec![written[0].clone(), written[1].clone(), existing];
        let ids = vec!["f_a".to_string(), "f_lonely".to_string()];
        let groups = groups_for(&pool, &ids, 8, 0, 0, 4);
        assert_eq!(groups.len(), 1, "a seed with no candidate is not a group");
        assert_eq!(groups[0].seed.id, "f_a");
        assert_eq!(groups[0].candidates[0].id, "f_b");
    }

    #[test]
    fn the_sweep_advances_and_wraps_so_the_tail_is_reached() {
        let mut seen = HashSet::new();
        for cycle in 0..5 {
            for i in sweep_window(10, cycle, 2) {
                seen.insert(i);
            }
        }
        assert_eq!(
            seen.len(),
            10,
            "five cycles of width two must cover ten facts"
        );
        assert_eq!(sweep_window(10, 5, 2), vec![0, 1], "and then wrap");
    }
}
