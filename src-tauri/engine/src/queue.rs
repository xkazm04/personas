use std::collections::{HashMap, HashSet, VecDeque};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Default maximum queue depth per persona.
pub const DEFAULT_MAX_QUEUE_DEPTH: usize = 10;

/// Default global maximum concurrent executions across all personas.
pub const GLOBAL_MAX_CONCURRENT: usize = 4;

// =============================================================================
// Priority
// =============================================================================

/// Execution priority levels. Higher priority executions are dequeued first.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionPriority {
    /// Low priority -- background or bulk jobs.
    Low = 0,
    /// Normal priority -- default for all user-triggered executions.
    #[default]
    Normal = 1,
    /// Urgent priority -- healing retries, chain triggers, manual re-runs.
    Urgent = 2,
}

// =============================================================================
// QueuedExecution
// =============================================================================

/// An execution waiting in the per-persona queue.
#[derive(Debug, Clone)]
pub struct QueuedExecution {
    pub execution_id: String,
    pub persona_id: String,
    pub priority: ExecutionPriority,
    pub enqueued_at: std::time::Instant,
    /// Populated when the execution is promoted from the queue via `drain_next`.
    /// Contains the number of milliseconds the execution waited in the queue.
    pub wait_ms: Option<u64>,
    /// Snapshot of the persona's `max_concurrent` at enqueue time.
    /// Used by `drain_next_global` to check per-persona capacity without a DB lookup.
    pub persona_max_concurrent: i32,
    /// Conflict key: the identity two admissions share when they mean the SAME
    /// work (a persona + the machine cause that fired it). `None` for anything
    /// an operator started by hand — see `ConcurrencyTracker::admit`.
    pub key: Option<String>,
}

// =============================================================================
// Enqueue result
// =============================================================================

/// Result of attempting to add an execution (either started or queued).
#[derive(Debug)]
pub enum AdmitResult {
    /// Execution was admitted to a running slot immediately.
    Running,
    /// Execution was queued at the given position (0-indexed).
    ///
    /// `displaced` names the execution evicted to make room, when this
    /// arrival outranked the weakest resident at a full queue. The caller
    /// owes that execution a refusal: an evicted waiter that finds out by
    /// silence is a data-loss bug, not a shed policy.
    Queued {
        position: usize,
        displaced: Option<String>,
    },
    /// Queue is full -- backpressure rejection.
    QueueFull { max_depth: usize },
    /// An execution carrying the SAME conflict key is already in flight
    /// (running, or waiting in this persona's queue). This is a successful,
    /// normal outcome -- a duplicate admission for one cause -- and NOT an
    /// error: it names the execution that holds the key so the caller can
    /// attach the new arrival's provenance to the run that is already going
    /// instead of dropping the event in silence.
    ///
    /// Deliberately evaluated BEFORE the depth verdict, so a duplicate can
    /// never consume the shed policy's displacement rule: displacing a waiter
    /// to make room for its own duplicate is the worst available outcome.
    AlreadyAdmitted { execution_id: String },
}

// =============================================================================
// Conflict key
// =============================================================================

/// Form the admission conflict key for an execution for an execution: the identity two
/// admissions share when they mean the SAME work.
///
/// `None` — no exclusion — is the load-bearing half, and it is the default. A
/// person who presses Run twice may genuinely mean it, so only machine-
/// originated work is deduplicated, and only the machine-originated kind that
/// can fire twice for ONE cause without anyone deciding to.
///
/// The key is read off the event-bus wrapper (`{"_event": …, "payload": …}`)
/// that `background/event_bus.rs` builds, because that is what actually reaches
/// this function. Three conditions, each of which is a correction to the
/// obvious design:
///
/// 1. `_event.source_type == "trigger"` with a `source_id`. `PersonaExecution.
///    trigger_id` is NOT usable here: scheduler-spawned rows carry
///    `trigger_id = NULL` (`background/scheduler.rs:429-433` says so, and the
///    event-bus start path passes `None`), so `_event.source_id` is the only
///    correlation back to the trigger that survives the publish → dispatch hop.
///
/// 2. `payload.trigger_type == "schedule"`. This is the ONE trigger kind whose
///    second fire while the first is still running is a duplicate rather than a
///    new cause, and the tree has already ruled on it: the scheduler skips a
///    schedule fire whose previous run is still active and emits
///    `schedule.skipped.overlap` (`background/scheduler.rs:765-800`). A webhook
///    or polling trigger fires per external event; `_event` carries no event
///    identity, so keying those would collapse distinct runs into one — the
///    data-loss direction, which is much worse than the duplication it prevents.
///    They stay outside the gate, exactly as the direction requires of any kind
///    that has neither an event identity nor a once-per-cause guarantee.
///
/// 3. Not a backfill slot. A replayed missed slot (`backfill_slot`) is an extra
///    run the operator or the catch-up path deliberately asked for, and the
///    scheduler publishes it WITHOUT consulting the overlap policy. Collapsing a
///    backfill into one run would silently undo that feature.
///
/// A schedule trigger with an author-set `payload` carries no `trigger_type`, so
/// it falls out at (2) and runs unguarded. That is the safe direction: this gate
/// fails open toward running.
pub fn admission_conflict_key(
    persona_id: &str,
    input_data: Option<&serde_json::Value>,
) -> Option<String> {
    let input = input_data?;
    let event = input.get("_event")?;
    if event.get("source_type")?.as_str()? != "trigger" {
        return None;
    }
    let source_id = event.get("source_id")?.as_str()?;

    let payload = input.get("payload")?;
    if payload.get("trigger_type").and_then(|v| v.as_str()) != Some("schedule") {
        return None;
    }
    if payload
        .get("backfill_slot")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return None;
    }

    // Unit separators: neither id can contain one, so the key cannot be forged
    // by a persona id that happens to end in a trigger id's prefix.
    Some(format!("{persona_id}\u{1f}trigger\u{1f}{source_id}"))
}

// =============================================================================
// ConcurrencyTracker
// =============================================================================

/// Concurrency tracking + per-persona priority queue with backpressure.
///
/// Tracks which executions are running per persona, enforces
/// max_concurrent limits, and queues overflow with priority ordering.
pub struct ConcurrencyTracker {
    /// Maps persona_id -> set of currently running execution_ids
    running: HashMap<String, HashSet<String>>,
    /// Maps conflict key -> the running execution_id that holds it.
    ///
    /// This is an EXCLUSION, not a resource limit: it answers "is this same
    /// work already in flight", while `has_capacity` / `global_max_concurrent`
    /// answer "can the host afford another process". The two are configured and
    /// evaluated independently, exactly as they are in the peer study's
    /// scheduler, and collapsing them would serialize a persona the operator
    /// deliberately configured for parallelism.
    ///
    /// Lifetime is pinned to `running`: both maps are mutated ONLY in
    /// `add_running` / `remove_running`, so a key cannot outlive the execution
    /// that holds it (which would wedge that persona's trigger silently and
    /// forever). Keeping the key anywhere else would reintroduce that failure.
    running_keys: HashMap<String, String>,
    /// Per-persona waiting queues, ordered by priority then FIFO.
    queues: HashMap<String, VecDeque<QueuedExecution>>,
    /// Maximum queue depth per persona (backpressure threshold).
    max_queue_depth: usize,
    /// Global maximum concurrent executions across all personas.
    /// An execution needs both per-persona AND global capacity to run.
    /// 0 = unlimited (no global cap).
    global_max_concurrent: usize,
    /// Quota-aware admission gate. When `Some(t)` and `now < t`, the AI
    /// provider's session/usage/rate limit was recently hit, so admission is
    /// PAUSED until `t` — new work waits in the per-persona queues instead of
    /// being admitted to run and failing fast against the limit. Set reactively
    /// by the engine when a completed execution failed with a RateLimit/
    /// SessionLimit classification; auto-clears by expiry (a probe execution
    /// after `t` either succeeds → admission resumes, or re-arms the cooldown).
    /// `None` = no limit known → admission unaffected (the common case).
    quota_cooldown_until: Option<DateTime<Utc>>,
    /// Resource-pressure gate. `true` when host CPU/memory load is above the
    /// high-water threshold, so admission is PAUSED — new work waits in the
    /// per-persona queues instead of piling onto a stressed host (which risks an
    /// OOM kill). Set by the periodic resource governor with hysteresis (pause at
    /// the high watermark, resume below the low watermark). Running executions are
    /// never interrupted; only new admissions defer. `false` = load is healthy.
    resource_throttled: bool,
}

