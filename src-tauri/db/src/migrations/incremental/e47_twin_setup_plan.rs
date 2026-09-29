//! The twin setup plan: the guided setup conversation as durable state.
//!
//! `twin_setup_turn` asked one question at a time and remembered nothing: the
//! transcript, the goals it was working toward and every offer it made lived in
//! the WebView, so a reload restarted the interview and nothing could plan
//! ahead. Five tables hold that state per twin instead:
//!
//! - `twin_setup_plans` — one row per twin: the plan's lifecycle (`status`,
//!   `version`), the stage it serves, the steering the operator gave it (topic
//!   preset, focused slot) and the lease a planner holds while it rebuilds.
//! - `twin_setup_goals` — what the plan is trying to learn, per slot.
//! - `twin_setup_steps` — every question: queued, live, answered, skipped or
//!   made obsolete by a re-plan. The transcript IS this table.
//! - `twin_setup_offers` — typed values proposed for a real field (bio, role,
//!   tone). Nothing writes a field until the operator accepts one.
//! - `twin_setup_observations` — what the engine has noticed about the person,
//!   with an evidence count.
//!
//! Schema decisions worth naming:
//!
//! 1. **Every table cascades from `twin_profiles`.** A plan has no meaning
//!    without its twin; deleting the twin must not leave a conversation behind.
//!    Offers additionally cascade from their step.
//! 2. **At most one live step per twin** is a partial unique index, not a
//!    convention: two live questions would be two answers racing for one slot.
//! 3. **The vocabularies carry CHECKs**, mirroring the doc comments on the
//!    `personas_core::models::twin_setup` wire types. A drift is a CHECK failure
//!    at runtime, not a compile error — keep them identical.
//! 4. **JSON columns** (`criteria_json`, `suggestions_json`, `readiness_json`)
//!    are read whole and never queried into.
//! 5. **`position` is unique per twin** in goals and in steps (census
//!    `unconstrained-sequence-column`): the queue's next step is "lowest queued
//!    position", and a tie would make that plan-dependent. Allocate inside the
//!    INSERT — append at `MAX(position) + 1`, jump the queue at
//!    `MIN(position) - 1`, over ALL of the twin's rows (obsolete and answered
//!    rows keep their positions). The UNIQUE's autoindex also serves the
//!    `(twin_id, position)` goal read.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "twin_setup_plans",
            description: "Twin setup: twin_setup_plans - one plan per twin (status, version, stage, steering, lease)",
            already_applied: |conn| has_table(conn, "twin_setup_plans"),
            apply: create_plans,
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "twin_setup_goals",
            description:
                "Twin setup: twin_setup_goals - what the plan is trying to learn, per slot",
            already_applied: |conn| has_table(conn, "twin_setup_goals"),
            apply: create_goals,
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "twin_setup_steps",
            description: "Twin setup: twin_setup_steps - every question, at most one live per twin",
            already_applied: |conn| has_table(conn, "twin_setup_steps"),
            apply: create_steps,
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "twin_setup_offers",
            description:
                "Twin setup: twin_setup_offers - typed field values awaiting the operator's verdict",
            already_applied: |conn| has_table(conn, "twin_setup_offers"),
            apply: create_offers,
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "twin_setup_observations",
            description: "Twin setup: twin_setup_observations - what the engine noticed, with evidence counts",
            already_applied: |conn| has_table(conn, "twin_setup_observations"),
            apply: create_observations,
        },
    )
}

fn create_plans(conn: &Connection) -> Result<(), AppError> {
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS twin_setup_plans (
            twin_id             TEXT PRIMARY KEY NOT NULL
                                REFERENCES twin_profiles(id) ON DELETE CASCADE,
            status              TEXT NOT NULL DEFAULT 'building'
                                CHECK (status IN ('building','ready','failed')),
            version             INTEGER NOT NULL DEFAULT 0,
            stage               TEXT NOT NULL DEFAULT 'setup'
                                CHECK (stage IN ('setup','training')),
            topic_preset        TEXT,
            focus_slot          TEXT,
            locale              TEXT,
            readiness_json      TEXT,
            answers_since_deep  INTEGER NOT NULL DEFAULT 0,
            change_note         TEXT,
            error               TEXT,
            lease_at            TEXT,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
            last_deep_at        TEXT
         );",
    )?;
    Ok(())
}

fn create_goals(conn: &Connection) -> Result<(), AppError> {
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS twin_setup_goals (
            id             TEXT PRIMARY KEY NOT NULL,
            twin_id        TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
            slot           TEXT NOT NULL,
            title          TEXT NOT NULL,
            intent         TEXT NOT NULL DEFAULT '',
            criteria_json  TEXT NOT NULL DEFAULT '[]',
            state          TEXT NOT NULL DEFAULT 'open'
                           CHECK (state IN ('open','covered','dropped')),
            pinned         INTEGER NOT NULL DEFAULT 0,
            coverage       REAL NOT NULL DEFAULT 0,
            position       INTEGER NOT NULL DEFAULT 0,
            answered       INTEGER NOT NULL DEFAULT 0,
            stall          INTEGER NOT NULL DEFAULT 0,
            created_at     TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (twin_id, position)
         );",
    )?;
    Ok(())
}

