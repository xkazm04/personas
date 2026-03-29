//! Scheduled performance digest.
//!
//! Periodically queries execution metrics, healing issues, credential health,
//! and cost data to produce a structured digest delivered via the existing
//! notification channel system (OS notification + Slack/Telegram/Email).

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use ts_rs::TS;

use crate::db::repos::core::settings;
use crate::db::DbPool;

// ---------------------------------------------------------------------------
// Digest configuration (persisted in app_settings as JSON)
// ---------------------------------------------------------------------------

/// User-configurable digest settings, stored as JSON under the
/// `performance_digest` app_settings key.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DigestConfig {
    /// Whether the digest is enabled.
    pub enabled: bool,
    /// Cadence: "daily" or "weekly".
    pub cadence: String,
    /// JSON array of notification channels (same format as persona notification_channels).
    /// When empty, only OS notifications are sent.
    #[serde(default)]
    pub channels: Option<String>,
}

impl Default for DigestConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            cadence: "weekly".to_string(),
            channels: None,
        }
    }
}

/// Load digest config from app_settings. Returns default (disabled) if unset.
pub fn load_config(pool: &DbPool) -> DigestConfig {
    settings::get(pool, crate::db::settings_keys::PERFORMANCE_DIGEST)
        .ok()
        .flatten()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

/// Persist digest config to app_settings.
pub fn save_config(pool: &DbPool, config: &DigestConfig) -> Result<(), crate::error::AppError> {
    let json = serde_json::to_string(config).map_err(|e| crate::error::AppError::Internal(e.to_string()))?;
    settings::set(pool, crate::db::settings_keys::PERFORMANCE_DIGEST, &json)
}

// ---------------------------------------------------------------------------
// Digest payload
// ---------------------------------------------------------------------------

/// A single persona's success rate with week-over-week trend.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DigestPersonaTrend {
    pub persona_id: String,
    pub persona_name: String,
    /// Success rate in the current period (0.0–1.0).
    pub success_rate: f64,
    /// Success rate in the previous period (0.0–1.0).
    pub prev_success_rate: f64,
    /// Change in success rate (current - previous).
    pub trend: f64,
    #[ts(type = "number")]
    pub total_executions: i64,
    pub total_cost: f64,
}

/// Top failure category with count.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DigestFailureCategory {
    pub category: String,
    #[ts(type = "number")]
    pub count: i64,
}

/// Credential health change entry.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DigestCredentialHealth {
    pub credential_name: String,
    pub status: String,
}

/// Anomaly highlight for the digest.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DigestAnomaly {
    pub metric: String,
    pub date: String,
    pub value: f64,
    pub baseline: f64,
    pub deviation_pct: f64,
}

/// The full performance digest payload.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceDigest {
    /// ISO 8601 timestamp when this digest was generated.
    pub generated_at: String,
    /// Period covered: "daily" or "weekly".
    pub period: String,
    /// Number of days covered (1 or 7).
    #[ts(type = "number")]
    pub period_days: i64,
    /// Total executions in the period.
    #[ts(type = "number")]
    pub total_executions: i64,
    #[ts(type = "number")]
    pub successful_executions: i64,
    #[ts(type = "number")]
    pub failed_executions: i64,
    /// Overall success rate (0.0–1.0).
    pub success_rate: f64,
    /// Previous period success rate for trend.
    pub prev_success_rate: f64,
    /// Total cost in the current period.
    pub total_cost: f64,
    /// Total cost in the previous period.
    pub prev_total_cost: f64,
    /// Projected monthly cost based on current burn rate.
    pub projected_monthly_cost: f64,
    /// Optional budget limit from settings.
    pub budget_limit: Option<f64>,
    /// Per-persona success rate trends.
    pub persona_trends: Vec<DigestPersonaTrend>,
    /// Top failure categories.
    pub top_failures: Vec<DigestFailureCategory>,
    /// Credential health changes.
    pub credential_health: Vec<DigestCredentialHealth>,
    /// Anomaly highlights.
    pub anomalies: Vec<DigestAnomaly>,
}

// ---------------------------------------------------------------------------
// Digest generation (queries existing tables)
// ---------------------------------------------------------------------------

