//! CLI session orchestration for Athena.
//!
//! Each turn: spawn `claude --print --output-format stream-json` (with
//! `--resume <id>` if we already have one), pipe the user message into
//! stdin, parse stream-json lines from stdout, emit them as Tauri events
//! for the panel UI, accumulate the assistant's final text, persist the
//! turn as episodes, and update the persistent claude_session_id pointer.
//!
//! Phase 1: minimal viable loop. Approval cards / op dispatch / dev
//! feedback land in later phases. The companion_session row holds a single
//! `id='default'` pointer; multi-companion support is deferred.
//!
//! ## Layout
//!
//! Split out of the former single-file `session.rs` (3,050 lines) along the
//! lifecycle of one turn rather than any imposed shape. No logic moved with it:
//!
//! - [`origin`] — the default session id, the autonomous-continuation marker
//!   and its pacing, and [`TurnOrigin`].
//! - [`interrupts`] — the process-wide registries a running turn can be
//!   stopped through, and the autonomy generation counters that make a
//!   superseded continuation inert.
//! - [`events`] — every Tauri event name a turn emits, the payload structs
//!   behind them, and the two emit helpers.
//! - [`locks`] — the per-conversation turn lock, the fleet queue depth, and the
//!   one definition of a turn's ledger identity.
//! - [`failure`] — the low-cardinality failure token and the wrapper that makes
//!   exactly one `is_error` ledger row per genuinely failed turn.
//! - [`turn`] — [`send_turn`] and `send_turn_inner`. **The order of statements
//!   inside `send_turn_inner` is behaviour**, so it moved as one unbroken
//!   block.
//! - [`autonomy`] — scheduling the next autonomous tick and spawning a
//!   proactive turn.
//! - [`model`] — which model and effort a companion turn runs at, asked of
//!   [`crate::companion::model_routing`] (still the single source of truth).
//! - [`stream`] — the CLI run's output shape, display cleanup of one assistant
//!   segment, and the mid-turn progress persist.
//! - [`build_turn`] — the build turn: its doctrine, its system prompt, itself.
//! - [`cli`] — spawning the CLI and reading its stream-json back.
//! - [`transcript`] — the persistent `claude_session_id` pointer and wiping it.
//!
//! Everything stays reachable as `crate::companion::session::X`; the re-exports
//! below preserve the pre-split surface exactly.

mod autonomy;
mod build_turn;
mod cli;
mod events;
mod failure;
mod interrupts;
mod locks;
mod model;
mod origin;
mod stream;
mod transcript;
mod turn;

#[cfg(test)]
mod tests;

pub use autonomy::*;
pub use build_turn::*;
pub use cli::*;
pub use events::*;
pub(crate) use failure::*;
pub use interrupts::*;
pub use origin::*;
pub use transcript::*;
pub use turn::*;
