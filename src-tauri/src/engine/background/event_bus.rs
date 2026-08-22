use super::SchedulerState;
use crate::db::models::{PersonaEvent, PersonaEventStatus, UpdateExecutionStatus};
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::resources::{tools as tool_repo, triggers as trigger_repo};
use crate::db::DbPool;
use crate::engine::bus;
use crate::engine::event_registry::emit_event_bus;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::AppHandle;

use crate::engine::ExecutionEngine;

// ---------------------------------------------------------------------------
// Tick functions -- single-cycle logic extracted from the old loops.
// Called by the ReactiveSubscription implementations in subscription/.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Event skip-reason ledger
// ---------------------------------------------------------------------------

/// Why the bus reached a decision that did NOT start a real execution for an
/// event.
///
/// Every one of these gates used to `continue` silently, so the terminal row
/// carried a NULL `error_message` and the product could not say why a trigger
/// did not fire. Each variant's [`token`](EventGateReason::token) is written
/// into `persona_events.error_message` and resolved for display by the
/// frontend through `tokenLabel(t, 'event_reason', ...)`. The tokens are
/// language-agnostic identifiers — never emit prose from Rust.
///
/// `error_message` is shared with genuine execution failures; the two uses stay
/// distinguishable by status (failures land on `failed` / `dead_letter` via
/// [`event_repo::increment_retry_or_dead_letter`], gate tokens land on
/// `skipped` / `delivered`, plus the one `dead_letter` cascade-stall case which
/// writes a token rather than prose).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EventGateReason {
    /// No subscription or event_listener matched the event at all.
    NoSubscriber,
    /// A webhook fire on an `approval`-mode trigger, queued into
    /// `pending_trigger_fires` instead of dispatching.
    ApprovalHeld,
    /// A matched persona has the Active/Off toggle set to Off.
    PersonaDisabled,
    /// A handoff EXPLICITLY targeted at a persona that is disabled — the
    /// cascade stalls here, so this one also dead-letters the event.
    HandoffTargetDisabled,
    /// A wildcard (`*`) source filter matched across a team boundary.
    CrossTeamBlocked,
    /// The persona/capability already has a running execution.
    CascadeGuard,
    /// The trigger is in `dry_run` mode — a run WAS launched, but as a
    /// simulation with outbound side-effects suppressed.
    DryRun,
    /// A row stranded in `processing` was reclaimed by the reaper and returned
    /// to `pending` for redelivery.
    StuckReclaimed,
    /// A row stranded in `processing` was reclaimed by the reaper but had
    /// already exhausted its retries, so it went to the dead-letter queue
    /// rather than looping forever.
    StuckRetryExhausted,
}

impl EventGateReason {
    /// The machine token persisted in `persona_events.error_message`.
    pub(crate) const fn token(self) -> &'static str {
        match self {
            Self::NoSubscriber => "no_subscriber",
            Self::ApprovalHeld => "approval_held",
            Self::PersonaDisabled => "persona_disabled",
            Self::HandoffTargetDisabled => "handoff_target_disabled",
            Self::CrossTeamBlocked => "cross_team_blocked",
            Self::CascadeGuard => "cascade_guard",
            Self::DryRun => "dry_run",
            Self::StuckReclaimed => "stuck_reclaimed",
            Self::StuckRetryExhausted => "stuck_retry_exhausted",
        }
    }
}

/// Ordered, de-duplicated set of gate reasons observed while dispatching ONE
/// event. An event can fan out to several matches and hit a different gate on
/// each, so the ledger records all of them in first-seen order.
#[derive(Debug, Default)]
pub(crate) struct EventGateLedger(Vec<EventGateReason>);

impl EventGateLedger {
    pub(crate) fn record(&mut self, reason: EventGateReason) {
        if !self.0.contains(&reason) {
            self.0.push(reason);
        }
    }

    /// Comma-joined token list for `persona_events.error_message`.
    ///
    /// `None` when nothing was gated — an event that dispatched cleanly must
    /// keep a NULL reason so the UI can tell "nothing to explain" apart from
    /// "reason unknown" and never fabricates one.
    pub(crate) fn into_reason(self) -> Option<String> {
        if self.0.is_empty() {
            return None;
        }
        Some(
            self.0
                .iter()
                .map(|r| r.token())
                .collect::<Vec<_>>()
                .join(","),
        )
    }
}

