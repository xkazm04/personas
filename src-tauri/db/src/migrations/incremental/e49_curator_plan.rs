//! Curator's tables: her allowlist, her projections, her queue and her ledger.
//!
//! Five tables and one index, each in its own `run_step` probing the object it
//! itself creates, so a crash between any two resumes rather than records a lie
//! (census `unresumable-migration-step` is the opposite shape).
//!
//! The house properties `e43_council` and `e48_registry_link` established, all
//! three kept here:
//!
//! - **Every closed set is a CHECK.** `consent_state`, `engine`, `state`,
//!   `kind`, `level`, `status`. `personas_core::models::curator` spells each one
//!   a second time as an enum, which is what a door validates against BEFORE a
//!   write so a refusal names the field (census `unchecked-closed-set-default`).
//! - **Every foreign key states ON DELETE.** An omitted clause is `NO ACTION`
//!   on SQLite, which REFUSES the parent delete rather than leaving the child
//!   alone - the opposite of what an author who omitted it usually meant
//!   (census `undeclared-parent-fate`). The fates here are deliberate and each
//!   one is argued at its table.
//! - **No nullable-with-default column.** A DEFAULT fires only on an omitting
//!   INSERT; without NOT NULL it binds the writer and promises the reader
//!   nothing (census `nullable-default-column`).
//!
//! ## The nullables, and why each one is not a zero
//!
//! Every nullable here is a case of **an unknown that must not be readable as
//! an absence**, which is this package's governing rule:
//!
//! - `curator_project.granted_at` / `last_seen_at` - "has not happened".
//! - `curator_plan_run.registry_head_sha` - git could not answer. It is also
//!   the cache key, so a NULL here says the read was not cacheable.
//! - `curator_plan_item.demand_json` - NULL exactly when `demand_known = 0`.
//!   No consumer reports demand for this subject, so demand is UNKNOWN. A
//!   `{"deviations":0}` here would be the false claim the column exists to
//!   avoid.
//! - `curator_plan_item.last_swept` - no sweep is recorded. (The scan scores
//!   that as its own `never_swept` clause, so this is not silent.)
//! - `curator_plan_item.has_applied_row` - **nullable, where the design said
//!   NOT NULL.** The applied ledger is a file in the checkout. Absent is a real
//!   answer (`0`: a fresh registry has applied nothing); *unreadable* is not,
//!   and `0` would report "never applied" for a subject that may well have
//!   been. The two are distinguished at the read: only an IO error that is not
//!   `NotFound` produces NULL.
//! - `curator_plan_item.declined_reason` / `dispatched_run_id` /
//!   `evidence_ref` - nothing has been dispatched by this package at all.
//!
//! ## `registry_dry_streak` - stored, and deliberately not trusted
//!
//! The registry's own `dry_streak` is **unreachable by construction**. Measured
//! 2026-09-23: 349 of 349 subject notes carrying the field read `0`, no other
//! value exists anywhere in that tree, and exactly two call sites mention it -
//! the librarian's doctrine READS it (`>= 2` suppresses a saturated subject)
//! while reconcile WRITES it, but only as `0` at note creation. Nothing
//! increments it, so the predicate can never fire, and a consumer cannot tell
//! that apart from "no subject is saturated".
//!
//! So this column is named for its SOURCE rather than for its meaning, and `0`
//! in it means UNKNOWN. `suppressed_by_saturation` beside it is computed from
//! Curator's OWN recorded outcomes and never reads this column. Carrying both
//! is the point: the day the registry starts incrementing, the disagreement
//! between the two is the signal, and a column that was never carried could not
//! show it.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "curator_project",
            description: "Curator's allowlist: which checkouts she may look at, and what the \
                          operator said about each",
            already_applied: |conn| has_table(conn, "curator_project"),
            apply: |conn| {
                // `enabled` and `consent_state` are the OPERATOR'S and are
                // never written by her. Both default to the refusing value:
                // a row that appears because a checkout appeared on disk must
                // not arrive already permitted.
                //
                // `root_path` is UNIQUE because the directory is the identity -
                // two slugs resolving to one checkout would be two allowlist
                // entries for one security boundary.
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS curator_project (
                        slug TEXT PRIMARY KEY NOT NULL,
                        root_path TEXT NOT NULL UNIQUE,
                        enabled INTEGER NOT NULL DEFAULT 0,
                        consent_state TEXT NOT NULL DEFAULT 'never_asked'
                            CHECK (consent_state IN ('never_asked','granted','refused')),
                        granted_at TEXT,
                        last_seen_at TEXT,
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
            id: "curator_plan_run",
            description: "One projection of the registry's instrument; a new one supersedes \
                          rather than mutates",
            already_applied: |conn| has_table(conn, "curator_plan_run"),
            apply: |conn| {
                // `superseded_by` is SET NULL rather than CASCADE: deleting the
                // newer run must not take the older one with it. The chain is
                // "what replaced me", and losing the replacement leaves a run
                // that is simply current again.
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS curator_plan_run (
                        id TEXT PRIMARY KEY NOT NULL,
                        created_at TEXT NOT NULL,
                        scan_generated_at TEXT NOT NULL,
                        registry_head_sha TEXT,
                        corpus_json TEXT NOT NULL,
                        consumers_json TEXT NOT NULL,
                        policy_json TEXT NOT NULL,
                        item_count INTEGER NOT NULL CHECK (item_count >= 0),
                        superseded_by TEXT
                            REFERENCES curator_plan_run(id) ON DELETE SET NULL
                    );",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "curator_plan_item",
            description: "One subject the projection would act on, with the clause that decides \
                          which engine answers it",
            already_applied: |conn| has_table(conn, "curator_plan_item"),
            apply: |conn| {
                // CASCADE from the run: an item has no meaning apart from the
                // projection it belongs to, and a superseded run keeps its own
                // items so the plan a person saw can be re-read whole.
                //
                // `stacks_json` is NOT NULL DEFAULT '[]' for e48's reason: an
                // empty inventory is `[]`, never absent.
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS curator_plan_item (
                        id TEXT PRIMARY KEY NOT NULL,
                        plan_run_id TEXT NOT NULL
                            REFERENCES curator_plan_run(id) ON DELETE CASCADE,
                        subject_id TEXT NOT NULL,
                        domain TEXT NOT NULL,
                        at TEXT NOT NULL,
                        points INTEGER NOT NULL CHECK (points >= 0),
                        reasons_json TEXT NOT NULL,
                        dominant_reason TEXT NOT NULL
                            CHECK (dominant_reason IN ('citation_gone','no_application',
                                'expired_application','deviation','thin_techniques',
                                'never_swept','missing_use_when','single_stack',
                                'at_risk_application','none')),
                        engine TEXT NOT NULL
                            CHECK (engine IN ('conform','deepen','apply','reconcile','intake',
                                'forge','none')),
                        techniques INTEGER NOT NULL CHECK (techniques >= 0),
                        applications INTEGER NOT NULL CHECK (applications >= 0),
                        stacks_json TEXT NOT NULL DEFAULT '[]',
                        demand_known INTEGER NOT NULL,
                        demand_json TEXT,
                        last_swept TEXT,
                        registry_dry_streak INTEGER NOT NULL DEFAULT 0
                            CHECK (registry_dry_streak >= 0),
                        suppressed_by_saturation INTEGER NOT NULL DEFAULT 0,
                        has_applied_row INTEGER,
                        state TEXT NOT NULL DEFAULT 'planned'
                            CHECK (state IN ('planned','dispatched','landed','declined','idled',
                                'blocked')),
                        declined_reason TEXT,
                        dispatched_run_id TEXT,
                        evidence_ref TEXT,
                        updated_at TEXT NOT NULL,
                        UNIQUE (plan_run_id, subject_id)
                    );",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "curator_plan_item.rank_index",
            description: "Read a plan's head without sorting the whole projection",
            already_applied: |conn| {
                Ok(!has_table(conn, "curator_plan_item")?
                    || has_index(conn, "idx_curator_plan_item_rank")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_curator_plan_item_rank
                     ON curator_plan_item(plan_run_id, points DESC);",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "curator_plan_item.subject_index",
            description: "Walk one subject's outcomes back through the plan runs - the \
                          saturation measurement",
            already_applied: |conn| {
                Ok(!has_table(conn, "curator_plan_item")?
                    || has_index(conn, "idx_curator_plan_item_subject")?)
            },
            apply: |conn| {
                // The saturation walk reads one subject across every plan run,
                // newest first. Without this it is a full scan of the whole
                // projection history per subject, once per projection.
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_curator_plan_item_subject
                     ON curator_plan_item(subject_id, plan_run_id);",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "curator_decision",
            description: "The one row a person answers; decisions supersede, never rewrite",
            already_applied: |conn| has_table(conn, "curator_decision"),
            apply: |conn| {
                // `plan_run_id` is RESTRICT, and it is the reason this table is
                // shaped on `dev_council_decisions`: the plan a person looked at
                // must not be deleted out from under the decision that cites it.
                // `plan_item_id` is SET NULL beside it because the ITEM is a
                // convenience pointer - the question survives the item being
                // re-projected, and the run it was asked against is what makes
                // the answer readable later.
                //
                // `decision_reason` is nullable for the council's reason: an
                // approval needs none, and a CHECK that forced one on a decline
                // would also forbid the approval's NULL. The door that answers a
                // decision is where a blank decline is refused.
                //
                // The nine `kind` members are the design's own vocabulary
                // (`.contest/staging/curator-blueprint`, the artifact this
                // schema was drawn from). There is no writer yet, so treat the
                // set as a claim the loop package must honour OR widen in its
                // own migration - not as something to squeeze a tenth meaning
                // into.
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS curator_decision (
                        id TEXT PRIMARY KEY NOT NULL,
                        kind TEXT NOT NULL
                            CHECK (kind IN ('subject_delta','subject_proposal',
                                'direction_proposal','coverage_delta','coverage_gap',
                                'stale_verdicts','first_commit_consent','handoff',
                                'decline_ratified')),
                        subject_id TEXT,
                        project_slug TEXT,
                        plan_item_id TEXT
                            REFERENCES curator_plan_item(id) ON DELETE SET NULL,
                        plan_run_id TEXT NOT NULL
                            REFERENCES curator_plan_run(id) ON DELETE RESTRICT,
                        title TEXT NOT NULL,
                        body_json TEXT NOT NULL,
                        level TEXT NOT NULL CHECK (level IN ('L0','L1','L2','L3')),
                        status TEXT NOT NULL DEFAULT 'awaiting'
                            CHECK (status IN ('awaiting','auto_approved','approved','declined',
                                'superseded')),
                        answered_by TEXT,
                        decided_at TEXT,
                        decision_reason TEXT,
                        saw_digest TEXT NOT NULL,
                        supersedes_decision_id TEXT
                            REFERENCES curator_decision(id) ON DELETE SET NULL,
                        created_at TEXT NOT NULL
                    );",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "curator_decision.queue_index",
            description: "Read what is awaiting an answer without scanning the ledger",
            already_applied: |conn| {
                Ok(!has_table(conn, "curator_decision")?
                    || has_index(conn, "idx_curator_decision_queue")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_curator_decision_queue
                     ON curator_decision(status, created_at DESC);",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "curator_commit",
            description: "Her audit ledger: nothing may write a commit into a repository \
                          without a row here",
            already_applied: |conn| has_table(conn, "curator_commit"),
            apply: |conn| {
                // `decision_id` is SET NULL: the commit OUTLIVES the question
                // that authorised it, and an audit row that vanished with its
                // decision would be the one record an audit needs most.
                //
                // `level_that_authorised` is recorded here rather than read
                // from the policy at audit time, because a later policy change
                // must not be able to re-authorise a commit retroactively.
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS curator_commit (
                        id TEXT PRIMARY KEY NOT NULL,
                        project_slug TEXT NOT NULL,
                        repo_path TEXT NOT NULL,
                        branch TEXT NOT NULL,
                        sha TEXT NOT NULL,
                        files_json TEXT NOT NULL,
                        decision_id TEXT
                            REFERENCES curator_decision(id) ON DELETE SET NULL,
                        level_that_authorised TEXT NOT NULL
                            CHECK (level_that_authorised IN ('L0','L1','L2','L3')),
                        run_id TEXT,
                        created_at TEXT NOT NULL
                    );",
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

    fn seed_run(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO curator_plan_run
                (id, created_at, scan_generated_at, registry_head_sha, corpus_json,
                 consumers_json, policy_json, item_count)
             VALUES (?1, '2026-09-23T00:00:00Z', '2026-09-22T22:39:52Z', 'abc1234',
                     '{}', '{}', '{}', 0)",
            rusqlite::params![id],
        )
        .unwrap();
    }

    fn seed_item(conn: &Connection, id: &str, run_id: &str) {
        conn.execute(
            "INSERT INTO curator_plan_item
                (id, plan_run_id, subject_id, domain, at, points, reasons_json,
                 dominant_reason, engine, techniques, applications, demand_known,
                 updated_at)
             VALUES (?1, ?2, 'software-engineering/table', 'software-engineering',
                     'ui-surfaces/data-display/table', 6, '[]', 'no_application', 'apply',
                     4, 0, 0, '2026-09-23T00:00:00Z')",
            rusqlite::params![id, run_id],
        )
        .unwrap();
    }

    #[test]
    fn the_chain_creates_every_curator_object() {
        let conn = migrated_conn();
        for table in [
            "curator_project",
            "curator_plan_run",
            "curator_plan_item",
            "curator_decision",
            "curator_commit",
        ] {
            assert!(has_table(&conn, table).unwrap(), "missing table {table}");
        }
        for index in [
            "idx_curator_plan_item_rank",
            "idx_curator_plan_item_subject",
            "idx_curator_decision_queue",
        ] {
            assert!(has_index(&conn, index).unwrap(), "missing index {index}");
        }
    }

    /// Re-running the whole chain must be a no-op. The boot path runs it on
    /// every start, so a step that is not idempotent fails the second launch,
    /// not the first.
    #[test]
    fn the_chain_is_idempotent() {
        let conn = migrated_conn();
        crate::migrations::run_incremental(&conn).unwrap();
        crate::migrations::run_incremental(&conn).unwrap();
        assert!(has_table(&conn, "curator_commit").unwrap());
    }

    /// The allowlist arrives refusing. A row that appeared because a checkout
    /// appeared on disk must not already be permitted.
    #[test]
    fn a_new_allowlist_row_is_off_and_never_asked() {
        let conn = migrated_conn();
        conn.execute(
            "INSERT INTO curator_project (slug, root_path, created_at, updated_at)
             VALUES ('personas', 'C:/checkouts/personas', '2026-09-23T00:00:00Z',
                     '2026-09-23T00:00:00Z')",
            [],
        )
        .unwrap();
        let (enabled, consent): (i64, String) = conn
            .query_row(
                "SELECT enabled, consent_state FROM curator_project WHERE slug = 'personas'",
                [],
                |r| Ok((r.get("enabled")?, r.get("consent_state")?)),
            )
            .unwrap();
        assert_eq!(enabled, 0);
        assert_eq!(consent, "never_asked");

        // And the closed set is the store's, not only the door's.
        assert!(conn
            .execute(
                "UPDATE curator_project SET consent_state = 'maybe' WHERE slug = 'personas'",
                [],
            )
            .is_err());
    }

    /// Two slugs resolving to one directory would be two allowlist entries for
    /// one security boundary.
    #[test]
    fn one_checkout_cannot_be_allowlisted_twice() {
        let conn = migrated_conn();
        conn.execute(
            "INSERT INTO curator_project (slug, root_path, created_at, updated_at)
             VALUES ('a', 'C:/one', '2026-09-23T00:00:00Z', '2026-09-23T00:00:00Z')",
            [],
        )
        .unwrap();
        assert!(conn
            .execute(
                "INSERT INTO curator_project (slug, root_path, created_at, updated_at)
                 VALUES ('b', 'C:/one', '2026-09-23T00:00:00Z', '2026-09-23T00:00:00Z')",
                [],
            )
            .is_err());
    }

    /// The plan a person looked at must not be deleted out from under the
    /// decision that cites it.
    #[test]
    fn a_cited_plan_run_cannot_be_deleted() {
        let conn = migrated_conn();
        seed_run(&conn, "run-1");
        seed_item(&conn, "item-1", "run-1");
        conn.execute(
            "INSERT INTO curator_decision
                (id, kind, plan_item_id, plan_run_id, title, body_json, level, saw_digest,
                 created_at)
             VALUES ('dec-1', 'subject_delta', 'item-1', 'run-1', 'table deepened', '{}',
                     'L1', 'sha-of-what-they-saw', '2026-09-23T00:00:00Z')",
            [],
        )
        .unwrap();

        assert!(
            conn.execute("DELETE FROM curator_plan_run WHERE id = 'run-1'", [])
                .is_err(),
            "RESTRICT must refuse the delete"
        );

        // The ITEM, by contrast, is a convenience pointer: deleting it leaves
        // the question readable against the run it was asked from.
        conn.execute("DELETE FROM curator_plan_item WHERE id = 'item-1'", [])
            .unwrap();
        let (item, run): (Option<String>, String) = conn
            .query_row(
                "SELECT plan_item_id, plan_run_id FROM curator_decision WHERE id = 'dec-1'",
                [],
                |r| Ok((r.get("plan_item_id")?, r.get("plan_run_id")?)),
            )
            .unwrap();
        assert_eq!(item, None);
        assert_eq!(run, "run-1");
    }

    /// An item has no meaning apart from its projection.
    #[test]
    fn items_cascade_from_their_run() {
        let conn = migrated_conn();
        seed_run(&conn, "run-1");
        seed_item(&conn, "item-1", "run-1");
        conn.execute("DELETE FROM curator_plan_run WHERE id = 'run-1'", [])
            .unwrap();
        let left: i64 = conn
            .query_row(
                "SELECT COUNT(*) AS items_left FROM curator_plan_item",
                [],
                |r| r.get("items_left"),
            )
            .unwrap();
        assert_eq!(left, 0);
    }

    /// The audit ledger outlives the question that authorised it - the one
    /// record an audit needs most must not vanish with its decision.
    #[test]
    fn a_commit_row_survives_its_decision() {
        let conn = migrated_conn();
        seed_run(&conn, "run-1");
        conn.execute(
            "INSERT INTO curator_decision
                (id, kind, plan_run_id, title, body_json, level, saw_digest, created_at)
             VALUES ('dec-1', 'first_commit_consent', 'run-1', 'may I commit', '{}', 'L0',
                     'digest', '2026-09-23T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO curator_commit
                (id, project_slug, repo_path, branch, sha, files_json, decision_id,
                 level_that_authorised, created_at)
             VALUES ('c-1', 'ascent', 'C:/ascent', 'main', 'deadbee', '[]', 'dec-1', 'L0',
                     '2026-09-23T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM curator_decision WHERE id = 'dec-1'", [])
            .unwrap();
        let (count, decision): (i64, Option<String>) = conn
            .query_row(
                "SELECT COUNT(*) AS rows_left, MAX(decision_id) AS decision
                 FROM curator_commit",
                [],
                |r| Ok((r.get("rows_left")?, r.get("decision")?)),
            )
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(decision, None);
    }

    /// `has_applied_row` is nullable because unreadable is not the same answer
    /// as never-applied, and `demand_json` is nullable for the same reason.
    /// Both must accept NULL and both must round-trip it.
    #[test]
    fn an_unknown_stores_as_null_rather_than_zero() {
        let conn = migrated_conn();
        seed_run(&conn, "run-1");
        seed_item(&conn, "item-1", "run-1");
        let (applied, demand, swept): (Option<i64>, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT has_applied_row, demand_json, last_swept FROM curator_plan_item
                 WHERE id = 'item-1'",
                [],
                |r| {
                    Ok((
                        r.get("has_applied_row")?,
                        r.get("demand_json")?,
                        r.get("last_swept")?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(applied, None);
        assert_eq!(demand, None);
        assert_eq!(swept, None);

        // And a REAL false is storable and distinct from the NULL above.
        conn.execute(
            "UPDATE curator_plan_item SET has_applied_row = 0 WHERE id = 'item-1'",
            [],
        )
        .unwrap();
        let applied: Option<i64> = conn
            .query_row(
                "SELECT has_applied_row FROM curator_plan_item WHERE id = 'item-1'",
                [],
                |r| r.get("has_applied_row"),
            )
            .unwrap();
        assert_eq!(applied, Some(0));
    }

    /// Every closed set refuses a non-member at the STORE, whichever writer
    /// reaches it.
    #[test]
    fn the_store_refuses_a_non_member_of_every_closed_set() {
        let conn = migrated_conn();
        seed_run(&conn, "run-1");
        seed_item(&conn, "item-1", "run-1");
        for (column, bad) in [
            ("dominant_reason", "vibes"),
            ("engine", "compile"),
            ("state", "pondering"),
        ] {
            assert!(
                conn.execute(
                    &format!("UPDATE curator_plan_item SET {column} = ?1 WHERE id = 'item-1'"),
                    rusqlite::params![bad],
                )
                .is_err(),
                "{column} must refuse {bad}"
            );
        }
        assert!(conn
            .execute(
                "INSERT INTO curator_decision
                    (id, kind, plan_run_id, title, body_json, level, saw_digest, created_at)
                 VALUES ('d', 'gossip', 'run-1', 't', '{}', 'L1', 'x', '2026-09-23T00:00:00Z')",
                [],
            )
            .is_err());
        assert!(conn
            .execute(
                "INSERT INTO curator_decision
                    (id, kind, plan_run_id, title, body_json, level, saw_digest, created_at)
                 VALUES ('d', 'handoff', 'run-1', 't', '{}', 'L9', 'x', '2026-09-23T00:00:00Z')",
                [],
            )
            .is_err());
    }

    /// Superseding is a pointer on the OLD run, and deleting the newer one
    /// leaves the older simply current again rather than taking it along.
    #[test]
    fn superseding_points_forward_and_does_not_cascade() {
        let conn = migrated_conn();
        seed_run(&conn, "run-1");
        seed_run(&conn, "run-2");
        conn.execute(
            "UPDATE curator_plan_run SET superseded_by = 'run-2' WHERE id = 'run-1'",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM curator_plan_run WHERE id = 'run-2'", [])
            .unwrap();
        let (count, superseded): (i64, Option<String>) = conn
            .query_row(
                "SELECT COUNT(*) AS rows_left, MAX(superseded_by) AS superseded
                 FROM curator_plan_run",
                [],
                |r| Ok((r.get("rows_left")?, r.get("superseded")?)),
            )
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(superseded, None);
    }
}
