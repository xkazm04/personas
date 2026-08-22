//! Turn serialisation: the per-conversation lock, the fleet queue depth, and
//! the one definition of a turn's ledger identity.
//!
//! Moved verbatim out of the former single-file `session.rs`.

use std::sync::Arc;

use super::origin::TurnOrigin;

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
