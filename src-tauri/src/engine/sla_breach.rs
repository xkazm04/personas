//! SLA breach events — the emission half of reliability-breach detection.
//!
//! The detection *reads* and the enter-once/recover state machine are pure and
//! live in [`crate::db::repos::communication::sla`]. This module wires them to
//! the execution-completion path: on every terminal execution,
//! [`evaluate_on_completion`] reads a bounded per-persona signal, consults the
//! durable episode row, and — only on a genuine state crossing — publishes a
//! typed event into the existing persona-event bus so it surfaces in the
//! Events / Incidents surfaces and can feed healing.
//!
//! **Zero-config by product decision (2026-07-14):** no `sla_targets` table, no
//! authoring UI, no settings surface. Thresholds are conservative constants in
//! the `sla` repo, tuned so false-positive noise (the real failure mode) stays
//! near zero.
//!
//! **Episode de-duplication.** `sla_breach_episodes` holds one durable row per
//! persona. A breach emits exactly ONE `sla.breach.opened`; subsequent failing
//! runs are no-ops while the episode is open. Crossing back to healthy emits one
//! `sla.breach.recovered` and closes the episode. Because the state is a table,
//! a restart mid-episode never re-announces an already-open breach.

use serde::Serialize;
use tauri::AppHandle;
use ts_rs::TS;

use crate::db::models::CreatePersonaEventInput;
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::communication::sla;
use crate::db::repos::core::personas as persona_repo;
use crate::db::DbPool;
use crate::engine::event_registry::emit_event_bus;

/// Bus event type published when a persona crosses INTO a reliability breach.
pub const EVENT_SLA_BREACH_OPENED: &str = "sla.breach.opened";
/// Bus event type published when a breached persona crosses back to healthy.
pub const EVENT_SLA_BREACH_RECOVERED: &str = "sla.breach.recovered";

/// Payload carried by both SLA breach bus events. Serialized into the event's
/// `payload` column (JSON) and picked up by the Events feed / Incidents surface.
/// Carries enough for a healing recommendation without a second lookup:
/// `persona_id`, the `reason` token, and the streak / rate that tripped it.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SlaBreachEventPayload {
    pub persona_id: String,
    pub persona_name: String,
    /// `"opened"` | `"recovered"`.
    pub state: String,
    /// Reason token: `"consecutive_failures"` | `"low_success_rate"`. On a
    /// recovery event this echoes the reason the episode originally opened with.
    pub reason: String,
    /// Leading consecutive-failure streak at the time of observation.
    #[ts(type = "number")]
    pub consecutive_failures: i64,
    /// Windowed success rate (0.0..=1.0) at the time of observation.
    pub success_rate: f64,
    /// Number of decided runs behind `success_rate` (the sample size).
    #[ts(type = "number")]
    pub decided: i64,
    /// When the episode opened (RFC 3339). Equals `observed_at` on the opened
    /// event; on a recovery event it's the original open time (episode duration
    /// = `observed_at - opened_at`).
    pub opened_at: String,
    /// When this event was observed (RFC 3339).
    pub observed_at: String,
}

