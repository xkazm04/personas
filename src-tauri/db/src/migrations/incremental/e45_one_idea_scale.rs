//! One scale for `effort`, `impact` and `risk`.
//!
//! Two scales reached these three columns and nothing reconciled them.
//! Measured on the operator's live database 2026-09-21:
//!
//! | producer | impact range | rows |
//! |---|---|---|
//! | `team_proposed` | 1-5 | 502 |
//! | `app-master` | 1-6 | 394 |
//! | the eight Idea-Scanner lenses | up to 7 | 55 |
//! | `scan_sweep` | up to 10 | 67 |
//!
//! `propose_backlog` documents 1-5 and gives every band a MEANING ("3 = touches
//! a route, a contract or a schema", "5 = unblocks a goal or a money path"),
//! and a project's mechanical triage rules accept or hold an item by reading
//! those numbers. `idea_scanner.rs:192` asks its model for `<1-10>`, and the
//! scan-sweep skill's JSONL grades out of ten too. **75 rows exceeded 5.**
//!
//! Left alone, a rank that compares producers compares unlike things: a
//! scanner's 5 is the middle of its range and a persona's 5 is the top of its
//! own. The chosen repair is the one the source-normalization discipline
//! prescribes — convert INTO the queue's scale at the boundary, explicitly and
//! reviewably, rather than carry two curves in one column and hope every reader
//! remembers. `BacklogSource::native_scale_max` declares each producer's curve
//! and `normalize_scale` applies the exchange rate at the one door from now on;
//! this migration applies the same arithmetic once to what is already stored.
//!
//! `ceil(v * 5 / 10)`, so 1,2 -> 1 · 3,4 -> 2 · 5,6 -> 3 · 7,8 -> 4 · 9,10 -> 5.
//! Monotone, top-to-top, and nothing folds to `0` — which matters because `0`
//! is precisely the value the absent-value convention exists to refuse.
//!
//! **This rewrites the operator's real scores, so it is deliberately narrow.**
//! Only rows whose producer actually graded out of ten are converted; a row
//! from a 1-5 producer is left exactly as filed, even when it is out of range
//! (two rows are, and they are clamped rather than divided — halving a score
//! its author meant on a 1-5 curve would corrupt it). The step probes its own
//! postcondition, so a crash resumes and a re-run cannot convert twice.
//!
//! Re-running after a human edits a score is safe for the same reason: the
//! ten-scale population is identified by `scan_type`, and once every one of its
//! rows is within 1-5 there is nothing left to match.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

