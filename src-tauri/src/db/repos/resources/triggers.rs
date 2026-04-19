use rusqlite::params;

use crate::db::models::{CreateTriggerInput, PersonaTrigger, TriggerConfig, UpdateTriggerInput};
use crate::db::DbPool;
use crate::engine::{chain, crypto, scheduler};
use crate::error::AppError;
use crate::validation::contract::check as validate_check;
use crate::validation::trigger as tv;

pub(crate) fn normalize_trigger_type(raw: &str) -> &str {
    tv::normalize_trigger_type(raw)
}

pub(crate) fn validate_trigger_type(trigger_type: &str) -> Result<(), AppError> {
    validate_check(tv::validate_trigger_type(trigger_type))
}

pub(crate) fn validate_config(trigger_type: &str, config: Option<&str>) -> Result<(), AppError> {
    validate_check(tv::validate_config(trigger_type, config))
}

/// Encrypt sensitive fields in a trigger config JSON string before writing to DB.
/// Returns an error if encryption fails -- secrets must never be stored in plaintext.
pub(crate) fn encrypt_config(config: &str) -> Result<String, AppError> {
    crypto::encrypt_trigger_config(config).map_err(|e| {
        tracing::error!("Failed to encrypt trigger config: {}", e);
        AppError::Internal(format!("Trigger config encryption failed: {e}"))
    })
}

row_mapper!(row_to_trigger -> PersonaTrigger {
    id, persona_id, trigger_type, config,
    enabled [bool], status,
    last_triggered_at, next_trigger_at,
    trigger_version [opt_i32],
    created_at, updated_at, use_case_id,
});

crud_get_by_id!(PersonaTrigger, "persona_triggers", "Trigger", row_to_trigger);
crud_get_all!(PersonaTrigger, "persona_triggers", row_to_trigger, "created_at DESC");
crud_delete!("persona_triggers");

pub fn get_by_persona_id(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<PersonaTrigger>, AppError> {
    timed_query!("persona_triggers", "persona_triggers::get_by_persona_id", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_triggers WHERE persona_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![persona_id], row_to_trigger)?;
        let triggers = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
        Ok(triggers)

    })
}

/// Bulk-fetch triggers for multiple persona IDs in a single query.
pub fn get_by_persona_ids(
    pool: &DbPool,
    persona_ids: &[String],
) -> Result<Vec<PersonaTrigger>, AppError> {
    timed_query!("persona_triggers", "persona_triggers::get_by_persona_ids", {
        if persona_ids.is_empty() {
            return Ok(Vec::new());
        }
        let conn = pool.get()?;
        let placeholders: Vec<String> = persona_ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "SELECT * FROM persona_triggers WHERE persona_id IN ({}) ORDER BY created_at DESC",
            placeholders.join(", ")
        );
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = persona_ids
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), row_to_trigger)?;
        let triggers = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
        Ok(triggers)

    })
}

pub fn create(pool: &DbPool, mut input: CreateTriggerInput) -> Result<PersonaTrigger, AppError> {
    timed_query!("persona_triggers", "persona_triggers::create", {
        input.trigger_type = normalize_trigger_type(&input.trigger_type).to_string();
        validate_trigger_type(&input.trigger_type)?;
        validate_config(&input.trigger_type, input.config.as_deref())?;

        // Chain triggers: reject configurations that would create a cycle
        if input.trigger_type == "chain" {
            if let Some(ref config_str) = input.config {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(config_str) {
                    if let Some(source_id) = parsed.get("source_persona_id").and_then(|v| v.as_str()) {
                        chain::detect_chain_cycle(pool, source_id, &input.persona_id, None)?;
                    }
                }
            }
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let enabled = input.enabled.unwrap_or(true);
        let status = if enabled { "active" } else { "disabled" };
        let enabled_i = enabled as i32;

        // Encrypt sensitive config fields before writing to DB
        let encrypted_config = input.config.as_deref().map(encrypt_config).transpose()?;

        // Compute next_trigger_at from plaintext config so it can be written
        // atomically in the same transaction as the INSERT.
        let parsed_cfg = TriggerConfig::from_raw(&input.trigger_type, input.config.as_deref());
        let next_trigger_at = scheduler::compute_next_from_config(&parsed_cfg, chrono::Utc::now());

        // Fix 4a: for schedule / polling / webhook source triggers, auto-create a
        // paired event_listener inside the same transaction so the target persona
        // actually runs when the trigger fires. Without this, the scheduler would
        // publish an event into the bus that nothing listens to. See the
        // auto-listener helpers below + docs/design/event-routing-proposal.md.
        let needs_auto_listener =
            AUTO_LISTENER_SOURCE_TYPES.contains(&input.trigger_type.as_str());

        let auto_listener_event_type: Option<String> = if needs_auto_listener {
            Some(parsed_cfg.event_type().to_string())
        } else {
            None
        };

        {
            let mut conn = pool.get()?;
            let tx = conn.transaction().map_err(AppError::Database)?;
            tx.execute(
                "INSERT INTO persona_triggers
                 (id, persona_id, trigger_type, config, enabled, status, use_case_id, next_trigger_at, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                params![id, input.persona_id, input.trigger_type, encrypted_config, enabled_i, status, input.use_case_id, next_trigger_at, now],
            )?;

            if let Some(event_type) = &auto_listener_event_type {
                insert_auto_listener_in_tx(&tx, &input.persona_id, &id, event_type)?;
            }

            tx.commit().map_err(AppError::Database)?;
        }

        get_by_id(pool, &id)

    })
}

pub fn update(
    pool: &DbPool,
    id: &str,
    mut input: UpdateTriggerInput,
) -> Result<PersonaTrigger, AppError> {
    timed_query!("persona_triggers", "persona_triggers::update", {
        if let Some(ref raw_tt) = input.trigger_type {
            let normalized = normalize_trigger_type(raw_tt).to_string();
            input.trigger_type = Some(normalized);
        }
        if let Some(ref tt) = input.trigger_type {
            validate_trigger_type(tt)?;
        }

        // Verify exists
        let existing = get_by_id(pool, id)?;

        let effective_type = input.trigger_type.as_deref().unwrap_or(&existing.trigger_type);

        if let Some(ref cfg) = input.config {
            validate_config(effective_type, Some(cfg.as_str()))?;
        }

        // Chain triggers: reject configurations that would create a cycle
        if effective_type == "chain" {
            let config_str = input.config.as_deref().or(existing.config.as_deref());
            if let Some(cfg) = config_str {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(cfg) {
                    if let Some(source_id) = parsed.get("source_persona_id").and_then(|v| v.as_str()) {
                        chain::detect_chain_cycle(pool, source_id, &existing.persona_id, Some(id))?;
                    }
                }
            }
        }

        // Encrypt sensitive config fields before writing to DB
        let encrypted_config = input.config.as_deref().map(encrypt_config).transpose()?;

        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        // When `enabled` changes, derive the corresponding status string.
        let derived_status: Option<String> = input.enabled.map(|e| {
            if e { "active".into() } else { "disabled".into() }
        });

        // Build dynamic SET clause
        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;

        push_field!(input.trigger_type, "trigger_type", sets, param_idx);
        push_field!(encrypted_config, "config", sets, param_idx);
        push_field!(input.enabled, "enabled", sets, param_idx);
        push_field!(derived_status, "status", sets, param_idx);
        push_field!(input.next_trigger_at, "next_trigger_at", sets, param_idx);

        let sql = format!(
            "UPDATE persona_triggers SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );

        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

        if let Some(ref v) = input.trigger_type {
            param_values.push(Box::new(v.clone()));
        }
        if let Some(ref v) = encrypted_config {
            param_values.push(Box::new(v.clone()));
        }
        if let Some(v) = input.enabled {
            param_values.push(Box::new(v as i32));
        }
        if let Some(ref v) = derived_status {
            param_values.push(Box::new(v.clone()));
        }
        if let Some(ref v) = input.next_trigger_at {
            param_values.push(Box::new(v.clone()));
        }
        param_values.push(Box::new(id.to_string()));

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params_ref.as_slice())?;
        drop(conn);

        // Recompute next_trigger_at when trigger_type or config changed and the
        // caller didn't explicitly supply a next_trigger_at value.
        let schedule_changed = input.trigger_type.is_some() || input.config.is_some();
        if schedule_changed && input.next_trigger_at.is_none() {
            let updated = get_by_id(pool, id)?;
            let next_at = scheduler::compute_next_trigger_at(&updated, chrono::Utc::now());
            let conn2 = pool.get()?;
            conn2.execute(
                "UPDATE persona_triggers SET next_trigger_at = ?1, updated_at = ?2 WHERE id = ?3",
                params![next_at, chrono::Utc::now().to_rfc3339(), id],
            )?;
        }

        get_by_id(pool, id)

    })
}

// ============================================================================
// Builder: atomic link/unlink of persona <-> event
//
// Creates (or removes) an event_listener trigger AND patches the persona's
// structured_prompt.eventHandlers map in a single transaction. See
// docs/design/event-routing-proposal.md S3.
// ============================================================================

/// Patch the persona's `structured_prompt.eventHandlers` map within an
/// existing transaction. Adds or updates a single (event_type, handler_text)
/// entry. If the persona has no structured_prompt yet, a minimal one is
/// synthesized that preserves the existing system_prompt as `identity` so
/// the rendered prompt doesn't lose the persona's personality.
fn patch_persona_event_handler_in_tx(
    tx: &rusqlite::Transaction<'_>,
    persona_id: &str,
    event_type: &str,
    handler_text: &str,
) -> Result<(), AppError> {
    // Read current structured_prompt + system_prompt
    let (sp_opt, system_prompt): (Option<String>, String) = tx
        .query_row(
            "SELECT structured_prompt, system_prompt FROM personas WHERE id = ?1",
            params![persona_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1).unwrap_or_default(),
                ))
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Persona {persona_id}"))
            }
            other => AppError::Database(other),
        })?;

    // Parse existing JSON or synthesize a minimal object.
    let mut sp_val: serde_json::Value = match sp_opt.as_deref() {
        Some(s) if !s.trim().is_empty() => serde_json::from_str(s).unwrap_or_else(|_| {
            // Corrupted JSON -- start fresh, but preserve identity from system_prompt.
            let mut m = serde_json::Map::new();
            if !system_prompt.is_empty() {
                m.insert("identity".into(), serde_json::Value::String(system_prompt.clone()));
            }
            serde_json::Value::Object(m)
        }),
        _ => {
            let mut m = serde_json::Map::new();
            if !system_prompt.is_empty() {
                m.insert("identity".into(), serde_json::Value::String(system_prompt.clone()));
            }
            serde_json::Value::Object(m)
        }
    };

    // Ensure top-level is an object and ensure eventHandlers is an object.
    let sp_obj = sp_val
        .as_object_mut()
        .ok_or_else(|| AppError::Internal("structured_prompt is not a JSON object".into()))?;

    let handlers = sp_obj
        .entry("eventHandlers".to_string())
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    let handlers_obj = handlers
        .as_object_mut()
        .ok_or_else(|| AppError::Internal("eventHandlers is not a JSON object".into()))?;

    handlers_obj.insert(
        event_type.to_string(),
        serde_json::Value::String(handler_text.to_string()),
    );

    // Serialize and write back.
    let new_sp = serde_json::to_string(&sp_val)
        .map_err(|e| AppError::Internal(format!("Failed to serialize structured_prompt: {e}")))?;

    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "UPDATE personas SET structured_prompt = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_sp, now, persona_id],
    )
    .map_err(AppError::Database)?;

    Ok(())
}

