//! Unified process session trait for multi-step lifecycle management.
//!
//! Design analysis, lab runs, n8n transforms, test runs, and executions all
//! follow the same shape: create record, transition through phases, track
//! progress, support cancellation, persist results. This module extracts the
//! common lifecycle contract into a trait system.
//!
//! # Architecture
//!
//! - [`SessionState`] — trait for per-domain state enums (status machines).
//! - [`ProcessSession`] — trait for session records with lifecycle operations.
//! - [`ProcessContext`] — helper that wraps `ActiveProcessRegistry` interaction,
//!   providing guarded registration, cancellation flag propagation, and
//!   cleanup-on-drop semantics.
//!
//! Each domain defines its state enum (implementing [`SessionState`]) and its
//! session struct (implementing [`ProcessSession`]). The trait enforces atomic
//! status transitions and provides a uniform cancellation + cleanup contract.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::ActiveProcessRegistry;

// =============================================================================
// SessionState — trait for per-domain state enums
// =============================================================================

/// Trait that all process lifecycle state enums must implement.
///
/// Provides a uniform interface for state machine operations regardless of the
/// underlying enum. Enums created with `declare_lifecycle!` satisfy most of
/// these requirements already; implement the remaining methods in a small
/// `impl SessionState for ...` block.
#[allow(dead_code)]
pub trait SessionState: Copy + Clone + Send + Sync + 'static + std::fmt::Debug {
    /// Entity name for error messages (e.g. "execution", "lab_run").
    const ENTITY: &'static str;

    /// String representation for DB persistence.
    fn as_str(&self) -> &'static str;

    /// Parse from a DB string value.
    fn from_db(s: &str) -> Result<Self, String>;

    /// Whether this state is terminal (no further transitions allowed).
    fn is_terminal(&self) -> bool;

    /// The canonical "failed" terminal state.
    fn failed() -> Self;

    /// The canonical "cancelled" terminal state.
    fn cancelled() -> Self;

    /// Whether transitioning from `self` to `target` is valid.
    fn can_transition_to(&self, target: Self) -> bool;

    /// Attempt a state transition, returning the new state or an error message.
    fn transition_to(self, target: Self) -> Result<Self, String> {
        if self.as_str() == target.as_str() {
            return Ok(self); // no-op for same-state
        }
        if self.is_terminal() {
            return Err(format!(
                "{}: cannot transition from terminal state '{}' to '{}'",
                Self::ENTITY,
                self.as_str(),
                target.as_str(),
            ));
        }
        if self.can_transition_to(target) {
            Ok(target)
        } else {
            Err(format!(
                "Invalid {} transition: '{}' -> '{}'",
                Self::ENTITY,
                self.as_str(),
                target.as_str(),
            ))
        }
    }
}

// =============================================================================
// ProcessSession — trait for session records
// =============================================================================

/// Unified lifecycle trait for multi-step process sessions.
///
/// Implementors define their state enum and phase-specific logic. The trait
/// enforces validated status transitions and provides uniform `cancel()` /
/// `fail()` / `complete()` entry points.
///
/// For `ActiveProcessRegistry` integration, use [`ProcessContext`] which
/// provides guarded registration and cancellation flag propagation.
#[allow(dead_code)]
pub trait ProcessSession {
    /// The state machine enum for this process domain.
    type State: SessionState;

    /// Domain name used for `ActiveProcessRegistry` keys
    /// (e.g. "test", "lab", "n8n").
    const DOMAIN: &'static str;

    /// The unique session/run ID.
    fn session_id(&self) -> &str;

    /// Current state of this session.
    fn current_state(&self) -> Self::State;

    /// Set the state (called internally after validation).
    /// Implementors should update their status field here.
    fn set_state(&mut self, state: Self::State);

    /// Optional error message setter (called by `fail()`).
    fn set_error(&mut self, _error: String) {}

    /// Optional completed_at timestamp setter (called by terminal transitions).
    fn set_completed_at(&mut self, _timestamp: String) {}

    /// Transition to a new state with validation.
    fn transition(&mut self, target: Self::State) -> Result<Self::State, String> {
        let current = self.current_state();
        let new_state = current.transition_to(target)?;
        self.set_state(new_state);
        if new_state.is_terminal() {
            self.set_completed_at(chrono::Utc::now().to_rfc3339());
        }
        Ok(new_state)
    }

