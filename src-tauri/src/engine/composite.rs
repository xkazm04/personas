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
//! 4. Log partial-match diagnostics for near-miss evaluations.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use ts_rs::TS;

use crate::db::models::{CreatePersonaEventInput, TriggerConfig};
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::db::DbPool;
use crate::keyed_pool::KeyedResourcePool;

// ---------------------------------------------------------------------------
// Partial-match observability types
// ---------------------------------------------------------------------------

/// Per-condition match status within a composite evaluation.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ConditionStatus {
    pub event_type: String,
    pub source_filter: Option<String>,
    pub matched: bool,
    /// How many events in the window matched this condition.
    pub matched_event_count: u32,
}

/// Result of evaluating a composite trigger, with per-condition detail.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PartialMatchResult {
    pub trigger_id: String,
    pub trigger_name: String,
    pub persona_id: String,
    pub operator: String,
    pub window_seconds: u64,
    pub fired: bool,
    pub conditions_total: u32,
    pub conditions_met: u32,
    pub condition_details: Vec<ConditionStatus>,
    /// ISO-8601 timestamp of when this evaluation happened.
    pub evaluated_at: String,
    /// Whether this trigger is currently suppressed (already fired within window).
    pub suppressed: bool,
}

// ---------------------------------------------------------------------------
// Instance-based state — replaces former static globals for test isolation
// and safe concurrent access.
// ---------------------------------------------------------------------------

/// Owns the in-memory composite trigger state.  Each `CompositeState` is
/// independent, so unit tests can create throwaway instances without
/// cross-contamination.
///
/// The `tick_lock` serialises hydration + evaluation so that concurrent
/// `composite_tick` calls (e.g. during rapid restarts) cannot interleave
/// a half-finished hydration with a tick that reads stale suppression data.
#[derive(Clone)]
pub struct CompositeState {
    /// trigger_id → last time it fired (suppresses re-firing within the window).
    last_fired: KeyedResourcePool<String, DateTime<Utc>>,
    /// trigger_id → latest partial match result (overwritten each tick).
    latest_matches: KeyedResourcePool<String, PartialMatchResult>,
    /// Whether we have already hydrated `last_fired` from the database.
    hydrated: std::sync::Arc<AtomicBool>,
    /// Serialises the hydrate-then-evaluate sequence within a single tick.
    tick_lock: std::sync::Arc<Mutex<()>>,
}

impl CompositeState {
    pub fn new() -> Self {
        Self {
            last_fired: KeyedResourcePool::new(0, 0),
            latest_matches: KeyedResourcePool::new(0, 0),
            hydrated: std::sync::Arc::new(AtomicBool::new(false)),
            tick_lock: std::sync::Arc::new(Mutex::new(())),
        }
    }

    /// Hydrate the in-memory `last_fired` cache from the persisted
    /// `composite_trigger_fires` table.  Called once on the first composite
    /// tick after app (re)start.  The caller must already hold `tick_lock`.
    fn hydrate_from_db(&self, pool: &DbPool) {
        if self.hydrated.swap(true, Ordering::SeqCst) {
            return; // already hydrated
        }
        match trigger_repo::load_composite_fires(pool) {
            Ok(rows) => {
                for (trigger_id, fired_at) in rows {
                    if let Ok(ts) = DateTime::parse_from_rfc3339(&fired_at) {
                        if self.last_fired.get(&trigger_id).is_none() {
                            self.last_fired.insert(trigger_id, ts.with_timezone(&Utc));
                        }
                    }
                }
                tracing::debug!("Hydrated composite trigger suppression state from DB");
            }
            Err(e) => {
                tracing::warn!("Failed to hydrate composite fires from DB: {e}");
                // Reset so we retry next tick
                self.hydrated.store(false, Ordering::SeqCst);
            }
        }
    }

    /// Returns the most recent partial-match snapshots for all evaluated
    /// composite triggers.
    pub fn get_partial_matches(&self) -> Vec<PartialMatchResult> {
        self.latest_matches.values()
    }

    /// Returns the partial-match snapshot for a single trigger, if available.
    pub fn get_partial_match_for(&self, trigger_id: &str) -> Option<PartialMatchResult> {
        self.latest_matches.get(trigger_id)
    }
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

/// Tick function called by the CompositeSubscription.
///
/// The `tick_lock` inside `state` serialises hydration and evaluation so that
/// concurrent calls cannot interleave a half-finished hydration with stale
/// suppression reads.
pub fn composite_tick(pool: &DbPool, state: &CompositeState) {
    // Acquire the tick lock to serialise hydration + evaluation.
    let _guard = state.tick_lock.lock().unwrap_or_else(|e| e.into_inner());

    // Hydrate suppression state from DB on first tick after app start
    state.hydrate_from_db(pool);

    // Load only enabled composite triggers (filtered at SQL level)
    let composite_triggers = match trigger_repo::get_enabled_by_type(pool, "composite") {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("Failed to load composite triggers: {e} — composite evaluation skipped this tick");
            return;
        }
    };

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
    let recent_events = match event_repo::get_in_range(pool, &since, &until, None) {
        Ok((events, _)) => events,
        Err(e) => {
            tracing::error!("Failed to load recent events for composite evaluation: {e} — composite evaluation skipped this tick");
            return;
        }
    };

    let now = Utc::now();

