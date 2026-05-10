use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SmeeRelay {
    pub id: String,
    pub label: String,
    pub channel_url: String,
    pub status: String,
    pub event_filter: Option<String>,
    pub target_persona_id: Option<String>,
    pub events_relayed: i64,
    pub last_event_at: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// JSON-encoded array of `owner/repo` strings. When populated, the relay
    /// drops events whose body.repository.full_name is not in the list.
    /// `None` or `Some("[]")` accepts events from any repo (back-compat).
    /// Origin authentication only -- complements but does not replace
    /// downstream HMAC verification (see harness-learnings).
    pub allowed_repos: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSmeeRelayInput {
    pub label: String,
    pub channel_url: String,
    pub event_filter: Option<String>,
    pub target_persona_id: Option<String>,
    pub allowed_repos: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSmeeRelayInput {
    pub label: Option<String>,
    pub event_filter: Option<String>,
    pub target_persona_id: Option<String>,
    pub allowed_repos: Option<String>,
}
