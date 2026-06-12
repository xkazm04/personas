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

// v3.2 — helper mirror of the one in notifications.rs; duplicated per D-07 prep
// guidance to avoid creating a shared module for a 2-line function.
fn default_true() -> bool {
    true
}

/// v3.2 — Sample output declared on a use case, persisted through the promote
/// path into `design_context.use_cases[i].sample_output` (Phase 20 wires this).
/// All fields are optional at the schema layer (D-04); missing `format` is
/// coerced to `SampleOutputFormat::Plain` by `hoist_sample_outputs` in
/// `engine::template_v3`, so downstream renderers always see a concrete value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SampleOutput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<SampleOutputFormat>,
}

/// v3.2 — Locked enum for `sample_output.format` (D-01). Unknown values are
/// rejected at deserialize time by serde; the normalizer also warn-and-coerces
/// any unknown JSON string it sees before deserialize (defense-in-depth).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SampleOutputFormat {
    Markdown,
    Plain,
    Json,
    Html,
}

/// v3.2 — Shape-v2 notification channel entry on the persona row.
/// Discriminant vs. legacy shape B: presence of `use_case_ids`.
/// `credential_id` is optional because `type: "built-in"` and
/// `type: "titlebar"` have no credential backing them (D-07; spec §4.2).
///
/// Wire format is snake_case throughout the codebase — frontend, storage,
/// validation, and the `parse_channels_v2` discriminant all probe
/// `use_case_ids` / `credential_id` / `event_filter` directly. An earlier
/// `#[serde(rename_all = "camelCase")]` on this struct silently broke
/// every shape-v2 round-trip because the deserializer was the only place
/// that expected camelCase; reverting keeps serde aligned with the rest
/// of the codebase.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub struct ChannelSpecV2 {
    #[serde(rename = "type")]
    pub channel_type: ChannelSpecV2Type,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_id: Option<String>,
    pub use_case_ids: ChannelScopeV2,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_filter: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<serde_json::Value>,
}

/// v3.2 — Channel type discriminator for shape v2. Kebab-case on the wire
/// (`"built-in"`) to match the prototype + handoff doc spec.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
#[serde(rename_all = "kebab-case")]
pub enum ChannelSpecV2Type {
    BuiltIn,
    Titlebar,
    Slack,
    Telegram,
    Email,
    Discord,
    Teams,
}

