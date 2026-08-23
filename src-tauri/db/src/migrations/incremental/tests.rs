//! Tests for the incremental migration chain. Moved verbatim from the
//! former `migrations/incremental.rs`; only the import header changed to
//! name the modules the code under test now lives in.

use rusqlite::Connection;

use super::support::*;
use super::{ensure_composite_fires_table, run_incremental};

/// Rows written before `create_milestone` learned to stamp `cut_at` are
/// active with no cut — the scope-creep baseline is missing. The backfill
/// step must repair them on the next boot, and must not touch 'planned'
/// rows (uncut by definition) or an already-stamped `cut_at`.
#[test]
fn backfill_cut_at_repairs_uncut_active_milestones() {
    let pool = crate::init_test_db().unwrap();
    let conn = pool.get().unwrap();
    conn.execute_batch(
        "INSERT INTO dev_projects (id, name, root_path) VALUES ('p1', 'P', '/tmp/p1');
         INSERT INTO dev_milestones (id, project_id, name, status, created_at, updated_at)
            VALUES ('m-active', 'p1', 'Onboard', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
         INSERT INTO dev_milestones (id, project_id, name, status, created_at, updated_at)
            VALUES ('m-planned', 'p1', 'Later', 'planned', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
         INSERT INTO dev_milestones (id, project_id, name, status, cut_at, created_at, updated_at)
            VALUES ('m-cut', 'p1', 'Cut', 'active', '2026-02-02T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');",
    )
    .unwrap();

    // The backfill lives in the `ensure_composite_fires_table` phase that
    // `migrations::run` invokes, so replay the whole boot chain.
    crate::migrations::run(&conn).unwrap();
    run_incremental(&conn).unwrap();

    let cut_at = |id: &str| -> Option<String> {
        conn.query_row(
            "SELECT cut_at FROM dev_milestones WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .unwrap()
    };
    assert_eq!(cut_at("m-active").as_deref(), Some("2026-01-01T00:00:00Z"));
    assert_eq!(cut_at("m-planned"), None, "planned milestones stay uncut");
    assert_eq!(
        cut_at("m-cut").as_deref(),
        Some("2026-02-02T00:00:00Z"),
        "an existing cut stamp must not be rewritten"
    );
}

/// The description/rating ALTER lands on a table the operator already has
/// live rows in, and the boot chain replays on EVERY launch. Both columns
/// must appear, existing rows must survive with NULLs (unrated, which is
/// not rated-1), and replaying must neither fail nor rewrite the data.
#[test]
fn milestone_item_description_rating_alter_is_safe_on_a_populated_db() {
    let pool = crate::init_test_db().unwrap();
    let conn = pool.get().unwrap();
    conn.execute_batch(
        "INSERT INTO dev_projects (id, name, root_path) VALUES ('p9', 'P', '/tmp/p9');
         INSERT INTO dev_milestones (id, project_id, name, status, cut_at, created_at, updated_at)
            VALUES ('m9', 'p9', 'v1', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
         INSERT INTO dev_milestone_items (milestone_id, item_kind, item_id, bucket, added_after_cut, order_index, created_at)
            VALUES ('m9', 'use_case', 'uc-old', 'core', 1, 0, '2026-01-01T00:00:00Z');",
    )
    .unwrap();

    assert!(has_column(&conn, "dev_milestone_items", "description").unwrap());
    assert!(has_column(&conn, "dev_milestone_items", "rating").unwrap());

    // Annotate the pre-existing row, then replay the whole boot chain
    // twice — the guard must skip the ALTER rather than error, and must
    // not touch the data.
    conn.execute(
        "UPDATE dev_milestone_items SET description = 'kept', rating = 4
         WHERE milestone_id = 'm9' AND item_id = 'uc-old'",
        [],
    )
    .unwrap();
    crate::migrations::run(&conn).unwrap();
    run_incremental(&conn).unwrap();
    crate::migrations::run(&conn).unwrap();
    run_incremental(&conn).unwrap();

    let (desc, rating, creep): (Option<String>, Option<i64>, i64) = conn
        .query_row(
            "SELECT description, rating, added_after_cut FROM dev_milestone_items
             WHERE milestone_id = 'm9' AND item_id = 'uc-old'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(desc.as_deref(), Some("kept"));
    assert_eq!(rating, Some(4));
    assert_eq!(creep, 1, "the replay must not disturb the creep flag");

    // The CHECK rode along on the ADD COLUMN.
    assert!(
        conn.execute(
            "UPDATE dev_milestone_items SET rating = 0 WHERE milestone_id = 'm9'",
            [],
        )
        .is_err(),
        "rating 0 must be refused by the column CHECK"
    );
}

/// The boot path (`db::init_db`, db/mod.rs) replays BOTH migration phases
/// — `migrations::run` + `run_incremental` — on EVERY app launch against
/// whatever database already exists on disk. A single non-idempotent step
/// (unguarded `ALTER TABLE ADD COLUMN`, a `CREATE TABLE` without
/// `IF NOT EXISTS`, a rebuild that re-fires) therefore bricks every
/// existing install on its next launch, not just upgrades.
///
/// `init_test_db` runs the exact same chain once (fresh install); this
/// test then replays the chain twice more, simulating the second and
/// third launches on the same database file.
#[test]
fn migration_chain_is_idempotent_on_rerun() {
    let pool = crate::init_test_db().unwrap();
    let conn = pool.get().unwrap();

    // Second launch on the existing DB — the upgrade-on-boot path.
    crate::migrations::run(&conn).expect(
        "2nd run of initial migrations failed — every existing install would brick on next launch",
    );
    run_incremental(&conn)
        .expect("2nd run of incremental migrations failed — every existing install would brick on next launch");

    // Third launch — catches guards that only survive exactly one replay
    // (e.g. a step whose first replay mutates the state its own
    // `already_applied` check reads).
    crate::migrations::run(&conn).expect("3rd run of initial migrations failed");
    run_incremental(&conn).expect("3rd run of incremental migrations failed");

    // The replays must leave a structurally sound database behind.
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        integrity, "ok",
        "integrity_check failed after migration replay"
    );

    let fk_violations: i64 = conn
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check()", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        fk_violations, 0,
        "foreign_key_check found violations after migration replay"
    );

    // The persona_executions rebuild guard must not re-widen the status
    // CHECK on replay: exactly one 'incomplete' in the stored DDL. Two
    // would mean the `already_applied` guard failed and the table was
    // rebuilt again (dropping/re-copying user execution history on boot).
    let ddl: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='persona_executions'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        ddl.matches("'incomplete'").count(),
        1,
        "persona_executions CHECK was re-widened on replay — rebuild migration is not idempotent"
    );
}

/// A guarded `ALTER TABLE … ADD COLUMN` that genuinely cannot succeed must
/// SURFACE. Six sites in this file used `let _ = ddl_step(…)` to absorb the
/// "duplicate column name" they expect on re-run — and absorbed every other
/// error with it, so a migration that never wrote anything reported success.
///
/// Simulates a database where the statement cannot possibly work (its table
/// is gone). Under the discarded Result this returned `Ok(())`.
#[test]
fn a_genuinely_failed_guarded_alter_is_no_longer_swallowed() {
    let pool = crate::init_test_db().unwrap();
    let conn = pool.get().unwrap();
    // `cloud_webhook_watermarks` is created by the very next step after the
    // guarded ALTER and by nothing else in the tree, so its absence pins
    // WHERE the chain stopped. Without that marker the assertion is empty:
    // with the Result discarded the chain sails past the ALTER and only
    // trips ~200 lines later on `CREATE INDEX … ON automation_runs`, which
    // raises the same "no such table" from a completely different cause.
    conn.execute_batch(
        "DROP TABLE automation_runs;
         DROP TABLE cloud_webhook_watermarks;",
    )
    .unwrap();

    let err = run_incremental(&conn)
        .expect_err("an ALTER that cannot succeed must surface, not be swallowed");
    assert!(
        err.to_string().contains("automation_runs"),
        "the surfaced error must name the failing table, got: {err}",
    );
    assert!(
        !has_table(&conn, "cloud_webhook_watermarks").unwrap(),
        "the chain ran PAST the failed ALTER — the error was still being swallowed",
    );
}

/// `retire_persona_groups` drops `personas.group_id` and then drops the
/// `persona_groups` table it references. SQLite refuses `DROP COLUMN` while
/// any index/trigger/view still names the column — and the discarded Result
/// meant the migration marched on to `DROP TABLE persona_groups` anyway,
/// leaving `personas` with a REFERENCES clause pointing at nothing. With
/// `foreign_keys = ON` (every pooled connection) that makes EVERY
/// `INSERT INTO personas` fail with `no such table: persona_groups`.
///
/// Rebuilds that exact legacy shape, including a COMPOSITE index the
/// migration's hand-written `DROP INDEX` list has never heard of.
#[test]
fn a_blocked_group_id_drop_no_longer_takes_persona_groups_with_it() {
    let pool = crate::init_test_db().unwrap();
    let conn = pool.get().unwrap();
    conn.execute_batch(
        // The ORIGINAL pre-workspace shape: the chain's own earlier step
        // ("Added workspace fields to persona_groups") adds description +
        // the four default_* columns that `groups_to_teams_data_migration`
        // then reads, so seeding them here would collide with it.
        "CREATE TABLE persona_groups (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            color      TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
         );
         ALTER TABLE persona_memories ADD COLUMN group_id TEXT;
         ALTER TABLE personas ADD COLUMN group_id TEXT REFERENCES persona_groups(id);
         CREATE INDEX idx_personas_group_and_name ON personas(group_id, name);",
    )
    .unwrap();

    // A blocked DROP COLUMN is not worth bricking a launch over…
    run_incremental(&conn).expect("a blocked DROP COLUMN must not abort the whole migration chain");

    // …but the parent table must not be dropped out from under the FK.
    assert!(
        has_table(&conn, "persona_groups").unwrap(),
        "persona_groups was dropped while personas.group_id still references it",
    );
    conn.execute(
        "INSERT INTO personas (id, name, system_prompt, created_at, updated_at) \
         VALUES ('p1', 'n', 'sp', datetime('now'), datetime('now'))",
        [],
    )
    .expect("persona creation must still work after the migration");
}

/// Pins that a fresh database actually receives the artifacts of the
/// NEWEST migrations at the tail of `run_incremental`. If a late step is
/// accidentally short-circuited (e.g. an early `return`, a mis-keyed
/// `already_applied` guard that reads true on a fresh DB, or a reordering
/// that moves it behind a failing step), fresh installs silently miss
/// tables/columns and every repo touching them errors at runtime.
#[test]
fn fresh_schema_contains_latest_migration_artifacts() {
    let pool = crate::init_test_db().unwrap();
    let conn = pool.get().unwrap();

    // Tables created by the newest migrations (tail of run_incremental).
    for table in [
        "dev_goal_items",
        "team_assignment_templates",
        "dev_kpis",
        "dev_kpi_measurements",
        "dev_kpi_bindings",
        "dev_run_checkpoints",
        "athena_wake_log",
        "run_budgets",
        "dev_llm_spend",
        "dev_use_cases",
        "dev_use_case_contexts",
        "dev_milestones",
        "dev_milestone_items",
        "dev_workspaces",
        "workspace_knowledge",
        "workspace_practice_adoption",
        "dev_context_fingerprints",
    ] {
        assert!(
            has_table(&conn, table).unwrap(),
            "table `{table}` missing from a fresh database — its incremental migration did not run"
        );
    }

    // Columns ALTERed in by the newest migrations.
    for (table, column) in [
        ("persona_executions", "thinking_level"),
        ("persona_executions", "cache_read_tokens"),
        ("persona_executions", "cache_creation_tokens"),
        ("dev_goals", "kpi_id"),
        ("dev_goal_items", "verify_kind"),
        ("dev_goal_items", "verify_config"),
        ("dev_kpis", "metric_type"),
        ("dev_kpis", "tier"),
        ("dev_kpis", "context_id"),
        ("dev_kpis", "warn_at"),
        ("dev_kpis", "crit_at"),
        ("dev_kpis", "last_skip_at"),
        ("dev_kpis", "use_case_id"),
        ("team_assignments", "goal_id"),
        ("dev_contexts", "category"),
        ("dev_contexts", "business_feature"),
        ("dev_context_groups", "domain"),
        ("persona_memories", "derived_from"),
        ("persona_memory_review_proposal", "team_id"),
        ("dev_kpi_measurements", "env"),
        ("dev_projects", "workspace_id"),
        ("workspace_knowledge", "topic"),
        ("workspace_knowledge", "abstraction"),
        ("workspace_knowledge", "durability"),
    ] {
        assert!(
            has_column(&conn, table, column).unwrap(),
            "column `{table}.{column}` missing from a fresh database — its incremental migration did not run"
        );
    }

    // Indexes shipped alongside the newest table migrations.
    for index in [
        "idx_dev_llm_spend_source",
        "idx_dev_kpi_bindings_kpi",
        "idx_athena_wake_log_surface",
        "idx_run_budgets_kind",
        "idx_team_assignment_templates_team",
        "idx_dev_kpis_context",
        "idx_dev_kpis_use_case",
        "idx_dev_use_cases_project",
        "idx_workspace_knowledge_ws_status",
        "idx_workspace_knowledge_dedup",
        "idx_dev_context_fingerprints_hash",
    ] {
        assert!(
            has_index(&conn, index).unwrap(),
            "index `{index}` missing from a fresh database — its incremental migration did not run"
        );
    }

    // The status CHECK on persona_executions must carry 'incomplete'
    // (fresh DBs get it from the base schema; legacy DBs from the
    // rebuild migration). Without it, Incomplete executions fail to
    // persist and are force-written as `failed`.
    let ddl: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='persona_executions'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        ddl.contains("'incomplete'"),
        "persona_executions status CHECK does not allow 'incomplete'"
    );
}

