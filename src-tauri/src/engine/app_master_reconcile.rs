//! **App master proposal reconciler** (P5a) — the tick that turns three
//! permanently-null backbone fields into readings.
//!
//! P4 shipped the App master mandate, the forbidden-class detector and the v2
//! rollup, and had to send `proposalsMerged`, `proposalsReverted` and
//! `gatePassRate` as `null` **every time**, because nothing in Personas
//! recorded any of them. kp's backbone reads an absent field as a coverage gap,
//! so the probation verdict was permanently `incomplete` — the review a human
//! is asked to take could never be about a complete record.
//!
//! This subscription is the missing observer. Once per tick, for every project
//! that carries an App master mandate:
//!
//! 1. **Discover** proposal branches (`autopilot/*` — the namespace the
//!    unattended dispatch guardrail *tells* the session to use) in the
//!    project's `root_path`, and record any new one in `app_master_proposals`
//!    together with the commits it carries, captured now, while the fork point
//!    still isolates them.
//! 2. **Gate** each newly-recorded proposal by running the repository's OWN
//!    declared gate commands against that branch in a throwaway worktree, and
//!    record one three-valued row per command in `app_master_gate_runs`. The
//!    commands come from the mandate's `approvalGates` (kp puts the dossier's
//!    `declaredGates` there) and from nowhere else; with none declared,
//!    nothing runs and the verdict is *not configured*.
//! 3. **Reconcile** every known proposal against the project's main branch:
//!    an ancestor tip is a merge, a later `Revert "<subject>"` /
//!    `This reverts commit <sha>` naming one of the proposal's commits is a
//!    revert.
//!
//! # Why here and not at dispatch
//!
//! The Overnight engine's dispatch is **asynchronous**: it spawns headless
//! fleet sessions and writes its ledger row immediately, long before any of
//! those sessions has authored a branch. A gate run wired into
//! `run_project_night` would therefore run against a branch that does not
//! exist yet — the gate would not see its target, which is precisely the
//! failure mode the `pre-authorship-verification` technique names. Observing
//! the branches after the fact is the only placement where the gate sees what
//! a human would actually merge.
//!
//! `dev_tools_apply_diff` is the other candidate chokepoint and is deliberately
//! left alone: it holds a *diff*, not a branch, it is a synchronous IPC command
//! a user is waiting on, and the forbidden-class detector already runs there.
//! Running a repository's full gate suite inside it would block the UI for
//! minutes.
//!
//! # What it costs when nothing is hired
//!
//! One `app_settings` prefix query. A project with no mandate is never touched,
//! and no git process is spawned.

use std::path::{Path, PathBuf};
use std::time::Duration;

use personas_engine::app_master_gates as gates;

use crate::db::DbPool;

use super::subscription::ReactiveSubscription;

/// How often to reconcile. A human merging a morning's proposal is a
/// day-scale event; 30 minutes is already far finer than the signal.
const TICK: Duration = Duration::from_secs(1800);

/// How many proposals one tick may newly gate. Gate suites are minutes each,
/// so a first pass over a repo with a long `autopilot/*` history spreads over
/// several ticks rather than monopolising one.
const MAX_GATED_PER_TICK: usize = gates::MAX_PROPOSALS_GATED_PER_TICK;

/// How far back to look for a revert, from the merge observation. A revert
/// that lands a year after the merge is a different decision than the one this
/// probation window is judging.
const REVERT_LOOKBACK_DAYS: i64 = 120;

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

/// What one reconciliation pass observed. Returned so the headless bridge's
/// on-demand tick (`docs/architecture/cloud-integration-bridge.md` §13) can
/// report what actually ran rather than "done". Every field is a count of
/// something the pass *witnessed* — no field is an estimate, and `errors`
/// carries the per-project failures verbatim instead of collapsing them into a
/// success.
#[derive(Debug, Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReconcileSummary {
    /// Projects carrying an App master mandate that were swept.
    pub projects: usize,
    /// Proposal branches seen in the `autopilot/*` namespace.
    pub branches_seen: usize,
    /// Branches recorded in `app_master_proposals` for the first time.
    pub newly_recorded: usize,
    /// Proposals whose declared gates were run this pass (capped per tick).
    pub gated: usize,
    pub errors: Vec<String>,
}

/// One reconciliation pass over every mandated project.
pub(crate) async fn reconcile_tick(pool: &DbPool) {
    let _ = reconcile_tick_summary(pool, None).await;
}

