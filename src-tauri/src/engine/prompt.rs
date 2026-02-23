use super::types::{providers, CliArgs, ModelProfile};
use crate::db::models::{Persona, PersonaToolDefinition};

/// Parse the model_profile JSON string into a ModelProfile struct.
/// Returns None if the input is None, empty, or invalid JSON.
pub fn parse_model_profile(json: Option<&str>) -> Option<ModelProfile> {
    let json_str = json?.trim();
    if json_str.is_empty() {
        return None;
    }
    serde_json::from_str::<ModelProfile>(json_str).ok()
}

/// Build documentation string for a single tool definition.
pub fn build_tool_documentation(tool: &PersonaToolDefinition) -> String {
    let mut doc = format!("### {}\n{}\n", tool.name, tool.description);
    doc.push_str(&format!("**Category**: {}\n", tool.category));

    if tool.script_path.is_empty() {
        // N8n-imported tools: no script file, use built-in Bash tool
        if let Some(ref guide) = tool.implementation_guide {
            doc.push_str("**Implementation Guide**:\n");
            doc.push_str(guide);
            doc.push('\n');
        } else {
            doc.push_str("**Implementation**: Use the Bash tool to call the relevant API (curl, python, etc.). Credentials are available as environment variables.\n");
        }
    } else {
        doc.push_str(&format!(
            "**Usage**: npx tsx \"{}\" --input '<JSON>'\n",
            tool.script_path
        ));
    }

    if let Some(ref schema) = tool.input_schema {
        doc.push_str(&format!("**Input Schema**: {}\n", schema));
    }
    if let Some(ref cred_type) = tool.requires_credential_type {
        doc.push_str(&format!(
            "**Requires Credential**: {} (available as env var)\n",
            cred_type
        ));
    }
    doc
}

