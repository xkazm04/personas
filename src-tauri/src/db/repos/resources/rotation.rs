use std::str::FromStr;

use rusqlite::{params, Row};

use crate::db::models::{
    CreateRotationPolicyInput, CredentialRotationEntry, CredentialRotationPolicy,
    UpdateRotationPolicyInput,
};
use crate::db::DbPool;
use crate::engine::lifecycle::RotationEntryStatus;
use crate::error::AppError;

// ============================================================================
// Row Mappers
// ============================================================================

fn row_to_policy(row: &Row) -> rusqlite::Result<CredentialRotationPolicy> {
    Ok(CredentialRotationPolicy {
        id: row.get("id")?,
        credential_id: row.get("credential_id")?,
        enabled: row.get::<_, i32>("enabled")? != 0,
        rotation_interval_days: row.get("rotation_interval_days")?,
        policy_type: row.get("policy_type")?,
        last_rotated_at: row.get("last_rotated_at")?,
        next_rotation_at: row.get("next_rotation_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_history(row: &Row) -> rusqlite::Result<CredentialRotationEntry> {
    let status_str: String = row.get("status")?;
    Ok(CredentialRotationEntry {
        id: row.get("id")?,
        credential_id: row.get("credential_id")?,
        rotation_type: row.get("rotation_type")?,
        status: RotationEntryStatus::from_str(&status_str)
            .unwrap_or(RotationEntryStatus::Failed),
        detail: row.get("detail")?,
        created_at: row.get("created_at")?,
    })
}

// ============================================================================
// Rotation Policy CRUD
// ============================================================================

pub fn get_policies_by_credential(
    pool: &DbPool,
    credential_id: &str,
) -> Result<Vec<CredentialRotationPolicy>, AppError> {
    timed_query!("credential_rotation", "credential_rotation::get_policies_by_credential", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM credential_rotation_policies WHERE credential_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![credential_id], row_to_policy)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)

    })
}

pub fn get_policy_by_id(
    pool: &DbPool,
    id: &str,
) -> Result<CredentialRotationPolicy, AppError> {
    timed_query!("credential_rotation", "credential_rotation::get_policy_by_id", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM credential_rotation_policies WHERE id = ?1",
            params![id],
            row_to_policy,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("RotationPolicy {id}"))
            }
            other => AppError::Database(other),
        })

    })
}

pub fn get_due_policies(pool: &DbPool, now: &str) -> Result<Vec<CredentialRotationPolicy>, AppError> {
    timed_query!("credential_rotation", "credential_rotation::get_due_policies", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM credential_rotation_policies
             WHERE enabled = 1
               AND next_rotation_at IS NOT NULL
               AND next_rotation_at <= ?1
             ORDER BY next_rotation_at ASC",
        )?;
        let rows = stmt.query_map(params![now], row_to_policy)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)

    })
}

pub fn create_policy(
    pool: &DbPool,
    input: CreateRotationPolicyInput,
) -> Result<CredentialRotationPolicy, AppError> {
    timed_query!("credential_rotation", "credential_rotation::create_policy", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let interval = input.rotation_interval_days.unwrap_or(90);
        let policy_type = input.policy_type.as_deref().unwrap_or("scheduled");
        let enabled = input.enabled.unwrap_or(true);

        // Enforce single-active-policy invariant: disable any existing enabled
        // policies for this credential before creating an enabled one.
        if enabled {
            disable_policies_for_credential(pool, &input.credential_id)?;
        }

        let enabled_i32 = enabled as i32;

        // Compute next_rotation_at
        let next = chrono::Utc::now()
            + chrono::Duration::days(interval as i64);
        let next_str = next.to_rfc3339();

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO credential_rotation_policies
             (id, credential_id, enabled, rotation_interval_days, policy_type, next_rotation_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![id, input.credential_id, enabled_i32, interval, policy_type, next_str, now],
        )?;

        get_policy_by_id(pool, &id)

    })
}

pub fn update_policy(
    pool: &DbPool,
    id: &str,
    input: UpdateRotationPolicyInput,
) -> Result<CredentialRotationPolicy, AppError> {
    timed_query!("credential_rotation", "credential_rotation::update_policy", {
        let existing = get_policy_by_id(pool, id)?;
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let enabled_bool = input.enabled.unwrap_or(existing.enabled);

        // Enforce single-active-policy invariant: when enabling a policy,
        // disable all other enabled policies for the same credential.
        if enabled_bool && !existing.enabled {
            disable_policies_for_credential(pool, &existing.credential_id)?;
        }

        let enabled = enabled_bool as i32;
        let interval = input
            .rotation_interval_days
            .unwrap_or(existing.rotation_interval_days);

        // Recompute next_rotation_at from last_rotated_at or now
        let base = existing
            .last_rotated_at
            .as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .unwrap_or_else(chrono::Utc::now);
        let next = base + chrono::Duration::days(interval as i64);
        let next_str = next.to_rfc3339();

        conn.execute(
            "UPDATE credential_rotation_policies
             SET enabled = ?1, rotation_interval_days = ?2, next_rotation_at = ?3, updated_at = ?4
             WHERE id = ?5",
            params![enabled, interval, next_str, now, id],
        )?;

        get_policy_by_id(pool, id)

    })
}

