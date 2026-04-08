//! Daemon support module.
//!
//! Houses the cross-process coordination primitives needed to run the
//! `personas-daemon` binary alongside the windowed Tauri app without
//! duplicate trigger firings.
//!
//! Phase 0 scaffolding (2026-04-08): only [`lock`] exists. The trigger
//! runtime integration is added in a follow-up pass.
//!
//! See `.planning/research/2026-04-08-cloud-headless-personas.md` for
//! architectural context.

pub mod lock;
