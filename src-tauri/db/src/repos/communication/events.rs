use rusqlite::{params, OptionalExtension};

use crate::models::{
    CreateEventSubscriptionInput, CreatePersonaEventInput, CreateTriggerInput, EventFilterInput,
    PersonaEvent, PersonaEventStatus, PersonaEventSubscription, UpdateEventSubscriptionInput,
};
use crate::query_builder::QueryBuilder;
use crate::repos::resources::triggers::encrypt_config;
use crate::repos::utils::collect_rows;
use crate::DbPool;
use personas_core::crypto;
use personas_core::error::AppError;

// ============================================================================
// Input Validation
// ============================================================================

/// Maximum payload size in bytes (64 KB).
const MAX_PAYLOAD_BYTES: usize = 64 * 1024;

/// Maximum length for event_type and source_type strings.
pub(crate) const MAX_TYPE_LEN: usize = 128;

/// Validate that `event_type` and `source_type` contain only safe characters:
/// alphanumeric, underscore, hyphen, dot, colon, forward-slash.
/// Must start with an alphanumeric or underscore character.
pub(crate) fn is_safe_type_string(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let first = s.as_bytes()[0];
    if !(first.is_ascii_alphanumeric() || first == b'_') {
        return false;
    }
    s.bytes().all(|b| {
        b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.' || b == b':' || b == b'/'
    })
}

/// Validate and sanitize a `CreatePersonaEventInput` before publishing.
fn validate_event_input(input: &CreatePersonaEventInput) -> Result<(), AppError> {
    // -- event_type --
    if input.event_type.is_empty() {
        return Err(AppError::Validation("event_type must not be empty".into()));
    }
    if input.event_type.len() > MAX_TYPE_LEN {
        return Err(AppError::Validation(format!(
            "event_type exceeds maximum length of {MAX_TYPE_LEN} characters"
        )));
    }
    if !is_safe_type_string(&input.event_type) {
        return Err(AppError::Validation(
            "event_type contains invalid characters; only alphanumeric, underscore, hyphen, dot, colon, and forward-slash are allowed".into(),
        ));
    }

    // -- source_type --
    if input.source_type.is_empty() {
        return Err(AppError::Validation("source_type must not be empty".into()));
    }
    if input.source_type.len() > MAX_TYPE_LEN {
        return Err(AppError::Validation(format!(
            "source_type exceeds maximum length of {MAX_TYPE_LEN} characters"
        )));
    }
    if !is_safe_type_string(&input.source_type) {
        return Err(AppError::Validation(
            "source_type contains invalid characters; only alphanumeric, underscore, hyphen, dot, colon, and forward-slash are allowed".into(),
        ));
    }

    // -- payload size --
    if let Some(ref payload) = input.payload {
        if payload.len() > MAX_PAYLOAD_BYTES {
            return Err(AppError::Validation(format!(
                "payload exceeds maximum size of {} bytes ({} bytes provided)",
                MAX_PAYLOAD_BYTES,
                payload.len()
            )));
        }
    }

    Ok(())
}

// ============================================================================
// Helpers
// ============================================================================

/// Encrypt an optional payload for at-rest storage.
///
/// Returns `(stored_payload, payload_iv)`. If encryption fails, the plaintext
/// is returned with `None` IV and a warning is logged.
fn encrypt_optional_payload(payload: &Option<String>) -> (Option<String>, Option<String>) {
    match payload {
        Some(plaintext) if !plaintext.is_empty() => match crypto::encrypt_for_db(plaintext) {
            Ok((ct, iv)) => (Some(ct), Some(iv)),
            Err(e) => {
                tracing::warn!("Failed to encrypt event payload, storing plaintext: {}", e);
                (Some(plaintext.clone()), None)
            }
        },
        other => (other.clone(), None),
    }
}

// ============================================================================
// Row Mappers
// ============================================================================

fn row_to_event(row: &rusqlite::Row) -> rusqlite::Result<PersonaEvent> {
    let raw_payload: Option<String> = row.get("payload")?;
    let payload_iv: Option<String> = row.get("payload_iv").unwrap_or(None);

    // Decrypt payload if IV is present (encrypted at rest), otherwise return as-is.
    // On decrypt failure, return None instead of leaking ciphertext to the frontend,
    // and surface the error in the error_message field.
    let raw_error: Option<String> = row.get("error_message")?;
    let (payload, error_message) = match (raw_payload, payload_iv) {
        (Some(ct), Some(ref iv)) if !iv.is_empty() => match crypto::decrypt_from_db(&ct, iv) {
            Ok(pt) => (Some(pt), raw_error),
            Err(e) => {
                tracing::warn!("Failed to decrypt event payload: {}", e);
                let decrypt_err = format!("[Decryption failed: {}]", e);
                let combined = match raw_error {
                    Some(existing) => Some(format!("{existing}; {decrypt_err}")),
                    None => Some(decrypt_err),
                };
                (None, combined)
            }
        },
        (p, _) => (p, raw_error), // Plaintext or no payload
    };

    let status_str: String = row.get("status")?;
    Ok(PersonaEvent {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        event_type: row.get("event_type")?,
        source_type: row.get("source_type")?,
        source_id: row.get("source_id")?,
        target_persona_id: row.get("target_persona_id")?,
        payload,
        status: PersonaEventStatus::from_db(&status_str),
        error_message,
        processed_at: row.get("processed_at")?,
        created_at: row.get("created_at")?,
        use_case_id: row.get("use_case_id")?,
        retry_count: row.get("retry_count").unwrap_or(0),
    })
}

row_mapper!(row_to_subscription -> PersonaEventSubscription {
    id,
    persona_id,
    event_type,
    source_filter,
    enabled [bool],
    created_at,
    updated_at,
    use_case_id,
});

// ============================================================================
// Events
// ============================================================================

pub fn publish(pool: &DbPool, input: CreatePersonaEventInput) -> Result<PersonaEvent, AppError> {
    validate_event_input(&input)?;

    timed_query!("persona_events", "persona_events::publish", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let project_id = input.project_id.unwrap_or_else(|| "default".into());

        // Encrypt payload at rest if present
        let (stored_payload, payload_iv) = encrypt_optional_payload(&input.payload);

        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "INSERT INTO persona_events
             (id, project_id, event_type, source_type, source_id, target_persona_id, payload, payload_iv, use_case_id, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', ?10)",
        )?;
        stmt.execute(params![
            id,
            project_id,
            input.event_type,
            input.source_type,
            input.source_id,
            input.target_persona_id,
            stored_payload,
            payload_iv,
            input.use_case_id,
            now,
        ])?;

        get_by_id(pool, &id)
    })
}

crud_get_by_id!(PersonaEvent, "persona_events", "PersonaEvent", row_to_event);

pub fn get_pending(
    pool: &DbPool,
    limit: Option<i64>,
    project_id: Option<&str>,
) -> Result<Vec<PersonaEvent>, AppError> {
    timed_query!("persona_events", "persona_events::get_pending", {
        let limit = limit.unwrap_or(100);
        let conn = pool.get()?;

        if let Some(pid) = project_id {
            let mut stmt = conn.prepare_cached(
                "SELECT * FROM persona_events
                 WHERE status = 'pending' AND project_id = ?1
                 ORDER BY created_at ASC, id ASC
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![pid, limit], row_to_event)?;
            Ok(collect_rows(rows, "get_pending"))
        } else {
            let mut stmt = conn.prepare_cached(
                "SELECT * FROM persona_events
                 WHERE status = 'pending'
                 ORDER BY created_at ASC, id ASC
                 LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![limit], row_to_event)?;
            Ok(collect_rows(rows, "get_pending"))
        }
    })
}

/// Atomically claim pending events by setting their status to 'processing'
/// in a single UPDATE…RETURNING statement. This prevents duplicate processing
/// when tick intervals overlap (the next tick cannot see rows that have already
/// been claimed by a previous tick).
pub fn claim_pending(pool: &DbPool, limit: i64) -> Result<Vec<PersonaEvent>, AppError> {
    timed_query!("persona_events", "persona_events::claim_pending", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "UPDATE persona_events
             SET status = 'processing'
             WHERE id IN (
                 SELECT id FROM persona_events
                 WHERE status = 'pending'
                 ORDER BY created_at ASC, id ASC
                 LIMIT ?1
             )
             RETURNING *",
        )?;
        let rows = stmt.query_map(params![limit], row_to_event)?;
        Ok(collect_rows(rows, "claim_pending"))
    })
}

/// Like [`claim_pending`], but claims only events the DAEMON owns: events
/// whose target persona is headless, or events with no target persona (the
/// daemon marks those Delivered immediately). Filtering in SQL prevents the
/// former claim-then-release ping-pong — non-headless events kept their
/// created_at when released back to pending, so the same 5 rows were
/// re-claimed every 5s tick (~11 wasted statements + WAL churn per tick) —
/// and the starvation where a full window of non-headless events blocked
/// headless ones indefinitely while the windowed app was closed.
pub fn claim_pending_headless(pool: &DbPool, limit: i64) -> Result<Vec<PersonaEvent>, AppError> {
    timed_query!(
        "persona_events",
        "persona_events::claim_pending_headless",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
                "UPDATE persona_events
             SET status = 'processing'
             WHERE id IN (
                 SELECT e.id FROM persona_events e
                 LEFT JOIN personas p ON p.id = e.target_persona_id
                 WHERE e.status = 'pending'
                   AND (e.target_persona_id IS NULL OR p.headless = 1)
                 ORDER BY e.created_at ASC, e.id ASC
                 LIMIT ?1
             )
             RETURNING *",
            )?;
            let rows = stmt.query_map(params![limit], row_to_event)?;
            Ok(collect_rows(rows, "claim_pending_headless"))
        }
    )
}

pub fn update_status(
    pool: &DbPool,
    id: &str,
    status: PersonaEventStatus,
    error_message: Option<String>,
) -> Result<(), AppError> {
    timed_query!("persona_events", "persona_events::update_status", {
        let conn = pool.get()?;

        // Validate transition: read current status and check legality.
        let mut select_stmt =
            conn.prepare_cached("SELECT status FROM persona_events WHERE id = ?1")?;
        let current_str: String = select_stmt
            .query_row(params![id], |row| row.get(0))
            .map_err(|_| AppError::NotFound(format!("PersonaEvent {id}")))?;
        let current = PersonaEventStatus::from_db(&current_str);

        if !current.can_transition_to(&status) {
            return Err(AppError::Validation(format!(
                "Invalid event status transition: {} -> {}",
                current, status
            )));
        }

        let status_str = status.as_str();
        let processed_at: Option<String> = if status != PersonaEventStatus::Pending {
            Some(chrono::Utc::now().to_rfc3339())
        } else {
            None
        };

        // Use WHERE status = current to close the TOCTOU gap: if another thread
        // changed the status between our SELECT and this UPDATE, rows_affected
        // will be 0 and we reject the stale transition.
        let mut update_stmt = conn.prepare_cached(
            "UPDATE persona_events
             SET status = ?1, error_message = ?2, processed_at = ?3
             WHERE id = ?4 AND status = ?5",
        )?;
        let rows = update_stmt.execute(params![
            status_str,
            error_message,
            processed_at,
            id,
            current_str
        ])?;

        if rows == 0 {
            return Err(AppError::Validation(format!(
                "Event {id} status changed concurrently (expected '{current_str}')"
            )));
        }

        Ok(())
    })
}

pub fn get_recent(
    pool: &DbPool,
    limit: Option<i64>,
    project_id: Option<&str>,
) -> Result<Vec<PersonaEvent>, AppError> {
    timed_query!("persona_events", "persona_events::get_recent", {
        let limit = limit.unwrap_or(100);
        let conn = pool.get()?;

        if let Some(pid) = project_id {
            let mut stmt = conn.prepare_cached(
                "SELECT * FROM persona_events
                 WHERE project_id = ?1
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![pid, limit], row_to_event)?;
            Ok(collect_rows(rows, "get_recent"))
        } else {
            let mut stmt = conn.prepare_cached(
                "SELECT * FROM persona_events
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![limit], row_to_event)?;
            Ok(collect_rows(rows, "get_recent"))
        }
    })
}

