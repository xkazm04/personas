use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::{Persona, PersonaToolDefinition, PersonaTrustLevel, PersonaTrustOrigin};

// =============================================================================
// ExecutionState -- canonical state machine for execution status
// =============================================================================

crate::declare_lifecycle! {
    /// Canonical execution state machine.
    ///
    /// Valid transitions:
    ///   Queued   -> Running | Failed | Cancelled
    ///   Running  -> Completed | Failed | Incomplete | Cancelled
    ///
    /// This is the single source of truth for execution status. The DB column
    /// stores the lowercase string form, the frontend `isExecuting` boolean is
    /// derived from `is_active()`, and event payloads carry this enum serialized.
    ///
    /// The TS binding is exported via ts_rs and consumed by the frontend
    /// `executionState.ts` module. **Do not add variants here without updating
    /// the `TERMINAL` / `ACTIVE` slices and the compile-time assertion test.**
    pub enum ExecutionState, entity = "execution" {
        Queued("queued")         => [Running, Failed, Cancelled],
        Running("running")       => [Completed, Failed, Incomplete, Cancelled],
        Completed("completed")   => [],
        Failed("failed")         => [],
        Incomplete("incomplete") => [],
        Cancelled("cancelled")   => [],
    }
    aliases {
        // Backwards-compat: some old DB rows might have "pending"
        "pending" => Queued,
    }
}

#[allow(dead_code)]
impl ExecutionState {
    /// All terminal states (execution is done, no further transitions).
    pub const TERMINAL: &'static [ExecutionState] = &[
        ExecutionState::Completed,
        ExecutionState::Failed,
        ExecutionState::Incomplete,
        ExecutionState::Cancelled,
    ];

    /// All active states (execution is in progress).
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
        /// Per-item decisions for batch reviews (e.g. multiple stock signals)
        decisions: Option<Vec<serde_json::Value>>,
    },
    ExecutionFlow {
        flows: serde_json::Value,
    },
    KnowledgeAnnotation {
        scope: String,
        note: String,
        confidence: Option<f64>,
    },
}

// =============================================================================
// Continuation -- unified resume mechanism
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
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
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
#[derive(Debug, Clone, Default)]
#[allow(dead_code)] // Fields populated by runner, consumed by later phases
pub struct ExecutionResult {
    pub success: bool,
    pub output: Option<String>,
    pub error: Option<String>,
    pub session_limit_reached: bool,
    pub log_file_path: Option<String>,
    pub claude_session_id: Option<String>,
    pub duration_ms: u64,
    pub execution_flows: Option<crate::db::models::Json<serde_json::Value>>,
    pub model_used: Option<String>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
    pub tool_steps: Option<crate::db::models::Json<Vec<ToolCallStep>>>,
    /// Trace ID for this execution (used for chain trace propagation).
    pub trace_id: Option<String>,
    /// Frozen config snapshot assembled at the validate stage.
    pub execution_config: Option<String>,
    /// `true` when the execution logger encountered I/O errors, meaning the
    /// log file may be incomplete / truncated.
    pub log_truncated: bool,
}

// =============================================================================
// ExecutionConfig -- immutable config snapshot assembled once per execution
// =============================================================================

/// Immutable execution configuration assembled once at the validate stage from
/// all config sources (persona fields, workspace defaults, global settings,
/// model profile, credential hints). Passed as a frozen reference through the
/// entire pipeline and persisted alongside results for post-mortem debugging.
///
/// Sensitive fields (auth tokens, credential values) are intentionally excluded;
/// only the resolved *shape* of the config is captured.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionConfig {
    /// Resolved model profile (after persona → workspace → global cascade).
    /// Auth tokens are redacted before storage.
    pub model_profile: Option<RedactedModelProfile>,
    /// CLI engine used for this execution (e.g. "claude_code", "codex_cli").
    pub engine: String,
    /// Resolved max budget in USD (from persona → workspace cascade).
    pub max_budget_usd: Option<f64>,
    /// Resolved max turns (from persona → workspace cascade).
    pub max_turns: Option<i32>,
    /// Execution timeout in milliseconds.
    pub timeout_ms: i32,
    /// Whether workspace shared instructions were injected.
    pub has_workspace_instructions: bool,
    /// Workspace (group) ID, if any.
    pub workspace_id: Option<String>,
    /// Names of tools available to the execution.
    pub tool_names: Vec<String>,
    /// Credential connector names that were resolved (no secret values).
    pub credential_connectors: Vec<String>,
    /// BYOM routing rule that was applied, if any.
    pub routing_rule: Option<String>,
    /// BYOM compliance rule that was applied, if any.
    pub compliance_rule: Option<String>,
    /// Continuation mode used ("none", "prompt_hint", "session_resume").
    pub continuation_mode: String,
    /// Timestamp when this config was assembled.
    pub assembled_at: String,
}

/// Model profile with auth tokens redacted for safe persistence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedactedModelProfile {
    pub model: Option<String>,
    pub provider: Option<String>,
    pub base_url: Option<String>,
    pub prompt_cache_policy: Option<String>,
}

impl RedactedModelProfile {
    pub fn from_profile(profile: &ModelProfile) -> Self {
        Self {
            model: profile.model.clone(),
            provider: profile.provider.clone(),
            base_url: profile.base_url.clone(),
            prompt_cache_policy: profile.prompt_cache_policy.clone(),
        }
    }
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
    /// Prompt caching policy: "none", "short" (5 min), or "long" (1 hr).
    /// Controls Anthropic prompt caching for system prompt reuse across executions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_cache_policy: Option<String>,
}

