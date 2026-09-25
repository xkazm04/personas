//! `dev_use_case_scenarios` and `dev_council_scenario_results` - the layer
//! nested under a feature.
//!
//! Like its sibling [`super::council`], this module never decides anything. It
//! stores what the upsert command validated and what the ingest door resolved;
//! the rules about WHAT may be written (a flat axes map, a slug that is not
//! already taken, propose-then-adopt) live at those doors, where there is a
//! caller to refuse.
//!
//! `floor` comes back exactly as DECLARED, `NULL` and all. The default is
//! resolved where a floor is applied (`personas_core::models::
//! resolve_scenario_floor`), never here: this row is what the `state.json`
//! export writes, and the `/council` skill's own S5 has to see the same
//! absence the store holds or the two implementations stop agreeing about
//! which scenarios named a floor.

use std::collections::BTreeMap;

use crate::models::{CouncilScenarioResult, FeatureScenario, UpsertScenarioInput};
use crate::DbPool;
use personas_core::error::AppError;
use personas_core::models::ScenarioDeclaration;
use rusqlite::{params, Row};

const SCENARIO_COLUMNS: &str = "id, use_case_id, slug, title, axes_json, scope, source, floor, \
     created_at, updated_at";
const RESULT_COLUMNS: &str = "id, run_id, scenario_id, state, score, confidence, n, proof, \
     floor_hit, advisory, summary";

/// Parse a stored `axes_json` document into the flat map the model carries.
///
/// A document that does not parse, or is not an object, reads as EMPTY rather
/// than failing the whole board: the door refuses a non-flat map on the way
/// in, so a row that got here another way is a row whose axes nobody can
/// trust - and dropping the axes is the honest rendering of that, not a
/// fabricated one (census `fabricated-json-on-parse-failure` is about the
/// opposite shape: inventing content, which this does not).
fn parse_axes(raw: &str) -> BTreeMap<String, String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        tracing::warn!(
            "scenarios: axes_json is not valid JSON - reading the scenario with no axes"
        );
        return BTreeMap::new();
    };
    let Some(object) = value.as_object() else {
        return BTreeMap::new();
    };
    object
        .iter()
        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
        .collect()
}

pub(crate) fn axes_to_json(axes: &BTreeMap<String, String>) -> String {
    serde_json::to_string(axes).unwrap_or_else(|_| "{}".to_string())
}

