//! **The worker's write-back door** — how a headless App Master run tells
//! Personas what it did.
//!
//! # The gap this closes
//!
//! An App Master decides on each wake which of its charters to run
//! (`engine::subscription::attention`), and a code-authoring charter is
//! dispatched as a headless fleet session in an isolated authoring worktree.
//! That worker has a repository, a branch and a model — and, until this module,
//! **no way back into the database**. It has neither the Personas MCP nor an
//! ideas route on the loopback dev-tools bridge, so everything it learned ended
//! at a git commit.
//!
//! The consequence was measured in cycle 1: a delivery run for idea `297f6ba4`
//! committed on its `autopilot/*` branch and the idea stayed
//! `dev_ideas.status = 'accepted'` with no `dev_tasks` row — so the next wake's
//! "accepted ideas with no task" sensor
//! ([`personas_db::repos::dev::attention`]) offered the SAME idea again. A KPI
//! stewardship run wrote a measurement command into the repo and no `dev_kpis`
//! row anywhere. Work happened; nothing in Personas could tell.
//!
//! # The rule these four operations follow
//!
//! Every one of them goes through the door the UI already uses — the idea
//! verdict through [`apply_idea_verdict_cas`], task creation through
//! [`create_task_core`], the terminal write through the same
//! `record_task_outcome` + `write_back_to_source_idea` pair the task executor
//! runs, KPI writes through `repos::dev::kpis`. **No second write path.** A row
//! written by a worker is indistinguishable from one written by a click,
//! because it was written by the same code.
//!
//! The vocabularies below are all read off the schema rather than invented;
//! each one names where it came from, and every value a caller may pass is
//! validated HERE so a bad token is a 400 naming the allowed set rather than a
//! 500 carrying a raw SQLite CHECK message.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::commands::infrastructure::dev_tools::{
    apply_idea_verdict_cas, create_task_core, run_triage_rules_core, IdeaVerdict,
};
use crate::commands::infrastructure::task_executor::{
    record_task_outcome, write_back_to_source_idea,
};
use crate::db::models::{DevGoal, DevGoalItem, DevIdea, DevKpi, DevKpiMeasurement, DevTask};
use crate::db::repos::dev_tools as repo;
use crate::db::DbPool;
use crate::error::AppError;

// ============================================================================
// Vocabularies — every one of them lifted from the schema, not invented
// ============================================================================

/// What a worker can say happened to the idea it was given.
///
/// `already_delivered` is the fourth because the first three had no honest word
/// for "this was already on main when I looked". The backlog is reconciled
/// against nothing: the undispatched sensor is "accepted AND no live task"
/// (`personas_db::repos::dev::attention`) and the only automatic closure is a
/// dispatch's OWN merged branch, so an item some other branch satisfied is
/// offered again on every wake. A worker that noticed had one word for it —
/// `declined` — which routes through the reject verdict and writes an
/// importance-8 "do not re-surface" constraint into the shared ledger. That
/// records delivered work as a refusal. `already_delivered` closes the item the
/// way a delivery does (task `completed`, idea left `accepted`) and writes no
/// verdict and no constraint; it requires the `commit` that proves the claim.
const OUTCOMES: [&str; 4] = ["delivered", "declined", "blocked", "already_delivered"];

/// The outcome for work a worker found already satisfied on the default branch.
pub const OUTCOME_ALREADY_DELIVERED: &str = "already_delivered";

/// The `scan_type` an App-Master-filed backlog item carries.
///
/// `dev_ideas.origin` is a CLOSED allowlist — `personas_core::models::FINDING_ORIGINS`,
/// eleven measurement sensors, validated by `create_finding` and rendered by an
/// exhaustive `Record<FindingOrigin, …>` in `FindingBadge.tsx`. `app-master` is
/// not in it, so a filed item leaves `origin` NULL and identifies its producer
/// through `scan_type`, exactly as a scanner idea does. Adding a twelfth origin
/// is a UI + 14-locale change, not a backend one; see the note in the report.
pub const APP_MASTER_SCAN_TYPE: &str = "app-master";

/// `dev_kpis.category` — `c02_dev_goals_and_kpis.rs:257`.
const KPI_CATEGORIES: [&str; 4] = ["technical", "traffic", "value", "quality"];
/// `dev_kpis.measure_kind` — `c02_dev_goals_and_kpis.rs:259`.
const KPI_MEASURE_KINDS: [&str; 4] = ["codebase", "connector", "manual", "derived"];
/// `dev_kpis.direction` — `c02_dev_goals_and_kpis.rs:263`.
const KPI_DIRECTIONS: [&str; 2] = ["up", "down"];
/// `dev_kpis.cadence` — `c02_dev_goals_and_kpis.rs:269`.
const KPI_CADENCES: [&str; 3] = ["manual", "daily", "weekly"];
/// `dev_kpis.status` — `c02_dev_goals_and_kpis.rs:271`. A worker may propose or
/// activate; `paused`/`archived` are retirement decisions a human makes.
const KPI_CREATE_STATUSES: [&str; 2] = ["proposed", "active"];
/// `dev_kpi_measurements.source` — `c02_dev_goals_and_kpis.rs:301`, widened with
/// `ai-compose` by `e09_devices_and_provenance.rs:341`. `simulation` and
/// `ai-compose` are excluded: both have their OWN repo door with invariants the
/// generic recorder cannot enforce, and a caller must not reach them by passing
/// a string.
const MEASUREMENT_SOURCES: [&str; 4] = ["evaluator", "manual", "scan", "health_snapshot"];
/// `dev_kpi_measurements.env` — `c02_dev_goals_and_kpis.rs:303`.
const MEASUREMENT_ENVS: [&str; 3] = ["local", "test", "production"];

/// Refuse a token outside its allowed set, naming the set. `AppError::Validation`
/// is what the bridge's `status_for` maps to 400.
fn require_one_of(field: &str, value: &str, allowed: &[&str]) -> Result<(), AppError> {
    if allowed.contains(&value) {
        return Ok(());
    }
    Err(AppError::Validation(format!(
        "{field} must be one of {}, got `{value}`",
        allowed.join(" | ")
    )))
}

fn trimmed(v: Option<&String>) -> Option<&str> {
    v.map(|s| s.trim()).filter(|s| !s.is_empty())
}

// ============================================================================
// 1 · The outcome of a delivery run
// ============================================================================

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct IdeaOutcomeInput {
    /// `delivered` | `declined` | `blocked` | `already_delivered`.
    ///
    /// `already_delivered` means the worker found the item satisfied on the
    /// default branch by work it did not do; it closes the item like a delivery
    /// and requires `commit`. It is NOT `declined` — see [`OUTCOMES`].
    pub outcome: String,
    /// What happened, in the worker's own words. Becomes the task's outcome
    /// block, and — for `declined` — the idea's rejection reason.
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub commit: Option<String>,
    #[serde(default, alias = "prUrl")]
    pub pr_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct IdeaOutcomeResult {
    pub idea_id: String,
    /// The idea's status AFTER the write.
    pub idea_status: String,
    pub task: DevTask,
    /// True when this call had to mint the task row because the dispatch never
    /// did. Reported rather than hidden: a worker seeing `true` here knows its
    /// dispatch path did not leave a record, which is a defect upstream.
    pub task_created: bool,
    /// The terminal `dev_tasks.status` written — one of
    /// `personas_core::models::TASK_STATUSES`.
    pub task_status: String,
}

/// The terminal `dev_tasks` status each outcome maps onto.
///
/// The vocabulary is `personas_core::models::TASK_STATUSES`
/// (`core/src/models/dev_tools.rs:1391`) — `queued | running | completed |
/// failed | cancelled`. There is no `blocked` and no `declined`, and inventing
/// one would render as nothing in the Run Desk (the repo warns on an unknown
/// status for exactly that reason, `db/src/repos/dev/tasks.rs:46`). So:
/// delivered → `completed`, blocked → `failed` (the work stopped short and the
/// reason is on the row), declined → `cancelled` (nobody is going to run it).
/// `already_delivered` is a delivery somebody else made, so it lands on
/// `completed` too: the work exists, and the row has to read that way.
fn task_status_for(outcome: &str) -> &'static str {
    match outcome {
        "delivered" | OUTCOME_ALREADY_DELIVERED => "completed",
        "blocked" => "failed",
        _ => "cancelled",
    }
}

/// True for the two outcomes that mean the work exists in the repository —
/// the learning loop, the task's terminal shape and the goal recompute all key
/// on this rather than on the literal `delivered`.
fn outcome_is_delivery(outcome: &str) -> bool {
    matches!(outcome, "delivered" | OUTCOME_ALREADY_DELIVERED)
}

/// Compose the outcome block appended to the task's description.
///
/// `dev_tasks` has no result column — its text fields are `description` and
/// `error` (`db/src/migrations/schema.rs:1275`). So the provenance lands as a
/// clearly-fenced block on the description (which already holds the dispatch
/// brief, so the row reads as ask-then-answer), and the note additionally
/// becomes `error` for a non-delivered outcome, which is the field the Run Desk
/// surfaces for a task that did not finish.
fn outcome_block(outcome: &str, input: &IdeaOutcomeInput) -> String {
    let mut s = format!("\n\n--- App Master outcome: {outcome} ---\n");
    for (label, value) in [
        ("note", trimmed(input.note.as_ref())),
        ("branch", trimmed(input.branch.as_ref())),
        ("commit", trimmed(input.commit.as_ref())),
        ("pr", trimmed(input.pr_url.as_ref())),
    ] {
        if let Some(v) = value {
            s.push_str(&format!("{label}: {v}\n"));
        }
    }
    s
}

/// True when the idea's latest task already carries `outcome` — the replay
/// queue asks this before applying a queued outcome, so an outcome a human
/// replayed by hand (or an earlier drain whose file move failed) is filed
/// rather than appended a second time.
pub fn outcome_already_recorded(
    db: &DbPool,
    idea_id: &str,
    outcome: &str,
) -> Result<bool, AppError> {
    let Some(task) = repo::latest_task_for_idea(db, idea_id)? else {
        return Ok(false);
    };
    let marker = format!("--- App Master outcome: {outcome} ---");
    Ok(task.status == task_status_for(outcome)
        && task.description.as_deref().unwrap_or("").contains(&marker))
}

