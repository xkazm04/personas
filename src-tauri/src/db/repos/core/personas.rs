use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use rusqlite::{params, OptionalExtension, Row};
use tracing::instrument;

use crate::db::models::{CreatePersonaInput, HealthStatus, Persona, PersonaGatewayExposure, PersonaHealth, PersonaSummary, PersonaTrustLevel, PersonaTrustOrigin, UpdatePersonaInput};
use crate::db::repos::utils::collect_rows;
use crate::db::DbPool;
use crate::engine::crypto;
use crate::engine::crypto::CryptoError;
use crate::error::AppError;
use crate::validation::contract::check as validate_check;
use crate::validation::persona as pv;

/// Session-scoped counter of decryption failures. Helps detect systemic key
/// rotation issues before users report broken model configs.
static DECRYPTION_FAILURE_COUNT: AtomicU64 = AtomicU64::new(0);

// ---------------------------------------------------------------------------
// Persona health / trust thresholds (single source of truth)
//
// Frontend mirror: src/lib/personas/personaThresholds.ts
// Keep both files in sync when changing any value.
// ---------------------------------------------------------------------------

/// Failure ratio at or above which a persona is classified as "failing".
/// Below this (but > 0) the persona is "degraded"; exactly 0 is "healthy".
const HEALTH_FAILING_RATIO: f64 = 0.6;

/// Trust score component weights (must sum to 100).
const TRUST_W_SUCCESS: f64 = 50.0;
const TRUST_W_COST: f64 = 20.0;
const TRUST_W_HEALING: f64 = 15.0;
const TRUST_W_VOLUME: f64 = 15.0;

/// Healing penalty per consecutive failure (score = 1.0 − failures × this).
const HEALING_PENALTY_PER_FAILURE: f64 = 0.2;

/// Volume bonus reaches 1.0 at this many terminal executions.
const VOLUME_FULL_CREDIT_RUNS: f64 = 20.0;

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
            tracing::error!(
                persona_id = %persona_id,
                error_category = %error_category,
                session_failure_count = session_failures,
                "Failed to decrypt model_profile auth_token: {}",
                e
            );
            obj.remove("auth_token_enc");
            obj.remove("auth_token_iv");
            obj.insert(
                "auth_token_error".into(),
                serde_json::Value::String(format!("Decryption failed: {error_category}")),
            );
            serde_json::to_string(&val).unwrap_or_else(|_| json.to_string())
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
// All business rules live in crate::validation::persona. These thin wrappers
// keep the repo layer as a safety net while the command layer is the primary
// validation callsite.

fn validate_name(name: &str) -> Result<(), AppError> {
    validate_check(pv::validate_name(name))
}

fn validate_system_prompt(prompt: &str) -> Result<(), AppError> {
    validate_check(pv::validate_system_prompt(prompt))
}

fn validate_structured_prompt(prompt: &str) -> Result<(), AppError> {
    validate_check(pv::validate_structured_prompt(prompt))
}

fn validate_max_concurrent(v: i32) -> Result<(), AppError> {
    validate_check(pv::validate_max_concurrent(v))
}

fn validate_timeout_ms(v: i32) -> Result<(), AppError> {
    validate_check(pv::validate_timeout_ms(v))
}

fn validate_max_budget_usd(v: f64) -> Result<(), AppError> {
    validate_check(pv::validate_max_budget_usd(v))
}

fn validate_max_turns(v: i32) -> Result<(), AppError> {
    validate_check(pv::validate_max_turns(v))
}

fn validate_notification_channels(channels_json: &str) -> Result<(), AppError> {
    validate_check(pv::validate_notification_channels(channels_json))
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
        trust_level: row.get::<_, Option<String>>("trust_level")?
            .and_then(|s| s.parse().ok())
            .unwrap_or(PersonaTrustLevel::Verified),
        trust_origin: row.get::<_, Option<String>>("trust_origin")?
            .and_then(|s| s.parse().ok())
            .unwrap_or(PersonaTrustOrigin::Builtin),
        trust_verified_at: row.get::<_, Option<String>>("trust_verified_at").unwrap_or(None),
        trust_score: row.get::<_, Option<f64>>("trust_score")?.unwrap_or(0.0),
        parameters: row.get::<_, Option<String>>("parameters").unwrap_or(None),
        gateway_exposure: row
            .get::<_, Option<String>>("gateway_exposure")
            .ok()
            .flatten()
            .and_then(|s| s.parse().ok())
            .unwrap_or(PersonaGatewayExposure::LocalOnly),
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
    timed_query!("personas", "personas::get_all", {
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
    })
}

