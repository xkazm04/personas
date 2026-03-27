use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use rusqlite::{params, Row};
use tracing::instrument;

use crate::db::models::{CreatePersonaInput, Persona, PersonaHealth, PersonaSummary, UpdatePersonaInput};
use crate::db::repos::utils::collect_rows;
use crate::db::DbPool;
use crate::engine::crypto;
use crate::engine::crypto::CryptoError;
use crate::error::AppError;

/// Session-scoped counter of decryption failures. Helps detect systemic key
/// rotation issues before users report broken model configs.
static DECRYPTION_FAILURE_COUNT: AtomicU64 = AtomicU64::new(0);

// -- Model profile auth_token encryption helpers -----------------------------

/// Encrypt the `auth_token` field inside a model_profile JSON string before DB storage.
/// Replaces `auth_token` with `auth_token_enc` (ciphertext) and `auth_token_iv` (nonce).
/// Returns the modified JSON string. No-ops if auth_token is absent or empty.
fn encrypt_model_profile(json: &str) -> Result<String, AppError> {
    let mut val: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| AppError::Validation(format!("Invalid model_profile JSON: {e}")))?;

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
        .map_err(|e| AppError::Internal(format!("Failed to serialize model_profile: {e}")))
}

/// Categorize a CryptoError into a human-readable error category for logging.
fn classify_crypto_error(e: &CryptoError) -> &'static str {
    match e {
        CryptoError::KeyManagement(_) => "key-not-found",
        CryptoError::Decrypt(_) => "corrupt-data-or-algorithm-mismatch",
        CryptoError::Base64(_) => "corrupt-data",
        CryptoError::Encrypt(_) => "unexpected-encrypt-error",
    }
}

/// Return the current session-scoped decryption failure count.
pub fn decryption_failure_count() -> u64 {
    DECRYPTION_FAILURE_COUNT.load(Ordering::Relaxed)
}

/// Decrypt the `auth_token_enc` field inside a model_profile JSON string back to `auth_token`.
/// Used when returning a single persona for editing or engine execution.
/// `persona_id` is used for structured logging context on failure.
fn decrypt_model_profile(json: &str, persona_id: &str) -> String {
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
            let session_failures = DECRYPTION_FAILURE_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
            let error_category = classify_crypto_error(&e);
            tracing::warn!(
                persona_id = %persona_id,
                error_category = %error_category,
                session_failure_count = session_failures,
                "Failed to decrypt model_profile auth_token: {}",
                e
            );
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

// -- Shared validation helpers ------------------------------------------------

fn validate_name(name: &str) -> Result<(), AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation("Name cannot be empty".into()));
    }
    Ok(())
}

/// 50 KB limit -- generous for prompts, prevents economic abuse via oversized payloads.
const MAX_PROMPT_BYTES: usize = 50 * 1024;

fn validate_system_prompt(prompt: &str) -> Result<(), AppError> {
    if prompt.trim().is_empty() {
        return Err(AppError::Validation("System prompt cannot be empty".into()));
    }
    if prompt.len() > MAX_PROMPT_BYTES {
        return Err(AppError::Validation(format!(
            "System prompt exceeds maximum size of {} KB",
            MAX_PROMPT_BYTES / 1024
        )));
    }
    reject_dangerous_content(prompt, "System prompt")?;
    Ok(())
}

fn validate_structured_prompt(prompt: &str) -> Result<(), AppError> {
    if prompt.len() > MAX_PROMPT_BYTES {
        return Err(AppError::Validation(format!(
            "Structured prompt exceeds maximum size of {} KB",
            MAX_PROMPT_BYTES / 1024
        )));
    }
    reject_dangerous_content(prompt, "Structured prompt")?;
    // Must be valid JSON
    if serde_json::from_str::<serde_json::Value>(prompt).is_err() {
        return Err(AppError::Validation(
            "Structured prompt must be valid JSON".into(),
        ));
    }
    Ok(())
}

