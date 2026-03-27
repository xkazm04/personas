//! Shared export/import data structs and validation constants used by both
//! `import_export` (single-persona v1 bundles) and `data_portability`
//! (full workspace v2 archives).

use serde::{Deserialize, Serialize};

// ============================================================================
// Field length limits
// ============================================================================
pub const MAX_NAME_LEN: usize = 200;
pub const MAX_DESCRIPTION_LEN: usize = 2_000;
pub const MAX_SYSTEM_PROMPT_LEN: usize = 100_000;
pub const MAX_STRUCTURED_PROMPT_LEN: usize = 100_000;
pub const MAX_SHORT_FIELD_LEN: usize = 500;
pub const MAX_CONFIG_LEN: usize = 10_000;
pub const MAX_DESIGN_CONTEXT_LEN: usize = 50_000;
pub const MAX_MEMORY_CONTENT_LEN: usize = 50_000;

// Array size caps (shared between both formats)
pub const MAX_TRIGGERS: usize = 100;
pub const MAX_SUBSCRIPTIONS: usize = 50;
pub const MAX_MEMORIES: usize = 500;

// ============================================================================
// Shared export structs
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct TriggerExport {
    pub trigger_type: String,
    pub config: Option<String>,
    pub enabled: bool,
    pub use_case_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SubscriptionExport {
    pub event_type: String,
    pub source_filter: Option<String>,
    pub enabled: bool,
    pub use_case_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MemoryExport {
    pub title: String,
    pub content: String,
    pub category: String,
    pub importance: i32,
    pub tags: Option<String>,
}
