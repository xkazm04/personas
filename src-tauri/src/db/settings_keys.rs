//! Canonical settings key constants for the `app_settings` table.
//!
//! Use these instead of raw string literals to prevent typo-based key mismatches.
//!
//! ## Defaults and units
//!
//! Every key defined here is paired with a `<KEY>_DEFAULT` constant that holds
//! the fallback value used when the row is missing from `app_settings`. Consumers
//! MUST reference the `_DEFAULT` constant rather than hard-coding a literal, so
//! that "what does unset mean for this key?" has exactly one answer. Units are
//! encoded in the key name itself (`_DAYS`, `_MS`, ...) — do not rename a key
//! without also changing the unit.
//!
//! ## Validation
//!
//! - [`validate_key`] — rejects unknown keys and malformed prefix keys.
//! - [`validate_value`] — rejects malformed values for keys with a typed
//!   contract (numeric retention values, ms durations, ...).
//!
//! Both are enforced in [`crate::db::repos::core::settings::set`] so that the
//! repo layer cannot be bypassed by internal callers.

// =============================================================================
// Exact keys
// =============================================================================

/// Ollama Cloud API key (free tier models like Qwen3, GLM-5, Kimi K2.5).
pub const OLLAMA_API_KEY: &str = "ollama_api_key";

/// LiteLLM proxy base URL (e.g., `http://localhost:4000`).
pub const LITELLM_BASE_URL: &str = "litellm_base_url";

/// LiteLLM proxy master authentication key (`sk-...`).
pub const LITELLM_MASTER_KEY: &str = "litellm_master_key";

/// Active CLI engine: `"claude_code"` or `"codex_cli"`.
pub const CLI_ENGINE: &str = "cli_engine";

/// Event retention period in days. Events older than this are purged by the
/// cleanup subscription.
pub const EVENT_RETENTION_DAYS: &str = "event_retention_days";
/// Default retention in days for [`EVENT_RETENTION_DAYS`].
pub const EVENT_RETENTION_DAYS_DEFAULT: i64 = 30;

/// Execution retention period in days. Executions older than this are purged
/// by the background cleanup task.
pub const EXECUTION_RETENTION_DAYS: &str = "execution_retention_days";
/// Default retention in days for [`EXECUTION_RETENTION_DAYS`] (two months).
pub const EXECUTION_RETENTION_DAYS_DEFAULT: i64 = 60;

/// Per-persona execution retention override (in months).
/// Key format: `execution_retention_months:<persona_id>`, value: number string.
/// When set, overrides the global retention for that persona.
#[allow(dead_code)]
pub const EXECUTION_RETENTION_MONTHS_PREFIX: &str = "execution_retention_months:";

/// Per-persona auto-rollback setting prefix. The full key is
/// `auto_rollback:<persona_id>`, with value `"true"` or `"false"`.
/// When enabled, the auto-rollback subscription checks whether the current
/// prompt version's error rate exceeds 2x the previous version's rate.
pub const AUTO_ROLLBACK_PREFIX: &str = "auto_rollback:";

/// Global default model profile (JSON-encoded ModelProfile).
/// Used as the lowest-priority fallback in the hierarchical config cascade:
/// global → workspace → agent.
pub const GLOBAL_MODEL_PROFILE: &str = "global_model_profile";

/// File watcher debounce window in milliseconds. Events for the same path
/// are suppressed for this duration after the first trigger match, reducing
/// CPU spikes during FS bursts (IDE auto-save, git operations).
#[allow(dead_code)]
pub const FILE_WATCHER_DEBOUNCE_MS: &str = "file_watcher_debounce_ms";
/// Default debounce window in milliseconds for [`FILE_WATCHER_DEBOUNCE_MS`].
#[allow(dead_code)]
pub const FILE_WATCHER_DEBOUNCE_MS_DEFAULT: u64 = 500;

/// Per-persona auto-optimization setting prefix. Key: `auto_optimize:<persona_id>`.
/// Value: JSON `{"enabled":true,"cron":"0 2 * * 0","min_score":80,"models":["sonnet"]}`.
/// When enabled, a weekly arena test runs and auto-improves the prompt if scores are below min_score.
pub const AUTO_OPTIMIZE_PREFIX: &str = "auto_optimize:";

/// Per-persona health watch setting prefix. Key: `health_watch:<persona_id>`.
/// Value: JSON `{"enabled":true,"interval_hours":6,"error_threshold":30}`.
/// When enabled, periodic health checks run and send notifications on degradation.
pub const HEALTH_WATCH_PREFIX: &str = "health_watch:";

/// Performance digest configuration (JSON-encoded DigestConfig).
/// Controls cadence (daily/weekly), enabled state, and notification channels.
pub const PERFORMANCE_DIGEST: &str = "performance_digest";

