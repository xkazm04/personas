//! Server control's two tables: the dev-server columns of `dev_projects`
//! (`dev_command`, `dev_port`, added by `e59_dev_servers`) and
//! `dev_server_runs`, one row per server Personas spawned and still owns.
//!
//! `DevProject` deliberately does not carry `dev_command` / `dev_port` (the
//! contract keeps that model and its binding untouched), so this module reads
//! them with its own narrow projection, [`DevServerConfig`]. Membership in the
//! Server control view IS `dev_port IS NOT NULL`; there is no second flag.
//!
//! `dev_server_runs` is what lets a server outlive the app: a start writes the
//! row, a stop deletes it, and boot re-adopts every row whose pid is still
//! alive and deletes the rest. `persistent = 0` marks a Studio preview, which
//! the app still kills at exit.

use personas_core::error::AppError;
use rusqlite::{params, OptionalExtension};

use crate::DbPool;

/// The dev-server projection of one `dev_projects` row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DevServerConfig {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub workspace_id: Option<String>,
    /// Comma-separated, the `DevProject.tech_stack` convention.
    pub tech_stack: Option<String>,
    /// NULL means not configured yet (a scan is pending or failed).
    pub dev_command: Option<String>,
    /// NULL means the project is not in the Server control view.
    pub dev_port: Option<i64>,
}

/// One `dev_server_runs` row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DevServerRun {
    pub project_id: String,
    /// Root of the process tree Personas spawned.
    pub pid: i64,
    pub port: i64,
    /// Unix epoch seconds.
    pub started_at: i64,
    /// `true` = survives app exit (server control); `false` = Studio preview.
    pub persistent: bool,
}

/// Every column [`row_to_config`] reads, qualified because the list joins
/// `dev_workspaces` for its sort. Named rather than `*` so a column added to
/// `dev_projects` later never shifts this read.
const CONFIG_COLUMNS: &str =
    "p.id, p.name, p.root_path, p.workspace_id, p.tech_stack, p.dev_command, p.dev_port";

/// Every column of `dev_server_runs`, in the order [`row_to_run`] names them.
const RUN_COLUMNS: &str = "project_id, pid, port, started_at, persistent";

row_mapper!(row_to_config -> DevServerConfig {
    id, name, root_path, workspace_id, tech_stack, dev_command, dev_port,
});

row_mapper!(row_to_run -> DevServerRun {
    project_id, pid, port, started_at,
    persistent [bool],
});

/// Every project in the Server control view: `dev_port IS NOT NULL` and kind
/// `code`, sorted by workspace name (projects without a workspace last), then
/// by project name. The id is the final tiebreak so the order is total.
pub fn list_configured(pool: &DbPool) -> Result<Vec<DevServerConfig>, AppError> {
    timed_query!("dev_projects", "dev_servers::list_configured", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {CONFIG_COLUMNS}
               FROM dev_projects p
               LEFT JOIN dev_workspaces w ON w.id = p.workspace_id
              WHERE p.dev_port IS NOT NULL
                AND COALESCE(p.kind, 'code') = 'code'
              ORDER BY (w.name IS NULL), w.name COLLATE NOCASE, p.workspace_id,
                       p.name COLLATE NOCASE, p.id"
        ))?;
        let rows = stmt.query_map([], row_to_config)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// One project's dev-server projection, whether or not it is in the view.
/// `None` means no such project.
pub fn get_config(pool: &DbPool, project_id: &str) -> Result<Option<DevServerConfig>, AppError> {
    timed_query!("dev_projects", "dev_servers::get_config", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {CONFIG_COLUMNS} FROM dev_projects p WHERE p.id = ?1"
        ))?;
        stmt.query_row(params![project_id], row_to_config)
            .optional()
            .map_err(AppError::Database)
    })
}

/// Set a project's command and port together (the Edit form). Returns whether
/// the project exists.
pub fn set_config(
    pool: &DbPool,
    project_id: &str,
    dev_command: Option<&str>,
    dev_port: u16,
) -> Result<bool, AppError> {
    timed_query!("dev_projects", "dev_servers::set_config", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let changed = conn.execute(
            "UPDATE dev_projects SET dev_command = ?2, dev_port = ?3, updated_at = ?4 WHERE id = ?1",
            params![project_id, dev_command, i64::from(dev_port), now],
        )?;
        Ok(changed > 0)
    })
}

/// Put a project into the view on `dev_port`, leaving its command alone.
/// Returns whether the project exists.
pub fn set_port(pool: &DbPool, project_id: &str, dev_port: u16) -> Result<bool, AppError> {
    timed_query!("dev_projects", "dev_servers::set_port", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let changed = conn.execute(
            "UPDATE dev_projects SET dev_port = ?2, updated_at = ?3 WHERE id = ?1",
            params![project_id, i64::from(dev_port), now],
        )?;
        Ok(changed > 0)
    })
}

