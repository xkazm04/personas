//! Composite trigger engine.
//!
//! Evaluates composite triggers that combine multiple event conditions with
//! AND/OR/sequence operators and time windows. Partial matches are tracked
//! in-memory and expire when the time window elapses.
//!
//! On each tick:
//! 1. Load recent events from the DB (last N seconds).
//! 2. For each enabled composite trigger, evaluate whether its conditions
//!    are satisfied within the configured time window.
//! 3. If satisfied, publish a composite event and record the trigger as fired
//!    to prevent re-firing until conditions reset.

use std::collections::HashMap;
use std::sync::OnceLock;
use std::sync::Mutex;

use chrono::{DateTime, Duration, Utc};

use crate::db::models::{CreatePersonaEventInput, TriggerConfig};
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::db::DbPool;

/// In-memory state for composite trigger evaluation.
/// Tracks which triggers have already fired to prevent double-firing.
struct CompositeState {
    /// trigger_id -> last time it fired (used to suppress re-firing within the window)
    last_fired: HashMap<String, DateTime<Utc>>,
}

static STATE: OnceLock<Mutex<CompositeState>> = OnceLock::new();

fn get_state() -> &'static Mutex<CompositeState> {
    STATE.get_or_init(|| {
        Mutex::new(CompositeState {
            last_fired: HashMap::new(),
        })
    })
}

/// Tick function called by the CompositeSubscription.
pub fn composite_tick(pool: &DbPool) {
    // Load all enabled composite triggers
    let triggers = match trigger_repo::get_all(pool) {
        Ok(t) => t,
        Err(_) => return,
    };

    let composite_triggers: Vec<_> = triggers
        .into_iter()
        .filter(|t| t.trigger_type == "composite" && t.enabled)
        .collect();

    if composite_triggers.is_empty() {
        return;
    }

    // Find the maximum window we need to look back
    let max_window = composite_triggers
        .iter()
        .filter_map(|t| {
            if let TriggerConfig::Composite { window_seconds, .. } = t.parse_config() {
                window_seconds
            } else {
                None
            }
        })
        .max()
        .unwrap_or(300);

    // Load recent events within the max window
    let since = (Utc::now() - Duration::seconds(max_window as i64)).to_rfc3339();
    let until = Utc::now().to_rfc3339();
    let recent_events = match event_repo::get_in_range(pool, &since, &until) {
        Ok(events) => events,
        Err(_) => return,
    };

    let now = Utc::now();

    for trigger in &composite_triggers {
        let config = trigger.parse_config();
        if let TriggerConfig::Composite {
            conditions: Some(ref conditions),
            operator,
            window_seconds: Some(window_secs),
            event_type,
            ..
        } = config
        {
            if conditions.is_empty() {
                continue;
            }

            // Check if we already fired within the window (suppress re-firing)
            {
                let state = get_state().lock().unwrap();
                if let Some(last) = state.last_fired.get(&trigger.id) {
                    if now.signed_duration_since(*last).num_seconds() < window_secs as i64 {
                        continue;
                    }
                }
            }

            let window_start = now - Duration::seconds(window_secs as i64);
            let op = operator.as_deref().unwrap_or("all");

            // Filter events within this trigger's specific window
            let windowed_events: Vec<_> = recent_events
                .iter()
                .filter(|e| {
                    if let Ok(ts) = DateTime::parse_from_rfc3339(&e.created_at) {
                        ts >= window_start
                    } else {
                        false
                    }
                })
                .collect();

            let fired = match op {
                "all" => evaluate_all(conditions, &windowed_events),
                "any" => evaluate_any(conditions, &windowed_events),
                "sequence" => evaluate_sequence(conditions, &windowed_events),
                _ => evaluate_all(conditions, &windowed_events),
            };

            if fired {
                // Record firing
                {
                    let mut state = get_state().lock().unwrap();
                    state.last_fired.insert(trigger.id.clone(), now);
                }

                // Build payload showing which conditions matched
                let matched_summary: Vec<_> = conditions
                    .iter()
                    .map(|c| {
                        serde_json::json!({
                            "event_type": c.event_type,
                            "source_filter": c.source_filter,
                        })
                    })
                    .collect();

                let payload = serde_json::json!({
                    "operator": op,
                    "window_seconds": window_secs,
                    "conditions_met": matched_summary,
                });

                let input = CreatePersonaEventInput {
                    event_type: event_type.as_deref().unwrap_or("composite_fired").into(),
                    source_type: "composite".into(),
                    project_id: None,
                    source_id: Some(trigger.id.clone()),
                    target_persona_id: Some(trigger.persona_id.clone()),
                    payload: Some(serde_json::to_string(&payload).unwrap_or_default()),
                    use_case_id: trigger.use_case_id.clone(),
                };

                if let Err(e) = event_repo::publish(pool, input) {
                    tracing::warn!(trigger_id = %trigger.id, "composite publish error: {e}");
                } else {
                    tracing::info!(trigger_id = %trigger.id, operator = %op, "Composite trigger fired");
                }
            }
        }
    }

    // Cleanup: remove entries for triggers that no longer exist or are old
    {
        let mut state = get_state().lock().unwrap();
        let cutoff = now - Duration::seconds(3600);
        state.last_fired.retain(|_, v| *v > cutoff);
    }
}

/// ALL (AND): every condition must have at least one matching event in the window.
fn evaluate_all(
    conditions: &[crate::db::models::CompositeCondition],
    events: &[&crate::db::models::PersonaEvent],
) -> bool {
    conditions.iter().all(|cond| {
        events.iter().any(|e| event_matches_condition(e, cond))
    })
}

/// ANY (OR): at least one condition must have a matching event.
fn evaluate_any(
    conditions: &[crate::db::models::CompositeCondition],
    events: &[&crate::db::models::PersonaEvent],
) -> bool {
    conditions.iter().any(|cond| {
        events.iter().any(|e| event_matches_condition(e, cond))
    })
}

/// SEQUENCE: all conditions must match events in chronological order.
fn evaluate_sequence(
    conditions: &[crate::db::models::CompositeCondition],
    events: &[&crate::db::models::PersonaEvent],
) -> bool {
    let mut last_time: Option<DateTime<Utc>> = None;

    for cond in conditions {
        let matched = events.iter().find(|e| {
            if !event_matches_condition(e, cond) {
                return false;
            }
            if let Some(ref lt) = last_time {
                // Must be after the previous condition's match
                if let Ok(ts) = DateTime::parse_from_rfc3339(&e.created_at) {
                    ts.with_timezone(&Utc) >= *lt
                } else {
                    false
                }
            } else {
                true
            }
        });

        match matched {
            Some(e) => {
                if let Ok(ts) = DateTime::parse_from_rfc3339(&e.created_at) {
                    last_time = Some(ts.with_timezone(&Utc));
                }
            }
            None => return false,
        }
    }

    true
}

/// Check if an event matches a composite condition.
fn event_matches_condition(
    event: &crate::db::models::PersonaEvent,
    condition: &crate::db::models::CompositeCondition,
) -> bool {
    if event.event_type != condition.event_type {
        return false;
    }

    // Check source filter if set
    if let Some(ref filter) = condition.source_filter {
        match &event.source_id {
            Some(source) => {
                if filter.ends_with('*') {
                    let prefix = &filter[..filter.len() - 1];
                    if !source.starts_with(prefix) {
                        return false;
                    }
                } else if source != filter {
                    return false;
                }
            }
            None => return false,
        }
    }

    true
}
