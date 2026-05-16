use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Outbound webhook subscription. Fires HTTP POSTs to Slack/Discord/Teams/
/// generic JSON endpoints when a persona event matches one of the configured
/// event-type patterns.
///
/// The webhook URL is the credential-protected secret; either store it inline
/// (small deployments) or reference a `persona_credentials` row via
/// `credential_id` (preferred for sharing across subscriptions).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSubscription {
    pub id: String,
    pub label: String,
    /// One of `slack`, `discord`, `teams`, `generic`.
    pub provider: String,
    /// Outbound webhook URL. Either set directly or resolved from
    /// `credential_id` at dispatch time.
    pub webhook_url: Option<String>,
    pub credential_id: Option<String>,
    /// JSON array of event-type patterns. A pattern matches an event when it
    /// equals the event_type, or when the pattern ends with `.*` and the
    /// event_type begins with the prefix. Example:
    /// `["execution.finished", "healing.*"]`.
    pub event_types: String,
    /// Mustache-style template applied to the event payload. `{{path.to.field}}`
    /// is replaced with the value at that JSON path; missing paths render as
    /// empty strings. When omitted, a provider-specific default is used.
    pub template_body: Option<String>,
    pub enabled: bool,
    pub last_delivery_at: Option<String>,
    pub last_delivery_status: Option<String>,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreateNotificationSubscriptionInput {
    pub label: String,
    pub provider: String,
    pub webhook_url: Option<String>,
    pub credential_id: Option<String>,
    pub event_types: Vec<String>,
    pub template_body: Option<String>,
    pub enabled: Option<bool>,
}

/// Partial update payload. Any field set to `None` (TypeScript `null`) is
/// left untouched; set a field to its empty value to clear it (empty string
/// for URLs / templates, empty array is rejected for event_types).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNotificationSubscriptionInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub webhook_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_types: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_body: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NotificationTestResult {
    pub ok: bool,
    pub status_code: Option<i32>,
    pub response_excerpt: Option<String>,
    pub error: Option<String>,
}
