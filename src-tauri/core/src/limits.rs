//! Engine-wide execution ceilings.
//!
//! These live in `personas-core` rather than in the engine because `validation`
//! clamps user-supplied timeouts against them, and `validation` sits below the
//! engine in the crate graph. A single `crate::engine::ENGINE_MAX_EXECUTION_MS`
//! reference was otherwise enough to drag all 157k LOC of `engine` into the
//! core layer — see the crate-split notes in `lib.rs`.
//!
//! `engine` re-exports both constants, so `crate::engine::ENGINE_MAX_EXECUTION_*`
//! keeps resolving for the ~dozen call sites that use it.

/// Hard engine-level ceiling for any single execution (20 minutes).
/// This is a non-overridable safety net that prevents runaway executions
/// regardless of per-persona timeout configuration.
pub const ENGINE_MAX_EXECUTION_SECS: u64 = 20 * 60;

/// Engine ceiling expressed in milliseconds for validation and clamping.
pub const ENGINE_MAX_EXECUTION_MS: i32 = (ENGINE_MAX_EXECUTION_SECS * 1000) as i32;