/// The producers whose prompt asks for 1-10, by the `scan_type` they file under.
///
/// Spelled as `scan_type` rather than `origin` because that is what the rows
/// carried when they were written, and it is what `BacklogSource::from_token`
/// reads. The eight lenses are the closed set in `scan_agents.toml`; they all
/// collapse to `BacklogSource::IdeaScanner`, which is the variant that declares
/// a native scale of ten.
const TEN_SCALE_SCAN_TYPES: &str = "'scan_sweep', 'architecture-analyst', 'security-auditor', \
     'accessibility-checker', 'business-strategist', 'onboarding-designer', \
     'error-handler', 'test-strategist', 'ux-reviewer'";

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "dev_ideas.rescale_ten_point_producers",
            description:
                "Convert 1-10 scores into the queue's 1-5 scale (127 rows measured 2026-09-21)",
            already_applied: |conn| {
                if !has_table(conn, "dev_ideas")? {
                    return Ok(true);
                }
                // The postcondition: no ten-scale producer's row is still
                // outside 1-5. Not a marker - a marker would let a crash
                // between the UPDATE and the marker write convert twice.
                let remaining: i64 = conn.query_row(
                    &format!(
                        "SELECT COUNT(*) AS n FROM dev_ideas
                          WHERE scan_type IN ({TEN_SCALE_SCAN_TYPES})
                            AND (effort > 5 OR impact > 5 OR risk > 5)"
                    ),
                    [],
                    |r| r.get("n"),
                )?;
                Ok(remaining == 0)
            },
            apply: |conn| {
                // `(v + 1) / 2` is `ceil(v / 2)` for positive integers under
                // SQLite's truncating integer division. A NULL stays NULL: a
                // score nobody gave must not acquire one by passing through a
                // conversion.
                ddl_step(
                    conn,
                    &format!(
                        "UPDATE dev_ideas
                            SET effort = CASE WHEN effort IS NULL THEN NULL
                                              ELSE MIN(5, MAX(1, (effort + 1) / 2)) END,
                                impact = CASE WHEN impact IS NULL THEN NULL
                                              ELSE MIN(5, MAX(1, (impact + 1) / 2)) END,
                                risk   = CASE WHEN risk   IS NULL THEN NULL
                                              ELSE MIN(5, MAX(1, (risk   + 1) / 2)) END
                          WHERE scan_type IN ({TEN_SCALE_SCAN_TYPES})"
                    ),
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "dev_ideas.clamp_out_of_range_scores",
            description: "Clamp the few 1-5 producers' scores that landed above 5 (2 rows measured 2026-09-21)",
            already_applied: |conn| {
                if !has_table(conn, "dev_ideas")? {
                    return Ok(true);
                }
                let remaining: i64 = conn.query_row(
                    "SELECT COUNT(*) AS n FROM dev_ideas
                      WHERE effort > 5 OR impact > 5 OR risk > 5",
                    [],
                    |r| r.get("n"),
                )?;
                Ok(remaining == 0)
            },
            apply: |conn| {
                // Clamped, NOT divided. These came from a producer that grades
                // 1-5 (the App Master door refuses anything else at its own
                // entrance, `app_master_writeback.rs`), so a 6 is an author
                // meaning "the top" on a five-point curve and halving it to 3
                // would invent a middling score nobody assigned.
                ddl_step(
                    conn,
                    "UPDATE dev_ideas
                        SET effort = MIN(effort, 5),
                            impact = MIN(impact, 5),
                            risk   = MIN(risk, 5)
                      WHERE effort > 5 OR impact > 5 OR risk > 5",
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

    fn idea(conn: &Connection, id: &str, scan_type: &str, effort: i32, impact: i32, risk: i32) {
        conn.execute(
            "INSERT INTO dev_ideas (id, project_id, scan_type, category, title, description,
                                    status, effort, impact, risk, created_at, updated_at)
             VALUES (?1, NULL, ?2, 'technical', ?1, 'd', 'pending', ?3, ?4, ?5,
                     '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
            rusqlite::params![id, scan_type, effort, impact, risk],
        )
        .unwrap();
    }

    fn scores(conn: &Connection, id: &str) -> (Option<i32>, Option<i32>, Option<i32>) {
        conn.query_row(
            "SELECT effort, impact, risk FROM dev_ideas WHERE id = ?1",
            rusqlite::params![id],
            |r| Ok((r.get("effort")?, r.get("impact")?, r.get("risk")?)),
        )
        .unwrap()
    }

    /// The whole exchange rate, asserted at every fold point rather than at one
    /// convenient value.
    #[test]
    fn a_ten_point_score_folds_monotonically_onto_the_five_point_scale() {
        let conn = migrated_conn();
        for (n, v) in (1..=10).enumerate() {
            idea(&conn, &format!("i{n}"), "scan_sweep", v, v, v);
        }
        run(&conn).unwrap();

        let expected = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
        for (n, want) in expected.iter().enumerate() {
            assert_eq!(
                scores(&conn, &format!("i{n}")),
                (Some(*want), Some(*want), Some(*want)),
                "10-point value {} should fold to {want}",
                n + 1
            );
        }
    }

    /// Every lens collapses to the same producer and therefore the same curve.
    #[test]
    fn every_idea_scanner_lens_is_converted_not_just_the_one_we_thought_of() {
        let conn = migrated_conn();
        idea(&conn, "i-arch", "architecture-analyst", 8, 7, 9);
        idea(&conn, "i-ux", "ux-reviewer", 6, 10, 2);
        run(&conn).unwrap();

        assert_eq!(scores(&conn, "i-arch"), (Some(4), Some(4), Some(5)));
        assert_eq!(scores(&conn, "i-ux"), (Some(3), Some(5), Some(1)));
    }

    /// A 1-5 producer's row is NOT divided. This is the assertion that keeps the
    /// migration from corrupting the 502 rows it has no business touching.
    #[test]
    fn a_five_point_producers_score_is_left_exactly_as_filed() {
        let conn = migrated_conn();
        idea(&conn, "i-team", "team_proposed", 1, 5, 3);
        idea(&conn, "i-am", "app-master", 2, 4, 2);
        run(&conn).unwrap();

        assert_eq!(scores(&conn, "i-team"), (Some(1), Some(5), Some(3)));
        assert_eq!(scores(&conn, "i-am"), (Some(2), Some(4), Some(2)));
    }

    /// Out of range from a five-point producer is clamped, never halved.
    #[test]
    fn an_out_of_range_five_point_score_is_clamped_rather_than_divided() {
        let conn = migrated_conn();
        idea(&conn, "i-six", "app-master", 6, 6, 1);
        run(&conn).unwrap();

        assert_eq!(scores(&conn, "i-six"), (Some(5), Some(5), Some(1)));
    }

    /// A score nobody gave must not acquire one.
    #[test]
    fn a_null_score_stays_null() {
        let conn = migrated_conn();
        conn.execute(
            "INSERT INTO dev_ideas (id, project_id, scan_type, category, title, description,
                                    status, effort, impact, risk, created_at, updated_at)
             VALUES ('i-null', NULL, 'scan_sweep', 'technical', 't', 'd', 'pending',
                     NULL, 9, NULL, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
            [],
        )
        .unwrap();

        run(&conn).unwrap();

        assert_eq!(scores(&conn, "i-null"), (None, Some(5), None));
    }

    /// The postcondition probe, not a marker: a second pass must not halve
    /// anything twice, including a score a human has edited since.
    #[test]
    fn a_second_pass_does_not_convert_twice() {
        let conn = migrated_conn();
        idea(&conn, "i-ten", "scan_sweep", 10, 10, 10);
        run(&conn).unwrap();
        assert_eq!(scores(&conn, "i-ten"), (Some(5), Some(5), Some(5)));

        run(&conn).unwrap();
        assert_eq!(scores(&conn, "i-ten"), (Some(5), Some(5), Some(5)));
    }
}