/// Page through events in a `[since, until]` time window.
///
/// Pagination contract (see also `search`): the ORDER BY uses a composite
/// `(created_at, id)` key as a deterministic tiebreaker, so two events
/// inserted in the same millisecond — easy under burst load — are no longer
/// ordered nondeterministically. Callers using `since` / `until` as cursors
/// must pass back the values verbatim from a row's `created_at` and treat
/// `(created_at, id)` as the opaque cursor; a backwards clock jump can
/// produce duplicate timestamps but the `id` tiebreaker keeps the order
/// stable.
pub fn get_in_range(
    pool: &DbPool,
    since: &str,
    until: &str,
    limit: Option<i64>,
) -> Result<(Vec<PersonaEvent>, bool), AppError> {
    timed_query!("persona_events", "persona_events::get_in_range", {
        let limit = limit.unwrap_or(1000).max(1);
        let fetch = limit + 1; // fetch one extra to detect has_more
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "SELECT * FROM persona_events
             WHERE created_at >= ?1 AND created_at <= ?2
             ORDER BY created_at ASC, id ASC
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![since, until, fetch], row_to_event)?;
        let mut events = collect_rows(rows, "get_in_range");
        let has_more = events.len() as i64 > limit;
        if has_more {
            events.truncate(limit as usize);
        }
        Ok((events, has_more))
    })
}

/// Fetch events after the `(after_created_at, after_id)` composite cursor
/// (ascending by `created_at`, then `id`), bounded by `limit`. When
/// `after_created_at` is `None`, returns the oldest events first up to the
/// limit — this only happens once per install, at which point the outbound
/// webhook notifier seeds its watermark.
///
/// The composite cursor is required for correctness: many events can share a
/// single `created_at` (same millisecond). A bare `created_at > cursor` drops
/// every boundary event that shares the watermark's timestamp but wasn't in the
/// last processed batch. Passing the last-seen `id` as a tiebreaker
/// (`created_at = cursor AND id > cursor_id`) admits those siblings exactly
/// once. `after_id = None` falls back to the legacy timestamp-only predicate so
/// a pre-existing bare-timestamp watermark still works until the next tick
/// rewrites it as a composite.
///
/// Used by `engine::webhook_notifier::tick` to drain unseen events into
/// outbound subscriptions.
pub fn get_recent_after(
    pool: &DbPool,
    after_created_at: Option<&str>,
    after_id: Option<&str>,
    limit: i64,
) -> Result<Vec<PersonaEvent>, AppError> {
    timed_query!("persona_events", "persona_events::get_recent_after", {
        let conn = pool.get()?;
        match (after_created_at, after_id) {
            (Some(cursor_at), Some(cursor_id)) => {
                let mut stmt = conn.prepare_cached(
                    "SELECT * FROM persona_events
                     WHERE created_at > ?1 OR (created_at = ?1 AND id > ?2)
                     ORDER BY created_at ASC, id ASC
                     LIMIT ?3",
                )?;
                let rows = stmt.query_map(params![cursor_at, cursor_id, limit], row_to_event)?;
                Ok(collect_rows(rows, "get_recent_after"))
            }
            (Some(cursor_at), None) => {
                // Legacy bare-timestamp watermark — no id tiebreaker available yet.
                let mut stmt = conn.prepare_cached(
                    "SELECT * FROM persona_events
                     WHERE created_at > ?1
                     ORDER BY created_at ASC, id ASC
                     LIMIT ?2",
                )?;
                let rows = stmt.query_map(params![cursor_at, limit], row_to_event)?;
                Ok(collect_rows(rows, "get_recent_after"))
            }
            _ => {
                let mut stmt = conn.prepare_cached(
                    "SELECT * FROM persona_events
                     ORDER BY created_at ASC, id ASC
                     LIMIT ?1",
                )?;
                let rows = stmt.query_map(params![limit], row_to_event)?;
                Ok(collect_rows(rows, "get_recent_after"))
            }
        }
    })
}

/// Count events by source persona ID (used for post-mortem dedup check).
pub fn count_by_source(pool: &DbPool, persona_id: &str) -> Result<i64, AppError> {
    timed_query!("persona_events", "persona_events::count_by_source", {
        let conn = pool.get()?;
        let mut stmt =
            conn.prepare_cached("SELECT COUNT(*) FROM persona_events WHERE source_id = ?1")?;
        let count: i64 = stmt.query_row(params![persona_id], |row| row.get(0))?;
        Ok(count)
    })
}

/// Whether any event already references this polymorphic `source_id`. Used by
/// the shared-event relay to dedup re-delivered firings: the remote feed cursor
/// is a bare `fired_at` timestamp with no id tiebreaker, so firings sharing a
/// boundary timestamp can be re-sent and would otherwise be re-published.
pub fn exists_by_source_id(pool: &DbPool, source_id: &str) -> Result<bool, AppError> {
    timed_query!("persona_events", "persona_events::exists_by_source_id", {
        let conn = pool.get()?;
        let mut stmt = conn
            .prepare_cached("SELECT EXISTS(SELECT 1 FROM persona_events WHERE source_id = ?1)")?;
        let exists: i64 = stmt.query_row(params![source_id], |row| row.get(0))?;
        Ok(exists != 0)
    })
}

/// Collect the `fired_at` slot timestamps of every backfill catch-up event
/// already published for a trigger (`source_id`). Used by the user-initiated
/// backfill command to skip slots that were already enqueued — by a prior click
/// or by the auto-backfill path — preventing duplicate / cost-runaway runs.
///
/// Payloads are encrypted at rest, so this can't be a `json_extract` WHERE
/// clause; instead we decrypt each candidate row and inspect its JSON for the
/// `backfill_slot: true` marker + `fired_at`. The scan is bounded by the 30-day
/// event-cleanup window so it stays small. NOTE: triggers that carry an explicit
/// configured `payload` don't get the synthesized marker (true for both the auto
/// and user paths), so those degrade to no-dedup — matching pre-existing
/// behaviour; closing that gap would require a dedicated slot-time column.
pub fn backfill_slot_times_for_source(
    pool: &DbPool,
    source_id: &str,
) -> Result<std::collections::HashSet<String>, AppError> {
    timed_query!(
        "persona_events",
        "persona_events::backfill_slot_times_for_source",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
                "SELECT payload, payload_iv FROM persona_events
                 WHERE source_id = ?1 AND source_type = 'trigger'",
            )?;
            let rows = stmt.query_map(params![source_id], |row| {
                let raw_payload: Option<String> = row.get(0)?;
                let payload_iv: Option<String> = row.get(1).unwrap_or(None);
                Ok((raw_payload, payload_iv))
            })?;

            let mut slots: std::collections::HashSet<String> = std::collections::HashSet::new();
            for row in rows.flatten() {
                let (raw_payload, payload_iv) = row;
                let plaintext = match (raw_payload, payload_iv) {
                    (Some(ct), Some(ref iv)) if !iv.is_empty() => {
                        match crypto::decrypt_from_db(&ct, iv) {
                            Ok(pt) => pt,
                            Err(_) => continue,
                        }
                    }
                    (Some(pt), _) => pt, // plaintext fallback (encryption disabled/failed)
                    (None, _) => continue,
                };
                if let Ok(serde_json::Value::Object(map)) =
                    serde_json::from_str::<serde_json::Value>(&plaintext)
                {
                    let is_backfill = map
                        .get("backfill_slot")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    if is_backfill {
                        if let Some(fired_at) = map.get("fired_at").and_then(|v| v.as_str()) {
                            slots.insert(fired_at.to_string());
                        }
                    }
                }
            }
            Ok(slots)
        }
    )
}

/// Count events of one type emitted by one persona since a timestamp. Used by
/// the team-assignment orchestrator to detect that a step's execution emitted
/// a verdict event (e.g. `qa.pr.changes_requested`) during its run window —
/// `source_id` stores the EMITTING persona's id (see dispatch.rs).
pub fn count_by_type_and_source_since(
    pool: &DbPool,
    event_type: &str,
    source_persona_id: &str,
    since: &str,
) -> Result<i64, AppError> {
    timed_query!(
        "persona_events",
        "persona_events::count_by_type_and_source_since",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
                "SELECT COUNT(*) FROM persona_events
                 WHERE event_type = ?1 AND source_id = ?2 AND created_at >= ?3",
            )?;
            let count: i64 = stmt
                .query_row(params![event_type, source_persona_id, since], |row| {
                    row.get(0)
                })?;
            Ok(count)
        }
    )
}

pub fn cleanup(pool: &DbPool, older_than_days: Option<i64>) -> Result<i64, AppError> {
    timed_query!("persona_events", "persona_events::cleanup", {
        let days = older_than_days.unwrap_or(30);
        let conn = pool.get()?;

        // Use chrono for the cutoff date to match the timestamp format used in publish().
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339();
        let mut stmt = conn.prepare_cached(
            "DELETE FROM persona_events
             WHERE status IN ('completed', 'skipped', 'failed', 'discarded')
               AND created_at < ?1",
        )?;
        let rows = stmt.execute(params![cutoff])?;

        Ok(rows as i64)
    })
}

/// Enforce a hard count ceiling on terminal events, independent of age.
///
/// Age-only cleanup (`cleanup`) lets the table balloon inside a single
/// retention window when a source is chatty. This trims the oldest terminal
/// rows so at most `max_keep` remain. Only terminal *processed* rows are
/// eligible — `dead_letter` (DLQ), `pending`, and `processing` (in-flight) rows
/// are EXEMPT and never counted toward or deleted by the cap, mirroring the
/// status set used by `cleanup`. Returns the number of rows deleted.
pub fn enforce_count_cap(pool: &DbPool, max_keep: i64) -> Result<i64, AppError> {
    timed_query!("persona_events", "persona_events::enforce_count_cap", {
        let max_keep = max_keep.max(0);
        let conn = pool.get()?;
        // Delete terminal rows that are NOT among the newest `max_keep` terminal
        // rows. The subquery is scoped to the same terminal status set so the
        // ordering/limit is computed over eligible rows only — exempt rows never
        // enter the window and so can neither be kept-slots nor deletion targets.
        let mut stmt = conn.prepare_cached(
            "DELETE FROM persona_events
             WHERE status IN ('completed', 'skipped', 'failed', 'discarded')
               AND id NOT IN (
                 SELECT id FROM persona_events
                 WHERE status IN ('completed', 'skipped', 'failed', 'discarded')
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?1
               )",
        )?;
        let rows = stmt.execute(params![max_keep])?;
        Ok(rows as i64)
    })
}

/// Per-event-type skipped-rate aggregation. A `skipped` event is an honest
/// "no subscriber matched" marker (`background.rs`) — a persistently high
/// skipped rate for a type signals a dead / misrouted trigger contract that
/// nothing is listening to. Scoped to the last `since_days` days so the rate
/// reflects current wiring, not ancient history. Only types with at least one
/// skip are returned, ordered by skip count descending.
pub fn skipped_rate_by_type(
    pool: &DbPool,
    since_days: i64,
) -> Result<Vec<SkippedRateRow>, AppError> {
    timed_query!("persona_events", "persona_events::skipped_rate_by_type", {
        let since = (chrono::Utc::now() - chrono::Duration::days(since_days.max(0))).to_rfc3339();
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "SELECT event_type,
                    COUNT(*) AS total,
                    SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped
             FROM persona_events
             WHERE created_at >= ?1
             GROUP BY event_type
             HAVING skipped > 0
             ORDER BY skipped DESC, total DESC",
        )?;
        let rows = stmt.query_map(params![since], |row| {
            let event_type: String = row.get("event_type")?;
            let total: i64 = row.get("total")?;
            let skipped: i64 = row.get("skipped")?;
            Ok(SkippedRateRow {
                event_type,
                total,
                skipped,
            })
        })?;
        Ok(collect_rows(rows, "skipped_rate_by_type"))
    })
}

