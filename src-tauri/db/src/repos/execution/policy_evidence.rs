//! Self-Tuning Fabric v1 — read-only evidence aggregator.
//!
//! Joins `persona_executions` × `personas.template_category` (cost +
//! reliability), `lab_matrix_results` (quality), `dev_llm_spend` (calendar-
//! month spend) and the healing effectiveness ledger into one
//! [`PolicyEvidenceSnapshot`] for the pure proposal generator in
//! [`crate::policy_tuning`]. Strictly read-only over every source table —
//! the only thing this module ever writes is nothing.

use std::collections::HashMap;

use rusqlite::params;
use uuid::Uuid;

use crate::policy_tuning::{EvidenceCell, PolicyEvidenceSnapshot};
use crate::repos::execution::healing;
use crate::settings_keys::MONTHLY_COST_CEILING_USD;
use crate::DbPool;
use personas_core::error::AppError;

/// Aggregate the evidence snapshot over a trailing window (days; `None` = 30,
/// clamped to `1..=365`).
pub fn gather(pool: &DbPool, window_days: Option<i64>) -> Result<PolicyEvidenceSnapshot, AppError> {
    let window_days = window_days.unwrap_or(30).clamp(1, 365);
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(window_days)).to_rfc3339();

    // Healing effectiveness rides the same window (context evidence).
    let healing_report = healing::get_healing_effectiveness(pool, Some(window_days))?;

    let conn = pool.get()?;

    // -- Per-(category, model) execution cells -----------------------------
    let mut cells: Vec<EvidenceCell>;
    let lab: HashMap<String, (i64, f64)>;
    let spend_totals: (f64, i64);
    {
    let mut stmt = conn.prepare(
        "SELECT COALESCE(NULLIF(LOWER(p.template_category), ''), 'uncategorized') AS category,
                e.model_used AS model,
                COUNT(*) AS runs,
                SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) AS completed,
                AVG(COALESCE(e.cost_usd, 0)) AS avg_cost,
                SUM(COALESCE(e.cost_usd, 0)) AS total_cost,
                AVG(COALESCE(e.duration_ms, 0)) AS avg_dur
         FROM persona_executions e
         JOIN personas p ON p.id = e.persona_id
         WHERE e.model_used IS NOT NULL AND e.model_used != ''
           AND e.status IN ('completed', 'failed', 'incomplete', 'cancelled')
           AND e.created_at >= ?1
         GROUP BY category, model
         ORDER BY category ASC, runs DESC",
    )?;
    cells = stmt
        .query_map(params![cutoff], |row| {
            let runs: i64 = row.get("runs")?;
            let completed: i64 = row.get("completed")?;
            Ok(EvidenceCell {
                category: row.get("category")?,
                model: row.get("model")?,
                runs,
                completed,
                failed: runs - completed,
                success_rate: if runs > 0 {
                    completed as f64 / runs as f64
                } else {
                    0.0
                },
                avg_cost_usd: row.get("avg_cost")?,
                total_cost_usd: row.get("total_cost")?,
                avg_duration_ms: row.get("avg_dur")?,
                lab_samples: 0,
                avg_lab_quality: None,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // -- Per-model lab quality (matrix results, non-error, scored) ---------
    let mut stmt = conn.prepare(
        "SELECT model_id,
                COUNT(*) AS n,
                AVG(output_quality_score) AS q
         FROM lab_matrix_results
         WHERE output_quality_score IS NOT NULL
           AND status != 'error'
           AND created_at >= ?1
         GROUP BY model_id",
    )?;
    lab = stmt
        .query_map(params![cutoff], |row| {
            Ok((
                row.get::<_, String>("model_id")?,
                (row.get::<_, i64>("n")?, row.get::<_, f64>("q")?),
            ))
        })?
        .collect::<Result<HashMap<_, _>, _>>()?;

    // -- Calendar-month spend (budget-ceiling evidence) --------------------
    spend_totals = conn.query_row(
        "SELECT COALESCE(SUM(COALESCE(cost_usd, 0)), 0), COUNT(*)
         FROM dev_llm_spend
         WHERE created_at >= datetime('now', 'start of month')",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    }
    drop(conn);
    let (monthly_spend_usd, monthly_spend_rows) = spend_totals;
    for cell in &mut cells {
        if let Some((n, q)) = lab.get(&cell.model) {
            cell.lab_samples = *n;
            cell.avg_lab_quality = Some(*q);
        }
    }

    let monthly_ceiling_usd = crate::repos::core::settings::get(pool, MONTHLY_COST_CEILING_USD)
        .ok()
        .flatten()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .unwrap_or(0.0);

    Ok(PolicyEvidenceSnapshot {
        id: format!("polsnap_{}", Uuid::new_v4().simple()),
        window_days,
        generated_at: chrono::Utc::now().to_rfc3339(),
        cells,
        healing: healing_report,
        monthly_spend_usd,
        monthly_spend_rows,
        monthly_ceiling_usd,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn test_pool() -> DbPool {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:policy_evidence_testdb_{id}?mode=memory&cache=shared");
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder()
            .max_size(4)
            .build(manager)
            .expect("test pool build");
        {
            let conn = pool.get().expect("conn");
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::migrations::run(&conn).expect("initial migrations");
            crate::migrations::run_incremental(&conn).expect("incremental migrations");
        }
        pool
    }

    fn seed_persona(pool: &DbPool, id: &str, category: &str) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, template_category, created_at, updated_at)
             VALUES (?1, ?1, 'test', ?2, datetime('now'), datetime('now'))",
            params![id, category],
        )
        .unwrap();
    }

    fn seed_execution(pool: &DbPool, persona_id: &str, model: &str, status: &str, cost: f64) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO persona_executions
                (id, persona_id, status, model_used, cost_usd, duration_ms, created_at)
             VALUES (lower(hex(randomblob(8))), ?1, ?2, ?3, ?4, 1200, datetime('now'))",
            params![persona_id, status, model, cost],
        )
        .unwrap();
    }

    #[test]
    fn aggregates_cells_per_category_and_model() {
        let pool = test_pool();
        seed_persona(&pool, "p1", "Research");
        seed_persona(&pool, "p2", "Research");
        for _ in 0..3 {
            seed_execution(&pool, "p1", "opus", "completed", 0.6);
        }
        seed_execution(&pool, "p1", "opus", "failed", 0.6);
        seed_execution(&pool, "p2", "haiku", "completed", 0.05);
        // Non-terminal + model-less rows must not count.
        seed_execution(&pool, "p2", "haiku", "running", 0.05);
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO persona_executions (id, persona_id, status, created_at)
                 VALUES ('no-model', 'p1', 'completed', datetime('now'))",
                [],
            )
            .unwrap();
        }

        let snap = gather(&pool, Some(30)).unwrap();
        assert_eq!(snap.window_days, 30);
        assert_eq!(snap.cells.len(), 2);
        let opus = snap.cells.iter().find(|c| c.model == "opus").unwrap();
        assert_eq!(opus.category, "research"); // lowercased
        assert_eq!(opus.runs, 4);
        assert_eq!(opus.completed, 3);
        assert_eq!(opus.failed, 1);
        assert!((opus.success_rate - 0.75).abs() < 1e-9);
        assert!((opus.avg_cost_usd - 0.6).abs() < 1e-9);
        let haiku = snap.cells.iter().find(|c| c.model == "haiku").unwrap();
        assert_eq!(haiku.runs, 1); // 'running' excluded
        assert!(snap.id.starts_with("polsnap_"));
    }

    #[test]
    fn joins_lab_quality_and_month_spend() {
        let pool = test_pool();
        seed_persona(&pool, "p1", "dev");
        seed_execution(&pool, "p1", "sonnet", "completed", 0.2);
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO lab_matrix_runs (id, persona_id, status, user_instruction, created_at)
                 VALUES ('run1', 'p1', 'completed', 'test', datetime('now'))",
                [],
            )
            .unwrap();
            for (i, q) in [80, 90].iter().enumerate() {
                conn.execute(
                    "INSERT INTO lab_matrix_results
                        (id, run_id, variant, scenario_name, model_id, status,
                         output_quality_score, created_at)
                     VALUES (?1, 'run1', 'current', 's', 'sonnet', 'pass', ?2, datetime('now'))",
                    params![format!("r{i}"), q],
                )
                .unwrap();
            }
            // Error rows must not pollute quality.
            conn.execute(
                "INSERT INTO lab_matrix_results
                    (id, run_id, variant, scenario_name, model_id, status,
                     output_quality_score, created_at)
                 VALUES ('rerr', 'run1', 'current', 's', 'sonnet', 'error', 1, datetime('now'))",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO dev_llm_spend (id, source, trigger_kind, cost_usd, created_at)
                 VALUES ('sp1', 'test', 'manual', 12.5, datetime('now'))",
                [],
            )
            .unwrap();
        }

        let snap = gather(&pool, Some(30)).unwrap();
        let sonnet = snap.cells.iter().find(|c| c.model == "sonnet").unwrap();
        assert_eq!(sonnet.lab_samples, 2);
        assert!((sonnet.avg_lab_quality.unwrap() - 85.0).abs() < 1e-9);
        assert!((snap.monthly_spend_usd - 12.5).abs() < 1e-9);
        assert_eq!(snap.monthly_spend_rows, 1);
        assert!((snap.monthly_ceiling_usd - 0.0).abs() < f64::EPSILON);
    }
}
