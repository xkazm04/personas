use rusqlite::params;

use crate::db::models::{OAuthTokenLifetimeSummary, OAuthTokenMetric};
use crate::db::DbPool;
use crate::error::AppError;

/// Insert a new token refresh metric record.
#[allow(clippy::too_many_arguments)]
pub fn insert(
    pool: &DbPool,
    credential_id: &str,
    service_type: &str,
    predicted_lifetime_secs: Option<i64>,
    actual_lifetime_secs: Option<i64>,
    drift_secs: Option<i64>,
    used_fallback: bool,
    success: bool,
    error_message: Option<&str>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO oauth_token_metrics
         (id, credential_id, service_type, predicted_lifetime_secs, actual_lifetime_secs,
          drift_secs, used_fallback, success, error_message, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            id,
            credential_id,
            service_type,
            predicted_lifetime_secs,
            actual_lifetime_secs,
            drift_secs,
            used_fallback as i32,
            success as i32,
            error_message,
            now
        ],
    )?;
    Ok(())
}

/// Get recent token metrics for a credential, newest first.
pub fn get_by_credential(
    pool: &DbPool,
    credential_id: &str,
    limit: u32,
) -> Result<Vec<OAuthTokenMetric>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, credential_id, service_type, predicted_lifetime_secs, actual_lifetime_secs,
                drift_secs, used_fallback, success, error_message, created_at
         FROM oauth_token_metrics
         WHERE credential_id = ?1
         ORDER BY created_at DESC
         LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![credential_id, limit], |row| {
            Ok(OAuthTokenMetric {
                id: row.get(0)?,
                credential_id: row.get(1)?,
                service_type: row.get(2)?,
                predicted_lifetime_secs: row.get(3)?,
                actual_lifetime_secs: row.get(4)?,
                drift_secs: row.get(5)?,
                used_fallback: row.get::<_, i32>(6)? != 0,
                success: row.get::<_, i32>(7)? != 0,
                error_message: row.get(8)?,
                created_at: row.get(9)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// Compute an aggregated lifetime summary for a credential.
pub fn get_lifetime_summary(
    pool: &DbPool,
    credential_id: &str,
) -> Result<OAuthTokenLifetimeSummary, AppError> {
    let conn = pool.get()?;

    // Get the credential's service_type
    let service_type: String = conn
        .query_row(
            "SELECT service_type FROM persona_credentials WHERE id = ?1",
            params![credential_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "unknown".to_string());

    // Aggregate stats
    let (total_refreshes, fallback_count, failure_count, avg_predicted, avg_actual, avg_drift) = conn
        .query_row(
            "SELECT
                COUNT(*),
                SUM(CASE WHEN used_fallback = 1 THEN 1 ELSE 0 END),
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END),
                AVG(predicted_lifetime_secs),
                AVG(actual_lifetime_secs),
                AVG(drift_secs)
             FROM oauth_token_metrics
             WHERE credential_id = ?1",
            params![credential_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)? as u32,
                    row.get::<_, i64>(1).unwrap_or(0) as u32,
                    row.get::<_, i64>(2).unwrap_or(0) as u32,
                    row.get::<_, Option<f64>>(3)?,
                    row.get::<_, Option<f64>>(4)?,
                    row.get::<_, Option<f64>>(5)?,
                ))
            },
        )
        .unwrap_or((0, 0, 0, None, None, None));

    // Latest record
    let (latest_predicted, latest_actual) = conn
        .query_row(
            "SELECT predicted_lifetime_secs, actual_lifetime_secs
             FROM oauth_token_metrics
             WHERE credential_id = ?1 AND success = 1
             ORDER BY created_at DESC
             LIMIT 1",
            params![credential_id],
            |row| Ok((row.get::<_, Option<i64>>(0)?, row.get::<_, Option<i64>>(1)?)),
        )
        .unwrap_or((None, None));

    // Last 5 predicted lifetimes for trend detection
    let mut stmt = conn.prepare(
        "SELECT predicted_lifetime_secs
         FROM oauth_token_metrics
         WHERE credential_id = ?1 AND success = 1 AND predicted_lifetime_secs IS NOT NULL
         ORDER BY created_at DESC
         LIMIT 5",
    )?;
    let recent_predicted: Vec<i64> = stmt
        .query_map(params![credential_id], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    // Detect if lifetime is trending shorter: each value is smaller than its predecessor
    let lifetime_trending_shorter = if recent_predicted.len() >= 3 {
        // recent_predicted is newest-first; check if newest values are smaller
        recent_predicted
            .windows(2)
            .all(|w| w[0] <= w[1])
            && recent_predicted.first() < recent_predicted.last()
    } else {
        false
    };

    Ok(OAuthTokenLifetimeSummary {
        credential_id: credential_id.to_string(),
        service_type,
        total_refreshes,
        fallback_count,
        failure_count,
        avg_predicted_lifetime_secs: avg_predicted,
        avg_actual_lifetime_secs: avg_actual,
        avg_drift_secs: avg_drift,
        latest_predicted_lifetime_secs: latest_predicted,
        latest_actual_lifetime_secs: latest_actual,
        lifetime_trending_shorter,
        recent_predicted_lifetimes: recent_predicted,
    })
}

/// Delete metric entries older than the given number of days.
pub fn cleanup_old_entries(pool: &DbPool, retention_days: i64) -> Result<usize, AppError> {
    let conn = pool.get()?;
    let deleted = conn.execute(
        "DELETE FROM oauth_token_metrics WHERE created_at < datetime('now', ?1)",
        params![format!("-{retention_days} days")],
    )?;
    Ok(deleted)
}