/// `source='ai-compose'` is what the Factory measurement-setup compose run
/// writes. Until the CHECK was widened SQLite rejected every one of them,
/// and the background writer swallowed the error — so the assertion that
/// matters is that the value is now *accepted*, on a fresh install and on a
/// legacy database that still carries the narrow CHECK.
#[test]
fn ai_compose_is_an_accepted_measurement_source() {
    let pool = crate::init_test_db().unwrap();
    let conn = pool.get().unwrap();
    conn.execute_batch(
        "INSERT INTO dev_projects (id, name, root_path) VALUES ('p1','P','/tmp/ai-compose');
         INSERT INTO dev_kpis (id, project_id, name, category, measure_kind, unit, direction)
            VALUES ('k1','p1','Coverage','technical','codebase','%','up');",
    )
    .unwrap();

    conn.execute(
        "INSERT INTO dev_kpi_measurements (id, kpi_id, value, source, env, evidence)
         VALUES ('m1','k1',61.5,'ai-compose','production','{\"cmd\":\"npx vitest run\"}')",
        [],
    )
    .expect("an AI-composed reading must be storable");

    // The widening is additive, never a hole: an invented source is still
    // refused, so the column keeps meaning something.
    assert!(
        conn.execute(
            "INSERT INTO dev_kpi_measurements (id, kpi_id, value, source)
             VALUES ('m2','k1',1.0,'vibes')",
            [],
        )
        .is_err(),
        "the CHECK must still reject a source nothing writes",
    );
}

