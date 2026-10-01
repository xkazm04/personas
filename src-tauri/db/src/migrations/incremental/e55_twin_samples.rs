//! Twin learn-from-sample (spark `twin-portable-blueprint`).
//!
//! The user highlights or copies a piece of their own writing in the browser;
//! a background analysis turns it into PROPOSALS (an exemplar for its channel,
//! voice rules, a length hint, the eight style dims) that the user accepts in
//! the Hub. Nothing writes a tone field until a proposal is accepted.
//!
//! - `twin_samples` - one row per captured sample and the state of its
//!   analysis. The text is kept so a refused or failed sample can be shown
//!   back with its reason.
//! - `twin_sample_proposals` - what the analysis proposed, one row per change,
//!   resolved by the accept/dismiss door.
//! - `twin_setup_goals.last_why` - the assess pass's one-line reason for the
//!   goal's latest coverage move, so the training blueprint can say why an
//!   answer counted (the model already wrote it; the parser dropped it).
//!
//! Schema decisions worth naming:
//!
//! 1. **Both tables cascade from `twin_profiles`**, like every twin child
//!    table, and proposals also cascade from their sample.
//! 2. **The vocabularies carry CHECKs**, mirroring the `personas_core::models`
//!    `TwinSample` / `TwinSampleProposal` wire docs. Keep them identical.
//! 3. **Self-facts are NOT a proposal kind.** They go straight into
//!    `twin_pending_memories` (channel `sample`), whose review queue already
//!    exists; a second fact door would split one review into two.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "twin_samples",
            description: "Twin learn-from-sample: twin_samples - captured writing samples and their analysis state",
            already_applied: |conn| has_table(conn, "twin_samples"),
            apply: create_samples,
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "twin_sample_proposals",
            description:
                "Twin learn-from-sample: twin_sample_proposals - reviewed changes a sample proposed",
            already_applied: |conn| has_table(conn, "twin_sample_proposals"),
            apply: create_proposals,
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "twin_setup_goals_last_why",
            description: "Twin setup: twin_setup_goals.last_why - the assess pass's reason for the latest coverage move",
            // Guarded on the table too: a test DB built without the e47 tables
            // must not fail here (init_test_db drops tables).
            already_applied: |conn| {
                Ok(!has_table(conn, "twin_setup_goals")?
                    || has_column(conn, "twin_setup_goals", "last_why")?)
            },
            apply: add_last_why,
        },
    )
}

fn create_samples(conn: &Connection) -> Result<(), AppError> {
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS twin_samples (
            id           TEXT PRIMARY KEY NOT NULL,
            twin_id      TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
            text         TEXT NOT NULL,
            channel      TEXT,
            source_kind  TEXT NOT NULL CHECK (source_kind IN ('selection','clipboard','forge')),
            source_host  TEXT,
            status       TEXT NOT NULL DEFAULT 'analyzing'
                         CHECK (status IN ('analyzing','ready','failed','refused')),
            error        TEXT,
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            analyzed_at  TEXT
         );
         CREATE INDEX IF NOT EXISTS idx_twin_samples_twin_created
            ON twin_samples (twin_id, created_at DESC);",
    )?;
    Ok(())
}

fn create_proposals(conn: &Connection) -> Result<(), AppError> {
    ddl_step(
        conn,
        "CREATE TABLE IF NOT EXISTS twin_sample_proposals (
            id           TEXT PRIMARY KEY NOT NULL,
            sample_id    TEXT NOT NULL REFERENCES twin_samples(id) ON DELETE CASCADE,
            twin_id      TEXT NOT NULL REFERENCES twin_profiles(id) ON DELETE CASCADE,
            kind         TEXT NOT NULL
                         CHECK (kind IN ('exemplar','voice','constraint','length','dims')),
            channel      TEXT NOT NULL,
            value        TEXT NOT NULL,
            reason       TEXT,
            status       TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open','accepted','edited','dismissed')),
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            resolved_at  TEXT
         );
         CREATE INDEX IF NOT EXISTS idx_twin_sample_proposals_twin_status
            ON twin_sample_proposals (twin_id, status);
         CREATE INDEX IF NOT EXISTS idx_twin_sample_proposals_sample
            ON twin_sample_proposals (sample_id);",
    )?;
    Ok(())
}

fn add_last_why(conn: &Connection) -> Result<(), AppError> {
    ddl_step(
        conn,
        "ALTER TABLE twin_setup_goals ADD COLUMN last_why TEXT;",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Both tables, their indexes and the goal column land on a fresh
    /// database, and a replay is a no-op.
    #[test]
    fn twin_sample_tables_land_idempotently() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        for table in ["twin_samples", "twin_sample_proposals"] {
            assert!(has_table(&conn, table)?, "missing table {table}");
        }
        for index in [
            "idx_twin_samples_twin_created",
            "idx_twin_sample_proposals_twin_status",
            "idx_twin_sample_proposals_sample",
        ] {
            assert!(has_index(&conn, index)?, "missing index {index}");
        }
        if has_table(&conn, "twin_setup_goals")? {
            assert!(has_column(&conn, "twin_setup_goals", "last_why")?);
        }
        run(&conn)?;
        run(&conn)?;
        Ok(())
    }

    /// The CHECKs refuse a value outside each vocabulary.
    #[test]
    fn twin_sample_checks_refuse_unknown_vocabulary() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO twin_profiles (id, name, slug, obsidian_subpath) VALUES ('t1', 'T', 't', 'p/t')",
            [],
        )?;
        let bad_kind = conn.execute(
            "INSERT INTO twin_samples (id, twin_id, text, source_kind) VALUES ('s1', 't1', 'x', 'telepathy')",
            [],
        );
        assert!(bad_kind.is_err(), "source_kind CHECK must refuse");
        conn.execute(
            "INSERT INTO twin_samples (id, twin_id, text, source_kind) VALUES ('s1', 't1', 'x', 'clipboard')",
            [],
        )?;
        let bad_proposal = conn.execute(
            "INSERT INTO twin_sample_proposals (id, sample_id, twin_id, kind, channel, value)
             VALUES ('p1', 's1', 't1', 'fact', 'email', 'x')",
            [],
        );
        assert!(bad_proposal.is_err(), "kind CHECK must refuse 'fact'");
        Ok(())
    }
}