fn create_steps(conn: &Connection) -> Result<(), AppError> {
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS twin_setup_steps (
            id                  TEXT PRIMARY KEY NOT NULL,
            twin_id             TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
            goal_id             TEXT,
            stage               TEXT NOT NULL CHECK (stage IN ('setup','training')),
            origin              TEXT NOT NULL
                                CHECK (origin IN ('opener','plan','follow_up','handoff')),
            kind                TEXT NOT NULL DEFAULT 'fact'
                                CHECK (kind IN ('scene','opinion','reply_drill','fact','rule','preference')),
            question            TEXT NOT NULL,
            answer_mode         TEXT NOT NULL DEFAULT 'pick'
                                CHECK (answer_mode IN ('pick','write')),
            incoming            TEXT,
            tone_channel        TEXT,
            suggestions_json    TEXT NOT NULL DEFAULT '[]',
            status              TEXT NOT NULL DEFAULT 'queued'
                                CHECK (status IN ('queued','live','answered','skipped','obsolete')),
            answer              TEXT,
            position            INTEGER NOT NULL DEFAULT 0,
            plan_version        INTEGER NOT NULL DEFAULT 0,
            coverage_gain       REAL,
            reconciled          INTEGER NOT NULL DEFAULT 0,
            reconcile_attempts  INTEGER NOT NULL DEFAULT 0,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            asked_at            TEXT,
            answered_at         TEXT,
            UNIQUE (twin_id, position)
         );
         CREATE INDEX IF NOT EXISTS idx_twin_setup_steps_twin_status_position
            ON twin_setup_steps(twin_id, status, position);
         CREATE UNIQUE INDEX IF NOT EXISTS idx_twin_setup_steps_one_live
            ON twin_setup_steps(twin_id) WHERE status = 'live';",
    )?;
    Ok(())
}

fn create_offers(conn: &Connection) -> Result<(), AppError> {
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS twin_setup_offers (
            id           TEXT PRIMARY KEY NOT NULL,
            twin_id      TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
            step_id      TEXT NOT NULL REFERENCES twin_setup_steps(id) ON DELETE CASCADE,
            origin       TEXT NOT NULL CHECK (origin IN ('reconcile','sample')),
            kind         TEXT NOT NULL CHECK (kind IN ('bio','role','tone')),
            part         TEXT CHECK (part IS NULL OR part IN ('voice','examples','constraints')),
            channel      TEXT,
            value        TEXT NOT NULL,
            length_hint  TEXT,
            reason       TEXT NOT NULL DEFAULT '',
            status       TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open','accepted','edited','dismissed')),
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            resolved_at  TEXT
         );
         CREATE INDEX IF NOT EXISTS idx_twin_setup_offers_twin_status
            ON twin_setup_offers(twin_id, status);",
    )?;
    Ok(())
}

