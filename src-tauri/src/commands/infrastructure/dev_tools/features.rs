//! The Features page: one board read, and the scenario CRUD under it.
//!
//! Adapters, all four of them - each validates, makes one call into a repo and
//! maps the result. The rules that matter live where there is a caller to
//! refuse: the fold and the envelope in `personas_core::models`, the store's
//! closed sets in e43, and the ingest door's recomputation in
//! [`super::council_ingest`].
//!
//! The one thing decided here is the SOURCE of a scenario: anything written
//! through [`dev_tools_upsert_scenario`] is `operator`, always. A council's
//! own discovery enters through the ingest door as `proposed` / `council`, and
//! the two paths never meet - which is what makes propose-then-adopt a fact
//! rather than a convention.

use std::sync::Arc;

use tauri::{AppHandle, State};

use super::council::export_state_json;
use super::council_ingest::emit_council_changed;
use crate::db::models::{FeatureBoard, FeatureScenario, UpsertScenarioInput};
use crate::db::repos::dev::feature_board as board_repo;
use crate::db::repos::dev::scenarios as scenario_repo;
use crate::db::repos::dev::use_cases as use_case_repo;
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;
use personas_core::models::SCENARIO_SCOPES;
use personas_core::validation::require_non_empty;

/// Longest scenario title, and the cap on one axis key or value.
const MAX_TITLE: usize = 300;
const MAX_AXIS_TEXT: usize = 200;
/// Axes on one scenario. A coordinate, not a document.
const MAX_AXES: usize = 20;

