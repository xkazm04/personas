use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Persona Automations (external workflow references)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaAutomation {
    pub id: String,
    pub persona_id: String,
    pub use_case_id: Option<String>,
    pub name: String,
    pub description: String,
    pub platform: String,
    pub platform_workflow_id: Option<String>,
    pub platform_url: Option<String>,
    pub webhook_url: Option<String>,
    pub webhook_method: String,
    pub platform_credential_id: Option<String>,
    pub credential_mapping: Option<String>,
    pub input_schema: Option<String>,
    pub output_schema: Option<String>,
    pub timeout_ms: i64,
    pub retry_count: i32,
    pub fallback_mode: String,
    pub deployment_status: String,
    pub last_triggered_at: Option<String>,
    pub last_result_status: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreateAutomationInput {
    pub persona_id: String,
    pub use_case_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub platform: String,
    pub platform_workflow_id: Option<String>,
    pub platform_url: Option<String>,
    pub webhook_url: Option<String>,
    pub webhook_method: Option<String>,
    pub platform_credential_id: Option<String>,
    pub credential_mapping: Option<String>,
    pub input_schema: Option<String>,
    pub output_schema: Option<String>,
    pub timeout_ms: Option<i64>,
    pub retry_count: Option<i32>,
    pub fallback_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAutomationInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub use_case_id: Option<Option<String>>,
    pub platform_workflow_id: Option<Option<String>>,
    pub platform_url: Option<Option<String>>,
    pub webhook_url: Option<Option<String>>,
    pub webhook_method: Option<String>,
    pub platform_credential_id: Option<Option<String>>,
    pub credential_mapping: Option<Option<String>>,
    pub input_schema: Option<Option<String>>,
    pub output_schema: Option<Option<String>>,
    pub timeout_ms: Option<i64>,
    pub retry_count: Option<i32>,
    pub fallback_mode: Option<String>,
    pub deployment_status: Option<String>,
    pub error_message: Option<Option<String>>,
}

// ============================================================================
// Automation Runs (invocation history)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRun {
    pub id: String,
    pub automation_id: String,
    pub execution_id: Option<String>,
    pub status: String,
    pub input_data: Option<String>,
    pub output_data: Option<String>,
    pub platform_run_id: Option<String>,
    pub platform_logs_url: Option<String>,
    pub duration_ms: Option<i64>,
    pub error_message: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
}
