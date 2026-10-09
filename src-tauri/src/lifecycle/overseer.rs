//! The Overseer owns a project's "All steps green" goal.
//!
//! The Overseer has no runtime of its own here. It becomes the OWNER of a
//! `dev_goals` row and of backlog items, and the existing idea pipeline does
//! the work (a mandate project's App Master dispatches accepted items through
//! its charter; without one they wait in the accepted queue).
//!
//! - **Watch** (the Lifecycle star) is a per-project setting,
//!   [`LIFECYCLE_OVERSEER_WATCH_PREFIX`]. A watched project is auto-measured
//!   once per new base tip by `engine::subscription::LifecycleWatchSubscription`
//!   while the Overseer is switched on. It never touches `personas.starred`.
//! - **Send** ([`send`]) opens (or reuses) the open goal titled [`GOAL_TITLE`]
//!   and files one item per measurable step that is not green (`red`,
//!   `amber`, `unmeasured`, `stale`) through the backlog's one door, then
//!   accepts it through the triage verdict door. `instructed` and `green`
//!   steps get nothing. Send also sets watch. It is [`decide`] then
//!   `apply`; [`preview`] is [`decide`] alone, so the dry run the UI shows
//!   and what send then does cannot disagree.
//! - **Close by observation only** ([`after_measure`]): after a Measure whose
//!   base tip IS the current base tip, an open item whose step is now `green`
//!   is marked delivered with `verify_state = cleared` and the measure as its
//!   evidence; the goal closes when every measurable step is green. Nothing a
//!   builder or an agent claims closes anything.

use std::collections::HashMap;
use std::path::Path;

use chrono::{DateTime, Utc};

use crate::commands::infrastructure::dev_tools::{apply_idea_verdict_by, IdeaVerdict};
use crate::db::models::{
    BacklogSource, DevGoal, DevIdea, DevProject, IdeaDraft, IdeaPlan, IdeaStatus,
    LifecycleGoalItem, LifecycleGoalView, LifecycleHealth, LifecycleMetric, LifecycleMetricKey,
    LifecycleSendPreview, LifecycleSendPreviewStep, LifecycleSendResult, LifecycleStepHealthView,
    LifecycleWatchedPipeline, LifecycleWatchedStep, PlanStep,
};
use crate::db::repos::core::settings as settings_repo;
use crate::db::repos::dev::goals as goal_repo;
use crate::db::repos::dev::ideas as idea_repo;
use crate::db::repos::dev::lifecycle_runs::{latest_measure, MeasureSummary};
use crate::db::repos::dev::projects as project_repo;
use crate::db::settings_keys::LIFECYCLE_OVERSEER_WATCH_PREFIX;
use crate::db::DbPool;
use crate::error::AppError;

use super::health::fmt_ms;

/// The goal the Overseer owns per project. An open goal with this exact title
/// is reused; a closed one is never reopened (the next send opens a new one).
pub const GOAL_TITLE: &str = "All steps green";
/// Who decided, in the decision memory the accept writes.
pub const ACTOR: &str = "Overseer";
/// The auto-measure never runs a project twice within this many minutes.
pub const AUTO_MEASURE_SPACING_MINUTES: i64 = 30;
/// `dev_ideas.scan_type` of an Overseer item.
const SCAN_TYPE: &str = "lifecycle_step";
/// `dev_goal_signals.signal_type` the auto-close writes.
const SIGNAL_TYPE: &str = "lifecycle_measure";

// ---------------------------------------------------------------------------
// Watch
// ---------------------------------------------------------------------------

fn watch_key(project_id: &str) -> String {
    format!("{LIFECYCLE_OVERSEER_WATCH_PREFIX}{project_id}")
}

/// Is the project starred for the Overseer? A failed read is "not watched".
pub fn is_watched(pool: &DbPool, project_id: &str) -> bool {
    settings_repo::get_bool(pool, &watch_key(project_id), false)
}