/// Reject null bytes and C0 control characters (except \t, \n, \r) that have
/// no legitimate purpose in prompts and could be used to smuggle payloads.
fn reject_dangerous_content(text: &str, field_name: &str) -> Result<(), AppError> {
    for ch in text.chars() {
        if ch == '\0' {
            return Err(AppError::Validation(format!(
                "{field_name} must not contain null bytes"
            )));
        }
        // Block C0 control chars U+0001..U+001F except tab, newline, carriage return
        if ch.is_control() && ch != '\t' && ch != '\n' && ch != '\r' {
            return Err(AppError::Validation(format!(
                "{field_name} contains invalid control characters"
            )));
        }
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
    let channels: Vec<serde_json::Value> = serde_json::from_str(channels_json)
        .map_err(|_| AppError::Validation("notification_channels must be a valid JSON array".into()))?;

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
    Ok(())
}

// -- Notification channel secret encryption helpers --------------------------

/// Config keys that contain secrets and must be encrypted at rest.
const SENSITIVE_CHANNEL_KEYS: &[&str] = &[
    "webhook_url",
    "bot_token",
    "sendgrid_api_key",
    "resend_api_key",
];

/// Encrypt sensitive config values inside notification_channels JSON before DB storage.
/// For each sensitive key, replaces `key` with `key_enc` (ciphertext) and `key_iv` (nonce).
pub(crate) fn encrypt_notification_channels(json: &str) -> Result<String, AppError> {
    let mut channels: Vec<serde_json::Value> = serde_json::from_str(json)
        .map_err(|e| AppError::Validation(format!("Invalid notification_channels JSON: {e}")))?;

    for ch in channels.iter_mut() {
        let config = match ch.get_mut("config").and_then(|c| c.as_object_mut()) {
            Some(c) => c,
            None => continue,
        };
        for &key in SENSITIVE_CHANNEL_KEYS {
            let value = match config.get(key).and_then(|v| v.as_str()) {
                Some(v) if !v.is_empty() => v.to_string(),
                _ => continue,
            };
            let (ciphertext, nonce) = crypto::encrypt_for_db(&value)?;
            config.remove(key);
            config.insert(format!("{key}_enc"), serde_json::Value::String(ciphertext));
            config.insert(format!("{key}_iv"), serde_json::Value::String(nonce));
        }
    }

    serde_json::to_string(&channels)
        .map_err(|e| AppError::Internal(format!("Failed to serialize notification_channels: {e}")))
}

/// Decrypt sensitive config values inside notification_channels JSON when reading from DB.
/// Reverses the encryption: replaces `key_enc`+`key_iv` back to plaintext `key`.
fn decrypt_notification_channels(json: &str, persona_id: &str) -> String {
    let mut channels: Vec<serde_json::Value> = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return json.to_string(),
    };

    for ch in channels.iter_mut() {
        let config = match ch.get_mut("config").and_then(|c| c.as_object_mut()) {
            Some(c) => c,
            None => continue,
        };
        for &key in SENSITIVE_CHANNEL_KEYS {
            let enc_key = format!("{key}_enc");
            let iv_key = format!("{key}_iv");
            let enc = match config.get(&enc_key).and_then(|v| v.as_str()) {
                Some(v) if !v.is_empty() => v.to_string(),
                _ => continue,
            };
            let iv = match config.get(&iv_key).and_then(|v| v.as_str()) {
                Some(v) if !v.is_empty() => v.to_string(),
                _ => continue,
            };
            match crypto::decrypt_from_db(&enc, &iv) {
                Ok(plaintext) => {
                    config.remove(&enc_key);
                    config.remove(&iv_key);
                    config.insert(key.to_string(), serde_json::Value::String(plaintext));
                }
                Err(e) => {
                    let session_failures = DECRYPTION_FAILURE_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
                    tracing::warn!(
                        persona_id = %persona_id,
                        config_key = %key,
                        session_failure_count = session_failures,
                        "Failed to decrypt notification channel secret: {}", e
                    );
                }
            }
        }
    }

    serde_json::to_string(&channels).unwrap_or_else(|_| json.to_string())
}

