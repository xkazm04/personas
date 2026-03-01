use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

use crate::db::models::{
    CreateEventSubscriptionInput, CreatePersonaEventInput, CreateTriggerInput,
    PersonaEvent, PersonaEventSubscription, UpdateEventSubscriptionInput,
};
use crate::db::repos::communication::events as repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::engine::rate_limiter::{EVENT_SOURCE_MAX, EVENT_SOURCE_WINDOW};
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub fn list_events(
    state: State<'_, Arc<AppState>>,
    limit: Option<i64>,
    project_id: Option<String>,
) -> Result<Vec<PersonaEvent>, AppError> {
    repo::get_recent(&state.db, limit, project_id.as_deref())
}

#[tauri::command]
pub fn publish_event(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    input: CreatePersonaEventInput,
) -> Result<PersonaEvent, AppError> {
    let rate_key = format!("event:{}", input.source_type);
    if let Err(retry_after) = state.rate_limiter.check(&rate_key, EVENT_SOURCE_MAX, EVENT_SOURCE_WINDOW) {
        return Err(AppError::RateLimited(format!(
            "Event source '{}' exceeded {} events/minute. Retry after {}s",
            input.source_type, EVENT_SOURCE_MAX, retry_after
        )));
    }

    let event = repo::publish(&state.db, input)?;
    if let Err(e) = app.emit("event-bus", event.clone()) {
        tracing::warn!(event_id = %event.id, error = %e, "Failed to emit event-bus event to frontend");
    }
    Ok(event)
}

#[tauri::command]
pub fn list_subscriptions(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<PersonaEventSubscription>, AppError> {
    repo::get_subscriptions_by_persona(&state.db, &persona_id)
}

#[tauri::command]
pub fn create_subscription(
    state: State<'_, Arc<AppState>>,
    input: CreateEventSubscriptionInput,
) -> Result<PersonaEventSubscription, AppError> {
    // Dual-write: create the legacy subscription AND an event_listener trigger.
    // The event bus deduplicates by persona_id so both existing paths work.
    let config = serde_json::json!({
        "listen_event_type": input.event_type,
        "source_filter": input.source_filter,
    });
    let _ = trigger_repo::create(
        &state.db,
        CreateTriggerInput {
            persona_id: input.persona_id.clone(),
            trigger_type: "event_listener".into(),
            config: Some(serde_json::to_string(&config).unwrap_or_default()),
            enabled: input.enabled,
            use_case_id: input.use_case_id.clone(),
        },
    );

    repo::create_subscription(&state.db, input)
}

#[tauri::command]
pub fn update_subscription(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateEventSubscriptionInput,
) -> Result<PersonaEventSubscription, AppError> {
    repo::update_subscription(&state.db, &id, input)
}

#[tauri::command]
pub fn delete_subscription(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    repo::delete_subscription(&state.db, &id)
}

#[tauri::command]
pub fn test_event_flow(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    event_type: String,
    payload: Option<String>,
) -> Result<PersonaEvent, AppError> {
    if let Err(retry_after) = state.rate_limiter.check("event:test", EVENT_SOURCE_MAX, EVENT_SOURCE_WINDOW) {
        return Err(AppError::RateLimited(format!(
            "Test event flow exceeded {} events/minute. Retry after {}s",
            EVENT_SOURCE_MAX, retry_after
        )));
    }

    let input = CreatePersonaEventInput {
        event_type,
        source_type: "test".into(),
        project_id: None,
        source_id: None,
        target_persona_id: None,
        payload,
        use_case_id: None,
    };
    let event = repo::publish(&state.db, input)?;
    if let Err(e) = app.emit("event-bus", event.clone()) {
        tracing::warn!(event_id = %event.id, error = %e, "Failed to emit test event-bus event to frontend");
    }
    Ok(event)
}