/// The rebuild copies from the table's OWN stored DDL, so a column added by
/// a later migration must survive it — a hand-written column list would
/// silently drop the data. Simulates a legacy DB by narrowing the CHECK back
/// down and adding a column the rebuild code has never heard of.
#[test]
fn widening_the_measurement_source_preserves_rows_and_later_columns() {
    let pool = crate::init_test_db().unwrap();
    let conn = pool.get().unwrap();
    conn.execute_batch(
        "INSERT INTO dev_projects (id, name, root_path) VALUES ('p1','P','/tmp/widen');
         INSERT INTO dev_kpis (id, project_id, name, category, measure_kind, unit, direction)
            VALUES ('k1','p1','Coverage','technical','codebase','%','up');",
    )
    .unwrap();

    // Rewind to the pre-widening shape, plus a "future" column.
    conn.execute_batch(
        "PRAGMA foreign_keys = OFF;
         DROP TABLE dev_kpi_measurements;
         CREATE TABLE dev_kpi_measurements (
            id          TEXT PRIMARY KEY,
            kpi_id      TEXT NOT NULL REFERENCES dev_kpis(id) ON DELETE CASCADE,
            value       REAL NOT NULL,
            measured_at TEXT NOT NULL DEFAULT (datetime('now')),
            source      TEXT NOT NULL DEFAULT 'manual'
                        CHECK(source IN ('evaluator','manual','scan','health_snapshot','simulation')),
            env         TEXT NOT NULL DEFAULT 'production'
                        CHECK(env IN ('local','test','production')),
            evidence    TEXT,
            note        TEXT
         );
         ALTER TABLE dev_kpi_measurements ADD COLUMN confidence REAL;
         CREATE INDEX idx_dev_kpi_measurements_kpi
            ON dev_kpi_measurements(kpi_id, measured_at DESC);
         INSERT INTO dev_kpi_measurements (id, kpi_id, value, source, evidence, confidence)
            VALUES ('old','k1',40.0,'evaluator','{\"cmd\":\"legacy\"}',0.75);
         PRAGMA foreign_keys = ON;",
    )
    .unwrap();
    assert!(conn
        .execute(
            "INSERT INTO dev_kpi_measurements (id, kpi_id, value, source)
             VALUES ('pre','k1',1.0,'ai-compose')",
            [],
        )
        .is_err());

    run_incremental(&conn).unwrap();

    let (value, evidence, confidence): (f64, Option<String>, Option<f64>) = conn
        .query_row(
            "SELECT value, evidence, confidence FROM dev_kpi_measurements WHERE id = 'old'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("the legacy row survived the rebuild");
    assert_eq!(value, 40.0);
    assert_eq!(evidence.as_deref(), Some("{\"cmd\":\"legacy\"}"));
    assert_eq!(
        confidence,
        Some(0.75),
        "a column the rebuild code never knew about must ride along with its data",
    );
    assert!(
        has_index(&conn, "idx_dev_kpi_measurements_kpi").unwrap(),
        "the index is replayed after the rename",
    );
    conn.execute(
        "INSERT INTO dev_kpi_measurements (id, kpi_id, value, source, env, evidence)
         VALUES ('m1','k1',61.5,'ai-compose','production','{}')",
        [],
    )
    .expect("the widened CHECK now accepts the composed source");

    // Replay must be a no-op, not a second rebuild.
    run_incremental(&conn).unwrap();
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM dev_kpi_measurements", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        rows, 2,
        "re-running the migration must not duplicate or drop rows"
    );
}

