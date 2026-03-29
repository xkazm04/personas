/// Canonical settings key constants for `app_settings` table.
///
/// Use these instead of raw string literals to prevent typo-based key mismatches.
///
/// Ollama Cloud API key (free tier models like Qwen3, GLM-5, Kimi K2.5).
pub const OLLAMA_API_KEY: &str = "ollama_api_key";

/// LiteLLM proxy base URL (e.g., `http://localhost:4000`).
pub const LITELLM_BASE_URL: &str = "litellm_base_url";

/// LiteLLM proxy master authentication key (`sk-...`).
pub const LITELLM_MASTER_KEY: &str = "litellm_master_key";

/// Active CLI engine: `"claude_code"` or `"codex_cli"`.
pub const CLI_ENGINE: &str = "cli_engine";

/// Event retention period in days. Events older than this are purged by the
/// cleanup subscription. Default: 30.
pub const EVENT_RETENTION_DAYS: &str = "event_retention_days";

/// Execution retention period in days. Executions older than this are purged
/// by the background cleanup task. Default: 60 (two months).
pub const EXECUTION_RETENTION_DAYS: &str = "execution_retention_days";

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
/// CPU spikes during FS bursts (IDE auto-save, git operations). Default: 500.
#[allow(dead_code)]
pub const FILE_WATCHER_DEBOUNCE_MS: &str = "file_watcher_debounce_ms";

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
/// Value: model ID string (e.g., `"claude-haiku-4-5-20251001"`).
/// Defaults to `claude-haiku-4-5-20251001` when unset.
pub const SMART_SEARCH_MODEL: &str = "smart_search_model";

/// Claude CLI fallback scheduling flag. Key: `claude_cli_fallback:<persona_id>`.
/// Value: JSON `{"enabled":true,"cron":"..."}`.
/// When enabled, provides a generated `claude -p` command for external cron scheduling.
#[allow(dead_code)]
pub const CLAUDE_CLI_FALLBACK_PREFIX: &str = "claude_cli_fallback:";