    /// Mark the session as cancelled.
    fn cancel(&mut self) -> Result<Self::State, String> {
        self.transition(Self::State::cancelled())
    }

    /// Mark the session as failed with an error message.
    fn fail(&mut self, error: &str) -> Result<Self::State, String> {
        self.set_error(error.to_string());
        self.transition(Self::State::failed())
    }
}

// =============================================================================
// ProcessContext — ActiveProcessRegistry integration
// =============================================================================

/// Wraps `ActiveProcessRegistry` interaction for a process session.
///
/// Provides:
/// - Guarded run registration (auto-unregister on drop via `RunGuard`)
/// - Cancellation flag access
/// - Convenience methods for checking cancellation and setting PIDs
///
/// # Usage
///
/// ```ignore
/// let ctx = ProcessContext::register(&state.process_registry, "lab", &run_id);
/// // ... in background task loop:
/// if ctx.is_cancelled() { break; }
/// // ctx auto-unregisters when dropped
/// ```
#[allow(dead_code)]
pub struct ProcessContext {
    domain: String,
    run_id: String,
    cancelled: Arc<AtomicBool>,
    registry: Arc<ActiveProcessRegistry>,
    /// Set to false once `into_guard_parts` is called, so Drop knows not
    /// to double-unregister.
    owns_registration: bool,
}

#[allow(dead_code)]
impl ProcessContext {
    /// Register a new process run and return a context that auto-unregisters on drop.
    pub fn register(
        registry: &Arc<ActiveProcessRegistry>,
        domain: &str,
        run_id: &str,
    ) -> Self {
        let cancelled = registry.register_run(domain, run_id);
        Self {
            domain: domain.to_string(),
            run_id: run_id.to_string(),
            cancelled,
            registry: Arc::clone(registry),
            owns_registration: true,
        }
    }

    /// Check whether cancellation has been requested.
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    /// Get a clone of the cancellation flag (for passing to sub-tasks).
    pub fn cancelled_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancelled)
    }

    /// Store a child PID for this run.
    pub fn set_pid(&self, pid: u32) {
        self.registry.set_run_pid(&self.domain, &self.run_id, pid);
    }

    /// Take (remove and return) the child PID.
    pub fn take_pid(&self) -> Option<u32> {
        self.registry.take_run_pid(&self.domain, &self.run_id)
    }

    /// Request cancellation of this run.
    pub fn request_cancel(&self) {
        self.registry.cancel_run(&self.domain, &self.run_id);
    }

    /// Decompose into the cancellation flag, releasing ownership of the
    /// registration. The caller is responsible for calling
    /// `registry.unregister_run()` when done — typically via a `RunGuard`
    /// obtained from `register_run_guarded()`.
    ///
    /// This is useful when you need the flag but want the existing `RunGuard`
    /// drop semantics from the registry directly.
    pub fn into_parts(mut self) -> (Arc<AtomicBool>, Arc<ActiveProcessRegistry>, String, String) {
        self.owns_registration = false;
        (
            self.cancelled.clone(),
            self.registry.clone(),
            self.domain.clone(),
            self.run_id.clone(),
        )
    }

    /// Domain name.
    pub fn domain(&self) -> &str {
        &self.domain
    }

    /// Run ID.
    pub fn run_id(&self) -> &str {
        &self.run_id
    }
}

impl Drop for ProcessContext {
    fn drop(&mut self) {
        if self.owns_registration {
            self.registry.unregister_run(&self.domain, &self.run_id);
        }
    }
}

// =============================================================================
// SessionState impls for existing enums
// =============================================================================

// -- ExecutionState -----------------------------------------------------------

impl SessionState for super::types::ExecutionState {
    const ENTITY: &'static str = "execution";

    fn as_str(&self) -> &'static str {
        // Delegate to the existing method generated by declare_lifecycle!
        super::types::ExecutionState::as_str(self)
    }

    fn from_db(s: &str) -> Result<Self, String> {
        s.parse::<Self>()
    }

    fn is_terminal(&self) -> bool {
        super::types::ExecutionState::is_terminal(self)
    }

    fn failed() -> Self {
        super::types::ExecutionState::Failed
    }

    fn cancelled() -> Self {
        super::types::ExecutionState::Cancelled
    }

    fn can_transition_to(&self, target: Self) -> bool {
        // Delegate to the existing method generated by declare_lifecycle!
        super::types::ExecutionState::can_transition_to(self, target)
    }
}