/// Assemble the full prompt string from persona configuration, tools, input data,
/// and optional credential environment variable hints.
pub fn assemble_prompt(
    persona: &Persona,
    tools: &[PersonaToolDefinition],
    input_data: Option<&serde_json::Value>,
    credential_hints: Option<&[&str]>,
) -> String {
    let mut prompt = String::new();

    // Header
    prompt.push_str(&format!("# Persona: {}\n\n", persona.name));

    // Description
    if let Some(ref desc) = persona.description {
        if !desc.is_empty() {
            prompt.push_str("## Description\n");
            prompt.push_str(desc);
            prompt.push_str("\n\n");
        }
    }

    // Identity and Instructions from structured_prompt or system_prompt
    if let Some(ref sp_json) = persona.structured_prompt {
        if let Ok(sp) = serde_json::from_str::<serde_json::Value>(sp_json) {
            // Identity
            if let Some(identity) = sp.get("identity").and_then(|v| v.as_str()) {
                prompt.push_str("## Identity\n");
                prompt.push_str(identity);
                prompt.push_str("\n\n");
            }

            // Instructions
            if let Some(instructions) = sp.get("instructions").and_then(|v| v.as_str()) {
                prompt.push_str("## Instructions\n");
                prompt.push_str(instructions);
                prompt.push_str("\n\n");
            }

            // Tool Guidance
            if let Some(tg) = sp.get("toolGuidance").and_then(|v| v.as_str()) {
                if !tg.is_empty() {
                    prompt.push_str("## Tool Guidance\n");
                    prompt.push_str(tg);
                    prompt.push_str("\n\n");
                }
            }

            // Examples
            if let Some(examples) = sp.get("examples").and_then(|v| v.as_str()) {
                if !examples.is_empty() {
                    prompt.push_str("## Examples\n");
                    prompt.push_str(examples);
                    prompt.push_str("\n\n");
                }
            }

            // Error Handling
            if let Some(eh) = sp.get("errorHandling").and_then(|v| v.as_str()) {
                if !eh.is_empty() {
                    prompt.push_str("## Error Handling\n");
                    prompt.push_str(eh);
                    prompt.push_str("\n\n");
                }
            }

            // Custom Sections
            if let Some(sections) = sp.get("customSections").and_then(|v| v.as_array()) {
                for section in sections {
                    let heading = section.get("title")
                        .or_else(|| section.get("label"))
                        .or_else(|| section.get("name"))
                        .or_else(|| section.get("key"))
                        .and_then(|v| v.as_str());
                    if let (Some(name), Some(content)) = (
                        heading,
                        section.get("content").and_then(|v| v.as_str()),
                    ) {
                        prompt.push_str(&format!("## {}\n", name));
                        prompt.push_str(content);
                        prompt.push_str("\n\n");
                    }
                }
            }

            // Web Search research prompt
            if let Some(ws) = sp.get("webSearch").and_then(|v| v.as_str()) {
                if !ws.is_empty() {
                    prompt.push_str("## Web Search Research Prompt\n");
                    prompt.push_str("When performing web searches during this execution, use the following research guidance:\n\n");
                    prompt.push_str(ws);
                    prompt.push_str("\n\n");
                }
            }
        } else {
            // Structured prompt failed to parse, fall back to system_prompt
            prompt.push_str("## Identity\n");
            prompt.push_str(&persona.system_prompt);
            prompt.push_str("\n\n");
        }
    } else {
        // No structured prompt, use system_prompt as identity
        prompt.push_str("## Identity\n");
        prompt.push_str(&persona.system_prompt);
        prompt.push_str("\n\n");
    }

    // Available Tools
    if !tools.is_empty() {
        prompt.push_str("## Available Tools\n");
        for tool in tools {
            prompt.push_str(&build_tool_documentation(tool));
            prompt.push('\n');
        }
    }

    // Available Credentials (as environment variables)
    if let Some(hints) = credential_hints {
        if !hints.is_empty() {
            prompt.push_str("## Available Credentials (as environment variables)\n");
            for hint in hints {
                prompt.push_str(&format!("- {}\n", hint));
            }
            prompt.push_str(
                "\nUse these environment variables to authenticate with external services.\n\n",
            );
        }
    }

    // Communication Protocols
    prompt.push_str("## Communication Protocols\n\n");
    prompt.push_str(PROTOCOL_USER_MESSAGE);
    prompt.push_str(PROTOCOL_PERSONA_ACTION);
    prompt.push_str(PROTOCOL_EMIT_EVENT);
    prompt.push_str(PROTOCOL_AGENT_MEMORY);
    prompt.push_str(PROTOCOL_MANUAL_REVIEW);
    prompt.push_str(PROTOCOL_EXECUTION_FLOW);
    prompt.push_str(PROTOCOL_OUTCOME_ASSESSMENT);

    // Input Data
    if let Some(data) = input_data {
        prompt.push_str("## Input Data\n```json\n");
        if let Ok(pretty) = serde_json::to_string_pretty(data) {
            prompt.push_str(&pretty);
        } else {
            prompt.push_str(&data.to_string());
        }
        prompt.push_str("\n```\n\n");
    }

    // Execute Now
    prompt.push_str("## EXECUTE NOW\n");
    prompt.push_str(&format!(
        "You are {}. Execute your task now. Follow your instructions precisely.\n",
        persona.name
    ));
    if !tools.is_empty() {
        prompt.push_str("Use available tools as needed.\n");
    }
    prompt.push_str("Respond naturally and complete the task.\n");

    prompt
}

/// Platform-specific command and initial args for invoking the Claude CLI.
fn base_cli_setup() -> (String, Vec<String>) {
    if cfg!(windows) {
        (
            "cmd".to_string(),
            vec!["/C".to_string(), "claude.cmd".to_string()],
        )
    } else {
        ("claude".to_string(), vec![])
    }
}

/// Apply provider-specific environment overrides and removals to a CliArgs.
/// Reused by build_cli_args and test_runner.
pub fn apply_provider_env(cli_args: &mut CliArgs, profile: &ModelProfile) {
    match profile.provider.as_deref() {
        Some(providers::OLLAMA) => {
            if let Some(ref base_url) = profile.base_url {
                cli_args
                    .env_overrides
                    .push(("OLLAMA_BASE_URL".to_string(), base_url.clone()));
            }
            if let Some(ref auth_token) = profile.auth_token {
                if !auth_token.is_empty() {
                    cli_args
                        .env_overrides
                        .push(("OLLAMA_API_KEY".to_string(), auth_token.clone()));
                }
            }
            cli_args
                .env_removals
                .push("ANTHROPIC_API_KEY".to_string());
        }
        Some(providers::LITELLM) => {
            if let Some(ref base_url) = profile.base_url {
                cli_args
                    .env_overrides
                    .push(("ANTHROPIC_BASE_URL".to_string(), base_url.clone()));
            }
            if let Some(ref auth_token) = profile.auth_token {
                if !auth_token.is_empty() {
                    cli_args
                        .env_overrides
                        .push(("ANTHROPIC_AUTH_TOKEN".to_string(), auth_token.clone()));
                }
            }
            cli_args
                .env_removals
                .push("ANTHROPIC_API_KEY".to_string());
        }
        Some(providers::CUSTOM) => {
            if let Some(ref base_url) = profile.base_url {
                cli_args
                    .env_overrides
                    .push(("OPENAI_BASE_URL".to_string(), base_url.clone()));
            }
            if let Some(ref auth_token) = profile.auth_token {
                cli_args
                    .env_overrides
                    .push(("OPENAI_API_KEY".to_string(), auth_token.clone()));
            }
            cli_args
                .env_removals
                .push("ANTHROPIC_API_KEY".to_string());
        }
        _ => {
            // Default provider (anthropic) — no special env needed
        }
    }
}