impl ConcurrencyTracker {
    /// Create a new empty tracker with default queue depth and global concurrency limit.
    pub fn new() -> Self {
        Self {
            running: HashMap::new(),
            running_keys: HashMap::new(),
            queues: HashMap::new(),
            max_queue_depth: DEFAULT_MAX_QUEUE_DEPTH,
            global_max_concurrent: GLOBAL_MAX_CONCURRENT,
            quota_cooldown_until: None,
            resource_throttled: false,
        }
    }

    /// Create a tracker with a custom max queue depth.
    #[allow(dead_code)]
    pub fn with_max_queue_depth(max_depth: usize) -> Self {
        Self {
            running: HashMap::new(),
            running_keys: HashMap::new(),
            queues: HashMap::new(),
            max_queue_depth: max_depth,
            global_max_concurrent: GLOBAL_MAX_CONCURRENT,
            quota_cooldown_until: None,
            resource_throttled: false,
        }
    }

    /// Update the max queue depth (e.g. when tier changes).
    pub fn set_max_queue_depth(&mut self, depth: usize) {
        self.max_queue_depth = depth;
    }

    /// Return the configured max queue depth.
    pub fn max_queue_depth(&self) -> usize {
        self.max_queue_depth
    }

    /// Update the global maximum concurrent executions.
    #[allow(dead_code)]
    pub fn set_global_max_concurrent(&mut self, max: usize) {
        self.global_max_concurrent = max;
    }

    /// Return the configured global max concurrent limit.
    pub fn global_max_concurrent(&self) -> usize {
        self.global_max_concurrent
    }

    /// Total running executions across all personas.
    pub fn total_running(&self) -> usize {
        self.running.values().map(|set| set.len()).sum()
    }

    /// Check if the global concurrency limit allows another execution.
    /// Returns `true` if unlimited (0) or below the limit.
    pub fn has_global_capacity(&self) -> bool {
        self.global_max_concurrent == 0 || self.total_running() < self.global_max_concurrent
    }

    /// Quota gate: `true` when the AI provider's session/usage/rate limit is NOT
    /// in cooldown (the common case), so admission may proceed. `false` while a
    /// recently-hit limit's cooldown is still in the future — admission pauses.
    pub fn quota_available(&self) -> bool {
        match self.quota_cooldown_until {
            Some(t) => Utc::now() >= t,
            None => true,
        }
    }

    /// Arm (or extend) the quota cooldown: pause admission until `until`. Never
    /// shortens an existing cooldown (takes the later of the two) so a burst of
    /// limit-failures doesn't prematurely lift the pause. Called by the engine
    /// when a completed execution failed against a rate/session limit.
    pub fn set_quota_cooldown(&mut self, until: DateTime<Utc>) {
        self.quota_cooldown_until = Some(match self.quota_cooldown_until {
            Some(existing) if existing > until => existing,
            _ => until,
        });
    }

    /// The current quota cooldown deadline, if any (for observability/UI).
    #[allow(dead_code)]
    pub fn quota_cooldown_until(&self) -> Option<DateTime<Utc>> {
        self.quota_cooldown_until
    }

    /// Resource gate: `true` when host load is below the high-water threshold
    /// (the common case) so admission may proceed; `false` while CPU/memory
    /// pressure is high — admission pauses to avoid piling onto a stressed host.
    pub fn resource_available(&self) -> bool {
        !self.resource_throttled
    }

    /// Set the resource-pressure pause. Called by the periodic resource governor
    /// with hysteresis so a brief spike doesn't flap admission on/off.
    pub fn set_resource_throttled(&mut self, throttled: bool) {
        self.resource_throttled = throttled;
    }

    /// Whether admission is currently paused by resource pressure (for the UI).
    #[allow(dead_code)]
    pub fn resource_throttled(&self) -> bool {
        self.resource_throttled
    }

    /// Total queued executions across all personas.
    pub fn total_queued(&self) -> usize {
        self.queues.values().map(|q| q.len()).sum()
    }

    /// Check if a persona has capacity for another execution.
    ///
    /// `max_concurrent <= 0` means unlimited capacity.
    pub fn has_capacity(&self, persona_id: &str, max_concurrent: i32) -> bool {
        if max_concurrent <= 0 {
            return true;
        }
        let count = self.running_count(persona_id);
        (count as i32) < max_concurrent
    }

    /// Register an execution as running for a persona.
    ///
    /// `key` is the conflict key (see `admit`): `Some(k)` claims the exclusion
    /// for this execution, `None` means this execution participates in no
    /// exclusion at all. The parameter is explicit rather than defaulted so a
    /// new registration site has to decide, which is the only thing keeping the
    /// two maps' lifetimes in step.
    pub fn add_running(&mut self, persona_id: &str, execution_id: &str, key: Option<&str>) {
        self.running
            .entry(persona_id.to_string())
            .or_default()
            .insert(execution_id.to_string());
        if let Some(k) = key {
            self.running_keys
                .insert(k.to_string(), execution_id.to_string());
        }
    }

    /// The execution currently holding `key`, if any (running only).
    pub fn running_key_holder(&self, key: &str) -> Option<&str> {
        self.running_keys.get(key).map(|s| s.as_str())
    }

    /// The queued execution carrying `key` in this persona's queue, if any.
    ///
    /// A linear scan is correct here by construction: the queue is depth-capped
    /// (`DEFAULT_MAX_QUEUE_DEPTH`, 10 by default), so the scan is bounded.
    fn queued_key_holder(&self, persona_id: &str, key: &str) -> Option<&str> {
        self.queues
            .get(persona_id)?
            .iter()
            .find_map(|e| (e.key.as_deref() == Some(key)).then_some(e.execution_id.as_str()))
    }

    /// Atomically check capacity and register an execution.
    ///
    /// Returns `true` if the execution was registered (had capacity).
    /// Returns `false` if at capacity (execution not registered).
    /// This prevents TOCTOU races between `has_capacity` and `add_running`.
    pub fn try_add_running(
        &mut self,
        persona_id: &str,
        execution_id: &str,
        max_concurrent: i32,
    ) -> bool {
        if !self.has_capacity(persona_id, max_concurrent) {
            return false;
        }
        // No conflict key: this is the healing-retry path, which re-runs an
        // execution a person or a policy already decided to retry. It is a
        // resource check, not an admission, and it does not claim the exclusion.
        self.add_running(persona_id, execution_id, None);
        true
    }

