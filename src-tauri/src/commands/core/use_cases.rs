//! Use-case (capability) management commands — Phase C3.
//!
//! Enables the UI to toggle capabilities on/off at runtime and to simulate
//! them without spilling outputs to real notification channels.
//!
//! See docs/concepts/persona-capabilities/02-use-case-as-capability.md.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::db::repos::core::personas as persona_repo;
use crate::db::models::PersonaExecution;
use crate::error::AppError;
use crate::ipc_auth::require_privileged;
use crate::AppState;

use self::testable::{build_simulation_input, cascade_use_case_toggle};

/// Pure helpers extracted from the IPC commands so the inline tests can
/// exercise cascade + simulation logic without constructing an `AppState`.
mod testable {
    use super::{AppError, UseCaseGenerationSettings, UseCaseToggleResult};

    /// Apply a capability toggle: patch `personas.design_context.useCases[i].enabled`
    /// and cascade into `persona_triggers`, `persona_event_subscriptions`, and
    /// `persona_automations`. Runs in a single transaction. Returns counts of
    /// rows updated for each linked table.
    ///
    /// Assumes the caller is responsible for any post-cascade work
    /// (session-pool invalidation, telemetry, etc.).
    pub fn cascade_use_case_toggle(
        conn: &mut rusqlite::Connection,
        persona_id: &str,
        use_case_id: &str,
        enabled: bool,
    ) -> Result<UseCaseToggleResult, AppError> {
        let now = chrono::Utc::now().to_rfc3339();

        // Read current design_context.
        let dc_str: Option<String> = conn
            .prepare("SELECT design_context FROM personas WHERE id = ?1")?
            .query_row(rusqlite::params![persona_id], |row| row.get(0))
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::Validation(format!("Persona '{}' not found", persona_id))
                }
                other => AppError::Database(other),
            })?;
        let dc_str = dc_str.ok_or_else(|| {
            AppError::Validation(format!(
                "Persona '{}' has no design_context", persona_id
            ))
        })?;

        let mut dc: serde_json::Value = serde_json::from_str(&dc_str)
            .map_err(|e| AppError::Validation(format!("design_context is not valid JSON: {}", e)))?;
        let use_cases = dc
            .get_mut("use_cases")
            .and_then(|v| v.as_array_mut())
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "Persona '{}' design_context has no use_cases array", persona_id
                ))
            })?;
        let mut found = false;
        for uc in use_cases.iter_mut() {
            let matches = uc.get("id").and_then(|v| v.as_str()) == Some(use_case_id);
            if matches {
                if let Some(obj) = uc.as_object_mut() {
                    obj.insert("enabled".to_string(), serde_json::Value::Bool(enabled));
                }
                found = true;
                break;
            }
        }
        if !found {
            return Err(AppError::Validation(format!(
                "use_case_id '{}' not found on persona '{}'",
                use_case_id, persona_id
            )));
        }
        let new_dc_str = serde_json::to_string(&dc)
            .map_err(|e| AppError::Validation(format!("failed to re-serialize design_context: {}", e)))?;

        let tx = conn.transaction().map_err(AppError::Database)?;

        tx.execute(
            "UPDATE personas SET design_context = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![new_dc_str, now, persona_id],
        )?;

        let trigger_status = if enabled { "active" } else { "paused" };
        let triggers_updated = tx.execute(
            "UPDATE persona_triggers
             SET enabled = ?1, status = ?2, updated_at = ?3
             WHERE persona_id = ?4 AND use_case_id = ?5",
            rusqlite::params![enabled as i64, trigger_status, now, persona_id, use_case_id],
        )? as usize;

        let subscriptions_updated = tx.execute(
            "UPDATE persona_event_subscriptions
             SET enabled = ?1, updated_at = ?2
             WHERE persona_id = ?3 AND use_case_id = ?4",
            rusqlite::params![enabled as i64, now, persona_id, use_case_id],
        )? as usize;

        // Pause runnable automations on disable; leave them paused on re-enable
        // so the user must explicitly reactivate (avoids accidentally restarting
        // an automation that was deliberately paused before the capability flip).
        let automations_updated = if enabled {
            0
        } else {
            tx.execute(
                "UPDATE persona_automations
                 SET deployment_status = 'paused', updated_at = ?1
                 WHERE persona_id = ?2 AND use_case_id = ?3
                   AND deployment_status IN ('running', 'active')",
                rusqlite::params![now, persona_id, use_case_id],
            )? as usize
        };

        tx.commit().map_err(AppError::Database)?;

        Ok(UseCaseToggleResult {
            enabled,
            triggers_updated,
            subscriptions_updated,
            automations_updated,
        })
    }

    /// Phase C5b — patch `design_context.use_cases[uc].generation_settings`
    /// with the supplied policy. Replaces any prior value for that capability.
    /// Returns the merged settings as stored. Pure DB write — no
    /// session-pool / cascade side-effects (caller does those).
    pub fn patch_generation_settings(
        conn: &rusqlite::Connection,
        persona_id: &str,
        use_case_id: &str,
        settings: &UseCaseGenerationSettings,
    ) -> Result<UseCaseGenerationSettings, AppError> {
        let dc_str: Option<String> = conn
            .prepare("SELECT design_context FROM personas WHERE id = ?1")?
            .query_row(rusqlite::params![persona_id], |row| row.get(0))
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::Validation(format!("Persona '{}' not found", persona_id))
                }
                other => AppError::Database(other),
            })?;
        let dc_str = dc_str.ok_or_else(|| {
            AppError::Validation(format!("Persona '{}' has no design_context", persona_id))
        })?;

        let mut dc: serde_json::Value = serde_json::from_str(&dc_str)
            .map_err(|e| AppError::Validation(format!("design_context is not valid JSON: {}", e)))?;
        let use_cases = dc
            .get_mut("use_cases")
            .and_then(|v| v.as_array_mut())
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "Persona '{}' design_context has no use_cases array",
                    persona_id
                ))
            })?;

        let mut found = false;
        let merged_value = serde_json::to_value(settings).map_err(|e| {
            AppError::Validation(format!("failed to serialize generation_settings: {}", e))
        })?;
        for uc in use_cases.iter_mut() {
            if uc.get("id").and_then(|v| v.as_str()) == Some(use_case_id) {
                if let Some(obj) = uc.as_object_mut() {
                    obj.insert("generation_settings".to_string(), merged_value.clone());
                }
                found = true;
                break;
            }
        }
        if !found {
            return Err(AppError::Validation(format!(
                "use_case_id '{}' not found on persona '{}'",
                use_case_id, persona_id
            )));
        }

        let new_dc_str = serde_json::to_string(&dc)
            .map_err(|e| AppError::Validation(format!("failed to re-serialize design_context: {}", e)))?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE personas SET design_context = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![new_dc_str, now, persona_id],
        )?;

        Ok(settings.clone())
    }

    /// Build the simulation input payload. Precedence:
    ///   1. caller `input_override` (parsed as JSON; falls back to `{user_input: raw}`)
    ///   2. `use_case.sample_input`
    ///   3. empty object
    ///
    /// Always injects `_simulation: true` so dispatch can short-circuit real
    /// notification delivery.
    pub fn build_simulation_input(
        use_case: &serde_json::Value,
        input_override: Option<&str>,
    ) -> Result<String, AppError> {
        let input_json: serde_json::Value = if let Some(raw) = input_override {
            serde_json::from_str(raw.trim())
                .unwrap_or_else(|_| serde_json::json!({ "user_input": raw }))
        } else if let Some(sample) = use_case.get("sample_input").cloned() {
            if sample.is_null() { serde_json::json!({}) } else { sample }
        } else {
            serde_json::json!({})
        };

        let mut obj = input_json
            .as_object()
            .cloned()
            .unwrap_or_else(serde_json::Map::new);
        obj.insert("_simulation".to_string(), serde_json::Value::Bool(true));
        serde_json::to_string(&serde_json::Value::Object(obj))
            .map_err(|e| AppError::Validation(format!("failed to build simulate input: {}", e)))
    }
}

