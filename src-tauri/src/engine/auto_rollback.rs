//! Auto-rollback subscription: periodically checks personas with auto-rollback
//! enabled and reverts to the previous prompt version when the current version's
//! error rate exceeds 2x the previous version's rate.
//!
//! This is a Pro feature. The setting is persisted as `auto_rollback:<persona_id>`
//! in the `app_settings` table.

use serde::Serialize;
use tauri::Emitter;

use super::event_registry::event_name;
use crate::db::models::CreatePersonaEventInput;
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::core::settings;
use crate::db::repos::execution::metrics as metric_repo;
use crate::db::repos::core::personas as persona_repo;
use crate::db::settings_keys;
use crate::db::DbPool;

/// Tauri event payload emitted when an auto-rollback is triggered.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoRollbackEvent {
    pub persona_id: String,
    pub persona_name: String,
    pub from_version: i64,
    pub to_version: i64,
    pub current_error_rate: f64,
    pub previous_error_rate: f64,
}

/// Check all personas that have auto-rollback enabled and trigger rollback
/// when the current prompt version's error rate exceeds 2x the previous version's.
pub fn auto_rollback_tick(pool: &DbPool, app: &tauri::AppHandle) {
    // 1. Get all personas
    let personas = match persona_repo::get_all(pool) {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("Auto-rollback: failed to list personas: {}", e);
            return;
        }
    };

    let total_personas = personas.len();
    let mut checked: u32 = 0;
    let mut skipped: u32 = 0;
    let mut eligible: u32 = 0;
    let mut rolled_back: u32 = 0;

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

        checked += 1;

        // 3. Get prompt versions (need at least 2 to compare)
        let versions = match metric_repo::get_prompt_versions(pool, &persona.id, Some(5)) {
            Ok(v) => v,
            Err(e) => {
                tracing::debug!(
                    persona_id = %persona.id,
                    error = %e,
                    "Auto-rollback: skipping persona — failed to fetch prompt versions",
                );
                skipped += 1;
                continue;
            }
        };

        if versions.len() < 2 {
            tracing::debug!(
                persona_id = %persona.id,
                version_count = versions.len(),
                "Auto-rollback: skipping persona — need at least 2 versions to compare",
            );
            skipped += 1;
            continue;
        }

        // Use the version tagged "production" as current rather than the highest
        // version_number.  After a rollback the demoted version still has a higher
        // number but is tagged "experimental", so sorting by number alone would
        // re-select the demoted version every tick, causing an infinite loop.
        let mut versions = versions;
        versions.sort_by(|a, b| b.version_number.cmp(&a.version_number));

        let current_idx = match versions.iter().position(|v| v.tag == "production") {
            Some(i) => i,
            None => {
                tracing::debug!(
                    persona_id = %persona.id,
                    "Auto-rollback: skipping persona — no version tagged production",
                );
                skipped += 1;
                continue;
            }
        };

        let current = &versions[current_idx];

        // Previous = the highest-numbered version that isn't the current production one
        let previous = match versions.iter().find(|v| v.id != current.id) {
            Some(p) => p,
            None => {
                tracing::debug!(
                    persona_id = %persona.id,
                    "Auto-rollback: skipping persona — no non-production version to compare against",
                );
                skipped += 1;
                continue;
            }
        };

        tracing::debug!(
            persona_id = %persona.id,
            current_version = current.version_number,
            previous_version = previous.version_number,
            total_versions = versions.len(),
            "Auto-rollback: evaluating persona versions",
        );

        // 4. Get performance data to compute error rates per version
        let perf = match metric_repo::get_prompt_performance(pool, &persona.id, 30) {
            Ok(p) => p,
            Err(e) => {
                tracing::debug!(
                    persona_id = %persona.id,
                    error = %e,
                    "Auto-rollback: skipping persona — failed to fetch performance data",
                );
                skipped += 1;
                continue;
            }
        };

        // Find version deployment dates from markers
        let current_marker = perf.version_markers.iter().find(|m| m.version_number == current.version_number);
        let previous_marker = perf.version_markers.iter().find(|m| m.version_number == previous.version_number);

        let current_date = match current_marker {
            Some(m) => match m.created_at.get(..10) {
                Some(d) => d,
                None => {
                    tracing::warn!(
                        persona_id = %persona.id,
                        created_at = %m.created_at,
                        "Auto-rollback: skipping persona — truncated timestamp for current version marker",
                    );
                    skipped += 1;
                    continue;
                }
            },
            None => {
                tracing::debug!(
                    persona_id = %persona.id,
                    current_version = current.version_number,
                    "Auto-rollback: skipping persona — no deployment marker for current version",
                );
                skipped += 1;
                continue;
            }
        };
        let previous_date = match previous_marker {
            Some(m) => match m.created_at.get(..10) {
                Some(d) => d,
                None => {
                    tracing::warn!(
                        persona_id = %persona.id,
                        created_at = %m.created_at,
                        "Auto-rollback: skipping persona — truncated timestamp for previous version marker",
                    );
                    skipped += 1;
                    continue;
                }
            },
            None => match perf.daily_points.first() {
                Some(p) => p.date.as_str(),
                None => {
                    tracing::debug!(
                        persona_id = %persona.id,
                        previous_version = previous.version_number,
                        "Auto-rollback: skipping persona — no marker or data points for previous version",
                    );
                    skipped += 1;
                    continue;
                }
            },
        };

        // Compute error rates for each version's active period
        let current_points: Vec<_> = perf.daily_points.iter().filter(|p| p.date.as_str() >= current_date).collect();
        let previous_points: Vec<_> = perf.daily_points.iter().filter(|p| p.date.as_str() >= previous_date && p.date.as_str() < current_date).collect();

        if current_points.is_empty() || previous_points.is_empty() {
            tracing::debug!(
                persona_id = %persona.id,
                current_data_points = current_points.len(),
                previous_data_points = previous_points.len(),
                "Auto-rollback: skipping persona — insufficient data points for comparison",
            );
            skipped += 1;
            continue;
        }

        // Need at least a few data points for a meaningful comparison
        let total_current_executions: i64 = current_points.iter().map(|p| p.total_executions).sum();
        if total_current_executions < 3 {
            tracing::debug!(
                persona_id = %persona.id,
                total_current_executions,
                "Auto-rollback: skipping persona — fewer than 3 executions on current version",
            );
            skipped += 1;
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
        // Use a minimum threshold to avoid rolling back on noise (e.g. 0->0.01)
        let threshold = (previous_error_rate * 2.0).max(0.1);

        tracing::debug!(
            persona_id = %persona.id,
            current_version = current.version_number,
            previous_version = previous.version_number,
            current_error_rate = %format!("{:.2}%", current_error_rate * 100.0),
            previous_error_rate = %format!("{:.2}%", previous_error_rate * 100.0),
            threshold = %format!("{:.2}%", threshold * 100.0),
            current_data_points = current_points.len(),
            previous_data_points = previous_points.len(),
            total_current_executions,
            "Auto-rollback: computed error rates for version comparison",
        );

        if current_error_rate <= threshold {
            tracing::debug!(
                persona_id = %persona.id,
                current_error_rate = %format!("{:.2}%", current_error_rate * 100.0),
                threshold = %format!("{:.2}%", threshold * 100.0),
                "Auto-rollback: current version within threshold — no rollback needed",
            );
            eligible += 1;
            continue;
        }

        tracing::info!(
            persona_id = %persona.id,
            persona_name = %persona.name,
            current_version = current.version_number,
            previous_version = previous.version_number,
            current_error_rate = %format!("{:.1}%", current_error_rate * 100.0),
            previous_error_rate = %format!("{:.1}%", previous_error_rate * 100.0),
            threshold = %format!("{:.1}%", threshold * 100.0),
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
            rolled_back += 1;
            tracing::info!(
                persona_id = %persona.id,
                rolled_back_to = previous.version_number,
                "Auto-rollback: successfully rolled back to v{}",
                previous.version_number,
            );

            // Emit frontend notification so users discover the rollback
            let event = AutoRollbackEvent {
                persona_id: persona.id.clone(),
                persona_name: persona.name.clone(),
                from_version: current.version_number as i64,
                to_version: previous.version_number as i64,
                current_error_rate,
                previous_error_rate,
            };
            if let Err(e) = app.emit(event_name::AUTO_ROLLBACK_TRIGGERED, &event) {
                tracing::warn!(
                    persona_id = %persona.id,
                    error = %e,
                    "Auto-rollback: failed to emit frontend event",
                );
            }

            // Persist an audit trail entry in the event bus
            let detail = format!(
                "Auto-rolled back from v{} (error rate {:.1}%) to v{} (error rate {:.1}%)",
                current.version_number,
                current_error_rate * 100.0,
                previous.version_number,
                previous_error_rate * 100.0,
            );
            let _ = event_repo::publish(
                pool,
                CreatePersonaEventInput {
                    event_type: "auto_rollback".to_string(),
                    source_type: "system".to_string(),
                    project_id: None,
                    source_id: None,
                    target_persona_id: Some(persona.id.clone()),
                    payload: Some(detail),
                    use_case_id: None,
                },
            );
        }
    }

    tracing::info!(
        total_personas,
        checked,
        skipped,
        eligible,
        rolled_back,
        "Auto-rollback: tick complete",
    );
}

