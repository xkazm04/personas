use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Memories
// ============================================================================

/// Valid range for memory importance scores.
pub const IMPORTANCE_MIN: i32 = 1;
pub const IMPORTANCE_MAX: i32 = 5;

/// Validate that an importance score is within the allowed range (1–5).
pub fn validate_importance(value: i32) -> Result<i32, crate::error::AppError> {
    if (IMPORTANCE_MIN..=IMPORTANCE_MAX).contains(&value) {
        Ok(value)
    } else {
        Err(crate::error::AppError::Validation(format!(
            "Importance must be between {IMPORTANCE_MIN} and {IMPORTANCE_MAX}, got {value}"
        )))
    }
}

// -- Memory category taxonomy -------------------------------------------------

/// The canonical set of memory categories.
///
/// - `fact`        — Objective knowledge about the world or the agent's domain.
/// - `preference`  — User or stakeholder preferences that guide agent behaviour.
/// - `instruction` — Explicit rules or directives the agent must follow.
/// - `context`     — Background information that helps the agent reason.
/// - `learned`     — Insights the agent derived from past executions.
/// - `constraint`  — Hard limits (rate-limits, compliance rules, deadlines).
pub const MEMORY_CATEGORIES: &[&str] = &[
    "fact",
    "preference",
    "instruction",
    "context",
    "learned",
    "constraint",
];

/// The default category assigned when none is provided.
pub const DEFAULT_MEMORY_CATEGORY: &str = "fact";

/// Validate that `value` is one of the recognised memory categories.
/// Returns the validated string on success.
pub fn validate_category(value: &str) -> Result<&str, crate::error::AppError> {
    if MEMORY_CATEGORIES.contains(&value) {
        Ok(value)
    } else {
        Err(crate::error::AppError::Validation(format!(
            "Invalid memory category '{value}'. Valid categories: {}",
            MEMORY_CATEGORIES.join(", ")
        )))
    }
}

/// Return `value` if it is a recognised category, otherwise [`DEFAULT_MEMORY_CATEGORY`].
/// Useful for importing data that may contain legacy/unknown categories.
pub fn normalize_category(value: &str) -> &'static str {
    match MEMORY_CATEGORIES.iter().find(|&&c| c == value) {
        Some(c) => c,
        None => DEFAULT_MEMORY_CATEGORY,
    }
}

/// Description metadata for a single memory category, exposed to the frontend.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct MemoryCategoryInfo {
    /// Machine-readable key (e.g. "fact").
    pub key: String,
    /// Human-readable label (e.g. "Fact").
    pub label: String,
    /// Short explanation of when to use this category.
    pub description: String,
}

/// Build the full list of category metadata for the frontend.
pub fn all_category_info() -> Vec<MemoryCategoryInfo> {
    vec![
        MemoryCategoryInfo { key: "fact".into(), label: "Fact".into(), description: "Objective knowledge about the world or the agent's domain".into() },
        MemoryCategoryInfo { key: "preference".into(), label: "Preference".into(), description: "User or stakeholder preferences that guide agent behaviour".into() },
        MemoryCategoryInfo { key: "instruction".into(), label: "Instruction".into(), description: "Explicit rules or directives the agent must follow".into() },
        MemoryCategoryInfo { key: "context".into(), label: "Context".into(), description: "Background information that helps the agent reason".into() },
        MemoryCategoryInfo { key: "learned".into(), label: "Learned".into(), description: "Insights the agent derived from past executions".into() },
        MemoryCategoryInfo { key: "constraint".into(), label: "Constraint".into(), description: "Hard limits such as rate-limits, compliance rules, or deadlines".into() },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaMemory {
    pub id: String,
    pub persona_id: String,
    pub title: String,
    pub content: String,
    pub category: String,
    pub source_execution_id: Option<String>,
    /// Importance score on a 1–5 scale:
    /// - 1: Low — minor or ephemeral detail
    /// - 2: Below average — limited ongoing relevance
    /// - 3: Normal (default) — standard operational knowledge
    /// - 4: High — frequently useful context
    /// - 5: Critical — essential knowledge for agent operation
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
