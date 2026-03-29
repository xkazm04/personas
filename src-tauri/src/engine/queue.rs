use std::collections::{HashMap, HashSet, VecDeque};

use serde::{Deserialize, Serialize};

/// Default maximum queue depth per persona.
pub const DEFAULT_MAX_QUEUE_DEPTH: usize = 10;

// =============================================================================
// Priority
// =============================================================================

/// Execution priority levels. Higher priority executions are dequeued first.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
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
    Queued { position: usize },
    /// Queue is full -- backpressure rejection.
    QueueFull { max_depth: usize },
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
    /// Per-persona waiting queues, ordered by priority then FIFO.
    queues: HashMap<String, VecDeque<QueuedExecution>>,
    /// Maximum queue depth per persona (backpressure threshold).
    max_queue_depth: usize,
}

impl ConcurrencyTracker {
    /// Create a new empty tracker with default queue depth.
    pub fn new() -> Self {
        Self {
            running: HashMap::new(),
            queues: HashMap::new(),
            max_queue_depth: DEFAULT_MAX_QUEUE_DEPTH,
        }
    }

    /// Create a tracker with a custom max queue depth.
    #[allow(dead_code)]
    pub fn with_max_queue_depth(max_depth: usize) -> Self {
        Self {
            running: HashMap::new(),
            queues: HashMap::new(),
            max_queue_depth: max_depth,
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

    /// Total running executions across all personas.
    pub fn total_running(&self) -> usize {
        self.running.values().map(|set| set.len()).sum()
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
    pub fn add_running(&mut self, persona_id: &str, execution_id: &str) {
        self.running
            .entry(persona_id.to_string())
            .or_default()
            .insert(execution_id.to_string());
    }

    /// Atomically check capacity and register an execution.
    ///
    /// Returns `true` if the execution was registered (had capacity).
    /// Returns `false` if at capacity (execution not registered).
    /// This prevents TOCTOU races between `has_capacity` and `add_running`.
    pub fn try_add_running(&mut self, persona_id: &str, execution_id: &str, max_concurrent: i32) -> bool {
        if !self.has_capacity(persona_id, max_concurrent) {
            return false;
        }
        self.add_running(persona_id, execution_id);
        true
    }

    /// Atomically try to run or enqueue an execution.
    ///
    /// 1. If there's capacity -> register as running, return `Running`.
    /// 2. If queue has room -> enqueue with priority, return `Queued { position }`.
    /// 3. If queue is full -> return `QueueFull` (backpressure).
    pub fn admit(
        &mut self,
        persona_id: &str,
        execution_id: &str,
        max_concurrent: i32,
        priority: ExecutionPriority,
    ) -> AdmitResult {
        // Try to run immediately
        if self.try_add_running(persona_id, execution_id, max_concurrent) {
            return AdmitResult::Running;
        }

        // Check backpressure
        let queue = self.queues.entry(persona_id.to_string()).or_default();
        if queue.len() >= self.max_queue_depth {
            return AdmitResult::QueueFull {
                max_depth: self.max_queue_depth,
            };
        }

        // Insert into queue respecting priority (higher priority = closer to front)
        let entry = QueuedExecution {
            execution_id: execution_id.to_string(),
            persona_id: persona_id.to_string(),
            priority,
            enqueued_at: std::time::Instant::now(),
            wait_ms: None,
        };

        // Find insertion point: after all entries with >= priority (FIFO within same priority)
        let pos = queue
            .iter()
            .position(|e| e.priority < priority)
            .unwrap_or(queue.len());
        queue.insert(pos, entry);

        AdmitResult::Queued { position: pos }
    }

    /// Remove an execution from the running set.
    /// Cleans up the persona entry if no executions remain.
    pub fn remove_running(&mut self, persona_id: &str, execution_id: &str) {
        if let Some(set) = self.running.get_mut(persona_id) {
            set.remove(execution_id);
            if set.is_empty() {
                self.running.remove(persona_id);
            }
        }
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
    pub fn drain_next(
        &mut self,
        persona_id: &str,
        max_concurrent: i32,
    ) -> Option<QueuedExecution> {
        if !self.has_capacity(persona_id, max_concurrent) {
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
        self.add_running(persona_id, &next.execution_id);

        Some(next)
    }

    /// Count running executions for a specific persona.
    pub fn running_count(&self, persona_id: &str) -> usize {
        self.running
            .get(persona_id)
            .map_or(0, |set| set.len())
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
        self.queues
            .get(persona_id)
            .map_or(0, |q| q.len())
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
        tracker.add_running("persona-1", "exec-1");
        tracker.add_running("persona-1", "exec-2");

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
        tracker.add_running("persona-1", "exec-a");
        tracker.add_running("persona-1", "exec-b");

        assert_eq!(tracker.running_count("persona-1"), 2);

        // Adding the same execution_id again should not increase count (HashSet)
        tracker.add_running("persona-1", "exec-a");
        assert_eq!(tracker.running_count("persona-1"), 2);
    }

    #[test]
    fn test_remove_frees_capacity() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.add_running("persona-1", "exec-1");
        tracker.add_running("persona-1", "exec-2");

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
        tracker.add_running("persona-a", "exec-a1");
        assert!(!tracker.has_capacity("persona-a", 1));

        // Persona B should still have capacity
        assert!(tracker.has_capacity("persona-b", 1));
        assert_eq!(tracker.running_count("persona-b"), 0);

        // Add one for persona B
        tracker.add_running("persona-b", "exec-b1");
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
        let result = tracker.admit("p1", "exec-1", 2, ExecutionPriority::Normal);
        assert!(matches!(result, AdmitResult::Running));
        assert_eq!(tracker.running_count("p1"), 1);
        assert_eq!(tracker.queue_depth("p1"), 0);
    }

    #[test]
    fn test_admit_queues_when_at_capacity() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.add_running("p1", "exec-1");

        let result = tracker.admit("p1", "exec-2", 1, ExecutionPriority::Normal);
        assert!(matches!(result, AdmitResult::Queued { position: 0 }));
        assert_eq!(tracker.running_count("p1"), 1);
        assert_eq!(tracker.queue_depth("p1"), 1);
    }

    #[test]
    fn test_admit_backpressure_when_queue_full() {
        let mut tracker = ConcurrencyTracker::with_max_queue_depth(2);
        tracker.add_running("p1", "exec-run");

        // Fill queue
        tracker.admit("p1", "exec-q1", 1, ExecutionPriority::Normal);
        tracker.admit("p1", "exec-q2", 1, ExecutionPriority::Normal);

        // Third should be rejected
        let result = tracker.admit("p1", "exec-q3", 1, ExecutionPriority::Normal);
        assert!(matches!(result, AdmitResult::QueueFull { max_depth: 2 }));
        assert_eq!(tracker.queue_depth("p1"), 2);
    }

    #[test]
    fn test_priority_ordering() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.add_running("p1", "exec-run");

        // Enqueue normal, then urgent, then low
        tracker.admit("p1", "exec-normal", 1, ExecutionPriority::Normal);
        tracker.admit("p1", "exec-urgent", 1, ExecutionPriority::Urgent);
        tracker.admit("p1", "exec-low", 1, ExecutionPriority::Low);

        // Queue order should be: urgent, normal, low
        let ids = tracker.queued_ids("p1");
        assert_eq!(ids, vec!["exec-urgent", "exec-normal", "exec-low"]);
    }

    #[test]
    fn test_fifo_within_same_priority() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.add_running("p1", "exec-run");

        tracker.admit("p1", "exec-a", 1, ExecutionPriority::Normal);
        tracker.admit("p1", "exec-b", 1, ExecutionPriority::Normal);
        tracker.admit("p1", "exec-c", 1, ExecutionPriority::Normal);

        let ids = tracker.queued_ids("p1");
        assert_eq!(ids, vec!["exec-a", "exec-b", "exec-c"]);
    }

    #[test]
    fn test_drain_next_promotes_from_queue() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.add_running("p1", "exec-run");

        tracker.admit("p1", "exec-q1", 1, ExecutionPriority::Normal);
        tracker.admit("p1", "exec-q2", 1, ExecutionPriority::Normal);

        // Free a slot
        tracker.remove_running("p1", "exec-run");

        // Drain should promote exec-q1
        let next = tracker.drain_next("p1", 1);
        assert!(next.is_some());
        let promoted = next.unwrap();
        assert_eq!(promoted.execution_id, "exec-q1");
        assert!(promoted.wait_ms.is_some(), "wait_ms should be populated on promotion");
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
        tracker.add_running("p1", "exec-run");

        tracker.admit("p1", "exec-low", 1, ExecutionPriority::Low);
        tracker.admit("p1", "exec-urgent", 1, ExecutionPriority::Urgent);

        tracker.remove_running("p1", "exec-run");

        let next = tracker.drain_next("p1", 1).unwrap();
        assert_eq!(next.execution_id, "exec-urgent");
    }

