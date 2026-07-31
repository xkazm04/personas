//! Write-attribution context for the Reversible Agent journal.
//!
//! The change journal (`db::journal`) stamps every captured row with the
//! execution that produced it. The stamp is read *inside* SQLite's
//! `preupdate_hook`, which fires synchronously on the thread performing the
//! write — so the context must be visible from arbitrary synchronous code
//! deep inside a repo call, without threading a parameter through every
//! layer (the same "pass context downward without layer inversion" problem
//! `CdcHooks` solves for the drain task).
//!
//! Two scopes are provided:
//!
//! - **Task scope** ([`with_execution`]): the execution runner wraps the
//!   whole agent-run future. `tokio::task_local!` storage is visible from
//!   any synchronous code executed while that future is being polled — on
//!   whatever worker thread — which is exactly when rusqlite hooks run for
//!   writes issued by the task.
//! - **Thread scope** ([`ThreadAttributionGuard`]): RAII fallback for
//!   synchronous / `spawn_blocking` paths that are not inside the scoped
//!   future.
//!
//! [`current_execution_id`] checks the task scope first, then the thread
//! scope, and returns `None` for unattributed writes (normal user activity)
//! — journal rows then record `execution_id = NULL`.
//!
//! Known v1 limitation (documented, accepted): writes performed by
//! out-of-process companions (e.g. the `personas-mcp` stdio binary attaching
//! via `open_pool_at`) run in a different process with no hooks installed and
//! are neither journaled nor attributed.

use std::cell::RefCell;

tokio::task_local! {
    /// Execution id owning every DB write issued while the scoped future is
    /// polled. Set only via [`with_execution`].
    static TASK_EXECUTION_ID: String;
}

thread_local! {
    /// Thread-scoped fallback attribution (see [`ThreadAttributionGuard`]).
    static THREAD_EXECUTION_ID: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// The execution id that owns writes happening *right now* on this
/// thread/task, or `None` when the write is unattributed.
pub fn current_execution_id() -> Option<String> {
    // Task scope wins: it is the narrower, explicitly-entered scope.
    if let Ok(id) = TASK_EXECUTION_ID.try_with(|id| id.clone()) {
        return Some(id);
    }
    THREAD_EXECUTION_ID.with(|cell| cell.borrow().clone())
}

/// Run `fut` with every DB write it issues attributed to `execution_id`.
///
/// The execution runner wraps each agent run in this scope; the journal's
/// `preupdate_hook` reads it back via [`current_execution_id`].
pub async fn with_execution<F, T>(execution_id: String, fut: F) -> T
where
    F: std::future::Future<Output = T>,
{
    TASK_EXECUTION_ID.scope(execution_id, fut).await
}

/// RAII guard attributing writes on the CURRENT thread to an execution.
/// For synchronous code paths (tests, `spawn_blocking` sections). Restores
/// the previous value on drop, so guards nest correctly.
pub struct ThreadAttributionGuard {
    prev: Option<String>,
}

impl ThreadAttributionGuard {
    pub fn enter(execution_id: impl Into<String>) -> Self {
        let prev = THREAD_EXECUTION_ID
            .with(|cell| cell.borrow_mut().replace(execution_id.into()));
        Self { prev }
    }
}

impl Drop for ThreadAttributionGuard {
    fn drop(&mut self) {
        THREAD_EXECUTION_ID.with(|cell| {
            *cell.borrow_mut() = self.prev.take();
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unattributed_by_default() {
        assert_eq!(current_execution_id(), None);
    }

    #[test]
    fn thread_guard_sets_and_restores() {
        assert_eq!(current_execution_id(), None);
        {
            let _g = ThreadAttributionGuard::enter("exec-1");
            assert_eq!(current_execution_id().as_deref(), Some("exec-1"));
            {
                let _inner = ThreadAttributionGuard::enter("exec-2");
                assert_eq!(current_execution_id().as_deref(), Some("exec-2"));
            }
            assert_eq!(current_execution_id().as_deref(), Some("exec-1"));
        }
        assert_eq!(current_execution_id(), None);
    }

    #[tokio::test]
    async fn task_scope_wins_and_clears() {
        let inside = with_execution("exec-task".into(), async {
            current_execution_id()
        })
        .await;
        assert_eq!(inside.as_deref(), Some("exec-task"));
        assert_eq!(current_execution_id(), None);
    }
}
