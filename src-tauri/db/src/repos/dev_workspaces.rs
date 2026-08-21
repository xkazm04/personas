//! SHIM: retire in W4 once callers migrate.
//!
//! The Workspace Knowledge Center repository was a single 4,518-line module
//! spanning ~15 tables and half a dozen unrelated domains. It now lives in
//! [`crate::repos::workspaces`], one module per table family. This file
//! re-exports that tree unchanged so the `repos::dev_workspaces::…` call sites
//! across `src-tauri/src/commands/**` keep resolving while they are migrated
//! wave by wave.
//!
//! Add nothing here. New functions belong in the owning `repos::workspaces::*`
//! module.

// SHIM: retire in W4 once callers migrate.
pub use super::workspaces::adoption::*;
pub use super::workspaces::consults::*;
pub use super::workspaces::context_state::*;
pub use super::workspaces::evidence::*;
pub use super::workspaces::harvest::*;
pub use super::workspaces::ingest::*;
pub use super::workspaces::knowledge::*;
pub use super::workspaces::mining::*;
pub use super::workspaces::org::*;
pub use super::workspaces::pattern_edges::*;
pub use super::workspaces::playbooks::*;
pub use super::workspaces::practice_ideas::*;
