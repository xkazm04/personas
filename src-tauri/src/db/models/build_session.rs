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
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Cancelled | Self::Promoted
        )
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
            Self::Analyzing => matches!(
                next,
                Self::Resolving | Self::AwaitingInput | Self::DraftReady
            ),
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
        /// Set only when the question was mirrored from a v3
        /// clarifying_question with scope=connector_category. Carries the
        /// machine-token category the vault picker should filter by.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        connector_category: Option<String>,
        /// C7 — true when the v3 question carried `accepts_reference: true`,
        /// meaning the answering UI should expose the file/URL attachment
        /// affordance and the answer payload may carry a `reference`.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        accepts_reference: bool,
        /// C7 — true when the v3 question carried
        /// `accepts_webhook_source: true`, meaning the answering UI should
        /// expose a smee.io URL input. Used when the LLM picks the
        /// `webhook` trigger type for a capability.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        accepts_webhook_source: bool,
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

    // ------------------------------------------------------------------
    // v3 capability-framework events (additive; coexist with legacy events)
    //
    // The CLI's three-phase protocol (behavior_core → capability_enumeration →
    // per-capability resolution) streams these event types. The run_session
    // parser ALSO mirrors each v3 event into a legacy CellUpdate so the
    // existing 3×3 matrix UI keeps rendering during the migration window
    // (§3.8 + §4.5 of C4-build-from-scratch-v3-handoff.md).
    // ------------------------------------------------------------------
    /// Phase A output: persona behavior core (mission + identity + voice +
    /// principles + constraints + decision_principles + verbosity_default).
    BehaviorCoreUpdate {
        session_id: String,
        data: serde_json::Value,
        status: String,
    },

    /// Phase B output: list of capability drafts (id + title + summary + goal).
    /// Emitted ONCE before per-capability resolution begins. Further drafts
    /// from "+ Add" flows are delivered as additional events with the same
    /// type; the frontend appends/dedupes by capability id.
    CapabilityEnumerationUpdate {
        session_id: String,
        data: serde_json::Value,
        status: String,
    },

    /// Phase C output: one field resolution on one capability.
    /// `field` is one of: suggested_trigger, connectors, notification_channels,
    /// review_policy, memory_policy, event_subscriptions, input_schema,
    /// sample_input, tool_hints, use_case_flow, error_handling.
    CapabilityResolutionUpdate {
        session_id: String,
        capability_id: String,
        field: String,
        value: serde_json::Value,
        status: String,
    },

    /// Persona-wide resolution: tools / connectors / notification_channels_default /
    /// operating_instructions / tool_guidance / error_handling / core_memories.
    PersonaResolutionUpdate {
        session_id: String,
        field: String,
        value: serde_json::Value,
        status: String,
    },

    /// v3 clarifying question — scoped to mission, a capability, or a specific
    /// field within a capability. Replaces legacy per-dimension `Question`
    /// when the CLI is emitting v3 events.
    ClarifyingQuestionV3 {
        session_id: String,
        /// One of: "mission" | "capability" | "field" | "connector_category"
        scope: String,
        capability_id: Option<String>,
        field: Option<String>,
        question: String,
        options: Option<Vec<String>>,
        /// For `scope: "connector_category"` — the machine token category the
        /// frontend vault picker should filter connectors by (e.g. "storage",
        /// "messaging", "image_generation"). None for other scopes.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        category: Option<String>,
        /// C7 — when true, the answering UI surfaces a file/URL attachment
        /// affordance. The answer command resolves the reference server-side
        /// and prepends a fenced block to the answer text before piping to
        /// the CLI. See `engine::build_session::reference`.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        accepts_reference: bool,
        /// C7 — when true, the answering UI surfaces a smee.io URL input.
        /// Emitted when the LLM picks the `webhook` trigger type (rule 24).
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        accepts_webhook_source: bool,
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
    /// JSON-encoded adoption questionnaire answers (answers + question metadata + credential bindings).
    pub adoption_answers: Option<String>,
    pub intent: String,
    pub error_message: Option<String>,
    pub cli_pid: Option<u32>,
    /// Original workflow JSON for import mode (null for pure intent mode).
    pub workflow_json: Option<String>,
    /// Pre-parsed AgentIR from frontend parser for import mode.
    pub parser_result_json: Option<String>,
    /// Build mode — `Some("interactive")` (default ask-the-user gate flow) or
    /// `Some("one_shot")` (autonomous: LLM resolves every gate, retries up to
    /// 3× on test failure, auto-promotes on success). NULL on legacy rows is
    /// treated as `interactive` at read time.
    pub mode: Option<String>,
    /// Companion chat session that originated this build, when applicable.
    /// Used by the BuildWatcher job to post a result message back into the
    /// chat's episode log on terminal phase. NULL when the session was
    /// started from the regular UI (not via Companion).
    pub companion_session_id: Option<String>,
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
    /// Optional reference attachment for clarifying questions whose IR shape
    /// carries `accepts_reference: true`. C7 (2026-04-27). At most one of
    /// `path` / `url` / `inline_content` is populated; the answer command
    /// resolves whichever is set, fences the contents, and prepends them to
    /// `answer` before piping to the CLI subprocess. See
    /// `engine::build_session::reference` for the contract.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<UserAnswerReference>,
    /// Optional webhook source for clarifying questions whose IR shape
    /// carries `accepts_webhook_source: true`. C7 (2026-04-28). The answer
    /// command appends a fenced "WEBHOOK SOURCE" block to the answer text
    /// so the LLM places the URL on the relevant trigger config's
    /// `smee_channel_url` field. Promote-time then auto-creates the
    /// `smee_relays` row.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub webhook_source: Option<UserWebhookSource>,
}