    #[test]
    fn test_remove_queued() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.add_running("p1", "exec-run");

        tracker.admit("p1", "exec-q1", 1, ExecutionPriority::Normal);
        tracker.admit("p1", "exec-q2", 1, ExecutionPriority::Normal);

        assert!(tracker.remove_queued("p1", "exec-q1"));
        assert_eq!(tracker.queue_depth("p1"), 1);
        assert_eq!(tracker.queued_ids("p1"), vec!["exec-q2"]);

        // Removing non-existent returns false
        assert!(!tracker.remove_queued("p1", "exec-q1"));
    }

    #[test]
    fn test_queue_position() {
        let mut tracker = ConcurrencyTracker::new();
        tracker.add_running("p1", "exec-run");

        tracker.admit("p1", "exec-q1", 1, ExecutionPriority::Normal);
        tracker.admit("p1", "exec-q2", 1, ExecutionPriority::Normal);
        tracker.admit("p1", "exec-q3", 1, ExecutionPriority::Normal);

        assert_eq!(tracker.queue_position("p1", "exec-q1"), Some(0));
        assert_eq!(tracker.queue_position("p1", "exec-q2"), Some(1));
        assert_eq!(tracker.queue_position("p1", "exec-q3"), Some(2));
        assert_eq!(tracker.queue_position("p1", "exec-nonexistent"), None);
    }
}
