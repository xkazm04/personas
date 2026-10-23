//! **Steward merges in the act log** (spark `mandate-lanes`, close-out item 2).
//!
//! A rung-3 App Master worker merges its own branch inside its worktree, so the
//! app never sees the merge happen, and until this module no `merge` act was
//! ever written: the WP6 re-read trigger "many merges since the last read"
//! (`personas_engine::mandate_reread`, counted by `charter_acts::tallies`) could
//! not fire.
//!
//! **Where a merge is detected.** The one detection the app already had is the
//! dispatch sweep in `engine::subscription::attention`
//! (`close_abandoned_dispatch_tasks` -> `branch_delivery_evidence` ->
//! [`git_merged_since`]): a dispatch branch that moved after the dispatch and
//! is now an ancestor of the project's main. That sweep only looks at workers
//! that ended WITHOUT writing back, so it misses every merge a worker reported.
//! This module asks the same question, through the same git reading, of every
//! recent dispatch branch of a mandate that permits its steward to merge, and
//! records each merged branch once.
//!
//! **Who merged.** A merge is the steward's only when the charter's mandate let
//! its worker merge: the ship rung the dispatch path itself computes
//! (`ship_rung_for_envelope`) is at [`RUNG_MAY_MERGE`] or above. Below that the
//! worker was told to open the branch and ask, so a merged branch is the
//! operator's merge, and it is not written as a steward act.
//!
//! **Once per branch.** The act is `item_kind = 'merge'`, `item_id = <branch>`,
//! `actor = 'steward'`, irreversible (a landed merge is not undone by a revert
//! in this log), on the charter the dispatch served, written through
//! `charter_acts::append_once` so a second detection writes nothing. No
//! mandate behind the dispatch: no row.
//!
//! **Bounded.** Dispatches of the last [`LOOKBACK_DAYS`] days, at most
//! [`MAX_ROWS`] ledger rows and [`MAX_PROBES_PER_SWEEP`] git readings per run
//! (a branch already recorded costs no git at all). Hosted on the steward
//! sweep (`mandate_sweep::sweep_and_emit`, 15 min), which announces every act.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use personas_engine::unattended::{ship_rung_for_envelope, RUNG_MAY_MERGE};

use crate::db::models::{CharterAct, CharterActor, MandateSummary, NewCharterAct};
use crate::db::repos::core::attention_ledger::{self, DispatchBranch};
use crate::db::repos::core::{charter_acts, mandates};
use crate::db::DbPool;
use crate::engine::subscription::{git_merged_since, MergeEvidence};

/// The act's `item_kind`, the one `charter_acts::tallies` counts as a merge.
pub(crate) const ACT_KIND_MERGE: &str = "merge";
/// How far back a dispatch's branch is still read.
pub(crate) const LOOKBACK_DAYS: i64 = 14;
/// Ledger rows one run reads.
pub(crate) const MAX_ROWS: u32 = 200;
/// Git readings one run may take (each is a handful of `git` children).
pub(crate) const MAX_PROBES_PER_SWEEP: usize = 10;

/// The git reading, injectable for tests: `Some` when `branch` moved at or
/// after `since_unix` and is now reachable from main.
pub(crate) type MergeProbe<'a> =
    &'a dyn Fn(&Path, &str, Option<&str>, i64) -> Option<MergeEvidence>;

/// The mandate a dispatch served, when it lets its steward merge.
fn steward_may_merge(m: &MandateSummary) -> bool {
    ship_rung_for_envelope(m.scope_rung, Some(&m.envelope)) >= RUNG_MAY_MERGE
}

/// The merge act for one detected merge.
pub(crate) fn merge_act(charter_id: &str, e: &MergeEvidence) -> NewCharterAct {
    NewCharterAct {
        charter_id: charter_id.to_string(),
        item_kind: ACT_KIND_MERGE.to_string(),
        item_id: e.branch.clone(),
        verdict: "merged".to_string(),
        actor: CharterActor::Steward,
        scope: None,
        reversible: false,
        cost_usd: None,
        shown_json: Some(
            serde_json::json!({ "branch": e.branch, "main": e.main, "tip": e.tip }).to_string(),
        ),
        origin_device: None,
    }
}

/// Record one detected merge on `charter_id`. `Ok(None)` when the charter
/// already holds that branch's merge, or is not a mandate.
pub(crate) fn record_merge(
    pool: &DbPool,
    charter_id: &str,
    e: &MergeEvidence,
) -> Result<Option<CharterAct>, crate::error::AppError> {
    match mandates::get(pool, charter_id) {
        Ok(Some(_)) => charter_acts::append_once(pool, &merge_act(charter_id, e)),
        // No charter, or a charter that is not a mandate: no row.
        Ok(None) | Err(crate::error::AppError::Validation(_)) => Ok(None),
        Err(e) => Err(e),
    }
}

/// One run over the live git readings.
pub(crate) fn merge_sweep(pool: &DbPool) -> Vec<CharterAct> {
    merge_sweep_with(pool, chrono::Utc::now(), &git_merged_since)
}

/// [`merge_sweep`] at `now`, with the git reading injected.
pub(crate) fn merge_sweep_with(
    pool: &DbPool,
    now: chrono::DateTime<chrono::Utc>,
    probe: MergeProbe<'_>,
) -> Vec<CharterAct> {
    let since = (now - chrono::Duration::days(LOOKBACK_DAYS)).to_rfc3339();
    let rows = match attention_ledger::recent_dispatch_branches(pool, &since, MAX_ROWS) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "mandate merges: the dispatch ledger is unreadable");
            return Vec::new();
        }
    };
    // One mandate read per charter, and one reading per (charter, branch).
    let mut charters: HashMap<String, Option<MandateSummary>> = HashMap::new();
    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut probes = 0usize;
    let mut out = Vec::new();
    for DispatchBranch {
        charter_id,
        branch,
        started_at,
    } in rows
    {
        if !seen.insert((charter_id.clone(), branch.clone())) {
            continue;
        }
        let mandate = charters
            .entry(charter_id.clone())
            .or_insert_with(|| mandates::get(pool, &charter_id).ok().flatten());
        let Some(mandate) = mandate.as_ref().filter(|m| steward_may_merge(m)) else {
            continue;
        };
        match charter_acts::has_item_act(pool, &charter_id, ACT_KIND_MERGE, &branch) {
            Ok(false) => {}
            Ok(true) => continue,
            Err(e) => {
                tracing::warn!(charter_id = %charter_id, error = %e, "mandate merges: acts unreadable");
                continue;
            }
        }
        if probes >= MAX_PROBES_PER_SWEEP {
            break;
        }
        let Some(since_unix) = chrono::DateTime::parse_from_rfc3339(&started_at)
            .ok()
            .map(|d| d.timestamp())
        else {
            continue;
        };
        let Ok(project) = crate::db::repos::dev_tools::get_project_by_id(pool, &mandate.project_id)
        else {
            continue;
        };
        probes += 1;
        let Some(evidence) = probe(
            Path::new(&project.root_path),
            &branch,
            project.main_branch.as_deref(),
            since_unix,
        ) else {
            continue;
        };
        match record_merge(pool, &charter_id, &evidence) {
            Ok(Some(act)) => {
                tracing::info!(charter_id = %charter_id, branch = %branch, tip = %evidence.tip,
                    "mandate merges: a steward merge recorded");
                out.push(act);
            }
            Ok(None) => {}
            Err(e) => {
                tracing::warn!(charter_id = %charter_id, branch = %branch, error = %e,
                    "mandate merges: the merge act was not recorded")
            }
        }
    }
    out
}

#[cfg(test)]
mod tests;
