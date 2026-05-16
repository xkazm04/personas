use std::sync::Arc;

use tauri::State;

use crate::db::models::{
    CreateNotificationSubscriptionInput, NotificationSubscription, NotificationTestResult,
    UpdateNotificationSubscriptionInput,
};
use crate::db::repos::resources::notification_subscriptions as repo;
use crate::engine::webhook_notifier;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[tauri::command]
pub fn list_notification_subscriptions(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<NotificationSubscription>, AppError> {
    require_auth_sync(&state)?;
    repo::list_all(&state.db)
}

#[tauri::command]
pub fn get_notification_subscription(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<NotificationSubscription, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn create_notification_subscription(
    state: State<'_, Arc<AppState>>,
    input: CreateNotificationSubscriptionInput,
) -> Result<NotificationSubscription, AppError> {
    require_auth_sync(&state)?;
    repo::create(&state.db, input)
}

#[tauri::command]
pub fn update_notification_subscription(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateNotificationSubscriptionInput,
) -> Result<NotificationSubscription, AppError> {
    require_auth_sync(&state)?;
    repo::update(&state.db, &id, input)
}

#[tauri::command]
pub fn delete_notification_subscription(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::delete(&state.db, &id)
}

#[tauri::command]
pub async fn test_notification_subscription(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<NotificationTestResult, AppError> {
    require_auth_sync(&state)?;
    let outcome = webhook_notifier::test_dispatch(&state.db, &id).await?;
    Ok(NotificationTestResult {
        ok: outcome.ok,
        status_code: outcome.status_code.map(|c| c as i32),
        response_excerpt: outcome.response_excerpt,
        error: outcome.error,
    })
}