/// Counts of rows cascaded by a capability-toggle operation. The UI uses
/// these to show a confirmation like "This paused 2 triggers and 3
/// subscriptions."
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UseCaseToggleResult {
    pub enabled: bool,
    #[ts(type = "number")]
    pub triggers_updated: usize,
    #[ts(type = "number")]
    pub subscriptions_updated: usize,
    #[ts(type = "number")]
    pub automations_updated: usize,
}

/// Preview the blast radius of disabling a capability without mutating
/// anything. Returns the counts the UI would show in its confirmation
/// dialog.
#[tauri::command]
pub async fn get_use_case_cascade(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    use_case_id: String,
) -> Result<UseCaseToggleResult, AppError> {
    require_privileged(&state, "get_use_case_cascade").await?;

    let conn = state.db.get()?;
    let triggers_updated: i64 = conn
        .prepare(
            "SELECT COUNT(*) FROM persona_triggers WHERE persona_id = ?1 AND use_case_id = ?2",
        )?
        .query_row(rusqlite::params![persona_id, use_case_id], |row| row.get(0))?;
    let subscriptions_updated: i64 = conn
        .prepare(
            "SELECT COUNT(*) FROM persona_event_subscriptions WHERE persona_id = ?1 AND use_case_id = ?2",
        )?
        .query_row(rusqlite::params![persona_id, use_case_id], |row| row.get(0))?;
    let automations_updated: i64 = conn
        .prepare(
            "SELECT COUNT(*) FROM persona_automations WHERE persona_id = ?1 AND use_case_id = ?2",
        )?
        .query_row(rusqlite::params![persona_id, use_case_id], |row| row.get(0))?;

    // `enabled` here is meaningless for a preview — caller decides direction.
    Ok(UseCaseToggleResult {
        enabled: false,
        triggers_updated: triggers_updated as usize,
        subscriptions_updated: subscriptions_updated as usize,
        automations_updated: automations_updated as usize,
    })
}

