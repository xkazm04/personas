use rusqlite::{params, Row};

use crate::db::models::{CreatePersonaInput, Persona, PersonaHealth, PersonaSummary, UpdatePersonaInput};
use crate::db::DbPool;
use crate::engine::crypto;
use crate::error::AppError;

// ── Model profile auth_token encryption helpers ─────────────────────────────

/// Encrypt the `auth_token` field inside a model_profile JSON string before DB storage.
/// Replaces `auth_token` with `auth_token_enc` (ciphertext) and `auth_token_iv` (nonce).
/// Returns the modified JSON string. No-ops if auth_token is absent or empty.
fn encrypt_model_profile(json: &str) -> Result<String, AppError> {
    let mut val: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| AppError::Validation(format!("Invalid model_profile JSON: {}", e)))?;

    let obj = match val.as_object_mut() {
        Some(o) => o,
        None => return Ok(json.to_string()),
    };

    let token = obj
        .get("auth_token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if token.is_empty() {
        return Ok(json.to_string());
    }

    let (ciphertext, nonce) = crypto::encrypt_for_db(&token)?;
    obj.remove("auth_token");
    obj.insert("auth_token_enc".into(), serde_json::Value::String(ciphertext));
    obj.insert("auth_token_iv".into(), serde_json::Value::String(nonce));

    serde_json::to_string(&val)
        .map_err(|e| AppError::Internal(format!("Failed to serialize model_profile: {}", e)))
}

/// Decrypt the `auth_token_enc` field inside a model_profile JSON string back to `auth_token`.
/// Used when returning a single persona for editing or engine execution.
fn decrypt_model_profile(json: &str) -> String {
    let mut val: serde_json::Value = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return json.to_string(),
    };

    let obj = match val.as_object_mut() {
        Some(o) => o,
        None => return json.to_string(),
    };

    let enc = obj.get("auth_token_enc").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let iv = obj.get("auth_token_iv").and_then(|v| v.as_str()).unwrap_or("").to_string();

    if enc.is_empty() || iv.is_empty() {
        return json.to_string();
    }

    match crypto::decrypt_from_db(&enc, &iv) {
        Ok(plaintext) => {
            obj.remove("auth_token_enc");
            obj.remove("auth_token_iv");
            obj.insert("auth_token".into(), serde_json::Value::String(plaintext));
            serde_json::to_string(&val).unwrap_or_else(|_| json.to_string())
        }
        Err(e) => {
            tracing::warn!("Failed to decrypt model_profile auth_token: {}", e);
            json.to_string()
        }
    }
}

/// Redact all auth token fields from a model_profile JSON string.
/// Used when returning persona lists to avoid leaking tokens to the full store.
fn redact_model_profile(json: &str) -> String {
    let mut val: serde_json::Value = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return json.to_string(),
    };

    let obj = match val.as_object_mut() {
        Some(o) => o,
        None => return json.to_string(),
    };

    obj.remove("auth_token");
    obj.remove("auth_token_enc");
    obj.remove("auth_token_iv");

    serde_json::to_string(&val).unwrap_or_else(|_| json.to_string())
}

/// Encrypt the model_profile on a CreatePersonaInput if present.
fn encrypt_input_profile(profile: &Option<String>) -> Result<Option<String>, AppError> {
    match profile {
        Some(ref json) if !json.trim().is_empty() => Ok(Some(encrypt_model_profile(json)?)),
        other => Ok(other.clone()),
    }
}

/// Encrypt the model_profile on an UpdatePersonaInput if present.
fn encrypt_update_profile(profile: &Option<Option<String>>) -> Result<Option<Option<String>>, AppError> {
    match profile {
        Some(Some(ref json)) if !json.trim().is_empty() => Ok(Some(Some(encrypt_model_profile(json)?))),
        other => Ok(other.clone()),
    }
}

// ── Shared validation helpers ────────────────────────────────────────────────

fn validate_name(name: &str) -> Result<(), AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation("Name cannot be empty".into()));
    }
    Ok(())
}

fn validate_system_prompt(prompt: &str) -> Result<(), AppError> {
    if prompt.trim().is_empty() {
        return Err(AppError::Validation("System prompt cannot be empty".into()));
    }
    Ok(())
}

