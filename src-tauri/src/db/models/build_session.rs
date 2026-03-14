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
    pub fn from_str_value(s: &str) -> Self {
        match s {
            "initializing" => Self::Initializing,
            "analyzing" => Self::Analyzing,
            "awaiting_input" => Self::AwaitingInput,
            "resolving" => Self::Resolving,
            "draft_ready" => Self::DraftReady,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            "testing" => Self::Testing,
            "test_complete" => Self::TestComplete,
            "promoted" => Self::Promoted,
            _ => Self::Failed, // unknown phases treated as failed
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
    pub created_at: String,
    pub updated_at: String,
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
