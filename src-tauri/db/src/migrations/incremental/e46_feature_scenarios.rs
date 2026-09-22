//! Scenarios: the nested layer under a feature, and one council run's result
//! per scenario.
//!
//! A feature can be certified as a whole and still perform differently by
//! branch - an AI voice interview that is excellent with IT candidates and poor
//! with marketing ones is "approved" and wrong. A scenario is that feature
//! applied to ONE condition, and a council's approval becomes an ENVELOPE
//! ("holds for IT and engineering, weak for marketing, never measured for HR")
//! rather than a stamp.
//!
//! The same three database facts e43 established hold here, for the same
//! reasons (see its header): every closed set is a CHECK, every foreign key
//! states ON DELETE, and no column is nullable-with-default.
//!
//! Two nullables are deliberate and neither carries a DEFAULT:
//!
//! - `dev_use_case_scenarios.floor` - the default 0.5 for a `must_hold`
//!   scenario is resolved at READ time and never written, so raising the
//!   default later moves every scenario that never named its own floor rather
//!   than only the ones created after the change.
//! - `dev_council_scenario_results.score` / `.n` - an unmeasured scenario has
//!   no score, and `0.0` is the one value that must never stand in for "we did
//!   not look". The table CHECK makes the pair unrepresentable: `measured`
//!   without a score, or `unmeasured` with one, is refused by the store and not
//!   only by the door in front of it.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_use_case_scenarios",
            description: "One condition a feature is applied to, judged separately",
            already_applied: |conn| has_table(conn, "dev_use_case_scenarios"),
            apply: |conn| {
                // `axes_json` is a JSON object of axis -> value
                // (`{"candidate_family":"marketing"}`). Stored as a document
                // because the axis vocabulary belongs to the project, not to
                // this schema: a column per axis would need a migration every
                // time a team names a new one.
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_use_case_scenarios (
                        id TEXT PRIMARY KEY NOT NULL,
                        use_case_id TEXT NOT NULL
                            REFERENCES dev_use_cases(id) ON DELETE CASCADE,
                        slug TEXT NOT NULL,
                        title TEXT NOT NULL,
                        axes_json TEXT NOT NULL,
                        scope TEXT NOT NULL CHECK (scope IN
                            ('proposed','must_hold','tracked','out_of_scope')),
                        source TEXT NOT NULL CHECK (source IN
                            ('operator','council','telemetry','incident')),
                        floor REAL CHECK (floor IS NULL OR (floor >= 0 AND floor <= 1)),
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        UNIQUE (use_case_id, slug)
                    );",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "dev_council_scenario_results",
            description: "What one council round found for one scenario",
            already_applied: |conn| has_table(conn, "dev_council_scenario_results"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_council_scenario_results (
                        id TEXT PRIMARY KEY NOT NULL,
                        run_id TEXT NOT NULL
                            REFERENCES dev_council_runs(id) ON DELETE CASCADE,
                        scenario_id TEXT NOT NULL
                            REFERENCES dev_use_case_scenarios(id) ON DELETE CASCADE,
                        state TEXT NOT NULL CHECK (state IN ('measured','unmeasured')),
                        score REAL,
                        confidence TEXT NOT NULL CHECK (confidence IN ('low','med','high')),
                        n INTEGER CHECK (n IS NULL OR n >= 0),
                        proof TEXT NOT NULL CHECK (proof IN
                            ('observed','replayed','simulated','claimed')),
                        floor_hit INTEGER NOT NULL,
                        advisory INTEGER NOT NULL,
                        summary TEXT NOT NULL,
                        CHECK (
                            (state = 'measured'
                                 AND score IS NOT NULL AND score >= 0 AND score <= 1)
                            OR (state = 'unmeasured' AND score IS NULL)
                        ),
                        UNIQUE (run_id, scenario_id)
                    );",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "dev_council_scenario_results.scenario_index",
            description: "Read one scenario's history without scanning every run",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_council_scenario_results")?
                    || has_index(conn, "idx_dev_council_scenario_results_scenario")?)
            },
            apply: |conn| {
                // The UNIQUE above indexes `(run_id, scenario_id)`, which
                // serves the board's "this run's results" read and is useless
                // for "this scenario, over time" - the other direction needs
                // its own index or it is a table scan.
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_dev_council_scenario_results_scenario
                     ON dev_council_scenario_results(scenario_id);",
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

    /// A project, a feature, a council subject, a run - the parents every
    /// scenario row hangs from.
    fn seed(conn: &Connection) {
        conn.execute(
            "INSERT INTO dev_projects (id, name, root_path, status, created_at, updated_at)
             VALUES ('p1','P','/tmp/p','active','2026-09-21T00:00:00Z','2026-09-21T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO dev_use_cases (id, project_id, name, slug, kind, status, created_by)
             VALUES ('u1','p1','Interview','interview','capability','active','scan')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO dev_council_subjects
                (id, project_id, kind, use_case_id, slug, title, drift, created_at, updated_at)
             VALUES ('s1','p1','use_case','u1','interview','Interview','unknown',
                     '2026-09-21T00:00:00Z','2026-09-21T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO dev_council_runs
                (id, subject_id, round_no, supersedes_run_id, rubric_version, trust_state,
                 outcome, overall, coverage, head_sha, span_digest, spanned_paths_json,
                 hard_failures_json, must_address_json, summary, run_dir, ingested_at)
             VALUES ('r1','s1',1,NULL,'feature-v1','uncalibrated','ready',0.8,1.0,'abc','dig',
                     '[]','[]','[]','ok','/runs/r1','2026-09-21T00:00:00Z')",
            [],
        )
        .unwrap();
    }

    fn add_scenario(conn: &Connection, id: &str, slug: &str, scope: &str) -> rusqlite::Result<()> {
        conn.execute(
            "INSERT INTO dev_use_case_scenarios
                (id, use_case_id, slug, title, axes_json, scope, source, floor,
                 created_at, updated_at)
             VALUES (?1,'u1',?2,'A scenario','{}',?3,'operator',NULL,
                     '2026-09-21T00:00:00Z','2026-09-21T00:00:00Z')",
            rusqlite::params![id, slug, scope],
        )
        .map(|_| ())
    }

    #[test]
    fn the_chain_creates_both_scenario_objects() {
        let conn = migrated_conn();
        assert!(has_table(&conn, "dev_use_case_scenarios").unwrap());
        assert!(has_table(&conn, "dev_council_scenario_results").unwrap());
        assert!(has_index(&conn, "idx_dev_council_scenario_results_scenario").unwrap());
    }

    #[test]
    fn a_second_pass_is_a_no_op() {
        let conn = migrated_conn();
        run(&conn).unwrap();
        run(&conn).unwrap();
        assert!(has_table(&conn, "dev_use_case_scenarios").unwrap());
    }

    #[test]
    fn the_closed_sets_are_database_facts() {
        let conn = migrated_conn();
        seed(&conn);
        add_scenario(&conn, "sc1", "marketing", "must_hold").unwrap();
        assert!(
            conn.execute(
                "UPDATE dev_use_case_scenarios SET scope = 'maybe' WHERE id = 'sc1'",
                []
            )
            .is_err(),
            "scope is a closed set"
        );
        assert!(
            conn.execute(
                "UPDATE dev_use_case_scenarios SET source = 'vibes' WHERE id = 'sc1'",
                []
            )
            .is_err(),
            "source is a closed set"
        );
        assert!(
            conn.execute(
                "UPDATE dev_use_case_scenarios SET floor = 1.5 WHERE id = 'sc1'",
                []
            )
            .is_err(),
            "a floor outside 0..1 is not storable"
        );
        assert!(
            add_scenario(&conn, "sc2", "marketing", "tracked").is_err(),
            "UNIQUE(use_case_id, slug)"
        );
    }

    /// The pair the absent-value convention turns on: a measured scenario
    /// carries a score and an unmeasured one does not, and NEITHER half is
    /// representable the wrong way round.
    #[test]
    fn a_result_cannot_lie_about_whether_it_measured_anything() {
        let conn = migrated_conn();
        seed(&conn);
        add_scenario(&conn, "sc1", "marketing", "must_hold").unwrap();

        let insert = |id: &str, state: &str, score: Option<f64>| {
            conn.execute(
                "INSERT INTO dev_council_scenario_results
                    (id, run_id, scenario_id, state, score, confidence, n, proof,
                     floor_hit, advisory, summary)
                 VALUES (?1,'r1','sc1',?2,?3,'med',3,'simulated',0,1,'s')",
                rusqlite::params![id, state, score],
            )
        };
        assert!(
            insert("x1", "measured", None).is_err(),
            "measured without a score"
        );
        assert!(
            insert("x2", "unmeasured", Some(0.4)).is_err(),
            "unmeasured with a score"
        );
        assert!(insert("x3", "measured", Some(0.4)).is_ok());
        assert!(
            insert("x4", "unmeasured", None).is_err(),
            "UNIQUE(run_id, scenario_id) - one result per scenario per run"
        );
    }

    /// Both parents CASCADE: deleting the feature takes its scenarios and
    /// therefore their results, and deleting a run takes its results alone.
    #[test]
    fn results_cascade_from_both_the_run_and_the_scenario() {
        let conn = migrated_conn();
        seed(&conn);
        add_scenario(&conn, "sc1", "marketing", "must_hold").unwrap();
        conn.execute(
            "INSERT INTO dev_council_scenario_results
                (id, run_id, scenario_id, state, score, confidence, n, proof,
                 floor_hit, advisory, summary)
             VALUES ('x1','r1','sc1','measured',0.4,'med',3,'simulated',1,1,'weak')",
            [],
        )
        .unwrap();

        let count = |conn: &Connection, table: &str| -> i64 {
            conn.query_row(&format!("SELECT COUNT(*) AS n FROM {table}"), [], |r| {
                r.get("n")
            })
            .unwrap()
        };

        conn.execute("DELETE FROM dev_council_runs WHERE id = 'r1'", [])
            .unwrap();
        assert_eq!(count(&conn, "dev_council_scenario_results"), 0);
        assert_eq!(
            count(&conn, "dev_use_case_scenarios"),
            1,
            "the scenario outlives the run that judged it"
        );

        conn.execute("DELETE FROM dev_use_cases WHERE id = 'u1'", [])
            .unwrap();
        assert_eq!(
            count(&conn, "dev_use_case_scenarios"),
            0,
            "scenarios cascade from the feature"
        );
    }
}
