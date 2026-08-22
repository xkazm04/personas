//! Active-process / run bookkeeping shared by every CLI-backed command.
//!
//! Moved out of `lib.rs` unchanged (Rust refactor W1) — the crate root was the
//! most-parsed file in the repository and this block had no reason to live
//! there. No behaviour, visibility or signature changed in the move.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::keyed_pool::KeyedResourcePool;

/// Tracks an active CLI-backed process: its task ID and optional child PID.
pub struct ActiveProcess {
    /// The ID of the currently-running task (e.g. design_id, negotiation_id).
    pub id: Option<String>,
    /// Optional identifier of the domain resource this run targets (e.g. the
    /// recipe id for `recipe_execution`/`recipe_versioning`). Lets callers ask
    /// "is a run in flight for *this* resource?" instead of "any run at all?".
    /// Cleared together with `id` so it never lingers past the run.
    pub target_ref: Option<String>,
    /// PID of the CLI child process, used to kill on cancel.
    pub child_pid: Option<u32>,
    /// Per-run cancellation token.  Set to `true` when the run is superseded
    /// (new run starts and kills the old process) or explicitly cancelled.
    pub cancelled: Arc<AtomicBool>,
}

impl Default for ActiveProcess {
    fn default() -> Self {
        Self {
            id: None,
            target_ref: None,
            child_pid: None,
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }
}

/// Combined state for a multi-run entry: cancellation flag and optional child PID.
///
/// Replaces the previous two-HashMap split (`run_flags` + `run_pids`).
#[derive(Clone)]
pub struct RunEntry {
    pub flag: Arc<AtomicBool>,
    pub pid: Option<u32>,
}

/// Unified registry for all active child processes and cancellation flags.
///
/// Consolidates two patterns into a single structure:
///
/// 1. **Single-process domains** (design, credential_design, negotiation,
///    automation_design, auto_cred): one active (id, child_pid) pair per domain.
///
/// 2. **Multi-run domains** (test, pipeline, review, setup): multiple concurrent
///    runs per domain, each with an `AtomicBool` cancellation flag and optional
///    child PID. Stored in a single [`KeyedResourcePool`] keyed by
///    `"{domain}\0{run_id}"`.
pub struct ActiveProcessRegistry {
    /// Single-process domains: one active (id, pid) per domain.
    processes: Mutex<HashMap<String, ActiveProcess>>,
    /// Multi-run entries keyed by `"{domain}\0{run_id}"`.
    runs: KeyedResourcePool<String, RunEntry>,
}

impl Default for ActiveProcessRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ActiveProcessRegistry {
    pub fn new() -> Self {
        Self {
            processes: Mutex::new(HashMap::new()),
            // No automatic pruning — entries are explicitly removed via unregister_run.
            runs: KeyedResourcePool::new(0, 0),
        }
    }

    fn run_key(domain: &str, run_id: &str) -> String {
        format!("{domain}\0{run_id}")
    }

    // ── Single-process domain methods ──────────────────────────────

    /// Set the active task ID for a domain.
    pub fn set_id(&self, domain: &str, id: String) {
        let mut map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        map.entry(domain.to_string()).or_default().id = Some(id);
    }

    /// Atomically begin a new run for a single-process domain.
    ///
    /// - Marks the previous run (if any) as cancelled via its `AtomicBool`.
    /// - Takes the previous child PID (for the caller to kill).
    /// - Installs the new `id` and returns a fresh cancellation token.
    ///
    /// This prevents the race where a completed-but-not-yet-checked run sees its
    /// registry ID overwritten by a newer run and silently discards a valid result.
    pub fn begin_run(&self, domain: &str, id: String) -> (Option<u32>, Arc<AtomicBool>) {
        let mut map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        let proc = map.entry(domain.to_string()).or_default();

        // Cancel the previous run
        proc.cancelled.store(true, Ordering::Release);

        // Take the old PID so the caller can kill the child process
        let old_pid = proc.child_pid.take();

        // Install new run state
        let token = Arc::new(AtomicBool::new(false));
        proc.id = Some(id);
        proc.target_ref = None;
        proc.cancelled = token.clone();

        (old_pid, token)
    }

    /// Atomically claim a single-process domain for a new run *without*
    /// displacing an existing one. Returns `true` if no run was active and `id`
    /// is now installed; `false` if a run is already in progress (the caller
    /// should reject). The check-and-install happen under one lock acquisition,
    /// so two concurrent starts can never both win — unlike a `get_id()`-then-
    /// `set_id()` pair, which races across an `.await` and lets both pass the
    /// guard, spawning duplicate tasks and silently discarding a result
    /// (bug-hunt 2026-06-07 recipes #2).
    pub fn try_begin(&self, domain: &str, id: String) -> bool {
        let mut map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        let proc = map.entry(domain.to_string()).or_default();
        if proc.id.is_some() {
            return false;
        }
        proc.id = Some(id);
        proc.target_ref = None;
        true
    }

    /// Get the active task ID for a domain.
    pub fn get_id(&self, domain: &str) -> Option<String> {
        let map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        map.get(domain).and_then(|p| p.id.clone())
    }

