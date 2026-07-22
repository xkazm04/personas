use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use rusqlite::{params, OptionalExtension, Row};
use tracing::instrument;

use crate::db::models::{
    CreatePersonaInput, HealthStatus, Persona, PersonaGatewayExposure, PersonaHealth,
    PersonaLifecycle, PersonaSummary, PersonaTrustLevel, PersonaTrustOrigin, UpdatePersonaInput,
};
use crate::db::query_builder::QueryBuilder;
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
    obj.insert(
        "auth_token_enc".into(),
        serde_json::Value::String(ciphertext),
    );
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

    let enc = obj
        .get("auth_token_enc")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let iv = obj
        .get("auth_token_iv")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

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
fn encrypt_update_profile(
    profile: &Option<Option<String>>,
) -> Result<Option<Option<String>>, AppError> {
    match profile {
        Some(Some(ref json)) if !json.trim().is_empty() => {
            Ok(Some(Some(encrypt_model_profile(json)?)))
        }
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
                    let session_failures =
                        DECRYPTION_FAILURE_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
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
        starred: row.get::<_, i32>("starred").unwrap_or(0) != 0,
        max_concurrent: row.get("max_concurrent")?,
        timeout_ms: row.get("timeout_ms")?,
        notification_channels,
        last_design_result: row.get("last_design_result")?,
        last_test_report: row.get("last_test_report").ok(),
        model_profile,
        max_budget_usd: row.get("max_budget_usd")?,
        max_turns: row.get("max_turns")?,
        design_context: row.get("design_context")?,
        home_team_id: row.get("home_team_id")?,
        source_review_id: row
            .get::<_, Option<String>>("source_review_id")
            .unwrap_or(None),
        trust_level: row
            .get::<_, Option<String>>("trust_level")?
            .and_then(|s| s.parse().ok())
            .unwrap_or(PersonaTrustLevel::Verified),
        trust_origin: row
            .get::<_, Option<String>>("trust_origin")?
            .and_then(|s| s.parse().ok())
            .unwrap_or(PersonaTrustOrigin::Builtin),
        trust_verified_at: row
            .get::<_, Option<String>>("trust_verified_at")
            .unwrap_or(None),
        trust_score: row.get::<_, Option<f64>>("trust_score")?.unwrap_or(0.0),
        parameters: row.get::<_, Option<String>>("parameters").unwrap_or(None),
        gateway_exposure: row
            .get::<_, Option<String>>("gateway_exposure")
            .ok()
            .flatten()
            .and_then(|s| s.parse().ok())
            .unwrap_or(PersonaGatewayExposure::LocalOnly),
        template_category: row
            .get::<_, Option<String>>("template_category")
            .unwrap_or(None),
        cli_awareness_enabled: row
            .get::<_, Option<i64>>("cli_awareness_enabled")
            .ok()
            .flatten()
            .map(|v| v != 0)
            .unwrap_or(false),
        setup_status: row
            .get::<_, Option<String>>("setup_status")
            .ok()
            .flatten()
            .unwrap_or_else(|| "ready".to_string()),
        setup_detail: row
            .get::<_, Option<String>>("setup_detail")
            .ok()
            .flatten(),
        disabled_dims_json: row
            .get::<_, Option<String>>("disabled_dims_json")
            .ok()
            .flatten(),
        lifecycle: row
            .get::<_, Option<String>>("lifecycle")
            .ok()
            .flatten()
            .unwrap_or_else(|| "active".to_string()),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub(crate) fn row_to_persona(row: &Row) -> rusqlite::Result<Persona> {
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
        let mut stmt = conn.prepare_cached("SELECT * FROM personas ORDER BY created_at DESC")?;
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

/// List personas filtered to a set of lifecycle stages (redacted, list view).
/// An empty `stages` slice returns everything (equivalent to `get_all`). Used
/// by the roster's server-side lifecycle filter — the default view passes
/// `["active","draft"]`, the Archived view passes `["archived"]`.
#[instrument(skip(pool))]
pub fn get_all_by_lifecycle(pool: &DbPool, stages: &[&str]) -> Result<Vec<Persona>, AppError> {
    if stages.is_empty() {
        return get_all(pool);
    }
    timed_query!("personas", "personas::get_all_by_lifecycle", {
        let conn = pool.get()?;
        let mut qb = QueryBuilder::new();
        qb.where_in(
            "COALESCE(lifecycle, 'active')",
            stages.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
        );
        qb.order_by("created_at", "DESC");
        let sql = qb.build_select("SELECT * FROM personas");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_persona_redacted)?;
        Ok(collect_rows(rows, "personas::get_all_by_lifecycle"))
    })
}

// ---------------------------------------------------------------------------
// Lean roster projection
//
// The roster/list view renders name, icon, health/lifecycle badges, trust,
// timestamps, connector chips and workspace — it never reads the large
// editor-only blobs. `get_all` shipped the FULL `system_prompt`,
// `structured_prompt`, `last_test_report`, `notification_channels` and
// `parameters` for every persona on every roster fetch (and held them in JS
// memory for the whole list). The lean projection below selects only the
// list-view columns and leaves those five heavy fields blank; the persona
// EDITOR keeps its full-fidelity fetch via `get_persona_detail` → `get_by_id`.
//
// `design_context`, `model_profile` (redacted) and `last_design_result` are
// intentionally KEPT: home widgets, the config panel, team studio, the trigger
// studio and the roster's own connector chips read them off list rows. Trimming
// those is a larger follow-up that must first route those consumers through the
// detail fetch.
//
// Frontend safety model: `personaSlice` re-hydrates a row to full fidelity via
// `getPersonaDetail` the moment a persona is opened/prefetched, so the blanked
// fields are only ever absent on rows the user has not opened — and no roster
// consumer reads them (audited 2026-07-13).
// ---------------------------------------------------------------------------

/// Columns the roster actually renders. Excludes the five heavy editor-only
/// blobs (`system_prompt`, `structured_prompt`, `last_test_report`,
/// `notification_channels`, `parameters`) so they are never read from SQLite
/// nor serialized over IPC for the list view.
const LEAN_LIST_COLUMNS: &str = "id, project_id, name, description, icon, color, \
     enabled, sensitive, headless, starred, max_concurrent, timeout_ms, \
     last_design_result, model_profile, max_budget_usd, max_turns, design_context, \
     home_team_id, source_review_id, trust_level, trust_origin, trust_verified_at, \
     trust_score, gateway_exposure, template_category, cli_awareness_enabled, \
     setup_status, setup_detail, disabled_dims_json, lifecycle, created_at, updated_at";

/// Map a lean roster row to a `Persona` with the five heavy editor-only fields
/// left blank. `model_profile` is redacted (list view). Mirrors the light-field
/// reads of `row_to_persona_with_mode` — keep the two in sync when adding a
/// persona column that the roster needs.
fn row_to_persona_lean(row: &Row) -> rusqlite::Result<Persona> {
    let raw_profile: Option<String> = row.get("model_profile")?;
    let model_profile = raw_profile.map(|json| redact_model_profile(&json));
    Ok(Persona {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        // Heavy editor-only fields — deliberately blank on roster rows.
        system_prompt: String::new(),
        structured_prompt: None,
        icon: row.get("icon")?,
        color: row.get("color")?,
        enabled: row.get::<_, i32>("enabled")? != 0,
        sensitive: row.get::<_, i32>("sensitive")? != 0,
        headless: row.get::<_, i32>("headless").unwrap_or(0) != 0,
        starred: row.get::<_, i32>("starred").unwrap_or(0) != 0,
        max_concurrent: row.get("max_concurrent")?,
        timeout_ms: row.get("timeout_ms")?,
        notification_channels: None,
        last_design_result: row.get("last_design_result")?,
        last_test_report: None,
        model_profile,
        max_budget_usd: row.get("max_budget_usd")?,
        max_turns: row.get("max_turns")?,
        design_context: row.get("design_context")?,
        home_team_id: row.get("home_team_id")?,
        source_review_id: row
            .get::<_, Option<String>>("source_review_id")
            .unwrap_or(None),
        trust_level: row
            .get::<_, Option<String>>("trust_level")?
            .and_then(|s| s.parse().ok())
            .unwrap_or(PersonaTrustLevel::Verified),
        trust_origin: row
            .get::<_, Option<String>>("trust_origin")?
            .and_then(|s| s.parse().ok())
            .unwrap_or(PersonaTrustOrigin::Builtin),
        trust_verified_at: row
            .get::<_, Option<String>>("trust_verified_at")
            .unwrap_or(None),
        trust_score: row.get::<_, Option<f64>>("trust_score")?.unwrap_or(0.0),
        parameters: None,
        gateway_exposure: row
            .get::<_, Option<String>>("gateway_exposure")
            .ok()
            .flatten()
            .and_then(|s| s.parse().ok())
            .unwrap_or(PersonaGatewayExposure::LocalOnly),
        template_category: row
            .get::<_, Option<String>>("template_category")
            .unwrap_or(None),
        cli_awareness_enabled: row
            .get::<_, Option<i64>>("cli_awareness_enabled")
            .ok()
            .flatten()
            .map(|v| v != 0)
            .unwrap_or(false),
        setup_status: row
            .get::<_, Option<String>>("setup_status")
            .ok()
            .flatten()
            .unwrap_or_else(|| "ready".to_string()),
        setup_detail: row
            .get::<_, Option<String>>("setup_detail")
            .ok()
            .flatten(),
        disabled_dims_json: row
            .get::<_, Option<String>>("disabled_dims_json")
            .ok()
            .flatten(),
        lifecycle: row
            .get::<_, Option<String>>("lifecycle")
            .ok()
            .flatten()
            .unwrap_or_else(|| "active".to_string()),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Lean roster list: every persona, list-view columns only (heavy blobs blank).
/// The scale-conscious replacement for `get_all` on the `list_personas` path.
#[instrument(skip(pool))]
pub fn get_all_lean(pool: &DbPool) -> Result<Vec<Persona>, AppError> {
    timed_query!("personas", "personas::get_all_lean", {
        let conn = pool.get()?;
        let sql = format!("SELECT {LEAN_LIST_COLUMNS} FROM personas ORDER BY created_at DESC");
        let mut stmt = conn.prepare_cached(&sql)?;
        let rows = stmt.query_map([], row_to_persona_lean)?;
        Ok(collect_rows(rows, "personas::get_all_lean"))
    })
}

/// Lean roster list filtered to a set of lifecycle stages (server-side).
/// Empty `stages` == `get_all_lean`. The lean twin of `get_all_by_lifecycle`.
#[instrument(skip(pool))]
pub fn get_all_by_lifecycle_lean(
    pool: &DbPool,
    stages: &[&str],
) -> Result<Vec<Persona>, AppError> {
    if stages.is_empty() {
        return get_all_lean(pool);
    }
    timed_query!("personas", "personas::get_all_by_lifecycle_lean", {
        let conn = pool.get()?;
        let mut qb = QueryBuilder::new();
        qb.where_in(
            "COALESCE(lifecycle, 'active')",
            stages.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
        );
        qb.order_by("created_at", "DESC");
        let sql = qb.build_select(&format!("SELECT {LEAN_LIST_COLUMNS} FROM personas"));
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_persona_lean)?;
        Ok(collect_rows(rows, "personas::get_all_by_lifecycle_lean"))
    })
}

#[instrument(skip(pool))]
pub fn get_by_id(pool: &DbPool, id: &str) -> Result<Persona, AppError> {
    timed_query!("personas", "personas::get_by_id", {
        let start = Instant::now();
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached("SELECT * FROM personas WHERE id = ?1")?;
        let result = stmt
            .query_row(params![id], row_to_persona)
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
pub fn find_by_id_if_exposed(pool: &DbPool, id: &str) -> Result<Option<Persona>, AppError> {
    timed_query!("personas", "personas::find_by_id_if_exposed", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached("SELECT * FROM personas WHERE id = ?1")?;
        let result = stmt
            .query_row(params![id], row_to_persona)
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
        let mut qb = QueryBuilder::new();
        qb.where_in("id", ids.to_vec());
        let sql = qb.build_select("SELECT * FROM personas");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_persona)?;
        Ok(collect_rows(rows, "personas::get_by_ids"))
    })
}

#[instrument(skip(pool))]
pub fn get_enabled(pool: &DbPool) -> Result<Vec<Persona>, AppError> {
    timed_query!("personas", "personas::get_enabled", {
        let start = Instant::now();
        let conn = pool.get()?;
        let mut stmt =
            conn.prepare_cached("SELECT * FROM personas WHERE enabled = 1 ORDER BY name")?;
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

/// Personas the user has starred — the Director's coaching scope. Excludes
/// the Director itself is the caller's concern (cycle runners skip it).
#[instrument(skip(pool))]
pub fn get_starred(pool: &DbPool) -> Result<Vec<Persona>, AppError> {
    timed_query!("personas", "personas::get_starred", {
        let conn = pool.get()?;
        let mut stmt =
            conn.prepare_cached("SELECT * FROM personas WHERE starred = 1 ORDER BY name")?;
        let rows = stmt.query_map([], row_to_persona)?;
        Ok(collect_rows(rows, "personas::get_starred"))
    })
}

/// Toggle a persona's starred flag (Director scope). Returns the new value.
pub fn set_starred(pool: &DbPool, id: &str, starred: bool) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let updated = conn.execute(
        "UPDATE personas SET starred = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![if starred { 1 } else { 0 }, id],
    )?;
    if updated == 0 {
        return Err(AppError::NotFound(format!("persona {id}")));
    }
    Ok(starred)
}

/// Set a persona's lifecycle stage directly. Validates the value against the
/// `PersonaLifecycle` enum. Used by the build promote path (→ `active`) and the
/// build cancel/fail cleanup guard. Does NOT touch `enabled` — lifecycle and
/// the runtime-pause switch are orthogonal.
pub fn set_lifecycle(
    pool: &DbPool,
    id: &str,
    lifecycle: PersonaLifecycle,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let updated = conn.execute(
        "UPDATE personas SET lifecycle = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![lifecycle.as_str(), id],
    )?;
    if updated == 0 {
        return Err(AppError::NotFound(format!("persona {id}")));
    }
    Ok(())
}

/// Archive a persona: move it to `archived` while preserving ALL history (no
/// cascade — executions, memories, messages stay). Blocked for system-origin
/// personas (e.g. the Director). Returns the refreshed persona.
#[instrument(skip(pool))]
pub fn archive_persona(pool: &DbPool, id: &str) -> Result<Persona, AppError> {
    let existing = get_by_id(pool, id)?;
    if existing.trust_origin == PersonaTrustOrigin::System {
        return Err(AppError::Validation(
            "System personas cannot be archived".into(),
        ));
    }
    set_lifecycle(pool, id, PersonaLifecycle::Archived)?;
    get_by_id(pool, id)
}

/// Restore an archived persona back to `active`. If the persona is not archived
/// this is a no-op that still returns the current row. Returns the refreshed
/// persona.
#[instrument(skip(pool))]
pub fn restore_persona(pool: &DbPool, id: &str) -> Result<Persona, AppError> {
    let existing = get_by_id(pool, id)?;
    if existing.lifecycle == PersonaLifecycle::Archived.as_str() {
        set_lifecycle(pool, id, PersonaLifecycle::Active)?;
    }
    get_by_id(pool, id)
}

#[instrument(skip(pool, input), fields(persona_name = %input.name))]
pub fn create(pool: &DbPool, mut input: CreatePersonaInput) -> Result<Persona, AppError> {
    timed_query!("personas", "personas::create", {
        validate_name(&input.name)?;
        validate_system_prompt(&input.system_prompt)?;
        if let Some(ref sp) = input.structured_prompt {
            validate_structured_prompt(sp)?;
        }
        if let Some(v) = input.max_concurrent {
            validate_max_concurrent(v)?;
        }
        if let Some(v) = input.timeout_ms {
            validate_timeout_ms(v)?;
        }
        if let Some(v) = input.max_budget_usd {
            validate_max_budget_usd(v)?;
        }
        if let Some(v) = input.max_turns {
            validate_max_turns(v)?;
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let project_id = input.project_id.clone().unwrap_or_else(|| "default".into());

        // 2026-05-05 — name uniqueness within project. The build LLM
        // picks generic titles (e.g. "Email Triage Manager", "Documentation
        // Archiver") and the same intent shape often produces the same
        // name across runs. SQL audit on the rapid-validation cohort
        // showed five identically-named personas in the DB. Suffix on
        // collision so the user can tell them apart in lists/sidebar
        // without changing intent semantics. Only mutates `input.name`
        // when needed; original name is preserved when unique.
        let mut conn = pool.get()?;
        // Serialize the name-uniqueness check + INSERT under one IMMEDIATE
        // transaction. Previously the check and the INSERT used two separate
        // pooled connections, so two concurrent creates of the same name both
        // passed the "does it exist?" probe and inserted duplicates — a TOCTOU
        // with no DB unique constraint behind it. IMMEDIATE takes the write lock
        // before the SELECT, forcing concurrent creators to serialize so the
        // second sees the first's row and suffixes correctly.
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        {
            let mut suffix = 2u32;
            loop {
                let exists: bool = tx
                    .query_row(
                        "SELECT 1 FROM personas WHERE project_id = ?1 AND name = ?2 LIMIT 1",
                        params![project_id, input.name],
                        |_| Ok(()),
                    )
                    .is_ok();
                if !exists {
                    break;
                }
                let base = input
                    .name
                    .trim_end_matches(|c: char| {
                        c.is_ascii_digit() || c == ' ' || c == '(' || c == ')'
                    })
                    .to_string();
                input.name = format!("{} ({})", base.trim_end(), suffix);
                suffix += 1;
                if suffix > 99 {
                    // Defensive ceiling — a project with 99 collisions on
                    // the same name is a bug; insert anyway and let the
                    // user clean up rather than loop forever.
                    break;
                }
            }
        }
        let enabled = input.enabled.unwrap_or(true) as i32;
        let sensitive = 0i32;
        let max_concurrent = input.max_concurrent.unwrap_or(4);
        let timeout_ms = input.timeout_ms.unwrap_or(600_000);

        // Lifecycle: default `active`; the build-stub path passes `draft`.
        // Validate against the enum so a bad IPC value can't poison the column.
        let lifecycle = match input.lifecycle.as_deref() {
            Some(s) => s.parse::<PersonaLifecycle>()?.as_str().to_string(),
            None => PersonaLifecycle::Active.as_str().to_string(),
        };

        if let Some(ref channels_json) = input.notification_channels {
            validate_notification_channels(channels_json)?;
        }

        let encrypted_profile = encrypt_input_profile(&input.model_profile)?;
        let encrypted_channels = match &input.notification_channels {
            Some(json) if !json.trim().is_empty() => Some(encrypt_notification_channels(json)?),
            other => other.clone(),
        };

        let persona = tx
            .query_row(
                "INSERT INTO personas
             (id, project_id, name, description, system_prompt, structured_prompt,
              icon, color, enabled, sensitive, max_concurrent, timeout_ms,
              model_profile, max_budget_usd, max_turns, design_context,
              notification_channels, lifecycle, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?19)
             RETURNING *",
                params![
                    id,
                    project_id,
                    input.name,
                    input.description,
                    input.system_prompt,
                    input.structured_prompt,
                    input.icon,
                    input.color,
                    enabled,
                    sensitive,
                    max_concurrent,
                    timeout_ms,
                    encrypted_profile,
                    input.max_budget_usd,
                    input.max_turns,
                    input.design_context,
                    encrypted_channels,
                    lifecycle,
                    now,
                ],
                row_to_persona,
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::Internal("Failed to create persona".into())
                }
                other => AppError::Database(other),
            })?;
        tx.commit()?;
        Ok(persona)
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
        if let Some(ref name) = input.name {
            validate_name(name)?;
        }
        if let Some(ref prompt) = input.system_prompt {
            validate_system_prompt(prompt)?;
        }
        if let Some(Some(ref sp)) = input.structured_prompt {
            validate_structured_prompt(sp)?;
        }
        if let Some(v) = input.max_concurrent {
            validate_max_concurrent(v)?;
        }
        if let Some(v) = input.timeout_ms {
            validate_timeout_ms(v)?;
        }
        if let Some(Some(v)) = input.max_budget_usd {
            validate_max_budget_usd(v)?;
        }
        if let Some(Some(v)) = input.max_turns {
            validate_max_turns(v)?;
        }
        if let Some(ref channels_json) = input.notification_channels {
            validate_notification_channels(channels_json)?;
        }
        // Validate lifecycle against the enum before it reaches the SET clause.
        if let Some(ref lc) = input.lifecycle {
            lc.parse::<PersonaLifecycle>()?;
        }

        // Encrypt auth_token inside model_profile before storing
        let encrypted_profile = encrypt_update_profile(&input.model_profile)?;

        // Encrypt sensitive notification channel secrets before storing
        let encrypted_channels = match &input.notification_channels {
            Some(json) if !json.trim().is_empty() => Some(encrypt_notification_channels(json)?),
            other => other.clone(),
        };

        let now = chrono::Utc::now().to_rfc3339();
        let mut conn = pool.get()?;

        // Build dynamic SET clause and params in a single pass
        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now.clone())];

        push_field_param!(input.name, "name", sets, param_idx, param_values, clone);
        push_field_param!(
            input.description,
            "description",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.system_prompt,
            "system_prompt",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.structured_prompt,
            "structured_prompt",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(input.icon, "icon", sets, param_idx, param_values, clone);
        push_field_param!(input.color, "color", sets, param_idx, param_values, clone);
        push_field_param!(
            input.enabled,
            "enabled",
            sets,
            param_idx,
            param_values,
            bool
        );
        push_field_param!(
            input.sensitive,
            "sensitive",
            sets,
            param_idx,
            param_values,
            bool
        );
        push_field_param!(
            input.headless,
            "headless",
            sets,
            param_idx,
            param_values,
            bool
        );
        push_field_param!(
            input.max_concurrent,
            "max_concurrent",
            sets,
            param_idx,
            param_values,
            copy
        );
        push_field_param!(
            input.timeout_ms,
            "timeout_ms",
            sets,
            param_idx,
            param_values,
            copy
        );
        push_field_param!(
            encrypted_channels,
            "notification_channels",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.last_design_result,
            "last_design_result",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.last_test_report,
            "last_test_report",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            encrypted_profile,
            "model_profile",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.max_budget_usd,
            "max_budget_usd",
            sets,
            param_idx,
            param_values,
            copy
        );
        push_field_param!(
            input.max_turns,
            "max_turns",
            sets,
            param_idx,
            param_values,
            copy
        );
        push_field_param!(
            input.design_context,
            "design_context",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.home_team_id,
            "home_team_id",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.parameters,
            "parameters",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.gateway_exposure,
            "gateway_exposure",
            sets,
            param_idx,
            param_values,
            as_str
        );
        push_field_param!(
            input.cli_awareness_enabled,
            "cli_awareness_enabled",
            sets,
            param_idx,
            param_values,
            bool
        );
        push_field_param!(
            input.disabled_dims_json,
            "disabled_dims_json",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.lifecycle,
            "lifecycle",
            sets,
            param_idx,
            param_values,
            clone
        );
        let sql = format!(
            "UPDATE personas SET {} WHERE id = ?{} RETURNING *",
            sets.join(", "),
            param_idx
        );

        param_values.push(Box::new(id.to_string()));

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();

        // Wrap the UPDATE + change-log writes in one transaction so the audit
        // rows commit atomically with the persona edit. The diff is computed
        // from `existing` (already loaded above) — no extra SELECT round-trip.
        let tx = conn.transaction()?;
        let persona = tx
            .query_row(&sql, params_ref.as_slice(), row_to_persona)
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Persona {id}")),
                other => AppError::Database(other),
            })?;
        // Field-level change history. Never let an audit failure sink a real
        // edit — log and continue if the writer errors.
        let source = input.source.as_deref().or(Some("other"));
        if let Err(e) = crate::db::repos::resources::persona_change_log::write_diff(
            &tx, id, &existing, &input, source, &now,
        ) {
            tracing::warn!(persona_id = %id, error = %e, "persona change-log write failed");
        }
        tx.commit()?;
        Ok(persona)
    })
}

/// Lightweight name-only update used by build sessions to rename a persona from the agent_ir.
///
/// 2026-05-07 — applies the same uniqueness suffix logic as `create()`. The
/// build LLM picks generic names ("Email Triage Manager", "Weekly Work
/// Digest") that collide across runs of similar intents; SQL audit on the
/// today's cohort showed five identically-named "Email Digest Manager"
/// rows. Without the suffix here, every duplicate name lands at update
/// time even though `create()` had already routed the temporary name
/// through Fix 6. The suffix is computed within the SAME project as the
/// target persona (read project_id first), and we only suffix when the
/// requested name actually collides with a *different* persona — calling
/// `update_name(id, current_name)` is a no-op.
pub fn update_name(pool: &DbPool, id: &str, name: &str) -> Result<(), AppError> {
    timed_query!("personas", "personas::update_name", {
        validate_name(name)?;
        let mut conn = pool.get()?;
        // IMMEDIATE transaction so the collision check + UPDATE are atomic vs.
        // other writers — otherwise two concurrent renames (or a rename racing
        // a create) both pass the "does another row have this name?" probe and
        // land duplicates (TOCTOU, no DB unique constraint).
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

        // Look up project_id of the target persona so the uniqueness
        // check is project-scoped (mirrors create()).
        let project_id: String = tx
            .query_row(
                "SELECT project_id FROM personas WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "default".to_string());

        // Compute a non-colliding name. If `name` is already this row's
        // name OR doesn't collide with any OTHER row in the same project,
        // it stays unchanged. Otherwise append " (2)" / " (3)" / ...
        let mut final_name = name.to_string();
        let mut suffix = 2u32;
        loop {
            let collides: bool = tx
                .query_row(
                    "SELECT 1 FROM personas WHERE project_id = ?1 AND name = ?2 AND id <> ?3 LIMIT 1",
                    params![project_id, final_name, id],
                    |_| Ok(()),
                )
                .is_ok();
            if !collides {
                break;
            }
            let base = final_name
                .trim_end_matches(|c: char| c.is_ascii_digit() || c == ' ' || c == '(' || c == ')')
                .trim_end()
                .to_string();
            final_name = format!("{} ({})", base, suffix);
            suffix += 1;
            if suffix > 99 {
                break;
            }
        }

        tx.execute(
            "UPDATE personas SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![final_name, id],
        )?;
        tx.commit()?;
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

        let today_start = chrono::Utc::now()
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .to_string();
        let week_ago = (chrono::Utc::now() - chrono::Duration::days(7)).to_rfc3339();
        let today = chrono::Utc::now().date_naive();

        // Query 1: Basic summary (trigger counts + last run) — 1 query for all personas
        let mut summary_stmt = conn.prepare_cached(
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
        let mut combined_stmt = conn.prepare_cached(
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
        let mut spark_map: std::collections::HashMap<
            String,
            std::collections::HashMap<String, i64>,
        > = std::collections::HashMap::new();

        for (kind, pid, val, day, cnt) in
            collect_rows(combined_rows, "personas::get_summaries/combined")
        {
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
        tracing::debug!(
            elapsed_ms,
            count = summaries.len(),
            "personas::get_summaries"
        );
        if elapsed_ms > 100 {
            tracing::warn!(
                elapsed_ms,
                persona_count = summaries.len(),
                "personas::get_summaries exceeded 100ms threshold"
            );
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
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<f64>>(1)?.unwrap_or(0.0),
                ))
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
            statuses
                .iter()
                .take_while(|s| s.as_str() == "failed")
                .count() as u32
        };
        let healing_score =
            (1.0 - (consecutive_failures as f64 * HEALING_PENALTY_PER_FAILURE)).max(0.0);

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

/// What a `duplicate` call actually did to the persona's wiring, so the copy
/// flow can tell the user the honest blast radius of the duplication instead of
/// silently producing an inert shell. `*_copied` are cloned onto the new
/// persona (disabled); `*_skipped` / `*_shared` are intentionally NOT cloned —
/// automations are workspace-scoped deployments, and tools/credential links are
/// shared catalog references both personas resolve by name/type at run time.
#[derive(Debug, Clone, Default)]
pub struct DuplicationSummary {
    pub triggers_copied: usize,
    pub subscriptions_copied: usize,
    pub automations_skipped: usize,
    pub tools_shared: usize,
    pub credential_links_shared: usize,
}

/// Duplicate a persona server-side, preserving the encrypted model_profile
/// so the BYOM auth token is never exposed to (or lost by) the frontend.
///
/// Deep-copies the persona's own automation wiring — `persona_triggers` and
/// `persona_event_subscriptions` — with fresh ids, the new `persona_id`, and
/// every copied row **disabled** so the duplicate never double-fires alongside
/// the original. Tools, credential links and automations are reported (see
/// [`DuplicationSummary`]) but not cloned. Runs in a single transaction so a
/// mid-copy failure never leaves a half-wired duplicate.
#[instrument(skip(pool))]
pub fn duplicate(pool: &DbPool, source_id: &str) -> Result<(Persona, DuplicationSummary), AppError> {
    timed_query!("personas", "personas::duplicate", {
        let conn = pool.get()?;
        let new_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let tx = conn.unchecked_transaction()?;

        // Copy all fields from source, generating a new id/timestamps and appending " (Copy)" to name.
        // model_profile is copied as-is (already encrypted) so the auth token is preserved.
        let inserted = tx.execute(
            "INSERT INTO personas
             (id, project_id, name, description, system_prompt, structured_prompt,
              icon, color, enabled, sensitive, headless, max_concurrent, timeout_ms,
              model_profile, max_budget_usd, max_turns, design_context,
              notification_channels, parameters, trust_level, trust_origin,
              trust_verified_at, trust_score, source_review_id, last_design_result,
              template_category, cli_awareness_enabled, created_at, updated_at)
             SELECT ?1, project_id, name || ' (Copy)', description, system_prompt, structured_prompt,
                    icon, color, enabled, sensitive, headless, max_concurrent, timeout_ms,
                    model_profile, max_budget_usd, max_turns, design_context,
                    notification_channels, parameters, trust_level, trust_origin,
                    trust_verified_at, trust_score, source_review_id, last_design_result,
                    template_category, cli_awareness_enabled, ?2, ?2
             FROM personas WHERE id = ?3",
            params![new_id, now, source_id],
        )?;
        if inserted == 0 {
            return Err(AppError::NotFound(format!("Persona {source_id}")));
        }

        // 2026-07-16 (refactor-bughunt-2026-07-10 repos#3) — enforce the same
        // name-uniqueness invariant `create()`/`update_name()` pay a
        // transaction to hold. A bare `name || ' (Copy)'` collides with
        // itself on a second duplicate, or with a pre-existing "X (Copy)"
        // row, producing indistinguishable personas in the sidebar. Unlike
        // create()/update_name()'s generic numeric-suffix stripper (which
        // would mangle the literal "(Copy)" text), just keep appending
        // " (N)" onto the copy's base name until it's unique in the project.
        let (project_id, base_name): (String, String) = tx.query_row(
            "SELECT project_id, name FROM personas WHERE id = ?1",
            params![new_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let mut final_name = base_name.clone();
        let mut suffix = 2u32;
        loop {
            let collides: bool = tx
                .query_row(
                    "SELECT 1 FROM personas WHERE project_id = ?1 AND name = ?2 AND id <> ?3 LIMIT 1",
                    params![project_id, final_name, new_id],
                    |_| Ok(()),
                )
                .is_ok();
            if !collides {
                break;
            }
            final_name = format!("{base_name} ({suffix})");
            suffix += 1;
            if suffix > 99 {
                // Defensive ceiling, mirrors create()/update_name().
                break;
            }
        }
        if final_name != base_name {
            tx.execute(
                "UPDATE personas SET name = ?1 WHERE id = ?2",
                params![final_name, new_id],
            )?;
        }

        let mut summary = DuplicationSummary::default();

        // ── Copy triggers (disabled on the copy) ──
        let source_triggers: Vec<(String, Option<String>)> = {
            let mut stmt = tx.prepare(
                "SELECT trigger_type, config FROM persona_triggers WHERE persona_id = ?1",
            )?;
            let rows = stmt.query_map(params![source_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })?;
            rows.filter_map(|r| r.ok()).collect()
        };
        for (trigger_type, config) in &source_triggers {
            tx.execute(
                "INSERT INTO persona_triggers
                 (id, persona_id, trigger_type, config, enabled, last_triggered_at, next_trigger_at, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 0, NULL, NULL, ?5, ?5)",
                params![uuid::Uuid::new_v4().to_string(), new_id, trigger_type, config, now],
            )?;
            summary.triggers_copied += 1;
        }

        // ── Copy event subscriptions (disabled on the copy) ──
        let source_subs: Vec<(String, Option<String>)> = {
            let mut stmt = tx.prepare(
                "SELECT event_type, source_filter FROM persona_event_subscriptions WHERE persona_id = ?1",
            )?;
            let rows = stmt.query_map(params![source_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })?;
            rows.filter_map(|r| r.ok()).collect()
        };
        for (event_type, source_filter) in &source_subs {
            tx.execute(
                "INSERT INTO persona_event_subscriptions
                 (id, persona_id, event_type, source_filter, enabled, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)",
                params![uuid::Uuid::new_v4().to_string(), new_id, event_type, source_filter, now],
            )?;
            summary.subscriptions_copied += 1;
        }

        // ── Report (don't clone) automations + shared tool/credential references ──
        summary.automations_skipped = tx
            .query_row(
                "SELECT COUNT(*) FROM persona_automations WHERE persona_id = ?1",
                params![source_id],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0) as usize;
        summary.tools_shared = tx
            .query_row(
                "SELECT COUNT(*) FROM persona_tools WHERE persona_id = ?1",
                params![source_id],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0) as usize;
        summary.credential_links_shared = count_credential_links(&tx, source_id);

        tx.commit()?;

        let persona = get_by_id(pool, &new_id)?;
        Ok((persona, summary))
    })
}

/// Count the distinct credential dependencies a persona declares: its
/// `design_context.credentialLinks` entries plus the tool definitions it
/// assigns that require a credential type. Used by both the duplicate summary
/// (what's shared, not cloned) and the delete blast radius (what a delete
/// leaves dangling). Best-effort — a NULL/corrupt `design_context` contributes 0.
fn count_credential_links(conn: &rusqlite::Connection, persona_id: &str) -> usize {
    let design_links: usize = conn
        .query_row(
            "SELECT design_context FROM personas WHERE id = ?1",
            params![persona_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
        .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
        .and_then(|v| {
            v.get("credentialLinks")
                .or_else(|| v.get("credential_links"))
                .and_then(|c| c.as_object().map(|o| o.len()))
        })
        .unwrap_or(0);

    let tool_creds: usize = conn
        .query_row(
            "SELECT COUNT(DISTINCT ptd.requires_credential_type)
             FROM persona_tools pt
             INNER JOIN persona_tool_definitions ptd ON ptd.id = pt.tool_id
             WHERE pt.persona_id = ?1 AND ptd.requires_credential_type IS NOT NULL",
            params![persona_id],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0) as usize;

    design_links + tool_creds
}

#[instrument(skip(pool))]
pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("personas", "personas::delete", {
        let conn = pool.get()?;

        let tx = conn.unchecked_transaction()?;

        // persona_memories, persona_messages, persona_healing_issues, and
        // persona_events.target_persona_id are now FK-cascaded /
        // FK-set-null automatically by the FK hygiene ADR
        // (2026-05-02-fk-hygiene-cascade). Only persona_events.source_id
        // still needs manual cleanup — it's polymorphic (source_type can
        // be persona/trigger/system/...) so the FK couldn't constrain it.
        tx.execute(
            "DELETE FROM persona_events WHERE source_id = ?1",
            params![id],
        )?;

        let rows = tx.execute("DELETE FROM personas WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(rows > 0)
    })
}

/// Does this persona have ANY execution rows? Guard used by the draft cleanup
/// paths (build cancel/fail, TTL sweep) so a draft that already produced work
/// is never silently swept.
pub fn has_executions(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM persona_executions WHERE persona_id = ?1",
            params![id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(count > 0)
}

/// Delete a persona ONLY when it is a `draft` with no execution history. Returns
/// `Ok(true)` when it was deleted, `Ok(false)` when the guard declined (not a
/// draft, has executions, or already gone). The single remedy for orphaned
/// build stubs — build cancel/fail and the TTL sweep both route through here so
/// the "never destroy real work" guard lives in exactly one place.
#[instrument(skip(pool))]
pub fn delete_draft_if_safe(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let persona = match get_by_id(pool, id) {
        Ok(p) => p,
        Err(AppError::NotFound(_)) => return Ok(false),
        Err(e) => return Err(e),
    };
    if persona.lifecycle != PersonaLifecycle::Draft.as_str() {
        return Ok(false);
    }
    if persona.trust_origin == PersonaTrustOrigin::System {
        return Ok(false);
    }
    if has_executions(pool, id)? {
        return Ok(false);
    }
    delete(pool, id)
}

/// Bulk-delete personas in one call, returning a per-id outcome so the caller
/// can report exactly what happened. System-origin personas are `protected`
/// (never deleted); a missing row or DB error is reported as `failed` with a
/// reason. Iterates the same single-persona drain path server-side so the
/// frontend's "delete drafts" button is one IPC instead of N.
#[instrument(skip(pool))]
pub fn bulk_delete_personas(
    pool: &DbPool,
    ids: &[String],
) -> Result<Vec<crate::db::models::BulkDeleteOutcome>, AppError> {
    use crate::db::models::BulkDeleteOutcome;
    let mut outcomes = Vec::with_capacity(ids.len());
    for id in ids {
        // Protect system-origin personas (the Director) up front so we return
        // `protected` rather than attempting the delete.
        let origin = match get_by_id(pool, id) {
            Ok(p) => Some(p.trust_origin),
            Err(AppError::NotFound(_)) => None,
            Err(e) => {
                outcomes.push(BulkDeleteOutcome {
                    id: id.clone(),
                    status: "failed".into(),
                    reason: Some(e.to_string()),
                });
                continue;
            }
        };
        match origin {
            None => outcomes.push(BulkDeleteOutcome {
                id: id.clone(),
                status: "failed".into(),
                reason: Some("persona not found".into()),
            }),
            Some(PersonaTrustOrigin::System) => outcomes.push(BulkDeleteOutcome {
                id: id.clone(),
                status: "protected".into(),
                reason: Some("system persona cannot be deleted".into()),
            }),
            Some(_) => match delete(pool, id) {
                Ok(true) => outcomes.push(BulkDeleteOutcome {
                    id: id.clone(),
                    status: "deleted".into(),
                    reason: None,
                }),
                Ok(false) => outcomes.push(BulkDeleteOutcome {
                    id: id.clone(),
                    status: "failed".into(),
                    reason: Some("persona not found".into()),
                }),
                Err(e) => outcomes.push(BulkDeleteOutcome {
                    id: id.clone(),
                    status: "failed".into(),
                    reason: Some(e.to_string()),
                }),
            },
        }
    }
    Ok(outcomes)
}

/// TTL sweep: delete `draft` personas older than `retention_days` that have no
/// execution history. `retention_days <= 0` disables the sweep (returns 0).
/// Routes each candidate through `delete_draft_if_safe` so the same guard
/// applies. Returns the number actually deleted.
#[instrument(skip(pool))]
pub fn sweep_stale_drafts(pool: &DbPool, retention_days: i64) -> Result<usize, AppError> {
    if retention_days <= 0 {
        return Ok(0);
    }
    let candidate_ids: Vec<String> = {
        let conn = pool.get()?;
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(retention_days)).to_rfc3339();
        let mut stmt = conn.prepare(
            "SELECT id FROM personas
             WHERE COALESCE(lifecycle, 'active') = 'draft'
               AND created_at < ?1
               AND COALESCE(trust_origin, 'builtin') != 'system'",
        )?;
        let rows = stmt.query_map(params![cutoff], |r| r.get::<_, String>(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    let mut deleted = 0usize;
    for id in candidate_ids {
        match delete_draft_if_safe(pool, &id) {
            Ok(true) => deleted += 1,
            Ok(false) => {}
            Err(e) => tracing::warn!(persona_id = %id, error = %e, "sweep_stale_drafts: delete failed"),
        }
    }
    Ok(deleted)
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

        // Triggers. NOTE: this selects only `trigger_type` — the previous
        // `SELECT trigger_type, name` referenced a `name` column that
        // `persona_triggers` does not have (no migration ever added it), so
        // the whole query errored at runtime and the delete dialog silently
        // showed an empty blast radius. The fetched `name` was never used
        // anyway (impacts are bucketed by type), so dropping it fixes the bug.
        let triggers: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT trigger_type FROM persona_triggers WHERE persona_id = ?1")?;
            let rows = stmt.query_map(params![id], |row| row.get::<_, String>(0))?;
            rows.filter_map(|r| r.ok()).collect()
        };
        let scheduled = triggers.iter().filter(|t| t.as_str() == "schedule").count();
        let webhook = triggers.iter().filter(|t| t.as_str() == "webhook").count();
        let other = triggers.len() - scheduled - webhook;
        if scheduled > 0 {
            impacts.push((
                "trigger".into(),
                format!("{scheduled} scheduled trigger(s) will be removed"),
            ));
        }
        if webhook > 0 {
            impacts.push((
                "trigger".into(),
                format!("{webhook} webhook trigger(s) will be removed"),
            ));
        }
        if other > 0 {
            impacts.push((
                "trigger".into(),
                format!("{other} other trigger(s) will be removed"),
            ));
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
            impacts.push((
                "subscription".into(),
                format!("{subs} event subscription(s) will be removed"),
            ));
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
            impacts.push((
                "execution".into(),
                format!("{running} running/queued execution(s) will be cancelled"),
            ));
        }

        // Learned memories — permanently destroyed by the cascade delete.
        let memories: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_memories WHERE persona_id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if memories > 0 {
            impacts.push((
                "memory".into(),
                format!("{memories} learned memory item(s) will be permanently deleted"),
            ));
        }

        // Emitted events — the polymorphic `source_id` rows are hard-deleted
        // (they can't be FK-constrained). Events that merely *target* this
        // persona are FK-set-null and survive, so only source events are lost.
        let events: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_events WHERE source_id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if events > 0 {
            impacts.push((
                "event".into(),
                format!("{events} emitted event record(s) will be deleted from history"),
            ));
        }

        // Credential dependencies — design_context.credentialLinks + tool
        // requires_credential_type. The vault credentials themselves are shared
        // and survive; this reports the bindings that go away with the persona.
        let cred_links = count_credential_links(&conn, id);
        if cred_links > 0 {
            impacts.push((
                "credential".into(),
                format!("{cred_links} credential connection(s) will be unlinked"),
            ));
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

        // Team memberships — warn before removing an agent that belongs to one
        // or more teams (the persona_team_members rows cascade on delete, but
        // the user should know the team loses this member first).
        let teams: Vec<String> = {
            let mut stmt = conn.prepare(
                "SELECT t.name FROM persona_team_members ptm
                 INNER JOIN persona_teams t ON t.id = ptm.team_id
                 WHERE ptm.persona_id = ?1
                 ORDER BY t.name",
            )?;
            let rows = stmt.query_map(params![id], |row| row.get::<_, String>(0))?;
            rows.filter_map(|r| r.ok()).collect()
        };
        if !teams.is_empty() {
            impacts.push((
                "team".into(),
                format!(
                    "Member of team(s): {} — will be removed from them",
                    teams.join(", ")
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

    // NOTE (updated 2026-07-13): `blast_radius` IS unit-tested now — see
    // `test_blast_radius_reports_all_categories`. The old blocker was a bug, not
    // a schema gap: the triggers query selected a `name` column that
    // `persona_triggers` never had (no migration adds it), so the query errored
    // at runtime in prod AND in tests. That column's value was never used, so it
    // was dropped; the function now runs against `init_test_db`'s full schema.

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
                notification_channels: None,
                lifecycle: None,
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
                notification_channels: None,
                lifecycle: None,
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
                notification_channels: None,
                lifecycle: None,
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
                notification_channels: None,
                lifecycle: None,
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
                notification_channels: None,
                lifecycle: None,
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
                notification_channels: None,
                lifecycle: None,
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
            notification_channels: None,
            lifecycle: None,
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
                notification_channels: None,
                lifecycle: None,
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
                notification_channels: None,
                lifecycle: None,
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
        assert!(
            persona.description.is_some(),
            "precondition: description is set"
        );
        assert!(persona.icon.is_some(), "precondition: icon is set");
        assert!(
            persona.max_budget_usd.is_some(),
            "precondition: max_budget_usd is set"
        );

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

        assert_eq!(
            updated.description, None,
            "description should be cleared to NULL"
        );
        assert_eq!(updated.icon, None, "icon should be cleared to NULL");
        assert_eq!(updated.color, None, "color should be cleared to NULL");
        assert_eq!(
            updated.max_budget_usd, None,
            "max_budget_usd should be cleared to NULL"
        );
        assert_eq!(
            updated.max_turns, None,
            "max_turns should be cleared to NULL"
        );
        assert_eq!(
            updated.design_context, None,
            "design_context should be cleared to NULL"
        );

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
        assert_eq!(
            updated.description, original_description,
            "description should be unchanged"
        );
        assert_eq!(updated.icon, original_icon, "icon should be unchanged");
        assert_eq!(
            updated.max_budget_usd, original_budget,
            "max_budget_usd should be unchanged"
        );
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
        assert_eq!(
            input.description,
            Some(Some("hello".into())),
            "value → Some(Some(v))"
        );
        assert_eq!(
            input.max_budget_usd,
            Some(Some(5.0)),
            "numeric value → Some(Some(v))"
        );

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
        assert_eq!(
            input.description, None,
            "null → None (skip), not Some(None) (clear)"
        );
        assert_eq!(input.max_budget_usd, None, "null → None (skip)");
        assert_eq!(input.icon, None, "null → None (skip)");
    }

    // v3.2 — shape-v2 notification_channels encrypt/decrypt round-trip.
    #[test]
    fn test_encrypt_decrypt_shape_v2_builtin_titlebar_passthrough() {
        let shape_v2 = r#"[
            {"type":"built-in","enabled":true,"use_case_ids":"*"},
            {"type":"titlebar","enabled":true,"use_case_ids":["uc_a"],"event_filter":["stock.signal.buy"]}
        ]"#;

        // encrypt_notification_channels is pub(crate) — directly callable in this module.
        let encrypted = encrypt_notification_channels(shape_v2).expect("encrypt shape v2");
        // Since neither entry has sensitive config keys, encrypted output should
        // parse back identically after serde normalization.
        let decrypted = decrypt_notification_channels(&encrypted, "test_persona_id");

        // Parse both sides via parse_channels_v2 to normalize field ordering +
        // verify every shape-v2 key survives.
        use crate::notifications::parse_channels_v2;
        let input_parsed = parse_channels_v2(Some(shape_v2)).expect("input is v2");
        let out_parsed = parse_channels_v2(Some(&decrypted)).expect("output is v2");
        assert_eq!(
            input_parsed, out_parsed,
            "shape v2 must round-trip encrypt/decrypt with zero data loss"
        );
    }

    #[test]
    fn test_encrypt_decrypt_shape_v2_with_external_credential_id() {
        let shape_v2 = r##"[
            {"type":"slack","enabled":true,"credential_id":"cred_abc","use_case_ids":["uc_a"],"config":{"channel":"#alerts"}}
        ]"##;
        let encrypted = encrypt_notification_channels(shape_v2).expect("encrypt");
        let decrypted = decrypt_notification_channels(&encrypted, "test_persona_id");

        use crate::notifications::parse_channels_v2;
        let out = parse_channels_v2(Some(&decrypted)).expect("output is v2");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].credential_id.as_deref(), Some("cred_abc"));
        // Config map preserved with channel key intact.
        let cfg = out[0].config.as_ref().expect("config present");
        assert_eq!(cfg["channel"], "#alerts");
    }

    #[test]
    fn test_shape_v2_parses_back_from_decrypted_json() {
        let shape_v2 = r#"[{"type":"built-in","enabled":true,"use_case_ids":"*"}]"#;
        let encrypted = encrypt_notification_channels(shape_v2).expect("encrypt");
        let decrypted = decrypt_notification_channels(&encrypted, "test_persona_id");

        use crate::notifications::parse_channels_v2;
        let out = parse_channels_v2(Some(&decrypted)).expect("parses back as v2");
        assert_eq!(out.len(), 1);
        use crate::db::models::{ChannelScopeV2, ChannelSpecV2Type};
        assert_eq!(out[0].channel_type, ChannelSpecV2Type::BuiltIn);
        match &out[0].use_case_ids {
            ChannelScopeV2::All(s) => assert_eq!(s, "*"),
            _ => panic!("expected All(\"*\")"),
        }
    }

    // -----------------------------------------------------------------------
    // Persona lifecycle (Direction 1) + draft GC / bulk delete (Direction 2)
    // -----------------------------------------------------------------------

    fn lifecycle_input(name: &str, prompt: &str) -> CreatePersonaInput {
        CreatePersonaInput {
            name: name.into(),
            system_prompt: prompt.into(),
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
            notification_channels: None,
            lifecycle: None,
        }
    }

    #[test]
    fn test_lifecycle_defaults_to_active() {
        let pool = init_test_db().unwrap();
        let p = create(&pool, lifecycle_input("Active One", "Real prompt.")).unwrap();
        assert_eq!(p.lifecycle, "active", "default lifecycle must be active");
    }

    #[test]
    fn test_lifecycle_draft_stamp_and_promote_roundtrip() {
        let pool = init_test_db().unwrap();
        let mut input = lifecycle_input("Draft One", "You are a helpful AI assistant.");
        input.lifecycle = Some("draft".into());
        let p = create(&pool, input).unwrap();
        assert_eq!(p.lifecycle, "draft");

        // Promote (mirrors the build promote path setting lifecycle=active).
        set_lifecycle(&pool, &p.id, PersonaLifecycle::Active).unwrap();
        assert_eq!(get_by_id(&pool, &p.id).unwrap().lifecycle, "active");
    }

    #[test]
    fn test_create_rejects_invalid_lifecycle() {
        let pool = init_test_db().unwrap();
        let mut input = lifecycle_input("Bad LC", "Prompt.");
        input.lifecycle = Some("nonsense".into());
        assert!(create(&pool, input).is_err());
    }

    #[test]
    fn test_backfill_infers_draft_not_coincidental_prompt() {
        // Reproduces the migration backfill logic against seeded rows: a stub
        // with the placeholder prompt AND no design result → draft; a REAL
        // persona whose prompt merely LOOKS like the placeholder but HAS a
        // design result → NOT draft (the exact bug the heuristic replaces).
        let pool = init_test_db().unwrap();

        // Stub draft: placeholder prompt, no design.
        let stub = create(
            &pool,
            lifecycle_input("Stub", "You are a helpful AI assistant."),
        )
        .unwrap();
        // Coincidental: placeholder-looking prompt but a real completed build.
        let coincidental = create(
            &pool,
            lifecycle_input("Coincidental", "You are a helpful AI assistant."),
        )
        .unwrap();
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "UPDATE personas SET last_design_result = '{\"ok\":true}' WHERE id = ?1",
                params![coincidental.id],
            )
            .unwrap();
            // Reset both to 'active' then run the SAME backfill UPDATE the
            // migration performs.
            conn.execute("UPDATE personas SET lifecycle = 'active'", []).unwrap();
            conn.execute(
                "UPDATE personas SET lifecycle = 'draft'
                 WHERE (last_design_result IS NULL OR TRIM(last_design_result) = '')
                   AND (design_context IS NULL OR TRIM(design_context) = '')
                   AND (system_prompt = 'You are a helpful AI assistant.'
                        OR TRIM(COALESCE(system_prompt, '')) = '')
                   AND COALESCE(trust_origin, 'builtin') != 'system';",
                [],
            )
            .unwrap();
        }
        assert_eq!(get_by_id(&pool, &stub.id).unwrap().lifecycle, "draft");
        assert_eq!(
            get_by_id(&pool, &coincidental.id).unwrap().lifecycle,
            "active",
            "a persona with a design result must NOT be inferred as draft"
        );
    }

    #[test]
    fn test_archive_preserves_row_and_restore() {
        let pool = init_test_db().unwrap();
        let p = create(&pool, lifecycle_input("Archive Me", "Real.")).unwrap();

        let archived = archive_persona(&pool, &p.id).unwrap();
        assert_eq!(archived.lifecycle, "archived");
        // Row still exists (archive is not delete).
        assert_eq!(get_by_id(&pool, &p.id).unwrap().lifecycle, "archived");

        let restored = restore_persona(&pool, &p.id).unwrap();
        assert_eq!(restored.lifecycle, "active");
    }

    #[test]
    fn test_archive_blocks_system_origin() {
        let pool = init_test_db().unwrap();
        let p = create(&pool, lifecycle_input("Sys", "Real.")).unwrap();
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "UPDATE personas SET trust_origin = 'system' WHERE id = ?1",
                params![p.id],
            )
            .unwrap();
        }
        assert!(
            archive_persona(&pool, &p.id).is_err(),
            "system personas must not be archivable"
        );
    }

    #[test]
    fn test_get_all_by_lifecycle_filter() {
        let pool = init_test_db().unwrap();
        let a = create(&pool, lifecycle_input("A", "Real.")).unwrap();
        let mut d_in = lifecycle_input("D", "You are a helpful AI assistant.");
        d_in.lifecycle = Some("draft".into());
        let d = create(&pool, d_in).unwrap();
        let arch = create(&pool, lifecycle_input("Arch", "Real.")).unwrap();
        archive_persona(&pool, &arch.id).unwrap();

        let active_draft = get_all_by_lifecycle(&pool, &["active", "draft"]).unwrap();
        let ids: Vec<&str> = active_draft.iter().map(|p| p.id.as_str()).collect();
        assert!(ids.contains(&a.id.as_str()));
        assert!(ids.contains(&d.id.as_str()));
        assert!(!ids.contains(&arch.id.as_str()));

        let archived = get_all_by_lifecycle(&pool, &["archived"]).unwrap();
        assert_eq!(archived.len(), 1);
        assert_eq!(archived[0].id, arch.id);
    }

    #[test]
    fn test_get_all_by_lifecycle_lean_filter() {
        let pool = init_test_db().unwrap();
        let a = create(&pool, lifecycle_input("LeanActive", "Real.")).unwrap();
        let mut d_in = lifecycle_input("LeanDraft", "Real.");
        d_in.lifecycle = Some("draft".into());
        let d = create(&pool, d_in).unwrap();
        let arch = create(&pool, lifecycle_input("LeanArch", "Real.")).unwrap();
        archive_persona(&pool, &arch.id).unwrap();

        let active_draft = get_all_by_lifecycle_lean(&pool, &["active", "draft"]).unwrap();
        let ids: Vec<&str> = active_draft.iter().map(|p| p.id.as_str()).collect();
        assert!(ids.contains(&a.id.as_str()));
        assert!(ids.contains(&d.id.as_str()));
        assert!(!ids.contains(&arch.id.as_str()));

        let archived = get_all_by_lifecycle_lean(&pool, &["archived"]).unwrap();
        assert_eq!(archived.len(), 1);
        assert_eq!(archived[0].id, arch.id);

        // Empty stages == full lean roster.
        assert_eq!(get_all_by_lifecycle_lean(&pool, &[]).unwrap().len(), 3);
    }

    #[test]
    fn test_duplicate_copies_triggers_and_subscriptions_disabled() {
        let pool = init_test_db().unwrap();
        let mut src_in = lifecycle_input("Source", "You are the source.");
        src_in.design_context = Some(r#"{"summary":"src"}"#.into());
        let src = create(&pool, src_in).unwrap();

        // Seed two enabled triggers + one enabled subscription on the source.
        {
            let conn = pool.get().unwrap();
            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO persona_triggers (id, persona_id, trigger_type, config, enabled, created_at, updated_at)
                 VALUES (?1, ?2, 'schedule', '{\"cron\":\"* * * * *\"}', 1, ?3, ?3)",
                params![uuid::Uuid::new_v4().to_string(), src.id, now],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO persona_triggers (id, persona_id, trigger_type, config, enabled, created_at, updated_at)
                 VALUES (?1, ?2, 'webhook', NULL, 1, ?3, ?3)",
                params![uuid::Uuid::new_v4().to_string(), src.id, now],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO persona_event_subscriptions (id, persona_id, event_type, source_filter, enabled, created_at, updated_at)
                 VALUES (?1, ?2, 'file_changed', NULL, 1, ?3, ?3)",
                params![uuid::Uuid::new_v4().to_string(), src.id, now],
            )
            .unwrap();
        }

        let (copy, summary) = duplicate(&pool, &src.id).unwrap();

        assert_eq!(copy.name, "Source (Copy)");
        assert_ne!(copy.id, src.id);
        assert_eq!(copy.design_context.as_deref(), Some(r#"{"summary":"src"}"#));
        assert_eq!(summary.triggers_copied, 2);
        assert_eq!(summary.subscriptions_copied, 1);

        let conn = pool.get().unwrap();
        // Copied triggers carry the new persona_id and are DISABLED.
        let (trig_count, enabled_count): (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(enabled), 0) FROM persona_triggers WHERE persona_id = ?1",
                params![copy.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(trig_count, 2, "both triggers copied");
        assert_eq!(enabled_count, 0, "copied triggers must be disabled");

        let (sub_count, sub_enabled): (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(enabled), 0) FROM persona_event_subscriptions WHERE persona_id = ?1",
                params![copy.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(sub_count, 1, "subscription copied");
        assert_eq!(sub_enabled, 0, "copied subscription must be disabled");

        // Source rows are untouched (still enabled).
        let src_enabled: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(enabled), 0) FROM persona_triggers WHERE persona_id = ?1",
                params![src.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(src_enabled, 2, "source triggers stay enabled");
    }

    #[test]
    fn test_duplicate_missing_source_errors() {
        let pool = init_test_db().unwrap();
        assert!(matches!(
            duplicate(&pool, "no-such-id"),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn test_blast_radius_reports_all_categories() {
        let pool = init_test_db().unwrap();
        let mut p_in = lifecycle_input("Blast", "You are blast-tested.");
        p_in.design_context = Some(
            r#"{"credentialLinks":{"gmail":"cred-1","slack":"cred-2"}}"#.into(),
        );
        let p = create(&pool, p_in).unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO persona_triggers (id, persona_id, trigger_type, config, enabled, created_at, updated_at)
                 VALUES (?1, ?2, 'schedule', NULL, 1, ?3, ?3)",
                params![uuid::Uuid::new_v4().to_string(), p.id, now],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO persona_event_subscriptions (id, persona_id, event_type, source_filter, enabled, created_at, updated_at)
                 VALUES (?1, ?2, 'file_changed', NULL, 1, ?3, ?3)",
                params![uuid::Uuid::new_v4().to_string(), p.id, now],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO persona_memories (id, persona_id, title, content, created_at, updated_at)
                 VALUES (?1, ?2, 'm', 'c', ?3, ?3)",
                params![uuid::Uuid::new_v4().to_string(), p.id, now],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO persona_events (id, event_type, source_type, source_id, created_at)
                 VALUES (?1, 'x', 'persona', ?2, ?3)",
                params![uuid::Uuid::new_v4().to_string(), p.id, now],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO persona_executions (id, persona_id, status, created_at)
                 VALUES (?1, ?2, 'running', ?3)",
                params![uuid::Uuid::new_v4().to_string(), p.id, now],
            )
            .unwrap();
        }

        let impacts = blast_radius(&pool, &p.id).unwrap();
        let cats: std::collections::HashSet<&str> =
            impacts.iter().map(|(c, _)| c.as_str()).collect();
        assert!(cats.contains("trigger"), "trigger impact present");
        assert!(cats.contains("subscription"), "subscription impact present");
        assert!(cats.contains("execution"), "running execution impact present");
        assert!(cats.contains("memory"), "NEW: memory impact present");
        assert!(cats.contains("event"), "NEW: event impact present");
        assert!(cats.contains("credential"), "NEW: credential impact present");

        // The credential count = 2 design_context links (+0 tool creds here).
        let cred = impacts
            .iter()
            .find(|(c, _)| c == "credential")
            .map(|(_, d)| d.clone())
            .unwrap();
        assert!(cred.contains('2'), "two credential links reported: {cred}");
    }

    #[test]
    fn test_lean_projection_blanks_heavy_fields_and_reports_reduction() {
        let pool = init_test_db().unwrap();

        // A representative persona with realistically large editor-only blobs.
        let big_prompt = "You are a meticulous operations analyst. ".repeat(60); // ~2.4 KB
        let structured = format!(
            r#"{{"identity":"You are a meticulous operations analyst.","instructions":"{}"}}"#,
            "Follow the runbook step by step and report anomalies. ".repeat(60)
        );
        let test_report = format!(
            r#"{{"tools":[{}]}}"#,
            (0..30)
                .map(|i| format!(r#"{{"tool":"t{i}","passed":true,"log":"{}"}}"#, "x".repeat(80)))
                .collect::<Vec<_>>()
                .join(",")
        );
        let notif = r#"[{"type":"email","config":{"to":"ops@example.com","template":"long-body-here-repeated-many-times"}}]"#;
        let params = r#"[{"id":"threshold","type":"number","default":42,"label":"Alert threshold"}]"#;
        // Kept-on-roster blobs (connector chips / widgets read these).
        let design_ctx = r#"{"summary":"kept","use_cases":[{"id":"u1","title":"Triage"}]}"#;
        let design_result = r#"{"suggested_connectors":["gmail","slack"],"capabilities":["triage"]}"#;

        let mut input = lifecycle_input("Heavy Persona", &big_prompt);
        input.structured_prompt = Some(structured.clone());
        input.notification_channels = Some(notif.to_string());
        input.design_context = Some(design_ctx.to_string());
        let p = create(&pool, input).unwrap();

        // Set the fields CreatePersonaInput doesn't carry directly.
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "UPDATE personas SET last_test_report = ?1, parameters = ?2, \
                 last_design_result = ?3 WHERE id = ?4",
                params![test_report, params, design_result, p.id],
            )
            .unwrap();
        }

        let full = get_by_id(&pool, &p.id).unwrap();
        let lean = get_all_lean(&pool)
            .unwrap()
            .into_iter()
            .find(|x| x.id == p.id)
            .expect("persona present in lean roster");

        // Heavy editor-only fields are blank on the lean row.
        assert_eq!(lean.system_prompt, "", "system_prompt blanked");
        assert_eq!(lean.structured_prompt, None, "structured_prompt blanked");
        assert_eq!(lean.last_test_report, None, "last_test_report blanked");
        assert_eq!(lean.notification_channels, None, "notification_channels blanked");
        assert_eq!(lean.parameters, None, "parameters blanked");

        // Kept fields survive on the lean row (roster consumers depend on them).
        assert_eq!(lean.design_context.as_deref(), Some(design_ctx));
        assert_eq!(lean.last_design_result.as_deref(), Some(design_result));

        // Light fields round-trip.
        assert_eq!(lean.name, "Heavy Persona");
        assert_eq!(lean.lifecycle, "active");
        assert!(lean.enabled);

        // The full row still carries everything (editor path unchanged).
        assert!(full.system_prompt.len() > 2000);
        assert_eq!(full.structured_prompt.as_deref(), Some(structured.as_str()));
        assert_eq!(full.last_test_report.as_deref(), Some(test_report.as_str()));

        // Measure the serialized IPC-payload reduction for this persona.
        let full_bytes = serde_json::to_string(&full).unwrap().len();
        let lean_bytes = serde_json::to_string(&lean).unwrap().len();
        assert!(
            lean_bytes < full_bytes,
            "lean row must serialize smaller ({lean_bytes} vs {full_bytes})"
        );
        let pct = 100.0 * (full_bytes - lean_bytes) as f64 / full_bytes as f64;
        println!(
            "[lean-projection] full={full_bytes}B lean={lean_bytes}B \
             saved={}B ({pct:.1}%) per persona",
            full_bytes - lean_bytes
        );
        // Sanity: the five blanked blobs are the bulk of the savings.
        assert!(
            full_bytes - lean_bytes > 3000,
            "expected a multi-KB reduction, got {}B",
            full_bytes - lean_bytes
        );
    }

    #[test]
    fn test_bulk_delete_outcomes_incl_protected() {
        let pool = init_test_db().unwrap();
        let a = create(&pool, lifecycle_input("BulkA", "Real.")).unwrap();
        let sys = create(&pool, lifecycle_input("BulkSys", "Real.")).unwrap();
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "UPDATE personas SET trust_origin = 'system' WHERE id = ?1",
                params![sys.id],
            )
            .unwrap();
        }
        let outcomes = bulk_delete_personas(
            &pool,
            &[a.id.clone(), sys.id.clone(), "does-not-exist".to_string()],
        )
        .unwrap();
        let by_id = |id: &str| outcomes.iter().find(|o| o.id == id).unwrap();
        assert_eq!(by_id(&a.id).status, "deleted");
        assert_eq!(by_id(&sys.id).status, "protected");
        assert_eq!(by_id("does-not-exist").status, "failed");
        // Real deletes happened; system persona survives.
        assert!(get_by_id(&pool, &a.id).is_err());
        assert!(get_by_id(&pool, &sys.id).is_ok());
    }

    #[test]
    fn test_delete_draft_guard_survives_executions() {
        let pool = init_test_db().unwrap();
        let mut d_in = lifecycle_input("Guarded", "You are a helpful AI assistant.");
        d_in.lifecycle = Some("draft".into());
        let d = create(&pool, d_in).unwrap();

        // Seed an execution row so the guard must decline.
        {
            let conn = pool.get().unwrap();
            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO persona_executions (id, persona_id, status, created_at)
                 VALUES (?1, ?2, 'completed', ?3)",
                params![uuid::Uuid::new_v4().to_string(), d.id, now],
            )
            .unwrap();
        }
        assert_eq!(
            delete_draft_if_safe(&pool, &d.id).unwrap(),
            false,
            "a draft with executions must NOT be swept"
        );
        assert!(get_by_id(&pool, &d.id).is_ok());

        // A clean draft (no executions) IS deletable.
        let mut c_in = lifecycle_input("Clean", "You are a helpful AI assistant.");
        c_in.lifecycle = Some("draft".into());
        let c = create(&pool, c_in).unwrap();
        assert_eq!(delete_draft_if_safe(&pool, &c.id).unwrap(), true);
        assert!(get_by_id(&pool, &c.id).is_err());

        // An ACTIVE persona is never swept by this guard.
        let act = create(&pool, lifecycle_input("Act", "Real.")).unwrap();
        assert_eq!(delete_draft_if_safe(&pool, &act.id).unwrap(), false);
    }

    #[test]
    fn test_sweep_stale_drafts_off_by_default() {
        let pool = init_test_db().unwrap();
        let mut d_in = lifecycle_input("Old Draft", "You are a helpful AI assistant.");
        d_in.lifecycle = Some("draft".into());
        let d = create(&pool, d_in).unwrap();
        // Backdate creation well past any retention window.
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "UPDATE personas SET created_at = '2000-01-01T00:00:00Z' WHERE id = ?1",
                params![d.id],
            )
            .unwrap();
        }
        // retention 0 = disabled → no sweep.
        assert_eq!(sweep_stale_drafts(&pool, 0).unwrap(), 0);
        assert!(get_by_id(&pool, &d.id).is_ok(), "off-by-default must not sweep");

        // With a positive retention the old clean draft IS swept.
        assert_eq!(sweep_stale_drafts(&pool, 7).unwrap(), 1);
        assert!(get_by_id(&pool, &d.id).is_err());
    }
}
