//! Rendering what she remembers: episodes and facts, then goals, procedurals,
//! the backlog and the doctrine hits.
//!
//! Moved verbatim out of the former single-file `prompt.rs`.

use super::budget::{fit_trailing_to_render, EPISODE_RENDER_BUDGET};
use crate::companion::brain::backlog::BacklogItem;
use crate::companion::brain::episodic::Episode;
use crate::companion::brain::goals::Goal;
use crate::companion::brain::procedural::Procedural;
use crate::companion::brain::retrieval::DoctrineHit;
use crate::companion::brain::semantic::Fact;

pub(super) fn format_episodes(episodes: &[Episode]) -> String {
    if episodes.is_empty() {
        return String::new();
    }

    // Retrieval hands us a window sized in EPISODES, but what this block
    // spends is CHARS, and the two are not proportional: over the live corpus
    // a fixed 20-episode window renders anywhere from 1,560 to 39,212 chars -
    // 25x - because episodes themselves run from 2 chars to 4,918. A count
    // cannot bound what the prompt actually costs, so the cut happens here,
    // against the rendered block, with EPISODE_RENDER_BUDGET as the bound.
    let keep = fit_trailing_to_render(episodes, EPISODE_RENDER_BUDGET, |eps| {
        render_episode_block(eps, 0)
    });
    render_episode_block(&episodes[episodes.len() - keep..], episodes.len() - keep)
}

/// The episode block itself. `omitted` is how many older turns the budget cut
/// dropped; when it is non-zero the block says so, because a silently short
/// recall reads to everything downstream as "we never discussed that".
fn render_episode_block(episodes: &[Episode], omitted: usize) -> String {
    if episodes.is_empty() {
        return String::new();
    }
    let mut s = String::from("\n\n# Recalled conversation (oldest first)\n\n");
    if omitted > 0 {
        s.push_str(&format!(
            "_{omitted} older turn(s) omitted to fit the recall budget._

"
        ));
    }
    for ep in episodes {
        s.push_str(&format!(
            "## {}{} — {}\n\n{}\n\n",
            ep.role,
            machine_marker(&ep.content),
            ep.created_at,
            ep.content
        ));
    }
    s
}

/// Ten characters that tell the model a recalled turn is a **machine
/// correlator record**, not something the user said.
///
/// Without it a `fleet-event session:... state:running` row renders in the
/// same shape as a human turn under the same `## system` heading, and the
/// model has no way to weigh them differently -- it reads a load test as
/// conversation. Kept to one bracketed token because this is paid on every
/// rendered episode of every turn; the marker's job is to be
/// *distinguishable*, not descriptive.
fn machine_marker(content: &str) -> &'static str {
    if crate::companion::brain::episodic::is_machine_episode(content) {
        " [machine]"
    } else {
        ""
    }
}

/// Render facts grouped by scope. Each fact lists its sources so Athena
/// can cite back to the source episodes when she draws on it. Facts
/// without sources don't reach this layer (rejected at write time), but
/// we defensively skip empty-source rows just in case.
pub(super) fn format_facts(facts: &[Fact]) -> String {
    if facts.is_empty() {
        return String::new();
    }
    let mut s =
        String::from("\n\n# Semantic memory (facts you've distilled — every entry is cited)\n\n");
    let mut last_scope: Option<&str> = None;
    let mut sorted: Vec<&Fact> = facts.iter().collect();
    sorted.sort_by(|a, b| {
        a.scope
            .cmp(&b.scope)
            .then(b.importance.cmp(&a.importance))
            .then(b.updated_at.cmp(&a.updated_at))
    });
    for f in sorted {
        // `write_fact` refuses to persist a fact with no sources, so this
        // should be unreachable -- but the old fallback rendered the literal
        // string "no-sources" as if it were a real citation, teaching the
        // model that uncited memory is a legitimate shape. Skip it instead
        // (matching `consolidation.rs`'s `continue` on the same check) and
        // log loudly, since reaching this means the write-time invariant was
        // bypassed somewhere.
        if f.sources.is_empty() {
            tracing::warn!(
                key = %f.key,
                "skipping fact with empty sources in prompt render; write-time invariant should have prevented this"
            );
            continue;
        }
        if last_scope != Some(f.scope.as_str()) {
            s.push_str(&format!("## {} facts\n\n", capitalize(&f.scope)));
            last_scope = Some(f.scope.as_str());
        }
        s.push_str(&format!(
            "- **{key}** (importance {imp}, conf {conf:.0}%) — {value}  [from {srcs}]\n",
            key = f.key,
            imp = f.importance,
            conf = f.confidence * 100.0,
            value = f.value.trim(),
            srcs = f.sources.join(", "),
        ));
    }
    s.push('\n');
    s
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_ascii_uppercase().to_string() + chars.as_str(),
        None => String::new(),
    }
}

