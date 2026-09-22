//! The backlog contract: a plan on the item, a source on every row, and the
//! two terminal states whose absence let finished work pile up forever.
//!
//! Measured on the operator's live database 2026-09-21, which is what each
//! step below repairs:
//!
//! - **2,093 ideas, 14 producers, no shared door.** `origin` — the column that
//!   already had a closed allowlist and a validator — was NULL on **96%** of
//!   rows, because the two doors carrying the traffic have no parameter for
//!   it. `scan_type` had become the de-facto source vocabulary by accident,
//!   as free text. Step `dev_ideas.origin_backfill` gives every row its source
//!   from the `scan_type` it already carried.
//! - **518 accepted ideas had a COMPLETED task and were still `accepted`.**
//!   The write-back's own comment states it plainly: "`delivered` deliberately
//!   leaves the idea `accepted` … `dev_ideas` has no `implemented` status to
//!   move to". So the queue had no exit, and every count, badge and attention
//!   sensor read finished work as outstanding. Step `dev_ideas.delivered_backfill`
//!   closes them against the evidence that already exists — a terminal task row.
//! - **No item carried an execution plan.** ~8% of the largest producer's
//!   descriptions contained so much as a numbered list, and the worker's prompt
//!   pasted the item under a heading named `## Background` before asking the
//!   worker to do the planning itself. `plan` is where the analysing model
//!   leaves the plan for the executing one.
//!
//! Shape rules this file obeys, each one a census rule with teeth:
//!
//! - **One `run_step` per object, probing the object it itself creates**
//!   (`unresumable-migration-step`). The two backfills probe their own
//!   POSTCONDITION — "no row still needs this" — so a crash mid-UPDATE resumes
//!   instead of recording a lie, and a re-run is a no-op rather than a second
//!   pass over rows a human has since changed.
//! - **No nullable-with-default column** (`nullable-default-column`). A DEFAULT
//!   fires only on an omitting INSERT; without NOT NULL it binds the writer and
//!   promises the reader nothing. `escalated` is the only column here with a
//!   default and it is NOT NULL; every other addition is a genuine nullable
//!   carrying no default at all.
//! - **No default on a backfilled column** (`default-contradicted-by-backfill`).
//!   `completeness` is a closed set, so a string DEFAULT with no CHECK would
//!   also trip `unchecked-closed-set-default` — SQLite cannot ALTER-ADD a CHECK,
//!   so the closed set is enforced by `IdeaCompleteness` at the one door
//!   instead, and the column is left honestly empty for anything the backfill
//!   cannot decide.
//!
//! `status` deliberately gains no CHECK either. The column never had one, the
//! vocabulary is enforced by `IdeaStatus` at `decide_idea_cas`, and rebuilding
//! a 2,000-row table that eight subsystems read — to add a constraint the door
//! already guarantees — is a destructive change bought for nothing.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    // --- the plan the analysing model leaves for the executing one ----------
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_ideas.plan",
            description: "Add plan to dev_ideas (JSON array of numbered execution steps)",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_ideas")? || has_column(conn, "dev_ideas", "plan")?)
            },
            apply: |conn| ddl_step(conn, "ALTER TABLE dev_ideas ADD COLUMN plan TEXT;"),
        },
    )?;

    // --- whether the item carries everything a dispatch needs --------------
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_ideas.completeness",
            description: "Add completeness to dev_ideas (full | draft; draft is not dispatchable)",
            already_applied: |conn| {
                Ok(
                    !has_table(conn, "dev_ideas")?
                        || has_column(conn, "dev_ideas", "completeness")?,
                )
            },
            apply: |conn| ddl_step(conn, "ALTER TABLE dev_ideas ADD COLUMN completeness TEXT;"),
        },
    )?;

    // --- the sweep's grouping, carried on the item so the rail can report it -
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_ideas.wave_id",
            description:
                "Add wave_id to dev_ideas (the collision-free group this item executes in)",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_ideas")? || has_column(conn, "dev_ideas", "wave_id")?)
            },
            apply: |conn| ddl_step(conn, "ALTER TABLE dev_ideas ADD COLUMN wave_id TEXT;"),
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "dev_ideas.sweep_run_id",
            description: "Add sweep_run_id to dev_ideas (which review pass last judged this item)",
            already_applied: |conn| {
                Ok(
                    !has_table(conn, "dev_ideas")?
                        || has_column(conn, "dev_ideas", "sweep_run_id")?,
                )
            },
            apply: |conn| ddl_step(conn, "ALTER TABLE dev_ideas ADD COLUMN sweep_run_id TEXT;"),
        },
    )?;

    // --- who judged it. `provider`/`model` record who FILED it; this records
    //     who REVIEWED it, and the two are different models by design.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_ideas.reviewed_by_model",
            description:
                "Add reviewed_by_model to dev_ideas (the model that passed the sweep verdict)",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_ideas")?
                    || has_column(conn, "dev_ideas", "reviewed_by_model")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_ideas ADD COLUMN reviewed_by_model TEXT;",
                )
            },
        },
    )?;

    // --- did the cheap executor need help? The instrument that tells us
    //     whether the plans are good enough for the tier they were written for.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_ideas.escalated",
            description:
                "Add escalated to dev_ideas (the cheap executor failed and a stronger one retried)",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_ideas")? || has_column(conn, "dev_ideas", "escalated")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE dev_ideas ADD COLUMN escalated INTEGER NOT NULL DEFAULT 0;",
                )
            },
        },
    )?;

    // --- give every existing row its source --------------------------------
    //
    // `origin` is promoted to THE source vocabulary. Every row already carried
    // its producer in `scan_type`; it simply never reached the column with the
    // allowlist, because `insert_idea` has no parameter for it. The mapping is
    // `BacklogSource::from_token`, which accepts the historical `scan_type`
    // spellings — including the hyphenated `app-master` and every Idea-Scanner
    // lens, all of which collapse to `idea_scanner`.
    //
    // Written as SQL rather than a Rust loop so it is one statement over ~2,000
    // rows; the lens list is spelled out because it is a CLOSED set read from
    // `scan_agents.toml`, not a pattern.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_ideas.origin_backfill",
            description:
                "Backfill dev_ideas.origin from scan_type (origin was NULL on ~96% of rows)",
            already_applied: |conn| {
                if !has_table(conn, "dev_ideas")? || !has_column(conn, "dev_ideas", "origin")? {
                    return Ok(true);
                }
                // The POSTCONDITION, not a marker: no row is still missing a
                // source it could have been given. Re-running is a no-op.
                let remaining: i64 = conn.query_row(
                    "SELECT COUNT(*) AS n FROM dev_ideas
                      WHERE origin IS NULL AND scan_type IS NOT NULL AND scan_type <> ''",
                    [],
                    |r| r.get("n"),
                )?;
                Ok(remaining == 0)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "UPDATE dev_ideas
                        SET origin = CASE scan_type
                            WHEN 'app-master'            THEN 'app_master'
                            WHEN 'app_master'            THEN 'app_master'
                            WHEN 'team_proposed'         THEN 'team_proposed'
                            WHEN 'platform_escalation'   THEN 'platform_escalation'
                            WHEN 'headless_bench_seed'   THEN 'headless_bench_seed'
                            WHEN 'memory_reflection'     THEN 'memory_reflection'
                            WHEN 'cross-impact'          THEN 'manual'
                            WHEN 'architecture-analyst'  THEN 'idea_scanner'
                            WHEN 'security-auditor'      THEN 'idea_scanner'
                            WHEN 'accessibility-checker' THEN 'idea_scanner'
                            WHEN 'business-strategist'   THEN 'idea_scanner'
                            WHEN 'onboarding-designer'   THEN 'idea_scanner'
                            WHEN 'error-handler'         THEN 'idea_scanner'
                            WHEN 'test-strategist'       THEN 'idea_scanner'
                            WHEN 'ux-reviewer'           THEN 'idea_scanner'
                            ELSE CASE
                                WHEN scan_type LIKE 'static:%' THEN 'static_scan'
                                ELSE 'manual'
                            END
                        END
                      WHERE origin IS NULL AND scan_type IS NOT NULL AND scan_type <> '';",
                )
            },
        },
    )?;

    // --- close the work that is already done -------------------------------
    //
    // An accepted idea whose task reached `completed` IS delivered; the app
    // simply had nowhere to say so. The evidence is the terminal task row, not
    // anybody's report — the same signal the write-back door will use from now
    // on. `already_delivered` outcomes land on `completed` too, deliberately,
    // because the work exists either way.
    //
    // A `failed` or `cancelled` task is NOT evidence of delivery and is left
    // alone: those ideas stay `accepted`, which is now a state a reaper can
    // reach rather than a permanent resting place.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_ideas.delivered_backfill",
            description:
                "Close accepted ideas whose task already completed (518 rows measured 2026-09-21)",
            already_applied: |conn| {
                if !has_table(conn, "dev_ideas")? || !has_table(conn, "dev_tasks")? {
                    return Ok(true);
                }
                let remaining: i64 = conn.query_row(
                    "SELECT COUNT(*) AS n FROM dev_ideas i
                      WHERE i.status = 'accepted'
                        AND EXISTS (SELECT 1 FROM dev_tasks t
                                     WHERE t.source_idea_id = i.id AND t.status = 'completed')",
                    [],
                    |r| r.get("n"),
                )?;
                Ok(remaining == 0)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "UPDATE dev_ideas
                        SET status = 'delivered',
                            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
                      WHERE status = 'accepted'
                        AND EXISTS (SELECT 1 FROM dev_tasks t
                                     WHERE t.source_idea_id = dev_ideas.id
                                       AND t.status = 'completed');",
                )
            },
        },
    )?;

    // --- grade what is already here ----------------------------------------
    //
    // Only the two ends are decidable from stored data: an item with all three
    // scales, a description AND a plan is `full`; an item that cannot have a
    // plan yet is `draft`. Since no row has a plan on the day this runs, every
    // existing row grades `draft` — which is correct and is the point. The
    // column stays empty for nothing, so a NULL later means "filed before this
    // contract and never regraded", which is a question worth being able to ask.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_ideas.completeness_backfill",
            description:
                "Grade existing ideas full|draft (no row carries a plan yet, so all grade draft)",
            already_applied: |conn| {
                if !has_table(conn, "dev_ideas")? || !has_column(conn, "dev_ideas", "completeness")?
                {
                    return Ok(true);
                }
                let remaining: i64 = conn.query_row(
                    "SELECT COUNT(*) AS n FROM dev_ideas WHERE completeness IS NULL",
                    [],
                    |r| r.get("n"),
                )?;
                Ok(remaining == 0)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "UPDATE dev_ideas
                        SET completeness = CASE
                            WHEN effort IS NOT NULL AND impact IS NOT NULL AND risk IS NOT NULL
                             AND description IS NOT NULL AND TRIM(description) <> ''
                             AND plan IS NOT NULL AND TRIM(plan) <> ''
                            THEN 'full' ELSE 'draft' END
                      WHERE completeness IS NULL;",
                )
            },
        },
    )?;

    // --- the sensor reads `status` on every wake; it now has two more values
    //     to skip past, and the pile it scans is about to shrink by a third.
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_ideas.idx_status_wave",
            description:
                "Index dev_ideas(status, wave_id) for the dispatch feed and the sweep board",
            already_applied: |conn| {
                Ok(!has_table(conn, "dev_ideas")? || has_index(conn, "idx_dev_ideas_status_wave")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_dev_ideas_status_wave
                       ON dev_ideas(status, wave_id);",
                )
            },
        },
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A database shaped like the live one: the whole chain has already run, so
    /// the columns exist and only the backfills have anything left to do.
    fn migrated_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::migrations::run(&conn).unwrap();
        crate::migrations::run_incremental(&conn).unwrap();
        conn
    }

    fn idea(conn: &Connection, id: &str, scan_type: &str, status: &str) {
        conn.execute(
            "INSERT INTO dev_ideas (id, project_id, scan_type, category, title, description,
                                    status, effort, impact, risk, created_at, updated_at)
             VALUES (?1, NULL, ?2, 'technical', ?1, 'a description', ?3, 2, 3, 2,
                     '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
            rusqlite::params![id, scan_type, status],
        )
        .unwrap();
    }

    fn task(conn: &Connection, id: &str, idea_id: &str, status: &str) {
        conn.execute(
            "INSERT INTO dev_tasks (id, project_id, title, source_idea_id, status, created_at)
             VALUES (?1, NULL, ?1, ?2, ?3, '2026-09-02T00:00:00Z')",
            rusqlite::params![id, idea_id, status],
        )
        .unwrap();
    }

    fn origin_of(conn: &Connection, id: &str) -> Option<String> {
        conn.query_row(
            "SELECT origin FROM dev_ideas WHERE id = ?1",
            rusqlite::params![id],
            |r| r.get("origin"),
        )
        .unwrap()
    }

    fn status_of(conn: &Connection, id: &str) -> String {
        conn.query_row(
            "SELECT status FROM dev_ideas WHERE id = ?1",
            rusqlite::params![id],
            |r| r.get("status"),
        )
        .unwrap()
    }

    #[test]
    fn the_chain_adds_every_column_and_the_index() {
        let conn = migrated_conn();
        for column in [
            "plan",
            "completeness",
            "wave_id",
            "sweep_run_id",
            "reviewed_by_model",
            "escalated",
        ] {
            assert!(
                has_column(&conn, "dev_ideas", column).unwrap(),
                "dev_ideas.{column} missing after the chain"
            );
        }
        assert!(has_index(&conn, "idx_dev_ideas_status_wave").unwrap());
    }

    /// The live table's own `scan_type` vocabulary, mapped to the one source
    /// vocabulary. The hyphenated spelling and the eight Idea-Scanner lenses are
    /// the two cases a naive `origin = scan_type` would get wrong.
    #[test]
    fn the_origin_backfill_maps_every_live_scan_type() {
        let conn = migrated_conn();
        idea(&conn, "i-am", "app-master", "pending");
        idea(&conn, "i-team", "team_proposed", "pending");
        idea(&conn, "i-plat", "platform_escalation", "pending");
        idea(&conn, "i-lens", "architecture-analyst", "pending");
        idea(&conn, "i-lens2", "ux-reviewer", "pending");
        idea(&conn, "i-bench", "headless_bench_seed", "pending");
        idea(&conn, "i-static", "static:knip", "pending");
        idea(&conn, "i-odd", "something-nobody-declared", "pending");

        run(&conn).unwrap();

        assert_eq!(origin_of(&conn, "i-am").as_deref(), Some("app_master"));
        assert_eq!(origin_of(&conn, "i-team").as_deref(), Some("team_proposed"));
        assert_eq!(
            origin_of(&conn, "i-plat").as_deref(),
            Some("platform_escalation")
        );
        // Every lens is the SAME source; the lens itself stays in `scan_type`.
        assert_eq!(origin_of(&conn, "i-lens").as_deref(), Some("idea_scanner"));
        assert_eq!(origin_of(&conn, "i-lens2").as_deref(), Some("idea_scanner"));
        assert_eq!(
            origin_of(&conn, "i-bench").as_deref(),
            Some("headless_bench_seed")
        );
        assert_eq!(origin_of(&conn, "i-static").as_deref(), Some("static_scan"));
        // An unrecognised producer is NOT invented into a new source — it lands
        // on `manual`, which is the honest reading of "nobody declared this".
        assert_eq!(origin_of(&conn, "i-odd").as_deref(), Some("manual"));
    }

    /// A row that already carries an origin was filed through the door that had
    /// the column, and its value is authoritative over anything `scan_type` says.
    #[test]
    fn the_origin_backfill_never_overwrites_a_source_already_recorded() {
        let conn = migrated_conn();
        idea(&conn, "i-sweep", "scan_sweep", "pending");
        conn.execute(
            "UPDATE dev_ideas SET origin = 'kpi_sim' WHERE id = 'i-sweep'",
            [],
        )
        .unwrap();

        run(&conn).unwrap();

        assert_eq!(origin_of(&conn, "i-sweep").as_deref(), Some("kpi_sim"));
    }

    /// The 518. An accepted idea whose task COMPLETED is delivered; the app
    /// simply had nowhere to say so.
    #[test]
    fn the_delivered_backfill_closes_only_work_that_actually_landed() {
        let conn = migrated_conn();
        idea(&conn, "i-done", "app-master", "accepted");
        idea(&conn, "i-failed", "app-master", "accepted");
        idea(&conn, "i-cancelled", "app-master", "accepted");
        idea(&conn, "i-untouched", "app-master", "accepted");
        idea(&conn, "i-pending", "app-master", "pending");
        task(&conn, "t-done", "i-done", "completed");
        task(&conn, "t-failed", "i-failed", "failed");
        task(&conn, "t-cancelled", "i-cancelled", "cancelled");
        // A pending idea with a completed task must not be promoted past the
        // verdict nobody passed on it.
        task(&conn, "t-pending", "i-pending", "completed");

        run(&conn).unwrap();

        assert_eq!(status_of(&conn, "i-done"), "delivered");
        // A failure and a cancellation are not evidence of delivery. These stay
        // `accepted` — which is now a state a reaper can reach.
        assert_eq!(status_of(&conn, "i-failed"), "accepted");
        assert_eq!(status_of(&conn, "i-cancelled"), "accepted");
        assert_eq!(status_of(&conn, "i-untouched"), "accepted");
        assert_eq!(status_of(&conn, "i-pending"), "pending");
    }

    /// Every row grades on the day this runs, and since no row can carry a plan
    /// yet, every one of them grades `draft`. That is correct: none of them is
    /// dispatchable under the new contract until something plans it.
    #[test]
    fn existing_rows_grade_draft_because_none_of_them_carries_a_plan() {
        let conn = migrated_conn();
        idea(&conn, "i-rated", "app-master", "accepted");
        run(&conn).unwrap();

        let grade: Option<String> = conn
            .query_row(
                "SELECT completeness FROM dev_ideas WHERE id = 'i-rated'",
                [],
                |r| r.get("completeness"),
            )
            .unwrap();
        assert_eq!(grade.as_deref(), Some("draft"));
    }

    /// Each step probes its own POSTCONDITION rather than a marker, so a second
    /// pass must change nothing — including not re-closing an idea a human has
    /// since reopened.
    #[test]
    fn a_second_pass_changes_nothing_it_already_decided() {
        let conn = migrated_conn();
        idea(&conn, "i-done", "app-master", "accepted");
        task(&conn, "t-done", "i-done", "completed");
        run(&conn).unwrap();
        assert_eq!(status_of(&conn, "i-done"), "delivered");

        // A human disagrees and reopens it. The backfill must not fight them.
        conn.execute(
            "UPDATE dev_ideas SET status = 'rejected' WHERE id = 'i-done'",
            [],
        )
        .unwrap();

        run(&conn).unwrap();

        assert_eq!(status_of(&conn, "i-done"), "rejected");
    }
}
