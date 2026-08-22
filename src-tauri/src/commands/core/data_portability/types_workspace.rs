//! Record shapes for workspace knowledge and adoptions.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

/// A workspace and its shared knowledge library. Knowledge travels in ALL
/// statuses (the lifecycle is the data); adoption cells are filtered to the
/// projects actually bundled so the slice stays resolvable on import.
#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceKnowledgeExport {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub description: Option<String>,
    pub knowledge: Vec<WorkspaceKnowledgeEntryExport>,
    pub adoption: Vec<WorkspaceAdoptionExport>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceKnowledgeEntryExport {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub statement: String,
    pub detail_md: Option<String>,
    pub topic: Option<String>,
    pub abstraction: Option<String>,
    pub ftype: Option<String>,
    pub durability: Option<String>,
    pub governing_id: Option<String>,
    pub evidence_count: Option<i32>,
    pub applicability: Option<String>,
    pub status: String,
    pub origin_project_id: Option<String>,
    pub provenance: Option<String>,
    pub confidence: Option<f64>,
    pub dedup_key: Option<String>,
    pub superseded_by: Option<String>,
    pub harvest_scope: Option<String>,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub decided_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceAdoptionExport {
    pub practice_id: String,
    pub project_id: String,
    pub state: String,
    pub note: Option<String>,
    pub last_verified_at: Option<String>,
}