// ---------------------------------------------------------------------------
// Stuck-`processing` reaper
// ---------------------------------------------------------------------------

/// How often the stuck-event reaper takes a snapshot of the `processing` set.
///
/// A row must appear in TWO consecutive snapshots to be reaped, so this is also
/// the minimum time a row must sit in `processing` before it is touched. Five
/// minutes is far above every cadence that legitimately holds a claim: the
/// event bus ticks at 2s active / 10s idle (`subscription.rs`) and the headless
/// daemon claims on a 5s tick, and a tick's own dispatch work is bounded by
/// non-blocking `start_execution` calls. Do not shorten this without a claim
/// timestamp to lean on — a too-short window re-dispatches events a healthy
/// tick is still processing.
pub(crate) const STUCK_EVENT_REAP_INTERVAL: Duration = Duration::from_secs(300);

/// Upper bound on how many `processing` rows one pass inspects. Generous — a
/// healthy install has zero — but bounded so a pathological table cannot make
/// the pass unbounded.
const STUCK_EVENT_REAP_SCAN_LIMIT: i64 = 500;

/// Split the currently-`processing` ids into "reap these" and "watch these".
///
/// A row is reaped only when it was ALSO present on the previous pass, i.e. it
/// has held its claim for at least [`STUCK_EVENT_REAP_INTERVAL`]. Returns
/// `(to_reap, next_seen)`; `next_seen` is the full current set, so a row that
/// survives one pass is eligible on the next.
pub(crate) fn partition_stuck_candidates(
    current: &[String],
    previously_seen: &std::collections::HashSet<String>,
) -> (Vec<String>, std::collections::HashSet<String>) {
    let to_reap: Vec<String> = current
        .iter()
        .filter(|id| previously_seen.contains(*id))
        .cloned()
        .collect();
    let next_seen = current.iter().cloned().collect();
    (to_reap, next_seen)
}

/// Return events stranded in `processing` to the queue.
///
/// `claim_pending` flips `pending -> processing` atomically so a tick cannot
/// double-claim, but nothing ever returned a claimed row the tick failed to
/// finish: retention exempts `processing` as in-flight and the terminal writes
/// below are best-effort, so a crash (or a failed status UPDATE) between claim
/// and terminal write left the event invisible forever.
///
/// This is INSURANCE, not a realised loss — the operator's live DB has zero
/// `processing` rows. It is deliberately conservative: two consecutive
/// sightings before touching anything, one atomic guarded UPDATE per row so the
/// owning tick always wins a race, and `retry_count` incremented on every reap
/// so a poisoned event dead-letters instead of cycling forever.
///
/// Runs from the event-bus tick (engine boot onwards, then every
/// [`STUCK_EVENT_REAP_INTERVAL`]) rather than a fresh `tokio::spawn`, layering
/// on the existing `EventBusSubscription` loop.
pub(crate) fn reap_stuck_processing_events(scheduler: &SchedulerState, pool: &DbPool) {
    let now_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
    let last_ms = scheduler.stuck_reap_last_ms.load(Ordering::Relaxed);
    let interval_ms = STUCK_EVENT_REAP_INTERVAL.as_millis() as u64;
    // last_ms == 0 → never run; take the boot snapshot immediately.
    if last_ms != 0 && now_ms.saturating_sub(last_ms) < interval_ms {
        return;
    }
    scheduler
        .stuck_reap_last_ms
        .store(now_ms, Ordering::Relaxed);

    let current = match event_repo::list_processing_ids(pool, STUCK_EVENT_REAP_SCAN_LIMIT) {
        Ok(ids) => ids,
        Err(e) => {
            tracing::error!(
                "Stuck-event reaper: failed to list processing events: {}",
                e
            );
            return;
        }
    };

    let (to_reap, next_seen) = {
        let mut seen = scheduler
            .stuck_reap_seen
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let (to_reap, next_seen) = partition_stuck_candidates(&current, &seen);
        *seen = next_seen.clone();
        (to_reap, next_seen)
    };

    if to_reap.is_empty() {
        if !next_seen.is_empty() {
            tracing::debug!(
                watching = next_seen.len(),
                "Stuck-event reaper: events still claimed; eligible next pass if unchanged"
            );
        }
        return;
    }

    let mut redelivered = 0u64;
    let mut dead_lettered = 0u64;
    let mut raced = 0u64;
    for id in &to_reap {
        match event_repo::reap_stuck_processing(
            pool,
            id,
            event_repo::DEFAULT_MAX_RETRIES,
            EventGateReason::StuckReclaimed.token(),
            EventGateReason::StuckRetryExhausted.token(),
        ) {
            Ok(Some(event_repo::StuckReapOutcome::Redelivered)) => redelivered += 1,
            Ok(Some(event_repo::StuckReapOutcome::DeadLettered)) => dead_lettered += 1,
            // The owning tick finished between the snapshot and the write —
            // exactly the race the `WHERE status = 'processing'` guard exists
            // for. Not an error.
            Ok(None) => raced += 1,
            Err(e) => tracing::error!(event_id = %id, "Stuck-event reaper: reap failed: {}", e),
        }
    }

    let reaped = redelivered + dead_lettered;
    if reaped > 0 {
        scheduler.events_reaped.fetch_add(reaped, Ordering::Relaxed);
        // WARN, not INFO: a non-zero count means ticks are dying between
        // claiming an event and writing its outcome. Surfaced on
        // `SchedulerStats.events_reaped` too, so it is never silent.
        tracing::warn!(
            redelivered,
            dead_lettered,
            raced,
            "Stuck-event reaper: reclaimed {} event(s) stranded in 'processing'",
            reaped
        );
    }
}

