//! The persona <-> event binding lifecycle.
//!
//! Two stores move together here: the `event_listener` trigger row and the
//! matching entry in `personas.structured_prompt.eventHandlers`. Neither is
//! meaningful without the other, so every write in this module is a single
//! transaction spanning both. The event-type rename path is the same shape at
//! a larger radius — it rewrites four stores at once.

use rusqlite::params;

use crate::models::PersonaTrigger;
use crate::DbPool;
use personas_core::crypto;
use personas_core::error::AppError;

use super::definitions::{encrypt_config, get_by_persona_id, validate_config};
use super::get_by_id;

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
    // FOREIGN TABLE: personas is owned by `repos::core::personas`.
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
        Some(s) if !s.trim().is_empty() => serde_json::from_str(s).unwrap_or_else(|err| {
            // Corrupted JSON -- start fresh, but preserve identity from system_prompt.
            tracing::warn!(persona_id = persona_id, error = %err, "structured_prompt JSON corrupted; rebuilding minimal object");
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

    // FOREIGN TABLE: personas is owned by `repos::core::personas`.
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
    // FOREIGN TABLE: personas is owned by `repos::core::personas`.
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
    let mut sp_val = match serde_json::from_str::<serde_json::Value>(&sp_str) {
        Ok(v) => v,
        Err(err) => {
            tracing::warn!(persona_id = persona_id, error = %err, "structured_prompt JSON corrupted; skipping handler removal");
            return Ok(()); // corrupted → skip (don't crash deletion)
        }
    };
    let Some(sp_obj) = sp_val.as_object_mut() else {
        return Ok(());
    };
    let Some(handlers) = sp_obj
        .get_mut("eventHandlers")
        .and_then(|v| v.as_object_mut())
    else {
        return Ok(());
    };
    if handlers.remove(event_type).is_none() {
        return Ok(());
    }

    let new_sp = serde_json::to_string(&sp_val)
        .map_err(|e| AppError::Internal(format!("Failed to serialize structured_prompt: {e}")))?;
    // FOREIGN TABLE: personas is owned by `repos::core::personas`.
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
    timed_query!(
        "persona_triggers",
        "persona_triggers::link_persona_to_event",
        {
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
        }
    )
}

/// Inverse of `link_persona_to_event`: remove the trigger AND the matching
/// handler entry in a single transaction. If the trigger's config carries a
/// `_handler_key` advisory field, that key is removed; otherwise the trigger's
/// `listen_event_type` is used.
pub fn unlink_persona_from_event(pool: &DbPool, trigger_id: &str) -> Result<(), AppError> {
    timed_query!(
        "persona_triggers",
        "persona_triggers::unlink_persona_from_event",
        {
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
            serde_json::from_str(&config_str).unwrap_or_else(|err| {
                tracing::warn!(trigger_id = trigger_id, error = %err, "trigger config JSON corrupted; treating as empty");
                serde_json::Value::Null
            });
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
        }
    )
}

/// Backfill: seed a persona's `eventHandlers` from its existing event_listener
/// triggers. Idempotent — existing handlers are preserved, only missing keys
/// are filled in with the default placeholder. Returns the number of entries
/// created.
pub fn initialize_event_handlers_for_persona(
    pool: &DbPool,
    persona_id: &str,
) -> Result<u32, AppError> {
    timed_query!(
        "persona_triggers",
        "persona_triggers::initialize_event_handlers_for_persona",
        {
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
                // FOREIGN TABLE: personas is owned by `repos::core::personas`.
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
        }
    )
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
    timed_query!(
        "persona_triggers",
        "persona_triggers::update_persona_event_handler",
        {
            if event_type.trim().is_empty() {
                return Err(AppError::Validation("event_type cannot be empty".into()));
            }
            let mut conn = pool.get()?;
            let tx = conn.transaction().map_err(AppError::Database)?;
            patch_persona_event_handler_in_tx(&tx, persona_id, event_type, handler_text)?;
            tx.commit().map_err(AppError::Database)?;
            Ok(())
        }
    )
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
            // FOREIGN TABLE: persona_events is owned by `repos::communication::events`.
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
            // FOREIGN TABLE: persona_event_subscriptions is owned by `repos::communication::events`.
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
        // FOREIGN TABLE: personas is owned by `repos::core::personas`.
        let sps: Vec<String> = {
            let mut stmt = conn.prepare_cached(
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
        use crate::repos::communication::events as event_repo;

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
        // FOREIGN TABLE: persona_events is owned by `repos::communication::events`.
        let events_updated = tx.execute(
            "UPDATE persona_events SET event_type = ?1 WHERE event_type = ?2",
            params![new, old],
        )? as u32;

        // 2. persona_event_subscriptions.event_type
        // FOREIGN TABLE: persona_event_subscriptions is owned by `repos::communication::events`.
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
            // FOREIGN TABLE: personas is owned by `repos::core::personas`.
            let candidates: Vec<(String, String)> = {
                let mut stmt = tx.prepare(
                    "SELECT id, structured_prompt FROM personas
                     WHERE structured_prompt IS NOT NULL
                       AND json_extract(structured_prompt, '$.eventHandlers') IS NOT NULL",
                )?;
                let rows = stmt.query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
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
                    // FOREIGN TABLE: personas is owned by `repos::core::personas`.
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
