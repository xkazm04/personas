//! Bounded-parallel lane scheduler for the persona build fan-out.
//!
//! Build-orchestration Phase 2 scaffold. This is the reusable primitive the
//! fan-out phases run on: Phase 3 dispatches per-tool tests through it, Phase 4
//! dispatches per-capability resolution. It is deliberately decoupled from the
//! build session — a general bounded executor over independent tasks:
//!
//!   * at most `max_parallel` tasks run concurrently (a `Semaphore` budget),
//!   * a panic in one lane is isolated (`catch_unwind`) and reported as an
//!     error rather than aborting the batch (mirrors
//!     `team_assignment_orchestrator`'s panic discipline),
//!   * results come back in input order, each tagged with its lane id.
//!
//! Phase 2 ships this with its tests so the primitive is proven before any
//! build behavior flips; nothing in the runner fans out yet.

#![allow(dead_code)] // wired into the build runner in Phase 3 (parallel tool tests)

use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use futures_util::FutureExt;
use tokio::sync::Semaphore;

/// One lane's result: the lane id it was submitted under, plus `Ok(value)` or
/// `Err(message)` when the lane's task panicked or its worker was cancelled.
#[derive(Debug)]
pub struct LaneOutcome<T> {
    pub lane: String,
    pub result: Result<T, String>,
}

impl<T> LaneOutcome<T> {
    pub fn is_ok(&self) -> bool {
        self.result.is_ok()
    }
}

/// A submittable unit of work: a lane id + a boxed future.
pub type LaneTask<T> = (String, BoxFuture<'static, T>);

/// Convenience: box an async block into a `LaneTask`.
pub fn lane<T, F>(id: impl Into<String>, fut: F) -> LaneTask<T>
where
    F: Future<Output = T> + Send + 'static,
{
    (id.into(), Box::pin(fut))
}

/// Run `tasks` with at most `max_parallel` in flight (clamped to ≥1). Each task
/// is a `(lane_id, future)` pair. Panics are caught per-lane; results are
/// returned in the same order as `tasks`.
pub async fn run_lanes<T>(max_parallel: usize, tasks: Vec<LaneTask<T>>) -> Vec<LaneOutcome<T>>
where
    T: Send + 'static,
{
    let budget = Arc::new(Semaphore::new(max_parallel.max(1)));
    let mut lanes: Vec<String> = Vec::with_capacity(tasks.len());
    let mut handles = Vec::with_capacity(tasks.len());

    for (lane_id, fut) in tasks {
        lanes.push(lane_id);
        let budget = budget.clone();
        handles.push(tokio::spawn(async move {
            // Hold a permit for the task's lifetime → at most `max_parallel`
            // lanes run concurrently. `acquire_owned` only errors if the
            // semaphore is closed, which never happens here.
            let _permit = budget.acquire_owned().await.ok();
            match AssertUnwindSafe(fut).catch_unwind().await {
                Ok(value) => Ok(value),
                Err(panic) => Err(panic_message(panic)),
            }
        }));
    }

    let mut out = Vec::with_capacity(handles.len());
    for (lane_id, handle) in lanes.into_iter().zip(handles) {
        let result = match handle.await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(msg)) => Err(msg),
            Err(join_err) => Err(format!("lane worker join failed: {join_err}")),
        };
        out.push(LaneOutcome {
            lane: lane_id,
            result,
        });
    }
    out
}

fn panic_message(panic: Box<dyn std::any::Any + Send>) -> String {
    panic
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| panic.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "lane worker panicked".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    #[tokio::test]
    async fn preserves_input_order() {
        let tasks: Vec<LaneTask<i32>> = (0..5).map(|i| lane(format!("lane-{i}"), async move { i * 10 })).collect();
        let out = run_lanes(3, tasks).await;
        let values: Vec<i32> = out.iter().map(|o| *o.result.as_ref().unwrap()).collect();
        assert_eq!(values, vec![0, 10, 20, 30, 40]);
        assert_eq!(out[2].lane, "lane-2");
    }

    #[tokio::test]
    async fn bounds_concurrency_to_budget() {
        let live = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let tasks: Vec<LaneTask<usize>> = (0..8)
            .map(|i| {
                let live = live.clone();
                let peak = peak.clone();
                lane(format!("lane-{i}"), async move {
                    let now = live.fetch_add(1, Ordering::SeqCst) + 1;
                    peak.fetch_max(now, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(20)).await;
                    live.fetch_sub(1, Ordering::SeqCst);
                    i
                })
            })
            .collect();
        let out = run_lanes(2, tasks).await;
        assert_eq!(out.len(), 8);
        assert!(
            peak.load(Ordering::SeqCst) <= 2,
            "peak concurrency {} exceeded budget 2",
            peak.load(Ordering::SeqCst)
        );
    }

    #[tokio::test]
    async fn isolates_panics_per_lane() {
        let mut tasks: Vec<LaneTask<i32>> = Vec::new();
        tasks.push(lane("ok-0", async { 1 }));
        tasks.push(lane("boom", async { panic!("kaboom") }));
        tasks.push(lane("ok-1", async { 2 }));
        let out = run_lanes(3, tasks).await;
        assert!(out[0].result.is_ok());
        assert!(out[1].result.is_err());
        assert!(out[1].result.as_ref().unwrap_err().contains("kaboom"));
        assert_eq!(out[1].lane, "boom");
        assert_eq!(*out[2].result.as_ref().unwrap(), 2);
    }

    #[tokio::test]
    async fn zero_budget_clamps_to_one() {
        let out = run_lanes(0, vec![lane("a", async { 7 })]).await;
        assert_eq!(*out[0].result.as_ref().unwrap(), 7);
    }
}
