use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Teams
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaTeam {
    pub id: String,
    pub project_id: Option<String>,
    pub parent_team_id: Option<String>,
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
    pub parent_team_id: Option<String>,
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
// Node Configuration (parsed from PersonaTeamMember.config JSON)
// ============================================================================

/// Parsed node configuration from the `config` JSON field on PersonaTeamMember.
///
/// All fields are optional — existing nodes with no config work unchanged.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NodeConfig {
    /// Override the persona's default model_profile for this pipeline step.
    /// Example: "claude-haiku" for cheap classification nodes.
    pub model_profile_override: Option<String>,
    /// Node type: "persona" (default, LLM execution) or "command" (deterministic).
    pub node_type: Option<String>,
    /// Shell command to run if node_type == "command".
    pub command: Option<String>,
    /// If true, pipeline pauses here for human approval before executing.
    pub approval_gate: Option<bool>,
}

// ============================================================================
// Team Counts (batch query result)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TeamCounts {
    pub team_id: String,
    pub member_count: u32,
    pub connection_count: u32,
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

impl PipelineRun {
    /// Parse the status string into the canonical ExecutionState enum.
    /// Logs an error if the stored status is unrecognised so data corruption
    /// is immediately visible instead of silently mapping to `Failed`.
    pub fn state(&self) -> crate::engine::types::ExecutionState {
        match self.status.parse() {
            Ok(s) => s,
            Err(_) => {
                tracing::error!(
                    run_id = %self.id,
                    raw_status = %self.status,
                    "Unknown pipeline run status in DB — treating as Failed"
                );
                crate::engine::types::ExecutionState::Failed
            }
        }
    }
}
