use rusqlite::params;

use crate::db::models::{
    CreateEventSubscriptionInput, CreatePersonaEventInput, CreateTriggerInput, EventFilterInput,
    PersonaEvent, PersonaEventStatus, PersonaEventSubscription, UpdateEventSubscriptionInput,
};
use crate::db::repos::utils::collect_rows;
use crate::db::DbPool;
use crate::engine::crypto;
use crate::error::AppError;

// ============================================================================
// Input Validation
// ============================================================================

/// Maximum payload size in bytes (64 KB).
const MAX_PAYLOAD_BYTES: usize = 64 * 1024;

/// Maximum length for event_type and source_type strings.
const MAX_TYPE_LEN: usize = 128;

/// Validate that `event_type` and `source_type` contain only safe characters:
/// alphanumeric, underscore, hyphen, dot, colon, forward-slash.
/// Must start with an alphanumeric or underscore character.
fn is_safe_type_string(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let first = s.as_bytes()[0];
    if !(first.is_ascii_alphanumeric() || first == b'_') {
        return false;
    }
    s.bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.' || b == b':' || b == b'/')
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
        (Some(ct), Some(ref iv)) if !iv.is_empty() => {
            match crypto::decrypt_from_db(&ct, iv) {
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
            }
        }
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
        let (stored_payload, payload_iv) = match &input.payload {
            Some(plaintext) if !plaintext.is_empty() => {
                match crypto::encrypt_for_db(plaintext) {
                    Ok((ct, iv)) => (Some(ct), Some(iv)),
                    Err(e) => {
                        tracing::warn!("Failed to encrypt event payload, storing plaintext: {}", e);
                        (Some(plaintext.clone()), None)
                    }
                }
            }
            other => (other.clone(), None),
        };

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO persona_events
             (id, project_id, event_type, source_type, source_id, target_persona_id, payload, payload_iv, use_case_id, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', ?10)",
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
                now,
            ],
        )?;

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
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_events
                 WHERE status = 'pending' AND project_id = ?1
                 ORDER BY created_at ASC
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![pid, limit], row_to_event)?;
            Ok(collect_rows(rows, "get_pending"))
        } else {
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_events
                 WHERE status = 'pending'
                 ORDER BY created_at ASC
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
pub fn claim_pending(
    pool: &DbPool,
    limit: i64,
) -> Result<Vec<PersonaEvent>, AppError> {
    timed_query!("persona_events", "persona_events::claim_pending", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "UPDATE persona_events
             SET status = 'processing'
             WHERE id IN (
                 SELECT id FROM persona_events
                 WHERE status = 'pending'
                 ORDER BY created_at ASC
                 LIMIT ?1
             )
             RETURNING *",
        )?;
        let rows = stmt.query_map(params![limit], row_to_event)?;
        Ok(collect_rows(rows, "claim_pending"))
    })
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
        let current_str: String = conn
            .query_row(
                "SELECT status FROM persona_events WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
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

        conn.execute(
            "UPDATE persona_events
             SET status = ?1, error_message = ?2, processed_at = ?3
             WHERE id = ?4",
            params![status_str, error_message, processed_at, id],
        )?;

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
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_events
                 WHERE project_id = ?1
                 ORDER BY created_at DESC
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![pid, limit], row_to_event)?;
            Ok(collect_rows(rows, "get_recent"))
        } else {
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_events
                 ORDER BY created_at DESC
                 LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![limit], row_to_event)?;
            Ok(collect_rows(rows, "get_recent"))
        }
    })
}

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
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_events
             WHERE created_at >= ?1 AND created_at <= ?2
             ORDER BY created_at ASC
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

/// Count events by source persona ID (used for post-mortem dedup check).
pub fn count_by_source(pool: &DbPool, persona_id: &str) -> Result<i64, AppError> {
    timed_query!("persona_events", "persona_events::count_by_source", {
        let conn = pool.get()?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM persona_events WHERE source_id = ?1",
            params![persona_id],
            |row| row.get(0),
        )?;
        Ok(count)
    })
}

