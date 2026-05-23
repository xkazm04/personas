use serde::{Deserialize, Deserializer, Serialize};
use ts_rs::TS;

/// Three-state deserializer for nullable update fields. Serde's default for
/// `Option<Option<T>>` collapses JSON `null` to `None`, losing the
/// "set-to-null" intent. With this helper:
///
///   - field absent from JSON  → outer `None`        → preserve (no-op)
///   - field present, value `null` → `Some(None)`    → set column to NULL
///   - field present, value `x`    → `Some(Some(x))` → set column to `x`
///
/// Apply with `#[serde(default, deserialize_with = "double_option")]`.
fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

// ============================================================================
// Groups (Workspace Containers)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaGroup {
    pub id: String,
    pub name: String,
    pub color: String,
    pub sort_order: i32,
    pub collapsed: bool,
    /// Workspace description
    pub description: Option<String>,
    /// JSON-encoded ModelProfile -- group-level default model
    pub default_model_profile: Option<String>,
    /// Group-level default budget cap (USD)
    pub default_max_budget_usd: Option<f64>,
    /// Group-level default turn limit
    pub default_max_turns: Option<i32>,
    /// Shared instructions appended to every persona prompt in this workspace
    pub shared_instructions: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreatePersonaGroupInput {
    pub name: String,
    pub color: Option<String>,
    pub sort_order: Option<i32>,
    pub description: Option<String>,
}

/// Partial update payload for a `PersonaGroup` (cycle 24).
///
/// Single-Option fields (`name`, `color`, `sort_order`, `collapsed`) are
/// "set-or-preserve": `None` → no change, `Some(v)` → set to v. These
/// columns aren't nullable on the row so an explicit clear isn't meaningful.
///
/// Double-Option fields (the nullable defaults + description +
/// shared_instructions) are "set / clear / preserve": `None` → preserve,
/// `Some(None)` → set to NULL, `Some(Some(v))` → set to v. The
/// `double_option` deserializer above is what teaches serde to map JSON
/// `null` (the "clear" sentinel) to `Some(None)` instead of collapsing
/// to `None`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePersonaGroupInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "string")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "string")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub sort_order: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "boolean")]
    pub collapsed: Option<bool>,
    #[serde(default, deserialize_with = "double_option")]
    #[ts(optional, type = "string | null")]
    pub description: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    #[ts(optional, type = "string | null")]
    pub default_model_profile: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    #[ts(optional, type = "number | null")]
    pub default_max_budget_usd: Option<Option<f64>>,
    #[serde(default, deserialize_with = "double_option")]
    #[ts(optional, type = "number | null")]
    pub default_max_turns: Option<Option<i32>>,
    #[serde(default, deserialize_with = "double_option")]
    #[ts(optional, type = "string | null")]
    pub shared_instructions: Option<Option<String>>,
}
