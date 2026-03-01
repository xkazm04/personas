use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::db::models::{Persona, PersonaToolDefinition};

// =============================================================================
// ExecutionState — canonical state machine for execution status
// =============================================================================

/// Canonical execution state machine.
///
/// Valid transitions:
///   Queued -> Running
///   Running -> Completed | Failed | Incomplete | Cancelled
///
/// This is the single source of truth for execution status. The DB column
/// stores the lowercase string form, the frontend `isExecuting` boolean is
/// derived from `is_active()`, and event payloads carry this enum serialized.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionState {
    Queued,
    Running,
    Completed,
    Failed,
    Incomplete,
    Cancelled,
}

impl ExecutionState {
    /// All terminal states (execution is done, no further transitions).
    #[allow(dead_code)]
    pub const TERMINAL: &'static [ExecutionState] = &[
        ExecutionState::Completed,
        ExecutionState::Failed,
        ExecutionState::Incomplete,
        ExecutionState::Cancelled,
    ];

    /// All active states (execution is in progress).
    #[allow(dead_code)]
    pub const ACTIVE: &'static [ExecutionState] = &[
        ExecutionState::Queued,
        ExecutionState::Running,
    ];

    /// Returns true if the execution is still active (not in a terminal state).
    pub fn is_active(&self) -> bool {
        matches!(self, ExecutionState::Queued | ExecutionState::Running)
    }

    /// Returns true if the execution has reached a terminal state.
    pub fn is_terminal(&self) -> bool {
        !self.is_active()
    }

    /// Check whether transitioning from `self` to `target` is valid.
    #[allow(dead_code)]
    pub fn can_transition_to(&self, target: ExecutionState) -> bool {
        matches!(
            (self, target),
            (ExecutionState::Queued, ExecutionState::Running)
                | (ExecutionState::Running, ExecutionState::Completed)
                | (ExecutionState::Running, ExecutionState::Failed)
                | (ExecutionState::Running, ExecutionState::Incomplete)
                | (ExecutionState::Running, ExecutionState::Cancelled)
                // Recovery transitions: allow terminal -> cancelled for edge cases
                // and queued -> failed for stale execution recovery
                | (ExecutionState::Queued, ExecutionState::Failed)
                | (ExecutionState::Queued, ExecutionState::Cancelled)
        )
    }

    /// Returns the DB string representation (lowercase).
    pub fn as_str(&self) -> &'static str {
        match self {
            ExecutionState::Queued => "queued",
            ExecutionState::Running => "running",
            ExecutionState::Completed => "completed",
            ExecutionState::Failed => "failed",
            ExecutionState::Incomplete => "incomplete",
            ExecutionState::Cancelled => "cancelled",
        }
    }
}

impl fmt::Display for ExecutionState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for ExecutionState {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "queued" => Ok(ExecutionState::Queued),
            "running" => Ok(ExecutionState::Running),
            "completed" => Ok(ExecutionState::Completed),
            "failed" => Ok(ExecutionState::Failed),
            "incomplete" => Ok(ExecutionState::Incomplete),
            "cancelled" => Ok(ExecutionState::Cancelled),
            // Backwards-compat: some old DB rows might have "pending"
            "pending" => Ok(ExecutionState::Queued),
            other => Err(format!("Unknown execution state: '{}'", other)),
        }
    }
}

/// Classified stream-json line from Claude CLI stdout
#[derive(Debug, Clone, PartialEq)]
pub enum StreamLineType {
    SystemInit {
        model: String,
        session_id: Option<String>,
    },
    AssistantText {
        text: String,
    },
    AssistantToolUse {
        tool_name: String,
        input_preview: String,
    },
    ToolResult {
        content_preview: String,
    },
    Result {
        duration_ms: Option<u64>,
        total_cost_usd: Option<f64>,
        total_input_tokens: Option<u64>,
        total_output_tokens: Option<u64>,
        model: Option<String>,
        session_id: Option<String>,
    },
    Unknown,
}

/// Protocol messages the AI embeds in assistant text
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ProtocolMessage {
    UserMessage {
        title: Option<String>,
        content: String,
        content_type: Option<String>,
        priority: Option<String>,
    },
    PersonaAction {
        target: String,
        action: Option<String>,
        input: Option<serde_json::Value>,
    },
    EmitEvent {
        event_type: String,
        data: Option<serde_json::Value>,
    },
    AgentMemory {
        title: String,
        content: String,
        category: Option<String>,
        importance: Option<i32>,
        tags: Option<Vec<String>>,
    },
    ManualReview {
        title: String,
        description: Option<String>,
        severity: Option<String>,
        context_data: Option<String>,
        suggested_actions: Option<Vec<String>>,
    },
    ExecutionFlow {
        flows: serde_json::Value,
    },
}