/// Take a project out of the view (`dev_port = NULL`). The project itself and
/// its command stay. Returns whether the project was in the view.
pub fn clear_port(pool: &DbPool, project_id: &str) -> Result<bool, AppError> {
    timed_query!("dev_projects", "dev_servers::clear_port", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let changed = conn.execute(
            "UPDATE dev_projects SET dev_port = NULL, updated_at = ?2
              WHERE id = ?1 AND dev_port IS NOT NULL",
            params![project_id, now],
        )?;
        Ok(changed > 0)
    })
}

/// Write what a repository scan found: the command and the tech stack always,
/// the port only when `dev_port` is `Some` (the caller passes it only when it
/// is free). Returns whether the project exists.
pub fn apply_scan(
    pool: &DbPool,
    project_id: &str,
    dev_command: &str,
    tech_stack: Option<&str>,
    dev_port: Option<u16>,
) -> Result<bool, AppError> {
    timed_query!("dev_projects", "dev_servers::apply_scan", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let changed = conn.execute(
            "UPDATE dev_projects
                SET dev_command = ?2,
                    tech_stack  = COALESCE(?3, tech_stack),
                    dev_port    = COALESCE(?4, dev_port),
                    updated_at  = ?5
              WHERE id = ?1",
            params![
                project_id,
                dev_command,
                tech_stack,
                dev_port.map(i64::from),
                now
            ],
        )?;
        Ok(changed > 0)
    })
}

/// The project (other than `except_project_id`) whose `dev_port` is `port`,
/// if any. Two projects on one port can never both run, so configure refuses it.
pub fn port_holder(
    pool: &DbPool,
    port: u16,
    except_project_id: &str,
) -> Result<Option<String>, AppError> {
    timed_query!("dev_projects", "dev_servers::port_holder", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT name FROM dev_projects WHERE dev_port = ?1 AND id <> ?2 ORDER BY name, id LIMIT 1",
            params![i64::from(port), except_project_id],
            |row| row.get::<_, String>("name"),
        )
        .optional()
        .map_err(AppError::Database)
    })
}

/// Every configured port, for the free-port suggestion.
pub fn configured_ports(pool: &DbPool) -> Result<Vec<u16>, AppError> {
    timed_query!("dev_projects", "dev_servers::configured_ports", {
        let conn = pool.get()?;
        let mut stmt =
            conn.prepare_cached("SELECT dev_port FROM dev_projects WHERE dev_port IS NOT NULL")?;
        let rows = stmt.query_map([], |row| row.get::<_, i64>("dev_port"))?;
        let ports = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        // A value outside u16 can only come from a hand-edited row; it cannot
        // collide with a real port, so it is not one.
        Ok(ports
            .into_iter()
            .filter_map(|p| u16::try_from(p).ok())
            .collect())
    })
}

// ----------------------------------------------------------------------------
// dev_server_runs
// ----------------------------------------------------------------------------

/// Record (or replace) the server Personas just spawned for a project. One run
/// per project: a restart overwrites the row. Returns the number of rows
/// written (1).
pub fn upsert_run(pool: &DbPool, run: &DevServerRun) -> Result<usize, AppError> {
    timed_query!("dev_server_runs", "dev_servers::upsert_run", {
        let conn = pool.get()?;
        let written = conn.execute(
            "INSERT INTO dev_server_runs (project_id, pid, port, started_at, persistent)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(project_id) DO UPDATE SET
                 pid        = excluded.pid,
                 port       = excluded.port,
                 started_at = excluded.started_at,
                 persistent = excluded.persistent",
            params![
                run.project_id,
                run.pid,
                run.port,
                run.started_at,
                i64::from(run.persistent)
            ],
        )?;
        Ok(written)
    })
}

/// Forget a project's run (the server stopped or died). Returns whether a row
/// was there.
pub fn delete_run(pool: &DbPool, project_id: &str) -> Result<bool, AppError> {
    timed_query!("dev_server_runs", "dev_servers::delete_run", {
        let conn = pool.get()?;
        let deleted = conn.execute(
            "DELETE FROM dev_server_runs WHERE project_id = ?1",
            params![project_id],
        )?;
        Ok(deleted > 0)
    })
}

