use crate::models::{DevKpi, DevKpiBinding, DevKpiMeasurement};
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, Row};

// ============================================================================
// KPIs (outcome layer above goals — docs/plans/kpi-driven-orchestration.md)
// ============================================================================

pub fn row_to_kpi(row: &Row) -> rusqlite::Result<DevKpi> {
    Ok(DevKpi {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        context_group_id: row.get("context_group_id")?,
        context_id: row.get("context_id").unwrap_or(None),
        use_case_id: row.get("use_case_id").unwrap_or(None),
        name: row.get("name")?,
        description: row.get("description")?,
        category: row.get("category")?,
        measure_kind: row.get("measure_kind")?,
        measure_config: row.get("measure_config")?,
        unit: row.get("unit")?,
        direction: row.get("direction")?,
        baseline_value: row.get("baseline_value")?,
        target_value: row.get("target_value")?,
        target_date: row.get("target_date")?,
        current_value: row.get("current_value")?,
        last_measured_at: row.get("last_measured_at")?,
        cadence: row.get("cadence")?,
        status: row.get("status")?,
        created_by: row.get("created_by")?,
        rationale: row.get("rationale")?,
        needed_connector: row.get("needed_connector")?,
        metric_type: row.get("metric_type").unwrap_or(None),
        tier: row.get("tier").unwrap_or_else(|_| "supporting".to_string()),
        warn_at: row.get("warn_at").unwrap_or(None),
        crit_at: row.get("crit_at").unwrap_or(None),
        manual_rating: row.get("manual_rating").unwrap_or(None),
        assessment_pros: row.get("assessment_pros").unwrap_or(None),
        assessment_cons: row.get("assessment_cons").unwrap_or(None),
        last_skip_at: row.get("last_skip_at").unwrap_or(None),
        last_skip_rationale: row.get("last_skip_rationale").unwrap_or(None),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_kpi_measurement(row: &Row) -> rusqlite::Result<DevKpiMeasurement> {
    Ok(DevKpiMeasurement {
        id: row.get("id")?,
        kpi_id: row.get("kpi_id")?,
        value: row.get("value")?,
        measured_at: row.get("measured_at")?,
        source: row.get("source")?,
        env: row.get("env")?,
        evidence: row.get("evidence")?,
        note: row.get("note")?,
    })
}

/// List a project's KPIs, optionally filtered by status. Active first, then
/// proposed (review queue), then paused/archived; newest within each band.
pub fn list_kpis(
    pool: &DbPool,
    project_id: &str,
    status: Option<&str>,
) -> Result<Vec<DevKpi>, AppError> {
    timed_query!("dev_kpis", "dev_kpis::list_kpis", {
        let conn = pool.get()?;
        let mut sql = String::from("SELECT * FROM dev_kpis WHERE project_id = ?1");
        if status.is_some() {
            sql.push_str(" AND status = ?2");
        }
        sql.push_str(
            " ORDER BY CASE status
                 WHEN 'active' THEN 0 WHEN 'proposed' THEN 1
                 WHEN 'paused' THEN 2 ELSE 3 END,
               created_at DESC",
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = match status {
            Some(st) => stmt.query_map(params![project_id, st], row_to_kpi)?,
            None => stmt.query_map(params![project_id], row_to_kpi)?,
        };
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn get_kpi(pool: &DbPool, id: &str) -> Result<DevKpi, AppError> {
    timed_query!("dev_kpis", "dev_kpis::get_kpi", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM dev_kpis WHERE id = ?1",
            params![id],
            row_to_kpi,
        )
        .map_err(|_| AppError::NotFound(format!("KPI {id} not found")))
    })
}

#[allow(clippy::too_many_arguments)]
pub fn create_kpi(
    pool: &DbPool,
    project_id: &str,
    name: &str,
    description: Option<&str>,
    context_group_id: Option<&str>,
    category: &str,
    measure_kind: &str,
    measure_config: &str,
    unit: &str,
    direction: &str,
    baseline_value: Option<f64>,
    target_value: Option<f64>,
    target_date: Option<&str>,
    cadence: &str,
    status: Option<&str>,
    created_by: &str,
    rationale: Option<&str>,
    needed_connector: Option<&str>,
    metric_type: Option<&str>,
    context_id: Option<&str>,
    use_case_id: Option<&str>,
) -> Result<DevKpi, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation("KPI name cannot be empty".into()));
    }
    timed_query!("dev_kpis", "dev_kpis::create_kpi", {
        let id = uuid::Uuid::new_v4().to_string();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_kpis (id, project_id, context_group_id, name, description,
                category, measure_kind, measure_config, unit, direction,
                baseline_value, target_value, target_date, cadence, status,
                created_by, rationale, needed_connector, metric_type, context_id, use_case_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)",
            params![
                id,
                project_id,
                context_group_id,
                name.trim(),
                description,
                category,
                measure_kind,
                measure_config,
                unit,
                direction,
                baseline_value,
                target_value,
                target_date,
                cadence,
                status.unwrap_or("proposed"),
                created_by,
                rationale,
                needed_connector,
                metric_type,
                context_id,
                use_case_id
            ],
        )?;
        drop(conn);
        get_kpi(pool, &id)
    })
}

/// Field-wise update; `Option<Option<...>>` distinguishes "leave unchanged"
/// from "set NULL" (mirrors update_goal).
#[allow(clippy::too_many_arguments)]
pub fn update_kpi(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    description: Option<Option<&str>>,
    context_group_id: Option<Option<&str>>,
    context_id: Option<Option<&str>>,
    category: Option<&str>,
    measure_kind: Option<&str>,
    measure_config: Option<&str>,
    unit: Option<&str>,
    direction: Option<&str>,
    baseline_value: Option<Option<f64>>,
    target_value: Option<Option<f64>>,
    target_date: Option<Option<&str>>,
    cadence: Option<&str>,
    status: Option<&str>,
    needed_connector: Option<Option<&str>>,
    metric_type: Option<Option<&str>>,
    tier: Option<&str>,
    use_case_id: Option<Option<&str>>,
) -> Result<DevKpi, AppError> {
    timed_query!("dev_kpis", "dev_kpis::update_kpi", {
        let conn = pool.get()?;
        // Build SET clause field-by-field (small N; clarity over cleverness).
        let mut sets: Vec<String> = vec!["updated_at = datetime('now')".into()];
        let mut vals: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        let push = |sets: &mut Vec<String>,
                    col: &str,
                    v: Box<dyn rusqlite::types::ToSql>,
                    vals: &mut Vec<Box<dyn rusqlite::types::ToSql>>| {
            vals.push(v);
            sets.push(format!("{col} = ?{}", vals.len()));
        };
        if let Some(v) = name {
            push(&mut sets, "name", Box::new(v.to_string()), &mut vals);
        }
        if let Some(v) = description {
            push(
                &mut sets,
                "description",
                Box::new(v.map(str::to_string)),
                &mut vals,
            );
        }
        if let Some(v) = context_group_id {
            push(
                &mut sets,
                "context_group_id",
                Box::new(v.map(str::to_string)),
                &mut vals,
            );
        }
        if let Some(v) = context_id {
            push(
                &mut sets,
                "context_id",
                Box::new(v.map(str::to_string)),
                &mut vals,
            );
        }
        if let Some(v) = use_case_id {
            push(
                &mut sets,
                "use_case_id",
                Box::new(v.map(str::to_string)),
                &mut vals,
            );
        }
        if let Some(v) = category {
            push(&mut sets, "category", Box::new(v.to_string()), &mut vals);
        }
        if let Some(v) = measure_kind {
            push(
                &mut sets,
                "measure_kind",
                Box::new(v.to_string()),
                &mut vals,
            );
        }
        if let Some(v) = measure_config {
            push(
                &mut sets,
                "measure_config",
                Box::new(v.to_string()),
                &mut vals,
            );
        }
        if let Some(v) = unit {
            push(&mut sets, "unit", Box::new(v.to_string()), &mut vals);
        }
        if let Some(v) = direction {
            push(&mut sets, "direction", Box::new(v.to_string()), &mut vals);
        }
        if let Some(v) = baseline_value {
            push(&mut sets, "baseline_value", Box::new(v), &mut vals);
        }
        if let Some(v) = target_value {
            push(&mut sets, "target_value", Box::new(v), &mut vals);
        }
        if let Some(v) = target_date {
            push(
                &mut sets,
                "target_date",
                Box::new(v.map(str::to_string)),
                &mut vals,
            );
        }
        if let Some(v) = cadence {
            push(&mut sets, "cadence", Box::new(v.to_string()), &mut vals);
        }
        if let Some(v) = status {
            push(&mut sets, "status", Box::new(v.to_string()), &mut vals);
        }
        if let Some(v) = needed_connector {
            push(
                &mut sets,
                "needed_connector",
                Box::new(v.map(str::to_string)),
                &mut vals,
            );
        }
        if let Some(v) = metric_type {
            push(
                &mut sets,
                "metric_type",
                Box::new(v.map(str::to_string)),
                &mut vals,
            );
        }
        if let Some(v) = tier {
            push(&mut sets, "tier", Box::new(v.to_string()), &mut vals);
        }
        let sql = format!(
            "UPDATE dev_kpis SET {} WHERE id = ?{}",
            sets.join(", "),
            vals.len() + 1
        );
        vals.push(Box::new(id.to_string()));
        let n = conn.execute(
            &sql,
            rusqlite::params_from_iter(vals.iter().map(|b| b.as_ref())),
        )?;
        if n == 0 {
            return Err(AppError::NotFound(format!("KPI {id} not found")));
        }
        drop(conn);
        get_kpi(pool, id)
    })
}

pub fn delete_kpi(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_kpis", "dev_kpis::delete_kpi", {
        let conn = pool.get()?;
        let n = conn.execute("DELETE FROM dev_kpis WHERE id = ?1", params![id])?;
        Ok(n > 0)
    })
}

