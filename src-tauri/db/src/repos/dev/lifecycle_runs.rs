//! `dev_lifecycle_runs` - the append-only ledger of every command Lifecycle's
//! Measure ran (migration `e63_dev_lifecycle_runs`; read its header).
//!
//! One row per command per measure; the rows of one measure share a
//! `measure_id`. Nothing here updates or deletes a row: history is what the
//! median, the pass rate and the slow-gate regression are computed from.
//! Timestamps are RFC3339 UTC with fixed millisecond precision, so the
//! `finished_at` ordering the indexes serve is also the chronological one.

use rusqlite::{params, OptionalExtension};

use crate::models::{LifecycleGateKind, LifecycleRun, LifecycleRunOutcome};
use crate::query_builder::QueryBuilder;
use crate::DbPool;
use personas_core::error::AppError;

const RUN_COLUMNS: &str = "id, project_id, measure_id, command_id, command, kind, outcome, \
     exit_code, duration_ms, value_pct, first_error, head_sha, started_at, finished_at";

/// One row as stored; the enum columns are still text here.
struct RunRow {
    id: String,
    project_id: String,
    measure_id: String,
    command_id: String,
    command: String,
    kind: String,
    outcome: String,
    exit_code: Option<i32>,
    duration_ms: i64,
    value_pct: Option<f64>,
    first_error: Option<String>,
    head_sha: String,
    started_at: String,
    finished_at: String,
}

row_mapper!(row_to_run -> RunRow {
    id, project_id, measure_id, command_id, command, kind, outcome, exit_code, duration_ms,
    value_pct, first_error, head_sha, started_at, finished_at,
});

/// The `kind` column token (mirrors the migration's CHECK).
pub fn kind_token(kind: LifecycleGateKind) -> &'static str {
    match kind {
        LifecycleGateKind::Lint => "lint",
        LifecycleGateKind::Typecheck => "typecheck",
        LifecycleGateKind::Test => "test",
        LifecycleGateKind::Check => "check",
        LifecycleGateKind::Coverage => "coverage",
        LifecycleGateKind::Other => "other",
    }
}

fn parse_kind(s: &str) -> Option<LifecycleGateKind> {
    Some(match s {
        "lint" => LifecycleGateKind::Lint,
        "typecheck" => LifecycleGateKind::Typecheck,
        "test" => LifecycleGateKind::Test,
        "check" => LifecycleGateKind::Check,
        "coverage" => LifecycleGateKind::Coverage,
        "other" => LifecycleGateKind::Other,
        _ => return None,
    })
}

/// The `outcome` column token (mirrors the migration's CHECK).
pub fn outcome_token(outcome: LifecycleRunOutcome) -> &'static str {
    match outcome {
        LifecycleRunOutcome::Passed => "passed",
        LifecycleRunOutcome::Failed => "failed",
        LifecycleRunOutcome::DidNotRun => "did_not_run",
        LifecycleRunOutcome::Timeout => "timeout",
    }
}

fn parse_outcome(s: &str) -> Option<LifecycleRunOutcome> {
    Some(match s {
        "passed" => LifecycleRunOutcome::Passed,
        "failed" => LifecycleRunOutcome::Failed,
        "did_not_run" => LifecycleRunOutcome::DidNotRun,
        "timeout" => LifecycleRunOutcome::Timeout,
        _ => return None,
    })
}

impl RunRow {
    /// The CHECKs make an unknown token impossible on a real row; one that
    /// slipped past them anyway reads as `other` / `did_not_run` - never as a
    /// pass.
    fn into_run(self) -> LifecycleRun {
        LifecycleRun {
            kind: parse_kind(&self.kind).unwrap_or(LifecycleGateKind::Other),
            outcome: parse_outcome(&self.outcome).unwrap_or(LifecycleRunOutcome::DidNotRun),
            id: self.id,
            project_id: self.project_id,
            measure_id: self.measure_id,
            command_id: self.command_id,
            command: self.command,
            exit_code: self.exit_code,
            duration_ms: u32::try_from(self.duration_ms.max(0)).unwrap_or(u32::MAX),
            value_pct: self.value_pct,
            first_error: self.first_error,
            head_sha: self.head_sha,
            started_at: self.started_at,
            finished_at: self.finished_at,
        }
    }
}

