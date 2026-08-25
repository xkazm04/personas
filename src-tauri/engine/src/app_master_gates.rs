//! **App master proposal + gate ledgers** (P5a) — the three readings the
//! backbone had no instrument for.
//!
//! kp scores an App master on a deterministic `PerformanceBackbone`
//! (kp `docs/features/app-master/README.md`, "the deterministic performance
//! backbone"). Reporter v2 (P4) filled most of it from ledgers that already
//! existed and sent three fields as `null` **always**, because nothing in
//! Personas recorded them:
//!
//! | Field | Why it was null |
//! | --- | --- |
//! | `proposalsMerged` | nothing observed an autopilot branch landing |
//! | `proposalsReverted` | nothing observed one being taken back |
//! | `gatePassRate` | Personas ran persona-lab tests, never the repository's own gates |
//!
//! A field that is always null is not a measurement, and kp's backbone scores
//! it as a coverage gap — so the probation verdict was permanently
//! `incomplete`. This module is the missing record. It does **not** invent the
//! numbers; it takes them the only way they are honest:
//!
//! 1. **Gates come from the repository, never from imagination.** The command
//!    list is the mandate's `approvalGates` — which is what kp put the
//!    dossier's `declaredGates` into on the wire. When that list is empty the
//!    verdict is *not configured* and **nothing runs**; a plausible-looking
//!    `npm test` we made up would produce a green about a check nobody runs.
//!    (`gate-sees-target` / `failure-not-empty-success`, registry technique
//!    `pre-authorship-verification`.)
//! 2. **A gate runs against the proposal branch**, in a throwaway worktree, so
//!    it sees what a human would merge and never disturbs a shared checkout.
//!    Repos like kp run concurrent agent sessions in one tree; a gate that
//!    checked out a branch under them would be a bug we shipped into somebody
//!    else's work. The worktree **borrows the source checkout's installed
//!    dependencies** ([`borrow_installed_deps`]) — a fresh worktree has no
//!    `node_modules`, so before this every `npm run …` gate failed for a
//!    reason that had nothing to do with the proposal, and a `gatePassRate` of
//!    0 was a false reading, not a verdict.
//! 3. **Three-valued outcomes.** `passed` / `failed` / `did_not_run`. A
//!    timeout or a spawn failure is `did_not_run`: it is not a pass, it is not
//!    a failure, and it is excluded from both halves of the pass-rate ratio.
//!    An empty denominator yields `None`, never `0.0`.
//! 4. **Merge and revert are observed, not assumed.** `merged_at` is set when
//!    `git merge-base --is-ancestor <branch> <main>` says the branch's tip is
//!    on the main branch; `reverted_at` when a later main-branch commit says
//!    `Revert "<subject>"` or `This reverts commit <sha>` about one of the
//!    proposal's own commits. `NULL` means *not observed*, never *did not
//!    happen*, and the reporter turns "no proposals at all" into `None` rather
//!    than `0`.
//!
//! The proposal's commit list is captured **at discovery**, before any merge.
//! After a merge the branch is an ancestor of main and the fork point no
//! longer isolates its commits — revert detection needs the subjects it had
//! beforehand.

use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use personas_core::error::AppError;
use personas_db::DbPool;
use rusqlite::params;

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/// Default per-command wall clock. A gate that has not answered in ten minutes
/// is not going to answer usefully inside a background tick.
pub const DEFAULT_GATE_TIMEOUT_SECS: u64 = 600;

/// Environment override for [`DEFAULT_GATE_TIMEOUT_SECS`]. Read per run so an
/// operator can widen it without a restart.
pub const GATE_TIMEOUT_ENV: &str = "PERSONAS_APP_MASTER_GATE_TIMEOUT_SECS";

/// Hard cap on how many declared gate commands one proposal may run. The
/// mandate is authored elsewhere (kp) and a runaway list would turn one tick
/// into an unbounded build farm.
pub const MAX_GATES_PER_PROPOSAL: usize = 12;

/// Hard cap on how many proposals one tick may gate. Bounds a first run over a
/// repo with a long history of `autopilot/*` branches.
pub const MAX_PROPOSALS_GATED_PER_TICK: usize = 3;

/// Bound on the stored `first_error` — it is read by an agent and by a review
/// packet, not by a log grepper.
pub const MAX_FIRST_ERROR_CHARS: usize = 400;

/// Bound on commits captured per proposal. A branch with more than this is
/// recorded truncated rather than unbounded; revert detection degrades to the
/// captured prefix and says so by carrying fewer commits, not by claiming
/// more.
pub const MAX_PROPOSAL_COMMITS: usize = 50;

/// The branch namespace the unattended dispatch guardrail mandates
/// (`dev_tools::UNATTENDED_DISPATCH_GUARDRAILS`: "a dedicated branch named
/// `autopilot/<short-slug>`"). The reconciler discovers proposals by this
/// prefix because it is the contract the prompt states — not a guess about
/// what an agent might have named things.
pub const PROPOSAL_BRANCH_PREFIX: &str = "autopilot/";

pub fn gate_timeout() -> Duration {
    let secs = std::env::var(GATE_TIMEOUT_ENV)
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_GATE_TIMEOUT_SECS);
    Duration::from_secs(secs)
}

// ---------------------------------------------------------------------------
// Where the gate commands come from
// ---------------------------------------------------------------------------

/// Which authority produced the gate command list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GateSource {
    /// The App master mandate's `approvalGates`, i.e. the dossier's
    /// `declaredGates` as kp put them on the wire. The only source there is.
    Mandate,
    /// No declared gate command exists for this project. Reported distinctly
    /// from "passed" and from "failed": nothing ran, and nothing should.
    NotConfigured,
}

impl GateSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mandate => "mandate.approvalGates",
            Self::NotConfigured => "not configured",
        }
    }
}

/// The declared gate commands for a project, and where they came from.
///
/// **Order of authority, and there is exactly one entry in it today:** the
/// persisted [`crate::app_master::MandateRecord`]'s `approval_gates`. kp
/// composes that list from the repo dossier's `declaredGates`, so it *is* the
/// repository's own declaration as far as this process can see it.
///
/// `dev_projects.standards_config` was considered and rejected as a second
/// source: its `precommit` block holds policy flags (`{lint, docs_required,
/// code_quality}`), not commands, so reading a command out of it would mean
/// inventing one.
pub fn declared_gate_commands(pool: &DbPool, project_id: &str) -> (Vec<String>, GateSource) {
    let Some(record) = crate::app_master::get_mandate(pool, project_id) else {
        return (Vec::new(), GateSource::NotConfigured);
    };
    let cmds: Vec<String> = record
        .mandate
        .approval_gates
        .iter()
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
        .take(MAX_GATES_PER_PROPOSAL)
        .collect();
    if cmds.is_empty() {
        (Vec::new(), GateSource::NotConfigured)
    } else {
        (cmds, GateSource::Mandate)
    }
}

// ---------------------------------------------------------------------------
// Gate runs
// ---------------------------------------------------------------------------

/// The three-valued outcome of one gate command on one proposal branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GateOutcome {
    Passed,
    Failed,
    /// The command was never given a chance to answer — it timed out, or the
    /// shell could not spawn it, or the worktree it needed did not exist.
    /// **Not a pass.** Excluded from the pass-rate ratio entirely.
    DidNotRun,
}

impl GateOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Passed => "passed",
            Self::Failed => "failed",
            Self::DidNotRun => "did_not_run",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "passed" => Some(Self::Passed),
            "failed" => Some(Self::Failed),
            "did_not_run" => Some(Self::DidNotRun),
            _ => None,
        }
    }

    /// Does this outcome belong in the pass-rate denominator?
    pub fn counts_toward_rate(self) -> bool {
        !matches!(self, Self::DidNotRun)
    }
}

/// One recorded run of one declared gate command against one proposal branch.
#[derive(Debug, Clone, PartialEq)]
pub struct GateRun {
    pub id: String,
    pub project_id: String,
    pub persona_id: String,
    pub branch: String,
    pub command: String,
    /// `None` exactly when [`GateOutcome::DidNotRun`] — there was no exit code
    /// to read.
    pub exit_code: Option<i32>,
    pub outcome: GateOutcome,
    pub duration_ms: i64,
    /// First real error line, bounded. `None` on a pass.
    pub first_error: Option<String>,
    pub ran_at: String,
}

impl GateRun {
    pub fn new(
        project_id: &str,
        persona_id: &str,
        branch: &str,
        command: &str,
        outcome: GateOutcome,
        exit_code: Option<i32>,
        duration_ms: i64,
        first_error: Option<String>,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: project_id.to_string(),
            persona_id: persona_id.to_string(),
            branch: branch.to_string(),
            command: command.to_string(),
            exit_code,
            outcome,
            duration_ms,
            first_error: first_error.map(|e| truncate(&e, MAX_FIRST_ERROR_CHARS)),
            ran_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    /// One line per stage, the way the technique's verdict contract asks for
    /// it — *not configured* and *did not run* are visibly distinct from
    /// *passed*.
    pub fn one_line(&self) -> String {
        match self.outcome {
            GateOutcome::Passed => format!("PASS  {} ({} ms)", self.command, self.duration_ms),
            GateOutcome::Failed => format!(
                "FAIL  {} (exit {}) — {}",
                self.command,
                self.exit_code.unwrap_or(-1),
                self.first_error.as_deref().unwrap_or("(no error captured)")
            ),
            GateOutcome::DidNotRun => format!(
                "DID NOT RUN  {} — {}",
                self.command,
                self.first_error
                    .as_deref()
                    .unwrap_or("(no reason captured)")
            ),
        }
    }
}

/// Persist one gate run.
pub fn record_gate_run(pool: &DbPool, run: &GateRun) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT OR REPLACE INTO app_master_gate_runs
            (id, project_id, persona_id, branch, command, exit_code, outcome,
             duration_ms, first_error, ran_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            run.id,
            run.project_id,
            run.persona_id,
            run.branch,
            run.command,
            run.exit_code,
            run.outcome.as_str(),
            run.duration_ms,
            run.first_error,
            run.ran_at,
        ],
    )?;
    Ok(())
}