    /// Atomically try to run or enqueue an execution.
    ///
    /// 0. If `key` is already in flight (running or queued) -> `AlreadyAdmitted`.
    /// 1. If there's both per-persona AND global capacity -> register as running, return `Running`.
    /// 2. If queue has room -> enqueue with priority, return `Queued { position }`.
    /// 3. If queue is full -> return `QueueFull` (backpressure).
    ///
    /// `key` is the CONFLICT key -- the identity two admissions share when they
    /// mean the same work. It is not `persona_id`: per-persona concurrency is a
    /// resource limit (two CLI processes cost twice the memory and twice the
    /// tokens) and stays exactly as it is. `None` means "this admission is in no
    /// exclusion", and that is the load-bearing half of the design: only
    /// machine-originated work can fire twice for one cause without anyone
    /// deciding to, so an operator pressing Run twice passes `None` and both
    /// runs start.
    pub fn admit(
        &mut self,
        persona_id: &str,
        execution_id: &str,
        max_concurrent: i32,
        priority: ExecutionPriority,
        key: Option<&str>,
    ) -> AdmitResult {
        // Step 0 -- exclusion, BEFORE capacity and BEFORE the depth verdict.
        // Placing it first is what keeps a duplicate out of the shed policy:
        // an `AlreadyAdmitted` must never displace a resident waiter.
        if let Some(k) = key {
            if let Some(holder) = self.running_key_holder(k) {
                let holder = holder.to_string();
                tracing::debug!(
                    persona_id = persona_id,
                    execution_id = execution_id,
                    holder = %holder,
                    conflict_key = k,
                    "Admission refused as duplicate — an execution for this cause is already running"
                );
                return AdmitResult::AlreadyAdmitted {
                    execution_id: holder,
                };
            }
            if let Some(holder) = self.queued_key_holder(persona_id, k) {
                let holder = holder.to_string();
                tracing::debug!(
                    persona_id = persona_id,
                    execution_id = execution_id,
                    holder = %holder,
                    conflict_key = k,
                    "Admission refused as duplicate — an execution for this cause is already queued"
                );
                return AdmitResult::AlreadyAdmitted {
                    execution_id: holder,
                };
            }
        }

        // Try to run immediately — need per-persona AND global capacity AND the
        // provider quota not be in cooldown. When a session/usage/rate limit was
        // recently hit, `quota_available()` is false → fall through to enqueue so
        // the work WAITS rather than running straight into the limit and failing.
        let persona_ok = self.has_capacity(persona_id, max_concurrent);
        let global_ok = self.has_global_capacity();
        let quota_ok = self.quota_available();
        let resource_ok = self.resource_available();

        if persona_ok && global_ok && quota_ok && resource_ok {
            self.add_running(persona_id, execution_id, key);
            return AdmitResult::Running;
        }
        if persona_ok && global_ok && (!quota_ok || !resource_ok) {
            tracing::debug!(
                persona_id = persona_id,
                execution_id = execution_id,
                quota_held = !quota_ok,
                resource_held = !resource_ok,
                "Admission held (quota cooldown or resource pressure) — enqueuing instead of running"
            );
        }

        // Check backpressure. Depth alone cannot decide this: a queue that
        // carries priority levels but consults them only when choosing an
        // insertion point has a refuse-newest shed policy regardless of what
        // the levels say, because the gate that refuses never sees the class.
        // Reject-by-class needs the class evaluated BEFORE the depth verdict,
        // and it needs a displacement rule -- the comparison alone is the easy
        // half.
        let queue = self.queues.entry(persona_id.to_string()).or_default();
        let mut displaced: Option<String> = None;
        if queue.len() >= self.max_queue_depth {
            // The queue is held in descending priority order, FIFO within a
            // level, so the back is the lowest-ranked entry and the newest
            // among its equals -- the correct victim on both counts. A strict
            // `<` keeps refuse-newest for an arrival that does not outrank it.
            match queue.back() {
                Some(weakest) if weakest.priority < priority => {
                    let evicted = queue.pop_back().expect("back() was Some");
                    displaced = Some(evicted.execution_id);
                }
                _ => {
                    return AdmitResult::QueueFull {
                        max_depth: self.max_queue_depth,
                    };
                }
            }
        }

        // Insert into queue respecting priority (higher priority = closer to front)
        let entry = QueuedExecution {
            execution_id: execution_id.to_string(),
            persona_id: persona_id.to_string(),
            priority,
            enqueued_at: std::time::Instant::now(),
            wait_ms: None,
            persona_max_concurrent: max_concurrent,
            key: key.map(str::to_string),
        };

        // Find insertion point: after all entries with >= priority (FIFO within same priority)
        let pos = queue
            .iter()
            .position(|e| e.priority < priority)
            .unwrap_or(queue.len());
        queue.insert(pos, entry);

        AdmitResult::Queued {
            position: pos,
            displaced,
        }
    }

    /// Remove an execution from the running set.
    /// Cleans up the persona entry if no executions remain.
    ///
    /// Releases this execution's conflict key on the SAME call that releases its
    /// slot. A key that outlives its execution wedges that persona's trigger
    /// silently and forever, so the release is by execution id (not by key):
    /// every path that can free a slot -- including the cleanup after a panicked
    /// task -- frees the key with it, and no caller has to remember one.
    pub fn remove_running(&mut self, persona_id: &str, execution_id: &str) {
        if let Some(set) = self.running.get_mut(persona_id) {
            set.remove(execution_id);
            if set.is_empty() {
                self.running.remove(persona_id);
            }
        }
        self.running_keys.retain(|_, held| held != execution_id);
    }

    /// Remove a queued execution (e.g., on cancellation).
    /// Returns true if the execution was found and removed.
    pub fn remove_queued(&mut self, persona_id: &str, execution_id: &str) -> bool {
        if let Some(queue) = self.queues.get_mut(persona_id) {
            let before = queue.len();
            queue.retain(|e| e.execution_id != execution_id);
            let removed = queue.len() < before;
            if queue.is_empty() {
                self.queues.remove(persona_id);
            }
            return removed;
        }
        false
    }

    /// Drain the next eligible execution from a persona's queue into a running slot.
    ///
    /// Call this after `remove_running` frees a slot. Returns `Some(queued)` if
    /// an execution was promoted from the queue to running, `None` if the queue
    /// is empty or persona has no queue.
    pub fn drain_next(&mut self, persona_id: &str, max_concurrent: i32) -> Option<QueuedExecution> {
        if !self.quota_available() {
            return None;
        }
        if !self.resource_available() {
            return None;
        }
        if !self.has_capacity(persona_id, max_concurrent) {
            return None;
        }
        // The key check joins quota / resource / capacity here and not only at
        // `admit`, because promotion is the last honest moment: two entries can
        // sit in the queue before either runs, and a displacement can reorder
        // them after `admit` had its look. A key-blocked front stays queued (it
        // is not dropped) and is promoted by the drain that follows the holder's
        // completion.
        if self.front_key_blocked(persona_id) {
            return None;
        }

        // Pop from queue in a limited scope to release the borrow on self.queues
        let (mut next, is_empty) = {
            let queue = self.queues.get_mut(persona_id)?;
            let next = queue.pop_front()?;
            let is_empty = queue.is_empty();
            (next, is_empty)
        };

        // Clean up empty queue
        if is_empty {
            self.queues.remove(persona_id);
        }

        // Compute and record queue wait duration
        let wait_ms = next.enqueued_at.elapsed().as_millis() as u64;
        next.wait_ms = Some(wait_ms);

        tracing::info!(
            wait_ms = wait_ms,
            persona_id = persona_id,
            execution_id = %next.execution_id,
            priority = ?next.priority,
            "Execution promoted from queue"
        );

        // Register as running (now safe -- no outstanding borrow on self.queues)
        let key = next.key.clone();
        self.add_running(persona_id, &next.execution_id, key.as_deref());

        Some(next)
    }

    /// Whether this persona's queue head carries a conflict key that a running
    /// execution already holds. `false` for an empty queue or a keyless head.
    fn front_key_blocked(&self, persona_id: &str) -> bool {
        self.queues
            .get(persona_id)
            .and_then(|q| q.front())
            .and_then(|front| front.key.as_deref())
            .is_some_and(|k| self.running_keys.contains_key(k))
    }