// =============================================================================
// Continuation — unified resume mechanism
// =============================================================================

/// How to continue a previous execution.
///
/// Unifies two independent resume strategies into a single first-class type:
/// - `PromptHint`: injects a contextual hint into the input data so the LLM
///   knows it should continue from where a previous execution left off.
/// - `SessionResume`: uses Claude CLI `--resume <session_id>` to natively
///   continue a prior conversation, preserving full context.
///
/// The frontend decides which variant to use based on whether a
/// `claude_session_id` is available from the previous execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum Continuation {
    /// Soft continuation: injects a resume hint into the prompt input data.
    PromptHint(String),
    /// Hard continuation: resumes a prior Claude CLI session by ID.
    SessionResume(String),
}

/// CLI spawn arguments
#[derive(Debug, Clone)]
#[allow(dead_code)] // Fields used by runner
pub struct CliArgs {
    pub command: String,
    pub args: Vec<String>,
    pub env_overrides: Vec<(String, String)>,
    pub env_removals: Vec<String>,
    pub cwd: Option<std::path::PathBuf>,
}

/// Individual tool call step captured during execution for the inspector
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallStep {
    pub step_index: u32,
    pub tool_name: String,
    pub input_preview: String,
    pub output_preview: String,
    pub started_at_ms: u64,
    pub ended_at_ms: Option<u64>,
    pub duration_ms: Option<u64>,
}

/// Execution result
#[derive(Debug, Clone)]
#[allow(dead_code)] // Fields populated by runner, consumed by later phases
pub struct ExecutionResult {
    pub success: bool,
    pub output: Option<String>,
    pub error: Option<String>,
    pub session_limit_reached: bool,
    pub log_file_path: Option<String>,
    pub claude_session_id: Option<String>,
    pub duration_ms: u64,
    pub execution_flows: Option<String>,
    pub model_used: Option<String>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
    pub tool_steps: Option<String>,
    /// Trace ID for this execution (used for chain trace propagation).
    pub trace_id: Option<String>,
}

/// Accumulated execution metrics
#[derive(Debug, Clone, Default)]
pub struct ExecutionMetrics {
    pub model_used: Option<String>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
    pub session_id: Option<String>,
}

/// Parsed model profile from persona.model_profile JSON
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct ModelProfile {
    pub model: Option<String>,
    pub provider: Option<String>,
    pub base_url: Option<String>,
    pub auth_token: Option<String>,
}

/// Well-known provider identifiers used in ModelProfile.provider.
pub mod providers {
    pub const OLLAMA: &str = "ollama";
    pub const LITELLM: &str = "litellm";
    pub const CUSTOM: &str = "custom";
}

// =============================================================================
// EphemeralPersona — virtual persona that never touches the database
// =============================================================================

/// A virtual persona + tools bundle that exists only in memory.
///
/// Used for draft validation, sandbox testing, and preview-before-save flows
/// where a fully-formed persona config is needed without DB persistence.
#[derive(Debug, Clone)]
pub struct EphemeralPersona {
    pub persona: Persona,
    pub tools: Vec<PersonaToolDefinition>,
    #[allow(dead_code)]
    pub model_override: Option<ModelProfile>,
}

impl EphemeralPersona {
    /// Create an EphemeralPersona from a DB-persisted persona and its tools.
    pub fn from_persisted(
        persona: Persona,
        tools: Vec<PersonaToolDefinition>,
    ) -> Self {
        Self {
            persona,
            tools,
            model_override: None,
        }
    }

    /// Create an EphemeralPersona from a DB-persisted persona, tools, and a model override.
    #[allow(dead_code)]
    pub fn from_persisted_with_model(
        persona: Persona,
        tools: Vec<PersonaToolDefinition>,
        model_override: ModelProfile,
    ) -> Self {
        Self {
            persona,
            tools,
            model_override: Some(model_override),
        }
    }