/// Remove a single (event_type) entry from `structured_prompt.eventHandlers`.
/// Leaves other handlers intact. No-op if the persona has no handlers or the
/// specific key is missing.
fn remove_persona_event_handler_in_tx(
    tx: &rusqlite::Transaction<'_>,
    persona_id: &str,
    event_type: &str,
) -> Result<(), AppError> {
    let sp_opt: Option<String> = tx
        .query_row(
            "SELECT structured_prompt FROM personas WHERE id = ?1",
            params![persona_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Persona {persona_id}"))
            }
            other => AppError::Database(other),
        })?;

    let Some(sp_str) = sp_opt.filter(|s| !s.trim().is_empty()) else {
        return Ok(()); // no structured_prompt → nothing to remove
    };
    let Ok(mut sp_val) = serde_json::from_str::<serde_json::Value>(&sp_str) else {
        return Ok(()); // corrupted → skip (don't crash deletion)
    };
    let Some(sp_obj) = sp_val.as_object_mut() else {
        return Ok(());
    };
    let Some(handlers) = sp_obj.get_mut("eventHandlers").and_then(|v| v.as_object_mut()) else {
        return Ok(());
    };
    if handlers.remove(event_type).is_none() {
        return Ok(());
    }

    let new_sp = serde_json::to_string(&sp_val)
        .map_err(|e| AppError::Internal(format!("Failed to serialize structured_prompt: {e}")))?;
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "UPDATE personas SET structured_prompt = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_sp, now, persona_id],
    )
    .map_err(AppError::Database)?;

    Ok(())
}

/// Default handler text used when the Builder wires a persona without a
/// user-supplied handler. Describes the event in generic terms and points
/// the persona at the tools/credentials it already has.
fn default_handler_text(event_type: &str) -> String {
    format!(
        "When `{event_type}` fires, read the event payload from `input_data.payload`, \
         decide what action this persona should take based on its identity and available tools, \
         and produce the appropriate output (emit_message, emit_event, agent_memory, or manual_review). \
         If you cannot determine a reasonable action from the payload, request a manual_review with \
         a summary of the event and the ambiguity.",
    )
}

/// Atomically wire a persona as a listener for an event_type:
///   1. INSERT a new event_listener trigger
///   2. PATCH persona.structured_prompt.eventHandlers[event_type] with handler text
///
/// Both writes happen in a single transaction, so an error in either step
/// rolls back the other. Returns the created trigger.
pub fn link_persona_to_event(
    pool: &DbPool,
    persona_id: &str,
    event_type: &str,
    handler_text: Option<&str>,
    use_case_id: Option<&str>,
) -> Result<PersonaTrigger, AppError> {
    timed_query!("persona_triggers", "persona_triggers::link_persona_to_event", {
        if event_type.trim().is_empty() {
            return Err(AppError::Validation("event_type cannot be empty".into()));
        }

        let handler = handler_text
            .map(|s| s.to_string())
            .unwrap_or_else(|| default_handler_text(event_type));

        // Build the trigger config. Include advisory metadata so the Builder can
        // recognize its own triggers later.
        let config_json = serde_json::json!({
            "listen_event_type": event_type,
            "_managed_by": "builder",
            "_handler_key": event_type,
        })
        .to_string();
        validate_config("event_listener", Some(&config_json))?;
        let encrypted_config = encrypt_config(&config_json)?;

        let trigger_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let mut conn = pool.get()?;
        let tx = conn.transaction().map_err(AppError::Database)?;

        // 1. INSERT trigger (capability scope threaded through from builder UI;
        //    NULL = persona-wide — Phase C4).
        tx.execute(
            "INSERT INTO persona_triggers
             (id, persona_id, trigger_type, config, enabled, status, use_case_id, created_at, updated_at)
             VALUES (?1, ?2, 'event_listener', ?3, 1, 'active', ?4, ?5, ?5)",
            params![trigger_id, persona_id, encrypted_config, use_case_id, now],
        )
        .map_err(AppError::Database)?;

        // 2. PATCH persona.structured_prompt.eventHandlers
        patch_persona_event_handler_in_tx(&tx, persona_id, event_type, &handler)?;

        tx.commit().map_err(AppError::Database)?;

        get_by_id(pool, &trigger_id)
    })
}

/// Inverse of `link_persona_to_event`: remove the trigger AND the matching
/// handler entry in a single transaction. If the trigger's config carries a
/// `_handler_key` advisory field, that key is removed; otherwise the trigger's
/// `listen_event_type` is used.
pub fn unlink_persona_from_event(
    pool: &DbPool,
    trigger_id: &str,
) -> Result<(), AppError> {
    timed_query!("persona_triggers", "persona_triggers::unlink_persona_from_event", {
        // Read trigger first (outside tx — read-only) to resolve persona_id + handler_key.
        let trigger = get_by_id(pool, trigger_id)?;

        if trigger.trigger_type != "event_listener" {
            return Err(AppError::Validation(format!(
                "Trigger {trigger_id} is not an event_listener (type: {})",
                trigger.trigger_type
            )));
        }

        // Decrypt config to extract handler_key / listen_event_type.
        let config_str = trigger
            .config
            .as_deref()
            .map(crypto::decrypt_trigger_config)
            .transpose()
            .map_err(|e| AppError::Internal(format!("decrypt_trigger_config failed: {e}")))?
            .unwrap_or_default();
        let cfg: serde_json::Value =
            serde_json::from_str(&config_str).unwrap_or(serde_json::Value::Null);
        let handler_key = cfg
            .get("_handler_key")
            .and_then(|v| v.as_str())
            .or_else(|| cfg.get("listen_event_type").and_then(|v| v.as_str()))
            .map(String::from);

        let mut conn = pool.get()?;
        let tx = conn.transaction().map_err(AppError::Database)?;

        // 1. DELETE trigger
        tx.execute(
            "DELETE FROM persona_triggers WHERE id = ?1",
            params![trigger_id],
        )
        .map_err(AppError::Database)?;

        // 2. REMOVE handler entry (best effort — missing key is not fatal)
        if let Some(key) = handler_key {
            remove_persona_event_handler_in_tx(&tx, &trigger.persona_id, &key)?;
        }

        tx.commit().map_err(AppError::Database)?;

        Ok(())
    })
}

/// Backfill: seed a persona's `eventHandlers` from its existing event_listener
/// triggers. Idempotent — existing handlers are preserved, only missing keys
/// are filled in with the default placeholder. Returns the number of entries
/// created.
pub fn initialize_event_handlers_for_persona(
    pool: &DbPool,
    persona_id: &str,
) -> Result<u32, AppError> {
    timed_query!("persona_triggers", "persona_triggers::initialize_event_handlers_for_persona", {
        // Collect all event_types the persona already listens to via triggers.
        let triggers = get_by_persona_id(pool, persona_id)?;
        let mut event_types: Vec<String> = Vec::new();
        for t in triggers {
            if t.trigger_type != "event_listener" {
                continue;
            }
            let Some(raw) = t.config.as_deref() else {
                continue;
            };
            let Ok(decrypted) = crypto::decrypt_trigger_config(raw) else {
                continue;
            };
            let Ok(cfg) = serde_json::from_str::<serde_json::Value>(&decrypted) else {
                continue;
            };
            if let Some(et) = cfg.get("listen_event_type").and_then(|v| v.as_str()) {
                if !et.is_empty() && !event_types.contains(&et.to_string()) {
                    event_types.push(et.to_string());
                }
            }
        }

        if event_types.is_empty() {
            return Ok(0);
        }

        // Read current handlers to figure out which keys are already set.
        let sp_opt: Option<String> = {
            let conn = pool.get()?;
            conn.query_row(
                "SELECT structured_prompt FROM personas WHERE id = ?1",
                params![persona_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("Persona {persona_id}"))
                }
                other => AppError::Database(other),
            })?
        };
        let existing_keys: std::collections::HashSet<String> = sp_opt
            .as_deref()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
            .and_then(|v| {
                v.get("eventHandlers")
                    .and_then(|h| h.as_object())
                    .map(|obj| obj.keys().cloned().collect())
            })
            .unwrap_or_default();

        let missing: Vec<String> = event_types
            .into_iter()
            .filter(|et| !existing_keys.contains(et))
            .collect();
        if missing.is_empty() {
            return Ok(0);
        }

        let mut conn = pool.get()?;
        let tx = conn.transaction().map_err(AppError::Database)?;
        for et in &missing {
            let handler = default_handler_text(et);
            patch_persona_event_handler_in_tx(&tx, persona_id, et, &handler)?;
        }
        tx.commit().map_err(AppError::Database)?;

        Ok(missing.len() as u32)
    })
}

