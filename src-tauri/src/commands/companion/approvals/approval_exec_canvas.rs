//! `approval_exec_canvas` — acting on the Mastermind canvas (WP2, 2026-08-04).
//!
//! Three executors, and deliberately **no new capability between them**. Each
//! resolves the canvas slugs Athena can actually see into the SAME
//! [`FleetPlanRow`] shape the editable chat plan card produces, then hands off
//! to the existing `execute_fleet_spawn` / `execute_fleet_dispatch` executors
//! (or, for a scan, to `idea_scanner::run_scan_core`). Nothing here widens
//! [`validate_fleet_cwd_in_db`] — the plan validator applies that same
//! boundary to every resolved root path, so a canvas dispatch is confined to
//! registered dev projects exactly like every other fleet path.
//!
//! What the wrapper genuinely adds:
//!
//! * **Slug vocabulary.** The digest and the read ops speak canvas slugs, so
//!   the action ops must too. A grammar where she reads slugs but has to emit
//!   absolute Windows paths is a grammar that invites her to invent one.
//! * **The `demo-*` refusal.** When no projects are registered the canvas
//!   renders six placeholder islands. They have no repo and no passport, so
//!   every action against one resolves to null. Refusing them by name, with
//!   the reason, beats a confusing "path not found" three layers down.
//! * **Group dispatch that is sequential by construction.** The canvas
//!   comments are explicit that parallel spawning stalls the machine.
//!   `execute_fleet_dispatch` spawns its `role_specs` in one sequential `for`
//!   loop and caps at 8; routing through it is how "sequential" stays true
//!   without a second scheduler here to keep honest.
//!
//! The ledger is likewise reused, not rebuilt: both dispatch paths end in
//! [`record_fleet_plan_decision`], which routes through the single
//! `record_fleet_decision` choke point.

#[allow(unused_imports)]
use super::*;

use crate::companion::canvas;

/// Sessions one canvas group dispatch may start. Mirrors
/// [`FLEET_PLAN_MAX_ROWS`] and the hard cap inside `execute_fleet_dispatch`,
/// so a group can never be assembled that the executor would reject at the end.
pub(crate) const CANVAS_GROUP_MAX: usize = FLEET_PLAN_MAX_ROWS;

/// Ledger `outcome` for a canvas-originated dispatch that ran.
pub(crate) const CANVAS_OUTCOME_DISPATCHED: &str = "canvas_dispatched";
/// Same, for one whose executor returned an error.
pub(crate) const CANVAS_OUTCOME_FAILED: &str = "canvas_dispatch_failed";

/// Pull the shared params every canvas dispatch carries: what to do, and
/// optionally which installed skill leads the prompt.
fn objective_and_skill(params: &serde_json::Value) -> Result<(String, Option<String>), AppError> {
    let objective = params
        .get("task")
        .or_else(|| params.get("objective"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::Validation(
                "a canvas dispatch needs a `task`: the one-paragraph brief the session runs".into(),
            )
        })?;
    let skill = params
        .get("skill")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    Ok((objective.to_string(), skill))
}

/// Build one plan row from a canvas slug. Refuses demo islands and unknown
/// slugs with a reason (see [`canvas::resolve_canvas_target`]); the containment
/// check on the resolved path happens in [`validate_fleet_plan`], one boundary
/// in one place.
fn row_for_slug(
    db: &crate::db::DbPool,
    slug: &str,
    objective: &str,
    skill: &Option<String>,
) -> Result<serde_json::Value, AppError> {
    let target = canvas::resolve_canvas_target(db, slug)?;
    Ok(serde_json::json!({
        "cwd": target.root_path,
        "objective": objective,
        "skill": skill,
    }))
}

/// Validate the assembled rows and fire them through the existing fleet
/// executors, then write the single ledger row.
fn dispatch_rows(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    intent: &str,
    rows: Vec<serde_json::Value>,
) -> Result<ExecuteResult, AppError> {
    // Same validator the chat plan card runs: bounded intent + objective,
    // slug-shaped skill, and `validate_fleet_cwd_in_db` per row.
    let (intent, plan) =
        validate_fleet_plan(&state.db, intent, &rows).map_err(AppError::Validation)?;
    let (action, params) = fleet_plan_dispatch_params(&intent, &plan);
    tracing::info!(
        intent = %intent,
        sessions = plan.len(),
        action = action,
        "companion: dispatching from the Mastermind canvas"
    );
    let result = match action {
        "fleet_spawn" => execute_fleet_spawn(app, &params),
        // Sequential by construction: `execute_fleet_dispatch` spawns its
        // role_specs one after another in a single loop.
        _ => execute_fleet_dispatch(app, &params),
    };
    let outcome = if result.is_ok() {
        CANVAS_OUTCOME_DISPATCHED
    } else {
        CANVAS_OUTCOME_FAILED
    };
    // ONE ledger writer. `record_fleet_plan_decision` funnels into
    // `record_fleet_decision`, the choke point every fleet verdict passes
    // through; a second writer here is how an audit trail splits in half.
    record_fleet_plan_decision(&state.db, action, &intent, &plan, outcome);
    result
}