/// Generate a performance digest for the given period.
pub fn generate_digest(pool: &DbPool, period_days: i64) -> PerformanceDigest {
    let now = chrono::Utc::now();
    let period = if period_days <= 1 { "daily" } else { "weekly" };

    // Current period summary
    let (total, success, failed, cost) = query_period_summary(pool, period_days);
    // Previous period summary (for trend)
    let (prev_total, prev_success, _prev_failed, prev_cost) = query_prev_period_summary(pool, period_days);

    let success_rate = if total > 0 { success as f64 / total as f64 } else { 0.0 };
    let prev_success_rate = if prev_total > 0 { prev_success as f64 / prev_total as f64 } else { 0.0 };

    // Projected monthly cost
    let daily_cost = if period_days > 0 { cost / period_days as f64 } else { 0.0 };
    let projected_monthly_cost = daily_cost * 30.0;

    let persona_trends = query_persona_trends(pool, period_days);
    let top_failures = query_top_failures(pool, period_days);
    let credential_health = query_credential_health(pool);
    let anomalies = query_anomalies(pool, period_days);

    PerformanceDigest {
        generated_at: now.to_rfc3339(),
        period: period.to_string(),
        period_days,
        total_executions: total,
        successful_executions: success,
        failed_executions: failed,
        success_rate,
        prev_success_rate,
        total_cost: cost,
        prev_total_cost: prev_cost,
        projected_monthly_cost,
        budget_limit: None,
        persona_trends,
        top_failures,
        credential_health,
        anomalies,
    }
}

fn query_period_summary(pool: &DbPool, days: i64) -> (i64, i64, i64, f64) {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return (0, 0, 0, 0.0),
    };
    conn.query_row(
        "SELECT
            COUNT(*),
            COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(cost_usd), 0.0)
         FROM persona_executions
         WHERE created_at >= datetime('now', ?1)",
        params![format!("-{days} days")],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )
    .unwrap_or((0, 0, 0, 0.0))
}

fn query_prev_period_summary(pool: &DbPool, days: i64) -> (i64, i64, i64, f64) {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return (0, 0, 0, 0.0),
    };
    conn.query_row(
        "SELECT
            COUNT(*),
            COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(cost_usd), 0.0)
         FROM persona_executions
         WHERE created_at >= datetime('now', ?1)
           AND created_at < datetime('now', ?2)",
        params![format!("-{} days", days * 2), format!("-{days} days")],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )
    .unwrap_or((0, 0, 0, 0.0))
}

fn query_persona_trends(pool: &DbPool, days: i64) -> Vec<DigestPersonaTrend> {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    // Current period per-persona
    let current_sql = "SELECT
            e.persona_id,
            COALESCE(p.name, e.persona_id) as persona_name,
            COUNT(*) as total,
            COALESCE(SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END), 0) as success,
            COALESCE(SUM(e.cost_usd), 0.0) as cost
         FROM persona_executions e
         LEFT JOIN personas p ON p.id = e.persona_id
         WHERE e.created_at >= datetime('now', ?1)
         GROUP BY e.persona_id
         ORDER BY total DESC
         LIMIT 20";

    let mut stmt = match conn.prepare(current_sql) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let current_rows: Vec<(String, String, i64, i64, f64)> = stmt
        .query_map(params![format!("-{days} days")], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
        })
        .ok()
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();

    // Previous period per-persona
    let prev_sql = "SELECT
            persona_id,
            COUNT(*) as total,
            COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as success
         FROM persona_executions
         WHERE created_at >= datetime('now', ?1)
           AND created_at < datetime('now', ?2)
         GROUP BY persona_id";

    let prev_map: std::collections::HashMap<String, (i64, i64)> = conn
        .prepare(prev_sql)
        .ok()
        .map(|mut s| {
            s.query_map(params![format!("-{} days", days * 2), format!("-{days} days")], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
            })
            .ok()
            .map(|rows| rows.filter_map(|r| r.ok()).map(|(id, t, s)| (id, (t, s))).collect())
            .unwrap_or_default()
        })
        .unwrap_or_default();

    current_rows
        .into_iter()
        .map(|(persona_id, persona_name, total, success, cost)| {
            let sr = if total > 0 { success as f64 / total as f64 } else { 0.0 };
            let (prev_total, prev_success) = prev_map.get(&persona_id).copied().unwrap_or((0, 0));
            let prev_sr = if prev_total > 0 { prev_success as f64 / prev_total as f64 } else { 0.0 };
            DigestPersonaTrend {
                persona_id,
                persona_name,
                success_rate: sr,
                prev_success_rate: prev_sr,
                trend: sr - prev_sr,
                total_executions: total,
                total_cost: cost,
            }
        })
        .collect()
}