/// Direct update to a single persona event handler's text. Used by the
/// "Refine handler" action in the Builder. Creates the eventHandlers section
/// if it doesn't exist yet. Does NOT create a trigger — that's a separate
/// concern handled by `link_persona_to_event`.
pub fn update_persona_event_handler(
    pool: &DbPool,
    persona_id: &str,
    event_type: &str,
    handler_text: &str,
) -> Result<(), AppError> {
    timed_query!("persona_triggers", "persona_triggers::update_persona_event_handler", {
        if event_type.trim().is_empty() {
            return Err(AppError::Validation("event_type cannot be empty".into()));
        }
        let mut conn = pool.get()?;
        let tx = conn.transaction().map_err(AppError::Database)?;
        patch_persona_event_handler_in_tx(&tx, persona_id, event_type, handler_text)?;
        tx.commit().map_err(AppError::Database)?;
        Ok(())
    })
}

// ============================================================================
// Orphan cleanup (Fix 1 + Fix 2 from docs/design/event-routing-proposal.md)
// ============================================================================

/// Delete triggers whose `persona_id` no longer exists in the `personas` table.
/// Returns the number of rows deleted. This is the self-healing sweep that
/// prevents schedule triggers from firing into the void after their owning
/// persona is gone. Also cascade-deletes the paired Fix 4a auto-listener
/// event_listener trigger before removing the primary.
pub fn delete_orphaned_triggers(pool: &DbPool) -> Result<u32, AppError> {
    timed_query!("persona_triggers", "persona_triggers::delete_orphaned_triggers", {
        let mut conn = pool.get()?;
        let tx = conn.transaction().map_err(AppError::Database)?;

        // 1. Find all orphaned trigger IDs.
        let orphan_ids: Vec<String> = {
            let mut stmt = tx.prepare(
                "SELECT t.id FROM persona_triggers t
                 WHERE NOT EXISTS (SELECT 1 FROM personas p WHERE p.id = t.persona_id)",
            )?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?
        };

        if orphan_ids.is_empty() {
            return Ok(0);
        }

        // 2. For each orphan, also delete any paired Fix 4a auto-listener.
        //    (Their owning persona is gone too, so they'd be caught by step 3
        //    anyway — but an explicit pass is cheap and makes the intent clear.)
        let mut deleted: u32 = 0;
        for id in &orphan_ids {
            deleted += tx.execute(
                "DELETE FROM persona_triggers
                 WHERE trigger_type = 'event_listener'
                   AND json_extract(config, '$._auto_for_trigger') = ?1",
                params![id],
            )? as u32;
        }

        // 3. Delete the orphans themselves. Use a fresh NOT EXISTS query so
        //    we skip rows that were already removed in step 2 (would return 0
        //    rows affected and be counted as no-ops anyway, but this is more
        //    explicit about what's happening).
        for id in &orphan_ids {
            deleted += tx.execute(
                "DELETE FROM persona_triggers WHERE id = ?1",
                params![id],
            )? as u32;
        }

        tx.commit().map_err(AppError::Database)?;
        Ok(deleted)
    })
}

// ============================================================================
// Fix 4a — auto-listener wiring
// See docs/design/event-routing-proposal.md section "Fix 4a"
//
// Schedule / polling / webhook triggers publish events into the bus; the bus
// only invokes personas when a listener row matches. To close that gap, every
// create/update/delete of a source trigger also writes the matching listener
// trigger in lock-step. The auto-listener uses source_filter = trigger_id so
// it fires *only* for the paired source trigger, and carries an advisory
// `_auto_for_trigger` key so cleanup knows which listener to delete.
// ============================================================================

/// Trigger types that get an auto-created event_listener in Fix 4a.
pub(crate) const AUTO_LISTENER_SOURCE_TYPES: &[&str] =
    &["schedule", "polling", "webhook"];

/// Build the JSON config string for an auto-listener. Stores advisory fields
/// so cleanup can identify it later.
fn build_auto_listener_config(source_trigger_id: &str, event_type: &str) -> String {
    serde_json::json!({
        "listen_event_type": event_type,
        "source_filter": source_trigger_id,
        "_auto_for_trigger": source_trigger_id,
    })
    .to_string()
}

/// INSERT an auto-listener row inside an existing transaction. Used by the
/// trigger `create` path to stay atomic with the primary trigger write.
fn insert_auto_listener_in_tx(
    tx: &rusqlite::Transaction<'_>,
    persona_id: &str,
    source_trigger_id: &str,
    event_type: &str,
) -> Result<(), AppError> {
    let config_json = build_auto_listener_config(source_trigger_id, event_type);
    validate_config("event_listener", Some(&config_json))?;
    let encrypted = encrypt_config(&config_json)?;
    let listener_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    tx.execute(
        "INSERT INTO persona_triggers
         (id, persona_id, trigger_type, config, enabled, status, use_case_id, created_at, updated_at)
         VALUES (?1, ?2, 'event_listener', ?3, 1, 'active', NULL, ?4, ?4)",
        params![listener_id, persona_id, encrypted, now],
    )
    .map_err(AppError::Database)?;
    Ok(())
}

/// Cascade-delete any auto-listener paired with a source trigger. Safe on a
/// pool (no outer transaction) — used by the primary `delete` path. Returns
/// the number of listeners deleted (usually 0 or 1).
pub fn delete_auto_listeners_for(pool: &DbPool, source_trigger_id: &str) -> Result<u32, AppError> {
    timed_query!("persona_triggers", "persona_triggers::delete_auto_listeners_for", {
        let conn = pool.get()?;
        let rows = conn.execute(
            "DELETE FROM persona_triggers
             WHERE trigger_type = 'event_listener'
               AND json_extract(config, '$._auto_for_trigger') = ?1",
            params![source_trigger_id],
        )?;
        Ok(rows as u32)
    })
}

// ============================================================================
// Event type rename
// See docs/design/event-routing-proposal.md
//
// Atomically rewrites every storage site that holds `old` to `new`:
//   1. persona_events.event_type
//   2. persona_event_subscriptions.event_type
//   3. persona_triggers.config JSON — the `event_type` key (publishers),
//      the `listen_event_type` key (listeners), and the `_handler_key`
//      advisory (S3 link_persona_to_event)
//   4. personas.structured_prompt.eventHandlers — moves the key
//
// All inside a single transaction. Rejects catalog / reserved infrastructure
// event types so renaming can't desync hardcoded engine emitters from their
// listeners, and rejects collisions so streams don't merge by accident.
// ============================================================================

/// Event types that are hardcoded in engine emitters and listener paths.
/// Renaming any of these would break the runtime dispatch because the code
/// that publishes them still uses the literal string. Verified against:
///   - `src/features/triggers/sub_builder/libs/eventCanvasConstants.ts`
///   - `src-tauri/src/engine/dispatch.rs`
///   - `src-tauri/src/engine/chain.rs`
///   - `src-tauri/src/engine/background.rs`
///   - `src-tauri/src/engine/polling.rs`
pub(crate) const RESERVED_EVENT_TYPES: &[&str] = &[
    "webhook_received",
    "schedule_fired",
    "polling_changed",
    "chain_completed",
    "chain_triggered",
    "file_changed",
    "clipboard_changed",
    "app_focus_changed",
    "composite_fired",
    "trigger_fired",
    "execution_completed",
    "execution_failed",
    "persona_action",
    "emit_event",
];

/// Counts for UI feedback after a rename. Every field is the number of rows
/// whose stored event_type value was actually changed from `old` to `new`.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export)]
pub struct RenameEventTypeResult {
    pub events_updated: u32,
    pub subscriptions_updated: u32,
    pub trigger_publishers_updated: u32,
    pub trigger_listeners_updated: u32,
    pub handler_keys_updated: u32,
    pub persona_handlers_updated: u32,
}

/// Look for any row that references an event_type in ANY of the four stores.
/// Used as a collision check before a rename goes through, and as a read-only
/// hook into the "does this event_type exist anywhere?" question.
pub fn event_type_in_use(pool: &DbPool, event_type: &str) -> Result<bool, AppError> {
    timed_query!("persona_triggers", "persona_triggers::event_type_in_use", {
        let conn = pool.get()?;

        // persona_events
        let n_events: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_events WHERE event_type = ?1",
                params![event_type],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if n_events > 0 {
            return Ok(true);
        }

        // persona_event_subscriptions
        let n_subs: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_event_subscriptions WHERE event_type = ?1",
                params![event_type],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if n_subs > 0 {
            return Ok(true);
        }

        // persona_triggers config (publishers + listeners + handler_key)
        let n_triggers: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_triggers
                 WHERE json_extract(config, '$.event_type') = ?1
                    OR json_extract(config, '$.listen_event_type') = ?1
                    OR json_extract(config, '$._handler_key') = ?1",
                params![event_type],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if n_triggers > 0 {
            return Ok(true);
        }

        // personas.structured_prompt.eventHandlers — can't use dynamic
        // JSONPath string concat here because keys with dots (e.g.
        // `stock.alert.v2`) collide with JSONPath path separators. Pull
        // every persona with a non-null handlers map and membership-check
        // in Rust. The personas table is small (typically < 20 rows).
        let sps: Vec<String> = {
            let mut stmt = conn.prepare(
                "SELECT structured_prompt FROM personas
                 WHERE structured_prompt IS NOT NULL
                   AND json_extract(structured_prompt, '$.eventHandlers') IS NOT NULL",
            )?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?
        };
        for sp_str in sps {
            let Ok(sp_val) = serde_json::from_str::<serde_json::Value>(&sp_str) else {
                continue;
            };
            let Some(handlers) = sp_val.get("eventHandlers").and_then(|v| v.as_object()) else {
                continue;
            };
            if handlers.contains_key(event_type) {
                return Ok(true);
            }
        }
        Ok(false)
    })
}