/// Write a delivery run's outcome back onto the idea it was given.
///
/// Blocking (rusqlite throughout) — call it on the blocking pool.
pub fn record_idea_outcome(
    db: &DbPool,
    idea_id: &str,
    input: &IdeaOutcomeInput,
) -> Result<IdeaOutcomeResult, AppError> {
    let outcome = input.outcome.trim();
    require_one_of("outcome", outcome, &OUTCOMES)?;
    // `already_delivered` is a claim about the repository, not about this run,
    // and it closes a backlog item without anybody building anything. It has to
    // name the commit that makes it true, so the close is auditable from the
    // task row alone.
    if outcome == OUTCOME_ALREADY_DELIVERED && trimmed(input.commit.as_ref()).is_none() {
        return Err(AppError::Validation(
            "already_delivered requires `commit` — the commit on the default branch that \
             already satisfies this item"
                .into(),
        ));
    }
    // Resolve the idea FIRST: a 404 here means the worker was briefed with an
    // id that does not exist, which is worth saying plainly.
    let idea = repo::get_idea_by_id(db, idea_id)?;

    // The task the dispatch should have minted (P2), or one minted now so the
    // undispatched sensor stops offering an idea somebody already delivered.
    let (task, task_created) = match repo::latest_task_for_idea(db, &idea.id)? {
        Some(t) => (t, false),
        None => (
            create_task_core(
                db,
                idea.project_id.as_deref(),
                &idea.title,
                idea.description.as_deref(),
                Some(&idea.id),
                idea.goal_id.as_deref(),
                Some("queued"),
                None,
            )?,
            true,
        ),
    };

    let status = task_status_for(outcome);
    let delivered = outcome_is_delivery(outcome);
    let now = chrono::Utc::now().to_rfc3339();
    let note = trimmed(input.note.as_ref());
    let description = format!(
        "{}{}",
        task.description.as_deref().unwrap_or_default(),
        outcome_block(outcome, input)
    );
    // A non-delivered run puts its reason where the Run Desk reads it. A
    // delivered one leaves `error` alone rather than blanking it: if a previous
    // attempt failed, that history is not this call's to erase.
    let error_field = if delivered {
        None
    } else {
        Some(Some(note.unwrap_or(outcome)))
    };

    let task = repo::update_task(
        db,
        &task.id,
        None,
        Some(Some(description.as_str())),
        Some(status),
        None,
        if delivered { Some(100) } else { None },
        None,
        error_field,
        None,
        Some(Some(now.as_str())),
    )?;

    // The learning loop, through the executor's own write-backs — the same two
    // calls `finalize_task` makes, so a worker-reported outcome teaches the
    // project exactly what an in-app run would have.
    record_task_outcome(
        db,
        &task.id,
        delivered,
        &format!(
            "App Master worker reported `{outcome}`.{}",
            note.map(|n| format!(" {n}")).unwrap_or_default()
        ),
    );

    // The task's outcome changes the goal it serves: a delivered unit counts
    // as done, and a declined one leaves the goal's work. Best effort, and
    // never a regression (`apply_resolved_goal_progress` only moves forward).
    if let Some(goal_id) = task.goal_id.as_deref() {
        if let Err(e) = repo::apply_resolved_goal_progress(db, goal_id) {
            tracing::warn!(task_id = %task.id, goal_id = %goal_id, error = %e,
                "app-master outcome: goal progress recompute failed");
        }
    }

    let idea_status = if outcome == "declined" {
        // THE single verdict door. It writes the status, the decision memory
        // (a `constraint` the next scan reads as "do not re-raise this") and
        // the workspace adoption sync — which is also why `declined` must NOT
        // additionally call `write_back_to_source_idea`: both touch the
        // adoption cell and the last writer would win arbitrarily.
        apply_idea_verdict_cas(
            db,
            &idea.id,
            IdeaVerdict::Reject {
                reason: note.map(str::to_string),
            },
            ACTOR_APP_MASTER,
            None,
        )?
        .status
    } else {
        write_back_to_source_idea(db, &task.id, delivered);
        // `delivered` deliberately leaves the idea `accepted`. The undispatched
        // sensor keys on "accepted AND no task row", so a task in a done state
        // is what silences it — and `dev_ideas` has no `implemented` status to
        // move to (`schema.rs:1241` defaults `pending`; the vocabulary the
        // verdict door writes is `accepted` / `rejected`).
        //
        // `already_delivered` lands here too, and that is the whole point: it
        // silences the sensor through the completed task WITHOUT going through
        // the reject door, so closing an item the repository already satisfies
        // leaves no "do not re-surface" constraint behind.
        repo::get_idea_by_id(db, &idea.id)?.status
    };

    Ok(IdeaOutcomeResult {
        idea_id: idea.id,
        idea_status,
        task_status: task.status.clone(),
        task,
        task_created,
    })
}

/// The actor name an App Master's own write carries into the decision memory.
///
/// `record_idea_decision_by` (`dev_tools.rs:717`) interpolates the actor into
/// the memory title and body — it is free text, not a validated enum, so the
/// role can name itself rather than borrowing `Autonomy` from the overnight
/// dispatcher and becoming indistinguishable from it in the ledger.
pub const ACTOR_APP_MASTER: &str = "AppMaster";

// ============================================================================
// 2 · Filing a backlog item
// ============================================================================

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct FileIdeaInput {
    pub project_id: String,
    pub title: String,
    pub description: Option<String>,
    #[serde(default)]
    pub reasoning: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub effort: Option<i32>,
    #[serde(default)]
    pub impact: Option<i32>,
    #[serde(default)]
    pub risk: Option<i32>,
    #[serde(default)]
    pub context_id: Option<String>,
    /// The goal this item serves: a goal id, an id prefix of 8+ characters,
    /// or the goal's exact title. Resolved against the project; a reference
    /// that names no single goal files the item unbound and says so in
    /// `goal_note` rather than refusing the filing.
    #[serde(default, alias = "goal_id", alias = "goalId")]
    pub goal: Option<String>,
    /// File the item even though the backlog already holds a filing that
    /// reads as a paraphrase of it. Only for a finding that is genuinely
    /// different; an exact re-filing is still deduped.
    #[serde(default)]
    pub force: Option<bool>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FileIdeaResult {
    pub idea: DevIdea,
    /// False when the dedup guard matched and `idea` is the row that already
    /// held this key — in ANY status, `rejected` included. A worker re-filing
    /// something a human has already said no to gets that row back, and must
    /// not treat it as a fresh item.
    pub created: bool,
    pub dedup_key: String,
    /// What the filing actually did: `created`, `deduped`, or `rated`.
    /// `rated` is a dedup hit whose MISSING 1-5 scales this filing supplied —
    /// an unrated idea is one the project's mechanical triage rule can never
    /// accept, so a re-file that carries a risk score changes the row's fate
    /// and must not report itself as a plain duplicate.
    pub outcome: String,
    /// What happened to the goal reference, when there is something to say:
    /// the reference named no goal of this project, the row already served a
    /// different goal (the first binding stands), or no goal was named while
    /// the project has open goals. `None` when the goal was bound as asked or
    /// the project has no open goal to serve. Advisory, never a refusal.
    pub goal_note: Option<String>,
    /// What the project's triage rules did when this filing gave them a rated
    /// row to answer: a fresh filing carrying a risk score, or a re-filing
    /// that filled a missing scale in. `None` when the rules were not run
    /// (nothing new to judge) or could not run. `idea.status` is read AFTER
    /// the pass, so an item a rule accepted already reads `accepted`.
    pub triage: Option<FiledIdeaTriage>,
    /// Set when outcome is `near_duplicate`: which item already on the backlog
    /// this filing reads as a paraphrase of, and how to file anyway when it is
    /// a different finding.
    pub duplicate_note: Option<String>,
}

/// The triage-rules pass a filing triggered, over the project's whole pending
/// backlog (the rules are not per-idea, so a pass answers every rated row
/// still waiting, not only this one).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FiledIdeaTriage {
    /// Ideas the pass accepted.
    pub accepted: u32,
    /// Ideas the pass rejected.
    pub rejected: u32,
}

/// `FileIdeaResult::outcome` — a fresh row.
pub const FILE_IDEA_CREATED: &str = "created";
/// `FileIdeaResult::outcome` — the dedup guard matched and nothing changed.
pub const FILE_IDEA_DEDUPED: &str = "deduped";
/// `FileIdeaResult::outcome` — the dedup guard matched and this filing filled
/// in at least one scale the existing row was missing.
pub const FILE_IDEA_RATED: &str = "rated";
/// `FileIdeaResult::outcome` — no exact key matched, but the backlog already
/// holds an item this filing reads as a paraphrase of. `idea` is that item
/// (with any scale it was missing filled in); nothing new was filed.
pub const FILE_IDEA_NEAR_DUPLICATE: &str = "near_duplicate";

/// File a `pending` backlog item on the project's behalf.
///
/// Goes through [`repo::create_idea_deduped`] — the guarded door every
/// *generated* idea uses — with the key built by the repo's own
/// [`repo::scan_dedup_key`], so an App Master re-filing the same observation on
/// a later wake is a no-op instead of a duplicate.
pub fn file_backlog_idea(db: &DbPool, input: &FileIdeaInput) -> Result<FileIdeaResult, AppError> {
    personas_core::validation::require_non_empty("project_id", &input.project_id)?;
    personas_core::validation::require_non_empty("title", &input.title)?;
    // Resolve the project so an unknown id is a 400 naming the project rather
    // than a foreign-key failure naming a column.
    let project = repo::get_project_by_id(db, input.project_id.trim())?;

    let title = input.title.trim();
    let dedup_key = repo::scan_dedup_key(
        APP_MASTER_SCAN_TYPE,
        trimmed(input.context_id.as_ref()),
        title,
    );

    // An honest paraphrase of an item already on the backlog keys differently
    // (the key is built from the title's words), so look for one before the
    // insert, unless the exact key already matches (that is the guard's hit)
    // or the filer says this is a different finding.
    if !input.force.unwrap_or(false)
        && repo::find_idea_by_dedup_key(db, &project.id, &dedup_key)?.is_none()
    {
        if let Some(near) = repo::find_near_duplicate_idea(
            db,
            &project.id,
            title,
            trimmed(input.description.as_ref()),
        )? {
            let (idea, backfill) = repo::backfill_idea_scales(
                db,
                &near.idea.id,
                input.effort,
                input.impact,
                input.risk,
            )?;
            let duplicate_note = Some(format!(
                "already on the backlog as [{}] \"{}\" ({}, similarity {:.2}), so nothing new \
                 was filed; if yours is a different finding, re-file with \"force\": true",
                short_id(&idea.id),
                idea.title,
                idea.status,
                near.score
            ));
            let filed = FileIdeaResult {
                idea,
                created: false,
                dedup_key,
                outcome: FILE_IDEA_NEAR_DUPLICATE.to_string(),
                goal_note: None,
                triage: None,
                duplicate_note,
            };
            let filed = bind_filed_goal(db, &project.id, filed, trimmed(input.goal.as_ref()))?;
            return triage_filed_idea(
                db,
                &project.id,
                filed,
                matches!(backfill, repo::ScaleBackfill::Rated),
            );
        }
    }

    let created = repo::create_idea_deduped(
        db,
        &project.id,
        trimmed(input.context_id.as_ref()),
        APP_MASTER_SCAN_TYPE,
        trimmed(input.category.as_ref()),
        title,
        trimmed(input.description.as_ref()),
        trimmed(input.reasoning.as_ref()),
        input.effort,
        input.impact,
        input.risk,
        None,
        None,
        &dedup_key,
    )?;

    let filed = match created {
        Some(idea) => FileIdeaResult {
            idea,
            created: true,
            dedup_key,
            outcome: FILE_IDEA_CREATED.to_string(),
            goal_note: None,
            triage: None,
            duplicate_note: None,
        },
        // The guard fired. Hand back what is already there — "already filed" and
        // "could not file" are different answers and the caller must be able to
        // tell them apart.
        //
        // A re-file is not always a no-op: the row already in the backlog may
        // have been filed WITHOUT scales, and an unrated idea is one the
        // project's triage rule can never accept. Fill in what it is missing
        // (never overwriting a score that is already there) and say so.
        None => {
            let existing =
                repo::find_idea_by_dedup_key(db, &project.id, &dedup_key)?.ok_or_else(|| {
                    AppError::Internal(format!(
                        "backlog item {dedup_key} was deduped but cannot be read back"
                    ))
                })?;
            let (idea, backfill) = repo::backfill_idea_scales(
                db,
                &existing.id,
                input.effort,
                input.impact,
                input.risk,
            )?;
            FileIdeaResult {
                idea,
                created: false,
                dedup_key,
                outcome: match backfill {
                    repo::ScaleBackfill::Rated => FILE_IDEA_RATED.to_string(),
                    repo::ScaleBackfill::Unchanged => FILE_IDEA_DEDUPED.to_string(),
                },
                goal_note: None,
                triage: None,
                duplicate_note: None,
            }
        }
    };
    let judgeable = (filed.created && input.risk.is_some()) || filed.outcome == FILE_IDEA_RATED;
    let filed = bind_filed_goal(db, &project.id, filed, trimmed(input.goal.as_ref()))?;
    triage_filed_idea(db, &project.id, filed, judgeable)
}

