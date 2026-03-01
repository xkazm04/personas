use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Team Memories
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TeamMemory {
    pub id: String,
    pub team_id: String,
    pub run_id: Option<String>,
    pub member_id: Option<String>,
    pub persona_id: Option<String>,
    pub title: String,
    pub content: String,
    pub category: String,
    pub importance: i32,
    pub tags: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateTeamMemoryInput {
    pub team_id: String,
    pub run_id: Option<String>,
    pub member_id: Option<String>,
    pub persona_id: Option<String>,
    pub title: String,
    pub content: String,
    pub category: Option<String>,
    pub importance: Option<i32>,
    pub tags: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TeamMemoryStats {
    pub total: i64,
    pub avg_importance: f64,
    pub category_counts: Vec<(String, i64)>,
    pub run_counts: Vec<(String, i64)>,
}
