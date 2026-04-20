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

    /// v3.1 — Declarative assertions evaluated post-execution against the
    /// LLM output (see `output_assertions.rs`). Populated by the v3
    /// normalizer's `hoist_output_assertions` pass from `persona.output_assertions[]`
    /// + `use_cases[i].output_assertions[]`. Consumed at promote time to
    /// insert rows into the `output_assertions` table.
    #[serde(default, alias = "suggested_output_assertions")]
    pub output_assertions: Vec<serde_json::Value>,
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
    /// Phase C2 — semantic linkage to the capability this trigger fires.
    /// v2 templates and v2 CLI output populate this. Promote path prefers it
    /// over positional `triggers[i]` ↔ `use_cases[i]` matching.
    /// See `docs/concepts/persona-capabilities/06-building-pipeline.md`.
    #[serde(default)]
    pub use_case_id: Option<String>,
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

    /// Per-use-case error-handling recipe. Empty string for simple variants
    /// and structured UCs without the field — callers can skip rendering.
    pub fn error_handling(&self) -> &str {
        match self {
            AgentIrUseCase::Simple(_) => "",
            AgentIrUseCase::Structured(d) => d.error_handling.as_deref().unwrap_or(""),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentIrUseCaseData {
    /// Stable capability id (v2 convention: `uc_<slug>`). When absent, the
    /// promote path generates a UUID-suffixed id. Carries through to
    /// `design_context.useCases[].id` and to every linked trigger/subscription.
    #[serde(default)]
    pub id: Option<String>,
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

    // ---- Phase C2 additions (v2 capability envelope). All additive. ----

    /// One-line summary rendered in the Active Capabilities prompt section.
    /// Falls back to `description` when absent. Mirrors `DesignUseCase`.
    #[serde(default)]
    pub capability_summary: Option<String>,

    /// Runtime toggle. Absent = enabled. Set to Some(false) to disable
    /// without rebuilding the persona.
    #[serde(default)]
    pub enabled: Option<bool>,

    /// Per-capability notification channels. Shape matches the top-level
    /// `notification_channels` — kept as Value for forward compatibility.
    #[serde(default)]
    pub notification_channels: Option<serde_json::Value>,

    /// Per-capability model profile override. When set, the runtime uses
    /// this profile instead of the persona default for this capability.
    #[serde(default)]
    pub model_override: Option<serde_json::Value>,

    /// Named test fixtures for simulation (canned inputs).
    #[serde(default)]
    pub test_fixtures: Option<serde_json::Value>,

    /// Tool names the LLM should prefer when this capability is in focus.
    /// Advisory — all persona tools remain available at runtime.
    #[serde(default)]
    pub tool_hints: Option<Vec<String>>,

    /// Structured input schema (typed fields the trigger delivers).
    #[serde(default)]
    pub input_schema: Option<serde_json::Value>,

    /// Canonical example payload for simulation and documentation.
    #[serde(default)]
    pub sample_input: Option<serde_json::Value>,

    /// Authoring-time trigger hint — mirrors what the corresponding entry in
    /// `AgentIr.triggers[]` will contain once promoted. Lets template authors
    /// keep trigger intent next to the capability that owns it.
    #[serde(default)]
    pub suggested_trigger: Option<serde_json::Value>,

    /// Workflow diagram carried over from v1 `use_case_flows[i]` (nodes +
    /// edges). Documentation-only; runtime does not read it.
    #[serde(default)]
    pub use_case_flow: Option<serde_json::Value>,

    /// v3.1 — Per-capability error-handling recipe. When present, gets a
    /// subsection inside each UC's bullet in the Active Capabilities prompt
    /// block so the LLM sees failure-mode guidance next to the capability it
    /// applies to. Persona-wide `error_handling` stays as the baseline;
    /// per-UC strings extend it, never replace it.
    #[serde(default)]
    pub error_handling: Option<String>,
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

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// C2 — a v1-shaped IR (no v2 fields present) still parses and the new
    /// fields come back as `None` / empty. This is the backward-compat guarantee
    /// for pre-migration templates that haven't been rewritten yet.
    #[test]
    fn v1_shape_parses_into_v2_struct_with_none_extras() {
        let v1 = serde_json::json!({
            "name": "Legacy",
            "triggers": [
                { "trigger_type": "schedule", "config": { "cron": "0 * * * *" } }
            ],
            "use_cases": [
                { "title": "Old Use Case", "description": "legacy" }
            ]
        });
        let ir: AgentIr = serde_json::from_value(v1).expect("v1 still parses");
        assert_eq!(ir.name.as_deref(), Some("Legacy"));
        assert_eq!(ir.triggers.len(), 1);
        assert!(ir.triggers[0].use_case_id.is_none(), "v1 trigger has no use_case_id");

        match &ir.use_cases[0] {
            AgentIrUseCase::Structured(d) => {
                assert!(d.id.is_none());
                assert!(d.capability_summary.is_none());
                assert!(d.enabled.is_none());
                assert!(d.tool_hints.is_none());
            }
            AgentIrUseCase::Simple(_) => panic!("expected structured variant"),
        }
    }

    /// C2 — v2 fields round-trip through serde with stable shape. Lock the
    /// contract that the promote path depends on (semantic use_case_id
    /// linkage, per-capability metadata).
    #[test]
    fn v2_fields_round_trip() {
        let v2 = serde_json::json!({
            "name": "Stock Analyst",
            "triggers": [
                {
                    "trigger_type": "schedule",
                    "config": { "cron": "0 8 * * 1" },
                    "description": "Mondays 08:00",
                    "use_case_id": "uc_gem"
                }
            ],
            "use_cases": [
                {
                    "id": "uc_gem",
                    "title": "Weekly Gem Finder",
                    "description": "scans for gems",
                    "capability_summary": "weekly sector screen",
                    "enabled": true,
                    "tool_hints": ["http_request", "slack_post"],
                    "notification_channels": [{ "type": "slack" }],
                    "model_override": { "model": "claude-haiku-4-5" },
                    "sample_input": { "sector": "semiconductors" },
                    "input_schema": [{ "name": "sector", "type": "string" }],
                    "suggested_trigger": { "type": "schedule", "description": "Mondays 08:00" },
                    "use_case_flow": { "nodes": [], "edges": [] }
                }
            ]
        });
        let ir: AgentIr = serde_json::from_value(v2.clone()).expect("v2 parses");

        assert_eq!(
            ir.triggers[0].use_case_id.as_deref(),
            Some("uc_gem"),
            "semantic linkage preserved"
        );

        let data = match &ir.use_cases[0] {
            AgentIrUseCase::Structured(d) => d,
            AgentIrUseCase::Simple(_) => panic!("expected structured"),
        };
        assert_eq!(data.id.as_deref(), Some("uc_gem"));
        assert_eq!(data.capability_summary.as_deref(), Some("weekly sector screen"));
        assert_eq!(data.enabled, Some(true));
        assert_eq!(
            data.tool_hints.as_deref(),
            Some(&["http_request".to_string(), "slack_post".to_string()][..])
        );
        assert!(data.notification_channels.is_some());
        assert!(data.model_override.is_some());
        assert!(data.sample_input.is_some());
        assert!(data.input_schema.is_some());
        assert!(data.suggested_trigger.is_some());
        assert!(data.use_case_flow.is_some());

        // Serialize back and reparse — the structure must survive a round trip.
        let reparsed: AgentIr = serde_json::from_value(ir.to_value()).expect("round trip");
        assert_eq!(
            reparsed.triggers[0].use_case_id.as_deref(),
            Some("uc_gem"),
            "use_case_id survives round-trip"
        );
    }

    /// C2 — `enabled: false` is the explicit disable marker; `None` (missing)
    /// and `Some(true)` both count as active. Mirrors the runtime filter in
    /// `engine::prompt::render_active_capabilities`.
    #[test]
    fn enabled_tri_state_round_trips() {
        let cases = [
            serde_json::json!({ "id": "a", "title": "A" }),
            serde_json::json!({ "id": "b", "title": "B", "enabled": true }),
            serde_json::json!({ "id": "c", "title": "C", "enabled": false }),
        ];
        let expected = [None, Some(true), Some(false)];
        for (uc, want) in cases.into_iter().zip(expected) {
            let data: AgentIrUseCaseData =
                serde_json::from_value(uc).expect("case parses");
            assert_eq!(data.enabled, want);
        }
    }
}
