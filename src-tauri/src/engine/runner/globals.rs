//! App-wide settings fallback + default result shape.
//!
//! These helpers bridge between the per-persona `ModelProfile` (stored on the
//! persona row) and global provider settings (stored in the app settings DB).
//! When a persona doesn't specify a provider's base_url / API key, we fall
//! back to the app-wide value — and a few callers also need a canonical "all
//! fields zeroed" `ExecutionResult` to short-circuit with.

use crate::db::settings_keys;
use crate::db::DbPool;

use super::super::types::*;

/// Apply a global settings value to a profile field when the field is empty.
pub(super) fn apply_global_setting(pool: &DbPool, field: &mut Option<String>, settings_key: &str) {
    let needs_global = field.as_ref().map_or(true, |v| v.is_empty());
    if needs_global {
        if let Ok(Some(value)) = crate::db::repos::core::settings::get(pool, settings_key) {
            if !value.is_empty() {
                *field = Some(value);
            }
        }
    }
}

/// Resolve global provider settings (API keys, base URLs) from the app settings DB
/// when the per-persona model profile doesn't specify them.
pub(super) fn resolve_global_provider_settings(pool: &DbPool, profile: &mut ModelProfile) {
    match profile.provider.as_deref() {
        Some(providers::OLLAMA) => {
            apply_global_setting(pool, &mut profile.auth_token, settings_keys::OLLAMA_API_KEY);
        }
        Some(providers::LITELLM) => {
            apply_global_setting(pool, &mut profile.base_url, settings_keys::LITELLM_BASE_URL);
            apply_global_setting(pool, &mut profile.auth_token, settings_keys::LITELLM_MASTER_KEY);
        }
        _ => {}
    }
}

/// Canonical "everything unset" `ExecutionResult`. Call sites that fail early
/// (validation error, credential decryption failure, spawn failure) use this
/// plus field overrides to surface the error without hand-filling a dozen
/// zero-valued fields every time.
pub(super) fn default_result() -> ExecutionResult {
    ExecutionResult {
        success: false,
        output: None,
        error: None,
        session_limit_reached: false,
        log_file_path: None,
        claude_session_id: None,
        duration_ms: 0,
        execution_flows: None,
        model_used: None,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0.0,
        tool_steps: None,
        trace_id: None,
        execution_config: None,
        log_truncated: false,
    }
}