#[instrument(skip(pool))]
pub fn get_by_id(pool: &DbPool, id: &str) -> Result<Persona, AppError> {
    timed_query!("personas", "personas::get_by_id", {
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
    })
}

/// Look up a persona by id, but return `None` when its `gateway_exposure`
/// is `local_only`. Used by the external A2A management API endpoints to
/// avoid leaking the existence of personas not opted in to gateway visibility.
pub fn find_by_id_if_exposed(
    pool: &DbPool,
    id: &str,
) -> Result<Option<Persona>, AppError> {
    timed_query!("personas", "personas::find_by_id_if_exposed", {
        let conn = pool.get()?;
        let result = conn
            .query_row(
                "SELECT * FROM personas WHERE id = ?1",
                params![id],
                row_to_persona,
            )
            .optional()
            .map_err(AppError::Database)?;
        Ok(result.filter(|p| p.gateway_exposure.is_externally_visible()))
    })
}

/// Bulk-fetch personas by a list of IDs in a single query.
pub fn get_by_ids(pool: &DbPool, ids: &[String]) -> Result<Vec<Persona>, AppError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    timed_query!("personas", "personas::get_by_ids", {
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
    })
}

#[instrument(skip(pool))]
pub fn get_enabled(pool: &DbPool) -> Result<Vec<Persona>, AppError> {
    timed_query!("personas", "personas::get_enabled", {
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
    })
}

#[instrument(skip(pool, input), fields(persona_name = %input.name))]
pub fn create(pool: &DbPool, input: CreatePersonaInput) -> Result<Persona, AppError> {
    timed_query!("personas", "personas::create", {
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
        conn.query_row(
            "INSERT INTO personas
             (id, project_id, name, description, system_prompt, structured_prompt,
              icon, color, enabled, sensitive, max_concurrent, timeout_ms,
              model_profile, max_budget_usd, max_turns, design_context, group_id,
              notification_channels, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?19)
             RETURNING *",
            params![
                id, project_id, input.name, input.description, input.system_prompt,
                input.structured_prompt, input.icon, input.color, enabled, sensitive,
                max_concurrent, timeout_ms, encrypted_profile,
                input.max_budget_usd, input.max_turns, input.design_context,
                input.group_id, encrypted_channels, now,
            ],
            row_to_persona,
        ).map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::Internal("Failed to create persona".into()),
            other => AppError::Database(other),
        })
    })
}

#[instrument(skip(pool, input))]
pub fn update(pool: &DbPool, id: &str, input: UpdatePersonaInput) -> Result<Persona, AppError> {
    timed_query!("personas", "personas::update", {
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

        // Build dynamic SET clause and params in a single pass
        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

        push_field_param!(input.name, "name", sets, param_idx, param_values, clone);
        push_field_param!(input.description, "description", sets, param_idx, param_values, clone);
        push_field_param!(input.system_prompt, "system_prompt", sets, param_idx, param_values, clone);
        push_field_param!(input.structured_prompt, "structured_prompt", sets, param_idx, param_values, clone);
        push_field_param!(input.icon, "icon", sets, param_idx, param_values, clone);
        push_field_param!(input.color, "color", sets, param_idx, param_values, clone);
        push_field_param!(input.enabled, "enabled", sets, param_idx, param_values, bool);
        push_field_param!(input.sensitive, "sensitive", sets, param_idx, param_values, bool);
        push_field_param!(input.headless, "headless", sets, param_idx, param_values, bool);
        push_field_param!(input.max_concurrent, "max_concurrent", sets, param_idx, param_values, copy);
        push_field_param!(input.timeout_ms, "timeout_ms", sets, param_idx, param_values, copy);
        push_field_param!(encrypted_channels, "notification_channels", sets, param_idx, param_values, clone);
        push_field_param!(input.last_design_result, "last_design_result", sets, param_idx, param_values, clone);
        push_field_param!(encrypted_profile, "model_profile", sets, param_idx, param_values, clone);
        push_field_param!(input.max_budget_usd, "max_budget_usd", sets, param_idx, param_values, copy);
        push_field_param!(input.max_turns, "max_turns", sets, param_idx, param_values, copy);
        push_field_param!(input.design_context, "design_context", sets, param_idx, param_values, clone);
        push_field_param!(input.group_id, "group_id", sets, param_idx, param_values, clone);
        push_field_param!(input.parameters, "parameters", sets, param_idx, param_values, clone);
        push_field_param!(input.gateway_exposure, "gateway_exposure", sets, param_idx, param_values, as_str);

        let sql = format!(
            "UPDATE personas SET {} WHERE id = ?{} RETURNING *",
            sets.join(", "),
            param_idx
        );

        param_values.push(Box::new(id.to_string()));

        let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
        conn.query_row(&sql, params_ref.as_slice(), row_to_persona)
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Persona {id}")),
                other => AppError::Database(other),
            })
    })
}