/// The whole Features page in one read.
#[tauri::command]
pub async fn dev_tools_feature_board(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<FeatureBoard, AppError> {
    require_auth(&state).await?;
    board_repo::feature_board(&state.db, &project_id)
}

/// One feature's declared branches, in declaration order.
#[tauri::command]
pub async fn dev_tools_list_scenarios(
    state: State<'_, Arc<AppState>>,
    use_case_id: String,
) -> Result<Vec<FeatureScenario>, AppError> {
    require_auth(&state).await?;
    scenario_repo::list_scenarios(&state.db, &use_case_id)
}

/// Create or update one scenario.
///
/// Four refusals, and each is a way a scenario can become a branch nobody can
/// act on:
///
/// 1. A blank title. The title is what the floor-hit line names, so a scenario
///    with none produces an objection nobody can place.
/// 2. A scope outside the closed set.
/// 3. A slug that does not survive slugification - the slug is the join key
///    the `/council` skill folds against, and an empty one joins to nothing.
/// 4. Axes that are not a flat map of short strings. The axes are a
///    coordinate; a nested document here would be a second description of the
///    scenario competing with its title.
#[tauri::command]
pub async fn dev_tools_upsert_scenario(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    input: UpsertScenarioInput,
) -> Result<FeatureScenario, AppError> {
    require_auth(&state).await?;
    let (scenario, project_id) = upsert_scenario(&state.db, &input)?;
    announce(&state.db, &app, &project_id);
    Ok(scenario)
}

/// Body of [`dev_tools_upsert_scenario`], minus the IPC envelope - so the four
/// refusals can be driven without a Tauri runtime.
pub(crate) fn upsert_scenario(
    pool: &personas_db::DbPool,
    input: &UpsertScenarioInput,
) -> Result<(FeatureScenario, String), AppError> {
    let title = input.title.trim();
    require_non_empty("Scenario title", title)?;
    if title.chars().count() > MAX_TITLE {
        return Err(AppError::Validation(format!(
            "A scenario title longer than {MAX_TITLE} characters is a description, not a title"
        )));
    }
    if !SCENARIO_SCOPES.contains(&input.scope.as_str()) {
        return Err(AppError::Validation(format!(
            "Unknown scenario scope `{}` (expected one of {})",
            input.scope,
            SCENARIO_SCOPES.join(", ")
        )));
    }
    if let Some(floor) = input.floor {
        if !(0.0..=1.0).contains(&floor) || floor.is_nan() {
            return Err(AppError::Validation(format!(
                "A scenario floor is a score in 0..1, not {floor}"
            )));
        }
    }
    if input.axes.len() > MAX_AXES {
        return Err(AppError::Validation(format!(
            "A scenario carries at most {MAX_AXES} axes; this one has {}",
            input.axes.len()
        )));
    }
    for (key, value) in &input.axes {
        require_non_empty("Scenario axis name", key)?;
        require_non_empty(&format!("Scenario axis `{key}`"), value)?;
        if key.chars().count() > MAX_AXIS_TEXT || value.chars().count() > MAX_AXIS_TEXT {
            return Err(AppError::Validation(format!(
                "Scenario axis `{key}` is longer than {MAX_AXIS_TEXT} characters"
            )));
        }
    }

    // The slug is the join key the skill folds against, so it is derived by
    // the SAME function every other slug in this store is - never hand-rolled
    // beside it.
    let requested = input
        .slug
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(title);
    let slug = use_case_repo::slugify_use_case(requested);
    // Through the shared vocabulary rather than an inline refusal with a
    // sentence of its own: the emptiness rule already exists, returns the
    // identical `AppError::Validation`, and is open-coded at 300-odd call
    // sites in this tree (census `hand-rolled-emptiness-refusal`). What is
    // being refused is a title or slug with no alphanumerics at all, which
    // slugifies to nothing and would join to nothing.
    require_non_empty("Scenario slug", &slug)?;

    // The feature must exist: a branch of nothing is nothing. `get_use_case`
    // is also what gives the project this write has to announce itself on.
    let use_case = use_case_repo::get_use_case(pool, &input.use_case_id)?;
    let scenario = scenario_repo::upsert_scenario(pool, input, &slug)?;
    Ok((scenario, use_case.project_id))
}

/// Delete one scenario, with its results.
#[tauri::command]
pub async fn dev_tools_delete_scenario(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    // Read the owner BEFORE the delete: afterwards there is no row to ask.
    let project_id = scenario_repo::get_scenario(&state.db, &id)?
        .and_then(|s| use_case_repo::get_use_case(&state.db, &s.use_case_id).ok())
        .map(|u| u.project_id);
    if !scenario_repo::delete_scenario(&state.db, &id)? {
        return Err(AppError::NotFound(format!("Scenario {id} not found")));
    }
    if let Some(project_id) = project_id {
        announce(&state.db, &app, &project_id);
    }
    Ok(())
}

/// Tell the app a scenario moved, and hand the skill the new declaration.
///
/// Both halves are best-effort in the same way the decide door's exports are:
/// the row is the durable fact, and a file the app could not write is one the
/// next write rewrites anyway. The export matters because the skill reads its
/// scopes and floors from `state.json` and nowhere else - a scenario promoted
/// in the app and not exported is a floor the next council will not apply.
fn announce(pool: &personas_db::DbPool, app: &AppHandle, project_id: &str) {
    emit_council_changed(app, project_id);
    match repo::get_project_by_id(pool, project_id) {
        Ok(project) => {
            export_state_json(pool, std::path::Path::new(&project.root_path), project_id)
        }
        Err(e) => {
            tracing::warn!(project = %project_id, error = %e, "scenarios: could not resolve the project root to export state.json")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repos::dev::use_cases::create_use_case;
    use personas_db::DbPool;
    use std::collections::BTreeMap;

    fn seeded() -> (DbPool, String, String) {
        let pool = crate::db::init_test_db().unwrap();
        let project =
            repo::create_project(&pool, "P", "/tmp/p", None, None, None, None, None).unwrap();
        let uc = create_use_case(
            &pool,
            &project.id,
            "AI Voice Interview",
            None,
            "capability",
            None,
            &[],
            Some("active"),
            "scan",
            None,
        )
        .unwrap();
        (pool, project.id, uc.id)
    }

    fn input(uc: &str) -> UpsertScenarioInput {
        UpsertScenarioInput {
            id: None,
            use_case_id: uc.to_string(),
            slug: None,
            title: "Marketing candidates".into(),
            axes: [("candidate_family".to_string(), "marketing".to_string())]
                .into_iter()
                .collect(),
            scope: "must_hold".into(),
            floor: None,
        }
    }

    #[test]
    fn a_scenario_is_created_with_a_derived_slug_and_the_operators_name_on_it() {
        let (pool, project_id, uc) = seeded();
        let (scenario, owner) = upsert_scenario(&pool, &input(&uc)).unwrap();
        assert_eq!(owner, project_id);
        assert_eq!(
            scenario.slug, "marketing-candidates",
            "derived from the title"
        );
        assert_eq!(scenario.source, "operator");
        assert_eq!(scenario.scope, "must_hold");
        assert_eq!(scenario.floor, None, "nobody declared one");
    }

    #[test]
    fn a_blank_title_a_bad_scope_and_a_fat_axis_map_are_all_refused() {
        let (pool, _p, uc) = seeded();

        let mut blank = input(&uc);
        blank.title = "   ".into();
        assert!(upsert_scenario(&pool, &blank)
            .unwrap_err()
            .to_string()
            .contains("cannot be empty"));

        let mut scope = input(&uc);
        scope.scope = "maybe".into();
        assert!(upsert_scenario(&pool, &scope)
            .unwrap_err()
            .to_string()
            .contains("Unknown scenario scope"));

        let mut floor = input(&uc);
        floor.floor = Some(1.5);
        assert!(upsert_scenario(&pool, &floor)
            .unwrap_err()
            .to_string()
            .contains("score in 0..1"));

        let mut axes = input(&uc);
        axes.axes = (0..MAX_AXES + 1)
            .map(|i| (format!("axis{i}"), "v".to_string()))
            .collect::<BTreeMap<_, _>>();
        assert!(upsert_scenario(&pool, &axes)
            .unwrap_err()
            .to_string()
            .contains("at most"));

        let mut empty_axis = input(&uc);
        empty_axis.axes = [("family".to_string(), "  ".to_string())]
            .into_iter()
            .collect();
        assert!(upsert_scenario(&pool, &empty_axis).is_err());

        // A title with no alphanumerics slugifies to nothing, and a key that
        // joins to nothing is worse than a refusal.
        let mut punctuation = input(&uc);
        punctuation.title = "***".into();
        assert!(upsert_scenario(&pool, &punctuation)
            .unwrap_err()
            .to_string()
            .contains("Scenario slug cannot be empty"));
    }

    #[test]
    fn a_second_scenario_may_not_take_the_first_ones_slug() {
        let (pool, _p, uc) = seeded();
        upsert_scenario(&pool, &input(&uc)).unwrap();
        let mut same = input(&uc);
        same.slug = Some("marketing-candidates".into());
        same.title = "Marketing, again".into();
        assert!(
            upsert_scenario(&pool, &same).is_err(),
            "UNIQUE(use_case_id, slug)"
        );
    }

    #[test]
    fn a_scenario_on_a_feature_that_does_not_exist_is_refused() {
        let (pool, _p, _uc) = seeded();
        assert!(matches!(
            upsert_scenario(&pool, &input("no-such-feature")),
            Err(AppError::NotFound(_))
        ));
    }
}