/// Star or unstar a project. Unwatching deletes the row. Returns the new state.
pub fn set_watch(pool: &DbPool, project_id: &str, watched: bool) -> Result<bool, AppError> {
    project_repo::get_project_by_id(pool, project_id)?;
    let key = watch_key(project_id);
    if watched {
        settings_repo::set(pool, &key, "true")?;
    } else {
        settings_repo::delete(pool, &key)?;
    }
    Ok(watched)
}

/// Every watched project id, in key order.
pub fn watched_project_ids(pool: &DbPool) -> Result<Vec<String>, AppError> {
    Ok(
        settings_repo::get_by_prefix(pool, LIFECYCLE_OVERSEER_WATCH_PREFIX)?
            .into_iter()
            .filter(|(_, v)| v.trim().eq_ignore_ascii_case("true"))
            .filter_map(|(k, _)| {
                k.strip_prefix(LIFECYCLE_OVERSEER_WATCH_PREFIX)
                    .map(str::to_string)
            })
            .collect(),
    )
}

// ---------------------------------------------------------------------------
// Goal and items
// ---------------------------------------------------------------------------

/// The step ids a send files items for: measurable and not green.
fn needs_item(health: LifecycleHealth) -> bool {
    matches!(
        health,
        LifecycleHealth::Red
            | LifecycleHealth::Amber
            | LifecycleHealth::Unmeasured
            | LifecycleHealth::Stale
    )
}

fn health_word(health: LifecycleHealth) -> &'static str {
    match health {
        LifecycleHealth::Green => "green",
        LifecycleHealth::Amber => "amber",
        LifecycleHealth::Red => "red",
        LifecycleHealth::Unmeasured => "unmeasured",
        LifecycleHealth::Instructed => "instructed",
        LifecycleHealth::Stale => "stale",
    }
}

fn is_overseer_goal(g: &DevGoal) -> bool {
    g.title == GOAL_TITLE
}

/// The project's open "All steps green" goal, if any.
pub fn open_goal(pool: &DbPool, project_id: &str) -> Result<Option<DevGoal>, AppError> {
    Ok(goal_repo::list_goals_by_project(pool, project_id, None)?
        .into_iter()
        .filter(|g| is_overseer_goal(g) && goal_repo::goal_status_is_ongoing(&g.status))
        .max_by(|a, b| a.created_at.cmp(&b.created_at)))
}

/// The open goal, else the newest closed one; `None` when none was ever sent.
fn latest_goal(pool: &DbPool, project_id: &str) -> Result<Option<DevGoal>, AppError> {
    let goals: Vec<DevGoal> = goal_repo::list_goals_by_project(pool, project_id, None)?
        .into_iter()
        .filter(is_overseer_goal)
        .collect();
    let open = goals
        .iter()
        .filter(|g| goal_repo::goal_status_is_ongoing(&g.status))
        .max_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(open
        .or_else(|| goals.iter().max_by(|a, b| a.created_at.cmp(&b.created_at)))
        .cloned())
}

fn dedup_key(goal_id: &str, step_id: &str) -> String {
    format!("lifecycle:goal:{goal_id}:step:{step_id}")
}

/// The step an Overseer item under `goal_id` is about, read from its key.
fn step_of<'a>(goal_id: &str, idea: &'a DevIdea) -> Option<&'a str> {
    idea.dedup_key
        .as_deref()?
        .strip_prefix(&format!("lifecycle:goal:{goal_id}:step:"))
}

fn is_open(idea: &DevIdea) -> bool {
    matches!(
        IdeaStatus::from_token(&idea.status),
        Some(IdeaStatus::Pending | IdeaStatus::Accepted)
    )
}

/// The Overseer's open items under a goal, with the step each is about.
fn open_items<'a>(goal_id: &str, ideas: &'a [DevIdea]) -> Vec<(&'a DevIdea, &'a str)> {
    ideas
        .iter()
        .filter(|i| i.origin.as_deref() == Some(BacklogSource::Lifecycle.as_str()) && is_open(i))
        .filter_map(|i| step_of(goal_id, i).map(|s| (i, s)))
        .collect()
}