/// ISO 8601 timestamp of the last performance digest delivery.
pub const PERFORMANCE_DIGEST_LAST: &str = "performance_digest_last";

/// Quality-gate configuration (JSON-encoded QualityGateConfig).
/// Controls which substring patterns cause AgentMemory and ManualReview
/// messages to be rejected, tagged, or warned during dispatch.
pub const QUALITY_GATE_CONFIG: &str = "quality_gate_config";

/// Model override for smart search template ranking.
/// Value: model ID string.
pub const SMART_SEARCH_MODEL: &str = "smart_search_model";
/// Default model ID for [`SMART_SEARCH_MODEL`] when unset.
pub const SMART_SEARCH_MODEL_DEFAULT: &str = "claude-haiku-4-5-20251001";

/// Model override for the LLM-assisted semantic vault lint.
/// Value: model ID string.
pub const SEMANTIC_LINT_MODEL: &str = "semantic_lint_model";
/// Default model ID for [`SEMANTIC_LINT_MODEL`] when unset.
pub const SEMANTIC_LINT_MODEL_DEFAULT: &str = "claude-haiku-4-5-20251001";

/// Whether the weekly health digest is enabled. Value: `"true"` or `"false"`.
pub const HEALTH_DIGEST_ENABLED: &str = "health_digest_enabled";

/// ISO 8601 timestamp of the last health digest run.
pub const HEALTH_DIGEST_LAST_RUN: &str = "health_digest_last_run";

/// JSON-encoded notification preferences (healing severity thresholds).
pub const NOTIFICATION_PREFS: &str = "notification_prefs";

/// JSON-encoded CLI engine capability map (which operations each provider supports).
pub const ENGINE_CAPABILITIES: &str = "engine_capabilities";

/// BYOM (Bring Your Own Model) policy configuration (JSON-encoded ByomPolicy).
pub const BYOM_POLICY: &str = "byom_policy";

/// GitLab pipeline notification preferences (JSON-encoded).
pub const GITLAB_PIPELINE_NOTIFICATION_PREFS: &str = "gitlab_pipeline_notification_prefs";

/// Obsidian Brain vault configuration (JSON-encoded ObsidianVaultConfig).
pub const OBSIDIAN_BRAIN_CONFIG: &str = "obsidian_brain_config";

/// Dev-tools cross-project metadata cache (JSON-encoded).
/// Written by `infrastructure::dev_tools` to surface multi-project context to
/// agents connecting via the management API.
pub const DEV_TOOLS_CROSS_PROJECT_METADATA: &str = "dev_tools_cross_project_metadata";

/// Exact keys allowed in the settings store.
const ALLOWED_KEYS: &[&str] = &[
    OLLAMA_API_KEY,
    LITELLM_BASE_URL,
    LITELLM_MASTER_KEY,
    CLI_ENGINE,
    EVENT_RETENTION_DAYS,
    EXECUTION_RETENTION_DAYS,
    GLOBAL_MODEL_PROFILE,
    FILE_WATCHER_DEBOUNCE_MS,
    PERFORMANCE_DIGEST,
    PERFORMANCE_DIGEST_LAST,
    QUALITY_GATE_CONFIG,
    SMART_SEARCH_MODEL,
    SEMANTIC_LINT_MODEL,
    HEALTH_DIGEST_ENABLED,
    HEALTH_DIGEST_LAST_RUN,
    NOTIFICATION_PREFS,
    ENGINE_CAPABILITIES,
    BYOM_POLICY,
    GITLAB_PIPELINE_NOTIFICATION_PREFS,
    OBSIDIAN_BRAIN_CONFIG,
    DEV_TOOLS_CROSS_PROJECT_METADATA,
];

/// Prefix patterns for per-persona dynamic keys (e.g. `auto_rollback:<persona_id>`).
///
/// ## Contract for prefix keys
///
/// Every key matching a prefix in this list MUST be of the form
/// `<prefix><non-empty persona_id>` where the suffix contains only ASCII
/// alphanumerics plus `-` and `_`. Empty suffixes (`"auto_rollback:"` alone)
/// and suffixes containing whitespace, colons, or other punctuation are
/// rejected by [`validate_key`] so that downstream subscriptions can safely
/// strip the prefix and use the suffix as a persona_id.
const ALLOWED_PREFIXES: &[&str] = &[
    EXECUTION_RETENTION_MONTHS_PREFIX,
    AUTO_ROLLBACK_PREFIX,
    AUTO_OPTIMIZE_PREFIX,
    HEALTH_WATCH_PREFIX,
];