// ------------------------------------------------- dev_goals.status ----

/// Rewind `dev_goals` to the unconstrained TEXT column and seed it with the
/// given `(id, status)` rows, simulating a database written before the
/// CHECK existed.
fn legacy_goals_table(conn: &Connection, rows: &[(&str, &str)]) {
    conn.execute_batch(
        "PRAGMA foreign_keys = OFF;
         INSERT INTO dev_projects (id, name, root_path) VALUES ('p1','P','/tmp/goal-status');
         DROP TABLE dev_goals;
         CREATE TABLE dev_goals (
           id             TEXT PRIMARY KEY,
           project_id     TEXT NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
           parent_goal_id TEXT REFERENCES dev_goals(id) ON DELETE SET NULL,
           context_id     TEXT,
           order_index    INTEGER NOT NULL DEFAULT 0,
           title          TEXT NOT NULL,
           description    TEXT,
           status         TEXT NOT NULL DEFAULT 'open',
           progress       INTEGER DEFAULT 0,
           target_date    TEXT,
           started_at     TEXT,
           completed_at   TEXT,
           created_at     TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
         );
         ALTER TABLE dev_goals ADD COLUMN kpi_id TEXT;
         CREATE INDEX idx_dev_goals_project ON dev_goals(project_id);
         CREATE INDEX idx_dev_goals_status  ON dev_goals(status);
         CREATE INDEX idx_dev_goals_parent  ON dev_goals(parent_goal_id);
         PRAGMA foreign_keys = ON;",
    )
    .unwrap();
    for (i, (id, status)) in rows.iter().enumerate() {
        conn.execute(
            "INSERT INTO dev_goals (id, project_id, title, status, kpi_id)
             VALUES (?1, 'p1', ?2, ?3, ?4)",
            rusqlite::params![id, format!("goal {i}"), status, format!("kpi-{i}")],
        )
        .unwrap();
    }
}