pub(super) fn format_goals(goals: &[Goal]) -> String {
    if goals.is_empty() {
        return String::new();
    }
    let mut s = String::from("\n\n# Active goals (what the user said they're working toward)\n\n");
    for g in goals {
        let target = g
            .target_date
            .as_deref()
            .map(|d| format!(" · target {d}"))
            .unwrap_or_default();
        s.push_str(&format!(
            "- **{title}** (priority {p}{target}) — {desc}\n",
            title = g.title.trim(),
            p = g.priority,
            target = target,
            desc = first_paragraph(&g.description, 240)
        ));
    }
    s
}

/// Procedural rules — durable behaviors. Render with the trigger as the
/// "when" and behavior as the "do". Sources cite back to the episodes
/// where the rule was confirmed.
pub(super) fn format_procedurals(rules: &[Procedural]) -> String {
    if rules.is_empty() {
        return String::new();
    }
    let mut s = String::from("\n\n# Procedural rules (how to behave — every rule is cited)\n\n");
    let mut last_scope: Option<&str> = None;
    let mut sorted: Vec<&Procedural> = rules.iter().collect();
    sorted.sort_by(|a, b| {
        a.scope
            .cmp(&b.scope)
            .then(b.importance.cmp(&a.importance))
            .then(b.updated_at.cmp(&a.updated_at))
    });
    for r in sorted {
        if last_scope != Some(r.scope.as_str()) {
            s.push_str(&format!("## {} rules\n\n", r.scope));
            last_scope = Some(r.scope.as_str());
        }
        let sources = if r.sources.is_empty() {
            "no-sources".into()
        } else {
            r.sources.join(", ")
        };
        s.push_str(&format!(
            "- **When:** {trigger}  \n  **Then:** {behavior}  \n  _(imp {imp}, conf {conf:.0}%, from {srcs})_\n\n",
            trigger = r.trigger.trim(),
            behavior = first_paragraph(&r.behavior, 240),
            imp = r.importance,
            conf = r.confidence * 100.0,
            srcs = sources
        ));
    }
    s
}

/// Open backlog — what Athena has committed to do, plus capability
/// gaps she's flagged. The user shouldn't have to remind her.
pub(super) fn format_backlog(items: &[BacklogItem]) -> String {
    if items.is_empty() {
        return String::new();
    }
    let mut s = String::from("\n\n# Open backlog (your commitments + flagged capability gaps)\n\n");
    let (promises, gaps): (Vec<&BacklogItem>, Vec<&BacklogItem>) =
        items.iter().partition(|i| i.kind == "self_promise");
    if !promises.is_empty() {
        s.push_str("## Self-promises\n\n");
        for p in promises {
            let src = p
                .source_episode_id
                .as_deref()
                .map(|x| format!(" [from {x}]"))
                .unwrap_or_default();
            s.push_str(&format!("- {summary}{src}\n", summary = p.summary.trim()));
        }
        s.push('\n');
    }
    if !gaps.is_empty() {
        s.push_str("## Capability gaps\n\n");
        for g in gaps {
            s.push_str(&format!("- {summary}\n", summary = g.summary.trim()));
        }
    }
    s
}

pub(super) fn first_paragraph(s: &str, max_len: usize) -> String {
    let firstline = s.lines().next().unwrap_or("").trim();
    if firstline.len() <= max_len {
        firstline.to_string()
    } else {
        format!(
            "{}…",
            crate::utils::text::truncate_on_char_boundary(firstline, max_len)
        )
    }
}

pub(super) fn format_doctrine(doctrine: &[DoctrineHit]) -> String {
    if doctrine.is_empty() {
        return String::new();
    }
    let mut s =
        String::from("\n\n# Reference — Personas docs (cite by path when you draw on these)\n\n");
    for d in doctrine {
        s.push_str(&format!("## From `{}`\n\n{}\n\n", d.file_path, d.content));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::companion::brain::episodic::Episode;

    fn ep(role: &str, content: &str) -> Episode {
        Episode {
            id: "ep_x".into(),
            session_id: "default".into(),
            role: role.into(),
            content: content.into(),
            file_path: "p.md".into(),
            created_at: "2026-08-08T00:00:00Z".into(),
        }
    }

    /// Fail-before: a `fleet-event` row and a human turn both rendered as
    /// `## system — <ts>` / `## user — <ts>`, so the model saw a load test in
    /// the same shape as conversation.
    #[test]
    fn a_machine_episode_is_marked_and_a_human_turn_is_not() {
        let block = format_episodes(&[
            ep(
                "system",
                "fleet-event session:abc cc:- state:running project:personas",
            ),
            ep("user", "Why do we still have stale fleet sessions?"),
        ]);
        assert!(
            block.contains("## system [machine] \u{2014}"),
            "correlator record must be marked, got:\n{block}"
        );
        assert!(
            block.contains("## user \u{2014}"),
            "a human turn must carry no marker, got:\n{block}"
        );
        assert!(!block.contains("## user [machine]"));
    }

    /// The marker is paid on every turn, so its size is part of the contract.
    #[test]
    fn the_marker_stays_short() {
        assert_eq!(machine_marker("fleet-event x"), " [machine]");
        assert_eq!(machine_marker("hello"), "");
    }
}
