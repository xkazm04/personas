//! Mandate envelope + act log (2026-10-14, spark `mandate-lanes`, WP2).
//!
//! A project's mandate is its App Master charter. This step gives the charter
//! the envelope the operator signs on top of the rung ladder, and the
//! append-only log every decision inside it lands in:
//!
//! * `persona_responsibilities` gains `decide_scopes` (JSON array, `'[]'`),
//!   `merge_policy` (`'never'` | `'gate-green'` | `'gate-green+council-ready'`),
//!   `envelope_version` (0 = never signed) and `kept_at_acts` (NULL = never
//!   re-read). The defaults reproduce today's behaviour exactly: no scope is
//!   delegated and nothing merges. The one backfill: a charter already at
//!   rung 3 or above gets `merge_policy = 'gate-green'`, which is what a rung-3
//!   worker did before the policy existed (the count is logged; 0 live today).
//! * `persona_responsibilities.source` admits `'athena'` (orphan drafts). A
//!   CHECK cannot be altered in SQLite, so the table is rebuilt from its own
//!   live DDL ([`rebuild_table_from_live_ddl`]): copy by name, indexes replayed.
//! * `dev_goals` gains `met_when` (JSON, NULL = none) and `charter_id` (NULL =
//!   the project's active charter).
//! * `charter_acts` - append-only; only `reverted_at` / `revert_act_id` are
//!   ever written after insert. Deliberately FK-less (the
//!   `persona_memory_tombstone` doctrine): an audit log must not be cascaded
//!   away by deleting the charter or persona whose acts it records.
//!
//! Every step guards on `has_table` first: the TEST binary's schema is not
//! guaranteed to carry every table, and a step over a missing table is
//! vacuously applied.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

const RESP: &str = "persona_responsibilities";

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_responsibilities.mandate_envelope",
            description: "Add the mandate envelope columns to persona_responsibilities \
                          (decide_scopes, merge_policy, envelope_version, kept_at_acts)",
            already_applied: |conn| {
                Ok(!has_table(conn, RESP)? || has_column(conn, RESP, "merge_policy")?)
            },
            apply: add_envelope_columns,
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_responsibilities.source_check.athena",
            description: "Widen persona_responsibilities.source CHECK to admit 'athena'",
            already_applied: |conn| {
                if !has_table(conn, RESP)? {
                    return Ok(true);
                }
                let ddl: String = conn.query_row(
                    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [RESP],
                    |r| r.get("sql"),
                )?;
                Ok(ddl.contains("'athena'"))
            },
            apply: |conn| {
                rebuild_table_from_live_ddl(
                    conn,
                    RESP,
                    &|create_sql| {
                        // `'agent-proposed'` is the last entry of the source
                        // CHECK (e19) and occurs exactly once. Anything else is
                        // a shape this step was not written against.
                        if create_sql.matches("'agent-proposed'").count() != 1 {
                            return Err(AppError::Validation(
                                "persona_responsibilities source CHECK is not in the expected \
                                 shape - refusing to rebuild"
                                    .into(),
                            ));
                        }
                        // e19's rebuild renamed a staging table onto this
                        // name, and SQLite stores a renamed table's name
                        // QUOTED. Unquote it so the helper can address it.
                        let unquoted = create_sql.replacen(
                            "CREATE TABLE \"persona_responsibilities\"",
                            "CREATE TABLE persona_responsibilities",
                            1,
                        );
                        Ok(unquoted.replacen("'agent-proposed'", "'agent-proposed','athena'", 1))
                    },
                    "",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "dev_goals.met_when_charter",
            description: "Add met_when and charter_id to dev_goals (mandate intents)",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_goals")? || has_column(conn, "dev_goals", "charter_id")?)
            },
            apply: |conn| {
                let mut ddl = String::new();
                if !has_column(conn, "dev_goals", "met_when")? {
                    ddl.push_str("ALTER TABLE dev_goals ADD COLUMN met_when TEXT;\n");
                }
                ddl.push_str("ALTER TABLE dev_goals ADD COLUMN charter_id TEXT;");
                ddl_step(conn, &ddl)
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "charter_acts",
            description: "Create charter_acts (append-only mandate act log)",
            already_applied: |conn| has_table(conn, "charter_acts"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS charter_acts (
                        id               TEXT PRIMARY KEY NOT NULL,
                        charter_id       TEXT NOT NULL,
                        envelope_version INTEGER NOT NULL,
                        item_kind        TEXT NOT NULL,
                        item_id          TEXT NOT NULL,
                        verdict          TEXT NOT NULL,
                        actor            TEXT NOT NULL
                                         CHECK (actor IN ('router','steward','operator')),
                        scope            TEXT,
                        reversible       INTEGER NOT NULL CHECK (reversible IN (0, 1)),
                        cost_usd         REAL,
                        shown_json       TEXT,
                        env_change_json  TEXT,
                        reverted_at      TEXT,
                        revert_act_id    TEXT,
                        origin_device    TEXT,
                        created_at       TEXT NOT NULL
                     );
                     CREATE INDEX IF NOT EXISTS idx_charter_acts_charter
                        ON charter_acts(charter_id, created_at);
                     CREATE INDEX IF NOT EXISTS idx_charter_acts_item
                        ON charter_acts(item_kind, item_id);",
                )
            },
        },
    )?;

    Ok(())
}

