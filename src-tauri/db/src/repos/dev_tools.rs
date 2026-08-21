//! SHIM: retire in W4 once callers migrate.
//!
//! The Dev Tools repository was a single 10,128-line module spanning ~34 tables
//! and a dozen unrelated domains. It now lives in [`crate::repos::dev`], one
//! module per table family. This file re-exports that tree unchanged so the
//! hundreds of `repos::dev_tools::…` call sites across `src-tauri/src/commands/**`
//! keep resolving while they are migrated wave by wave.
//!
//! Add nothing here. New functions belong in the owning `repos::dev::*` module.

// SHIM: retire in W4 once callers migrate.
pub use super::dev::attention::*;
pub use super::dev::auto_runs::*;
pub use super::dev::competitions::*;
pub use super::dev::contexts::*;
pub use super::dev::cross_project::*;
pub use super::dev::goals::*;
pub use super::dev::ideas::*;
pub use super::dev::kpis::*;
pub use super::dev::milestones::*;
pub use super::dev::pipelines::*;
pub use super::dev::portfolio::*;
pub use super::dev::projects::*;
pub use super::dev::scans::*;
pub use super::dev::standards::*;
pub use super::dev::tasks::*;
pub use super::dev::triage_rules::*;
pub use super::dev::use_cases::*;
