use serde::Serialize;

use crate::db::models::{ConnectorDefinition, Persona, PersonaToolDefinition};

// ============================================================================
// Feasibility Result
// ============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct FeasibilityResult {
    pub confirmed_capabilities: Vec<String>,
    pub issues: Vec<String>,
    pub overall: String,
}

// ============================================================================
// Design Prompt Builder
// ============================================================================

/// Build a prompt that instructs Claude to produce a DesignAnalysisResult JSON.
pub fn build_design_prompt(
    persona: &Persona,
    tools: &[PersonaToolDefinition],
    connectors: &[ConnectorDefinition],
    instruction: &str,
    context: Option<&str>,
    existing_result: Option<&str>,
) -> String {
    let mut prompt = String::new();

    prompt.push_str("# Persona Design Analysis\n\n");
    prompt.push_str("You are an expert AI systems architect. Analyze the user's requirements and generate a complete persona configuration.\n\n");

    // Persona info
    prompt.push_str(&format!("## Target Persona: {}\n", persona.name));
    if let Some(ref desc) = persona.description {
        if !desc.is_empty() {
            prompt.push_str(&format!("Description: {}\n", desc));
        }
    }
    if !persona.system_prompt.is_empty() {
        prompt.push_str(&format!("Current system prompt: {}\n", persona.system_prompt));
    }
    prompt.push('\n');

    // Available tools
    if !tools.is_empty() {
        prompt.push_str("## Available Tools\n");
        for tool in tools {
            prompt.push_str(&format!(
                "- **{}** ({}): {}\n",
                tool.name, tool.category, tool.description
            ));
        }
        prompt.push('\n');
    }

    // Available connectors
    if !connectors.is_empty() {
        prompt.push_str("## Available Connectors\n");
        for conn in connectors {
            prompt.push_str(&format!("- **{}** ({}): {}\n", conn.name, conn.category, conn.label));
        }
        prompt.push('\n');
    }

    // Design context (files, references)
    if let Some(ctx) = context {
        if !ctx.is_empty() && ctx != "{}" {
            prompt.push_str("## Design Context\n");
            prompt.push_str("The user has provided the following context files and references:\n");
            prompt.push_str(ctx);
            prompt.push_str("\n\n");
        }
    }

    // Existing design result (for redesign/update)
    if let Some(existing) = existing_result {
        if !existing.is_empty() {
            prompt.push_str("## Current Design (to modify)\n");
            prompt.push_str("The persona already has a design. Preserve what works and update based on the new instructions:\n```json\n");
            prompt.push_str(existing);
            prompt.push_str("\n```\n\n");
        }
    }

    // User instruction
    prompt.push_str("## User Instruction\n");
    prompt.push_str(instruction);
    prompt.push_str("\n\n");

    // Output schema
    prompt.push_str(DESIGN_OUTPUT_SCHEMA);

    prompt
}

/// Build a prompt for refining an existing design with user feedback.
pub fn build_refinement_prompt(
    current_result_json: &str,
    feedback: &str,
    design_context: Option<&str>,
) -> String {
    let mut prompt = String::new();

    prompt.push_str("# Design Refinement\n\n");
    prompt.push_str("You are refining an existing persona design based on user feedback.\n\n");

    // Include original design context if available
    if let Some(ctx) = design_context {
        if !ctx.is_empty() && ctx != "{}" {
            prompt.push_str("## Design Context\n");
            prompt.push_str("The user provided the following context files and references during the original design:\n");
            prompt.push_str(ctx);
            prompt.push_str("\n\n");
        }
    }

    prompt.push_str("## Current Design\n```json\n");
    prompt.push_str(current_result_json);
    prompt.push_str("\n```\n\n");

    prompt.push_str("## User Feedback\n");
    prompt.push_str(feedback);
    prompt.push_str("\n\n");

    prompt.push_str("## Instructions\n");
    prompt.push_str("Update the design based on the feedback. Keep everything that the user didn't ask to change.\n");
    prompt.push_str("Output the complete updated design as a JSON block.\n\n");

    prompt.push_str(DESIGN_OUTPUT_SCHEMA);

    prompt
}

// ============================================================================
// Result Parser
// ============================================================================

/// Extract a DesignAnalysisResult JSON object from Claude's output text.
/// Looks for fenced ```json blocks or bare JSON objects with `structured_prompt`.
pub fn extract_design_result(output: &str) -> Option<serde_json::Value> {
    // Strategy 1: Find fenced JSON code block
    if let Some(result) = extract_fenced_json(output) {
        if result.get("structured_prompt").is_some() {
            return Some(result);
        }
    }

    // Strategy 2: Find bare JSON object containing structured_prompt
    if let Some(result) = extract_bare_json(output) {
        return Some(result);
    }

    None
}

