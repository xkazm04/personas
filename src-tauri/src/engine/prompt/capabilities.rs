//! Shared helpers that derive structured info from a persona or its tools.

use super::super::types::ModelProfile;
use crate::db::models::PersonaToolDefinition;

/// Parse the model_profile JSON string into a ModelProfile struct.
/// Returns None if the input is None, empty, or invalid JSON.
pub fn parse_model_profile(json: Option<&str>) -> Option<ModelProfile> {
    let json_str = json?.trim();
    if json_str.is_empty() {
        return None;
    }
    serde_json::from_str::<ModelProfile>(json_str).ok()
}

/// Render the "## Active Capabilities" section for the runtime prompt.
///
/// Reads the persona's `design_context` JSON, filters use cases by
/// `enabled != Some(false)` (missing or `true` both count as active), and
/// renders each with `capability_summary` (falling back to `description`).
/// Trigger hint and `tool_hints` are appended when present.
///
/// Returns empty when `design_context` is missing, unparseable, or contains
/// no enabled use cases — callers push the result unconditionally.
///
/// Phase C1 runtime foundation. See `docs/concepts/persona-capabilities/03-runtime.md`.
pub fn render_active_capabilities(design_context: Option<&str>) -> String {
    let Some(dc_json) = design_context else { return String::new(); };
    let Ok(dc) = serde_json::from_str::<serde_json::Value>(dc_json) else { return String::new(); };
    let Some(use_cases) = dc.get("use_cases").and_then(|v| v.as_array()) else { return String::new(); };
    if use_cases.is_empty() { return String::new(); }

    let mut out = String::new();
    let mut rendered = 0usize;

    for uc in use_cases {
        // Disabled only when explicitly `enabled == false`. Missing or true → active.
        if uc.get("enabled").and_then(|v| v.as_bool()) == Some(false) { continue; }

        let title = uc.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled");
        let summary = uc
            .get("capability_summary")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .or_else(|| uc.get("description").and_then(|v| v.as_str()))
            .unwrap_or("");

        if rendered == 0 {
            out.push_str("## Active Capabilities\n");
            out.push_str(
                "You have these active capabilities. Choose the right one for each request; each capability has its own trigger, inputs, and delivery channels.\n\n",
            );
        }

        out.push_str(&format!("- **{}**: {}", title, summary));

        if let Some(st) = uc.get("suggested_trigger") {
            if let Some(desc) = st.get("description").and_then(|v| v.as_str()) {
                if !desc.is_empty() {
                    out.push_str(&format!(" _(trigger: {})_", desc));
                }
            } else if let Some(t) = st.get("type").and_then(|v| v.as_str()) {
                out.push_str(&format!(" _(trigger: {})_", t));
            }
        }

        if let Some(hints) = uc.get("tool_hints").and_then(|v| v.as_array()) {
            let names: Vec<&str> = hints.iter().filter_map(|h| h.as_str()).collect();
            if !names.is_empty() {
                out.push_str(&format!(" _(tools: {})_", names.join(", ")));
            }
        }

        out.push('\n');

        // v3.1 — per-UC error-handling subsection. Authors frequently write
        // capability-specific failure recipes ("GitHub 422 branch-exists →
        // suffix counter; max 3 test-fix iters then abort") that the
        // persona-wide errorHandling section can't capture. Render indented
        // under the bullet so the LLM sees them attached to the capability
        // they apply to.
        if let Some(eh) = uc.get("error_handling").and_then(|v| v.as_str()) {
            let trimmed = eh.trim();
            if !trimmed.is_empty() {
                out.push_str("  _Error handling:_ ");
                out.push_str(trimmed);
                out.push('\n');
            }
        }

        rendered += 1;
    }

    if rendered > 0 {
        out.push('\n');
    }

    out
}