/// Toggle a capability's runtime enabled state.
///
/// Runs atomically:
///   1. Patch `personas.design_context.useCases[i].enabled`.
///   2. Cascade `UPDATE` on `persona_triggers`, `persona_event_subscriptions`,
///      and `persona_automations` rows that match `use_case_id`.
///   3. Invalidate the session pool so the next execution reassembles the
///      prompt with the new capability set (see session cache hash, C1).
///
/// Returns counts of cascaded rows so the UI can render a post-hoc toast
/// ("Paused 2 triggers, 1 subscription").
///
/// See docs/concepts/persona-capabilities/02-use-case-as-capability.md
/// §enable-disable-cascade for the contract.
#[tauri::command]
pub async fn set_use_case_enabled(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    use_case_id: String,
    enabled: bool,
) -> Result<UseCaseToggleResult, AppError> {
    require_privileged(&state, "set_use_case_enabled").await?;

    // Run cascade in a scoped block so the Connection (+ inner transaction) drops
    // **before** we await on `session_pool.invalidate`. Transactions are `!Send`
    // and holding one across an await makes the Tauri-command future non-Send.
    let result = {
        let mut conn = state.db.get()?;
        cascade_use_case_toggle(&mut conn, &persona_id, &use_case_id, enabled)?
    };

    state.session_pool.invalidate(&persona_id).await;

    tracing::info!(
        persona_id = %persona_id,
        use_case_id = %use_case_id,
        enabled,
        triggers_updated = result.triggers_updated,
        subscriptions_updated = result.subscriptions_updated,
        automations_updated = result.automations_updated,
        "Capability toggle cascaded",
    );

    Ok(result)
}

// =========================================================================
// Phase C5b — per-capability generation policy
// =========================================================================

/// Frontend-facing generation policy. Mirrors the TS `UseCaseGenerationSettings`
/// shape. All fields optional so callers can patch one knob without rewriting
/// the whole struct.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UseCaseGenerationSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memories: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reviews: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub events: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_aliases: Option<std::collections::HashMap<String, String>>,
}

