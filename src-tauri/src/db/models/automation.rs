use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::engine::lifecycle::AutomationDeployStatus;

// ============================================================================
// Enums
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AutomationPlatform {
    N8n,
    GithubActions,
    Zapier,
    Custom,
}

impl AutomationPlatform {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::N8n => "n8n",
            Self::GithubActions => "github_actions",
            Self::Zapier => "zapier",
            Self::Custom => "custom",
        }
    }

    /// Human-readable label for display.
    pub fn label(&self) -> &'static str {
        match self {
            Self::N8n => "n8n",
            Self::GithubActions => "GitHub Actions",
            Self::Zapier => "Zapier",
            Self::Custom => "External Workflow",
        }
    }
}

impl fmt::Display for AutomationPlatform {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for AutomationPlatform {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "n8n" => Ok(Self::N8n),
            "github_actions" => Ok(Self::GithubActions),
            "zapier" => Ok(Self::Zapier),
            "custom" => Ok(Self::Custom),
            other => Err(format!("Unknown automation platform: '{other}'")),
        }
    }
}

impl rusqlite::types::FromSql for AutomationPlatform {
    fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        let s = value.as_str()?;
        s.parse().map_err(|e: String| rusqlite::types::FromSqlError::Other(e.into()))
    }
}

impl rusqlite::types::ToSql for AutomationPlatform {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        Ok(rusqlite::types::ToSqlOutput::Borrowed(
            rusqlite::types::ValueRef::Text(self.as_str().as_bytes()),
        ))
    }
}

// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AutomationFallbackMode {
    Connector,
    Fail,
    Skip,
}

impl AutomationFallbackMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Connector => "connector",
            Self::Fail => "fail",
            Self::Skip => "skip",
        }
    }
}

impl fmt::Display for AutomationFallbackMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for AutomationFallbackMode {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "connector" => Ok(Self::Connector),
            "fail" => Ok(Self::Fail),
            "skip" => Ok(Self::Skip),
            other => Err(format!("Unknown fallback mode: '{other}'")),
        }
    }
}

impl rusqlite::types::FromSql for AutomationFallbackMode {
    fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        let s = value.as_str()?;
        s.parse().map_err(|e: String| rusqlite::types::FromSqlError::Other(e.into()))
    }
}

impl rusqlite::types::ToSql for AutomationFallbackMode {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        Ok(rusqlite::types::ToSqlOutput::Borrowed(
            rusqlite::types::ValueRef::Text(self.as_str().as_bytes()),
        ))
    }
}

// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AutomationRunStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Timeout,
}

impl AutomationRunStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Timeout => "timeout",
        }
    }
}

impl fmt::Display for AutomationRunStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for AutomationRunStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "pending" => Ok(Self::Pending),
            "running" => Ok(Self::Running),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "timeout" => Ok(Self::Timeout),
            other => Err(format!("Unknown automation run status: '{other}'")),
        }
    }
}

impl rusqlite::types::FromSql for AutomationRunStatus {
    fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        let s = value.as_str()?;
        s.parse().map_err(|e: String| rusqlite::types::FromSqlError::Other(e.into()))
    }
}

impl rusqlite::types::ToSql for AutomationRunStatus {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        Ok(rusqlite::types::ToSqlOutput::Borrowed(
            rusqlite::types::ValueRef::Text(self.as_str().as_bytes()),
        ))
    }
}

// ============================================================================
// Persona Automations (external workflow references)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaAutomation {
    pub id: String,
    pub persona_id: String,
    pub use_case_id: Option<String>,
    pub name: String,
    pub description: String,
    pub platform: AutomationPlatform,
    pub platform_workflow_id: Option<String>,
    pub platform_url: Option<String>,
    pub webhook_url: Option<String>,
    pub webhook_method: String,
    pub platform_credential_id: Option<String>,
    pub credential_mapping: Option<String>,
    pub input_schema: Option<String>,
    pub output_schema: Option<String>,
    pub timeout_ms: i64,
    pub retry_count: i32,
    pub fallback_mode: AutomationFallbackMode,
    pub deployment_status: AutomationDeployStatus,
    pub last_triggered_at: Option<String>,
    pub last_result_status: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreateAutomationInput {
    pub persona_id: String,
    pub use_case_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub platform: AutomationPlatform,
    pub platform_workflow_id: Option<String>,
    pub platform_url: Option<String>,
    pub webhook_url: Option<String>,
    pub webhook_method: Option<String>,
    pub platform_credential_id: Option<String>,
    pub credential_mapping: Option<String>,
    pub input_schema: Option<String>,
    pub output_schema: Option<String>,
    pub timeout_ms: Option<i64>,
    pub retry_count: Option<i32>,
    pub fallback_mode: Option<AutomationFallbackMode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAutomationInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub use_case_id: Option<Option<String>>,
    pub platform_workflow_id: Option<Option<String>>,
    pub platform_url: Option<Option<String>>,
    pub webhook_url: Option<Option<String>>,
    pub webhook_method: Option<String>,
    pub platform_credential_id: Option<Option<String>>,
    pub credential_mapping: Option<Option<String>>,
    pub input_schema: Option<Option<String>>,
    pub output_schema: Option<Option<String>>,
    pub timeout_ms: Option<i64>,
    pub retry_count: Option<i32>,
    pub fallback_mode: Option<AutomationFallbackMode>,
    pub deployment_status: Option<AutomationDeployStatus>,
    pub error_message: Option<Option<String>>,
}

// ============================================================================
// Automation Runs (invocation history)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRun {
    pub id: String,
    pub automation_id: String,
    pub execution_id: Option<String>,
    pub status: AutomationRunStatus,
    pub input_data: Option<String>,
    pub output_data: Option<String>,
    pub platform_run_id: Option<String>,
    pub platform_logs_url: Option<String>,
    pub duration_ms: Option<i64>,
    pub error_message: Option<String>,
    pub warnings: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
}
