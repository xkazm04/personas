use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

use crate::db::models::{
    CreateEventSubscriptionInput, CreatePersonaEventInput, CreateTriggerInput,
    PaginatedEvents, PersonaEvent, PersonaEventSubscription, UpdateEventSubscriptionInput,
};
use crate::db::repos::communication::events as repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::engine::rate_limiter::EVENT_SOURCE_WINDOW;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[tauri::command]
pub fn list_events(
    state: State<'_, Arc<AppState>>,
    limit: Option<i64>,
    project_id: Option<String>,
) -> Result<Vec<PersonaEvent>, AppError> {
    require_auth_sync(&state)?;
    repo::get_recent(&state.db, limit, project_id.as_deref())
}

#[tauri::command]
pub fn list_events_in_range(
    state: State<'_, Arc<AppState>>,
    since: String,
    until: String,
    limit: Option<i64>,
) -> Result<PaginatedEvents, AppError> {
    require_auth_sync(&state)?;
    let (events, has_more) = repo::get_in_range(&state.db, &since, &until, limit)?;
    Ok(PaginatedEvents { events, has_more })
}

#[tauri::command]
pub fn publish_event(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    input: CreatePersonaEventInput,
) -> Result<PersonaEvent, AppError> {
    require_auth_sync(&state)?;
    let event_source_max = state.tier_config.lock().unwrap_or_else(|e| e.into_inner()).event_source_max;
    let rate_key = format!("event:{}", input.source_type);
    if let Err(retry_after) = state.rate_limiter.check(&rate_key, event_source_max, EVENT_SOURCE_WINDOW) {
        return Err(AppError::RateLimited(format!(
            "Event source '{}' exceeded {} events/minute. Retry after {}s",
            input.source_type, event_source_max, retry_after
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
    require_auth_sync(&state)?;
    repo::get_subscriptions_by_persona(&state.db, &persona_id)
}

#[tauri::command]
pub fn list_all_subscriptions(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PersonaEventSubscription>, AppError> {
    require_auth_sync(&state)?;
    repo::get_all_subscriptions(&state.db)
}

#[tauri::command]
pub fn create_subscription(
    state: State<'_, Arc<AppState>>,
    input: CreateEventSubscriptionInput,
) -> Result<PersonaEventSubscription, AppError> {
    require_auth_sync(&state)?;
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
    require_auth_sync(&state)?;
    repo::update_subscription(&state.db, &id, input)
}

#[tauri::command]
pub fn delete_subscription(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_subscription(&state.db, &id)
}

#[tauri::command]
pub fn test_event_flow(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    event_type: String,
    payload: Option<String>,
) -> Result<PersonaEvent, AppError> {
    require_auth_sync(&state)?;
    let event_source_max = state.tier_config.lock().unwrap_or_else(|e| e.into_inner()).event_source_max;
    if let Err(retry_after) = state.rate_limiter.check("event:test", event_source_max, EVENT_SOURCE_WINDOW) {
        return Err(AppError::RateLimited(format!(
            "Test event flow exceeded {} events/minute. Retry after {}s",
            event_source_max, retry_after
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

// -- Dev seed: mock event -------------------------------------------------------

const MOCK_EVENT_TYPES: &[&str] = &[
    "webhook_received", "execution_completed", "trigger_fired",
    "credential_rotated", "health_check_failed", "deployment_started",
    "memory_created", "review_submitted",
];

const MOCK_EVENT_SOURCES: &[&str] = &[
    "webhook", "scheduler", "trigger_engine", "vault",
    "health_monitor", "cloud_deploy", "memory_engine", "review_pipeline",
];

const MOCK_EVENT_STATUSES: &[&str] = &[
    "completed", "completed", "processing", "completed",
    "failed", "processing", "completed", "pending",
];

#[tauri::command]
pub fn seed_mock_event(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<PersonaEvent, AppError> {
    require_auth_sync(&state)?;

    let personas = crate::db::repos::core::personas::get_all(&state.db)?;
    let t = chrono::Utc::now().timestamp_millis() as usize;
    let idx = t % std::cmp::max(personas.len(), 1);
    let target_persona_id = personas.get(idx).map(|p| p.id.clone());

    let event_type = MOCK_EVENT_TYPES[t % MOCK_EVENT_TYPES.len()].to_string();
    let source_type = MOCK_EVENT_SOURCES[t % MOCK_EVENT_SOURCES.len()].to_string();
    let status = MOCK_EVENT_STATUSES[t % MOCK_EVENT_STATUSES.len()].to_string();

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let payload = serde_json::json!({
        "mock": true,
        "timestamp": now,
        "detail": format!("Mock {} event from {}", event_type, source_type),
    }).to_string();

    let conn = state.db.get()?;
    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
    conn.execute(
        "INSERT INTO persona_events
         (id, event_type, source_type, source_id, target_persona_id, payload, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![id, event_type, source_type, Option::<String>::None, target_persona_id, payload, status, now],
    )?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;

    let event = PersonaEvent {
        id,
        event_type,
        source_type,
        source_id: None,
        project_id: String::new(),
        target_persona_id,
        payload: Some(payload),
        status,
        error_message: None,
        processed_at: None,
        use_case_id: None,
        created_at: now,
    };

    if let Err(e) = app.emit("event-bus", event.clone()) {
        tracing::warn!(error = %e, "Failed to emit mock event-bus event");
    }

    Ok(event)
}
