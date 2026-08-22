//! Who a turn is for and where it came from: the default session id, the
//! marker and pacing of an autonomous continuation, and [`TurnOrigin`].
//!
//! Moved verbatim out of the former single-file `session.rs`.

use std::time::Duration;

/// The single-instance companion session id (Phase 1).
pub const DEFAULT_SESSION_ID: &str = "default";

/// Synthetic user message used to drive autonomous continuation turns.
/// The prompt builder swaps it out for a turn-specific directive; the
/// dispatcher persists it as a `[autonomous]` system episode rather
/// than a regular user turn so the chat transcript stays readable.
///
/// Treat this string as a sentinel — never display it raw, never use
/// it as a real user prompt.
pub const AUTONOMOUS_CONTINUATION_MARKER: &str = "<<athena-autonomous-continuation>>";

/// Delay before the autonomous continuation tick fires. Long enough
/// for the user to interject ("stop", or any new turn) without a
/// race, short enough that long-running tasks don't feel paused.
pub(super) const AUTONOMOUS_CONTINUATION_DELAY: Duration = Duration::from_secs(15);

/// Hard cap on consecutive autonomous turns to prevent a runaway loop
/// (Athena keeps emitting `continue_autonomously` indefinitely). Once
/// reached, the system stops scheduling continuations until the user
/// sends a fresh message.
pub(super) const MAX_AUTONOMOUS_CHAIN: u32 = 20;

/// Why a turn was triggered. Drives prompt assembly (different
/// addendum for autonomous ticks), episode persistence (user turns
/// land as User episodes, autonomous ticks as System), and the
/// continuation-loop counter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnOrigin {
    /// User typed a message into the panel composer.
    User,
    /// Athena's `continue_autonomously` op triggered a follow-up turn.
    /// `chain_index` is 1-based — the first continuation is 1, second is
    /// 2, etc. Resets to 0 when a User turn lands.
    Autonomous { chain_index: u32 },
    /// A backend trigger (the proactive scheduler, or an app-event
    /// subscriber) woke Athena to reason about something that happened
    /// on its own — e.g. a persona execution finished and she should
    /// analyze it. Distinct from `Autonomous`: this is the FIRST turn
    /// of a self-initiated thread, not a continuation of a user chain.
    /// The caller builds the synthetic directive and passes it as
    /// `user_message`; the opening episode persists as `System` with a
    /// `[proactive: <trigger_kind>]` marker so the transcript shows the
    /// turn was machine-initiated, not user-typed.
    ///
    /// `trigger_kind` / `trigger_ref` mirror the proactive `Nudge`
    /// fields so a turn can be traced back to what woke it (and deduped
    /// against re-firing on the same execution).
    Proactive {
        trigger_kind: String,
        trigger_ref: Option<String>,
    },
    /// A frontend surface forwarded a *synthetic* prompt that is NOT the
    /// user's own words — e.g. Fleet's "Ask Athena" button sends a crafted
    /// stale-session directive. The user clicked a button, but the text is the
    /// system's, so it must not impersonate a user turn: it persists as
    /// `System` with a `[<source>]` marker (the chat renders it as a system
    /// divider, not a user bubble) and the model is told the provenance.
    /// `source` is a short human label, e.g. "Fleet".
    External { source: String },
}
