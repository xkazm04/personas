use super::super::*;
use super::{test_persona, test_tool};
use personas_db::models::LlmUsageHint;

#[test]
fn test_assemble_minimal_prompt() {
    let persona = test_persona();
    let prompt = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

    assert!(prompt.contains("# Persona: Test Agent"));
    assert!(prompt.contains("You are a helpful test agent."));
    assert!(prompt.contains("## EXECUTE NOW"));
    // No tools section when tools is empty
    assert!(!prompt.contains("## Available Tools"));
    // Should not contain "Use available tools" when no tools
    assert!(!prompt.contains("Use available tools as needed."));
}

#[test]
fn assemble_prompt_defaults_to_autonomous_mode() {
    // Persona with parameters = None should fall back to AUTONOMOUS discipline.
    let persona = test_persona();
    let prompt = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );
    assert!(
        prompt.contains("## Execution Mode: AUTONOMOUS"),
        "Persona with no parameters should use AUTONOMOUS mode"
    );
    assert!(
        prompt.contains("do not ask questions"),
        "AUTONOMOUS directive should forbid clarifying questions"
    );
    assert!(
        !prompt.contains("## Execution Mode: DELIBERATE"),
        "DELIBERATE directive should NOT appear when mode is autonomous"
    );
}

#[test]
fn assemble_prompt_injects_fanout_directive_when_enabled() {
    let mut persona = test_persona();
    // Off by default — no directive.
    let base = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );
    assert!(!base.contains("Parallel Delegation"));

    // Opted in via the deep_fanout parameter (accepts bool or "true").
    persona.parameters = Some(
        serde_json::json!([{ "key": "deep_fanout", "type": "boolean", "value": true }]).to_string(),
    );
    let prompt = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );
    assert!(
        prompt.contains("## Parallel Delegation (deep fan-out)"),
        "deep_fanout=true should inject the fan-out directive"
    );
}

#[test]
fn deep_fanout_adds_forward_subagent_text_flag() {
    let mut persona = test_persona();
    // Off by default — no flag, so ordinary executions don't pay the extra
    // subagent stream volume.
    let base = build_cli_args(Some(&persona), None);
    assert!(!base.args.contains(&"--forward-subagent-text".to_string()));

    persona.parameters = Some(
        serde_json::json!([{ "key": "deep_fanout", "type": "boolean", "value": true }]).to_string(),
    );
    let args = build_cli_args(Some(&persona), None);
    assert!(
        args.args.contains(&"--forward-subagent-text".to_string()),
        "deep_fanout=true should forward subagent text (CLI >= 2.1.211)"
    );
}

#[test]
fn assemble_prompt_honors_deliberate_parameter() {
    let mut persona = test_persona();
    persona.parameters = Some(
        serde_json::json!([
            {
                "key": "execution_discipline",
                "type": "select",
                "default": "autonomous",
                "value": "deliberate",
                "options": ["autonomous", "deliberate"]
            }
        ])
        .to_string(),
    );

    let prompt = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );
    assert!(
        prompt.contains("## Execution Mode: DELIBERATE"),
        "Persona with execution_discipline=deliberate should use DELIBERATE mode"
    );
    assert!(
        prompt.contains("Think before acting"),
        "DELIBERATE directive should include Think before acting"
    );
    assert!(
        prompt.contains("manual_review"),
        "DELIBERATE directive should authorize manual_review for technical ambiguity"
    );
    assert!(
        prompt.contains("Stay surgical"),
        "DELIBERATE directive should include surgical language"
    );
    assert!(
        !prompt.contains("## Execution Mode: AUTONOMOUS"),
        "AUTONOMOUS directive should NOT appear when mode is deliberate"
    );
    // The bottom reinforcement should also match the Deliberate path.
    assert!(
        prompt.contains("Follow the DELIBERATE discipline above"),
        "EXECUTE NOW block should use the Deliberate reinforcement text"
    );
}