/// Persist the generation policy onto a single capability inside the persona's
/// `design_context.use_cases[id].generation_settings`. Replaces any prior value
/// for that capability. Returns the patched settings as the LLM/dispatch layer
/// will see them on the next run.
///
/// Phase C5b.
#[tauri::command]
pub async fn set_use_case_generation_settings(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    use_case_id: String,
    settings: UseCaseGenerationSettings,
) -> Result<UseCaseGenerationSettings, AppError> {
    require_privileged(&state, "set_use_case_generation_settings").await?;

    let result = {
        let conn = state.db.get()?;
        testable::patch_generation_settings(&conn, &persona_id, &use_case_id, &settings)?
    };

    // Invalidate session pool so the next run reassembles the prompt with the
    // new "Generation policy" lines (see prompt::render_generation_policy_lines).
    state.session_pool.invalidate(&persona_id).await;

    tracing::info!(
        persona_id = %persona_id,
        use_case_id = %use_case_id,
        "Generation policy patched",
    );

    Ok(result)
}

/// Counts of subscribers / triggers that will be impacted by an event rename.
/// `excluding_persona_id` is the persona doing the renaming — usually
/// excluded so the user only sees *external* consumers they might break.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EventListenerCounts {
    #[ts(type = "number")]
    pub subscriptions: usize,
    #[ts(type = "number")]
    pub triggers: usize,
}

/// Count how many event subscribers and event-listener triggers currently
/// listen for `event_type`. Used by the rename modal to warn the user before
/// they break consumer wiring. Phase C5b.
#[tauri::command]
pub async fn count_event_listeners(
    state: State<'_, Arc<AppState>>,
    event_type: String,
    exclude_persona_id: Option<String>,
) -> Result<EventListenerCounts, AppError> {
    require_privileged(&state, "count_event_listeners").await?;

    let conn = state.db.get()?;
    let exclude = exclude_persona_id.as_deref().unwrap_or("");

    let subscriptions: i64 = conn
        .prepare(
            "SELECT COUNT(*) FROM persona_event_subscriptions
             WHERE event_type = ?1 AND (?2 = '' OR persona_id <> ?2)",
        )?
        .query_row(rusqlite::params![event_type, exclude], |r| r.get(0))?;

    // persona_triggers store config as JSON; event_listener triggers carry the
    // event name in the `event_type` column on the trigger row when present,
    // and we additionally match LIKE on the config JSON for older rows where
    // the column may be empty. The LIKE bound is anchored to '"event_type":"..."'
    // to avoid substring false-positives.
    let needle = format!("%\"event_type\":\"{}\"%", event_type.replace('"', "\\\""));
    let triggers: i64 = conn
        .prepare(
            "SELECT COUNT(*) FROM persona_triggers
             WHERE trigger_type = 'event_listener'
               AND (?1 = '' OR persona_id <> ?1)
               AND config LIKE ?2",
        )?
        .query_row(rusqlite::params![exclude, needle], |r| r.get(0))?;

    Ok(EventListenerCounts {
        subscriptions: subscriptions as usize,
        triggers: triggers as usize,
    })
}

/// How to handle existing consumers when an event is renamed.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum RenameConsumerAction {
    /// Rewrite each subscription/trigger to listen for `to`.
    Update,
    /// Drop each subscription/trigger so the producer can fully decouple.
    Delete,
    /// Leave consumers unchanged — they'll silently stop receiving the event.
    Leave,
}

/// Result of `rename_event_listeners` — counts of rows touched.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RenameEventListenersResult {
    #[ts(type = "number")]
    pub subscriptions_touched: usize,
    #[ts(type = "number")]
    pub triggers_touched: usize,
    pub action: RenameConsumerAction,
}