/// Pure pass-rate math: passed / (passed + failed).
///
/// **`did_not_run` is in neither half.** It is a hole in the instrument, so it
/// can neither raise nor lower the rate — the alternative (counting it as a
/// failure) would turn a flaky spawn into a performance claim about the
/// holder, and counting it as a pass would be a lie.
///
/// `None` when nothing counted: an empty set has no rate, and `0.0` would read
/// in kp as "every gate failed".
pub fn pass_rate(outcomes: &[GateOutcome]) -> Option<f64> {
    let counted: Vec<GateOutcome> = outcomes
        .iter()
        .copied()
        .filter(|o| o.counts_toward_rate())
        .collect();
    if counted.is_empty() {
        return None;
    }
    let passed = counted
        .iter()
        .filter(|o| matches!(o, GateOutcome::Passed))
        .count();
    Some(passed as f64 / counted.len() as f64)
}

/// The SQL fragment that attributes a project-scoped ledger row to ONE holder.
///
/// `NULL` persona means "do not filter" (the caller could not name a holder).
/// A row whose `persona_id` is `''` predates per-holder attribution — it cannot
/// belong to somebody else, so excluding it would delete a real reading rather
/// than reattribute it.
const PERSONA_PREDICATE: &str = "(?3 IS NULL OR persona_id = ?3 OR persona_id = '')";

/// Every gate outcome recorded for a project since `since` (RFC-3339),
/// optionally narrowed to one holder.
///
/// `since` is the [`crate::app_master::TenureWindow`]'s lower bound, not the
/// calendar month: a gate that ran for the PREVIOUS holder of this project is
/// not evidence about the current one (bench sweep #17).
pub fn gate_outcomes_since(
    pool: &DbPool,
    project_id: &str,
    persona_id: Option<&str>,
    since: &str,
) -> Result<Vec<GateOutcome>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(&format!(
        "SELECT outcome FROM app_master_gate_runs
         WHERE project_id = ?1 AND ran_at >= ?2 AND {PERSONA_PREDICATE}"
    ))?;
    let rows = stmt.query_map(params![project_id, since, persona_id], |r| {
        r.get::<_, String>(0)
    })?;
    Ok(rows
        .flatten()
        .filter_map(|s| GateOutcome::parse(&s))
        .collect())
}

/// The holder's gate pass rate over the window, or `None` when no gate
/// command actually ran in it (never `0.0`).
pub fn gate_pass_rate_since(
    pool: &DbPool,
    project_id: &str,
    persona_id: Option<&str>,
    since: &str,
) -> Option<f64> {
    let outcomes = gate_outcomes_since(pool, project_id, persona_id, since).ok()?;
    pass_rate(&outcomes)
}

/// Gate runs for one branch, newest first — the review-packet / debug read.
pub fn gate_runs_for_branch(
    pool: &DbPool,
    project_id: &str,
    branch: &str,
) -> Result<Vec<GateRun>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, project_id, persona_id, branch, command, exit_code, outcome,
                duration_ms, first_error, ran_at
         FROM app_master_gate_runs
         WHERE project_id = ?1 AND branch = ?2
         ORDER BY ran_at DESC",
    )?;
    let rows = stmt.query_map(params![project_id, branch], |r| {
        Ok(GateRun {
            id: r.get(0)?,
            project_id: r.get(1)?,
            persona_id: r.get(2)?,
            branch: r.get(3)?,
            command: r.get(4)?,
            exit_code: r.get(5)?,
            outcome: GateOutcome::parse(&r.get::<_, String>(6)?).unwrap_or(GateOutcome::DidNotRun),
            duration_ms: r.get(7)?,
            first_error: r.get(8)?,
            ran_at: r.get(9)?,
        })
    })?;
    Ok(rows.flatten().collect())
}

// ---------------------------------------------------------------------------
// Bounded, agent-readable failure extraction
// ---------------------------------------------------------------------------

/// Needles that mark a line as the first *real* failure rather than a banner.
const ERROR_NEEDLES: &[&str] = &[
    "error:",
    "error[",
    "error ",
    "failed:",
    " failed",
    "failure:",
    "panicked at",
    "assertionerror",
    "exception:",
    "traceback (most recent call last)",
    "fatal:",
    "✗",
    "✖",
    "not ok ",
];

/// Locate the first real failure line in a command's output.
///
/// Verdict-first output contracts ask for the first *located* failure, not a
/// log dump — an agent acting on this needs one line it can search for, and a
/// review packet needs something a human can read at a glance. Preference
/// order: an error-shaped line in stderr, an error-shaped line in stdout, the
/// first non-empty stderr line, the **last** non-empty stdout line (runners
/// that summarise at the end).
pub fn first_error_line(stdout: &str, stderr: &str) -> Option<String> {
    let shaped = |text: &str| -> Option<String> {
        text.lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .find(|l| {
                let lower = l.to_lowercase();
                ERROR_NEEDLES.iter().any(|n| lower.contains(n))
            })
            .map(|l| truncate(l, MAX_FIRST_ERROR_CHARS))
    };
    shaped(stderr)
        .or_else(|| shaped(stdout))
        .or_else(|| {
            stderr
                .lines()
                .map(str::trim)
                .find(|l| !l.is_empty())
                .map(|l| truncate(l, MAX_FIRST_ERROR_CHARS))
        })
        .or_else(|| {
            stdout
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .next_back()
                .map(|l| truncate(l, MAX_FIRST_ERROR_CHARS))
        })
}

fn truncate(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max.saturating_sub(1)).collect();
    format!("{head}…")
}

// ---------------------------------------------------------------------------
// The proposal ledger
// ---------------------------------------------------------------------------

/// One commit on a proposal branch, captured at discovery.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProposalCommit {
    pub sha: String,
    pub subject: String,
}

/// A proposal branch the reconciler has seen.
#[derive(Debug, Clone, PartialEq)]
pub struct Proposal {
    pub id: String,
    pub project_id: String,
    pub persona_id: String,
    pub branch: String,
    pub head_sha: String,
    pub base_sha: Option<String>,
    pub commits: Vec<ProposalCommit>,
    pub first_seen_at: String,
    /// `None` = not observed on the main branch. Never "did not merge".
    pub merged_at: Option<String>,
    pub merge_sha: Option<String>,
    pub reverted_at: Option<String>,
    pub revert_sha: Option<String>,
    /// `None` = the declared gates have not been run against this branch yet
    /// (or there are none declared).
    pub gates_ran_at: Option<String>,
}

fn row_to_proposal(r: &rusqlite::Row<'_>) -> rusqlite::Result<Proposal> {
    let commits_json: String = r.get(6)?;
    Ok(Proposal {
        id: r.get(0)?,
        project_id: r.get(1)?,
        persona_id: r.get(2)?,
        branch: r.get(3)?,
        head_sha: r.get(4)?,
        base_sha: r.get(5)?,
        commits: serde_json::from_str(&commits_json).unwrap_or_default(),
        first_seen_at: r.get(7)?,
        merged_at: r.get(8)?,
        merge_sha: r.get(9)?,
        reverted_at: r.get(10)?,
        revert_sha: r.get(11)?,
        gates_ran_at: r.get(12)?,
    })
}

const PROPOSAL_COLUMNS: &str = "id, project_id, persona_id, branch, head_sha, base_sha, commits, \
     first_seen_at, merged_at, merge_sha, reverted_at, revert_sha, gates_ran_at";

/// Record a newly-discovered proposal branch. Idempotent on
/// `(project_id, branch)`: re-seeing a known branch refreshes its head sha and
/// commit list but **never** clears an observation already made (a merge seen
/// once stays seen).
pub fn upsert_proposal(
    pool: &DbPool,
    project_id: &str,
    persona_id: &str,
    branch: &str,
    head_sha: &str,
    base_sha: Option<&str>,
    commits: &[ProposalCommit],
) -> Result<Proposal, AppError> {
    let conn = pool.get()?;
    let commits_json = serde_json::to_string(
        &commits
            .iter()
            .take(MAX_PROPOSAL_COMMITS)
            .cloned()
            .collect::<Vec<_>>(),
    )
    .unwrap_or_else(|_| "[]".to_string());
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO app_master_proposals
            (id, project_id, persona_id, branch, head_sha, base_sha, commits, first_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(project_id, branch) DO UPDATE SET
            head_sha = excluded.head_sha,
            base_sha = COALESCE(app_master_proposals.base_sha, excluded.base_sha),
            commits  = CASE
                         WHEN app_master_proposals.commits IN ('', '[]')
                         THEN excluded.commits
                         ELSE app_master_proposals.commits
                       END,
            persona_id = CASE
                           WHEN app_master_proposals.persona_id = ''
                           THEN excluded.persona_id
                           ELSE app_master_proposals.persona_id
                         END",
        params![
            uuid::Uuid::new_v4().to_string(),
            project_id,
            persona_id,
            branch,
            head_sha,
            base_sha,
            commits_json,
            now,
        ],
    )?;
    get_proposal(pool, project_id, branch)?.ok_or_else(|| {
        AppError::Internal("app_master_gates: proposal vanished after insert".into())
    })
}

pub fn get_proposal(
    pool: &DbPool,
    project_id: &str,
    branch: &str,
) -> Result<Option<Proposal>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {PROPOSAL_COLUMNS} FROM app_master_proposals
         WHERE project_id = ?1 AND branch = ?2"
    ))?;
    let mut rows = stmt.query_map(params![project_id, branch], row_to_proposal)?;
    Ok(rows.next().and_then(Result::ok))
}

/// Every proposal recorded for a project, newest first.
pub fn list_proposals(pool: &DbPool, project_id: &str) -> Result<Vec<Proposal>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {PROPOSAL_COLUMNS} FROM app_master_proposals
         WHERE project_id = ?1 ORDER BY first_seen_at DESC"
    ))?;
    let rows = stmt.query_map(params![project_id], row_to_proposal)?;
    Ok(rows.flatten().collect())
}

/// Mark a proposal observed on the main branch.
pub fn mark_merged(
    pool: &DbPool,
    proposal_id: &str,
    merged_at: &str,
    merge_sha: Option<&str>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE app_master_proposals
         SET merged_at = COALESCE(merged_at, ?2), merge_sha = COALESCE(merge_sha, ?3)
         WHERE id = ?1",
        params![proposal_id, merged_at, merge_sha],
    )?;
    Ok(())
}