/// Evaluate a persona's reliability on the completion path and emit a breach /
/// recovery event iff the episode state crossed. Cheap (one bounded query) and
/// best-effort: any read/write failure is logged and swallowed so it can never
/// break the execution that triggered it.
///
/// Call AFTER the terminal status is persisted and the persona-existence guard
/// has passed. Safe to call on both success and failure completions — recovery
/// is only detectable on the successful runs that clear a streak.
pub fn evaluate_on_completion(pool: &DbPool, app: &AppHandle, persona_id: &str) {
    let sig = match sla::get_persona_breach_signal(pool, persona_id) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(persona_id, error = %e, "sla breach: signal read failed");
            return;
        }
    };
    let episode = sla::get_breach_episode(pool, persona_id).unwrap_or_default();

    match sla::decide(episode.is_open, &sig) {
        sla::BreachDecision::NoOp => {}
        sla::BreachDecision::Open(reason) => {
            let now = chrono::Utc::now().to_rfc3339();
            if let Err(e) = sla::open_breach_episode(pool, persona_id, reason, &sig, &now) {
                tracing::warn!(persona_id, error = %e, "sla breach: open-episode write failed");
                return;
            }
            let persona_name = persona_name(pool, persona_id);
            tracing::warn!(
                persona_id,
                persona_name = %persona_name,
                reason,
                consecutive_failures = sig.consecutive_failures,
                success_rate = sig.success_rate,
                decided = sig.decided,
                "SLA breach opened",
            );
            let payload = SlaBreachEventPayload {
                persona_id: persona_id.to_string(),
                persona_name,
                state: "opened".into(),
                reason: reason.to_string(),
                consecutive_failures: sig.consecutive_failures,
                success_rate: sig.success_rate,
                decided: sig.decided,
                opened_at: now.clone(),
                observed_at: now,
            };
            publish(pool, app, EVENT_SLA_BREACH_OPENED, persona_id, &payload);
        }
        sla::BreachDecision::Recover => {
            let now = chrono::Utc::now().to_rfc3339();
            let reason = episode.reason.clone().unwrap_or_default();
            let opened_at = episode.opened_at.clone().unwrap_or_else(|| now.clone());
            if let Err(e) = sla::close_breach_episode(pool, persona_id, &sig, &now) {
                tracing::warn!(persona_id, error = %e, "sla breach: close-episode write failed");
                return;
            }
            let persona_name = persona_name(pool, persona_id);
            tracing::info!(
                persona_id,
                persona_name = %persona_name,
                success_rate = sig.success_rate,
                decided = sig.decided,
                "SLA breach recovered",
            );
            let payload = SlaBreachEventPayload {
                persona_id: persona_id.to_string(),
                persona_name,
                state: "recovered".into(),
                reason,
                consecutive_failures: sig.consecutive_failures,
                success_rate: sig.success_rate,
                decided: sig.decided,
                opened_at,
                observed_at: now,
            };
            publish(pool, app, EVENT_SLA_BREACH_RECOVERED, persona_id, &payload);
        }
    }
}

/// Best-effort persona-name lookup for the event payload / logs.
fn persona_name(pool: &DbPool, persona_id: &str) -> String {
    persona_repo::get_by_id(pool, persona_id)
        .map(|p| p.name)
        .unwrap_or_default()
}

/// Publish the event into `persona_events` and mirror it onto the live bus so
/// the Events feed updates without a refetch. `source_type = "sla_monitor"` and
/// `target_persona_id = None` keep it a broadcast system event (no persona is
/// woken unless a listener explicitly subscribes to the type).
fn publish(
    pool: &DbPool,
    app: &AppHandle,
    event_type: &str,
    persona_id: &str,
    payload: &SlaBreachEventPayload,
) {
    let payload_json = serde_json::to_string(payload).ok();
    match event_repo::publish(
        pool,
        CreatePersonaEventInput {
            event_type: event_type.into(),
            source_type: "sla_monitor".into(),
            source_id: Some(persona_id.into()),
            target_persona_id: None,
            project_id: None,
            payload: payload_json,
            use_case_id: None,
        },
    ) {
        Ok(event) => emit_event_bus(app, &event),
        Err(e) => tracing::warn!(persona_id, error = %e, "sla breach: event publish failed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_serializes_camel_case() {
        let payload = SlaBreachEventPayload {
            persona_id: "p1".into(),
            persona_name: "Alpha".into(),
            state: "opened".into(),
            reason: "consecutive_failures".into(),
            consecutive_failures: 5,
            success_rate: 0.0,
            decided: 5,
            opened_at: "2026-07-14T00:00:00+00:00".into(),
            observed_at: "2026-07-14T00:00:00+00:00".into(),
        };
        let v = serde_json::to_value(&payload).unwrap();
        // camelCase keys (matches the ts-rs binding) + healing-consumable fields.
        assert_eq!(v["personaId"], "p1");
        assert_eq!(v["consecutiveFailures"], 5);
        assert_eq!(v["reason"], "consecutive_failures");
        assert_eq!(v["state"], "opened");
    }

    #[test]
    fn event_type_constants_are_dotted_canonical() {
        assert_eq!(EVENT_SLA_BREACH_OPENED, "sla.breach.opened");
        assert_eq!(EVENT_SLA_BREACH_RECOVERED, "sla.breach.recovered");
    }
}
