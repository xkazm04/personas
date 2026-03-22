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

/// Per-persona auto-rollback setting prefix. The full key is
/// `auto_rollback:<persona_id>`, with value `"true"` or `"false"`.
/// When enabled, the auto-rollback subscription checks whether the current
/// prompt version's error rate exceeds 2x the previous version's rate.
pub const AUTO_ROLLBACK_PREFIX: &str = "auto_rollback:";