fn query_top_failures(pool: &DbPool, days: i64) -> Vec<DigestFailureCategory> {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let sql = "SELECT
            COALESCE(category, 'unknown') as cat,
            COUNT(*) as cnt
         FROM persona_healing_issues
         WHERE created_at >= datetime('now', ?1)
         GROUP BY cat
         ORDER BY cnt DESC
         LIMIT 10";
    conn.prepare(sql)
        .ok()
        .map(|mut s| {
            s.query_map(params![format!("-{days} days")], |row| {
                Ok(DigestFailureCategory {
                    category: row.get(0)?,
                    count: row.get(1)?,
                })
            })
            .ok()
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
        })
        .unwrap_or_default()
}

fn query_credential_health(pool: &DbPool) -> Vec<DigestCredentialHealth> {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    // Report credentials that are expired or have recent issues
    let sql = "SELECT
            name,
            CASE
                WHEN status = 'expired' THEN 'expired'
                WHEN status = 'error' THEN 'error'
                ELSE 'healthy'
            END as health_status
         FROM persona_credentials
         WHERE status IN ('expired', 'error')
         LIMIT 10";
    conn.prepare(sql)
        .ok()
        .map(|mut s| {
            s.query_map([], |row| {
                Ok(DigestCredentialHealth {
                    credential_name: row.get(0)?,
                    status: row.get(1)?,
                })
            })
            .ok()
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
        })
        .unwrap_or_default()
}