    /// Build from draft JSON (used by n8n draft validation and test commands).
    pub fn from_draft_json(draft_json: &str) -> Result<Self, String> {
        #[derive(Deserialize)]
        struct DraftToolInput {
            name: String,
            category: String,
            description: String,
            script_path: Option<String>,
            input_schema: Option<serde_json::Value>,
            requires_credential_type: Option<String>,
            implementation_guide: Option<String>,
        }

        #[derive(Deserialize)]
        struct DraftInput {
            name: Option<String>,
            system_prompt: String,
            structured_prompt: Option<serde_json::Value>,
            description: Option<String>,
            model_profile: Option<String>,
            max_budget_usd: Option<f64>,
            design_context: Option<String>,
            tools: Option<Vec<DraftToolInput>>,
        }

        let draft: DraftInput = serde_json::from_str(draft_json)
            .map_err(|e| format!("Invalid draft JSON: {}", e))?;

        let now = chrono::Utc::now().to_rfc3339();
        let persona = Persona {
            id: format!("draft-validate-{}", uuid::Uuid::new_v4()),
            project_id: "default".to_string(),
            name: draft.name.unwrap_or_else(|| "Draft Validation".to_string()),
            description: draft.description,
            system_prompt: draft.system_prompt,
            structured_prompt: draft.structured_prompt.map(|v| v.to_string()),
            icon: None,
            color: None,
            enabled: false,
            max_concurrent: 1,
            timeout_ms: 30_000,
            notification_channels: None,
            last_design_result: None,
            model_profile: draft.model_profile,
            max_budget_usd: draft.max_budget_usd,
            max_turns: Some(1),
            design_context: draft.design_context,
            group_id: None,
            created_at: now.clone(),
            updated_at: now,
        };

        let tools: Vec<PersonaToolDefinition> = draft
            .tools
            .unwrap_or_default()
            .into_iter()
            .map(|t| {
                let tool_now = chrono::Utc::now().to_rfc3339();
                PersonaToolDefinition {
                    id: format!("draft-tool-{}", uuid::Uuid::new_v4()),
                    name: t.name,
                    category: t.category,
                    description: t.description,
                    script_path: t.script_path.unwrap_or_default(),
                    input_schema: t.input_schema.map(|v| v.to_string()),
                    output_schema: None,
                    requires_credential_type: t.requires_credential_type,
                    implementation_guide: t.implementation_guide,
                    is_builtin: false,
                    created_at: tool_now.clone(),
                    updated_at: tool_now,
                }
            })
            .collect();

        Ok(Self {
            persona,
            tools,
            model_override: None,
        })
    }
}

/// Event payload emitted to frontend
#[derive(Debug, Clone, Serialize)]
pub struct ExecutionOutputEvent {
    pub execution_id: String,
    pub line: String,
}

/// Status event payload emitted to frontend.
/// The `status` field serializes as a lowercase string (e.g. "completed").
#[derive(Debug, Clone, Serialize)]
pub struct ExecutionStatusEvent {
    pub execution_id: String,
    pub status: ExecutionState,
    pub error: Option<String>,
    pub duration_ms: Option<u64>,
    pub cost_usd: Option<f64>,
}

/// Queue status event emitted to frontend when an execution is queued or promoted.
#[derive(Debug, Clone, Serialize)]
pub struct QueueStatusEvent {
    pub execution_id: String,
    pub persona_id: String,
    /// "queued" | "promoted" | "queue_full"
    pub action: String,
    /// 0-indexed position in the queue (only for "queued" action)
    pub position: Option<usize>,
    /// Total queue depth for this persona
    pub queue_depth: usize,
}

/// Healing event emitted to frontend after post-execution analysis
#[derive(Debug, Clone, Serialize)]
pub struct HealingEventPayload {
    pub issue_id: String,
    pub persona_id: String,
    pub execution_id: String,
    pub title: String,
    /// "auto_retry" | "issue_created" | "circuit_breaker"
    pub action: String,
    pub auto_fixed: bool,
    /// "low" | "medium" | "high" | "critical"
    pub severity: String,
    pub suggested_fix: Option<String>,
    pub persona_name: String,
    /// Human-readable description of the diagnosed failure.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Strategy label, e.g. "Exponential backoff", "Increased timeout".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strategy: Option<String>,
    /// Seconds until the retry fires (0 if not a retry).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backoff_seconds: Option<u64>,
    /// Current retry attempt number (1-based).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_number: Option<i64>,
    /// Maximum retry attempts allowed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_retries: Option<i64>,
}