/// Lightweight name-only update used by build sessions to rename a persona from the agent_ir.
pub fn update_name(pool: &DbPool, id: &str, name: &str) -> Result<(), AppError> {
    timed_query!("personas", "personas::update_name", {
        validate_name(name)?;
        let conn = pool.get()?;
        conn.execute(
            "UPDATE personas SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![name, id],
        )?;
        Ok(())
    })
}

/// Batch-fetch sidebar summary data (enabled trigger count + last execution time + health)
/// for all personas in a single CTE query, eliminating the N+1 per-persona health pattern.
/// Previously ran 3 queries per persona (recent statuses, runs today, 7-day sparkline);
/// now uses 1 base query + 3 batched queries across all personas.
#[instrument(skip(pool))]
pub fn get_summaries(pool: &DbPool) -> Result<Vec<PersonaSummary>, AppError> {
    timed_query!("personas", "personas::get_summaries", {
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

    // Query 2: Combined CTE for recent statuses, runs-today, and 7-day sparkline
    // Single scan of persona_executions instead of 3 separate queries.
    let mut combined_stmt = conn.prepare(
        "WITH ranked AS (
             SELECT persona_id, status, created_at,
                    ROW_NUMBER() OVER (PARTITION BY persona_id ORDER BY created_at DESC) AS rn
             FROM persona_executions
         ),
         recent AS (
             SELECT persona_id, status FROM ranked WHERE rn <= 10
         ),
         today AS (
             SELECT persona_id, COUNT(*) AS cnt
             FROM persona_executions
             WHERE created_at >= ?1
             GROUP BY persona_id
         ),
         sparkline AS (
             SELECT persona_id, DATE(created_at) AS day, COUNT(*) AS cnt
             FROM persona_executions
             WHERE created_at >= ?2
             GROUP BY persona_id, DATE(created_at)
         )
         SELECT 'R' AS kind, persona_id, status AS val, NULL AS day, 0 AS cnt FROM recent
         UNION ALL
         SELECT 'T' AS kind, persona_id, NULL AS val, NULL AS day, cnt FROM today
         UNION ALL
         SELECT 'S' AS kind, persona_id, NULL AS val, day, cnt FROM sparkline",
    )?;
    let combined_rows = combined_stmt.query_map(params![today_start, week_ago], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, i64>(4)?,
        ))
    })?;

    let mut recent_map: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    let mut today_map: std::collections::HashMap<String, i64> =
        std::collections::HashMap::new();
    let mut spark_map: std::collections::HashMap<String, std::collections::HashMap<String, i64>> =
        std::collections::HashMap::new();

    for (kind, pid, val, day, cnt) in collect_rows(combined_rows, "personas::get_summaries/combined") {
        match kind.as_str() {
            "R" => {
                if let Some(status) = val {
                    recent_map.entry(pid).or_default().push(status);
                }
            }
            "T" => {
                today_map.insert(pid, cnt);
            }
            "S" => {
                if let Some(d) = day {
                    spark_map.entry(pid).or_default().insert(d, cnt);
                }
            }
            _ => {}
        }
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
            HealthStatus::Dormant
        } else {
            let fail_ratio = fail_count / total_recent as f64;
            if fail_ratio == 0.0 {
                HealthStatus::Healthy
            } else if fail_ratio >= HEALTH_FAILING_RATIO {
                HealthStatus::Failing
            } else {
                HealthStatus::Degraded
            }
        };

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
    })
}

