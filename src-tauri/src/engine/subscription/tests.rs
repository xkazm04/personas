use super::*;
use crate::engine::background::SchedulerState;
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

struct TestSubscription {
    tick_count: Arc<AtomicU32>,
}

#[async_trait::async_trait]
impl ReactiveSubscription for TestSubscription {
    fn name(&self) -> &'static str {
        "test"
    }

    fn interval(&self) -> Duration {
        Duration::from_millis(50)
    }

    async fn tick(&self) {
        self.tick_count.fetch_add(1, Ordering::Relaxed);
    }
}

#[test]
fn test_high_severity_auto_approvable_classifier() {
    // Safe technical-status items (real stranded examples) -> approvable.
    assert!(high_severity_auto_approvable(
        "PR #1 is red — needs migration landed on main before it can merge",
        "",
        ""
    ));
    assert!(high_severity_auto_approvable(
        "REQUEST_CHANGES — lint gate fails on new src/lib/lighttrack.ts (17 errors)",
        "",
        ""
    ));
    assert!(high_severity_auto_approvable(
        "Release blocked — fix 10 pre-existing lint errors",
        "",
        ""
    ));
    assert!(high_severity_auto_approvable(
        "Eligibility Filtering — 4 review findings to triage",
        "",
        ""
    ));

    // Genuine business/policy decisions (real stranded examples) -> NEVER approvable.
    assert!(!high_severity_auto_approvable(
        "PHI egress to external observability — needs HIPAA/BAA decision",
        "",
        ""
    ));
    assert!(!high_severity_auto_approvable(
        "Release tagged — approve origin push + confirm production-deploy gate",
        "",
        ""
    ));
    assert!(!high_severity_auto_approvable(
        "Pricing change for the paid tier",
        "",
        ""
    ));

    // Denylist WINS on overlap: a change-request that also touches production stays human.
    assert!(!high_severity_auto_approvable(
        "REQUEST_CHANGES — production config change to prod deploy",
        "",
        ""
    ));
    // The PII-egress REQUEST_CHANGES variant stays human even though it mentions a code review.
    assert!(!high_severity_auto_approvable(
        "Merge gate: telemetry changeset — REQUEST_CHANGES (live customer PII egress)",
        "",
        ""
    ));

    // Unrecognised high-severity item -> stays pending (conservative default).
    assert!(!high_severity_auto_approvable(
        "Investigate intermittent customer report",
        "",
        ""
    ));
}

#[test]
fn test_subscription_trait_name() {
    let count = Arc::new(AtomicU32::new(0));
    let sub = TestSubscription { tick_count: count };
    assert_eq!(sub.name(), "test");
    assert_eq!(sub.interval(), Duration::from_millis(50));
    assert_eq!(sub.initial_delay(), Duration::ZERO);
}

#[tokio::test]
async fn test_subscription_ticks() {
    let count = Arc::new(AtomicU32::new(0));
    let sub = TestSubscription {
        tick_count: count.clone(),
    };
    sub.tick().await;
    sub.tick().await;
    assert_eq!(count.load(Ordering::Relaxed), 2);
}

/// A subscription whose tick always panics — used to verify the panic boundary.
struct PanickingSubscription;

#[async_trait::async_trait]
impl ReactiveSubscription for PanickingSubscription {
    fn name(&self) -> &'static str {
        "panicker"
    }

    fn interval(&self) -> Duration {
        Duration::from_millis(50)
    }

    async fn tick(&self) {
        panic!("intentional test panic");
    }
}

#[tokio::test]
async fn test_panic_boundary_catches_tick_panic() {
    use futures_util::FutureExt;

    let sub: Box<dyn ReactiveSubscription> = Box::new(PanickingSubscription);
    let result = AssertUnwindSafe(sub.tick()).catch_unwind().await;
    assert!(result.is_err(), "catch_unwind should capture the panic");
}

#[test]
fn test_scheduler_crash_counter_from_subscription() {
    let state = SchedulerState::new();
    assert_eq!(state.stats().subscriptions_crashed, 0);
    state.record_subscription_crash("panicker");
    assert_eq!(state.stats().subscriptions_crashed, 1);
}

// -----------------------------------------------------------------------
// Push fan-out (Direction 3)
// -----------------------------------------------------------------------

fn bus_event_input(event_type: &str) -> crate::db::models::CreatePersonaEventInput {
    crate::db::models::CreatePersonaEventInput {
        event_type: event_type.to_string(),
        source_type: "test".to_string(),
        project_id: None,
        source_id: None,
        target_persona_id: None,
        payload: None,
        use_case_id: None,
    }
}