    /// Record the domain resource this run targets (e.g. the recipe id for a
    /// recipe execution/versioning run). Pairs with [`Self::active_target`] so
    /// conflict checks can be scoped to the specific resource.
    pub fn set_target(&self, domain: &str, target: Option<String>) {
        let mut map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        map.entry(domain.to_string()).or_default().target_ref = target;
    }

    /// Return the target resource id of the *active* run for a domain, if any.
    /// Returns `None` when no run is active, even if a stale `target_ref`
    /// somehow lingers — so callers never see a phantom conflict.
    pub fn active_target(&self, domain: &str) -> Option<String> {
        let map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        map.get(domain).and_then(|p| {
            if p.id.is_some() {
                p.target_ref.clone()
            } else {
                None
            }
        })
    }

    /// Clear the active task ID for a domain (only if it matches the expected value).
    pub fn clear_id_if(&self, domain: &str, expected: &str) {
        let mut map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(proc) = map.get_mut(domain) {
            if proc.id.as_deref() == Some(expected) {
                proc.id = None;
                proc.target_ref = None;
            }
        }
    }

    /// Clear the active task ID unconditionally and return the old value.
    pub fn take_id(&self, domain: &str) -> Option<String> {
        let mut map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        map.get_mut(domain).and_then(|p| {
            p.target_ref = None;
            p.id.take()
        })
    }

    /// Set the child PID for a domain.
    pub fn set_pid(&self, domain: &str, pid: u32) {
        let mut map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        map.entry(domain.to_string()).or_default().child_pid = Some(pid);
    }

    /// Take (remove and return) the child PID for a domain.
    pub fn take_pid(&self, domain: &str) -> Option<u32> {
        let mut map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        map.get_mut(domain).and_then(|p| p.child_pid.take())
    }

    /// Clear the child PID for a domain.
    pub fn clear_pid(&self, domain: &str) {
        let mut map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(proc) = map.get_mut(domain) {
            proc.child_pid = None;
        }
    }

    /// Cancel an active process: set the cancelled flag, clear the ID, and
    /// return the child PID so the caller can kill the process.
    pub fn cancel(&self, domain: &str) -> Option<u32> {
        let mut map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(proc) = map.get_mut(domain) {
            proc.cancelled.store(true, Ordering::Release);
            proc.id = None;
            proc.child_pid.take()
        } else {
            None
        }
    }

    // ── Multi-run domain methods ───────────────────────────────────

    /// Register a new run and return its cancellation flag (initialised to `false`).
    pub fn register_run(&self, domain: &str, run_id: &str) -> Arc<AtomicBool> {
        let key = Self::run_key(domain, run_id);
        let entry = RunEntry {
            flag: Arc::new(AtomicBool::new(false)),
            pid: None,
        };
        let flag = entry.flag.clone();
        self.runs.insert(key, entry);
        flag
    }

    /// Set the cancellation flag for a run to `true`.
    pub fn cancel_run(&self, domain: &str, run_id: &str) {
        let key = Self::run_key(domain, run_id);
        if let Some(entry) = self.runs.get(&key) {
            entry.flag.store(true, Ordering::Release);
        }
    }

    /// Check whether a run is currently registered (i.e. its background task is still active).
    pub fn is_run_registered(&self, domain: &str, run_id: &str) -> bool {
        let key = Self::run_key(domain, run_id);
        self.runs.get(&key).is_some()
    }

    /// Remove a run's entry (cleanup after completion).
    pub fn unregister_run(&self, domain: &str, run_id: &str) {
        let key = Self::run_key(domain, run_id);
        self.runs.remove(&key);
    }

    /// Store a child PID for a multi-run.
    pub fn set_run_pid(&self, domain: &str, run_id: &str, pid: u32) {
        let key = Self::run_key(domain, run_id);
        self.runs.with_mut(&key, |entry| {
            entry.pid = Some(pid);
        });
    }

    /// Take (remove and return) the child PID for a multi-run.
    pub fn take_run_pid(&self, domain: &str, run_id: &str) -> Option<u32> {
        let key = Self::run_key(domain, run_id);
        self.runs.with_mut(&key, |entry| entry.pid.take()).flatten()
    }

    /// Remove a multi-run's child PID without returning it.
    pub fn clear_run_pid(&self, domain: &str, run_id: &str) {
        let key = Self::run_key(domain, run_id);
        self.runs.with_mut(&key, |entry| {
            entry.pid = None;
        });
    }

    /// Register a run and return `(cancellation_flag, guard)`.
    /// The guard calls `unregister_run` on drop — even if the task panics.
    pub fn register_run_guarded(
        self: &Arc<Self>,
        domain: &str,
        run_id: &str,
    ) -> (Arc<AtomicBool>, RunGuard) {
        let flag = self.register_run(domain, run_id);
        let guard = RunGuard {
            registry: Arc::clone(self),
            domain: domain.to_string(),
            run_id: run_id.to_string(),
        };
        (flag, guard)
    }
}

/// RAII guard that calls `unregister_run` when dropped.
/// Move this into a `tokio::spawn` block to guarantee cleanup on both
/// normal completion and task panic.
pub struct RunGuard {
    registry: Arc<ActiveProcessRegistry>,
    domain: String,
    run_id: String,
}

impl Drop for RunGuard {
    fn drop(&mut self) {
        self.registry.unregister_run(&self.domain, &self.run_id);
    }
}