fn row_to_scenario(row: &Row) -> rusqlite::Result<FeatureScenario> {
    Ok(FeatureScenario {
        id: row.get("id")?,
        use_case_id: row.get("use_case_id")?,
        slug: row.get("slug")?,
        title: row.get("title")?,
        axes: parse_axes(&row.get::<_, String>("axes_json")?),
        floor: row.get("floor")?,
        scope: row.get("scope")?,
        source: row.get("source")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// One stored scenario, as the pure fold sees it.
///
/// Both the ingest door and the board reach the fold through this, so
/// "declared" means exactly one thing in this process.
pub fn declaration_of(s: &FeatureScenario) -> ScenarioDeclaration {
    ScenarioDeclaration {
        slug: s.slug.clone(),
        title: s.title.clone(),
        axes: s.axes.clone(),
        scope: s.scope.clone(),
        floor: s.floor,
    }
}

fn row_to_result(row: &Row) -> rusqlite::Result<CouncilScenarioResult> {
    Ok(CouncilScenarioResult {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        scenario_id: row.get("scenario_id")?,
        state: row.get("state")?,
        score: row.get("score")?,
        confidence: row.get("confidence")?,
        n: row.get("n")?,
        proof: row.get("proof")?,
        floor_hit: row.get::<_, i64>("floor_hit")? != 0,
        advisory: row.get::<_, i64>("advisory")? != 0,
        summary: row.get("summary")?,
    })
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/// One feature's scenarios in DECLARATION order - oldest first, slug breaking
/// a tie.
///
/// The order is load-bearing rather than cosmetic: the skill's S2 folds
/// "every declared slug in declared order", and the envelope this app
/// recomputes must list its buckets the same way the result it is checking
/// did. A display order (must-holds first, say) belongs in the page, not here.
pub fn list_scenarios(pool: &DbPool, use_case_id: &str) -> Result<Vec<FeatureScenario>, AppError> {
    timed_query!("dev_use_case_scenarios", "scenarios::list", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {SCENARIO_COLUMNS} FROM dev_use_case_scenarios
              WHERE use_case_id = ?1
              ORDER BY created_at ASC, slug ASC"
        ))?;
        let rows = stmt.query_map(params![use_case_id], row_to_scenario)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

/// Every scenario of one PROJECT, in one query. What the board and the
/// `state.json` export both need, and the reason neither walks features.
pub fn list_scenarios_for_project(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<FeatureScenario>, AppError> {
    timed_query!("dev_use_case_scenarios", "scenarios::list_for_project", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {} FROM dev_use_case_scenarios s
               JOIN dev_use_cases u ON u.id = s.use_case_id
              WHERE u.project_id = ?1
              ORDER BY s.use_case_id ASC, s.created_at ASC, s.slug ASC",
            SCENARIO_COLUMNS
                .split(", ")
                .map(|c| format!("s.{c}"))
                .collect::<Vec<_>>()
                .join(", ")
        ))?;
        let rows = stmt.query_map(params![project_id], row_to_scenario)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

pub fn get_scenario(pool: &DbPool, id: &str) -> Result<Option<FeatureScenario>, AppError> {
    timed_query!("dev_use_case_scenarios", "scenarios::get", {
        let conn = pool.get()?;
        Ok(conn
            .query_row(
                &format!("SELECT {SCENARIO_COLUMNS} FROM dev_use_case_scenarios WHERE id = ?1"),
                params![id],
                row_to_scenario,
            )
            .ok())
    })
}

/// Find one scenario by the key the ingest door resolves against.
pub fn find_scenario(
    pool: &DbPool,
    use_case_id: &str,
    slug: &str,
) -> Result<Option<FeatureScenario>, AppError> {
    timed_query!("dev_use_case_scenarios", "scenarios::find", {
        let conn = pool.get()?;
        Ok(conn
            .query_row(
                &format!(
                    "SELECT {SCENARIO_COLUMNS} FROM dev_use_case_scenarios
                      WHERE use_case_id = ?1 AND slug = ?2"
                ),
                params![use_case_id, slug],
                row_to_scenario,
            )
            .ok())
    })
}

/// Create or update one scenario.
///
/// `source` is not a caller's choice on this path: a scenario a PERSON creates
/// is `operator`, always. The council's own discoveries arrive through
/// [`create_discovered_scenario`], which is the only writer of `council`.
pub fn upsert_scenario(
    pool: &DbPool,
    input: &UpsertScenarioInput,
    slug: &str,
) -> Result<FeatureScenario, AppError> {
    timed_query!("dev_use_case_scenarios", "scenarios::upsert", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let axes = axes_to_json(&input.axes);
        let id = match input.id.as_deref() {
            Some(existing) => {
                let n = conn.execute(
                    "UPDATE dev_use_case_scenarios
                        SET slug = ?2, title = ?3, axes_json = ?4, scope = ?5, floor = ?6,
                            updated_at = ?7
                      WHERE id = ?1",
                    params![
                        existing,
                        slug,
                        input.title,
                        axes,
                        input.scope,
                        input.floor,
                        now
                    ],
                )?;
                // A primary-key-targeted write that changed nothing is a write
                // against a row that is gone, and only the affected-row count
                // can tell the two apart (census `blind-identity-write`).
                if n == 0 {
                    return Err(AppError::NotFound(format!("Scenario {existing} not found")));
                }
                existing.to_string()
            }
            None => {
                let id = uuid::Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO dev_use_case_scenarios
                        (id, use_case_id, slug, title, axes_json, scope, source, floor,
                         created_at, updated_at)
                     VALUES (?1,?2,?3,?4,?5,?6,'operator',?7,?8,?8)",
                    params![
                        id,
                        input.use_case_id,
                        slug,
                        input.title,
                        axes,
                        input.scope,
                        input.floor,
                        now
                    ],
                )?;
                id
            }
        };
        conn.query_row(
            &format!("SELECT {SCENARIO_COLUMNS} FROM dev_use_case_scenarios WHERE id = ?1"),
            params![id],
            row_to_scenario,
        )
        .map_err(AppError::Database)
    })
}

/// A scenario the COUNCIL named, entered as `proposed` with no floor.
///
/// Propose-then-adopt: it is excluded from every envelope computation until a
/// person changes its scope, so a member cannot widen the contract it is
/// judged against by discovering a branch mid-run.
pub fn create_discovered_scenario(
    pool: &DbPool,
    use_case_id: &str,
    slug: &str,
    title: &str,
    axes: &BTreeMap<String, String>,
) -> Result<FeatureScenario, AppError> {
    timed_query!("dev_use_case_scenarios", "scenarios::create_discovered", {
        let conn = pool.get()?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO dev_use_case_scenarios
                (id, use_case_id, slug, title, axes_json, scope, source, floor,
                 created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,'proposed','council',NULL,?6,?6)",
            params![id, use_case_id, slug, title, axes_to_json(axes), now],
        )?;
        conn.query_row(
            &format!("SELECT {SCENARIO_COLUMNS} FROM dev_use_case_scenarios WHERE id = ?1"),
            params![id],
            row_to_scenario,
        )
        .map_err(AppError::Database)
    })
}

/// Delete one scenario. `false` when there was no such row - the caller turns
/// that into a `NotFound` rather than a silent success.
pub fn delete_scenario(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_use_case_scenarios", "scenarios::delete", {
        let conn = pool.get()?;
        let n = conn.execute(
            "DELETE FROM dev_use_case_scenarios WHERE id = ?1",
            params![id],
        )?;
        Ok(n > 0)
    })
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/// One scenario result as the ingest door resolved it, before it has an id.
/// Every derived field here (`floor_hit`, `advisory`) came from the scenario
/// row and the run's trust state, never from the result file.
#[derive(Debug, Clone, PartialEq)]
pub struct NewScenarioResult {
    pub scenario_id: String,
    pub state: String,
    pub score: Option<f64>,
    pub confidence: String,
    pub n: Option<i32>,
    pub proof: String,
    pub floor_hit: bool,
    pub advisory: bool,
    pub summary: String,
}

/// Every scenario result one run produced.
pub fn list_results_for_run(
    pool: &DbPool,
    run_id: &str,
) -> Result<Vec<CouncilScenarioResult>, AppError> {
    timed_query!(
        "dev_council_scenario_results",
        "scenarios::results_for_run",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(&format!(
                "SELECT {RESULT_COLUMNS} FROM dev_council_scenario_results WHERE run_id = ?1"
            ))?;
            let rows = stmt.query_map(params![run_id], row_to_result)?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        }
    )
}

