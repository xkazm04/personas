use std::collections::{HashMap, HashSet};

/// Pure concurrency tracking logic for persona execution slots.
///
/// Tracks which executions are running per persona and enforces
/// max_concurrent limits without any I/O.
pub struct ConcurrencyTracker {
    /// Maps persona_id -> set of currently running execution_ids
    running: HashMap<String, HashSet<String>>,
}

impl ConcurrencyTracker {
    /// Create a new empty tracker.
    pub fn new() -> Self {
        Self {
            running: HashMap::new(),
        }
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

    /// Count running executions for a specific persona.
    pub fn running_count(&self, persona_id: &str) -> usize {
        self.running
            .get(persona_id)
            .map_or(0, |set| set.len())
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

        // Second add should fail (1/1 — at capacity)
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
}
