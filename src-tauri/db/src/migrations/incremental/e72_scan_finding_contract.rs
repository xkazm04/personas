//! `scan-finding/1` reaches the backlog (spark backlog-scan-family, 2026-10-30).
//!
//! The scan-sweep skill and the lens-scan store now share ONE finding contract
//! (`ai-registry/docs/skill-clauses/finding-contract.md`): a stored `score` with
//! its breakdown, a lens that is never collapsed into a source, a per-lens MVP,
//! a reserve band, the model's predicted verdict recorded before a human sees
//! the item, and a proof object for anything that was built. Until this step the
//! door had nowhere to put any of it: `scan_type` was forced to `scan_sweep`, so
//! even the lens was lost, and every field past the three 1-5 scales was dropped.
//!
//! Two decision columns ride along because the autonomy ladder needs them: who
//! decided (`decided_by`, `machine:scan-sweep` for an L1 auto-triage) and when
//! (`decided_at`), plus `veto_until` - the 24 h window a machine decision is
//! shown with. `scan_trust_events` is the ladder's append-only transition log.
//!
//! Shape rules (census): one `run_step` per object, each probing the object it
//! creates; the only defaulted columns (`band`, `mvp`) are NOT NULL and carry a
//! CHECK over their closed set; everything else is an honest nullable with no
//! default, because the contract's absent-value rule is "unknown is NULL".

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