/// Webhook source attachment payload — captured during the build wizard
/// when the LLM picks `trigger_type: "webhook"` for a capability and asks
/// the user for a smee.io URL via a clarifying_question carrying
/// `accepts_webhook_source: true`. C7 (2026-04-28).
///
/// The frontend submits this via `answer_build_question`; the answer
/// command appends a fenced summary of the URL to the answer text so the
/// LLM can place it on the trigger config's `smee_channel_url` field.
/// Promote-time then reads the trigger config and auto-creates a
/// `smee_relays` row pointing at this persona.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UserWebhookSource {
    /// `https://smee.io/<channel>` URL the user pasted (or created at
    /// smee.io/new and copied back).
    pub channel_url: String,
    /// Optional comma-separated `event_type` allowlist forwarded to the
    /// `smee_relays.event_filter` column. Empty / None means no filter
    /// (relay forwards every smee event to the persona).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_filter: Option<String>,
}

/// Reference attachment payload — either a local file path, a URL, or
/// caller-supplied inline text.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UserAnswerReference {
    /// Local filesystem path (resolved by the file-picker dialog on the
    /// frontend). Mutually exclusive with `url` / `inline_content`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// HTTPS URL — fetched server-side with SSRF protection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Pre-loaded text content (e.g. from a paste). Server still applies
    /// the size cap.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inline_content: Option<String>,
    /// Optional human-friendly name shown to the LLM. Defaults to filename
    /// (file), URL (url), or "pasted reference" (inline).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
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
    pub adoption_answers: Option<serde_json::Value>,
    pub intent: String,
    pub error_message: Option<String>,
    /// Build mode — `"interactive"` or `"one_shot"`. NULL legacy rows are
    /// surfaced as `Some("interactive")` so the frontend can switch on a
    /// string without dealing with three-state logic.
    pub mode: Option<String>,
    /// Companion chat session that originated this build, when applicable.
    pub companion_session_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
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
            adoption_answers: s
                .adoption_answers
                .as_deref()
                .and_then(|a| serde_json::from_str(a).ok()),
            intent: s.intent.clone(),
            error_message: s.error_message.clone(),
            mode: Some(s.mode.clone().unwrap_or_else(|| "interactive".to_string())),
            companion_session_id: s.companion_session_id.clone(),
            created_at: s.created_at.clone(),
            updated_at: s.updated_at.clone(),
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
    pub adoption_answers: Option<Option<String>>,
    pub error_message: Option<Option<String>>,
    pub cli_pid: Option<Option<u32>>,
    pub mode: Option<Option<String>>,
    pub companion_session_id: Option<Option<String>>,
}