fn validate_max_concurrent(v: i32) -> Result<(), AppError> {
    if v < 1 {
        return Err(AppError::Validation("max_concurrent must be >= 1".into()));
    }
    Ok(())
}

fn validate_timeout_ms(v: i32) -> Result<(), AppError> {
    if v < 1000 {
        return Err(AppError::Validation("timeout_ms must be >= 1000".into()));
    }
    Ok(())
}

fn validate_max_budget_usd(v: f64) -> Result<(), AppError> {
    if v.is_nan() || v.is_infinite() {
        return Err(AppError::Validation("max_budget_usd must be a finite number".into()));
    }
    if v < 0.0 {
        return Err(AppError::Validation("max_budget_usd must be >= 0".into()));
    }
    Ok(())
}

fn validate_max_turns(v: i32) -> Result<(), AppError> {
    if v < 1 {
        return Err(AppError::Validation("max_turns must be >= 1".into()));
    }
    Ok(())
}

fn validate_notification_channels(channels_json: &str) -> Result<(), AppError> {
    if let Ok(channels) = serde_json::from_str::<Vec<serde_json::Value>>(channels_json) {
        for ch in &channels {
            let enabled = ch.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
            if !enabled {
                continue;
            }
            let ch_type = ch.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let config = ch.get("config");
            let get_field = |key: &str| -> bool {
                config
                    .and_then(|c| c.get(key))
                    .and_then(|v| v.as_str())
                    .map(|s| !s.trim().is_empty())
                    .unwrap_or(false)
            };
            match ch_type {
                "slack" if !get_field("channel") => {
                    return Err(AppError::Validation("Slack channel name is required".into()));
                }
                "telegram" if !get_field("chat_id") => {
                    return Err(AppError::Validation("Telegram chat ID is required".into()));
                }
                "email" if !get_field("to") => {
                    return Err(AppError::Validation("Email 'to' address is required".into()));
                }
                _ => {}
            }
        }
    }
    Ok(())
}

/// How to handle the model_profile auth_token when reading from DB.
enum ProfileMode {
    /// Decrypt the encrypted token back to plaintext (for detail/engine views).
    Decrypt,
    /// Remove all token fields (for list/sidebar views).
    Redact,
}

fn row_to_persona_with_mode(row: &Row, mode: ProfileMode) -> rusqlite::Result<Persona> {
    let raw_profile: Option<String> = row.get("model_profile")?;
    let model_profile = raw_profile.map(|json| match mode {
        ProfileMode::Decrypt => decrypt_model_profile(&json),
        ProfileMode::Redact => redact_model_profile(&json),
    });
    Ok(Persona {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        system_prompt: row.get("system_prompt")?,
        structured_prompt: row.get("structured_prompt")?,
        icon: row.get("icon")?,
        color: row.get("color")?,
        enabled: row.get::<_, i32>("enabled")? != 0,
        max_concurrent: row.get("max_concurrent")?,
        timeout_ms: row.get("timeout_ms")?,
        notification_channels: row.get("notification_channels")?,
        last_design_result: row.get("last_design_result")?,
        model_profile,
        max_budget_usd: row.get("max_budget_usd")?,
        max_turns: row.get("max_turns")?,
        design_context: row.get("design_context")?,
        group_id: row.get("group_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_persona(row: &Row) -> rusqlite::Result<Persona> {
    row_to_persona_with_mode(row, ProfileMode::Decrypt)
}

fn row_to_persona_redacted(row: &Row) -> rusqlite::Result<Persona> {
    row_to_persona_with_mode(row, ProfileMode::Redact)
}

pub fn get_all(pool: &DbPool) -> Result<Vec<Persona>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare("SELECT * FROM personas ORDER BY created_at DESC")?;
    let rows = stmt.query_map([], row_to_persona_redacted)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<Persona, AppError> {
    let conn = pool.get()?;
    conn.query_row("SELECT * FROM personas WHERE id = ?1", params![id], row_to_persona)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Persona {id}")),
            other => AppError::Database(other),
        })
}

pub fn get_enabled(pool: &DbPool) -> Result<Vec<Persona>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare("SELECT * FROM personas WHERE enabled = 1 ORDER BY name")?;
    let rows = stmt.query_map([], row_to_persona)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn create(pool: &DbPool, input: CreatePersonaInput) -> Result<Persona, AppError> {
    validate_name(&input.name)?;
    validate_system_prompt(&input.system_prompt)?;
    if let Some(v) = input.max_concurrent { validate_max_concurrent(v)?; }
    if let Some(v) = input.timeout_ms { validate_timeout_ms(v)?; }
    if let Some(v) = input.max_budget_usd { validate_max_budget_usd(v)?; }
    if let Some(v) = input.max_turns { validate_max_turns(v)?; }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let project_id = input.project_id.unwrap_or_else(|| "default".into());
    let enabled = input.enabled.unwrap_or(true) as i32;
    let max_concurrent = input.max_concurrent.unwrap_or(1);
    let timeout_ms = input.timeout_ms.unwrap_or(300_000);

    if let Some(ref channels_json) = input.notification_channels {
        validate_notification_channels(channels_json)?;
    }

    let encrypted_profile = encrypt_input_profile(&input.model_profile)?;

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO personas
         (id, project_id, name, description, system_prompt, structured_prompt,
          icon, color, enabled, max_concurrent, timeout_ms,
          model_profile, max_budget_usd, max_turns, design_context, group_id,
          notification_channels, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?18)",
        params![
            id, project_id, input.name, input.description, input.system_prompt,
            input.structured_prompt, input.icon, input.color, enabled,
            max_concurrent, timeout_ms, encrypted_profile,
            input.max_budget_usd, input.max_turns, input.design_context,
            input.group_id, input.notification_channels, now,
        ],
    )?;

    get_by_id(pool, &id)
}

