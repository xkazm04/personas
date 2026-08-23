//! The assembly itself: every block in its fixed order, each measured against
//! its budget as it goes in.
//!
//! Moved verbatim out of the former single-file `prompt.rs`.

use super::addenda::{delegation_addendum, tools_addendum};
use super::budget::{block_stat, PromptBlockSizes};
use super::memory::{
    format_backlog, format_doctrine, format_episodes, format_facts, format_goals,
    format_procedurals,
};
use crate::companion::brain::recall_synthesis::Briefing;
use crate::companion::brain::retrieval::Recall;

// `too_many_arguments`: this signature is wide and stays wide for now. The
// workspace already carries 159 site-level allows on functions of the same
// shape; these were simply the ones that never got one. Converting them to a
// parameter struct is a later wave's job, and the attribute is the marker
// that says so.
#[allow(clippy::too_many_arguments)]
pub(super) fn compose(
    constitution: &str,
    identity: &str,
    observability_md: &str,
    recall: &Recall,
    briefing: Option<&Briefing>,
    plugins_md: &str,
    connectors_md: &str,
    onboarding_md: &str,
    voice_md: &str,
    display_md: &str,
    autonomous_md: &str,
) -> (String, PromptBlockSizes) {
    // When a synthesized briefing is present, it replaces the raw memory
    // sections (facts/goals/procedurals/episodes/backlog/doctrine) — the
    // synthesis prompt fed Claude all of those, so the briefing is the
    // condensed projection. Doctrine is included in the synthesis input,
    // so we don't render it raw alongside the briefing either.
    let synthesized = briefing.map(recall_synthesis_format);

    let episodes_md = if synthesized.is_some() {
        String::new()
    } else {
        format_episodes(&recall.episodes)
    };
    let doctrine_md = if synthesized.is_some() {
        String::new()
    } else {
        format_doctrine(&recall.doctrine)
    };
    let facts_md = if synthesized.is_some() {
        String::new()
    } else {
        format_facts(&recall.facts)
    };
    let goals_md = if synthesized.is_some() {
        String::new()
    } else {
        format_goals(&recall.goals)
    };
    let procedurals_md = if synthesized.is_some() {
        String::new()
    } else {
        format_procedurals(&recall.procedurals)
    };
    let backlog_md = if synthesized.is_some() {
        String::new()
    } else {
        format_backlog(&recall.backlog)
    };
    let synth_md = synthesized.unwrap_or_default();

    let mut out = String::with_capacity(
        constitution.len()
            + identity.len()
            + observability_md.len()
            + episodes_md.len()
            + doctrine_md.len()
            + facts_md.len()
            + goals_md.len()
            + procedurals_md.len()
            + backlog_md.len()
            + synth_md.len()
            + onboarding_md.len()
            + voice_md.len()
            + display_md.len()
            + autonomous_md.len()
            + 256,
    );
    out.push_str(constitution);
    if !identity.is_empty() {
        out.push_str("\n\n# Identity (live, evolves)\n\n");
        out.push_str(identity);
    }
    // Synthesized briefing (when present) sits just below identity — same
    // slot the raw facts block would occupy. It's the projection of facts
    // + goals + procedurals + episodes + backlog + doctrine for this turn.
    out.push_str(&synth_md);
    // Facts sit just below identity — enduring knowledge about *who*.
    // Goals + procedurals follow: who he's trying to be (goals) and
    // how she's agreed to behave (procedurals). All three are stable
    // context that should color every response, not retrieval-of-the-day.
    out.push_str(&facts_md);
    out.push_str(&goals_md);
    out.push_str(&procedurals_md);
    out.push_str(observability_md);
    out.push_str(&episodes_md);
    // Backlog sits near episodes — the open commitments are conversational,
    // tied to specific past turns; this is where Athena scans for "did I
    // promise to follow up on something?"
    out.push_str(&backlog_md);
    out.push_str(&doctrine_md);
    // Plugins block: capabilities the user has toggled on for Athena
    // (currently just dev_tools). Sits between doctrine and connectors
    // because plugins are *internal* app capabilities — closer to
    // Athena's own toolkit than to external services.
    out.push_str(plugins_md);
    // Connectors block: which third-party tools the user has pinned
    // into the chat surface. Athena uses this to mention what she has
    // access to ("you have GitHub attached — want me to look at recent
    // commits?"). Empty string when none are pinned, so this adds zero
    // tokens to the typical prompt.
    out.push_str(connectors_md);
    // Onboarding sits at the very end so its instructions are the last
    // thing Athena reads before forming a reply — most recency-weighted.
    out.push_str(onboarding_md);
    // Voice addendum: only included when the user has voice playback on.
    out.push_str(voice_md);
    // Dual-language addendum: paired with voice — instructs Athena to
    // write the *visual* reply as a tighter, button-shaped index when
    // the user is also listening. Voice off ⇒ empty string ⇒ default
    // prose register.
    out.push_str(display_md);
    // Tools addendum: always on. Tells Athena she has WebSearch /
    // WebFetch via Claude Code so she stops guessing at time-sensitive
    // facts. Sits at the end (recency-weighted) but after onboarding +
    // voice because those are turn-shape, this is tool-shape.
    out.push_str(tools_addendum());
    // Delegate-don't-inline doctrine: always on. Pairs with the
    // non-blocking composer + activity tray — tells Athena to kick long
    // work off as a background task and reply immediately rather than
    // holding a silent turn open.
    out.push_str(delegation_addendum());
    // Autonomous-mode addendum: only when the header toggle is on.
    // Sits last so its instructions are the most recency-weighted —
    // the autonomous loop is the most important behavioral
    // modification of the turn.
    out.push_str(autonomous_md);

    // Instrumentation only — every count and hash is read off the exact
    // strings that were just pushed, so this cannot change a single byte of
    // `out`. (`prompt_is_byte_identical_with_the_churn_instrument` pins that.)
    let measured: Vec<(&'static str, (usize, u64))> = vec![
        ("constitution", block_stat(&[constitution])),
        ("identity", block_stat(&[identity])),
        ("observability", block_stat(&[observability_md])),
        (
            "recall",
            block_stat(&[
                episodes_md.as_str(),
                doctrine_md.as_str(),
                facts_md.as_str(),
                goals_md.as_str(),
                procedurals_md.as_str(),
                backlog_md.as_str(),
            ]),
        ),
        ("briefing", block_stat(&[synth_md.as_str()])),
        ("plugins", block_stat(&[plugins_md])),
        ("connectors", block_stat(&[connectors_md])),
        ("onboarding", block_stat(&[onboarding_md])),
        ("voice", block_stat(&[voice_md])),
        ("display", block_stat(&[display_md])),
        ("mode_addenda", block_stat(&[autonomous_md])),
        (
            "static_addenda",
            block_stat(&[tools_addendum(), delegation_addendum()]),
        ),
    ];
    let sizes = PromptBlockSizes {
        blocks: measured.iter().map(|(n, (c, _))| (*n, *c)).collect(),
        hashes: measured.iter().map(|(n, (_, h))| (*n, *h)).collect(),
        total: out.len(),
    };
    (out, sizes)
}

fn recall_synthesis_format(b: &Briefing) -> String {
    crate::companion::brain::recall_synthesis::format_briefing_section(b)
}