/// Apply the chosen consumer action when renaming an event. Excludes the
/// renaming persona by default. Phase C5b.
#[tauri::command]
pub async fn rename_event_listeners(
    state: State<'_, Arc<AppState>>,
    from_event: String,
    to_event: String,
    action: RenameConsumerAction,
    exclude_persona_id: Option<String>,
) -> Result<RenameEventListenersResult, AppError> {
    require_privileged(&state, "rename_event_listeners").await?;

    if from_event.trim().is_empty() || to_event.trim().is_empty() {
        return Err(AppError::Validation(
            "from_event and to_event must be non-empty".into(),
        ));
    }

    let conn = state.db.get()?;
    let exclude = exclude_persona_id.as_deref().unwrap_or("");
    let now = chrono::Utc::now().to_rfc3339();
    let needle = format!("%\"event_type\":\"{}\"%", from_event.replace('"', "\\\""));

    let (subscriptions_touched, triggers_touched) = match action {
        RenameConsumerAction::Update => {
            let subs = conn.execute(
                "UPDATE persona_event_subscriptions
                 SET event_type = ?1, updated_at = ?2
                 WHERE event_type = ?3 AND (?4 = '' OR persona_id <> ?4)",
                rusqlite::params![to_event, now, from_event, exclude],
            )? as usize;
            // For triggers we rewrite the config JSON's event_type field. Use a
            // simple string substitution scoped to '"event_type":"..."' to keep
            // the operation transparent without parsing each row.
            let from_token = format!("\"event_type\":\"{}\"", from_event.replace('"', "\\\""));
            let to_token = format!("\"event_type\":\"{}\"", to_event.replace('"', "\\\""));
            let trigs = conn.execute(
                "UPDATE persona_triggers
                 SET config = REPLACE(config, ?1, ?2), updated_at = ?3
                 WHERE trigger_type = 'event_listener'
                   AND (?4 = '' OR persona_id <> ?4)
                   AND config LIKE ?5",
                rusqlite::params![from_token, to_token, now, exclude, needle],
            )? as usize;
            (subs, trigs)
        }
        RenameConsumerAction::Delete => {
            let subs = conn.execute(
                "DELETE FROM persona_event_subscriptions
                 WHERE event_type = ?1 AND (?2 = '' OR persona_id <> ?2)",
                rusqlite::params![from_event, exclude],
            )? as usize;
            let trigs = conn.execute(
                "DELETE FROM persona_triggers
                 WHERE trigger_type = 'event_listener'
                   AND (?1 = '' OR persona_id <> ?1)
                   AND config LIKE ?2",
                rusqlite::params![exclude, needle],
            )? as usize;
            (subs, trigs)
        }
        RenameConsumerAction::Leave => (0, 0),
    };

    tracing::info!(
        from = %from_event,
        to = %to_event,
        action = ?action,
        subscriptions_touched,
        triggers_touched,
        "Event listeners reconciled after rename",
    );

    Ok(RenameEventListenersResult {
        subscriptions_touched,
        triggers_touched,
        action,
    })
}

