use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A single field-level entry in a persona's change history.
///
/// One row is written per changed field per `update_persona` call. The editor
/// Settings tab surfaces these newest-first so a user can answer "who changed
/// my agent's model / budget / prompt, and when".
///
/// Secret-bearing fields (`model_profile`, `notification_channels`) never store
/// their real values — `before_value` / `after_value` are redacted to
/// `"(changed)"`. All other values are truncated to a sane display length.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PersonaChangeEntry {
    pub id: String,
    pub persona_id: String,
    /// Persisted column name that changed, e.g. `"name"`, `"system_prompt"`,
    /// `"max_budget_usd"`, `"model_profile"`. Rendered as a friendly label in
    /// the UI via the i18n `status_tokens`/local map.
    pub field: String,
    /// Prior value (truncated / redacted). `None` when the field had no value.
    pub before_value: Option<String>,
    /// New value (truncated / redacted). `None` when the field was cleared.
    pub after_value: Option<String>,
    /// Origin of the edit: `"editor" | "header" | "fanout" | "other"`.
    pub source: Option<String>,
    pub created_at: String,
}