#[test]
fn assemble_prompt_ignores_malformed_discipline_parameter() {
    // Garbage that is not valid JSON: should fall back to AUTONOMOUS without panic.
    let mut persona = test_persona();
    persona.parameters = Some("not valid json".to_string());
    let prompt = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );
    assert!(
        prompt.contains("## Execution Mode: AUTONOMOUS"),
        "Malformed parameters JSON should fall back to AUTONOMOUS"
    );

    // Valid JSON but unknown discipline value: should fall back to AUTONOMOUS.
    persona.parameters = Some(
        serde_json::json!([
            {"key": "execution_discipline", "value": "chaos", "type": "select"}
        ])
        .to_string(),
    );
    let prompt = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );
    assert!(
        prompt.contains("## Execution Mode: AUTONOMOUS"),
        "Unknown discipline value should fall back to AUTONOMOUS"
    );

    // Parameter absent entirely (but parameters field populated with other keys):
    // should also fall back to AUTONOMOUS.
    persona.parameters = Some(
        serde_json::json!([
            {"key": "some_other_param", "value": "foo", "type": "string"}
        ])
        .to_string(),
    );
    let prompt = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );
    assert!(
        prompt.contains("## Execution Mode: AUTONOMOUS"),
        "Missing execution_discipline key should fall back to AUTONOMOUS"
    );
}

#[test]
fn test_prompt_contains_persona_name() {
    let persona = test_persona();
    let prompt = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

    assert!(prompt.contains("# Persona: Test Agent"));
    assert!(prompt.contains("You are Test Agent."));
}

#[test]
fn test_prompt_contains_system_prompt() {
    let persona = test_persona();
    let prompt = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

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

    let prompt = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

    assert!(prompt.contains("## Identity\n"));
    assert!(prompt.contains("I am a code reviewer."));
    assert!(prompt.contains("## Instructions\n"));
    assert!(prompt.contains("Review all pull requests carefully."));
    assert!(prompt.contains("## Tool Guidance\n"));
    assert!(prompt.contains("Use the linter tool first."));
    assert!(prompt.contains("## Examples\n"));
    assert!(prompt.contains("Example: Check for null pointers."));
    assert!(prompt.contains("## Error Handling\n"));
    assert!(prompt.contains("Report errors clearly."));
    assert!(prompt.contains("## Security\n"));
    assert!(prompt.contains("Always check for SQL injection."));
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

    let prompt = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

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

    let prompt = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

    assert!(!prompt.contains("## Web Search Research Prompt"));
}

