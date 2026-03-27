use rusqlite::params;
use url::Url;
use uuid::Uuid;

use crate::db::models::{SmeeRelay, CreateSmeeRelayInput, UpdateSmeeRelayInput};
use crate::db::DbPool;
use crate::error::AppError;

/// Allowed hostnames for Smee relay channel URLs.
/// Only smee.io (and its www variant) are permitted to prevent SSRF attacks
/// where an attacker-controlled URL points the SSE client at internal services.
const ALLOWED_SMEE_HOSTS: &[&str] = &["smee.io", "www.smee.io"];

/// Validate that a channel URL is a legitimate smee.io URL.
///
/// Rejects URLs that:
/// - Are not valid URLs
/// - Do not use HTTPS
/// - Point to a host outside the allowed list
/// - Contain userinfo (e.g. `https://user:pass@smee.io/...`)
fn validate_channel_url(channel_url: &str) -> Result<(), AppError> {
    let parsed = Url::parse(channel_url)
        .map_err(|_| AppError::Validation("Invalid URL format for Smee relay channel".into()))?;

    if parsed.scheme() != "https" {
        return Err(AppError::Validation(
            "Smee relay channel URL must use HTTPS".into(),
        ));
    }

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppError::Validation(
            "Smee relay channel URL must not contain credentials".into(),
        ));
    }

    let host = parsed.host_str().ok_or_else(|| {
        AppError::Validation("Smee relay channel URL must have a host".into())
    })?;

    if !ALLOWED_SMEE_HOSTS.contains(&host) {
        return Err(AppError::Validation(format!(
            "Smee relay channel URL must be a smee.io URL (got host '{host}')"
        )));
    }

    Ok(())
}

row_mapper!(row_to_relay -> SmeeRelay {
    id, label, channel_url, status, event_filter,
    target_persona_id, events_relayed, last_event_at,
    error, created_at, updated_at,
});

pub fn list(pool: &DbPool) -> Result<Vec<SmeeRelay>, AppError> {
    timed_query!("smee_relays", "smee_relays::list", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM smee_relays ORDER BY created_at DESC"
        )?;
        let rows = stmt.query_map([], row_to_relay)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    })
}

pub fn get(pool: &DbPool, id: &str) -> Result<SmeeRelay, AppError> {
    timed_query!("smee_relays", "smee_relays::get", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM smee_relays WHERE id = ?1",
            params![id],
            row_to_relay,
        ).map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Smee relay {id} not found")),
            e => AppError::Database(e),
        })
    })
}

pub fn create(pool: &DbPool, input: CreateSmeeRelayInput) -> Result<SmeeRelay, AppError> {
    validate_channel_url(&input.channel_url)?;

    timed_query!("smee_relays", "smee_relays::create", {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO smee_relays (id, label, channel_url, status, event_filter, target_persona_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'active', ?4, ?5, ?6, ?6)",
            params![id, input.label, input.channel_url, input.event_filter, input.target_persona_id, now],
        )?;
        get(pool, &id)
    })
}

pub fn update(pool: &DbPool, id: &str, input: UpdateSmeeRelayInput) -> Result<SmeeRelay, AppError> {
    timed_query!("smee_relays", "smee_relays::update", {
        let now = chrono::Utc::now().to_rfc3339();
        let existing = get(pool, id)?;
        let label = input.label.unwrap_or(existing.label);
        let event_filter = input.event_filter.or(existing.event_filter);
        let target_persona_id = input.target_persona_id.or(existing.target_persona_id);
        let conn = pool.get()?;
        conn.execute(
            "UPDATE smee_relays SET label = ?2, event_filter = ?3, target_persona_id = ?4, updated_at = ?5 WHERE id = ?1",
            params![id, label, event_filter, target_persona_id, now],
        )?;
        // Construct the return value from known data instead of a redundant SELECT.
        Ok(SmeeRelay {
            id: existing.id,
            label,
            channel_url: existing.channel_url,
            status: existing.status,
            event_filter,
            target_persona_id,
            events_relayed: existing.events_relayed,
            last_event_at: existing.last_event_at,
            error: existing.error,
            created_at: existing.created_at,
            updated_at: now,
        })
    })
}

pub fn set_status(pool: &DbPool, id: &str, status: &str) -> Result<SmeeRelay, AppError> {
    timed_query!("smee_relays", "smee_relays::set_status", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        let rows = conn.execute(
            "UPDATE smee_relays SET status = ?2, updated_at = ?3, error = CASE WHEN ?2 = 'active' THEN NULL ELSE error END WHERE id = ?1",
            params![id, status, now],
        )?;
        if rows == 0 {
            return Err(AppError::NotFound(format!("Smee relay {id} not found")));
        }
        get(pool, id)
    })
}

/// Fire-and-forget status update. Skips the post-write SELECT that `set_status`
/// performs, for callers that discard the returned `SmeeRelay`.
pub fn set_status_quiet(pool: &DbPool, id: &str, status: &str) -> Result<(), AppError> {
    timed_query!("smee_relays", "smee_relays::set_status_quiet", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE smee_relays SET status = ?2, updated_at = ?3, error = CASE WHEN ?2 = 'active' THEN NULL ELSE error END WHERE id = ?1",
            params![id, status, now],
        )?;
        Ok(())
    })
}

pub fn record_event(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("smee_relays", "smee_relays::record_event", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE smee_relays SET events_relayed = events_relayed + 1, last_event_at = ?2, updated_at = ?2 WHERE id = ?1",
            params![id, now],
        )?;
        Ok(())
    })
}

pub fn record_error(pool: &DbPool, id: &str, error: &str) -> Result<(), AppError> {
    timed_query!("smee_relays", "smee_relays::record_error", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE smee_relays SET error = ?2, status = 'error', updated_at = ?3 WHERE id = ?1",
            params![id, error, now],
        )?;
        Ok(())
    })
}

pub fn delete(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("smee_relays", "smee_relays::delete", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM smee_relays WHERE id = ?1", params![id])?;
        if rows == 0 {
            return Err(AppError::NotFound(format!("Smee relay {id} not found")));
        }
        Ok(())
    })
}

/// Get all active relay channel URLs for the relay engine.
pub fn list_active_urls(pool: &DbPool) -> Result<Vec<(String, String)>, AppError> {
    timed_query!("smee_relays", "smee_relays::list_active_urls", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, channel_url FROM smee_relays WHERE status = 'active'"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>("id")?, row.get::<_, String>("channel_url")?))
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    })
}
