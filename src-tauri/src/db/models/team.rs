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
