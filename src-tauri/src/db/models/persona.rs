use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

// ============================================================================
// Design Context — typed envelope for the design_context JSON column
// ============================================================================

/// A file attached during design analysis (API spec, schema, etc.).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DesignFile {
    pub name: String,
    pub content: String,
    /// File type discriminator: "api-spec", "schema", "mcp-config", "other"
    #[serde(rename = "type")]
    pub file_type: String,
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
}

/// Structured envelope for the `design_context` JSON column.
///
/// Three independent sections:
/// - `design_files` — files & references for the AI design prompt
/// - `credential_links` — connector name → credential ID mappings
/// - `use_cases` — structured workflow descriptions from design results
/// - `summary` — optional human-readable summary (legacy compat)
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
}

impl DesignContextData {
    /// Serialize to JSON string for DB storage.
    pub fn to_json_string(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
    }
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
    pub max_concurrent: i32,
    pub timeout_ms: i32,
    pub notification_channels: Option<String>,
    pub last_design_result: Option<String>,
    pub model_profile: Option<String>,
    pub max_budget_usd: Option<f64>,
    pub max_turns: Option<i32>,
    pub design_context: Option<String>,
    pub group_id: Option<String>,
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
        {
            return data;
        }
    }

    // Legacy format: try parsing as a flat JSON object with top-level keys
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(raw) {
        if let Some(obj) = val.as_object() {
            let mut result = DesignContextData::default();

            // Legacy: top-level "files" and "references" → designFiles section
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

    // Completely unparseable — treat raw text as summary
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
/// - `healthy`  — all recent executions succeeded (or no failures)
/// - `degraded` — some recent executions failed (failure rate < 60%)
/// - `failing`  — majority of recent executions failed (failure rate >= 60%)
/// - `dormant`  — no recent executions at all
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaHealth {
    /// Canonical health level: "healthy", "degraded", "failing", or "dormant"
    pub status: String,
    /// Last N execution statuses (e.g. ["completed","failed","completed"]), newest first
    pub recent_statuses: Vec<String>,
    /// Success rate from recent executions (0.0–1.0)
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
    pub max_concurrent: Option<i32>,
    pub timeout_ms: Option<i32>,
    pub notification_channels: Option<String>,
    pub last_design_result: Option<Option<String>>,
    pub model_profile: Option<Option<String>>,
    pub max_budget_usd: Option<Option<f64>>,
    pub max_turns: Option<Option<i32>>,
    pub design_context: Option<Option<String>>,
    pub group_id: Option<Option<String>>,
}
