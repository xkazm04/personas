use std::collections::HashMap;
use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::AppError;

// ============================================================================
// Typed enums for stringly-typed fields
// ============================================================================

/// Trust level for a persona — mirrors the peer `TrustLevel` enum in
/// `identity.rs` but kept separate because persona trust and peer trust
/// may diverge in the future.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum PersonaTrustLevel {
    Manual,
    #[default]
    Verified,
    Revoked,
}

impl fmt::Display for PersonaTrustLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl PersonaTrustLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Verified => "verified",
            Self::Revoked => "revoked",
        }
    }

    pub fn is_revoked(&self) -> bool {
        matches!(self, Self::Revoked)
    }
}

impl FromStr for PersonaTrustLevel {
    type Err = AppError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "manual" => Ok(Self::Manual),
            "verified" => Ok(Self::Verified),
            "revoked" => Ok(Self::Revoked),
            _ => Err(AppError::Validation(format!(
                "Invalid trust_level '{s}': must be 'manual', 'verified', or 'revoked'"
            ))),
        }
    }
}

/// Visibility of a persona to the external management HTTP API ("A2A gateway").
///
/// - `LocalOnly`  — not exposed via the management API at all (default).
///                  Existing personas migrate to this so external visibility is opt-in.
/// - `InviteOnly` — exposed only to API keys with an explicit grant. For now treated
///                  identically to `Public`; scope-based filtering lands with the
///                  rate-limiting/scopes finding.
/// - `Public`     — exposed to any authenticated API key.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum PersonaGatewayExposure {
    #[default]
    LocalOnly,
    InviteOnly,
    Public,
}

impl fmt::Display for PersonaGatewayExposure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl PersonaGatewayExposure {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::LocalOnly => "local_only",
            Self::InviteOnly => "invite_only",
            Self::Public => "public",
        }
    }

    /// True when the persona should be visible to authenticated API keys.
    pub fn is_externally_visible(&self) -> bool {
        matches!(self, Self::InviteOnly | Self::Public)
    }
}

impl FromStr for PersonaGatewayExposure {
    type Err = AppError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "local_only" => Ok(Self::LocalOnly),
            "invite_only" => Ok(Self::InviteOnly),
            "public" => Ok(Self::Public),
            _ => Err(AppError::Validation(format!(
                "Invalid gateway_exposure '{s}': must be 'local_only', 'invite_only', or 'public'"
            ))),
        }
    }
}

/// Origin of a persona's trust classification.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum PersonaTrustOrigin {
    #[default]
    Builtin,
    User,
    System,
}

impl fmt::Display for PersonaTrustOrigin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl PersonaTrustOrigin {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Builtin => "builtin",
            Self::User => "user",
            Self::System => "system",
        }
    }
}

impl FromStr for PersonaTrustOrigin {
    type Err = AppError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "builtin" => Ok(Self::Builtin),
            "user" => Ok(Self::User),
            "system" => Ok(Self::System),
            _ => Err(AppError::Validation(format!(
                "Invalid trust_origin '{s}': must be 'builtin', 'user', or 'system'"
            ))),
        }
    }
}

/// Parameter type discriminator for persona free parameters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ParamType {
    Number,
    String,
    Boolean,
    Select,
}

impl fmt::Display for ParamType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Number => "number",
            Self::String => "string",
            Self::Boolean => "boolean",
            Self::Select => "select",
        })
    }
}

/// File type discriminator for design context files.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "kebab-case")]
pub enum DesignFileKind {
    ApiSpec,
    Schema,
    McpConfig,
    #[default]
    Other,
}

/// Canonical health status for a persona.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Failing,
    Dormant,
}

impl fmt::Display for HealthStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Healthy => "healthy",
            Self::Degraded => "degraded",
            Self::Failing => "failing",
            Self::Dormant => "dormant",
        })
    }
}

// ============================================================================
// Design Context -- typed envelope for the design_context JSON column
// ============================================================================

/// A file attached during design analysis (API spec, schema, etc.).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DesignFile {
    pub name: String,
    pub content: String,
    #[serde(rename = "type")]
    pub file_type: DesignFileKind,
}

/// Design files and URL references provided as context during design analysis.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DesignFilesSection {
    #[serde(default)]
    pub files: Vec<DesignFile>,
    #[serde(default)]
    pub references: Vec<String>,
}

