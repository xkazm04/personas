use crate::db::models::{AlertRule, CreateAlertRuleInput, FiredAlert, UpdateAlertRuleInput};
use crate::db::DbPool;
use crate::error::AppError;

/// List all alert rules, ordered by creation date.
pub fn list_alert_rules(db: &DbPool) -> Result<Vec<AlertRule>, AppError> {
    timed_query!("alert_rules", "alert_rules::list_alert_rules", {
        let conn = db.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, metric, operator, threshold, severity, persona_id, enabled, created_at, updated_at
             FROM alert_rules
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(AlertRule {
                id: row.get(0)?,
                name: row.get(1)?,
                metric: row.get(2)?,
                operator: row.get(3)?,
                threshold: row.get(4)?,
                severity: row.get(5)?,
                persona_id: row.get(6)?,
                enabled: row.get::<_, i32>(7)? != 0,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    })
}

/// Create a new alert rule.
pub fn create_alert_rule(db: &DbPool, input: CreateAlertRuleInput) -> Result<AlertRule, AppError> {
    timed_query!("alert_rules", "alert_rules::create_alert_rule", {
    let conn = db.get()?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let metric_str = input.metric.to_string();
    let operator_str = input.operator.to_string();
    let severity_str = input.severity.to_string();
    conn.execute(
        "INSERT INTO alert_rules (id, name, metric, operator, threshold, severity, persona_id, enabled, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            id,
            input.name,
            metric_str,
            operator_str,
            input.threshold,
            severity_str,
            input.persona_id,
            input.enabled as i32,
            now,
            now,
        ],
    )?;
    Ok(AlertRule {
        id,
        name: input.name,
        metric: metric_str,
        operator: operator_str,
        threshold: input.threshold,
        severity: severity_str,
        persona_id: input.persona_id,
        enabled: input.enabled,
        created_at: now.clone(),
        updated_at: now,
    })
    })
}

/// Update an existing alert rule.
pub fn update_alert_rule(db: &DbPool, id: &str, input: UpdateAlertRuleInput) -> Result<AlertRule, AppError> {
    timed_query!("alert_rules", "alert_rules::update_alert_rule", {
    let conn = db.get()?;
    let now = chrono::Utc::now().to_rfc3339();

    // Build dynamic SET clause
    let mut sets = vec!["updated_at = ?1".to_string()];
    let mut idx = 2u32;
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now.clone())];

    if let Some(ref v) = input.name {
        sets.push(format!("name = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = input.metric {
        sets.push(format!("metric = ?{}", idx));
        params.push(Box::new(v.to_string()));
        idx += 1;
    }
    if let Some(ref v) = input.operator {
        sets.push(format!("operator = ?{}", idx));
        params.push(Box::new(v.to_string()));
        idx += 1;
    }
    if let Some(ref v) = input.severity {
        sets.push(format!("severity = ?{}", idx));
        params.push(Box::new(v.to_string()));
        idx += 1;
    }

    if let Some(ref v) = input.threshold {
        sets.push(format!("threshold = ?{}", idx));
        params.push(Box::new(*v));
        idx += 1;
    }
    if let Some(ref v) = input.persona_id {
        sets.push(format!("persona_id = ?{}", idx));
        params.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(v) = input.enabled {
        sets.push(format!("enabled = ?{}", idx));
        params.push(Box::new(v as i32));
        idx += 1;
    }

    let sql = format!(
        "UPDATE alert_rules SET {} WHERE id = ?{}",
        sets.join(", "),
        idx
    );
    params.push(Box::new(id.to_string()));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let changed = conn.execute(&sql, param_refs.as_slice())?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("Alert rule {} not found", id)));
    }

    // Re-read the updated row
    get_alert_rule(db, id)
    })
}

