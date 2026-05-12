//! Generic staged-compilation framework for all compiler pipelines.
//!
//! The codebase has several compilers (PersonaCompiler, IntentCompiler,
//! WorkflowCompiler) that all follow the same structural pattern:
//!
//!   input → prompt assembly → LLM generation → output parsing → validation → persistence
//!
//! This module provides a generic `CompilationPipeline` trait that each compiler
//! implements by supplying stage-specific logic, and a shared `CompilationStage`
//! enum that the frontend already consumes for progress tracking.
//!
//! Adding a new compilation target (e.g. ConnectorCompiler, TriggerCompiler)
//! requires only implementing the trait — no new stage enums, error handling
//! boilerplate, or LLM interaction patterns.

use serde::Serialize;
use ts_rs::TS;

// ============================================================================
// Compilation Stages (shared across all pipelines)
// ============================================================================

/// Named stages of any compilation pipeline.
///
/// Every pipeline runs these stages in order.  A stage may short-circuit
/// (e.g. `ResultParsing` can yield a clarification question instead of a result).
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CompilationStage {
    /// Build the LLM prompt from the pipeline's typed input.
    PromptAssembly,
    /// Spawn the LLM process and stream output.
    LlmGeneration,
    /// Parse the raw LLM output into a structured result.
    ResultParsing,
    /// Validate / enrich the parsed result (e.g. feasibility check).
    Validation,
    /// Persist the final result to the database.
    Persist,
}

#[allow(dead_code)]
impl CompilationStage {
    pub fn label(&self) -> &'static str {
        match self {
            Self::PromptAssembly => "Assembling prompt",
            Self::LlmGeneration => "Generating with AI",
            Self::ResultParsing => "Parsing output",
            Self::Validation => "Validating result",
            Self::Persist => "Saving result",
        }
    }

    /// Return all stages in pipeline order.
    pub fn all() -> &'static [CompilationStage] {
        &[
            Self::PromptAssembly,
            Self::LlmGeneration,
            Self::ResultParsing,
            Self::Validation,
            Self::Persist,
        ]
    }
}

// ============================================================================
// Pipeline Outcome (shared parse result type)
// ============================================================================

/// The outcome of parsing LLM output — either a structured result,
/// a clarification question, or a failure.
///
/// Generic over `T` so each pipeline can define its own result type
/// while still sharing the question/failed variants.
#[allow(dead_code)]
pub enum PipelineOutcome<T> {
    /// A complete result was extracted and parsed.
    Result(T),
    /// The LLM asked a clarification question instead of producing a result.
    Question(serde_json::Value),
    /// No valid output could be extracted.
    Failed,
}

// ============================================================================
// CompilationPipeline trait
// ============================================================================

/// A generic compilation pipeline.
///
/// Each compiler implements this trait to define how its specific input type
/// is assembled into a prompt, how raw LLM output is parsed into its output
/// type, and how the output is validated.
///
/// LLM generation (stage 2) and persistence (stage 5) are intentionally NOT
/// part of this trait because generation is always the same (spawn CLI, stream
/// stdout) and persistence varies too much in shape (SQL transactions, simple
/// updates, etc.) to benefit from a single trait method.
#[allow(dead_code)]
pub trait CompilationPipeline {
    /// The typed input for this pipeline (e.g. persona + tools + instruction).
    type Input;
    /// The structured output produced by parsing (e.g. serde_json::Value, TopologyBlueprint).
    type Output;

    /// Stage 1: Assemble the LLM prompt from the typed input.
    fn assemble_prompt(&self, input: &Self::Input) -> String;

    /// Stage 3: Parse raw LLM output into a structured outcome.
    fn parse_output(&self, raw: &str) -> PipelineOutcome<Self::Output>;

    /// Stage 4: Validate and optionally enrich the parsed output.
    /// Returns Ok(()) on success, Err with a description on failure.
    /// Default implementation is a no-op pass-through.
    fn validate(&self, _output: &mut Self::Output) -> Result<(), String> {
        Ok(())
    }