fn status_of(conn: &Connection, id: &str) -> String {
    conn.query_row(
        "SELECT status FROM dev_goals WHERE id = ?1",
        rusqlite::params![id],
        |r| r.get(0),
    )
    .unwrap()
}

/// Every legacy spelling `normalizeGoalStatus` already folds must survive
/// the migration as its canonical form. A CHECK that rejected them would
/// brick the launch of any install that has one.
#[test]
fn legacy_goal_status_aliases_migrate_to_their_canonical_form() {
    let pool = crate::init_test_db().unwrap();
    let conn = pool.get().unwrap();
    legacy_goals_table(
        &conn,
        &[
            ("g-running", "running"),
            ("g-matching", "matching"),
            ("g-underscore", "in_progress"),
            ("g-review", "review"),
            ("g-awaiting-review", "awaiting_review"),
            ("g-completed", "completed"),
            ("g-skipped", "skipped"),
            ("g-queued", "queued"),
            ("g-open", "open"),
            ("g-accept", "awaiting_acceptance"),
        ],
    );

    run_incremental(&conn).unwrap();

    for (id, expected) in [
        ("g-running", "in-progress"),
        ("g-matching", "in-progress"),
        ("g-underscore", "in-progress"),
        ("g-review", "blocked"),
        ("g-awaiting-review", "blocked"),
        ("g-completed", "done"),
        ("g-skipped", "done"),
        ("g-queued", "open"),
        ("g-open", "open"),
        ("g-accept", "awaiting_acceptance"),
    ] {
        assert_eq!(status_of(&conn, id), expected, "{id} migrated wrong");
    }
    // The rebuild preserved the ALTER-added column and the indexes.
    let kpi_id: Option<String> = conn
        .query_row(
            "SELECT kpi_id FROM dev_goals WHERE id = 'g-running'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(kpi_id.as_deref(), Some("kpi-0"));
    for idx in [
        "idx_dev_goals_project",
        "idx_dev_goals_status",
        "idx_dev_goals_parent",
    ] {
        assert!(has_index(&conn, idx).unwrap(), "{idx} was not replayed");
    }
}

/// The point of the constraint: a writer that bypasses the canonical set is
/// stopped at the boundary instead of silently mis-laning a goal forever.
#[test]
fn a_non_canonical_goal_status_is_rejected_at_the_db_boundary() {
    let pool = crate::init_test_db().unwrap();
    let conn = pool.get().unwrap();
    conn.execute(
        "INSERT INTO dev_projects (id, name, root_path) VALUES ('p1','P','/tmp/goal-reject')",
        [],
    )
    .unwrap();

    for bad in ["in_progress", "running", "completed", "", "whatever"] {
        let err = conn.execute(
            "INSERT INTO dev_goals (id, project_id, title, status)
             VALUES ('bad','p1','t',?1)",
            rusqlite::params![bad],
        );
        assert!(err.is_err(), "status {bad:?} must be refused by the CHECK");
    }
    for good in crate::repos::dev_tools::CANONICAL_GOAL_STATUSES {
        conn.execute(
            "INSERT INTO dev_goals (id, project_id, title, status)
             VALUES (?1,'p1','t',?2)",
            rusqlite::params![format!("ok-{good}"), good],
        )
        .unwrap_or_else(|e| panic!("canonical status {good:?} must be accepted: {e}"));
    }
}

/// A status nothing maps is REPORTED — a goal signal carrying the original
/// value, not a silent rewrite — and the migration still completes, because
/// it runs on every launch and must never brick one.
#[test]
fn an_unmappable_goal_status_is_reported_rather_than_quietly_defaulted() {
    let pool = crate::init_test_db().unwrap();
    let conn = pool.get().unwrap();
    legacy_goals_table(
        &conn,
        &[("g-weird", "escalated-to-legal"), ("g-fine", "running")],
    );

    run_incremental(&conn).unwrap();

    assert_eq!(status_of(&conn, "g-weird"), "open");
    let (kind, message): (String, String) = conn
        .query_row(
            "SELECT signal_type, message FROM dev_goal_signals WHERE goal_id = 'g-weird'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("the unmappable value must leave a trace on the goal itself");
    assert_eq!(kind, "status_unmappable");
    assert!(
        message.contains("escalated-to-legal"),
        "the report must carry the ORIGINAL value, or it buried the bug: {message}",
    );
    // A mappable neighbour is untouched by the anomaly path.
    assert_eq!(status_of(&conn, "g-fine"), "in-progress");
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM dev_goal_signals", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1,
        "only the unmappable row is reported",
    );
}

/// Re-running is a no-op: the guard reads the stored DDL, so a second and
/// third launch neither rebuild the table nor re-report anything.
#[test]
fn re_running_the_goal_status_migration_changes_nothing() {
    let pool = crate::init_test_db().unwrap();
    let conn = pool.get().unwrap();
    legacy_goals_table(
        &conn,
        &[("g-weird", "escalated-to-legal"), ("g-run", "running")],
    );

    run_incremental(&conn).unwrap();
    let ddl_after_first: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='dev_goals'",
            [],
            |r| r.get(0),
        )
        .unwrap();

    run_incremental(&conn).unwrap();
    run_incremental(&conn).unwrap();

    let ddl_after_third: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='dev_goals'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        ddl_after_first, ddl_after_third,
        "the replay rebuilt the table again"
    );
    assert_eq!(
        ddl_after_third.matches("CHECK(status IN").count(),
        1,
        "a replay must not stack a second CHECK onto the column",
    );
    assert_eq!(status_of(&conn, "g-run"), "in-progress");
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM dev_goal_signals", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1,
        "the anomaly is reported once, not once per launch",
    );
}