/// Redact all sensitive notification channel config values for list views.
fn redact_notification_channels(json: &str) -> String {
    let mut channels: Vec<serde_json::Value> = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return json.to_string(),
    };

    for ch in channels.iter_mut() {
        let config = match ch.get_mut("config").and_then(|c| c.as_object_mut()) {
            Some(c) => c,
            None => continue,
        };
        for &key in SENSITIVE_CHANNEL_KEYS {
            config.remove(key);
            config.remove(&format!("{key}_enc"));
            config.remove(&format!("{key}_iv"));
        }
    }

    serde_json::to_string(&channels).unwrap_or_else(|_| json.to_string())
}

/// How to handle the model_profile auth_token when reading from DB.
enum ProfileMode {
    /// Decrypt the encrypted token back to plaintext (for detail/engine views).
    Decrypt,
    /// Remove all token fields (for list/sidebar views).
    Redact,
}

fn row_to_persona_with_mode(row: &Row, mode: ProfileMode) -> rusqlite::Result<Persona> {
    let id: String = row.get("id")?;
    let raw_profile: Option<String> = row.get("model_profile")?;
    let model_profile = raw_profile.map(|json| match mode {
        ProfileMode::Decrypt => decrypt_model_profile(&json, &id),
        ProfileMode::Redact => redact_model_profile(&json),
    });
    let raw_channels: Option<String> = row.get("notification_channels")?;
    let notification_channels = raw_channels.map(|json| match mode {
        ProfileMode::Decrypt => decrypt_notification_channels(&json, &id),
        ProfileMode::Redact => redact_notification_channels(&json),
    });
    Ok(Persona {
        id,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        system_prompt: row.get("system_prompt")?,
        structured_prompt: row.get("structured_prompt")?,
        icon: row.get("icon")?,
        color: row.get("color")?,
        enabled: row.get::<_, i32>("enabled")? != 0,
        sensitive: row.get::<_, i32>("sensitive")? != 0,
        headless: row.get::<_, i32>("headless").unwrap_or(0) != 0,
        max_concurrent: row.get("max_concurrent")?,
        timeout_ms: row.get("timeout_ms")?,
        notification_channels,
        last_design_result: row.get("last_design_result")?,
        model_profile,
        max_budget_usd: row.get("max_budget_usd")?,
        max_turns: row.get("max_turns")?,
        design_context: row.get("design_context")?,
        group_id: row.get("group_id")?,
        source_review_id: row.get::<_, Option<String>>("source_review_id").unwrap_or(None),
        trust_level: row.get::<_, Option<String>>("trust_level")?.unwrap_or_else(|| "verified".to_string()),
        trust_origin: row.get::<_, Option<String>>("trust_origin")?.unwrap_or_else(|| "builtin".to_string()),
        trust_verified_at: row.get::<_, Option<String>>("trust_verified_at").unwrap_or(None),
        trust_score: row.get::<_, Option<f64>>("trust_score")?.unwrap_or(0.0),
        parameters: row.get::<_, Option<String>>("parameters").unwrap_or(None),
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

#[instrument(skip(pool))]
pub fn get_all(pool: &DbPool) -> Result<Vec<Persona>, AppError> {
    let start = Instant::now();
    let conn = pool.get()?;
    let mut stmt = conn.prepare("SELECT * FROM personas ORDER BY created_at DESC")?;
    let rows = stmt.query_map([], row_to_persona_redacted)?;
    let result = collect_rows(rows, "personas::get_all");
    let elapsed_ms = start.elapsed().as_millis() as u64;
    tracing::debug!(elapsed_ms, count = result.len(), "personas::get_all");
    if elapsed_ms > 100 {
        tracing::warn!(elapsed_ms, "personas::get_all exceeded 100ms threshold");
    }
    Ok(result)
}

#[instrument(skip(pool))]
pub fn get_by_id(pool: &DbPool, id: &str) -> Result<Persona, AppError> {
    let start = Instant::now();
    let conn = pool.get()?;
    let result = conn.query_row("SELECT * FROM personas WHERE id = ?1", params![id], row_to_persona)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Persona {id}")),
            other => AppError::Database(other),
        });
    let elapsed_ms = start.elapsed().as_millis() as u64;
    tracing::debug!(elapsed_ms, persona_id = %id, "personas::get_by_id");
    if elapsed_ms > 100 {
        tracing::warn!(elapsed_ms, persona_id = %id, "personas::get_by_id exceeded 100ms threshold");
    }
    result
}

/// Bulk-fetch personas by a list of IDs in a single query.
pub fn get_by_ids(pool: &DbPool, ids: &[String]) -> Result<Vec<Persona>, AppError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let conn = pool.get()?;
    let placeholders: Vec<String> = ids
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect();
    let sql = format!(
        "SELECT * FROM personas WHERE id IN ({})",
        placeholders.join(", ")
    );
    let params_ref: Vec<&dyn rusqlite::types::ToSql> = ids
        .iter()
        .map(|s| s as &dyn rusqlite::types::ToSql)
        .collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_ref.as_slice(), row_to_persona)?;
    Ok(collect_rows(rows, "personas::get_by_ids"))
}