/// [`reconcile_tick`], counted, and optionally scoped to one project.
pub(crate) async fn reconcile_tick_summary(
    pool: &DbPool,
    only_project: Option<&str>,
) -> ReconcileSummary {
    let mut summary = ReconcileSummary::default();
    let mandates = personas_engine::app_master::load_mandates(pool);
    if mandates.is_empty() {
        return summary;
    }
    for (project_id, record) in mandates {
        if only_project.is_some_and(|want| want != project_id) {
            continue;
        }
        summary.projects += 1;
        match reconcile_project(pool, &project_id, &record).await {
            Ok(counts) => {
                summary.branches_seen += counts.branches_seen;
                summary.newly_recorded += counts.newly_recorded;
                summary.gated += counts.gated;
            }
            Err(e) => {
                summary.errors.push(format!("{project_id}: {e}"));
                tracing::warn!(
                    project_id = %project_id,
                    error = %e,
                    "app_master_reconcile: project pass failed"
                );
            }
        }
    }
    summary
}

/// What one project's pass observed.
#[derive(Debug, Default)]
struct ProjectCounts {
    branches_seen: usize,
    newly_recorded: usize,
    gated: usize,
}

/// Reconcile one project. Returns `Err` only for conditions worth logging;
/// "nothing to do" is `Ok`.
async fn reconcile_project(
    pool: &DbPool,
    project_id: &str,
    record: &personas_engine::app_master::MandateRecord,
) -> Result<ProjectCounts, String> {
    let mut counts = ProjectCounts::default();
    let project = crate::db::repos::dev_tools::get_project_by_id(pool, project_id)
        .map_err(|e| format!("project row unreadable: {e}"))?;
    let root = PathBuf::from(&project.root_path);
    if project.root_path.trim().is_empty() || !root.exists() {
        // A URL-only App master (a known P4 gap). Nothing to observe on disk;
        // the ledger stays empty and the reporter keeps saying `null`, which is
        // the truth about this project.
        return Ok(counts);
    }
    // A path that is not a git work tree has no proposals by definition — and
    // git would otherwise walk up to a PARENT repository and answer about
    // somebody else's branches.
    if gates::git(&root, &["rev-parse", "--is-inside-work-tree"])
        .await
        .map(|s| s.trim() != "true")
        .unwrap_or(true)
    {
        return Ok(counts);
    }

    let Some(main_branch) = gates::resolve_main_branch(&root, project.main_branch.as_deref()).await
    else {
        return Err(
            "no main branch resolves in the checkout; skipping rather than \
                    computing a merge verdict against a branch nobody merges into"
                .into(),
        );
    };

    // -- 1. Discover ---------------------------------------------------------
    let branches = gates::list_proposal_branches(&root)
        .await
        .map_err(|e| format!("branch discovery failed: {e}"))?;
    counts.branches_seen = branches.len();
    let mut newly_seen: Vec<String> = Vec::new();
    for branch in &branches {
        let known = gates::get_proposal(pool, project_id, branch)
            .ok()
            .flatten()
            .is_some();
        let head = match gates::git(&root, &["rev-parse", branch]).await {
            Ok(h) => h,
            Err(e) => {
                tracing::warn!(project_id, branch, error = %e,
                    "app_master_reconcile: could not resolve a proposal branch tip");
                continue;
            }
        };
        let (base, commits) = gates::branch_commits(&root, &main_branch, branch)
            .await
            .unwrap_or((None, Vec::new()));
        if let Err(e) = gates::upsert_proposal(
            pool,
            project_id,
            &record.persona_id,
            branch,
            &head,
            base.as_deref(),
            &commits,
        ) {
            tracing::warn!(project_id, branch, error = %e,
                "app_master_reconcile: could not record a proposal");
            continue;
        }
        if !known {
            newly_seen.push(branch.clone());
            counts.newly_recorded += 1;
        }
    }

    // -- 2. Gate the ungated -------------------------------------------------
    let ungated: Vec<gates::Proposal> = gates::list_proposals(pool, project_id)
        .unwrap_or_default()
        .into_iter()
        .filter(|p| p.gates_ran_at.is_none() && branches.contains(&p.branch))
        .take(MAX_GATED_PER_TICK)
        .collect();
    for proposal in ungated {
        let sweep = gates::run_declared_gates(
            pool,
            project_id,
            &record.persona_id,
            &root,
            &proposal.branch,
        )
        .await;
        // Stamp the attempt either way. A project with no declared gates would
        // otherwise be re-attempted every tick forever; a "not configured"
        // verdict is a real, recorded answer.
        let _ = gates::mark_gates_ran(pool, &proposal.id, &chrono::Utc::now().to_rfc3339());
        counts.gated += 1;
        tracing::info!(
            project_id,
            branch = %proposal.branch,
            source = sweep.source.as_str(),
            "app_master_reconcile: {}",
            sweep.verdict()
        );
    }

    // -- 3. Merge / revert ---------------------------------------------------
    for proposal in gates::list_proposals(pool, project_id).unwrap_or_default() {
        reconcile_one(pool, &root, &main_branch, &proposal).await;
    }

    if !newly_seen.is_empty() {
        tracing::info!(
            project_id,
            count = newly_seen.len(),
            "app_master_reconcile: recorded new proposal branch(es): {}",
            newly_seen.join(", ")
        );
    }
    Ok(counts)
}

