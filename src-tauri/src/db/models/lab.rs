use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Lab: Arena (Multi-model comparison)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LabArenaRun {
    pub id: String,
    pub persona_id: String,
    pub status: String,
    pub models_tested: String,
    #[ts(type = "number")]
    pub scenarios_count: i32,
    pub use_case_filter: Option<String>,
    pub summary: Option<String>,
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
    pub status: String,
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
    pub status: String,
    pub user_instruction: String,
    pub draft_prompt_json: Option<String>,
    pub draft_change_summary: Option<String>,
    pub models_tested: String,
    #[ts(type = "number")]
    pub scenarios_count: i32,
    pub use_case_filter: Option<String>,
    pub summary: Option<String>,
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
    pub status: String,
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
    pub error_message: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
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
}