/// Run the project's triage rules when a filing handed them something new to
/// judge, the same way the protocol filing path does (`engine/dispatch.rs`,
/// G30).
///
/// The rules read the 1-5 scales, so a rated row is exactly the question they
/// exist to answer. Before this, only the protocol door, the scanner and the
/// overnight tick ran them: an idea a fleet worker filed through this bridge
/// with risk 1 sat `pending` until some unrelated filing or a night pass
/// triaged the project, while the write-back brief told the worker it would be
/// accepted without a human. Two filings qualify: a fresh row carrying a risk
/// score, and a re-filing that filled a missing scale in. A plain duplicate
/// changed nothing the rules can see, so it runs nothing.
///
/// Best effort: the finding is already on the backlog, so a rules failure is
/// logged and the filing still answers. The pass touches `dev_ideas` only;
/// an App Master's operator asks live in `persona_manual_reviews` and are
/// never reached by it (G43).
fn triage_filed_idea(
    db: &DbPool,
    project_id: &str,
    mut filed: FileIdeaResult,
    judgeable: bool,
) -> Result<FileIdeaResult, AppError> {
    if !judgeable {
        return Ok(filed);
    }
    match run_triage_rules_core(db, project_id) {
        Ok(pass) => {
            if pass.ideas_affected > 0 {
                filed.idea = repo::get_idea_by_id(db, &filed.idea.id)?;
            }
            filed.triage = Some(FiledIdeaTriage {
                accepted: u32::try_from(pass.ideas_affected.saturating_sub(pass.rejected_count))
                    .unwrap_or(u32::MAX),
                rejected: u32::try_from(pass.rejected_count).unwrap_or(u32::MAX),
            });
        }
        Err(e) => {
            tracing::warn!(
                project_id,
                idea_id = %filed.idea.id,
                error = %e,
                "app-master filing: triage rules failed to run"
            );
        }
    }
    Ok(filed)
}

/// The filer's door on the bridge: [`file_backlog_idea`], refused first when
/// the filing does not carry all three 1-5 scales.
///
/// The owner's rule (2026-09-09): the one who files an idea scores it. An
/// unrated row is invisible to the project's mechanical triage rule, so a
/// filing short of a scale sits `pending` until a human reads it. The HTTP
/// route has a synchronous reply, so the refusal reaches the worker in the
/// same turn and it re-files with the numbers; that is cheaper than an idea
/// nobody can ever accept automatically.
///
/// Two deliberate exceptions. A filing that collides with a row already on
/// the backlog still goes through, because a re-file carrying scales is how an
/// unrated row gets rated, and refusing a partial re-file would keep the row
/// unrated. And the replay queue keeps calling [`file_backlog_idea`] directly:
/// a queued filing has no worker left to answer, so refusing it would lose the
/// finding, which is worse than filing it unrated (the protocol filing path
/// makes the same call for the same reason).
pub fn file_rated_backlog_idea(
    db: &DbPool,
    input: &FileIdeaInput,
) -> Result<FileIdeaResult, AppError> {
    personas_core::validation::require_non_empty("project_id", &input.project_id)?;
    personas_core::validation::require_non_empty("title", &input.title)?;
    let out_of_range: Vec<String> = [
        ("effort", input.effort),
        ("impact", input.impact),
        ("risk", input.risk),
    ]
    .into_iter()
    .filter_map(|(k, v)| {
        v.filter(|v| !(1..=5).contains(v))
            .map(|v| format!("{k} {v}"))
    })
    .collect();
    if !out_of_range.is_empty() {
        return Err(AppError::Validation(format!(
            "scales are integers 1-5, got {}",
            out_of_range.join(", ")
        )));
    }
    let missing: Vec<&str> = [
        ("effort", input.effort.is_none()),
        ("impact", input.impact.is_none()),
        ("risk", input.risk.is_none()),
    ]
    .into_iter()
    .filter_map(|(k, gone)| gone.then_some(k))
    .collect();
    if !missing.is_empty() {
        let project = repo::get_project_by_id(db, input.project_id.trim())?;
        let dedup_key = repo::scan_dedup_key(
            APP_MASTER_SCAN_TYPE,
            trimmed(input.context_id.as_ref()),
            input.title.trim(),
        );
        if repo::find_idea_by_dedup_key(db, &project.id, &dedup_key)?.is_none() {
            return Err(AppError::Validation(format!(
                "missing {}: the filer scores every item on effort, impact and risk, \
                 each an integer 1-5; re-file with all three",
                missing.join(", ")
            )));
        }
    }
    file_backlog_idea(db, input)
}

/// How many open goals a "you named no goal" note lists by name.
const GOAL_NOTE_LISTED: usize = 5;

/// Bind the filed row to the goal the filer named, or tell it which goals it
/// could have named.
///
/// Runs on a created row AND on a dedup hit, through the repo's
/// never-overwrite door ([`repo::bind_idea_goal_if_unset`]), so a row first
/// filed without a goal gains one from a later filing and a row that already
/// serves a goal keeps it. Nothing here refuses the filing: the finding is
/// already on the backlog, and losing it over a goal reference would be worse
/// than filing it unbound and saying so.
fn bind_filed_goal(
    db: &DbPool,
    project_id: &str,
    mut filed: FileIdeaResult,
    goal_ref: Option<&str>,
) -> Result<FileIdeaResult, AppError> {
    match goal_ref {
        Some(goal_ref) => {
            match repo::bind_idea_goal_if_unset(db, &filed.idea.id, project_id, goal_ref)? {
                repo::IdeaGoalBinding::Bound(_) => {
                    filed.idea = repo::get_idea_by_id(db, &filed.idea.id)?;
                }
                repo::IdeaGoalBinding::AlreadyServes(_) => {}
                repo::IdeaGoalBinding::KeptExisting(held) => {
                    filed.goal_note = Some(format!(
                        "this item already serves goal {}; the first binding stands",
                        short_id(&held)
                    ));
                }
                repo::IdeaGoalBinding::Unresolved => {
                    filed.goal_note = Some(format!(
                        "goal `{goal_ref}` names no single goal of this project, so the item \
                         is filed with no goal; name a goal by its id{}",
                        open_goals_suffix(db, project_id)?
                    ));
                }
            }
        }
        None if filed.idea.goal_id.is_none() => {
            let suffix = open_goals_suffix(db, project_id)?;
            if !suffix.is_empty() {
                filed.goal_note = Some(format!(
                    "filed with no goal; add \"goal\" when the item serves one{suffix}"
                ));
            }
        }
        None => {}
    }
    Ok(filed)
}

/// `"; this project has N open goals: [id8] title, ..."`, or empty when the
/// project has no goal left to serve.
fn open_goals_suffix(db: &DbPool, project_id: &str) -> Result<String, AppError> {
    let open: Vec<_> = repo::list_goals_by_project(db, project_id, None)?
        .into_iter()
        .filter(|g| {
            !matches!(
                repo::normalize_goal_status(&g.status),
                "done" | "awaiting_acceptance"
            )
        })
        .collect();
    if open.is_empty() {
        return Ok(String::new());
    }
    let listed: Vec<String> = open
        .iter()
        .take(GOAL_NOTE_LISTED)
        .map(|g| format!("[{}] {}", short_id(&g.id), g.title))
        .collect();
    let more = open.len().saturating_sub(GOAL_NOTE_LISTED);
    Ok(format!(
        "; this project has {} open goal{}: {}{}",
        open.len(),
        if open.len() == 1 { "" } else { "s" },
        listed.join(", "),
        if more > 0 {
            format!(" and {more} more")
        } else {
            String::new()
        }
    ))
}

fn short_id(id: &str) -> &str {
    id.get(..8).unwrap_or(id)
}

// ============================================================================
// 3 · Declaring a KPI
// ============================================================================

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct CreateKpiInput {
    pub project_id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub measure_kind: Option<String>,
    /// JSON blob describing HOW the number is read. Defaults to `{}`.
    #[serde(default)]
    pub measure_config: Option<String>,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub direction: Option<String>,
    #[serde(default)]
    pub baseline_value: Option<f64>,
    #[serde(default)]
    pub target_value: Option<f64>,
    #[serde(default)]
    pub target_date: Option<String>,
    #[serde(default)]
    pub cadence: Option<String>,
    /// `proposed` (default) or `active`. A worker proposing a meter is the
    /// normal case; activating one is a claim it can already be read.
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub rationale: Option<String>,
    #[serde(default)]
    pub context_group_id: Option<String>,
    #[serde(default)]
    pub context_id: Option<String>,
}

