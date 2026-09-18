//! Turn serialisation: the per-conversation lock, the fleet queue depth, and
//! the one definition of a turn's ledger identity.
//!
//! Moved verbatim out of the former single-file `session.rs`.

use std::sync::Arc;

use super::origin::{TurnOrigin, JOB_COMPLETED_TRIGGER};
use crate::error::AppError;

/// Per-conversation turn lock. `send_turn` is the unit of mutual exclusion
/// WITHIN a conversation: two turns on the same conversation both `--resume`
/// the same Claude session id (clobbering each other's session-id write) and
/// interleave that thread's brain reads/writes. ACROSS conversations there is
/// no serialization — multi-conversation runs turns concurrently (the design's
/// unbounded-concurrency decision, affordable because every Athena spawn is
/// subscription-auth, not metered API). Keyed by conversation id, created
/// lazily; the map itself is guarded by a std Mutex held only for the O(1)
/// lookup, never across a turn.
static TURN_LOCKS: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

/// Fleet orchestration turns waiting on the turn lock (see the queue branch
/// in `send_turn`). Bounds the burst backlog so a wedged turn can't pile up
/// blocked tasks without limit.
pub(super) static FLEET_TURN_QUEUE_DEPTH: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

/// Get (or lazily create) the turn lock for one conversation.
pub(super) fn turn_lock_for(conversation_id: &str) -> Arc<tokio::sync::Mutex<()>> {
    let mut map = TURN_LOCKS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    map.entry(conversation_id.to_string())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

/// The ledger identity of a turn: `(origin, trigger_kind)` as
/// `companion_turn` stores them. One definition so the success row and the
/// failure row can never disagree about what kind of turn this was.
pub(super) fn ledger_origin_of(origin: &TurnOrigin) -> (&'static str, Option<String>) {
    match origin {
        TurnOrigin::User => ("chat", None),
        TurnOrigin::Autonomous { .. } => ("autonomous", None),
        TurnOrigin::Proactive { trigger_kind, .. } => ("proactive", Some(trigger_kind.clone())),
        TurnOrigin::External { source } => ("external", Some(source.clone())),
    }
}

/// Whether a turn of this origin WAITS for the conversation lock or tries
/// once and self-skips when a turn is in flight.
///
/// User-initiated turns wait (`User`, and `External`, a real button press
/// carrying the user's intent). Background origins self-skip: a missed
/// autonomous tick self-heals on the next one, and queuing machine work
/// would let it pile up behind the user. The one background exception is the
/// `job_completed` follow-up (athena-browser-react): a research job's
/// findings are an answer the user is waiting for, so that turn queues
/// behind whatever he is saying right now and lands after it, never dropped
/// because of it. (Fleet orchestration has its own bounded queue in
/// `turn.rs` and does not go through here.)
pub(super) fn awaits_turn_lock(origin: &TurnOrigin) -> bool {
    match origin {
        TurnOrigin::User | TurnOrigin::External { .. } => true,
        TurnOrigin::Proactive { trigger_kind, .. } => trigger_kind == JOB_COMPLETED_TRIGGER,
        TurnOrigin::Autonomous { .. } => false,
    }
}

/// Take the conversation lock for a turn of `origin`, by the rule above:
/// await it, or `try_lock` and answer the skip as the error `send_turn`
/// has always returned for a busy background turn.
///
/// Awaiting cannot deadlock: the lock is only ever held within one
/// `send_turn` body, bounded by `TURN_TIMEOUT`, and no path re-enters
/// `send_turn` synchronously while holding it (the spawners are
/// fire-and-forget on their own threads).
pub(super) async fn acquire_turn_lock<'a>(
    lock: &'a Arc<tokio::sync::Mutex<()>>,
    origin: &TurnOrigin,
) -> Result<tokio::sync::MutexGuard<'a, ()>, AppError> {
    if awaits_turn_lock(origin) {
        return Ok(lock.lock().await);
    }
    match lock.try_lock() {
        Ok(g) => Ok(g),
        Err(_) => {
            tracing::info!(
                "companion: a turn is already in flight — skipping this background turn"
            );
            Err(AppError::Internal(
                "A companion turn is already in progress; background turn skipped".into(),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn job_completed() -> TurnOrigin {
        TurnOrigin::Proactive {
            trigger_kind: JOB_COMPLETED_TRIGGER.to_string(),
            trigger_ref: Some("job_abc".to_string()),
        }
    }

    #[test]
    fn only_user_external_and_job_completed_wait_for_the_lock() {
        assert!(awaits_turn_lock(&TurnOrigin::User));
        assert!(awaits_turn_lock(&TurnOrigin::External {
            source: "Fleet".into()
        }));
        assert!(awaits_turn_lock(&job_completed()));
        assert!(!awaits_turn_lock(&TurnOrigin::Autonomous {
            chain_index: 1
        }));
        assert!(!awaits_turn_lock(&TurnOrigin::Proactive {
            trigger_kind: "exec_review".into(),
            trigger_ref: None,
        }));
    }

    /// The return leg queues behind a user turn: with the lock held by a fake
    /// user turn, the `job_completed` acquisition stays pending until that
    /// turn releases it, then completes — while a plain proactive turn on the
    /// same busy lock is refused at once.
    #[tokio::test]
    async fn a_job_completed_turn_waits_for_a_user_turn_and_a_plain_proactive_one_skips() {
        let lock = Arc::new(tokio::sync::Mutex::new(()));
        let user_guard = acquire_turn_lock(&lock, &TurnOrigin::User)
            .await
            .expect("the user turn takes a free lock");

        // A plain proactive turn is refused while the user turn runs.
        let skipped = acquire_turn_lock(
            &lock,
            &TurnOrigin::Proactive {
                trigger_kind: "exec_review".into(),
                trigger_ref: None,
            },
        )
        .await;
        assert!(matches!(skipped, Err(AppError::Internal(m)) if m.contains("skipped")));

        // The follow-up waits instead. The handle is kept and awaited below,
        // so the task's outcome (and a panic in it) is this test's outcome.
        let follow_up_lock = lock.clone();
        let waiting = tokio::spawn(async move {
            acquire_turn_lock(&follow_up_lock, &job_completed())
                .await
                .is_ok()
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(
            !waiting.is_finished(),
            "the job_completed turn must still be queued behind the user turn"
        );

        drop(user_guard);
        let acquired = tokio::time::timeout(Duration::from_secs(2), waiting)
            .await
            .expect("the follow-up acquires once the user turn releases")
            .expect("the task did not panic");
        assert!(acquired);
    }
}
