use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Persona
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Persona {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub system_prompt: String,
    pub structured_prompt: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub enabled: bool,
    pub max_concurrent: i32,
    pub timeout_ms: i32,
    pub notification_channels: Option<String>,
    pub last_design_result: Option<String>,
    pub model_profile: Option<String>,
    pub max_budget_usd: Option<f64>,
    pub max_turns: Option<i32>,
    pub design_context: Option<String>,
    pub group_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreatePersonaInput {
    pub name: String,
    pub system_prompt: String,
    pub project_id: Option<String>,
    pub description: Option<String>,
    pub structured_prompt: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub enabled: Option<bool>,
    pub max_concurrent: Option<i32>,
    pub timeout_ms: Option<i32>,
    pub model_profile: Option<String>,
    pub max_budget_usd: Option<f64>,
    pub max_turns: Option<i32>,
    pub design_context: Option<String>,
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdatePersonaInput {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub system_prompt: Option<String>,
    pub structured_prompt: Option<Option<String>>,
    pub icon: Option<Option<String>>,
    pub color: Option<Option<String>>,
    pub enabled: Option<bool>,
    pub max_concurrent: Option<i32>,
    pub timeout_ms: Option<i32>,
    pub notification_channels: Option<String>,
    pub last_design_result: Option<Option<String>>,
    pub model_profile: Option<Option<String>>,
    pub max_budget_usd: Option<Option<f64>>,
    pub max_turns: Option<Option<i32>>,
    pub design_context: Option<Option<String>>,
    pub group_id: Option<Option<String>>,
}

// ============================================================================
// Tool Definitions
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaToolDefinition {
    pub id: String,
    pub name: String,
    pub category: String,
    pub description: String,
    pub script_path: String,
    pub input_schema: Option<String>,
    pub output_schema: Option<String>,
    pub requires_credential_type: Option<String>,
    pub is_builtin: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateToolDefinitionInput {
    pub name: String,
    pub category: String,
    pub description: String,
    pub script_path: String,
    pub input_schema: Option<String>,
    pub output_schema: Option<String>,
    pub requires_credential_type: Option<String>,
    pub is_builtin: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateToolDefinitionInput {
    pub name: Option<String>,
    pub category: Option<String>,
    pub description: Option<String>,
    pub script_path: Option<String>,
    pub input_schema: Option<Option<String>>,
    pub output_schema: Option<Option<String>>,
    pub requires_credential_type: Option<Option<String>>,
}

// ============================================================================
// Persona Tools (assignments)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaTool {
    pub id: String,
    pub persona_id: String,
    pub tool_id: String,
    pub tool_config: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Triggers
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaTrigger {
    pub id: String,
    pub persona_id: String,
    pub trigger_type: String,
    pub config: Option<String>,
    pub enabled: bool,
    pub last_triggered_at: Option<String>,
    pub next_trigger_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateTriggerInput {
    pub persona_id: String,
    pub trigger_type: String,
    pub config: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateTriggerInput {
    pub trigger_type: Option<String>,
    pub config: Option<String>,
    pub enabled: Option<bool>,
    pub next_trigger_at: Option<Option<String>>,
}

// ============================================================================
// Executions
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaExecution {
    pub id: String,
    pub persona_id: String,
    pub trigger_id: Option<String>,
    pub status: String,
    pub input_data: Option<String>,
    pub output_data: Option<String>,
    pub claude_session_id: Option<String>,
    pub log_file_path: Option<String>,
    pub execution_flows: Option<String>,
    pub model_used: Option<String>,
    #[ts(type = "number")]
    pub input_tokens: i64,
    #[ts(type = "number")]
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub error_message: Option<String>,
    #[ts(type = "number | null")]
    pub duration_ms: Option<i64>,
    pub tool_steps: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateExecutionStatus {
    pub status: String,
    pub output_data: Option<String>,
    pub error_message: Option<String>,
    pub duration_ms: Option<i64>,
    pub log_file_path: Option<String>,
    pub execution_flows: Option<String>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cost_usd: Option<f64>,
    pub tool_steps: Option<String>,
}

// ============================================================================
// Credentials
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaCredential {
    pub id: String,
    pub name: String,
    pub service_type: String,
    pub encrypted_data: String,
    pub iv: String,
    pub metadata: Option<String>,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateCredentialInput {
    pub name: String,
    pub service_type: String,
    pub encrypted_data: String,
    pub iv: String,
    pub metadata: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateCredentialInput {
    pub name: Option<String>,
    pub service_type: Option<String>,
    pub encrypted_data: Option<String>,
    pub iv: Option<String>,
    pub metadata: Option<Option<String>>,
}

// ============================================================================
// Credential Events
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CredentialEvent {
    pub id: String,
    pub credential_id: String,
    pub event_template_id: String,
    pub name: String,
    pub config: Option<String>,
    pub enabled: bool,
    pub last_polled_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateCredentialEventInput {
    pub credential_id: String,
    pub event_template_id: String,
    pub name: String,
    pub config: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateCredentialEventInput {
    pub name: Option<String>,
    pub config: Option<String>,
    pub enabled: Option<bool>,
    pub last_polled_at: Option<String>,
}

// ============================================================================
// Manual Reviews
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaManualReview {
    pub id: String,
    pub execution_id: String,
    pub persona_id: String,
    pub title: String,
    pub description: Option<String>,
    pub severity: String,
    pub context_data: Option<String>,
    pub suggested_actions: Option<String>,
    pub status: String,
    pub reviewer_notes: Option<String>,
    pub resolved_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateManualReviewInput {
    pub execution_id: String,
    pub persona_id: String,
    pub title: String,
    pub description: Option<String>,
    pub severity: Option<String>,
    pub context_data: Option<String>,
    pub suggested_actions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateManualReviewInput {
    pub status: Option<String>,
    pub reviewer_notes: Option<String>,
    pub resolved_at: Option<String>,
}

// ============================================================================
// Messages
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaMessage {
    pub id: String,
    pub persona_id: String,
    pub execution_id: Option<String>,
    pub title: Option<String>,
    pub content: String,
    pub content_type: String,
    pub priority: String,
    pub is_read: bool,
    pub metadata: Option<String>,
    pub created_at: String,
    pub read_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateMessageInput {
    pub persona_id: String,
    pub execution_id: Option<String>,
    pub title: Option<String>,
    pub content: String,
    pub content_type: Option<String>,
    pub priority: Option<String>,
    pub metadata: Option<String>,
}

// ============================================================================
// Message Deliveries
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaMessageDelivery {
    pub id: String,
    pub message_id: String,
    pub channel_type: String,
    pub status: String,
    pub error_message: Option<String>,
    pub external_id: Option<String>,
    pub delivered_at: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Events
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaEvent {
    pub id: String,
    pub project_id: String,
    pub event_type: String,
    pub source_type: String,
    pub source_id: Option<String>,
    pub target_persona_id: Option<String>,
    pub payload: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub processed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreatePersonaEventInput {
    pub event_type: String,
    pub source_type: String,
    pub project_id: Option<String>,
    pub source_id: Option<String>,
    pub target_persona_id: Option<String>,
    pub payload: Option<String>,
}

// ============================================================================
// Event Subscriptions
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaEventSubscription {
    pub id: String,
    pub persona_id: String,
    pub event_type: String,
    pub source_filter: Option<String>,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateEventSubscriptionInput {
    pub persona_id: String,
    pub event_type: String,
    pub source_filter: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateEventSubscriptionInput {
    pub event_type: Option<String>,
    pub source_filter: Option<String>,
    pub enabled: Option<bool>,
}

// ============================================================================
// Observability: Metrics Snapshots
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaMetricsSnapshot {
    pub id: String,
    pub persona_id: String,
    pub snapshot_date: String,
    #[ts(type = "number")]
    pub total_executions: i64,
    #[ts(type = "number")]
    pub successful_executions: i64,
    #[ts(type = "number")]
    pub failed_executions: i64,
    pub total_cost_usd: f64,
    #[ts(type = "number")]
    pub total_input_tokens: i64,
    #[ts(type = "number")]
    pub total_output_tokens: i64,
    pub avg_duration_ms: f64,
    pub tools_used: Option<String>,
    #[ts(type = "number")]
    pub events_emitted: i64,
    #[ts(type = "number")]
    pub events_consumed: i64,
    #[ts(type = "number")]
    pub messages_sent: i64,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct CreateMetricsSnapshotInput {
    pub persona_id: String,
    pub snapshot_date: String,
    pub total_executions: i64,
    pub successful_executions: i64,
    pub failed_executions: i64,
    pub total_cost_usd: f64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub avg_duration_ms: f64,
    pub tools_used: Option<String>,
    pub events_emitted: i64,
    pub events_consumed: i64,
    pub messages_sent: i64,
}

// ============================================================================
// Observability: Prompt Versions
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaPromptVersion {
    pub id: String,
    pub persona_id: String,
    pub version_number: i32,
    pub structured_prompt: Option<String>,
    pub system_prompt: Option<String>,
    pub change_summary: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Teams
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaTeam {
    pub id: String,
    pub project_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub canvas_data: Option<String>,
    pub team_config: Option<String>,
    pub icon: Option<String>,
    pub color: String,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateTeamInput {
    pub name: String,
    pub project_id: Option<String>,
    pub description: Option<String>,
    pub canvas_data: Option<String>,
    pub team_config: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateTeamInput {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub canvas_data: Option<Option<String>>,
    pub team_config: Option<Option<String>>,
    pub icon: Option<Option<String>>,
    pub color: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaTeamMember {
    pub id: String,
    pub team_id: String,
    pub persona_id: String,
    pub role: String,
    pub position_x: f64,
    pub position_y: f64,
    pub config: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaTeamConnection {
    pub id: String,
    pub team_id: String,
    pub source_member_id: String,
    pub target_member_id: String,
    pub connection_type: String,
    pub condition: Option<String>,
    pub label: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Pipeline Runs
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PipelineRun {
    pub id: String,
    pub team_id: String,
    pub status: String,
    pub node_statuses: String,
    pub input_data: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub error_message: Option<String>,
}

// ============================================================================
// Connector Definitions
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ConnectorDefinition {
    pub id: String,
    pub name: String,
    pub label: String,
    pub icon_url: Option<String>,
    pub color: String,
    pub category: String,
    pub fields: String,
    pub healthcheck_config: Option<String>,
    pub services: String,
    pub events: String,
    pub metadata: Option<String>,
    pub is_builtin: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateConnectorDefinitionInput {
    pub name: String,
    pub label: String,
    pub icon_url: Option<String>,
    pub color: Option<String>,
    pub category: Option<String>,
    pub fields: String,
    pub healthcheck_config: Option<String>,
    pub services: Option<String>,
    pub events: Option<String>,
    pub metadata: Option<String>,
    pub is_builtin: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateConnectorDefinitionInput {
    pub name: Option<String>,
    pub label: Option<String>,
    pub icon_url: Option<Option<String>>,
    pub color: Option<String>,
    pub category: Option<String>,
    pub fields: Option<String>,
    pub healthcheck_config: Option<Option<String>>,
    pub services: Option<String>,
    pub events: Option<String>,
    pub metadata: Option<Option<String>>,
}

// ============================================================================
// Groups
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaGroup {
    pub id: String,
    pub name: String,
    pub color: String,
    pub sort_order: i32,
    pub collapsed: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreatePersonaGroupInput {
    pub name: String,
    pub color: Option<String>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdatePersonaGroupInput {
    pub name: Option<String>,
    pub color: Option<String>,
    pub sort_order: Option<i32>,
    pub collapsed: Option<bool>,
}

// ============================================================================
// Memories
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaMemory {
    pub id: String,
    pub persona_id: String,
    pub title: String,
    pub content: String,
    pub category: String,
    pub source_execution_id: Option<String>,
    pub importance: i32,
    pub tags: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreatePersonaMemoryInput {
    pub persona_id: String,
    pub title: String,
    pub content: String,
    pub category: Option<String>,
    pub source_execution_id: Option<String>,
    pub importance: Option<i32>,
    pub tags: Option<String>,
}

// ============================================================================
// Healing Issues
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaHealingIssue {
    pub id: String,
    pub persona_id: String,
    pub execution_id: Option<String>,
    pub title: String,
    pub description: String,
    pub severity: String,
    pub category: String,
    pub suggested_fix: Option<String>,
    pub auto_fixed: bool,
    pub status: String,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

// ============================================================================
// Design Reviews
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaDesignReview {
    pub id: String,
    pub test_case_id: String,
    pub test_case_name: String,
    pub instruction: String,
    pub status: String,
    pub structural_score: Option<i32>,
    pub semantic_score: Option<i32>,
    pub connectors_used: Option<String>,
    pub trigger_types: Option<String>,
    pub design_result: Option<String>,
    pub structural_evaluation: Option<String>,
    pub semantic_evaluation: Option<String>,
    pub test_run_id: String,
    pub had_references: Option<bool>,
    pub suggested_adjustment: Option<String>,
    pub adjustment_generation: Option<i32>,
    pub reviewed_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct CreateDesignReviewInput {
    pub test_case_id: String,
    pub test_case_name: String,
    pub instruction: String,
    pub status: String,
    pub structural_score: Option<i32>,
    pub semantic_score: Option<i32>,
    pub connectors_used: Option<String>,
    pub trigger_types: Option<String>,
    pub design_result: Option<String>,
    pub structural_evaluation: Option<String>,
    pub semantic_evaluation: Option<String>,
    pub test_run_id: String,
    pub had_references: Option<bool>,
    pub suggested_adjustment: Option<String>,
    pub adjustment_generation: Option<i32>,
    pub reviewed_at: String,
}

// ============================================================================
// Design Patterns
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaDesignPattern {
    pub id: String,
    pub pattern_type: String,
    pub pattern_text: String,
    pub trigger_condition: String,
    pub confidence: i32,
    pub source_review_ids: String,
    pub usage_count: i32,
    pub last_validated_at: Option<String>,
    pub is_active: bool,
    pub created_at: String,
}

// ============================================================================
// Budget Alert Rules
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BudgetAlertRule {
    pub id: String,
    pub persona_id: Option<String>,
    pub rule_type: String,
    pub threshold_usd: f64,
    pub enabled: bool,
    pub created_at: String,
}

// ============================================================================
// Tool Usage Analytics
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaToolUsage {
    pub id: String,
    pub execution_id: String,
    pub persona_id: String,
    pub tool_name: String,
    pub invocation_count: i32,
    pub created_at: String,
}