/// Declare a KPI on the project, through `repos::dev::kpis::create_kpi`.
///
/// `created_by` is fixed to `scan` — the column's CHECK admits only
/// `user | scan` (`c02_dev_goals_and_kpis.rs:273`), and a headless run is not a
/// user. Defaults mirror the `dev_tools_create_kpi` command
/// (`dev_tools.rs:1768`) rather than inventing a second set.
pub fn create_project_kpi(db: &DbPool, input: &CreateKpiInput) -> Result<DevKpi, AppError> {
    personas_core::validation::require_non_empty("project_id", &input.project_id)?;
    personas_core::validation::require_non_empty("name", &input.name)?;
    let project = repo::get_project_by_id(db, input.project_id.trim())?;

    let category = trimmed(input.category.as_ref()).unwrap_or("technical");
    let measure_kind = trimmed(input.measure_kind.as_ref()).unwrap_or("manual");
    let direction = trimmed(input.direction.as_ref()).unwrap_or("up");
    let cadence = trimmed(input.cadence.as_ref()).unwrap_or("manual");
    let status = trimmed(input.status.as_ref()).unwrap_or("proposed");
    require_one_of("category", category, &KPI_CATEGORIES)?;
    require_one_of("measure_kind", measure_kind, &KPI_MEASURE_KINDS)?;
    require_one_of("direction", direction, &KPI_DIRECTIONS)?;
    require_one_of("cadence", cadence, &KPI_CADENCES)?;
    require_one_of("status", status, &KPI_CREATE_STATUSES)?;

    repo::create_kpi(
        db,
        &project.id,
        input.name.trim(),
        trimmed(input.description.as_ref()),
        trimmed(input.context_group_id.as_ref()),
        category,
        measure_kind,
        trimmed(input.measure_config.as_ref()).unwrap_or("{}"),
        input.unit.as_deref().unwrap_or("").trim(),
        direction,
        input.baseline_value,
        input.target_value,
        trimmed(input.target_date.as_ref()),
        cadence,
        Some(status),
        "scan",
        trimmed(input.rationale.as_ref()),
        None,
        None,
        trimmed(input.context_id.as_ref()),
        None,
    )
}

// ============================================================================
// 4 · Recording a reading
// ============================================================================

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct MeasureKpiInput {
    pub value: f64,
    /// One of `evaluator | manual | scan | health_snapshot`. Defaults to `scan`
    /// — an automated worker reading the repository is a scan.
    #[serde(default)]
    pub source: Option<String>,
    /// `local` | `test` | `production`. Defaults to `production`: a worker
    /// measuring the project's real tree IS the production channel. `local` and
    /// `test` route to the SIMULATION door, which writes `source = 'simulation'`
    /// and deliberately does not roll `current_value` forward.
    #[serde(default)]
    pub env: Option<String>,
    #[serde(default)]
    pub evidence: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

/// Record one reading against a KPI.
///
/// Two doors, chosen by `env`, because the repo has two and the difference is
/// load-bearing: a production reading rolls `dev_kpis.current_value` /
/// `last_measured_at` forward, and a non-production one must never do that
/// (`repos/dev/kpis.rs:487`). Picking the door here rather than passing `env`
/// through one is what keeps a simulated value from claiming production.
pub fn record_kpi_reading(
    db: &DbPool,
    kpi_id: &str,
    input: &MeasureKpiInput,
) -> Result<DevKpiMeasurement, AppError> {
    if !input.value.is_finite() {
        return Err(AppError::Validation(
            "measurement value is not a finite number".into(),
        ));
    }
    let source = trimmed(input.source.as_ref()).unwrap_or("scan");
    let env = trimmed(input.env.as_ref()).unwrap_or("production");
    require_one_of("source", source, &MEASUREMENT_SOURCES)?;
    require_one_of("env", env, &MEASUREMENT_ENVS)?;
    // 404 on an unknown KPI before writing anything.
    repo::get_kpi(db, kpi_id)?;

    let evidence = trimmed(input.evidence.as_ref());
    let note = trimmed(input.note.as_ref());
    if env == "production" {
        repo::record_kpi_measurement(db, kpi_id, input.value, source, evidence, note)
    } else {
        repo::record_kpi_simulation_measurement(db, kpi_id, input.value, env, evidence, note)
    }
}

// ============================================================================
// 5 · Goals
// ============================================================================
//
// Until these existed a charter run could measure goal traceability but not
// read the goals, amend one, tick a checklist item or say which goal past work
// served: goal CRUD lived only behind Tauri IPC, and every amendment waited for
// a decide wake to carry it in the plan JSON. Creating and closing a goal stay
// out of this door on purpose: creation is the decide lane's, and `done` is
// the operator's acceptance.

/// One goal as a worker reads it: the row, its checklist, and the work that
/// names it.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGoal {
    pub goal: DevGoal,
    pub items: Vec<DevGoalItem>,
    /// Ideas naming the goal, in any status.
    pub ideas: u32,
    /// Tasks naming the goal, in any status.
    pub tasks: u32,
    /// Of those tasks, the ones that reached `completed`.
    pub completed_tasks: u32,
}