/// Mark a merged proposal observed as reverted.
pub fn mark_reverted(
    pool: &DbPool,
    proposal_id: &str,
    reverted_at: &str,
    revert_sha: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE app_master_proposals
         SET reverted_at = COALESCE(reverted_at, ?2), revert_sha = COALESCE(revert_sha, ?3)
         WHERE id = ?1",
        params![proposal_id, reverted_at, revert_sha],
    )?;
    Ok(())
}

/// Stamp the moment the declared gates last ran against a proposal.
pub fn mark_gates_ran(pool: &DbPool, proposal_id: &str, at: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE app_master_proposals SET gates_ran_at = ?2 WHERE id = ?1",
        params![proposal_id, at],
    )?;
    Ok(())
}

/// Merge / revert counts over a window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProposalCounts {
    /// Proposal branches first seen in the window.
    pub seen: i64,
    /// Of the project's proposals, how many merged **in** the window.
    pub merged: i64,
    /// Of the project's proposals, how many were reverted **in** the window.
    pub reverted: i64,
}

/// Count merges and reverts for the window.
///
/// `None` when the project has **no proposal rows at all** — with no proposal
/// ledger there is nothing to be right or wrong about, and a `0` would read in
/// kp as "opened work, landed none". Once even one proposal exists, a `0`
/// merged is a real reading: something was authored and nothing landed.
///
/// The window is applied to the *observation* (`merged_at` / `reverted_at`),
/// not to the proposal's first sighting: a branch opened last month and merged
/// this month is this month's merge.
///
/// `persona_id` narrows every count — including the "does a ledger exist at
/// all" probe — to one holder. A brand-new hire on a project whose only
/// proposals belong to its predecessor therefore reads `None` (no record of its
/// own), not the predecessor's numbers (bench sweep #17).
pub fn proposal_counts_since(
    pool: &DbPool,
    project_id: &str,
    persona_id: Option<&str>,
    since: &str,
) -> Option<ProposalCounts> {
    let conn = pool.get().ok()?;
    // `?2` (the window bound) is always supplied; the unwindowed `total` shape
    // simply does not reference it, which SQLite allows.
    let count = |window_clause: &str| -> Option<i64> {
        let sql = format!(
            "SELECT COUNT(*) FROM app_master_proposals
             WHERE project_id = ?1 AND {PERSONA_PREDICATE}{window_clause}"
        );
        conn.query_row(&sql, params![project_id, since, persona_id], |r| r.get(0))
            .ok()
    };
    let total: i64 = count("")?;
    if total == 0 {
        return None;
    }
    let seen = count(" AND first_seen_at >= ?2").unwrap_or(0);
    let merged = count(" AND merged_at IS NOT NULL AND merged_at >= ?2").unwrap_or(0);
    let reverted = count(" AND reverted_at IS NOT NULL AND reverted_at >= ?2").unwrap_or(0);
    Some(ProposalCounts {
        seen,
        merged,
        reverted,
    })
}

// ---------------------------------------------------------------------------
// Revert detection (pure)
// ---------------------------------------------------------------------------

/// Does this main-branch commit message revert one of `commits`?
///
/// Two shapes, both of them things git itself writes:
/// - the subject `Revert "<original subject>"` (`git revert` / GitHub's revert)
/// - the body line `This reverts commit <sha>` (git's own trailer)
///
/// A sha match uses prefix comparison in both directions, because the trailer
/// carries the full 40-char sha while a ledger may hold an abbreviation.
/// Prefixes shorter than 7 characters are ignored — below that, a "match" is
/// a coincidence.
pub fn message_reverts(message: &str, commits: &[ProposalCommit]) -> bool {
    if commits.is_empty() {
        return false;
    }
    let mut lines = message.lines();
    let subject = lines.next().unwrap_or("").trim();

    // Shape 1: Revert "<subject>"
    if let Some(inner) = subject
        .strip_prefix("Revert \"")
        .and_then(|r| r.strip_suffix('"'))
    {
        let inner = inner.trim();
        if !inner.is_empty()
            && commits
                .iter()
                .any(|c| c.subject.trim() == inner || strip_revert(&c.subject) == inner)
        {
            return true;
        }
    }

    // Shape 2: This reverts commit <sha>
    for line in message.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix("This reverts commit ") else {
            continue;
        };
        let sha: String = rest
            .trim()
            .trim_end_matches('.')
            .chars()
            .take_while(|c| c.is_ascii_hexdigit())
            .collect();
        if sha.len() < 7 {
            continue;
        }
        if commits.iter().any(|c| sha_matches(&c.sha, &sha)) {
            return true;
        }
    }
    false
}

fn strip_revert(subject: &str) -> &str {
    subject
        .trim()
        .strip_prefix("Revert \"")
        .and_then(|r| r.strip_suffix('"'))
        .unwrap_or(subject)
        .trim()
}

fn sha_matches(a: &str, b: &str) -> bool {
    let (a, b) = (a.trim().to_lowercase(), b.trim().to_lowercase());
    if a.len() < 7 || b.len() < 7 {
        return false;
    }
    a.starts_with(&b) || b.starts_with(&a)
}

// ---------------------------------------------------------------------------
// Git plumbing (bounded, cwd-scoped, read-only except for the worktree)
// ---------------------------------------------------------------------------