/// The retired DB skills system ("System A") must be absent from a fresh
/// database: the CREATE was removed from initial.rs, so a fresh install
/// never creates `skills` / `skill_components` / `persona_skills`.
#[test]
fn fresh_database_has_no_db_skills_tables() {
    let pool = crate::init_test_db().unwrap();
    let conn = pool.get().unwrap();
    for table in ["skills", "skill_components", "persona_skills"] {
        assert!(
            !has_table(&conn, table).unwrap(),
            "retired DB skills table `{table}` was created on a fresh install"
        );
    }
}

/// The guarded-drop retirement migration removes the three legacy tables
/// when they are EMPTY, but preserves any table that still holds rows
/// (never delete user data). Simulates a legacy database by recreating the
/// old schema, then replays `run_incremental`.
#[test]
fn retire_db_skills_drops_empty_but_preserves_nonempty() {
    let pool = crate::init_test_db().unwrap();
    let conn = pool.get().unwrap();

    // Recreate the legacy System-A schema on top of the fresh DB.
    conn.execute_batch(
        "CREATE TABLE skills (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL DEFAULT '1.0.0',
            description TEXT, category TEXT, is_builtin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(name, version));
         CREATE TABLE skill_components (
            id TEXT PRIMARY KEY,
            skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            component_type TEXT NOT NULL, component_data TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')));
         CREATE TABLE persona_skills (
            id TEXT PRIMARY KEY, persona_id TEXT NOT NULL,
            skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            enabled INTEGER NOT NULL DEFAULT 1, config TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(persona_id, skill_id));",
    )
    .unwrap();

    // Case 1: all empty → all dropped on replay.
    run_incremental(&conn).unwrap();
    for table in ["skills", "skill_components", "persona_skills"] {
        assert!(
            !has_table(&conn, table).unwrap(),
            "empty legacy table `{table}` was not dropped by the retirement migration"
        );
    }

    // Case 2: a non-empty `skills` table must be preserved.
    conn.execute_batch(
        "CREATE TABLE skills (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL DEFAULT '1.0.0',
            description TEXT, category TEXT, is_builtin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(name, version));",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO skills (id, name) VALUES ('s1', 'user skill')",
        [],
    )
    .unwrap();
    run_incremental(&conn).unwrap();
    assert!(
        has_table(&conn, "skills").unwrap(),
        "non-empty legacy `skills` table was deleted — user data lost"
    );
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM skills", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 1, "user skill row was lost");
}

