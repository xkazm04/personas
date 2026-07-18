//! Shared export/import data structs and validation constants used by both
//! `import_export` (single-persona v1 bundles) and `data_portability`
//! (full workspace v2 archives).

use serde::{Deserialize, Serialize};

use crate::error::AppError;

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
// Shared persona-field validation
// ============================================================================

/// Validate a persona's scalar fields against the shared length caps above.
///
/// This is the single source of truth for persona import field validation,
/// shared by both importers so a persona can never be written with an
/// oversized field regardless of which path it arrived through:
/// - `import_export::import_persona_from_value` (single-persona `.persona.json`)
/// - `engine::bundle::import_persona_from_value` (signed `.persona` bundle)
///
/// `name` is validated as the *final* name the caller intends to persist
/// (callers that append a suffix such as " (imported)" or a rename prefix
/// must pass the mutated name so the cap reflects what actually reaches the
/// database). Optional fields are only checked when present.
///
/// Callers that need an "empty name" distinct from a length error (e.g. to
/// reject a blank raw name before applying a suffix) should keep their own
/// `require_non_empty` on the raw value in addition to this call.
pub fn validate_persona_import_fields(
    name: &str,
    system_prompt: &str,
    description: Option<&str>,
    structured_prompt: Option<&str>,
    icon: Option<&str>,
    color: Option<&str>,
    notification_channels: Option<&str>,
    model_profile: Option<&str>,
    design_context: Option<&str>,
) -> Result<(), AppError> {
    crate::validation::require_non_empty("persona name", name)?;
    crate::validation::require_max_len("persona name", name, MAX_NAME_LEN)?;
    crate::validation::require_max_len("system_prompt", system_prompt, MAX_SYSTEM_PROMPT_LEN)?;
    require_opt("description", description, MAX_DESCRIPTION_LEN)?;
    require_opt("structured_prompt", structured_prompt, MAX_STRUCTURED_PROMPT_LEN)?;
    require_opt("icon", icon, MAX_SHORT_FIELD_LEN)?;
    require_opt("color", color, MAX_SHORT_FIELD_LEN)?;
    require_opt("notification_channels", notification_channels, MAX_SHORT_FIELD_LEN)?;
    require_opt("model_profile", model_profile, MAX_SHORT_FIELD_LEN)?;
    require_opt("design_context", design_context, MAX_DESIGN_CONTEXT_LEN)?;
    Ok(())
}

/// Small adapter so `validate_persona_import_fields` can take `Option<&str>`
/// (natural for JSON field-picking) while reusing the `Option<String>`-based
/// `require_optional_max_len` primitive.
fn require_opt(field: &str, value: Option<&str>, max_bytes: usize) -> Result<(), AppError> {
    if let Some(v) = value {
        crate::validation::require_max_len(field, v, max_bytes)?;
    }
    Ok(())
}

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
    pub tags: Option<crate::db::models::Json<Vec<String>>>,
}