/// Overall skipped-vs-total counts across all event types in the window, used
/// for the events-page header stat. `since_days` matches `skipped_rate_by_type`.
pub fn skipped_totals(pool: &DbPool, since_days: i64) -> Result<(i64, i64), AppError> {
    timed_query!("persona_events", "persona_events::skipped_totals", {
        let since = (chrono::Utc::now() - chrono::Duration::days(since_days.max(0))).to_rfc3339();
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped
             FROM persona_events
             WHERE created_at >= ?1",
        )?;
        let (total, skipped) = stmt.query_row(params![since], |row| {
            let total: i64 = row.get("total")?;
            let skipped: Option<i64> = row.get("skipped")?;
            Ok((total, skipped.unwrap_or(0)))
        })?;
        Ok((total, skipped))
    })
}

/// One row of the per-type skipped-rate aggregation.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SkippedRateRow {
    pub event_type: String,
    /// Total events of this type in the window.
    pub total: i64,
    /// How many of them were skipped (no subscriber matched).
    pub skipped: i64,
}

/// Delete every event whose `source_id` matches a specific id. Used when a
/// trigger is deleted to purge its event history from persona_events. Returns
/// the number of deleted rows.
pub fn delete_events_by_source_id(pool: &DbPool, source_id: &str) -> Result<u32, AppError> {
    timed_query!(
        "persona_events",
        "persona_events::delete_events_by_source_id",
        {
            let conn = pool.get()?;
            let mut stmt =
                conn.prepare_cached("DELETE FROM persona_events WHERE source_id = ?1")?;
            let rows = stmt.execute(params![source_id])?;
            Ok(rows as u32)
        }
    )
}

/// Delete events emitted by triggers that no longer exist (or whose owning
/// persona no longer exists). Catches accumulated noise from orphaned
/// triggers that the cleanup sweep in background.rs then prunes. Returns
/// the count deleted. Runs in one DELETE with a NOT EXISTS anti-join.
pub fn delete_orphaned_trigger_events(pool: &DbPool) -> Result<u32, AppError> {
    timed_query!(
        "persona_events",
        "persona_events::delete_orphaned_trigger_events",
        {
            let conn = pool.get()?;
            // Events where source_type == 'trigger' but source_id no longer exists
            // in persona_triggers. Left-join would be cleaner but sqlite's DELETE
            // doesn't allow JOIN syntax — use NOT EXISTS instead.
            let mut stmt = conn.prepare_cached(
                "DELETE FROM persona_events
             WHERE source_type = 'trigger'
               AND source_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM persona_triggers t WHERE t.id = persona_events.source_id
               )",
            )?;
            let rows = stmt.execute([])?;
            Ok(rows as u32)
        }
    )
}

// ============================================================================
// Dead Letter Queue (DLQ)
// ============================================================================

/// Default max retries before an event is moved to the dead letter queue.
pub const DEFAULT_MAX_RETRIES: i32 = 3;

/// Get all events in dead_letter status, ordered by most recent first.
pub fn get_dead_letter_events(
    pool: &DbPool,
    limit: Option<i64>,
) -> Result<Vec<PersonaEvent>, AppError> {
    timed_query!(
        "persona_events",
        "persona_events::get_dead_letter_events",
        {
            let limit = limit.unwrap_or(100);
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
                "SELECT * FROM persona_events
             WHERE status = 'dead_letter'
             ORDER BY processed_at DESC, created_at DESC, id DESC
             LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![limit], row_to_event)?;
            Ok(collect_rows(rows, "get_dead_letter_events"))
        }
    )
}

/// Count of events currently in dead_letter status.
pub fn count_dead_letter(pool: &DbPool) -> Result<i64, AppError> {
    timed_query!("persona_events", "persona_events::count_dead_letter", {
        let conn = pool.get()?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM persona_events WHERE status = 'dead_letter'",
            [],
            |row| row.get(0),
        )?;
        Ok(count)
    })
}

/// Publish an event directly into `dead_letter` status.
///
/// Used when an event *would have* been published but a precondition failed
/// (e.g. `mark_triggered` + disable both failed in chain cascade evaluation).
/// The event is recorded for auditability but will never be processed unless
/// manually retried from the DLQ.
pub fn publish_dead_letter(
    pool: &DbPool,
    input: CreatePersonaEventInput,
    error_message: String,
) -> Result<PersonaEvent, AppError> {
    timed_query!("persona_events", "persona_events::publish_dead_letter", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let project_id = input.project_id.unwrap_or_else(|| "default".into());

        let (stored_payload, payload_iv) = encrypt_optional_payload(&input.payload);

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO persona_events
             (id, project_id, event_type, source_type, source_id, target_persona_id,
              payload, payload_iv, use_case_id, status, error_message, processed_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'dead_letter', ?10, ?11, ?11)",
            params![
                id,
                project_id,
                input.event_type,
                input.source_type,
                input.source_id,
                input.target_persona_id,
                stored_payload,
                payload_iv,
                input.use_case_id,
                error_message,
                now,
            ],
        )?;

        get_by_id(pool, &id)
    })
}

/// Move a failed event to the dead letter queue.
///
/// Only events with status `Failed` can transition to `DeadLetter`,
/// matching the lifecycle rules in `PersonaEventStatus::can_transition_to`.
pub fn move_to_dead_letter(
    pool: &DbPool,
    id: &str,
    error_message: Option<String>,
) -> Result<(), AppError> {
    timed_query!("persona_events", "persona_events::move_to_dead_letter", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let rows = conn.execute(
            "UPDATE persona_events
             SET status = 'dead_letter', error_message = ?1, processed_at = ?2
             WHERE id = ?3 AND status = 'failed'",
            params![error_message, now, id],
        )?;
        if rows == 0 {
            // Distinguish "not found" from "wrong status" for a clear error message.
            let current_str: String = conn
                .query_row(
                    "SELECT status FROM persona_events WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .map_err(|_| AppError::NotFound(format!("PersonaEvent {id}")))?;
            return Err(AppError::Validation(format!(
                "Invalid event status transition: {} -> dead_letter",
                current_str
            )));
        }
        Ok(())
    })
}

/// Dead-letter an event the bus already CLAIMED (status `processing`).
///
/// [`move_to_dead_letter`] deliberately requires `status = 'failed'`, mirroring
/// `PersonaEventStatus::can_transition_to`, which has no `Processing ->
/// DeadLetter` edge. That edge is genuinely needed by the dispatch path: a
/// handoff explicitly targeted at a DISABLED persona is a stalled cascade that
/// must land in the DLQ, but the event is `processing` at that point, so the
/// `update_status` call the bus used silently failed validation and left the
/// row stranded in `processing` forever (never delivered, never retried, exempt
/// from retention). This is the narrow, guarded write for that case.
///
/// `reason` is a machine token (see `engine/background.rs` `EventGateReason`),
/// never user-facing prose. Returns `false` when the row was not in
/// `processing` (already terminal — a concurrent writer won).
pub fn dead_letter_from_processing(
    pool: &DbPool,
    id: &str,
    reason: Option<String>,
) -> Result<bool, AppError> {
    timed_query!(
        "persona_events",
        "persona_events::dead_letter_from_processing",
        {
            let conn = pool.get()?;
            let now = chrono::Utc::now().to_rfc3339();
            let rows = conn.execute(
                "UPDATE persona_events
                 SET status = 'dead_letter', error_message = ?1, processed_at = ?2
                 WHERE id = ?3 AND status = 'processing'",
                params![reason, now, id],
            )?;
            Ok(rows > 0)
        }
    )
}

// ============================================================================
// Stuck-`processing` reaper
// ============================================================================

/// What the reaper did to one stranded row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StuckReapOutcome {
    /// Returned to `pending` so a later tick redelivers it.
    Redelivered,
    /// Retries exhausted — parked in the DLQ instead of looping forever.
    DeadLettered,
}

/// Ids of every event currently claimed (`status = 'processing'`), oldest
/// first.
///
/// [`claim_pending`] atomically flips `pending -> processing` so a tick cannot
/// double-claim, but nothing ever returns a claimed row that the tick failed to
/// finish. Retention exempts `processing` as in-flight and the terminal status
/// writes in `engine/background.rs` are best-effort (`let _ =`), so a crash
/// between claim and terminal write strands the event forever: never
/// delivered, never retried, never pruned, absent from both the pending and
/// dead-letter counts the UI shows.
///
/// The caller decides which of these are genuinely stranded — see
/// `background.rs` `partition_stuck_candidates`, which requires a row to be
/// observed here on two consecutive passes. A single snapshot cannot tell a
/// stranded row from one a healthy tick is processing right now, and the row
/// carries no claim timestamp to lean on (`claim_pending` sets only `status`).
pub fn list_processing_ids(pool: &DbPool, limit: i64) -> Result<Vec<String>, AppError> {
    timed_query!("persona_events", "persona_events::list_processing_ids", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "SELECT id FROM persona_events
             WHERE status = 'processing'
             ORDER BY created_at ASC, id ASC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |row| row.get::<_, String>(0))?;
        Ok(rows.flatten().collect())
    })
}

