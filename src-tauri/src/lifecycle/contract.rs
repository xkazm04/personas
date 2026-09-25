//! The lifecycle contract: the rendered block injected into sessions the app
//! starts, at three named doors (Run Desk `build_task_prompt`, unattended
//! `*_task_text_at_rung`, Athena fleet-plan rows).
//!
//! STUB (WP1): final signature, empty output. WP2 renders the block.

use crate::db::models::LifecycleDoc;

/// Which door the contract is rendered for.
// WP1 stub: its callers (Run Desk prompt, unattended rungs, fleet rows) land in WP2.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContractContext {
    /// A Run Desk task on `branch`.
    RunDesk {
        branch: String,
        gh_authenticated: bool,
    },
    /// An unattended run: Land/Isolate wording is omitted, the rung guardrails
    /// (the mandate) outrank the preset.
    Unattended,
    /// An Athena fleet-plan row.
    FleetRow,
}

/// The contract block for `doc` at `version`, or `""` when there is nothing to
/// inject.
// WP1 stub: its callers (Run Desk prompt, unattended rungs, fleet rows) land in WP2.
#[allow(dead_code)]
pub fn render_contract(doc: &LifecycleDoc, version: i64, ctx: ContractContext) -> String {
    let _ = (doc, version, ctx);
    String::new()
}