/// Run one git command in `cwd`, returning trimmed stdout. Errors carry
/// git's own stderr, bounded.
pub async fn git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let out = tokio::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|e| format!("git {}: {e}", args.join(" ")))?;
    if !out.status.success() {
        return Err(truncate(
            &format!(
                "git {} failed: {}",
                args.join(" "),
                String::from_utf8_lossy(&out.stderr)
            ),
            MAX_FIRST_ERROR_CHARS,
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Resolve the project's main branch: the recorded `main_branch` if it exists
/// as a ref, else whichever of `main` / `master` does. `None` when neither
/// resolves — better a skipped reconciliation than a merge verdict computed
/// against a branch that is not the one people merge into.
pub async fn resolve_main_branch(cwd: &Path, recorded: Option<&str>) -> Option<String> {
    let mut candidates: Vec<String> = Vec::new();
    if let Some(r) = recorded.map(str::trim).filter(|r| !r.is_empty()) {
        candidates.push(r.to_string());
    }
    candidates.push("main".to_string());
    candidates.push("master".to_string());
    for c in candidates {
        if git(
            cwd,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("{c}^{{commit}}"),
            ],
        )
        .await
        .is_ok()
        {
            return Some(c);
        }
    }
    None
}

/// Local branches under [`PROPOSAL_BRANCH_PREFIX`].
pub async fn list_proposal_branches(cwd: &Path) -> Result<Vec<String>, String> {
    let out = git(
        cwd,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            &format!("refs/heads/{PROPOSAL_BRANCH_PREFIX}*"),
        ],
    )
    .await?;
    Ok(out
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect())
}

/// The commits a branch carries relative to `main` — captured at discovery,
/// while the fork point still isolates them.
pub async fn branch_commits(
    cwd: &Path,
    main_branch: &str,
    branch: &str,
) -> Result<(Option<String>, Vec<ProposalCommit>), String> {
    let base = git(cwd, &["merge-base", main_branch, branch]).await.ok();
    let range = match &base {
        Some(b) => format!("{b}..{branch}"),
        None => branch.to_string(),
    };
    let log = git(
        cwd,
        &[
            "log",
            "--no-merges",
            "--format=%H%x1f%s",
            &format!("-{MAX_PROPOSAL_COMMITS}"),
            &range,
        ],
    )
    .await?;
    let commits = log
        .lines()
        .filter_map(|l| {
            let (sha, subject) = l.split_once('\u{1f}')?;
            Some(ProposalCommit {
                sha: sha.trim().to_string(),
                subject: subject.trim().to_string(),
            })
        })
        .collect();
    Ok((base, commits))
}

/// Is `branch`'s tip an ancestor of `main_branch`? That is the merge signal:
/// the proposal's work is on the branch people ship from, however it got there
/// (merge commit, squash-with-the-same-tip, fast-forward, cherry-pick of the
/// tip).
///
/// A **squash** merge rewrites the commits and is therefore NOT detected here —
/// stated rather than papered over. It reads as "not merged", which
/// under-reports rather than over-reports the holder's delivery.
pub async fn is_merged(cwd: &Path, main_branch: &str, tip: &str) -> bool {
    tokio::process::Command::new("git")
        .args(["merge-base", "--is-ancestor", tip, main_branch])
        .current_dir(cwd)
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// When the work landed: the committer date of the earliest main-branch commit
/// that descends from `tip` (the merge commit, in the usual case), falling back
/// to the tip's own committer date for a fast-forward where the tip *is* on
/// main. Returns `(iso_date, sha)`.
pub async fn merge_point(
    cwd: &Path,
    main_branch: &str,
    tip: &str,
) -> Option<(String, Option<String>)> {
    let out = git(
        cwd,
        &[
            "log",
            "--ancestry-path",
            "--reverse",
            "--format=%H%x1f%cI",
            &format!("{tip}..{main_branch}"),
        ],
    )
    .await
    .ok()?;
    if let Some((sha, date)) = out.lines().next().and_then(|l| l.split_once('\u{1f}')) {
        return Some((date.trim().to_string(), Some(sha.trim().to_string())));
    }
    // Fast-forward: the tip itself is the landing point.
    let date = git(cwd, &["log", "-1", "--format=%cI", tip]).await.ok()?;
    Some((date.trim().to_string(), None))
}

/// Scan `main_branch` since `since` for a commit that reverts one of
/// `commits`. Returns `(iso_date, revert_sha)`.
pub async fn find_revert(
    cwd: &Path,
    main_branch: &str,
    since: &str,
    commits: &[ProposalCommit],
) -> Option<(String, String)> {
    if commits.is_empty() {
        return None;
    }
    let out = git(
        cwd,
        &[
            "log",
            main_branch,
            &format!("--since={since}"),
            "--format=%H%x1f%cI%x1f%B%x1e",
            "-500",
        ],
    )
    .await
    .ok()?;
    for entry in out.split('\u{1e}') {
        let entry = entry.trim_start_matches(['\n', '\r']);
        if entry.trim().is_empty() {
            continue;
        }
        let mut parts = entry.splitn(3, '\u{1f}');
        let sha = parts.next()?.trim().to_string();
        let date = parts.next()?.trim().to_string();
        let body = parts.next().unwrap_or("");
        if message_reverts(body, commits) {
            return Some((date, sha));
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Borrowing the source checkout's installed dependencies
// ---------------------------------------------------------------------------

/// Dependency directories a repository's own gates need and a **fresh worktree
/// never has**: `git worktree add` materialises tracked files only, so
/// `node_modules/`, a virtualenv, `vendor/` and `target/` are all absent. Every
/// `npm run …` in such a tree exits non-zero for a reason that has nothing to
/// do with the proposal, and recording that as a genuine FAIL is a false
/// reading — the pass rate would say the App master broke the build when the
/// truth is that the gate never had an environment.
///
/// `gate-sees-target` means the gate runs *the repository's own commands with
/// the repository's own resolved environment*. So the worktree **borrows** the
/// source checkout's installed dependencies by linking them in — a directory
/// junction on Windows, a symlink elsewhere. Nothing is installed: `npm ci` is
/// a different blast radius (network, minutes, and a lockfile write) and is not
/// this instrument's job.
///
/// `target` is only borrowed for a Rust repository (see [`dep_dir_candidates`])
/// — a stray `target/` in a Node repo is somebody else's build output.
pub const BORROWED_DEP_DIRS: &[&str] =
    &["node_modules", ".venv", "venv", ".tox", "vendor", "target"];

/// Environment files a gate may need to boot at all (kp's suite reads
/// `.env.local`). **Copied, never linked** — a gate that rewrote a linked
/// dotfile would rewrite the operator's own, and these are small.
pub const BORROWED_ENV_FILES: &[&str] = &[".env.local", ".env"];

/// What a gate worktree borrowed from the source checkout, so a reviewer can
/// see the environment was **borrowed, not rebuilt**.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BorrowedEnv {
    /// Names linked (directories) or copied (env files) into the worktree.
    pub linked: Vec<String>,
    /// Dependency directories resolvable inside the worktree after borrowing —
    /// either because we linked them, or because the repository tracks them.
    pub present: Vec<String>,
    /// Dependency directories missing from the **source** checkout too. We do
    /// not install them; when a command obviously needs one, the gate is
    /// `did_not_run`, not `failed`.
    pub absent: Vec<String>,
    /// How a directory was linked: `junction` on Windows, `symlink` elsewhere.
    pub mechanism: &'static str,
}

impl BorrowedEnv {
    /// Is this dependency directory resolvable inside the worktree?
    pub fn present(&self, dir: &str) -> bool {
        self.present.iter().any(|d| d == dir)
    }

    /// One line for the verdict — silent when nothing was borrowed.
    pub fn note(&self) -> Option<String> {
        if self.linked.is_empty() {
            return None;
        }
        Some(format!(
            "ENV   borrowed from the source checkout ({}), not rebuilt: {}",
            self.mechanism,
            self.linked.join(", ")
        ))
    }
}

/// The dependency directories worth considering for this repository.
///
/// `target` is Rust's and only Rust's: without a `Cargo.toml` a `target/` in
/// the source tree is some other tool's output and linking it in would put a
/// directory in the gate's way that its own commands never expected.
fn dep_dir_candidates(source_root: &Path) -> Vec<&'static str> {
    let rust = source_root.join("Cargo.toml").exists();
    BORROWED_DEP_DIRS
        .iter()
        .copied()
        .filter(|d| *d != "target" || rust)
        .collect()
}

/// The platform's non-privileged directory link.
///
/// Windows: a **directory junction** via `cmd /C mklink /J`.
/// `std::os::windows::fs::symlink_dir` needs `SeCreateSymbolicLinkPrivilege`
/// (Developer Mode or an elevated process); a junction needs neither, and a
/// gate run must not require the operator to be an administrator.
fn link_dir(source: &Path, link: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        let out = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(source)
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("could not run mklink: {e}"))?;
        if out.status.success() {
            return Ok(());
        }
        let msg = String::from_utf8_lossy(&out.stderr);
        let msg = if msg.trim().is_empty() {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            msg.trim().to_string()
        };
        Err(format!("mklink /J failed: {msg}"))
    }
    #[cfg(not(windows))]
    {
        std::os::unix::fs::symlink(source, link).map_err(|e| format!("symlink failed: {e}"))
    }
}

/// Remove one borrowed entry from the worktree.
///
/// **The target is never touched.** A junction and a symlink are removed as
/// links: `symlink_metadata` does not follow them, and `remove_dir` on a
/// reparse point / `remove_file` on a symlink unlinks the pointer only. A real
/// directory found under a borrowed name is left alone — it was not ours.
fn unlink_borrowed(worktree: &Path, name: &str) {
    let path = worktree.join(name);
    let Ok(meta) = std::fs::symlink_metadata(&path) else {
        return;
    };
    if meta.file_type().is_symlink() {
        // Windows reparse points (junctions included) report as symlinks and
        // unlink through `remove_dir`; POSIX symlinks through `remove_file`.
        if std::fs::remove_dir(&path).is_err() {
            let _ = std::fs::remove_file(&path);
        }
    } else if meta.is_file() {
        // A copied env file — ours, and only inside the throwaway worktree.
        let _ = std::fs::remove_file(&path);
    }
    // A real directory is not ours to delete.
}

/// Link the source checkout's installed dependencies into a fresh gate
/// worktree, and copy its env files.
///
/// Best-effort by design: a link that cannot be made is reported (the
/// dependency simply is not `present`), never fatal — a gate that would have
/// worked anyway must still get its chance.
pub fn borrow_installed_deps(source_root: &Path, worktree: &Path) -> BorrowedEnv {
    let mechanism = if cfg!(windows) { "junction" } else { "symlink" };
    let mut env = BorrowedEnv {
        mechanism,
        ..Default::default()
    };

    for name in dep_dir_candidates(source_root) {
        let src = source_root.join(name);
        let dst = worktree.join(name);
        if dst.exists() {
            // The repository tracks it (rare, but real). Nothing to borrow and
            // nothing missing.
            env.present.push(name.to_string());
            continue;
        }
        if !src.is_dir() {
            env.absent.push(name.to_string());
            continue;
        }
        match link_dir(&src, &dst) {
            Ok(()) => {
                env.linked.push(name.to_string());
                env.present.push(name.to_string());
            }
            Err(e) => {
                tracing::warn!(
                    dir = name,
                    error = %e,
                    "app_master_gates: could not borrow a dependency directory into the gate worktree"
                );
                env.absent.push(name.to_string());
            }
        }
    }

    for name in BORROWED_ENV_FILES {
        let src = source_root.join(name);
        let dst = worktree.join(name);
        if dst.exists() || !src.is_file() {
            continue;
        }
        match std::fs::copy(&src, &dst) {
            Ok(_) => env.linked.push(name.to_string()),
            Err(e) => tracing::warn!(
                file = *name,
                error = %e,
                "app_master_gates: could not copy an env file into the gate worktree"
            ),
        }
    }

    env
}

/// Is this command obviously a Node package-manager invocation?
///
/// Deliberately narrow. `npm`/`pnpm`/`yarn`/`npx`/`bun` cannot resolve a script
/// or a binary without `node_modules` — that is conclusive. `pytest` or
/// `python -m …` without a virtualenv is **not** conclusive: the interpreter on
/// `PATH` may well have the packages, so those just run and answer for
/// themselves.
pub fn is_node_package_manager_command(command: &str) -> bool {
    let first = command
        .trim_start()
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let first = first
        .trim_end_matches(".cmd")
        .trim_end_matches(".exe")
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("");
    matches!(first, "npm" | "pnpm" | "yarn" | "npx" | "bun")
}

/// The dependency this command obviously needs and this worktree does not have,
/// if any. `Some(dir)` means the gate is recorded `did_not_run` with reason
/// `deps_missing:<dir>` — not `failed`, because nothing about the proposal was
/// ever tested.
fn deps_missing_for(command: &str, env: &BorrowedEnv) -> Option<&'static str> {
    if is_node_package_manager_command(command) && !env.present("node_modules") {
        return Some("node_modules");
    }
    None
}

// ---------------------------------------------------------------------------
// Running the declared gates on a proposal branch
// ---------------------------------------------------------------------------

/// What one gating pass produced, ready to be reported as a verdict.
#[derive(Debug, Clone, PartialEq)]
pub struct GateSweep {
    pub branch: String,
    pub source: GateSource,
    pub runs: Vec<GateRun>,
    /// What the worktree borrowed from the source checkout — the environment
    /// the gates actually saw. Empty when nothing was borrowed (including when
    /// the worktree could not be created at all).
    pub linked_deps: Vec<String>,
}

impl GateSweep {
    /// One line per stage plus one verdict, per the technique's output
    /// contract. *Not configured* is visibly distinct from *passed*.
    pub fn verdict(&self) -> String {
        if self.source == GateSource::NotConfigured {
            return format!(
                "{}: NOT CONFIGURED — the App master mandate declares no gate commands, so \
                 nothing ran. This is not a pass.",
                self.branch
            );
        }
        let mut out = String::new();
        if !self.linked_deps.is_empty() {
            out.push_str(&format!(
                "ENV   borrowed from the source checkout, not rebuilt: {}\n",
                self.linked_deps.join(", ")
            ));
        }
        for r in &self.runs {
            out.push_str(&r.one_line());
            out.push('\n');
        }
        let rate = pass_rate(&self.runs.iter().map(|r| r.outcome).collect::<Vec<_>>());
        let did_not_run = self
            .runs
            .iter()
            .filter(|r| r.outcome == GateOutcome::DidNotRun)
            .count();
        match rate {
            Some(r) => out.push_str(&format!(
                "VERDICT {}: {:.0}% of the gates that ran passed ({} did not run)",
                self.branch,
                r * 100.0,
                did_not_run
            )),
            None => out.push_str(&format!(
                "VERDICT {}: NO GATE RAN ({did_not_run} could not be run) — no rate to report",
                self.branch
            )),
        }
        out
    }
}