/// Every Overseer item under the goal as the goal view lists it: open first,
/// then newest filed first. Pure.
fn goal_items(goal_id: &str, ideas: &[DevIdea]) -> Vec<LifecycleGoalItem> {
    let mut items: Vec<(bool, LifecycleGoalItem)> = ideas
        .iter()
        .filter(|i| i.origin.as_deref() == Some(BacklogSource::Lifecycle.as_str()))
        .filter_map(|i| {
            let step_id = step_of(goal_id, i)?.to_string();
            let updated_at = (!i.updated_at.is_empty() && i.updated_at != i.created_at)
                .then(|| i.updated_at.clone());
            Some((
                is_open(i),
                LifecycleGoalItem {
                    id: i.id.clone(),
                    step_id,
                    title: i.title.clone(),
                    status: i.status.clone(),
                    verify_state: i.verify_state.clone(),
                    created_at: i.created_at.clone(),
                    updated_at,
                },
            ))
        })
        .collect();
    items.sort_by(|(a_open, a), (b_open, b)| {
        b_open
            .cmp(a_open)
            .then_with(|| b.created_at.cmp(&a.created_at))
            .then_with(|| b.id.cmp(&a.id))
    });
    items.into_iter().map(|(_, item)| item).collect()
}

/// Counts over the measured health. Pure.
fn counts(health: &[LifecycleStepHealthView]) -> (u32, u32, u32) {
    let mut measurable = 0;
    let mut green = 0;
    let mut instructed = 0;
    for h in health {
        match h.health {
            LifecycleHealth::Instructed => instructed += 1,
            LifecycleHealth::Green => {
                measurable += 1;
                green += 1;
            }
            _ => measurable += 1,
        }
    }
    (measurable, green, instructed)
}

/// The goal's view for a snapshot; `None` when no goal was ever sent.
pub fn goal_view(
    pool: &DbPool,
    project_id: &str,
    health: &[LifecycleStepHealthView],
) -> Result<Option<LifecycleGoalView>, AppError> {
    let Some(goal) = latest_goal(pool, project_id)? else {
        return Ok(None);
    };
    let ideas = idea_repo::list_ideas_by_goal(pool, &goal.id)?;
    let (measurable_total, measurable_green, instructed) = counts(health);
    Ok(Some(LifecycleGoalView {
        open_items: open_items(&goal.id, &ideas).len() as u32,
        items: goal_items(&goal.id, &ideas),
        goal_id: goal.id,
        measurable_total,
        measurable_green,
        instructed,
    }))
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

fn metric_word(key: LifecycleMetricKey) -> &'static str {
    match key {
        LifecycleMetricKey::MedianMs => "median time",
        LifecycleMetricKey::PassRate => "pass rate",
        LifecycleMetricKey::CoveragePct => "coverage",
        LifecycleMetricKey::DocsCleanPct => "docs clean",
        LifecycleMetricKey::DoneRate => "done rate",
    }
}

fn metric_line(m: &LifecycleMetric) -> String {
    let value = match (m.key, m.value) {
        (_, None) => "no sample".to_string(),
        (LifecycleMetricKey::MedianMs, Some(v)) => fmt_ms(v.max(0.0) as u64),
        (_, Some(v)) => format!("{}%", v.round() as i64),
    };
    format!("{} {value} (n={})", metric_word(m.key), m.samples)
}

/// What was measured, in one paragraph: verdict, reason, metrics with their
/// sample counts, and where.
fn measured(h: &LifecycleStepHealthView) -> String {
    let verdict = match (h.health, h.stale_of) {
        (LifecycleHealth::Stale, Some(was)) => format!("stale (was {})", health_word(was)),
        (v, _) => health_word(v).to_string(),
    };
    let mut out = format!("Measured verdict: {verdict}.");
    if let Some(reason) = &h.reason {
        out.push_str(&format!(" Reason: {reason}."));
    }
    if !h.metrics.is_empty() {
        let lines: Vec<String> = h.metrics.iter().map(metric_line).collect();
        out.push_str(&format!(" Metrics: {}.", lines.join("; ")));
    }
    if let (Some(at), Some(sha)) = (&h.measured_at, &h.head_sha) {
        out.push_str(&format!(
            " Last measured {at} on base tip {}.",
            sha.get(..10).unwrap_or(sha)
        ));
    }
    out
}