/// Extract JSON from a fenced ```json ... ``` block.
fn extract_fenced_json(output: &str) -> Option<serde_json::Value> {
    let mut in_block = false;
    let mut json_content = String::new();
    let mut best_result: Option<serde_json::Value> = None;

    for line in output.lines() {
        let trimmed = line.trim();
        if !in_block && (trimmed == "```json" || trimmed == "```JSON") {
            in_block = true;
            json_content.clear();
            continue;
        }
        if in_block && trimmed == "```" {
            in_block = false;
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&json_content) {
                if val.is_object() {
                    best_result = Some(val);
                }
            }
            continue;
        }
        if in_block {
            json_content.push_str(line);
            json_content.push('\n');
        }
    }

    best_result
}

/// Find the largest JSON object in the output that contains `structured_prompt`.
fn extract_bare_json(output: &str) -> Option<serde_json::Value> {
    // Look for lines starting with `{` that might be a JSON object start
    let chars: Vec<char> = output.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        if chars[i] == '{' {
            // Try to find the matching closing brace
            if let Some(end) = find_matching_brace(&chars, i) {
                let candidate: String = chars[i..=end].iter().collect();
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&candidate) {
                    if val.get("structured_prompt").is_some() {
                        return Some(val);
                    }
                }
            }
        }
        i += 1;
    }

    None
}

/// Find the index of the matching closing brace for an opening brace at `start`.
fn find_matching_brace(chars: &[char], start: usize) -> Option<usize> {
    let mut depth = 0;
    let mut in_string = false;
    let mut escape_next = false;

    for (i, &ch) in chars.iter().enumerate().skip(start) {
        if escape_next {
            escape_next = false;
            continue;
        }
        if ch == '\\' && in_string {
            escape_next = true;
            continue;
        }
        if ch == '"' {
            in_string = !in_string;
            continue;
        }
        if in_string {
            continue;
        }
        if ch == '{' {
            depth += 1;
        } else if ch == '}' {
            depth -= 1;
            if depth == 0 {
                return Some(i);
            }
        }
    }

    None
}

// ============================================================================
// Feasibility Checker
// ============================================================================

/// Check whether a design result is feasible given available tools and connectors.
pub fn check_feasibility(
    design_result_json: &str,
    available_tools: &[String],
    available_connectors: &[String],
) -> FeasibilityResult {
    let mut confirmed = Vec::new();
    let mut issues = Vec::new();

    let val: serde_json::Value = match serde_json::from_str(design_result_json) {
        Ok(v) => v,
        Err(_) => {
            return FeasibilityResult {
                confirmed_capabilities: vec![],
                issues: vec!["Failed to parse design result JSON".into()],
                overall: "blocked".into(),
            };
        }
    };

    // Check suggested tools
    if let Some(tools) = val.get("suggested_tools").and_then(|v| v.as_array()) {
        for tool in tools {
            if let Some(name) = tool.as_str() {
                if available_tools.iter().any(|t| t == name) {
                    confirmed.push(format!("Tool '{}' is available", name));
                } else {
                    issues.push(format!("Tool '{}' is not installed", name));
                }
            }
        }
    }

    // Check suggested connectors
    if let Some(conns) = val.get("suggested_connectors").and_then(|v| v.as_array()) {
        for conn in conns {
            if let Some(name) = conn.get("name").and_then(|v| v.as_str()) {
                if available_connectors.iter().any(|c| c == name) {
                    confirmed.push(format!("Connector '{}' is available", name));
                } else {
                    issues.push(format!("Connector '{}' is not installed", name));
                }
            }
        }
    }

    // Check trigger types are valid
    if let Some(triggers) = val.get("suggested_triggers").and_then(|v| v.as_array()) {
        let valid_types = ["manual", "schedule", "polling", "webhook"];
        for trigger in triggers {
            if let Some(t_type) = trigger.get("trigger_type").and_then(|v| v.as_str()) {
                if valid_types.contains(&t_type) {
                    confirmed.push(format!("Trigger type '{}' is supported", t_type));
                } else {
                    issues.push(format!("Unknown trigger type '{}'", t_type));
                }
            }
        }
    }

    // Check structured prompt exists
    if val.get("structured_prompt").is_some() {
        confirmed.push("Structured prompt is defined".into());
    } else {
        issues.push("Missing structured_prompt section".into());
    }

    let overall = if issues.is_empty() {
        "ready".into()
    } else if issues.len() <= 2 {
        "partial".into()
    } else {
        "blocked".into()
    };

    FeasibilityResult {
        confirmed_capabilities: confirmed,
        issues,
        overall,
    }
}

// ============================================================================
// Output Schema Constant
// ============================================================================

const DESIGN_OUTPUT_SCHEMA: &str = r##"## Required Output Format