/// Scenario results for MANY runs in one query - the board's read.
///
/// An empty `run_ids` returns an empty vec rather than building a `IN ()`,
/// which SQLite parses as a syntax error rather than as "nothing".
pub fn list_results_for_runs(
    pool: &DbPool,
    run_ids: &[String],
) -> Result<Vec<CouncilScenarioResult>, AppError> {
    if run_ids.is_empty() {
        return Ok(Vec::new());
    }
    timed_query!(
        "dev_council_scenario_results",
        "scenarios::results_for_runs",
        {
            let conn = pool.get()?;
            let placeholders = vec!["?"; run_ids.len()].join(",");
            let mut stmt = conn.prepare(&format!(
                "SELECT {RESULT_COLUMNS} FROM dev_council_scenario_results
                  WHERE run_id IN ({placeholders})"
            ))?;
            let rows = stmt.query_map(
                rusqlite::params_from_iter(run_ids.iter().map(String::as_str)),
                row_to_result,
            )?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::dev::projects::create_project;
    use crate::repos::dev::use_cases::create_use_case;

    fn seeded() -> (DbPool, String, String) {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/p", None, None, None, None, None).unwrap();
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

    fn axes(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn input(uc: &str, title: &str, scope: &str) -> UpsertScenarioInput {
        UpsertScenarioInput {
            id: None,
            use_case_id: uc.to_string(),
            slug: None,
            title: title.to_string(),
            axes: axes(&[("candidate_family", "marketing")]),
            scope: scope.to_string(),
            floor: None,
        }
    }

    #[test]
    fn a_scenario_round_trips_with_its_axes() {
        let (pool, _p, uc) = seeded();
        let created = upsert_scenario(
            &pool,
            &input(&uc, "Marketing candidates", "tracked"),
            "marketing",
        )
        .unwrap();
        assert_eq!(created.source, "operator", "a person's scenario is theirs");
        assert_eq!(created.scope, "tracked");
        assert_eq!(
            created.axes.get("candidate_family").map(String::as_str),
            Some("marketing")
        );
        assert_eq!(created.floor, None, "nobody declared one");

        let listed = list_scenarios(&pool, &uc).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0], created);
    }

    /// The default floor is never written and never read back as a number: the
    /// row says "nobody declared one", and the fold resolves it. That is what
    /// lets the `state.json` export hand the skill the same absence, so its own
    /// S5 reaches the same answer.
    /// Returns `Result` so the pool checkout can PROPAGATE: a fixture that
    /// panics on acquire hides the same saturation the product would (census
    /// `pool-get-unwrapped`).
    #[test]
    fn a_must_hold_scenario_keeps_its_undeclared_floor_null() -> Result<(), AppError> {
        let (pool, _p, uc) = seeded();
        let created = upsert_scenario(&pool, &input(&uc, "IT candidates", "must_hold"), "it")?;
        assert_eq!(created.floor, None);
        assert_eq!(
            personas_core::models::resolve_scenario_floor(created.floor),
            0.5
        );

        let conn = pool.get()?;
        let stored: Option<f64> = conn.query_row(
            "SELECT floor FROM dev_use_case_scenarios WHERE id = ?1",
            params![created.id],
            |r| r.get("floor"),
        )?;
        assert_eq!(stored, None, "the default is a fold, not a write");
        Ok(())
    }

    #[test]
    fn an_update_targets_a_row_that_must_exist() {
        let (pool, _p, uc) = seeded();
        let created =
            upsert_scenario(&pool, &input(&uc, "Marketing", "tracked"), "marketing").unwrap();

        let mut update = input(&uc, "Marketing candidates", "must_hold");
        update.id = Some(created.id.clone());
        update.floor = Some(0.7);
        let updated = upsert_scenario(&pool, &update, "marketing").unwrap();
        assert_eq!(updated.id, created.id);
        assert_eq!(updated.scope, "must_hold");
        assert_eq!(updated.floor, Some(0.7));
        assert_eq!(updated.source, "operator");

        let mut ghost = input(&uc, "Gone", "tracked");
        ghost.id = Some("no-such-scenario".into());
        assert!(matches!(
            upsert_scenario(&pool, &ghost, "gone"),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn a_duplicate_slug_is_refused_by_the_store() {
        let (pool, _p, uc) = seeded();
        upsert_scenario(&pool, &input(&uc, "Marketing", "tracked"), "marketing").unwrap();
        assert!(
            upsert_scenario(
                &pool,
                &input(&uc, "Marketing again", "tracked"),
                "marketing"
            )
            .is_err(),
            "UNIQUE(use_case_id, slug)"
        );
    }

    /// The council's own discovery enters `proposed` with source `council`,
    /// and nothing else writes that source.
    #[test]
    fn a_discovered_scenario_enters_proposed() {
        let (pool, _p, uc) = seeded();
        let discovered = create_discovered_scenario(
            &pool,
            &uc,
            "hr",
            "HR candidates",
            &axes(&[("candidate_family", "hr")]),
        )
        .unwrap();
        assert_eq!(discovered.scope, "proposed");
        assert_eq!(discovered.source, "council");
        assert_eq!(discovered.floor, None, "a proposal gates nothing");
        assert_eq!(
            find_scenario(&pool, &uc, "hr").unwrap().map(|s| s.id),
            Some(discovered.id)
        );
    }

    #[test]
    fn deleting_says_whether_there_was_anything_there() {
        let (pool, _p, uc) = seeded();
        let created =
            upsert_scenario(&pool, &input(&uc, "Marketing", "tracked"), "marketing").unwrap();
        assert!(delete_scenario(&pool, &created.id).unwrap());
        assert!(!delete_scenario(&pool, &created.id).unwrap());
        assert!(list_scenarios(&pool, &uc).unwrap().is_empty());
    }

    #[test]
    fn the_project_wide_read_spans_every_feature() {
        let (pool, project_id, uc) = seeded();
        upsert_scenario(&pool, &input(&uc, "Marketing", "tracked"), "marketing").unwrap();
        let other = create_use_case(
            &pool,
            &project_id,
            "Checkout",
            None,
            "capability",
            None,
            &[],
            Some("active"),
            "scan",
            None,
        )
        .unwrap();
        upsert_scenario(
            &pool,
            &input(&other.id, "Guest checkout", "must_hold"),
            "guest",
        )
        .unwrap();

        let all = list_scenarios_for_project(&pool, &project_id).unwrap();
        assert_eq!(all.len(), 2);
        assert!(all
            .iter()
            .any(|s| s.slug == "guest" && s.scope == "must_hold"));
    }

    #[test]
    fn many_runs_read_their_results_in_one_query_and_none_reads_nothing() {
        let (pool, _p, _uc) = seeded();
        assert!(list_results_for_runs(&pool, &[]).unwrap().is_empty());
    }
}