// -- Dangling foreign-key targets ----------------------------------------

/// The static gate proposed in `docs/concepts/golden-paths/schema-change.md`
/// ("The missing gate", difference set C), as a runtime assertion over the
/// database the real chain actually builds.
///
/// SQLite resolves foreign-key targets LAZILY: `REFERENCES nonexistent(id)`
/// succeeds at `CREATE TABLE` and only raises `no such table:
/// main.nonexistent` on the first `INSERT` under `foreign_keys = ON`. And
/// `PRAGMA foreign_key_check` is structurally blind to it on an EMPTY child
/// table — which a table whose every insert fails always is — so
/// `migration_chain_is_idempotent_on_rerun`'s FK assertion passes straight
/// over the defect. This query is what sees it.
///
/// `mcp_gateway_members` -> `credentials` shipped 2026-04-08 and made the
/// whole gateway-membership feature dead on arrival on every install.
#[test]
fn no_foreign_key_points_at_a_missing_table() {
    let pool = crate::init_test_db().unwrap();
    let conn = pool.get().unwrap();

    let mut stmt = conn
        .prepare(
            "SELECT m.name, fk.\"table\"
               FROM sqlite_master m
               JOIN pragma_foreign_key_list(m.name) fk
              WHERE m.type = 'table'
                AND fk.\"table\" NOT IN (
                      SELECT name FROM sqlite_master WHERE type = 'table')",
        )
        .unwrap();
    let dangling: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    // Assert the instrument before the result: a database with no tables
    // would produce an empty list and a false pass.
    let table_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        table_count > 200,
        "only {table_count} tables in the fresh schema — the chain did not run, \
         so this test proves nothing"
    );
    let fk_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master m
               JOIN pragma_foreign_key_list(m.name) fk
              WHERE m.type = 'table'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        fk_count > 50,
        "only {fk_count} foreign keys found — the pragma join is broken, not the schema"
    );

    assert!(
        dangling.is_empty(),
        "foreign keys point at tables that do not exist (child -> phantom parent): {dangling:?}. \
         Every INSERT into those children fails at runtime under foreign_keys = ON."
    );
}

/// The behavioural half: the gateway-membership feature must actually work.
/// `add_member`'s INSERT is the statement that has been raising
/// `no such table: main.credentials` since 2026-04-08.
#[test]
fn mcp_gateway_members_accepts_an_insert_under_foreign_keys_on() {
    let pool = crate::init_test_db().unwrap();
    let conn = pool.get().unwrap();

    let fk_on: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        fk_on, 1,
        "test connection has FK enforcement off — proves nothing"
    );

    conn.execute_batch(
        "INSERT INTO persona_credentials
            (id, name, service_type, encrypted_data, iv, created_at, updated_at)
         VALUES ('gw', 'Gateway', 'mcp_gateway', 'x', 'y', '2026-01-01', '2026-01-01'),
                ('mem', 'Member', 'mcp', 'x', 'y', '2026-01-01', '2026-01-01');",
    )
    .unwrap();

    conn.execute(
        "INSERT INTO mcp_gateway_members
            (id, gateway_credential_id, member_credential_id, display_name, enabled, sort_order)
         VALUES ('m1', 'gw', 'mem', 'Member', 1, 0)",
        [],
    )
    .expect("adding a gateway member must succeed");

    // The FK must also be live, not merely non-dangling.
    let orphan = conn.execute(
        "INSERT INTO mcp_gateway_members
            (id, gateway_credential_id, member_credential_id, display_name, enabled, sort_order)
         VALUES ('m2', 'gw', 'does-not-exist', 'Ghost', 1, 0)",
        [],
    );
    assert!(
        orphan.is_err(),
        "a member row referencing a missing credential was accepted — the FK is not enforced"
    );

    // ON DELETE CASCADE must reach through the repointed parent.
    conn.execute("DELETE FROM persona_credentials WHERE id = 'gw'", [])
        .unwrap();
    let left: i64 = conn
        .query_row("SELECT COUNT(*) FROM mcp_gateway_members", [], |r| r.get(0))
        .unwrap();
    assert_eq!(left, 0, "deleting the gateway credential did not cascade");
}

