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
    build_refinement_prompt_with_history(current_result_json, feedback, design_context, None)
}

/// Build a refinement prompt that includes conversation history for richer multi-turn context.
/// When `conversation_history` is provided, earlier exchanges are injected so the LLM
/// can see the full thread of instructions, questions, answers, and intermediate results.
pub fn build_refinement_prompt_with_history(
    current_result_json: &str,
    feedback: &str,
    design_context: Option<&str>,
    conversation_history: Option<&str>,
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

    // Include conversation history if available — this gives the LLM the full
    // multi-turn thread so refinement quality improves across rounds.
    if let Some(history) = conversation_history {
        if !history.is_empty() && history != "[]" {
            prompt.push_str("## Conversation History\n");
            prompt.push_str("The following is the full design conversation so far. Use it to understand the user's evolving intent and previous decisions:\n\n");
            // Parse messages and render as a readable thread
            if let Ok(messages) = serde_json::from_str::<Vec<serde_json::Value>>(history) {
                for msg in &messages {
                    let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("unknown");
                    let content = msg.get("content").and_then(|v| v.as_str()).unwrap_or("");
                    let msg_type = msg.get("messageType").and_then(|v| v.as_str()).unwrap_or("");
                    if content.is_empty() {
                        continue;
                    }
                    match role {
                        "user" => {
                            let label = match msg_type {
                                "instruction" => "User Instruction",
                                "answer" => "User Answer",
                                "feedback" => "User Feedback",
                                _ => "User",
                            };
                            prompt.push_str(&format!("**{}**: {}\n\n", label, content));
                        }
                        "assistant" => {
                            let label = match msg_type {
                                "question" => "AI Question",
                                "result" => "AI Result",
                                _ => "AI",
                            };
                            // For results, truncate to avoid blowing up prompt size
                            if msg_type == "result" && content.len() > 500 {
                                prompt.push_str(&format!("**{}**: [Design result — {} chars, see Current Design below]\n\n", label, content.len()));
                            } else {
                                prompt.push_str(&format!("**{}**: {}\n\n", label, content));
                            }
                        }
                        _ => {}
                    }
                }
            }
            prompt.push_str("---\n\n");
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

/// Extract a design question JSON from Claude's output text.
/// Looks for JSON objects containing `design_question` key.
pub fn extract_design_question(output: &str) -> Option<serde_json::Value> {
    let val = extract_json_by_key(output, &["design_question"])?;
    let q = val.get("design_question")?;
    if q.get("question").and_then(|v| v.as_str()).is_some() {
        return Some(q.clone());
    }
    None
}

/// Extract a DesignAnalysisResult JSON object from Claude's output text.
/// Looks for fenced ```json blocks or bare JSON objects with `structured_prompt`.
pub fn extract_design_result(output: &str) -> Option<serde_json::Value> {
    extract_json_by_key(output, &["structured_prompt"])
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

/// Find the first bare JSON object in the output that contains **any** of the
/// given discriminating keys. This is the shared implementation behind all
/// `extract_bare_*_json` helpers.
fn extract_bare_json_with_key(output: &str, keys: &[&str]) -> Option<serde_json::Value> {
    let chars: Vec<char> = output.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        if chars[i] == '{' {
            if let Some(end) = find_matching_brace(&chars, i) {
                let candidate: String = chars[i..=end].iter().collect();
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&candidate) {
                    if keys.iter().any(|k| val.get(*k).is_some()) {
                        return Some(val);
                    }
                }
            }
        }
        i += 1;
    }

    None
}

/// Unified JSON extraction combinator. Tries fenced ```json block first, then
/// scans for bare JSON objects containing any of the given discriminant keys.
/// This is the single entry point for all AI-output JSON extraction.
pub fn extract_json_by_key(output: &str, keys: &[&str]) -> Option<serde_json::Value> {
    // Strategy 1: fenced JSON code block
    if let Some(val) = extract_fenced_json(output) {
        if keys.iter().any(|k| val.get(*k).is_some()) {
            return Some(val);
        }
    }
    // Strategy 2: bare JSON object with discriminant key
    extract_bare_json_with_key(output, keys)
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

pub const DESIGN_OUTPUT_SCHEMA: &str = r##"## Required Output Format

You MUST output your result as a single JSON code block. The JSON must conform to this exact schema:

```json
{
  "service_flow": ["Service1", "Service2", "Service3"],
  "structured_prompt": {
    "identity": "Who this persona is and its core purpose",
    "instructions": "Step-by-step instructions for the persona",
    "toolGuidance": "How and when to use each tool, with API endpoint examples",
    "examples": "Example interactions or scenarios",
    "errorHandling": "How to handle errors and edge cases",
    "webSearch": "Research guidance for web-enabled runs (empty string if not applicable)",
    "customSections": [
      { "title": "Section Title", "content": "Section content" }
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
      "name": "connector_slug",
      "label": "Human Readable Name",
      "auth_type": "oauth2|pat|api_key|bot_token|service_account|api_token",
      "credential_fields": [
        {
          "key": "field_key",
          "label": "Human Label",
          "type": "text|password",
          "placeholder": "example value",
          "helpText": "Where to find this credential",
          "required": true
        }
      ],
      "setup_instructions": "Step-by-step setup guide for this specific service",
      "related_tools": ["tool_name"],
      "related_triggers": [0],
      "api_base_url": "https://api.service.com"
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
  ],
  "use_case_flows": [
    {
      "id": "flow_1",
      "name": "Primary Workflow",
      "description": "Description of this workflow path",
      "nodes": [
        { "id": "n1", "type": "start", "label": "Trigger fires" },
        { "id": "n2", "type": "connector", "label": "Read from Service", "detail": "API call details", "connector": "connector_slug" },
        { "id": "n3", "type": "decision", "label": "Condition check?", "detail": "What is being evaluated" },
        { "id": "n4", "type": "action", "label": "Process data", "detail": "What processing occurs" },
        { "id": "n5", "type": "connector", "label": "Write to Service", "connector": "another_connector" },
        { "id": "n6", "type": "event", "label": "Emit notification" },
        { "id": "n7", "type": "error", "label": "Handle failure", "error_message": "What went wrong" },
        { "id": "n8", "type": "end", "label": "Complete" }
      ],
      "edges": [
        { "id": "e1", "source": "n1", "target": "n2" },
        { "id": "e2", "source": "n2", "target": "n3" },
        { "id": "e3", "source": "n3", "target": "n4", "label": "Yes", "variant": "yes" },
        { "id": "e4", "source": "n3", "target": "n7", "label": "No", "variant": "no" },
        { "id": "e5", "source": "n4", "target": "n5" },
        { "id": "e6", "source": "n5", "target": "n6" },
        { "id": "e7", "source": "n6", "target": "n8" },
        { "id": "e8", "source": "n7", "target": "n8", "variant": "error" }
      ]
    }
  ]
}
```

Important rules:
1. `suggested_tools` must only reference tools from the Available Tools list above
2. Each external service MUST have its own named connector (e.g., "slack", "github", "stripe") — never use "http_generic"
3. Each connector MUST include `credential_fields` with at least one field
4. Each connector MUST include `auth_type` matching its authentication method
5. `file_read`/`file_write` are LOCAL filesystem only — for cloud storage use `http_request` with the appropriate connector
6. `service_flow` must list the external services in data-pipeline order
7. `full_prompt_markdown` must be the complete, ready-to-use system prompt in markdown format
8. Output ONLY the JSON block — no additional text before or after
9. `use_case_flows` MUST contain 1-3 flow diagrams documenting the persona's primary workflows
10. Each flow MUST have "start" and "end" nodes, with 5-10 nodes total showing the workflow
11. Flow node types: "start", "end", "action", "decision", "connector" (set `connector` to slug), "event", "error"
12. Flow edges use `variant`: "yes"/"no" for decision branches, "error" for error paths

## Clarification Questions

If the user's instruction is ambiguous or you need critical information before producing a good design, you MAY output a question instead of the full result. Use this format:

```json
{
  "design_question": {
    "question": "Your clarification question here",
    "options": ["Option A", "Option B", "Option C"],
    "context": "Brief context explaining why you need this information"
  }
}
```

Rules for questions:
- Only ask when the answer would meaningfully change the design (e.g., scope, data sources, autonomy level)
- Provide 2-4 concrete options when possible
- Ask at most ONE question, then wait for the answer
- If the instruction is clear enough to produce a reasonable design, produce the full result instead
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
            implementation_guide: None,
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

    // ── Question Extraction Tests ─────────────────────────────────

    #[test]
    fn test_extract_question_fenced_json() {
        let output = r#"I need some clarification:

```json
{"design_question":{"question":"What data sources should this agent monitor?","options":["Email only","Email and Slack","All messaging platforms"],"context":"The scope affects which tools and connectors to suggest."}}
```
"#;
        let question = extract_design_question(output);
        assert!(question.is_some());
        let q = question.unwrap();
        assert_eq!(
            q.get("question").and_then(|v| v.as_str()),
            Some("What data sources should this agent monitor?")
        );
        assert!(q.get("options").and_then(|v| v.as_array()).is_some());
    }

    #[test]
    fn test_extract_question_bare_json() {
        let output = r#"Before I can design this, I need to ask: {"design_question":{"question":"How autonomous should this agent be?","options":["Read-only","Full access with approval","Fully autonomous"]}}"#;
        let question = extract_design_question(output);
        assert!(question.is_some());
        let q = question.unwrap();
        assert_eq!(
            q.get("question").and_then(|v| v.as_str()),
            Some("How autonomous should this agent be?")
        );
    }

    #[test]
    fn test_extract_question_not_present() {
        let output = format!("Here is the full design:\n```json\n{}\n```", sample_design_result());
        let question = extract_design_question(&output);
        assert!(question.is_none());
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
