use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Database Schema Tables (user-defined focus tables per credential)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DbSchemaTable {
    pub id: String,
    pub credential_id: String,
    pub table_name: String,
    pub display_label: Option<String>,
    /// JSON array of column hints: [{name, type, nullable, pk}]
    pub column_hints: Option<String>,
    pub is_favorite: bool,
    #[ts(type = "number")]
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Database Saved Queries (favorite queries per credential)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DbSavedQuery {
    pub id: String,
    pub credential_id: String,
    pub title: String,
    pub query_text: String,
    /// sql | redis | mongodb | graphql
    pub language: String,
    pub last_run_at: Option<String>,
    pub last_run_ok: Option<bool>,
    #[ts(type = "number | null")]
    pub last_run_ms: Option<i64>,
    pub is_favorite: bool,
    #[ts(type = "number")]
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Query Execution Result
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    #[ts(type = "number")]
    pub row_count: usize,
    #[ts(type = "number")]
    pub duration_ms: u64,
    pub truncated: bool,
}
