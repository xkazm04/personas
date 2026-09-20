//! The council's verdict chain: subjects, runs, per-member verdicts and the
//! one human decision - plus the `tier` that decides which features reach it.
//!
//! Four tables and one column, each in its own `run_step` probing the object it
//! itself creates, so a crash between any two resumes rather than records a lie
//! (census `unresumable-migration-step` is the opposite shape: one probe
//! guarding several DDL transactions).
//!
//! Three properties are database facts here rather than conventions, because
//! every one of them has a writer that would otherwise be trusted to remember:
//!
//! - **Every closed set is a CHECK.** `kind`, `drift`, `outcome`,
//!   `trust_state`, `decision`, `state`, `confidence`, `tier`. The ingest door
//!   validates them first and names the field, but the store refuses a
//!   non-member whichever writer reaches it (census
//!   `unchecked-closed-set-default`).
//! - **Every foreign key states ON DELETE.** An omitted clause is `NO ACTION`
//!   on SQLite, which REFUSES the parent delete rather than leaving the child
//!   alone - the opposite of what an author who omitted it usually meant
//!   (census `undeclared-parent-fate`). The fates here are deliberate:
//!   subjects and their runs CASCADE from the project, a run's verdicts
//!   CASCADE from the run, a subject's `use_case_id` is SET NULL because the
//!   verdict chain outlives the feature row it judged, and a decision's
//!   `run_id` is RESTRICT because the run a person looked at must not be
//!   deleted out from under the decision that cites it.
//! - **No nullable-with-default column.** A DEFAULT fires only on an omitting
//!   INSERT; without NOT NULL it binds the writer and promises the reader
//!   nothing (census `nullable-default-column`).
//!
//! `overall REAL NULL` is the one deliberate nullable, and it carries no
//! DEFAULT: a weighted mean over zero measured dimensions is *unmeasured*, and
//! `0.0` is the one value it must never be confused with.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_council_subjects",
            description: "One thing a council judges: a major feature or an architecture redesign",
            already_applied: |conn| has_table(conn, "dev_council_subjects"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_council_subjects (
                        id TEXT PRIMARY KEY NOT NULL,
                        project_id TEXT NOT NULL
                            REFERENCES dev_projects(id) ON DELETE CASCADE,
                        kind TEXT NOT NULL CHECK (kind IN ('use_case','architecture')),
                        use_case_id TEXT
                            REFERENCES dev_use_cases(id) ON DELETE SET NULL,
                        slug TEXT NOT NULL,
                        title TEXT NOT NULL,
                        drift TEXT NOT NULL DEFAULT 'unknown'
                            CHECK (drift IN ('none','grown','changed','unknown')),
                        drift_checked_at TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        UNIQUE (project_id, kind, slug)
                    );",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "dev_council_runs",
            description: "One council round over one subject; rounds supersede, never rewrite",
            already_applied: |conn| has_table(conn, "dev_council_runs"),
            apply: |conn| {
                // `round_no` carries both its own CHECK and the UNIQUE that
                // makes "two round 2s" unrepresentable. The door additionally
                // refuses a round that is not prior + 1, which the store
                // cannot express - but the pair here is what stops a second
                // writer inventing a duplicate round behind the door's back.
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_council_runs (
                        id TEXT PRIMARY KEY NOT NULL,
                        subject_id TEXT NOT NULL
                            REFERENCES dev_council_subjects(id) ON DELETE CASCADE,
                        round_no INTEGER NOT NULL CHECK (round_no >= 1),
                        supersedes_run_id TEXT
                            REFERENCES dev_council_runs(id) ON DELETE SET NULL,
                        rubric_version TEXT NOT NULL
                            CHECK (rubric_version IN ('feature-v1','architecture-v1')),
                        trust_state TEXT NOT NULL
                            CHECK (trust_state IN ('uncalibrated','untrusted','trusted')),
                        outcome TEXT NOT NULL
                            CHECK (outcome IN ('ready','fail','incomplete','stalled')),
                        overall REAL,
                        coverage REAL NOT NULL,
                        head_sha TEXT NOT NULL,
                        span_digest TEXT NOT NULL,
                        spanned_paths_json TEXT NOT NULL,
                        hard_failures_json TEXT NOT NULL,
                        must_address_json TEXT NOT NULL,
                        summary TEXT NOT NULL,
                        run_dir TEXT NOT NULL,
                        started_at TEXT,
                        finished_at TEXT,
                        ingested_at TEXT NOT NULL,
                        UNIQUE (subject_id, round_no)
                    );",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "dev_council_runs.run_dir_index",
            description: "Find a run by the directory it came from, so an ingest is idempotent",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_council_runs")?
                    || has_index(conn, "idx_dev_council_runs_run_dir")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_council_runs_run_dir
                     ON dev_council_runs(run_dir);",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "dev_council_verdicts",
            description: "One member's verdict inside a run; one row per dimension",
            already_applied: |conn| has_table(conn, "dev_council_verdicts"),
            apply: |conn| {
                // `score REAL` is nullable and DEFAULT-less on purpose: an
                // unmeasured dimension has no score, and the absent-value
                // convention forbids spelling that `0`.
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_council_verdicts (
                        id TEXT PRIMARY KEY NOT NULL,
                        run_id TEXT NOT NULL
                            REFERENCES dev_council_runs(id) ON DELETE CASCADE,
                        dimension TEXT NOT NULL CHECK (dimension IN
                            ('value','craft','rivalry','robustness','economics','reversibility')),
                        kind TEXT NOT NULL CHECK (kind IN ('mechanical','judged','mixed')),
                        state TEXT NOT NULL CHECK (state IN
                            ('measured','unmeasured','not_applicable','carried')),
                        score REAL,
                        confidence TEXT NOT NULL CHECK (confidence IN ('low','med','high')),
                        floor REAL,
                        floor_hit INTEGER NOT NULL,
                        advisory INTEGER NOT NULL,
                        payload_json TEXT NOT NULL,
                        UNIQUE (run_id, dimension)
                    );",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "dev_council_decisions",
            description: "The one row a human writes; decisions supersede, never rewrite",
            already_applied: |conn| has_table(conn, "dev_council_decisions"),
            apply: |conn| {
                // `reason` is nullable because an approval needs none; the
                // decide command - the only writer - refuses a blank reason on
                // a rejection, which is an invariant SQLite cannot express
                // without a CHECK that would also forbid an approval's NULL.
                // Stated here so the next reader does not think it was
                // forgotten.
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS dev_council_decisions (
                        id TEXT PRIMARY KEY NOT NULL,
                        subject_id TEXT NOT NULL
                            REFERENCES dev_council_subjects(id) ON DELETE CASCADE,
                        run_id TEXT NOT NULL
                            REFERENCES dev_council_runs(id) ON DELETE RESTRICT,
                        decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
                        reason TEXT,
                        saw_digest TEXT NOT NULL,
                        supersedes_decision_id TEXT
                            REFERENCES dev_council_decisions(id) ON DELETE SET NULL,
                        decided_at TEXT NOT NULL
                    );",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "dev_council_decisions.subject_index",
            description: "Read a subject's standing decision without scanning the ledger",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_council_decisions")?
                    || has_index(conn, "idx_dev_council_decisions_subject")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_dev_council_decisions_subject
                     ON dev_council_decisions(subject_id, decided_at DESC);",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "dev_use_cases.tier",
            description: "Only a major feature reaches the council's human gate",
            // The TEST binary drops tables, so the ALTER is guarded on both the
            // table and the column: `has_column` on a table that does not exist
            // answers false, which would re-run the ALTER and fail the boot.
            already_applied: |conn| {
                Ok(
                    !has_table(conn, "dev_use_cases")?
                        || has_column(conn, "dev_use_cases", "tier")?,
                )
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_use_cases ADD COLUMN tier TEXT NOT NULL DEFAULT 'standard'
                     CHECK (tier IN ('major','standard'));",
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

    #[test]
    fn the_chain_creates_every_council_object() {
        let conn = migrated_conn();
        for t in [
            "dev_council_subjects",
            "dev_council_runs",
            "dev_council_verdicts",
            "dev_council_decisions",
        ] {
            assert!(has_table(&conn, t).unwrap(), "missing table {t}");
        }
        assert!(has_index(&conn, "idx_dev_council_runs_run_dir").unwrap());
        assert!(has_index(&conn, "idx_dev_council_decisions_subject").unwrap());
        assert!(has_column(&conn, "dev_use_cases", "tier").unwrap());
    }

    /// The step must be idempotent - `run_incremental` keeps no record of what
    /// has run and consults each step's own probe on every boot.
    #[test]
    fn a_second_pass_is_a_no_op() {
        let conn = migrated_conn();
        run(&conn).unwrap();
        run(&conn).unwrap();
        assert!(has_column(&conn, "dev_use_cases", "tier").unwrap());
    }

    fn seed_subject(conn: &Connection) -> String {
        conn.execute(
            "INSERT INTO dev_projects (id, name, root_path, status, created_at, updated_at)
             VALUES ('p1','P','/tmp/p','active','2026-09-20T00:00:00Z','2026-09-20T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO dev_council_subjects
                (id, project_id, kind, use_case_id, slug, title, drift, created_at, updated_at)
             VALUES ('s1','p1','use_case',NULL,'checkout','Checkout','unknown',
                     '2026-09-20T00:00:00Z','2026-09-20T00:00:00Z')",
            [],
        )
        .unwrap();
        "s1".to_string()
    }

    fn seed_run(conn: &Connection, id: &str, round: i64) {
        conn.execute(
            "INSERT INTO dev_council_runs
                (id, subject_id, round_no, supersedes_run_id, rubric_version, trust_state,
                 outcome, overall, coverage, head_sha, span_digest, spanned_paths_json,
                 hard_failures_json, must_address_json, summary, run_dir, ingested_at)
             VALUES (?1,'s1',?2,NULL,'feature-v1','uncalibrated','ready',0.8,1.0,'abc','dig',
                     '[]','[]','[]','ok',?3,'2026-09-20T00:00:00Z')",
            rusqlite::params![id, round, format!("/runs/{id}")],
        )
        .unwrap();
    }

    /// Every closed set refuses a non-member, and the store is what refuses it
    /// - not only the door in front of it.
    #[test]
    fn the_closed_sets_are_database_facts() {
        let conn = migrated_conn();
        seed_subject(&conn);
        assert!(
            conn.execute(
                "UPDATE dev_council_subjects SET drift = 'sideways' WHERE id = 's1'",
                []
            )
            .is_err(),
            "drift must refuse a non-member"
        );
        seed_run(&conn, "r1", 1);
        assert!(
            conn.execute(
                "UPDATE dev_council_runs SET outcome = 'approved' WHERE id = 'r1'",
                []
            )
            .is_err(),
            "a run may not carry a human's verdict as its outcome"
        );
        assert!(
            conn.execute(
                "UPDATE dev_council_runs SET round_no = 0 WHERE id = 'r1'",
                []
            )
            .is_err(),
            "round_no >= 1"
        );
        conn.execute(
            "INSERT INTO dev_council_verdicts
                (id, run_id, dimension, kind, state, score, confidence, floor,
                 floor_hit, advisory, payload_json)
             VALUES ('v1','r1','value','judged','measured',0.8,'med',0.4,0,1,'{}')",
            [],
        )
        .unwrap();
        assert!(
            conn.execute(
                "UPDATE dev_council_verdicts SET dimension = 'vibes' WHERE id = 'v1'",
                []
            )
            .is_err(),
            "a dimension outside the rubric vocabulary is not storable"
        );
        assert!(
            conn.execute(
                "INSERT INTO dev_council_verdicts
                    (id, run_id, dimension, kind, state, confidence, floor_hit, advisory, payload_json)
                 VALUES ('v2','r1','value','judged','unmeasured','low',0,1,'{}')",
                []
            )
            .is_err(),
            "one verdict per dimension per run"
        );
    }

    #[test]
    fn two_rounds_cannot_share_a_number() {
        let conn = migrated_conn();
        seed_subject(&conn);
        seed_run(&conn, "r1", 1);
        assert!(
            conn.execute(
                "INSERT INTO dev_council_runs
                    (id, subject_id, round_no, rubric_version, trust_state, outcome,
                     coverage, head_sha, span_digest, spanned_paths_json, hard_failures_json,
                     must_address_json, summary, run_dir, ingested_at)
                 VALUES ('r2','s1',1,'feature-v1','uncalibrated','fail',1.0,'abc','d',
                         '[]','[]','[]','x','/runs/r2','2026-09-20T00:00:00Z')",
                []
            )
            .is_err(),
            "UNIQUE(subject_id, round_no)"
        );
    }

    /// The two fates that are easy to get backwards: a decided run is PINNED
    /// (RESTRICT), and a subject's verdicts vanish with the subject (CASCADE).
    #[test]
    fn a_decided_run_cannot_be_deleted_and_a_subject_takes_its_runs_with_it() {
        let conn = migrated_conn();
        seed_subject(&conn);
        seed_run(&conn, "r1", 1);
        conn.execute(
            "INSERT INTO dev_council_decisions
                (id, subject_id, run_id, decision, reason, saw_digest, decided_at)
             VALUES ('d1','s1','r1','approved',NULL,'dig','2026-09-20T00:00:00Z')",
            [],
        )
        .unwrap();

        assert!(
            conn.execute("DELETE FROM dev_council_runs WHERE id = 'r1'", [])
                .is_err(),
            "a run a person decided on must not be deletable"
        );

        conn.execute("DELETE FROM dev_council_subjects WHERE id = 's1'", [])
            .unwrap();
        let runs: i64 = conn
            .query_row("SELECT COUNT(*) AS n FROM dev_council_runs", [], |r| {
                r.get("n")
            })
            .unwrap();
        let decisions: i64 = conn
            .query_row("SELECT COUNT(*) AS n FROM dev_council_decisions", [], |r| {
                r.get("n")
            })
            .unwrap();
        assert_eq!(runs, 0, "runs cascade from the subject");
        assert_eq!(decisions, 0, "decisions cascade from the subject");
    }

    /// The verdict chain OUTLIVES the feature row it judged - that is what
    /// `ON DELETE SET NULL` on `use_case_id` buys, and deleting a use case
    /// must not take the record of its council with it.
    #[test]
    fn deleting_the_feature_leaves_the_verdict_chain_standing() {
        let conn = migrated_conn();
        conn.execute(
            "INSERT INTO dev_projects (id, name, root_path, status, created_at, updated_at)
             VALUES ('p1','P','/tmp/p','active','2026-09-20T00:00:00Z','2026-09-20T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO dev_use_cases (id, project_id, name, slug, kind, status, created_by)
             VALUES ('u1','p1','Checkout','checkout','capability','active','scan')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO dev_council_subjects
                (id, project_id, kind, use_case_id, slug, title, drift, created_at, updated_at)
             VALUES ('s1','p1','use_case','u1','checkout','Checkout','unknown',
                     '2026-09-20T00:00:00Z','2026-09-20T00:00:00Z')",
            [],
        )
        .unwrap();

        conn.execute("DELETE FROM dev_use_cases WHERE id = 'u1'", [])
            .unwrap();
        let bound: Option<String> = conn
            .query_row(
                "SELECT use_case_id FROM dev_council_subjects WHERE id = 's1'",
                [],
                |r| r.get("use_case_id"),
            )
            .unwrap();
        assert_eq!(bound, None, "the subject survives, unbound");
    }

    /// The DEFAULT is what an existing row gets; the CHECK is what every later
    /// writer gets. Both, or the column is a suggestion.
    #[test]
    fn tier_defaults_to_standard_and_refuses_anything_else() {
        let conn = migrated_conn();
        conn.execute(
            "INSERT INTO dev_projects (id, name, root_path, status, created_at, updated_at)
             VALUES ('p1','P','/tmp/p','active','2026-09-20T00:00:00Z','2026-09-20T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO dev_use_cases (id, project_id, name, slug, kind, status, created_by)
             VALUES ('u1','p1','Checkout','checkout','capability','active','scan')",
            [],
        )
        .unwrap();
        let tier: String = conn
            .query_row("SELECT tier FROM dev_use_cases WHERE id = 'u1'", [], |r| {
                r.get("tier")
            })
            .unwrap();
        assert_eq!(tier, "standard");
        assert!(conn
            .execute(
                "UPDATE dev_use_cases SET tier = 'major' WHERE id = 'u1'",
                []
            )
            .is_ok());
        assert!(
            conn.execute(
                "UPDATE dev_use_cases SET tier = 'critical' WHERE id = 'u1'",
                []
            )
            .is_err(),
            "tier is a closed set"
        );
    }
}
