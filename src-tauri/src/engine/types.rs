use serde::{Deserialize, Serialize};

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

/// Event payload emitted to frontend
#[derive(Debug, Clone, Serialize)]
pub struct ExecutionOutputEvent {
    pub execution_id: String,
    pub line: String,
}

/// Status event payload emitted to frontend
#[derive(Debug, Clone, Serialize)]
pub struct ExecutionStatusEvent {
    pub execution_id: String,
    pub status: String,
    pub error: Option<String>,
    pub duration_ms: Option<u64>,
    pub cost_usd: Option<f64>,
}

/// Healing event emitted to frontend after post-execution analysis
#[derive(Debug, Clone, Serialize)]
pub struct HealingEventPayload {
    pub issue_id: String,
    pub persona_id: String,
    pub execution_id: String,
    pub title: String,
    /// "auto_retry" | "issue_created"
    pub action: String,
    pub auto_fixed: bool,
}