/// Append one run with no captured output. The caller owns `id`,
/// `measure_id` and the timestamps.
pub fn append_run(pool: &DbPool, run: &LifecycleRun) -> Result<(), AppError> {
    append_run_with_output(pool, run, None)
}

/// Append one run and the tail of its output (`output_tail`, migration
/// `e64_lifecycle_run_output`): `None` = nothing captured, `Some("")` = the
/// command ran and printed nothing. The output never rides [`LifecycleRun`];
/// read it back with [`run_output`].
pub fn append_run_with_output(
    pool: &DbPool,
    run: &LifecycleRun,
    output: Option<&str>,
) -> Result<(), AppError> {
    timed_query!("dev_lifecycle_runs", "dev_lifecycle_runs::append_run", {
        let conn = pool.get()?;
        conn.execute(
            &format!(
                "INSERT INTO dev_lifecycle_runs ({RUN_COLUMNS}, output_tail)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)"
            ),
            params![
                run.id,
                run.project_id,
                run.measure_id,
                run.command_id,
                run.command,
                kind_token(run.kind),
                outcome_token(run.outcome),
                run.exit_code,
                i64::from(run.duration_ms),
                run.value_pct,
                run.first_error,
                run.head_sha,
                run.started_at,
                run.finished_at,
                output,
            ],
        )?;
        Ok(())
    })
}

struct OutputRow {
    output_tail: Option<String>,
}

row_mapper!(row_to_output -> OutputRow { output_tail });

/// The stored output of run `run_id`, only when it belongs to `project_id`.
/// `None` = no such run in that project; `Some(None)` = the run exists but
/// nothing was captured.
pub fn run_output(
    pool: &DbPool,
    project_id: &str,
    run_id: &str,
) -> Result<Option<Option<String>>, AppError> {
    timed_query!("dev_lifecycle_runs", "dev_lifecycle_runs::run_output", {
        let conn = pool.get()?;
        let row = conn
            .query_row(
                "SELECT output_tail FROM dev_lifecycle_runs WHERE id = ?1 AND project_id = ?2",
                params![run_id, project_id],
                row_to_output,
            )
            .optional()?;
        Ok(row.map(|r| r.output_tail))
    })
}

/// The newest `per_command` runs of EACH command of `kinds` (empty = every
/// kind) in one project, all merged newest first. Ties read in reverse
/// insertion order, as [`list_recent_measure_runs`] does.
pub fn list_runs_per_command(
    pool: &DbPool,
    project_id: &str,
    kinds: &[LifecycleGateKind],
    per_command: usize,
) -> Result<Vec<LifecycleRun>, AppError> {
    timed_query!(
        "dev_lifecycle_runs",
        "dev_lifecycle_runs::list_runs_per_command",
        {
            let kind_filter = if kinds.is_empty() {
                String::new()
            } else {
                let marks: Vec<String> = (0..kinds.len()).map(|i| format!("?{}", i + 3)).collect();
                format!(" AND kind IN ({})", marks.join(", "))
            };
            let conn = pool.get()?;
            let mut stmt = conn.prepare(&format!(
                "SELECT {RUN_COLUMNS} FROM (
                     SELECT {RUN_COLUMNS}, rowid AS rid, ROW_NUMBER() OVER (
                         PARTITION BY command_id
                         ORDER BY finished_at DESC, started_at DESC, rowid DESC) AS rn
                     FROM dev_lifecycle_runs WHERE project_id = ?1{kind_filter})
                 WHERE rn <= ?2
                 ORDER BY finished_at DESC, started_at DESC, rid DESC"
            ))?;
            let limit = i64::try_from(per_command).unwrap_or(i64::MAX);
            let mut values: Vec<Box<dyn rusqlite::ToSql>> =
                vec![Box::new(project_id.to_string()), Box::new(limit)];
            values.extend(
                kinds
                    .iter()
                    .map(|k| Box::new(kind_token(*k)) as Box<dyn rusqlite::ToSql>),
            );
            let rows = stmt
                .query_map(
                    rusqlite::params_from_iter(values.iter().map(|v| v.as_ref())),
                    row_to_run,
                )?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows.into_iter().map(RunRow::into_run).collect())
        }
    )
}

