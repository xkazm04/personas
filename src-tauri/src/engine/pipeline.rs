//! ExecutionPipeline — First-class definition of the backend execution flow.
//!
//! The execution pipeline has 7 stages:
//!   Initiate -> Validate -> CreateRecord -> SpawnEngine
//!     -> StreamOutput -> FinalizeStatus -> Complete
//!
//! Each stage is a typed boundary. This module provides:
//! - Stage enum with tracing span helpers
//! - Typed payloads at each transition
//! - A PipelineContext that accumulates tracing data across stages

use std::fmt;
use std::time::Instant;

use serde::Serialize;

// =============================================================================
// Pipeline stages
// =============================================================================

/// The ordered stages of the backend execution pipeline.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PipelineStage {
    /// Frontend initiates via Tauri command
    Initiate,
    /// Validate concurrency, budget, load persona + tools
    Validate,
    /// Create execution record in DB, set to running
    CreateRecord,
    /// Register in engine tracker, spawn tokio task
    SpawnEngine,
    /// Runner spawns CLI process, streams output events
    StreamOutput,
    /// Write terminal status to DB, emit status event
    FinalizeStatus,
    /// Post-processing: healing, chain triggers, notifications
    Complete,
}

#[allow(dead_code)]
impl PipelineStage {
    /// All stages in order.
    pub const ALL: &'static [PipelineStage] = &[
        PipelineStage::Initiate,
        PipelineStage::Validate,
        PipelineStage::CreateRecord,
        PipelineStage::SpawnEngine,
        PipelineStage::StreamOutput,
        PipelineStage::FinalizeStatus,
        PipelineStage::Complete,
    ];

    /// Human-readable label.
    pub fn label(&self) -> &'static str {
        match self {
            Self::Initiate => "Initiate",
            Self::Validate => "Validate",
            Self::CreateRecord => "Create Record",
            Self::SpawnEngine => "Spawn Engine",
            Self::StreamOutput => "Stream Output",
            Self::FinalizeStatus => "Finalize Status",
            Self::Complete => "Complete",
        }
    }

    /// The system boundary this stage represents.
    pub fn boundary(&self) -> &'static str {
        match self {
            Self::Initiate => "Frontend -> Tauri Command",
            Self::Validate => "Command -> DB reads",
            Self::CreateRecord => "Command -> DB write",
            Self::SpawnEngine => "Engine -> Tokio task",
            Self::StreamOutput => "Runner -> Tauri events",
            Self::FinalizeStatus => "Runner -> DB + events",
            Self::Complete => "Engine -> post-processing",
        }
    }
}

impl fmt::Display for PipelineStage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.label())
    }
}

// =============================================================================
// Pipeline context (per-execution tracing)
// =============================================================================

/// A trace entry for a single pipeline stage.
#[derive(Debug, Clone)]
pub struct StageTrace {
    pub stage: PipelineStage,
    #[allow(dead_code)]
    pub started_at: Instant,
    pub duration_ms: Option<u64>,
    pub error: Option<String>,
}

/// Accumulated context for one execution's pipeline journey.
///
/// Created at the start of execute_persona, threaded through each stage,
/// and finalized when the execution completes. Enables end-to-end tracing
/// without modifying individual stage implementations.
#[derive(Debug, Clone)]
pub struct PipelineContext {
    pub execution_id: String,
    pub persona_id: String,
    pub started_at: Instant,
    pub stages: Vec<StageTrace>,
    current_stage: Option<PipelineStage>,
    current_start: Option<Instant>,
}

impl PipelineContext {
    /// Create a new pipeline context for an execution.
    pub fn new(execution_id: &str, persona_id: &str) -> Self {
        Self {
            execution_id: execution_id.into(),
            persona_id: persona_id.into(),
            started_at: Instant::now(),
            stages: Vec::new(),
            current_stage: None,
            current_start: None,
        }
    }

    /// Enter a pipeline stage. Closes the previous stage if open.
    pub fn enter_stage(&mut self, stage: PipelineStage) {
        self.close_current_stage();
        tracing::debug!(
            execution_id = %self.execution_id,
            stage = %stage,
            boundary = stage.boundary(),
            "Pipeline: entering stage",
        );
        self.current_stage = Some(stage);
        self.current_start = Some(Instant::now());
    }

    /// Mark the current stage as completed.
    pub fn complete_stage(&mut self) {
        self.close_current_stage();
    }

    /// Mark the current stage as failed with an error.
    pub fn fail_stage(&mut self, error: &str) {
        if let (Some(stage), Some(start)) = (self.current_stage, self.current_start) {
            let duration_ms = start.elapsed().as_millis() as u64;
            tracing::warn!(
                execution_id = %self.execution_id,
                stage = %stage,
                duration_ms = duration_ms,
                error = error,
                "Pipeline: stage failed",
            );
            self.stages.push(StageTrace {
                stage,
                started_at: start,
                duration_ms: Some(duration_ms),
                error: Some(error.into()),
            });
            self.current_stage = None;
            self.current_start = None;
        }
    }

    /// Total pipeline duration so far.
    pub fn elapsed_ms(&self) -> u64 {
        self.started_at.elapsed().as_millis() as u64
    }

    /// Log a summary of all stages (useful at pipeline completion).
    pub fn log_summary(&self) {
        let total_ms = self.elapsed_ms();
        let stage_details: Vec<String> = self
            .stages
            .iter()
            .map(|s| {
                let dur = s
                    .duration_ms
                    .map(|d| format!("{}ms", d))
                    .unwrap_or_else(|| "?".into());
                let err = s
                    .error
                    .as_ref()
                    .map(|e| format!(" [ERR: {}]", e))
                    .unwrap_or_default();
                format!("  {} ({}): {}{}", s.stage.label(), s.stage.boundary(), dur, err)
            })
            .collect();

        tracing::info!(
            execution_id = %self.execution_id,
            persona_id = %self.persona_id,
            total_ms = total_ms,
            stages = stage_details.len(),
            "Pipeline summary:\n{}",
            stage_details.join("\n"),
        );
    }

    /// Close the current stage (internal helper).
    fn close_current_stage(&mut self) {
        if let (Some(stage), Some(start)) = (self.current_stage, self.current_start) {
            let duration_ms = start.elapsed().as_millis() as u64;
            tracing::debug!(
                execution_id = %self.execution_id,
                stage = %stage,
                duration_ms = duration_ms,
                "Pipeline: stage completed",
            );
            self.stages.push(StageTrace {
                stage,
                started_at: start,
                duration_ms: Some(duration_ms),
                error: None,
            });
            self.current_stage = None;
            self.current_start = None;
        }
    }
}