/// The repo path an item's plan points at, repo-relative.
fn step_files(root: &Path, step_id: &str, health: LifecycleHealth) -> Vec<String> {
    let first = |candidates: &[&str]| -> String {
        candidates
            .iter()
            .find(|c| root.join(c.trim_end_matches('/')).exists())
            .map(|c| (*c).to_string())
            .unwrap_or_else(|| ".".to_string())
    };
    let path = match step_id {
        "tests" if health == LifecycleHealth::Unmeasured => {
            first(&["package.json", "Cargo.toml", "pyproject.toml"])
        }
        "gate" | "tests" => first(&["src/", "lib/"]),
        "docs" => first(&["docs/", "README.md"]),
        _ => first(&["CLAUDE.md", "AGENTS.md", ".claude/CLAUDE.md"]),
    };
    vec![path]
}

/// How to make a step measurable, when it is not.
fn make_measurable(step_id: &str) -> &'static str {
    match step_id {
        "gate" => {
            "Configure the gate step's commands (typecheck, lint, check) or add the scripts \
             Measure detects, so a Lifecycle Measure can run them on the base tip"
        }
        "tests" => {
            "Add a test command and a coverage command whose output prints a coverage \
             percentage, so a Lifecycle Measure records a coverage figure"
        }
        "docs" => {
            "Couple the docs to the sources they describe so the docs rot scan can verify \
             them (an unverifiable doc is never clean)"
        }
        _ => {
            "Record this step's outcome on every task and commit (at least 5 samples) so its \
             done rate can be measured"
        }
    }
}

/// The ways a step must never be made green. Named in every plan.
const FORBIDDEN: &str = "Do not make it green by deleting or skipping tests, adding \
                         suppression directives (lint disables, allow attributes, ts-ignore, \
                         skip markers), editing gate configuration or budgets, or bumping \
                         dependencies to satisfy a check";

/// The backlog item for one not-green step. Pure.
fn draft(
    project_id: &str,
    goal_id: &str,
    root: &Path,
    rule: Option<&str>,
    h: &LifecycleStepHealthView,
) -> IdeaDraft {
    let step = h.step_id.as_str();
    let target = format!("A Lifecycle Measure on the base tip reports `{step}` green");
    let files = step_files(root, step, h.health);
    let (title, first, effort, impact, risk) = match h.health {
        LifecycleHealth::Unmeasured => (
            format!("Make lifecycle step `{step}` measurable"),
            PlanStep {
                n: 1,
                action: make_measurable(step).to_string(),
                files: files.clone(),
                done_when: format!(
                    "A Lifecycle Measure on the base tip gives `{step}` a verdict other \
                     than unmeasured"
                ),
            },
            2,
            3,
            1,
        ),
        LifecycleHealth::Stale => (
            format!("Re-measure lifecycle step `{step}` green on the base tip"),
            PlanStep {
                n: 1,
                action: format!(
                    "Run a Lifecycle Measure on the current base tip and read `{step}`'s \
                     verdict; if it is not green, find the cause in the code"
                ),
                files: files.clone(),
                done_when: format!("`{step}` has a verdict measured on the current base tip"),
            },
            1,
            2,
            1,
        ),
        other => (
            format!(
                "Turn lifecycle step `{step}` green (measured {})",
                health_word(other)
            ),
            PlanStep {
                n: 1,
                action: format!(
                    "Reproduce what the measure saw ({}) and name the cause in the code",
                    h.reason.as_deref().unwrap_or("see the evidence")
                ),
                files: files.clone(),
                done_when: "The cause is named with the file and the measured symptom".into(),
            },
            3,
            if other == LifecycleHealth::Red { 4 } else { 3 },
            2,
        ),
    };
    let evidence = measured(h);
    let mut d = IdeaDraft::new(project_id, BacklogSource::Lifecycle, title);
    d.category = Some("technical".into());
    d.scan_type = Some(SCAN_TYPE.into());
    d.goal_id = Some(goal_id.to_string());
    d.description = Some(format!(
        "The Overseer's goal \"{GOAL_TITLE}\" needs lifecycle step `{step}` measured green on \
         the base tip. {evidence}{} Target: measured green on the base tip. The item closes \
         only when a Lifecycle Measure observes it green; a claim of done does not close it.",
        rule.map(|r| format!(" The step's rule: {r}"))
            .unwrap_or_default()
    ));
    d.evidence = Some(evidence);
    d.effort = Some(effort);
    d.impact = Some(impact);
    d.risk = Some(risk);
    d.dedup_key = Some(dedup_key(goal_id, step));
    d.plan = Some(IdeaPlan {
        steps: vec![
            first,
            PlanStep {
                n: 2,
                action: format!("Fix the cause in the code. {FORBIDDEN}."),
                files,
                done_when: target,
            },
        ],
    });
    d
}

