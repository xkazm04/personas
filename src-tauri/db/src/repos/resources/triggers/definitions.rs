//! Trigger *definitions* — the authoring lifecycle of `persona_triggers`.
//!
//! A row here is written by a human (or an adoption/import path) and then
//! rarely touched again: validate, encrypt, arm, insert, update, orphan-sweep.
//! The firing-time state that used to share this module lives next door in
//! [`super::scheduling`] and [`super::fires`].
//!
//! The paired Fix 4a auto-listener rows are part of this same lifecycle — they
//! are created and cascade-deleted in lock-step with the definition they shadow
//! — so they stay here rather than in [`super::event_wiring`].

use rusqlite::{params, OptionalExtension};

use super::scheduling::{clear_schedule_status_reason, set_schedule_status_reason};
use super::{get_by_id, row_to_trigger};
use crate::chain;
use crate::models::{CreateTriggerInput, PersonaTrigger, TriggerConfig, UpdateTriggerInput};
use crate::query_builder::QueryBuilder;
use crate::DbPool;
use personas_core::error::AppError;
use personas_core::validation::contract::check as validate_check;
use personas_core::validation::trigger as tv;
use personas_core::{crypto, scheduler};

pub fn normalize_trigger_type(raw: &str) -> &str {
    tv::normalize_trigger_type(raw)
}

pub fn validate_trigger_type(trigger_type: &str) -> Result<(), AppError> {
    validate_check(tv::validate_trigger_type(trigger_type))
}

pub fn validate_config(trigger_type: &str, config: Option<&str>) -> Result<(), AppError> {
    validate_check(tv::validate_config(trigger_type, config))
}

/// Every door-side validator, in one place.
///
/// `create`/`update` used to run only `validate_config`, while
/// `validate_polling_url` (the SSRF guard) and
/// `validate_schedule_has_cron_or_interval` (the "this schedule can never fire"
/// preflight) lived ONLY in the `create_trigger` IPC command — so every other
/// creation path (template adoption, build sessions, n8n import, data import,
/// team handoff, chain wiring) bypassed both. Calling them here makes the repo
/// the door rather than one of several.
pub fn validate_all(trigger_type: &str, config: Option<&str>) -> Result<(), AppError> {
    let mut errors = tv::validate_config(trigger_type, config);
    errors.extend(tv::validate_polling_url(trigger_type, config));
    errors.extend(tv::validate_schedule_has_cron_or_interval(
        trigger_type,
        config,
    ));
    validate_check(errors)
}

/// Compute `next_trigger_at`, refusing rather than writing a **born-dead** row.
///
/// A trigger whose kind is time-based (`schedule`, `polling`) and whose
/// `next_trigger_at` is NULL is invisible to `get_due` forever — it renders
/// `armed` and never runs. Nothing in the app can currently tell the user that,
/// so the only honest outcome is to refuse at creation with a message naming
/// the reason. For every other kind a NULL is correct (they are woken by a
/// webhook, an event, a chain, a file, the clipboard, …), so this returns
/// `Ok(None)` for them.
fn arm_or_refuse(
    trigger_type: &str,
    parsed_cfg: &TriggerConfig,
    plaintext_config: Option<&str>,
    seed: u64,
) -> Result<Option<String>, AppError> {
    let next = scheduler::compute_next_from_config(parsed_cfg, chrono::Utc::now(), seed);
    let time_based = personas_core::models::TriggerKind::from_wire(trigger_type)
        .is_some_and(|k| k.is_time_based());
    if next.is_none() && time_based {
        validate_check(vec![tv::unschedulable_error(
            trigger_type,
            plaintext_config,
        )])?;
    }
    Ok(next)
}

/// Encrypt sensitive fields in a trigger config JSON string before writing to DB.
/// Returns an error if encryption fails -- secrets must never be stored in plaintext.
pub fn encrypt_config(config: &str) -> Result<String, AppError> {
    crypto::encrypt_trigger_config(config).map_err(|e| {
        tracing::error!("Failed to encrypt trigger config: {}", e);
        AppError::Internal(format!("Trigger config encryption failed: {e}"))
    })
}

pub fn get_by_persona_id(pool: &DbPool, persona_id: &str) -> Result<Vec<PersonaTrigger>, AppError> {
    timed_query!("persona_triggers", "persona_triggers::get_by_persona_id", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "SELECT * FROM persona_triggers WHERE persona_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![persona_id], row_to_trigger)?;
        let triggers = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        Ok(triggers)
    })
}

