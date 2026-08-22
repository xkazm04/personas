//! The two legs: **A · compress** turns the episode window into candidates,
//! **B · reconcile** judges supersedes and contradictions across the live set.
//! Both bound their input before the prompt is built.
//!
//! Moved verbatim out of the former single-file `sleep_cycle.rs`.

use std::collections::HashSet;

use super::apply::{
    apply_candidates, apply_supersedes, apply_tag_proposals, collect_contradictions,
};
use super::limits::{
    COMPRESS_TIMEOUT, MAX_CHARS_IN, MAX_EPISODES_IN, MAX_EPISODE_CHARS, MAX_FACTS_TO_RECONCILE,
    RECONCILE_TIMEOUT,
};
use super::parse::{normalize_tag, parse_object};
use super::prompts::{build_compress_prompt, build_reconcile_prompt};
use super::run::{CycleLlm, CycleNotes, CycleStats, Window};
use super::sync_inbox::consume_sync_inbox;
use crate::companion::brain::{consolidation, episodic, oneshot, semantic, taxonomy};
use crate::db::UserDbPool;
use crate::error::AppError;

// ── Phase A · compress ─────────────────────────────────────────────────────

pub(super) async fn phase_compress(
    pool: &UserDbPool,
    llm: &dyn CycleLlm,
    cycle_id: &str,
    window: Window,
    stats: &mut CycleStats,
    notes: &mut CycleNotes,
) -> Result<String, AppError> {
    // The window was read once, at admission, to weigh the pressure that let
    // this cycle in. It is not re-queried here: two reads that are supposed to
    // agree are two reads that can drift.
    //
    // The true window size comes from a COUNT, not from the length of the
    // fetch: the fetch is itself capped, so using it would report "read 120 of
    // 480" on a window of 1,000 — understating the loss exactly when the number
    // matters most.
    stats.window_start = window.boundary;
    stats.episodes_available = window.available;

    let input = bound_input(window.episodes, stats.episodes_available);
    stats.episodes_in = input.episodes.len();
    stats.chars_in = input.chars;
    stats.truncated = input.truncated;
    // THE hand-off to the next cycle: the `created_at` of the newest episode
    // this pass actually fed to compress. Recorded on failed cycles too, but
    // only ever *read* off a completed one (`cycle_report::last_completed`
    // filters on status) — so a cycle that broke half-way hands nothing
    // forward, and its window is genuinely retried rather than skipped.
    stats.consumed_through = input.consumed_through.clone();
    if let Some(note) = input.note.clone() {
        notes.truncation = Some(note);
    }

    if input.episodes.is_empty() {
        return Ok("no new conversation since the last cycle".into());
    }

    let vocabulary = taxonomy::list_active(pool)?;
    let active_tags: HashSet<String> = vocabulary
        .iter()
        .map(|t| normalize_tag(&t.tag))
        .filter(|t| !t.is_empty())
        .collect();
    let known_episodes: HashSet<String> = input.episodes.iter().map(|e| e.id.clone()).collect();

    let prompt = build_compress_prompt(&input.episodes, &vocabulary);
    let text = llm
        .call(oneshot::leg::CYCLE_COMPRESS, &prompt, COMPRESS_TIMEOUT)
        .await?;
    let reply = parse_object(&text, "compress reply")?;

    apply_candidates(
        pool,
        cycle_id,
        &reply,
        &active_tags,
        Some(&known_episodes),
        None,
        stats,
        notes,
    )?;
    apply_tag_proposals(pool, cycle_id, &reply, stats, notes)?;

    Ok(format!(
        "{} episodes ({} chars) → {} facts, {} procedurals, {} tag proposals",
        stats.episodes_in,
        stats.chars_in,
        stats.facts_applied,
        stats.procedurals_applied,
        stats.tags_proposed
    ))
}

/// The bounded compress input.
pub(super) struct BoundedInput {
    pub(super) episodes: Vec<episodic::Episode>,
    pub(super) chars: usize,
    pub(super) truncated: bool,
    /// `created_at` of the newest episode kept — the boundary the next cycle
    /// starts after. `None` only when nothing was kept, in which case the
    /// boundary must not move.
    pub(super) consumed_through: Option<String>,
    pub(super) note: Option<String>,
}