    /// Drain the highest-priority queued execution across ALL persona queues.
    ///
    /// Scans every persona queue and selects the candidate with the highest
    /// priority (then earliest enqueue time as tiebreaker) that also has
    /// per-persona capacity. Call this after `remove_running` frees a slot
    /// so that ANY persona's queued work can be promoted.
    ///
    /// Returns `None` if the global limit is at capacity or all queues are
    /// empty / blocked on their per-persona limits.
    pub fn drain_next_global(&mut self) -> Option<QueuedExecution> {
        if !self.quota_available() {
            return None;
        }
        if !self.resource_available() {
            return None;
        }
        if !self.has_global_capacity() {
            return None;
        }

        // Find the best candidate across all persona queues:
        //   - highest priority first
        //   - within same priority, earliest enqueued_at (FIFO)
        //   - must have per-persona capacity
        let mut best_pid: Option<String> = None;
        let mut best_priority = ExecutionPriority::Low;
        let mut best_time: Option<std::time::Instant> = None;
        let mut best_max_concurrent: i32 = 0;

        for (persona_id, queue) in &self.queues {
            let front = match queue.front() {
                Some(f) => f,
                None => continue,
            };

            // Skip if this persona is at its per-persona limit
            if !self.has_capacity(persona_id, front.persona_max_concurrent) {
                continue;
            }

            // Skip a head whose conflict key is still held by a running
            // execution -- the same check `drain_next` makes, applied here so a
            // key-blocked persona does not win the global selection and then
            // yield nothing.
            if self.front_key_blocked(persona_id) {
                continue;
            }

            let dominated = match (&best_pid, best_time) {
                (None, _) => true,
                (Some(_), Some(bt)) => {
                    front.priority > best_priority
                        || (front.priority == best_priority && front.enqueued_at < bt)
                }
                _ => true,
            };

            if dominated {
                best_pid = Some(persona_id.clone());
                best_priority = front.priority;
                best_time = Some(front.enqueued_at);
                best_max_concurrent = front.persona_max_concurrent;
            }
        }

        let pid = best_pid?;
        self.drain_next(&pid, best_max_concurrent)
    }

    /// Count running executions for a specific persona.
    pub fn running_count(&self, persona_id: &str) -> usize {
        self.running.get(persona_id).map_or(0, |set| set.len())
    }

    /// Get all running execution IDs for a specific persona.
    pub fn running_ids(&self, persona_id: &str) -> Vec<String> {
        self.running
            .get(persona_id)
            .map(|set| set.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Count queued executions for a specific persona.
    pub fn queue_depth(&self, persona_id: &str) -> usize {
        self.queues.get(persona_id).map_or(0, |q| q.len())
    }

    /// Get the queue position for a specific execution (0-indexed), or None.
    #[allow(dead_code)]
    pub fn queue_position(&self, persona_id: &str, execution_id: &str) -> Option<usize> {
        self.queues
            .get(persona_id)?
            .iter()
            .position(|e| e.execution_id == execution_id)
    }

    /// Get all queued execution IDs for a persona (in dequeue order).
    #[allow(dead_code)]
    pub fn queued_ids(&self, persona_id: &str) -> Vec<String> {
        self.queues
            .get(persona_id)
            .map(|q| q.iter().map(|e| e.execution_id.clone()).collect())
            .unwrap_or_default()
    }
}

impl Default for ConcurrencyTracker {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_tracker_empty() {
        let tracker = ConcurrencyTracker::new();
        assert_eq!(tracker.running_count("any-persona"), 0);
        assert_eq!(tracker.queue_depth("any-persona"), 0);
        assert_eq!(tracker.global_max_concurrent(), GLOBAL_MAX_CONCURRENT);
    }

    #[test]
    fn test_has_capacity_when_empty() {
        let tracker = ConcurrencyTracker::new();
        assert!(tracker.has_capacity("persona-1", 1));
        assert!(tracker.has_capacity("persona-1", 5));
        assert!(tracker.has_capacity("persona-1", 100));
        // Unlimited capacity with max_concurrent <= 0
        assert!(tracker.has_capacity("persona-1", 0));
        assert!(tracker.has_capacity("persona-1", -1));
    }

    #[test]
    fn test_has_capacity_at_limit() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.add_running("persona-1", "exec-1", None);
        tracker.add_running("persona-1", "exec-2", None);

        // At limit of 2
        assert!(!tracker.has_capacity("persona-1", 2));
        // Above limit
        assert!(!tracker.has_capacity("persona-1", 1));
        // Still has room for 3
        assert!(tracker.has_capacity("persona-1", 3));
    }

    #[test]
    fn test_add_and_count() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.add_running("persona-1", "exec-a", None);
        tracker.add_running("persona-1", "exec-b", None);

        assert_eq!(tracker.running_count("persona-1"), 2);

        // Adding the same execution_id again should not increase count (HashSet)
        tracker.add_running("persona-1", "exec-a", None);
        assert_eq!(tracker.running_count("persona-1"), 2);
    }

    #[test]
    fn test_remove_frees_capacity() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.add_running("persona-1", "exec-1", None);
        tracker.add_running("persona-1", "exec-2", None);

        assert_eq!(tracker.running_count("persona-1"), 2);
        assert!(!tracker.has_capacity("persona-1", 2));

        tracker.remove_running("persona-1", "exec-1");

        assert_eq!(tracker.running_count("persona-1"), 1);
        assert!(tracker.has_capacity("persona-1", 2));

