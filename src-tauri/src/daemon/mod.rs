//! Daemon support module.
//!
//! Houses the cross-process coordination primitives needed to run the
//! `personas-daemon` binary alongside the windowed Tauri app without
//! duplicate trigger firings.
//!
//! See `.planning/research/2026-04-08-cloud-headless-personas.md` for
//! architectural context.

pub mod lock;
pub mod runtime;

// Re-exports for daemon_bin.rs — keeps db/engine modules private.
pub use crate::db::{init_db, DbPool};
pub use crate::engine::background::SchedulerState;
pub use crate::engine::failover::ProviderCircuitBreaker;