/// Every recorded run, for the boot re-adopt pass.
pub fn list_runs(pool: &DbPool) -> Result<Vec<DevServerRun>, AppError> {
    timed_query!("dev_server_runs", "dev_servers::list_runs", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {RUN_COLUMNS} FROM dev_server_runs ORDER BY project_id"
        ))?;
        let rows = stmt.query_map([], row_to_run)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::dev::projects::create_project;

    fn project(pool: &DbPool, name: &str) -> String {
        create_project(
            pool,
            name,
            &format!("C:/repos/{name}"),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap()
        .id
    }

    #[test]
    fn a_project_joins_the_view_only_when_it_has_a_port() {
        let pool = crate::init_test_db().unwrap();
        let a = project(&pool, "alpha");
        let _b = project(&pool, "beta");
        assert!(list_configured(&pool).unwrap().is_empty());

        assert!(set_port(&pool, &a, 3000).unwrap());
        let view = list_configured(&pool).unwrap();
        assert_eq!(view.len(), 1);
        assert_eq!(view[0].id, a);
        assert_eq!(view[0].dev_port, Some(3000));
        assert_eq!(view[0].dev_command, None);

        assert!(clear_port(&pool, &a).unwrap());
        assert!(list_configured(&pool).unwrap().is_empty());
        // Clearing again is a no-op, reported as such.
        assert!(!clear_port(&pool, &a).unwrap());
    }

    #[test]
    fn configure_and_scan_write_their_columns() {
        let pool = crate::init_test_db().unwrap();
        let a = project(&pool, "alpha");
        assert!(set_config(&pool, &a, Some("npm run dev"), 3001).unwrap());
        let cfg = get_config(&pool, &a).unwrap().unwrap();
        assert_eq!(cfg.dev_command.as_deref(), Some("npm run dev"));
        assert_eq!(cfg.dev_port, Some(3001));

        // A scan without a free port keeps the configured one.
        assert!(apply_scan(&pool, &a, "bun run dev", Some("Next.js,React"), None).unwrap());
        let cfg = get_config(&pool, &a).unwrap().unwrap();
        assert_eq!(cfg.dev_command.as_deref(), Some("bun run dev"));
        assert_eq!(cfg.tech_stack.as_deref(), Some("Next.js,React"));
        assert_eq!(cfg.dev_port, Some(3001));

        assert!(apply_scan(&pool, &a, "bun run dev", None, Some(4000)).unwrap());
        let cfg = get_config(&pool, &a).unwrap().unwrap();
        assert_eq!(cfg.dev_port, Some(4000));
        assert_eq!(cfg.tech_stack.as_deref(), Some("Next.js,React"));

        assert!(get_config(&pool, "no-such-project").unwrap().is_none());
        assert!(!set_config(&pool, "no-such-project", None, 1).unwrap());
    }

    #[test]
    fn the_view_sorts_by_workspace_then_name() {
        let pool = crate::init_test_db().unwrap();
        let loose = project(&pool, "aardvark");
        let zed = project(&pool, "zed");
        let mid = project(&pool, "Mid");
        let ws = crate::repos::workspaces::org::create_workspace(&pool, "Bank", None, None, false)
            .unwrap();
        crate::repos::workspaces::org::assign_project(&pool, &zed, Some(&ws.id)).unwrap();
        crate::repos::workspaces::org::assign_project(&pool, &mid, Some(&ws.id)).unwrap();
        for (i, id) in [&loose, &zed, &mid].into_iter().enumerate() {
            set_port(&pool, id, 3000 + i as u16).unwrap();
        }
        let order: Vec<String> = list_configured(&pool)
            .unwrap()
            .into_iter()
            .map(|c| c.name)
            .collect();
        // Workspace members first (by name, case-insensitive), the loose one last.
        assert_eq!(order, vec!["Mid", "zed", "aardvark"]);
    }

    #[test]
    fn port_holder_and_configured_ports() {
        let pool = crate::init_test_db().unwrap();
        let a = project(&pool, "alpha");
        let b = project(&pool, "beta");
        set_port(&pool, &a, 3000).unwrap();
        assert_eq!(
            port_holder(&pool, 3000, &b).unwrap().as_deref(),
            Some("alpha")
        );
        assert_eq!(port_holder(&pool, 3000, &a).unwrap(), None);
        assert_eq!(port_holder(&pool, 3001, &b).unwrap(), None);
        set_port(&pool, &b, 3005).unwrap();
        let mut ports = configured_ports(&pool).unwrap();
        ports.sort_unstable();
        assert_eq!(ports, vec![3000, 3005]);
    }

    #[test]
    fn runs_upsert_list_and_delete() {
        let pool = crate::init_test_db().unwrap();
        let a = project(&pool, "alpha");
        let run = DevServerRun {
            project_id: a.clone(),
            pid: 4242,
            port: 3000,
            started_at: 1_700_000_000,
            persistent: true,
        };
        assert_eq!(upsert_run(&pool, &run).unwrap(), 1);
        let restarted = DevServerRun {
            pid: 4343,
            persistent: false,
            ..run.clone()
        };
        upsert_run(&pool, &restarted).unwrap();
        assert_eq!(list_runs(&pool).unwrap(), vec![restarted]);

        assert!(delete_run(&pool, &a).unwrap());
        assert!(!delete_run(&pool, &a).unwrap());
        assert!(list_runs(&pool).unwrap().is_empty());
    }

    #[test]
    fn a_run_goes_with_its_project() {
        let pool = crate::init_test_db().unwrap();
        let a = project(&pool, "alpha");
        upsert_run(
            &pool,
            &DevServerRun {
                project_id: a.clone(),
                pid: 1,
                port: 3000,
                started_at: 0,
                persistent: true,
            },
        )
        .unwrap();
        crate::repos::dev::projects::delete_project(&pool, &a).unwrap();
        assert!(list_runs(&pool).unwrap().is_empty());
    }
}
