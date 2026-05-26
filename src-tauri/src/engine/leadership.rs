//! Engine leadership — which running instance owns the singleton background
//! loops (scheduler, OAuth refresh, polling, webhook notifier, project
//! tracking, …) against the ONE shared local DB.
//!
//! # Why
//!
//! Multiple processes can run against one local device/DB at once: the
//! windowed Tauri app, the `personas-daemon` binary, and (future) instances
//! spawned for parallel testing. Each currently runs its OWN copy of every
//! background loop, so two instances double-fire schedulers, double-rotate
//! OAuth tokens, etc. (WAL keeps the file intact; the behavior is wrong.)
//!
//! This module generalizes the proven `daemon.lock` heartbeat-lease
//! ([`crate::daemon::lock`]) so that *any* instance can hold engine
//! leadership — not just the daemon binary. Exactly one holder at a time is
//! the **leader**; everyone else is a **follower**. Followers run the local
//! UI + bridges + can submit intents, but defer the singleton loops to the
//! leader (the gating is wired in a later phase; this module only establishes
//! *who* the leader is).
//!
//! # Model
//!
//! Leadership *is* the lock file. `try_acquire()` atomically creates it; if a
//! fresh lock already exists, this instance is a follower. A stale lock
//! (heartbeat older than [`STALE_THRESHOLD`]) is taken over. The leader
//! refreshes the heartbeat every [`HEARTBEAT_INTERVAL`] via [`Self::tick`];
//! a follower's `tick` re-attempts acquisition so it takes over within the
//! stale window if the leader dies.
//!
//! Single-instance degrades to "the one instance acquires → leader → runs
//! everything" — today's behavior, one file check of overhead at startup.
//!
//! # Precedence (intentional follow-up)
//!
//! The first instance to boot wins. In the common deployments this is
//! correct: an always-on daemon acquires before any UI; with no daemon, the
//! first UI leads. The refinement where a *starting daemon preempts a UI
//! leader* (so headless trigger firing is never weaker than today) is tracked
//! in the multi-driver-orchestration ADR — it needs a `role` field in the
//! lock + a preemption path, deliberately out of scope for this foundational
//! commit (which changes no existing behavior).

use std::path::PathBuf;
use std::sync::Mutex;

use crate::daemon::lock::{default_data_dir, DaemonLock, LockError, TriggerKind};

/// All trigger kinds — a generalized engine leader owns every singleton loop,
/// not just the narrow set the daemon historically claimed.
fn all_owned_kinds() -> Vec<TriggerKind> {
    vec![
        TriggerKind::Cron,
        TriggerKind::Polling,
        TriggerKind::Webhook,
        TriggerKind::SmeeRelay,
        TriggerKind::SharedEventRelay,
        TriggerKind::CloudWebhookRelay,
    ]
}

/// Per-process engine-leadership state. Held in `AppState` (one per process).
///
/// `instance_id` is a fresh UUID per launch — it distinguishes concurrent
/// instances of the *same install* (the device `peer_id` is per-install and
/// can't tell two running processes apart).
pub struct EngineLeadership {
    instance_id: String,
    app_data_dir: PathBuf,
    /// `Some(lock)` iff this instance currently holds leadership.
    lock: Mutex<Option<DaemonLock>>,
}

impl EngineLeadership {
    /// Construct for a given app-data dir (where `daemon.lock` lives). Does
    /// NOT acquire — call [`Self::try_acquire`] at startup.
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            instance_id: uuid::Uuid::new_v4().to_string(),
            app_data_dir,
            lock: Mutex::new(None),
        }
    }

    /// Construct against the default app-data dir.
    pub fn with_default_dir() -> Self {
        Self::new(default_data_dir())
    }

    /// Stable per-PROCESS id (new each launch).
    pub fn instance_id(&self) -> &str {
        &self.instance_id
    }

    /// Attempt to become the engine leader. Idempotent — if already leader,
    /// returns `true` without touching the file. Returns whether this instance
    /// holds leadership after the call.
    pub fn try_acquire(&self) -> bool {
        let mut guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_some() {
            return true;
        }
        match DaemonLock::acquire(&self.app_data_dir, all_owned_kinds()) {
            Ok(lock) => {
                tracing::info!(
                    instance_id = %self.instance_id,
                    "engine leadership acquired"
                );
                *guard = Some(lock);
                true
            }
            Err(LockError::AlreadyHeld { pid, heartbeat_at }) => {
                tracing::debug!(
                    instance_id = %self.instance_id,
                    leader_pid = pid,
                    leader_heartbeat = %heartbeat_at,
                    "engine leadership held by another instance — following"
                );
                false
            }
            Err(e) => {
                tracing::warn!(error = %e, "engine leadership acquire failed — assuming follower");
                false
            }
        }
    }

    /// Whether this instance currently holds leadership.
    pub fn is_leader(&self) -> bool {
        self.lock
            .lock()
            .map(|g| g.is_some())
            .unwrap_or(false)
    }

    /// Heartbeat tick. If leader, refresh the lease (relinquishing on write
    /// failure). If follower, re-attempt acquisition so a dead leader's lease
    /// is taken over within the stale window. Call every
    /// [`crate::daemon::lock::HEARTBEAT_INTERVAL`].
    pub fn tick(&self) {
        let need_acquire = {
            let mut guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
            match guard.as_mut() {
                Some(lock) => {
                    if let Err(e) = lock.heartbeat() {
                        tracing::warn!(
                            error = %e,
                            "engine leadership heartbeat failed — relinquishing leadership"
                        );
                        *guard = None;
                        false
                    } else {
                        false
                    }
                }
                None => true,
            }
        };
        if need_acquire {
            // Follower (or just-relinquished): try to take over a stale lease.
            self.try_acquire();
        }
    }

    /// Relinquish leadership (clean shutdown). No-op for a follower.
    pub fn release(&self) {
        let mut guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(lock) = guard.take() {
            let _ = lock.release();
            tracing::info!(instance_id = %self.instance_id, "engine leadership released");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn lone_instance_becomes_leader() {
        let tmp = TempDir::new().unwrap();
        let l = EngineLeadership::new(tmp.path().to_path_buf());
        assert!(!l.is_leader());
        assert!(l.try_acquire());
        assert!(l.is_leader());
        // Idempotent.
        assert!(l.try_acquire());
        assert!(l.is_leader());
    }

    #[test]
    fn second_instance_is_follower_then_takes_over() {
        let tmp = TempDir::new().unwrap();
        let leader = EngineLeadership::new(tmp.path().to_path_buf());
        let follower = EngineLeadership::new(tmp.path().to_path_buf());
        assert!(leader.try_acquire());
        assert!(!follower.try_acquire(), "second instance must follow");
        assert!(!follower.is_leader());
        // Leader relinquishes; follower's tick takes over.
        leader.release();
        follower.tick();
        assert!(follower.is_leader(), "follower must take over a released lease");
    }

    #[test]
    fn instance_ids_are_distinct_per_process_object() {
        let tmp = TempDir::new().unwrap();
        let a = EngineLeadership::new(tmp.path().to_path_buf());
        let b = EngineLeadership::new(tmp.path().to_path_buf());
        assert_ne!(a.instance_id(), b.instance_id());
    }

    #[test]
    fn heartbeat_keeps_leadership() {
        let tmp = TempDir::new().unwrap();
        let l = EngineLeadership::new(tmp.path().to_path_buf());
        assert!(l.try_acquire());
        l.tick(); // heartbeat
        assert!(l.is_leader());
    }
}
