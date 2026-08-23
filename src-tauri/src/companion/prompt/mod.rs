//! System-prompt composition for the companion's CLI session.
//!
//! Layers fed to Claude every turn:
//!   1. Constitution — static character + voice + provenance contract.
//!   2. Identity — evolving self-model from `identity.md`.
//!   3. Observability digest — current state of the Personas app.
//!   4. Recalled conversation — episodes via hybrid retrieval.
//!   5. Reference (doctrine) — relevant chunks of the curated app docs.
//!
//! The two recall sections are kept distinct so Athena can tell us-history
//! ("we discussed X") from canonical reference ("the docs say X").
//!
//! ## Layout
//!
//! Split out of the former single-file `prompt.rs` (3,037 lines) by *what a
//! block is about*, since the file is a collection of block renderers around
//! one builder and one composer. No logic moved with it:
//!
//! - [`build`] — [`build_system_prompt`], the entry point that gathers every
//!   block, and the cfg-gated `EmbedderArg` seam that keeps its signature
//!   identical in ml and non-ml builds.
//! - [`compose`] — the assembly: every block in its fixed order, measured
//!   against its budget as it goes in.
//! - [`recall`] — where the recalled conversation comes from in each feature
//!   build, and the optional synthesis pass over it.
//! - [`recall_preview`] — the same recall as the payload the UI's recall chip
//!   reads.
//! - [`memory`] — episodes, facts, goals, procedurals, backlog, doctrine.
//! - [`capabilities`] — the Dev Tools registry, plugins, connectors.
//! - [`projects`] — project goals, KPIs and today's tracking pulses.
//! - [`indexes`] — the persona / context / skill indexes and the char-budget
//!   machinery they share.
//! - [`scene`] — the published canvas digest.
//! - [`devices`] — the paired-devices roster (absent without a device link).
//! - [`addenda`] — the conditional tails: language, voice, display, autonomy,
//!   tools, delegation, progress, onboarding, the daily-goals ritual.
//! - [`budget`] — what each named block may cost, and what it did cost.
//!
//! Everything stays reachable as `crate::companion::prompt::X`; the re-exports
//! below preserve the pre-split surface exactly.

mod addenda;
mod budget;
mod build;
mod capabilities;
mod compose;
mod devices;
mod indexes;
mod memory;
mod projects;
mod recall;
mod recall_preview;
mod scene;

#[cfg(test)]
mod tests;

pub use budget::*;
pub use build::*;
pub(crate) use indexes::*;
pub use recall_preview::*;