pub fn cleanup(pool: &DbPool, older_than_days: Option<i64>) -> Result<i64, AppError> {
    timed_query!("persona_events", "persona_events::cleanup", {
        let days = older_than_days.unwrap_or(30);
        let conn = pool.get()?;

        // Use chrono for the cutoff date to match the timestamp format used in publish().
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339();
        let rows = conn.execute(
            "DELETE FROM persona_events
             WHERE status IN ('completed', 'skipped', 'failed', 'discarded')
               AND created_at < ?1",
            params![cutoff],
        )?;

        Ok(rows as i64)
    })
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
    timed_query!("persona_events", "persona_events::get_dead_letter_events", {
        let limit = limit.unwrap_or(100);
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_events
             WHERE status = 'dead_letter'
             ORDER BY processed_at DESC, created_at DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], row_to_event)?;
        Ok(collect_rows(rows, "get_dead_letter_events"))
    })
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

/// Move a failed event to the dead letter queue.
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
             WHERE id = ?3",
            params![error_message, now, id],
        )?;
        if rows == 0 {
            return Err(AppError::NotFound(format!("PersonaEvent {id}")));
        }
        Ok(())
    })
}

/// Increment retry_count and reset status to 'pending' for a dead-lettered event.
/// Returns `RetryExhausted` if retry_count has already reached `MAX_MANUAL_RETRIES`.
///
/// Manual retries from the DLQ are capped separately from the automatic retry
/// limit (`DEFAULT_MAX_RETRIES`) because the user may want a few extra manual
/// attempts — but we still need a ceiling to prevent infinite loops.
pub const MAX_MANUAL_RETRIES: i32 = 5;

pub fn retry_dead_letter(pool: &DbPool, id: &str) -> Result<PersonaEvent, AppError> {
    timed_query!("persona_events", "persona_events::retry_dead_letter", {
        let conn = pool.get()?;

        // Check current retry_count before allowing the retry.
        let current_retries: i32 = conn
            .query_row(
                "SELECT retry_count FROM persona_events WHERE id = ?1 AND status = 'dead_letter'",
                params![id],
                |row| row.get(0),
            )
            .map_err(|_| AppError::NotFound(format!("Dead-lettered PersonaEvent {id}")))?;

        if current_retries >= MAX_MANUAL_RETRIES {
            return Err(AppError::RetryExhausted(format!(
                "Event {id} has exhausted all {MAX_MANUAL_RETRIES} retry attempts"
            )));
        }

        conn.execute(
            "UPDATE persona_events
             SET status = 'pending', retry_count = retry_count + 1,
                 error_message = NULL, processed_at = NULL
             WHERE id = ?1 AND status = 'dead_letter'",
            params![id],
        )?;
        get_by_id(pool, id)
    })
}

/// Discard a dead-lettered event by marking it as 'discarded'.
pub fn discard_dead_letter(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("persona_events", "persona_events::discard_dead_letter", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let rows = conn.execute(
            "UPDATE persona_events
             SET status = 'discarded', processed_at = ?1
             WHERE id = ?2 AND status = 'dead_letter'",
            params![now, id],
        )?;
        if rows == 0 {
            return Err(AppError::NotFound(format!(
                "Dead-lettered PersonaEvent {id}"
            )));
        }
        Ok(())
    })
}

/// Increment retry_count for a failed event. If retry_count reaches max_retries,
/// move it to dead_letter status. Returns true if moved to DLQ.
pub fn increment_retry_or_dead_letter(
    pool: &DbPool,
    id: &str,
    error_message: Option<String>,
    max_retries: i32,
) -> Result<bool, AppError> {
    timed_query!("persona_events", "persona_events::increment_retry_or_dead_letter", {
        let conn = pool.get()?;

        // Get current retry_count
        let current_retries: i32 = conn.query_row(
            "SELECT retry_count FROM persona_events WHERE id = ?1",
            params![id],
            |row| row.get(0),
        ).map_err(|_| AppError::NotFound(format!("PersonaEvent {id}")))?;

        let new_count = current_retries + 1;
        let now = chrono::Utc::now().to_rfc3339();

        if new_count >= max_retries {
            // Move to dead letter queue
            conn.execute(
                "UPDATE persona_events
                 SET status = 'dead_letter', retry_count = ?1, error_message = ?2, processed_at = ?3
                 WHERE id = ?4",
                params![new_count, error_message, now, id],
            )?;
            Ok(true)
        } else {
            // Mark as failed with incremented retry count
            conn.execute(
                "UPDATE persona_events
                 SET status = 'failed', retry_count = ?1, error_message = ?2, processed_at = ?3
                 WHERE id = ?4",
                params![new_count, error_message, now, id],
            )?;
            Ok(false)
        }
    })
}

