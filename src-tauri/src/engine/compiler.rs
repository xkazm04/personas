//! PersonaCompiler — explicit multi-stage compilation pipeline for persona design.
//!
//! The design workflow is structurally a compiler:
//!   wizard input → NL instruction → LLM prompt → Claude CLI → raw output → parsed JSON → feasibility check → DB persist
//!
//! This module makes the stages explicit so that refinement is simply
//! recompilation with additional constraints, and new stages (validation,
//! optimization, dry-run) can be added without touching the UI layer.

use serde::Serialize;
use ts_rs::TS;

use crate::db::models::{ConnectorDefinition, Persona, PersonaToolDefinition};
use crate::engine::design;

// ============================================================================
// Compilation Stages
// ============================================================================

/// Named stages of the persona compilation pipeline.
///
/// The pipeline always runs these in order. Each stage produces an output
/// that feeds into the next. A stage can short-circuit the pipeline
/// (e.g. `Parse` may yield a clarification question instead of a result).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CompilationStage {
    /// Build the LLM prompt from persona + tools + connectors + instruction.
    PromptAssembly,
    /// Spawn the Claude CLI and stream output.
    LlmGeneration,
    /// Parse the raw LLM output into a structured result or question.
    ResultParsing,
    /// Validate the parsed result against available tools/connectors.
    FeasibilityCheck,
    /// Persist the final result to the database.
    Persist,
}

impl CompilationStage {
    pub fn label(&self) -> &'static str {
        match self {
            Self::PromptAssembly => "Assembling prompt",
            Self::LlmGeneration => "Generating with AI",
            Self::ResultParsing => "Parsing output",
            Self::FeasibilityCheck => "Checking feasibility",
            Self::Persist => "Saving result",
        }
    }

    /// Return all stages in pipeline order.
    pub fn all() -> &'static [CompilationStage] {
        &[
            Self::PromptAssembly,
            Self::LlmGeneration,
            Self::ResultParsing,
            Self::FeasibilityCheck,
            Self::Persist,
        ]
    }
}

// ============================================================================
// Compilation Input
// ============================================================================

/// Everything needed to compile a persona design.
///
/// For initial compilation, `existing_result` is None.
/// For refinement (recompilation), it contains the previous result JSON and
/// `instruction` is the user's feedback/constraint.
pub struct CompilationInput<'a> {
    pub persona: &'a Persona,
    pub tools: &'a [PersonaToolDefinition],
    pub connectors: &'a [ConnectorDefinition],
    pub instruction: &'a str,
    pub design_context: Option<&'a str>,
    pub existing_result: Option<&'a str>,
    pub conversation_history: Option<&'a str>,
}

// ============================================================================
// Prompt Assembly (Stage 1)
// ============================================================================

/// Assemble the LLM prompt for the given compilation input.
///
/// For initial compilation, delegates to `build_design_prompt`.
/// For refinement (when `existing_result` is Some), delegates to
/// `build_refinement_prompt_with_history`.
pub fn assemble_prompt(input: &CompilationInput) -> String {
    if let Some(existing) = input.existing_result {
        // Refinement / recompilation — instruction is the feedback
        design::build_refinement_prompt_with_history(
            existing,
            input.instruction,
            input.design_context,
            input.conversation_history,
        )
    } else {
        // Initial compilation
        design::build_design_prompt(
            input.persona,
            input.tools,
            input.connectors,
            input.instruction,
            input.design_context,
            None,
        )
    }
}

// ============================================================================
// Result Parsing (Stage 3)
// ============================================================================

/// The outcome of parsing LLM output — either a design result, a question, or failure.
pub enum ParseOutcome {
    /// A complete design result was extracted.
    Result(serde_json::Value),
    /// The LLM asked a clarification question.
    Question(serde_json::Value),
    /// No valid JSON could be extracted.
    Failed,
}

/// Parse raw LLM output into a structured outcome.
pub fn parse_output(raw_output: &str) -> ParseOutcome {
    // Check for clarification question first
    if let Some(question) = design::extract_design_question(raw_output) {
        return ParseOutcome::Question(question);
    }
    // Then check for a full design result
    if let Some(result) = design::extract_design_result(raw_output) {
        return ParseOutcome::Result(result);
    }
    ParseOutcome::Failed
}

// ============================================================================
// Feasibility Check (Stage 4)
// ============================================================================

/// Run feasibility check and attach the result to the design JSON.
pub fn run_feasibility(
    result: &mut serde_json::Value,
    tool_names: &[String],
    connector_names: &[String],
) -> design::FeasibilityResult {
    let feasibility = design::check_feasibility(&result.to_string(), tool_names, connector_names);

    if let Some(obj) = result.as_object_mut() {
        obj.insert(
            "feasibility".into(),
            serde_json::json!({
                "confirmed_capabilities": feasibility.confirmed_capabilities,
                "issues": feasibility.issues,
                "overall_feasibility": feasibility.overall,
            }),
        );
    }

    feasibility
}

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

    #[test]
    fn test_assemble_prompt_initial() {
        let persona = test_persona();
        let input = CompilationInput {
            persona: &persona,
            tools: &[],
            connectors: &[],
            instruction: "Monitor my inbox",
            design_context: None,
            existing_result: None,
            conversation_history: None,
        };
        let prompt = assemble_prompt(&input);
        assert!(prompt.contains("# Persona Design Analysis"));
        assert!(prompt.contains("Monitor my inbox"));
    }

    #[test]
    fn test_assemble_prompt_refinement() {
        let persona = test_persona();
        let existing = r#"{"structured_prompt":{"identity":"test"}}"#;
        let input = CompilationInput {
            persona: &persona,
            tools: &[],
            connectors: &[],
            instruction: "Add Slack notifications",
            design_context: None,
            existing_result: Some(existing),
            conversation_history: None,
        };
        let prompt = assemble_prompt(&input);
        assert!(prompt.contains("# Design Refinement"));
        assert!(prompt.contains("Add Slack notifications"));
    }

    #[test]
    fn test_parse_output_result() {
        let output = r##"Here is the design:

```json
{"structured_prompt":{"identity":"test","instructions":"test","toolGuidance":"","examples":"","errorHandling":"","customSections":[]},"suggested_tools":[],"suggested_triggers":[],"full_prompt_markdown":"# Test","summary":"A test persona"}
```
"##;
        match parse_output(output) {
            ParseOutcome::Result(val) => {
                assert!(val.get("structured_prompt").is_some());
            }
            _ => panic!("Expected Result"),
        }
    }

    #[test]
    fn test_parse_output_question() {
        let output = r##"I need clarification:

```json
{"design_question":{"question":"What data sources?","options":["Email","Slack"],"context":"Scope matters"}}
```
"##;
        match parse_output(output) {
            ParseOutcome::Question(q) => {
                assert_eq!(
                    q.get("question").and_then(|v| v.as_str()),
                    Some("What data sources?")
                );
            }
            _ => panic!("Expected Question"),
        }
    }

    #[test]
    fn test_parse_output_failed() {
        let output = "Some text that doesn't contain any valid JSON";
        match parse_output(output) {
            ParseOutcome::Failed => {}
            _ => panic!("Expected Failed"),
        }
    }

    #[test]
    fn test_compilation_stages_order() {
        let stages = CompilationStage::all();
        assert_eq!(stages.len(), 5);
        assert_eq!(stages[0], CompilationStage::PromptAssembly);
        assert_eq!(stages[4], CompilationStage::Persist);
    }
}