/// A single use-case description extracted from design results.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DesignUseCase {
    pub id: String,
    pub title: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_input: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_filter: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_schema: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggested_trigger: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_override: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notification_channels: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_subscriptions: Option<serde_json::Value>,
    /// Runtime toggle — `None` or `Some(true)` means active. Phase C1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// One-line "what this capability does" used in the Active Capabilities
    /// section of the runtime prompt. Falls back to `description` when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capability_summary: Option<String>,
    /// Tool names the LLM should prefer when this capability is in focus.
    /// Advisory only — all persona tools remain available at runtime.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_hints: Option<Vec<String>>,
    /// Phase C5b — per-capability generation policy. Controls whether the
    /// dispatcher persists memories/reviews/events emitted by the LLM under
    /// this capability, and lets the user rename emitted events. Absent or
    /// individual fields absent ⇒ defaults inherited from the persona's
    /// existing artefacts (see `engine::dispatch::testable::resolve_generation_policy`).
    /// Stored as raw JSON so the field can grow without a migration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generation_settings: Option<serde_json::Value>,
}

/// A step in the connector pipeline showing chronological service interactions.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorPipelineStep {
    pub connector_name: String,
    pub action_label: String,
    pub order: i32,
}

/// Structured envelope for the `design_context` JSON column.
///
/// Independent sections:
/// - `design_files` -- files & references for the AI design prompt
/// - `credential_links` -- connector name -> credential ID mappings
/// - `use_cases` -- structured workflow descriptions from design results
/// - `summary` -- optional human-readable summary (legacy compat)
/// - `connector_pipeline` -- chronological connector interaction sequence
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DesignContextData {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub design_files: Option<DesignFilesSection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_links: Option<HashMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_cases: Option<Vec<DesignUseCase>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connector_pipeline: Option<Vec<ConnectorPipelineStep>>,
    /// Twin profile this persona is pinned to. When `Some`, the
    /// `builtin-twin` connector should resolve this id instead of the
    /// globally-active twin. Connector resolution wiring is a separate
    /// follow-up — for now this is a pure config field round-tripped
    /// through the design_context envelope.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub twin_id: Option<String>,
}

impl DesignContextData {
    /// Serialize to JSON string for DB storage.
    pub fn to_json_string(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
    }
}

// ============================================================================
// Free Parameters (adjustable without rebuild)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaParameter {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub param_type: ParamType,
    pub default_value: serde_json::Value,
    pub value: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>, // for "select" type
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>, // e.g., "$", "%", "ms"
}

