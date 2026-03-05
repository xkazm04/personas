//! LLM-powered recipe execution via the AI artifact flow.
//!
//! Sends the rendered prompt to Claude CLI and streams the result back.

use crate::commands::credentials::ai_artifact_flow::AiArtifactMessages;

// ── Messages ────────────────────────────────────────────────────

pub const RECIPE_EXECUTION_MESSAGES: AiArtifactMessages = AiArtifactMessages {
    status_event: "recipe-execution-status",
    progress_event: "recipe-execution-progress",
    id_field: "execution_id",
    initial_status: "executing",
    init_progress: "Connecting to Claude...",
    streaming_progress: "Executing recipe...",
    complete_prefix: "Execution complete",
    success_progress: "Recipe executed successfully",
    extraction_failed_error:
        "Failed to capture execution output. The recipe may have produced no output.",
    log_label: "recipe_execution",
    timeout_secs: 120,
};

// ── Extractor ───────────────────────────────────────────────────

/// Wraps the entire LLM text output as `{ "output": "..." }`.
/// Unlike other extractors, we don't look for specific JSON keys — the full
/// response is the result.
pub fn extract_recipe_execution_result(output: &str) -> Option<serde_json::Value> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(serde_json::json!({ "output": trimmed }))
}