/// Build CLI arguments for spawning the Claude CLI process.
///
/// When called without a persona or model profile (both `None`), produces the
/// same result as the former `build_default_cli_args()`.
pub fn build_cli_args(
    persona: Option<&Persona>,
    model_profile: Option<&ModelProfile>,
) -> CliArgs {
    let (command, mut args) = base_cli_setup();

    // Base flags: read prompt from stdin, stream-json output, verbose (required by
    // --print + stream-json), skip permissions.
    // NOTE: --verbose causes Claude CLI to emit both JSON events AND plain-text lines.
    // The parser filters out non-JSON lines to prevent duplicate output display.
    args.extend([
        "-p".to_string(),
        "-".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--dangerously-skip-permissions".to_string(),
    ]);

    // Model override
    if let Some(profile) = model_profile {
        if let Some(ref model) = profile.model {
            if !model.is_empty() {
                args.push("--model".to_string());
                args.push(model.clone());
            }
        }
    }

    // Persona-specific flags
    if let Some(persona) = persona {
        // Budget limit
        if let Some(budget) = persona.max_budget_usd {
            if budget > 0.0 {
                args.push("--max-budget-usd".to_string());
                args.push(format!("{}", budget));
            }
        }

        // Max turns
        if let Some(turns) = persona.max_turns {
            if turns > 0 {
                args.push("--max-turns".to_string());
                args.push(format!("{}", turns));
            }
        }
    }

    let mut cli_args = CliArgs {
        command,
        args,
        env_overrides: Vec::new(),
        env_removals: Vec::new(),
        cwd: None,
    };

    // Provider env
    if let Some(profile) = model_profile {
        apply_provider_env(&mut cli_args, profile);
    }

    cli_args.env_removals.push("CLAUDECODE".to_string());
    cli_args.env_removals.push("CLAUDE_CODE".to_string());

    cli_args
}

/// Build CLI arguments to resume an existing Claude session.
/// Uses `--resume <id>` instead of `-p -` to continue a prior conversation.
pub fn build_resume_cli_args(claude_session_id: &str) -> CliArgs {
    let (command, mut args) = base_cli_setup();

    args.extend([
        "--resume".to_string(),
        claude_session_id.to_string(),
        "-p".to_string(),
        "-".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--dangerously-skip-permissions".to_string(),
    ]);

    CliArgs {
        command,
        args,
        env_overrides: Vec::new(),
        env_removals: vec!["CLAUDECODE".to_string(), "CLAUDE_CODE".to_string()],
        cwd: None,
    }
}

// ---------------------------------------------------------------------------
// Protocol instruction constants
// ---------------------------------------------------------------------------

const PROTOCOL_USER_MESSAGE: &str = r#"### User Message Protocol
To send a message to the user, output a JSON object on its own line:
```json
{"user_message": {"title": "Optional Title", "content": "Message content here", "content_type": "info", "priority": "normal"}}
```
Fields:
- `title` (optional): Short title for the message
- `content` (required): The message body
- `content_type` (optional): "info", "warning", "error", "success" (default: "info")
- `priority` (optional): "low", "normal", "high", "urgent" (default: "normal")

"#;

const PROTOCOL_PERSONA_ACTION: &str = r#"### Persona Action Protocol
To trigger an action on another persona, output a JSON object on its own line:
```json
{"persona_action": {"target": "target-persona-id", "action": "run", "input": {"key": "value"}}}
```
Fields:
- `target` (required): The persona ID to target
- `action` (optional): Action to perform (default: "run")
- `input` (optional): JSON data to pass to the target persona

"#;

