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
    /// Pages in the source (PDF); `None` for flat text.
    #[ts(type = "number | null")]
    pub page_count: Option<i32>,
    /// Pages with no readable text layer (scanned images). > 0 means part of
    /// this document is invisible to search.
    #[ts(type = "number")]
    pub empty_pages: i32,
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
    /// 1-based page this chunk was read from; `None` for flat text.
    #[ts(type = "number | null")]
    pub source_page: Option<i32>,
    /// 0.0..=1.0 — how faithfully this text represents its source page.
    #[ts(type = "number")]
    pub extraction_confidence: f32,
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
    /// Where in the source this passage came from — the citation. `None` for
    /// flat text, which has no addressable location beyond the file itself.
    #[ts(type = "number | null")]
    pub source_page: Option<i32>,
    /// How much to trust that this passage is a faithful reading of the source
    /// (0.0..=1.0). A retrieval hit on a low-confidence chunk is a hit on text
    /// scraped off a mostly-image page: quote it, but hedge it.
    #[ts(type = "number")]
    pub extraction_confidence: f32,
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