        // Remove last one -> persona entry cleaned up
        tracker.remove_running("persona-1", "exec-2");
        assert_eq!(tracker.running_count("persona-1"), 0);
    }

    #[test]
    fn test_multi_persona_independence() {
        let mut tracker = ConcurrencyTracker::new();

        // Persona A at its limit of 1
        tracker.add_running("persona-a", "exec-a1", None);
        assert!(!tracker.has_capacity("persona-a", 1));

        // Persona B should still have capacity
        assert!(tracker.has_capacity("persona-b", 1));
        assert_eq!(tracker.running_count("persona-b"), 0);

        // Add one for persona B
        tracker.add_running("persona-b", "exec-b1", None);
        assert!(!tracker.has_capacity("persona-b", 1));

        // Removing from persona A doesn't affect persona B
        tracker.remove_running("persona-a", "exec-a1");
        assert!(tracker.has_capacity("persona-a", 1));
        assert!(!tracker.has_capacity("persona-b", 1));
    }

    #[test]
    fn test_try_add_running_atomic() {
        let mut tracker = ConcurrencyTracker::new();

        // First add should succeed (0/1)
        assert!(tracker.try_add_running("p1", "exec-1", 1));
        assert_eq!(tracker.running_count("p1"), 1);

        // Second add should fail (1/1 -- at capacity)
        assert!(!tracker.try_add_running("p1", "exec-2", 1));
        assert_eq!(tracker.running_count("p1"), 1);

        // After removing, should succeed again
        tracker.remove_running("p1", "exec-1");
        assert!(tracker.try_add_running("p1", "exec-3", 1));
        assert_eq!(tracker.running_count("p1"), 1);

        // Unlimited capacity (max_concurrent <= 0) always succeeds
        assert!(tracker.try_add_running("p2", "exec-a", 0));
        assert!(tracker.try_add_running("p2", "exec-b", 0));
        assert!(tracker.try_add_running("p2", "exec-c", -1));
    }

    // =====================================================================
    // Queue + priority tests
    // =====================================================================

    #[test]
    fn test_admit_runs_immediately_when_capacity() {
        let mut tracker = ConcurrencyTracker::new();
        let result = tracker.admit("p1", "exec-1", 2, ExecutionPriority::Normal, None);
        assert!(matches!(result, AdmitResult::Running));
        assert_eq!(tracker.running_count("p1"), 1);
        assert_eq!(tracker.queue_depth("p1"), 0);
    }

    #[test]
    fn test_admit_queues_when_at_capacity() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.add_running("p1", "exec-1", None);

        let result = tracker.admit("p1", "exec-2", 1, ExecutionPriority::Normal, None);
        assert!(matches!(
            result,
            AdmitResult::Queued {
                position: 0,
                displaced: None
            }
        ));
        assert_eq!(tracker.running_count("p1"), 1);
        assert_eq!(tracker.queue_depth("p1"), 1);
    }

    #[test]
    fn test_admit_backpressure_when_queue_full() {
        let mut tracker = ConcurrencyTracker::with_max_queue_depth(2);
        tracker.add_running("p1", "exec-run", None);

        // Fill queue
        tracker.admit("p1", "exec-q1", 1, ExecutionPriority::Normal, None);
        tracker.admit("p1", "exec-q2", 1, ExecutionPriority::Normal, None);

        // Third should be rejected
        let result = tracker.admit("p1", "exec-q3", 1, ExecutionPriority::Normal, None);
        assert!(matches!(result, AdmitResult::QueueFull { max_depth: 2 }));
        assert_eq!(tracker.queue_depth("p1"), 2);
    }

    #[test]
    fn test_urgent_arrival_displaces_low_at_the_bound() {
        // The intersection the depth tests and the priority tests both miss:
        // a bounded queue that is FULL of low-priority work, and an Urgent
        // arrival (a healing retry, a chain trigger, a manual re-run).
        // Priority must decide admission here, not only insertion order.
        let mut tracker = ConcurrencyTracker::with_max_queue_depth(2);
        tracker.add_running("p1", "exec-run", None);

        tracker.admit("p1", "bulk-1", 1, ExecutionPriority::Low, None);
        tracker.admit("p1", "bulk-2", 1, ExecutionPriority::Low, None);
        assert_eq!(tracker.queue_depth("p1"), 2);

        let result = tracker.admit("p1", "heal-1", 1, ExecutionPriority::Urgent, None);

        // The urgent execution is admitted; the lowest-ranked resident leaves.
        assert!(
            matches!(result, AdmitResult::Queued { .. }),
            "urgent arrival was refused at a queue full of Low work: {result:?}"
        );
        let ids = tracker.queued_ids("p1");
        assert_eq!(ids, vec!["heal-1", "bulk-1"]);
        assert_eq!(tracker.queue_depth("p1"), 2, "the bound still holds");
    }

    #[test]
    fn test_equal_priority_arrival_still_refused_at_the_bound() {
        // Displacement is not a bypass: an arrival that does not outrank the
        // weakest resident is refused exactly as before.
        let mut tracker = ConcurrencyTracker::with_max_queue_depth(2);
        tracker.add_running("p1", "exec-run", None);

        tracker.admit("p1", "q1", 1, ExecutionPriority::Normal, None);
        tracker.admit("p1", "q2", 1, ExecutionPriority::Normal, None);

        let result = tracker.admit("p1", "q3", 1, ExecutionPriority::Normal, None);
        assert!(matches!(result, AdmitResult::QueueFull { max_depth: 2 }));
        assert_eq!(tracker.queued_ids("p1"), vec!["q1", "q2"]);
    }

    #[test]
    fn test_priority_ordering() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.add_running("p1", "exec-run", None);

        // Enqueue normal, then urgent, then low
        tracker.admit("p1", "exec-normal", 1, ExecutionPriority::Normal, None);
        tracker.admit("p1", "exec-urgent", 1, ExecutionPriority::Urgent, None);
        tracker.admit("p1", "exec-low", 1, ExecutionPriority::Low, None);

        // Queue order should be: urgent, normal, low
        let ids = tracker.queued_ids("p1");
        assert_eq!(ids, vec!["exec-urgent", "exec-normal", "exec-low"]);
    }

    #[test]
    fn test_fifo_within_same_priority() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.add_running("p1", "exec-run", None);

        tracker.admit("p1", "exec-a", 1, ExecutionPriority::Normal, None);
        tracker.admit("p1", "exec-b", 1, ExecutionPriority::Normal, None);
        tracker.admit("p1", "exec-c", 1, ExecutionPriority::Normal, None);

        let ids = tracker.queued_ids("p1");
        assert_eq!(ids, vec!["exec-a", "exec-b", "exec-c"]);
    }

    #[test]
    fn test_drain_next_promotes_from_queue() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.add_running("p1", "exec-run", None);

        tracker.admit("p1", "exec-q1", 1, ExecutionPriority::Normal, None);
        tracker.admit("p1", "exec-q2", 1, ExecutionPriority::Normal, None);

        // Free a slot
        tracker.remove_running("p1", "exec-run");

        // Drain should promote exec-q1
        let next = tracker.drain_next("p1", 1);
        assert!(next.is_some());
        let promoted = next.unwrap();
        assert_eq!(promoted.execution_id, "exec-q1");
        assert!(
            promoted.wait_ms.is_some(),
            "wait_ms should be populated on promotion"
        );
        assert_eq!(tracker.running_count("p1"), 1);
        assert_eq!(tracker.queue_depth("p1"), 1);
    }

    #[test]
    fn test_drain_next_returns_none_when_empty() {
        let mut tracker = ConcurrencyTracker::new();
        assert!(tracker.drain_next("p1", 1).is_none());
    }

    #[test]
    fn test_drain_respects_priority() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.add_running("p1", "exec-run", None);

        tracker.admit("p1", "exec-low", 1, ExecutionPriority::Low, None);
        tracker.admit("p1", "exec-urgent", 1, ExecutionPriority::Urgent, None);

        tracker.remove_running("p1", "exec-run");

        let next = tracker.drain_next("p1", 1).unwrap();
        assert_eq!(next.execution_id, "exec-urgent");
    }

    #[test]
    fn test_remove_queued() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.add_running("p1", "exec-run", None);

        tracker.admit("p1", "exec-q1", 1, ExecutionPriority::Normal, None);
        tracker.admit("p1", "exec-q2", 1, ExecutionPriority::Normal, None);

        assert!(tracker.remove_queued("p1", "exec-q1"));
        assert_eq!(tracker.queue_depth("p1"), 1);
        assert_eq!(tracker.queued_ids("p1"), vec!["exec-q2"]);

        // Removing non-existent returns false
        assert!(!tracker.remove_queued("p1", "exec-q1"));
    }

    #[test]
    fn test_queue_position() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.add_running("p1", "exec-run", None);

        tracker.admit("p1", "exec-q1", 1, ExecutionPriority::Normal, None);
        tracker.admit("p1", "exec-q2", 1, ExecutionPriority::Normal, None);
        tracker.admit("p1", "exec-q3", 1, ExecutionPriority::Normal, None);

        assert_eq!(tracker.queue_position("p1", "exec-q1"), Some(0));
        assert_eq!(tracker.queue_position("p1", "exec-q2"), Some(1));
        assert_eq!(tracker.queue_position("p1", "exec-q3"), Some(2));
        assert_eq!(tracker.queue_position("p1", "exec-nonexistent"), None);
    }

    // =====================================================================
    // Global concurrency tests
    // =====================================================================

    #[test]
    fn test_global_capacity_blocks_admission() {
        let mut tracker = ConcurrencyTracker::new();
        // Global limit is 4 (GLOBAL_MAX_CONCURRENT)

        // Spread 4 executions across different personas (each persona has unlimited capacity)
        assert!(matches!(
            tracker.admit("p1", "e1", 0, ExecutionPriority::Normal, None),
            AdmitResult::Running
        ));
        assert!(matches!(
            tracker.admit("p2", "e2", 0, ExecutionPriority::Normal, None),
            AdmitResult::Running
        ));
        assert!(matches!(
            tracker.admit("p3", "e3", 0, ExecutionPriority::Normal, None),
            AdmitResult::Running
        ));
        assert!(matches!(
            tracker.admit("p4", "e4", 0, ExecutionPriority::Normal, None),
            AdmitResult::Running
        ));
        assert_eq!(tracker.total_running(), 4);

        // 5th execution should be queued even though persona has unlimited capacity
        let result = tracker.admit("p5", "e5", 0, ExecutionPriority::Normal, None);
        assert!(matches!(
            result,
            AdmitResult::Queued {
                position: 0,
                displaced: None
            }
        ));
        assert_eq!(tracker.total_running(), 4);
        assert_eq!(tracker.queue_depth("p5"), 1);

        // Free a global slot
        tracker.remove_running("p1", "e1");
        assert!(tracker.has_global_capacity());

        // Now admission should work
        assert!(matches!(
            tracker.admit("p6", "e6", 0, ExecutionPriority::Normal, None),
            AdmitResult::Running
        ));
    }

    #[test]
    fn test_global_drain_cross_persona() {
        let mut tracker = ConcurrencyTracker::new();
        // global_max = 4

        // Fill 4 slots across 2 personas
        tracker.add_running("p1", "e1", None);
        tracker.add_running("p1", "e2", None);
        tracker.add_running("p2", "e3", None);
        tracker.add_running("p2", "e4", None);

        // Queue items on p3 and p4 (blocked by global limit, per-persona unlimited)
        tracker.admit("p3", "e5", 0, ExecutionPriority::Normal, None);
        tracker.admit("p4", "e6", 0, ExecutionPriority::Urgent, None);

        assert_eq!(tracker.queue_depth("p3"), 1);
        assert_eq!(tracker.queue_depth("p4"), 1);

        // Free a global slot
        tracker.remove_running("p1", "e1");

        // drain_next_global should pick the Urgent one from p4
        let next = tracker.drain_next_global().unwrap();
        assert_eq!(next.execution_id, "e6");
        assert_eq!(next.persona_id, "p4");
        assert_eq!(tracker.running_count("p4"), 1);
        assert_eq!(tracker.queue_depth("p4"), 0);

        // p3's item is still queued (global full again at 4)
        assert_eq!(tracker.queue_depth("p3"), 1);
        assert!(!tracker.has_global_capacity());
    }

    #[test]
    fn test_global_drain_skips_persona_at_limit() {
        let mut tracker = ConcurrencyTracker::new();
        // global_max = 4

        // p1: running 1/1 (at per-persona limit of 1)
        tracker.add_running("p1", "e1", None);
        // p2: running 3 (unlimited) — fills global capacity to 4
        tracker.add_running("p2", "e2", None);
        tracker.add_running("p2", "e3", None);
        tracker.add_running("p2", "e6", None);

        // Both are queued because global capacity is full (4/4)
        tracker.admit("p1", "e4", 1, ExecutionPriority::Urgent, None);
        tracker.admit("p3", "e5", 0, ExecutionPriority::Normal, None);

        // Free up one global slot
        tracker.remove_running("p2", "e6");

        // drain_next_global should skip p1 (at per-persona limit of 1)
        // and pick p3's item
        let next = tracker.drain_next_global().unwrap();
        assert_eq!(next.execution_id, "e5");
        assert_eq!(next.persona_id, "p3");

        // p1's urgent item stays queued (per-persona blocked)
        assert_eq!(tracker.queue_depth("p1"), 1);
    }

    #[test]
    fn test_global_drain_returns_none_at_capacity() {
        let mut tracker = ConcurrencyTracker::new();

        tracker.add_running("p1", "e1", None);
        tracker.add_running("p2", "e2", None);
        tracker.add_running("p3", "e3", None);
        tracker.add_running("p4", "e4", None);

        tracker.admit("p5", "e5", 0, ExecutionPriority::Normal, None);

        // Global at capacity — drain should return None
        assert!(tracker.drain_next_global().is_none());
    }

    #[test]
    fn test_global_drain_fifo_within_same_priority() {
        let mut tracker = ConcurrencyTracker::new();

        // Fill global
        tracker.add_running("p1", "e1", None);
        tracker.add_running("p2", "e2", None);
        tracker.add_running("p3", "e3", None);
        tracker.add_running("p4", "e4", None);

        // Queue two Normal items — p5 enqueued first, p6 second
        tracker.admit("p5", "e5", 0, ExecutionPriority::Normal, None);
        // Small sleep equivalent: e5's Instant is earlier than e6's
        tracker.admit("p6", "e6", 0, ExecutionPriority::Normal, None);

        // Free a slot
        tracker.remove_running("p1", "e1");

        // Should pick e5 (earlier enqueue time, same priority)
        let next = tracker.drain_next_global().unwrap();
        assert_eq!(next.execution_id, "e5");
    }

    #[test]
    fn test_admit_stores_persona_max_concurrent() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.add_running("p1", "e1", None);

        tracker.admit("p1", "e2", 1, ExecutionPriority::Normal, None);

        let queued = tracker.queues.get("p1").unwrap().front().unwrap();
        assert_eq!(queued.persona_max_concurrent, 1);
    }

    // =====================================================================
    // Configurable global cap (max_parallel_executions setting)
    // =====================================================================

    /// The tracker honors a cap injected via `set_global_max_concurrent` rather
    /// than the compile-time const: admit `cap` executions across distinct
    /// personas (per-persona unlimited so only the global cap can reject), queue
    /// the next, re-admit after a slot frees.
    #[test]
    fn test_injected_global_cap_is_respected() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.set_global_max_concurrent(2);
        assert_eq!(tracker.global_max_concurrent(), 2);

        assert!(matches!(
            tracker.admit("pa", "e1", 0, ExecutionPriority::Normal, None),
            AdmitResult::Running
        ));
        assert!(matches!(
            tracker.admit("pb", "e2", 0, ExecutionPriority::Normal, None),
            AdmitResult::Running
        ));
        assert_eq!(tracker.total_running(), 2);

        // At the cap of 2 -> third is queued.
        assert!(matches!(
            tracker.admit("pc", "e3", 0, ExecutionPriority::Normal, None),
            AdmitResult::Queued {
                position: 0,
                displaced: None
            }
        ));
        assert!(!tracker.has_global_capacity());

        // Free a slot -> capacity returns and a new admit runs.
        tracker.remove_running("pa", "e1");
        assert!(tracker.has_global_capacity());
        assert!(matches!(
            tracker.admit("pd", "e4", 0, ExecutionPriority::Normal, None),
            AdmitResult::Running
        ));
    }

    /// A cap of 1 fully serializes execution across all personas.
    #[test]
    fn test_injected_global_cap_of_one_serializes() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.set_global_max_concurrent(1);
        assert!(matches!(
            tracker.admit("pa", "e1", 0, ExecutionPriority::Normal, None),
            AdmitResult::Running
        ));
        assert!(matches!(
            tracker.admit("pb", "e2", 0, ExecutionPriority::Normal, None),
            AdmitResult::Queued { .. }
        ));
    }

    // -- Quota-aware admission ------------------------------------------------

    #[test]
    fn test_quota_available_by_default() {
        let tracker = ConcurrencyTracker::new();
        assert!(tracker.quota_available(), "no cooldown => available");
        assert_eq!(tracker.quota_cooldown_until(), None);
    }

    #[test]
    fn test_quota_cooldown_future_blocks_past_allows() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.set_quota_cooldown(Utc::now() + chrono::Duration::minutes(10));
        assert!(!tracker.quota_available(), "future cooldown => unavailable");
        // A past deadline means the cooldown has lapsed.
        tracker.set_quota_cooldown(Utc::now() - chrono::Duration::minutes(1));
        // set never shortens, so the 10-min future deadline still stands.
        assert!(
            !tracker.quota_available(),
            "set never shortens an active cooldown"
        );
    }

    // -- Resource-aware admission ---------------------------------------------

    #[test]
    fn test_resource_available_by_default() {
        let tracker = ConcurrencyTracker::new();
        assert!(tracker.resource_available(), "no pressure => available");
        assert!(!tracker.resource_throttled());
    }

    #[test]
    fn test_resource_throttle_queues_then_resumes() {
        let mut tracker = ConcurrencyTracker::new();
        // Healthy load: admission runs immediately.
        assert!(matches!(
            tracker.admit("pa", "e1", 0, ExecutionPriority::Normal, None),
            AdmitResult::Running
        ));
        // High load: new admissions defer to the per-persona queue instead of
        // running onto a stressed host.
        tracker.set_resource_throttled(true);
        assert!(!tracker.resource_available());
        assert!(matches!(
            tracker.admit("pb", "e2", 0, ExecutionPriority::Normal, None),
            AdmitResult::Queued { .. }
        ));
        // Load recovers: admission resumes.
        tracker.set_resource_throttled(false);
        assert!(matches!(
            tracker.admit("pc", "e3", 0, ExecutionPriority::Normal, None),
            AdmitResult::Running
        ));
    }

    #[test]
    fn test_quota_cooldown_never_shortens() {
        let mut tracker = ConcurrencyTracker::new();
        let far = Utc::now() + chrono::Duration::minutes(30);
        tracker.set_quota_cooldown(far);
        tracker.set_quota_cooldown(Utc::now() + chrono::Duration::minutes(5));
        assert_eq!(
            tracker.quota_cooldown_until(),
            Some(far),
            "keeps the later deadline"
        );
    }

    #[test]
    fn test_admit_enqueues_during_cooldown_even_with_capacity() {
        let mut tracker = ConcurrencyTracker::new();
        // Plenty of capacity, but quota is in cooldown -> must enqueue, not run.
        tracker.set_quota_cooldown(Utc::now() + chrono::Duration::minutes(10));
        assert!(matches!(
            tracker.admit("p", "e1", 0, ExecutionPriority::Normal, None),
            AdmitResult::Queued { .. }
        ));
        assert_eq!(tracker.total_running(), 0, "nothing runs during cooldown");
        assert_eq!(tracker.total_queued(), 1, "work waits in the queue");
        // drains are also held during cooldown
        assert!(
            tracker.drain_next_global().is_none(),
            "no promotion during cooldown"
        );
    }

    #[test]
    fn test_admit_runs_after_cooldown_lapses() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.set_quota_cooldown(Utc::now() - chrono::Duration::seconds(1)); // already lapsed
        assert!(tracker.quota_available());
        assert!(matches!(
            tracker.admit("p", "e1", 0, ExecutionPriority::Normal, None),
            AdmitResult::Running
        ));
    }

    // =====================================================================
    // Conflict-key exclusion
    //
    // The measurable this gate exists for: concurrent runs for ONE
    // (persona, trigger) go from `max_concurrent` to 1, while every other
    // kind of parallelism the operator asked for is untouched. The paired
    // assertions below are what stop this becoming the per-persona limit in
    // disguise -- if they ever go red, the gate has widened from exclusion
    // into serialization.
    // =====================================================================

    /// The key as the engine forms it: persona + the machine cause.
    fn trigger_key(persona_id: &str, trigger_id: &str) -> String {
        format!("{persona_id}\u{1f}trigger\u{1f}{trigger_id}")
    }

    #[test]
    fn test_same_persona_and_trigger_runs_once_not_twice() {
        // BEFORE this gate: two Running, two ids in `running_ids`, two CLI
        // processes and two provider charges for one cause.
        let mut tracker = ConcurrencyTracker::new();
        let key = trigger_key("p1", "trig-a");

        let first = tracker.admit("p1", "exec-1", 2, ExecutionPriority::Normal, Some(&key));
        assert!(matches!(first, AdmitResult::Running), "{first:?}");

        let second = tracker.admit("p1", "exec-2", 2, ExecutionPriority::Normal, Some(&key));
        match second {
            AdmitResult::AlreadyAdmitted { execution_id } => {
                assert_eq!(
                    execution_id, "exec-1",
                    "the refusal must NAME the run already going, so the caller can \
                     attach the new provenance instead of dropping the event"
                );
            }
            other => panic!("expected AlreadyAdmitted, got {other:?}"),
        }

        assert_eq!(
            tracker.running_count("p1"),
            1,
            "one cause, one in-flight run"
        );
        assert_eq!(
            tracker.queue_depth("p1"),
            0,
            "a duplicate is refused, not parked -- the queue depth is for real work"
        );
    }

    #[test]
    fn test_different_triggers_both_reach_running() {
        // The paired assertion. Per-persona concurrency is a RESOURCE limit and
        // stays exactly as configured: two distinct causes for one persona both
        // run at max_concurrent = 2.
        let mut tracker = ConcurrencyTracker::new();
        let key_a = trigger_key("p1", "trig-a");
        let key_b = trigger_key("p1", "trig-b");

        assert!(matches!(
            tracker.admit("p1", "exec-a", 2, ExecutionPriority::Normal, Some(&key_a)),
            AdmitResult::Running
        ));
        assert!(
            matches!(
                tracker.admit("p1", "exec-b", 2, ExecutionPriority::Normal, Some(&key_b)),
                AdmitResult::Running
            ),
            "a different trigger is different work -- the gate must not serialize it"
        );
        assert_eq!(tracker.running_count("p1"), 2);
    }

    #[test]
    fn test_keyless_admissions_both_reach_running() {
        // The other half of the paired assertion: a person pressing Run twice
        // may genuinely mean it, so operator-originated work carries no key and
        // is never deduplicated.
        let mut tracker = ConcurrencyTracker::new();
        assert!(matches!(
            tracker.admit("p1", "manual-1", 2, ExecutionPriority::Normal, None),
            AdmitResult::Running
        ));
        assert!(matches!(
            tracker.admit("p1", "manual-2", 2, ExecutionPriority::Normal, None),
            AdmitResult::Running
        ));
        assert_eq!(tracker.running_count("p1"), 2);
    }

    #[test]
    fn test_key_is_released_with_the_slot() {
        // A key that outlives its execution wedges the trigger silently and
        // forever. Release happens on `remove_running` -- the same call that
        // frees the slot, on every path that can free one.
        let mut tracker = ConcurrencyTracker::new();
        let key = trigger_key("p1", "trig-a");

        assert!(matches!(
            tracker.admit("p1", "exec-1", 1, ExecutionPriority::Normal, Some(&key)),
            AdmitResult::Running
        ));
        assert!(tracker.running_key_holder(&key).is_some());

        tracker.remove_running("p1", "exec-1");
        assert!(
            tracker.running_key_holder(&key).is_none(),
            "the key must not survive the execution that held it"
        );
        assert!(
            matches!(
                tracker.admit("p1", "exec-2", 1, ExecutionPriority::Normal, Some(&key)),
                AdmitResult::Running
            ),
            "the next fire of the same trigger runs normally"
        );
    }

    #[test]
    fn test_duplicate_of_a_queued_entry_is_refused_too() {
        // Exclusion covers the queued side as well as the running side: two
        // entries can be waiting before either runs.
        let mut tracker = ConcurrencyTracker::new();
        let key = trigger_key("p1", "trig-a");
        tracker.add_running("p1", "occupant", None); // persona at max_concurrent = 1

        assert!(matches!(
            tracker.admit("p1", "queued-1", 1, ExecutionPriority::Normal, Some(&key)),
            AdmitResult::Queued { .. }
        ));
        match tracker.admit("p1", "queued-2", 1, ExecutionPriority::Normal, Some(&key)) {
            AdmitResult::AlreadyAdmitted { execution_id } => {
                assert_eq!(execution_id, "queued-1")
            }
            other => panic!("expected AlreadyAdmitted, got {other:?}"),
        }
        assert_eq!(tracker.queued_ids("p1"), vec!["queued-1"]);
    }

    #[test]
    fn test_duplicate_never_consumes_the_displacement_rule() {
        // An AlreadyAdmitted is not a QueueFull. Displacing a resident waiter to
        // make room for that waiter's own duplicate is the worst available
        // outcome, so the key is evaluated BEFORE the depth verdict.
        let mut tracker = ConcurrencyTracker::with_max_queue_depth(2);
        let key = trigger_key("p1", "trig-a");
        tracker.add_running("p1", "occupant", None);

        // A full queue of Low work, one entry of which carries the key.
        tracker.admit("p1", "bulk-1", 1, ExecutionPriority::Low, Some(&key));
        tracker.admit("p1", "bulk-2", 1, ExecutionPriority::Low, None);
        assert_eq!(tracker.queue_depth("p1"), 2);

        // An Urgent duplicate: outranks the weakest resident, and would displace
        // it if the depth verdict were reached first.
        let result = tracker.admit("p1", "dupe", 1, ExecutionPriority::Urgent, Some(&key));
        assert!(
            matches!(result, AdmitResult::AlreadyAdmitted { .. }),
            "{result:?}"
        );
        assert_eq!(
            tracker.queued_ids("p1"),
            vec!["bulk-1", "bulk-2"],
            "nothing was evicted for a duplicate"
        );
    }

    #[test]
    fn test_drain_does_not_promote_a_key_blocked_head() {
        // Promotion is the last honest moment: capacity is free, but the head's
        // key is held by a running execution, so it stays queued rather than
        // becoming the second concurrent run for one cause.
        let mut tracker = ConcurrencyTracker::new();
        let key = trigger_key("p1", "trig-a");
        tracker.add_running("p1", "r0", None);
        tracker.add_running("p1", "r1", None);

        assert!(matches!(
            tracker.admit("p1", "queued-1", 2, ExecutionPriority::Normal, Some(&key)),
            AdmitResult::Queued { .. }
        ));

        // A slot frees, and the key is claimed by a different running execution
        // (the cloud-task / healing registration paths also register directly).
        tracker.remove_running("p1", "r0");
        tracker.add_running("p1", "holder", Some(&key));

        assert!(
            tracker.drain_next("p1", 2).is_none(),
            "capacity alone must not promote a duplicate"
        );
        assert_eq!(tracker.queue_depth("p1"), 1, "it waits, it is not dropped");

        tracker.remove_running("p1", "holder");
        let promoted = tracker.drain_next("p1", 2).expect("key released");
        assert_eq!(promoted.execution_id, "queued-1");
    }

    #[test]
    fn test_global_drain_skips_a_key_blocked_persona() {
        let mut tracker = ConcurrencyTracker::new();
        let key = trigger_key("p1", "trig-a");
        tracker.add_running("p1", "r0", None);
        tracker.add_running("p2", "r1", None);

        // p1's head is Urgent (it would win the global selection) but blocked;
        // p2's head is Normal and free.
        assert!(matches!(
            tracker.admit("p1", "p1-queued", 1, ExecutionPriority::Urgent, Some(&key)),
            AdmitResult::Queued { .. }
        ));
        assert!(matches!(
            tracker.admit("p2", "p2-queued", 1, ExecutionPriority::Normal, None),
            AdmitResult::Queued { .. }
        ));

        tracker.remove_running("p1", "r0");
        tracker.remove_running("p2", "r1");
        tracker.add_running("p1", "holder", Some(&key));

        let promoted = tracker.drain_next_global().expect("p2 is promotable");
        assert_eq!(
            promoted.execution_id, "p2-queued",
            "a key-blocked head must not win the global selection and then yield nothing"
        );
    }
}

