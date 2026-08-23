//! Per-environment connector bindings for a project's passport dimensions.
//!
//! `dev_projects` carries four singular credential pointers
//! (`monitoring_`/`pr_`/`llm_tracking_`/`support_credential_id`). Those answer
//! "which connector does this project use for X", which is the wrong question
//! for the env-split dimensions: a project can have SQLite locally, a Neon
//! branch in test and RDS in production, and can watch each of those with a
//! different monitoring backend.
//!
//! The key is `(project_id, dimension, env)`. `dimension` is the passport row
//! key, optionally suffixed with a capability — `"persistence"`,
//! `"monitoring"`, `"monitoring.logs"` — so the Monitoring dimension's four
//! grid items can each hold their own binding without a schema change.
//!
//! Clearing a binding DELETES the row rather than storing a NULL: "no connector
//! for this pair" and "a row that says no connector" are the same fact, and one
//! representation cannot drift from the other.
use rusqlite::params;

use crate::models::DevProjectEnvConnector;
use crate::DbPool;
use personas_core::error::AppError;

fn row_to_env_connector(row: &rusqlite::Row) -> rusqlite::Result<DevProjectEnvConnector> {
    Ok(DevProjectEnvConnector {
        project_id: row.get("project_id")?,
        dimension: row.get("dimension")?,
        env: row.get("env")?,
        credential_id: row.get("credential_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Every binding on a project, ordered so a UI can render them without sorting.
/// Rows whose `credential_id` is NULL are filtered out — see the module note.
pub fn list_env_connectors(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevProjectEnvConnector>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT project_id, dimension, env, credential_id, created_at, updated_at
           FROM dev_project_env_connectors
          WHERE project_id = ?1 AND credential_id IS NOT NULL
          ORDER BY dimension, env",
    )?;
    let rows = stmt.query_map(params![project_id], row_to_env_connector)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

/// Bind a connector to one (dimension, env) pair, replacing whatever was there.
pub fn set_env_connector(
    pool: &DbPool,
    project_id: &str,
    dimension: &str,
    env: &str,
    credential_id: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO dev_project_env_connectors (project_id, dimension, env, credential_id)
              VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(project_id, dimension, env)
         DO UPDATE SET credential_id = excluded.credential_id,
                       updated_at    = datetime('now')",
        params![project_id, dimension, env, credential_id],
    )?;
    Ok(())
}

/// Remove the binding for one pair. Idempotent — clearing an unbound pair is a
/// no-op, not an error.
pub fn clear_env_connector(
    pool: &DbPool,
    project_id: &str,
    dimension: &str,
    env: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "DELETE FROM dev_project_env_connectors
          WHERE project_id = ?1 AND dimension = ?2 AND env = ?3",
        params![project_id, dimension, env],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_project(pool: &DbPool) -> String {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO dev_projects (id, name, root_path, status)
             VALUES ('p1', 'Proj', '/tmp/p1', 'active')",
            [],
        )
        .unwrap();
        "p1".to_string()
    }

    #[test]
    fn set_is_upsert_and_clear_is_idempotent() {
        let pool = crate::init_test_db().unwrap();
        let pid = seed_project(&pool);

        set_env_connector(&pool, &pid, "persistence", "production", "cred-a").unwrap();
        let rows = list_env_connectors(&pool, &pid).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].credential_id, "cred-a");

        // Re-binding the SAME pair replaces rather than duplicating — the
        // primary key is (project, dimension, env), and a second row here would
        // make "which connector is bound" ambiguous.
        set_env_connector(&pool, &pid, "persistence", "production", "cred-b").unwrap();
        let rows = list_env_connectors(&pool, &pid).unwrap();
        assert_eq!(rows.len(), 1, "upsert created a duplicate row");
        assert_eq!(rows[0].credential_id, "cred-b");

        // A different env on the same dimension is a DIFFERENT binding.
        set_env_connector(&pool, &pid, "persistence", "local", "cred-c").unwrap();
        assert_eq!(list_env_connectors(&pool, &pid).unwrap().len(), 2);

        clear_env_connector(&pool, &pid, "persistence", "production").unwrap();
        let rows = list_env_connectors(&pool, &pid).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].env, "local");

        // Clearing something already gone must not error.
        clear_env_connector(&pool, &pid, "persistence", "production").unwrap();
    }

    #[test]
    fn capability_suffixed_dimensions_are_independent() {
        let pool = crate::init_test_db().unwrap();
        let pid = seed_project(&pool);

        // The Monitoring dimension's grid items share the `monitoring` prefix
        // but must not collide.
        set_env_connector(&pool, &pid, "monitoring", "production", "sentry").unwrap();
        set_env_connector(&pool, &pid, "monitoring.logs", "production", "axiom").unwrap();
        set_env_connector(&pool, &pid, "monitoring.metrics", "production", "grafana").unwrap();

        let rows = list_env_connectors(&pool, &pid).unwrap();
        assert_eq!(rows.len(), 3);
        let logs = rows
            .iter()
            .find(|r| r.dimension == "monitoring.logs")
            .unwrap();
        assert_eq!(logs.credential_id, "axiom");
    }
}