/// Simulate a capability: run the persona end-to-end with the capability's
/// `sample_input` (or a provided override), tagging the resulting execution
/// row with `is_simulation = true`. Dispatch skips real notification delivery
/// for simulation rows.
///
/// Unlike `execute_persona` with a `use_case_id`, simulate **bypasses** the
/// capability's `enabled` gate so the user can test a disabled capability
/// before activating it.
///
/// See docs/concepts/persona-capabilities/02-use-case-as-capability.md §simulation.
#[tauri::command]
pub async fn simulate_use_case(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    use_case_id: String,
    input_override: Option<String>,
) -> Result<PersonaExecution, AppError> {
    require_privileged(&state, "simulate_use_case").await?;

    // Resolve sample_input from the use case when no override is given.
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
    let dc_str = persona.design_context.clone().ok_or_else(|| {
        AppError::Validation(format!("Persona '{}' has no design_context", persona.name))
    })?;
    let dc: serde_json::Value = serde_json::from_str(&dc_str)
        .map_err(|e| AppError::Validation(format!("design_context is not valid JSON: {}", e)))?;
    let use_case = dc
        .get("use_cases")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.iter().find(|uc| uc.get("id").and_then(|v| v.as_str()) == Some(use_case_id.as_str())))
        .ok_or_else(|| {
            AppError::Validation(format!(
                "use_case_id '{}' not found on persona '{}'",
                use_case_id, persona.name
            ))
        })?;

    // Build the simulation payload — `_simulation: true` is injected here so
    // dispatch can short-circuit real notification delivery downstream.
    let input_data = Some(build_simulation_input(use_case, input_override.as_deref())?);

    // Delegate to the shared inner executor with is_simulation=true.
    // `execute_persona_inner` reads use_case from design_context again (C1
    // auto-inject), which will still populate `_use_case` and `_time_filter`
    // blocks correctly for the prompt assembler.
    crate::commands::execution::executions::execute_persona_inner(
        &state,
        app,
        persona_id,
        /* trigger_id */ None,
        input_data,
        Some(use_case_id),
        /* continuation */ None,
        /* idempotency_key */ None,
        /* is_simulation */ true,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toggle_result_serializes_snake_case() {
        let r = UseCaseToggleResult {
            enabled: true,
            triggers_updated: 2,
            subscriptions_updated: 1,
            automations_updated: 0,
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("triggers_updated"));
        assert!(json.contains("subscriptions_updated"));
    }

    /// Phase C3 §K — Cascade integration test.
    ///
    /// Given a persona with 2 linked triggers, 3 linked subscriptions, and 1
    /// running automation, disabling the capability must:
    ///   - flip `design_context.use_cases[i].enabled` to `false`,
    ///   - flip `persona_triggers.enabled = 0` and `status = 'paused'` for both,
    ///   - flip `persona_event_subscriptions.enabled = 0` for all three,
    ///   - set the automation's `deployment_status = 'paused'`.
    #[test]
    fn cascade_disables_triggers_subscriptions_and_running_automations() {
        let pool = crate::db::init_test_db().expect("init test db");
        let mut conn = pool.get().expect("get conn");
        seed_persona_with_capability(&conn, "p_1", "uc_1");

        let now = chrono::Utc::now().to_rfc3339();
        for tid in ["tr_1", "tr_2"] {
            conn.execute(
                "INSERT INTO persona_triggers
                 (id, persona_id, use_case_id, trigger_type, enabled, status, created_at, updated_at)
                 VALUES (?1, 'p_1', 'uc_1', 'manual', 1, 'active', ?2, ?2)",
                rusqlite::params![tid, now],
            ).unwrap();
        }
        for (sid, evt) in [("sub_1", "evt.a"), ("sub_2", "evt.b"), ("sub_3", "evt.c")] {
            conn.execute(
                "INSERT INTO persona_event_subscriptions
                 (id, persona_id, use_case_id, event_type, enabled, created_at, updated_at)
                 VALUES (?1, 'p_1', 'uc_1', ?2, 1, ?3, ?3)",
                rusqlite::params![sid, evt, now],
            ).unwrap();
        }
        conn.execute(
            "INSERT INTO persona_automations
             (id, persona_id, use_case_id, name, platform, deployment_status, created_at, updated_at)
             VALUES ('au_1', 'p_1', 'uc_1', 'Test Automation', 'n8n', 'running', ?1, ?1)",
            rusqlite::params![now],
        ).unwrap();

        let result = cascade_use_case_toggle(&mut conn, "p_1", "uc_1", false)
            .expect("cascade ok");

        assert_eq!(result.enabled, false);
        assert_eq!(result.triggers_updated, 2, "two triggers should be cascaded");
        assert_eq!(result.subscriptions_updated, 3, "three subs should be cascaded");
        assert_eq!(result.automations_updated, 1, "one running automation paused");

        for tid in ["tr_1", "tr_2"] {
            let (enabled, status): (i64, String) = conn
                .query_row(
                    "SELECT enabled, status FROM persona_triggers WHERE id = ?1",
                    rusqlite::params![tid],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                ).unwrap();
            assert_eq!(enabled, 0, "trigger {tid} should be disabled");
            assert_eq!(status, "paused", "trigger {tid} status should be paused");
        }
        for sid in ["sub_1", "sub_2", "sub_3"] {
            let enabled: i64 = conn.query_row(
                "SELECT enabled FROM persona_event_subscriptions WHERE id = ?1",
                rusqlite::params![sid],
                |r| r.get(0),
            ).unwrap();
            assert_eq!(enabled, 0, "subscription {sid} should be disabled");
        }
        let auto_status: String = conn.query_row(
            "SELECT deployment_status FROM persona_automations WHERE id = 'au_1'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(auto_status, "paused");

        let dc: String = conn.query_row(
            "SELECT design_context FROM personas WHERE id = 'p_1'",
            [],
            |r| r.get(0),
        ).unwrap();
        let dc_v: serde_json::Value = serde_json::from_str(&dc).unwrap();
        assert_eq!(dc_v["use_cases"][0]["enabled"], serde_json::json!(false));
    }

    /// Phase C3 §K — Re-enable does **not** auto-resume paused automations
    /// (deliberate design — see `cascade_use_case_toggle` doc comment).
    #[test]
    fn cascade_reenable_resumes_triggers_and_subs_but_leaves_automations_paused() {
        let pool = crate::db::init_test_db().expect("init test db");
        let mut conn = pool.get().expect("get conn");
        seed_persona_with_capability(&conn, "p_2", "uc_2");

        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO persona_triggers
             (id, persona_id, use_case_id, trigger_type, enabled, status, created_at, updated_at)
             VALUES ('tr_p', 'p_2', 'uc_2', 'manual', 0, 'paused', ?1, ?1)",
            rusqlite::params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO persona_event_subscriptions
             (id, persona_id, use_case_id, event_type, enabled, created_at, updated_at)
             VALUES ('sub_p', 'p_2', 'uc_2', 'evt.test', 0, ?1, ?1)",
            rusqlite::params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO persona_automations
             (id, persona_id, use_case_id, name, platform, deployment_status, created_at, updated_at)
             VALUES ('au_p', 'p_2', 'uc_2', 'A', 'n8n', 'paused', ?1, ?1)",
            rusqlite::params![now],
        ).unwrap();

        let result = cascade_use_case_toggle(&mut conn, "p_2", "uc_2", true).unwrap();
        assert_eq!(result.enabled, true);
        assert_eq!(result.automations_updated, 0, "automations stay paused on re-enable");

        let trig_status: String = conn.query_row(
            "SELECT status FROM persona_triggers WHERE id = 'tr_p'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(trig_status, "active");
        let sub_enabled: i64 = conn.query_row(
            "SELECT enabled FROM persona_event_subscriptions WHERE id = 'sub_p'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(sub_enabled, 1);
        let auto_status: String = conn.query_row(
            "SELECT deployment_status FROM persona_automations WHERE id = 'au_p'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(auto_status, "paused", "operator must explicitly reactivate");
    }

    #[test]
    fn cascade_rejects_unknown_use_case() {
        let pool = crate::db::init_test_db().unwrap();
        let mut conn = pool.get().unwrap();
        seed_persona_with_capability(&conn, "p_3", "uc_real");

        let err = cascade_use_case_toggle(&mut conn, "p_3", "uc_phantom", false).unwrap_err();
        match err {
            AppError::Validation(msg) => assert!(msg.contains("uc_phantom"), "msg: {msg}"),
            other => panic!("expected Validation, got {other:?}"),
        }
    }

    /// Phase C3 §K — Simulation payload always carries `_simulation: true`,
    /// the flag dispatch checks to short-circuit real notification delivery.
    #[test]
    fn build_simulation_input_with_override_includes_simulation_flag() {
        let uc = serde_json::json!({"id": "uc", "sample_input": {"x": 1}});
        let raw = build_simulation_input(&uc, Some(r#"{"y": 2}"#)).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["_simulation"], serde_json::json!(true));
        assert_eq!(v["y"], serde_json::json!(2));
        assert!(v.get("x").is_none(), "override replaces sample, no merge");
    }

    #[test]
    fn build_simulation_input_falls_back_to_sample_input() {
        let uc = serde_json::json!({"id": "uc", "sample_input": {"x": 1}});
        let raw = build_simulation_input(&uc, None).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["_simulation"], serde_json::json!(true));
        assert_eq!(v["x"], serde_json::json!(1));
    }

    #[test]
    fn build_simulation_input_with_no_sample_emits_flag_only() {
        let uc = serde_json::json!({"id": "uc"});
        let raw = build_simulation_input(&uc, None).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["_simulation"], serde_json::json!(true));
        assert_eq!(v.as_object().unwrap().len(), 1, "only the flag should be present");
    }

    #[test]
    fn build_simulation_input_with_plain_text_override_wraps_as_user_input() {
        let uc = serde_json::json!({"id": "uc"});
        let raw = build_simulation_input(&uc, Some("hello there")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["_simulation"], serde_json::json!(true));
        assert_eq!(v["user_input"], serde_json::json!("hello there"));
    }

    /// Static guarantee: the dispatch layer's [SIM] short-circuit branch is
    /// the contract that `is_simulation = true` ⇒ no real notifications. This
    /// test pins the marker so a future refactor that drops the branch fails
    /// loudly here. (A full mock-notifier integration test belongs alongside
    /// `execute_persona_inner` once that path gets a test harness.)
    #[test]
    fn dispatch_module_contains_simulation_short_circuit() {
        let dispatch_src = include_str!("../../engine/dispatch.rs");
        assert!(
            dispatch_src.contains("if ctx.is_simulation"),
            "dispatch.rs must branch on ctx.is_simulation to skip real delivery"
        );
        assert!(
            dispatch_src.contains("[SIM]"),
            "dispatch.rs must log a [SIM] marker so simulation rows are auditable"
        );
    }

    /// Phase C5b — `patch_generation_settings` writes settings into the
    /// capability and returns the merged value. Subsequent reads via
    /// `dispatch::testable::pick_generation_policy` must reflect them.
    #[test]
    fn patch_generation_settings_persists_to_design_context() {
        let pool = crate::db::init_test_db().expect("init test db");
        let conn = pool.get().expect("get conn");
        seed_persona_with_capability(&conn, "p_gs", "uc_gs");

        let settings = UseCaseGenerationSettings {
            memories: Some("off".to_string()),
            reviews: Some("trust_llm".to_string()),
            events: Some("on".to_string()),
            event_aliases: Some({
                let mut m = std::collections::HashMap::new();
                m.insert("alert".to_string(), "escalation".to_string());
                m
            }),
        };
        let returned = testable::patch_generation_settings(&conn, "p_gs", "uc_gs", &settings)
            .expect("patch ok");
        assert_eq!(returned.memories.as_deref(), Some("off"));
        assert_eq!(returned.reviews.as_deref(), Some("trust_llm"));

        let dc: String = conn.query_row(
            "SELECT design_context FROM personas WHERE id = 'p_gs'",
            [], |r| r.get(0),
        ).unwrap();
        let policy = crate::engine::dispatch::testable::pick_generation_policy(&dc, "uc_gs");
        assert!(matches!(policy.memories, crate::engine::dispatch::testable::BoolPolicy::Off));
        assert!(matches!(policy.reviews, crate::engine::dispatch::testable::ReviewPolicy::TrustLlm));
        assert_eq!(policy.event_aliases.get("alert").map(|s| s.as_str()), Some("escalation"));
    }

    #[test]
    fn patch_generation_settings_rejects_unknown_use_case() {
        let pool = crate::db::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        seed_persona_with_capability(&conn, "p_gs2", "uc_gs2");
        let settings = UseCaseGenerationSettings::default();
        let err = testable::patch_generation_settings(&conn, "p_gs2", "missing", &settings)
            .unwrap_err();
        match err {
            AppError::Validation(m) => assert!(m.contains("missing")),
            other => panic!("expected Validation, got {other:?}"),
        }
    }

    fn seed_persona_with_capability(conn: &rusqlite::Connection, persona_id: &str, use_case_id: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        let dc = serde_json::json!({
            "use_cases": [
                { "id": use_case_id, "title": "Cap", "enabled": true }
            ]
        }).to_string();
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, design_context, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            rusqlite::params![persona_id, "Test", "you are test", dc, now],
        ).expect("seed persona");
    }
}