/// Signal- and poll-driven ticks both funnel through
/// `event_repo::claim_pending`, whose atomic pending→processing UPDATE is
/// the double-dispatch guard. Race two claimers (one per path) over a
/// fixed set of pending events and prove every event is claimed EXACTLY
/// once — no event dispatched twice, none lost.
#[test]
fn no_double_dispatch_under_signal_poll_claim_race() {
    use crate::db::repos::communication::events as event_repo;

    let pool = crate::db::init_test_db().expect("init test db");
    const TOTAL: usize = 120;
    for i in 0..TOTAL {
        event_repo::publish(&pool, bus_event_input(&format!("race.{i}"))).expect("publish");
    }

    let claimer = |pool: crate::db::DbPool| {
        std::thread::spawn(move || {
            let mut ids: Vec<String> = Vec::new();
            loop {
                let batch = event_repo::claim_pending(&pool, 50).expect("claim_pending");
                if batch.is_empty() {
                    break;
                }
                ids.extend(batch.into_iter().map(|e| e.id));
            }
            ids
        })
    };

    // "Signal path" and "poll path" racing over the same pool.
    let h1 = claimer(pool.clone());
    let h2 = claimer(pool.clone());
    let ids1 = h1.join().expect("signal-path claimer panicked");
    let ids2 = h2.join().expect("poll-path claimer panicked");

    let mut all: Vec<&String> = ids1.iter().chain(ids2.iter()).collect();
    let total_claims = all.len();
    all.sort();
    all.dedup();
    assert_eq!(
        total_claims,
        all.len(),
        "an event was claimed by BOTH the signal and poll paths — double dispatch"
    );
    assert_eq!(
        all.len(),
        TOTAL,
        "every pending event must be claimed exactly once across both paths"
    );
}

/// Burst drain: 200 pending events, a wake-driven consumer that mirrors
/// the production loop (one claim_pending(50) batch per wakeup; a FULL
/// batch re-arms the signal exactly like event_bus_tick does). All 200
/// must drain in back-to-back signal-driven batches — far under the pure
/// poll floor of 3 further 2s intervals (>= 6s) — without a single poll
/// tick needing to fire.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn burst_of_200_drains_on_wake_far_faster_than_polling() {
    use crate::db::repos::communication::events as event_repo;

    let pool = crate::db::init_test_db().expect("init test db");
    const TOTAL: usize = 200;
    const POLL_INTERVAL: Duration = Duration::from_secs(2);

    // Publish the burst FIRST — notifies coalesce into at most one stored
    // permit, which is exactly the situation the full-batch re-arm in
    // event_bus_tick exists for.
    {
        let pool = pool.clone();
        tokio::task::spawn_blocking(move || {
            for i in 0..TOTAL {
                event_repo::publish(&pool, bus_event_input(&format!("burst.{i}")))
                    .expect("publish");
                event_bus_wake_signal().notify_one();
            }
        })
        .await
        .expect("publisher task");
    }

    let start = Instant::now();
    let consumer = {
        let pool = pool.clone();
        tokio::spawn(async move {
            let wake = event_bus_wake_signal();
            let mut interval = tokio::time::interval(POLL_INTERVAL);
            interval.tick().await; // consume the immediate first tick
            let mut claimed = 0usize;
            let mut poll_wakeups = 0u32;
            while claimed < TOTAL {
                tokio::select! {
                    _ = interval.tick() => { poll_wakeups += 1; }
                    _ = wake.notified() => {}
                }
                // Mirror event_bus_tick: ONE batch per wakeup + full-batch re-arm.
                let batch = {
                    let pool = pool.clone();
                    tokio::task::spawn_blocking(move || event_repo::claim_pending(&pool, 50))
                        .await
                        .expect("claim task")
                        .expect("claim_pending")
                };
                if batch.len() == 50 {
                    wake.notify_one();
                }
                claimed += batch.len();
            }
            (claimed, poll_wakeups)
        })
    };

    let (claimed, poll_wakeups) = tokio::time::timeout(Duration::from_secs(15), consumer)
        .await
        .expect("burst did not drain within 15s — wake signal path is broken")
        .expect("consumer task panicked");
    let elapsed = start.elapsed();

    assert_eq!(claimed, TOTAL, "all burst events must be claimed");
    // Pure polling needs >= 3 further 2s intervals after the first batch
    // (4 batches x 50). The wake path must beat that floor decisively.
    assert!(
        elapsed < Duration::from_secs(6),
        "burst drained in {elapsed:?} with {poll_wakeups} poll wakeups — \
         expected signal-driven back-to-back batches well under the 6s poll floor"
    );
}