/// Get events eligible for automatic retry (failed status, retry_count < max_retries).
pub fn get_retry_eligible(
    pool: &DbPool,
    max_retries: i32,
    limit: i64,
) -> Result<Vec<PersonaEvent>, AppError> {
    timed_query!("persona_events", "persona_events::get_retry_eligible", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_events
             WHERE status = 'failed'
               AND retry_count < ?1
             ORDER BY created_at ASC
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

    let mut clauses: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = 1u32;

    if let Some(ref v) = filter.event_type {
        clauses.push(format!("event_type = ?{idx}"));
        param_values.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = filter.source_type {
        clauses.push(format!("source_type = ?{idx}"));
        param_values.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = filter.status {
        clauses.push(format!("status = ?{idx}"));
        param_values.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = filter.target_persona_id {
        clauses.push(format!("target_persona_id = ?{idx}"));
        param_values.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = filter.since {
        clauses.push(format!("created_at >= ?{idx}"));
        param_values.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = filter.until {
        clauses.push(format!("created_at <= ?{idx}"));
        param_values.push(Box::new(v.clone()));
        idx += 1;
    }
    if let Some(ref v) = filter.search {
        if !v.is_empty() {
            // Full-text search on payload (plaintext stored after encryption roundtrip is
            // not searchable, so we search the raw column which may be ciphertext).
            // Also search event_type and source_type for broader match.
            let pattern = format!("%{v}%");
            clauses.push(format!(
                "(event_type LIKE ?{idx} OR source_type LIKE ?{} OR payload LIKE ?{})",
                idx + 1,
                idx + 2
            ));
            param_values.push(Box::new(pattern.clone()));
            param_values.push(Box::new(pattern.clone()));
            param_values.push(Box::new(pattern));
            idx += 3;
        }
    }

    let where_clause = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };

    let sql = format!(
        "SELECT * FROM persona_events {where_clause} ORDER BY created_at DESC LIMIT ?{idx}"
    );
    param_values.push(Box::new(fetch));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_ref.as_slice(), row_to_event)?;
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
    timed_query!("event_subscriptions", "event_subscriptions::get_subscription_by_id", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM persona_event_subscriptions WHERE id = ?1",
            params![id],
            row_to_subscription,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("PersonaEventSubscription {id}"))
            }
            other => AppError::Database(other),
        })
    })
}

pub fn get_subscriptions_by_persona(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<PersonaEventSubscription>, AppError> {
    timed_query!("event_subscriptions", "event_subscriptions::get_subscriptions_by_persona", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_event_subscriptions
             WHERE persona_id = ?1
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![persona_id], row_to_subscription)?;
        Ok(collect_rows(rows, "get_subscriptions_by_persona"))
    })
}

/// Bulk-fetch subscriptions for multiple persona IDs in a single query.
pub fn get_subscriptions_by_persona_ids(
    pool: &DbPool,
    persona_ids: &[String],
) -> Result<Vec<PersonaEventSubscription>, AppError> {
    if persona_ids.is_empty() {
        return Ok(Vec::new());
    }
    timed_query!("event_subscriptions", "event_subscriptions::get_subscriptions_by_persona_ids", {
        let conn = pool.get()?;
        let placeholders: Vec<String> = persona_ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "SELECT * FROM persona_event_subscriptions WHERE persona_id IN ({}) ORDER BY created_at DESC",
            placeholders.join(", ")
        );
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = persona_ids
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), row_to_subscription)?;
        Ok(collect_rows(rows, "get_subscriptions_by_persona_ids"))
    })
}

pub fn get_all_subscriptions(
    pool: &DbPool,
) -> Result<Vec<PersonaEventSubscription>, AppError> {
    timed_query!("event_subscriptions", "event_subscriptions::get_all_subscriptions", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_event_subscriptions ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_subscription)?;
        Ok(collect_rows(rows, "get_all_subscriptions"))
    })
}

pub fn get_subscriptions_by_event_type(
    pool: &DbPool,
    event_type: &str,
) -> Result<Vec<PersonaEventSubscription>, AppError> {
    timed_query!("event_subscriptions", "event_subscriptions::get_subscriptions_by_event_type", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_event_subscriptions
             WHERE event_type = ?1 AND enabled = 1
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![event_type], row_to_subscription)?;
        Ok(collect_rows(rows, "get_subscriptions_by_event_type"))
    })
}