/// Atomically rename an event type everywhere it's referenced. Returns a
/// per-store count of rows actually rewritten. Runs inside a single
/// transaction; any error rolls everything back.
pub fn rename_event_type(
    pool: &DbPool,
    old: &str,
    new: &str,
) -> Result<RenameEventTypeResult, AppError> {
    timed_query!("persona_triggers", "persona_triggers::rename_event_type", {
        // ── Validation ─────────────────────────────────────────────────
        use crate::db::repos::communication::events as event_repo;

        let old = old.trim();
        let new = new.trim();

        if old.is_empty() || new.is_empty() {
            return Err(AppError::Validation(
                "event_type names cannot be empty".into(),
            ));
        }
        if old == new {
            return Err(AppError::Validation(
                "old and new event_type are identical; nothing to rename".into(),
            ));
        }
        if new.len() > event_repo::MAX_TYPE_LEN {
            return Err(AppError::Validation(format!(
                "new event_type exceeds maximum length of {} characters",
                event_repo::MAX_TYPE_LEN
            )));
        }
        if !event_repo::is_safe_type_string(new) {
            return Err(AppError::Validation(
                "new event_type contains invalid characters; only alphanumeric, \
                 underscore, hyphen, dot, colon, and forward-slash are allowed \
                 (must start with alphanumeric or underscore)"
                    .into(),
            ));
        }
        if RESERVED_EVENT_TYPES.contains(&old) {
            return Err(AppError::Validation(format!(
                "`{old}` is a reserved infrastructure event type and cannot be renamed. \
                 Renaming it would desync hardcoded engine emitters from their listeners."
            )));
        }
        if RESERVED_EVENT_TYPES.contains(&new) {
            return Err(AppError::Validation(format!(
                "`{new}` is a reserved infrastructure event type and cannot be used as a rename target."
            )));
        }

        // Collision: new must not already exist anywhere
        if event_type_in_use(pool, new)? {
            return Err(AppError::Validation(format!(
                "event_type `{new}` is already in use; renaming would merge two streams. \
                 Delete or rename the existing `{new}` references first."
            )));
        }

        // ── Atomic rewrite ─────────────────────────────────────────────
        let mut conn = pool.get()?;
        let tx = conn.transaction().map_err(AppError::Database)?;
        let now = chrono::Utc::now().to_rfc3339();

        // 1. persona_events.event_type
        let events_updated = tx.execute(
            "UPDATE persona_events SET event_type = ?1 WHERE event_type = ?2",
            params![new, old],
        )? as u32;

        // 2. persona_event_subscriptions.event_type
        let subscriptions_updated = tx.execute(
            "UPDATE persona_event_subscriptions
             SET event_type = ?1, updated_at = ?2
             WHERE event_type = ?3",
            params![new, now, old],
        )? as u32;

        // 3a. persona_triggers.config — publisher event_type key
        let trigger_publishers_updated = tx.execute(
            "UPDATE persona_triggers
             SET config = json_set(config, '$.event_type', ?1),
                 updated_at = ?2
             WHERE json_extract(config, '$.event_type') = ?3",
            params![new, now, old],
        )? as u32;

        // 3b. persona_triggers.config — listener listen_event_type key
        let listeners_updated = tx.execute(
            "UPDATE persona_triggers
             SET config = json_set(config, '$.listen_event_type', ?1),
                 updated_at = ?2
             WHERE json_extract(config, '$.listen_event_type') = ?3",
            params![new, now, old],
        )? as u32;

        // 3c. persona_triggers.config — S3 _handler_key advisory
        let handler_keys_updated = tx.execute(
            "UPDATE persona_triggers
             SET config = json_set(config, '$._handler_key', ?1),
                 updated_at = ?2
             WHERE json_extract(config, '$._handler_key') = ?3",
            params![new, now, old],
        )? as u32;

        // 4. personas.structured_prompt.eventHandlers — key rename
        //
        //    Dynamic JSONPath like `'$.eventHandlers.' || ?1` breaks on keys
        //    containing dots (SQLite treats them as nested path separators,
        //    so `eventHandlers.stock.alert.v2` is read as
        //    `eventHandlers -> stock -> alert -> v2` — wrong). Pull every
        //    persona with a non-null handlers map and filter in Rust. The
        //    personas table is small, so this is fine.
        let persona_handlers_updated: u32 = {
            let candidates: Vec<(String, String)> = {
                let mut stmt = tx.prepare(
                    "SELECT id, structured_prompt FROM personas
                     WHERE structured_prompt IS NOT NULL
                       AND json_extract(structured_prompt, '$.eventHandlers') IS NOT NULL",
                )?;
                let rows = stmt.query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                    ))
                })?;
                rows.collect::<Result<Vec<_>, _>>()
                    .map_err(AppError::Database)?
            };

            let mut count = 0u32;
            for (persona_id, sp_str) in candidates {
                // Parse, move the key in memory, write back. Doing this in
                // JSON-land rather than via nested json_set/json_remove is
                // safer — it preserves every other field and works with any
                // nesting order.
                let mut sp_val: serde_json::Value = match serde_json::from_str(&sp_str) {
                    Ok(v) => v,
                    Err(_) => continue, // corrupted — skip (matches existing handler path behavior)
                };
                let Some(sp_obj) = sp_val.as_object_mut() else {
                    continue;
                };
                let Some(handlers_val) = sp_obj.get_mut("eventHandlers") else {
                    continue;
                };
                let Some(handlers) = handlers_val.as_object_mut() else {
                    continue;
                };
                // Defensive: skip if new already collides inside this persona.
                // The pre-tx collision check already covered the cross-persona
                // case, but a single persona could in theory have both keys.
                if handlers.contains_key(new) {
                    continue;
                }
                let Some(handler_text) = handlers.remove(old) else {
                    continue;
                };
                handlers.insert(new.to_string(), handler_text);

                let new_sp = serde_json::to_string(&sp_val).map_err(|e| {
                    AppError::Internal(format!(
                        "Failed to serialize updated structured_prompt: {e}"
                    ))
                })?;
                let rows = tx.execute(
                    "UPDATE personas SET structured_prompt = ?1, updated_at = ?2 WHERE id = ?3",
                    params![new_sp, now, persona_id],
                )?;
                count += rows as u32;
            }
            count
        };

        tx.commit().map_err(AppError::Database)?;

        Ok(RenameEventTypeResult {
            events_updated,
            subscriptions_updated,
            trigger_publishers_updated,
            trigger_listeners_updated: listeners_updated,
            handler_keys_updated,
            persona_handlers_updated,
        })
    })
}

/// Backfill: walk every schedule/polling/webhook trigger in the DB and create
/// a matching event_listener auto-listener for any that don't already have
/// one. Idempotent. Returns (triggers_scanned, listeners_created).
pub fn backfill_auto_listeners(pool: &DbPool) -> Result<(u32, u32), AppError> {
    timed_query!("persona_triggers", "persona_triggers::backfill_auto_listeners", {
        // 1. Load all source triggers that need auto-listeners.
        let candidates: Vec<PersonaTrigger> = {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_triggers
                 WHERE trigger_type IN ('schedule', 'polling', 'webhook')
                 ORDER BY created_at",
            )?;
            let rows = stmt.query_map([], row_to_trigger)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?
        };

        if candidates.is_empty() {
            return Ok((0, 0));
        }

        let scanned = candidates.len() as u32;

        // 2. Load existing auto-listener source_trigger ids so we can skip ones that
        //    already have a pair. json_extract with plaintext config works fine; for
        //    encrypted configs the extract silently returns NULL, which is also fine
        //    (we just skip them — if decrypt is needed, user already created it).
        let existing_pairs: std::collections::HashSet<String> = {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT json_extract(config, '$._auto_for_trigger')
                 FROM persona_triggers
                 WHERE trigger_type = 'event_listener'
                   AND json_extract(config, '$._auto_for_trigger') IS NOT NULL",
            )?;
            let rows = stmt.query_map([], |row| row.get::<_, Option<String>>(0))?;
            rows.filter_map(|r| r.ok().flatten()).collect()
        };

        // 3. Create missing listeners in one transaction.
        let mut conn = pool.get()?;
        let tx = conn.transaction().map_err(AppError::Database)?;
        let mut created = 0u32;
        for src in &candidates {
            if existing_pairs.contains(&src.id) {
                continue;
            }
            // Parse config to get the event_type the trigger publishes.
            let cfg = src.parse_config();
            let event_type = cfg.event_type().to_string();
            insert_auto_listener_in_tx(&tx, &src.persona_id, &src.id, &event_type)?;
            created += 1;
        }
        tx.commit().map_err(AppError::Database)?;

        Ok((scanned, created))
    })
}

/// Get enabled chain triggers whose source_persona_id matches the given value.
/// Uses SQL-level filtering with json_extract to avoid loading all triggers.
pub fn get_chain_triggers_for_source(
    pool: &DbPool,
    source_persona_id: &str,
) -> Result<Vec<PersonaTrigger>, AppError> {
    timed_query!("persona_triggers", "persona_triggers::get_chain_triggers_for_source", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_triggers
             WHERE trigger_type = 'chain'
               AND status = 'active'
               AND json_extract(config, '$.source_persona_id') = ?1
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![source_persona_id], row_to_trigger)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)

    })
}

/// Get enabled event_listener triggers whose listen_event_type matches the given event type.
/// Uses SQL-level filtering with json_extract.
pub fn get_event_listeners_for_event_type(
    pool: &DbPool,
    event_type: &str,
) -> Result<Vec<PersonaTrigger>, AppError> {
    timed_query!("persona_triggers", "persona_triggers::get_event_listeners_for_event_type", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_triggers
             WHERE trigger_type = 'event_listener'
               AND status = 'active'
               AND json_extract(config, '$.listen_event_type') = ?1
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![event_type], row_to_trigger)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)

    })
}

