//! The narrative the operator reads with his coffee — written in the order the
//! questions arrive in, ending with what the cycle did NOT see.
//!
//! Moved verbatim out of the former single-file `sleep_cycle.rs`.

use super::limits::{MAX_FACTS_PER_CYCLE, MAX_PROCEDURALS_PER_CYCLE, MAX_SUPERSEDES_PER_CYCLE};
use super::run::{CycleNotes, CycleStats};
use crate::companion::brain::cycle_report;

// ── Report ─────────────────────────────────────────────────────────────────

/// The narrative the operator reads with his coffee.
///
/// Written for a human, in this order because it is the order the questions
/// arrive in: what did you learn, what came from the other machine, what are you
/// asking me about, and what did you NOT see. The last section is the one that
/// matters most — a cycle that quietly dropped half its input while reporting
/// three tidy facts is the failure mode this whole wave exists to avoid.
pub(super) fn render_report(
    cycle_id: &str,
    status: &str,
    stats: &CycleStats,
    notes: &CycleNotes,
) -> String {
    let mut r = String::new();
    r.push_str(&format!("# Sleep cycle — {cycle_id}\n\n"));

    if status == cycle_report::STATUS_FAILED {
        r.push_str(
            "**This cycle FAILED.** What is below is what it managed before it stopped.\n\n",
        );
        if let Some(err) = &stats.error {
            r.push_str(&format!("> {err}\n\n"));
        }
    }

    r.push_str(&format!(
        "Read {} of {} conversation episodes in the window ({} chars).\n\n",
        stats.episodes_in, stats.episodes_available, stats.chars_in
    ));

    r.push_str("## What I learned\n\n");
    if notes.learned_facts.is_empty() && notes.learned_procedurals.is_empty() {
        r.push_str("Nothing new was durable enough to keep.\n\n");
    } else {
        for f in &notes.learned_facts {
            r.push_str(&format!("- {f}\n"));
        }
        for p in &notes.learned_procedurals {
            r.push_str(&format!("- {p}\n"));
        }
        r.push('\n');
    }

    if !notes.staged.is_empty() {
        r.push_str("## What arrived from the other device\n\n");
        for s in &notes.staged {
            r.push_str(&format!("- {s}\n"));
        }
        r.push('\n');
    }

    if !notes.supersedes.is_empty() {
        r.push_str("## What I retired\n\n");
        r.push_str(
            "Retired means demoted out of retrieval, never deleted — the markdown and the \
             provenance chain stay.\n\n",
        );
        for s in &notes.supersedes {
            r.push_str(&format!("- {s}\n"));
        }
        r.push('\n');
    }

    let proposes = !notes.proposed_tags.is_empty()
        || !notes.contradictions.is_empty()
        || !notes.prune_candidates.is_empty();
    if proposes {
        r.push_str("## What I propose (nothing here has been applied)\n\n");
        if !notes.proposed_tags.is_empty() {
            r.push_str("**New classifications**, inert until you activate them:\n\n");
            for t in &notes.proposed_tags {
                r.push_str(&format!("- {t}\n"));
            }
            r.push('\n');
        }
        if !notes.contradictions.is_empty() {
            r.push_str("**Contradictions** I found but did not resolve:\n\n");
            for c in &notes.contradictions {
                r.push_str(&format!("- {c}\n"));
            }
            r.push('\n');
        }
        if !notes.prune_candidates.is_empty() {
            r.push_str(&format!(
                "**{} facts are over the per-scope size cap** and would be the first to be \
                 forgotten. I have not touched them:\n\n",
                notes.prune_candidates.len()
            ));
            for c in notes.prune_candidates.iter().take(25) {
                r.push_str(&format!("- {c}\n"));
            }
            if notes.prune_candidates.len() > 25 {
                r.push_str(&format!(
                    "- …and {} more\n",
                    notes.prune_candidates.len() - 25
                ));
            }
            r.push('\n');
        }
    }

    r.push_str("## What I did not see, and what I dropped\n\n");
    let mut honesty: Vec<String> = Vec::new();
    if let Some(t) = &notes.truncation {
        honesty.push(t.clone());
    }
    if stats.facts_dropped > 0 {
        // The forgotten count is called out separately because it is the one
        // drop reason that is the system obeying rather than the system
        // hitting a limit, and folding it into a bare "dropped N" would read
        // as a failure.
        let forgotten = if stats.facts_dropped_forgotten > 0 {
            format!(
                ", {} because you had asked me to forget that key",
                stats.facts_dropped_forgotten
            )
        } else {
            String::new()
        };
        honesty.push(format!(
            "{} fact candidate(s) were dropped ({} of them for exceeding the {}-per-cycle cap{}).",
            stats.facts_dropped, stats.facts_dropped_over_cap, MAX_FACTS_PER_CYCLE, forgotten
        ));
    }
    if !notes.refused_forgotten.is_empty() {
        honesty.push(
            "I re-derived these from the evidence and did not write them, because you              deleted them before:"
                .to_string(),
        );
        for line in &notes.refused_forgotten {
            honesty.push(format!("  - {line}"));
        }
    }
    if stats.procedurals_dropped > 0 {
        honesty.push(format!(
            "{} procedural candidate(s) were dropped ({} for exceeding the {}-per-cycle cap).",
            stats.procedurals_dropped,
            stats.procedurals_dropped_over_cap,
            MAX_PROCEDURALS_PER_CYCLE
        ));
    }
    if stats.unknown_tags_dropped > 0 {
        honesty.push(format!(
            "{} tag(s) I tried to apply are not in the active vocabulary and were dropped.",
            stats.unknown_tags_dropped
        ));
    }
    if stats.staged_malformed > 0 {
        honesty.push(format!(
            "{} staged delta(s) could not be used. They are marked processed anyway, so they \
             cannot block future cycles.",
            stats.staged_malformed
        ));
    }
    if stats.supersedes_dropped > 0 {
        honesty.push(format!(
            "{} supersede verdict(s) were refused (bad id, cross-scope, or over the \
             {MAX_SUPERSEDES_PER_CYCLE}-per-cycle cap).",
            stats.supersedes_dropped
        ));
    }
    honesty.extend(notes.caveats.iter().cloned());
    if honesty.is_empty() {
        r.push_str("Nothing was truncated and nothing was dropped.\n");
    } else {
        for h in honesty {
            r.push_str(&format!("- {h}\n"));
        }
    }
    r
}
