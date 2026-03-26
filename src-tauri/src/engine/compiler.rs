//! PersonaCompiler -- persona design compilation via the staged pipeline framework.
//!
//! This module implements `CompilationPipeline` for persona design:
//!   wizard input → NL instruction → LLM prompt → Claude CLI → raw output →
//!   parsed JSON → feasibility check → DB persist
//!
//! The public API (`assemble_prompt`, `parse_output`, `run_feasibility`) is
//! preserved for backward compatibility; each delegates to the pipeline impl.

use crate::db::models::{ConnectorDefinition, Persona, PersonaToolDefinition};
use crate::engine::compilation_pipeline::{CompilationPipeline, PipelineOutcome};
use crate::engine::design;

// Re-export the shared stage enum so existing `use crate::engine::compiler::CompilationStage`
// continues to work without changing every import site.
pub use crate::engine::compilation_pipeline::CompilationStage;

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
// Parse Outcome (backward-compatible alias)
// ============================================================================

/// The outcome of parsing LLM output -- either a design result, a question, or failure.
///
/// This is now a thin wrapper around `PipelineOutcome<serde_json::Value>`.
pub enum ParseOutcome {
    /// A complete design result was extracted.
    Result(serde_json::Value),
    /// The LLM asked a clarification question.
    Question(serde_json::Value),
    /// No valid JSON could be extracted.
    Failed,
}

impl From<PipelineOutcome<serde_json::Value>> for ParseOutcome {
    fn from(outcome: PipelineOutcome<serde_json::Value>) -> Self {
        match outcome {
            PipelineOutcome::Result(v) => ParseOutcome::Result(v),
            PipelineOutcome::Question(v) => ParseOutcome::Question(v),
            PipelineOutcome::Failed => ParseOutcome::Failed,
        }
    }
}

// ============================================================================
// PersonaCompiler (pipeline implementation)
// ============================================================================

/// The persona design compiler — implements the generic pipeline for
/// persona prompt assembly, output parsing, and feasibility validation.
pub struct PersonaCompiler {
    /// Tool names available for feasibility checking (stage 4).
    pub tool_names: Vec<String>,
    /// Connector names available for feasibility checking (stage 4).
    pub connector_names: Vec<String>,
}

impl CompilationPipeline for PersonaCompiler {
    type Input = CompilationInput<'static>;
    type Output = serde_json::Value;

    fn assemble_prompt(&self, input: &Self::Input) -> String {
        assemble_prompt(input)
    }

    fn parse_output(&self, raw: &str) -> PipelineOutcome<Self::Output> {
        if let Some(question) = design::extract_design_question(raw) {
            return PipelineOutcome::Question(question);
        }
        if let Some(result) = design::extract_design_result(raw) {
            return PipelineOutcome::Result(result);
        }
        PipelineOutcome::Failed
    }

    fn validate(&self, output: &mut Self::Output) -> Result<(), String> {
        run_feasibility(output, &self.tool_names, &self.connector_names);
        Ok(())
    }

    fn pipeline_name(&self) -> &'static str {
        "persona"
    }
}

// ============================================================================
// Backward-compatible free functions
// ============================================================================

/// Assemble the LLM prompt for the given compilation input.
///
/// For initial compilation, delegates to `build_design_prompt`.
/// For refinement (when `existing_result` is Some), delegates to
/// `build_refinement_prompt_with_history`.
pub fn assemble_prompt(input: &CompilationInput) -> String {
    if let Some(existing) = input.existing_result {
        design::build_refinement_prompt_with_history(
            existing,
            input.instruction,
            input.design_context,
            input.conversation_history,
        )
    } else {
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

/// Parse raw LLM output into a structured outcome.
pub fn parse_output(raw_output: &str) -> ParseOutcome {
    if let Some(question) = design::extract_design_question(raw_output) {
        return ParseOutcome::Question(question);
    }
    if let Some(result) = design::extract_design_result(raw_output) {
        return ParseOutcome::Result(result);
    }
    ParseOutcome::Failed
}

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
    use crate::engine::compilation_pipeline::CompilationStage;

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
            sensitive: false,
            headless: false,
            max_concurrent: 1,
            timeout_ms: 300000,
            notification_channels: None,
            last_design_result: None,
            model_profile: None,
            max_budget_usd: None,
            max_turns: None,
            design_context: None,
            group_id: None,
            source_review_id: None,
            trust_level: "manual".into(),
            trust_origin: "user".into(),
            trust_verified_at: None,
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

    #[test]
    fn test_persona_compiler_pipeline_trait() {
        let compiler = PersonaCompiler {
            tool_names: vec![],
            connector_names: vec![],
        };
        assert_eq!(compiler.pipeline_name(), "persona");

        // parse_output via trait
        let raw = "Some text that doesn't contain any valid JSON";
        match compiler.parse_output(raw) {
            PipelineOutcome::Failed => {}
            _ => panic!("Expected Failed"),
        }
    }
}
