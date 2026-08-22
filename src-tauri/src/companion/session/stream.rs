//! What comes back out of the CLI: the run's output shape, display cleanup of
//! one assistant segment, and the mid-turn progress persist.
//!
//! Moved verbatim out of the former single-file `session.rs`.

use crate::companion::brain::episodic::{self, EpisodeRole};
use crate::db::UserDbPool;

/// `run_cli`'s output: the display text plus the parsed terminal `result`
/// usage (`None` when the CLI emitted no result event — older CLI, or the turn
/// errored before the result line).
/// `(full_text, segments, usage)`. `segments` is the per-assistant-message
/// text in emission order — in a multi-step (tool-using) turn the CLI emits a
/// separate `assistant` message per agentic step (talk → tool → talk → …), so
/// each entry is one "she talked here" beat of prose. `full_text` is the
/// concatenation (what the dispatcher parses for ops/beats — unchanged);
/// `segments` lets send_turn surface non-final steps as interim messages.
pub(super) type CliRunOutput = (
    String,
    Vec<String>,
    Option<crate::companion::turn_ledger::CliUsage>,
);

/// Strip machine-grammar lines from one assistant-message segment so it can be
/// shown as an interim message. Mirrors the frontend `stripModelDirectives`
/// (OP: / QR: / TTS: / raw `{"op"`) and also drops `PROGRESS:` lines — those
/// are persisted separately as their own beat-asides, so a segment's prose
/// must not duplicate them. Display-only: the dispatcher remains the authority
/// for ops/beats, run on the full concatenated text.
pub(super) fn clean_segment_for_display(seg: &str) -> String {
    let kept: Vec<&str> = seg
        .lines()
        .filter(|line| {
            let t = line.trim_start();
            !(t.starts_with("OP:")
                || t.starts_with("QR:")
                || t.starts_with("TTS:")
                || t.starts_with("PROGRESS:")
                || t.starts_with("{\"op\""))
        })
        .collect();
    kept.join("\n").trim().to_string()
}

/// Continuous informing (Variant B): persist one just-arrived assistant
/// message's `PROGRESS:` beats and the PRIOR step's prose as their own
/// lightweight (non-embedded) assistant episodes, at their real emission time.
///
/// Called once per streamed `assistant` message from `run_cli`'s loop when
/// progress persistence is enabled. This replaces the old end-of-turn flush in
/// `send_turn` that appended every beat/segment in a tight loop — which stamped
/// them all within the same millisecond ("big bang" on reload). Now each write
/// lands as the turn actually progresses.
///
/// Ordering: the prior step's prose is flushed BEFORE this step's beats, so the
/// transcript reads chronologically. `pending` holds the last non-empty cleaned
/// prose that has NOT yet been confirmed non-final; it's only replaced by a
/// newer non-empty prose (so a beat-only step never promotes it). Whatever
/// remains in `pending` at EOF is the considered final reply and is persisted by
/// `send_turn`, never here — matching the prior `seg_clean[..last]` interim /
/// `seg_clean[last]` final split exactly, just at real time.
pub(super) fn persist_stream_progress(
    pool: &UserDbPool,
    session_id: &str,
    msg_text: &str,
    pending: &mut Option<String>,
) {
    let cleaned = clean_segment_for_display(msg_text);
    let has_prose = !cleaned.trim().is_empty();

    // A newer prose step confirms the prior one is non-final — flush it as an
    // interim message before this step's beats so ordering stays chronological.
    if has_prose {
        if let Some(prev) = pending.take() {
            if let Err(e) =
                episodic::append_episode(pool, session_id, EpisodeRole::Assistant, &prev)
            {
                tracing::warn!(error = %e, "failed to persist interim segment episode (live)");
            }
        }
    }

    // Progress beats are always asides (stripped from the final reply), so each
    // is safe to persist the instant its line completes — including the last
    // step's beats.
    for line in msg_text.lines() {
        if let Some(beat) = line.trim_start().strip_prefix("PROGRESS:") {
            let beat = beat.trim();
            if beat.is_empty() {
                continue;
            }
            if let Err(e) = episodic::append_episode(
                pool,
                session_id,
                EpisodeRole::Assistant,
                &format!("PROGRESS: {beat}"),
            ) {
                tracing::warn!(error = %e, "failed to persist progress beat episode (live)");
            }
        }
    }

    // Hold this step's prose as the new candidate final reply.
    if has_prose {
        *pending = Some(cleaned);
    }
}