/// Bulk-fetch enabled event_listener triggers for multiple event types in a single query.
pub fn get_event_listeners_for_event_types(
    pool: &DbPool,
    event_types: &[String],
) -> Result<Vec<PersonaTrigger>, AppError> {
    timed_query!("persona_triggers", "persona_triggers::get_event_listeners_for_event_types", {
        if event_types.is_empty() {
            return Ok(Vec::new());
        }
        let conn = pool.get()?;
        let placeholders: Vec<String> = event_types
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "SELECT * FROM persona_triggers
             WHERE trigger_type = 'event_listener'
               AND status = 'active'
               AND json_extract(config, '$.listen_event_type') IN ({})
             ORDER BY created_at DESC",
            placeholders.join(", ")
        );
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = event_types
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), row_to_trigger)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)

    })
}

/// Get enabled triggers of a specific type using SQL-level filtering.
/// Avoids loading all triggers and filtering in Rust — mirrors the pattern
/// used by `get_chain_triggers_for_source` and `get_event_listeners_for_event_type`.
pub fn get_enabled_by_type(pool: &DbPool, trigger_type: &str) -> Result<Vec<PersonaTrigger>, AppError> {
    timed_query!("persona_triggers", "persona_triggers::get_enabled_by_type", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_triggers
             WHERE trigger_type = ?1 AND status = 'active'
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![trigger_type], row_to_trigger)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)

    })
}

pub fn get_due(pool: &DbPool, now: &str) -> Result<Vec<PersonaTrigger>, AppError> {
    timed_query!("persona_triggers", "persona_triggers::get_due", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_triggers
             WHERE status = 'active' AND next_trigger_at IS NOT NULL AND next_trigger_at <= ?1
             ORDER BY next_trigger_at ASC",
        )?;
        let rows = stmt.query_map(params![now], row_to_trigger)?;
        let triggers = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
        Ok(triggers)

    })
}

/// Returns a map of trigger_id -> health status ("healthy", "degraded", "failing", "unknown")
/// by joining triggers with the 3 most recent executions per trigger in a single query.
pub fn get_health_map(pool: &DbPool) -> Result<std::collections::HashMap<String, String>, AppError> {
    timed_query!("persona_triggers", "persona_triggers::get_health_map", {
        let conn = pool.get()?;
        // For each trigger, get the 3 most recent executions (ranked by created_at DESC).
        // Then aggregate: count failures in top 3, check if top 2 are both non-completed.
        let mut stmt = conn.prepare(
            "WITH ranked AS (
               SELECT
                 e.trigger_id,
                 e.status,
                 ROW_NUMBER() OVER (PARTITION BY e.trigger_id ORDER BY e.created_at DESC) AS rn
               FROM persona_executions e
               WHERE e.trigger_id IS NOT NULL
             ),
             top3 AS (
               SELECT trigger_id, status, rn FROM ranked WHERE rn <= 3
             ),
             agg AS (
               SELECT
                 trigger_id,
                 COUNT(*) AS total,
                 SUM(CASE WHEN status IN ('failed', 'error') THEN 1 ELSE 0 END) AS fail_count,
                 -- Check if the two most recent are both non-completed
                 SUM(CASE WHEN rn <= 2 AND status != 'completed' THEN 1 ELSE 0 END) AS top2_non_completed
               FROM top3
               GROUP BY trigger_id
             )
             SELECT trigger_id, total, fail_count, top2_non_completed FROM agg",
        )?;

        let mut health_map = std::collections::HashMap::new();
        let rows = stmt.query_map([], |row| {
            let trigger_id: String = row.get(0)?;
            let total: i64 = row.get(1)?;
            let fail_count: i64 = row.get(2)?;
            let top2_non_completed: i64 = row.get(3)?;
            Ok((trigger_id, total, fail_count, top2_non_completed))
        })?;

        for row in rows {
            let (trigger_id, total, fail_count, top2_non_completed) = row.map_err(AppError::Database)?;
            let health = if total == 0 {
                "unknown"
            } else if fail_count == 0 {
                "healthy"
            } else if total >= 2 && top2_non_completed >= 2 {
                "failing"
            } else {
                "degraded"
            };
            health_map.insert(trigger_id, health.to_string());
        }

        Ok(health_map)

    })
}

/// Single-query chain link resolution using SQL JOINs + json_extract.
/// Returns (trigger_id, source_persona_id, source_name, target_persona_id, target_name, condition_type, enabled).
#[allow(clippy::type_complexity)]
pub fn get_chain_links(
    pool: &DbPool,
) -> Result<
    Vec<(String, String, String, String, String, String, bool)>,
    AppError,
> {
    timed_query!("persona_triggers", "persona_triggers::get_chain_links", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT
               t.id,
               COALESCE(json_extract(t.config, '$.source_persona_id'), '') AS source_persona_id,
               COALESCE(sp.name, 'Unknown') AS source_persona_name,
               t.persona_id AS target_persona_id,
               COALESCE(tp.name, 'Unknown') AS target_persona_name,
               COALESCE(json_extract(t.config, '$.condition.type'), 'any') AS condition_type,
               t.enabled
             FROM persona_triggers t
             LEFT JOIN personas sp ON sp.id = json_extract(t.config, '$.source_persona_id')
             LEFT JOIN personas tp ON tp.id = t.persona_id
             WHERE t.trigger_type = 'chain'
             ORDER BY t.created_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i32>(6)? != 0,
            ))
        })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)

    })
}

/// Atomically claim a due trigger using compare-and-swap on `trigger_version`.
///
/// The WHERE clause checks that `trigger_version` still matches the value the
/// caller read from `get_due`.  If a concurrent scheduler tick already advanced
/// the schedule (incrementing the version), this UPDATE touches 0 rows and
/// returns `Ok(false)`, preventing double-fire.
pub fn mark_triggered(
    pool: &DbPool,
    id: &str,
    next_trigger_at: Option<String>,
    expected_version: i32,
) -> Result<bool, AppError> {
    timed_query!("persona_triggers", "persona_triggers::mark_triggered", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        let rows = conn.execute(
            "UPDATE persona_triggers
             SET last_triggered_at = ?1, next_trigger_at = ?2, updated_at = ?1,
                 trigger_version = trigger_version + 1
             WHERE id = ?3 AND trigger_version = ?4",
            params![now, next_trigger_at, id, expected_version],
        )?;
        Ok(rows > 0)

    })
}

/// Unconditionally advance a trigger's schedule after a manual execution.
///
/// Unlike `mark_triggered` (which uses CAS to prevent double-fire from
/// concurrent scheduler ticks), this always updates. Used when the user
/// manually runs or recovers an overdue trigger so it moves out of the
/// "overdue" state.
pub fn advance_schedule(
    pool: &DbPool,
    id: &str,
    next_trigger_at: Option<String>,
) -> Result<(), AppError> {
    timed_query!("persona_triggers", "persona_triggers::advance_schedule", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE persona_triggers
             SET last_triggered_at = ?1, next_trigger_at = ?2, updated_at = ?1,
                 trigger_version = trigger_version + 1
             WHERE id = ?3",
            params![now, next_trigger_at, id],
        )?;
        Ok(())

    })
}

/// Atomically update the content hash and advance the schedule in a single
/// compare-and-swap (CAS) operation.
///
/// The WHERE clause checks that the stored content_hash still matches
/// `expected_old_hash`. If another poll cycle already updated the hash,
/// the CAS fails (returns `Ok(false)`) and the caller must NOT publish a
/// duplicate event.
///
/// This prevents the race where event publish succeeds but the hash or
/// schedule update fails, leaving stale state for the next cycle.
pub fn mark_triggered_with_hash(
    pool: &DbPool,
    id: &str,
    new_hash: &str,
    expected_old_hash: Option<&str>,
    next_trigger_at: Option<String>,
) -> Result<bool, AppError> {
    timed_query!("persona_triggers", "persona_triggers::mark_triggered_with_hash", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let rows = match expected_old_hash {
            Some(old) => conn.execute(
                "UPDATE persona_triggers
                 SET config = json_set(COALESCE(config, '{}'), '$.content_hash', ?1),
                     last_triggered_at = ?2,
                     next_trigger_at = ?3,
                     updated_at = ?2,
                     trigger_version = trigger_version + 1
                 WHERE id = ?4
                   AND json_extract(config, '$.content_hash') = ?5",
                params![new_hash, now, next_trigger_at, id, old],
            )?,
            None => conn.execute(
                "UPDATE persona_triggers
                 SET config = json_set(COALESCE(config, '{}'), '$.content_hash', ?1),
                     last_triggered_at = ?2,
                     next_trigger_at = ?3,
                     updated_at = ?2,
                     trigger_version = trigger_version + 1
                 WHERE id = ?4
                   AND json_extract(config, '$.content_hash') IS NULL",
                params![new_hash, now, next_trigger_at, id],
            )?,
        };

        Ok(rows > 0)

    })
}

/// Set the `enabled` flag on a trigger. Used as a safety valve to disable
/// triggers that fail to mark as triggered, preventing cascade re-fire loops.
/// Also updates the `status` column to stay in sync.
pub fn set_enabled(pool: &DbPool, id: &str, enabled: bool) -> Result<(), AppError> {
    timed_query!("persona_triggers", "persona_triggers::set_enabled", {
        let now = chrono::Utc::now().to_rfc3339();
        let status = if enabled { "active" } else { "disabled" };
        let conn = pool.get()?;
        conn.execute(
            "UPDATE persona_triggers SET enabled = ?1, status = ?2, updated_at = ?3 WHERE id = ?4",
            params![enabled as i32, status, now, id],
        )?;
        Ok(())

    })
}

/// Set the full lifecycle status on a trigger, keeping `enabled` in sync.
///
/// Unlike `set_enabled` (which only knows Active/Disabled), this preserves
/// all four states: Active, Paused, Errored, Disabled.
pub fn set_status(
    pool: &DbPool,
    id: &str,
    status: crate::engine::lifecycle::TriggerStatus,
) -> Result<(), AppError> {
    timed_query!("persona_triggers", "persona_triggers::set_status", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE persona_triggers SET status = ?1, enabled = ?2, updated_at = ?3 WHERE id = ?4",
            params![status.as_str(), status.is_enabled() as i32, now, id],
        )?;
        Ok(())

    })
}

