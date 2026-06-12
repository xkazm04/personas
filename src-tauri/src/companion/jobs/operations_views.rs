//! Read-only named views over the operational store (`personas.db` / sys DB)
//! for the `operations_database` connector (B1 / direction 1).
//!
//! Athena's `personas_database` connector points at the companion brain DB, so
//! she could never read the *execution* store (executions / messages / reviews
//! / incidents / goals / KPIs) — every operational feature (fleet analysis,
//! daily brief) needed a bespoke Rust pre-gatherer. This module exposes those
//! tables as curated, parameterized, **read-only** views she can query
//! directly via `use_connector { capability: "query_operations", view, … }`.
//!
//! Safety: every view is a hand-written SELECT with bound parameters — no model
//! input is ever interpolated into SQL. Row counts are capped. There is no
//! mutation capability on this connector. Results are markdown tables; the
//! caller must treat any persona-authored content inside them as untrusted
//! data, never instructions (see the constitution's operations-data section).

use rusqlite::types::Value as SqlValue;
use rusqlite::Connection;
use serde_json::Value;

use crate::db::DbPool;
use crate::error::AppError;

/// Run one named view against the operational store. `args` carries the
/// view-specific parameters (all optional, all clamped). Unknown views return a
/// validation error naming the valid set.
pub fn run_view(pool: &DbPool, args: &Value) -> Result<String, AppError> {
    let view = args
        .get("view")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let conn = pool.get()?;
    match view {
        "executions_recent" => executions_recent(&conn, args),
        "cost_by_persona_day" => cost_by_persona_day(&conn, args),
        "messages_inbox" => messages_inbox(&conn, args),
        "reviews_pending" => reviews_pending(&conn, args),
        "incidents" => incidents(&conn, args),
        "goals_active" => goals_active(&conn, args),
        "kpis_latest" => kpis_latest(&conn, args),
        other => Err(AppError::Validation(format!(
            "unknown operations view `{other}`. Valid views: executions_recent, \
             cost_by_persona_day, messages_inbox, reviews_pending, incidents, \
             goals_active, kpis_latest"
        ))),
    }
}

// ── param helpers ────────────────────────────────────────────────────────

fn arg_i64(args: &Value, key: &str, default: i64, min: i64, max: i64) -> i64 {
    args.get(key)
        .and_then(|v| v.as_i64())
        .unwrap_or(default)
        .clamp(min, max)
}

