use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Test Runs (Multi-LLM Sandbox Testing)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaTestRun {
    pub id: String,
    pub persona_id: String,
    pub status: String,
    pub models_tested: String,
    #[ts(type = "number")]
    pub scenarios_count: i32,
    pub summary: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaTestResult {
    pub id: String,
    pub test_run_id: String,
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
pub struct CreateTestResultInput {
    pub test_run_id: String,
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