#[instrument(skip(pool))]
pub fn get_enabled(pool: &DbPool) -> Result<Vec<Persona>, AppError> {
    let start = Instant::now();
    let conn = pool.get()?;
    let mut stmt = conn.prepare("SELECT * FROM personas WHERE enabled = 1 ORDER BY name")?;
    let rows = stmt.query_map([], row_to_persona)?;
    let result = collect_rows(rows, "personas::get_enabled");
    let elapsed_ms = start.elapsed().as_millis() as u64;
    tracing::debug!(elapsed_ms, count = result.len(), "personas::get_enabled");
    if elapsed_ms > 100 {
        tracing::warn!(elapsed_ms, "personas::get_enabled exceeded 100ms threshold");
    }
    Ok(result)
}

#[instrument(skip(pool, input), fields(persona_name = %input.name))]
pub fn create(pool: &DbPool, input: CreatePersonaInput) -> Result<Persona, AppError> {
    validate_name(&input.name)?;
    validate_system_prompt(&input.system_prompt)?;
    if let Some(ref sp) = input.structured_prompt { validate_structured_prompt(sp)?; }
    if let Some(v) = input.max_concurrent { validate_max_concurrent(v)?; }
    if let Some(v) = input.timeout_ms { validate_timeout_ms(v)?; }
    if let Some(v) = input.max_budget_usd { validate_max_budget_usd(v)?; }
    if let Some(v) = input.max_turns { validate_max_turns(v)?; }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let project_id = input.project_id.unwrap_or_else(|| "default".into());
    let enabled = input.enabled.unwrap_or(true) as i32;
    let sensitive = 0i32;
    let max_concurrent = input.max_concurrent.unwrap_or(4);
    let timeout_ms = input.timeout_ms.unwrap_or(600_000);

    if let Some(ref channels_json) = input.notification_channels {
        validate_notification_channels(channels_json)?;
    }

    let encrypted_profile = encrypt_input_profile(&input.model_profile)?;
    let encrypted_channels = match &input.notification_channels {
        Some(json) if !json.trim().is_empty() => Some(encrypt_notification_channels(json)?),
        other => other.clone(),
    };

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO personas
         (id, project_id, name, description, system_prompt, structured_prompt,
          icon, color, enabled, sensitive, max_concurrent, timeout_ms,
          model_profile, max_budget_usd, max_turns, design_context, group_id,
          notification_channels, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?19)",
        params![
            id, project_id, input.name, input.description, input.system_prompt,
            input.structured_prompt, input.icon, input.color, enabled, sensitive,
            max_concurrent, timeout_ms, encrypted_profile,
            input.max_budget_usd, input.max_turns, input.design_context,
            input.group_id, encrypted_channels, now,
        ],
    )?;

    get_by_id(pool, &id)
}