// ============================================================================
// Persona
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Persona {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub system_prompt: String,
    pub structured_prompt: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub enabled: bool,
    pub sensitive: bool,
    pub headless: bool,
    pub max_concurrent: i32,
    pub timeout_ms: i32,
    pub notification_channels: Option<String>,
    pub last_design_result: Option<String>,
    pub model_profile: Option<String>,
    pub max_budget_usd: Option<f64>,
    pub max_turns: Option<i32>,
    pub design_context: Option<String>,
    pub group_id: Option<String>,
    pub source_review_id: Option<String>,
    pub trust_level: PersonaTrustLevel,
    pub trust_origin: PersonaTrustOrigin,
    pub trust_verified_at: Option<String>,
    pub trust_score: f64,
    /// Free parameters: JSON array of `PersonaParameter` definitions.
    /// Adjustable at runtime without triggering a rebuild.
    pub parameters: Option<String>,
    /// Visibility to the external management HTTP API.
    /// Defaults to `LocalOnly` so existing personas are not exposed.
    #[serde(default)]
    pub gateway_exposure: PersonaGatewayExposure,
    /// Lowercase template category (e.g. `"development"`, `"finance"`) derived
    /// by `infer_template_category` when the persona was created via template
    /// adoption. `None` for manually-created or pre-Phase-17 personas. Used by
    /// Simple-mode's illustration resolver tier-3 (see `useIllustration.ts`).
    #[serde(default)]
    pub template_category: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Persona {
    /// Parse the `design_context` JSON string into a typed `DesignContextData`.
    /// Returns a default (empty) value if the column is NULL or unparseable.
    pub fn parsed_design_context(&self) -> DesignContextData {
        parse_design_context(self.design_context.as_deref())
    }

    /// Extract only the design-files section as a JSON string for prompt building.
    /// Returns `None` if there are no files or references.
    pub fn design_files_for_prompt(&self) -> Option<String> {
        let ctx = self.parsed_design_context();
        if let Some(ref df) = ctx.design_files {
            if !df.files.is_empty() || !df.references.is_empty() {
                return serde_json::to_string(df).ok();
            }
        }
        // Legacy fallback: if the raw JSON has top-level "files"/"references",
        // return the raw string as-is for backward compat
        if let Some(ref raw) = self.design_context {
            if raw.contains("\"files\"") || raw.contains("\"references\"") {
                return Some(raw.clone());
            }
        }
        None
    }
}

/// Parse a raw design_context JSON string into the typed envelope.
/// Handles both new structured format and legacy flat formats.
pub fn parse_design_context(raw: Option<&str>) -> DesignContextData {
    let raw = match raw {
        Some(s) if !s.trim().is_empty() => s,
        _ => return DesignContextData::default(),
    };

    // Try parsing as the new structured envelope first
    if let Ok(data) = serde_json::from_str::<DesignContextData>(raw) {
        // If any typed field is populated, treat it as the new format
        if data.design_files.is_some()
            || data.credential_links.is_some()
            || data.use_cases.is_some()
            || data.summary.is_some()
            || data.twin_id.is_some()
        {
            return data;
        }
    }

    // Legacy format: try parsing as a flat JSON object with top-level keys
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(raw) {
        if let Some(obj) = val.as_object() {
            let mut result = DesignContextData::default();

            // Legacy: top-level "files" and "references" -> designFiles section
            if obj.contains_key("files") || obj.contains_key("references") {
                let files: Vec<DesignFile> = obj
                    .get("files")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default();
                let references: Vec<String> = obj
                    .get("references")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default();
                if !files.is_empty() || !references.is_empty() {
                    result.design_files = Some(DesignFilesSection { files, references });
                }
            }

            // Legacy: top-level "credential_links"
            if let Some(links) = obj.get("credential_links") {
                if let Ok(map) = serde_json::from_value::<HashMap<String, String>>(links.clone()) {
                    if !map.is_empty() {
                        result.credential_links = Some(map);
                    }
                }
            }

            // Legacy: top-level "use_cases"
            if let Some(ucs) = obj.get("use_cases") {
                if let Ok(cases) = serde_json::from_value::<Vec<DesignUseCase>>(ucs.clone()) {
                    if !cases.is_empty() {
                        result.use_cases = Some(cases);
                    }
                }
            }

            // Legacy: top-level "summary"
            if let Some(s) = obj.get("summary").and_then(|v| v.as_str()) {
                if !s.is_empty() {
                    result.summary = Some(s.to_string());
                }
            }

            return result;
        }
    }

    // Completely unparseable -- treat raw text as summary
    DesignContextData {
        summary: Some(raw.to_string()),
        ..Default::default()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreatePersonaInput {
    pub name: String,
    pub system_prompt: String,
    pub project_id: Option<String>,
    pub description: Option<String>,
    pub structured_prompt: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub enabled: Option<bool>,
    pub max_concurrent: Option<i32>,
    pub timeout_ms: Option<i32>,
    pub model_profile: Option<String>,
    pub max_budget_usd: Option<f64>,
    pub max_turns: Option<i32>,
    pub design_context: Option<String>,
    pub group_id: Option<String>,
    pub notification_channels: Option<String>,
}

/// Canonical health level for a persona, derived from recent execution outcomes.
///
/// - `healthy`  -- all recent executions succeeded (or no failures)
/// - `degraded` -- some recent executions failed (failure rate < 60%)
/// - `failing`  -- majority of recent executions failed (failure rate >= 60%)
/// - `dormant`  -- no recent executions at all
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaHealth {
    pub status: HealthStatus,
    /// Last N execution statuses (e.g. ["completed","failed","completed"]), newest first
    pub recent_statuses: Vec<String>,
    /// Success rate from recent executions (0.0--1.0)
    pub success_rate: f64,
    /// Total number of recent executions examined
    pub total_recent: i64,
    /// Number of executions started today
    pub runs_today: i64,
    /// 7-day execution count histogram (index 0 = 6 days ago, index 6 = today)
    pub sparkline: Vec<i64>,
}

/// Lightweight summary for sidebar badges: trigger count, last execution time, and health.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaSummary {
    pub persona_id: String,
    pub enabled_trigger_count: i64,
    pub last_run_at: Option<String>,
    pub health: PersonaHealth,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdatePersonaInput {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub system_prompt: Option<String>,
    pub structured_prompt: Option<Option<String>>,
    pub icon: Option<Option<String>>,
    pub color: Option<Option<String>>,
    pub enabled: Option<bool>,
    pub sensitive: Option<bool>,
    pub headless: Option<bool>,
    pub max_concurrent: Option<i32>,
    pub timeout_ms: Option<i32>,
    pub notification_channels: Option<String>,
    pub last_design_result: Option<Option<String>>,
    pub model_profile: Option<Option<String>>,
    pub max_budget_usd: Option<Option<f64>>,
    pub max_turns: Option<Option<i32>>,
    pub design_context: Option<Option<String>>,
    pub group_id: Option<Option<String>>,
    pub parameters: Option<Option<String>>,
    pub gateway_exposure: Option<PersonaGatewayExposure>,
}
