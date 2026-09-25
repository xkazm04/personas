//! Lifecycle v2: each project's development practice as durable, versioned state.
//!
//! Two tables:
//!
//! - `dev_lifecycle_versions` - the project's lifecycle document, one row per
//!   version. APPEND-ONLY: a change is a new row at `MAX(version) + 1`; the only
//!   column ever updated afterwards is `install_task_id` (set once, when the
//!   "Install into repo" dev task is created). An absent row means the implicit
//!   Solo default (version 0, author `default`), which is why `'default'` is not
//!   in the `author` CHECK - it is never stored.
//! - `dev_lifecycle_evidence` - what git showed after a finished app task, one
//!   row per task (outcomes per step as JSON). Commit evidence for manual CLI
//!   work is derived on read and never stored, hence `source_kind` admits only
//!   `'task'`.
//!
//! Schema decisions worth naming:
//!
//! 1. **Both tables cascade from `dev_projects`.** A practice has no meaning
//!    without its project.
//! 2. **The vocabularies carry CHECKs**, mirroring the
//!    `personas_core::models::lifecycle` wire enums. Keep them identical.
//! 3. **`(project_id, version)` is UNIQUE** (census
//!    `unconstrained-sequence-column`): the latest version is "highest version",
//!    and a tie would make it plan-dependent. The explicit DESC index serves the
//!    latest-version read.
//! 4. **Evidence is idempotent per source** (`UNIQUE(project_id, source_kind,
//!    source_ref)`): re-finalizing a task replaces its row instead of adding one.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_lifecycle_versions",
            description:
                "Lifecycle v2: dev_lifecycle_versions - the project's practice, one row per version",
            already_applied: |conn| has_table(conn, "dev_lifecycle_versions"),
            apply: create_versions,
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_lifecycle_evidence",
            description:
                "Lifecycle v2: dev_lifecycle_evidence - per-task step outcomes read from git",
            already_applied: |conn| has_table(conn, "dev_lifecycle_evidence"),
            apply: create_evidence,
        },
    )
}

fn create_versions(conn: &Connection) -> Result<(), AppError> {
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS dev_lifecycle_versions (
            id               TEXT PRIMARY KEY NOT NULL,
            project_id       TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
            version          INTEGER NOT NULL,
            preset           TEXT NOT NULL CHECK (preset IN ('solo','team')),
            doc_json         TEXT NOT NULL,
            change_note      TEXT,
            author           TEXT NOT NULL CHECK (author IN ('operator','athena','system')),
            install_task_id  TEXT,
            created_at       TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (project_id, version)
         );
         CREATE INDEX IF NOT EXISTS idx_dev_lifecycle_versions_project_version
            ON dev_lifecycle_versions (project_id, version DESC);",
    )?;
    Ok(())
}

