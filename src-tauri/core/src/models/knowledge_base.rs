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

/// Full result payload of `kb_search`. Wraps the ranked hits together with
/// retrieval-quality metadata so the caller can see what the pipeline
/// *removed*, not just what survived.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KbSearchResponse {
    /// Ranked hits (RRF over vector + BM25, floor- and filter-applied).
    pub results: Vec<VectorSearchResult>,
    /// How many vector candidates the shared relevance floor
    /// (`retrieval::MAX_VECTOR_DISTANCE`) dropped before ranking. A large
    /// number relative to `results.len()` means the corpus has little that is
    /// actually close to this query — the honest signal that used to be
    /// hidden when small corpora padded results with far-away noise.
    #[ts(type = "number")]
    pub floor_filtered: usize,
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

// ============================================================================
// Structured Extraction (LLM document -> typed rows)
// ============================================================================

/// One field of an entity type in an extraction schema.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KbSchemaField {
    pub name: String,
    /// What this field holds, in the model's words — carried into the
    /// extraction prompt so the second pass knows what to look for.
    pub description: String,
}

/// One entity type the schema will extract (e.g. "footing", "line_item").
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KbSchemaEntity {
    pub entity_type: String,
    pub description: String,
    pub fields: Vec<KbSchemaField>,
}

/// A proposed-or-approved extraction schema: the set of entity types and their
/// fields the model will pull out of the corpus. Inferred in pass 1, edited by
/// the user, then applied in pass 2 — see `vector/DESIGN.md`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KbExtractionSchema {
    pub entities: Vec<KbSchemaEntity>,
}

/// One extraction pass over a knowledge base.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KbExtractionRun {
    pub id: String,
    pub kb_id: String,
    /// The approved `KbExtractionSchema`, serialized. Kept on the run so its
    /// entities can be interpreted without re-deriving the schema.
    pub schema_json: String,
    pub status: String,
    #[ts(type = "number")]
    pub entity_count: i32,
    pub error_message: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

/// One typed object extracted from a document.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KbEntity {
    pub id: String,
    pub run_id: String,
    pub kb_id: String,
    pub document_id: Option<String>,
    /// Source document title, hydrated on read for display. Not a stored column.
    pub document_title: Option<String>,
    /// 1-based page the object was found on; `None` for flat-text sources.
    #[ts(type = "number | null")]
    pub source_page: Option<i32>,
    pub entity_type: String,
    /// The model's short label for this instance, e.g. "F10 footing".
    pub entity_key: String,
    /// Field -> value object matching the run's schema.
    pub attributes: Option<serde_json::Value>,
    #[ts(type = "number")]
    pub extraction_confidence: f32,
    pub created_at: String,
}

/// Progress event for a running extraction pass.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KbExtractionProgress {
    pub run_id: String,
    pub kb_id: String,
    pub status: String,
    #[ts(type = "number")]
    pub documents_total: usize,
    #[ts(type = "number")]
    pub documents_done: usize,
    #[ts(type = "number")]
    pub entities_found: usize,
    pub current_document: Option<String>,
    pub error: Option<String>,
}
