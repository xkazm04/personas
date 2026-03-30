use std::sync::Arc;

use chrono::DateTime;
use tauri::State;

// AppHandle kept on commands for forward-compatibility but no longer used
// for manual event-bus emits — CDC handles those automatically.
#[allow(unused_imports)]
use tauri::AppHandle;

use crate::db::models::{
    CreateEventSubscriptionInput, CreatePersonaEventInput, CreateTriggerInput,
    EventFilterInput, PaginatedEvents, PersonaEvent, PersonaEventStatus, PersonaEventSubscription,
    UpdateEventSubscriptionInput,
};
use crate::db::repos::communication::events as repo;
// NOTE: emit_event_bus calls removed — CDC update_hook auto-emits on persona_events INSERT/UPDATE
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
    DateTime::parse_from_rfc3339(&since).map_err(|e| {
        AppError::Validation(format!("'since' is not a valid RFC3339 date: {e}"))
    })?;
    DateTime::parse_from_rfc3339(&until).map_err(|e| {
        AppError::Validation(format!("'until' is not a valid RFC3339 date: {e}"))
    })?;
    let (events, has_more) = repo::get_in_range(&state.db, &since, &until, limit)?;
    Ok(PaginatedEvents { events, has_more })
}

#[tauri::command]
pub fn search_events(
    state: State<'_, Arc<AppState>>,
    filter: EventFilterInput,
) -> Result<PaginatedEvents, AppError> {
    require_auth_sync(&state)?;
    let (events, has_more) = repo::search(&state.db, &filter)?;
    Ok(PaginatedEvents { events, has_more })
}

#[tauri::command]
pub fn publish_event(
    _app: AppHandle,
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
    // CDC auto-emits on persona_events INSERT
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

    let config = serde_json::json!({
        "listen_event_type": input.event_type,
        "source_filter": input.source_filter,
    });

    let trigger_input = CreateTriggerInput {
        persona_id: input.persona_id.clone(),
        trigger_type: "event_listener".into(),
        config: Some(serde_json::to_string(&config).unwrap_or_default()),
        enabled: input.enabled,
        use_case_id: input.use_case_id.clone(),
    };

    repo::create_subscription_with_trigger(&state.db, input, trigger_input)
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
    _app: AppHandle,
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
    // CDC auto-emits on persona_events INSERT
    Ok(event)
}

// -- Dead Letter Queue commands --------------------------------------------------

#[tauri::command]
pub fn list_dead_letter_events(
    state: State<'_, Arc<AppState>>,
    limit: Option<i64>,
) -> Result<Vec<PersonaEvent>, AppError> {
    require_auth_sync(&state)?;
    repo::get_dead_letter_events(&state.db, limit)
}

#[tauri::command]
pub fn count_dead_letter_events(
    state: State<'_, Arc<AppState>>,
) -> Result<i64, AppError> {
    require_auth_sync(&state)?;
    repo::count_dead_letter(&state.db)
}

#[tauri::command]
pub fn retry_dead_letter_event(
    _app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<PersonaEvent, AppError> {
    require_auth_sync(&state)?;
    let event = repo::retry_dead_letter(&state.db, &id)?;
    // CDC auto-emits on persona_events UPDATE
    Ok(event)
}

#[tauri::command]
pub fn discard_dead_letter_event(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::discard_dead_letter(&state.db, &id)?;
    Ok(true)
}

// -- Dev seed: mock event -------------------------------------------------------

#[tauri::command]
pub fn seed_mock_event(
    _app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<PersonaEvent, AppError> {
    require_auth_sync(&state)?;

    use super::mock_seed::{self, MOCK_EVENT_TEMPLATES};

    let t = mock_seed::seed_index();
    let target_persona_id = mock_seed::pick_persona_id(&state.db, t)?;
    let tpl = &MOCK_EVENT_TEMPLATES[t % MOCK_EVENT_TEMPLATES.len()];

    let now = chrono::Utc::now().to_rfc3339();
    let payload = serde_json::json!({
        "mock": true,
        "timestamp": now,
        "detail": format!("Mock {} event from {}", tpl.event_type, tpl.source),
    }).to_string();

    // Route through publish() to ensure validation and encryption are applied,
    // keeping mock events structurally identical to production events.
    let input = CreatePersonaEventInput {
        event_type: tpl.event_type.to_string(),
        source_type: tpl.source.to_string(),
        project_id: Some("mock".into()),
        source_id: None,
        target_persona_id,
        payload: Some(payload),
        use_case_id: None,
    };
    let mut event = repo::publish(&state.db, input)?;

    // Update status to the mock's chosen status (publish() always sets 'pending').
    if tpl.status != PersonaEventStatus::Pending {
        repo::update_status(&state.db, &event.id, tpl.status.clone(), None)?;
        event.status = tpl.status.clone();
    }

    // CDC auto-emits on persona_events INSERT + UPDATE

    Ok(event)
}