// ---------------------------------------------------------------------------
// Composite trigger fire persistence
// ---------------------------------------------------------------------------

/// Load all persisted composite trigger fire timestamps.
pub fn load_composite_fires(pool: &DbPool) -> Result<Vec<(String, String)>, AppError> {
    timed_query!("composite_trigger_fires", "composite_fires::load_all", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT trigger_id, fired_at FROM composite_trigger_fires"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut result = Vec::new();
        for r in rows {
            result.push(r?);
        }
        Ok(result)
    })
}

/// Upsert a composite trigger fire timestamp.
pub fn upsert_composite_fire(pool: &DbPool, trigger_id: &str, fired_at: &str) -> Result<(), AppError> {
    timed_query!("composite_trigger_fires", "composite_fires::upsert", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO composite_trigger_fires (trigger_id, fired_at)
             VALUES (?1, ?2)
             ON CONFLICT(trigger_id) DO UPDATE SET fired_at = excluded.fired_at",
            params![trigger_id, fired_at],
        )?;
        Ok(())
    })
}

/// Remove composite fire records older than the given cutoff timestamp.
pub fn cleanup_composite_fires(pool: &DbPool, cutoff: &str) -> Result<(), AppError> {
    timed_query!("composite_trigger_fires", "composite_fires::cleanup", {
        let conn = pool.get()?;
        conn.execute(
            "DELETE FROM composite_trigger_fires WHERE fired_at < ?1",
            params![cutoff],
        )?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::repos::test_fixtures;

    fn create_test_persona(pool: &DbPool) -> crate::db::models::Persona {
        test_fixtures::create_test_persona(pool, "Trigger Test Agent", "You handle triggers.")
    }

    #[test]
    fn test_crud_triggers() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Create
        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"0 * * * *"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();
        assert_eq!(trigger.trigger_type, "schedule");
        assert!(trigger.enabled);
        assert_eq!(trigger.persona_id, persona.id);

        // Get by ID
        let fetched = get_by_id(&pool, &trigger.id).unwrap();
        assert_eq!(fetched.config, Some(r#"{"cron":"0 * * * *"}"#.into()));

        // List by persona — since Fix 4a, creating a `schedule` trigger also
        // creates a paired `event_listener` auto-listener. Assert on the
        // source trigger type count, not the raw total.
        let list = get_by_persona_id(&pool, &persona.id).unwrap();
        let schedule_count = list.iter().filter(|t| t.trigger_type == "schedule").count();
        assert_eq!(schedule_count, 1);

        // Update
        let updated = update(
            &pool,
            &trigger.id,
            UpdateTriggerInput {
                trigger_type: None,
                config: Some(r#"{"cron":"*/5 * * * *"}"#.into()),
                enabled: Some(false),
                next_trigger_at: None,
            },
        )
        .unwrap();
        assert!(!updated.enabled);
        assert_eq!(updated.config, Some(r#"{"cron":"*/5 * * * *"}"#.into()));

        // Delete
        let deleted = delete(&pool, &trigger.id).unwrap();
        assert!(deleted);
        assert!(get_by_id(&pool, &trigger.id).is_err());
    }

    #[test]
    fn test_get_due_and_mark_triggered() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Create a trigger with a past next_trigger_at
        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: None,
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        // Set next_trigger_at to a past time
        let past = "2020-01-01T00:00:00+00:00";
        update(
            &pool,
            &trigger.id,
            UpdateTriggerInput {
                trigger_type: None,
                config: None,
                enabled: None,
                next_trigger_at: Some(Some(past.into())),
            },
        )
        .unwrap();

        // Should appear in due list
        let now = chrono::Utc::now().to_rfc3339();
        let due = get_due(&pool, &now).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, trigger.id);

        // Mark triggered with a future next_trigger_at (CAS: version = 0 for fresh trigger)
        let future = "2099-12-31T23:59:59+00:00";
        mark_triggered(&pool, &trigger.id, Some(future.into()), 0).unwrap();

        // Should no longer be due (next_trigger_at is in the future)
        let due_after = get_due(&pool, &now).unwrap();
        assert_eq!(due_after.len(), 0);

        // Verify last_triggered_at was set
        let refreshed = get_by_id(&pool, &trigger.id).unwrap();
        assert!(refreshed.last_triggered_at.is_some());
        assert_eq!(refreshed.next_trigger_at, Some(future.into()));
    }

    #[test]
    fn test_not_found() {
        let pool = init_test_db().unwrap();
        let result = get_by_id(&pool, "nonexistent-id");
        assert!(result.is_err());
    }

    #[test]
    fn test_mark_triggered_deleted_trigger() {
        let pool = init_test_db().unwrap();

        // mark_triggered on a nonexistent ID should return Ok(false)
        let result = mark_triggered(&pool, "nonexistent-id", None, 0).unwrap();
        assert!(!result);
    }

    #[test]
    fn test_invalid_trigger_type_rejected() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let result = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "invalid_type".into(),
                config: None,
                enabled: Some(true),
                use_case_id: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_zero_interval_rejected() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let result = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"interval_seconds":0}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_valid_interval_accepted() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let result = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"interval_seconds":3600}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_create_schedule_trigger_initializes_next_trigger_at() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"0 * * * *"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        // next_trigger_at must be set so the scheduler loop picks it up
        assert!(
            trigger.next_trigger_at.is_some(),
            "schedule trigger must have next_trigger_at initialized on create"
        );
    }

    #[test]
    fn test_create_polling_trigger_initializes_next_trigger_at() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "polling".into(),
                config: Some(r#"{"interval_seconds":300}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        assert!(
            trigger.next_trigger_at.is_some(),
            "polling trigger must have next_trigger_at initialized on create"
        );
    }

    #[test]
    fn test_create_manual_trigger_next_trigger_at_is_null() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "manual".into(),
                config: None,
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        assert!(
            trigger.next_trigger_at.is_none(),
            "manual trigger should have no next_trigger_at"
        );
    }

    #[test]
    fn test_null_interval_rejected() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let result = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"interval_seconds":null}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_update_rejects_invalid_trigger_type() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "manual".into(),
                config: None,
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        let result = update(
            &pool,
            &trigger.id,
            UpdateTriggerInput {
                trigger_type: Some("bogus".into()),
                config: None,
                enabled: None,
                next_trigger_at: None,
            },
        );
        assert!(result.is_err());
    }

    // ========================================================================
    // S3: Builder link/unlink integration tests
    // ========================================================================

    fn read_structured_prompt(pool: &DbPool, persona_id: &str) -> serde_json::Value {
        let conn = pool.get().unwrap();
        let sp: Option<String> = conn
            .query_row(
                "SELECT structured_prompt FROM personas WHERE id = ?1",
                params![persona_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .unwrap();
        sp.as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(serde_json::Value::Null)
    }

    #[test]
    fn test_s3_link_creates_trigger_and_handler() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let trigger = link_persona_to_event(
            &pool,
            &persona.id,
            "stock.signal.strong_buy",
            None, // use default handler
            None, // persona-wide
        )
        .unwrap();

        // Trigger created with correct type + advisory metadata
        assert_eq!(trigger.trigger_type, "event_listener");
        assert_eq!(trigger.persona_id, persona.id);
        assert!(trigger.enabled);

        let decrypted = crypto::decrypt_trigger_config(trigger.config.as_deref().unwrap()).unwrap();
        let cfg: serde_json::Value = serde_json::from_str(&decrypted).unwrap();
        assert_eq!(cfg.get("listen_event_type").unwrap().as_str().unwrap(), "stock.signal.strong_buy");
        assert_eq!(cfg.get("_managed_by").unwrap().as_str().unwrap(), "builder");
        assert_eq!(cfg.get("_handler_key").unwrap().as_str().unwrap(), "stock.signal.strong_buy");

        // Persona structured_prompt patched with eventHandlers entry
        let sp = read_structured_prompt(&pool, &persona.id);
        let handler = sp
            .get("eventHandlers")
            .and_then(|h| h.get("stock.signal.strong_buy"))
            .and_then(|v| v.as_str())
            .expect("handler entry should exist");
        assert!(handler.contains("stock.signal.strong_buy"));
        // identity should be carried over from system_prompt since original had no structured_prompt
        let identity = sp
            .get("identity")
            .and_then(|v| v.as_str())
            .expect("identity should be seeded from system_prompt");
        assert!(identity.contains("triggers"));
    }

    #[test]
    fn test_s3_link_with_custom_handler_text() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);
        let custom = "Compose a Slack DM with ticker and signal strength.";

        link_persona_to_event(
            &pool,
            &persona.id,
            "stock.signal.strong_buy",
            Some(custom),
            None,
        )
        .unwrap();

        let sp = read_structured_prompt(&pool, &persona.id);
        let handler = sp
            .get("eventHandlers")
            .and_then(|h| h.get("stock.signal.strong_buy"))
            .and_then(|v| v.as_str())
            .unwrap();
        assert_eq!(handler, custom);
    }

    #[test]
    fn test_s3_unlink_removes_both_trigger_and_handler() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let trigger =
            link_persona_to_event(&pool, &persona.id, "stock.signal.strong_buy", None, None).unwrap();

        // Verify both exist
        assert!(get_by_id(&pool, &trigger.id).is_ok());
        let sp = read_structured_prompt(&pool, &persona.id);
        assert!(sp
            .get("eventHandlers")
            .and_then(|h| h.get("stock.signal.strong_buy"))
            .is_some());

        // Unlink
        unlink_persona_from_event(&pool, &trigger.id).unwrap();

        // Both gone
        assert!(get_by_id(&pool, &trigger.id).is_err());
        let sp_after = read_structured_prompt(&pool, &persona.id);
        assert!(
            sp_after
                .get("eventHandlers")
                .and_then(|h| h.get("stock.signal.strong_buy"))
                .is_none(),
            "handler should be removed after unlink"
        );
    }

    #[test]
    fn test_s3_unlink_preserves_other_handlers() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let t1 = link_persona_to_event(&pool, &persona.id, "event.one", None, None).unwrap();
        let _t2 = link_persona_to_event(&pool, &persona.id, "event.two", None, None).unwrap();

        unlink_persona_from_event(&pool, &t1.id).unwrap();

        let sp = read_structured_prompt(&pool, &persona.id);
        let handlers = sp.get("eventHandlers").unwrap().as_object().unwrap();
        assert!(!handlers.contains_key("event.one"));
        assert!(handlers.contains_key("event.two"));
    }

    #[test]
    fn test_s3_link_rejects_empty_event_type() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let result = link_persona_to_event(&pool, &persona.id, "", None, None);
        assert!(result.is_err());

        let result2 = link_persona_to_event(&pool, &persona.id, "   ", None, None);
        assert!(result2.is_err());
    }

    #[test]
    fn test_s5_initialize_event_handlers_is_idempotent() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Pre-existing event_listener trigger WITHOUT a Builder-managed flag
        // (simulates template-created or manual trigger)
        create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "event_listener".into(),
                config: Some(r#"{"listen_event_type":"legacy.event"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        // First call seeds the handler
        let created = initialize_event_handlers_for_persona(&pool, &persona.id).unwrap();
        assert_eq!(created, 1);

        let sp = read_structured_prompt(&pool, &persona.id);
        assert!(sp
            .get("eventHandlers")
            .and_then(|h| h.get("legacy.event"))
            .is_some());

        // Second call is a no-op
        let created2 = initialize_event_handlers_for_persona(&pool, &persona.id).unwrap();
        assert_eq!(created2, 0);
    }

    #[test]
    fn test_s6_update_persona_event_handler() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Create with default handler
        link_persona_to_event(&pool, &persona.id, "my.event", None, None).unwrap();

        // Refine it
        let refined = "Refined handler: pull ticker from payload and alert.";
        update_persona_event_handler(&pool, &persona.id, "my.event", refined).unwrap();

        let sp = read_structured_prompt(&pool, &persona.id);
        let text = sp
            .get("eventHandlers")
            .and_then(|h| h.get("my.event"))
            .and_then(|v| v.as_str())
            .unwrap();
        assert_eq!(text, refined);
    }

    #[test]
    fn test_s3_link_preserves_existing_structured_prompt_fields() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Seed persona with an existing structured_prompt
        {
            let conn = pool.get().unwrap();
            let sp = serde_json::json!({
                "identity": "I am a test persona.",
                "instructions": "Do test things.",
                "toolGuidance": "Use test tools."
            });
            conn.execute(
                "UPDATE personas SET structured_prompt = ?1 WHERE id = ?2",
                params![sp.to_string(), persona.id],
            )
            .unwrap();
        }

        link_persona_to_event(&pool, &persona.id, "test.event", None, None).unwrap();

        let sp = read_structured_prompt(&pool, &persona.id);
        // Original fields preserved
        assert_eq!(sp.get("identity").and_then(|v| v.as_str()).unwrap(), "I am a test persona.");
        assert_eq!(sp.get("instructions").and_then(|v| v.as_str()).unwrap(), "Do test things.");
        assert_eq!(sp.get("toolGuidance").and_then(|v| v.as_str()).unwrap(), "Use test tools.");
        // New handler added
        assert!(sp
            .get("eventHandlers")
            .and_then(|h| h.get("test.event"))
            .is_some());
    }

    // ========================================================================
    // Fix 1 + Fix 2: orphan cleanup
    // ========================================================================

    #[test]
    fn test_fix1_delete_orphaned_triggers_skips_live_personas() {
        let pool = init_test_db().unwrap();
        let live_persona = create_test_persona(&pool);

        // Live persona's trigger should survive
        let live_trigger = create(
            &pool,
            CreateTriggerInput {
                persona_id: live_persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"0 * * * *"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        // Insert an orphan referencing a non-existent persona. FK is enforced
        // per-connection, so temporarily disable it on this connection to
        // simulate a pre-FK-enforcement install where orphans accumulated
        // (which is what the user's production DB looked like).
        {
            let conn = pool.get().unwrap();
            let _guard = crate::db::FkDisabledGuard::new(&conn).unwrap();
            conn.execute(
                "INSERT INTO persona_triggers
                 (id, persona_id, trigger_type, config, enabled, status, use_case_id, created_at, updated_at)
                 VALUES ('orphan-1', 'ghost-persona', 'schedule', '{}', 1, 'active', NULL, '2026-01-01', '2026-01-01')",
                [],
            )
            .unwrap();
        }

        let deleted = delete_orphaned_triggers(&pool).unwrap();
        assert_eq!(deleted, 1, "should delete exactly the one orphan");

        // Live trigger still there
        assert!(get_by_id(&pool, &live_trigger.id).is_ok());
        assert!(get_by_id(&pool, "orphan-1").is_err());
    }

    #[test]
    fn test_fix1_delete_orphaned_triggers_cascades_auto_listeners() {
        let pool = init_test_db().unwrap();

        // Create an orphaned source trigger + matching auto-listener directly
        // (simulates a trigger whose persona got deleted while the trigger +
        // its Fix 4a auto-listener lingered). Needs FK disabled because the
        // persona doesn't exist.
        {
            let conn = pool.get().unwrap();
            let _guard = crate::db::FkDisabledGuard::new(&conn).unwrap();
            conn.execute(
                "INSERT INTO persona_triggers
                 (id, persona_id, trigger_type, config, enabled, status, use_case_id, created_at, updated_at)
                 VALUES ('orphan-src', 'ghost', 'schedule', '{\"cron\":\"0 * * * *\"}', 1, 'active', NULL, '2026-01-01', '2026-01-01')",
                [],
            )
            .unwrap();
            // Auto-listener with the advisory pointer — unencrypted so json_extract works
            conn.execute(
                "INSERT INTO persona_triggers
                 (id, persona_id, trigger_type, config, enabled, status, use_case_id, created_at, updated_at)
                 VALUES ('orphan-listener', 'ghost', 'event_listener',
                   '{\"listen_event_type\":\"trigger_fired\",\"source_filter\":\"orphan-src\",\"_auto_for_trigger\":\"orphan-src\"}',
                   1, 'active', NULL, '2026-01-01', '2026-01-01')",
                [],
            )
            .unwrap();
        }

        let deleted = delete_orphaned_triggers(&pool).unwrap();
        // Both the source AND the listener should be gone: source via the
        // orphan loop, listener via the cascade pass inside the loop.
        assert_eq!(deleted, 2);
        assert!(get_by_id(&pool, "orphan-src").is_err());
        assert!(get_by_id(&pool, "orphan-listener").is_err());
    }

    // ========================================================================
    // Fix 4a: auto-listener wiring
    // ========================================================================

    #[test]
    fn test_fix4a_create_schedule_also_creates_auto_listener() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let src = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"*/15 * * * *"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        // Find the auto-listener by querying triggers for this persona
        let listeners = get_by_persona_id(&pool, &persona.id).unwrap();
        let auto_listener = listeners
            .iter()
            .find(|t| t.trigger_type == "event_listener")
            .expect("should have created an auto-listener");

        // Decrypt and inspect its config
        let decrypted = crypto::decrypt_trigger_config(auto_listener.config.as_deref().unwrap())
            .unwrap();
        let cfg: serde_json::Value = serde_json::from_str(&decrypted).unwrap();
        assert_eq!(
            cfg.get("listen_event_type").and_then(|v| v.as_str()).unwrap(),
            "trigger_fired",
            "default event_type should be trigger_fired",
        );
        assert_eq!(
            cfg.get("source_filter").and_then(|v| v.as_str()).unwrap(),
            src.id.as_str(),
            "source_filter should be the source trigger id"
        );
        assert_eq!(
            cfg.get("_auto_for_trigger").and_then(|v| v.as_str()).unwrap(),
            src.id.as_str(),
            "_auto_for_trigger advisory must match source id"
        );
    }

    #[test]
    fn test_fix4a_create_schedule_uses_custom_event_type() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"0 * * * *","event_type":"morning_digest"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        let listeners = get_by_persona_id(&pool, &persona.id).unwrap();
        let auto_listener = listeners
            .iter()
            .find(|t| t.trigger_type == "event_listener")
            .unwrap();
        let decrypted = crypto::decrypt_trigger_config(auto_listener.config.as_deref().unwrap())
            .unwrap();
        let cfg: serde_json::Value = serde_json::from_str(&decrypted).unwrap();
        assert_eq!(
            cfg.get("listen_event_type").and_then(|v| v.as_str()).unwrap(),
            "morning_digest",
        );
    }

    #[test]
    fn test_fix4a_manual_trigger_skips_auto_listener() {
        // Manual / event_listener / chain triggers should NOT get auto-listeners
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "manual".into(),
                config: None,
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        let listeners = get_by_persona_id(&pool, &persona.id).unwrap();
        let event_listeners = listeners
            .iter()
            .filter(|t| t.trigger_type == "event_listener")
            .count();
        assert_eq!(event_listeners, 0, "manual triggers should not auto-create listeners");
    }

    #[test]
    fn test_fix4a_delete_auto_listeners_for() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        let src = create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"0 0 * * *"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        // Confirm listener exists
        let listeners_before: Vec<_> = get_by_persona_id(&pool, &persona.id)
            .unwrap()
            .into_iter()
            .filter(|t| t.trigger_type == "event_listener")
            .collect();
        assert_eq!(listeners_before.len(), 1);

        // Cascade delete
        let removed = delete_auto_listeners_for(&pool, &src.id).unwrap();
        assert_eq!(removed, 1);

        let listeners_after: Vec<_> = get_by_persona_id(&pool, &persona.id)
            .unwrap()
            .into_iter()
            .filter(|t| t.trigger_type == "event_listener")
            .collect();
        assert_eq!(listeners_after.len(), 0);
    }

    #[test]
    fn test_fix4a_backfill_creates_missing_only() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Create a source trigger via a raw INSERT to simulate a pre-Fix-4a
        // trigger that never got its auto-listener.
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO persona_triggers
                 (id, persona_id, trigger_type, config, enabled, status, use_case_id, created_at, updated_at)
                 VALUES ('pre-fix-src', ?1, 'schedule', '{\"cron\":\"0 * * * *\"}', 1, 'active', NULL, '2026-01-01', '2026-01-01')",
                params![persona.id],
            ).unwrap();
        }

        let (scanned, created) = backfill_auto_listeners(&pool).unwrap();
        assert_eq!(scanned, 1);
        assert_eq!(created, 1);

        // Second call should be a no-op
        let (scanned2, created2) = backfill_auto_listeners(&pool).unwrap();
        assert_eq!(scanned2, 1);
        assert_eq!(created2, 0, "backfill must be idempotent");
    }

    #[test]
    fn test_fix4a_backfill_respects_existing_auto_listener() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Creating via create() produces both rows
        create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"0 * * * *"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        // Backfill finds the source but skips listener creation
        let (scanned, created) = backfill_auto_listeners(&pool).unwrap();
        assert_eq!(scanned, 1);
        assert_eq!(created, 0);
    }

    // ========================================================================
    // rename_event_type
    // ========================================================================

    use crate::db::models::CreatePersonaEventInput;
    use crate::db::repos::communication::events as event_repo;

    /// Helper: insert a persona_event_subscriptions row directly via SQL so we
    /// can verify the rename rewrites it, without going through the full
    /// create_subscription_with_trigger dual-write.
    fn insert_subscription(pool: &DbPool, persona_id: &str, event_type: &str) -> String {
        let conn = pool.get().unwrap();
        let sub_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO persona_event_subscriptions
             (id, persona_id, event_type, source_filter, enabled, use_case_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, NULL, 1, NULL, ?4, ?4)",
            params![sub_id, persona_id, event_type, now],
        )
        .unwrap();
        sub_id
    }

    /// Helper: seed the persona with an eventHandlers entry via direct SQL.
    fn seed_handler(pool: &DbPool, persona_id: &str, event_type: &str, text: &str) {
        let sp = serde_json::json!({
            "identity": "Test identity.",
            "instructions": "Do things.",
            "eventHandlers": { event_type: text }
        })
        .to_string();
        let conn = pool.get().unwrap();
        conn.execute(
            "UPDATE personas SET structured_prompt = ?1 WHERE id = ?2",
            params![sp, persona_id],
        )
        .unwrap();
    }

    /// Helper: read structured_prompt + return eventHandlers object.
    fn read_handlers(pool: &DbPool, persona_id: &str) -> serde_json::Value {
        let conn = pool.get().unwrap();
        let sp: Option<String> = conn
            .query_row(
                "SELECT structured_prompt FROM personas WHERE id = ?1",
                params![persona_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .unwrap();
        sp.as_deref()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
            .and_then(|v| v.get("eventHandlers").cloned())
            .unwrap_or(serde_json::Value::Null)
    }

    #[test]
    fn test_rename_happy_path_updates_every_store() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // 1. Historical persona_event (source_type: 'trigger' + source_id required
        //    to satisfy validators). The exact values don't matter; only the
        //    event_type column is what we're renaming.
        event_repo::publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "stock.alert.old_name".into(),
                source_type: "trigger".into(),
                source_id: Some("fake-trigger-id".into()),
                target_persona_id: None,
                project_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();

        // 2. Legacy subscription row
        insert_subscription(&pool, &persona.id, "stock.alert.old_name");

        // 3. Trigger publisher: create a schedule trigger with custom event_type.
        //    This ALSO creates a Fix 4a auto-listener with the matching
        //    listen_event_type, which is a second trigger row we expect the
        //    rename to rewrite.
        create(
            &pool,
            CreateTriggerInput {
                persona_id: persona.id.clone(),
                trigger_type: "schedule".into(),
                config: Some(r#"{"cron":"*/15 * * * *","event_type":"stock.alert.old_name"}"#.into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        // 4. S3 link_persona_to_event creates another event_listener with the
        //    _handler_key advisory set to the event_type.
        link_persona_to_event(&pool, &persona.id, "stock.alert.old_name", Some("Handle old name."), None).unwrap();

        // 5. Persona handler entry — already seeded by the S3 link above.
        //    Confirm it's there before rename.
        let before = read_handlers(&pool, &persona.id);
        assert!(before.get("stock.alert.old_name").is_some());

        // ── Rename ──
        let result = rename_event_type(&pool, "stock.alert.old_name", "stock.alert.new_name").unwrap();

        assert_eq!(result.events_updated, 1, "historical events should be rewritten");
        assert_eq!(result.subscriptions_updated, 1, "legacy subs should be rewritten");
        assert_eq!(
            result.trigger_publishers_updated, 1,
            "the schedule trigger's config.event_type should be rewritten",
        );
        assert!(
            result.trigger_listeners_updated >= 2,
            "both the Fix 4a auto-listener AND the S3 link_persona event_listener should be rewritten",
        );
        assert_eq!(
            result.handler_keys_updated, 1,
            "the S3 _handler_key advisory should be rewritten",
        );
        assert_eq!(result.persona_handlers_updated, 1);

        // ── Verify: nothing references the old name anymore ──
        assert!(!event_type_in_use(&pool, "stock.alert.old_name").unwrap());
        assert!(event_type_in_use(&pool, "stock.alert.new_name").unwrap());

        // structured_prompt eventHandlers key was moved
        let after = read_handlers(&pool, &persona.id);
        assert!(after.get("stock.alert.old_name").is_none());
        assert_eq!(
            after.get("stock.alert.new_name").and_then(|v| v.as_str()).unwrap(),
            "Handle old name.",
            "handler text is preserved verbatim, only the key name changes",
        );
    }

    #[test]
    fn test_rename_rejects_empty_names() {
        let pool = init_test_db().unwrap();
        assert!(rename_event_type(&pool, "", "new").is_err());
        assert!(rename_event_type(&pool, "old", "").is_err());
        assert!(rename_event_type(&pool, "   ", "new").is_err());
    }

    #[test]
    fn test_rename_rejects_same_name() {
        let pool = init_test_db().unwrap();
        let err = rename_event_type(&pool, "same", "same").unwrap_err();
        assert!(format!("{err:?}").contains("identical"));
    }

    #[test]
    fn test_rename_rejects_reserved_source() {
        let pool = init_test_db().unwrap();
        for reserved in RESERVED_EVENT_TYPES {
            let err = rename_event_type(&pool, reserved, "my_custom_name").unwrap_err();
            assert!(
                format!("{err:?}").contains("reserved"),
                "expected reserved-name error for {reserved}, got {err:?}",
            );
        }
    }

    #[test]
    fn test_rename_rejects_reserved_target() {
        let pool = init_test_db().unwrap();
        let err = rename_event_type(&pool, "some_custom_event", "trigger_fired").unwrap_err();
        assert!(format!("{err:?}").contains("reserved"));
    }

    #[test]
    fn test_rename_rejects_invalid_format() {
        let pool = init_test_db().unwrap();
        // Starts with a digit? That's actually fine per the validator (alnum).
        // Starts with a dot? Not allowed.
        let err = rename_event_type(&pool, "old_name", ".leading.dot").unwrap_err();
        assert!(format!("{err:?}").contains("invalid characters"));
        // Contains a space? Not allowed.
        let err2 = rename_event_type(&pool, "old_name", "has space").unwrap_err();
        assert!(format!("{err2:?}").contains("invalid characters"));
    }

    #[test]
    fn test_rename_rejects_collision() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Seed an existing stream under the target name.
        insert_subscription(&pool, &persona.id, "already.exists");

        let err = rename_event_type(&pool, "old_name", "already.exists").unwrap_err();
        assert!(format!("{err:?}").contains("already in use"));
    }

    #[test]
    fn test_rename_no_op_when_old_has_no_references() {
        // Renaming an event type that isn't referenced anywhere should succeed
        // with zero counts across the board (it's idempotent — nothing breaks).
        let pool = init_test_db().unwrap();
        let result = rename_event_type(&pool, "nonexistent.event", "also_nonexistent").unwrap();
        assert_eq!(result.events_updated, 0);
        assert_eq!(result.subscriptions_updated, 0);
        assert_eq!(result.trigger_publishers_updated, 0);
        assert_eq!(result.trigger_listeners_updated, 0);
        assert_eq!(result.handler_keys_updated, 0);
        assert_eq!(result.persona_handlers_updated, 0);
    }

    #[test]
    fn test_rename_preserves_other_handlers_and_other_events() {
        let pool = init_test_db().unwrap();
        let persona = create_test_persona(&pool);

        // Seed a persona with TWO handler keys; only one should be renamed.
        let sp = serde_json::json!({
            "identity": "Multi-handler persona.",
            "eventHandlers": {
                "event.one": "handler one",
                "event.two": "handler two"
            }
        })
        .to_string();
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "UPDATE personas SET structured_prompt = ?1 WHERE id = ?2",
                params![sp, persona.id],
            )
            .unwrap();
        }

        // Add subscriptions for both names
        insert_subscription(&pool, &persona.id, "event.one");
        insert_subscription(&pool, &persona.id, "event.two");

        rename_event_type(&pool, "event.one", "event.renamed").unwrap();

        let handlers = read_handlers(&pool, &persona.id);
        assert!(handlers.get("event.one").is_none());
        assert_eq!(
            handlers.get("event.renamed").and_then(|v| v.as_str()).unwrap(),
            "handler one",
        );
        // Untouched sibling
        assert_eq!(
            handlers.get("event.two").and_then(|v| v.as_str()).unwrap(),
            "handler two",
        );

        // event.two subscription untouched
        assert!(event_type_in_use(&pool, "event.two").unwrap());
    }

    #[test]
    fn test_rename_event_type_in_use_returns_false_for_unknown() {
        let pool = init_test_db().unwrap();
        assert!(!event_type_in_use(&pool, "totally.unseen.event").unwrap());
    }

    // Placate the "unused import" lint for helpers used only by specific tests.
    #[allow(dead_code)]
    fn _seed_handler_keeper(pool: &DbPool, persona_id: &str) {
        seed_handler(pool, persona_id, "x", "y");
    }
}