/// Bulk-fetch enabled subscriptions for multiple event types in a single query.
pub fn get_subscriptions_by_event_types(
    pool: &DbPool,
    event_types: &[String],
) -> Result<Vec<PersonaEventSubscription>, AppError> {
    if event_types.is_empty() {
        return Ok(Vec::new());
    }
    timed_query!("event_subscriptions", "event_subscriptions::get_subscriptions_by_event_types", {
        let conn = pool.get()?;
        let placeholders: Vec<String> = event_types
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "SELECT * FROM persona_event_subscriptions
             WHERE event_type IN ({}) AND enabled = 1
             ORDER BY created_at DESC",
            placeholders.join(", ")
        );
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = event_types
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), row_to_subscription)?;
        Ok(collect_rows(rows, "get_subscriptions_by_event_types"))
    })
}

pub fn create_subscription(
    pool: &DbPool,
    input: CreateEventSubscriptionInput,
) -> Result<PersonaEventSubscription, AppError> {
    timed_query!("event_subscriptions", "event_subscriptions::create_subscription", {
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
            let existing = conn.query_row(
                "SELECT * FROM persona_event_subscriptions
                 WHERE persona_id = ?1 AND event_type = ?2
                   AND COALESCE(source_filter, '') = COALESCE(?3, '')",
                params![input.persona_id, input.event_type, input.source_filter],
                row_to_subscription,
            ).map_err(AppError::Database)?;
            return Ok(existing);
        }

        get_subscription_by_id(pool, &id)
    })
}

/// Atomically create an event_listener trigger and a legacy subscription
/// inside a single transaction (dual-write).
pub fn create_subscription_with_trigger(
    pool: &DbPool,
    input: CreateEventSubscriptionInput,
    trigger_input: CreateTriggerInput,
) -> Result<PersonaEventSubscription, AppError> {
    timed_query!("event_subscriptions", "event_subscriptions::create_subscription_with_trigger", {
        let mut conn = pool.get()?;
        let tx = conn.transaction().map_err(AppError::Database)?;

        // 1) Insert the event_listener trigger
        let trigger_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let trigger_enabled = trigger_input.enabled.unwrap_or(true);
        let trigger_status = if trigger_enabled { "active" } else { "disabled" };
        let encrypted_config = trigger_input.config.as_deref().map(|c| {
            crypto::encrypt_trigger_config(c).unwrap_or_else(|e| {
                tracing::warn!("Failed to encrypt trigger config, storing as-is: {}", e);
                c.to_string()
            })
        });
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
            let existing = conn.query_row(
                "SELECT * FROM persona_event_subscriptions
                 WHERE persona_id = ?1 AND event_type = ?2
                   AND COALESCE(source_filter, '') = COALESCE(?3, '')",
                params![input.persona_id, input.event_type, input.source_filter],
                row_to_subscription,
            ).map_err(AppError::Database)?;
            Ok(existing)
        } else {
            get_subscription_by_id(pool, &sub_id)
        }
    })
}

pub fn update_subscription(
    pool: &DbPool,
    id: &str,
    input: UpdateEventSubscriptionInput,
) -> Result<PersonaEventSubscription, AppError> {
    timed_query!("event_subscriptions", "event_subscriptions::update_subscription", {
        // Verify exists
        get_subscription_by_id(pool, id)?;

        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;

        push_field!(input.event_type, "event_type", sets, param_idx);
        push_field!(input.source_filter, "source_filter", sets, param_idx);
        push_field!(input.enabled, "enabled", sets, param_idx);

        let sql = format!(
            "UPDATE persona_event_subscriptions SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );

        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

        if let Some(ref v) = input.event_type {
            param_values.push(Box::new(v.clone()));
        }
        if let Some(ref v) = input.source_filter {
            param_values.push(Box::new(v.clone()));
        }
        if let Some(v) = input.enabled {
            param_values.push(Box::new(v as i32));
        }
        param_values.push(Box::new(id.to_string()));

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params_ref.as_slice())?;

        get_subscription_by_id(pool, id)
    })
}

pub fn delete_subscription(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("event_subscriptions", "event_subscriptions::delete_subscription", {
        let conn = pool.get()?;
        let rows = conn.execute(
            "DELETE FROM persona_event_subscriptions WHERE id = ?1",
            params![id],
        )?;
        Ok(rows > 0)
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::CreateEventSubscriptionInput;
    use crate::db::repos::test_fixtures;

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
        assert!(result.unwrap_err().to_string().contains("invalid characters"));
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
        assert!(result.is_ok(), "payload at exactly MAX_PAYLOAD_BYTES should be accepted");
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
        update_status(&pool, &evt.id, PersonaEventStatus::Failed, Some("boom".into())).unwrap();

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
}