/// `canvas_dispatch` — start ONE fleet session in one canvas project.
///
/// Params: `{ "slug": "<canvas slug>", "task": "<brief>", "skill": "<optional>" }`
pub(crate) fn execute_canvas_dispatch(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let slug = params
        .get("slug")
        .or_else(|| params.get("project"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Validation("canvas_dispatch: missing `slug`".into()))?;
    let (objective, skill) = objective_and_skill(params)?;
    let target = canvas::resolve_canvas_target(&state.db, slug)?;
    let rows = vec![row_for_slug(&state.db, slug, &objective, &skill)?];
    let intent = format!("canvas dispatch: {} · {objective}", target.name);
    dispatch_rows(state, app, &intent, rows)
}

/// `canvas_group_dispatch` — run ONE instruction across several canvas
/// projects, one session each.
///
/// Params: `{ "slugs": ["a","b"], "task": "<brief>", "skill": "<optional>" }`
///
/// Sequential and capped. A slug that refuses (demo island, unregistered) is
/// reported and SKIPPED rather than failing the whole group, so one bad name
/// in a list of six does not cost the other five; a group where every slug
/// refuses is an error, not a silent no-op.
pub(crate) fn execute_canvas_group_dispatch(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let slugs: Vec<String> = params
        .get("slugs")
        .or_else(|| params.get("projects"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(str::trim))
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    if slugs.is_empty() {
        return Err(AppError::Validation(
            "canvas_group_dispatch: `slugs` must list at least one canvas project".into(),
        ));
    }
    if slugs.len() > CANVAS_GROUP_MAX {
        return Err(AppError::Validation(format!(
            "canvas_group_dispatch: {} projects exceeds the cap of {CANVAS_GROUP_MAX} sessions \
             per group. Dispatch the worst {CANVAS_GROUP_MAX} first, then the rest.",
            slugs.len()
        )));
    }
    let (objective, skill) = objective_and_skill(params)?;

    let mut rows: Vec<serde_json::Value> = Vec::with_capacity(slugs.len());
    let mut refused: Vec<String> = Vec::new();
    for slug in &slugs {
        match row_for_slug(&state.db, slug, &objective, &skill) {
            Ok(row) => rows.push(row),
            Err(e) => refused.push(format!("`{slug}`: {e}")),
        }
    }
    if rows.is_empty() {
        return Err(AppError::Validation(format!(
            "canvas_group_dispatch: none of those projects can be dispatched into. {}",
            refused.join(" ")
        )));
    }
    let label = params
        .get("group")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("canvas group");
    let intent = format!("{label}: {objective}");
    let result = dispatch_rows(state, app, &intent, rows)?;
    if refused.is_empty() {
        return Ok(result);
    }
    Ok(ExecuteResult::message(format!(
        "{} Skipped: {}",
        result.message,
        refused.join(" ")
    )))
}

/// `canvas_run_idea_scan` — run an idea scan for one canvas project.
///
/// Params: `{ "slug": "<canvas slug>", "scan_types": ["..."], "target_count": 10 }`
///
/// Routed to the SAME `run_scan_core` the Ideas cell's popover calls, so the
/// backlog-saturation guard, the stale-idea archival and the agent registry all
/// apply unchanged. Not a fleet action, so it writes no fleet-decision row:
/// that ledger records which terminals Athena started, and padding it with
/// session-less rows would blunt the one audit surface the terminal-spawning
/// containment change is compensated by.
pub(crate) async fn execute_canvas_run_idea_scan(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let slug = params
        .get("slug")
        .or_else(|| params.get("project"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Validation("canvas_run_idea_scan: missing `slug`".into()))?;
    let target = canvas::resolve_canvas_target(&state.db, slug)?;
    let scan_types: Vec<String> = params
        .get("scan_types")
        .or_else(|| params.get("agent_keys"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(str::trim))
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    // Default to every registered scan agent: the Ideas cell's own dispatch
    // popover presents the full set, and an empty list is rejected downstream
    // as "no valid scan agents selected" rather than defaulted, which would
    // read to the user as the op silently failing.
    let scan_types = if scan_types.is_empty() {
        crate::commands::infrastructure::idea_scanner::get_scan_agents()
            .iter()
            .map(|a| a.key.clone())
            .collect()
    } else {
        scan_types
    };
    let target_count = params
        .get("target_count")
        .and_then(|v| v.as_i64())
        .map(|n| n.clamp(1, 50) as i32);

    let value = crate::commands::infrastructure::idea_scanner::run_scan_core(
        app.clone(),
        state.db.clone(),
        target.project_id.clone(),
        scan_types,
        None,
        target_count,
    )
    .await?;
    let scan_id = value
        .get("id")
        .or_else(|| value.get("scan_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    Ok(ExecuteResult::message(format!(
        "Started an idea scan for {}{}. Findings land in the project's backlog when it finishes.",
        target.name,
        if scan_id.is_empty() {
            String::new()
        } else {
            format!(" (scan `{}`)", &scan_id[..scan_id.len().min(8)])
        },
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;

    /// A system DB carrying just the `dev_projects` columns `list_projects`
    /// reads, with `root` registered under a real slug.
    fn pool_with_project(id: &str, name: &str, root: &std::path::Path) -> crate::db::DbPool {
        let manager = SqliteConnectionManager::memory();
        let pool = Pool::builder().max_size(1).build(manager).expect("pool");
        {
            let conn = pool.get().unwrap();
            conn.execute_batch(
                "CREATE TABLE dev_projects (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL,
                    description TEXT, status TEXT NOT NULL DEFAULT 'active',
                    tech_stack TEXT, github_url TEXT, monitoring_credential_id TEXT,
                    monitoring_project_slug TEXT, static_scan_config TEXT,
                    auto_pr_on_success INTEGER NOT NULL DEFAULT 0, pr_credential_id TEXT,
                    llm_tracking_credential_id TEXT, support_credential_id TEXT,
                    data_links TEXT, test_env_url TEXT, test_env_branch TEXT,
                    main_branch TEXT, standards_config TEXT, team_id TEXT,
                    workspace_id TEXT,
                    created_at TEXT NOT NULL DEFAULT '2026-01-01',
                    updated_at TEXT NOT NULL DEFAULT '2026-01-01');",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO dev_projects (id, name, root_path) VALUES (?1, ?2, ?3)",
                params![id, name, root.to_string_lossy()],
            )
            .unwrap();
        }
        pool
    }

    fn objective() -> String {
        "tighten the test suite".to_string()
    }

    #[test]
    fn a_demo_slug_is_refused_on_every_action_path() {
        let dir = std::env::temp_dir();
        let db = pool_with_project("proj_1", "Personas", &dir);
        for slug in ["demo-desktop", "demo-web", "DEMO-codex"] {
            // Single dispatch + group dispatch both go through `row_for_slug`.
            let err = row_for_slug(&db, slug, &objective(), &None)
                .expect_err("a demo island must never resolve to a row");
            assert!(
                format!("{err}").contains("demo islands"),
                "{slug}: {err}"
            );
            // The scan path shares the same resolver.
            let err = canvas::resolve_canvas_target(&db, slug).expect_err("scan must refuse too");
            assert!(format!("{err}").contains("demo islands"), "{slug}: {err}");
        }
    }

    #[test]
    fn an_unknown_slug_names_real_ones_instead_of_guessing() {
        let dir = std::env::temp_dir();
        let db = pool_with_project("proj_1", "Personas", &dir);
        let err = canvas::resolve_canvas_target(&db, "not-a-project").expect_err("must refuse");
        let msg = format!("{err}");
        assert!(msg.contains("`proj_1`"), "must offer a real id: {msg}");
        assert!(msg.contains("Do not invent"), "{msg}");
    }

    #[test]
    fn a_slug_resolves_by_id_and_by_name() {
        let dir = std::env::temp_dir();
        let db = pool_with_project("proj_1", "Personas", &dir);
        assert_eq!(
            canvas::resolve_canvas_target(&db, "proj_1").unwrap().name,
            "Personas"
        );
        assert_eq!(
            canvas::resolve_canvas_target(&db, "personas")
                .unwrap()
                .project_id,
            "proj_1"
        );
    }

    #[test]
    fn a_group_is_capped_at_the_same_eight_as_fleet_dispatch() {
        assert_eq!(CANVAS_GROUP_MAX, FLEET_PLAN_MAX_ROWS);
        assert_eq!(CANVAS_GROUP_MAX, 8);
    }

    #[test]
    fn a_group_dispatch_never_asks_for_parallel_execution() {
        // The sequential guarantee is structural, not a flag: rows become
        // `role_specs`, and `execute_fleet_dispatch` walks them in ONE `for`
        // loop. Pin that the params we hand it carry no concurrency knob a
        // future reader could flip.
        let plan = vec![
            FleetPlanRow {
                cwd: "C:/a".into(),
                objective: objective(),
                skill: None,
                label: None,
                model: None,
                effort: None,
            },
            FleetPlanRow {
                cwd: "C:/b".into(),
                objective: objective(),
                skill: None,
                label: None,
                model: None,
                effort: None,
            },
        ];
        let (action, params) = fleet_plan_dispatch_params("canvas group", &plan);
        assert_eq!(action, "fleet_dispatch");
        assert!(params.get("parallel").is_none());
        assert!(params.get("concurrency").is_none());
        assert_eq!(params["role_specs"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn a_dispatch_without_a_task_is_refused_before_anything_spawns() {
        let err = objective_and_skill(&serde_json::json!({ "slug": "proj_1" }))
            .expect_err("no task, no dispatch");
        assert!(format!("{err}").contains("`task`"), "{err}");
    }
}