/// Return one stranded `processing` row to `pending`, or dead-letter it when
/// its retries are exhausted.
///
/// The whole decision is ONE atomic UPDATE guarded on `status = 'processing'`,
/// so a terminal write from the tick that actually owns the row always wins the
/// race and the reaper reports `None`. `retry_count` is incremented on every
/// reap, which is what stops a permanently-poisoned event from cycling
/// pending -> processing -> pending forever.
///
/// `reclaimed_reason` / `exhausted_reason` are machine tokens (see
/// `engine/background.rs` `EventGateReason`), never prose.
pub fn reap_stuck_processing(
    pool: &DbPool,
    id: &str,
    max_retries: i32,
    reclaimed_reason: &str,
    exhausted_reason: &str,
) -> Result<Option<StuckReapOutcome>, AppError> {
    timed_query!("persona_events", "persona_events::reap_stuck_processing", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let mut stmt = conn.prepare_cached(
            "UPDATE persona_events
             SET retry_count = retry_count + 1,
                 status = CASE WHEN retry_count + 1 >= ?1 THEN 'dead_letter' ELSE 'pending' END,
                 error_message = CASE WHEN retry_count + 1 >= ?1 THEN ?2 ELSE ?3 END,
                 processed_at = CASE WHEN retry_count + 1 >= ?1 THEN ?4 ELSE NULL END
             WHERE id = ?5 AND status = 'processing'
             RETURNING status",
        )?;
        let status: Option<String> = stmt
            .query_row(
                params![max_retries, exhausted_reason, reclaimed_reason, now, id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;

        Ok(status.map(|s| {
            if s == "dead_letter" {
                StuckReapOutcome::DeadLettered
            } else {
                StuckReapOutcome::Redelivered
            }
        }))
    })
}

/// Increment retry_count and reset status to 'pending' for a dead-lettered event.
/// Returns `RetryExhausted` if retry_count has already reached `MAX_MANUAL_RETRIES`.
///
/// Manual retries from the DLQ are capped separately from the automatic retry
/// limit (`DEFAULT_MAX_RETRIES`) because the user may want a few extra manual
/// attempts — but we still need a ceiling to prevent infinite loops.
pub const MAX_MANUAL_RETRIES: i32 = 5;

/// Shared by `retry_dead_letter` (single) and `bulk_retry_dead_letter` (looped
/// per id inside one transaction) — the retry-cap CASE is the TOCTOU guard and
/// must never drift between the two paths. `?1` = id, `?2` = MAX_MANUAL_RETRIES.
const RETRY_DLQ_SQL: &str = "UPDATE persona_events
             SET status = 'pending',
                 retry_count = retry_count + 1,
                 error_message = CASE
                     WHEN error_message IS NOT NULL
                     THEN '[Retry #' || (retry_count + 1) || ' — previous error: ' || error_message || ']'
                     ELSE NULL
                 END,
                 processed_at = NULL
             WHERE id = ?1
               AND status = 'dead_letter'
               AND retry_count < ?2";

/// Shared by `discard_dead_letter` (single) and `bulk_discard_dead_letter`
/// (looped per id inside one transaction). `?1` = processed_at, `?2` = id.
const DISCARD_DLQ_SQL: &str = "UPDATE persona_events
             SET status = 'discarded', processed_at = ?1
             WHERE id = ?2 AND status = 'dead_letter'";

pub fn retry_dead_letter(pool: &DbPool, id: &str) -> Result<PersonaEvent, AppError> {
    timed_query!("persona_events", "persona_events::retry_dead_letter", {
        let conn = pool.get()?;

        // Single atomic UPDATE: flip status to 'pending', bump retry_count, and
        // preserve the prior error message — all guarded by the dead_letter +
        // retry-cap predicate. This closes the TOCTOU race where two concurrent
        // retry callers could both pass a SELECT-side cap check and then both
        // increment retry_count past MAX_MANUAL_RETRIES.
        let rows = conn.execute(RETRY_DLQ_SQL, params![id, MAX_MANUAL_RETRIES])?;

        if rows == 0 {
            // Distinguish the three failure modes by reading current state.
            let current: Option<(String, i32)> = conn
                .query_row(
                    "SELECT status, retry_count FROM persona_events WHERE id = ?1",
                    params![id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;

            return match current {
                None => Err(AppError::NotFound(format!(
                    "Dead-lettered PersonaEvent {id}"
                ))),
                Some((status, _)) if status != "dead_letter" => Err(AppError::NotFound(format!(
                    "Dead-lettered PersonaEvent {id}"
                ))),
                Some((_, retry_count)) if retry_count >= MAX_MANUAL_RETRIES => {
                    Err(AppError::RetryExhausted(format!(
                        "Event {id} has exhausted all {MAX_MANUAL_RETRIES} retry attempts"
                    )))
                }
                // Concurrent caller raced ahead and reset the row before we
                // could observe it; surface as not-in-DLQ so the UI re-fetches.
                Some(_) => Err(AppError::NotFound(format!(
                    "Dead-lettered PersonaEvent {id}"
                ))),
            };
        }

        get_by_id(pool, id)
    })
}

/// Discard a dead-lettered event by marking it as 'discarded'.
pub fn discard_dead_letter(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("persona_events", "persona_events::discard_dead_letter", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let rows = conn.execute(DISCARD_DLQ_SQL, params![now, id])?;
        if rows == 0 {
            return Err(AppError::NotFound(format!(
                "Dead-lettered PersonaEvent {id}"
            )));
        }
        Ok(())
    })
}

/// Per-id outcome returned by the bulk DLQ commands.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BulkDeadLetterOutcome {
    /// Event ids that were successfully retried / discarded.
    pub succeeded: Vec<String>,
    /// Event ids that could not be retried / discarded, paired with a short
    /// `reason` token (`not_found`, `retry_exhausted`, `wrong_status`).
    pub failed: Vec<BulkDeadLetterFailure>,
}

#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BulkDeadLetterFailure {
    pub id: String,
    /// Short machine-readable token (`not_found`, `retry_exhausted`,
    /// `wrong_status`). The frontend maps this through `tokenLabel`.
    pub reason: String,
}

/// Retry many dead-lettered events in a single transaction. Each id is
/// evaluated independently — exhausted retries or missing ids land in
/// `failed` rather than aborting the batch, so an operator clicking
/// "Retry selected" never gets stuck on one stale row. The whole
/// commit happens at once so observers never see a half-retried batch.
pub fn bulk_retry_dead_letter(
    pool: &DbPool,
    ids: &[String],
) -> Result<BulkDeadLetterOutcome, AppError> {
    timed_query!(
        "persona_events",
        "persona_events::bulk_retry_dead_letter",
        {
            if ids.is_empty() {
                return Ok(BulkDeadLetterOutcome {
                    succeeded: Vec::new(),
                    failed: Vec::new(),
                });
            }

            let mut conn = pool.get()?;
            let tx = conn.transaction().map_err(AppError::Database)?;

            let mut succeeded: Vec<String> = Vec::new();
            let mut failed: Vec<BulkDeadLetterFailure> = Vec::new();

            for id in ids {
                let rows = tx.execute(RETRY_DLQ_SQL, params![id, MAX_MANUAL_RETRIES])?;

                if rows == 1 {
                    succeeded.push(id.clone());
                } else {
                    let current: Option<(String, i32)> = tx
                        .query_row(
                            "SELECT status, retry_count FROM persona_events WHERE id = ?1",
                            params![id],
                            |row| Ok((row.get(0)?, row.get(1)?)),
                        )
                        .optional()?;

                    let reason = match current {
                        None => "not_found",
                        Some((status, _)) if status != "dead_letter" => "wrong_status",
                        Some((_, rc)) if rc >= MAX_MANUAL_RETRIES => "retry_exhausted",
                        Some(_) => "wrong_status",
                    };
                    failed.push(BulkDeadLetterFailure {
                        id: id.clone(),
                        reason: reason.into(),
                    });
                }
            }

            tx.commit().map_err(AppError::Database)?;

            Ok(BulkDeadLetterOutcome { succeeded, failed })
        }
    )
}

/// Discard many dead-lettered events in a single transaction. Same
/// per-id partial-failure shape as `bulk_retry_dead_letter`.
pub fn bulk_discard_dead_letter(
    pool: &DbPool,
    ids: &[String],
) -> Result<BulkDeadLetterOutcome, AppError> {
    timed_query!(
        "persona_events",
        "persona_events::bulk_discard_dead_letter",
        {
            if ids.is_empty() {
                return Ok(BulkDeadLetterOutcome {
                    succeeded: Vec::new(),
                    failed: Vec::new(),
                });
            }

            let mut conn = pool.get()?;
            let tx = conn.transaction().map_err(AppError::Database)?;

            let now = chrono::Utc::now().to_rfc3339();
            let mut succeeded: Vec<String> = Vec::new();
            let mut failed: Vec<BulkDeadLetterFailure> = Vec::new();

            for id in ids {
                let rows = tx.execute(DISCARD_DLQ_SQL, params![now, id])?;

                if rows == 1 {
                    succeeded.push(id.clone());
                } else {
                    let status: Option<String> = tx
                        .query_row(
                            "SELECT status FROM persona_events WHERE id = ?1",
                            params![id],
                            |row| row.get(0),
                        )
                        .optional()?;
                    let reason = match status {
                        None => "not_found",
                        Some(_) => "wrong_status",
                    };
                    failed.push(BulkDeadLetterFailure {
                        id: id.clone(),
                        reason: reason.into(),
                    });
                }
            }

            tx.commit().map_err(AppError::Database)?;

            Ok(BulkDeadLetterOutcome { succeeded, failed })
        }
    )
}

/// Increment retry_count for a failed event. If retry_count reaches max_retries,
/// move it to dead_letter status. Returns true if moved to DLQ.
pub fn increment_retry_or_dead_letter(
    pool: &DbPool,
    id: &str,
    error_message: Option<String>,
    max_retries: i32,
) -> Result<bool, AppError> {
    timed_query!(
        "persona_events",
        "persona_events::increment_retry_or_dead_letter",
        {
            let conn = pool.get()?;

            // Atomically increment retry_count and conditionally set status in a
            // single UPDATE to avoid TOCTOU races with concurrent retry attempts.
            let now = chrono::Utc::now().to_rfc3339();

            // Use a single atomic UPDATE that increments retry_count and conditionally
            // sets status based on whether the new count exceeds max_retries.
            let rows = conn.execute(
                "UPDATE persona_events
             SET retry_count = retry_count + 1,
                 error_message = ?1,
                 processed_at = ?2,
                 status = CASE WHEN retry_count + 1 >= ?3 THEN 'dead_letter' ELSE 'failed' END
             WHERE id = ?4",
                params![error_message, now, max_retries, id],
            )?;

            if rows == 0 {
                return Err(AppError::NotFound(format!("PersonaEvent {id}")));
            }

            // Check if it was moved to dead letter
            let final_status: String = conn
                .query_row(
                    "SELECT status FROM persona_events WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .map_err(|_| AppError::NotFound(format!("PersonaEvent {id}")))?;

            Ok(final_status == "dead_letter")
        }
    )
}

/// Get events eligible for automatic retry (failed status, retry_count < max_retries).
pub fn get_retry_eligible(
    pool: &DbPool,
    max_retries: i32,
    limit: i64,
) -> Result<Vec<PersonaEvent>, AppError> {
    timed_query!("persona_events", "persona_events::get_retry_eligible", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "SELECT * FROM persona_events
             WHERE status = 'failed'
               AND retry_count < ?1
             ORDER BY created_at ASC, id ASC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![max_retries, limit], row_to_event)?;
        Ok(collect_rows(rows, "get_retry_eligible"))
    })
}

// ============================================================================
// Filtered search
// ============================================================================

pub fn search(
    pool: &DbPool,
    filter: &EventFilterInput,
) -> Result<(Vec<PersonaEvent>, bool), AppError> {
    timed_query!("persona_events", "persona_events::search", {
        let limit = filter.limit.unwrap_or(100).max(1);
        let fetch = limit + 1;
        let conn = pool.get()?;

        let mut qb = crate::query_builder::QueryBuilder::new();

        if let Some(ref v) = filter.event_type {
            qb.where_eq("event_type", v.clone());
        }
        if let Some(ref v) = filter.source_type {
            qb.where_eq("source_type", v.clone());
        }
        if let Some(ref v) = filter.status {
            qb.where_eq("status", v.clone());
        }
        if let Some(ref v) = filter.target_persona_id {
            qb.where_eq("target_persona_id", v.clone());
        }
        if let Some(ref v) = filter.since {
            qb.where_gte("created_at", v.clone());
        }
        if let Some(ref v) = filter.until {
            qb.where_lte("created_at", v.clone());
        }
        if let Some(ref v) = filter.search {
            if !v.is_empty() {
                let pattern = format!("%{v}%");
                // `payload` is stored encrypted at rest (see `encrypt_optional_payload`);
                // a LIKE against it matches ciphertext and silently returns zero hits.
                // Only search the plaintext columns here.
                qb.where_like_any(&["event_type", "source_type"], pattern);
            }
        }

        // Composite (created_at, id) ordering. The id tiebreaker is required
        // for stable cursor pagination — without it, two events inserted in
        // the same millisecond can be skipped or duplicated by since/until
        // scrolling. See `get_in_range` for the cursor contract.
        qb.order_by_multiple(&[("created_at", "DESC"), ("id", "DESC")]);
        qb.limit(fetch);

        let sql = qb.build_select("SELECT * FROM persona_events");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_event)?;
        let mut events = collect_rows(rows, "search_events");
        let has_more = events.len() as i64 > limit;
        if has_more {
            events.truncate(limit as usize);
        }
        Ok((events, has_more))
    })
}

// ============================================================================
// Event Subscriptions
// ============================================================================