/// Observe one proposal's fate on the main branch.
async fn reconcile_one(pool: &DbPool, root: &Path, main_branch: &str, proposal: &gates::Proposal) {
    if proposal.merged_at.is_none() {
        if !gates::is_merged(root, main_branch, &proposal.head_sha).await {
            return;
        }
        let (at, sha) = gates::merge_point(root, main_branch, &proposal.head_sha)
            .await
            // A tip that IS on main but whose landing point cannot be dated is
            // still merged. Dating it "now" over-states recency, so the merge
            // is recorded at the observation time and the sha left null —
            // "we saw it land, we cannot say exactly when".
            .unwrap_or_else(|| (chrono::Utc::now().to_rfc3339(), None));
        if let Err(e) = gates::mark_merged(pool, &proposal.id, &at, sha.as_deref()) {
            tracing::warn!(branch = %proposal.branch, error = %e,
                "app_master_reconcile: could not record a merge");
            return;
        }
        tracing::info!(
            branch = %proposal.branch,
            merged_at = %at,
            "app_master_reconcile: proposal observed on the main branch"
        );
    }

    // Reverts are only meaningful for merged work, and only until one is found.
    let merged_at = match gates::get_proposal(pool, &proposal.project_id, &proposal.branch) {
        Ok(Some(p)) if p.reverted_at.is_none() => match p.merged_at {
            Some(at) => at,
            None => return,
        },
        _ => return,
    };
    let since = revert_window_start(&merged_at);
    if let Some((at, sha)) = gates::find_revert(root, main_branch, &since, &proposal.commits).await
    {
        if let Err(e) = gates::mark_reverted(pool, &proposal.id, &at, &sha) {
            tracing::warn!(branch = %proposal.branch, error = %e,
                "app_master_reconcile: could not record a revert");
            return;
        }
        tracing::info!(
            branch = %proposal.branch,
            reverted_at = %at,
            revert_sha = %sha,
            "app_master_reconcile: a merged proposal was reverted on the main branch"
        );
    }
}

/// The `--since` bound for revert scanning: the merge date, or (when it does
/// not parse) a bounded lookback from now. Never unbounded — a full-history
/// `git log` on a large repository inside a background tick is a stall.
fn revert_window_start(merged_at: &str) -> String {
    match chrono::DateTime::parse_from_rfc3339(merged_at) {
        Ok(dt) => dt.to_rfc3339(),
        Err(_) => (chrono::Utc::now() - chrono::Duration::days(REVERT_LOOKBACK_DAYS)).to_rfc3339(),
    }
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

/// Periodic proposal reconciler for App-master-mandated projects.
pub struct AppMasterReconcileSubscription {
    pub pool: DbPool,
}

#[async_trait::async_trait]
impl ReactiveSubscription for AppMasterReconcileSubscription {
    fn name(&self) -> &'static str {
        "app_master_reconcile"
    }

    fn interval(&self) -> Duration {
        TICK
    }

    fn initial_delay(&self) -> Duration {
        // Later than the probation tick on purpose: this one may spawn a repo's
        // gate suite, and launch is the worst moment to do that.
        Duration::from_secs(600)
    }

    async fn tick(&self) {
        reconcile_tick(&self.pool).await;
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // The git plumbing this module drives (branch discovery, merge detection,
    // revert detection, the gate sweep in a worktree) is tested against a real
    // throwaway repository in `personas_engine::app_master_gates::tests` —
    // where the functions live. Only the tick's own policy is tested here.

    #[test]
    fn revert_window_falls_back_to_a_bounded_lookback() {
        let ok = revert_window_start("2026-08-10T00:00:00+00:00");
        assert!(ok.starts_with("2026-08-10"));
        // Garbage in must not produce an unbounded `git log` over full history
        // inside a background tick.
        let fallback = revert_window_start("not a date");
        assert!(chrono::DateTime::parse_from_rfc3339(&fallback).is_ok());
    }
}