/// Perform the actual rollback -- mirrors the logic in observability.rs rollback_prompt_version.
/// All writes are wrapped in a single SQLite transaction so that a crash or error
/// cannot leave the persona in a half-rolled-back state.
///
/// Both prompt fields are restored atomically from the version snapshot: present
/// fields are written, absent fields are NULLed.  This prevents "Frankenstein"
/// personas where prompts come from two different versions that were never designed
/// to work together.
fn perform_rollback(pool: &DbPool, persona_id: &str, version_id: &str) -> Result<(), crate::error::AppError> {
    let version = metric_repo::get_prompt_version_by_id(pool, version_id)?;

    // Abort if the version has no prompt content at all — nothing to restore.
    let has_structured = version.structured_prompt.is_some();
    let has_system = version.system_prompt.is_some();

    if !has_structured && !has_system {
        tracing::error!(
            persona_id = %persona_id,
            version_id = %version_id,
            "Auto-rollback: aborting — rollback version has neither structured_prompt nor system_prompt",
        );
        return Err(crate::error::AppError::Validation(
            "Rollback version contains no prompt data".to_string(),
        ));
    }

    if has_structured != has_system {
        tracing::warn!(
            persona_id = %persona_id,
            version_id = %version_id,
            has_structured,
            has_system,
            "Auto-rollback: partial rollback — version only contains one prompt field; \
             the missing field will be cleared to avoid mixed-version prompts",
        );
    }

    let mut conn = pool.get()?;
    let tx = conn.transaction().map_err(crate::error::AppError::Database)?;
    let now = chrono::Utc::now().to_rfc3339();

    // Restore both fields atomically from the version snapshot.  Fields that
    // are None in the version are explicitly set to NULL so the persona never
    // ends up with prompts from two different versions.
    tx.execute(
        "UPDATE personas SET structured_prompt = ?1, system_prompt = ?2, updated_at = ?3 WHERE id = ?4",
        rusqlite::params![version.structured_prompt, version.system_prompt, now, persona_id],
    ).map_err(crate::error::AppError::Database)?;

    // Atomically demote ALL current production versions for this persona,
    // then promote the rollback target.  This avoids the race where
    // get_production_version() returns None (or a stale row) outside the
    // transaction, which would skip the demotion and leave two versions
    // tagged "production".
    tx.execute(
        "UPDATE persona_prompt_versions SET tag = 'experimental' \
         WHERE persona_id = ?1 AND tag = 'production' AND id != ?2",
        rusqlite::params![persona_id, version_id],
    ).map_err(crate::error::AppError::Database)?;

    tx.execute(
        "UPDATE persona_prompt_versions SET tag = ?1 WHERE id = ?2",
        rusqlite::params!["production", version_id],
    ).map_err(crate::error::AppError::Database)?;

    tx.commit().map_err(crate::error::AppError::Database)?;

    Ok(())
}