/// Well-known provider identifiers used in ModelProfile.provider.
pub mod providers {
    pub const OLLAMA: &str = "ollama";
    pub const LITELLM: &str = "litellm";
    pub const CUSTOM: &str = "custom";
}

// =============================================================================
// EphemeralPersona -- virtual persona that never touches the database
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
            .map_err(|e| format!("Invalid draft JSON: {e}"))?;

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
            sensitive: false,
            headless: false,
            max_concurrent: 1,
            timeout_ms: 30_000,
            notification_channels: None,
            last_design_result: None,
            model_profile: draft.model_profile,
            max_budget_usd: draft.max_budget_usd,
            max_turns: Some(1),
            design_context: draft.design_context,
            group_id: None,
            source_review_id: None,
            trust_level: PersonaTrustLevel::Verified,
            trust_origin: PersonaTrustOrigin::Builtin,
            trust_verified_at: None,
            trust_score: 1.0,
            parameters: None,
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
    /// Total executions running globally across all personas
    pub global_running: usize,
    /// Global maximum concurrent execution limit
    pub global_capacity: usize,
}

/// Heartbeat event emitted during stream silence so frontend can detect stuck executions.
#[derive(Debug, Clone, Serialize)]
pub struct HeartbeatEvent {
    pub execution_id: String,
    /// Total milliseconds since execution started.
    pub elapsed_ms: u64,
    /// Milliseconds since last stdout line was received.
    pub silence_ms: u64,
}

/// Structured execution event emitted on the `execution-event` channel.
/// Provides typed, discriminated events for frontend consumption alongside
/// the raw `execution-output` display string channel.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StructuredExecutionEvent {
    Text {
        execution_id: String,
        content: String,
    },
    ToolUse {
        execution_id: String,
        tool_name: String,
        input_preview: String,
    },
    ToolResult {
        execution_id: String,
        content_preview: String,
    },
    SystemInit {
        execution_id: String,
        model: String,
        session_id: Option<String>,
    },
    #[serde(rename = "result")]
    ExecutionResult {
        execution_id: String,
        duration_ms: Option<u64>,
        cost_usd: Option<f64>,
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
        model: Option<String>,
        session_id: Option<String>,
    },
    FileChange {
        execution_id: String,
        path: String,
        change_type: String,
    },
    Heartbeat {
        execution_id: String,
        elapsed_ms: u64,
        silence_ms: u64,
    },
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

/// Emitted when a healing issue transitions status (auto-fix confirmed/reverted).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealingIssueUpdatedEvent {
    pub issue_id: String,
    pub persona_id: String,
    pub execution_id: Option<String>,
    /// New status after transition: "resolved" or "open"
    pub new_status: String,
    /// What triggered the transition: "auto_fix_confirmed" | "auto_fix_reverted"
    pub transition: String,
}

/// AI healing output line emitted to frontend (streamed per line).
#[derive(Debug, Clone, Serialize)]
#[allow(dead_code)] // Type documents the event shape; events emitted via json!()
pub struct AiHealingOutputEvent {
    pub execution_id: String,
    pub persona_id: String,
    pub line: String,
}

/// AI healing status change emitted to frontend.
#[derive(Debug, Clone, Serialize)]
#[allow(dead_code)] // Type documents the event shape; events emitted via json!()
pub struct AiHealingStatusEvent {
    pub execution_id: String,
    pub persona_id: String,
    /// "started" | "diagnosing" | "applying" | "completed" | "failed"
    pub phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnosis: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fixes_applied: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub should_retry: Option<bool>,
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Compile-time assertion: TERMINAL + ACTIVE must cover every ExecutionState variant.
    ///
    /// If you add a new variant to ExecutionState, this test will fail until you
    /// classify it as either TERMINAL or ACTIVE.
    #[test]
    fn terminal_plus_active_covers_all_variants() {
        for state in ExecutionState::ALL_VARIANTS {
            assert!(
                ExecutionState::TERMINAL.contains(state) || ExecutionState::ACTIVE.contains(state),
                "ExecutionState::{state:?} is neither TERMINAL nor ACTIVE — classify it",
            );
        }
    }

    /// Ensure TERMINAL and ACTIVE are mutually exclusive.
    #[test]
    fn terminal_and_active_are_disjoint() {
        for state in ExecutionState::TERMINAL {
            assert!(
                !ExecutionState::ACTIVE.contains(state),
                "ExecutionState::{state:?} is in both TERMINAL and ACTIVE",
            );
        }
    }

    /// Verify the exact terminal set so TS/Rust stay in sync.
    /// If a new terminal variant is added, update this test AND
    /// `TERMINAL_STATES` in `src/lib/execution/executionState.ts`.
    #[test]
    fn terminal_set_matches_expected() {
        let expected: Vec<&str> = vec!["completed", "failed", "incomplete", "cancelled"];
        let actual: Vec<&str> = ExecutionState::TERMINAL.iter().map(|s| s.as_str()).collect();
        assert_eq!(actual, expected, "TERMINAL set changed — update the TS TERMINAL_STATES constant");
    }

    /// Verify the exact active set.
    #[test]
    fn active_set_matches_expected() {
        let expected: Vec<&str> = vec!["queued", "running"];
        let actual: Vec<&str> = ExecutionState::ACTIVE.iter().map(|s| s.as_str()).collect();
        assert_eq!(actual, expected, "ACTIVE set changed — update the TS ACTIVE_STATES constant");
    }
}