    for trigger in &composite_triggers {
        if !trigger.is_within_active_window(now) {
            continue;
        }
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

            let op = operator.as_deref().unwrap_or("all");

            // Check if we already fired within the window (suppress re-firing)
            let suppressed = state.last_fired
                .get(&trigger.id)
                .is_some_and(|last| {
                    now.signed_duration_since(last).num_seconds() < window_secs as i64
                });

            let window_start = now - Duration::seconds(window_secs as i64);

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

            // Evaluate with detailed results
            let (fired, condition_details) = match op {
                "all" => evaluate_all_detailed(conditions, &windowed_events),
                "any" => evaluate_any_detailed(conditions, &windowed_events),
                "sequence" => evaluate_sequence_detailed(conditions, &windowed_events),
                _ => evaluate_all_detailed(conditions, &windowed_events),
            };

            let conditions_met = condition_details.iter().filter(|c| c.matched).count() as u32;
            let conditions_total = condition_details.len() as u32;

            let result = PartialMatchResult {
                trigger_id: trigger.id.clone(),
                trigger_name: trigger.trigger_type.clone(),
                persona_id: trigger.persona_id.clone(),
                operator: op.to_string(),
                window_seconds: window_secs,
                fired: fired && !suppressed,
                conditions_total,
                conditions_met,
                condition_details,
                evaluated_at: now.to_rfc3339(),
                suppressed,
            };

            // Cache the partial match result
            state.latest_matches.insert(trigger.id.clone(), result);

            // Log partial-match diagnostics for near-misses
            if !fired && conditions_met > 0 {
                tracing::info!(
                    trigger_id = %trigger.id,
                    operator = %op,
                    conditions_met = conditions_met,
                    conditions_total = conditions_total,
                    "Composite trigger near-miss: {conditions_met}/{conditions_total} conditions satisfied"
                );
            }

            if suppressed {
                continue;
            }

            if fired {
                // Record firing in memory and persist to DB
                state.last_fired.insert(trigger.id.clone(), now);
                if let Err(e) = trigger_repo::upsert_composite_fire(pool, &trigger.id, &now.to_rfc3339()) {
                    tracing::warn!(trigger_id = %trigger.id, "Failed to persist composite fire: {e}");
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

    // Cleanup: use max_window (the largest window_seconds across all composite
    // triggers) as the retention cutoff so we never prune a suppression entry
    // that a trigger still needs. Previously used a hardcoded 3600s which raced
    // with triggers whose window_seconds == 3600.
    let cutoff = now - Duration::seconds(max_window as i64);
    state.last_fired.retain(|_, v| *v > cutoff);
    // Persist the same cutoff to the DB table
    if let Err(e) = trigger_repo::cleanup_composite_fires(pool, &cutoff.to_rfc3339()) {
        tracing::warn!("Failed to cleanup composite fires in DB: {e}");
    }
    // Also clean up stale match results (keep for 2x the max window)
    let match_cutoff = now - Duration::seconds(max_window as i64 * 2);
    state.latest_matches.retain(|_, v| {
        if let Ok(ts) = DateTime::parse_from_rfc3339(&v.evaluated_at) {
            ts.with_timezone(&Utc) > match_cutoff
        } else {
            false
        }
    });
}

// ---------------------------------------------------------------------------
// Detailed evaluation functions
// ---------------------------------------------------------------------------

/// Compute per-condition match status for a set of conditions and events.
fn compute_condition_statuses(
    conditions: &[crate::db::models::CompositeCondition],
    events: &[&crate::db::models::PersonaEvent],
) -> Vec<ConditionStatus> {
    conditions
        .iter()
        .map(|cond| {
            let count = events
                .iter()
                .filter(|e| event_matches_condition(e, cond))
                .count() as u32;
            ConditionStatus {
                event_type: cond.event_type.clone(),
                source_filter: cond.source_filter.clone(),
                matched: count > 0,
                matched_event_count: count,
            }
        })
        .collect()
}

/// ALL (AND): every condition must have at least one matching event in the window.
fn evaluate_all_detailed(
    conditions: &[crate::db::models::CompositeCondition],
    events: &[&crate::db::models::PersonaEvent],
) -> (bool, Vec<ConditionStatus>) {
    let statuses = compute_condition_statuses(conditions, events);
    let fired = statuses.iter().all(|s| s.matched);
    (fired, statuses)
}

/// ANY (OR): at least one condition must have a matching event.
fn evaluate_any_detailed(
    conditions: &[crate::db::models::CompositeCondition],
    events: &[&crate::db::models::PersonaEvent],
) -> (bool, Vec<ConditionStatus>) {
    let statuses = compute_condition_statuses(conditions, events);
    let fired = statuses.iter().any(|s| s.matched);
    (fired, statuses)
}

/// SEQUENCE: all conditions must match events in chronological order.
fn evaluate_sequence_detailed(
    conditions: &[crate::db::models::CompositeCondition],
    events: &[&crate::db::models::PersonaEvent],
) -> (bool, Vec<ConditionStatus>) {
    // First compute basic match counts for all conditions
    let mut statuses = compute_condition_statuses(conditions, events);

    // Now check sequence ordering — a condition may have matching events
    // but not in the right chronological order
    let mut last_time: Option<DateTime<Utc>> = None;
    let mut sequence_broken = false;

    for (i, cond) in conditions.iter().enumerate() {
        if sequence_broken {
            // Once sequence breaks, mark remaining as unmatched for the sequence
            statuses[i].matched = false;
            continue;
        }

        let matched = events.iter().find(|e| {
            if !event_matches_condition(e, cond) {
                return false;
            }
            if let Some(ref lt) = last_time {
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
                statuses[i].matched = true;
            }
            None => {
                statuses[i].matched = false;
                sequence_broken = true;
            }
        }
    }

    let fired = !sequence_broken && !conditions.is_empty();
    (fired, statuses)
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