/// Compute a trust score (0.0–100.0) for a persona from its recent execution history.
///
/// Factors:
/// - **Success rate** (weight 0.50): percentage of completed executions in last 50
/// - **Cost discipline** (weight 0.20): 1.0 if under budget, scaled down if over
/// - **Healing frequency** (weight 0.15): penalised by consecutive failures
/// - **Volume bonus** (weight 0.15): more executions = more confidence in the score
pub fn compute_trust_score(pool: &DbPool, persona_id: &str) -> Result<f64, AppError> {
    timed_query!("personas", "personas::compute_trust_score", {
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
        let healing_score = (1.0 - (consecutive_failures as f64 * HEALING_PENALTY_PER_FAILURE)).max(0.0);

        // Volume bonus: more executions build confidence (sigmoid-like curve capped at 1.0)
        let volume_score = (total / VOLUME_FULL_CREDIT_RUNS).min(1.0);

        // Weighted combination
        let score = (success_rate * TRUST_W_SUCCESS)
            + (cost_score * TRUST_W_COST)
            + (healing_score * TRUST_W_HEALING)
            + (volume_score * TRUST_W_VOLUME);

        Ok(score.clamp(0.0, 100.0))
    })
}

/// Recompute and persist the trust score for a persona.
/// Called after every execution completion.
pub fn refresh_trust_score(pool: &DbPool, persona_id: &str) -> Result<f64, AppError> {
    timed_query!("personas", "personas::refresh_trust_score", {
        let score = compute_trust_score(pool, persona_id)?;
        let conn = pool.get()?;
        conn.execute(
            "UPDATE personas SET trust_score = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![score, persona_id],
        )?;
        tracing::debug!(persona_id, trust_score = score, "Trust score updated");
        Ok(score)
    })
}

/// Duplicate a persona server-side, preserving the encrypted model_profile
/// so the BYOM auth token is never exposed to (or lost by) the frontend.
#[instrument(skip(pool))]
pub fn duplicate(pool: &DbPool, source_id: &str) -> Result<Persona, AppError> {
    timed_query!("personas", "personas::duplicate", {
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
              notification_channels, parameters, trust_level, trust_origin,
              trust_verified_at, trust_score, source_review_id, last_design_result,
              created_at, updated_at)
             SELECT ?1, project_id, name || ' (Copy)', description, system_prompt, structured_prompt,
                    icon, color, enabled, sensitive, headless, max_concurrent, timeout_ms,
                    model_profile, max_budget_usd, max_turns, design_context, group_id,
                    notification_channels, parameters, trust_level, trust_origin,
                    trust_verified_at, trust_score, source_review_id, last_design_result,
                    ?2, ?2
             FROM personas WHERE id = ?3",
            params![new_id, now, source_id],
        )?;

        get_by_id(pool, &new_id)
    })
}

#[instrument(skip(pool))]
pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("personas", "personas::delete", {
        let conn = pool.get()?;

        let tx = conn.unchecked_transaction()?;

        // Clean up records that lack ON DELETE CASCADE foreign keys.
        // Tables with CASCADE (persona_tools, persona_triggers, persona_executions,
        // persona_event_subscriptions, etc.) are handled automatically by SQLite.
        tx.execute("DELETE FROM persona_memories WHERE persona_id = ?1", params![id])?;
        tx.execute("DELETE FROM persona_messages WHERE persona_id = ?1", params![id])?;
        tx.execute("DELETE FROM persona_events WHERE source_id = ?1 OR target_persona_id = ?1", params![id])?;
        tx.execute("DELETE FROM persona_healing_issues WHERE persona_id = ?1", params![id])?;

        let rows = tx.execute("DELETE FROM personas WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(rows > 0)
    })
}