/// Returns true if `suffix` is a syntactically acceptable persona_id-shaped
/// suffix for a prefix key. Requires non-empty ASCII alphanumerics plus `-`/`_`.
fn is_valid_prefix_suffix(suffix: &str) -> bool {
    !suffix.is_empty()
        && suffix
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Returns `Ok(())` if the key is in the allow-list (exact match) or is a
/// well-formed prefix key (`prefix:<non-empty persona_id>`).
/// Returns `Err` with a descriptive message otherwise.
pub fn validate_key(key: &str) -> Result<(), String> {
    if ALLOWED_KEYS.contains(&key) {
        return Ok(());
    }
    for prefix in ALLOWED_PREFIXES {
        if let Some(suffix) = key.strip_prefix(*prefix) {
            if suffix.is_empty() {
                return Err(format!(
                    "settings key '{key}' is missing the <persona_id> suffix after prefix '{prefix}'"
                ));
            }
            if !is_valid_prefix_suffix(suffix) {
                return Err(format!(
                    "settings key '{key}' has an invalid persona_id suffix after prefix '{prefix}' \
                     (allowed: ASCII alphanumerics, '-', '_')"
                ));
            }
            return Ok(());
        }
    }
    Err(format!("unknown settings key: {key}"))
}

/// Validate that the value is well-formed for keys with a typed contract.
/// Keys without a typed contract accept any value (the 64 KB limit is enforced
/// separately at the command layer).
///
/// Currently validates:
/// - `EVENT_RETENTION_DAYS`, `EXECUTION_RETENTION_DAYS` → non-negative integer (u32 range)
/// - `FILE_WATCHER_DEBOUNCE_MS` → non-negative integer (u32 range, milliseconds)
pub fn validate_value(key: &str, value: &str) -> Result<(), String> {
    match key {
        EVENT_RETENTION_DAYS | EXECUTION_RETENTION_DAYS => value
            .parse::<u32>()
            .map(|_| ())
            .map_err(|_| format!("value for '{key}' must be a non-negative integer (days), got {value:?}")),
        FILE_WATCHER_DEBOUNCE_MS => value
            .parse::<u32>()
            .map(|_| ())
            .map_err(|_| format!("value for '{key}' must be a non-negative integer (milliseconds), got {value:?}")),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_key_accepted() {
        assert!(validate_key("cli_engine").is_ok());
        assert!(validate_key("byom_policy").is_ok());
        assert!(validate_key("health_digest_enabled").is_ok());
        assert!(validate_key("dev_tools_cross_project_metadata").is_ok());
    }

    #[test]
    fn well_formed_prefix_key_accepted() {
        assert!(validate_key("auto_rollback:abc-123").is_ok());
        assert!(validate_key("health_watch:some_persona_42").is_ok());
        assert!(validate_key("execution_retention_months:xyz").is_ok());
    }

    #[test]
    fn bare_prefix_rejected() {
        // No suffix → not a valid per-persona key.
        assert!(validate_key("auto_rollback:").is_err());
        assert!(validate_key("health_watch:").is_err());
        assert!(validate_key("auto_optimize:").is_err());
    }

    #[test]
    fn malformed_prefix_suffix_rejected() {
        // Whitespace, additional colons, and punctuation are not allowed in persona_id suffixes.
        assert!(validate_key("auto_rollback:bad id").is_err());
        assert!(validate_key("auto_rollback:bad:id").is_err());
        assert!(validate_key("auto_rollback:bad/id").is_err());
    }

    #[test]
    fn unknown_key_rejected() {
        assert!(validate_key("evil_key").is_err());
        assert!(validate_key("").is_err());
        assert!(validate_key("cli_engine_extra").is_err());
    }

    #[test]
    fn numeric_value_validation() {
        assert!(validate_value(EVENT_RETENTION_DAYS, "30").is_ok());
        assert!(validate_value(EVENT_RETENTION_DAYS, "0").is_ok());
        assert!(validate_value(EVENT_RETENTION_DAYS, "30d").is_err());
        assert!(validate_value(EVENT_RETENTION_DAYS, "").is_err());
        assert!(validate_value(EVENT_RETENTION_DAYS, " 30 ").is_err());
        assert!(validate_value(EXECUTION_RETENTION_DAYS, "-5").is_err());
        assert!(validate_value(FILE_WATCHER_DEBOUNCE_MS, "500").is_ok());
        assert!(validate_value(FILE_WATCHER_DEBOUNCE_MS, "500ms").is_err());
    }

    #[test]
    fn unknown_keys_skip_value_validation() {
        // Keys without a typed contract accept any value shape.
        assert!(validate_value(CLI_ENGINE, "whatever").is_ok());
        assert!(validate_value(BYOM_POLICY, "{malformed").is_ok());
    }
}