pub fn get_subscription_by_id(
    pool: &DbPool,
    id: &str,
) -> Result<PersonaEventSubscription, AppError> {
    timed_query!(
        "event_subscriptions",
        "event_subscriptions::get_subscription_by_id",
        {
            let conn = pool.get()?;
            let mut stmt =
                conn.prepare_cached("SELECT * FROM persona_event_subscriptions WHERE id = ?1")?;
            stmt.query_row(params![id], row_to_subscription)
                .map_err(|e| match e {
                    rusqlite::Error::QueryReturnedNoRows => {
                        AppError::NotFound(format!("PersonaEventSubscription {id}"))
                    }
                    other => AppError::Database(other),
                })
        }
    )
}

pub fn get_subscriptions_by_persona(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<PersonaEventSubscription>, AppError> {
    timed_query!(
        "event_subscriptions",
        "event_subscriptions::get_subscriptions_by_persona",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
                "SELECT * FROM persona_event_subscriptions
             WHERE persona_id = ?1
             ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map(params![persona_id], row_to_subscription)?;
            Ok(collect_rows(rows, "get_subscriptions_by_persona"))
        }
    )
}

/// Bulk-fetch subscriptions for multiple persona IDs in a single query.
pub fn get_subscriptions_by_persona_ids(
    pool: &DbPool,
    persona_ids: &[String],
) -> Result<Vec<PersonaEventSubscription>, AppError> {
    if persona_ids.is_empty() {
        return Ok(Vec::new());
    }
    timed_query!(
        "event_subscriptions",
        "event_subscriptions::get_subscriptions_by_persona_ids",
        {
            let conn = pool.get()?;
            let mut qb = QueryBuilder::new();
            qb.where_in("persona_id", persona_ids.to_vec());
            qb.order_by("created_at", "DESC");
            let sql = qb.build_select("SELECT * FROM persona_event_subscriptions");
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_subscription)?;
            Ok(collect_rows(rows, "get_subscriptions_by_persona_ids"))
        }
    )
}

pub fn get_all_subscriptions(pool: &DbPool) -> Result<Vec<PersonaEventSubscription>, AppError> {
    timed_query!(
        "event_subscriptions",
        "event_subscriptions::get_all_subscriptions",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
                "SELECT * FROM persona_event_subscriptions ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map([], row_to_subscription)?;
            Ok(collect_rows(rows, "get_all_subscriptions"))
        }
    )
}

/// All enabled subscriptions, unfiltered by event type. The live event-bus
/// dispatch (`background.rs`) fetches the full set and lets `bus::match_event`
/// filter by CANONICAL event type — separator styles drift across the fleet's
/// emitted event names (`code_review.completed` vs `code-review.completed`), so
/// an exact `event_type IN (...)` pre-filter silently dropped variant-spelled
/// subscriptions before the canonical matcher ever saw them. The subscription
/// set is small (tens–low hundreds); if it grows large, replace this with a
/// canonical generated column + indexed lookup.
pub fn get_all_enabled_subscriptions(
    pool: &DbPool,
) -> Result<Vec<PersonaEventSubscription>, AppError> {
    timed_query!(
        "event_subscriptions",
        "event_subscriptions::get_all_enabled_subscriptions",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
                "SELECT * FROM persona_event_subscriptions WHERE enabled = 1
                 ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map([], row_to_subscription)?;
            Ok(collect_rows(rows, "get_all_enabled_subscriptions"))
        }
    )
}

pub fn get_subscriptions_by_event_type(
    pool: &DbPool,
    event_type: &str,
) -> Result<Vec<PersonaEventSubscription>, AppError> {
    timed_query!(
        "event_subscriptions",
        "event_subscriptions::get_subscriptions_by_event_type",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
                "SELECT * FROM persona_event_subscriptions
             WHERE event_type = ?1 AND enabled = 1
             ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map(params![event_type], row_to_subscription)?;
            Ok(collect_rows(rows, "get_subscriptions_by_event_type"))
        }
    )
}

/// Bulk-fetch enabled subscriptions for multiple event types in a single query.
pub fn get_subscriptions_by_event_types(
    pool: &DbPool,
    event_types: &[String],
) -> Result<Vec<PersonaEventSubscription>, AppError> {
    if event_types.is_empty() {
        return Ok(Vec::new());
    }
    timed_query!(
        "event_subscriptions",
        "event_subscriptions::get_subscriptions_by_event_types",
        {
            let conn = pool.get()?;
            let mut qb = QueryBuilder::new();
            qb.where_in("event_type", event_types.to_vec());
            qb.where_raw(|_| "enabled = 1".to_string(), vec![]);
            qb.order_by("created_at", "DESC");
            let sql = qb.build_select("SELECT * FROM persona_event_subscriptions");
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_subscription)?;
            Ok(collect_rows(rows, "get_subscriptions_by_event_types"))
        }
    )
}

pub fn create_subscription(
    pool: &DbPool,
    input: CreateEventSubscriptionInput,
) -> Result<PersonaEventSubscription, AppError> {
    timed_query!(
        "event_subscriptions",
        "event_subscriptions::create_subscription",
        {
            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            let enabled = input.enabled.unwrap_or(true) as i32;

            let conn = pool.get()?;
            // Use INSERT OR IGNORE to silently skip if an identical subscription exists
            // (unique index on persona_id, event_type, COALESCE(source_filter, '')).
            let rows = conn.execute(
            "INSERT OR IGNORE INTO persona_event_subscriptions
             (id, persona_id, event_type, source_filter, enabled, use_case_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                id,
                input.persona_id,
                input.event_type,
                input.source_filter,
                enabled,
                input.use_case_id,
                now,
            ],
        )?;

            if rows == 0 {
                // Duplicate exists -- return the existing subscription
                let existing = conn
                    .query_row(
                        "SELECT * FROM persona_event_subscriptions
                 WHERE persona_id = ?1 AND event_type = ?2
                   AND COALESCE(source_filter, '') = COALESCE(?3, '')",
                        params![input.persona_id, input.event_type, input.source_filter],
                        row_to_subscription,
                    )
                    .map_err(AppError::Database)?;
                return Ok(existing);
            }

            get_subscription_by_id(pool, &id)
        }
    )
}

