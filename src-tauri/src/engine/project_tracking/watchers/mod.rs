//! Source watchers — pull-based readers that turn external state (git
//! log, the active-runs ledger, optional Obsidian notes) into
//! [`crate::engine::project_tracking::events::EventPayload`] entries.
//!
//! Each watcher:
//! - Takes a project path and a "since" cutoff.
//! - Returns a `Vec<EventPayload>` (possibly empty, possibly with errors
//!   logged + swallowed; failure to poll one watcher must not break the
//!   tick for the same project's other watchers).
//! - Has no side effects on its own; the scheduler is the writer.

pub mod git;
pub mod ledger;
pub mod obsidian;
