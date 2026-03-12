use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Knowledge Base Registry
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBase {
    pub id: String,
    pub credential_id: String,
    pub name: String,
    pub description: Option<String>,
    pub embedding_model: String,
    #[ts(type = "number")]
    pub embedding_dims: i32,
    #[ts(type = "number")]
    pub chunk_size: i32,
    #[ts(type = "number")]
    pub chunk_overlap: i32,
    #[ts(type = "number")]
    pub document_count: i32,
    #[ts(type = "number")]
    pub chunk_count: i32,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Knowledge Base Documents
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KbDocument {
    pub id: String,
    pub kb_id: String,
    pub source_type: String,
    pub source_path: Option<String>,
    pub title: String,
    pub content_hash: String,
    #[ts(type = "number")]
    pub byte_size: i64,
    #[ts(type = "number")]
    pub chunk_count: i32,
    pub metadata_json: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub indexed_at: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Knowledge Base Chunks
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KbChunk {
    pub id: String,
    pub kb_id: String,
    pub document_id: String,
    #[ts(type = "number")]
    pub chunk_index: i32,
    pub content: String,
    #[ts(type = "number")]
    pub token_count: i32,
    pub metadata_json: Option<String>,
}

// ============================================================================
// Vector Search Result
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct VectorSearchResult {
    pub chunk_id: String,
    pub document_id: String,
    pub document_title: String,
    pub content: String,
    #[ts(type = "number")]
    pub score: f32,
    #[ts(type = "number")]
    pub distance: f32,
    pub source_path: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

// ============================================================================
// Ingest Request
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KbIngestRequest {
    pub kb_id: String,
    pub source_type: String,
    pub source_path: Option<String>,
    pub raw_text: Option<String>,
    pub title: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

// ============================================================================
// Search Query
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KbSearchQuery {
    pub kb_id: String,
    pub query: String,
    #[ts(type = "number | undefined")]
    pub top_k: Option<usize>,
    #[ts(type = "number | undefined")]
    pub min_score: Option<f32>,
    pub filter_source: Option<String>,
}

// ============================================================================
// Ingest Progress (background job state)
// ============================================================================

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KbIngestProgress {
    pub job_id: String,
    pub kb_id: String,
    pub status: String,
    #[ts(type = "number")]
    pub documents_total: usize,
    #[ts(type = "number")]
    pub documents_done: usize,
    #[ts(type = "number")]
    pub chunks_created: usize,
    pub current_file: Option<String>,
    pub error: Option<String>,
}