#[cfg(test)]
mod admission_key_tests {
    use super::admission_conflict_key;
    use serde_json::json;

    /// The shape `background/event_bus.rs` actually builds before it calls
    /// `start_execution`: the event metadata beside the trigger's payload.
    fn wrapped(
        source_type: &str,
        source_id: &str,
        payload: serde_json::Value,
    ) -> serde_json::Value {
        json!({
            "_event": {
                "event_type": "trigger_fired",
                "source_type": source_type,
                "source_id": source_id,
            },
            "payload": payload,
        })
    }

    fn schedule_payload(trigger_id: &str) -> serde_json::Value {
        json!({
            "trigger_id": trigger_id,
            "trigger_type": "schedule",
            "target_persona_id": "p1",
            "fired_at": "2026-09-03T09:00:00Z",
        })
    }

    #[test]
    fn a_schedule_fire_carries_a_key_and_two_slots_of_it_agree() {
        let a = admission_conflict_key(
            "p1",
            Some(&wrapped("trigger", "trig-a", schedule_payload("trig-a"))),
        );
        let b = admission_conflict_key(
            "p1",
            Some(&wrapped(
                "trigger",
                "trig-a",
                json!({
                    "trigger_id": "trig-a",
                    "trigger_type": "schedule",
                    "target_persona_id": "p1",
                    // A LATER slot of the same schedule: a different fired_at,
                    // deliberately NOT part of the key. Two slots of one
                    // schedule overlapping is the duplicate this gate is for.
                    "fired_at": "2026-09-03T10:00:00Z",
                }),
            )),
        );
        assert!(a.is_some());
        assert_eq!(a, b);
    }

