use serde::{Deserialize, Serialize};

// ============================================================================
// AgentIr — typed intermediate representation emitted by the build-session LLM.
//
// Previously flowed as `serde_json::Value` through design analysis, build
// sessions, and promote. Each consumer used ad-hoc `.get("key")` with silent
// fallbacks. This typed struct makes the contract explicit:
//   • `#[serde(alias)]` preserves backward compat with legacy key names
//   • `#[serde(default)]` means missing fields deserialize cleanly
//   • Compile errors surface when a consumer references a removed/renamed field
// ============================================================================

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentIr {
    #[serde(default)]
    pub name: Option<String>,

    #[serde(default)]
    pub description: Option<String>,

    /// Primary prompt text. Legacy payloads may use `full_prompt_markdown`.
    #[serde(default, alias = "full_prompt_markdown")]
    pub system_prompt: Option<String>,

    /// Structured prompt sections (identity, instructions, toolGuidance, …).
    /// Kept as `Value` because the inner schema is stable and consumed opaquely.
    #[serde(default)]
    pub structured_prompt: Option<serde_json::Value>,

    #[serde(default)]
    pub icon: Option<String>,

    #[serde(default)]
    pub color: Option<String>,

    /// Tool definitions — may be plain strings (`"notion"`) or full objects.
    #[serde(default, alias = "suggested_tools")]
    pub tools: Vec<AgentIrTool>,

    /// Trigger definitions with type + config.
    #[serde(default, alias = "suggested_triggers")]
    pub triggers: Vec<AgentIrTrigger>,

    /// Connectors the agent requires. Legacy key: `suggested_connectors`.
    #[serde(default, alias = "suggested_connectors")]
    pub required_connectors: Vec<AgentIrConnector>,

    /// Use-case descriptions — may be plain strings or structured objects.
    #[serde(default, alias = "use_case_flows")]
    pub use_cases: Vec<AgentIrUseCase>,

    /// Event subscriptions / publications.
    #[serde(default, alias = "suggested_event_subscriptions")]
    pub events: Vec<AgentIrEvent>,

    /// Messaging config. Legacy key: `suggested_notification_channels`.
    #[serde(default, alias = "suggested_notification_channels")]
    pub messages: Option<serde_json::Value>,

    /// Standalone notification channels (may overlap with messages.channels).
    #[serde(default)]
    pub notification_channels: Option<serde_json::Value>,

    /// High-level design context (summary + use_cases list).
    #[serde(default)]
    pub design_context: Option<AgentIrDesignContext>,

    /// Ordered list of services in the agent's flow.
    #[serde(default)]
    pub service_flow: Vec<serde_json::Value>,

    // -- Less-structured metadata kept as Value --
    #[serde(default)]
    pub connectors: Option<serde_json::Value>,

    #[serde(default)]
    pub triggers_summary: Option<serde_json::Value>,

    #[serde(default)]
    pub human_review: Option<serde_json::Value>,

    #[serde(default)]
    pub memory: Option<serde_json::Value>,

    #[serde(default)]
    pub error_handling: Option<serde_json::Value>,
}

// ---- Sub-types ----

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentIrTrigger {
    #[serde(default)]
    pub trigger_type: Option<String>,
    #[serde(default)]
    pub config: Option<serde_json::Value>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentIrEvent {
    #[serde(default)]
    pub event_type: Option<String>,
    #[serde(default)]
    pub source_filter: Option<String>,
    #[serde(default)]
    pub direction: Option<String>,
}

/// A connector entry in agent IR. May be a plain name (`"gmail"`) or a full object.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AgentIrConnector {
    Simple(String),
    Structured(AgentIrConnectorData),
}

impl Default for AgentIrConnector {
    fn default() -> Self {
        AgentIrConnector::Structured(AgentIrConnectorData::default())
    }
}