You MUST output your result as a single JSON code block. The JSON must conform to this exact schema:

```json
{
  "structured_prompt": {
    "identity": "Who this persona is and its core purpose",
    "instructions": "Step-by-step instructions for the persona",
    "toolGuidance": "How and when to use each tool",
    "examples": "Example interactions or scenarios",
    "errorHandling": "How to handle errors and edge cases",
    "customSections": [
      { "key": "section_key", "label": "Section Label", "content": "Section content" }
    ]
  },
  "suggested_tools": ["tool_name_1", "tool_name_2"],
  "suggested_triggers": [
    {
      "trigger_type": "schedule|polling|webhook|manual",
      "config": { "cron": "*/5 * * * *" },
      "description": "What this trigger does"
    }
  ],
  "full_prompt_markdown": "# Complete System Prompt\n\nThe full prompt in markdown...",
  "summary": "One-paragraph summary of this persona design",
  "design_highlights": [
    {
      "category": "Category Name",
      "icon": "emoji",
      "color": "blue",
      "items": ["Key capability 1", "Key capability 2"]
    }
  ],
  "suggested_connectors": [
    {
      "name": "connector_name",
      "setup_instructions": "How to configure this connector",
      "related_tools": ["tool_name"],
      "related_triggers": [0]
    }
  ],
  "suggested_notification_channels": [
    {
      "type": "slack|telegram|email",
      "description": "Channel purpose",
      "required_connector": "connector_name",
      "config_hints": { "channel": "#alerts" }
    }
  ],
  "suggested_event_subscriptions": [
    {
      "event_type": "event_name",
      "description": "When and why to listen for this event"
    }
  ]
}
```