#[test]
fn test_prompt_with_tools() {
    let persona = test_persona();
    let tool = test_tool();
    let prompt = assemble_prompt(
        &persona,
        &[tool],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

    assert!(prompt.contains("## Available Tools"));
    assert!(prompt.contains("### file_reader"));
    assert!(prompt.contains("Reads files from disk"));
    assert!(prompt.contains("**Category**: filesystem"));
    assert!(prompt.contains("tools/file_reader.ts"));
    assert!(prompt.contains(r#"{"path": "string"}"#));
    // Should include "Use available tools" when tools present
    assert!(prompt.contains("Use available tools as needed."));
    // Universal web-research directive: native WebSearch/WebFetch, no external libs.
    assert!(prompt.contains("## Web Research"));
    assert!(prompt.contains("WebSearch"));
    assert!(prompt.contains("Do NOT install, import, or shell out to external web-search"));
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
    assert!(doc.contains("Use the Bash tool with `curl` to call the API"));
    assert!(!doc.contains("**Implementation Guide**:"));
}

#[test]
fn test_prompt_with_input_data() {
    let persona = test_persona();
    let input = serde_json::json!({"task": "review", "files": ["main.rs"]});
    let prompt = assemble_prompt(
        &persona,
        &[],
        Some(&input),
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

    assert!(prompt.contains("## Input Data"));
    assert!(prompt.contains("```json"));
    assert!(prompt.contains("\"task\": \"review\""));
    assert!(prompt.contains("\"main.rs\""));
}

// -- Connector Usage Reference (llm_usage_hint injection) ----------
//
// These tests lock the contract that when a persona has connector
// credentials attached and those connectors have llm_usage_hint metadata,
// the system prompt exposes a Connector Usage Reference section the
// agent can consult instead of probing APIs blindly.

/// Contract: connectors WITH llm_usage_hint render a full section with
/// label, overview, examples, and gotchas.
#[test]
fn test_prompt_usage_reference_section_present() {
    let persona = test_persona();
    let hint = LlmUsageHint {
        overview: "GitHub REST API v3. Auth via PAT in $GITHUB_TOKEN.".into(),
        examples: vec![
            "curl -H \"Authorization: Bearer $GITHUB_TOKEN\" https://api.github.com/user".into(),
        ],
        gotchas: Some(vec![
            "Pagination defaults to 30 items; use ?per_page=100.".into()
        ]),
    };
    let hints = vec![ResolvedConnectorHint {
        name: "github".into(),
        label: "GitHub".into(),
        hint,
    }];
    // Force the INLINE path deterministically: an empty written-skills set
    // means no connector shrank to a pointer, so full usage renders
    // regardless of the sidecar enable flag (which now defaults ON).
    let prompt = assemble_prompt_with_skills(
        &persona,
        &[],
        None,
        None,
        None,
        Some(&hints),
        #[cfg(feature = "desktop")]
        None,
        Some(&[]),
    );

    assert!(prompt.contains("## Connector Usage Reference"));
    assert!(prompt.contains("### GitHub"));
    assert!(prompt.contains("GitHub REST API v3"));
    assert!(prompt.contains("Examples:"));
    assert!(prompt.contains("api.github.com/user"));
    assert!(prompt.contains("Gotchas:"));
    assert!(prompt.contains("?per_page=100"));
}

/// Contract: when the sidecar is enabled and a connector's SKILL.md WAS
/// written, its usage shrinks to a skill pointer (no inline body).
#[test]
fn test_prompt_usage_reference_shrinks_to_pointer_when_written() {
    // SAFETY: shares the process-global sidecar env with other tests; set
    // it explicitly rather than relying on the default (mirrors the
    // hooks_sidecar env-var test convention).
    std::env::set_var(crate::skills_sidecar::SIDECAR_ENV, "1");
    let persona = test_persona();
    let hints = vec![ResolvedConnectorHint {
        name: "github".into(),
        label: "GitHub".into(),
        hint: LlmUsageHint {
            overview: "GitHub REST API v3.".into(),
            examples: vec!["curl https://api.github.com/user".into()],
            gotchas: None,
        },
    }];
    let prompt = assemble_prompt_with_skills(
        &persona,
        &[],
        None,
        None,
        None,
        Some(&hints),
        #[cfg(feature = "desktop")]
        None,
        Some(&["github".to_string()]),
    );
    std::env::remove_var(crate::skills_sidecar::SIDECAR_ENV);

    assert!(prompt.contains("## Connector Usage Reference"));
    assert!(prompt.contains("see skill `personas-connector-github`"));
    // Shrunk — no inline body / examples for the written connector.
    assert!(!prompt.contains("### GitHub"));
    assert!(!prompt.contains("api.github.com/user"));
}

/// Per-skill lockstep: with the sidecar enabled, a connector whose SKILL.md
/// was written shrinks to a pointer, while a connector NOT in the written
/// set (e.g. its write failed) KEEPS its full inline usage text.
#[test]
fn test_prompt_usage_reference_per_skill_lockstep() {
    std::env::set_var(crate::skills_sidecar::SIDECAR_ENV, "1");
    let persona = test_persona();
    let hints = vec![
        ResolvedConnectorHint {
            name: "github".into(),
            label: "GitHub".into(),
            hint: LlmUsageHint {
                overview: "GitHub REST API v3.".into(),
                examples: vec!["curl https://api.github.com/user".into()],
                gotchas: None,
            },
        },
        ResolvedConnectorHint {
            name: "slack".into(),
            label: "Slack".into(),
            hint: LlmUsageHint {
                overview: "Slack Web API. Post via chat.postMessage.".into(),
                examples: vec!["curl https://slack.com/api/chat.postMessage".into()],
                gotchas: None,
            },
        },
    ];
    // Only github's SKILL.md was written; slack's write failed.
    let prompt = assemble_prompt_with_skills(
        &persona,
        &[],
        None,
        None,
        None,
        Some(&hints),
        #[cfg(feature = "desktop")]
        None,
        Some(&["github".to_string()]),
    );
    std::env::remove_var(crate::skills_sidecar::SIDECAR_ENV);

    // github → pointer, no inline body.
    assert!(prompt.contains("see skill `personas-connector-github`"));
    assert!(!prompt.contains("### GitHub"));
    // slack → keeps full inline usage (write failed → no pointer).
    assert!(prompt.contains("### Slack"));
    assert!(prompt.contains("chat.postMessage"));
    assert!(!prompt.contains("see skill `personas-connector-slack`"));
}

/// Contract: when no connector hints are in scope, the section header
/// is absent -- no dangling empty block.
#[test]
fn test_prompt_usage_reference_section_absent() {
    let persona = test_persona();
    let prompt = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );
    assert!(!prompt.contains("## Connector Usage Reference"));

    // Also verify empty slice is treated same as None.
    let empty: [ResolvedConnectorHint; 0] = [];
    let prompt2 = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        Some(&empty),
        #[cfg(feature = "desktop")]
        None,
    );
    assert!(!prompt2.contains("## Connector Usage Reference"));
}

/// Contract: the section is rendered immediately after the Available
/// Credentials section when both are present.
#[test]
fn test_prompt_usage_reference_follows_credentials_section() {
    let persona = test_persona();
    let cred_hints = ["`GITHUB_TOKEN` (from GitHub credential 'my-gh')"];
    let hint = LlmUsageHint {
        overview: "GitHub REST API v3.".into(),
        examples: vec![],
        gotchas: None,
    };
    let hints = vec![ResolvedConnectorHint {
        name: "github".into(),
        label: "GitHub".into(),
        hint,
    }];
    let prompt = assemble_prompt(
        &persona,
        &[],
        None,
        Some(&cred_hints),
        None,
        Some(&hints),
        #[cfg(feature = "desktop")]
        None,
    );

    let creds_pos = prompt.find("## Available Credentials").unwrap();
    let refs_pos = prompt.find("## Connector Usage Reference").unwrap();
    assert!(refs_pos > creds_pos);
}

/// Roundtrip: a JSON metadata blob with llm_usage_hint deserializes
/// via ConnectorMetadataPartial, and the blob WITHOUT it also parses.
#[test]
fn test_connector_metadata_partial_roundtrip() {
    use personas_db::models::ConnectorMetadataPartial;

    let with_hint = r#"{
        "summary": "GitHub connector",
        "llm_usage_hint": {
            "overview": "GitHub API",
            "examples": ["curl https://api.github.com"],
            "gotchas": ["rate limited"]
        }
    }"#;
    let parsed: ConnectorMetadataPartial =
        serde_json::from_str(with_hint).expect("parse with hint");
    let hint = parsed.llm_usage_hint.expect("hint present");
    assert_eq!(hint.overview, "GitHub API");
    assert_eq!(hint.examples.len(), 1);
    assert_eq!(hint.gotchas.as_ref().unwrap().len(), 1);

    let without_hint = r#"{"summary":"Something","setup_guide":"..."}"#;
    let parsed2: ConnectorMetadataPartial =
        serde_json::from_str(without_hint).expect("parse without hint");
    assert!(parsed2.llm_usage_hint.is_none());
}

#[test]
fn test_prompt_contains_protocols() {
    let persona = test_persona();
    let prompt = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

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
    let prompt = assemble_prompt(
        &persona,
        &[],
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

    assert!(prompt.contains("## EXECUTE NOW"));
    assert!(prompt.contains("Act autonomously"));
    // The EXECUTE NOW section should come after protocols
    let exec_pos = prompt.find("## EXECUTE NOW").unwrap();
    let proto_pos = prompt.find("## Communication Protocols").unwrap();
    assert!(exec_pos > proto_pos);
}