#[instrument(skip(pool, input))]
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
    if let Some(Some(ref sp)) = input.structured_prompt { validate_structured_prompt(sp)?; }
    if let Some(v) = input.max_concurrent { validate_max_concurrent(v)?; }
    if let Some(v) = input.timeout_ms { validate_timeout_ms(v)?; }
    if let Some(Some(v)) = input.max_budget_usd { validate_max_budget_usd(v)?; }
    if let Some(Some(v)) = input.max_turns { validate_max_turns(v)?; }
    if let Some(ref channels_json) = input.notification_channels {
        validate_notification_channels(channels_json)?;
    }

    // Encrypt auth_token inside model_profile before storing
    let encrypted_profile = encrypt_update_profile(&input.model_profile)?;

    // Encrypt sensitive notification channel secrets before storing
    let encrypted_channels = match &input.notification_channels {
        Some(json) if !json.trim().is_empty() => Some(encrypt_notification_channels(json)?),
        other => other.clone(),
    };

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
    push_field!(input.sensitive, "sensitive", sets, param_idx);
    push_field!(input.headless, "headless", sets, param_idx);
    push_field!(input.max_concurrent, "max_concurrent", sets, param_idx);
    push_field!(input.timeout_ms, "timeout_ms", sets, param_idx);
    push_field!(encrypted_channels, "notification_channels", sets, param_idx);
    push_field!(input.last_design_result, "last_design_result", sets, param_idx);
    push_field!(encrypted_profile, "model_profile", sets, param_idx);
    push_field!(input.max_budget_usd, "max_budget_usd", sets, param_idx);
    push_field!(input.max_turns, "max_turns", sets, param_idx);
    push_field!(input.design_context, "design_context", sets, param_idx);
    push_field!(input.group_id, "group_id", sets, param_idx);
    push_field!(input.parameters, "parameters", sets, param_idx);

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
    if let Some(v) = input.sensitive { param_values.push(Box::new(v as i32)); }
    if let Some(v) = input.headless { param_values.push(Box::new(v as i32)); }
    if let Some(v) = input.max_concurrent { param_values.push(Box::new(v)); }
    if let Some(v) = input.timeout_ms { param_values.push(Box::new(v)); }
    if let Some(ref v) = encrypted_channels { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.last_design_result { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = encrypted_profile { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.max_budget_usd { param_values.push(Box::new(*v)); }
    if let Some(ref v) = input.max_turns { param_values.push(Box::new(*v)); }
    if let Some(ref v) = input.design_context { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.group_id { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.parameters { param_values.push(Box::new(v.clone())); }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_by_id(pool, id)
}

/// Lightweight name-only update used by build sessions to rename a persona from the agent_ir.
pub fn update_name(pool: &DbPool, id: &str, name: &str) -> Result<(), AppError> {
    validate_name(name)?;
    let conn = pool.get()?;
    conn.execute(
        "UPDATE personas SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![name, id],
    )?;
    Ok(())
}

/// Batch-fetch sidebar summary data (enabled trigger count + last execution time + health)
/// for all personas in a single CTE query, eliminating the N+1 per-persona health pattern.
/// Previously ran 3 queries per persona (recent statuses, runs today, 7-day sparkline);
/// now uses 1 base query + 3 batched queries across all personas.
#[instrument(skip(pool))]
pub fn get_summaries(pool: &DbPool) -> Result<Vec<PersonaSummary>, AppError> {
    let start = Instant::now();
    let conn = pool.get()?;

    let today_start = chrono::Utc::now().date_naive().and_hms_opt(0, 0, 0).unwrap().to_string();
    let week_ago = (chrono::Utc::now() - chrono::Duration::days(7)).to_rfc3339();
    let today = chrono::Utc::now().date_naive();

    // Query 1: Basic summary (trigger counts + last run) — 1 query for all personas
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
    let base_rows = summary_stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>("persona_id")?,
            row.get::<_, i64>("enabled_trigger_count")?,
            row.get::<_, Option<String>>("last_run_at")?,
        ))
    })?;
    let base_rows: Vec<(String, i64, Option<String>)> =
        collect_rows(base_rows, "personas::get_summaries/base_rows");

    // Query 2: Batched recent statuses — last 10 per persona using ROW_NUMBER window
    let mut recent_stmt = conn.prepare(
        "SELECT persona_id, status FROM (
             SELECT persona_id, status,
                    ROW_NUMBER() OVER (PARTITION BY persona_id ORDER BY created_at DESC) AS rn
             FROM persona_executions
         ) WHERE rn <= 10
         ORDER BY persona_id, rn",
    )?;
    let recent_rows = recent_stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut recent_map: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for row in collect_rows(recent_rows, "personas::get_summaries/recent_statuses") {
        recent_map.entry(row.0).or_default().push(row.1);
    }

    // Query 3: Batched runs-today count — 1 query for all personas
    let mut today_stmt = conn.prepare(
        "SELECT persona_id, COUNT(*) AS cnt
         FROM persona_executions
         WHERE created_at >= ?1
         GROUP BY persona_id",
    )?;
    let today_rows = today_stmt.query_map(params![today_start], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    let today_map: std::collections::HashMap<String, i64> =
        collect_rows(today_rows, "personas::get_summaries/runs_today")
            .into_iter()
            .collect();

    // Query 4: Batched 7-day sparkline — 1 query for all personas
    let mut sparkline_stmt = conn.prepare(
        "SELECT persona_id, DATE(created_at) AS day, COUNT(*) AS cnt
         FROM persona_executions
         WHERE created_at >= ?1
         GROUP BY persona_id, DATE(created_at)",
    )?;
    let spark_rows = sparkline_stmt.query_map(params![week_ago], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;
    let mut spark_map: std::collections::HashMap<String, std::collections::HashMap<String, i64>> =
        std::collections::HashMap::new();
    for (pid, day, cnt) in collect_rows(spark_rows, "personas::get_summaries/sparkline") {
        spark_map.entry(pid).or_default().insert(day, cnt);
    }

    // Assemble results from the batched maps
    let mut summaries = Vec::with_capacity(base_rows.len());
    for (persona_id, enabled_trigger_count, last_run_at) in base_rows {
        let recent_statuses = recent_map.remove(&persona_id).unwrap_or_default();
        let total_recent = recent_statuses.len() as i64;

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

        let runs_today = today_map.get(&persona_id).copied().unwrap_or(0);

        let day_counts = spark_map.remove(&persona_id).unwrap_or_default();
        let sparkline: Vec<i64> = (0..7)
            .map(|days_ago| {
                let day = (today - chrono::Duration::days(6 - days_ago)).to_string();
                *day_counts.get(&day).unwrap_or(&0)
            })
            .collect();

        summaries.push(PersonaSummary {
            persona_id,
            enabled_trigger_count,
            last_run_at,
            health: PersonaHealth {
                status,
                recent_statuses,
                success_rate,
                total_recent,
                runs_today,
                sparkline,
            },
        });
    }

    let elapsed_ms = start.elapsed().as_millis() as u64;
    tracing::debug!(elapsed_ms, count = summaries.len(), "personas::get_summaries");
    if elapsed_ms > 100 {
        tracing::warn!(elapsed_ms, persona_count = summaries.len(), "personas::get_summaries exceeded 100ms threshold");
    }

    Ok(summaries)
}

/// Compute a trust score (0.0–100.0) for a persona from its recent execution history.
///
/// Factors:
/// - **Success rate** (weight 0.50): percentage of completed executions in last 50
/// - **Cost discipline** (weight 0.20): 1.0 if under budget, scaled down if over
/// - **Healing frequency** (weight 0.15): penalised by consecutive failures
/// - **Volume bonus** (weight 0.15): more executions = more confidence in the score
pub fn compute_trust_score(pool: &DbPool, persona_id: &str) -> Result<f64, AppError> {
    let conn = pool.get()?;

    // Last 50 terminal executions
    let mut stmt = conn.prepare(
        "SELECT status, cost_usd FROM persona_executions
         WHERE persona_id = ?1 AND status IN ('completed', 'failed')
         ORDER BY created_at DESC LIMIT 50",
    )?;
    let rows: Vec<(String, f64)> = stmt
        .query_map(params![persona_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<f64>>(1)?.unwrap_or(0.0)))
        })?
        .filter_map(|r| r.ok())
        .collect();

    if rows.is_empty() {
        return Ok(0.0);
    }

    let total = rows.len() as f64;
    let successes = rows.iter().filter(|(s, _)| s == "completed").count() as f64;
    let success_rate = successes / total;

    // Cost discipline: compare monthly spend vs budget
    let budget: Option<f64> = conn
        .query_row(
            "SELECT max_budget_usd FROM personas WHERE id = ?1",
            params![persona_id],
            |row| row.get(0),
        )
        .unwrap_or(None);
    let monthly_spend: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(cost_usd), 0.0) FROM persona_executions
             WHERE persona_id = ?1 AND status IN ('completed', 'failed', 'incomplete', 'cancelled')
             AND created_at >= datetime('now', 'start of month')",
            params![persona_id],
            |row| row.get(0),
        )
        .unwrap_or(0.0);
    let cost_score = match budget {
        Some(b) if b > 0.0 => (1.0 - (monthly_spend / b).min(2.0) / 2.0).max(0.0),
        _ => 1.0, // no budget set = full marks
    };

    // Healing frequency: penalise consecutive failures
    let consecutive_failures: u32 = {
        let mut stmt2 = conn.prepare(
            "SELECT status FROM persona_executions
             WHERE persona_id = ?1 ORDER BY created_at DESC LIMIT 20",
        )?;
        let statuses: Vec<String> = stmt2
            .query_map(params![persona_id], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        statuses.iter().take_while(|s| s.as_str() == "failed").count() as u32
    };
    let healing_score = (1.0 - (consecutive_failures as f64 * 0.2)).max(0.0);

    // Volume bonus: more executions build confidence (sigmoid-like curve capped at 1.0)
    let volume_score = (total / 20.0).min(1.0);

    // Weighted combination
    let score = (success_rate * 50.0)
        + (cost_score * 20.0)
        + (healing_score * 15.0)
        + (volume_score * 15.0);

    Ok(score.clamp(0.0, 100.0))
}

