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

/// A single baked change on a shared-event feed — one recorded entry in the
/// feed's change history (e.g. a detected connector API change). Read-only;
/// seeded from `db/builtin_shared_events.rs`. `payload` is the JSON string
/// delivered on the bus as the `shared:<slug>` event.
///
/// Distinct from `cloud::client::SharedEventFiring`, which models a firing
/// polled from the cloud feed (different shape/source).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SharedEventChange {
    pub id: String,
    pub slug: String,
    pub seq: i64,
    pub title: String,
    pub fired_at: String,
    pub payload: String,
    pub release_version: Option<String>,
}

/// One feed→project route: a shared-event feed pinned to a dev project so a
/// firing can open the quick-dispatch door pre-scoped to that project. The
/// composite key (catalog_entry_id, project_id) makes the pairing itself the
/// row — routes are replaced as a set via `set_routes`, never edited in place.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SharedEventProjectRoute {
    pub catalog_entry_id: String,
    pub project_id: String,
    pub created_at: String,
}

/// One ingested feed-impact run: the durable record of what a dispatched
/// `feed_impact_dispatch` Fleet session concluded (or committed) for one
/// (firing, project) pair. Written only through the gated ingest door
/// (`dev_tools_feed_impact_ingest`) — the CLI session itself never writes
/// the database; it writes `<root>/feed-impact/runs/<id>/result.json`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SharedEventImpactRun {
    pub id: String,
    pub firing_id: String,
    pub catalog_entry_id: String,
    pub project_id: String,
    /// no_impact | assessed | committed | gates_red | failed
    pub verdict: String,
    pub summary: String,
    pub commit_sha: Option<String>,
    pub details_md: Option<String>,
    pub created_at: String,
}

/// Per-feed change-activity rollup — the latest change + total count for one
/// slug. Powers the "Latest change" column + Watchtower ordering in the
/// Marketplace tables. `last_payload` is the newest change's JSON payload.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SharedEventFeedActivity {
    pub slug: String,
    pub change_count: i64,
    pub last_fired_at: String,
    pub last_payload: String,
}