    /// Return the pipeline name for logging/tracing.
    fn pipeline_name(&self) -> &'static str;
}

// ============================================================================
// Prompt-assembly inventory (compile-time guard against duplication)
// ============================================================================

/// Canonical inventory of prompt-assembly entry points across the three
/// compilers that implement [`CompilationPipeline`]. See
/// [`engine/README.md`](./README.md) for the decision matrix that explains
/// which compiler owns which artifact.
///
/// This list is paired with the `const _: () = assert!(...)` below to make
/// it impossible to silently land a fifth compiler with an unregistered
/// prompt-assembly helper. If you add or remove a pipeline, update both this
/// list and the README in the same change.
///
/// `chain.rs` is deliberately **not** listed: it is a runtime event-cascade
/// evaluator and assembles no prompt.
#[doc(hidden)]
#[allow(dead_code)]
pub const PROMPT_ASSEMBLY_INVENTORY: &[&str] = &[
    "engine::compiler::assemble_prompt",
    "engine::intent_compiler::build_intent_prompt",
    "engine::workflow_compiler::WorkflowCompiler::assemble_prompt",
];

/// Compile-time assertion: keep the inventory at exactly three entries. If
/// this fires, you have either added a compiler without registering it
/// (breaking the documented boundary in `engine/README.md`) or removed one
/// without retiring its README row.
const _: () = assert!(
    PROMPT_ASSEMBLY_INVENTORY.len() == 3,
    "engine: PROMPT_ASSEMBLY_INVENTORY must list exactly the three compilers \
     described in engine/README.md (compiler, intent_compiler, workflow_compiler). \
     Update the inventory AND the README decision matrix together."
);

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compilation_stages_order() {
        let stages = CompilationStage::all();
        assert_eq!(stages.len(), 5);
        assert_eq!(stages[0], CompilationStage::PromptAssembly);
        assert_eq!(stages[4], CompilationStage::Persist);
    }

    #[test]
    fn test_stage_labels() {
        assert_eq!(
            CompilationStage::PromptAssembly.label(),
            "Assembling prompt"
        );
        assert_eq!(CompilationStage::Validation.label(), "Validating result");
    }

    /// Verify that a minimal pipeline implementation compiles and works.
    struct EchoPipeline;

    impl CompilationPipeline for EchoPipeline {
        type Input = String;
        type Output = String;

        fn assemble_prompt(&self, input: &String) -> String {
            format!("Echo: {input}")
        }

        fn parse_output(&self, raw: &str) -> PipelineOutcome<String> {
            if raw.is_empty() {
                PipelineOutcome::Failed
            } else {
                PipelineOutcome::Result(raw.to_string())
            }
        }

        fn pipeline_name(&self) -> &'static str {
            "echo"
        }
    }

    #[test]
    fn test_echo_pipeline_assemble() {
        let pipeline = EchoPipeline;
        let prompt = pipeline.assemble_prompt(&"hello".to_string());
        assert_eq!(prompt, "Echo: hello");
    }

    #[test]
    fn test_prompt_assembly_inventory_entries_are_unique() {
        let mut sorted: Vec<&&str> = PROMPT_ASSEMBLY_INVENTORY.iter().collect();
        sorted.sort();
        let before = sorted.len();
        sorted.dedup();
        assert_eq!(
            before,
            sorted.len(),
            "Duplicate entries in PROMPT_ASSEMBLY_INVENTORY — each compiler must register exactly one prompt-assembly helper"
        );
    }

    #[test]
    fn test_echo_pipeline_parse() {
        let pipeline = EchoPipeline;
        match pipeline.parse_output("some output") {
            PipelineOutcome::Result(s) => assert_eq!(s, "some output"),
            _ => panic!("Expected Result"),
        }
        match pipeline.parse_output("") {
            PipelineOutcome::Failed => {}
            _ => panic!("Expected Failed"),
        }
    }
}