/// v3.2 — `use_case_ids` is either the sentinel string `"*"` (matches all UCs)
/// or an explicit list of IDs. Empty list is rejected by the validator
/// (`validation::persona::validate_notification_channels`). Untagged serde
/// tries `String` before `Vec<String>`, which correctly maps `"*"` → All
/// and `["uc_a"]` → Specific.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
#[serde(untagged)]
pub enum ChannelScopeV2 {
    All(String),
    Specific(Vec<String>),
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
    // v3.2 — per-UC sample output for adoption preview + test delivery
    // (SCHEMA-01). Preserved through the promote path as-is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_output: Option<SampleOutput>,
    /// Runtime toggle — `None` or `Some(true)` means active. Phase C1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// One-line "what this capability does" used in the Active Capabilities
    /// section of the runtime prompt. Falls back to `description` when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capability_summary: Option<String>,
    /// Recipe provenance — set when the use case was adopted from a catalog
    /// recipe. Carried through Rust-side design_context rewrites so the
    /// catalog's "Adopted" badge and future staleness checks keep working.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_recipe_id: Option<String>,
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
    /// `builtin-twin` connector resolves this id instead of the
    /// globally-active twin via `twin_get_active_profile(persona_id)`.
    /// A deleted twin id silently falls back to the active twin so the
    /// connector never errors on stale design_context entries.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub twin_id: Option<String>,
    /// Dev Tools project (codebase) this persona is pinned to. When `Some`,
    /// the `codebase` connector resolves THIS `dev_projects.id` instead of the
    /// globally-first project (`resolve_context_project`), so a team adopted
    /// for repo X reads repo X. Set once by the team adoption questionnaire and
    /// written to every member, so each persona keeps its binding independently
    /// (it survives team disband). A deleted/inactive project silently falls
    /// back to the global probe so the connector never errors on stale entries.
    /// Mirrors `twin_id`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dev_project_id: Option<String>,
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
    /// Per-persona star: marks the persona as in the Director's coaching scope.
    /// Promoted from a localStorage-only favorite to a durable column.
    #[serde(default)]
    pub starred: bool,
    pub max_concurrent: i32,
    pub timeout_ms: i32,
    pub notification_channels: Option<String>,
    pub last_design_result: Option<String>,
    /// JSON-encoded report from the most recent `test_build_draft` run for
    /// this persona (A-grade Phase 2, 2026-05-03). Shape matches the value
    /// returned from `engine::build_session::run_tool_tests` — see
    /// `tool_tests.rs` for the full schema. The TestReportModal in the
    /// editor reads this so users can see real per-tool / per-connector
    /// results *after* promote, not just during the in-flight build session.
    /// `None` for personas that have never run a test (manual templates,
    /// legacy installs).
    pub last_test_report: Option<String>,
    pub model_profile: Option<String>,
    pub max_budget_usd: Option<f64>,
    pub max_turns: Option<i32>,
    pub design_context: Option<String>,
    /// Workspace anchor (Groups→Teams consolidation): the one team whose
    /// shared instructions + defaults + injected memory apply at runtime.
    pub home_team_id: Option<String>,
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
    /// Phase 5 v1: per-persona gate for the Claude CLI session-resume
    /// awareness feature. When `true` AND the global cli_session toggle on
    /// `AmbientContextFusion` is also `true`, the runner injects a `## Active
    /// Claude CLI Session` block into the persona's system prompt before
    /// `runner::run_execution`. Defaults to `false` — explicit opt-in per
    /// persona. See `docs/features/companion/athena-cli-session-
    /// awareness.md`.
    #[serde(default)]
    pub cli_awareness_enabled: bool,
    /// Adoption pre-flight signal. `ready` (default) means every declared
    /// connector has a matching vault credential or is a built-in local
    /// resource. `needs_credentials` means the persona was created but one
    /// or more declared connectors have no vault entry — the UI shows a
    /// "Setup required" badge and the runtime scheduler should skip
    /// auto-execution until the user fixes it. Set by
    /// `instant_adopt_template_inner` and `promote_build_draft_inner`.
    #[serde(default = "default_setup_status")]
    pub setup_status: String,
    /// JSON-encoded `PersonaSetup` (adoption-honesty redesign) — the
    /// structured account of what the persona needs: typed connector
    /// blockers, wired trigger types, and a human-readable readiness
    /// preview. `setup_status` above stays the coarse execute-gate;
    /// this carries the detail the UI routes on. NULL on legacy rows and
    /// until the next promote writes it.
    #[serde(default)]
    pub setup_detail: Option<String>,
    /// JSON-encoded `{ [use_case_id]: GlyphDimension[] }` recording per-
    /// capability dim disables set in the View mode SigilEditModal.
    /// Durable — survives rebuilds + runtime executions. Read by the
    /// runtime executor (skips actions bound to disabled dims) and by
    /// re-build flows (seeds the build session's disabled_dims_json).
    /// NULL = no disables; this is the default for fresh + legacy rows.
    #[serde(default)]
    pub disabled_dims_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn default_setup_status() -> String {
    "ready".to_string()
}

impl Persona {
    /// Parse the `design_context` JSON string into a typed `DesignContextData`.
    /// Returns a default (empty) value if the column is NULL or unparseable.
    pub fn parsed_design_context(&self) -> DesignContextData {
        parse_design_context(self.design_context.as_deref())
    }

    /// Parse `disabled_dims_json` into a `{ use_case_id → set<dim> }` map.
    /// Returns an empty map on NULL or parse failure — the column is purely
    /// advisory and a corrupt row must not block execution.
    pub fn parsed_disabled_dims(&self) -> std::collections::HashMap<String, Vec<String>> {
        let Some(raw) = self.disabled_dims_json.as_deref() else {
            return std::collections::HashMap::new();
        };
        serde_json::from_str(raw).unwrap_or_default()
    }

    /// Convenience: is `dim` disabled for the given capability id?
    /// Returns `false` on NULL column, unknown cap, or empty set — so the
    /// runtime executor's call site reads as "skip iff this returns true",
    /// no extra option chain needed.
    pub fn is_dim_disabled_for_cap(&self, cap_id: &str, dim: &str) -> bool {
        self.parsed_disabled_dims()
            .get(cap_id)
            .is_some_and(|dims| dims.iter().any(|d| d == dim))
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
    pub last_test_report: Option<Option<String>>,
    pub model_profile: Option<Option<String>>,
    pub max_budget_usd: Option<Option<f64>>,
    pub max_turns: Option<Option<i32>>,
    pub design_context: Option<Option<String>>,
    pub home_team_id: Option<Option<String>>,
    pub parameters: Option<Option<String>>,
    pub gateway_exposure: Option<PersonaGatewayExposure>,
    /// Phase 5 v1: per-persona Claude CLI session-resume awareness gate.
    pub cli_awareness_enabled: Option<bool>,
    /// Per-capability dim disables — JSON `{ [use_case_id]: GlyphDimension[] }`.
    /// Outer `Option` follows the partial-update pattern (`None` = leave
    /// unchanged); inner `Option<String>` lets callers explicitly clear
    /// the column with `Some(None)`. Set by the View-mode SigilEditModal.
    pub disabled_dims_json: Option<Option<String>>,
}