/// Apply the two caps to the window, **oldest-material-first**.
///
/// Walks forward from the oldest episode, so when the budget runs out it is the
/// NEWEST material that is left — and because the cycle records
/// `consumed_through` at exactly the point it stopped, that material is the
/// first thing the next cycle reads. A truncated heavy day therefore drains
/// across successive cycles instead of being orphaned.
///
/// L1b walked backwards from the newest, reasoning that a cycle which read last
/// week and missed last night is worse than useless. That was true of a
/// *time-triggered* cycle whose window restarted at the previous cycle's clock
/// time, because the skipped middle was never revisited by anyone. Under the
/// pressure model the boundary moves only as far as the reading got, so
/// oldest-first loses nothing — it defers — and it is the only order under
/// which "no gap, no overlap" can hold.
///
/// `window_total` is the TRUE number of episodes in the window, which may
/// exceed `available.len()` because the fetch is itself capped. The truncation
/// note is written against that number, not against what happened to be
/// fetched.
pub(super) fn bound_input(available: Vec<episodic::Episode>, window_total: usize) -> BoundedInput {
    let total_available = window_total.max(available.len());
    let mut excerpted = 0usize;
    let mut chars = 0usize;
    let mut kept: Vec<episodic::Episode> = Vec::new();

    for mut ep in available.into_iter() {
        if kept.len() >= MAX_EPISODES_IN as usize {
            break;
        }
        if ep.content.chars().count() > MAX_EPISODE_CHARS {
            ep.content = crate::companion::brain::util::excerpt(&ep.content, MAX_EPISODE_CHARS);
            ep.content.push_str("\n…[excerpted]");
            excerpted += 1;
        }
        let len = ep.content.chars().count();
        if chars + len > MAX_CHARS_IN && !kept.is_empty() {
            break;
        }
        chars += len;
        kept.push(ep);
    }

    let consumed_through = kept.last().map(|e| e.created_at.clone());
    let dropped = total_available.saturating_sub(kept.len());
    let truncated = dropped > 0 || excerpted > 0;
    let note = truncated.then(|| {
        format!(
            "Input was capped: {dropped} of {total_available} episodes in the window were left \
             unread and {excerpted} long bodies were excerpted (caps: {MAX_EPISODES_IN} episodes, \
             {MAX_CHARS_IN} chars, {MAX_EPISODE_CHARS} chars per episode). The unread ones are the \
             NEWEST ones, and they are what the next cycle starts on — deferred, not lost."
        )
    });

    BoundedInput {
        episodes: kept,
        chars,
        truncated,
        consumed_through,
        note,
    }
}

// ── Phase B · reconcile ────────────────────────────────────────────────────

pub(super) async fn phase_reconcile(
    pool: &UserDbPool,
    llm: &dyn CycleLlm,
    cycle_id: &str,
    stats: &mut CycleStats,
    notes: &mut CycleNotes,
) -> Result<String, AppError> {
    // B1 · consume whatever the paired device staged.
    consume_sync_inbox(pool, cycle_id, stats, notes)?;

    // B2 · judge supersedes / contradictions across the active fact set.
    let facts = semantic::list_facts(pool, None, false, MAX_FACTS_TO_RECONCILE)?;
    let judged = if facts.len() < 2 {
        notes
            .caveats
            .push("Reconcile leg skipped: fewer than two active facts to compare.".into());
        false
    } else {
        let prompt = build_reconcile_prompt(&facts);
        let text = llm
            .call(oneshot::leg::CYCLE_RECONCILE, &prompt, RECONCILE_TIMEOUT)
            .await?;
        let reply = parse_object(&text, "reconcile reply")?;
        apply_supersedes(pool, &reply, stats, notes)?;
        collect_contradictions(&reply, stats, notes);
        true
    };

    // B3 · lifecycle. Decay is idempotent within its own window and safe to run
    // unattended (importance floor of 1 — it lowers salience, never eligibility).
    // Pruning is NOT run: forgetting is report-only in v0.
    let decayed = consolidation::decay_unused_facts(pool)?;
    let candidates = consolidation::low_value_prune_candidates(pool)?;
    stats.prune_candidates = candidates.len();
    for c in &candidates {
        notes.prune_candidates.push(format!(
            "`{}` [{}/{}] importance {}, last seen {}",
            c.id, c.scope, c.key, c.importance, c.last_seen_at
        ));
    }

    Ok(format!(
        "{} staged consumed, {} supersedes applied, {} decayed, {} prune candidates reported{}",
        stats.staged_consumed,
        stats.supersedes_applied,
        decayed,
        stats.prune_candidates,
        if judged { "" } else { " (no reconcile leg)" }
    ))
}