// -- LabRunStatus -------------------------------------------------------------

impl SessionState for crate::db::models::LabRunStatus {
    const ENTITY: &'static str = "lab_run";

    fn as_str(&self) -> &'static str {
        crate::db::models::LabRunStatus::as_str(self)
    }

    fn from_db(s: &str) -> Result<Self, String> {
        // LabRunStatus::from_db never fails (unknown → Failed), wrap it
        Ok(crate::db::models::LabRunStatus::from_db(s))
    }

    fn is_terminal(&self) -> bool {
        crate::db::models::LabRunStatus::is_terminal(self)
    }

    fn failed() -> Self {
        crate::db::models::LabRunStatus::Failed
    }

    fn cancelled() -> Self {
        crate::db::models::LabRunStatus::Cancelled
    }

    fn can_transition_to(&self, target: Self) -> bool {
        crate::db::models::LabRunStatus::validate_transition(self, target).is_ok()
    }
}

// -- SessionStatus (N8N) ------------------------------------------------------

impl SessionState for crate::db::models::SessionStatus {
    const ENTITY: &'static str = "n8n_session";

    fn as_str(&self) -> &'static str {
        crate::db::models::SessionStatus::as_str(*self)
    }

    fn from_db(s: &str) -> Result<Self, String> {
        use crate::db::models::SessionStatus;
        match s {
            "draft" => Ok(SessionStatus::Draft),
            "analyzing" => Ok(SessionStatus::Analyzing),
            "transforming" => Ok(SessionStatus::Transforming),
            "awaiting_answers" => Ok(SessionStatus::AwaitingAnswers),
            "editing" => Ok(SessionStatus::Editing),
            "confirmed" => Ok(SessionStatus::Confirmed),
            "failed" => Ok(SessionStatus::Failed),
            "interrupted" => Ok(SessionStatus::Interrupted),
            other => Err(format!("Unknown n8n session status: '{other}'")),
        }
    }

    fn is_terminal(&self) -> bool {
        use crate::db::models::SessionStatus;
        matches!(self, SessionStatus::Confirmed | SessionStatus::Failed | SessionStatus::Interrupted)
    }

    fn failed() -> Self {
        crate::db::models::SessionStatus::Failed
    }

    fn cancelled() -> Self {
        // N8N sessions use "interrupted" as their cancellation equivalent
        crate::db::models::SessionStatus::Interrupted
    }

    fn can_transition_to(&self, target: Self) -> bool {
        use crate::db::models::SessionStatus;
        // N8N sessions can always transition to Failed or Interrupted from any non-terminal state
        if matches!(target, SessionStatus::Failed | SessionStatus::Interrupted) {
            return !self.is_terminal();
        }
        // Define the valid forward transitions
        matches!(
            (self, target),
            (SessionStatus::Draft, SessionStatus::Analyzing)
                | (SessionStatus::Analyzing, SessionStatus::Transforming)
                | (SessionStatus::Analyzing, SessionStatus::AwaitingAnswers)
                | (SessionStatus::Transforming, SessionStatus::AwaitingAnswers)
                | (SessionStatus::Transforming, SessionStatus::Confirmed)
                | (SessionStatus::AwaitingAnswers, SessionStatus::Editing)
                | (SessionStatus::AwaitingAnswers, SessionStatus::Transforming)
                | (SessionStatus::Editing, SessionStatus::Transforming)
                | (SessionStatus::Editing, SessionStatus::AwaitingAnswers)
        )
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::LabRunStatus;
    use crate::db::models::SessionStatus;
    use crate::engine::types::ExecutionState;

    // -- SessionState trait tests --

    #[test]
    fn execution_state_satisfies_session_state() {
        assert_eq!(ExecutionState::ENTITY, "execution");
        assert_eq!(
            <ExecutionState as SessionState>::as_str(&ExecutionState::Queued),
            "queued"
        );
        assert!(!ExecutionState::Queued.is_terminal());
        assert!(ExecutionState::Completed.is_terminal());
        assert!(ExecutionState::Failed.is_terminal());
        assert!(ExecutionState::Cancelled.is_terminal());
    }

    #[test]
    fn execution_state_transition_to_via_trait() {
        let state = ExecutionState::Queued;
        let next = SessionState::transition_to(state, ExecutionState::Running);
        assert_eq!(next, Ok(ExecutionState::Running));
    }

    #[test]
    fn execution_state_invalid_transition_via_trait() {
        let state = ExecutionState::Completed;
        let next = SessionState::transition_to(state, ExecutionState::Running);
        assert!(next.is_err());
        assert!(next.unwrap_err().contains("terminal state"));
    }

    #[test]
    fn execution_state_same_state_noop() {
        let state = ExecutionState::Running;
        let next = SessionState::transition_to(state, ExecutionState::Running);
        assert_eq!(next, Ok(ExecutionState::Running));
    }

    #[test]
    fn lab_run_status_satisfies_session_state() {
        assert_eq!(LabRunStatus::ENTITY, "lab_run");
        assert!(!LabRunStatus::Generating.is_terminal());
        assert!(LabRunStatus::Completed.is_terminal());
        assert!(LabRunStatus::Failed.is_terminal());
        assert!(LabRunStatus::Cancelled.is_terminal());
    }

    #[test]
    fn lab_run_status_transitions() {
        assert!(LabRunStatus::Drafting.can_transition_to(LabRunStatus::Generating));
        assert!(LabRunStatus::Generating.can_transition_to(LabRunStatus::Running));
        assert!(LabRunStatus::Running.can_transition_to(LabRunStatus::Completed));
        assert!(!LabRunStatus::Completed.can_transition_to(LabRunStatus::Running));
    }

    #[test]
    fn lab_run_status_from_db_roundtrip() {
        for status in [
            LabRunStatus::Drafting,
            LabRunStatus::Generating,
            LabRunStatus::Running,
            LabRunStatus::Completed,
            LabRunStatus::Failed,
            LabRunStatus::Cancelled,
        ] {
            let s = SessionState::as_str(&status);
            let parsed = <LabRunStatus as SessionState>::from_db(s).unwrap();
            assert_eq!(parsed, status);
        }
    }

    #[test]
    fn n8n_session_status_satisfies_session_state() {
        assert_eq!(SessionStatus::ENTITY, "n8n_session");
        assert!(!SessionStatus::Draft.is_terminal());
        assert!(!SessionStatus::Analyzing.is_terminal());
        assert!(SessionStatus::Confirmed.is_terminal());
        assert!(SessionStatus::Failed.is_terminal());
        assert!(SessionStatus::Interrupted.is_terminal());
    }

    #[test]
    fn n8n_session_status_forward_transitions() {
        assert!(SessionStatus::Draft.can_transition_to(SessionStatus::Analyzing));
        assert!(SessionStatus::Analyzing.can_transition_to(SessionStatus::Transforming));
        assert!(SessionStatus::Transforming.can_transition_to(SessionStatus::AwaitingAnswers));
        assert!(SessionStatus::AwaitingAnswers.can_transition_to(SessionStatus::Editing));
    }

    #[test]
    fn n8n_session_status_fail_from_any_non_terminal() {
        for status in [
            SessionStatus::Draft,
            SessionStatus::Analyzing,
            SessionStatus::Transforming,
            SessionStatus::AwaitingAnswers,
            SessionStatus::Editing,
        ] {
            assert!(
                status.can_transition_to(SessionStatus::Failed),
                "{:?} should be able to transition to Failed",
                status
            );
            assert!(
                status.can_transition_to(SessionStatus::Interrupted),
                "{:?} should be able to transition to Interrupted",
                status
            );
        }
    }

    #[test]
    fn n8n_session_status_no_transition_from_terminal() {
        for status in [
            SessionStatus::Confirmed,
            SessionStatus::Failed,
            SessionStatus::Interrupted,
        ] {
            assert!(
                !status.can_transition_to(SessionStatus::Draft),
                "{:?} should not transition to Draft",
                status
            );
        }
    }

    #[test]
    fn n8n_session_status_from_db_roundtrip() {
        for status in [
            SessionStatus::Draft,
            SessionStatus::Analyzing,
            SessionStatus::Transforming,
            SessionStatus::AwaitingAnswers,
            SessionStatus::Editing,
            SessionStatus::Confirmed,
            SessionStatus::Failed,
            SessionStatus::Interrupted,
        ] {
            let s = SessionState::as_str(&status);
            let parsed = SessionStatus::from_db(s).unwrap();
            assert_eq!(parsed, status);
        }
    }

    // -- ProcessSession trait tests --

    /// Minimal test session to verify trait mechanics.
    struct TestSession {
        // Required by the ProcessSession trait via `session_id()`. Tests don't
        // currently exercise the id directly — keep the field so the trait
        // impl stays valid but silence the dead-code lint.
        #[allow(dead_code)]
        id: String,
        state: ExecutionState,
        error: Option<String>,
        completed_at: Option<String>,
    }

    impl TestSession {
        fn new(id: &str, state: ExecutionState) -> Self {
            Self {
                id: id.to_string(),
                state,
                error: None,
                completed_at: None,
            }
        }
    }

    impl ProcessSession for TestSession {
        type State = ExecutionState;
        const DOMAIN: &'static str = "test";

        fn session_id(&self) -> &str {
            &self.id
        }

        fn current_state(&self) -> ExecutionState {
            self.state
        }

        fn set_state(&mut self, state: ExecutionState) {
            self.state = state;
        }

        fn set_error(&mut self, error: String) {
            self.error = Some(error);
        }

        fn set_completed_at(&mut self, ts: String) {
            self.completed_at = Some(ts);
        }
    }

    #[test]
    fn process_session_transition_happy_path() {
        let mut session = TestSession::new("run-1", ExecutionState::Queued);
        let result = session.transition(ExecutionState::Running);
        assert_eq!(result, Ok(ExecutionState::Running));
        assert_eq!(session.current_state(), ExecutionState::Running);
        assert!(session.completed_at.is_none()); // non-terminal
    }

    #[test]
    fn process_session_transition_to_terminal_sets_completed_at() {
        let mut session = TestSession::new("run-2", ExecutionState::Running);
        let result = session.transition(ExecutionState::Completed);
        assert_eq!(result, Ok(ExecutionState::Completed));
        assert!(session.completed_at.is_some());
    }

    #[test]
    fn process_session_cancel() {
        let mut session = TestSession::new("run-3", ExecutionState::Running);
        let result = session.cancel();
        assert_eq!(result, Ok(ExecutionState::Cancelled));
        assert!(session.completed_at.is_some());
    }

    #[test]
    fn process_session_fail_sets_error() {
        let mut session = TestSession::new("run-4", ExecutionState::Running);
        let result = session.fail("something broke");
        assert_eq!(result, Ok(ExecutionState::Failed));
        assert_eq!(session.error.as_deref(), Some("something broke"));
        assert!(session.completed_at.is_some());
    }

    #[test]
    fn process_session_cannot_cancel_terminal() {
        let mut session = TestSession::new("run-5", ExecutionState::Completed);
        let result = session.cancel();
        assert!(result.is_err());
    }

    // -- ProcessContext tests --

    #[test]
    fn process_context_register_and_cancel() {
        let registry = Arc::new(ActiveProcessRegistry::new());
        let ctx = ProcessContext::register(&registry, "test", "run-1");

        assert!(!ctx.is_cancelled());
        assert!(registry.is_run_registered("test", "run-1"));

        ctx.request_cancel();
        assert!(ctx.is_cancelled());
    }

    #[test]
    fn process_context_unregisters_on_drop() {
        let registry = Arc::new(ActiveProcessRegistry::new());
        {
            let _ctx = ProcessContext::register(&registry, "test", "run-2");
            assert!(registry.is_run_registered("test", "run-2"));
        }
        // After drop, the run should be unregistered
        assert!(!registry.is_run_registered("test", "run-2"));
    }

    #[test]
    fn process_context_into_parts_prevents_double_unregister() {
        let registry = Arc::new(ActiveProcessRegistry::new());
        let ctx = ProcessContext::register(&registry, "test", "run-3");
        let (flag, reg, domain, run_id) = ctx.into_parts();
        // Registration still exists (not unregistered by into_parts)
        assert!(reg.is_run_registered("test", "run-3"));
        // Flag is usable
        assert!(!flag.load(Ordering::Acquire));
        // Manual cleanup
        reg.unregister_run(&domain, &run_id);
        assert!(!reg.is_run_registered("test", "run-3"));
    }

    #[test]
    fn process_context_pid_management() {
        let registry = Arc::new(ActiveProcessRegistry::new());
        let ctx = ProcessContext::register(&registry, "test", "run-4");

        assert_eq!(ctx.take_pid(), None);
        ctx.set_pid(12345);
        assert_eq!(ctx.take_pid(), Some(12345));
        assert_eq!(ctx.take_pid(), None); // taken
    }
}