/// Accept a freshly filed item through the triage verdict door.
fn accept(pool: &DbPool, idea: &DevIdea) -> Result<(), AppError> {
    apply_idea_verdict_by(pool, &idea.id, IdeaVerdict::Accept, ACTOR).map(|_| ())
}

/// What send does with one step, decided before anything is written.
#[derive(Debug, Clone)]
pub enum SendAction {
    /// Green or instructed: nothing to do.
    Skip,
    /// File a new item and accept it.
    File,
    /// The step's item under the open goal is still open: count it.
    AlreadyOpen(DevIdea),
    /// The item was closed green and the step regressed: reopen it.
    Reopen(DevIdea),
    /// Someone rejected, archived or let the item expire: that stands.
    Decided(DevIdea),
}

/// One step's decision, in step order.
#[derive(Debug, Clone)]
pub struct SendDecision {
    pub health: LifecycleStepHealthView,
    pub action: SendAction,
}

/// The action for one step, given the goal send would file under (`None`
/// when send would open a new goal, which has no items yet). Reads only.
fn decide_step(
    pool: &DbPool,
    project_id: &str,
    goal_id: Option<&str>,
    h: &LifecycleStepHealthView,
) -> Result<SendAction, AppError> {
    if !needs_item(h.health) {
        return Ok(SendAction::Skip);
    }
    let Some(goal_id) = goal_id else {
        return Ok(SendAction::File);
    };
    // The backlog's door dedups on the key in ANY status, so the existing row
    // decides: none files, open counts, delivered reopens, decided stands.
    let key = dedup_key(goal_id, &h.step_id);
    Ok(
        match idea_repo::find_idea_by_dedup_key(pool, project_id, &key)? {
            None => SendAction::File,
            Some(idea) if is_open(&idea) => SendAction::AlreadyOpen(idea),
            Some(idea) if idea.status == IdeaStatus::Delivered.as_str() => SendAction::Reopen(idea),
            Some(idea) => SendAction::Decided(idea),
        },
    )
}

/// What send would do for every step of `health` under `goal_id`. Reads
/// only; [`preview`] and [`send`] both start here.
pub fn decide(
    pool: &DbPool,
    project_id: &str,
    goal_id: Option<&str>,
    health: &[LifecycleStepHealthView],
) -> Result<Vec<SendDecision>, AppError> {
    health
        .iter()
        .map(|h| {
            Ok(SendDecision {
                action: decide_step(pool, project_id, goal_id, h)?,
                health: h.clone(),
            })
        })
        .collect()
}

/// What `apply` did with one step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Applied {
    Skipped,
    Filed,
    AlreadyOpen,
    Reopened,
}

