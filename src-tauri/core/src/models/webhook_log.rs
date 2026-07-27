use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A logged incoming webhook HTTP request.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct WebhookRequestLog {
    pub id: String,
    pub trigger_id: String,
    pub method: String,
    pub headers: Option<String>,
    pub body: Option<String>,
    pub status_code: i32,
    pub response_body: Option<String>,
    pub event_id: Option<String>,
    pub error_message: Option<String>,
    pub received_at: String,
}

/// Input for creating a webhook request log entry.
#[derive(Debug, Clone)]
pub struct CreateWebhookRequestLogInput {
    pub trigger_id: String,
    pub method: String,
    pub headers: Option<String>,
    pub body: Option<String>,
    pub status_code: i32,
    pub response_body: Option<String>,
    pub event_id: Option<String>,
    pub error_message: Option<String>,
}
