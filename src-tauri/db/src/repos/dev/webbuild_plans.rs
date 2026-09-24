//! `webbuild_plans` — one row per Studio project: its plan phases and the
//! sketch lane's first drawing of the site, both as JSON whose shape is owned
//! by app_lib's `webbuild` module (this crate cannot see those types).

use rusqlite::params;

use crate::DbPool;
use personas_core::error::AppError;

/// A stored plan, JSON still encoded.
#[derive(Debug, Clone, PartialEq)]
pub struct WebBuildPlanRow {
    pub project_id: String,
    pub phases_json: String,
    pub sketch_json: Option<String>,
    pub updated_at: String,
}

const COLUMNS: &str = "project_id, phases_json, sketch_json, updated_at";

row_mapper!(row_to_plan -> WebBuildPlanRow {
    project_id, phases_json, sketch_json [opt], updated_at,
});

pub fn get_webbuild_plan(
    pool: &DbPool,
    project_id: &str,
) -> Result<Option<WebBuildPlanRow>, AppError> {
    timed_query!("webbuild_plans", "webbuild_plans::get_webbuild_plan", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM webbuild_plans WHERE project_id = ?1"
        ))?;
        let mut rows = stmt.query_map(params![project_id], row_to_plan)?;
        Ok(rows.next().transpose()?)
    })
}

/// Replace the project's plan. `sketch_json = None` keeps a stored sketch:
/// the plan is saved after every turn, the sketch only once, when it lands.
pub fn upsert_webbuild_plan(
    pool: &DbPool,
    project_id: &str,
    phases_json: &str,
    sketch_json: Option<&str>,
) -> Result<(), AppError> {
    timed_query!("webbuild_plans", "webbuild_plans::upsert_webbuild_plan", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO webbuild_plans (project_id, phases_json, sketch_json, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(project_id) DO UPDATE SET
               phases_json = excluded.phases_json,
               sketch_json = COALESCE(excluded.sketch_json, webbuild_plans.sketch_json),
               updated_at  = excluded.updated_at",
            params![
                project_id,
                phases_json,
                sketch_json,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(pool: &DbPool) -> Result<String, AppError> {
        let id = uuid::Uuid::new_v4().to_string();
        pool.get()?.execute(
            "INSERT INTO dev_projects (id, name, root_path, created_at, updated_at) VALUES (?1, 'p', ?2, 'now', 'now')",
            params![id, format!("/tmp/{id}")],
        )?;
        Ok(id)
    }

    #[test]
    fn round_trips_and_keeps_the_sketch_across_plan_updates() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let id = project(&pool)?;
        assert!(get_webbuild_plan(&pool, &id)?.is_none());
        upsert_webbuild_plan(&pool, &id, "[]", Some(r#"{"pages":[]}"#))?;
        upsert_webbuild_plan(&pool, &id, r#"[{"id":"v"}]"#, None)?;
        let row = get_webbuild_plan(&pool, &id)?.expect("a stored plan");
        assert_eq!(row.phases_json, r#"[{"id":"v"}]"#);
        assert_eq!(row.sketch_json.as_deref(), Some(r#"{"pages":[]}"#));
        Ok(())
    }

    #[test]
    fn deleting_the_project_deletes_its_plan() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let id = project(&pool)?;
        upsert_webbuild_plan(&pool, &id, "[]", None)?;
        pool.get()?
            .execute("DELETE FROM dev_projects WHERE id = ?1", params![id])?;
        assert!(get_webbuild_plan(&pool, &id)?.is_none());
        Ok(())
    }
}
