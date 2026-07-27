//! Team channel messages (C1) — the authoritative multi-author orchestration
//! channel. See docs/architecture/team-channel-orchestration.md.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One message in a team's channel from any author kind.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TeamChannelMessage {
    pub id: String,
    pub team_id: String,
    /// 'user' | 'athena' | 'director' | 'persona'
    pub author_kind: String,
    /// Persona id when author_kind is 'persona' or 'director'; NULL for user/athena.
    pub author_id: Option<String>,
    pub body: String,
    /// JSON array of persona ids the message is addressed to; NULL = whole team.
    pub addressed_to: Option<String>,
    /// Threading: the message id this replies to.
    pub reply_to: Option<String>,
    /// Optional anchor to a specific assignment/mission.
    pub assignment_id: Option<String>,
    /// 'inject' (reaches step input/prompt) | 'mention' (routes to an actor) |
    /// 'display' (human-only). The defined-consumer governance rule.
    pub consumer: String,
    /// JSON `[{step_id, persona_id, at}]` delivery receipts.
    pub deliveries: Option<String>,
    pub created_at: String,
}

/// Input for posting a channel message.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateChannelMessageInput {
    pub team_id: String,
    pub author_kind: String,
    pub author_id: Option<String>,
    pub body: String,
    pub addressed_to: Option<Vec<String>>,
    pub reply_to: Option<String>,
    pub assignment_id: Option<String>,
    /// Defaults to 'inject' when None.
    pub consumer: Option<String>,
}