fn create_evidence(conn: &Connection) -> Result<(), AppError> {
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS dev_lifecycle_evidence (
            id             TEXT PRIMARY KEY NOT NULL,
            project_id     TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
            source_kind    TEXT NOT NULL CHECK (source_kind IN ('task')),
            source_ref     TEXT NOT NULL,
            title          TEXT NOT NULL,
            outcomes_json  TEXT NOT NULL DEFAULT '[]',
            occurred_at    TEXT NOT NULL,
            observed_at    TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (project_id, source_kind, source_ref)
         );
         CREATE INDEX IF NOT EXISTS idx_dev_lifecycle_evidence_project_occurred
            ON dev_lifecycle_evidence (project_id, occurred_at DESC);",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_project(conn: &Connection, id: &str) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO dev_projects (id, name, root_path) VALUES (?1, ?1, ?1)",
            rusqlite::params![id],
        )?;
        Ok(())
    }

    fn insert_version(conn: &Connection, id: &str, version: i64) -> rusqlite::Result<usize> {
        conn.execute(
            "INSERT INTO dev_lifecycle_versions (id, project_id, version, preset, doc_json, author)
             VALUES (?1, 'p1', ?2, 'solo', '{}', 'operator')",
            rusqlite::params![id, version],
        )
    }

    /// Both tables and their indexes land on a fresh database, and a replay is
    /// a no-op that keeps rows.
    #[test]
    fn dev_lifecycle_tables_land_idempotently() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        for table in ["dev_lifecycle_versions", "dev_lifecycle_evidence"] {
            assert!(has_table(&conn, table)?, "missing table {table}");
        }
        for index in [
            "idx_dev_lifecycle_versions_project_version",
            "idx_dev_lifecycle_evidence_project_occurred",
        ] {
            assert!(has_index(&conn, index)?, "missing index {index}");
        }

        seed_project(&conn, "p1")?;
        insert_version(&conn, "v1", 1)?;
        run(&conn)?;
        let n: i64 = conn.query_row(
            "SELECT COUNT(id) AS n FROM dev_lifecycle_versions",
            [],
            |r| r.get("n"),
        )?;
        assert_eq!(n, 1, "a replay must not touch existing rows");
        Ok(())
    }

    /// A version number is unique per project, and evidence is unique per source.
    #[test]
    fn versions_and_evidence_are_unique_per_project() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        seed_project(&conn, "p1")?;
        insert_version(&conn, "v1", 1)?;
        assert!(
            insert_version(&conn, "v2", 1).is_err(),
            "duplicate version must be refused"
        );
        insert_version(&conn, "v2", 2)?;
        conn.execute(
            "INSERT INTO dev_lifecycle_evidence (id, project_id, source_kind, source_ref, title, occurred_at)
             VALUES ('e1', 'p1', 'task', 't1', 'x', '2026-09-25T00:00:00Z')",
            [],
        )?;
        assert!(conn
            .execute(
                "INSERT INTO dev_lifecycle_evidence (id, project_id, source_kind, source_ref, title, occurred_at)
                 VALUES ('e2', 'p1', 'task', 't1', 'y', '2026-09-25T00:00:00Z')",
                [],
            )
            .is_err());
        Ok(())
    }

    /// The CHECKs refuse a token outside each vocabulary.
    #[test]
    fn dev_lifecycle_checks_refuse_unknown_tokens() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        seed_project(&conn, "p1")?;
        for bad in [
            "INSERT INTO dev_lifecycle_versions (id, project_id, version, preset, doc_json, author)
             VALUES ('b1', 'p1', 1, 'enterprise', '{}', 'operator')",
            "INSERT INTO dev_lifecycle_versions (id, project_id, version, preset, doc_json, author)
             VALUES ('b2', 'p1', 2, 'solo', '{}', 'default')",
            "INSERT INTO dev_lifecycle_evidence (id, project_id, source_kind, source_ref, title, occurred_at)
             VALUES ('b3', 'p1', 'commit', 'abc', 'x', '2026-09-25T00:00:00Z')",
        ] {
            assert!(conn.execute(bad, []).is_err(), "CHECK must refuse: {bad}");
        }
        Ok(())
    }

    /// Deleting the project removes its versions and evidence (FK cascade).
    #[test]
    fn deleting_a_project_cascades_to_its_lifecycle() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        seed_project(&conn, "p1")?;
        insert_version(&conn, "v1", 1)?;
        conn.execute_batch(
            "INSERT INTO dev_lifecycle_evidence (id, project_id, source_kind, source_ref, title, occurred_at)
                VALUES ('e1', 'p1', 'task', 't1', 'x', '2026-09-25T00:00:00Z');
             DELETE FROM dev_projects WHERE id = 'p1';",
        )?;
        for table in ["dev_lifecycle_versions", "dev_lifecycle_evidence"] {
            let n: i64 =
                conn.query_row(&format!("SELECT COUNT(*) AS n FROM {table}"), [], |r| {
                    r.get("n")
                })?;
            assert_eq!(n, 0, "{table} must cascade");
        }
        Ok(())
    }
}