    #[test]
    fn a_manual_run_has_no_key() {
        // The operator's own run: no `_event` wrapper at all. Pressing Run twice
        // must start two runs.
        assert_eq!(
            admission_conflict_key("p1", Some(&json!({ "prompt": "do the thing" }))),
            None
        );
        assert_eq!(admission_conflict_key("p1", None), None);
    }

    #[test]
    fn a_webhook_fire_has_no_key() {
        // A webhook trigger fires per external event, and `_event` carries no
        // event identity, so keying it would collapse distinct payloads into one
        // run. It stays outside the gate.
        assert_eq!(
            admission_conflict_key(
                "p1",
                Some(&wrapped(
                    "webhook",
                    "trig-w",
                    json!({ "trigger_type": "webhook" })
                ))
            ),
            None
        );
        // Same for a trigger-sourced event whose kind is not a schedule.
        assert_eq!(
            admission_conflict_key(
                "p1",
                Some(&wrapped(
                    "trigger",
                    "trig-w",
                    json!({ "trigger_type": "webhook" })
                ))
            ),
            None
        );
    }

    #[test]
    fn a_backfill_slot_has_no_key() {
        // A replayed missed slot is an extra run someone asked for; the
        // scheduler publishes it without consulting the overlap policy, and
        // collapsing a five-slot backfill into one run would undo that feature.
        let mut payload = schedule_payload("trig-a");
        payload["backfill_slot"] = json!(true);
        assert_eq!(
            admission_conflict_key("p1", Some(&wrapped("trigger", "trig-a", payload))),
            None
        );
    }

    #[test]
    fn an_author_set_payload_fails_open() {
        // No `trigger_type` in an author-written payload -> no key -> the run is
        // unguarded. Failing open toward running is the safe direction.
        assert_eq!(
            admission_conflict_key(
                "p1",
                Some(&wrapped("trigger", "trig-a", json!({ "ticker": "MSFT" })))
            ),
            None
        );
    }

    #[test]
    fn the_key_separates_persona_from_trigger() {
        // Distinct personas on one trigger, and distinct triggers on one
        // persona, are distinct work.
        let p1 = admission_conflict_key(
            "p1",
            Some(&wrapped("trigger", "trig-a", schedule_payload("trig-a"))),
        );
        let p2 = admission_conflict_key(
            "p2",
            Some(&wrapped("trigger", "trig-a", schedule_payload("trig-a"))),
        );
        let p1b = admission_conflict_key(
            "p1",
            Some(&wrapped("trigger", "trig-b", schedule_payload("trig-b"))),
        );
        assert_ne!(p1, p2);
        assert_ne!(p1, p1b);
    }
}