/// Recompute and persist the trust score for a persona.
/// Called after every execution completion.
pub fn refresh_trust_score(pool: &DbPool, persona_id: &str) -> Result<f64, AppError> {
    let score = compute_trust_score(pool, persona_id)?;
    let conn = pool.get()?;
    conn.execute(
        "UPDATE personas SET trust_score = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![score, persona_id],
    )?;
    tracing::debug!(persona_id, trust_score = score, "Trust score updated");
    Ok(score)
}

/// Duplicate a persona server-side, preserving the encrypted model_profile
/// so the BYOM auth token is never exposed to (or lost by) the frontend.
#[instrument(skip(pool))]
pub fn duplicate(pool: &DbPool, source_id: &str) -> Result<Persona, AppError> {
    let conn = pool.get()?;
    let new_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Copy all fields from source, generating a new id/timestamps and appending " (Copy)" to name.
    // model_profile is copied as-is (already encrypted) so the auth token is preserved.
    conn.execute(
        "INSERT INTO personas
         (id, project_id, name, description, system_prompt, structured_prompt,
          icon, color, enabled, sensitive, headless, max_concurrent, timeout_ms,
          model_profile, max_budget_usd, max_turns, design_context, group_id,
          notification_channels, created_at, updated_at)
         SELECT ?1, project_id, name || ' (Copy)', description, system_prompt, structured_prompt,
                icon, color, enabled, sensitive, headless, max_concurrent, timeout_ms,
                model_profile, max_budget_usd, max_turns, design_context, group_id,
                notification_channels, ?2, ?2
         FROM personas WHERE id = ?3",
        params![new_id, now, source_id],
    )?;

    get_by_id(pool, &new_id)
}