/// One tick of the event bus: fetch pending events, match to subscriptions,
/// and dispatch executions.
///
/// Uses batch pre-fetching to minimize SQLite queries: instead of querying
/// per-event and per-match, we bulk-fetch subscriptions, listeners, personas,
/// and tools for the entire tick cycle (~3 queries instead of ~350).
pub(crate) async fn event_bus_tick(
    scheduler: &SchedulerState,
    app: &AppHandle,
    pool: &DbPool,
    engine: &ExecutionEngine,
) {
    // System-op automations: run any due *schedule* automations on this tick.
    // Reuses the bus loop's cadence (2s active / 10s idle) — ample resolution
    // for cron-grained system ops like the weekly context-scan. See
    // `engine/system_ops.rs`.
    crate::engine::system_ops::run_due_schedule_automations(app, pool);

    // 0. Return events stranded in `processing` to the queue. Self-throttled to
    //    STUCK_EVENT_REAP_INTERVAL, and runs BEFORE the early-return below so a
    //    strand is still reaped on an otherwise idle bus. Hosted here rather
    //    than in a fresh task so it inherits the EventBusSubscription's
    //    leadership gate and panic boundary.
    reap_stuck_processing_events(scheduler, pool);

    // 1. Atomically claim pending events (SET status='processing' WHERE status='pending')
    //    This prevents duplicate processing when ticks overlap.
    let events = match event_repo::claim_pending(pool, 50) {
        Ok(e) => e,
        Err(e) => {
            tracing::error!("Event bus poll error: {}", e);
            return;
        }
    };

    // Push fan-out burst drain (Direction 3): a FULL batch means more events
    // are likely still pending, but `Notify` permits coalesce — a 200-event
    // burst fires many notifies that collapse into ~1 stored permit, so
    // without re-arming, batches 3+ would wait a whole poll interval each
    // (~2s per 50 events). Re-arm the wake signal so the scheduler loop runs
    // the next tick back-to-back until an under-full batch signals the burst
    // is drained. Claim atomicity (pending→processing above) makes redundant
    // wakes harmless.
    if events.len() == 50 {
        crate::engine::subscription::event_bus_wake_signal().notify_one();
    }

    if events.is_empty() {
        // No pending events — check if any executions are running to set idle mode.
        // This is a cheap query that lets subscriptions reduce their polling cadence.
        let has_running = exec_repo::has_running_executions(pool).unwrap_or(false);
        scheduler.set_active(has_running);
        return;
    }
    // Events are pending — system is definitely active
    scheduler.set_active(true);

    // System-op *event* automations react to the same bus events personas do
    // (e.g. a context-scan that fires on a custom event). Runs alongside the
    // persona-dispatch path below; the helper skips scan lifecycle events to
    // avoid self-triggering loops.
    crate::engine::system_ops::dispatch_event_automations(app, pool, &events);

    // 2. Collect unique event types for batch queries
    let event_types: Vec<String> = {
        let mut types: Vec<String> = events.iter().map(|e| e.event_type.clone()).collect();
        types.sort();
        types.dedup();
        types
    };

    // 3. Bulk-fetch all subscriptions and listeners for these event types (2 queries)
    //    Subscriptions: fetch the full enabled set and let `bus::match_event`
    //    filter by CANONICAL event type. An exact `event_type IN (...)` pre-filter
    //    silently dropped subscriptions whose separator style differed from the
    //    emitted event (`code_review.completed` vs `code-review.completed`), so
    //    downstream steps starved. The set is small; canonical matching is in bus.
    let all_subs = match event_repo::get_all_enabled_subscriptions(pool) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("Event bus: bulk subscription fetch failed: {}", e);
            // Fall through with empty — individual events will be marked skipped
            Vec::new()
        }
    };
    // Listeners: like subscriptions above, fetch the full active set and let
    // `bus::match_event` / `ParsedTrigger::is_eligible` filter by CANONICAL
    // event type. The previous `json_extract(...) IN (event_types)` pre-filter
    // was an EXACT string compare, so a canvas-built listener stored as
    // `code_review.completed` silently never matched an emitted
    // `code-review.completed` (subscription-backed listeners were masked by
    // their dual-written legacy subscription; purely canvas-created ones had no
    // safety net). The active event_listener set is small; canonical matching
    // now happens in the bus, exactly mirroring the subscription path.
    let all_listeners =
        trigger_repo::get_enabled_by_type(pool, "event_listener").unwrap_or_default();

    tracing::debug!(
        event_count = events.len(),
        event_types = event_types.len(),
        subscriptions = all_subs.len(),
        listeners = all_listeners.len(),
        "Event bus: batch pre-fetch complete"
    );

    // 4. Pre-parse trigger configs once (avoids re-deserializing JSON per event).
    let parsed_listeners: Vec<bus::ParsedTrigger<'_>> =
        all_listeners.iter().map(bus::ParsedTrigger::new).collect();

    // 5. Match all events against the pre-fetched subscriptions/listeners
    //    and collect (event_index, matches) pairs.
    let mut event_matches: Vec<(usize, Vec<bus::EventMatch>)> = Vec::new();
    for (idx, event) in events.iter().enumerate() {
        // Status already set to 'processing' by claim_pending — no separate update needed.

        // Match against legacy subscriptions + event_listener triggers, then
        // prefer capability-scoped over persona-wide for the same persona
        // (Phase C4 §event-routing). The helper also dedupes on
        // `(persona_id, use_case_id)` so the legacy-subs + trigger-rows merge
        // doesn't double-fire a capability-scoped handler.
        let mut combined = bus::match_event(event, &all_subs);
        combined.extend(bus::match_event(event, &parsed_listeners));
        let matches = bus::prefer_capability_scoped(combined);

        tracing::debug!(
            event_id = %event.id,
            event_type = %event.event_type,
            match_count = matches.len(),
            "Event bus: matching complete"
        );

        if matches.is_empty() {
            tracing::info!(
                event_id = %event.id,
                event_type = %event.event_type,
                "Event bus: no subscriber matches -- marking as skipped (no consumers)"
            );
            // No consumers → Skipped, not Delivered. Recording a no-subscriber
            // event as "Delivered" (and counting it toward events_delivered)
            // was success theater: it inflated the delivery stat and made a
            // dead / misrouted trigger look like it was successfully handled.
            // It's still counted in events_processed (it was processed), just
            // not as a delivery.
            //
            // The reason column carries the `no_subscriber` token so the Live
            // Stream / Dead Letter tabs can say WHY nothing ran — a bare
            // `skipped` with a NULL reason is exactly the state 22 rows in the
            // operator's live DB were stuck in.
            let _ = event_repo::update_status(
                pool,
                &event.id,
                PersonaEventStatus::Skipped,
                Some(EventGateReason::NoSubscriber.token().to_string()),
            );
            scheduler.events_processed.fetch_add(1, Ordering::Relaxed);
            emit_event_to_frontend(app, event, PersonaEventStatus::Skipped);
        } else {
            event_matches.push((idx, matches));
        }
    }

    if event_matches.is_empty() {
        return;
    }

    // 5. Collect unique persona IDs across all matches for bulk persona + tool fetch
    let persona_ids: Vec<String> = {
        let mut ids: Vec<String> = event_matches
            .iter()
            .flat_map(|(_, matches)| matches.iter().map(|m| m.persona_id.clone()))
            .collect();
        // Also fetch each event's source persona so the cross-team bleed guard
        // can compare home teams — the source may not be among matched personas.
        for (idx, _) in &event_matches {
            let ev = &events[*idx];
            if ev.source_type.starts_with("persona:") {
                if let Some(src) = ev.source_id.clone() {
                    ids.push(src);
                }
            }
        }
        ids.sort();
        ids.dedup();
        ids
    };

    // 6. Bulk-fetch personas (1 query)
    let persona_map: HashMap<String, crate::db::models::Persona> =
        match persona_repo::get_by_ids(pool, &persona_ids) {
            Ok(personas) => personas.into_iter().map(|p| (p.id.clone(), p)).collect(),
            Err(e) => {
                tracing::error!("Event bus: bulk persona fetch failed: {}", e);
                HashMap::new()
            }
        };

    // 7. Bulk-fetch tools for all matched personas (1 query)
    let tools_map: HashMap<String, Vec<crate::db::models::PersonaToolDefinition>> = {
        let pairs = tool_repo::get_tools_for_personas(pool, &persona_ids).unwrap_or_default();
        let mut map: HashMap<String, Vec<crate::db::models::PersonaToolDefinition>> =
            HashMap::new();
        for (pid, def) in pairs {
            map.entry(pid).or_default().push(def);
        }
        map
    };

    tracing::debug!(
        personas_fetched = persona_map.len(),
        personas_with_tools = tools_map.len(),
        "Event bus: batch persona/tool fetch complete"
    );

    // 8. Dispatch executions using the pre-fetched maps
    for (idx, matches) in &event_matches {
        let event = &events[*idx];
        let mut any_failed = false;
        // Why this event did (or did not) produce runs. Written into
        // `persona_events.error_message` as machine tokens at the terminal
        // status write below, so every silent `continue` in this loop leaves a
        // readable trace instead of a NULL reason.
        let mut gates = EventGateLedger::default();

        // Destructive-action gate for WEBHOOK-fired triggers (UAT F-MAJOR-11:
        // the approval/dry_run gate only covered scheduler triggers, leaving
        // exactly the external-ingress type an alert/ticket automation uses
        // ungated). Scheduler triggers hold at their tick (pre-publish); a
        // webhook publishes its event directly, so the `approval` hold happens
        // here — once per event, before any match dispatches. On approval,
        // `resolve_pending_trigger_fire` re-publishes as source_type "trigger",
        // which flows through normally (and never re-enters this webhook branch).
        if event.source_type == "webhook" {
            if let Some(trig) = event
                .source_id
                .as_deref()
                .and_then(|sid| trigger_repo::get_by_id(pool, sid).ok())
            {
                if trig.unattended_mode == "approval" {
                    match trigger_repo::insert_pending_fire(
                        pool,
                        &trig.id,
                        &trig.persona_id,
                        &event.event_type,
                        event.payload.as_deref(),
                        trig.use_case_id.as_deref(),
                    ) {
                        Ok(pf) => tracing::info!(
                            trigger_id = %trig.id,
                            persona_id = %trig.persona_id,
                            pending_id = %pf.id,
                            "Webhook trigger in approval mode — fire held for human approval (no execution)"
                        ),
                        Err(e) => tracing::error!(
                            trigger_id = %trig.id,
                            "Failed to hold webhook fire for approval: {}", e
                        ),
                    }
                    // The held event must reach a TERMINAL status here. This
                    // branch used to `continue` straight out of the dispatch
                    // loop without any status write, stranding the row in
                    // `processing` forever: never delivered, never retried,
                    // exempt from retention (`events.rs` cleanup skips
                    // in-flight rows) and invisible to both the pending and
                    // dead-letter counts. Approval republishes a NEW event
                    // (`resolve_pending_trigger_fire`), so `skipped` with an
                    // `approval_held` reason is the honest terminal state for
                    // the original.
                    gates.record(EventGateReason::ApprovalHeld);
                    let _ = event_repo::update_status(
                        pool,
                        &event.id,
                        PersonaEventStatus::Skipped,
                        gates.into_reason(),
                    );
                    emit_event_to_frontend(app, event, PersonaEventStatus::Skipped);
                    scheduler.events_processed.fetch_add(1, Ordering::Relaxed);
                    continue;
                }
            }
        }

        // Breadcrumb: set when a handoff EXPLICITLY targeted at a persona is
        // dropped because that persona is disabled. The bus marks the event
        // `delivered` either way, so without this a stalled cascade is invisible
        // (delivered + no execution, no error). health-lint catches this pre-run;
        // this carries the reason onto the event at runtime.
        let mut dropped_disabled_target = false;

        for m in matches {
            // Resolve persona from map
            let persona = match persona_map.get(&m.persona_id) {
                Some(p) => p.clone(),
                None => {
                    tracing::warn!(persona_id = %m.persona_id, "Event bus: persona not found in batch");
                    any_failed = true;
                    continue;
                }
            };

            // Honour the persona Active/Off toggle. The header switch sets
            // personas.enabled = 0; without this guard the event-bus path
            // happily dispatched executions to disabled personas because the
            // get_subscriptions / get_event_listeners SQL paths never joined
            // on personas.enabled. Skip silently — no DLQ, no retry — the
            // user explicitly turned the agent off.
            if !persona.enabled {
                // A handoff explicitly targeted at this (disabled) persona is a
                // dropped cascade step — the chain stalls here. Mark it so the
                // delivered event carries WHY no execution followed. An untargeted
                // fan-out reaching a disabled persona is an ordinary skip (the user
                // turned that agent off on purpose) and stays a quiet info log.
                if event.target_persona_id.as_deref() == Some(persona.id.as_str()) {
                    dropped_disabled_target = true;
                    gates.record(EventGateReason::HandoffTargetDisabled);
                    tracing::warn!(
                        persona_id = %persona.id,
                        persona_name = %persona.name,
                        event_type = %event.event_type,
                        "Event bus: DROPPED handoff — target persona is disabled; cascade stalls here (enable it to resume)"
                    );
                } else {
                    gates.record(EventGateReason::PersonaDisabled);
                    tracing::info!(
                        persona_id = %persona.id,
                        persona_name = %persona.name,
                        event_type = %event.event_type,
                        "Event bus: skipping — persona is disabled"
                    );
                }
                continue;
            }

            // Cross-team bleed guard. Adoption wires intra-team subscriptions
            // with source_filter "*"; in a multi-team / multi-repo deployment
            // that lets one team's event (e.g. ai-bookkeeper's release.published)
            // wake every team's matching persona, which then refuses the
            // off-repo work and burns a precondition_failed run. Suppress a
            // wildcard match that crosses a team boundary (same-team, explicit
            // filters, and teamless personas are untouched).
            if event.source_type.starts_with("persona:") {
                let src_home = event
                    .source_id
                    .as_deref()
                    .and_then(|sid| persona_map.get(sid))
                    .and_then(|p| p.home_team_id.as_deref());
                if bus::is_cross_team_wildcard_bleed(
                    m.source_filter.as_deref(),
                    persona.home_team_id.as_deref(),
                    src_home,
                ) {
                    gates.record(EventGateReason::CrossTeamBlocked);
                    tracing::info!(
                        persona_id = %persona.id,
                        persona_name = %persona.name,
                        source_id = ?event.source_id,
                        event_type = %event.event_type,
                        "Event bus: skipping — cross-team wildcard bleed suppressed"
                    );
                    continue;
                }
            }

            // Cascade guard. Scope it to the capability when the match is
            // capability-scoped so a legitimate UC1→UC2 chain in the same
            // persona isn't blocked by UC1 still completing when its
            // emitted event lands. Persona-wide matches keep the original
            // per-persona guard (no use_case to disambiguate).
            let running_count = match m.use_case_id.as_deref() {
                Some(uc_id) => {
                    exec_repo::get_running_count_for_persona_use_case(pool, &persona.id, uc_id)
                        .unwrap_or(0)
                }
                None => exec_repo::get_running_count_for_persona(pool, &persona.id).unwrap_or(0),
            };
            if running_count > 0 {
                gates.record(EventGateReason::CascadeGuard);
                tracing::info!(
                    persona_id = %persona.id,
                    persona_name = %persona.name,
                    use_case_id = ?m.use_case_id,
                    running_count = running_count,
                    event_type = %event.event_type,
                    "Event bus: skipping — capability already has running execution (cascade guard)"
                );
                continue;
            }

            // Destructive-action gate (UAT P5 + F-MAJOR-11): a trigger in
            // `dry_run` mode launches the run as a SIMULATION so outbound
            // side-effects are suppressed (dispatch skips real notification/
            // connector delivery for is_simulation runs). Covers BOTH the
            // scheduler path (source_type == "trigger") and external webhook
            // fires (source_type == "webhook") — each carries the firing
            // trigger id in source_id. (`approval` for webhook is held above,
            // before this point; for the scheduler it's held at tick time.)
            let dry_run = matches!(event.source_type.as_str(), "trigger" | "webhook")
                && event
                    .source_id
                    .as_deref()
                    .and_then(|sid| trigger_repo::get_by_id(pool, sid).ok())
                    .map(|t| t.unattended_mode == "dry_run")
                    .unwrap_or(false);

            // Create execution record (must be per-match, not batchable)
            let create_result = if dry_run {
                exec_repo::create_with_idempotency(
                    pool,
                    &persona.id,
                    None,
                    m.payload.clone(),
                    None,
                    m.use_case_id.clone(),
                    None,
                    true, // is_simulation
                )
            } else {
                exec_repo::create(
                    pool,
                    &persona.id,
                    None,
                    m.payload.clone(),
                    None,
                    m.use_case_id.clone(),
                )
            };
            let exec = match create_result {
                Ok(e) => e,
                Err(e) => {
                    tracing::error!("Event bus: failed to create execution: {}", e);
                    any_failed = true;
                    continue;
                }
            };
            if dry_run {
                gates.record(EventGateReason::DryRun);
                tracing::info!(
                    persona_id = %persona.id,
                    execution_id = %exec.id,
                    "Event bus: trigger in dry_run mode — launched as simulation (outbound suppressed)"
                );
            }

            // Resolve tools from map
            let tools = tools_map.get(&persona.id).cloned().unwrap_or_default();

            // Parse input — log on failure since chain_trace_id is embedded in the payload JSON.
            // A parse failure here means the chain trace ID is lost and downstream
            // chain executions will create orphaned trace roots.
            let parsed_payload: Option<serde_json::Value> =
                m.payload
                    .as_deref()
                    .and_then(|s| match serde_json::from_str(s) {
                        Ok(v) => Some(v),
                        Err(parse_err) => {
                            tracing::warn!(
                                event_id = %event.id,
                                persona_id = %m.persona_id,
                                payload_len = s.len(),
                                error = %parse_err,
                                "Event bus: payload JSON parse failed — chain trace correlation \
                                 will break if this event is part of a chain cascade"
                            );
                            scheduler
                                .trace_continuity_breaks
                                .fetch_add(1, Ordering::Relaxed);
                            None
                        }
                    });

            // Wrap the payload with `_event` metadata so the persona prompt
            // (see engine/prompt.rs `## Triggering Event` block) can show the
            // firing event_type + source. Without this, the persona has no
            // way to route behavior per-event. `source_persona_id` is set only
            // when the source_id refers to an actual persona row.
            let source_persona_id = event.source_id.as_ref().and_then(|sid| {
                match crate::db::repos::core::personas::get_by_id(pool, sid) {
                    Ok(_) => Some(sid.clone()),
                    Err(_) => None,
                }
            });
            let mut event_meta = serde_json::Map::new();
            event_meta.insert(
                "event_type".into(),
                serde_json::Value::String(event.event_type.clone()),
            );
            event_meta.insert(
                "source_type".into(),
                serde_json::Value::String(event.source_type.clone()),
            );
            if let Some(sid) = &event.source_id {
                event_meta.insert("source_id".into(), serde_json::Value::String(sid.clone()));
            }
            if let Some(spid) = &source_persona_id {
                event_meta.insert(
                    "source_persona_id".into(),
                    serde_json::Value::String(spid.clone()),
                );
            }
            if let Some(tpid) = &event.target_persona_id {
                event_meta.insert(
                    "target_persona_id".into(),
                    serde_json::Value::String(tpid.clone()),
                );
            }
            let input_val: Option<serde_json::Value> = Some(serde_json::json!({
                "_event": serde_json::Value::Object(event_meta),
                "payload": parsed_payload.unwrap_or(serde_json::Value::Null),
            }));

            // Start execution (admit() handles concurrency atomically --
            //    no separate has_capacity check to avoid TOCTOU gap)
            if let Err(e) = engine
                .start_execution(
                    app.clone(),
                    pool.clone(),
                    exec.id.clone(),
                    persona,
                    tools,
                    input_val,
                    None,
                )
                .await
            {
                tracing::error!(execution_id = %exec.id, "Event bus: failed to start execution: {}", e);
                crate::engine::persist_status_update(
                    pool,
                    Some(app),
                    &exec.id,
                    UpdateExecutionStatus {
                        status: crate::engine::types::ExecutionState::Failed,
                        error_message: Some(e.to_string()),
                        ..Default::default()
                    },
                )
                .await;
                any_failed = true;
                continue;
            }

            scheduler.events_delivered.fetch_add(1, Ordering::Relaxed);
        }

        // Machine tokens for every gate this event hit, or `None` when it
        // dispatched cleanly. Computed once — the branches below are mutually
        // exclusive and each consumes it at most once.
        let gate_reason = gates.into_reason();

        if any_failed {
            // Use DLQ pattern: increment retry count, move to dead_letter after max retries
            let max_retries = event_repo::DEFAULT_MAX_RETRIES;
            match event_repo::increment_retry_or_dead_letter(
                pool,
                &event.id,
                Some("One or more subscription executions failed".into()),
                max_retries,
            ) {
                Ok(moved_to_dlq) => {
                    let status = if moved_to_dlq {
                        PersonaEventStatus::DeadLetter
                    } else {
                        PersonaEventStatus::Failed
                    };
                    if moved_to_dlq {
                        tracing::warn!(
                            event_id = %event.id,
                            event_type = %event.event_type,
                            "Event moved to dead letter queue after {} retries",
                            max_retries,
                        );
                    }
                    emit_event_to_frontend(app, event, status);
                }
                Err(e) => {
                    tracing::error!(event_id = %event.id, "Failed to update DLQ status: {}", e);
                }
            }
        } else if dropped_disabled_target {
            // A targeted handoff to a disabled persona is a STALLED cascade — no
            // execution follows and the chain dead-ends here. Mark it DeadLetter
            // (not Delivered) so it surfaces in the Dead-Letter tab instead of
            // looking healthy; retrying is pointless until the user re-enables the
            // persona, so DeadLetter (manual replay) is correct, not Failed
            // (auto-retry churn). (UAT F-TEAM-STALL-INVISIBLE.)
            //
            // This used to go through `update_status`, which validates against
            // `PersonaEventStatus::can_transition_to` — and that table has NO
            // `Processing -> DeadLetter` edge. So the write ALWAYS failed
            // validation, was swallowed by `let _ =`, and the row stayed
            // `processing` forever while the frontend was told "dead_letter".
            // `dead_letter_from_processing` is the guarded write for exactly
            // this transition. The prose note is replaced by the
            // `handoff_target_disabled` machine token (resolved for display by
            // the frontend) so the DLQ reason is language-agnostic like every
            // other status token.
            match event_repo::dead_letter_from_processing(pool, &event.id, gate_reason) {
                Ok(true) => emit_event_to_frontend(app, event, PersonaEventStatus::DeadLetter),
                Ok(false) => tracing::warn!(
                    event_id = %event.id,
                    "Event bus: stalled-handoff dead-letter skipped — event no longer 'processing'"
                ),
                Err(e) => tracing::error!(
                    event_id = %event.id,
                    "Event bus: failed to dead-letter stalled handoff: {}", e
                ),
            }
        } else {
            let _ = event_repo::update_status(
                pool,
                &event.id,
                PersonaEventStatus::Delivered,
                gate_reason,
            );
            emit_event_to_frontend(app, event, PersonaEventStatus::Delivered);
        }
        scheduler.events_processed.fetch_add(1, Ordering::Relaxed);
    }

    // Durable usage-limit retries: dispatch any whose reset time has passed.
    // Lives on this tick because it's the engine-aware loop with the right
    // cadence (2s active / 10s idle); the table itself is written by the
    // healing paths (HealingAction::RetryAt).
    engine.drain_due_scheduled_retries(app, pool).await;
}

/// Emit event update to frontend for realtime visualization.
fn emit_event_to_frontend(app: &AppHandle, event: &PersonaEvent, status: PersonaEventStatus) {
    let mut payload = event.clone();
    payload.status = status;
    payload.processed_at = Some(chrono::Utc::now().to_rfc3339());

    emit_event_bus(app, &payload);
}
