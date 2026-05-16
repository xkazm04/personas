use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// User-authored annotation on a single persona execution. Free-form tags,
/// a short note, and a star flag — mirrors LangSmith trace annotations.
/// One row per (execution_id, author); re-saving overwrites the prior value.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExecutionAnnotation {
    pub id: String,
    pub execution_id: String,
    pub persona_id: String,
    pub author: String,
    /// Free-form labels (e.g. "regression", "golden-example", "investigate").
    pub tags: Vec<String>,
    pub note: Option<String>,
    pub starred: bool,
    pub created_at: String,
    pub updated_at: String,
}