/// Disable all enabled rotation policies for a credential.
/// Used to enforce the single-active-policy invariant before enabling a new one.
pub fn disable_policies_for_credential(pool: &DbPool, credential_id: &str) -> Result<u64, AppError> {
    timed_query!("credential_rotation", "credential_rotation::disable_policies_for_credential", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        let rows = conn.execute(
            "UPDATE credential_rotation_policies
             SET enabled = 0, updated_at = ?1
             WHERE credential_id = ?2 AND enabled = 1",
            params![now, credential_id],
        )?;
        Ok(rows as u64)
    })
}

pub fn delete_policy(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("credential_rotation", "credential_rotation::delete_policy", {
        let conn = pool.get()?;
        let rows = conn.execute(
            "DELETE FROM credential_rotation_policies WHERE id = ?1",
            params![id],
        )?;
        Ok(rows > 0)

    })
}

pub fn mark_rotated(pool: &DbPool, policy_id: &str) -> Result<(), AppError> {
    timed_query!("credential_rotation", "credential_rotation::mark_rotated", {
        let policy = get_policy_by_id(pool, policy_id)?;
        let now = chrono::Utc::now();
        let now_str = now.to_rfc3339();
        let next = now + chrono::Duration::days(policy.rotation_interval_days as i64);
        let next_str = next.to_rfc3339();

        let conn = pool.get()?;
        conn.execute(
            "UPDATE credential_rotation_policies
             SET last_rotated_at = ?1, next_rotation_at = ?2, updated_at = ?1
             WHERE id = ?3",
            params![now_str, next_str, policy_id],
        )?;
        Ok(())

    })
}

/// Count consecutive recent rotation failures for a credential (from most recent backwards).
pub fn get_consecutive_rotation_failures(pool: &DbPool, credential_id: &str) -> Result<u32, AppError> {
    timed_query!("credential_rotation", "credential_rotation::get_consecutive_rotation_failures", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT status FROM credential_rotation_history
             WHERE credential_id = ?1 AND rotation_type != 'anomaly'
             ORDER BY created_at DESC
             LIMIT 20",
        )?;
        let statuses: Vec<String> = stmt
            .query_map(params![credential_id], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();

        let count = statuses
            .iter()
            .take_while(|s| s.as_str() == "failed")
            .count();
        Ok(count as u32)

    })
}

/// Schedule a short retry for a failed rotation using exponential backoff.
/// Backoff: 1h, 4h, 12h (capped) based on consecutive failures.
pub fn schedule_failed_retry(pool: &DbPool, policy_id: &str, consecutive_failures: u32) -> Result<(), AppError> {
    timed_query!("credential_rotation", "credential_rotation::schedule_failed_retry", {
        let retry_hours: i64 = match consecutive_failures {
            0 | 1 => 1,
            2 => 4,
            _ => 12,
        };
        let now = chrono::Utc::now();
        let next = now + chrono::Duration::hours(retry_hours);
        let next_str = next.to_rfc3339();
        let now_str = now.to_rfc3339();

        let conn = pool.get()?;
        conn.execute(
            "UPDATE credential_rotation_policies
             SET next_rotation_at = ?1, updated_at = ?2
             WHERE id = ?3",
            params![next_str, now_str, policy_id],
        )?;
        Ok(())

    })
}

/// Disable a rotation policy (e.g., after too many consecutive failures).
pub fn disable_policy(pool: &DbPool, policy_id: &str) -> Result<(), AppError> {
    timed_query!("credential_rotation", "credential_rotation::disable_policy", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE credential_rotation_policies
             SET enabled = 0, updated_at = ?1
             WHERE id = ?2",
            params![now, policy_id],
        )?;
        Ok(())

    })
}

// ============================================================================
// Rotation History
// ============================================================================

pub fn get_history(
    pool: &DbPool,
    credential_id: &str,
    limit: Option<i64>,
) -> Result<Vec<CredentialRotationEntry>, AppError> {
    timed_query!("credential_rotation", "credential_rotation::get_history", {
        let lim = limit.unwrap_or(50);
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM credential_rotation_history
             WHERE credential_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![credential_id, lim], row_to_history)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)

    })
}

pub fn record_rotation(
    pool: &DbPool,
    credential_id: &str,
    rotation_type: &str,
    status: RotationEntryStatus,
    detail: Option<&str>,
) -> Result<CredentialRotationEntry, AppError> {
    timed_query!("credential_rotation", "credential_rotation::record_rotation", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO credential_rotation_history
             (id, credential_id, rotation_type, status, detail, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, credential_id, rotation_type, status.as_str(), detail, now],
        )?;

        conn.query_row(
            "SELECT * FROM credential_rotation_history WHERE id = ?1",
            params![id],
            row_to_history,
        )
        .map_err(AppError::Database)

    })
}
