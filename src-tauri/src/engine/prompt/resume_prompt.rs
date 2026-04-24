//! Lightweight prompt for `--resume` continuations.

use super::ResolvedConnectorHint;

/// Assemble a lighter prompt for session-resume executions.
///
/// When using `--resume`, the Claude CLI session already has the full persona
/// context. We only send new input data and credential hints.
pub fn assemble_resume_prompt(
    input_data: Option<&serde_json::Value>,
    credential_hints: Option<&[&str]>,
    connector_usage_hints: Option<&[ResolvedConnectorHint]>,
) -> String {
    let mut prompt = String::new();

    prompt.push_str("Continue the previous execution.\n\n");

    if let Some(hints) = credential_hints {
        if !hints.is_empty() {
            prompt.push_str("## Available Credentials (via proxy)\n");
            prompt.push_str("Use the credential proxy as described earlier. Credential IDs:\n");
            for hint in hints {
                prompt.push_str(&format!("- {hint}\n"));
            }
            prompt.push('\n');
        }
    }

    // Resume prompts skip the full Connector Usage Reference header because
    // the resumed session already has that context from the initial run.
    // We re-emit a compact reminder only if any hint has a non-empty overview.
    if let Some(connector_hints) = connector_usage_hints {
        if !connector_hints.is_empty() {
            prompt.push_str("## Connector Usage Reference (reminder)\n");
            for entry in connector_hints {
                prompt.push_str(&format!("- **{}**: {}\n", entry.label, entry.hint.overview));
            }
            prompt.push('\n');
        }
    }

    if let Some(data) = input_data {
        prompt.push_str("## Input Data\n```json\n");
        prompt.push_str(&serde_json::to_string_pretty(data).unwrap_or_else(|_| data.to_string()));
        prompt.push_str("\n```\n");
    }

    prompt
}