/// A filter over one project's runs. Empty `kinds` = every kind.
#[derive(Debug, Default, Clone)]
pub struct RunQuery<'a> {
    pub project_id: &'a str,
    pub kinds: &'a [LifecycleGateKind],
    pub command_id: Option<&'a str>,
    pub measure_id: Option<&'a str>,
    pub limit: Option<usize>,
}

/// Runs matching `q`, newest first.
pub fn list_runs(pool: &DbPool, q: &RunQuery<'_>) -> Result<Vec<LifecycleRun>, AppError> {
    timed_query!("dev_lifecycle_runs", "dev_lifecycle_runs::list_runs", {
        let mut qb = QueryBuilder::new();
        qb.where_eq("project_id", q.project_id.to_string());
        if !q.kinds.is_empty() {
            qb.where_in(
                "kind",
                q.kinds.iter().map(|k| kind_token(*k).to_string()).collect(),
            );
        }
        if let Some(c) = q.command_id {
            qb.where_eq("command_id", c.to_string());
        }
        if let Some(m) = q.measure_id {
            qb.where_eq("measure_id", m.to_string());
        }
        qb.order_by_multiple(&[("finished_at", "DESC"), ("started_at", "DESC")]);
        if let Some(n) = q.limit {
            qb.limit(i64::try_from(n).unwrap_or(i64::MAX));
        }
        let conn = pool.get()?;
        let sql = qb.build_select(&format!("SELECT {RUN_COLUMNS} FROM dev_lifecycle_runs"));
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(qb.params_ref().as_slice(), row_to_run)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows.into_iter().map(RunRow::into_run).collect())
    })
}

/// Every run of the project's newest `measures` measures (by each measure's
/// last `finished_at`), newest first; ties in reverse insertion order, so a
/// reader walking the list backwards sees one measure's runs as planned.
pub fn list_recent_measure_runs(
    pool: &DbPool,
    project_id: &str,
    measures: usize,
) -> Result<Vec<LifecycleRun>, AppError> {
    timed_query!(
        "dev_lifecycle_runs",
        "dev_lifecycle_runs::list_recent_measure_runs",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(&format!(
                "SELECT {RUN_COLUMNS} FROM dev_lifecycle_runs
                 WHERE project_id = ?1 AND measure_id IN (
                     SELECT measure_id FROM dev_lifecycle_runs WHERE project_id = ?1
                     GROUP BY measure_id ORDER BY MAX(finished_at) DESC LIMIT ?2)
                 ORDER BY finished_at DESC, started_at DESC, rowid DESC"
            ))?;
            let limit = i64::try_from(measures).unwrap_or(i64::MAX);
            let rows = stmt
                .query_map(params![project_id, limit], row_to_run)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows.into_iter().map(RunRow::into_run).collect())
        }
    )
}

/// The newest measure of a project: its id, the base tip it ran on and when
/// its last command finished. `None` when the project was never measured.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MeasureSummary {
    pub measure_id: String,
    pub head_sha: String,
    pub finished_at: String,
}

struct MeasureRow {
    measure_id: String,
    head_sha: String,
    finished_at: String,
}

row_mapper!(row_to_measure -> MeasureRow { measure_id, head_sha, finished_at });