/// Carry out `decisions` under `goal`. A `File` that loses the dedup race to
/// another filer is decided again from the row that won.
fn apply(
    pool: &DbPool,
    project_id: &str,
    goal: &DevGoal,
    root: &Path,
    rules: &HashMap<&str, &str>,
    decisions: Vec<SendDecision>,
) -> Result<Vec<(String, Applied)>, AppError> {
    let mut out = Vec::with_capacity(decisions.len());
    for SendDecision { health: h, action } in decisions {
        let action = match action {
            SendAction::File => {
                let rule = rules.get(h.step_id.as_str()).copied();
                if let Some(idea) =
                    idea_repo::file_idea(pool, draft(project_id, &goal.id, root, rule, &h))?
                {
                    accept(pool, &idea)?;
                    out.push((h.step_id, Applied::Filed));
                    continue;
                }
                match decide_step(pool, project_id, Some(&goal.id), &h)? {
                    // The door said "spent" yet no row reads back: count nothing.
                    SendAction::File => SendAction::Skip,
                    other => other,
                }
            }
            other => other,
        };
        let applied = match action {
            SendAction::Skip | SendAction::File => Applied::Skipped,
            SendAction::AlreadyOpen(_) => Applied::AlreadyOpen,
            SendAction::Reopen(existing) => {
                reopen(pool, &existing, &h)?;
                Applied::Reopened
            }
            SendAction::Decided(existing) => {
                tracing::debug!(
                    idea_id = %existing.id, status = %existing.status,
                    "lifecycle overseer: a decided item is not refiled"
                );
                Applied::Skipped
            }
        };
        out.push((h.step_id, applied));
    }
    Ok(out)
}

/// Closed by an observation that no longer holds: the step regressed under
/// the same goal. Reopen it rather than file a twin.
fn reopen(pool: &DbPool, existing: &DevIdea, h: &LifecycleStepHealthView) -> Result<(), AppError> {
    idea_repo::decide_idea_cas(
        pool,
        &existing.id,
        &existing.status,
        IdeaStatus::Accepted.as_str(),
        None,
    )?;
    let evidence = serde_json::json!({
        "observed_by": SIGNAL_TYPE,
        "step_id": h.step_id,
        "health": health_word(h.health),
        "summary": measured(h),
    })
    .to_string();
    idea_repo::set_finding_verify_state(pool, &existing.id, "regressed", Some(&evidence))
}

/// A dry run of [`send`]: the same snapshot and the same [`decide`], nothing
/// written. Reads the snapshot (files and git): call it off the IPC thread.
pub fn preview(pool: &DbPool, project_id: &str) -> Result<LifecycleSendPreview, AppError> {
    let snap = super::snapshot(pool, project_id)?;
    let goal_id = open_goal(pool, project_id)?.map(|g| g.id);
    let decisions = decide(pool, project_id, goal_id.as_deref(), &snap.health)?;
    let mut out = LifecycleSendPreview {
        goal_id,
        will_file: Vec::new(),
        already_open: Vec::new(),
        will_reopen: Vec::new(),
        skipped: Vec::new(),
    };
    for SendDecision { health: h, action } in decisions {
        let step = |reason: Option<String>, item_id: Option<String>| LifecycleSendPreviewStep {
            step_id: h.step_id.clone(),
            health: h.health,
            reason,
            item_id,
        };
        match action {
            SendAction::Skip => out.skipped.push(step(h.reason.clone(), None)),
            SendAction::File => out.will_file.push(step(h.reason.clone(), None)),
            SendAction::AlreadyOpen(i) => out.already_open.push(step(h.reason.clone(), Some(i.id))),
            SendAction::Reopen(i) => out.will_reopen.push(step(h.reason.clone(), Some(i.id))),
            SendAction::Decided(i) => out.skipped.push(step(
                Some(format!("its item was {}; that decision stands", i.status)),
                Some(i.id),
            )),
        }
    }
    Ok(out)
}

/// Hand the pipeline to the Overseer (see the module docs). Reads the
/// snapshot (files and git): call it off the IPC thread.
pub fn send(pool: &DbPool, project_id: &str) -> Result<LifecycleSendResult, AppError> {
    send_applied(pool, project_id).map(|(result, _)| result)
}