/// Run the project's declared gates against `branch` in a throwaway worktree,
/// recording one row per command.
///
/// **Worktree, always.** kp-style repos run concurrent agent sessions in one
/// checkout; checking a branch out under them would corrupt somebody's
/// in-flight work. The worktree is created detached at the branch tip (so the
/// branch is not "checked out" anywhere and stays available), and removed
/// afterwards even when a gate failed.
///
/// **The worktree borrows the source checkout's installed dependencies**
/// ([`borrow_installed_deps`]): a fresh worktree has no `node_modules`, no
/// virtualenv, no `vendor/`, no `target/`, so every `npm run …` in it would
/// exit non-zero for a reason that has nothing to do with the proposal. Those
/// directories are linked in (junction / symlink), `.env.local`/`.env` copied,
/// and the links removed with the worktree — the targets are never touched.
/// Nothing is installed. What was borrowed is recorded on
/// [`GateSweep::linked_deps`] and in the verdict.
///
/// A worktree that cannot be created records every declared command as
/// `did_not_run` with the reason — an unrunnable gate is a hole in the
/// instrument and must be visible as one, not as silence. So does a command
/// that obviously needs a dependency the **source** checkout does not have
/// either (`deps_missing:<dir>`): it was never given an environment, so it is
/// not a failure of the proposal.
pub async fn run_declared_gates(
    pool: &DbPool,
    project_id: &str,
    persona_id: &str,
    root_path: &Path,
    branch: &str,
) -> GateSweep {
    let (commands, source) = declared_gate_commands(pool, project_id);
    if source == GateSource::NotConfigured {
        tracing::info!(
            project_id,
            branch,
            "app_master_gates: no declared gate commands — nothing run (not configured, not a pass)"
        );
        return GateSweep {
            branch: branch.to_string(),
            source,
            runs: Vec::new(),
            linked_deps: Vec::new(),
        };
    }

    let wt_dir = match tempfile::Builder::new()
        .prefix("personas-app-master-gate-")
        .tempdir()
    {
        Ok(d) => d,
        Err(e) => {
            return did_not_run_sweep(
                pool,
                project_id,
                persona_id,
                branch,
                &commands,
                source,
                &format!("could not create a temp dir for the gate worktree: {e}"),
            )
        }
    };
    let wt_path = wt_dir.path().join("wt");
    let wt_str = wt_path.to_string_lossy().to_string();

    if let Err(e) = git(root_path, &["worktree", "add", "--detach", &wt_str, branch]).await {
        return did_not_run_sweep(pool, project_id, persona_id, branch, &commands, source, &e);
    }

    // The gates must see the repository's own resolved environment, so borrow
    // it rather than rebuild it.
    let borrowed = borrow_installed_deps(root_path, &wt_path);
    if !borrowed.linked.is_empty() {
        tracing::info!(
            project_id,
            branch,
            mechanism = borrowed.mechanism,
            "app_master_gates: gate worktree borrowed the source checkout's environment ({}) — not rebuilt",
            borrowed.linked.join(", ")
        );
    }

    let timeout = gate_timeout();
    let mut runs: Vec<GateRun> = Vec::new();
    for cmd in &commands {
        let run = match deps_missing_for(cmd, &borrowed) {
            // The source checkout has no such dependency either. Installing it
            // is a different blast radius (network, minutes, a lockfile write)
            // and is not this instrument's job — so the gate never ran, and
            // says so.
            Some(dir) => GateRun::new(
                project_id,
                persona_id,
                branch,
                cmd,
                GateOutcome::DidNotRun,
                None,
                0,
                Some(format!(
                    "deps_missing:{dir} — the source checkout has no {dir}/ to borrow into the \
                     gate worktree, and nothing was installed. Not a pass and not a failure."
                )),
            ),
            None => run_one_gate(project_id, persona_id, branch, cmd, &wt_path, timeout).await,
        };
        if let Err(e) = record_gate_run(pool, &run) {
            tracing::warn!(project_id, branch, error = %e,
                "app_master_gates: could not record a gate run");
        }
        runs.push(run);
    }

    // Unlink the borrowed environment BEFORE the worktree is removed. A
    // recursive delete that walked into a junction would delete the operator's
    // real `node_modules`; unlinking first means the removal only ever sees an
    // ordinary tree.
    for name in &borrowed.linked {
        unlink_borrowed(&wt_path, name);
    }

    // Best-effort cleanup — a leaked worktree is a mess, but a failed cleanup
    // must not lose the readings we just took.
    let _ = git(root_path, &["worktree", "remove", "--force", &wt_str]).await;
    let _ = git(root_path, &["worktree", "prune"]).await;
    drop(wt_dir);

    GateSweep {
        branch: branch.to_string(),
        source,
        runs,
        linked_deps: borrowed.linked,
    }
}

fn did_not_run_sweep(
    pool: &DbPool,
    project_id: &str,
    persona_id: &str,
    branch: &str,
    commands: &[String],
    source: GateSource,
    reason: &str,
) -> GateSweep {
    tracing::warn!(
        project_id,
        branch,
        reason,
        "app_master_gates: gates could not be run against the proposal branch"
    );
    let runs: Vec<GateRun> = commands
        .iter()
        .map(|c| {
            let run = GateRun::new(
                project_id,
                persona_id,
                branch,
                c,
                GateOutcome::DidNotRun,
                None,
                0,
                Some(reason.to_string()),
            );
            let _ = record_gate_run(pool, &run);
            run
        })
        .collect();
    GateSweep {
        branch: branch.to_string(),
        source,
        runs,
        linked_deps: Vec::new(),
    }
}

