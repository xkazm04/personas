//! Living-agent data spine (spark `living-agent-core`, WP1).
//!
//! Promotes a persona's CHARACTER ("Core") to runtime data and adds the
//! responsibility / brain / attention tables:
//!
//! * `persona_responsibilities` — the standing charters a persona holds
//!   (outcomes, objectives, scope rung, cadence, tenure).
//! * `persona_episodes` — the append-only episodic record the brain
//!   consolidates from (excerpted bodies, content-hashed).
//! * `persona_memory_sources` — memory → episode provenance join.
//! * `persona_memory_tombstone` — forgotten fact keys. Deliberately FK-less
//!   (same doctrine as `memory_reaper_ledger`): a tombstone is the durable
//!   record that a fact must NOT come back, so no entity's deletion may be
//!   able to cascade away the record of its own forgetting.
//! * `persona_attention_ledger` — one row per attention/consolidation pass
//!   (verdict, consumed watermark, stats, cost).
//!
//! Plus three column widenings: `persona_memories.fact_key` (stable fact
//! identity for tombstone matching), `persona_prompt_versions.core_profile`
//! (Core travels with prompt history), and
//! `persona_memory_review_proposal.kind` (proposal family discriminator).

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "persona_responsibilities.table",
            description: "Create persona_responsibilities (living-agent charters)",
            already_applied: |conn| has_table(conn, "persona_responsibilities"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS persona_responsibilities (
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
                                           CHECK(source IN ('operator','kp-hire','migration')),
                        created_at         TEXT NOT NULL,
                        updated_at         TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_pr_persona
                        ON persona_responsibilities(persona_id, status);",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_episodes.table",
            description: "Create persona_episodes (living-agent episodic record)",
            already_applied: |conn| has_table(conn, "persona_episodes"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS persona_episodes (
                        id                TEXT PRIMARY KEY NOT NULL,
                        persona_id        TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
                        execution_id      TEXT,
                        responsibility_id TEXT,
                        role              TEXT NOT NULL,
                        source            TEXT NOT NULL DEFAULT '',
                        body_excerpt      TEXT NOT NULL,
                        file_path         TEXT,
                        content_hash      TEXT NOT NULL,
                        chars             INTEGER NOT NULL,
                        created_at        TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_pe_persona_created
                        ON persona_episodes(persona_id, created_at DESC);",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_memory_sources.table",
            description: "Create persona_memory_sources (memory -> episode provenance)",
            already_applied: |conn| has_table(conn, "persona_memory_sources"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS persona_memory_sources (
                        memory_id  TEXT NOT NULL REFERENCES persona_memories(id) ON DELETE CASCADE,
                        episode_id TEXT NOT NULL,
                        PRIMARY KEY(memory_id, episode_id)
                    );",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_memory_tombstone.table",
            description:
                "Create persona_memory_tombstone (forgotten fact keys; FK-less on purpose)",
            already_applied: |conn| has_table(conn, "persona_memory_tombstone"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS persona_memory_tombstone (
                        persona_id TEXT NOT NULL,
                        fact_key   TEXT NOT NULL,
                        reason     TEXT NOT NULL DEFAULT '',
                        created_at TEXT NOT NULL,
                        PRIMARY KEY(persona_id, fact_key)
                    );",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_memories.fact_key",
            description: "Add fact_key to persona_memories (stable fact identity)",
            already_applied: |conn| has_column(conn, "persona_memories", "fact_key"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_memories ADD COLUMN fact_key TEXT;",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_prompt_versions.core_profile",
            description:
                "Add core_profile to persona_prompt_versions (Core travels with prompt history)",
            already_applied: |conn| has_column(conn, "persona_prompt_versions", "core_profile"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_prompt_versions ADD COLUMN core_profile TEXT;",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_memory_review_proposal.kind",
            description: "Add kind to persona_memory_review_proposal (proposal family)",
            already_applied: |conn| has_column(conn, "persona_memory_review_proposal", "kind"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE persona_memory_review_proposal
                         ADD COLUMN kind TEXT NOT NULL DEFAULT 'memory_curation'
                         CHECK(kind IN ('memory_curation','self_model_diff'));",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "persona_attention_ledger.table",
            description: "Create persona_attention_ledger (attention/consolidation pass ledger)",
            already_applied: |conn| has_table(conn, "persona_attention_ledger"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS persona_attention_ledger (
                        id                TEXT PRIMARY KEY NOT NULL,
                        persona_id        TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
                        responsibility_id TEXT,
                        kind              TEXT NOT NULL CHECK(kind IN ('attention','consolidation')),
                        lane              TEXT,
                        verdict           TEXT NOT NULL,
                        reason            TEXT NOT NULL DEFAULT '',
                        consumed_through  TEXT,
                        stats_json        TEXT,
                        cost_usd          REAL,
                        started_at        TEXT NOT NULL,
                        completed_at      TEXT
                    );
                    CREATE INDEX IF NOT EXISTS idx_pal_persona
                        ON persona_attention_ledger(persona_id, started_at DESC);",
                )
            },
        },
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use personas_core::error::AppError;

    #[test]
    fn e16_is_idempotent_and_preserves_rows_on_rerun() -> Result<(), AppError> {
        // init_test_db runs the whole chain once (fresh install). Insert real
        // rows into every e16 object, then replay e16 twice more — the second
        // and third launches on the same database file. Nothing may error and
        // nothing may be rewritten.
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;

        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
             VALUES ('p1', 'test', 'sp', datetime('now'), datetime('now'))",
            [],
        )?;
        conn.execute_batch(
            "INSERT INTO persona_responsibilities
                (id, persona_id, title, created_at, updated_at)
                VALUES ('r1', 'p1', 'Keep the docs honest', datetime('now'), datetime('now'));
             INSERT INTO persona_episodes
                (id, persona_id, role, body_excerpt, content_hash, chars, created_at)
                VALUES ('e1', 'p1', 'assistant', 'excerpt', 'hash1', 7, datetime('now'));
             INSERT INTO persona_memories (id, persona_id, title, content, fact_key)
                VALUES ('m1', 'p1', 't', 'c', 'fact.key');
             INSERT INTO persona_memory_sources (memory_id, episode_id) VALUES ('m1', 'e1');
             INSERT INTO persona_memory_tombstone (persona_id, fact_key, created_at)
                VALUES ('p1', 'dead.key', datetime('now'));
             INSERT INTO persona_attention_ledger
                (id, persona_id, kind, verdict, started_at)
                VALUES ('a1', 'p1', 'attention', 'started', datetime('now'));",
        )?;

        super::run(&conn).expect("e16 second run");
        super::run(&conn).expect("e16 third run");

        for (table, expected) in [
            ("persona_responsibilities", 1i64),
            ("persona_episodes", 1),
            ("persona_memory_sources", 1),
            ("persona_memory_tombstone", 1),
            ("persona_attention_ledger", 1),
        ] {
            let n: i64 =
                conn.query_row(&format!("SELECT COUNT(*) AS n FROM {table}"), [], |r| {
                    r.get("n")
                })?;
            assert_eq!(n, expected, "{table} rows must survive the replay");
        }

        // The widened columns exist and hold data across the replay.
        let fact_key: Option<String> = conn.query_row(
            "SELECT fact_key FROM persona_memories WHERE id = 'm1'",
            [],
            |r| r.get("fact_key"),
        )?;
        assert_eq!(fact_key.as_deref(), Some("fact.key"));
        let kind_default: String = conn.query_row(
            "SELECT COALESCE(
                (SELECT kind FROM persona_memory_review_proposal LIMIT 1),
                'memory_curation') AS kind",
            [],
            |r| r.get("kind"),
        )?;
        assert_eq!(kind_default, "memory_curation");
        assert!(super::has_column(
            &conn,
            "persona_prompt_versions",
            "core_profile"
        )?);
        Ok(())
    }

    #[test]
    fn e16_status_check_and_kind_check_are_enforced() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
             VALUES ('p1', 'test', 'sp', datetime('now'), datetime('now'))",
            [],
        )?;
        assert!(
            conn.execute(
                "INSERT INTO persona_responsibilities
                    (id, persona_id, title, status, created_at, updated_at)
                    VALUES ('r-bad', 'p1', 't', 'zombie', datetime('now'), datetime('now'))",
                [],
            )
            .is_err(),
            "responsibility status outside the CHECK set must be refused",
        );
        assert!(
            conn.execute(
                "INSERT INTO persona_attention_ledger
                    (id, persona_id, kind, verdict, started_at)
                    VALUES ('a-bad', 'p1', 'daydream', 'started', datetime('now'))",
                [],
            )
            .is_err(),
            "ledger kind outside the CHECK set must be refused",
        );
        Ok(())
    }

    #[test]
    fn e16_cascade_delete_reaches_the_new_tables() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
             VALUES ('p1', 'test', 'sp', datetime('now'), datetime('now'))",
            [],
        )?;
        conn.execute_batch(
            "INSERT INTO persona_responsibilities
                (id, persona_id, title, created_at, updated_at)
                VALUES ('r1', 'p1', 't', datetime('now'), datetime('now'));
             INSERT INTO persona_episodes
                (id, persona_id, role, body_excerpt, content_hash, chars, created_at)
                VALUES ('e1', 'p1', 'assistant', 'x', 'h', 1, datetime('now'));
             INSERT INTO persona_attention_ledger
                (id, persona_id, kind, verdict, started_at)
                VALUES ('a1', 'p1', 'attention', 'started', datetime('now'));
             INSERT INTO persona_memory_tombstone (persona_id, fact_key, created_at)
                VALUES ('p1', 'k', datetime('now'));",
        )?;
        conn.execute("DELETE FROM personas WHERE id = 'p1'", [])?;
        for table in [
            "persona_responsibilities",
            "persona_episodes",
            "persona_attention_ledger",
        ] {
            let n: i64 =
                conn.query_row(&format!("SELECT COUNT(*) AS n FROM {table}"), [], |r| {
                    r.get("n")
                })?;
            assert_eq!(n, 0, "{table} must cascade on persona delete");
        }
        // Tombstones are FK-less BY DESIGN — they must survive the delete.
        let tombs: i64 = conn.query_row(
            "SELECT COUNT(*) AS n FROM persona_memory_tombstone",
            [],
            |r| r.get("n"),
        )?;
        assert_eq!(tombs, 1, "tombstones deliberately outlive their persona");
        Ok(())
    }
}
