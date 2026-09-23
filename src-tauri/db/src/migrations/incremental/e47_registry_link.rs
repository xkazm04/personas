//! The workspace -> knowledge-registry link, promoted out of the browser.
//!
//! The link lived in `localStorage` under `devtools.registryLinks.v1`, and
//! exactly one derived scalar ever crossed to the backend
//! (`app_settings.knowledge_registry_root`, computed in TypeScript). Everything
//! else that needed the link - Curator's eligibility, her loop, her dispatch -
//! is in Rust, which could not read a word of it. This is the same move
//! `dev_workspaces` itself made when its own prototype outgrew the browser.
//!
//! ## Shape, and why it is two tables
//!
//! A registry is a REPO, not a workspace's property: one registry can be held
//! by several workspaces, and picking the same repo twice must resolve to the
//! SAME entity - one clone, one pairing, one SHA. So registries are their own
//! keyed collection (`id` is `owner/repo`, the identity the store already used)
//! and a workspace holds a reference. `dev_workspace_registries.workspace_id`
//! is the PRIMARY KEY, which is what makes "one registry per workspace"
//! unrepresentable rather than merely conventional - the store's
//! `Record<workspaceId, registryId>` says exactly that and nothing enforced it.
//!
//! `clone_path` is UNIQUE because the working copy is half the identity: two
//! registries pointing at one directory would pair, sync and scan the same
//! folder under two names.
//!
//! The same three database facts e43 established hold here, for the same
//! reasons (see its header):
//!
//! - **Every closed set is a CHECK.** `state` and `dev_projects.kind`.
//! - **Every foreign key states ON DELETE.** Both are CASCADE and both are
//!   deliberate: a deleted workspace holds nothing, and a deleted registry is
//!   held by nobody. Neither fate is "refuse the parent delete", which is what
//!   an omitted clause means on SQLite.
//! - **No nullable-with-default column.** `lanes_json` / `domains_json` are
//!   NOT NULL DEFAULT '[]' - an empty inventory is `[]`, never absent.
//!
//! Four nullables are deliberate and none carries a DEFAULT: `session_id`,
//! `sha`, `paired_at` and `error` are each "this has not happened yet", and an
//! empty string would be a different, false claim.
//!
//! ## `dev_projects.kind`
//!
//! A registry checkout is registered as a dev project so work can be dispatched
//! into it at all - but it is not a product codebase, and the surfaces that
//! scan, passport and territory-map projects would treat it as one. `kind`
//! separates the two so those readers can exclude it by a column rather than by
//! guessing from the path.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_registries",
            description: "A knowledge registry: the repo, its working copy and what it publishes",
            already_applied: |conn| has_table(conn, "dev_registries"),
            apply: |conn| {
                // `lanes_json` / `domains_json` are JSON arrays rather than
                // child tables: both are an INVENTORY discovered by pairing and
                // replaced wholesale on the next probe, never edited row by
                // row, and nothing joins on a lane.
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_registries (
                        id TEXT PRIMARY KEY NOT NULL,
                        full_name TEXT NOT NULL,
                        url TEXT NOT NULL,
                        default_branch TEXT NOT NULL,
                        credential_id TEXT NOT NULL,
                        clone_path TEXT NOT NULL UNIQUE,
                        state TEXT NOT NULL
                            CHECK (state IN ('unlinked','pairing','paired','error')),
                        session_id TEXT,
                        lanes_json TEXT NOT NULL DEFAULT '[]',
                        domains_json TEXT NOT NULL DEFAULT '[]',
                        sha TEXT,
                        paired_at TEXT,
                        error TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "dev_workspace_registries",
            description: "Which registry a workspace holds - at most one, by primary key",
            already_applied: |conn| has_table(conn, "dev_workspace_registries"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_workspace_registries (
                        workspace_id TEXT PRIMARY KEY NOT NULL
                            REFERENCES dev_workspaces(id) ON DELETE CASCADE,
                        registry_id TEXT NOT NULL
                            REFERENCES dev_registries(id) ON DELETE CASCADE,
                        linked_at TEXT NOT NULL
                    );",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "dev_workspace_registries.registry_index",
            description: "Every workspace holding one registry, without scanning the table",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_workspace_registries")?
                    || has_index(conn, "idx_dev_workspace_registries_registry")?)
            },
            apply: |conn| {
                // The PK indexes `workspace_id`, which answers "what does this
                // workspace hold". The co-holder read goes the other way and is
                // a table scan without its own index - and it is the read that
                // tells an operator whether leaving a registry strands three
                // other workspaces.
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_dev_workspace_registries_registry
                     ON dev_workspace_registries(registry_id);",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "dev_projects.kind",
            description: "Separate a registry checkout from a product codebase",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_projects")? || has_column(conn, "dev_projects", "kind")?)
            },
            apply: |conn| {
                // SQLite accepts a CHECK on ADD COLUMN and does not re-validate
                // existing rows against it - which is exactly right here: every
                // row that already exists is a code project and the DEFAULT
                // says so.
                ddl_step(
                    conn,
                    "ALTER TABLE dev_projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'code'
                        CHECK (kind IN ('code','registry'));",
                )
            },
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn migrated_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::migrations::run(&conn).unwrap();
        crate::migrations::run_incremental(&conn).unwrap();
        conn
    }

    fn seed(conn: &Connection) {
        conn.execute(
            "INSERT INTO dev_workspaces (id, name, created_at, updated_at)
             VALUES ('ws-1','Alpha','2026-09-23T00:00:00Z','2026-09-23T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO dev_workspaces (id, name, created_at, updated_at)
             VALUES ('ws-2','Beta','2026-09-23T00:00:00Z','2026-09-23T00:00:00Z')",
            [],
        )
        .unwrap();
        add_registry(conn, "org/reg", "/clones/reg").unwrap();
    }

    fn add_registry(conn: &Connection, id: &str, clone_path: &str) -> rusqlite::Result<()> {
        conn.execute(
            "INSERT INTO dev_registries
                (id, full_name, url, default_branch, credential_id, clone_path, state,
                 lanes_json, domains_json, created_at, updated_at)
             VALUES (?1, ?1, '', 'main', '', ?2, 'paired', '[\"knowledge\"]', '[]',
                     '2026-09-23T00:00:00Z','2026-09-23T00:00:00Z')",
            rusqlite::params![id, clone_path],
        )
        .map(|_| ())
    }

    fn link(conn: &Connection, workspace_id: &str, registry_id: &str) -> rusqlite::Result<()> {
        conn.execute(
            "INSERT INTO dev_workspace_registries (workspace_id, registry_id, linked_at)
             VALUES (?1, ?2, '2026-09-23T00:00:00Z')",
            rusqlite::params![workspace_id, registry_id],
        )
        .map(|_| ())
    }

    #[test]
    fn the_chain_creates_every_object() {
        let conn = migrated_conn();
        assert!(has_table(&conn, "dev_registries").unwrap());
        assert!(has_table(&conn, "dev_workspace_registries").unwrap());
        assert!(has_index(&conn, "idx_dev_workspace_registries_registry").unwrap());
        assert!(has_column(&conn, "dev_projects", "kind").unwrap());
    }

    #[test]
    fn a_second_pass_is_a_no_op() {
        let conn = migrated_conn();
        run(&conn).unwrap();
        run(&conn).unwrap();
        assert!(has_table(&conn, "dev_registries").unwrap());
    }

    /// The whole reason the workspace column is the PRIMARY KEY: the store's
    /// `Record<workspaceId, registryId>` meant "at most one", and nothing made
    /// that true. A second link for the same workspace must be refused by the
    /// STORE, not by whichever writer happens to remember.
    #[test]
    fn a_workspace_can_hold_only_one_registry() {
        let conn = migrated_conn();
        seed(&conn);
        add_registry(&conn, "org/other", "/clones/other").unwrap();
        link(&conn, "ws-1", "org/reg").unwrap();
        assert!(
            link(&conn, "ws-1", "org/other").is_err(),
            "one registry per workspace is a primary key"
        );
        // ...while the other direction is the point of the shape: one registry,
        // several holders.
        link(&conn, "ws-2", "org/reg").unwrap();
    }

    #[test]
    fn the_closed_sets_and_the_unique_clone_path_are_database_facts() {
        let conn = migrated_conn();
        seed(&conn);
        assert!(
            conn.execute(
                "UPDATE dev_registries SET state = 'halfway' WHERE id = 'org/reg'",
                []
            )
            .is_err(),
            "state is a closed set"
        );
        assert!(
            add_registry(&conn, "org/twin", "/clones/reg").is_err(),
            "two registries cannot share one working copy"
        );
        assert!(
            conn.execute(
                "INSERT INTO dev_projects (id, name, root_path, kind, status, created_at, updated_at)
                 VALUES ('p1','P','/tmp/p','knowledge','active','2026-09-23T00:00:00Z','2026-09-23T00:00:00Z')",
                []
            )
            .is_err(),
            "kind is a closed set"
        );
    }

    /// An existing project predates the column and must read as `code` - the
    /// DEFAULT is what every scan, passport and territory reader will rely on.
    #[test]
    fn an_existing_project_is_a_code_project() {
        let conn = migrated_conn();
        conn.execute(
            "INSERT INTO dev_projects (id, name, root_path, status, created_at, updated_at)
             VALUES ('p1','P','/tmp/p','active','2026-09-23T00:00:00Z','2026-09-23T00:00:00Z')",
            [],
        )
        .unwrap();
        let kind: String = conn
            .query_row("SELECT kind FROM dev_projects WHERE id = 'p1'", [], |r| {
                r.get("kind")
            })
            .unwrap();
        assert_eq!(kind, "code");
    }

    /// Both fates are CASCADE, and both were chosen rather than defaulted: a
    /// deleted workspace holds nothing, and a deleted registry is held by
    /// nobody. The registry itself survives a workspace leaving.
    #[test]
    fn links_cascade_from_both_parents() {
        let conn = migrated_conn();
        seed(&conn);
        link(&conn, "ws-1", "org/reg").unwrap();
        link(&conn, "ws-2", "org/reg").unwrap();

        let count = |conn: &Connection, table: &str| -> i64 {
            conn.query_row(&format!("SELECT COUNT(*) AS n FROM {table}"), [], |r| {
                r.get("n")
            })
            .unwrap()
        };

        conn.execute("DELETE FROM dev_workspaces WHERE id = 'ws-1'", [])
            .unwrap();
        assert_eq!(count(&conn, "dev_workspace_registries"), 1);
        assert_eq!(
            count(&conn, "dev_registries"),
            1,
            "the registry outlives a workspace leaving it"
        );

        conn.execute("DELETE FROM dev_registries WHERE id = 'org/reg'", [])
            .unwrap();
        assert_eq!(count(&conn, "dev_workspace_registries"), 0);
    }
}