async fn run_one_gate(
    project_id: &str,
    persona_id: &str,
    branch: &str,
    command: &str,
    cwd: &Path,
    timeout: Duration,
) -> GateRun {
    let start = std::time::Instant::now();
    // The parent environment passes through (that is how the repository's own
    // toolchain is found), plus `CI=1` so Next/Vite/Jest-style tools take their
    // non-interactive path instead of asking a question nobody can answer.
    let spawn = if cfg!(target_os = "windows") {
        tokio::process::Command::new("cmd")
            .args(["/C", command])
            .current_dir(cwd)
            .env("CI", "1")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            // The timeout drops the child future; without this the timed-out
            // gate would keep running unattended after we recorded it as
            // DID NOT RUN.
            .kill_on_drop(true)
            .spawn()
    } else {
        tokio::process::Command::new("sh")
            .args(["-c", command])
            .current_dir(cwd)
            .env("CI", "1")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
    };

    let child = match spawn {
        Ok(c) => c,
        Err(e) => {
            return GateRun::new(
                project_id,
                persona_id,
                branch,
                command,
                GateOutcome::DidNotRun,
                None,
                start.elapsed().as_millis() as i64,
                Some(format!("could not spawn the gate command: {e}")),
            )
        }
    };

    let waited = tokio::time::timeout(timeout, child.wait_with_output()).await;
    let duration_ms = start.elapsed().as_millis() as i64;

    match waited {
        Err(_) => GateRun::new(
            project_id,
            persona_id,
            branch,
            command,
            GateOutcome::DidNotRun,
            None,
            duration_ms,
            Some(format!(
                "timed out after {}s — recorded as DID NOT RUN, which is not a pass",
                timeout.as_secs()
            )),
        ),
        Ok(Err(e)) => GateRun::new(
            project_id,
            persona_id,
            branch,
            command,
            GateOutcome::DidNotRun,
            None,
            duration_ms,
            Some(format!("the gate command could not be waited on: {e}")),
        ),
        Ok(Ok(out)) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);
            if out.status.success() {
                GateRun::new(
                    project_id,
                    persona_id,
                    branch,
                    command,
                    GateOutcome::Passed,
                    out.status.code(),
                    duration_ms,
                    None,
                )
            } else {
                GateRun::new(
                    project_id,
                    persona_id,
                    branch,
                    command,
                    GateOutcome::Failed,
                    out.status.code(),
                    duration_ms,
                    first_error_line(&stdout, &stderr),
                )
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use personas_db::init_test_db;

    fn c(sha: &str, subject: &str) -> ProposalCommit {
        ProposalCommit {
            sha: sha.to_string(),
            subject: subject.to_string(),
        }
    }

    // -- pass-rate math ------------------------------------------------------

    #[test]
    fn empty_gate_set_has_no_rate() {
        assert_eq!(pass_rate(&[]), None);
    }

    #[test]
    fn did_not_run_is_excluded_from_both_halves_of_the_ratio() {
        // One pass, one did-not-run. If did_not_run counted as a failure the
        // rate would be 0.5; as a pass, still 1.0 but for the wrong reason.
        // It must be excluded: 1/1.
        assert_eq!(
            pass_rate(&[GateOutcome::Passed, GateOutcome::DidNotRun]),
            Some(1.0)
        );
        assert_eq!(
            pass_rate(&[GateOutcome::Failed, GateOutcome::DidNotRun]),
            Some(0.0)
        );
        assert_eq!(
            pass_rate(&[
                GateOutcome::Passed,
                GateOutcome::Failed,
                GateOutcome::DidNotRun,
                GateOutcome::DidNotRun
            ]),
            Some(0.5)
        );
    }

    #[test]
    fn a_set_of_only_did_not_run_has_no_rate_it_is_not_zero() {
        // The whole point: "nothing could be run" and "everything failed" are
        // opposite findings that a 0.0 would make identical.
        assert_eq!(
            pass_rate(&[GateOutcome::DidNotRun, GateOutcome::DidNotRun]),
            None
        );
    }

    #[test]
    fn all_passed_is_one() {
        assert_eq!(
            pass_rate(&[GateOutcome::Passed, GateOutcome::Passed]),
            Some(1.0)
        );
    }

    #[test]
    fn outcome_wire_values_round_trip() {
        for o in [
            GateOutcome::Passed,
            GateOutcome::Failed,
            GateOutcome::DidNotRun,
        ] {
            assert_eq!(GateOutcome::parse(o.as_str()), Some(o));
        }
        assert_eq!(GateOutcome::parse("skipped"), None);
    }

    // -- gate command sourcing ----------------------------------------------

    fn seed_mandate(pool: &DbPool, project_id: &str, gates: &[&str]) {
        let record = crate::app_master::MandateRecord {
            persona_id: "p1".into(),
            project_id: project_id.into(),
            mandate: crate::app_master::Mandate {
                scope_rung: 2,
                forbidden_classes: vec![],
                approval_gates: gates.iter().map(|g| g.to_string()).collect(),
                owner: "owner@example.com".into(),
            },
            probation_ends_at: chrono::Utc::now().to_rfc3339(),
            hired_at: chrono::Utc::now().to_rfc3339(),
            review_cadence_days: 30,
            retire_criteria: vec![],
            probation_decided_at: None,
            probation_decision: None,
            probation_review_id: None,
            headless_incomplete_streak: 0,
        };
        crate::app_master::set_mandate(pool, &record).unwrap();
    }

    #[test]
    fn gate_commands_come_from_the_mandate_and_nowhere_else() {
        let pool = init_test_db().unwrap();
        // No mandate at all -> not configured, empty list. Never a guessed
        // `npm test`.
        let (cmds, src) = declared_gate_commands(&pool, "proj-unknown");
        assert!(cmds.is_empty());
        assert_eq!(src, GateSource::NotConfigured);

        seed_mandate(&pool, "proj-1", &["npm run test:unit", "  ", "cargo test"]);
        let (cmds, src) = declared_gate_commands(&pool, "proj-1");
        assert_eq!(src, GateSource::Mandate);
        assert_eq!(cmds, vec!["npm run test:unit", "cargo test"]);
    }

    #[test]
    fn a_mandate_with_no_gates_is_not_configured_not_an_empty_pass() {
        let pool = init_test_db().unwrap();
        seed_mandate(&pool, "proj-2", &[]);
        let (cmds, src) = declared_gate_commands(&pool, "proj-2");
        assert!(cmds.is_empty());
        assert_eq!(src, GateSource::NotConfigured);
    }

    // -- gate run recording --------------------------------------------------

    #[test]
    fn recorded_runs_drive_the_window_rate() {
        let pool = init_test_db().unwrap();
        let since = "2000-01-01T00:00:00+00:00";
        // Nothing recorded -> no rate at all.
        assert_eq!(gate_pass_rate_since(&pool, "proj-3", None, since), None);

        for (cmd, outcome, exit) in [
            ("npm run lint", GateOutcome::Passed, Some(0)),
            ("npm run test:unit", GateOutcome::Failed, Some(1)),
            ("npm run build", GateOutcome::DidNotRun, None),
        ] {
            record_gate_run(
                &pool,
                &GateRun::new(
                    "proj-3",
                    "persona-1",
                    "autopilot/x",
                    cmd,
                    outcome,
                    exit,
                    120,
                    if outcome == GateOutcome::Passed {
                        None
                    } else {
                        Some("boom".into())
                    },
                ),
            )
            .unwrap();
        }
        // 1 passed / 2 that ran. The did_not_run is in neither half.
        assert_eq!(
            gate_pass_rate_since(&pool, "proj-3", None, since),
            Some(0.5)
        );

        let runs = gate_runs_for_branch(&pool, "proj-3", "autopilot/x").unwrap();
        assert_eq!(runs.len(), 3);
        assert!(runs.iter().any(|r| r.outcome == GateOutcome::DidNotRun
            && r.exit_code.is_none()
            && r.first_error.is_some()));
    }

    #[test]
    fn the_window_bound_is_honoured() {
        let pool = init_test_db().unwrap();
        let mut old = GateRun::new(
            "proj-4",
            "",
            "autopilot/old",
            "npm test",
            GateOutcome::Failed,
            Some(1),
            5,
            Some("old failure".into()),
        );
        old.ran_at = "2001-01-01T00:00:00+00:00".into();
        record_gate_run(&pool, &old).unwrap();
        // A window that starts after the only run has no rate — not 0.0.
        assert_eq!(
            gate_pass_rate_since(&pool, "proj-4", None, "2020-01-01T00:00:00+00:00"),
            None
        );
        assert_eq!(
            gate_pass_rate_since(&pool, "proj-4", None, "2000-01-01T00:00:00+00:00"),
            Some(0.0)
        );
    }

    // -- tenure attribution (bench sweep #17) --------------------------------

    fn gate_run_at(pool: &DbPool, project: &str, persona: &str, at: &str, outcome: GateOutcome) {
        let mut run = GateRun::new(
            project,
            persona,
            "autopilot/x",
            "npm test",
            outcome,
            Some(0),
            5,
            None,
        );
        run.ran_at = at.into();
        record_gate_run(pool, &run).unwrap();
    }

    /// The regression: a gate run from the PREVIOUS holder's tenure is not
    /// evidence about the new hire, even on the same project in the same month.
    #[test]
    fn gate_runs_before_the_tenure_start_are_excluded_and_after_it_are_counted() {
        let pool = init_test_db().unwrap();
        let month = "2026-08-01T00:00:00+00:00";
        let tenure = "2026-08-25T00:00:00+00:00";
        // The predecessor's month: two passes.
        gate_run_at(
            &pool,
            "proj-ten",
            "p-old",
            "2026-08-10T00:00:00+00:00",
            GateOutcome::Passed,
        );
        gate_run_at(
            &pool,
            "proj-ten",
            "p-old",
            "2026-08-11T00:00:00+00:00",
            GateOutcome::Passed,
        );

        // Over the calendar month the new hire would inherit a perfect record.
        assert_eq!(
            gate_pass_rate_since(&pool, "proj-ten", None, month),
            Some(1.0)
        );
        // Over its own tenure it has no record at all — not 1.0, and not 0.0.
        assert_eq!(
            gate_pass_rate_since(&pool, "proj-ten", Some("p-new"), tenure),
            None
        );

        // Its own first gate fails; that, and only that, is its rate.
        gate_run_at(
            &pool,
            "proj-ten",
            "p-new",
            "2026-08-26T00:00:00+00:00",
            GateOutcome::Failed,
        );
        assert_eq!(
            gate_pass_rate_since(&pool, "proj-ten", Some("p-new"), tenure),
            Some(0.0)
        );
        // The predecessor's own reading is untouched by any of this.
        assert_eq!(
            gate_pass_rate_since(&pool, "proj-ten", Some("p-old"), month),
            Some(1.0)
        );
    }

    /// Rows written before per-holder attribution carry `persona_id = ''`.
    /// They cannot belong to anybody else, so they stay in the reading.
    #[test]
    fn unattributed_legacy_gate_runs_are_still_counted() {
        let pool = init_test_db().unwrap();
        gate_run_at(
            &pool,
            "proj-legacy",
            "",
            "2026-08-26T00:00:00+00:00",
            GateOutcome::Passed,
        );
        assert_eq!(
            gate_pass_rate_since(
                &pool,
                "proj-legacy",
                Some("p-new"),
                "2026-08-25T00:00:00+00:00"
            ),
            Some(1.0)
        );
    }

    /// The proposal ledger's "does a record exist" probe is per holder too, so
    /// a new hire reads `None` rather than the predecessor's merges.
    #[test]
    fn the_proposal_ledger_is_read_per_holder() {
        let pool = init_test_db().unwrap();
        let p = upsert_proposal(
            &pool,
            "proj-prop",
            "p-old",
            "autopilot/old",
            "sha-o",
            None,
            &[c("sha-o", "fix: o")],
        )
        .unwrap();
        mark_merged(&pool, &p.id, "2026-08-10T00:00:00+00:00", Some("merge-1")).unwrap();
        let month = "2026-08-01T00:00:00+00:00";
        let tenure = "2026-08-25T00:00:00+00:00";

        // Project-wide, the month shows a merge.
        assert_eq!(
            proposal_counts_since(&pool, "proj-prop", None, month)
                .unwrap()
                .merged,
            1
        );
        // The new hire has no proposal ledger of its own.
        assert!(proposal_counts_since(&pool, "proj-prop", Some("p-new"), tenure).is_none());

        // Once it authors one, a 0 merged is its own real reading.
        upsert_proposal(
            &pool,
            "proj-prop",
            "p-new",
            "autopilot/new",
            "sha-n",
            None,
            &[c("sha-n", "fix: n")],
        )
        .unwrap();
        let mine = proposal_counts_since(&pool, "proj-prop", Some("p-new"), month).unwrap();
        assert_eq!((mine.seen, mine.merged, mine.reverted), (1, 0, 0));
    }

    #[test]
    fn first_error_is_bounded_on_write() {
        let pool = init_test_db().unwrap();
        let long = "e".repeat(5_000);
        let run = GateRun::new(
            "proj-5",
            "",
            "autopilot/b",
            "npm test",
            GateOutcome::Failed,
            Some(1),
            1,
            Some(long),
        );
        assert!(run.first_error.as_ref().unwrap().chars().count() <= MAX_FIRST_ERROR_CHARS);
        record_gate_run(&pool, &run).unwrap();
    }

    // -- first-error extraction ---------------------------------------------

    #[test]
    fn first_error_prefers_a_shaped_stderr_line() {
        let stdout = "running 3 tests\nok\n";
        let stderr = "warning: unused\nerror[E0433]: failed to resolve\nmore\n";
        assert_eq!(
            first_error_line(stdout, stderr).as_deref(),
            Some("error[E0433]: failed to resolve")
        );
    }

    #[test]
    fn first_error_falls_back_to_the_last_stdout_line() {
        let stdout = "running\n\nTests:  1 failed, 2 total\n";
        // "failed" is error-shaped, so it is picked from stdout.
        assert_eq!(
            first_error_line(stdout, "").as_deref(),
            Some("Tests:  1 failed, 2 total")
        );
        // Nothing error-shaped anywhere: the summary line still beats silence.
        assert_eq!(
            first_error_line("step one\nstep two\n", "").as_deref(),
            Some("step two")
        );
        assert_eq!(first_error_line("", ""), None);
    }

    // -- revert detection (pure) --------------------------------------------

    #[test]
    fn revert_by_quoted_subject() {
        let commits = vec![c("abc1234def", "fix(auth): stop leaking the token")];
        assert!(message_reverts(
            "Revert \"fix(auth): stop leaking the token\"\n\nThis reverts commit abc1234def.",
            &commits
        ));
        assert!(!message_reverts(
            "Revert \"chore: something else entirely\"",
            &commits
        ));
    }

    #[test]
    fn revert_by_trailer_sha_matches_on_a_prefix_either_way() {
        let commits = vec![c("abc1234def5678", "fix: x")];
        assert!(message_reverts(
            "chore: back that out\n\nThis reverts commit abc1234.",
            &commits
        ));
        let short = vec![c("abc1234", "fix: x")];
        assert!(message_reverts(
            "chore: back that out\n\nThis reverts commit abc1234def5678901234.",
            &short
        ));
    }

    #[test]
    fn a_too_short_sha_is_a_coincidence_not_a_revert() {
        let commits = vec![c("abc1234def", "fix: x")];
        assert!(!message_reverts(
            "chore: x\n\nThis reverts commit abc12.",
            &commits
        ));
    }

    #[test]
    fn no_commits_means_no_revert_claim() {
        assert!(!message_reverts(
            "Revert \"anything\"\n\nThis reverts commit deadbeefcafe.",
            &[]
        ));
    }

    // -- proposal ledger -----------------------------------------------------

    #[test]
    fn no_proposals_at_all_is_none_not_zero() {
        let pool = init_test_db().unwrap();
        assert_eq!(
            proposal_counts_since(&pool, "proj-6", None, "2000-01-01T00:00:00+00:00"),
            None
        );
    }

    #[test]
    fn one_unmerged_proposal_makes_zero_a_real_reading() {
        let pool = init_test_db().unwrap();
        upsert_proposal(
            &pool,
            "proj-7",
            "persona-1",
            "autopilot/fix-a",
            "sha-a",
            Some("base-a"),
            &[c("sha-a", "fix: a")],
        )
        .unwrap();
        let counts =
            proposal_counts_since(&pool, "proj-7", None, "2000-01-01T00:00:00+00:00").unwrap();
        assert_eq!(counts.merged, 0);
        assert_eq!(counts.reverted, 0);
        assert_eq!(counts.seen, 1);
    }

    #[test]
    fn merge_and_revert_observations_are_sticky_and_windowed() {
        let pool = init_test_db().unwrap();
        let p = upsert_proposal(
            &pool,
            "proj-8",
            "persona-1",
            "autopilot/fix-b",
            "sha-b",
            None,
            &[c("sha-b", "fix: b")],
        )
        .unwrap();
        mark_merged(&pool, &p.id, "2026-08-10T00:00:00+00:00", Some("merge-1")).unwrap();
        // A second observation must not move the first one.
        mark_merged(&pool, &p.id, "2026-08-20T00:00:00+00:00", Some("merge-2")).unwrap();
        let stored = get_proposal(&pool, "proj-8", "autopilot/fix-b")
            .unwrap()
            .unwrap();
        assert_eq!(
            stored.merged_at.as_deref(),
            Some("2026-08-10T00:00:00+00:00")
        );
        assert_eq!(stored.merge_sha.as_deref(), Some("merge-1"));

        mark_reverted(&pool, &p.id, "2026-08-12T00:00:00+00:00", "revert-1").unwrap();
        let counts =
            proposal_counts_since(&pool, "proj-8", None, "2026-08-01T00:00:00+00:00").unwrap();
        assert_eq!((counts.merged, counts.reverted), (1, 1));
        // A window that opens after both observations sees neither — but the
        // project still HAS proposals, so it is 0, not None.
        let later =
            proposal_counts_since(&pool, "proj-8", None, "2026-09-01T00:00:00+00:00").unwrap();
        assert_eq!((later.merged, later.reverted), (0, 0));
    }

    #[test]
    fn re_seeing_a_branch_never_clears_an_observation() {
        let pool = init_test_db().unwrap();
        let p = upsert_proposal(
            &pool,
            "proj-9",
            "persona-1",
            "autopilot/fix-c",
            "sha-c",
            None,
            &[c("sha-c", "fix: c")],
        )
        .unwrap();
        mark_merged(&pool, &p.id, "2026-08-10T00:00:00+00:00", Some("m")).unwrap();
        // The reconciler re-discovers the same branch on the next tick.
        let again = upsert_proposal(
            &pool,
            "proj-9",
            "persona-1",
            "autopilot/fix-c",
            "sha-c2",
            None,
            &[c("sha-c2", "fix: c amended")],
        )
        .unwrap();
        assert_eq!(again.id, p.id);
        assert_eq!(again.head_sha, "sha-c2");
        assert_eq!(
            again.merged_at.as_deref(),
            Some("2026-08-10T00:00:00+00:00")
        );
        // The captured commit list is NOT overwritten: revert detection needs
        // the subjects as they were before a merge rewrote the context.
        assert_eq!(again.commits, vec![c("sha-c", "fix: c")]);
    }

    #[test]
    fn gate_sweep_verdict_distinguishes_not_configured_from_passed() {
        let sweep = GateSweep {
            branch: "autopilot/x".into(),
            source: GateSource::NotConfigured,
            runs: vec![],
            linked_deps: vec![],
        };
        let v = sweep.verdict();
        assert!(v.contains("NOT CONFIGURED"));
        assert!(v.contains("not a pass"));

        let sweep = GateSweep {
            branch: "autopilot/x".into(),
            source: GateSource::Mandate,
            linked_deps: vec!["node_modules".into()],
            runs: vec![
                GateRun::new(
                    "p",
                    "",
                    "autopilot/x",
                    "npm run lint",
                    GateOutcome::Passed,
                    Some(0),
                    10,
                    None,
                ),
                GateRun::new(
                    "p",
                    "",
                    "autopilot/x",
                    "npm test",
                    GateOutcome::DidNotRun,
                    None,
                    0,
                    Some("timed out".into()),
                ),
            ],
        };
        let v = sweep.verdict();
        assert!(v.contains("PASS  npm run lint"));
        assert!(v.contains("DID NOT RUN  npm test"));
        assert!(v.contains("100% of the gates that ran passed (1 did not run)"));
        // The reviewer can see the environment was borrowed, not rebuilt.
        assert!(v.contains("borrowed from the source checkout, not rebuilt: node_modules"));
    }

    // -- borrowing the source checkout's environment ------------------------

    #[test]
    fn a_node_package_manager_command_is_recognised_and_pytest_is_not() {
        for cmd in [
            "npm run test:unit",
            "  pnpm lint",
            "yarn build",
            "npx tsc --noEmit",
            "bun test",
            "npm.cmd run x",
        ] {
            assert!(is_node_package_manager_command(cmd), "{cmd}");
        }
        // Not conclusive: the interpreter on PATH may well have the packages,
        // so these just run and answer for themselves.
        for cmd in [
            "pytest -q",
            "python -m pytest",
            "cargo test",
            "make check",
            "",
        ] {
            assert!(!is_node_package_manager_command(cmd), "{cmd}");
        }
    }

    #[test]
    fn target_is_only_a_candidate_for_a_rust_repository() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!dep_dir_candidates(dir.path()).contains(&"target"));
        std::fs::write(dir.path().join("Cargo.toml"), "[package]").unwrap();
        assert!(dep_dir_candidates(dir.path()).contains(&"target"));
    }

    // -- git plumbing, against a real throwaway repository -------------------
    //
    // Real `git`, not a mock. The whole merge/revert lane is a claim about what
    // git answers; a mocked `merge-base --is-ancestor` would pin our
    // assumptions about git rather than git's behaviour, and this ledger is
    // read as evidence in a human's hire/retire decision.

    struct Repo {
        dir: tempfile::TempDir,
    }

    impl Repo {
        fn new() -> Option<Self> {
            let dir = tempfile::tempdir().ok()?;
            let r = Repo { dir };
            r.git(&["init", "--initial-branch=main"])?;
            r.git(&["config", "user.email", "t@example.com"])?;
            r.git(&["config", "user.name", "T"])?;
            r.git(&["config", "commit.gpgsign", "false"])?;
            r.commit("README.md", "hello", "chore: initial")?;
            Some(r)
        }

        fn path(&self) -> &Path {
            self.dir.path()
        }

        fn git(&self, args: &[&str]) -> Option<String> {
            let out = std::process::Command::new("git")
                .args(args)
                .current_dir(self.dir.path())
                .output()
                .ok()?;
            if !out.status.success() {
                return None;
            }
            Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
        }

        fn commit(&self, file: &str, body: &str, message: &str) -> Option<String> {
            std::fs::write(self.dir.path().join(file), body).ok()?;
            self.git(&["add", file])?;
            self.git(&["commit", "-m", message])?;
            self.git(&["rev-parse", "HEAD"])
        }
    }

    fn git_available() -> bool {
        std::process::Command::new("git")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[tokio::test]
    async fn an_unmerged_branch_is_discoverable_and_not_reported_as_merged() {
        if !git_available() {
            return;
        }
        let Some(repo) = Repo::new() else { return };
        repo.git(&["checkout", "-b", "autopilot/fix-a"]).unwrap();
        let tip = repo.commit("a.txt", "a", "fix: a").unwrap();
        repo.git(&["checkout", "main"]).unwrap();

        assert_eq!(
            list_proposal_branches(repo.path()).await.unwrap(),
            vec!["autopilot/fix-a".to_string()]
        );
        assert!(!is_merged(repo.path(), "main", &tip).await);
    }

    #[tokio::test]
    async fn a_merged_branch_is_observed_with_a_landing_date() {
        if !git_available() {
            return;
        }
        let Some(repo) = Repo::new() else { return };
        repo.git(&["checkout", "-b", "autopilot/fix-b"]).unwrap();
        let tip = repo.commit("b.txt", "b", "fix: b").unwrap();
        repo.git(&["checkout", "main"]).unwrap();
        repo.git(&["merge", "--no-ff", "-m", "Merge fix b", "autopilot/fix-b"])
            .unwrap();

        assert!(is_merged(repo.path(), "main", &tip).await);
        let (at, sha) = merge_point(repo.path(), "main", &tip).await.unwrap();
        assert!(at.contains('T'), "expected an ISO date, got {at}");
        // The merge commit is the landing point, and it is named.
        assert!(sha.is_some());
    }

    #[tokio::test]
    async fn branch_commits_are_captured_relative_to_main() {
        if !git_available() {
            return;
        }
        let Some(repo) = Repo::new() else { return };
        repo.git(&["checkout", "-b", "autopilot/fix-c"]).unwrap();
        repo.commit("c.txt", "c", "fix: c one").unwrap();
        repo.commit("c2.txt", "c2", "fix: c two").unwrap();
        repo.git(&["checkout", "main"]).unwrap();

        let (base, commits) = branch_commits(repo.path(), "main", "autopilot/fix-c")
            .await
            .unwrap();
        assert!(base.is_some());
        let subjects: Vec<&str> = commits.iter().map(|c| c.subject.as_str()).collect();
        assert_eq!(subjects, vec!["fix: c two", "fix: c one"]);
    }

    #[tokio::test]
    async fn a_revert_on_main_is_found_by_the_message_git_itself_wrote() {
        if !git_available() {
            return;
        }
        let Some(repo) = Repo::new() else { return };
        repo.git(&["checkout", "-b", "autopilot/fix-d"]).unwrap();
        let tip = repo.commit("d.txt", "d", "fix: d the thing").unwrap();
        repo.git(&["checkout", "main"]).unwrap();
        repo.git(&["merge", "--no-ff", "-m", "Merge fix d", "autopilot/fix-d"])
            .unwrap();
        repo.git(&["revert", "--no-edit", &tip]).unwrap();

        let commits = vec![c(&tip, "fix: d the thing")];
        let (_, sha) = find_revert(repo.path(), "main", "2000-01-01T00:00:00+00:00", &commits)
            .await
            .expect("the revert commit should have been found");
        assert!(!sha.is_empty());
    }

    #[tokio::test]
    async fn an_unrelated_revert_on_main_is_not_attributed_to_this_proposal() {
        if !git_available() {
            return;
        }
        let Some(repo) = Repo::new() else { return };
        repo.git(&["checkout", "-b", "autopilot/fix-e"]).unwrap();
        let tip = repo.commit("e.txt", "e", "fix: e the thing").unwrap();
        repo.git(&["checkout", "main"]).unwrap();
        repo.git(&["merge", "--no-ff", "-m", "Merge fix e", "autopilot/fix-e"])
            .unwrap();
        repo.commit("z.txt", "z", "Revert \"something entirely else\"")
            .unwrap();

        let commits = vec![c(&tip, "fix: e the thing")];
        assert!(
            find_revert(repo.path(), "main", "2000-01-01T00:00:00+00:00", &commits)
                .await
                .is_none()
        );
    }

    #[tokio::test]
    async fn resolve_main_branch_prefers_the_recorded_name_then_falls_back() {
        if !git_available() {
            return;
        }
        let Some(repo) = Repo::new() else { return };
        // A recorded branch that does not exist must not be used to compute a
        // merge verdict; the fallback finds the real one.
        assert_eq!(
            resolve_main_branch(repo.path(), Some("trunk"))
                .await
                .as_deref(),
            Some("main")
        );
        assert_eq!(
            resolve_main_branch(repo.path(), Some("main"))
                .await
                .as_deref(),
            Some("main")
        );
    }

    #[tokio::test]
    async fn declared_gates_run_against_the_branch_in_a_worktree() {
        if !git_available() {
            return;
        }
        let Some(repo) = Repo::new() else { return };
        repo.git(&["checkout", "-b", "autopilot/fix-f"]).unwrap();
        repo.commit("marker.txt", "on-the-branch", "feat: marker")
            .unwrap();
        repo.git(&["checkout", "main"]).unwrap();

        let pool = init_test_db().unwrap();
        // A gate that can only pass if the worktree really is on the proposal
        // branch — the marker file exists nowhere else — plus one that must
        // fail. Together they prove `gate-sees-target` and the ratio.
        seed_mandate(
            &pool,
            "proj-gate",
            &[
                "git ls-files --error-unmatch marker.txt",
                "git ls-files --error-unmatch does-not-exist.txt",
            ],
        );

        let sweep = run_declared_gates(
            &pool,
            "proj-gate",
            "persona-1",
            repo.path(),
            "autopilot/fix-f",
        )
        .await;

        assert_eq!(sweep.source, GateSource::Mandate);
        assert_eq!(sweep.runs.len(), 2);
        assert_eq!(sweep.runs[0].outcome, GateOutcome::Passed);
        assert_eq!(sweep.runs[1].outcome, GateOutcome::Failed);
        assert!(sweep.runs[1].first_error.is_some());
        assert_eq!(
            gate_pass_rate_since(&pool, "proj-gate", None, "2000-01-01T00:00:00+00:00"),
            Some(0.5)
        );
        // The shared checkout is untouched: the branch was never checked out
        // under a concurrent session, and the worktree is gone.
        assert_eq!(
            repo.git(&["rev-parse", "--abbrev-ref", "HEAD"]).unwrap(),
            "main"
        );
        assert!(!repo.path().join("marker.txt").exists());
        assert_eq!(
            repo.git(&["worktree", "list"])
                .unwrap()
                .lines()
                .filter(|l| !l.trim().is_empty())
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn a_project_with_no_declared_gates_runs_nothing_and_claims_nothing() {
        if !git_available() {
            return;
        }
        let Some(repo) = Repo::new() else { return };
        let pool = init_test_db().unwrap();
        // No mandate row at all for this project: nothing to run, and no
        // invented `npm test` standing in for the repo's real gates.
        let sweep = run_declared_gates(
            &pool,
            "proj-none",
            "persona-1",
            repo.path(),
            "autopilot/anything",
        )
        .await;
        assert_eq!(sweep.source, GateSource::NotConfigured);
        assert!(sweep.runs.is_empty());
        assert_eq!(
            gate_pass_rate_since(&pool, "proj-none", None, "2000-01-01T00:00:00+00:00"),
            None
        );
    }

    #[tokio::test]
    async fn a_gate_that_times_out_is_did_not_run_and_never_a_pass() {
        if !git_available() {
            return;
        }
        let Some(repo) = Repo::new() else { return };
        let pool = init_test_db().unwrap();
        // One second, so the sleep cannot finish.
        std::env::set_var(GATE_TIMEOUT_ENV, "1");
        let cmd = if cfg!(target_os = "windows") {
            // `timeout` needs a console; ping to loopback is the portable stall.
            "ping -n 20 127.0.0.1 > NUL"
        } else {
            "sleep 20"
        };
        seed_mandate(&pool, "proj-timeout", &[cmd]);

        let sweep =
            run_declared_gates(&pool, "proj-timeout", "persona-1", repo.path(), "main").await;
        std::env::remove_var(GATE_TIMEOUT_ENV);

        assert_eq!(sweep.runs.len(), 1);
        assert_eq!(sweep.runs[0].outcome, GateOutcome::DidNotRun);
        assert!(sweep.runs[0].exit_code.is_none());
        assert!(sweep.runs[0]
            .first_error
            .as_deref()
            .unwrap()
            .contains("timed out"));
        // The only recorded run did not run, so there is NO rate — not 0.0,
        // and emphatically not 1.0.
        assert_eq!(
            gate_pass_rate_since(&pool, "proj-timeout", None, "2000-01-01T00:00:00+00:00"),
            None
        );
    }

    /// A gate that can only pass if the worktree resolved `node_modules` — the
    /// directory `git worktree add` never materialises, because it is not
    /// tracked. Before the borrow this was a genuine FAIL for every `npm run …`
    /// gate, i.e. a `gatePassRate` of 0 that said nothing about the proposal.
    #[tokio::test]
    async fn a_gate_sees_the_source_checkouts_installed_dependencies() {
        if !git_available() {
            return;
        }
        let Some(repo) = Repo::new() else { return };
        // Untracked, exactly like a real install.
        std::fs::create_dir_all(repo.path().join("node_modules")).unwrap();
        std::fs::write(repo.path().join("node_modules").join("marker"), "installed").unwrap();
        std::fs::write(repo.path().join(".env.local"), "KP_X=1\n").unwrap();

        repo.git(&["checkout", "-b", "autopilot/fix-deps"]).unwrap();
        repo.commit("dep.txt", "d", "feat: dep").unwrap();
        repo.git(&["checkout", "main"]).unwrap();

        let pool = init_test_db().unwrap();
        let (marker_gate, env_gate) = if cfg!(target_os = "windows") {
            (
                "if exist node_modules\\marker (exit 0) else (exit 1)",
                "if exist .env.local (exit 0) else (exit 1)",
            )
        } else {
            ("test -e node_modules/marker", "test -e .env.local")
        };
        seed_mandate(&pool, "proj-deps", &[marker_gate, env_gate]);

        let sweep = run_declared_gates(
            &pool,
            "proj-deps",
            "persona-1",
            repo.path(),
            "autopilot/fix-deps",
        )
        .await;

        assert_eq!(sweep.source, GateSource::Mandate);
        assert_eq!(
            sweep.runs[0].outcome,
            GateOutcome::Passed,
            "the gate did not resolve the borrowed node_modules: {}",
            sweep.runs[0].one_line()
        );
        assert_eq!(sweep.runs[1].outcome, GateOutcome::Passed);
        assert!(sweep.linked_deps.contains(&"node_modules".to_string()));
        assert!(sweep.linked_deps.contains(&".env.local".to_string()));
        assert!(sweep
            .verdict()
            .contains("borrowed from the source checkout, not rebuilt"));

        // The link was removed with the worktree and the TARGET survived — a
        // recursive delete that walked into the junction would have taken the
        // operator's real install with it.
        assert!(
            repo.path().join("node_modules").join("marker").exists(),
            "the source checkout's node_modules must survive worktree cleanup"
        );
        assert_eq!(
            std::fs::read_to_string(repo.path().join("node_modules").join("marker")).unwrap(),
            "installed"
        );
        assert!(repo.path().join(".env.local").exists());
        // …and no worktree leaked.
        assert_eq!(
            repo.git(&["worktree", "list"])
                .unwrap()
                .lines()
                .filter(|l| !l.trim().is_empty())
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn an_npm_gate_with_no_node_modules_anywhere_did_not_run_and_never_failed() {
        if !git_available() {
            return;
        }
        let Some(repo) = Repo::new() else { return };
        // No node_modules in the SOURCE checkout either, and we install
        // nothing: `npm ci` is a different blast radius and cost.
        let pool = init_test_db().unwrap();
        seed_mandate(
            &pool,
            "proj-nodeps",
            &["npm run test:unit", "git --version"],
        );

        let sweep =
            run_declared_gates(&pool, "proj-nodeps", "persona-1", repo.path(), "main").await;

        assert_eq!(sweep.runs.len(), 2);
        assert_eq!(sweep.runs[0].outcome, GateOutcome::DidNotRun);
        assert!(sweep.runs[0].exit_code.is_none());
        assert!(
            sweep.runs[0]
                .first_error
                .as_deref()
                .unwrap()
                .starts_with("deps_missing:node_modules"),
            "expected a deps_missing reason, got {:?}",
            sweep.runs[0].first_error
        );
        // A command that does not need the missing dependency still runs.
        assert_eq!(sweep.runs[1].outcome, GateOutcome::Passed);
        assert!(sweep.linked_deps.is_empty());
        // did_not_run is in neither half: one pass out of one that ran.
        assert_eq!(
            gate_pass_rate_since(&pool, "proj-nodeps", None, "2000-01-01T00:00:00+00:00"),
            Some(1.0)
        );
    }
}