impl AgentIrConnector {
    pub fn name(&self) -> Option<&str> {
        match self {
            AgentIrConnector::Simple(s) => Some(s.as_str()),
            AgentIrConnector::Structured(d) => d.name.as_deref(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentIrConnectorData {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub service_type: Option<String>,
    #[serde(default)]
    pub has_credential: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentIrDesignContext {
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub use_cases: Vec<serde_json::Value>,
}

// ---- Tool: string-or-object enum ----

/// A tool entry in agent IR. May be a plain name (`"notion"`) or a full definition object.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AgentIrTool {
    Simple(String),
    Structured(AgentIrToolData),
}

impl AgentIrTool {
    /// Effective tool name regardless of variant.
    pub fn name(&self) -> &str {
        match self {
            AgentIrTool::Simple(s) => s.as_str(),
            AgentIrTool::Structured(d) => d.name.as_deref().unwrap_or(""),
        }
    }

    /// Whether this is a full object definition (not a plain string).
    pub fn is_structured(&self) -> bool {
        matches!(self, AgentIrTool::Structured(_))
    }

    /// Get the structured data, if present.
    pub fn data(&self) -> Option<&AgentIrToolData> {
        match self {
            AgentIrTool::Structured(d) => Some(d),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentIrToolData {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub input_schema: Option<serde_json::Value>,
    #[serde(default)]
    pub parameters: Option<serde_json::Value>,
    #[serde(default)]
    pub output_schema: Option<serde_json::Value>,
    #[serde(default)]
    pub requires_credential_type: Option<String>,
    #[serde(default)]
    pub implementation_guide: Option<String>,
}

// ---- Use case: string-or-object enum ----

/// A use-case entry in agent IR. May be a plain description or a structured object.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AgentIrUseCase {
    Simple(String),
    Structured(AgentIrUseCaseData),
}

impl AgentIrUseCase {
    /// Title for display — the string itself for simple, or the `.title` field.
    pub fn title(&self) -> &str {
        match self {
            AgentIrUseCase::Simple(s) => s.as_str(),
            AgentIrUseCase::Structured(d) => d.title.as_deref().unwrap_or("Use Case"),
        }
    }

    /// Description text.
    pub fn description(&self) -> &str {
        match self {
            AgentIrUseCase::Simple(s) => s.as_str(),
            AgentIrUseCase::Structured(d) => d.description.as_deref().unwrap_or(""),
        }
    }

    /// Category with fallback.
    pub fn category(&self) -> &str {
        match self {
            AgentIrUseCase::Simple(_) => "general",
            AgentIrUseCase::Structured(d) => d.category.as_deref().unwrap_or("general"),
        }
    }

    /// Execution mode with fallback.
    pub fn execution_mode(&self) -> &str {
        match self {
            AgentIrUseCase::Simple(_) => "e2e",
            AgentIrUseCase::Structured(d) => d.execution_mode.as_deref().unwrap_or("e2e"),
        }
    }

    /// Per-use-case event subscriptions (empty for simple variants).
    pub fn event_subscriptions(&self) -> &[AgentIrUseCaseEvent] {
        match self {
            AgentIrUseCase::Simple(_) => &[],
            AgentIrUseCase::Structured(d) => &d.event_subscriptions,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentIrUseCaseData {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub execution_mode: Option<String>,
    /// Per-use-case event subscriptions. Legacy key: `events`.
    #[serde(default, alias = "events")]
    pub event_subscriptions: Vec<AgentIrUseCaseEvent>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentIrUseCaseEvent {
    /// Event type name. Legacy key: `type`.
    #[serde(default, alias = "type")]
    pub event_type: Option<String>,
    #[serde(default)]
    pub source_filter: Option<String>,
}

// ---- Accessor helpers ----

impl AgentIr {
    /// Notification channels from `messages.channels` or top-level `notification_channels`.
    pub fn notification_channel_array(&self) -> Option<&serde_json::Value> {
        self.messages
            .as_ref()
            .and_then(|v| v.get("channels"))
            .filter(|v| v.is_array())
            .or_else(|| {
                self.notification_channels
                    .as_ref()
                    .filter(|v| v.is_array())
            })
    }

    /// Derive connectors from `service_flow` when `required_connectors` is empty.
    pub fn effective_connectors_json(&self) -> serde_json::Value {
        if !self.required_connectors.is_empty() {
            return serde_json::to_value(&self.required_connectors).unwrap_or_default();
        }
        // Fall back to deriving from service_flow
        let derived: Vec<serde_json::Value> = self
            .service_flow
            .iter()
            .filter_map(|s| {
                let name = s.as_str()?;
                if name == "Local Database" || name == "In-App Messaging" {
                    return None;
                }
                let normalized = name.to_lowercase().replace(' ', "_");
                Some(serde_json::json!({
                    "name": normalized,
                    "service_type": normalized,
                }))
            })
            .collect();
        serde_json::Value::Array(derived)
    }

    /// Summary text from `design_context.summary`.
    pub fn design_summary(&self) -> &str {
        self.design_context
            .as_ref()
            .and_then(|dc| dc.summary.as_deref())
            .unwrap_or("")
    }

    /// Serialize back to `serde_json::Value` (for places that still need dynamic JSON).
    pub fn to_value(&self) -> serde_json::Value {
        serde_json::to_value(self).unwrap_or_default()
    }
}
