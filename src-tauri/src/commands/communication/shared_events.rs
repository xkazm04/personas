use std::sync::Arc;
use tauri::State;

use crate::db::models::{
    CreateSharedEventSubscriptionInput, SharedEventCatalogEntry, SharedEventSubscription,
};
use crate::db::repos::communication::shared_events as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Browse the locally-cached shared events catalog.
#[tauri::command]
pub fn shared_events_browse_catalog(
    state: State<'_, Arc<AppState>>,
    category: Option<String>,
    search: Option<String>,
) -> Result<Vec<SharedEventCatalogEntry>, AppError> {
    require_auth_sync(&state)?;
    repo::list_catalog(&state.db, category.as_deref(), search.as_deref())
}

/// Refresh the catalog from the cloud orchestrator.
///
/// Fetches the latest catalog entries from Supabase, upserts them into the
/// local cache, and returns the full catalog.
#[tauri::command]
pub async fn shared_events_refresh_catalog(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<SharedEventCatalogEntry>, AppError> {
    require_auth_sync(&state)?;

    // Try to fetch from cloud; if cloud is unavailable, return local cache
    let cloud = state.cloud_client.lock().await.clone();
    if let Some(client) = cloud {
        match client.shared_events_browse_catalog(None).await {
            Ok(response) => {
                // Convert cloud entries to local model and upsert
                let entries: Vec<SharedEventCatalogEntry> = response
                    .entries
                    .into_iter()
                    .map(|e| SharedEventCatalogEntry {
                        id: e.id,
                        slug: e.slug,
                        name: e.name,
                        description: e.description,
                        category: e.category,
                        publisher: e.publisher,
                        icon: e.icon,
                        color: e.color,
                        sample_payload: e.sample_payload,
                        event_schema: e.event_schema,
                        subscriber_count: e.subscriber_count,
                        is_featured: e.is_featured,
                        status: e.status,
                        cloud_updated_at: e.updated_at,
                        cached_at: chrono::Utc::now().to_rfc3339(),
                    })
                    .collect();

                let _ = repo::upsert_catalog_batch(&state.db, &entries);
            }
            Err(e) => {
                tracing::warn!("Failed to refresh shared events catalog from cloud: {e}");
            }
        }
    }

    repo::list_catalog(&state.db, None, None)
}

/// Subscribe to a shared event feed.
#[tauri::command]
pub fn shared_events_subscribe(
    state: State<'_, Arc<AppState>>,
    catalog_entry_id: String,
) -> Result<SharedEventSubscription, AppError> {
    require_auth_sync(&state)?;
    repo::subscribe(
        &state.db,
        CreateSharedEventSubscriptionInput { catalog_entry_id },
    )
}

/// Unsubscribe from a shared event feed.
#[tauri::command]
pub fn shared_events_unsubscribe(
    state: State<'_, Arc<AppState>>,
    subscription_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::unsubscribe(&state.db, &subscription_id)
}

/// List all shared event subscriptions.
#[tauri::command]
pub fn shared_events_list_subscriptions(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<SharedEventSubscription>, AppError> {
    require_auth_sync(&state)?;
    repo::list_subscriptions(&state.db)
}