/// Atomically create an event_listener trigger and a legacy subscription
/// inside a single transaction (dual-write).
pub fn create_subscription_with_trigger(
    pool: &DbPool,
    input: CreateEventSubscriptionInput,
    trigger_input: CreateTriggerInput,
) -> Result<PersonaEventSubscription, AppError> {
    timed_query!(
        "event_subscriptions",
        "event_subscriptions::create_subscription_with_trigger",
        {
            let mut conn = pool.get()?;
            let tx = conn.transaction().map_err(AppError::Database)?;

            // 1) Insert the event_listener trigger
            let trigger_id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            let trigger_enabled = trigger_input.enabled.unwrap_or(true);
            let trigger_status = if trigger_enabled {
                "active"
            } else {
                "disabled"
            };
            // Secrets must never be stored in plaintext -- propagate encryption
            // failures instead of silently falling back to the raw config
            // (matches the contract `triggers::encrypt_config` enforces on the
            // primary trigger path; see refactor-bughunt-2026-07-10 repos#2).
            let encrypted_config = trigger_input
                .config
                .as_deref()
                .map(encrypt_config)
                .transpose()?;
            tx.execute(
            "INSERT INTO persona_triggers
             (id, persona_id, trigger_type, config, enabled, status, use_case_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![
                trigger_id,
                trigger_input.persona_id,
                trigger_input.trigger_type,
                encrypted_config,
                trigger_enabled as i32,
                trigger_status,
                trigger_input.use_case_id,
                now,
            ],
        )?;

            // 2) Insert the legacy subscription
            let sub_id = uuid::Uuid::new_v4().to_string();
            let sub_enabled = input.enabled.unwrap_or(true) as i32;
            let sub_rows = tx.execute(
            "INSERT OR IGNORE INTO persona_event_subscriptions
             (id, persona_id, event_type, source_filter, enabled, use_case_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                sub_id,
                input.persona_id,
                input.event_type,
                input.source_filter,
                sub_enabled,
                input.use_case_id,
                now,
            ],
        )?;

            tx.commit().map_err(AppError::Database)?;

            // Return the subscription (existing or newly created)
            if sub_rows == 0 {
                // Duplicate existed -- find and return it
                let conn = pool.get()?;
                let existing = conn
                    .query_row(
                        "SELECT * FROM persona_event_subscriptions
                 WHERE persona_id = ?1 AND event_type = ?2
                   AND COALESCE(source_filter, '') = COALESCE(?3, '')",
                        params![input.persona_id, input.event_type, input.source_filter],
                        row_to_subscription,
                    )
                    .map_err(AppError::Database)?;
                Ok(existing)
            } else {
                get_subscription_by_id(pool, &sub_id)
            }
        }
    )
}

pub fn update_subscription(
    pool: &DbPool,
    id: &str,
    input: UpdateEventSubscriptionInput,
) -> Result<PersonaEventSubscription, AppError> {
    timed_query!(
        "event_subscriptions",
        "event_subscriptions::update_subscription",
        {
            // Fetch the existing subscription so we can locate the paired trigger
            let existing = get_subscription_by_id(pool, id)?;

            let now = chrono::Utc::now().to_rfc3339();
            let mut conn = pool.get()?;
            let tx = conn.transaction().map_err(AppError::Database)?;

            // 1) Update the subscription row
            let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
            let mut param_idx = 2u32;
            let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> =
                vec![Box::new(now.clone())];

            push_field_param!(
                input.event_type,
                "event_type",
                sets,
                param_idx,
                param_values,
                clone
            );
            push_field_param!(
                input.source_filter,
                "source_filter",
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

            let sql = format!(
                "UPDATE persona_event_subscriptions SET {} WHERE id = ?{}",
                sets.join(", "),
                param_idx
            );

            param_values.push(Box::new(id.to_string()));

            let params_ref: Vec<&dyn rusqlite::types::ToSql> =
                param_values.iter().map(|p| p.as_ref()).collect();
            tx.execute(&sql, params_ref.as_slice())?;

            // 2) Propagate changes to the paired event_listener trigger
            let new_event_type = input.event_type.as_deref().unwrap_or(&existing.event_type);
            let new_source_filter = input
                .source_filter
                .as_deref()
                .or(existing.source_filter.as_deref());

            let config = serde_json::json!({
                "listen_event_type": new_event_type,
                "source_filter": new_source_filter,
            });
            // Secrets must never be stored in plaintext -- propagate encryption
            // failures instead of silently falling back to the raw config
            // (see refactor-bughunt-2026-07-10 repos#2).
            let encrypted_config = {
                let raw = serde_json::to_string(&config).unwrap_or_default();
                encrypt_config(&raw)?
            };

            if let Some(enabled) = input.enabled {
                let status = if enabled { "active" } else { "disabled" };
                tx.execute(
                    "UPDATE persona_triggers
                 SET config = ?1, enabled = ?2, status = ?3, updated_at = ?4
                 WHERE persona_id = ?5
                   AND trigger_type = 'event_listener'
                   AND COALESCE(use_case_id, '') = COALESCE(?6, '')",
                    params![
                        encrypted_config,
                        enabled as i32,
                        status,
                        now,
                        existing.persona_id,
                        existing.use_case_id,
                    ],
                )?;
            } else if input.event_type.is_some() || input.source_filter.is_some() {
                tx.execute(
                    "UPDATE persona_triggers
                 SET config = ?1, updated_at = ?2
                 WHERE persona_id = ?3
                   AND trigger_type = 'event_listener'
                   AND COALESCE(use_case_id, '') = COALESCE(?4, '')",
                    params![
                        encrypted_config,
                        now,
                        existing.persona_id,
                        existing.use_case_id,
                    ],
                )?;
            }

            tx.commit().map_err(AppError::Database)?;

            get_subscription_by_id(pool, id)
        }
    )
}

pub fn delete_subscription(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!(
        "event_subscriptions",
        "event_subscriptions::delete_subscription",
        {
            let mut conn = pool.get()?;

            // Read the subscription first so we can find the paired trigger
            let sub = conn.query_row(
                "SELECT persona_id, event_type, source_filter, use_case_id
             FROM persona_event_subscriptions WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            );

            let sub = match sub {
                Ok(s) => s,
                Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(false),
                Err(e) => return Err(AppError::Database(e)),
            };

            let (persona_id, _event_type, _source_filter, use_case_id) = sub;

            let tx = conn.transaction().map_err(AppError::Database)?;

            // Delete the paired event_listener trigger created alongside this subscription.
            // Match on persona_id, trigger_type, and use_case_id to find the paired trigger.
            tx.execute(
                "DELETE FROM persona_triggers
             WHERE persona_id = ?1
               AND trigger_type = 'event_listener'
               AND COALESCE(use_case_id, '') = COALESCE(?2, '')",
                params![persona_id, use_case_id],
            )?;

            // Delete the subscription itself
            let rows = tx.execute(
                "DELETE FROM persona_event_subscriptions WHERE id = ?1",
                params![id],
            )?;

            tx.commit().map_err(AppError::Database)?;

            Ok(rows > 0)
        }
    )
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;
    use crate::models::CreateEventSubscriptionInput;
    use crate::repos::test_fixtures;

    fn create_test_persona(pool: &DbPool) -> String {
        test_fixtures::create_test_persona_id(
            pool,
            "Event Test Persona",
            "You are an event test persona.",
        )
    }

    // ------------------------------------------------------------------
    // Event tests
    // ------------------------------------------------------------------

    #[test]
    fn test_publish_and_get_event() {
        let pool = init_test_db().unwrap();

        let event = publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "file_changed".into(),
                source_type: "watcher".into(),
                project_id: Some("proj-1".into()),
                source_id: Some("watcher-1".into()),
                target_persona_id: None,
                payload: Some(r#"{"path":"src/main.rs"}"#.into()),
                use_case_id: None,
            },
        )
        .unwrap();

        assert_eq!(event.event_type, "file_changed");
        assert_eq!(event.source_type, "watcher");
        assert_eq!(event.project_id, "proj-1");
        assert_eq!(event.status, PersonaEventStatus::Pending);
        assert!(event.processed_at.is_none());

        // Fetch by id
        let fetched = get_by_id(&pool, &event.id).unwrap();
        assert_eq!(fetched.id, event.id);
        assert_eq!(fetched.payload, Some(r#"{"path":"src/main.rs"}"#.into()));
    }

    #[test]
    fn test_get_by_id_not_found() {
        let pool = init_test_db().unwrap();
        let result = get_by_id(&pool, "nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_get_pending_events() {
        let pool = init_test_db().unwrap();

        // Publish two pending events
        publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "build_complete".into(),
                source_type: "ci".into(),
                project_id: Some("proj-a".into()),
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();

        publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "test_passed".into(),
                source_type: "ci".into(),
                project_id: Some("proj-b".into()),
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();

        // All pending
        let all_pending = get_pending(&pool, None, None).unwrap();
        assert_eq!(all_pending.len(), 2);

        // Filtered by project
        let proj_a = get_pending(&pool, None, Some("proj-a")).unwrap();
        assert_eq!(proj_a.len(), 1);
        assert_eq!(proj_a[0].event_type, "build_complete");

        // With limit
        let limited = get_pending(&pool, Some(1), None).unwrap();
        assert_eq!(limited.len(), 1);
    }

    #[test]
    fn test_update_status() {
        let pool = init_test_db().unwrap();

        let event = publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "deploy".into(),
                source_type: "pipeline".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();

        // Mark completed
        update_status(&pool, &event.id, PersonaEventStatus::Completed, None).unwrap();
        let updated = get_by_id(&pool, &event.id).unwrap();
        assert_eq!(updated.status, PersonaEventStatus::Completed);
        assert!(updated.processed_at.is_some());

        // Mark with error
        let event2 = publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "deploy".into(),
                source_type: "pipeline".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();

        update_status(
            &pool,
            &event2.id,
            PersonaEventStatus::Failed,
            Some("timeout exceeded".into()),
        )
        .unwrap();
        let failed = get_by_id(&pool, &event2.id).unwrap();
        assert_eq!(failed.status, PersonaEventStatus::Failed);
        assert_eq!(failed.error_message, Some("timeout exceeded".into()));
        assert!(failed.processed_at.is_some());
    }

    #[test]
    fn test_update_status_not_found() {
        let pool = init_test_db().unwrap();
        let result = update_status(&pool, "nonexistent", PersonaEventStatus::Completed, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_recent() {
        let pool = init_test_db().unwrap();

        for i in 0..3 {
            publish(
                &pool,
                CreatePersonaEventInput {
                    event_type: format!("event_{i}"),
                    source_type: "test".into(),
                    project_id: Some("proj-x".into()),
                    source_id: None,
                    target_persona_id: None,
                    payload: None,
                    use_case_id: None,
                },
            )
            .unwrap();
        }

        let recent = get_recent(&pool, Some(2), None).unwrap();
        assert_eq!(recent.len(), 2);

        let recent_proj = get_recent(&pool, None, Some("proj-x")).unwrap();
        assert_eq!(recent_proj.len(), 3);
    }

    #[test]
    fn test_cleanup() {
        let pool = init_test_db().unwrap();

        let event = publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "old_event".into(),
                source_type: "test".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();

        // Mark as completed (cleanup only deletes completed/skipped/failed)
        update_status(&pool, &event.id, PersonaEventStatus::Completed, None).unwrap();

        // Cleanup with 0 days should delete it (created_at < now - 0 days is already true)
        let deleted = cleanup(&pool, Some(0)).unwrap();
        assert_eq!(deleted, 1);

        // Verify gone
        assert!(get_by_id(&pool, &event.id).is_err());
    }

    /// Helper: publish an event and immediately drive it to a terminal status.
    fn publish_terminal(pool: &DbPool, event_type: &str, status: PersonaEventStatus) -> String {
        let ev = publish(
            pool,
            CreatePersonaEventInput {
                event_type: event_type.into(),
                source_type: "test".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();
        update_status(pool, &ev.id, status, None).unwrap();
        ev.id
    }

    #[test]
    fn test_enforce_count_cap_trims_terminal_only() {
        let pool = init_test_db().unwrap();

        // 5 terminal (completed) events
        for _ in 0..5 {
            publish_terminal(&pool, "capped", PersonaEventStatus::Completed);
        }
        // 1 pending (in-flight) + 1 dead_letter — both EXEMPT
        publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "still_pending".into(),
                source_type: "test".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();
        publish_dead_letter(
            &pool,
            CreatePersonaEventInput {
                event_type: "dlq".into(),
                source_type: "test".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
            "boom".into(),
        )
        .unwrap();

        // Keep only 2 terminal rows → 3 of the 5 completed get trimmed.
        let deleted = enforce_count_cap(&pool, 2).unwrap();
        assert_eq!(deleted, 3);

        // Pending + dead_letter survive untouched; exactly 2 completed remain.
        let recent = get_recent(&pool, Some(100), None).unwrap();
        let completed = recent
            .iter()
            .filter(|e| e.status == PersonaEventStatus::Completed)
            .count();
        assert_eq!(completed, 2);
        assert!(recent
            .iter()
            .any(|e| e.status == PersonaEventStatus::Pending));
        assert!(recent
            .iter()
            .any(|e| e.status == PersonaEventStatus::DeadLetter));
    }

    #[test]
    fn test_enforce_count_cap_noop_under_ceiling() {
        let pool = init_test_db().unwrap();
        publish_terminal(&pool, "a", PersonaEventStatus::Completed);
        publish_terminal(&pool, "b", PersonaEventStatus::Skipped);
        // Ceiling well above the 2 terminal rows → nothing deleted.
        assert_eq!(enforce_count_cap(&pool, 100).unwrap(), 0);
    }

    #[test]
    fn test_skipped_rate_by_type() {
        let pool = init_test_db().unwrap();

        // event_type "dead" → 2 skipped, 1 completed
        publish_terminal(&pool, "dead", PersonaEventStatus::Skipped);
        publish_terminal(&pool, "dead", PersonaEventStatus::Skipped);
        publish_terminal(&pool, "dead", PersonaEventStatus::Completed);
        // event_type "live" → 1 completed, 0 skipped (must NOT appear)
        publish_terminal(&pool, "live", PersonaEventStatus::Completed);

        let rows = skipped_rate_by_type(&pool, 7).unwrap();
        assert_eq!(rows.len(), 1, "only types with a skip appear");
        assert_eq!(rows[0].event_type, "dead");
        assert_eq!(rows[0].skipped, 2);
        assert_eq!(rows[0].total, 3);

        let (total, skipped) = skipped_totals(&pool, 7).unwrap();
        assert_eq!(total, 4);
        assert_eq!(skipped, 2);
    }

    // ------------------------------------------------------------------
    // Subscription tests
    // ------------------------------------------------------------------

    #[test]
    fn test_subscription_crud() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool);

        // Create
        let sub = create_subscription(
            &pool,
            CreateEventSubscriptionInput {
                persona_id: persona_id.clone(),
                event_type: "file_changed".into(),
                source_filter: Some("src/**".into()),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        assert_eq!(sub.persona_id, persona_id);
        assert_eq!(sub.event_type, "file_changed");
        assert_eq!(sub.source_filter, Some("src/**".into()));
        assert!(sub.enabled);

        // Get by id
        let fetched = get_subscription_by_id(&pool, &sub.id).unwrap();
        assert_eq!(fetched.id, sub.id);

        // Update
        let updated = update_subscription(
            &pool,
            &sub.id,
            UpdateEventSubscriptionInput {
                event_type: Some("build_complete".into()),
                source_filter: None,
                enabled: Some(false),
            },
        )
        .unwrap();
        assert_eq!(updated.event_type, "build_complete");
        assert!(!updated.enabled);

        // Delete
        let deleted = delete_subscription(&pool, &sub.id).unwrap();
        assert!(deleted);
        assert!(get_subscription_by_id(&pool, &sub.id).is_err());
    }

    #[test]
    fn test_subscription_not_found() {
        let pool = init_test_db().unwrap();
        let result = get_subscription_by_id(&pool, "nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_get_subscriptions_by_persona() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool);

        create_subscription(
            &pool,
            CreateEventSubscriptionInput {
                persona_id: persona_id.clone(),
                event_type: "event_a".into(),
                source_filter: None,
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        create_subscription(
            &pool,
            CreateEventSubscriptionInput {
                persona_id: persona_id.clone(),
                event_type: "event_b".into(),
                source_filter: None,
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        let subs = get_subscriptions_by_persona(&pool, &persona_id).unwrap();
        assert_eq!(subs.len(), 2);
    }

    #[test]
    fn test_get_subscriptions_by_event_type() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool);

        // One enabled, one disabled
        create_subscription(
            &pool,
            CreateEventSubscriptionInput {
                persona_id: persona_id.clone(),
                event_type: "deploy".into(),
                source_filter: None,
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        create_subscription(
            &pool,
            CreateEventSubscriptionInput {
                persona_id: persona_id.clone(),
                event_type: "deploy".into(),
                source_filter: Some("staging".into()),
                enabled: Some(false),
                use_case_id: None,
            },
        )
        .unwrap();

        // Only enabled ones returned
        let subs = get_subscriptions_by_event_type(&pool, "deploy").unwrap();
        assert_eq!(subs.len(), 1);
        assert!(subs[0].enabled);
    }

    #[test]
    fn test_delete_subscription_not_found() {
        let pool = init_test_db().unwrap();
        let deleted = delete_subscription(&pool, "nonexistent").unwrap();
        assert!(!deleted);
    }

    #[test]
    fn test_update_subscription_propagates_to_trigger() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool);

        let sub_input = CreateEventSubscriptionInput {
            persona_id: persona_id.clone(),
            event_type: "file_changed".into(),
            source_filter: Some("src/**".into()),
            enabled: Some(true),
            use_case_id: None,
        };
        let trigger_input = CreateTriggerInput {
            persona_id: persona_id.clone(),
            trigger_type: "event_listener".into(),
            config: Some(r#"{"listen_event_type":"file_changed","source_filter":"src/**"}"#.into()),
            enabled: Some(true),
            use_case_id: None,
        };

        let sub = create_subscription_with_trigger(&pool, sub_input, trigger_input).unwrap();

        // Verify trigger exists and is enabled
        let conn = pool.get().unwrap();
        let enabled_before: i32 = conn
            .query_row(
                "SELECT enabled FROM persona_triggers
                 WHERE persona_id = ?1 AND trigger_type = 'event_listener'",
                params![persona_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(enabled_before, 1);
        drop(conn); // Release connection back to the pool before update_subscription needs it

        // Update: disable the subscription and change event_type
        update_subscription(
            &pool,
            &sub.id,
            UpdateEventSubscriptionInput {
                event_type: Some("build_complete".into()),
                source_filter: None,
                enabled: Some(false),
            },
        )
        .unwrap();

        // Verify the trigger was also updated
        let conn = pool.get().unwrap();
        let (enabled_after, status): (i32, String) = conn
            .query_row(
                "SELECT enabled, status FROM persona_triggers
                 WHERE persona_id = ?1 AND trigger_type = 'event_listener'",
                params![persona_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(enabled_after, 0);
        assert_eq!(status, "disabled");
    }

    #[test]
    fn test_delete_subscription_removes_paired_trigger() {
        let pool = init_test_db().unwrap();
        let persona_id = create_test_persona(&pool);

        let sub_input = CreateEventSubscriptionInput {
            persona_id: persona_id.clone(),
            event_type: "webhook_received".into(),
            source_filter: None,
            enabled: Some(true),
            use_case_id: None,
        };
        let trigger_input = CreateTriggerInput {
            persona_id: persona_id.clone(),
            trigger_type: "event_listener".into(),
            config: Some(r#"{"listen_event_type":"webhook_received"}"#.into()),
            enabled: Some(true),
            use_case_id: None,
        };

        let sub = create_subscription_with_trigger(&pool, sub_input, trigger_input).unwrap();

        // Verify trigger exists
        let conn = pool.get().unwrap();
        let count_before: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_triggers
                 WHERE persona_id = ?1 AND trigger_type = 'event_listener'",
                params![persona_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count_before, 1);

        // Delete
        let deleted = delete_subscription(&pool, &sub.id).unwrap();
        assert!(deleted);

        // Verify trigger was also deleted
        let count_after: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_triggers
                 WHERE persona_id = ?1 AND trigger_type = 'event_listener'",
                params![persona_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count_after, 0);
    }

    // ------------------------------------------------------------------
    // Event validation tests
    // ------------------------------------------------------------------

    #[test]
    fn test_publish_rejects_empty_event_type() {
        let pool = init_test_db().unwrap();
        let result = publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "".into(),
                source_type: "test".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("event_type"));
    }

    #[test]
    fn test_publish_rejects_invalid_event_type_chars() {
        let pool = init_test_db().unwrap();
        // Script injection attempt
        let result = publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "<script>alert(1)</script>".into(),
                source_type: "test".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        );
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("invalid characters"));
    }

    #[test]
    fn test_publish_rejects_oversized_payload() {
        let pool = init_test_db().unwrap();
        let large_payload = "x".repeat(MAX_PAYLOAD_BYTES + 1);
        let result = publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "test_event".into(),
                source_type: "test".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: Some(large_payload),
                use_case_id: None,
            },
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("payload"));
    }

    #[test]
    fn test_publish_accepts_valid_event_types() {
        let pool = init_test_db().unwrap();
        // All patterns used across the codebase
        let valid_types = [
            "file_changed",
            "build_complete",
            "trigger_fired",
            "chain_triggered",
            "persona_action",
            "trigger:schedule",
            "webhook_received",
            "deploy",
            "event_0",
        ];
        for et in valid_types {
            let result = publish(
                &pool,
                CreatePersonaEventInput {
                    event_type: et.into(),
                    source_type: "test".into(),
                    project_id: None,
                    source_id: None,
                    target_persona_id: None,
                    payload: Some(r#"{"ok":true}"#.into()),
                    use_case_id: None,
                },
            );
            assert!(result.is_ok(), "event_type '{et}' should be accepted");
        }
    }

    #[test]
    fn test_publish_accepts_max_payload() {
        let pool = init_test_db().unwrap();
        let max_payload = "x".repeat(MAX_PAYLOAD_BYTES);
        let result = publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "payload_test".into(),
                source_type: "test".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: Some(max_payload),
                use_case_id: None,
            },
        );
        assert!(
            result.is_ok(),
            "payload at exactly MAX_PAYLOAD_BYTES should be accepted"
        );
    }

    // ------------------------------------------------------------------
    // Search / filter tests
    // ------------------------------------------------------------------

    #[test]
    fn test_search_no_filters() {
        let pool = init_test_db().unwrap();
        for i in 0..3 {
            publish(
                &pool,
                CreatePersonaEventInput {
                    event_type: format!("search_evt_{i}"),
                    source_type: "test".into(),
                    project_id: None,
                    source_id: None,
                    target_persona_id: None,
                    payload: None,
                    use_case_id: None,
                },
            )
            .unwrap();
        }

        let filter = EventFilterInput {
            event_type: None,
            source_type: None,
            status: None,
            target_persona_id: None,
            since: None,
            until: None,
            search: None,
            limit: None,
        };
        let (events, _) = search(&pool, &filter).unwrap();
        assert_eq!(events.len(), 3);
    }

    #[test]
    fn test_search_by_event_type() {
        let pool = init_test_db().unwrap();
        publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "webhook_received".into(),
                source_type: "webhook".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();
        publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "deploy_started".into(),
                source_type: "ci".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();

        let filter = EventFilterInput {
            event_type: Some("webhook_received".into()),
            source_type: None,
            status: None,
            target_persona_id: None,
            since: None,
            until: None,
            search: None,
            limit: None,
        };
        let (events, _) = search(&pool, &filter).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "webhook_received");
    }

    #[test]
    fn test_search_by_status() {
        let pool = init_test_db().unwrap();
        let evt = publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "status_test".into(),
                source_type: "test".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();
        update_status(
            &pool,
            &evt.id,
            PersonaEventStatus::Failed,
            Some("boom".into()),
        )
        .unwrap();

        let filter = EventFilterInput {
            event_type: None,
            source_type: None,
            status: Some("failed".into()),
            target_persona_id: None,
            since: None,
            until: None,
            search: None,
            limit: None,
        };
        let (events, _) = search(&pool, &filter).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].status, PersonaEventStatus::Failed);
    }

    #[test]
    fn test_search_with_text() {
        let pool = init_test_db().unwrap();
        publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "webhook_received".into(),
                source_type: "github".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();
        publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "deploy_started".into(),
                source_type: "ci".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();

        // Search by event type substring
        let filter = EventFilterInput {
            event_type: None,
            source_type: None,
            status: None,
            target_persona_id: None,
            since: None,
            until: None,
            search: Some("webhook".into()),
            limit: None,
        };
        let (events, _) = search(&pool, &filter).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "webhook_received");

        // Search by source type substring
        let filter2 = EventFilterInput {
            event_type: None,
            source_type: None,
            status: None,
            target_persona_id: None,
            since: None,
            until: None,
            search: Some("github".into()),
            limit: None,
        };
        let (events2, _) = search(&pool, &filter2).unwrap();
        assert_eq!(events2.len(), 1);
    }

    #[test]
    fn test_search_pagination() {
        let pool = init_test_db().unwrap();
        for i in 0..5 {
            publish(
                &pool,
                CreatePersonaEventInput {
                    event_type: format!("page_evt_{i}"),
                    source_type: "test".into(),
                    project_id: None,
                    source_id: None,
                    target_persona_id: None,
                    payload: None,
                    use_case_id: None,
                },
            )
            .unwrap();
        }

        let filter = EventFilterInput {
            event_type: None,
            source_type: Some("test".into()),
            status: None,
            target_persona_id: None,
            since: None,
            until: None,
            search: None,
            limit: Some(3),
        };
        let (events, has_more) = search(&pool, &filter).unwrap();
        assert_eq!(events.len(), 3);
        assert!(has_more);
    }

    #[test]
    fn test_claim_pending_atomicity() {
        let pool = init_test_db().unwrap();

        // Publish 3 pending events
        for i in 0..3 {
            publish(
                &pool,
                CreatePersonaEventInput {
                    event_type: format!("claim_test_{i}"),
                    source_type: "test".into(),
                    project_id: None,
                    source_id: None,
                    target_persona_id: None,
                    payload: None,
                    use_case_id: None,
                },
            )
            .unwrap();
        }

        // First claim should get all 3 and set them to 'processing'
        let claimed = claim_pending(&pool, 10).unwrap();
        assert_eq!(claimed.len(), 3);
        for ev in &claimed {
            assert_eq!(ev.status, PersonaEventStatus::Processing);
        }

        // Second claim should get 0 — all are already 'processing'
        let second = claim_pending(&pool, 10).unwrap();
        assert_eq!(second.len(), 0);

        // get_pending should also return 0
        let pending = get_pending(&pool, None, None).unwrap();
        assert_eq!(pending.len(), 0);
    }

    #[test]
    fn test_claim_pending_respects_limit() {
        let pool = init_test_db().unwrap();

        for i in 0..5 {
            publish(
                &pool,
                CreatePersonaEventInput {
                    event_type: format!("limit_test_{i}"),
                    source_type: "test".into(),
                    project_id: None,
                    source_id: None,
                    target_persona_id: None,
                    payload: None,
                    use_case_id: None,
                },
            )
            .unwrap();
        }

        // Claim only 2
        let claimed = claim_pending(&pool, 2).unwrap();
        assert_eq!(claimed.len(), 2);

        // 3 should still be pending
        let remaining = get_pending(&pool, None, None).unwrap();
        assert_eq!(remaining.len(), 3);
    }

    // ========================================================================
    // Fix 1: orphan event cleanup
    // ========================================================================

    #[test]
    fn test_fix1_delete_events_by_source_id() {
        let pool = init_test_db().unwrap();

        // Publish 3 events tied to one fake trigger id + 2 events tied to another
        for i in 0..3 {
            publish(
                &pool,
                CreatePersonaEventInput {
                    event_type: format!("evt_{i}"),
                    source_type: "trigger".into(),
                    source_id: Some("trigger-alpha".into()),
                    target_persona_id: None,
                    project_id: None,
                    payload: None,
                    use_case_id: None,
                },
            )
            .unwrap();
        }
        for i in 0..2 {
            publish(
                &pool,
                CreatePersonaEventInput {
                    event_type: format!("beta_{i}"),
                    source_type: "trigger".into(),
                    source_id: Some("trigger-beta".into()),
                    target_persona_id: None,
                    project_id: None,
                    payload: None,
                    use_case_id: None,
                },
            )
            .unwrap();
        }

        let removed = delete_events_by_source_id(&pool, "trigger-alpha").unwrap();
        assert_eq!(removed, 3);

        // Beta events still there
        let conn = pool.get().unwrap();
        let beta_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_events WHERE source_id = ?1",
                params!["trigger-beta"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(beta_count, 2);
    }

    #[test]
    fn test_fix1_delete_orphaned_trigger_events_matches_only_orphans() {
        let pool = init_test_db().unwrap();

        // Create a live trigger with raw INSERT so we don't get auto-listener
        // side-effects confusing the test
        let persona = crate::repos::test_fixtures::create_test_persona(
            &pool,
            "Event Test Persona",
            "Events happen here.",
        );
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO persona_triggers
                 (id, persona_id, trigger_type, config, enabled, status, use_case_id, created_at, updated_at)
                 VALUES ('live-trigger', ?1, 'manual', NULL, 1, 'active', NULL, '2026-01-01', '2026-01-01')",
                params![persona.id],
            )
            .unwrap();
        }

        // Event tied to live trigger — should SURVIVE
        publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "live_event".into(),
                source_type: "trigger".into(),
                source_id: Some("live-trigger".into()),
                target_persona_id: None,
                project_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();

        // Event tied to a ghost trigger — should be DELETED
        publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "ghost_event".into(),
                source_type: "trigger".into(),
                source_id: Some("ghost-trigger".into()),
                target_persona_id: None,
                project_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();

        // Non-trigger event (source_type != 'trigger') — should SURVIVE regardless
        publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "webhook_event".into(),
                source_type: "webhook".into(),
                source_id: Some("some-webhook-id".into()),
                target_persona_id: None,
                project_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();

        let removed = delete_orphaned_trigger_events(&pool).unwrap();
        assert_eq!(removed, 1, "only the ghost trigger event should be deleted");

        let conn = pool.get().unwrap();
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM persona_events", [], |row| row.get(0))
            .unwrap();
        assert_eq!(remaining, 2, "live + webhook events should survive");
    }

    // ------------------------------------------------------------------
    // Skip-reason ledger (event_reason tokens)
    //
    // The bus writes a machine token into `error_message` for every gate that
    // drops a match (`engine/background.rs` `EventGateReason`). These tests
    // pin the wire format — the literal token strings — and assert each one
    // actually lands on the row after the claim→terminal-status round trip a
    // real tick performs.
    // ------------------------------------------------------------------

    /// Publish an event and claim it, mirroring the bus's `claim_pending`
    /// step so the row under test is genuinely in `processing`.
    fn publish_and_claim(pool: &DbPool, event_type: &str) -> PersonaEvent {
        publish(
            pool,
            CreatePersonaEventInput {
                event_type: event_type.into(),
                source_type: "test".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();
        let claimed = claim_pending(pool, 10).unwrap();
        let evt = claimed
            .into_iter()
            .find(|e| e.event_type == event_type)
            .expect("event should be claimed");
        assert_eq!(evt.status, PersonaEventStatus::Processing);
        evt
    }

    fn assert_reason_lands(status: PersonaEventStatus, token: &str) {
        let pool = init_test_db().unwrap();
        let evt = publish_and_claim(&pool, "gate_test");
        update_status(&pool, &evt.id, status.clone(), Some(token.to_string())).unwrap();

        let row = get_by_id(&pool, &evt.id).unwrap();
        assert_eq!(row.status, status, "terminal status for token {token}");
        assert_eq!(
            row.error_message.as_deref(),
            Some(token),
            "reason token should land on the row"
        );
    }

    #[test]
    fn skip_reason_no_subscriber_lands_on_row() {
        assert_reason_lands(PersonaEventStatus::Skipped, "no_subscriber");
    }

    #[test]
    fn skip_reason_approval_held_lands_on_row() {
        assert_reason_lands(PersonaEventStatus::Skipped, "approval_held");
    }

    #[test]
    fn skip_reason_persona_disabled_lands_on_row() {
        // Gates that drop a match inside the fan-out leave the event
        // `delivered` (the bus does not change WHICH events are skipped) —
        // the token is what explains the empty delivery.
        assert_reason_lands(PersonaEventStatus::Delivered, "persona_disabled");
    }

    #[test]
    fn skip_reason_cross_team_blocked_lands_on_row() {
        assert_reason_lands(PersonaEventStatus::Delivered, "cross_team_blocked");
    }

    #[test]
    fn skip_reason_cascade_guard_lands_on_row() {
        assert_reason_lands(PersonaEventStatus::Delivered, "cascade_guard");
    }

    #[test]
    fn skip_reason_dry_run_lands_on_row() {
        assert_reason_lands(PersonaEventStatus::Delivered, "dry_run");
    }

    #[test]
    fn skip_reason_multiple_gates_are_comma_joined() {
        let pool = init_test_db().unwrap();
        let evt = publish_and_claim(&pool, "multi_gate");
        update_status(
            &pool,
            &evt.id,
            PersonaEventStatus::Delivered,
            Some("persona_disabled,cascade_guard".to_string()),
        )
        .unwrap();
        let row = get_by_id(&pool, &evt.id).unwrap();
        assert_eq!(
            row.error_message.as_deref(),
            Some("persona_disabled,cascade_guard")
        );
    }

    #[test]
    fn clean_dispatch_leaves_reason_null() {
        // An event that dispatched with no gate hit must keep a NULL reason so
        // the UI can tell "nothing to explain" from "reason unknown".
        let pool = init_test_db().unwrap();
        let evt = publish_and_claim(&pool, "clean_dispatch");
        update_status(&pool, &evt.id, PersonaEventStatus::Delivered, None).unwrap();
        let row = get_by_id(&pool, &evt.id).unwrap();
        assert!(row.error_message.is_none());
    }

    #[test]
    fn handoff_target_disabled_dead_letters_from_processing() {
        // Regression: `update_status(.., DeadLetter, ..)` on a `processing` row
        // is rejected by `can_transition_to` (no Processing -> DeadLetter edge),
        // so the stalled-cascade write silently failed and stranded the row.
        let pool = init_test_db().unwrap();
        let evt = publish_and_claim(&pool, "stalled_handoff");

        let via_update_status = update_status(
            &pool,
            &evt.id,
            PersonaEventStatus::DeadLetter,
            Some("handoff_target_disabled".to_string()),
        );
        assert!(
            via_update_status.is_err(),
            "processing -> dead_letter must stay illegal through update_status"
        );

        let moved = dead_letter_from_processing(
            &pool,
            &evt.id,
            Some("handoff_target_disabled".to_string()),
        )
        .unwrap();
        assert!(moved);

        let row = get_by_id(&pool, &evt.id).unwrap();
        assert_eq!(row.status, PersonaEventStatus::DeadLetter);
        assert_eq!(
            row.error_message.as_deref(),
            Some("handoff_target_disabled")
        );
        assert!(row.processed_at.is_some());
    }

    // ------------------------------------------------------------------
    // Stuck-`processing` reaper
    //
    // A tick that dies between `claim_pending` and its terminal status write
    // leaves the event in `processing` forever: never delivered, never
    // retried, exempt from retention, invisible to the pending and
    // dead-letter counts. These cover the two ways out.
    // ------------------------------------------------------------------

    #[test]
    fn list_processing_ids_sees_only_claimed_rows() {
        let pool = init_test_db().unwrap();
        let stranded = publish_and_claim(&pool, "stranded");
        publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "untouched".into(),
                source_type: "test".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();

        let processing = list_processing_ids(&pool, 100).unwrap();
        assert_eq!(processing, vec![stranded.id.clone()]);

        // Once it reaches a terminal status it drops out of the scan.
        update_status(&pool, &stranded.id, PersonaEventStatus::Delivered, None).unwrap();
        assert!(list_processing_ids(&pool, 100).unwrap().is_empty());
    }

    #[test]
    fn reap_stuck_processing_redelivers_a_strand() {
        let pool = init_test_db().unwrap();
        let evt = publish_and_claim(&pool, "crashed_mid_tick");

        let outcome = reap_stuck_processing(
            &pool,
            &evt.id,
            DEFAULT_MAX_RETRIES,
            "stuck_reclaimed",
            "stuck_retry_exhausted",
        )
        .unwrap();
        assert_eq!(outcome, Some(StuckReapOutcome::Redelivered));

        let row = get_by_id(&pool, &evt.id).unwrap();
        assert_eq!(row.status, PersonaEventStatus::Pending);
        assert_eq!(row.retry_count, 1);
        assert_eq!(row.error_message.as_deref(), Some("stuck_reclaimed"));
        assert!(
            row.processed_at.is_none(),
            "a redelivered event is not processed yet"
        );

        // …and it is genuinely back in the queue: the next tick can claim it.
        let reclaimed = claim_pending(&pool, 10).unwrap();
        assert!(reclaimed.iter().any(|e| e.id == evt.id));
    }

    #[test]
    fn reap_stuck_processing_dead_letters_an_exhausted_strand() {
        let pool = init_test_db().unwrap();
        let evt = publish_and_claim(&pool, "poisoned");

        // Burn the retry budget: each reap increments retry_count, so the last
        // one flips to dead_letter instead of cycling pending -> processing
        // -> pending forever.
        for attempt in 1..DEFAULT_MAX_RETRIES {
            let outcome = reap_stuck_processing(
                &pool,
                &evt.id,
                DEFAULT_MAX_RETRIES,
                "stuck_reclaimed",
                "stuck_retry_exhausted",
            )
            .unwrap();
            assert_eq!(
                outcome,
                Some(StuckReapOutcome::Redelivered),
                "attempt {attempt} should still redeliver"
            );
            // Re-strand it, as a crashing tick would.
            claim_pending(&pool, 10).unwrap();
        }

        let outcome = reap_stuck_processing(
            &pool,
            &evt.id,
            DEFAULT_MAX_RETRIES,
            "stuck_reclaimed",
            "stuck_retry_exhausted",
        )
        .unwrap();
        assert_eq!(outcome, Some(StuckReapOutcome::DeadLettered));

        let row = get_by_id(&pool, &evt.id).unwrap();
        assert_eq!(row.status, PersonaEventStatus::DeadLetter);
        assert_eq!(row.retry_count, DEFAULT_MAX_RETRIES);
        assert_eq!(row.error_message.as_deref(), Some("stuck_retry_exhausted"));
        assert!(row.processed_at.is_some());

        // It is out of the queue for good — no further claim can pick it up.
        assert!(!claim_pending(&pool, 10)
            .unwrap()
            .iter()
            .any(|e| e.id == evt.id));
        assert!(get_dead_letter_events(&pool, Some(10))
            .unwrap()
            .iter()
            .any(|e| e.id == evt.id));
    }

    #[test]
    fn reap_stuck_processing_loses_the_race_to_the_owning_tick() {
        // The guard that makes this safe to run alongside a live tick: if the
        // tick wrote its terminal status first, the reap is a no-op.
        let pool = init_test_db().unwrap();
        let evt = publish_and_claim(&pool, "finished_first");
        update_status(&pool, &evt.id, PersonaEventStatus::Delivered, None).unwrap();

        let outcome = reap_stuck_processing(
            &pool,
            &evt.id,
            DEFAULT_MAX_RETRIES,
            "stuck_reclaimed",
            "stuck_retry_exhausted",
        )
        .unwrap();
        assert_eq!(outcome, None);

        let row = get_by_id(&pool, &evt.id).unwrap();
        assert_eq!(row.status, PersonaEventStatus::Delivered);
        assert_eq!(row.retry_count, 0, "a lost race must not burn a retry");
        assert!(row.error_message.is_none());
    }

    #[test]
    fn dead_letter_from_processing_ignores_non_processing_rows() {
        let pool = init_test_db().unwrap();
        let evt = publish(
            &pool,
            CreatePersonaEventInput {
                event_type: "still_pending".into(),
                source_type: "test".into(),
                project_id: None,
                source_id: None,
                target_persona_id: None,
                payload: None,
                use_case_id: None,
            },
        )
        .unwrap();

        let moved = dead_letter_from_processing(&pool, &evt.id, Some("x".into())).unwrap();
        assert!(
            !moved,
            "a pending row must not be dead-lettered by this path"
        );
        let row = get_by_id(&pool, &evt.id).unwrap();
        assert_eq!(row.status, PersonaEventStatus::Pending);
        assert!(row.error_message.is_none());
    }
}