/// The four columns plus the rung-3 backfill, in one transaction so the
/// backfill cannot be lost to a crash between the ALTER and the UPDATE (the
/// step's postcondition is the column, so it would never run again).
fn add_envelope_columns(conn: &Connection) -> Result<(), AppError> {
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(
        "ALTER TABLE persona_responsibilities
            ADD COLUMN decide_scopes TEXT NOT NULL DEFAULT '[]';
         ALTER TABLE persona_responsibilities
            ADD COLUMN merge_policy TEXT NOT NULL DEFAULT 'never'
            CHECK (merge_policy IN ('never','gate-green','gate-green+council-ready'));
         ALTER TABLE persona_responsibilities
            ADD COLUMN envelope_version INTEGER NOT NULL DEFAULT 0;
         ALTER TABLE persona_responsibilities
            ADD COLUMN kept_at_acts INTEGER;",
    )?;
    let backfilled = tx.execute(
        "UPDATE persona_responsibilities SET merge_policy = 'gate-green' WHERE scope_rung >= 3",
        [],
    )?;
    tx.commit()?;
    tracing::info!(
        backfilled,
        "e67: charters at rung 3+ keep merging on green gates (merge_policy = 'gate-green')"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PoolExt;

    /// The pre-e67 shape of `persona_responsibilities`: e16's CREATE with the
    /// e19 CHECK widening, plus the columns e19/e25 added by ALTER.
    const PRE_E67_DDL: &str = "CREATE TABLE persona_responsibilities (
            id                 TEXT PRIMARY KEY NOT NULL,
            persona_id         TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
            title              TEXT NOT NULL,
            domain             TEXT NOT NULL DEFAULT 'general',
            outcomes           TEXT NOT NULL DEFAULT '[]',
            objectives         TEXT NOT NULL DEFAULT '[]',
            scope_rung         INTEGER NOT NULL DEFAULT 0,
            refusal_classes    TEXT NOT NULL DEFAULT '[]',
            approval_gates     TEXT NOT NULL DEFAULT '[]',
            owner              TEXT NOT NULL DEFAULT '',
            cadence            TEXT NOT NULL DEFAULT '{}',
            budget_monthly_usd REAL,
            tenure             TEXT NOT NULL DEFAULT '{}',
            status             TEXT NOT NULL DEFAULT 'active'
                CHECK(status IN ('draft','active','suspended','retired')),
            project_id         TEXT,
            source             TEXT NOT NULL DEFAULT 'operator'
                               CHECK(source IN ('operator','kp-hire','migration','agent-proposed')),
            created_at         TEXT NOT NULL,
            updated_at         TEXT NOT NULL
        );
        ALTER TABLE persona_responsibilities ADD COLUMN connectors TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE persona_responsibilities ADD COLUMN procedure TEXT NOT NULL DEFAULT '';
        ALTER TABLE persona_responsibilities ADD COLUMN spec TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE persona_responsibilities ADD COLUMN workspace_id TEXT;
        CREATE INDEX idx_pr_persona ON persona_responsibilities(persona_id, status);";

    fn insert_charter(conn: &Connection, id: &str, rung: i64, source: &str) {
        conn.execute(
            "INSERT INTO persona_responsibilities
                (id, persona_id, title, domain, scope_rung, budget_monthly_usd, project_id,
                 source, spec, created_at, updated_at)
             VALUES (?1, 'p1', ?1, 'software_engineering', ?2, 5.0, 'proj', ?3,
                     '{\"priority\":2}', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')",
            rusqlite::params![id, rung, source],
        )
        .unwrap();
    }

    fn rewind(conn: &Connection) {
        conn.execute_batch(&format!(
            "PRAGMA foreign_keys = OFF;
             DROP TABLE persona_responsibilities;
             {PRE_E67_DDL}
             DROP TABLE IF EXISTS charter_acts;
             ALTER TABLE dev_goals DROP COLUMN met_when;
             ALTER TABLE dev_goals DROP COLUMN charter_id;
             PRAGMA foreign_keys = ON;"
        ))
        .unwrap();
    }

    #[test]
    fn a_fresh_database_carries_the_envelope_the_log_and_the_goal_columns() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.conn("e67 test").unwrap();
        for col in [
            "decide_scopes",
            "merge_policy",
            "envelope_version",
            "kept_at_acts",
        ] {
            assert!(has_column(&conn, RESP, col).unwrap(), "{col} missing");
        }
        assert!(has_column(&conn, "dev_goals", "met_when").unwrap());
        assert!(has_column(&conn, "dev_goals", "charter_id").unwrap());
        assert!(has_table(&conn, "charter_acts").unwrap());
        assert!(has_index(&conn, "idx_charter_acts_charter").unwrap());
        assert!(has_index(&conn, "idx_charter_acts_item").unwrap());

        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, enabled, created_at, updated_at)
             VALUES ('p1','p1','sp',1,datetime('now'),datetime('now'))",
            [],
        )
        .unwrap();
        insert_charter(&conn, "c_athena", 2, "athena");
        let (scopes, policy, version, kept): (String, String, i64, Option<i64>) = conn
            .query_row(
                "SELECT decide_scopes, merge_policy, envelope_version, kept_at_acts
                 FROM persona_responsibilities WHERE id = 'c_athena'",
                [],
                |r| {
                    Ok((
                        r.get("decide_scopes")?,
                        r.get("merge_policy")?,
                        r.get("envelope_version")?,
                        r.get("kept_at_acts")?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            (scopes.as_str(), policy.as_str(), version, kept),
            ("[]", "never", 0, None)
        );
        assert!(
            conn.execute(
                "UPDATE persona_responsibilities SET merge_policy = 'always' WHERE id = 'c_athena'",
                [],
            )
            .is_err(),
            "merge_policy is CHECK-constrained"
        );
    }

    #[test]
    fn a_populated_table_is_widened_backfilled_and_kept_whole() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.conn("e67 test").unwrap();
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, enabled, created_at, updated_at)
             VALUES ('p1','p1','sp',1,datetime('now'),datetime('now'))",
            [],
        )
        .unwrap();
        rewind(&conn);
        insert_charter(&conn, "c2", 2, "kp-hire");
        insert_charter(&conn, "c3", 3, "operator");
        conn.execute(
            "UPDATE persona_responsibilities SET workspace_id = 'ws' WHERE id = 'c2'",
            [],
        )
        .unwrap();
        assert!(
            conn.execute(
                "INSERT INTO persona_responsibilities (id, persona_id, title, source, created_at, updated_at)
                 VALUES ('x','p1','x','athena','t','t')",
                [],
            )
            .is_err(),
            "the rewound table must refuse 'athena' or the test proves nothing"
        );

        run(&conn).unwrap();

        let rows: Vec<(String, String, i64, String, Option<String>, String)> = {
            let mut stmt = conn
                .prepare(
                    "SELECT id, merge_policy, envelope_version, decide_scopes, workspace_id, spec
                     FROM persona_responsibilities ORDER BY id",
                )
                .unwrap();
            stmt.query_map([], |r| {
                Ok((
                    r.get("id")?,
                    r.get("merge_policy")?,
                    r.get("envelope_version")?,
                    r.get("decide_scopes")?,
                    r.get("workspace_id")?,
                    r.get("spec")?,
                ))
            })
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
        };
        assert_eq!(rows.len(), 2, "the rebuild kept every row");
        assert_eq!(rows[0].0, "c2");
        assert_eq!(rows[0].1, "never", "a rung-2 charter keeps the default");
        assert_eq!(
            rows[0].4.as_deref(),
            Some("ws"),
            "an ALTER-added column rode along"
        );
        assert_eq!(rows[0].5, "{\"priority\":2}");
        assert_eq!(rows[1].0, "c3");
        assert_eq!(
            rows[1].1, "gate-green",
            "a rung-3 charter keeps merging on green"
        );
        assert!(rows.iter().all(|r| r.2 == 0 && r.3 == "[]"));
        assert!(
            has_index(&conn, "idx_pr_persona").unwrap(),
            "index replayed"
        );
        insert_charter(&conn, "c_athena", 2, "athena");
        assert!(has_table(&conn, "charter_acts").unwrap());
        assert!(has_column(&conn, "dev_goals", "met_when").unwrap());

        // FK survived the rebuild: deleting the persona cascades its charters.
        conn.execute("DELETE FROM personas WHERE id = 'p1'", [])
            .unwrap();
        let left: i64 = conn
            .query_row(
                "SELECT COUNT(*) AS n FROM persona_responsibilities",
                [],
                |r| r.get("n"),
            )
            .unwrap();
        assert_eq!(left, 0);

        // A replay is a no-op, not a second rebuild or a second backfill.
        run(&conn).unwrap();
    }

    #[test]
    fn a_replay_does_not_backfill_again() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.conn("e67 test").unwrap();
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, enabled, created_at, updated_at)
             VALUES ('p1','p1','sp',1,datetime('now'),datetime('now'))",
            [],
        )
        .unwrap();
        insert_charter(&conn, "c3", 3, "operator");
        // A rung-3 charter the operator set to `never` after e67 ran must stay `never`.
        run(&conn).unwrap();
        let policy: String = conn
            .query_row(
                "SELECT merge_policy FROM persona_responsibilities WHERE id = 'c3'",
                [],
                |r| r.get("merge_policy"),
            )
            .unwrap();
        assert_eq!(policy, "never");
    }
}