/// Returns a summary of resources that will be affected by deleting a persona.
#[instrument(skip(pool))]
pub fn blast_radius(pool: &DbPool, id: &str) -> Result<Vec<(String, String)>, AppError> {
    timed_query!("personas", "personas::blast_radius", {
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
    })
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
    fn test_gateway_exposure_defaults_to_local_only() {
        let pool = init_test_db().unwrap();
        let persona = create(
            &pool,
            CreatePersonaInput {
                name: "Default Exposure".into(),
                system_prompt: "noop".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
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
        assert_eq!(
            persona.gateway_exposure,
            PersonaGatewayExposure::LocalOnly,
            "newly created personas must default to LocalOnly"
        );

        // find_by_id_if_exposed must return None for local_only personas
        let hidden = find_by_id_if_exposed(&pool, &persona.id).unwrap();
        assert!(
            hidden.is_none(),
            "local_only personas must not be returned by find_by_id_if_exposed"
        );
    }

    #[test]
    fn test_gateway_exposure_update_roundtrip() {
        let pool = init_test_db().unwrap();
        let persona = create(
            &pool,
            CreatePersonaInput {
                name: "Exposure Test".into(),
                system_prompt: "noop".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
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

        // Update to public
        let updated = update(
            &pool,
            &persona.id,
            UpdatePersonaInput {
                gateway_exposure: Some(PersonaGatewayExposure::Public),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(updated.gateway_exposure, PersonaGatewayExposure::Public);

        // Now find_by_id_if_exposed must return Some
        let visible = find_by_id_if_exposed(&pool, &persona.id).unwrap();
        assert!(visible.is_some(), "public personas must resolve");
        assert_eq!(visible.unwrap().id, persona.id);

        // Set to invite_only — also externally visible
        let _ = update(
            &pool,
            &persona.id,
            UpdatePersonaInput {
                gateway_exposure: Some(PersonaGatewayExposure::InviteOnly),
                ..Default::default()
            },
        )
        .unwrap();
        let invite = find_by_id_if_exposed(&pool, &persona.id).unwrap();
        assert!(invite.is_some(), "invite_only personas must resolve");

        // Back to local_only — must hide again
        let _ = update(
            &pool,
            &persona.id,
            UpdatePersonaInput {
                gateway_exposure: Some(PersonaGatewayExposure::LocalOnly),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(find_by_id_if_exposed(&pool, &persona.id).unwrap().is_none());
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

        // timeout_ms > engine ceiling
        let mut input = base();
        input.timeout_ms = Some(crate::engine::ENGINE_MAX_EXECUTION_MS + 1);
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

        // timeout_ms > engine ceiling
        let mut input = base();
        input.timeout_ms = Some(crate::engine::ENGINE_MAX_EXECUTION_MS + 1);
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

    // -----------------------------------------------------------------------
    // Option<Option<T>> update semantics: set / clear / skip round-trip
    // -----------------------------------------------------------------------

    /// Helper: create a persona with known nullable fields populated.
    fn create_persona_with_nullable_fields(pool: &DbPool) -> Persona {
        create(
            pool,
            CreatePersonaInput {
                name: "Nullable Agent".into(),
                system_prompt: "Prompt.".into(),
                project_id: None,
                description: Some("initial description".into()),
                structured_prompt: None,
                icon: Some("rocket".into()),
                color: Some("#ff0000".into()),
                enabled: None,
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: Some(5.0),
                max_turns: Some(10),
                design_context: Some(r#"{"use_cases":[]}"#.into()),
                group_id: None,
                notification_channels: None,
            },
        )
        .unwrap()
    }

    #[test]
    fn test_option_option_set_field() {
        let pool = init_test_db().unwrap();
        let persona = create_persona_with_nullable_fields(&pool);

        // Set description to a new value via Some(Some(v))
        let updated = update(
            &pool,
            &persona.id,
            UpdatePersonaInput {
                description: Some(Some("new description".into())),
                icon: Some(Some("star".into())),
                max_budget_usd: Some(Some(10.0)),
                max_turns: Some(Some(20)),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(updated.description.as_deref(), Some("new description"));
        assert_eq!(updated.icon.as_deref(), Some("star"));
        assert_eq!(updated.max_budget_usd, Some(10.0));
        assert_eq!(updated.max_turns, Some(20));

        // Verify round-trip through re-fetch
        let fetched = get_by_id(&pool, &persona.id).unwrap();
        assert_eq!(fetched.description.as_deref(), Some("new description"));
        assert_eq!(fetched.icon.as_deref(), Some("star"));
        assert_eq!(fetched.max_budget_usd, Some(10.0));
        assert_eq!(fetched.max_turns, Some(20));
    }

    #[test]
    fn test_option_option_clear_field_to_null() {
        let pool = init_test_db().unwrap();
        let persona = create_persona_with_nullable_fields(&pool);
        assert!(persona.description.is_some(), "precondition: description is set");
        assert!(persona.icon.is_some(), "precondition: icon is set");
        assert!(persona.max_budget_usd.is_some(), "precondition: max_budget_usd is set");

        // Clear fields by sending Some(None)
        let updated = update(
            &pool,
            &persona.id,
            UpdatePersonaInput {
                description: Some(None),
                icon: Some(None),
                color: Some(None),
                max_budget_usd: Some(None),
                max_turns: Some(None),
                design_context: Some(None),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(updated.description, None, "description should be cleared to NULL");
        assert_eq!(updated.icon, None, "icon should be cleared to NULL");
        assert_eq!(updated.color, None, "color should be cleared to NULL");
        assert_eq!(updated.max_budget_usd, None, "max_budget_usd should be cleared to NULL");
        assert_eq!(updated.max_turns, None, "max_turns should be cleared to NULL");
        assert_eq!(updated.design_context, None, "design_context should be cleared to NULL");

        // Verify round-trip: re-fetch confirms columns are actually NULL in DB
        let fetched = get_by_id(&pool, &persona.id).unwrap();
        assert_eq!(fetched.description, None);
        assert_eq!(fetched.icon, None);
        assert_eq!(fetched.max_budget_usd, None);
    }

    #[test]
    fn test_option_option_skip_field() {
        let pool = init_test_db().unwrap();
        let persona = create_persona_with_nullable_fields(&pool);
        let original_description = persona.description.clone();
        let original_icon = persona.icon.clone();
        let original_budget = persona.max_budget_usd;

        // Update only the name — all Option<Option<T>> fields should be skipped (None = skip)
        let updated = update(
            &pool,
            &persona.id,
            UpdatePersonaInput {
                name: Some("Renamed Agent".into()),
                // All Option<Option<T>> fields left as None (default) = skip
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(updated.name, "Renamed Agent");
        assert_eq!(updated.description, original_description, "description should be unchanged");
        assert_eq!(updated.icon, original_icon, "icon should be unchanged");
        assert_eq!(updated.max_budget_usd, original_budget, "max_budget_usd should be unchanged");
    }

    #[test]
    fn test_option_option_serde_json_boundary() {
        // Verify that serde_json deserialization of UpdatePersonaInput matches
        // the documented contract:
        //   - field absent (with Default) → None (skip)
        //   - field: null               → None (skip, same as absent for standard serde)
        //   - field: "value"            → Some(Some("value")) (set)
        //
        // IMPORTANT: Standard serde cannot distinguish absent vs null for
        // Option<Option<T>>. Both produce None. The "clear" semantic (Some(None))
        // is only achievable via Rust constructors, not via JSON. This test
        // documents that limitation.

        // Case 1: field present with value → Some(Some(value))
        let json = serde_json::json!({
            "name": null,
            "description": "hello",
            "system_prompt": null,
            "structured_prompt": null,
            "icon": null,
            "color": null,
            "enabled": null,
            "sensitive": null,
            "headless": null,
            "max_concurrent": null,
            "timeout_ms": null,
            "notification_channels": null,
            "last_design_result": null,
            "model_profile": null,
            "max_budget_usd": 5.0,
            "max_turns": null,
            "design_context": null,
            "group_id": null,
            "parameters": null
        });
        let input: UpdatePersonaInput = serde_json::from_value(json).unwrap();
        assert_eq!(input.description, Some(Some("hello".into())), "value → Some(Some(v))");
        assert_eq!(input.max_budget_usd, Some(Some(5.0)), "numeric value → Some(Some(v))");

        // Case 2: field present as null → None (skip) for Option<Option<T>>
        // This is the critical boundary: null does NOT produce Some(None) (clear)
        // without a custom deserializer. It produces None (skip).
        let json = serde_json::json!({
            "name": null,
            "description": null,
            "system_prompt": null,
            "structured_prompt": null,
            "icon": null,
            "color": null,
            "enabled": null,
            "sensitive": null,
            "headless": null,
            "max_concurrent": null,
            "timeout_ms": null,
            "notification_channels": null,
            "last_design_result": null,
            "model_profile": null,
            "max_budget_usd": null,
            "max_turns": null,
            "design_context": null,
            "group_id": null,
            "parameters": null
        });
        let input: UpdatePersonaInput = serde_json::from_value(json).unwrap();
        // With standard serde, null for Option<Option<T>> becomes None (skip), NOT Some(None) (clear).
        // The frontend buildUpdateInput sends null for both "skip" and "clear" cases,
        // so they are indistinguishable at the JSON boundary.
        assert_eq!(input.description, None, "null → None (skip), not Some(None) (clear)");
        assert_eq!(input.max_budget_usd, None, "null → None (skip)");
        assert_eq!(input.icon, None, "null → None (skip)");
    }
}