/// Fingerprint of the persona's currently-enabled capabilities.
///
/// Used by the session pool cache key so toggling a capability invalidates
/// warm sessions. Stable under reordering: use case ids are sorted before
/// being joined. Returns empty string when design_context is absent / empty
/// so personas without capabilities don't carry bogus hash input.
///
/// Phase C1. See `docs/concepts/persona-capabilities/03-runtime.md` §3.
pub fn active_capabilities_fingerprint(design_context: Option<&str>) -> String {
    let Some(dc_json) = design_context else { return String::new(); };
    let Ok(dc) = serde_json::from_str::<serde_json::Value>(dc_json) else { return String::new(); };
    let Some(use_cases) = dc.get("use_cases").and_then(|v| v.as_array()) else { return String::new(); };

    let mut entries: Vec<String> = use_cases
        .iter()
        .filter(|uc| uc.get("enabled").and_then(|v| v.as_bool()) != Some(false))
        .filter_map(|uc| {
            let id = uc.get("id").and_then(|v| v.as_str())?;
            let title = uc.get("title").and_then(|v| v.as_str()).unwrap_or("");
            Some(format!("{}@{}", id, title))
        })
        .collect();
    entries.sort();
    entries.join("|")
}

/// Phase C5b — render the per-capability generation policy as natural-language
/// bullet points the LLM can act on. Returns an empty Vec when the JSON object
/// has no recognised fields, so the caller can skip the surrounding header.
///
/// This is the SOFT layer of the two-layer enforcement model. The HARD layer
/// is `engine::dispatch::testable::resolve_generation_policy` which silently
/// drops protocol messages that violate the policy — required because LLMs
/// occasionally ignore even explicit instructions.
pub fn render_generation_policy_lines(settings: Option<&serde_json::Value>) -> Vec<String> {
    let Some(s) = settings.filter(|v| !v.is_null()) else { return Vec::new(); };
    let mut lines = Vec::new();

    if let Some(v) = s.get("memories").and_then(|v| v.as_str()) {
        if v.eq_ignore_ascii_case("off") {
            lines.push(
                "Do not write to agent memory for this capability. The persona has memories \
                 from other capabilities; do not extend them from this run.".to_string(),
            );
        }
    }
    if let Some(v) = s.get("reviews").and_then(|v| v.as_str()) {
        match v.to_ascii_lowercase().as_str() {
            "off" => lines.push(
                "Do not request manual review for this capability. Resolve uncertainty \
                 with your own best judgment and proceed.".to_string(),
            ),
            "trust_llm" | "trustllm" | "trust-llm" => lines.push(
                "Trust your own judgment for this capability. If you would normally \
                 request manual review, proceed instead — your decisions will not be queued \
                 for human approval.".to_string(),
            ),
            _ => {}
        }
    }
    if let Some(v) = s.get("events").and_then(|v| v.as_str()) {
        if v.eq_ignore_ascii_case("off") {
            lines.push(
                "Do not emit events for this capability. Other personas will not be \
                 notified of your actions on this run.".to_string(),
            );
        }
    }
    if let Some(map) = s.get("event_aliases").and_then(|v| v.as_object()) {
        let pairs: Vec<String> = map
            .iter()
            .filter_map(|(k, v)| v.as_str().map(|tgt| format!("{} → {}", k, tgt)))
            .collect();
        if !pairs.is_empty() {
            lines.push(format!(
                "When emitting events, use these renamed names: {}",
                pairs.join(", ")
            ));
        }
    }

    lines
}

/// Build documentation string for a single tool definition.
pub fn build_tool_documentation(tool: &PersonaToolDefinition) -> String {
    let mut doc = format!("### {}\n{}\n", tool.name, tool.description);
    doc.push_str(&format!("**Category**: {}\n", tool.category));

    if tool.script_path.is_empty() {
        // N8n-imported tools: no script file, use built-in Bash tool with curl
        if let Some(ref guide) = tool.implementation_guide {
            doc.push_str("**Implementation Guide**:\n");
            doc.push_str(guide);
            doc.push('\n');
        } else {
            doc.push_str("**Implementation**: Use the Bash tool with `curl` to call the API. Credentials are available as environment variables (e.g. `$GOOGLE_ACCESS_TOKEN`).\n");
        }
    } else {
        doc.push_str(&format!(
            "**Usage**: npx tsx \"{}\" --input '<JSON>'\n",
            tool.script_path
        ));
    }

    if let Some(ref schema) = tool.input_schema {
        doc.push_str(&format!("**Input Schema**: {schema}\n"));
    }
    if let Some(ref cred_type) = tool.requires_credential_type {
        doc.push_str(&format!(
            "**Requires Credential**: {cred_type} (available as env var)\n"
        ));
    }
    doc
}
