use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FrontendCrashRow {
    pub id: String,
    pub component: String,
    pub message: String,
    pub stack: Option<String>,
    pub component_stack: Option<String>,
    pub app_version: Option<String>,
    pub created_at: String,
}
