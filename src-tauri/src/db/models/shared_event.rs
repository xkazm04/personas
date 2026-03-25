use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A catalog entry representing a curated shared event feed.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SharedEventCatalogEntry {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub publisher: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub sample_payload: Option<String>,
    pub event_schema: Option<String>,
    pub subscriber_count: i64,
    pub is_featured: bool,
    pub status: String,
    pub cloud_updated_at: Option<String>,
    pub cached_at: String,
}

/// A user's subscription to a shared event feed.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SharedEventSubscription {
    pub id: String,
    pub catalog_entry_id: String,
    pub slug: String,
    pub enabled: bool,
    pub last_cursor: Option<String>,
    pub events_relayed: i64,
    pub last_event_at: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Input for subscribing to a shared event feed.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSharedEventSubscriptionInput {
    pub catalog_entry_id: String,
}