/// Persist Factory-console calibration + assessment. Each field is COALESCEd, so
/// a partial save (only the fields the user just changed) preserves the rest.
#[allow(clippy::too_many_arguments)]
pub fn save_kpi_assessment(
    pool: &DbPool,
    id: &str,
    warn_at: Option<f64>,
    crit_at: Option<f64>,
    manual_rating: Option<i32>,
    pros: Option<&str>,
    cons: Option<&str>,
) -> Result<DevKpi, AppError> {
    timed_query!("dev_kpis", "dev_kpis::save_kpi_assessment", {
        let conn = pool.get()?;
        let n = conn.execute(
            "UPDATE dev_kpis SET
                warn_at = COALESCE(?2, warn_at),
                crit_at = COALESCE(?3, crit_at),
                manual_rating = COALESCE(?4, manual_rating),
                assessment_pros = COALESCE(?5, assessment_pros),
                assessment_cons = COALESCE(?6, assessment_cons),
                updated_at = datetime('now')
             WHERE id = ?1",
            params![id, warn_at, crit_at, manual_rating, pros, cons],
        )?;
        if n == 0 {
            return Err(AppError::NotFound(format!("KPI {id} not found")));
        }
        drop(conn);
        get_kpi(pool, id)
    })
}

/// All KPIs across every project (cross-project dashboard scope). Same
/// status ordering as `list_kpis`.
pub fn list_all_kpis(pool: &DbPool) -> Result<Vec<DevKpi>, AppError> {
    timed_query!("dev_kpis", "dev_kpis::list_all_kpis", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_kpis
             ORDER BY CASE status
                  WHEN 'active' THEN 0 WHEN 'proposed' THEN 1
                  WHEN 'paused' THEN 2 ELSE 3 END,
                created_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_kpi)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Bulk measurement history for a set of KPIs (trend charts) — newest-first
/// per KPI, bounded per KPI by `per_kpi` (applied client-side is wasteful;
/// a window function keeps the payload tight).
pub fn list_kpi_measurements_bulk(
    pool: &DbPool,
    kpi_ids: &[String],
    per_kpi: i64,
) -> Result<Vec<DevKpiMeasurement>, AppError> {
    if kpi_ids.is_empty() {
        return Ok(Vec::new());
    }
    timed_query!(
        "dev_kpi_measurements",
        "dev_kpis::list_kpi_measurements_bulk",
        {
            let conn = pool.get()?;
            let ph = kpi_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!(
                "SELECT * FROM (
                 SELECT m.*, ROW_NUMBER() OVER (
                     PARTITION BY kpi_id ORDER BY datetime(measured_at) DESC
                 ) AS rn
                 FROM dev_kpi_measurements m
                 WHERE kpi_id IN ({ph})
             ) WHERE rn <= ?
             ORDER BY datetime(measured_at) ASC"
            );
            let mut stmt = conn.prepare(&sql)?;
            let mut params: Vec<&dyn rusqlite::types::ToSql> = kpi_ids
                .iter()
                .map(|s| s as &dyn rusqlite::types::ToSql)
                .collect();
            params.push(&per_kpi);
            let rows =
                stmt.query_map(rusqlite::params_from_iter(params), row_to_kpi_measurement)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Newest-first measurement history (bounded).
pub fn list_kpi_measurements(
    pool: &DbPool,
    kpi_id: &str,
    limit: Option<i64>,
) -> Result<Vec<DevKpiMeasurement>, AppError> {
    timed_query!("dev_kpi_measurements", "dev_kpis::list_kpi_measurements", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_kpi_measurements WHERE kpi_id = ?1
             ORDER BY datetime(measured_at) DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(
            params![kpi_id, limit.unwrap_or(100)],
            row_to_kpi_measurement,
        )?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Record a measurement and roll the KPI's live state forward
/// (current_value + last_measured_at) in the same call.
pub fn record_kpi_measurement(
    pool: &DbPool,
    kpi_id: &str,
    value: f64,
    source: &str,
    evidence: Option<&str>,
    note: Option<&str>,
) -> Result<DevKpiMeasurement, AppError> {
    timed_query!(
        "dev_kpi_measurements",
        "dev_kpis::record_kpi_measurement",
        {
            let id = uuid::Uuid::new_v4().to_string();
            let conn = pool.get()?;
            conn.execute(
                "INSERT INTO dev_kpi_measurements (id, kpi_id, value, source, evidence, note)
             VALUES (?1,?2,?3,?4,?5,?6)",
                params![id, kpi_id, value, source, evidence, note],
            )?;
            let n = conn.execute(
                "UPDATE dev_kpis SET current_value = ?1, last_measured_at = datetime('now'),
                 updated_at = datetime('now')
             WHERE id = ?2",
                params![value, kpi_id],
            )?;
            if n == 0 {
                return Err(AppError::NotFound(format!("KPI {kpi_id} not found")));
            }
            conn.query_row(
                "SELECT * FROM dev_kpi_measurements WHERE id = ?1",
                params![id],
                row_to_kpi_measurement,
            )
            .map_err(AppError::Database)
        }
    )
}

/// Record a SIMULATED measurement (docs/plans/kpi-simulation-skill.md).
/// Deliberately does NOT roll `current_value`/`last_measured_at` forward —
/// simulated values are advisory series points and must never drive pace,
/// off-track derivation, or autopilot. `env` is restricted to the
/// non-production channels: a simulation never claims production.
pub fn record_kpi_simulation_measurement(
    pool: &DbPool,
    kpi_id: &str,
    value: f64,
    env: &str,
    evidence: Option<&str>,
    note: Option<&str>,
) -> Result<DevKpiMeasurement, AppError> {
    if !matches!(env, "local" | "test") {
        return Err(AppError::Validation(format!(
            "Simulation env must be 'local' or 'test', got '{env}' — simulated values never claim production"
        )));
    }
    timed_query!(
        "dev_kpi_measurements",
        "dev_kpis::record_kpi_simulation_measurement",
        {
            let id = uuid::Uuid::new_v4().to_string();
            let conn = pool.get()?;
            conn.execute(
                "INSERT INTO dev_kpi_measurements (id, kpi_id, value, source, env, evidence, note)
             VALUES (?1,?2,?3,'simulation',?4,?5,?6)",
                params![id, kpi_id, value, env, evidence, note],
            )?;
            conn.query_row(
                "SELECT * FROM dev_kpi_measurements WHERE id = ?1",
                params![id],
                row_to_kpi_measurement,
            )
            .map_err(AppError::Database)
        }
    )
}

/// Record an AI-COMPOSED measurement — the reading a Factory "measurement
/// setup" compose run produced by ACTUALLY RUNNING the command it had just
/// written.
///
/// Its own door, for the same reason `record_kpi_simulation_measurement` has
/// one: the class of a value is a property of the WRITER, not of a string the
/// caller happens to pass. Two invariants the generic recorder cannot enforce:
///
///  * `evidence` is REQUIRED. An evidence-free composed value is exactly the
///    row `ingest_kpi_sim` refuses; the compose run always holds the cmd/parse/
///    output that produced the number, so there is no honest case for dropping
///    it on the floor.
///  * `env` is written EXPLICITLY. The column defaults to `'production'`, so a
///    composed reading used to claim production by omission instead of by
///    decision. The command really did run against the project's working tree,
///    so `'production'` is the right answer — it is now stated rather than
///    inherited.
///
/// Unlike the simulation door this DOES roll `current_value` /
/// `last_measured_at` forward: it is a real measurement of the real repo, the
/// same act the evaluator performs.
pub fn record_kpi_compose_measurement(
    pool: &DbPool,
    kpi_id: &str,
    value: f64,
    evidence: &str,
    note: Option<&str>,
) -> Result<DevKpiMeasurement, AppError> {
    if !value.is_finite() {
        return Err(AppError::Validation(
            "AI-composed measurement value is not a finite number".into(),
        ));
    }
    if evidence.trim().is_empty() {
        return Err(AppError::Validation(
            "An AI-composed measurement must carry evidence — a value without provenance is refused"
                .into(),
        ));
    }
    timed_query!(
        "dev_kpi_measurements",
        "dev_kpis::record_kpi_compose_measurement",
        {
            let id = uuid::Uuid::new_v4().to_string();
            let conn = pool.get()?;
            conn.execute(
                "INSERT INTO dev_kpi_measurements (id, kpi_id, value, source, env, evidence, note)
                 VALUES (?1,?2,?3,'ai-compose','production',?4,?5)",
                params![id, kpi_id, value, evidence, note],
            )?;
            let n = conn.execute(
                "UPDATE dev_kpis SET current_value = ?1, last_measured_at = datetime('now'),
                     updated_at = datetime('now')
                 WHERE id = ?2",
                params![value, kpi_id],
            )?;
            if n == 0 {
                return Err(AppError::NotFound(format!("KPI {kpi_id} not found")));
            }
            conn.query_row(
                "SELECT * FROM dev_kpi_measurements WHERE id = ?1",
                params![id],
                row_to_kpi_measurement,
            )
            .map_err(AppError::Database)
        }
    )
}

// ============================================================================
// KPI connector bindings (P6 — swappable tool under a type-bound KPI)
// ============================================================================

fn row_to_kpi_binding(row: &Row) -> rusqlite::Result<DevKpiBinding> {
    Ok(DevKpiBinding {
        id: row.get("id")?,
        kpi_id: row.get("kpi_id")?,
        credential_id: row.get("credential_id")?,
        service_type: row.get("service_type")?,
        procedure: row.get("procedure")?,
        composed_by: row.get("composed_by")?,
        status: row.get("status")?,
        verified_at: row.get("verified_at")?,
        created_at: row.get("created_at")?,
    })
}

pub fn list_kpi_bindings(pool: &DbPool, kpi_id: &str) -> Result<Vec<DevKpiBinding>, AppError> {
    timed_query!("dev_kpi_bindings", "dev_kpis::list_kpi_bindings", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_kpi_bindings WHERE kpi_id = ?1 ORDER BY datetime(created_at) DESC",
        )?;
        let rows = stmt.query_map(params![kpi_id], row_to_kpi_binding)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn active_kpi_binding(pool: &DbPool, kpi_id: &str) -> Result<Option<DevKpiBinding>, AppError> {
    timed_query!("dev_kpi_bindings", "dev_kpis::active_kpi_binding", {
        let conn = pool.get()?;
        let row = conn
            .query_row(
                "SELECT * FROM dev_kpi_bindings WHERE kpi_id = ?1 AND status = 'active'
                 ORDER BY datetime(created_at) DESC LIMIT 1",
                params![kpi_id],
                row_to_kpi_binding,
            )
            .ok();
        Ok(row)
    })
}

/// Activate a verified binding: archive any current active binding, insert
/// the new one as active, and flip the KPI to a live connector KPI. The KPI
/// row's identity + measurement series are untouched (switch-without-harm).
pub fn activate_kpi_binding(
    pool: &DbPool,
    kpi_id: &str,
    credential_id: &str,
    service_type: &str,
    procedure: &str,
    composed_by: &str,
) -> Result<DevKpiBinding, AppError> {
    timed_query!("dev_kpi_bindings", "dev_kpis::activate_kpi_binding", {
        let id = uuid::Uuid::new_v4().to_string();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_kpi_bindings SET status = 'archived' WHERE kpi_id = ?1 AND status = 'active'",
            params![kpi_id],
        )?;
        conn.execute(
            "INSERT INTO dev_kpi_bindings (id, kpi_id, credential_id, service_type, procedure,
                composed_by, status, verified_at)
             VALUES (?1,?2,?3,?4,?5,?6,'active',datetime('now'))",
            params![
                id,
                kpi_id,
                credential_id,
                service_type,
                procedure,
                composed_by
            ],
        )?;
        conn.execute(
            "UPDATE dev_kpis SET measure_kind = 'connector', needed_connector = NULL,
                 updated_at = datetime('now')
             WHERE id = ?1",
            params![kpi_id],
        )?;
        conn.query_row(
            "SELECT * FROM dev_kpi_bindings WHERE id = ?1",
            params![id],
            row_to_kpi_binding,
        )
        .map_err(AppError::Database)
    })
}

pub fn set_kpi_binding_status(
    pool: &DbPool,
    binding_id: &str,
    status: &str,
) -> Result<(), AppError> {
    timed_query!("dev_kpi_bindings", "dev_kpis::set_kpi_binding_status", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_kpi_bindings SET status = ?1 WHERE id = ?2",
            params![status, binding_id],
        )?;
        Ok(())
    })
}
