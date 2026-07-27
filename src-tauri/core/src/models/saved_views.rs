use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SavedView {
    pub id: String,
    pub name: String,
    pub persona_id: Option<String>,
    pub day_range: i32,
    pub custom_start_date: Option<String>,
    pub custom_end_date: Option<String>,
    pub compare_enabled: bool,
    pub is_smart: bool,
    /// "analytics" | "agent_list"
    pub view_type: String,
    /// JSON blob storing filter/sort/grouping config
    pub view_config: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateSavedViewInput {
    pub name: String,
    pub persona_id: Option<String>,
    pub day_range: i32,
    pub custom_start_date: Option<String>,
    pub custom_end_date: Option<String>,
    pub compare_enabled: bool,
    pub is_smart: bool,
    pub view_type: String,
    pub view_config: Option<String>,
}
