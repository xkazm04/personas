//! Companion (Athena) — always-available chat partner over the agent ecosystem.
//!
//! Phase 0 scaffold: directory layout, embedded constitution/identity templates,
//! and brain submodule stubs. Real wiring lands in subsequent phases.
//!
//! Source of truth for memory is markdown on disk at
//! `~/.personas/companion-brain/`. SQL tables (see `companion_node`,
//! `companion_edge`, ...) are an index over those files plus runtime state.

pub mod brain;
pub mod disk;
pub mod dispatcher;
pub mod observability;
pub mod prompt;
pub mod session;
pub mod templates;