/// One `ALTER TABLE dev_ideas ADD COLUMN` step, probing its own column.
///
/// A macro rather than a loop because `IncrementalMigration` takes plain `fn`
/// pointers: a closure that captured the column name from a loop variable
/// would not coerce to one.
macro_rules! add_idea_column {
    ($conn:expr, $id:literal, $column:literal, $description:literal, $ddl:literal) => {
        run_step(
            $conn,
            IncrementalMigration {
                id: $id,
                description: $description,
                already_applied: |conn| {
                    Ok(!has_table(conn, "dev_ideas")? || has_column(conn, "dev_ideas", $column)?)
                },
                apply: |conn| ddl_step(conn, $ddl),
            },
        )?
    };
}

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    add_idea_column!(
        conn,
        "dev_ideas.lens",
        "lens",
        "Add lens to dev_ideas (the scan dimension that found the item; never collapsed into scan_type)",
        "ALTER TABLE dev_ideas ADD COLUMN lens TEXT;"
    );
    add_idea_column!(
        conn,
        "dev_ideas.impact_why",
        "impact_why",
        "Add impact_why to dev_ideas (the one-line reason for the impact number)",
        "ALTER TABLE dev_ideas ADD COLUMN impact_why TEXT;"
    );
    add_idea_column!(
        conn,
        "dev_ideas.confidence",
        "confidence",
        "Add confidence to dev_ideas (low | medium | high)",
        "ALTER TABLE dev_ideas ADD COLUMN confidence TEXT CHECK (confidence IN ('low','medium','high'));"
    );
    add_idea_column!(
        conn,
        "dev_ideas.score",
        "score",
        "Add score to dev_ideas (the producer's scan-score/1; consumers never recompute it)",
        "ALTER TABLE dev_ideas ADD COLUMN score REAL;"
    );
    add_idea_column!(
        conn,
        "dev_ideas.score_parts",
        "score_parts",
        "Add score_parts to dev_ideas (JSON breakdown that ships with the score)",
        "ALTER TABLE dev_ideas ADD COLUMN score_parts TEXT;"
    );
    add_idea_column!(
        conn,
        "dev_ideas.band",
        "band",
        "Add band to dev_ideas (ranked | reserve; reserve = verified but over the run cap)",
        "ALTER TABLE dev_ideas ADD COLUMN band TEXT NOT NULL DEFAULT 'ranked' CHECK (band IN ('ranked','reserve'));"
    );
    add_idea_column!(
        conn,
        "dev_ideas.mvp",
        "mvp",
        "Add mvp to dev_ideas (1 on the lens's top finding of its run)",
        "ALTER TABLE dev_ideas ADD COLUMN mvp INTEGER NOT NULL DEFAULT 0 CHECK (mvp IN (0,1));"
    );
    add_idea_column!(
        conn,
        "dev_ideas.mvp_rule",
        "mvp_rule",
        "Add mvp_rule to dev_ideas (top-score | override)",
        "ALTER TABLE dev_ideas ADD COLUMN mvp_rule TEXT CHECK (mvp_rule IN ('top-score','override'));"
    );
    add_idea_column!(
        conn,
        "dev_ideas.mvp_why",
        "mvp_why",
        "Add mvp_why to dev_ideas (required by the contract when mvp_rule = override)",
        "ALTER TABLE dev_ideas ADD COLUMN mvp_why TEXT;"
    );
    add_idea_column!(
        conn,
        "dev_ideas.predicted_verdict",
        "predicted_verdict",
        "Add predicted_verdict to dev_ideas (the model's shadow verdict: accept | reject | defer)",
        "ALTER TABLE dev_ideas ADD COLUMN predicted_verdict TEXT CHECK (predicted_verdict IN ('accept','reject','defer'));"
    );
    add_idea_column!(
        conn,
        "dev_ideas.predicted_why",
        "predicted_why",
        "Add predicted_why to dev_ideas (the precedent the prediction leaned on)",
        "ALTER TABLE dev_ideas ADD COLUMN predicted_why TEXT;"
    );
    add_idea_column!(
        conn,
        "dev_ideas.predicted_by",
        "predicted_by",
        "Add predicted_by to dev_ideas (<skill>@<version>:<model>)",
        "ALTER TABLE dev_ideas ADD COLUMN predicted_by TEXT;"
    );
    add_idea_column!(
        conn,
        "dev_ideas.size",
        "size",
        "Add size to dev_ideas (XS | S | M | L | XL)",
        "ALTER TABLE dev_ideas ADD COLUMN size TEXT CHECK (size IN ('XS','S','M','L','XL'));"
    );
    add_idea_column!(
        conn,
        "dev_ideas.routing",
        "routing",
        "Add routing to dev_ideas (JSON {lane,result,method,gate,disposition} - the producer's routing words)",
        "ALTER TABLE dev_ideas ADD COLUMN routing TEXT;"
    );
    add_idea_column!(
        conn,
        "dev_ideas.decided_by",
        "decided_by",
        "Add decided_by to dev_ideas (who passed the current verdict: Human, TriageRule, machine:scan-sweep, ...)",
        "ALTER TABLE dev_ideas ADD COLUMN decided_by TEXT;"
    );
    add_idea_column!(
        conn,
        "dev_ideas.decided_at",
        "decided_at",
        "Add decided_at to dev_ideas (when the current verdict was passed)",
        "ALTER TABLE dev_ideas ADD COLUMN decided_at TEXT;"
    );
    add_idea_column!(
        conn,
        "dev_ideas.veto_until",
        "veto_until",
        "Add veto_until to dev_ideas (end of the 24 h window a machine decision is shown with)",
        "ALTER TABLE dev_ideas ADD COLUMN veto_until TEXT;"
    );

    // --- the autonomy ladder's transition log -------------------------------
    //
    // Append-only by construction: two triggers refuse UPDATE and DELETE, so a
    // level can only ever be re-derived from the full history it was earned in.
    // No FK to dev_ideas or dev_projects - an idea deleted later must not erase
    // the evidence a slice was promoted or demoted on.
    run_step(
        conn,
        IncrementalMigration {
            id: "scan_trust_events.table",
            description: "Create scan_trust_events (append-only autonomy-ladder transitions per project x slice)",
            already_applied: |conn| has_table(conn, "scan_trust_events"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS scan_trust_events (
                         id         TEXT PRIMARY KEY NOT NULL,
                         project_id TEXT NOT NULL,
                         slice      TEXT NOT NULL,
                         from_level INTEGER NOT NULL CHECK (from_level BETWEEN 0 AND 3),
                         to_level   INTEGER NOT NULL CHECK (to_level BETWEEN 0 AND 3),
                         reason     TEXT NOT NULL,
                         agreement  REAL,
                         n          INTEGER,
                         idea_id    TEXT,
                         at         TEXT NOT NULL
                     );
                     CREATE INDEX IF NOT EXISTS idx_scan_trust_events_slice
                         ON scan_trust_events(project_id, slice, at);
                     CREATE TRIGGER IF NOT EXISTS scan_trust_events_no_update
                         BEFORE UPDATE ON scan_trust_events
                         BEGIN SELECT RAISE(ABORT, 'scan_trust_events is append-only'); END;
                     CREATE TRIGGER IF NOT EXISTS scan_trust_events_no_delete
                         BEFORE DELETE ON scan_trust_events
                         BEGIN SELECT RAISE(ABORT, 'scan_trust_events is append-only'); END;",
                )
            },
        },
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn migrated_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::migrations::run(&conn).unwrap();
        crate::migrations::run_incremental(&conn).unwrap();
        conn
    }

    #[test]
    fn the_chain_adds_every_contract_column_and_the_event_log() {
        let conn = migrated_conn();
        for column in [
            "lens",
            "impact_why",
            "confidence",
            "score",
            "score_parts",
            "band",
            "mvp",
            "mvp_rule",
            "mvp_why",
            "predicted_verdict",
            "predicted_why",
            "predicted_by",
            "size",
            "routing",
            "decided_by",
            "decided_at",
            "veto_until",
        ] {
            assert!(
                has_column(&conn, "dev_ideas", column).unwrap(),
                "dev_ideas.{column} missing after the chain"
            );
        }
        assert!(has_table(&conn, "scan_trust_events").unwrap());
        // A second pass is a no-op.
        run(&conn).unwrap();
    }

    #[test]
    fn an_omitting_insert_is_ranked_and_not_mvp_and_unscored() {
        let conn = migrated_conn();
        conn.execute(
            "INSERT INTO dev_ideas (id, scan_type, category, title, status, created_at, updated_at)
             VALUES ('i1', 'scan_sweep', 'technical', 't', 'pending', 'x', 'x')",
            [],
        )
        .unwrap();
        let (band, mvp, score): (String, i64, Option<f64>) = conn
            .query_row(
                "SELECT band, mvp, score FROM dev_ideas WHERE id = 'i1'",
                [],
                |r| Ok((r.get("band")?, r.get("mvp")?, r.get("score")?)),
            )
            .unwrap();
        assert_eq!(band, "ranked");
        assert_eq!(mvp, 0);
        assert_eq!(score, None, "unscored is NULL, never 0");
        assert!(conn
            .execute(
                "UPDATE dev_ideas SET band = 'elsewhere' WHERE id = 'i1'",
                []
            )
            .is_err());
    }

    #[test]
    fn trust_events_refuse_update_and_delete() {
        let conn = migrated_conn();
        conn.execute(
            "INSERT INTO scan_trust_events (id, project_id, slice, from_level, to_level, reason, at)
             VALUES ('e1', 'p', 'technical|perf|perf|S', 2, 1, 'reversal', 'now')",
            [],
        )
        .unwrap();
        assert!(conn
            .execute("UPDATE scan_trust_events SET to_level = 3", [])
            .is_err());
        assert!(conn.execute("DELETE FROM scan_trust_events", []).is_err());
    }
}