/// Bulk-fetch triggers for multiple persona IDs in a single query.
pub fn get_by_persona_ids(
    pool: &DbPool,
    persona_ids: &[String],
) -> Result<Vec<PersonaTrigger>, AppError> {
    timed_query!(
        "persona_triggers",
        "persona_triggers::get_by_persona_ids",
        {
            if persona_ids.is_empty() {
                return Ok(Vec::new());
            }
            let conn = pool.get()?;
            let mut qb = QueryBuilder::new();
            qb.where_in("persona_id", persona_ids.to_vec());
            qb.order_by("created_at", "DESC");
            let sql = qb.build_select("SELECT * FROM persona_triggers");
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_trigger)?;
            let triggers = rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?;
            Ok(triggers)
        }
    )
}

pub fn create(pool: &DbPool, mut input: CreateTriggerInput) -> Result<PersonaTrigger, AppError> {
    timed_query!("persona_triggers", "persona_triggers::create", {
        input.trigger_type = normalize_trigger_type(&input.trigger_type).to_string();
        validate_trigger_type(&input.trigger_type)?;
        validate_all(&input.trigger_type, input.config.as_deref())?;

        // Chain triggers: reject configurations that would create a cycle.
        // A parse failure here used to be silently swallowed, which let a
        // malformed-but-still-cyclic config slip past detection. Surface the
        // parse error as a Validation failure so the cycle check is a guarantee
        // rather than a coincidence.
        if input.trigger_type == "chain" {
            if let Some(ref config_str) = input.config {
                let parsed: serde_json::Value = serde_json::from_str(config_str).map_err(|e| {
                    AppError::Validation(format!("Chain trigger config is not valid JSON: {e}"))
                })?;
                if let Some(source_id) = parsed.get("source_persona_id").and_then(|v| v.as_str()) {
                    chain::detect_chain_cycle(pool, source_id, &input.persona_id, None)?;
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
        // atomically in the same transaction as the INSERT — and REFUSE if a
        // time-based trigger comes out with none, rather than writing a row
        // that can never become due. Nothing downstream reports that state, so
        // the door is the only place a user can be told.
        let parsed_cfg = TriggerConfig::from_raw(&input.trigger_type, input.config.as_deref());
        let next_trigger_at = arm_or_refuse(
            &input.trigger_type,
            &parsed_cfg,
            input.config.as_deref(),
            personas_core::cron::seed_hash(&id),
        )?;
        let invalid_timezone = scheduler::invalid_schedule_timezone(&parsed_cfg);

        // Fix 4a: for schedule / polling / webhook source triggers, auto-create a
        // paired event_listener inside the same transaction so the target persona
        // actually runs when the trigger fires. Without this, the scheduler would
        // publish an event into the bus that nothing listens to. See the
        // auto-listener helpers below + docs/design/event-routing-proposal.md.
        let needs_auto_listener = AUTO_LISTENER_SOURCE_TYPES.contains(&input.trigger_type.as_str());

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

        if let Some((cron_expr, timezone, error)) = invalid_timezone {
            record_invalid_timezone_issue(
                pool,
                &id,
                &input.persona_id,
                &cron_expr,
                &timezone,
                &error,
            );
        }

        get_by_id(pool, &id)
    })
}

/// Set the destructive-action gate (`unattended_mode`) for a trigger directly.
/// Kept off `CreateTriggerInput`/`UpdateTriggerInput` to avoid a field cascade
/// across the ~30 construction sites; the UI calls the dedicated command. (UAT P5)
pub fn set_unattended_mode(
    pool: &DbPool,
    id: &str,
    mode: &str,
) -> Result<PersonaTrigger, AppError> {
    timed_query!(
        "persona_triggers",
        "persona_triggers::set_unattended_mode",
        {
            if !crate::models::UNATTENDED_MODES.contains(&mode) {
                return Err(AppError::Validation(format!(
                    "Invalid unattended_mode '{mode}' (expected one of: auto, dry_run, approval)"
                )));
            }
            let now = chrono::Utc::now().to_rfc3339();
            let conn = pool.get()?;
            conn.execute(
                "UPDATE persona_triggers SET unattended_mode = ?1, updated_at = ?2 WHERE id = ?3",
                params![mode, now, id],
            )?;
            // get_by_id surfaces a NotFound if the id didn't exist (UPDATE affects 0 rows).
            get_by_id(pool, id)
        }
    )
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

        let effective_type = input
            .trigger_type
            .as_deref()
            .unwrap_or(&existing.trigger_type);

        if let Some(ref cfg) = input.config {
            // Same door as `create`: the SSRF guard and the schedule-timing
            // preflight used to run only in the `update_trigger` IPC command,
            // so every other update path skipped them.
            validate_all(effective_type, Some(cfg.as_str()))?;
            // …and refuse to edit a live trigger INTO a dead one. Checked
            // before the write, on the caller's plaintext config, so a refusal
            // leaves the stored row untouched. (The post-write recompute below
            // is what would otherwise silently NULL `next_trigger_at`.)
            let candidate = TriggerConfig::from_raw(effective_type, Some(cfg.as_str()));
            arm_or_refuse(
                effective_type,
                &candidate,
                Some(cfg.as_str()),
                personas_core::cron::seed_hash(id),
            )?;
        }

        // Chain triggers: reject configurations that would create a cycle.
        // Only validate if the caller is passing a new config — falling back to
        // the stored config can be parseable (sensitive fields are encrypted in
        // place but the surrounding JSON envelope is intact) so we still run
        // cycle detection on it, but a malformed payload from the caller now
        // fails loudly instead of being silently dropped.
        if effective_type == "chain" {
            let config_str = input.config.as_deref().or(existing.config.as_deref());
            if let Some(cfg) = config_str {
                let parsed: serde_json::Value = serde_json::from_str(cfg).map_err(|e| {
                    AppError::Validation(format!("Chain trigger config is not valid JSON: {e}"))
                })?;
                if let Some(source_id) = parsed.get("source_persona_id").and_then(|v| v.as_str()) {
                    chain::detect_chain_cycle(pool, source_id, &existing.persona_id, Some(id))?;
                }
            }
        }

        // Encrypt sensitive config fields before writing to DB
        let encrypted_config = input.config.as_deref().map(encrypt_config).transpose()?;

        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        // When `enabled` changes, derive the corresponding status string.
        let derived_status: Option<String> = input.enabled.map(|e| {
            if e {
                "active".into()
            } else {
                "disabled".into()
            }
        });

        // Build dynamic SET clause
        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

        push_field_param!(
            input.trigger_type,
            "trigger_type",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            encrypted_config,
            "config",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.enabled,
            "enabled",
            sets,
            param_idx,
            param_values,
            bool
        );
        push_field_param!(
            derived_status,
            "status",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.next_trigger_at,
            "next_trigger_at",
            sets,
            param_idx,
            param_values,
            clone
        );

        let sql = format!(
            "UPDATE persona_triggers SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );

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
            if let Some((cron_expr, timezone, error)) =
                scheduler::invalid_schedule_timezone(&updated.parse_config())
            {
                record_invalid_timezone_issue(
                    pool,
                    &updated.id,
                    &updated.persona_id,
                    &cron_expr,
                    &timezone,
                    &error,
                );
            } else {
                // Direction 3: schedule is valid again (e.g. the timezone was
                // corrected) — clear any persisted pause reason so the row stops
                // showing "Paused (invalid timezone)".
                if let Err(e) = clear_schedule_status_reason(pool, id) {
                    tracing::warn!(trigger_id = id, error = %e, "failed to clear schedule status reason");
                }
            }
        }

        get_by_id(pool, id)
    })
}

fn record_invalid_timezone_issue(
    pool: &DbPool,
    trigger_id: &str,
    persona_id: &str,
    cron_expr: &str,
    timezone: &str,
    error: &str,
) {
    // Direction 3 (lost fires get a home): persist a machine-readable reason so
    // the schedule row can explain WHY next_trigger_at is NULL instead of just
    // showing "Paused/Unscheduled". Done before the dedup gate below so the
    // reason is always current even when the healing issue is already open.
    let detail = format!("timezone `{timezone}` for cron `{cron_expr}` ({error})");
    if let Err(e) = set_schedule_status_reason(pool, trigger_id, "invalid_timezone", Some(&detail))
    {
        tracing::warn!(
            trigger_id,
            persona_id,
            error = %e,
            "failed to persist invalid-timezone schedule status reason"
        );
    }

    let title = "Fix schedule timezone";
    let description = format!(
        "Scheduled trigger `{trigger_id}` uses invalid timezone `{timezone}` for cron `{cron_expr}` ({error}). \
         The trigger is paused until the timezone is corrected so it does not fire at the host machine's local time."
    );

    // FOREIGN TABLE: persona_healing_issues is owned by `repos::execution::healing`.
    let already_open = match pool.get() {
        Ok(conn) => conn
            .query_row(
                "SELECT 1 FROM persona_healing_issues
                 WHERE persona_id = ?1
                   AND status = 'open'
                   AND category = 'schedule_timezone'
                   AND description LIKE ?2
                 LIMIT 1",
                params![persona_id, format!("%`{trigger_id}`%")],
                |_| Ok(()),
            )
            .optional()
            .map(|row| row.is_some())
            .unwrap_or(false),
        Err(_) => false,
    };

    if already_open {
        return;
    }

    if let Err(e) = crate::repos::execution::healing::create(
        pool,
        persona_id,
        title,
        &description,
        true,
        Some("medium"),
        Some("schedule_timezone"),
        None,
        Some("Edit the schedule and choose a valid IANA timezone such as `America/New_York`, `Europe/Prague`, or `UTC`."),
    ) {
        tracing::warn!(
            trigger_id,
            persona_id,
            timezone,
            error = %e,
            "failed to create invalid schedule timezone healing issue"
        );
    }
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
    timed_query!(
        "persona_triggers",
        "persona_triggers::delete_orphaned_triggers",
        {
            let mut conn = pool.get()?;
            let tx = conn.transaction().map_err(AppError::Database)?;

            // 1. Find all orphaned trigger IDs.
            let orphan_ids: Vec<String> = {
                // FOREIGN TABLE: personas is owned by `repos::core::personas`.
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
                deleted +=
                    tx.execute("DELETE FROM persona_triggers WHERE id = ?1", params![id])? as u32;
            }

            tx.commit().map_err(AppError::Database)?;
            Ok(deleted)
        }
    )
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

/// Trigger types that get a paired auto-created `event_listener` row at
/// create time (and a matching cascade-delete on teardown).
///
/// ## Membership policy — pinned by `auto_listener_policy_tests`
///
/// A trigger type belongs in this set **iff all three** of the following hold:
///
///   1. **It publishes** at least one event onto the in-process event bus
///      during normal firing. (i.e. there's something for a listener to hear.)
///   2. **It does not also self-listen.** Triggers that are *themselves* the
///      consumer side of the bus (`event_listener`) must be excluded — pairing
///      one with another listener would loop.
///   3. **No other code path registers a listener for the published event.**
///      Triggers whose pairing is implicit elsewhere (e.g. `composite`'s
///      inner triggers carry their own auto-listeners; `chain` is invoked
///      directly by an upstream execution; OS event sources like
///      `file_watcher` / `clipboard` / `app_focus` callback into their own
///      handlers) don't need this safety net.
///
/// The exhaustive-classification test in this module forces every entry in
/// `VALID_TRIGGER_TYPES` to be tagged either `Auto { … }` or
/// `NoListener { reason }`, so adding a new trigger type without making this
/// decision fails the test rather than silently producing events nothing
/// listens for.
pub(crate) const AUTO_LISTENER_SOURCE_TYPES: &[&str] = &["schedule", "polling", "webhook"];

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
    timed_query!(
        "persona_triggers",
        "persona_triggers::delete_auto_listeners_for",
        {
            let conn = pool.get()?;
            let rows = conn.execute(
                "DELETE FROM persona_triggers
             WHERE trigger_type = 'event_listener'
               AND json_extract(config, '$._auto_for_trigger') = ?1",
                params![source_trigger_id],
            )?;
            Ok(rows as u32)
        }
    )
}

/// Backfill: walk every schedule/polling/webhook trigger in the DB and create
/// a matching event_listener auto-listener for any that don't already have
/// one. Idempotent. Returns (triggers_scanned, listeners_created).
pub fn backfill_auto_listeners(pool: &DbPool) -> Result<(u32, u32), AppError> {
    timed_query!(
        "persona_triggers",
        "persona_triggers::backfill_auto_listeners",
        {
            // 1. Load all source triggers that need auto-listeners.
            let candidates: Vec<PersonaTrigger> = {
                let conn = pool.get()?;
                let mut stmt = conn.prepare_cached(
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
                let mut stmt = conn.prepare_cached(
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
        }
    )
}
