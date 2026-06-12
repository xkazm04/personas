//! Shared helpers that derive structured info from a persona or its tools.

use super::super::types::ModelProfile;
use crate::db::models::PersonaToolDefinition;

/// Canonical tier-slug → model-id map for per-capability `model_override`
/// values baked by templates/recipes. Default tier (sonnet) is stored as
/// `null` on the capability and resolved by the caller's fallback chain.
pub fn tier_slug_to_model_id(slug: &str) -> Option<&'static str> {
    match slug.trim().to_ascii_lowercase().as_str() {
        "haiku" => Some("claude-haiku-4-5-20251001"),
        "sonnet" => Some("claude-sonnet-4-6"),
        "opus" => Some("claude-opus-4-8"),
        _ => None,
    }
}

/// The default-tier model for capability executions when neither the
/// capability (`model_override`) nor the persona (`model_profile`) names
/// one. The recipe bundle's tiering doctrine is "null = sonnet default";
/// without this fallback a profile-less persona silently rides the CLI
/// ACCOUNT default — observed live as opus-4-8[1m] on every team step,
/// the dominant fleet cost driver (2026-06-12 cost review).
pub const DEFAULT_CAPABILITY_MODEL: &str = "claude-sonnet-4-6";

/// Resolve a capability's `model_override` value into a ModelProfile.
/// Accepts BOTH shapes that exist in the wild:
///  - short tier slug baked by templates/recipes: `"haiku" | "sonnet" | "opus"`
///    (also tolerates a full `claude-*` model id string)
///  - full ModelProfile object set from the capability detail UI
/// Returns None for null/absent/unrecognized — callers fall back to the
/// persona profile, then [`DEFAULT_CAPABILITY_MODEL`].
pub fn resolve_use_case_model_override(mo: &serde_json::Value) -> Option<ModelProfile> {
    match mo {
        serde_json::Value::String(s) => {
            let id = tier_slug_to_model_id(s).map(str::to_string).or_else(|| {
                let t = s.trim();
                t.starts_with("claude-").then(|| t.to_string())
            })?;
            Some(ModelProfile {
                model: Some(id),
                ..ModelProfile::default()
            })
        }
        v @ serde_json::Value::Object(_) => serde_json::from_value(v.clone()).ok(),
        _ => None,
    }
}

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
    let Some(dc_json) = design_context else {
        return String::new();
    };
    let Ok(dc) = serde_json::from_str::<serde_json::Value>(dc_json) else {
        return String::new();
    };
    let Some(use_cases) = crate::engine::design_context::pick_use_cases_array(&dc) else {
        return String::new();
    };
    if use_cases.is_empty() {
        return String::new();
    }

    let mut out = String::new();
    let mut rendered = 0usize;

    for uc in use_cases {
        // Disabled only when explicitly `enabled == false`. Missing or true → active.
        if uc.get("enabled").and_then(|v| v.as_bool()) == Some(false) {
            continue;
        }

        let title = uc
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled");
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
    let Some(dc_json) = design_context else {
        return String::new();
    };
    let Ok(dc) = serde_json::from_str::<serde_json::Value>(dc_json) else {
        return String::new();
    };
    let Some(use_cases) = crate::engine::design_context::pick_use_cases_array(&dc) else {
        return String::new();
    };

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
    let Some(s) = settings.filter(|v| !v.is_null()) else {
        return Vec::new();
    };
    let mut lines = Vec::new();

    if let Some(v) = s.get("memories").and_then(|v| v.as_str()) {
        if v.eq_ignore_ascii_case("off") {
            lines.push(
                "Do not write to agent memory for this capability. The persona has memories \
                 from other capabilities; do not extend them from this run."
                    .to_string(),
            );
        }
    }
    if let Some(v) = s.get("reviews").and_then(|v| v.as_str()) {
        match v.to_ascii_lowercase().as_str() {
            "off" => lines.push(
                "Do not request manual review for this capability. Resolve uncertainty \
                 with your own best judgment and proceed."
                    .to_string(),
            ),
            "trust_llm" | "trustllm" | "trust-llm" => lines.push(
                "Trust your own judgment for this capability. If you would normally \
                 request manual review, proceed instead — your decisions will not be queued \
                 for human approval."
                    .to_string(),
            ),
            _ => {}
        }
    }
    if let Some(v) = s.get("events").and_then(|v| v.as_str()) {
        if v.eq_ignore_ascii_case("off") {
            lines.push(
                "Do not emit events for this capability. Other personas will not be \
                 notified of your actions on this run."
                    .to_string(),
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

/// 2026-05-06 — extended renderer that walks the whole use_case to derive
/// policy lines from BOTH `generation_settings` (explicit runtime override)
/// AND the build-time IR fields `review_policy.mode` / `memory_policy.enabled`.
/// Mirrors the precedence in `dispatch::pick_generation_policy`: explicit
/// settings win, but when absent we fall back to the IR fields the build
/// LLM actually writes.
///
/// Why two functions instead of replacing the original: the original
/// signature is on the public surface (used by tests and other callers).
/// This adds a richer entry point without breaking those.
pub fn render_capability_policy_lines(use_case: &serde_json::Value) -> Vec<String> {
    let mut lines = render_generation_policy_lines(use_case.get("generation_settings"));

    // Track which keys were already covered by generation_settings so the
    // fallback doesn't double-emit.
    let settings = use_case.get("generation_settings");
    let memories_explicit = settings.and_then(|s| s.get("memories")).is_some();
    let reviews_explicit = settings.and_then(|s| s.get("reviews")).is_some();

    // memory_policy.enabled fallback
    if !memories_explicit {
        if let Some(enabled) = use_case
            .get("memory_policy")
            .and_then(|v| v.get("enabled"))
            .and_then(|v| v.as_bool())
        {
            if !enabled {
                lines.push(
                    "Do not write to agent memory for this capability. \
                     The persona has memories from other capabilities; do not extend them from this run.".to_string(),
                );
            }
        }
    }

    // review_policy.mode fallback. The "always" mode is the meaningful
    // one to surface — without an explicit instruction the LLM treats
    // routine completions as not requiring review (per templates.rs:180).
    // For mode=always we want every output to be flagged.
    if !reviews_explicit {
        if let Some(mode) = use_case
            .get("review_policy")
            .and_then(|v| v.get("mode"))
            .and_then(|v| v.as_str())
        {
            match mode.to_ascii_lowercase().as_str() {
                "never" => lines.push(
                    "Do not request manual review for this capability. \
                     Resolve uncertainty with your own best judgment and proceed."
                        .to_string(),
                ),
                "always" => lines.push(
                    "Always emit a `manual_review` protocol message for every output of \
                     this capability before delivering it. The user has explicitly required \
                     human approval — never skip this step, even for routine completions. \
                     Use severity \"medium\" unless the output is high-impact (severity \"high\"). \
                     Include the proposed output in the description so the reviewer can decide \
                     without re-running the capability."
                        .to_string(),
                ),
                "auto_triage" | "autotriage" | "auto-triage" => lines.push(
                    "Emit a `manual_review` for outputs you would normally flag. The runtime \
                     spawns an automated triage evaluator that judges each review against the \
                     persona's decision_principles and resolves it without blocking on a human. \
                     Use this freely — it is not a queue, it is a transparency record."
                        .to_string(),
                ),
                _ => {}
            }
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