/// [`send`], also returning what `apply` did per step (step order).
pub(crate) fn send_applied(
    pool: &DbPool,
    project_id: &str,
) -> Result<(LifecycleSendResult, Vec<(String, Applied)>), AppError> {
    let project = project_repo::get_project_by_id(pool, project_id)?;
    let snap = super::snapshot(pool, project_id)?;
    let goal = match open_goal(pool, project_id)? {
        Some(g) => g,
        None => goal_repo::create_goal(
            pool,
            project_id,
            GOAL_TITLE,
            Some(
                "Every measurable lifecycle step measured green on the base tip. Owned by the \
                 Overseer; closed by observation when a Lifecycle Measure sees it.",
            ),
            None,
            Some("open"),
            None,
            None,
        )?,
    };
    let rules: HashMap<&str, &str> = snap
        .steps
        .iter()
        .map(|v| (v.step.id.as_str(), v.step.rule.as_str()))
        .collect();
    let decisions = decide(pool, project_id, Some(&goal.id), &snap.health)?;
    let root = Path::new(&project.root_path);
    let applied = apply(pool, project_id, &goal, root, &rules, decisions)?;
    let count = |want: &[Applied]| applied.iter().filter(|(_, a)| want.contains(a)).count() as u32;
    let result = LifecycleSendResult {
        goal_id: goal.id.clone(),
        filed: count(&[Applied::Filed, Applied::Reopened]),
        already_open: count(&[Applied::AlreadyOpen]),
    };
    set_watch(pool, project_id, true)?;
    // The same observation rule as after a measure: a send whose steps the
    // newest measure (on the current tip) already sees green closes at once.
    after_measure(pool, project_id)?;
    Ok((result, applied))
}

// ---------------------------------------------------------------------------
// Close by observation
// ---------------------------------------------------------------------------

/// What one [`after_measure`] did.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CloseOutcome {
    pub closed_items: u32,
    pub goal_closed: bool,
}

/// After a Measure: close what it OBSERVED green. A cheap no-op when the
/// project has no open goal; nothing closes unless the newest measure ran on
/// the current base tip. Reads the snapshot (files and git): call it off the
/// IPC thread.
pub fn after_measure(pool: &DbPool, project_id: &str) -> Result<CloseOutcome, AppError> {
    let mut out = CloseOutcome::default();
    let Some(goal) = open_goal(pool, project_id)? else {
        return Ok(out);
    };
    let Some(measure) = latest_measure(pool, project_id)? else {
        return Ok(out);
    };
    let project = project_repo::get_project_by_id(pool, project_id)?;
    let tip = super::measure::base_tip(
        Path::new(&project.root_path),
        project.main_branch.as_deref(),
    )
    .ok();
    if measure.head_sha.is_empty() || tip.as_deref() != Some(measure.head_sha.as_str()) {
        tracing::debug!(project_id, measure_id = %measure.measure_id,
            "lifecycle overseer: the newest measure is not on the current base tip; nothing closes");
        return Ok(out);
    }
    let snap = super::snapshot(pool, project_id)?;
    let green: Vec<&str> = snap
        .health
        .iter()
        .filter(|h| h.health == LifecycleHealth::Green)
        .map(|h| h.step_id.as_str())
        .collect();
    let ideas = idea_repo::list_ideas_by_goal(pool, &goal.id)?;
    for (idea, step) in open_items(&goal.id, &ideas) {
        if !green.contains(&step) {
            continue;
        }
        close_item(pool, idea, step, &measure)?;
        out.closed_items += 1;
    }
    let (total, green_count, _) = counts(&snap.health);
    if total > 0 && green_count == total {
        let now = Utc::now().to_rfc3339();
        goal_repo::update_goal(
            pool,
            &goal.id,
            None,
            None,
            Some("done"),
            Some(100),
            None,
            None,
            None,
            Some(Some(now.as_str())),
            None,
        )?;
        goal_repo::create_goal_signal(
            pool,
            &goal.id,
            SIGNAL_TYPE,
            Some(&measure.measure_id),
            None,
            Some(&format!(
                "Lifecycle measure {} on {}: all {total} measurable steps green",
                measure.measure_id, measure.head_sha
            )),
        )?;
        out.goal_closed = true;
    }
    Ok(out)
}