#[instrument(skip(pool))]
pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;

    // Clean up records that lack ON DELETE CASCADE foreign keys.
    // Tables with CASCADE (persona_tools, persona_triggers, persona_executions,
    // persona_event_subscriptions, etc.) are handled automatically by SQLite.
    conn.execute("DELETE FROM persona_memories WHERE persona_id = ?1", params![id])?;
    conn.execute("DELETE FROM persona_messages WHERE persona_id = ?1", params![id])?;
    conn.execute("DELETE FROM persona_events WHERE source_id = ?1 OR target_persona_id = ?1", params![id])?;
    conn.execute("DELETE FROM persona_healing_issues WHERE persona_id = ?1", params![id])?;

    let rows = conn.execute("DELETE FROM personas WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

/// Returns a summary of resources that will be affected by deleting a persona.
#[instrument(skip(pool))]
pub fn blast_radius(pool: &DbPool, id: &str) -> Result<Vec<(String, String)>, AppError> {
    let conn = pool.get()?;
    let mut impacts: Vec<(String, String)> = Vec::new();

    // Active automations
    let active_automations: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM persona_automations WHERE persona_id = ?1 AND deployment_status = 'active'",
            params![id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if active_automations > 0 {
        impacts.push((
            "automation".into(),
            format!("{active_automations} active automation(s) will stop running"),
        ));
    }

    // Triggers
    let triggers: Vec<(String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT trigger_type, name FROM persona_triggers WHERE persona_id = ?1",
        )?;
        let rows = stmt.query_map(params![id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            ))
        })?;
        rows.filter_map(|r| r.ok()).collect()
    };
    let scheduled = triggers.iter().filter(|(t, _)| t == "schedule").count();
    let webhook = triggers.iter().filter(|(t, _)| t == "webhook").count();
    let other = triggers.len() - scheduled - webhook;
    if scheduled > 0 {
        impacts.push(("trigger".into(), format!("{scheduled} scheduled trigger(s) will be removed")));
    }
    if webhook > 0 {
        impacts.push(("trigger".into(), format!("{webhook} webhook trigger(s) will be removed")));
    }
    if other > 0 {
        impacts.push(("trigger".into(), format!("{other} other trigger(s) will be removed")));
    }

    // Event subscriptions
    let subs: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM persona_event_subscriptions WHERE persona_id = ?1",
            params![id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if subs > 0 {
        impacts.push(("subscription".into(), format!("{subs} event subscription(s) will be removed")));
    }

    // Running executions
    let running: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM persona_executions WHERE persona_id = ?1 AND status IN ('running', 'queued')",
            params![id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if running > 0 {
        impacts.push(("execution".into(), format!("{running} running/queued execution(s) will be cancelled")));
    }

    // Chain triggers referencing this persona
    let chain_dependents: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT p.name FROM persona_triggers pt
             INNER JOIN personas p ON p.id = pt.persona_id
             WHERE pt.trigger_type = 'chain' AND pt.config LIKE ?1 AND pt.persona_id != ?2",
        )?;
        let pattern = format!("%{}%", id);
        let rows = stmt.query_map(params![pattern, id], |row| row.get::<_, String>(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    if !chain_dependents.is_empty() {
        impacts.push((
            "chain".into(),
            format!(
                "Agent(s) {} have chain triggers referencing this agent",
                chain_dependents.join(", ")
            ),
        ));
    }

    Ok(impacts)
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
                enabled: Some(false),
                ..Default::default()
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
                ..Default::default()
            },
        );
        assert!(result.is_err());

        // Whitespace-only name should fail
        let result = update(
            &pool,
            &persona.id,
            UpdatePersonaInput {
                name: Some("   ".into()),
                ..Default::default()
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
                system_prompt: Some("".into()),
                ..Default::default()
            },
        );
        assert!(result.is_err());

        // Whitespace-only system_prompt should fail
        let result = update(
            &pool,
            &persona.id,
            UpdatePersonaInput {
                system_prompt: Some("  \n  ".into()),
                ..Default::default()
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

        let base = || UpdatePersonaInput::default();

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
