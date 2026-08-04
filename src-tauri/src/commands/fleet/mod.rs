//! Fleet plugin — DEV-only Claude Code session aggregator.
//!
//! Owns and observes multiple `claude` CLI sub-processes from one Tauri app.
//! See `docs/features/fleet.md` (lands in phase 9) for the design rationale.
//!
//! Module layout (filled in across phases 1-9):
//! - [`types`]       — ts-rs DTOs shared with the frontend (phase 1)
//! - [`registry`]    — global registry of active sessions + state (phase 2 / 6)
//! - [`pty`]         — portable-pty spawn + I/O multiplexing (phase 2)
//! - [`commands`]    — Tauri command surface (phase 2)
//! - [`hooks`]       — axum routes that accept Claude Code hook callbacks (phase 4)
//! - [`hook_install`] — idempotent ~/.claude/settings.json patching (phase 5)
//! - [`transcript`]  — JSONL watcher on ~/.claude/projects/ (phase 6)
//!
//! The Rust module always compiles; only the frontend sidebar entry is
//! DEV-gated. Keeps ts-rs output and command-name codegen stable across
//! build profiles.

/// Performance gates over the scale-critical hot paths. Test-only: it carries no
/// production callers by design, so it costs nothing in a shipped build.
#[cfg(test)]
pub mod bench;
pub mod commands;
pub mod companion_api;
pub mod debug_log;
pub mod external;
pub mod headless;
pub mod hook_install;
pub mod hooks;
pub mod keys;
pub mod monitor_stats;
pub mod naming;
pub mod pairing;
pub mod persist;
pub mod process_scan;
pub mod pty;
pub mod registry;
pub mod run;
pub mod screen_activity;
pub mod stale;
#[cfg(feature = "desktop")]
pub mod transcript;
pub mod transcript_read;
pub mod types;
pub mod wait;