fn arg_str<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn arg_bool(args: &Value, key: &str) -> bool {
    args.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

// ── result formatting ────────────────────────────────────────────────────

fn cell_to_string(v: SqlValue) -> String {
    match v {
        SqlValue::Null => String::new(),
        SqlValue::Integer(i) => i.to_string(),
        SqlValue::Real(f) => {
            let s = format!("{f:.4}");
            let trimmed = s.trim_end_matches('0').trim_end_matches('.');
            if trimmed.is_empty() { "0".to_string() } else { trimmed.to_string() }
        }
        SqlValue::Text(s) => s,
        SqlValue::Blob(_) => "<blob>".to_string(),
    }
}

fn format_markdown(headers: &[&str], rows: &[Vec<String>]) -> String {
    if rows.is_empty() {
        return "_(no matching rows)_".to_string();
    }
    let esc = |s: &str| s.replace('|', "\\|").replace('\n', " ");
    let mut out = String::with_capacity(64 + rows.len() * 48);
    out.push_str("| ");
    out.push_str(&headers.join(" | "));
    out.push_str(" |\n|");
    for _ in headers {
        out.push_str(" --- |");
    }
    out.push('\n');
    for r in rows {
        out.push_str("| ");
        out.push_str(&r.iter().map(|c| esc(c)).collect::<Vec<_>>().join(" | "));
        out.push_str(" |\n");
    }
    out.push_str(&format!("\n_{} row(s)._", rows.len()));
    out
}

/// Prepare `sql`, bind `binds` in order (anonymous `?` placeholders), read every
/// column generically, and render a markdown table with `headers`.
fn query_to_markdown(
    conn: &Connection,
    sql: &str,
    binds: &[SqlValue],
    headers: &[&str],
) -> Result<String, AppError> {
    let cols = headers.len();
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(binds.iter()), |row| {
            let mut cells = Vec::with_capacity(cols);
            for i in 0..cols {
                cells.push(cell_to_string(row.get::<_, SqlValue>(i)?));
            }
            Ok(cells)
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(format_markdown(headers, &rows))
}

// ── views ────────────────────────────────────────────────────────────────

fn executions_recent(conn: &Connection, args: &Value) -> Result<String, AppError> {
    let days = arg_i64(args, "days", 7, 1, 30);
    let limit = arg_i64(args, "limit", 25, 1, 50);
    let mut sql = String::from(
        "SELECT e.id, COALESCE(p.name, e.persona_id), e.status, COALESCE(e.cost_usd, 0), \
                COALESCE(e.duration_ms, 0), e.created_at, \
                substr(COALESCE(e.error_message, ''), 1, 200) \
         FROM persona_executions e LEFT JOIN personas p ON p.id = e.persona_id \
         WHERE e.created_at >= datetime('now', ?)",
    );
    let mut binds = vec![SqlValue::Text(format!("-{days} days"))];
    if let Some(status) = arg_str(args, "status") {
        sql.push_str(" AND e.status = ?");
        binds.push(SqlValue::Text(status.to_string()));
    }
    if let Some(persona) = arg_str(args, "persona") {
        sql.push_str(" AND p.name LIKE ?");
        binds.push(SqlValue::Text(format!("%{persona}%")));
    }
    sql.push_str(" ORDER BY e.created_at DESC LIMIT ?");
    binds.push(SqlValue::Integer(limit));
    query_to_markdown(
        conn,
        &sql,
        &binds,
        &["id", "persona", "status", "cost_usd", "duration_ms", "created_at", "error"],
    )
}

fn cost_by_persona_day(conn: &Connection, args: &Value) -> Result<String, AppError> {
    let days = arg_i64(args, "days", 30, 1, 90);
    let sql = "SELECT COALESCE(p.name, e.persona_id), date(e.created_at), \
                      COALESCE(SUM(e.cost_usd), 0), COUNT(*) \
               FROM persona_executions e LEFT JOIN personas p ON p.id = e.persona_id \
               WHERE e.created_at >= datetime('now', ?) \
               GROUP BY COALESCE(p.name, e.persona_id), date(e.created_at) \
               ORDER BY date(e.created_at) DESC, SUM(e.cost_usd) DESC LIMIT 200";
    let binds = [SqlValue::Text(format!("-{days} days"))];
    query_to_markdown(conn, sql, &binds, &["persona", "day", "cost_usd", "runs"])
}

fn messages_inbox(conn: &Connection, args: &Value) -> Result<String, AppError> {
    let days = arg_i64(args, "days", 7, 1, 30);
    let limit = arg_i64(args, "limit", 25, 1, 50);
    let mut sql = String::from(
        "SELECT id, COALESCE(NULLIF(title, ''), '(untitled)'), COALESCE(priority, 'normal'), \
                CASE WHEN COALESCE(is_read, 0) = 0 THEN 'unread' ELSE 'read' END, created_at \
         FROM persona_messages \
         WHERE created_at >= datetime('now', ?)",
    );
    let mut binds = vec![SqlValue::Text(format!("-{days} days"))];
    if arg_bool(args, "unread_only") {
        sql.push_str(" AND COALESCE(is_read, 0) = 0");
    }
    sql.push_str(" ORDER BY created_at DESC LIMIT ?");
    binds.push(SqlValue::Integer(limit));
    query_to_markdown(conn, &sql, &binds, &["id", "title", "priority", "read", "created_at"])
}

fn reviews_pending(conn: &Connection, args: &Value) -> Result<String, AppError> {
    let limit = arg_i64(args, "limit", 25, 1, 50);
    let sql = "SELECT r.id, COALESCE(p.name, r.persona_id), \
                      COALESCE(NULLIF(r.title, ''), '(untitled)'), COALESCE(r.severity, 'info'), \
                      r.created_at \
               FROM persona_manual_reviews r LEFT JOIN personas p ON p.id = r.persona_id \
               WHERE r.status = 'pending' ORDER BY r.created_at ASC LIMIT ?";
    let binds = [SqlValue::Integer(limit)];
    query_to_markdown(conn, sql, &binds, &["id", "persona", "title", "severity", "created_at"])
}

fn incidents(conn: &Connection, args: &Value) -> Result<String, AppError> {
    let days = arg_i64(args, "days", 30, 1, 90);
    let limit = arg_i64(args, "limit", 25, 1, 50);
    let mut sql = String::from(
        "SELECT id, severity, status, COALESCE(NULLIF(title, ''), '(untitled)'), \
                COALESCE(persona_name, ''), created_at \
         FROM audit_incidents \
         WHERE created_at >= datetime('now', ?)",
    );
    let mut binds = vec![SqlValue::Text(format!("-{days} days"))];
    if let Some(status) = arg_str(args, "status") {
        sql.push_str(" AND status = ?");
        binds.push(SqlValue::Text(status.to_string()));
    }
    sql.push_str(
        " ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 \
          WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC LIMIT ?",
    );
    binds.push(SqlValue::Integer(limit));
    query_to_markdown(
        conn,
        &sql,
        &binds,
        &["id", "severity", "status", "title", "persona", "created_at"],
    )
}

fn goals_active(conn: &Connection, _args: &Value) -> Result<String, AppError> {
    let sql = "SELECT g.id, g.project_id, g.title, g.status, COALESCE(g.progress, 0), \
                      (SELECT COALESCE(SUM(done), 0) FROM dev_goal_items WHERE goal_id = g.id), \
                      (SELECT COUNT(*) FROM dev_goal_items WHERE goal_id = g.id) \
               FROM dev_goals g \
               WHERE g.status IN ('open', 'in_progress', 'paused') \
               ORDER BY g.updated_at DESC LIMIT 50";
    query_to_markdown(
        conn,
        sql,
        &[],
        &["id", "project", "title", "status", "progress", "todos_done", "todos_total"],
    )
}

fn kpis_latest(conn: &Connection, _args: &Value) -> Result<String, AppError> {
    let sql = "SELECT k.id, k.name, COALESCE(k.unit, ''), k.current_value, k.target_value, \
                      k.status, k.last_measured_at \
               FROM dev_kpis k WHERE k.status = 'active' \
               ORDER BY k.last_measured_at DESC LIMIT 50";
    query_to_markdown(
        conn,
        sql,
        &[],
        &["id", "name", "unit", "current", "target", "status", "last_measured_at"],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use r2d2_sqlite::SqliteConnectionManager;

    fn ops_pool() -> DbPool {
        let manager = SqliteConnectionManager::memory();
        let pool = r2d2::Pool::builder().max_size(1).build(manager).expect("pool");
        pool.get()
            .unwrap()
            .execute_batch(
                "CREATE TABLE personas (id TEXT, name TEXT);
                 CREATE TABLE persona_executions (id TEXT, persona_id TEXT, status TEXT,
                    cost_usd REAL, duration_ms INTEGER, error_message TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')));
                 INSERT INTO personas VALUES ('p1','Dev Clone');
                 INSERT INTO persona_executions (id,persona_id,status,cost_usd,duration_ms)
                    VALUES ('e1','p1','completed',0.42,1500),('e2','p1','failed',0.01,200);",
            )
            .unwrap();
        pool
    }

    #[test]
    fn executions_recent_renders_table() {
        let pool = ops_pool();
        let out = run_view(&pool, &serde_json::json!({"view": "executions_recent", "days": 7})).unwrap();
        assert!(out.contains("Dev Clone"));
        assert!(out.contains("completed"));
        assert!(out.contains("0.42"));
        assert!(out.contains("2 row(s)"));
    }

    #[test]
    fn status_filter_and_unknown_view() {
        let pool = ops_pool();
        let only_failed =
            run_view(&pool, &serde_json::json!({"view": "executions_recent", "status": "failed"})).unwrap();
        assert!(only_failed.contains("1 row(s)"));
        assert!(only_failed.contains("failed"));

        let err = run_view(&pool, &serde_json::json!({"view": "nope"}));
        assert!(err.is_err());
    }
}