pub fn update(pool: &DbPool, id: &str, input: UpdatePersonaInput) -> Result<Persona, AppError> {
    // Verify exists
    let existing = get_by_id(pool, id)?;

    // Auto-version if structured_prompt is changing
    if let Some(ref new_sp) = input.structured_prompt {
        let changed = match (&existing.structured_prompt, new_sp.as_deref()) {
            (None, None) => false,
            (Some(old), Some(new)) => old != new,
            _ => true,
        };
        if changed {
            let _ = crate::db::repos::execution::metrics::create_prompt_version_if_changed(
                pool,
                id,
                new_sp.clone(),
                input.system_prompt.clone(),
            );
        }
    }

    // Validate fields when provided
    if let Some(ref name) = input.name { validate_name(name)?; }
    if let Some(ref prompt) = input.system_prompt { validate_system_prompt(prompt)?; }
    if let Some(v) = input.max_concurrent { validate_max_concurrent(v)?; }
    if let Some(v) = input.timeout_ms { validate_timeout_ms(v)?; }
    if let Some(Some(v)) = input.max_budget_usd { validate_max_budget_usd(v)?; }
    if let Some(Some(v)) = input.max_turns { validate_max_turns(v)?; }
    if let Some(ref channels_json) = input.notification_channels {
        validate_notification_channels(channels_json)?;
    }

    // Encrypt auth_token inside model_profile before storing
    let encrypted_profile = encrypt_update_profile(&input.model_profile)?;

    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    // Build dynamic SET clause
    let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
    let mut param_idx = 2u32;

    push_field!(input.name, "name", sets, param_idx);
    push_field!(input.description, "description", sets, param_idx);
    push_field!(input.system_prompt, "system_prompt", sets, param_idx);
    push_field!(input.structured_prompt, "structured_prompt", sets, param_idx);
    push_field!(input.icon, "icon", sets, param_idx);
    push_field!(input.color, "color", sets, param_idx);
    push_field!(input.enabled, "enabled", sets, param_idx);
    push_field!(input.max_concurrent, "max_concurrent", sets, param_idx);
    push_field!(input.timeout_ms, "timeout_ms", sets, param_idx);
    push_field!(input.notification_channels, "notification_channels", sets, param_idx);
    push_field!(input.last_design_result, "last_design_result", sets, param_idx);
    push_field!(encrypted_profile, "model_profile", sets, param_idx);
    push_field!(input.max_budget_usd, "max_budget_usd", sets, param_idx);
    push_field!(input.max_turns, "max_turns", sets, param_idx);
    push_field!(input.design_context, "design_context", sets, param_idx);
    push_field!(input.group_id, "group_id", sets, param_idx);

    let sql = format!(
        "UPDATE personas SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    // Use a boxed params approach to handle dynamic binding
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(ref v) = input.name { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.description { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.system_prompt { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.structured_prompt { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.icon { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.color { param_values.push(Box::new(v.clone())); }
    if let Some(v) = input.enabled { param_values.push(Box::new(v as i32)); }
    if let Some(v) = input.max_concurrent { param_values.push(Box::new(v)); }
    if let Some(v) = input.timeout_ms { param_values.push(Box::new(v)); }
    if let Some(ref v) = input.notification_channels { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.last_design_result { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = encrypted_profile { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.max_budget_usd { param_values.push(Box::new(*v)); }
    if let Some(ref v) = input.max_turns { param_values.push(Box::new(*v)); }
    if let Some(ref v) = input.design_context { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.group_id { param_values.push(Box::new(v.clone())); }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_by_id(pool, id)
}

/// Batch-fetch sidebar summary data (enabled trigger count + last execution time + health)
/// for all personas in a single query, eliminating the N+1 IPC pattern.
pub fn get_summaries(pool: &DbPool) -> Result<Vec<PersonaSummary>, AppError> {
    let conn = pool.get()?;

    // Step 1: Basic summary (trigger counts + last run)
    let mut summary_stmt = conn.prepare(
        "SELECT
             p.id AS persona_id,
             COALESCE(t.cnt, 0) AS enabled_trigger_count,
             e.last_run_at
         FROM personas p
         LEFT JOIN (
             SELECT persona_id, COUNT(*) AS cnt
             FROM persona_triggers
             WHERE enabled = 1
             GROUP BY persona_id
         ) t ON t.persona_id = p.id
         LEFT JOIN (
             SELECT persona_id, MAX(created_at) AS last_run_at
             FROM persona_executions
             GROUP BY persona_id
         ) e ON e.persona_id = p.id",
    )?;
    let base_rows: Vec<(String, i64, Option<String>)> = summary_stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>("persona_id")?,
                row.get::<_, i64>("enabled_trigger_count")?,
                row.get::<_, Option<String>>("last_run_at")?,
            ))
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Step 2: Compute health for each persona from recent executions
    let today_start = chrono::Utc::now().date_naive().and_hms_opt(0, 0, 0).unwrap().to_string();
    let week_ago = (chrono::Utc::now() - chrono::Duration::days(7)).to_rfc3339();

    let mut summaries = Vec::with_capacity(base_rows.len());
    for (persona_id, enabled_trigger_count, last_run_at) in base_rows {
        let health = compute_persona_health(&conn, &persona_id, &today_start, &week_ago)?;
        summaries.push(PersonaSummary {
            persona_id,
            enabled_trigger_count,
            last_run_at,
            health,
        });
    }

    Ok(summaries)
}

/// Compute health data for a single persona from its recent executions.
fn compute_persona_health(
    conn: &rusqlite::Connection,
    persona_id: &str,
    today_start: &str,
    week_ago: &str,
) -> Result<PersonaHealth, AppError> {
    // Recent statuses (last 10, newest first)
    let mut status_stmt = conn.prepare_cached(
        "SELECT status FROM persona_executions
         WHERE persona_id = ?1
         ORDER BY created_at DESC
         LIMIT 10",
    )?;
    let recent_statuses: Vec<String> = status_stmt
        .query_map(params![persona_id], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    let total_recent = recent_statuses.len() as i64;

    // Success rate
    let success_count = recent_statuses
        .iter()
        .filter(|s| s.as_str() == "completed")
        .count() as f64;
    let fail_count = recent_statuses
        .iter()
        .filter(|s| s.as_str() == "failed" || s.as_str() == "error")
        .count() as f64;
    let success_rate = if total_recent > 0 {
        success_count / total_recent as f64
    } else {
        0.0
    };

    // Health status derivation
    let status = if total_recent == 0 {
        "dormant"
    } else {
        let fail_ratio = fail_count / total_recent as f64;
        if fail_ratio == 0.0 {
            "healthy"
        } else if fail_ratio >= 0.6 {
            "failing"
        } else {
            "degraded"
        }
    }
    .to_string();

    // Runs today
    let runs_today: i64 = conn.query_row(
        "SELECT COUNT(*) FROM persona_executions
         WHERE persona_id = ?1 AND created_at >= ?2",
        params![persona_id, today_start],
        |row| row.get(0),
    )?;

    // 7-day sparkline: count executions per day for the last 7 days
    let mut sparkline_stmt = conn.prepare_cached(
        "SELECT DATE(created_at) AS day, COUNT(*) AS cnt
         FROM persona_executions
         WHERE persona_id = ?1 AND created_at >= ?2
         GROUP BY DATE(created_at)",
    )?;
    let day_counts: std::collections::HashMap<String, i64> = sparkline_stmt
        .query_map(params![persona_id, week_ago], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let today = chrono::Utc::now().date_naive();
    let sparkline: Vec<i64> = (0..7)
        .map(|days_ago| {
            let day = (today - chrono::Duration::days(6 - days_ago)).to_string();
            *day_counts.get(&day).unwrap_or(&0)
        })
        .collect();

    Ok(PersonaHealth {
        status,
        recent_statuses,
        success_rate,
        total_recent,
        runs_today,
        sparkline,
    })
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM personas WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    #[test]
    fn test_crud_persona() {
        let pool = init_test_db().unwrap();

        // Create
        let persona = create(
            &pool,
            CreatePersonaInput {
                name: "Test Agent".into(),
                system_prompt: "You are a test agent.".into(),
                project_id: None,
                description: Some("A test persona".into()),
                structured_prompt: None,
                icon: None,
                color: Some("#06b6d4".into()),
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                group_id: None,
                notification_channels: None,
            },
        )
        .unwrap();
        assert_eq!(persona.name, "Test Agent");
        assert!(persona.enabled);

        // Read
        let fetched = get_by_id(&pool, &persona.id).unwrap();
        assert_eq!(fetched.description, Some("A test persona".into()));

        // List
        let all = get_all(&pool).unwrap();
        assert_eq!(all.len(), 1);

        // Update
        let updated = update(
            &pool,
            &persona.id,
            UpdatePersonaInput {
                name: Some("Updated Agent".into()),
                description: None,
                system_prompt: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(false),
                max_concurrent: None,
                timeout_ms: None,
                notification_channels: None,
                last_design_result: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                group_id: None,
            },
        )
        .unwrap();
        assert_eq!(updated.name, "Updated Agent");
        assert!(!updated.enabled);

        // Enabled list should be empty now
        let enabled = get_enabled(&pool).unwrap();
        assert_eq!(enabled.len(), 0);

        // Delete
        let deleted = delete(&pool, &persona.id).unwrap();
        assert!(deleted);
        assert!(get_by_id(&pool, &persona.id).is_err());
    }

    #[test]
    fn test_validation() {
        let pool = init_test_db().unwrap();
        let result = create(
            &pool,
            CreatePersonaInput {
                name: "".into(),
                system_prompt: "test".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: None,
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                group_id: None,
                notification_channels: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_update_rejects_empty_name() {
        let pool = init_test_db().unwrap();
        let persona = create(
            &pool,
            CreatePersonaInput {
                name: "Valid Agent".into(),
                system_prompt: "You are valid.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: None,
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                group_id: None,
                notification_channels: None,
            },
        )
        .unwrap();

        // Empty name should fail
        let result = update(
            &pool,
            &persona.id,
            UpdatePersonaInput {
                name: Some("".into()),
                description: None, system_prompt: None, structured_prompt: None,
                icon: None, color: None, enabled: None, max_concurrent: None,
                timeout_ms: None, notification_channels: None, last_design_result: None,
                model_profile: None, max_budget_usd: None, max_turns: None,
                design_context: None, group_id: None,
            },
        );
        assert!(result.is_err());

        // Whitespace-only name should fail
        let result = update(
            &pool,
            &persona.id,
            UpdatePersonaInput {
                name: Some("   ".into()),
                description: None, system_prompt: None, structured_prompt: None,
                icon: None, color: None, enabled: None, max_concurrent: None,
                timeout_ms: None, notification_channels: None, last_design_result: None,
                model_profile: None, max_budget_usd: None, max_turns: None,
                design_context: None, group_id: None,
            },
        );
        assert!(result.is_err());

        // Name unchanged in DB
        let fetched = get_by_id(&pool, &persona.id).unwrap();
        assert_eq!(fetched.name, "Valid Agent");
    }

    #[test]
    fn test_update_rejects_empty_system_prompt() {
        let pool = init_test_db().unwrap();
        let persona = create(
            &pool,
            CreatePersonaInput {
                name: "Prompt Agent".into(),
                system_prompt: "Original prompt.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: None,
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                group_id: None,
                notification_channels: None,
            },
        )
        .unwrap();

        // Empty system_prompt should fail
        let result = update(
            &pool,
            &persona.id,
            UpdatePersonaInput {
                name: None, description: None,
                system_prompt: Some("".into()),
                structured_prompt: None,
                icon: None, color: None, enabled: None, max_concurrent: None,
                timeout_ms: None, notification_channels: None, last_design_result: None,
                model_profile: None, max_budget_usd: None, max_turns: None,
                design_context: None, group_id: None,
            },
        );
        assert!(result.is_err());

        // Whitespace-only system_prompt should fail
        let result = update(
            &pool,
            &persona.id,
            UpdatePersonaInput {
                name: None, description: None,
                system_prompt: Some("  \n  ".into()),
                structured_prompt: None,
                icon: None, color: None, enabled: None, max_concurrent: None,
                timeout_ms: None, notification_channels: None, last_design_result: None,
                model_profile: None, max_budget_usd: None, max_turns: None,
                design_context: None, group_id: None,
            },
        );
        assert!(result.is_err());

        // Prompt unchanged in DB
        let fetched = get_by_id(&pool, &persona.id).unwrap();
        assert_eq!(fetched.system_prompt, "Original prompt.");
    }

    #[test]
    fn test_create_validates_numeric_fields() {
        let pool = init_test_db().unwrap();

        let base = || CreatePersonaInput {
            name: "Agent".into(),
            system_prompt: "Prompt.".into(),
            project_id: None, description: None, structured_prompt: None,
            icon: None, color: None, enabled: None, max_concurrent: None,
            timeout_ms: None, model_profile: None, max_budget_usd: None,
            max_turns: None, design_context: None, group_id: None,
            notification_channels: None,
        };

        // max_concurrent < 1
        let mut input = base();
        input.max_concurrent = Some(0);
        assert!(create(&pool, input).is_err());

        // timeout_ms < 1000
        let mut input = base();
        input.timeout_ms = Some(999);
        assert!(create(&pool, input).is_err());

        // max_budget_usd < 0
        let mut input = base();
        input.max_budget_usd = Some(-0.01);
        assert!(create(&pool, input).is_err());

        // max_turns < 1
        let mut input = base();
        input.max_turns = Some(0);
        assert!(create(&pool, input).is_err());

        // Valid values should succeed
        let mut input = base();
        input.max_concurrent = Some(1);
        input.timeout_ms = Some(1000);
        input.max_budget_usd = Some(0.0);
        input.max_turns = Some(1);
        assert!(create(&pool, input).is_ok());
    }

    #[test]
    fn test_update_validates_numeric_fields() {
        let pool = init_test_db().unwrap();
        let persona = create(
            &pool,
            CreatePersonaInput {
                name: "Numeric Agent".into(),
                system_prompt: "Prompt.".into(),
                project_id: None, description: None, structured_prompt: None,
                icon: None, color: None, enabled: None, max_concurrent: None,
                timeout_ms: None, model_profile: None, max_budget_usd: None,
                max_turns: None, design_context: None, group_id: None,
                notification_channels: None,
            },
        )
        .unwrap();

        let base = || UpdatePersonaInput {
            name: None, description: None, system_prompt: None,
            structured_prompt: None, icon: None, color: None, enabled: None,
            max_concurrent: None, timeout_ms: None, notification_channels: None,
            last_design_result: None, model_profile: None, max_budget_usd: None,
            max_turns: None, design_context: None, group_id: None,
        };

        // max_concurrent < 1
        let mut input = base();
        input.max_concurrent = Some(0);
        assert!(update(&pool, &persona.id, input).is_err());

        // timeout_ms < 1000
        let mut input = base();
        input.timeout_ms = Some(500);
        assert!(update(&pool, &persona.id, input).is_err());

        // max_budget_usd negative
        let mut input = base();
        input.max_budget_usd = Some(Some(-1.0));
        assert!(update(&pool, &persona.id, input).is_err());

        // max_turns < 1
        let mut input = base();
        input.max_turns = Some(Some(0));
        assert!(update(&pool, &persona.id, input).is_err());

        // Clearing values (Some(None)) should be allowed
        let mut input = base();
        input.max_budget_usd = Some(None);
        input.max_turns = Some(None);
        assert!(update(&pool, &persona.id, input).is_ok());
    }
}
