use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// BuildPhase -- lifecycle state of a build session
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum BuildPhase {
    Initializing,
    Analyzing,
    AwaitingInput,
    Resolving,
    DraftReady,
    Completed,
    Failed,
    Cancelled,
    Testing,
    TestComplete,
    Promoted,
}

impl BuildPhase {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Initializing => "initializing",
            Self::Analyzing => "analyzing",
            Self::AwaitingInput => "awaiting_input",
            Self::Resolving => "resolving",
            Self::DraftReady => "draft_ready",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Testing => "testing",
            Self::TestComplete => "test_complete",
            Self::Promoted => "promoted",
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled | Self::Promoted)
    }

    /// Parse a phase string (as stored in SQLite) back into a `BuildPhase`.
    /// Returns `None` for unknown values instead of silently mapping to `Failed`.
    pub fn from_str_value(s: &str) -> Option<Self> {
        match s {
            "initializing" => Some(Self::Initializing),
            "analyzing" => Some(Self::Analyzing),
            "awaiting_input" => Some(Self::AwaitingInput),
            "resolving" => Some(Self::Resolving),
            "draft_ready" => Some(Self::DraftReady),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            "testing" => Some(Self::Testing),
            "test_complete" => Some(Self::TestComplete),
            "promoted" => Some(Self::Promoted),
            _ => None,
        }
    }

    /// Validate a phase transition. Returns `Ok(())` if the transition is allowed.
    pub fn validate_transition(&self, next: BuildPhase) -> Result<(), String> {
        // Any phase can transition to Failed or Cancelled
        if matches!(next, Self::Failed | Self::Cancelled) {
            return Ok(());
        }

        let allowed = match self {
            Self::Initializing => matches!(next, Self::Analyzing),
            Self::Analyzing => matches!(next, Self::Resolving | Self::AwaitingInput | Self::DraftReady),
            Self::AwaitingInput => matches!(next, Self::Resolving),
            Self::Resolving => matches!(next, Self::AwaitingInput | Self::DraftReady),
            Self::DraftReady => matches!(next, Self::Testing | Self::Resolving | Self::Promoted),
            Self::Testing => matches!(next, Self::TestComplete | Self::DraftReady | Self::Testing),
            Self::TestComplete => matches!(next, Self::Testing | Self::Promoted),
            Self::Completed | Self::Failed | Self::Cancelled | Self::Promoted => false,
        };

        if allowed {
            Ok(())
        } else {
            Err(format!(
                "Invalid phase transition: {} -> {}",
                self.as_str(),
                next.as_str()
            ))
        }
    }
}

// ============================================================================
// BuildEvent -- discriminated union streamed to frontend via Channel
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum BuildEvent {
    CellUpdate {
        session_id: String,
        cell_key: String,
        data: serde_json::Value,
        status: String,
    },
    Question {
        session_id: String,
        cell_key: String,
        question: String,
        options: Option<Vec<String>>,
    },
    Progress {
        session_id: String,
        dimension: Option<String>,
        message: String,
        percent: Option<f32>,
        activity: Option<String>,
    },
    Error {
        session_id: String,
        cell_key: Option<String>,
        message: String,
        retryable: bool,
    },
    SessionStatus {
        session_id: String,
        phase: String,
        resolved_count: usize,
        total_count: usize,
    },
}

// ============================================================================
// BuildSession -- SQLite row representation
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildSession {
    pub id: String,
    pub persona_id: String,
    pub phase: BuildPhase,
    /// JSON-encoded map of resolved cells (stored as TEXT in SQLite).
    pub resolved_cells: String,
    /// JSON-encoded pending question (stored as TEXT in SQLite).
    pub pending_question: Option<String>,
    /// JSON-encoded agent intermediate representation.
    pub agent_ir: Option<String>,
    pub intent: String,
    pub error_message: Option<String>,
    pub cli_pid: Option<u32>,
    /// Original workflow JSON for import mode (null for pure intent mode).
    pub workflow_json: Option<String>,
    /// Pre-parsed AgentIR from frontend parser for import mode.
    pub parser_result_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl BuildSession {
    /// Parse the JSON-encoded `agent_ir` string into a typed `AgentIr` struct.
    /// Returns `None` if the field is absent or unparseable.
    pub fn parse_agent_ir(&self) -> Option<super::agent_ir::AgentIr> {
        self.agent_ir
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
    }
}

// ============================================================================
// UserAnswer -- input from frontend to resume a paused session
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UserAnswer {
    pub cell_key: String,
    pub answer: String,
}

// ============================================================================
// PersistedBuildSession -- frontend-friendly hydration payload
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersistedBuildSession {
    pub id: String,
    pub persona_id: String,
    pub phase: BuildPhase,
    pub resolved_cells: serde_json::Value,
    pub pending_question: Option<serde_json::Value>,
    pub agent_ir: Option<serde_json::Value>,
    pub intent: String,
    pub error_message: Option<String>,
    pub created_at: String,
}

impl PersistedBuildSession {
    /// Convert a raw `BuildSession` (with JSON strings) into a frontend-friendly
    /// `PersistedBuildSession` (with parsed `serde_json::Value` fields).
    pub fn from_session(s: &BuildSession) -> Self {
        Self {
            id: s.id.clone(),
            persona_id: s.persona_id.clone(),
            phase: s.phase,
            resolved_cells: serde_json::from_str(&s.resolved_cells).unwrap_or_default(),
            pending_question: s
                .pending_question
                .as_deref()
                .and_then(|q| serde_json::from_str(q).ok()),
            agent_ir: s
                .agent_ir
                .as_deref()
                .and_then(|ir| serde_json::from_str(ir).ok()),
            intent: s.intent.clone(),
            error_message: s.error_message.clone(),
            created_at: s.created_at.clone(),
        }
    }
}

// ============================================================================
// UpdateBuildSession -- partial update payload for repo::update
// ============================================================================

#[derive(Debug, Clone, Default)]
pub struct UpdateBuildSession {
    pub phase: Option<String>,
    pub resolved_cells: Option<String>,
    pub pending_question: Option<Option<String>>,
    pub agent_ir: Option<Option<String>>,
    pub error_message: Option<Option<String>>,
    pub cli_pid: Option<Option<u32>>,
}
