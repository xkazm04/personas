use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Lab: Run Status State Machine
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum LabRunStatus {
    Drafting,
    Generating,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl LabRunStatus {
    pub fn from_db(s: &str) -> Self {
        match s {
            "drafting" => Self::Drafting,
            "generating" => Self::Generating,
            "running" => Self::Running,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            _ => Self::Failed, // unknown statuses treated as failed
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Drafting => "drafting",
            Self::Generating => "generating",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }

    pub fn validate_transition(&self, next: LabRunStatus) -> Result<(), String> {
        let allowed = match self {
            Self::Drafting => matches!(next, Self::Generating | Self::Failed | Self::Cancelled),
            Self::Generating => matches!(next, Self::Running | Self::Failed | Self::Cancelled),
            Self::Running => matches!(next, Self::Completed | Self::Failed | Self::Cancelled),
            Self::Completed | Self::Failed | Self::Cancelled => false,
        };
        if allowed {
            Ok(())
        } else {
            Err(format!(
                "Invalid status transition: {} -> {}",
                self.as_str(),
                next.as_str()
            ))
        }
    }
}

// ============================================================================
// Lab: Arena (Multi-model comparison)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LabArenaRun {
    pub id: String,
    pub persona_id: String,
    pub status: LabRunStatus,
    pub models_tested: String,
    #[ts(type = "number")]
    pub scenarios_count: i32,
    pub use_case_filter: Option<String>,
    pub summary: Option<String>,
    pub llm_summary: Option<String>,
    pub progress_json: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LabArenaResult {
    pub id: String,
    pub run_id: String,
    pub scenario_name: String,
    pub model_id: String,
    pub provider: String,
    pub status: String,
    pub output_preview: Option<String>,
    pub tool_calls_expected: Option<String>,
    pub tool_calls_actual: Option<String>,
    #[ts(type = "number | null")]
    pub tool_accuracy_score: Option<i32>,
    #[ts(type = "number | null")]
    pub output_quality_score: Option<i32>,
    #[ts(type = "number | null")]
    pub protocol_compliance: Option<i32>,
    #[ts(type = "number")]
    pub input_tokens: i64,
    #[ts(type = "number")]
    pub output_tokens: i64,
    pub cost_usd: f64,
    #[ts(type = "number")]
    pub duration_ms: i64,
    pub rationale: Option<String>,
    pub suggestions: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct CreateArenaResultInput {
    pub run_id: String,
    pub scenario_name: String,
    pub model_id: String,
    pub provider: String,
    pub status: String,
    pub output_preview: Option<String>,
    pub tool_calls_expected: Option<String>,
    pub tool_calls_actual: Option<String>,
    pub tool_accuracy_score: Option<i32>,
    pub output_quality_score: Option<i32>,
    pub protocol_compliance: Option<i32>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub duration_ms: i64,
    pub error_message: Option<String>,
    pub rationale: Option<String>,
    pub suggestions: Option<String>,
}

// ============================================================================
// Lab: A/B (Prompt version comparison)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LabAbRun {
    pub id: String,
    pub persona_id: String,
    pub status: LabRunStatus,
    pub version_a_id: String,
    pub version_b_id: String,
    #[ts(type = "number")]
    pub version_a_num: i32,
    #[ts(type = "number")]
    pub version_b_num: i32,
    pub models_tested: String,
    #[ts(type = "number")]
    pub scenarios_count: i32,
    pub use_case_filter: Option<String>,
    pub test_input: Option<String>,
    pub summary: Option<String>,
    pub llm_summary: Option<String>,
    pub progress_json: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LabAbResult {
    pub id: String,
    pub run_id: String,
    pub version_id: String,
    #[ts(type = "number")]
    pub version_number: i32,
    pub scenario_name: String,
    pub model_id: String,
    pub provider: String,
    pub status: String,
    pub output_preview: Option<String>,
    pub tool_calls_expected: Option<String>,
    pub tool_calls_actual: Option<String>,
    #[ts(type = "number | null")]
    pub tool_accuracy_score: Option<i32>,
    #[ts(type = "number | null")]
    pub output_quality_score: Option<i32>,
    #[ts(type = "number | null")]
    pub protocol_compliance: Option<i32>,
    #[ts(type = "number")]
    pub input_tokens: i64,
    #[ts(type = "number")]
    pub output_tokens: i64,
    pub cost_usd: f64,
    #[ts(type = "number")]
    pub duration_ms: i64,
    pub rationale: Option<String>,
    pub suggestions: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct CreateAbResultInput {
    pub run_id: String,
    pub version_id: String,
    pub version_number: i32,
    pub scenario_name: String,
    pub model_id: String,
    pub provider: String,
    pub status: String,
    pub output_preview: Option<String>,
    pub tool_calls_expected: Option<String>,
    pub tool_calls_actual: Option<String>,
    pub tool_accuracy_score: Option<i32>,
    pub output_quality_score: Option<i32>,
    pub protocol_compliance: Option<i32>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub duration_ms: i64,
    pub error_message: Option<String>,
    pub rationale: Option<String>,
    pub suggestions: Option<String>,
}

// ============================================================================
// Lab: Matrix (Draft generation + current vs draft comparison)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LabMatrixRun {
    pub id: String,
    pub persona_id: String,
    pub status: LabRunStatus,
    pub user_instruction: String,
    pub draft_prompt_json: Option<String>,
    pub draft_change_summary: Option<String>,
    pub models_tested: String,
    #[ts(type = "number")]
    pub scenarios_count: i32,
    pub use_case_filter: Option<String>,
    pub summary: Option<String>,
    pub llm_summary: Option<String>,
    pub progress_json: Option<String>,
    pub error: Option<String>,
    pub draft_accepted: bool,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LabMatrixResult {
    pub id: String,
    pub run_id: String,
    pub variant: String,
    pub scenario_name: String,
    pub model_id: String,
    pub provider: String,
    pub status: String,
    pub output_preview: Option<String>,
    pub tool_calls_expected: Option<String>,
    pub tool_calls_actual: Option<String>,
    #[ts(type = "number | null")]
    pub tool_accuracy_score: Option<i32>,
    #[ts(type = "number | null")]
    pub output_quality_score: Option<i32>,
    #[ts(type = "number | null")]
    pub protocol_compliance: Option<i32>,
    #[ts(type = "number")]
    pub input_tokens: i64,
    #[ts(type = "number")]
    pub output_tokens: i64,
    pub cost_usd: f64,
    #[ts(type = "number")]
    pub duration_ms: i64,
    pub rationale: Option<String>,
    pub suggestions: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct CreateMatrixResultInput {
    pub run_id: String,
    pub variant: String,
    pub scenario_name: String,
    pub model_id: String,
    pub provider: String,
    pub status: String,
    pub output_preview: Option<String>,
    pub tool_calls_expected: Option<String>,
    pub tool_calls_actual: Option<String>,
    pub tool_accuracy_score: Option<i32>,
    pub output_quality_score: Option<i32>,
    pub protocol_compliance: Option<i32>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub duration_ms: i64,
    pub error_message: Option<String>,
    pub rationale: Option<String>,
    pub suggestions: Option<String>,
}

// ============================================================================
// Lab: Eval (N prompt versions × M models evaluation matrix)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LabEvalRun {
    pub id: String,
    pub persona_id: String,
    pub status: LabRunStatus,
    /// JSON array of version IDs, e.g. ["uuid1","uuid2","uuid3"]
    pub version_ids: String,
    /// JSON array of version numbers, e.g. [1,3,5]
    pub version_numbers: String,
    pub models_tested: String,
    #[ts(type = "number")]
    pub scenarios_count: i32,
    pub use_case_filter: Option<String>,
    pub test_input: Option<String>,
    pub summary: Option<String>,
    pub llm_summary: Option<String>,
    pub progress_json: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LabEvalResult {
    pub id: String,
    pub run_id: String,
    pub version_id: String,
    #[ts(type = "number")]
    pub version_number: i32,
    pub scenario_name: String,
    pub model_id: String,
    pub provider: String,
    pub status: String,
    pub output_preview: Option<String>,
    pub tool_calls_expected: Option<String>,
    pub tool_calls_actual: Option<String>,
    #[ts(type = "number | null")]
    pub tool_accuracy_score: Option<i32>,
    #[ts(type = "number | null")]
    pub output_quality_score: Option<i32>,
    #[ts(type = "number | null")]
    pub protocol_compliance: Option<i32>,
    #[ts(type = "number")]
    pub input_tokens: i64,
    #[ts(type = "number")]
    pub output_tokens: i64,
    pub cost_usd: f64,
    #[ts(type = "number")]
    pub duration_ms: i64,
    pub rationale: Option<String>,
    pub suggestions: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Lab: User Ratings (thumbs up/down feedback on results)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LabUserRating {
    pub id: String,
    pub run_id: String,
    pub result_id: Option<String>,
    pub scenario_name: String,
    #[ts(type = "number")]
    pub rating: i32,
    pub feedback: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct CreateRatingInput {
    pub run_id: String,
    pub result_id: Option<String>,
    pub scenario_name: String,
    pub rating: i32,
    pub feedback: Option<String>,
}

pub struct CreateEvalResultInput {
    pub run_id: String,
    pub version_id: String,
    pub version_number: i32,
    pub scenario_name: String,
    pub model_id: String,
    pub provider: String,
    pub status: String,
    pub output_preview: Option<String>,
    pub tool_calls_expected: Option<String>,
    pub tool_calls_actual: Option<String>,
    pub tool_accuracy_score: Option<i32>,
    pub output_quality_score: Option<i32>,
    pub protocol_compliance: Option<i32>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub duration_ms: i64,
    pub error_message: Option<String>,
    pub rationale: Option<String>,
    pub suggestions: Option<String>,
}

// ============================================================================
// Full Persona Versioning (prompts + settings + tools reference)
// ============================================================================

/// Full persona version snapshot (prompts + settings + tools reference).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaVersion {
    pub id: String,
    pub persona_id: String,
    #[ts(type = "number")]
    pub version_number: i32,
    pub name: String,
    pub description: Option<String>,
    pub system_prompt: String,
    pub structured_prompt: Option<String>,
    pub model_profile: Option<String>,
    pub max_budget_usd: Option<f64>,
    #[ts(type = "number | null")]
    pub max_turns: Option<i32>,
    #[ts(type = "number")]
    pub timeout_ms: i32,
    pub design_context: Option<String>,
    pub change_summary: Option<String>,
    pub tag: String,
    pub parent_version_id: Option<String>,
    pub created_at: String,
}