fn create_observations(conn: &Connection) -> Result<(), AppError> {
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS twin_setup_observations (
            id          TEXT PRIMARY KEY NOT NULL,
            twin_id     TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
            text        TEXT NOT NULL,
            evidence    INTEGER NOT NULL DEFAULT 1,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
         );",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_twin(conn: &Connection, id: &str) -> Result<(), AppError> {
        conn.execute(
            "INSERT INTO twin_profiles (id, name, slug, obsidian_subpath) VALUES (?1, ?1, ?1, ?1)",
            rusqlite::params![id],
        )?;
        Ok(())
    }

    /// A step at the next free position (positions are unique per twin).
    fn insert_step(conn: &Connection, id: &str, status: &str) -> rusqlite::Result<usize> {
        conn.execute(
            "INSERT INTO twin_setup_steps (id, twin_id, stage, origin, question, status, position)
             VALUES (?1, 't1', 'setup', 'plan', 'q', ?2,
                     (SELECT COALESCE(MAX(position), -1) + 1 FROM twin_setup_steps
                       WHERE twin_id = 't1'))",
            rusqlite::params![id, status],
        )
    }

    /// The five tables and their indexes land on a fresh database, and a
    /// replay is a no-op that keeps rows.
    #[test]
    fn twin_setup_tables_land_idempotently() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        for table in [
            "twin_setup_plans",
            "twin_setup_goals",
            "twin_setup_steps",
            "twin_setup_offers",
            "twin_setup_observations",
        ] {
            assert!(has_table(&conn, table)?, "missing table {table}");
        }
        for index in [
            "idx_twin_setup_steps_twin_status_position",
            "idx_twin_setup_steps_one_live",
            "idx_twin_setup_offers_twin_status",
        ] {
            assert!(has_index(&conn, index)?, "missing index {index}");
        }

        seed_twin(&conn, "t1")?;
        conn.execute("INSERT INTO twin_setup_plans (twin_id) VALUES ('t1')", [])?;
        run(&conn)?;
        let n: i64 = conn.query_row(
            "SELECT COUNT(twin_id) AS n FROM twin_setup_plans",
            [],
            |r| r.get("n"),
        )?;
        assert_eq!(n, 1, "a replay must not touch existing rows");
        let (status, stage): (String, String) = conn.query_row(
            "SELECT status, stage FROM twin_setup_plans WHERE twin_id = 't1'",
            [],
            |r| Ok((r.get("status")?, r.get("stage")?)),
        )?;
        assert_eq!((status.as_str(), stage.as_str()), ("building", "setup"));
        Ok(())
    }

    /// The partial unique index allows any number of queued steps but refuses
    /// a second live step for the same twin.
    #[test]
    fn at_most_one_live_step_per_twin() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        seed_twin(&conn, "t1")?;
        insert_step(&conn, "s1", "queued")?;
        insert_step(&conn, "s2", "queued")?;
        insert_step(&conn, "s3", "live")?;
        assert!(
            insert_step(&conn, "s4", "live").is_err(),
            "a second live step must be refused"
        );
        conn.execute(
            "UPDATE twin_setup_steps SET status = 'answered' WHERE id = 's3'",
            [],
        )?;
        insert_step(&conn, "s4", "live")?;
        Ok(())
    }

    /// Positions are unique per twin — in steps and in goals — but two twins
    /// may use the same position.
    #[test]
    fn positions_are_unique_per_twin() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        seed_twin(&conn, "t1")?;
        seed_twin(&conn, "t2")?;
        conn.execute_batch(
            "INSERT INTO twin_setup_steps (id, twin_id, stage, origin, question, position)
                VALUES ('s1', 't1', 'setup', 'plan', 'q', 3),
                       ('s2', 't2', 'setup', 'plan', 'q', 3);
             INSERT INTO twin_setup_goals (id, twin_id, slot, title, position)
                VALUES ('g1', 't1', 'identity', 'x', 0), ('g2', 't2', 'identity', 'x', 0);",
        )?;
        assert!(conn
            .execute(
                "INSERT INTO twin_setup_steps (id, twin_id, stage, origin, question, position)
                 VALUES ('s3', 't1', 'setup', 'plan', 'q', 3)",
                [],
            )
            .is_err());
        assert!(conn
            .execute(
                "INSERT INTO twin_setup_goals (id, twin_id, slot, title, position)
                 VALUES ('g3', 't1', 'tone', 'y', 0)",
                [],
            )
            .is_err());
        Ok(())
    }

    /// The CHECKs refuse a token outside each vocabulary.
    #[test]
    fn twin_setup_checks_refuse_unknown_tokens() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        seed_twin(&conn, "t1")?;
        insert_step(&conn, "s1", "answered")?;
        for bad in [
            "INSERT INTO twin_setup_plans (twin_id, status) VALUES ('t1', 'done')",
            "INSERT INTO twin_setup_goals (id, twin_id, slot, title, state)
             VALUES ('g1', 't1', 'identity', 'x', 'maybe')",
            // Distinct positions, so only the CHECK can be what refuses these.
            "INSERT INTO twin_setup_steps (id, twin_id, stage, origin, question, status, position)
             VALUES ('x1', 't1', 'setup', 'plan', 'q', 'pending', 10)",
            "INSERT INTO twin_setup_steps (id, twin_id, stage, origin, question, position)
             VALUES ('x2', 't1', 'setup', 'guess', 'q', 11)",
            "INSERT INTO twin_setup_steps (id, twin_id, stage, origin, kind, question, position)
             VALUES ('x3', 't1', 'setup', 'plan', 'riddle', 'q', 12)",
            "INSERT INTO twin_setup_offers (id, twin_id, step_id, origin, kind, value)
             VALUES ('o1', 't1', 's1', 'reconcile', 'avatar', 'v')",
            "INSERT INTO twin_setup_offers (id, twin_id, step_id, origin, kind, part, value)
             VALUES ('o2', 't1', 's1', 'sample', 'tone', 'length', 'v')",
        ] {
            assert!(conn.execute(bad, []).is_err(), "CHECK must refuse: {bad}");
        }
        Ok(())
    }

    /// Deleting the twin removes its plan, steps and offers (FK cascade).
    #[test]
    fn deleting_a_twin_cascades_to_its_plan() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        seed_twin(&conn, "t1")?;
        insert_step(&conn, "s1", "answered")?;
        conn.execute_batch(
            "INSERT INTO twin_setup_plans (twin_id) VALUES ('t1');
             INSERT INTO twin_setup_offers (id, twin_id, step_id, origin, kind, value)
                VALUES ('o1', 't1', 's1', 'reconcile', 'bio', 'v');
             DELETE FROM twin_profiles WHERE id = 't1';",
        )?;
        for table in ["twin_setup_plans", "twin_setup_steps", "twin_setup_offers"] {
            let n: i64 =
                conn.query_row(&format!("SELECT COUNT(*) AS n FROM {table}"), [], |r| {
                    r.get("n")
                })?;
            assert_eq!(n, 0, "{table} must cascade");
        }
        Ok(())
    }
}
