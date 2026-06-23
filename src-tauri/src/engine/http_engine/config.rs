//! Static config for the remote HTTP engine: endpoints, pricing, and the
//! remote-safe tool allowlists.

/// Default DashScope (international) OpenAI-compatible endpoint.
pub const DEFAULT_BASE_URL: &str = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
/// Default model when a capability/persona doesn't pin one.
pub const DEFAULT_MODEL: &str = "qwen3-coder-plus";
/// Generous timeout — LLM generations (esp. reasoning models) are slow; the
/// outer `run_execution_with_ceiling` still caps total wall time.
pub(super) const HTTP_TIMEOUT_SECS: u64 = 600;
/// Max model⇄tool round-trips before we give up (prevents runaway loops).
pub(super) const MAX_TOOL_ITERS: usize = 6;
/// Cap on a single http_get response fed back to the model.
pub(super) const HTTP_GET_MAX_BYTES: usize = 16 * 1024;

/// Whether a `ModelProfile.provider` string selects this remote HTTP path.
/// Phase 1: Qwen / DashScope only. Adding OpenAI/Gemini later is a one-line
/// extension here plus a price-table entry.
pub fn is_remote_http_provider(provider: &str) -> bool {
    matches!(provider.trim().to_ascii_lowercase().as_str(), "qwen" | "dashscope")
}

/// Per-1M-token USD pricing (verified Sep-2025 SKUs). Unknown models -> None,
/// which the callers stamp as $0 (configure when the price is confirmed).
pub(super) fn price_per_million(model: &str) -> Option<(f64, f64)> {
    match model {
        "qwen3-coder-plus" => Some((0.65, 3.25)),
        "qwen3-max" => Some((0.78, 3.90)),
        _ => None,
    }
}

pub(super) fn cost_of(model: &str, in_tok: u64, out_tok: u64) -> f64 {
    match price_per_million(model) {
        Some((pin, pout)) => (in_tok as f64 / 1e6) * pin + (out_tok as f64 / 1e6) * pout,
        None => 0.0,
    }
}

/// MCP tools safe to expose to a REMOTE model: read-only DB / knowledge /
/// context queries with no external side effects. Write/exec/connector tools
/// (personas_execute, *_write_*, drive_*, gmail_*/gdrive_*/gcalendar_*,
/// llm_delegate) are deliberately withheld — a prompt-injected remote model must
/// not be able to trigger them, and connector tools also need the local
/// credential bridge (Phase 3b-connectors).
pub(super) const REMOTE_SAFE_MCP_TOOLS: &[&str] = &[
    "personas_list", "personas_get", "personas_status", "personas_result", "personas_health",
    "personas_knowledge_search", "personas_search_executions", "personas_list_templates",
    "context_list_groups", "context_search_by_keyword", "context_get_by_file_path", "context_neighbors",
    "arena_list_models", "arena_list_runs", "arena_run_status", "arena_get_results",
    "obsidian_vault_search",
    // Bounded write: lets a running persona post its own summary to Messages.
    "post_message",
];

/// Connector MCP tools (Gmail/Drive/Calendar) — opt-in via the
/// `qwen_connector_tools` setting (default OFF). They route through the desktop
/// credential proxy on :9420 (credentials stay local; only args + results cross
/// to the model). Off by default because enabling sends connector RESULTS (e.g.
/// email content) to the remote provider — a per-team data-residency decision.
pub(super) const CONNECTOR_TOOLS: &[&str] = &[
    "gmail_list_messages", "gmail_get_message",
    "gdrive_list_files", "gdrive_get_file",
    "gcalendar_list_events",
];

/// Whether a tool name may be exposed to the remote engine.
pub(super) fn tool_allowed(name: &str, connectors_on: bool) -> bool {
    REMOTE_SAFE_MCP_TOOLS.contains(&name) || (connectors_on && CONNECTOR_TOOLS.contains(&name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_only_remote_providers() {
        assert!(is_remote_http_provider("qwen"));
        assert!(is_remote_http_provider("Qwen"));
        assert!(is_remote_http_provider("  dashscope  "));
        assert!(!is_remote_http_provider("claude"));
        assert!(!is_remote_http_provider("anthropic"));
        assert!(!is_remote_http_provider("ollama"));
        assert!(!is_remote_http_provider(""));
    }

    #[test]
    fn prices_known_models_only() {
        assert_eq!(price_per_million("qwen3-coder-plus"), Some((0.65, 3.25)));
        assert!(price_per_million("qwen3-max").is_some());
        assert_eq!(price_per_million("qwen3.7-plus"), None); // unverified SKU -> $0 stamp
        assert_eq!(price_per_million("unknown"), None);
    }

    #[test]
    fn connector_tools_gated_and_disjoint() {
        // Safe read-only MCP tools are always allowed.
        assert!(tool_allowed("personas_health", false));
        // Connector tools only when explicitly opted in.
        assert!(!tool_allowed("gmail_list_messages", false));
        assert!(tool_allowed("gmail_list_messages", true));
        // Write/exec tools are never exposed, even with connectors on.
        assert!(!tool_allowed("personas_execute", true));
        assert!(!tool_allowed("drive_write_text", true));
        // The safe and connector lists must not overlap.
        for t in CONNECTOR_TOOLS {
            assert!(!REMOTE_SAFE_MCP_TOOLS.contains(t), "{t} double-listed");
        }
    }
}