const PROTOCOL_EMIT_EVENT: &str = r#"### Emit Event Protocol
To emit an event to the system event bus, output a JSON object on its own line:
```json
{"emit_event": {"type": "task_completed", "data": {"result": "success", "details": "..."}}}
```
Fields:
- `type` (required): Event type identifier
- `data` (optional): Arbitrary JSON payload

"#;

const PROTOCOL_AGENT_MEMORY: &str = r#"### Agent Memory Protocol
To store a memory for future reference, output a JSON object on its own line:
```json
{"agent_memory": {"title": "Memory Title", "content": "What to remember", "category": "learning", "importance": 5, "tags": ["tag1", "tag2"]}}
```
Fields:
- `title` (required): Short title for the memory
- `content` (required): Detailed content to remember
- `category` (optional): "learning", "preference", "fact", "procedure" (default: "general")
- `importance` (optional): 1-10 importance rating (default: 5)
- `tags` (optional): Array of string tags for categorization

"#;

const PROTOCOL_MANUAL_REVIEW: &str = r#"### Manual Review Protocol
To flag something for human review, output a JSON object on its own line:
```json
{"manual_review": {"title": "Review Title", "description": "What needs review", "severity": "medium", "context_data": "relevant context", "suggested_actions": ["action1", "action2"]}}
```
Fields:
- `title` (required): Short title describing the review item
- `description` (optional): Detailed description
- `severity` (optional): "low", "medium", "high", "critical" (default: "medium")
- `context_data` (optional): Additional context string
- `suggested_actions` (optional): Array of suggested resolution steps

"#;

const PROTOCOL_EXECUTION_FLOW: &str = r#"### Execution Flow Protocol
To declare execution flow metadata, output a JSON object on its own line:
```json
{"execution_flow": {"flows": [{"step": 1, "action": "analyze", "status": "completed"}, {"step": 2, "action": "implement", "status": "pending"}]}}
```
Fields:
- `flows` (required): JSON value describing the execution flow steps

"#;

const PROTOCOL_OUTCOME_ASSESSMENT: &str = r#"### Outcome Assessment Protocol
IMPORTANT: At the very end of your execution, you MUST output an outcome assessment as the last thing before finishing:
```json
{"outcome_assessment": {"accomplished": true, "summary": "Brief description of what was achieved"}}
```
Fields:
- `accomplished` (required): true if the task was successfully completed from a business perspective, false if it could not be completed
- `summary` (required): Brief description of the outcome
- `blockers` (optional): List of reasons the task could not be completed (only when accomplished is false)

You MUST always output this assessment. Set accomplished to false if:
- Required data was not available or accessible
- External services were unreachable or returned errors that prevented task completion
- The task requirements could not be fulfilled with the available tools
- You could not verify the task was completed correctly