/// Get a single alert rule by ID.
pub fn get_alert_rule(db: &DbPool, id: &str) -> Result<AlertRule, AppError> {
    timed_query!("alert_rules", "alert_rules::get_alert_rule", {
        let conn = db.get()?;
        conn.query_row(
            "SELECT id, name, metric, operator, threshold, severity, persona_id, enabled, created_at, updated_at
             FROM alert_rules WHERE id = ?1",
            [id],
            |row| {
                Ok(AlertRule {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    metric: row.get(2)?,
                    operator: row.get(3)?,
                    threshold: row.get(4)?,
                    severity: row.get(5)?,
                    persona_id: row.get(6)?,
                    enabled: row.get::<_, i32>(7)? != 0,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )
        .map_err(|_| AppError::NotFound(format!("Alert rule {} not found", id)))
    })
}

/// Delete an alert rule by ID.
pub fn delete_alert_rule(db: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("alert_rules", "alert_rules::delete_alert_rule", {
        let conn = db.get()?;
        let changed = conn.execute("DELETE FROM alert_rules WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("Alert rule {} not found", id)));
        }
        Ok(())
    })
}

/// Toggle the enabled state of an alert rule.
pub fn toggle_alert_rule(db: &DbPool, id: &str) -> Result<AlertRule, AppError> {
    timed_query!("alert_rules", "alert_rules::toggle_alert_rule", {
        let conn = db.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let changed = conn.execute(
            "UPDATE alert_rules SET enabled = NOT enabled, updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("Alert rule {} not found", id)));
        }
        get_alert_rule(db, id)
    })
}

// ============================================================================
// Fired Alerts
// ============================================================================

/// List fired alerts, newest first. Limited to `limit` entries (default 200).
pub fn list_fired_alerts(db: &DbPool, limit: Option<i64>) -> Result<Vec<FiredAlert>, AppError> {
    timed_query!("alert_rules", "alert_rules::list_fired_alerts", {
        let conn = db.get()?;
        let max = limit.unwrap_or(200).clamp(1, 1000);
        let mut stmt = conn.prepare(
            "SELECT id, rule_id, rule_name, metric, severity, message, value, threshold, persona_id, fired_at, dismissed
             FROM fired_alerts
             ORDER BY fired_at DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map([max], |row| {
            Ok(FiredAlert {
                id: row.get(0)?,
                rule_id: row.get(1)?,
                rule_name: row.get(2)?,
                metric: row.get(3)?,
                severity: row.get(4)?,
                message: row.get(5)?,
                value: row.get(6)?,
                threshold: row.get(7)?,
                persona_id: row.get(8)?,
                fired_at: row.get(9)?,
                dismissed: row.get::<_, i32>(10)? != 0,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    })
}

/// Create a fired alert record.
pub fn create_fired_alert(db: &DbPool, alert: &FiredAlert) -> Result<(), AppError> {
    timed_query!("alert_rules", "alert_rules::create_fired_alert", {
        let conn = db.get()?;
        conn.execute(
            "INSERT INTO fired_alerts (id, rule_id, rule_name, metric, severity, message, value, threshold, persona_id, fired_at, dismissed)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                alert.id,
                alert.rule_id,
                alert.rule_name,
                alert.metric,
                alert.severity,
                alert.message,
                alert.value,
                alert.threshold,
                alert.persona_id,
                alert.fired_at,
                alert.dismissed as i32,
            ],
        )?;
        Ok(())
    })
}

/// Dismiss a fired alert.
pub fn dismiss_fired_alert(db: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("alert_rules", "alert_rules::dismiss_fired_alert", {
        let conn = db.get()?;
        let changed = conn.execute(
            "UPDATE fired_alerts SET dismissed = 1 WHERE id = ?1",
            [id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("Fired alert {} not found", id)));
        }
        Ok(())
    })
}

/// Clear all fired alert history.
pub fn clear_fired_alerts(db: &DbPool) -> Result<(), AppError> {
    timed_query!("alert_rules", "alert_rules::clear_fired_alerts", {
        let conn = db.get()?;
        conn.execute("DELETE FROM fired_alerts", [])?;
        Ok(())
    })
}
