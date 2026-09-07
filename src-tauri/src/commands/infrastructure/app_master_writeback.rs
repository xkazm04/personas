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
    apply_idea_verdict_cas, create_task_core, IdeaVerdict,
};
use crate::commands::infrastructure::task_executor::{
    record_task_outcome, write_back_to_source_idea,
};
use crate::db::models::{DevIdea, DevKpi, DevKpiMeasurement, DevTask};
use crate::db::repos::dev_tools as repo;
use crate::db::DbPool;
use crate::error::AppError;

// ============================================================================
// Vocabularies — every one of them lifted from the schema, not invented
// ============================================================================

/// What a worker can say happened to the idea it was given.
const OUTCOMES: [&str; 3] = ["delivered", "declined", "blocked"];

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
    /// `delivered` | `declined` | `blocked`.
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
fn task_status_for(outcome: &str) -> &'static str {
    match outcome {
        "delivered" => "completed",
        "blocked" => "failed",
        _ => "cancelled",
    }
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
                None,
                Some("queued"),
                None,
            )?,
            true,
        ),
    };

    let status = task_status_for(outcome);
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
    let error_field = if outcome == "delivered" {
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
        if outcome == "delivered" {
            Some(100)
        } else {
            None
        },
        None,
        error_field,
        None,
        Some(Some(now.as_str())),
    )?;

    // The learning loop, through the executor's own write-backs — the same two
    // calls `finalize_task` makes, so a worker-reported outcome teaches the
    // project exactly what an in-app run would have.
    let delivered = outcome == "delivered";
    record_task_outcome(
        db,
        &task.id,
        delivered,
        &format!(
            "App Master worker reported `{outcome}`.{}",
            note.map(|n| format!(" {n}")).unwrap_or_default()
        ),
    );

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
}

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

    match created {
        Some(idea) => Ok(FileIdeaResult {
            idea,
            created: true,
            dedup_key,
        }),
        // The guard fired. Hand back what is already there — "already filed" and
        // "could not file" are different answers and the caller must be able to
        // tell them apart.
        None => {
            let idea =
                repo::find_idea_by_dedup_key(db, &project.id, &dedup_key)?.ok_or_else(|| {
                    AppError::Internal(format!(
                        "backlog item {dedup_key} was deduped but cannot be read back"
                    ))
                })?;
            Ok(FileIdeaResult {
                idea,
                created: false,
                dedup_key,
            })
        }
    }
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
// The brief — what every App Master dispatch tells its worker
// ============================================================================

/// The write-back block appended to every App Master dispatch.
///
/// Pure and bounded, and deliberately short: it rides on EVERY dispatch, beside
/// the charter's own contract and the worktree guardrails, so every line has to
/// earn its place. It names the handshake file, the header, the four routes and
/// the one rule — because a worker that cannot find the door does not write
/// back, and cycle 1 measured exactly that outcome.
pub fn write_back_brief(project_id: &str, idea_id: Option<&str>) -> String {
    let mut s = String::from(
        "\nPERSONAS WRITE-BACK — your run is not finished until the outcome is written back.\n\
         The app publishes a handshake at ~/.personas/local-http.json with `port` and `token`.\n\
         Every call needs the header `x-personas-local-token: <token>` and\n\
         a base of http://127.0.0.1:<port>/dev-tools\n",
    );
    s.push_str(&format!("Your project_id is {project_id}.\n"));
    if let Some(idea) = idea_id {
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
    }
    s.push_str(&format!(
        "Anything else you learned goes back as data, not as prose in your transcript:\n\
         - POST /dev-tools/ideas \
         {{\"project_id\":\"{project_id}\",\"title\":\"...\",\"description\":\"...\"}} \
         — file a backlog item (deduped; re-filing is safe)\n\
         - POST /dev-tools/kpis \
         {{\"project_id\":\"{project_id}\",\"name\":\"...\",\"measure_kind\":\"codebase\"}} \
         — declare a meter\n\
         - POST /dev-tools/kpis/<kpi_id>/measure \
         {{\"value\":12.5,\"evidence\":\"the command and its output\"}} \
         — record a reading\n\
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
        let s = write_back_brief("proj-42", Some("297f6ba4"));
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
            "\"pr_url\"",
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

    #[test]
    fn a_brief_without_an_idea_omits_the_outcome_route() {
        let s = write_back_brief("proj-42", None);
        assert!(!s.contains("/outcome"));
        assert!(s.contains("proj-42"));
        assert!(s.contains("POST /dev-tools/kpis "));
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
        assert_eq!(
            repo::list_ideas(&pool, Some(&pid), None, None, None, None)?.len(),
            1
        );
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