pub fn latest_measure(pool: &DbPool, project_id: &str) -> Result<Option<MeasureSummary>, AppError> {
    timed_query!(
        "dev_lifecycle_runs",
        "dev_lifecycle_runs::latest_measure",
        {
            let conn = pool.get()?;
            let row = conn
                .query_row(
                    "SELECT measure_id, MAX(head_sha) AS head_sha, MAX(finished_at) AS finished_at
                 FROM dev_lifecycle_runs WHERE project_id = ?1
                 GROUP BY measure_id ORDER BY MAX(finished_at) DESC LIMIT 1",
                    params![project_id],
                    row_to_measure,
                )
                .optional()?;
            Ok(row.map(|r| MeasureSummary {
                measure_id: r.measure_id,
                head_sha: r.head_sha,
                finished_at: r.finished_at,
            }))
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::dev::projects::create_project;

    fn project(pool: &DbPool) -> Result<String, AppError> {
        Ok(create_project(
            pool,
            "lc-runs",
            "/tmp/lc-runs",
            None,
            None,
            None,
            None,
            None,
        )?
        .id)
    }

    fn run(
        project_id: &str,
        measure: &str,
        command_id: &str,
        kind: LifecycleGateKind,
        outcome: LifecycleRunOutcome,
        finished_at: &str,
    ) -> LifecycleRun {
        LifecycleRun {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: project_id.to_string(),
            measure_id: measure.to_string(),
            command_id: command_id.to_string(),
            command: format!("npm run {command_id}"),
            kind,
            outcome,
            exit_code: Some(0),
            duration_ms: 1200,
            value_pct: Some(71.5),
            first_error: None,
            head_sha: format!("sha-{measure}"),
            started_at: finished_at.to_string(),
            finished_at: finished_at.to_string(),
        }
    }

    #[test]
    fn a_run_round_trips_every_field() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let p = project(&pool)?;
        let mut r = run(
            &p,
            "m1",
            "coverage",
            LifecycleGateKind::Coverage,
            LifecycleRunOutcome::Timeout,
            "2026-10-08T10:00:00.000Z",
        );
        r.exit_code = None;
        r.first_error = Some("timed out after 600s".into());
        append_run(&pool, &r)?;
        let got = list_runs(
            &pool,
            &RunQuery {
                project_id: &p,
                ..Default::default()
            },
        )?;
        assert_eq!(got, vec![r]);
        Ok(())
    }

    #[test]
    fn filters_and_recent_measures_are_newest_first() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let p = project(&pool)?;
        use LifecycleGateKind as K;
        use LifecycleRunOutcome as O;
        append_run(
            &pool,
            &run(
                &p,
                "m1",
                "lint",
                K::Lint,
                O::Passed,
                "2026-10-01T00:00:00.000Z",
            ),
        )?;
        append_run(
            &pool,
            &run(
                &p,
                "m1",
                "test",
                K::Test,
                O::Failed,
                "2026-10-01T00:01:00.000Z",
            ),
        )?;
        append_run(
            &pool,
            &run(
                &p,
                "m2",
                "lint",
                K::Lint,
                O::Passed,
                "2026-10-02T00:00:00.000Z",
            ),
        )?;
        append_run(
            &pool,
            &run(
                &p,
                "m3",
                "lint",
                K::Lint,
                O::Failed,
                "2026-10-03T00:00:00.000Z",
            ),
        )?;

        let lint = list_runs(
            &pool,
            &RunQuery {
                project_id: &p,
                kinds: &[K::Lint],
                limit: Some(2),
                ..Default::default()
            },
        )?;
        assert_eq!(
            lint.iter()
                .map(|r| r.measure_id.as_str())
                .collect::<Vec<_>>(),
            ["m3", "m2"]
        );
        let by_measure = list_runs(
            &pool,
            &RunQuery {
                project_id: &p,
                measure_id: Some("m1"),
                ..Default::default()
            },
        )?;
        assert_eq!(by_measure.len(), 2);
        assert_eq!(by_measure[0].command_id, "test", "newest first");

        let recent = list_recent_measure_runs(&pool, &p, 2)?;
        assert!(recent.iter().all(|r| r.measure_id != "m1"));
        assert_eq!(recent.len(), 2);

        let latest = latest_measure(&pool, &p)?.expect("measured");
        assert_eq!(latest.measure_id, "m3");
        assert_eq!(latest.head_sha, "sha-m3");
        Ok(())
    }

    #[test]
    fn recent_measure_ties_read_in_reverse_insertion_order() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let p = project(&pool)?;
        let at = "2026-10-01T00:00:00.000Z";
        for id in ["a", "b", "c"] {
            let r = run(
                &p,
                "m1",
                id,
                LifecycleGateKind::Lint,
                LifecycleRunOutcome::DidNotRun,
                at,
            );
            append_run(&pool, &r)?;
        }
        let ids: Vec<String> = list_recent_measure_runs(&pool, &p, 1)?
            .into_iter()
            .map(|r| r.command_id)
            .collect();
        assert_eq!(ids, ["c", "b", "a"]);
        Ok(())
    }

    #[test]
    fn output_is_stored_apart_and_read_only_by_the_owning_project() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let p = project(&pool)?;
        let other = create_project(&pool, "other", "/tmp/other", None, None, None, None, None)?.id;
        let at = "2026-10-01T00:00:00.000Z";
        let ran = run(
            &p,
            "m1",
            "lint",
            LifecycleGateKind::Lint,
            LifecycleRunOutcome::Failed,
            at,
        );
        append_run_with_output(&pool, &ran, Some("--- stdout ---\nboom"))?;
        let silent = run(
            &p,
            "m1",
            "tsc",
            LifecycleGateKind::Typecheck,
            LifecycleRunOutcome::DidNotRun,
            at,
        );
        append_run(&pool, &silent)?;

        assert_eq!(
            run_output(&pool, &p, &ran.id)?,
            Some(Some("--- stdout ---\nboom".to_string()))
        );
        assert_eq!(run_output(&pool, &p, &silent.id)?, Some(None));
        assert_eq!(run_output(&pool, &other, &ran.id)?, None, "not its run");
        assert_eq!(run_output(&pool, &p, "no-such-run")?, None);
        // The list payload is unchanged by the column.
        let listed = list_runs(
            &pool,
            &RunQuery {
                project_id: &p,
                command_id: Some("lint"),
                ..Default::default()
            },
        )?;
        assert_eq!(listed, vec![ran]);
        Ok(())
    }

    #[test]
    fn runs_per_command_cap_each_command_not_the_total() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let p = project(&pool)?;
        use LifecycleGateKind as K;
        use LifecycleRunOutcome as O;
        // `lint` runs every measure (5x), `tsc` once long ago, `test` is another step.
        for i in 0..5 {
            let at = format!("2026-10-0{}T00:00:00.000Z", i + 2);
            append_run(
                &pool,
                &run(&p, &format!("m{i}"), "lint", K::Lint, O::Passed, &at),
            )?;
            append_run(
                &pool,
                &run(&p, &format!("m{i}"), "test", K::Test, O::Passed, &at),
            )?;
        }
        append_run(
            &pool,
            &run(
                &p,
                "m-old",
                "tsc",
                K::Typecheck,
                O::Failed,
                "2026-10-01T00:00:00.000Z",
            ),
        )?;

        let gate = list_runs_per_command(&pool, &p, &[K::Lint, K::Typecheck], 3)?;
        let ids: Vec<(&str, &str)> = gate
            .iter()
            .map(|r| (r.command_id.as_str(), r.measure_id.as_str()))
            .collect();
        assert_eq!(
            ids,
            [
                ("lint", "m4"),
                ("lint", "m3"),
                ("lint", "m2"),
                ("tsc", "m-old")
            ],
            "three newest lint runs, and the one tsc run survives the cap"
        );
        assert_eq!(list_runs_per_command(&pool, &p, &[], 1)?.len(), 3);
        assert!(list_runs_per_command(&pool, &p, &[K::Coverage], 30)?.is_empty());
        Ok(())
    }

    #[test]
    fn an_unmeasured_project_has_no_latest_measure() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let p = project(&pool)?;
        assert!(latest_measure(&pool, &p)?.is_none());
        assert!(list_recent_measure_runs(&pool, &p, 10)?.is_empty());
        Ok(())
    }
}