fn query_anomalies(pool: &DbPool, days: i64) -> Vec<DigestAnomaly> {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    // Get daily cost data and detect anomalies via rolling average
    let sql = "SELECT
            DATE(created_at) as date,
            COALESCE(SUM(cost_usd), 0.0) as daily_cost
         FROM persona_executions
         WHERE created_at >= datetime('now', ?1)
         GROUP BY DATE(created_at)
         ORDER BY date ASC";

    let points: Vec<(String, f64)> = conn
        .prepare(sql)
        .ok()
        .map(|mut s| {
            s.query_map(params![format!("-{} days", days * 2)], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .ok()
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
        })
        .unwrap_or_default();

    let window = 5;
    let mut anomalies = Vec::new();

    for i in 0..points.len() {
        let value = points[i].1;
        if value == 0.0 {
            continue;
        }
        let start = i.saturating_sub(window);
        let preceding: Vec<f64> = (start..i).map(|j| points[j].1).collect();
        if preceding.is_empty() {
            continue;
        }
        let baseline = preceding.iter().sum::<f64>() / preceding.len() as f64;
        if baseline == 0.0 {
            continue;
        }
        let deviation_pct = ((value - baseline) / baseline) * 100.0;
        if deviation_pct > 100.0 {
            anomalies.push(DigestAnomaly {
                metric: "cost".to_string(),
                date: points[i].0.clone(),
                value,
                baseline,
                deviation_pct,
            });
        }
    }

    // Limit to top 5 anomalies
    anomalies.sort_by(|a, b| b.deviation_pct.partial_cmp(&a.deviation_pct).unwrap_or(std::cmp::Ordering::Equal));
    anomalies.truncate(5);
    anomalies
}

// ---------------------------------------------------------------------------
// Digest formatting & delivery
// ---------------------------------------------------------------------------

/// Format the digest as a human-readable text notification.
fn format_digest_text(digest: &PerformanceDigest) -> (String, String) {
    let title = format!(
        "Performance Digest ({})",
        if digest.period == "daily" { "Daily" } else { "Weekly" }
    );

    let mut body = String::new();

    // Summary
    let trend_arrow = if digest.success_rate > digest.prev_success_rate {
        "^"
    } else if digest.success_rate < digest.prev_success_rate {
        "v"
    } else {
        "="
    };
    body.push_str(&format!(
        "Executions: {} ({} ok, {} failed)\n",
        digest.total_executions, digest.successful_executions, digest.failed_executions
    ));
    body.push_str(&format!(
        "Success rate: {:.1}% {} (was {:.1}%)\n",
        digest.success_rate * 100.0,
        trend_arrow,
        digest.prev_success_rate * 100.0,
    ));

    // Cost
    let cost_trend = if digest.total_cost > digest.prev_total_cost { "^" } else if digest.total_cost < digest.prev_total_cost { "v" } else { "=" };
    body.push_str(&format!(
        "Cost: ${:.2} {} (was ${:.2}) | Projected: ${:.2}/mo\n",
        digest.total_cost, cost_trend, digest.prev_total_cost, digest.projected_monthly_cost,
    ));

    // Top persona trends (top 5)
    if !digest.persona_trends.is_empty() {
        body.push_str("\nAgent Trends:\n");
        for pt in digest.persona_trends.iter().take(5) {
            let arrow = if pt.trend > 0.01 { "^" } else if pt.trend < -0.01 { "v" } else { "=" };
            body.push_str(&format!(
                "  {} {:.0}% {} ({} runs, ${:.2})\n",
                pt.persona_name,
                pt.success_rate * 100.0,
                arrow,
                pt.total_executions,
                pt.total_cost,
            ));
        }
    }

    // Top failures
    if !digest.top_failures.is_empty() {
        body.push_str("\nTop Failures:\n");
        for f in digest.top_failures.iter().take(5) {
            body.push_str(&format!("  {} ({})\n", f.category, f.count));
        }
    }

    // Credential health
    if !digest.credential_health.is_empty() {
        body.push_str("\nCredential Issues:\n");
        for c in &digest.credential_health {
            body.push_str(&format!("  {} [{}]\n", c.credential_name, c.status));
        }
    }

    // Anomalies
    if !digest.anomalies.is_empty() {
        body.push_str("\nAnomalies:\n");
        for a in &digest.anomalies {
            body.push_str(&format!(
                "  {} on {}: {:.2} vs baseline {:.2} (+{:.0}%)\n",
                a.metric, a.date, a.value, a.baseline, a.deviation_pct,
            ));
        }
    }

    (title, body)
}

/// Generate and deliver the performance digest.
pub fn deliver_digest(pool: &DbPool, app: &AppHandle) {
    let config = load_config(pool);
    if !config.enabled {
        return;
    }

    let period_days = if config.cadence == "daily" { 1 } else { 7 };
    let digest = generate_digest(pool, period_days);

    // Skip sending if there were no executions
    if digest.total_executions == 0 {
        tracing::debug!("Skipping performance digest: no executions in period");
        return;
    }

    let (title, body) = format_digest_text(&digest);

    // OS notification
    crate::notifications::send(app, &title, &body);

    // External channels
    if let Some(ref channels_json) = config.channels {
        deliver_digest_to_channels(app, channels_json, &title, &body);
    }

    // Store last digest timestamp
    let _ = settings::set(
        pool,
        crate::db::settings_keys::PERFORMANCE_DIGEST_LAST,
        &chrono::Utc::now().to_rfc3339(),
    );

    tracing::info!(
        period = %config.cadence,
        total_executions = digest.total_executions,
        success_rate = %format!("{:.1}%", digest.success_rate * 100.0),
        "Performance digest delivered"
    );
}

/// Deliver digest notification to external channels (reuses notification infra).
fn deliver_digest_to_channels(app: &AppHandle, channels_json: &str, title: &str, body: &str) {
    // Parse channels using the same format as persona notification channels
    let channels: Vec<serde_json::Value> = match serde_json::from_str(channels_json) {
        Ok(ch) => ch,
        Err(_) => return,
    };
    if channels.is_empty() {
        return;
    }

    // Re-serialize and use the public notification infra
    // We create a synthetic channel list and call the low-level delivery
    let title = title.to_owned();
    let body = body.to_owned();
    let app = app.clone();
    let json = channels_json.to_owned();
    tokio::spawn(async move {
        crate::notifications::deliver_to_external_channels(&app, &json, &title, &body).await;
    });
}

// ---------------------------------------------------------------------------
// Digest subscription tick
// ---------------------------------------------------------------------------

/// Called by the DigestSubscription on each tick. Checks if a digest is due
/// and delivers it if so.
pub fn digest_tick(pool: &DbPool, app: &AppHandle) {
    let config = load_config(pool);
    if !config.enabled {
        return;
    }

    let interval_hours: i64 = if config.cadence == "daily" { 24 } else { 168 };

    // Check last digest timestamp
    let last_sent = settings::get(pool, crate::db::settings_keys::PERFORMANCE_DIGEST_LAST)
        .ok()
        .flatten();

    let should_send = match last_sent {
        Some(ts) => {
            match chrono::DateTime::parse_from_rfc3339(&ts) {
                Ok(last) => {
                    let elapsed = chrono::Utc::now().signed_duration_since(last.with_timezone(&chrono::Utc));
                    elapsed.num_hours() >= interval_hours
                }
                Err(_) => true, // Corrupted timestamp, send digest
            }
        }
        None => true, // Never sent
    };

    if should_send {
        deliver_digest(pool, app);
    }
}
