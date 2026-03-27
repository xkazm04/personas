use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Memories
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaMemory {
    pub id: String,
    pub persona_id: String,
    pub title: String,
    pub content: String,
    pub category: String,
    pub source_execution_id: Option<String>,
    pub importance: i32,
    pub tags: Option<String>,
    /// Memory tier: "core" (always injected), "active" (selected by scoring),
    /// "archive" (never injected, searchable only).
    pub tier: String,
    /// How many times this memory has been injected into a prompt.
    pub access_count: i32,
    /// Last time this memory was injected into a prompt (ISO 8601).
    pub last_accessed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreatePersonaMemoryInput {
    pub persona_id: String,
    pub title: String,
    pub content: String,
    pub category: Option<String>,
    pub source_execution_id: Option<String>,
    pub importance: Option<i32>,
    pub tags: Option<String>,
}