"#;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{Persona, PersonaToolDefinition};

    fn test_persona() -> Persona {
        Persona {
            id: "test-id".into(),
            project_id: "proj-1".into(),
            name: "Test Agent".into(),
            description: Some("A test agent".into()),
            system_prompt: "You are a helpful test agent.".into(),
            structured_prompt: None,
            icon: None,
            color: None,
            enabled: true,
            max_concurrent: 2,
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
            id: "tool-1".into(),
            name: "file_reader".into(),
            category: "filesystem".into(),
            description: "Reads files from disk".into(),
            script_path: "tools/file_reader.ts".into(),
            input_schema: Some(r#"{"path": "string"}"#.into()),
            output_schema: None,
            requires_credential_type: None,
            implementation_guide: None,
            is_builtin: true,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn test_assemble_minimal_prompt() {
        let persona = test_persona();
        let prompt = assemble_prompt(&persona, &[], None, None);

        assert!(prompt.contains("# Persona: Test Agent"));
        assert!(prompt.contains("You are a helpful test agent."));
        assert!(prompt.contains("## EXECUTE NOW"));
        // No tools section when tools is empty
        assert!(!prompt.contains("## Available Tools"));
        // Should not contain "Use available tools" when no tools
        assert!(!prompt.contains("Use available tools as needed."));
    }

    #[test]
    fn test_prompt_contains_persona_name() {
        let persona = test_persona();
        let prompt = assemble_prompt(&persona, &[], None, None);

        assert!(prompt.contains("# Persona: Test Agent"));
        assert!(prompt.contains("You are Test Agent."));
    }

    #[test]
    fn test_prompt_contains_system_prompt() {
        let persona = test_persona();
        let prompt = assemble_prompt(&persona, &[], None, None);

        assert!(prompt.contains("## Identity"));
        assert!(prompt.contains("You are a helpful test agent."));
    }

    #[test]
    fn test_prompt_with_structured_prompt() {
        let mut persona = test_persona();
        persona.structured_prompt = Some(
            serde_json::json!({
                "identity": "I am a code reviewer.",
                "instructions": "Review all pull requests carefully.",
                "toolGuidance": "Use the linter tool first.",
                "examples": "Example: Check for null pointers.",
                "errorHandling": "Report errors clearly.",
                "customSections": [
                    {"name": "Security", "content": "Always check for SQL injection."}
                ]
            })
            .to_string(),
        );

        let prompt = assemble_prompt(&persona, &[], None, None);

        assert!(prompt.contains("## Identity\nI am a code reviewer."));
        assert!(prompt.contains("## Instructions\nReview all pull requests carefully."));
        assert!(prompt.contains("## Tool Guidance\nUse the linter tool first."));
        assert!(prompt.contains("## Examples\nExample: Check for null pointers."));
        assert!(prompt.contains("## Error Handling\nReport errors clearly."));
        assert!(prompt.contains("## Security\nAlways check for SQL injection."));
        // system_prompt should NOT appear since structured_prompt is used
        assert!(!prompt.contains("You are a helpful test agent."));
    }

    #[test]
    fn test_prompt_with_web_search() {
        let mut persona = test_persona();
        persona.structured_prompt = Some(
            serde_json::json!({
                "identity": "I am a researcher.",
                "instructions": "Research market trends.",
                "webSearch": "Search for Q1 2026 tech industry reports and competitor pricing data."
            })
            .to_string(),
        );

        let prompt = assemble_prompt(&persona, &[], None, None);

        assert!(prompt.contains("## Web Search Research Prompt"));
        assert!(prompt.contains("Q1 2026 tech industry reports"));
        assert!(prompt.contains("research guidance"));
    }

    #[test]
    fn test_prompt_without_web_search_when_empty() {
        let mut persona = test_persona();
        persona.structured_prompt = Some(
            serde_json::json!({
                "identity": "I am a helper.",
                "instructions": "Help users.",
                "webSearch": ""
            })
            .to_string(),
        );

        let prompt = assemble_prompt(&persona, &[], None, None);

        assert!(!prompt.contains("## Web Search Research Prompt"));
    }

    #[test]
    fn test_prompt_with_tools() {
        let persona = test_persona();
        let tool = test_tool();
        let prompt = assemble_prompt(&persona, &[tool], None, None);

        assert!(prompt.contains("## Available Tools"));
        assert!(prompt.contains("### file_reader"));
        assert!(prompt.contains("Reads files from disk"));
        assert!(prompt.contains("**Category**: filesystem"));
        assert!(prompt.contains("tools/file_reader.ts"));
        assert!(prompt.contains(r#"{"path": "string"}"#));
        // Should include "Use available tools" when tools present
        assert!(prompt.contains("Use available tools as needed."));
    }

    #[test]
    fn test_tool_with_implementation_guide() {
        let mut tool = test_tool();
        tool.script_path = String::new(); // n8n-imported tool
        tool.implementation_guide =
            Some("API: GET https://api.example.com/data\nAuth: Bearer $TOKEN".into());
        let doc = build_tool_documentation(&tool);
        assert!(doc.contains("**Implementation Guide**:"));
        assert!(doc.contains("https://api.example.com/data"));
        assert!(!doc.contains("Use the Bash tool"));
    }

    #[test]
    fn test_tool_without_guide_shows_fallback() {
        let mut tool = test_tool();
        tool.script_path = String::new(); // n8n-imported tool, no guide
        tool.implementation_guide = None;
        let doc = build_tool_documentation(&tool);
        assert!(doc.contains("Use the Bash tool to call the relevant API"));
        assert!(!doc.contains("**Implementation Guide**:"));
    }

    #[test]
    fn test_prompt_with_input_data() {
        let persona = test_persona();
        let input = serde_json::json!({"task": "review", "files": ["main.rs"]});
        let prompt = assemble_prompt(&persona, &[], Some(&input), None);

        assert!(prompt.contains("## Input Data"));
        assert!(prompt.contains("```json"));
        assert!(prompt.contains("\"task\": \"review\""));
        assert!(prompt.contains("\"main.rs\""));
    }

    #[test]
    fn test_prompt_contains_protocols() {
        let persona = test_persona();
        let prompt = assemble_prompt(&persona, &[], None, None);

        assert!(prompt.contains("## Communication Protocols"));
        assert!(prompt.contains("### User Message Protocol"));
        assert!(prompt.contains("### Persona Action Protocol"));
        assert!(prompt.contains("### Emit Event Protocol"));
        assert!(prompt.contains("### Agent Memory Protocol"));
        assert!(prompt.contains("### Manual Review Protocol"));
        assert!(prompt.contains("### Execution Flow Protocol"));
        assert!(prompt.contains("### Outcome Assessment Protocol"));
    }

    #[test]
    fn test_prompt_ends_with_execute_now() {
        let persona = test_persona();
        let prompt = assemble_prompt(&persona, &[], None, None);

        assert!(prompt.contains("## EXECUTE NOW"));
        assert!(prompt.contains("Respond naturally and complete the task."));
        // The EXECUTE NOW section should come after protocols
        let exec_pos = prompt.find("## EXECUTE NOW").unwrap();
        let proto_pos = prompt.find("## Communication Protocols").unwrap();
        assert!(exec_pos > proto_pos);
    }

    #[test]
    fn test_cli_args_base_flags() {
        let persona = test_persona();
        let args = build_cli_args(Some(&persona), None);

        // Check base flags are present
        assert!(args.args.contains(&"-p".to_string()));
        assert!(args.args.contains(&"-".to_string()));
        assert!(args.args.contains(&"--output-format".to_string()));
        assert!(args.args.contains(&"stream-json".to_string()));
        assert!(args.args.contains(&"--verbose".to_string()));
        assert!(args
            .args
            .contains(&"--dangerously-skip-permissions".to_string()));

        // Platform-specific command
        if cfg!(windows) {
            assert_eq!(args.command, "cmd");
            assert!(args.args.contains(&"/C".to_string()));
            assert!(args.args.contains(&"claude.cmd".to_string()));
        } else {
            assert_eq!(args.command, "claude");
        }
    }

    #[test]
    fn test_cli_args_with_model() {
        let profile = ModelProfile {
            model: Some("claude-sonnet-4-20250514".into()),
            ..Default::default()
        };
        let args = build_cli_args(None, Some(&profile));

        assert!(args.args.contains(&"--model".to_string()));
        assert!(args.args.contains(&"claude-sonnet-4-20250514".to_string()));
    }

    #[test]
    fn test_cli_args_with_budget() {
        let mut persona = test_persona();
        persona.max_budget_usd = Some(1.5);

        let args = build_cli_args(Some(&persona), None);

        assert!(args.args.contains(&"--max-budget-usd".to_string()));
        assert!(args.args.contains(&"1.5".to_string()));
    }

    #[test]
    fn test_cli_args_with_max_turns() {
        let mut persona = test_persona();
        persona.max_turns = Some(10);

        let args = build_cli_args(Some(&persona), None);

        assert!(args.args.contains(&"--max-turns".to_string()));
        assert!(args.args.contains(&"10".to_string()));
    }

    #[test]
    fn test_cli_args_default_no_persona() {
        let args = build_cli_args(None, None);

        // Should produce same base flags as with persona
        assert!(args.args.contains(&"-p".to_string()));
        assert!(args.args.contains(&"--verbose".to_string()));
        // No persona-specific flags
        assert!(!args.args.contains(&"--max-budget-usd".to_string()));
        assert!(!args.args.contains(&"--max-turns".to_string()));
    }

    #[test]
    fn test_parse_model_profile_none() {
        assert!(parse_model_profile(None).is_none());
        assert!(parse_model_profile(Some("")).is_none());
        assert!(parse_model_profile(Some("  ")).is_none());
    }

    #[test]
    fn test_parse_model_profile_valid() {
        let json = r#"{"model": "gpt-4", "provider": "openai", "base_url": "https://api.example.com", "auth_token": "sk-123"}"#;
        let profile = parse_model_profile(Some(json)).unwrap();

        assert_eq!(profile.model, Some("gpt-4".into()));
        assert_eq!(profile.provider, Some("openai".into()));
        assert_eq!(profile.base_url, Some("https://api.example.com".into()));
        assert_eq!(profile.auth_token, Some("sk-123".into()));
    }

    #[test]
    fn test_parse_model_profile_invalid_json() {
        assert!(parse_model_profile(Some("{invalid json}")).is_none());
        assert!(parse_model_profile(Some("not json at all")).is_none());
        assert!(parse_model_profile(Some("[1,2,3]")).is_none());
    }
}