/// The upgrade path: a database that already carries the broken shape must
/// be repaired on its next boot, and must keep any rows it somehow holds.
/// Rows are inserted with FK enforcement off, because with it on the broken
/// table cannot be written to at all — which is the whole bug.
#[test]
fn legacy_mcp_gateway_members_fk_is_repaired_without_losing_rows() {
    let pool = crate::init_test_db().unwrap();
    let conn = pool.get().unwrap();

    // Rebuild the table in its as-shipped (broken) shape.
    {
        let _guard = crate::FkDisabledGuard::new(&conn).unwrap();
        conn.execute_batch(
            "DROP TABLE mcp_gateway_members;
             CREATE TABLE IF NOT EXISTS mcp_gateway_members (
                 id                      TEXT PRIMARY KEY,
                 gateway_credential_id   TEXT NOT NULL,
                 member_credential_id    TEXT NOT NULL,
                 display_name            TEXT NOT NULL,
                 enabled                 INTEGER NOT NULL DEFAULT 1,
                 sort_order              INTEGER NOT NULL DEFAULT 0,
                 created_at              TEXT NOT NULL DEFAULT (datetime('now')),
                 FOREIGN KEY (gateway_credential_id) REFERENCES credentials(id) ON DELETE CASCADE,
                 FOREIGN KEY (member_credential_id) REFERENCES credentials(id) ON DELETE CASCADE,
                 UNIQUE (gateway_credential_id, member_credential_id)
             );
             CREATE INDEX IF NOT EXISTS idx_mcp_gateway_members_gw ON mcp_gateway_members(gateway_credential_id);
             CREATE INDEX IF NOT EXISTS idx_mcp_gateway_members_member ON mcp_gateway_members(member_credential_id);
             INSERT INTO persona_credentials
                 (id, name, service_type, encrypted_data, iv, created_at, updated_at)
             VALUES ('gw', 'Gateway', 'mcp_gateway', 'x', 'y', '2026-01-01', '2026-01-01'),
                    ('mem', 'Member', 'mcp', 'x', 'y', '2026-01-01', '2026-01-01');
             INSERT INTO mcp_gateway_members
                 (id, gateway_credential_id, member_credential_id, display_name, enabled, sort_order)
             VALUES ('legacy', 'gw', 'mem', 'Legacy member', 1, 3);",
        )
        .unwrap();
    }
    assert_eq!(
        dangling_fk_count(&conn, "mcp_gateway_members").unwrap(),
        2,
        "fixture did not reproduce the broken shape"
    );

    // Next launch.
    run_incremental(&conn).expect("repair migration must not abort boot");

    assert_eq!(
        dangling_fk_count(&conn, "mcp_gateway_members").unwrap(),
        0,
        "the dangling foreign keys were not repaired"
    );
    let (display, sort): (String, i64) = conn
        .query_row(
            "SELECT display_name, sort_order FROM mcp_gateway_members WHERE id = 'legacy'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("the pre-existing member row was destroyed by the rebuild");
    assert_eq!(display, "Legacy member");
    assert_eq!(sort, 3, "column order was not preserved by the rebuild");

    // Indexes survive the DROP/RENAME.
    assert!(has_index(&conn, "idx_mcp_gateway_members_gw").unwrap());
    assert!(has_index(&conn, "idx_mcp_gateway_members_member").unwrap());

    // And the guard holds: a replay must not rebuild again.
    run_incremental(&conn).expect("replay after repair must be a no-op");
    assert_eq!(dangling_fk_count(&conn, "mcp_gateway_members").unwrap(), 0);
}

/// The three `pending_auth_*` columns were deleted, not corrected to
/// `persona_executions`, because nothing reads or writes them. Pin that:
/// if the JIT-OAuth runner integration is ever built it must add its own
/// guarded step rather than resurrecting the swallowed ALTERs.
#[test]
fn pending_auth_scaffolding_columns_are_gone() {
    let pool = crate::init_test_db().unwrap();
    let conn = pool.get().unwrap();
    for col in [
        "pending_auth_url",
        "pending_auth_started_at",
        "pending_auth_credential_id",
    ] {
        assert!(
            !has_column(&conn, "persona_executions", col).unwrap(),
            "{col} is back on persona_executions with no reader — \
             add the reader in the same change or drop the column"
        );
    }
    assert!(
        !has_table(&conn, "executions").unwrap(),
        "an `executions` table now exists; the deleted ALTERs targeted it by mistake \
         and the comment explaining the deletion needs revisiting"
    );
}
