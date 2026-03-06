//! Auto-rollback subscription: periodically checks personas with auto-rollback
//! enabled and reverts to the previous prompt version when the current version's
//! error rate exceeds 2x the previous version's rate.
//!
//! This is a Pro feature. The setting is persisted as `auto_rollback:<persona_id>`
//! in the `app_settings` table.

use crate::db::repos::core::settings;
use crate::db::repos::execution::metrics as metric_repo;
use crate::db::repos::core::personas as persona_repo;
use crate::db::settings_keys;
use crate::db::DbPool;

/// Check all personas that have auto-rollback enabled and trigger rollback
/// when the current prompt version's error rate exceeds 2x the previous version's.
pub fn auto_rollback_tick(pool: &DbPool) {
    // 1. Get all personas
    let personas = match persona_repo::get_all(pool) {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("Auto-rollback: failed to list personas: {}", e);
            return;
        }
    };

    for persona in &personas {
        // 2. Check if auto-rollback is enabled for this persona
        let key = format!("{}{}", settings_keys::AUTO_ROLLBACK_PREFIX, persona.id);
        let enabled = settings::get(pool, &key)
            .ok()
            .flatten()
            .map(|v| v == "true")
            .unwrap_or(false);

        if !enabled {
            continue;
        }

        // 3. Get prompt versions (need at least 2 to compare)
        let versions = match metric_repo::get_prompt_versions(pool, &persona.id, Some(5)) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if versions.len() < 2 {
            continue;
        }

        let sorted: Vec<_> = {
            let mut v = versions;
            v.sort_by(|a, b| b.version_number.cmp(&a.version_number));
            v
        };

        let current = &sorted[0];
        let previous = &sorted[1];

        // 4. Get performance data to compute error rates per version
        let perf = match metric_repo::get_prompt_performance(pool, &persona.id, 30) {
            Ok(p) => p,
            Err(_) => continue,
        };

        // Find version deployment dates from markers
        let current_marker = perf.version_markers.iter().find(|m| m.version_number == current.version_number);
        let previous_marker = perf.version_markers.iter().find(|m| m.version_number == previous.version_number);

        let current_date = match current_marker {
            Some(m) => &m.created_at[..10],
            None => continue,
        };
        let previous_date = match previous_marker {
            Some(m) => &m.created_at[..10],
            None => match perf.daily_points.first() {
                Some(p) => p.date.as_str(),
                None => continue,
            },
        };

        // Compute error rates for each version's active period
        let current_points: Vec<_> = perf.daily_points.iter().filter(|p| p.date.as_str() >= current_date).collect();
        let previous_points: Vec<_> = perf.daily_points.iter().filter(|p| p.date.as_str() >= previous_date && p.date.as_str() < current_date).collect();

        if current_points.is_empty() || previous_points.is_empty() {
            continue;
        }

        // Need at least a few data points for a meaningful comparison
        let total_current_executions: i64 = current_points.iter().map(|p| p.total_executions).sum();
        if total_current_executions < 3 {
            continue;
        }

        let current_error_rate: f64 = {
            let total = current_points.iter().map(|p| p.total_executions as f64).sum::<f64>();
            if total > 0.0 {
                current_points.iter().map(|p| p.error_rate * p.total_executions as f64).sum::<f64>() / total
            } else {
                0.0
            }
        };

        let previous_error_rate: f64 = {
            let total = previous_points.iter().map(|p| p.total_executions as f64).sum::<f64>();
            if total > 0.0 {
                previous_points.iter().map(|p| p.error_rate * p.total_executions as f64).sum::<f64>() / total
            } else {
                0.0
            }
        };

        // 5. Check if current error rate exceeds 2x the previous version's rate
        // Use a minimum threshold to avoid rolling back on noise (e.g. 0→0.01)
        let threshold = (previous_error_rate * 2.0).max(0.1);
        if current_error_rate <= threshold {
            continue;
        }

        tracing::info!(
            persona_id = %persona.id,
            persona_name = %persona.name,
            current_version = current.version_number,
            previous_version = previous.version_number,
            current_error_rate = %format!("{:.1}%", current_error_rate * 100.0),
            previous_error_rate = %format!("{:.1}%", previous_error_rate * 100.0),
            "Auto-rollback: current version error rate exceeds 2x threshold, rolling back",
        );

        // 6. Perform rollback to the previous version
        if let Err(e) = perform_rollback(pool, &persona.id, &previous.id) {
            tracing::error!(
                persona_id = %persona.id,
                error = %e,
                "Auto-rollback: rollback failed",
            );
        } else {
            tracing::info!(
                persona_id = %persona.id,
                rolled_back_to = previous.version_number,
                "Auto-rollback: successfully rolled back to v{}",
                previous.version_number,
            );
        }
    }
}

/// Perform the actual rollback — mirrors the logic in observability.rs rollback_prompt_version.
fn perform_rollback(pool: &DbPool, persona_id: &str, version_id: &str) -> Result<(), crate::error::AppError> {
    let version = metric_repo::get_prompt_version_by_id(pool, version_id)?;

    let conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();

    if let Some(ref sp) = version.structured_prompt {
        conn.execute(
            "UPDATE personas SET structured_prompt = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![sp, now, persona_id],
        )?;
    }
    if let Some(ref sys) = version.system_prompt {
        conn.execute(
            "UPDATE personas SET system_prompt = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![sys, now, persona_id],
        )?;
    }

    // Demote current production, promote rollback target
    if let Ok(Some(current_prod)) = metric_repo::get_production_version(pool, persona_id) {
        if current_prod.id != version_id {
            let _ = metric_repo::update_prompt_version_tag(pool, &current_prod.id, "experimental");
        }
    }
    metric_repo::update_prompt_version_tag(pool, version_id, "production")?;

    Ok(())
}