fn close_item(
    pool: &DbPool,
    idea: &DevIdea,
    step: &str,
    measure: &MeasureSummary,
) -> Result<(), AppError> {
    idea_repo::decide_idea_cas(
        pool,
        &idea.id,
        &idea.status,
        IdeaStatus::Delivered.as_str(),
        None,
    )?;
    let evidence = serde_json::json!({
        "observed_by": SIGNAL_TYPE,
        "measure_id": measure.measure_id,
        "head_sha": measure.head_sha,
        "step_id": step,
        "health": "green",
        "previous_status": idea.status,
        "summary": format!(
            "Lifecycle measure {} on {}: {step} green",
            measure.measure_id, measure.head_sha
        ),
    })
    .to_string();
    idea_repo::set_finding_verify_state(pool, &idea.id, "cleared", Some(&evidence))
}

// ---------------------------------------------------------------------------
// The watched list and the auto-measure pick
// ---------------------------------------------------------------------------

/// Every watched project with its goal progress, last measure and every
/// step's health (its mini rail), by name. A project deleted since it was
/// starred is left out. Costs ONE snapshot per watched project (manifests,
/// git and one health computation each), the same read the project's own
/// page makes; the list is short by nature. Call it off the IPC thread.
pub fn watched_pipelines(pool: &DbPool) -> Result<Vec<LifecycleWatchedPipeline>, AppError> {
    let mut out = Vec::new();
    for project_id in watched_project_ids(pool)? {
        let project = match project_repo::get_project_by_id(pool, &project_id) {
            Ok(p) => p,
            Err(AppError::NotFound(_)) => continue,
            Err(e) => return Err(e),
        };
        let snap = super::snapshot(pool, &project_id)?;
        out.push(LifecycleWatchedPipeline {
            last_measured_at: latest_measure(pool, &project_id)?.map(|m| m.finished_at),
            project_name: project.name,
            project_id,
            goal: snap.goal,
            steps: snap
                .health
                .into_iter()
                .map(|h| LifecycleWatchedStep {
                    step_id: h.step_id,
                    health: h.health,
                })
                .collect(),
        });
    }
    out.sort_by(|a, b| a.project_name.cmp(&b.project_name));
    Ok(out)
}

fn finished_at(m: &MeasureSummary) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(&m.finished_at)
        .ok()
        .map(|t| t.with_timezone(&Utc))
}

/// The one watched project the auto-measure should run now, with the base
/// tip it would measure: its tip differs from its last measured tip, its last
/// measure finished at least [`AUTO_MEASURE_SPACING_MINUTES`] ago, and it was
/// not refused at this same tip (`refused`: project -> tip). The least
/// recently measured wins; a never-measured project first. `tip_of` resolves
/// a project's base tip (`None` = no tip, nothing to measure).
pub fn due_project(
    pool: &DbPool,
    now: DateTime<Utc>,
    refused: &HashMap<String, String>,
    tip_of: &dyn Fn(&DevProject) -> Option<String>,
) -> Result<Option<(String, String)>, AppError> {
    let spacing = chrono::Duration::minutes(AUTO_MEASURE_SPACING_MINUTES);
    let mut best: Option<(Option<DateTime<Utc>>, String, String)> = None;
    for project_id in watched_project_ids(pool)? {
        let project = match project_repo::get_project_by_id(pool, &project_id) {
            Ok(p) => p,
            Err(AppError::NotFound(_)) => continue,
            Err(e) => return Err(e),
        };
        let Some(tip) = tip_of(&project) else {
            continue;
        };
        if refused.get(&project_id) == Some(&tip) {
            continue;
        }
        let last = latest_measure(pool, &project_id)?;
        let last_at = last.as_ref().and_then(finished_at);
        if let Some(m) = &last {
            if m.head_sha == tip {
                continue;
            }
            if last_at.is_some_and(|t| now - t < spacing) {
                continue;
            }
        }
        let better = match &best {
            None => true,
            Some((b, _, _)) => match (last_at, b) {
                (None, Some(_)) => true,
                (Some(a), Some(b)) => a < *b,
                _ => false,
            },
        };
        if better {
            best = Some((last_at, project_id, tip));
        }
    }
    Ok(best.map(|(_, p, t)| (p, t)))
}

#[cfg(test)]
#[path = "overseer_tests.rs"]
mod tests;