Important rules:
1. `suggested_tools` must only reference tools from the Available Tools list above
2. `suggested_connectors` should reference connectors from the Available Connectors list when possible
3. `suggested_triggers[].related_triggers` are zero-based indices into the `suggested_triggers` array
4. `full_prompt_markdown` must be the complete, ready-to-use system prompt in markdown format
5. Output ONLY the JSON block — no additional text before or after
"##;

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{ConnectorDefinition, Persona, PersonaToolDefinition};

    fn test_persona() -> Persona {
        Persona {
            id: "p-1".into(),
            project_id: "proj-1".into(),
            name: "Email Monitor".into(),
            description: Some("Monitors emails".into()),
            system_prompt: "You monitor emails.".into(),
            structured_prompt: None,
            icon: None,
            color: None,
            enabled: true,
            max_concurrent: 1,
            timeout_ms: 300000,
            notification_channels: None,
            last_design_result: None,
            model_profile: None,
            max_budget_usd: None,
            max_turns: None,
            design_context: None,
            group_id: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    fn test_tool() -> PersonaToolDefinition {
        PersonaToolDefinition {
            id: "t-1".into(),
            name: "gmail_reader".into(),
            category: "email".into(),
            description: "Reads Gmail messages".into(),
            script_path: "tools/gmail_reader.ts".into(),
            input_schema: None,
            output_schema: None,
            requires_credential_type: Some("gmail".into()),
            is_builtin: true,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    fn test_connector() -> ConnectorDefinition {
        ConnectorDefinition {
            id: "c-1".into(),
            name: "gmail".into(),
            label: "Gmail".into(),
            icon_url: None,
            color: "#EA4335".into(),
            category: "email".into(),
            fields: "[]".into(),
            healthcheck_config: None,
            services: "[]".into(),
            events: "[]".into(),
            metadata: None,
            is_builtin: true,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    fn sample_design_result() -> &'static str {
        r##"{"structured_prompt":{"identity":"Email monitor agent","instructions":"Check emails periodically","toolGuidance":"Use gmail_reader","examples":"","errorHandling":"Retry on failure","customSections":[]},"suggested_tools":["gmail_reader"],"suggested_triggers":[{"trigger_type":"schedule","config":{"cron":"*/5 * * * *"},"description":"Check every 5 minutes"}],"full_prompt_markdown":"# Email Monitor\n\nYou monitor emails.","summary":"An email monitoring persona","suggested_connectors":[{"name":"gmail","setup_instructions":"Configure OAuth"}]}"##
    }

    // ── Prompt Builder Tests ──────────────────────────────────────

    #[test]
    fn test_build_design_prompt_basic() {
        let persona = test_persona();
        let prompt = build_design_prompt(&persona, &[], &[], "Monitor my inbox", None, None);

        assert!(prompt.contains("# Persona Design Analysis"));
        assert!(prompt.contains("Monitor my inbox"));
        assert!(prompt.contains("Email Monitor"));
        assert!(prompt.contains("structured_prompt"));
        assert!(prompt.contains("Required Output Format"));
    }

    #[test]
    fn test_build_design_prompt_with_tools() {
        let persona = test_persona();
        let tool = test_tool();
        let prompt = build_design_prompt(&persona, &[tool], &[], "Monitor my inbox", None, None);

        assert!(prompt.contains("## Available Tools"));
        assert!(prompt.contains("gmail_reader"));
        assert!(prompt.contains("email"));
        assert!(prompt.contains("Reads Gmail messages"));
    }

    #[test]
    fn test_build_design_prompt_with_connectors() {
        let persona = test_persona();
        let conn = test_connector();
        let prompt = build_design_prompt(&persona, &[], &[conn], "Monitor my inbox", None, None);

        assert!(prompt.contains("## Available Connectors"));
        assert!(prompt.contains("gmail"));
        assert!(prompt.contains("Gmail"));
    }

    #[test]
    fn test_build_design_prompt_with_context() {
        let persona = test_persona();
        let ctx = r#"{"files":[{"name":"api.yaml","content":"openapi: 3.0"}],"references":["https://example.com"]}"#;
        let prompt = build_design_prompt(&persona, &[], &[], "Monitor my inbox", Some(ctx), None);

        assert!(prompt.contains("## Design Context"));
        assert!(prompt.contains("api.yaml"));
        assert!(prompt.contains("https://example.com"));
    }

    #[test]
    fn test_build_design_prompt_redesign() {
        let persona = test_persona();
        let existing = sample_design_result();
        let prompt = build_design_prompt(
            &persona,
            &[],
            &[],
            "Add Slack notifications",
            None,
            Some(existing),
        );

        assert!(prompt.contains("## Current Design (to modify)"));
        assert!(prompt.contains("Email monitor agent"));
        assert!(prompt.contains("Add Slack notifications"));
    }

    #[test]
    fn test_build_refinement_prompt() {
        let result = sample_design_result();
        let prompt = build_refinement_prompt(result, "Add error reporting to Slack", None);

        assert!(prompt.contains("# Design Refinement"));
        assert!(prompt.contains("Email monitor agent"));
        assert!(prompt.contains("Add error reporting to Slack"));
        assert!(prompt.contains("Required Output Format"));
        assert!(!prompt.contains("## Design Context"));
    }

    #[test]
    fn test_build_refinement_prompt_with_context() {
        let result = sample_design_result();
        let ctx = r#"{"files":[{"name":"api.yaml","content":"openapi: 3.0"}],"references":["https://example.com"]}"#;
        let prompt = build_refinement_prompt(result, "Add error reporting to Slack", Some(ctx));

        assert!(prompt.contains("# Design Refinement"));
        assert!(prompt.contains("## Design Context"));
        assert!(prompt.contains("api.yaml"));
        assert!(prompt.contains("Add error reporting to Slack"));
    }

    // ── Result Parser Tests ──────────────────────────────────────

    #[test]
    fn test_extract_result_fenced_json() {
        let output = format!(
            "Here is the design analysis:\n\n```json\n{}\n```\n\nDone.",
            sample_design_result()
        );
        let result = extract_design_result(&output);
        assert!(result.is_some());
        let val = result.unwrap();
        assert!(val.get("structured_prompt").is_some());
        assert!(val.get("suggested_tools").is_some());
    }

    #[test]
    fn test_extract_result_bare_json() {
        let output = format!("Analysis complete. {}", sample_design_result());
        let result = extract_design_result(&output);
        assert!(result.is_some());
        let val = result.unwrap();
        assert_eq!(
            val.get("summary").and_then(|v| v.as_str()),
            Some("An email monitoring persona")
        );
    }

    #[test]
    fn test_extract_result_no_json() {
        let output = "I analyzed the requirements but could not produce a valid design.";
        let result = extract_design_result(output);
        assert!(result.is_none());
    }

    // ── Feasibility Checker Tests ────────────────────────────────

    #[test]
    fn test_feasibility_all_available() {
        let result = check_feasibility(
            sample_design_result(),
            &["gmail_reader".into()],
            &["gmail".into()],
        );
        assert_eq!(result.overall, "ready");
        assert!(result.issues.is_empty());
        assert!(!result.confirmed_capabilities.is_empty());
    }

    #[test]
    fn test_feasibility_missing_tool() {
        let result = check_feasibility(sample_design_result(), &[], &["gmail".into()]);
        assert_eq!(result.overall, "partial");
        assert!(result.issues.iter().any(|i| i.contains("gmail_reader")));
    }

    #[test]
    fn test_feasibility_missing_connector() {
        let result = check_feasibility(sample_design_result(), &["gmail_reader".into()], &[]);
        assert_eq!(result.overall, "partial");
        assert!(result.issues.iter().any(|i| i.contains("gmail")));
    }
}
