/// Canonical settings key constants for `app_settings` table.
///
/// Use these instead of raw string literals to prevent typo-based key mismatches.

/// Ollama Cloud API key (free tier models like Qwen3, GLM-5, Kimi K2.5).
pub const OLLAMA_API_KEY: &str = "ollama_api_key";

/// LiteLLM proxy base URL (e.g., `http://localhost:4000`).
pub const LITELLM_BASE_URL: &str = "litellm_base_url";

/// LiteLLM proxy master authentication key (`sk-...`).
pub const LITELLM_MASTER_KEY: &str = "litellm_master_key";