fn count_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// Every goal of a project with its checklist and attached work.
pub fn list_project_goals(db: &DbPool, project_id: &str) -> Result<Vec<ProjectGoal>, AppError> {
    let project = repo::get_project_by_id(db, project_id.trim())?;
    let work = repo::goal_work_by_project(db, &project.id)?;
    repo::list_goals_by_project(db, &project.id, None)?
        .into_iter()
        .map(|goal| {
            let w = work.iter().find(|w| w.goal_id == goal.id);
            Ok(ProjectGoal {
                items: repo::list_goal_items(db, &goal.id)?,
                ideas: count_u32(w.map_or(0, |w| w.ideas)),
                tasks: count_u32(w.map_or(0, |w| w.tasks)),
                completed_tasks: count_u32(w.map_or(0, |w| w.completed_tasks)),
                goal,
            })
        })
        .collect()
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct AmendGoalInput {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// `open` | `in-progress` | `blocked` | `awaiting_acceptance`. `done` is
    /// refused: closing a goal is the operator's acceptance.
    #[serde(default)]
    pub status: Option<String>,
}

/// Amend a goal's wording or status in place, through `update_goal` (the same
/// write the decide lane's `goals` verb makes).
pub fn amend_project_goal(
    db: &DbPool,
    goal_id: &str,
    input: &AmendGoalInput,
) -> Result<DevGoal, AppError> {
    let goal = repo::get_goal_by_id(db, goal_id.trim())?;
    let title = trimmed(input.title.as_ref());
    let description = trimmed(input.description.as_ref());
    let status = match trimmed(input.status.as_ref()) {
        None => None,
        Some(raw) => match repo::canonical_goal_status(raw) {
            Some("done") => {
                return Err(AppError::Validation(
                    "a goal is closed by the operator's acceptance, not through this door; \
                     set `awaiting_acceptance` when you believe it is met"
                        .into(),
                ))
            }
            Some(s) => Some(s),
            None => {
                return Err(AppError::Validation(format!(
                    "status must be one of open | in-progress | blocked | awaiting_acceptance, got `{raw}`"
                )))
            }
        },
    };
    if title.is_none() && description.is_none() && status.is_none() {
        return Err(AppError::Validation(
            "nothing to amend: send at least one of title, description, status".into(),
        ));
    }
    repo::update_goal(
        db,
        &goal.id,
        title,
        description.map(Some),
        status,
        None,
        None,
        None,
        None,
        None,
        None,
    )
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct GoalItemInput {
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GoalItemResult {
    pub item: DevGoalItem,
    /// The goal's progress after the recompute.
    pub goal_progress: i32,
}

/// Tick (or un-tick) one checklist item on a goal and recompute the goal's
/// progress from it.
///
/// A verification gate (`verify_kind` set) is refused: it is closed by its
/// passing test, never by hand, exactly as the UI's own item command refuses
/// it. Un-ticking an ordinary item re-opens a gate that had already passed, so
/// "done" never outlives the scope it was verified against.
pub fn set_goal_item_done(
    db: &DbPool,
    goal_id: &str,
    item_id: &str,
    input: &GoalItemInput,
) -> Result<GoalItemResult, AppError> {
    let goal = repo::get_goal_by_id(db, goal_id.trim())?;
    let item = repo::list_goal_items(db, &goal.id)?
        .into_iter()
        .find(|i| i.id == item_id.trim())
        .ok_or_else(|| {
            AppError::NotFound(format!("goal {} has no checklist item {item_id}", goal.id))
        })?;
    if item.verify_kind.is_some() {
        return Err(AppError::Validation(
            "this item is a verification gate: it is closed by its passing test, not by hand"
                .into(),
        ));
    }
    let item = repo::update_goal_item(db, &item.id, None, Some(input.done))?;
    if !input.done {
        repo::reopen_verification_if_passed(db, &goal.id)?;
    }
    let goal_progress = repo::apply_resolved_goal_progress(db, &goal.id)?;
    Ok(GoalItemResult {
        item,
        goal_progress,
    })
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct IdeaGoalInput {
    /// A goal id, an id prefix of 8+ characters, or the goal's exact title,
    /// resolved against the idea's project.
    #[serde(alias = "goal_id", alias = "goalId")]
    pub goal: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct IdeaGoalResult {
    pub idea: DevIdea,
    pub goal_id: String,
    /// The idea's delivery tasks that served no goal and now serve this one.
    pub tasks_linked: u32,
    /// The goal's progress after the recompute, when any task was linked.
    pub goal_progress: Option<i32>,
}

/// Say, after the fact, which goal an idea's work served.
///
/// Binds the idea through the filing doors' never-overwrite door
/// ([`repo::bind_idea_goal_if_unset`]), then attributes the idea's tasks that
/// serve no goal, so work already delivered counts toward the goal it served.
/// An idea already serving a DIFFERENT goal is refused: moving work between
/// goals is not a worker's call.
pub fn attribute_idea_to_goal(
    db: &DbPool,
    idea_id: &str,
    input: &IdeaGoalInput,
) -> Result<IdeaGoalResult, AppError> {
    personas_core::validation::require_non_empty("goal", &input.goal)?;
    let idea = repo::get_idea_by_id(db, idea_id.trim())?;
    let project_id = idea.project_id.clone().ok_or_else(|| {
        AppError::Validation(format!(
            "idea {} belongs to no project, so it can serve no goal",
            idea.id
        ))
    })?;
    let goal_ref = input.goal.trim();
    let goal_id = match repo::bind_idea_goal_if_unset(db, &idea.id, &project_id, goal_ref)? {
        repo::IdeaGoalBinding::Bound(g) | repo::IdeaGoalBinding::AlreadyServes(g) => g.id,
        repo::IdeaGoalBinding::KeptExisting(held) => {
            return Err(AppError::Validation(format!(
                "idea {} already serves goal {}; the first binding stands",
                short_id(&idea.id),
                short_id(&held)
            )))
        }
        repo::IdeaGoalBinding::Unresolved => {
            return Err(AppError::Validation(format!(
                "goal `{goal_ref}` names no single goal of this idea's project{}",
                open_goals_suffix(db, &project_id)?
            )))
        }
    };
    let linked = repo::link_idea_tasks_to_goal(db, &idea.id, &goal_id)?;
    let goal_progress = if linked > 0 {
        Some(repo::apply_resolved_goal_progress(db, &goal_id)?)
    } else {
        None
    };
    Ok(IdeaGoalResult {
        idea: repo::get_idea_by_id(db, &idea.id)?,
        goal_id,
        tasks_linked: count_u32(linked),
        goal_progress,
    })
}

// ============================================================================
// The brief — what every App Master dispatch tells its worker
// ============================================================================

/// The one instruction that reconciles the backlog against the default branch.
///
/// The undispatched sensor only asks "accepted, and no live task?", so an item
/// some other branch already satisfied is offered on every wake until a worker
/// says so. Before `already_delivered` existed the only word for it was
/// `declined`, which files a rejection constraint against work that shipped.
const ALREADY_DELIVERED_LINE: &str =
    "If you find an accepted idea of this project ALREADY satisfied on the default branch \
     (by any work, not only yours), close it instead of building it again: \
     POST /dev-tools/ideas/<idea_id>/outcome \
     {\"outcome\":\"already_delivered\",\"commit\":\"<sha on the default branch>\",\
     \"note\":\"what already covers it\"}. `commit` is required. \
     Do NOT report that as \"declined\" — declining writes a standing \"do not build this\" \
     ruling against work that shipped.\n";

/// The write-back block appended to every App Master dispatch.
///
/// Pure and bounded, and deliberately short: it rides on EVERY dispatch, beside
/// the charter's own contract and the worktree guardrails, so every line has to
/// earn its place. It names the handshake file, the header, the four routes and
/// the one rule — because a worker that cannot find the door does not write
/// back, and cycle 1 measured exactly that outcome.
///
/// [`ALREADY_DELIVERED_LINE`] rides on EVERY brief, including a dispatch that
/// names no idea: a certification or stewardship worker is often the one that
/// notices an accepted item is already on main, and until it was told how to
/// close one, nothing but a delivery dispatch ever could.
pub fn write_back_brief(project_id: &str, idea_ids: &[String]) -> String {
    let mut s = String::from(
        "\nPERSONAS WRITE-BACK — your run is not finished until the outcome is written back.\n\
         The app publishes a handshake at ~/.personas/local-http.json with `port` and `token`.\n\
         Every call needs the header `x-personas-local-token: <token>` and\n\
         a base of http://127.0.0.1:<port>/dev-tools\n",
    );
    s.push_str(&format!("Your project_id is {project_id}.\n"));
    if let [idea] = idea_ids {
        s.push_str(&format!(
            "Your idea_id is {idea}. Report it EXACTLY once, when you stop:\n\
             - POST /dev-tools/ideas/{idea}/outcome \
             {{\"outcome\":\"delivered\",\"note\":\"what shipped\",\
             \"branch\":\"...\",\"commit\":\"...\"}}\n\
             - ...or {{\"outcome\":\"declined\",\"note\":\"why this should not be built\"}}\n\
             - ...or {{\"outcome\":\"blocked\",\"note\":\"what stopped you\"}}\n\
             Add \"pr_url\":\"<url>\" to that call when you opened a pull request — \
             it is how the next wake sees the PR at all.\n"
        ));
    } else if !idea_ids.is_empty() {
        // A batch. Each idea carries its own row and its own sensor entry, so
        // each needs its own verdict: one call covering six would leave five
        // reading "accepted, no task" while the work was done, which is the
        // exact miscount batching was allowed in order to fix. The verdicts
        // may differ — delivering four of six and blocking two is a good
        // outcome honestly reported, and better than one verdict averaged
        // over six.
        s.push_str(&format!(
            "This run carries {} accepted ideas, batched onto one branch. \
             Report EACH of them EXACTLY once, when you stop — one call per idea, \
             with its own verdict:\n",
            idea_ids.len()
        ));
        for idea in idea_ids {
            s.push_str(&format!("- POST /dev-tools/ideas/{idea}/outcome\n"));
        }
        s.push_str(
            "Each call takes {\"outcome\":\"delivered\",\"note\":\"what shipped\",\
             \"branch\":\"...\",\"commit\":\"...\"} — or \
             {\"outcome\":\"declined\",\"note\":\"why this should not be built\"} — or \
             {\"outcome\":\"blocked\",\"note\":\"what stopped you\"}. \
             Add \"pr_url\":\"<url>\" when you opened a pull request; it is how the \
             next wake sees the PR at all.\n\
             Do not report one verdict for the batch. An idea you finished and did \
             not report stays on the backlog for ever and will be dispatched again.\n",
        );
    }
    s.push_str(ALREADY_DELIVERED_LINE);
    s.push_str(&format!(
        "Anything else you learned goes back as data, not as prose in your transcript:\n\
         - POST /dev-tools/ideas \
         {{\"project_id\":\"{project_id}\",\"title\":\"...\",\"description\":\"...\",\"effort\":2,\"impact\":3,\"risk\":2,\"goal\":\"<goal id>\"}} \
         — file a backlog item (deduped, paraphrases included; re-filing is safe; \
         \"force\":true files a different finding that reads alike); `goal` names the goal it serves\n\
         `effort`, `impact` and `risk` (each 1-5) are REQUIRED; a filing without them is refused. \
         1 documentation or a reversible local change · 2 code behind a test · \
         3 touches a route, a contract or a schema · \
         4 touches ledger, settlement or security semantics · 5 irreversible or external. \
         Risk 1-2 is accepted by the project's triage rule without a human. \
         Re-filing an item you first filed unrated fills its score in.\n\
         - POST /dev-tools/kpis \
         {{\"project_id\":\"{project_id}\",\"name\":\"...\",\"measure_kind\":\"codebase\"}} \
         — declare a meter\n\
         - POST /dev-tools/kpis/<kpi_id>/measure \
         {{\"value\":12.5,\"evidence\":\"the command and its output\"}} \
         — record a reading\n\
         - GET /dev-tools/goals/{project_id} — the goals, their checklists and the work naming them; \
         POST /dev-tools/goals/<goal_id>/amend {{\"title\"|\"description\"|\"status\"}} · \
         POST /dev-tools/goals/<goal_id>/items/<item_id> {{\"done\":true}} · \
         POST /dev-tools/ideas/<idea_id>/goal {{\"goal\":\"<goal id>\"}} (attribute past work)\n\
         A KPI you only described in a commit message does not exist. \
         An idea you only mentioned is not filed.\n"
    ));
    s
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use personas_db::init_test_db;

    fn project(pool: &DbPool, name: &str) -> String {
        repo::create_project(pool, name, "/tmp/wb", None, None, None, None, None)
            .expect("project")
            .id
    }

    fn accepted_idea(pool: &DbPool, project_id: &str, title: &str) -> DevIdea {
        let idea = repo::create_idea(
            pool,
            Some(project_id),
            None,
            "manual",
            Some("technical"),
            title,
            Some("body"),
            None,
            Some("accepted"),
            None,
            None,
            None,
            None,
            None,
        )
        .expect("idea");
        idea
    }

    // ── The brief (pure) ──────────────────────────────────────────────────

    #[test]
    fn the_brief_names_every_route_and_the_project() {
        let s = write_back_brief("proj-42", &["297f6ba4".to_string()]);
        for needle in [
            "proj-42",
            "297f6ba4",
            "/dev-tools/ideas/297f6ba4/outcome",
            "POST /dev-tools/ideas ",
            "POST /dev-tools/kpis ",
            "/measure",
            "x-personas-local-token",
            "~/.personas/local-http.json",
            "delivered",
            "declined",
            "blocked",
            "already_delivered",
            "\"pr_url\"",
            "GET /dev-tools/goals/proj-42",
            "/goals/<goal_id>/amend",
            "/goals/<goal_id>/items/<item_id>",
            "/dev-tools/ideas/<idea_id>/goal",
        ] {
            assert!(s.contains(needle), "the brief must name `{needle}`:\n{s}");
        }
        // It rides on every dispatch — keep it small enough to read.
        assert!(
            s.lines().count() <= 25,
            "the write-back brief grew past 25 lines ({})",
            s.lines().count()
        );
    }

    /// A dispatch that names no idea has no verdict to report — but it can
    /// still be the run that NOTICES an accepted item is already on main, and
    /// closing one is the only reconciliation the backlog has. So the brief
    /// drops the per-idea verdict routes and keeps the `already_delivered`
    /// instruction, addressed to `<idea_id>` rather than to one id.
    #[test]
    fn a_brief_without_an_idea_omits_the_verdict_route_but_can_still_close_delivered_work() {
        let s = write_back_brief("proj-42", &[]);
        assert!(
            !s.contains("Report it EXACTLY once"),
            "there is no idea to report on"
        );
        assert!(s.contains("proj-42"));
        assert!(s.contains("POST /dev-tools/kpis "));
        assert!(
            s.contains("already_delivered") && s.contains("/dev-tools/ideas/<idea_id>/outcome"),
            "every brief tells the worker how to close work it finds already on main:\n{s}"
        );
    }

    /// A batched run carries several ideas and each one owns a task row and a
    /// sensor entry, so each needs its own verdict. One call covering six
    /// would leave five reading "accepted, no task" while the work was done —
    /// the miscount batching was allowed in order to fix.
    #[test]
    fn a_batched_brief_names_every_idea_and_asks_for_a_verdict_each() {
        let ids: Vec<String> = ["c285ef9f", "9b85968e", "d394346a"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let s = write_back_brief("proj-42", &ids);
        assert!(s.contains("carries 3 accepted ideas"));
        assert!(s.contains("one call per idea"));
        for id in &ids {
            assert!(
                s.contains(&format!("/dev-tools/ideas/{id}/outcome")),
                "the batched brief must name `{id}`:
{s}"
            );
        }
        assert!(
            s.contains("Do not report one verdict for the batch"),
            "the failure mode has to be named, not implied"
        );
    }

    // ── Outcomes ──────────────────────────────────────────────────────────

    #[test]
    fn delivered_completes_the_task_and_silences_the_sensor() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "delivered-app");
        let idea = accepted_idea(&pool, &pid, "Ship the retry helper");

        // The sensor offers it while no task exists.
        assert_eq!(
            repo::list_undispatched_ideas(&pool, Some(&pid), None)?.len(),
            1
        );

        let out = record_idea_outcome(
            &pool,
            &idea.id,
            &IdeaOutcomeInput {
                outcome: "delivered".into(),
                note: Some("added the helper + tests".into()),
                branch: Some("autopilot/retry".into()),
                commit: Some("abc1234".into()),
                pr_url: None,
            },
        )?;

        assert!(out.task_created, "no dispatch had minted a task");
        assert_eq!(out.task_status, "completed");
        assert_eq!(out.idea_status, "accepted", "delivery is not a verdict");
        let desc = out.task.description.unwrap_or_default();
        assert!(desc.contains("App Master outcome: delivered"));
        assert!(desc.contains("branch: autopilot/retry"));
        assert!(desc.contains("commit: abc1234"));
        assert!(out.task.error.is_none(), "a delivery writes no error");
        assert_eq!(out.task.progress_pct, 100);
        assert!(out.task.completed_at.is_some());

        // The sensor is quiet now: an accepted idea WITH a task row.
        assert!(repo::list_undispatched_ideas(&pool, Some(&pid), None)?.is_empty());
        Ok(())
    }

    #[test]
    fn declined_rejects_the_idea_through_the_verdict_door() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "declined-app");
        let idea = accepted_idea(&pool, &pid, "Rewrite the router");

        let out = record_idea_outcome(
            &pool,
            &idea.id,
            &IdeaOutcomeInput {
                outcome: "declined".into(),
                note: Some("the router already does this".into()),
                branch: None,
                commit: None,
                pr_url: None,
            },
        )?;

        assert_eq!(out.task_status, "cancelled");
        assert_eq!(out.idea_status, "rejected");
        // The verdict door carried the reason onto the row, not just the task.
        let stored = repo::get_idea_by_id(&pool, &idea.id)?;
        assert_eq!(stored.status, "rejected");
        assert_eq!(
            stored.rejection_reason.as_deref(),
            Some("the router already does this")
        );
        assert_eq!(
            out.task.error.as_deref(),
            Some("the router already does this")
        );
        Ok(())
    }

    #[test]
    fn blocked_fails_the_task_and_leaves_the_idea_accepted() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "blocked-app");
        let idea = accepted_idea(&pool, &pid, "Wire the connector");

        let out = record_idea_outcome(
            &pool,
            &idea.id,
            &IdeaOutcomeInput {
                outcome: "blocked".into(),
                note: Some("no credential for the vendor API".into()),
                branch: None,
                commit: None,
                pr_url: None,
            },
        )?;
        assert_eq!(out.task_status, "failed");
        assert_eq!(out.idea_status, "accepted");
        assert_eq!(
            out.task.error.as_deref(),
            Some("no credential for the vendor API")
        );
        Ok(())
    }

    /// The reconciliation gap: an accepted item some OTHER branch already
    /// satisfied has no closure but a worker saying so. Before
    /// `already_delivered` the only word for it was `declined`, which routes
    /// through the reject verdict and leaves an importance-8 "do not
    /// re-surface" constraint standing against work that shipped. This outcome
    /// closes the item the way a delivery does and writes no verdict at all.
    #[test]
    fn already_delivered_closes_the_item_without_a_rejection() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "reconciled-app");
        let idea = accepted_idea(&pool, &pid, "Guard the retry against a zero backoff");

        assert_eq!(
            repo::list_undispatched_ideas(&pool, Some(&pid), None)?.len(),
            1
        );

        let out = record_idea_outcome(
            &pool,
            &idea.id,
            &IdeaOutcomeInput {
                outcome: "already_delivered".into(),
                note: Some("the backoff clamp landed with the scheduler rewrite".into()),
                branch: None,
                commit: Some("9f21ab0".into()),
                pr_url: None,
            },
        )?;

        assert_eq!(out.task_status, "completed", "the work exists");
        assert_eq!(out.task.progress_pct, 100);
        assert!(out.task.completed_at.is_some());
        assert!(
            out.task.error.is_none(),
            "nothing failed — this is not a blocked run"
        );
        let desc = out.task.description.clone().unwrap_or_default();
        assert!(desc.contains("App Master outcome: already_delivered"));
        assert!(desc.contains("commit: 9f21ab0"), "the claim is auditable");

        // No verdict was cast: the idea keeps its accepted status and, above
        // all, carries no rejection reason.
        assert_eq!(out.idea_status, "accepted");
        let stored = repo::get_idea_by_id(&pool, &idea.id)?;
        assert_eq!(stored.status, "accepted");
        assert!(
            stored.rejection_reason.is_none(),
            "delivered work must not be recorded as a refusal"
        );

        // And no "do not re-surface" constraint reached the shared ledger.
        let constraints =
            crate::db::repos::dev_memories::list_recent_by_kind(&pool, &pid, "idea_decision", 10)?;
        assert!(
            constraints.is_empty(),
            "already_delivered writes no decision memory, got {constraints:?}"
        );

        // The sensor stops offering it — the whole point.
        assert!(repo::list_undispatched_ideas(&pool, Some(&pid), None)?.is_empty());
        Ok(())
    }

    /// The claim is about the repository, not about this run, so it has to name
    /// the commit that makes it true — otherwise `already_delivered` is just a
    /// cheaper way to silence the sensor than building the thing.
    #[test]
    fn already_delivered_without_a_commit_is_refused() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "unproven-app");
        let idea = accepted_idea(&pool, &pid, "Something that may or may not exist");
        let err = record_idea_outcome(
            &pool,
            &idea.id,
            &IdeaOutcomeInput {
                outcome: "already_delivered".into(),
                note: Some("pretty sure it is there".into()),
                branch: None,
                commit: None,
                pr_url: None,
            },
        )
        .expect_err("a claim about main needs the sha that proves it");
        assert!(matches!(err, AppError::Validation(_)));
        assert!(
            repo::list_tasks(&pool, Some(&pid), None)?.is_empty(),
            "the refusal happens before anything is written"
        );
        Ok(())
    }

    #[test]
    fn an_outcome_updates_the_dispatch_task_rather_than_minting_a_second() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "reuse-app");
        let idea = accepted_idea(&pool, &pid, "Tune the cache");
        let dispatched = create_task_core(
            &pool,
            Some(&pid),
            &idea.title,
            Some("the dispatch brief"),
            Some(&idea.id),
            None,
            Some("running"),
            None,
        )?;

        let out = record_idea_outcome(
            &pool,
            &idea.id,
            &IdeaOutcomeInput {
                outcome: "delivered".into(),
                note: None,
                branch: None,
                commit: None,
                pr_url: None,
            },
        )?;
        assert!(!out.task_created);
        assert_eq!(out.task.id, dispatched.id);
        assert_eq!(repo::list_tasks(&pool, Some(&pid), None)?.len(), 1);
        // The dispatch brief survives; the outcome is appended to it.
        let desc = out.task.description.unwrap_or_default();
        assert!(desc.starts_with("the dispatch brief"));
        assert!(desc.contains("App Master outcome: delivered"));
        Ok(())
    }

    #[test]
    fn an_unknown_outcome_is_refused_before_anything_is_written() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "refuse-app");
        let idea = accepted_idea(&pool, &pid, "Something");
        let err = record_idea_outcome(
            &pool,
            &idea.id,
            &IdeaOutcomeInput {
                outcome: "done".into(),
                note: None,
                branch: None,
                commit: None,
                pr_url: None,
            },
        )
        .expect_err("`done` is not in the outcome vocabulary");
        assert!(matches!(err, AppError::Validation(_)));
        assert!(repo::list_tasks(&pool, Some(&pid), None)?.is_empty());
        Ok(())
    }

    // ── Filing ────────────────────────────────────────────────────────────

    #[test]
    fn filing_the_same_item_twice_returns_the_first_row() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "file-app");
        let input = FileIdeaInput {
            project_id: pid.clone(),
            title: "Extract the retry helper".into(),
            description: Some("three copies in the engine".into()),
            reasoning: Some("they drift".into()),
            category: Some("technical".into()),
            effort: Some(2),
            impact: Some(4),
            risk: Some(1),
            context_id: None,
            goal: None,
            force: None,
        };

        let first = file_backlog_idea(&pool, &input)?;
        assert!(first.created);
        assert_eq!(first.idea.status, "pending");
        assert_eq!(first.idea.scan_type, APP_MASTER_SCAN_TYPE);
        assert_eq!(first.idea.reasoning.as_deref(), Some("they drift"));

        // A reworded re-file collapses onto the same key (the title normalizer
        // drops filler words), so the second call creates nothing.
        let second = file_backlog_idea(
            &pool,
            &FileIdeaInput {
                title: "Extract the retry helper".into(),
                ..input.clone()
            },
        )?;
        assert!(!second.created);
        assert_eq!(second.idea.id, first.idea.id);
        assert_eq!(second.dedup_key, first.dedup_key);
        assert_eq!(first.outcome, FILE_IDEA_CREATED);
        // Both filings carried the SAME scales, so nothing was rated.
        assert_eq!(second.outcome, FILE_IDEA_DEDUPED);
        assert_eq!(
            repo::list_ideas(&pool, Some(&pid), None, None, None, None)?.len(),
            1
        );
        Ok(())
    }

    /// The G27 defect: `dev_ideas.risk` is nullable and the mechanical triage
    /// rule (`risk >= 1 AND risk < 3`) cannot see an unrated row, so an idea
    /// filed without a score can only ever move by a human reading it. A
    /// re-filing that carries the score has to be able to fix that.
    #[test]
    fn re_filing_an_unrated_item_with_a_risk_score_rates_it() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "rate-app");
        let unrated = FileIdeaInput {
            project_id: pid.clone(),
            title: "Split the settlement ledger writer".into(),
            description: Some("one function does three things".into()),
            reasoning: None,
            category: Some("technical".into()),
            effort: None,
            impact: None,
            risk: None,
            context_id: None,
            goal: None,
            force: None,
        };

        let first = file_backlog_idea(&pool, &unrated)?;
        assert!(first.created);
        assert_eq!(first.outcome, FILE_IDEA_CREATED);
        assert_eq!(first.idea.risk, None, "filed with no score at all");

        let rated = file_backlog_idea(
            &pool,
            &FileIdeaInput {
                effort: Some(2),
                impact: Some(4),
                risk: Some(1),
                ..unrated.clone()
            },
        )?;
        assert!(!rated.created);
        assert_eq!(rated.outcome, FILE_IDEA_RATED);
        assert_eq!(rated.idea.id, first.idea.id);
        assert_eq!(rated.idea.risk, Some(1));
        assert_eq!(rated.idea.effort, Some(2));
        assert_eq!(rated.idea.impact, Some(4));
        // Rating is an UPDATE — the dedup guarantee is untouched.
        assert_eq!(
            repo::list_ideas(&pool, Some(&pid), None, None, None, None)?.len(),
            1
        );

        // A third filing that adds nothing new is a plain duplicate again.
        let again = file_backlog_idea(
            &pool,
            &FileIdeaInput {
                effort: Some(2),
                impact: Some(4),
                risk: Some(1),
                ..unrated.clone()
            },
        )?;
        assert_eq!(again.outcome, FILE_IDEA_DEDUPED);
        Ok(())
    }

    #[test]
    fn re_filing_with_a_different_risk_keeps_the_first_and_records_the_note() -> Result<(), AppError>
    {
        let pool = init_test_db()?;
        let pid = project(&pool, "conflict-app");
        let filed = FileIdeaInput {
            project_id: pid.clone(),
            title: "Rotate the settlement signing key".into(),
            description: Some("the key is a year old".into()),
            reasoning: Some("touches settlement".into()),
            category: Some("technical".into()),
            effort: None,
            impact: None,
            risk: Some(4),
            context_id: None,
            goal: None,
            force: None,
        };
        let first = file_backlog_idea(&pool, &filed)?;
        assert_eq!(first.idea.risk, Some(4));

        // A later run scores the same item as trivially safe. The FIRST rating
        // stands — being re-filed is not a licence to talk a 4 down to a 1 —
        // and the disagreement is recorded where a triaging human sees it.
        let second = file_backlog_idea(
            &pool,
            &FileIdeaInput {
                risk: Some(1),
                ..filed.clone()
            },
        )?;
        assert!(!second.created);
        assert_eq!(second.outcome, FILE_IDEA_DEDUPED);
        assert_eq!(second.idea.risk, Some(4), "the first rating stands");
        let reasoning = second.idea.reasoning.clone().unwrap_or_default();
        assert!(
            reasoning.starts_with("touches settlement"),
            "the original reasoning is kept: {reasoning}"
        );
        assert!(
            reasoning.contains("[re-file] kept the first rating: risk 4 (re-filed as 1)"),
            "the disagreement is recorded: {reasoning}"
        );
        Ok(())
    }

    #[test]
    fn a_different_title_still_creates_a_second_item() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "create-app");
        let base = FileIdeaInput {
            project_id: pid.clone(),
            title: "Extract the retry helper".into(),
            description: None,
            reasoning: None,
            category: Some("technical".into()),
            effort: None,
            impact: None,
            risk: Some(2),
            context_id: None,
            goal: None,
            force: None,
        };
        let first = file_backlog_idea(&pool, &base)?;
        let other = file_backlog_idea(
            &pool,
            &FileIdeaInput {
                title: "Cache the exchange-rate lookup".into(),
                ..base.clone()
            },
        )?;
        assert_eq!(first.outcome, FILE_IDEA_CREATED);
        assert_eq!(other.outcome, FILE_IDEA_CREATED);
        assert_ne!(other.idea.id, first.idea.id);
        assert_eq!(
            repo::list_ideas(&pool, Some(&pid), None, None, None, None)?.len(),
            2
        );
        Ok(())
    }

    #[test]
    fn a_filing_that_names_a_goal_binds_it_and_a_dedup_hit_binds_an_unbound_row(
    ) -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "goal-file-app");
        let goal = repo::create_goal(
            &pool,
            &pid,
            "Settle in a second",
            None,
            None,
            None,
            None,
            None,
        )?;
        let base = FileIdeaInput {
            project_id: pid.clone(),
            title: "Batch the settlement writes".into(),
            description: None,
            reasoning: None,
            category: Some("technical".into()),
            effort: Some(2),
            impact: Some(4),
            risk: Some(2),
            context_id: None,
            goal: None,
            force: None,
        };

        // Filed with no goal while the project has one open: filed, and told.
        let first = file_backlog_idea(&pool, &base)?;
        assert_eq!(first.idea.goal_id, None);
        let note = first.goal_note.clone().unwrap_or_default();
        assert!(note.contains("1 open goal"), "{note}");
        assert!(note.contains(&goal.id[..8]), "{note}");

        // A re-filing that names the goal binds the row it collided with.
        let second = file_backlog_idea(
            &pool,
            &FileIdeaInput {
                goal: Some(goal.id.clone()),
                ..base.clone()
            },
        )?;
        assert!(!second.created);
        assert_eq!(second.idea.id, first.idea.id);
        assert_eq!(second.idea.goal_id.as_deref(), Some(goal.id.as_str()));
        assert_eq!(second.goal_note, None);

        // A goal posted as `goal_id` (the column's own name) is read, not dropped.
        let parsed: FileIdeaInput = serde_json::from_str(&format!(
            r#"{{"project_id":"{pid}","title":"Other","goal_id":"{}"}}"#,
            goal.id
        ))
        .map_err(|e| AppError::Internal(e.to_string()))?;
        assert_eq!(parsed.goal.as_deref(), Some(goal.id.as_str()));
        Ok(())
    }

    #[test]
    fn a_goal_reference_naming_nothing_files_the_item_unbound_and_says_so() -> Result<(), AppError>
    {
        let pool = init_test_db()?;
        let pid = project(&pool, "goal-miss-app");
        let other = repo::create_goal(&pool, &pid, "First goal", None, None, None, None, None)?;
        let held = repo::create_goal(&pool, &pid, "Second goal", None, None, None, None, None)?;
        let base = FileIdeaInput {
            project_id: pid.clone(),
            title: "Index the ledger by account".into(),
            description: None,
            reasoning: None,
            category: None,
            effort: Some(1),
            impact: Some(3),
            risk: Some(2),
            context_id: None,
            goal: Some("no such goal".into()),
            force: None,
        };
        let filed = file_backlog_idea(&pool, &base)?;
        assert!(filed.created, "a bad goal reference never loses the filing");
        assert_eq!(filed.idea.goal_id, None);
        let note = filed.goal_note.unwrap_or_default();
        assert!(note.contains("names no single goal"), "{note}");

        // A row already serving a goal keeps it when a re-filing names another.
        repo::set_idea_goal(&pool, &filed.idea.id, Some(&held.id))?;
        let refiled = file_backlog_idea(
            &pool,
            &FileIdeaInput {
                goal: Some(other.id.clone()),
                ..base.clone()
            },
        )?;
        assert_eq!(refiled.idea.goal_id.as_deref(), Some(held.id.as_str()));
        assert!(refiled
            .goal_note
            .unwrap_or_default()
            .contains("the first binding stands"));
        Ok(())
    }

    #[test]
    fn the_bridge_door_refuses_a_first_filing_short_of_a_scale() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "rated-door-app");
        let unrated = FileIdeaInput {
            project_id: pid.clone(),
            title: "Split the settlement ledger writer".into(),
            description: None,
            reasoning: None,
            category: None,
            effort: None,
            impact: Some(4),
            risk: Some(2),
            context_id: None,
            goal: None,
            force: None,
        };
        match file_rated_backlog_idea(&pool, &unrated) {
            Err(AppError::Validation(m)) => {
                assert!(
                    m.contains("missing effort"),
                    "the refusal names the gap: {m}"
                )
            }
            other => panic!("expected a validation refusal, got {other:?}"),
        }
        assert!(
            repo::list_ideas(&pool, Some(&pid), None, None, None, None)?.is_empty(),
            "a refused filing writes nothing"
        );

        let out_of_range = file_rated_backlog_idea(
            &pool,
            &FileIdeaInput {
                effort: Some(7),
                ..unrated.clone()
            },
        );
        assert!(matches!(out_of_range, Err(AppError::Validation(_))));

        let rated = file_rated_backlog_idea(
            &pool,
            &FileIdeaInput {
                effort: Some(2),
                ..unrated.clone()
            },
        )?;
        assert!(rated.created);
        Ok(())
    }

    /// The rate-on-refile path stays open: a row seeded unrated (through the
    /// replay door, which keeps filing short filings) is rated by a bridge
    /// re-filing that still carries only some scales.
    #[test]
    fn the_bridge_door_lets_a_re_filing_rate_an_unrated_row() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "rated-refile-app");
        let unrated = FileIdeaInput {
            project_id: pid.clone(),
            title: "Index the ledger by account".into(),
            description: None,
            reasoning: None,
            category: None,
            effort: None,
            impact: None,
            risk: None,
            context_id: None,
            goal: None,
            force: None,
        };
        let seeded = file_backlog_idea(&pool, &unrated)?;
        assert!(seeded.created);
        let refiled = file_rated_backlog_idea(
            &pool,
            &FileIdeaInput {
                risk: Some(1),
                ..unrated.clone()
            },
        )?;
        assert_eq!(refiled.outcome, FILE_IDEA_RATED);
        assert_eq!(refiled.idea.risk, Some(1));
        Ok(())
    }

    fn accept_low_risk_rule(pool: &DbPool, pid: &str) {
        crate::db::repos::dev::triage_rules::create_triage_rule(
            pool,
            Some(pid),
            "accept risk below 3",
            r#"[{"field":"risk","op":"gte","value":1},{"field":"risk","op":"lt","value":3}]"#,
            "accept",
            Some(true),
        )
        .expect("rule");
    }

    fn rated_filing(pid: &str, title: &str, risk: Option<i32>) -> FileIdeaInput {
        FileIdeaInput {
            project_id: pid.to_string(),
            title: title.into(),
            description: None,
            reasoning: None,
            category: None,
            effort: risk.map(|_| 2),
            impact: risk.map(|_| 3),
            risk,
            context_id: None,
            goal: None,
            force: None,
        }
    }

    /// A risk-1 filing through the bridge is answered by the project's rule in
    /// the same call, as the protocol door already does: the row comes back
    /// `accepted`, not `pending` until some other door triages the project.
    #[test]
    fn a_rated_bridge_filing_runs_the_projects_triage_rule() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "triage-door-app");
        accept_low_risk_rule(&pool, &pid);

        let out = file_rated_backlog_idea(
            &pool,
            &rated_filing(&pid, "Cache the fx rate lookup", Some(1)),
        )?;
        assert!(out.created);
        assert_eq!(out.idea.status, "accepted", "the rule answered in the call");
        let triage = out.triage.expect("a rated filing runs the rules");
        assert_eq!((triage.accepted, triage.rejected), (1, 0));

        // A plain duplicate changed nothing the rules can see.
        let again = file_rated_backlog_idea(
            &pool,
            &rated_filing(&pid, "Cache the fx rate lookup", Some(1)),
        )?;
        assert_eq!(again.outcome, FILE_IDEA_DEDUPED);
        assert!(again.triage.is_none());
        Ok(())
    }

    /// A re-filing that rates an unrated row changes that row's fate, so it
    /// runs the rules too.
    #[test]
    fn rating_an_unrated_row_on_refile_runs_the_triage_rule() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "triage-refile-app");
        accept_low_risk_rule(&pool, &pid);

        let seeded = file_backlog_idea(&pool, &rated_filing(&pid, "Trim the audit log", None))?;
        assert!(seeded.created);
        assert!(
            seeded.triage.is_none(),
            "an unrated row gives the rules nothing"
        );
        assert_eq!(seeded.idea.status, "pending");

        let rated =
            file_rated_backlog_idea(&pool, &rated_filing(&pid, "Trim the audit log", Some(2)))?;
        assert_eq!(rated.outcome, FILE_IDEA_RATED);
        assert!(rated.triage.is_some());
        assert_eq!(rated.idea.status, "accepted");
        Ok(())
    }

    /// Two write-ups of one finding (the bank-edge pair of 2026-09-08) key
    /// differently, so the second is answered with the first rather than
    /// filed; `force` files a finding that only reads alike.
    #[test]
    fn a_paraphrased_filing_is_answered_with_the_item_already_filed() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "bank-edge");
        let first = file_rated_backlog_idea(
            &pool,
            &FileIdeaInput {
                description: Some(
                    "The bank-edge repository has no git remote configured, so a delivery run \
                     can never open a pull request and every delivery ends at a ready branch."
                        .into(),
                ),
                ..rated_filing(
                    &pid,
                    "bank-edge has no git remote, so every delivery ends branch-ready",
                    Some(5),
                )
            },
        )?;
        assert!(first.created);

        let paraphrase = FileIdeaInput {
            description: Some(
                "bank-edge has no git remote. The charter asks for a pull request on every \
                 delivery, but with no remote configured the run can never open one."
                    .into(),
            ),
            ..rated_filing(
                &pid,
                "bank-edge has no git remote, so the project's charter can never open a pull request",
                Some(5),
            )
        };
        let second = file_rated_backlog_idea(&pool, &paraphrase)?;
        assert!(!second.created);
        assert_eq!(second.outcome, FILE_IDEA_NEAR_DUPLICATE);
        assert_eq!(second.idea.id, first.idea.id);
        let note = second.duplicate_note.unwrap_or_default();
        assert!(note.contains("\"force\": true"), "{note}");
        assert_eq!(
            repo::list_ideas(&pool, Some(&pid), None, None, None, None)?.len(),
            1
        );

        let forced = file_rated_backlog_idea(
            &pool,
            &FileIdeaInput {
                force: Some(true),
                ..paraphrase
            },
        )?;
        assert!(
            forced.created,
            "force files a finding that only reads alike"
        );
        assert_eq!(forced.outcome, FILE_IDEA_CREATED);
        Ok(())
    }

    // ── Goals ─────────────────────────────────────────────────────────────

    #[test]
    fn a_worker_reads_the_goals_with_their_checklists_and_work() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "goals-read-app");
        let goal = repo::create_goal(
            &pool,
            &pid,
            "Settle in a second",
            None,
            None,
            None,
            None,
            None,
        )?;
        repo::create_goal_item(&pool, &goal.id, "measure p95")?;
        repo::create_task(
            &pool,
            Some(&pid),
            "t",
            None,
            None,
            Some(&goal.id),
            Some("queued"),
            None,
        )?;

        let goals = list_project_goals(&pool, &pid)?;
        assert_eq!(goals.len(), 1);
        assert_eq!(goals[0].goal.id, goal.id);
        assert_eq!(goals[0].items.len(), 1);
        assert_eq!((goals[0].tasks, goals[0].completed_tasks), (1, 0));
        assert!(matches!(
            list_project_goals(&pool, "no-such-project"),
            Err(AppError::NotFound(_))
        ));
        Ok(())
    }

    #[test]
    fn amending_a_goal_changes_it_in_place_but_never_closes_it() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "goals-amend-app");
        let goal = repo::create_goal(&pool, &pid, "Old wording", None, None, None, None, None)?;

        let amended = amend_project_goal(
            &pool,
            &goal.id,
            &AmendGoalInput {
                title: Some("New wording".into()),
                description: None,
                status: Some("in_progress".into()),
            },
        )?;
        assert_eq!(amended.id, goal.id, "amended in place, not re-created");
        assert_eq!(amended.title, "New wording");
        assert_eq!(amended.status, "in-progress", "the alias folds");

        for (status, why) in [
            ("done", "closing is the operator's"),
            ("shipped", "unknown"),
        ] {
            let out = amend_project_goal(
                &pool,
                &goal.id,
                &AmendGoalInput {
                    title: None,
                    description: None,
                    status: Some(status.into()),
                },
            );
            assert!(
                matches!(out, Err(AppError::Validation(_))),
                "{why}: {out:?}"
            );
        }
        let empty = amend_project_goal(
            &pool,
            &goal.id,
            &AmendGoalInput {
                title: Some("  ".into()),
                description: None,
                status: None,
            },
        );
        assert!(matches!(empty, Err(AppError::Validation(_))));
        Ok(())
    }

    #[test]
    fn ticking_a_checklist_item_moves_the_goal_but_a_gate_is_refused() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "goals-item-app");
        let goal = repo::create_goal(&pool, &pid, "Ship the ledger", None, None, None, None, None)?;
        let a = repo::create_goal_item(&pool, &goal.id, "write it")?;
        repo::create_goal_item(&pool, &goal.id, "test it")?;
        let gate = repo::set_goal_verification(&pool, &goal.id, "posts a transfer", None)?;

        let out = set_goal_item_done(&pool, &goal.id, &a.id, &GoalItemInput { done: true })?;
        assert!(out.item.done);
        assert_eq!(out.goal_progress, 33, "1 of 3 items");

        let refused = set_goal_item_done(&pool, &goal.id, &gate.id, &GoalItemInput { done: true });
        assert!(
            matches!(refused, Err(AppError::Validation(_))),
            "{refused:?}"
        );

        let other = repo::create_goal(&pool, &pid, "Other", None, None, None, None, None)?;
        let wrong_goal = set_goal_item_done(&pool, &other.id, &a.id, &GoalItemInput { done: true });
        assert!(matches!(wrong_goal, Err(AppError::NotFound(_))));
        Ok(())
    }

    #[test]
    fn attributing_an_idea_to_a_goal_carries_its_delivered_tasks() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "goals-attr-app");
        let goal = repo::create_goal(&pool, &pid, "Settle faster", None, None, None, None, None)?;
        repo::create_goal_item(&pool, &goal.id, "measure it")?;
        let idea = accepted_idea(&pool, &pid, "Batch the settlement writes");
        record_idea_outcome(
            &pool,
            &idea.id,
            &IdeaOutcomeInput {
                outcome: "delivered".into(),
                note: None,
                branch: None,
                commit: None,
                pr_url: None,
            },
        )?;

        let out = attribute_idea_to_goal(
            &pool,
            &idea.id,
            &IdeaGoalInput {
                goal: goal.id[..8].to_string(),
            },
        )?;
        assert_eq!(out.goal_id, goal.id);
        assert_eq!(out.idea.goal_id.as_deref(), Some(goal.id.as_str()));
        assert_eq!(
            out.tasks_linked, 1,
            "the delivered task now serves the goal"
        );
        assert!(out.goal_progress.is_some());
        let task = repo::latest_task_for_idea(&pool, &idea.id)?.expect("task");
        assert_eq!(task.goal_id.as_deref(), Some(goal.id.as_str()));

        // Naming it again is idempotent; naming another goal is refused.
        let again = attribute_idea_to_goal(
            &pool,
            &idea.id,
            &IdeaGoalInput {
                goal: goal.id.clone(),
            },
        )?;
        assert_eq!(again.tasks_linked, 0);
        let other = repo::create_goal(&pool, &pid, "Other goal", None, None, None, None, None)?;
        let moved = attribute_idea_to_goal(
            &pool,
            &idea.id,
            &IdeaGoalInput {
                goal: other.id.clone(),
            },
        );
        assert!(matches!(moved, Err(AppError::Validation(_))), "{moved:?}");
        let unknown = attribute_idea_to_goal(
            &pool,
            &idea.id,
            &IdeaGoalInput {
                goal: "no such goal".into(),
            },
        );
        assert!(matches!(unknown, Err(AppError::Validation(_))));
        Ok(())
    }

    /// A delivered idea whose task serves a goal moves that goal: the outcome
    /// door recomputes progress, so the percentage stops reading 0 while the
    /// work that serves it lands.
    #[test]
    fn a_delivered_outcome_moves_the_goal_its_task_serves() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "goal-progress-app");
        let goal = repo::create_goal(&pool, &pid, "Settle faster", None, None, None, None, None)?;
        repo::create_goal_item(&pool, &goal.id, "measure p95")?;
        let idea = accepted_idea(&pool, &pid, "Batch the settlement writes");
        repo::set_idea_goal(&pool, &idea.id, Some(&goal.id))?;

        let out = record_idea_outcome(
            &pool,
            &idea.id,
            &IdeaOutcomeInput {
                outcome: "delivered".into(),
                note: None,
                branch: None,
                commit: None,
                pr_url: None,
            },
        )?;
        assert_eq!(out.task.goal_id.as_deref(), Some(goal.id.as_str()));
        let moved = repo::get_goal_by_id(&pool, &goal.id)?;
        assert_eq!(moved.progress, 50, "0/1 checklist + 1/1 linked tasks");
        assert_eq!(repo::normalize_goal_status(&moved.status), "in-progress");
        Ok(())
    }

    #[test]
    fn filing_against_an_unknown_project_is_refused() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let err = file_backlog_idea(
            &pool,
            &FileIdeaInput {
                project_id: "no-such-project".into(),
                title: "Anything".into(),
                description: None,
                reasoning: None,
                category: None,
                effort: None,
                impact: None,
                risk: None,
                context_id: None,
                goal: None,
                force: None,
            },
        )
        .expect_err("an unknown project cannot receive a backlog item");
        assert!(matches!(
            err,
            AppError::NotFound(_) | AppError::Validation(_)
        ));
        Ok(())
    }

    // ── KPIs ──────────────────────────────────────────────────────────────

    #[test]
    fn a_kpi_can_be_declared_and_then_measured() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "kpi-app");

        let kpi = create_project_kpi(
            &pool,
            &CreateKpiInput {
                project_id: pid.clone(),
                name: "Rust clippy findings".into(),
                description: Some("workspace, -D warnings".into()),
                category: Some("quality".into()),
                measure_kind: Some("codebase".into()),
                measure_config: Some(r#"{"cmd":"cargo clippy"}"#.into()),
                unit: Some("findings".into()),
                direction: Some("down".into()),
                baseline_value: Some(217.0),
                target_value: Some(0.0),
                target_date: None,
                cadence: Some("weekly".into()),
                status: None,
                rationale: None,
                context_group_id: None,
                context_id: None,
            },
        )?;
        assert_eq!(kpi.status, "proposed", "a worker proposes by default");
        assert_eq!(kpi.created_by, "scan");
        assert_eq!(kpi.direction, "down");

        let m = record_kpi_reading(
            &pool,
            &kpi.id,
            &MeasureKpiInput {
                value: 5.0,
                source: None,
                env: None,
                evidence: Some("cargo clippy → 5".into()),
                note: None,
            },
        )?;
        assert_eq!(m.value, 5.0);
        assert_eq!(m.source, "scan");
        assert_eq!(m.env, "production");
        // A production reading rolls the current value forward.
        assert_eq!(repo::get_kpi(&pool, &kpi.id)?.current_value, Some(5.0));

        // A non-production reading goes through the simulation door instead,
        // and must NOT move the current value.
        let sim = record_kpi_reading(
            &pool,
            &kpi.id,
            &MeasureKpiInput {
                value: 99.0,
                source: None,
                env: Some("local".into()),
                evidence: None,
                note: None,
            },
        )?;
        assert_eq!(sim.source, "simulation");
        assert_eq!(sim.env, "local");
        assert_eq!(repo::get_kpi(&pool, &kpi.id)?.current_value, Some(5.0));
        Ok(())
    }

    #[test]
    fn a_kpi_token_outside_the_schema_vocabulary_is_refused() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let pid = project(&pool, "kpi-refuse-app");
        let base = CreateKpiInput {
            project_id: pid,
            name: "Something".into(),
            description: None,
            category: Some("velocity".into()), // not in the CHECK
            measure_kind: None,
            measure_config: None,
            unit: None,
            direction: None,
            baseline_value: None,
            target_value: None,
            target_date: None,
            cadence: None,
            status: None,
            rationale: None,
            context_group_id: None,
            context_id: None,
        };
        let err = create_project_kpi(&pool, &base).expect_err("`velocity` is not a KPI category");
        match err {
            AppError::Validation(m) => {
                assert!(m.contains("technical"), "the refusal names the set: {m}")
            }
            other => panic!("expected a validation refusal, got {other:?}"),
        }
        Ok(())
    }

    #[test]
    fn measuring_an_unknown_kpi_is_a_not_found() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let err = record_kpi_reading(
            &pool,
            "no-such-kpi",
            &MeasureKpiInput {
                value: 1.0,
                source: None,
                env: None,
                evidence: None,
                note: None,
            },
        )
        .expect_err("an unknown KPI cannot be measured");
        assert!(matches!(err, AppError::NotFound(_)));
        Ok(())
    }
}
