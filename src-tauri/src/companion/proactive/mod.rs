//! Proactive messaging — Athena reaching out on her own initiative.
//!
//! Pipeline:
//!   1. **Triggers** (`triggers.rs`) — pure functions that scan brain
//!      state and produce `Nudge` candidates (goal target approaching,
//!      backlog item aging, cadence ritual due).
//!   2. **Quiet check** (`quiet.rs`) — read active rituals, decide if
//!      now-time is inside any quiet_hours / focus_window. No deliveries
//!      during those windows.
//!   3. **Budget** (`budget.rs`) — daily cap (default 3). Stops the
//!      drip from becoming spam during long sessions.
//!   4. **Persistence** (this module) — write candidates into
//!      `companion_proactive_message` with `queued`, dedupe against any
//!      already-unresolved message for the same `(trigger_kind, trigger_ref)`.
//!   5. **Delivery** — caller emits a Tauri event and bumps status
//!      `queued → delivered`. The frontend takes over from there.
//!
//! Design intent: keep all the *what* in this module (which messages
//! to draft) and let the caller handle the *how* (when to wake up,
//! where to emit). That makes the scheduler swappable — manual via a
//! Tauri command in v1, tokio-task via `companion_init` in v1.5.

pub mod baselines;
pub mod budget;
pub mod execution_review;
pub mod fleet_triggers;
pub mod incident_triggers;
pub mod message_triage;
pub mod quiet;
pub mod triggers;

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use uuid::Uuid;

use crate::db::UserDbPool;
use crate::error::AppError;

/// One proactive message — what Athena would say if she reached out
/// right now. `trigger_ref` is the foreign id (goal, backlog item,
/// ritual) so the dedupe query can prevent stacking.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProactiveMessage {
    pub id: String,
    pub trigger_kind: String,
    pub trigger_ref: Option<String>,
    pub message: String,
    pub status: String,
    pub created_at: String,
    pub delivered_at: Option<String>,
    pub resolved_at: Option<String>,
    /// ISO8601 UTC timestamp at which the deliver-due sweep should release
    /// this row. `None` = standard trigger-driven nudges (delivered as
    /// soon as their guards pass). `Some` = Athena's `schedule_proactive`
    /// commitments — held in `queued` until the time arrives.
    pub scheduled_for: Option<String>,
}

/// Trigger kind used by [`insert_scheduled`] for Athena-authored future
/// check-ins. Kept distinct from the trigger-evaluator kinds so the
/// telemetry and the dedupe paths can tell them apart.
pub const SCHEDULED_TRIGGER_KIND: &str = "athena_scheduled";

/// Candidate produced by a trigger evaluator. Persisted via
/// `enqueue_if_new` — the dedupe + budget guards live there, not in
/// the trigger functions, so triggers stay testable.
#[derive(Debug, Clone)]
pub struct Nudge {
    pub trigger_kind: String,
    pub trigger_ref: Option<String>,
    pub message: String,
}

/// Run a full proactive evaluation pass: gather all trigger
/// candidates, drop any blocked by quiet hours / budget / dedupe,
/// persist the rest as `queued`, and return the new ids. The caller
/// is responsible for emitting the Tauri event + transitioning to
/// `delivered`.
///
/// Returns `Vec<ProactiveMessage>` for the *newly inserted* messages
/// only — anything deduped or budget-skipped is silently swallowed
/// (still tracked via the existing rows, just not surfaced again).
pub fn evaluate(pool: &UserDbPool) -> Result<Vec<ProactiveMessage>, AppError> {
    evaluate_with_extra_candidates(pool, Vec::new())
}

/// Like [`evaluate`] but accepts a list of pre-built `Nudge`s to merge
/// into the candidate set after the standard `triggers::collect_all`.
/// Used by the desktop-feature path to thread `ambient_match` Nudges
/// (which require async + the ambient_ctx + rule_engine handles) into
/// the synchronous evaluation pipeline. Quiet hours / budget / dedupe
/// guards still apply to the merged set — extra candidates aren't
/// privileged.
pub fn evaluate_with_extra_candidates(
    pool: &UserDbPool,
    extra: Vec<Nudge>,
) -> Result<Vec<ProactiveMessage>, AppError> {
    if quiet::is_quiet_now(pool).unwrap_or(false) {
        tracing::debug!("proactive: quiet hours — skipping evaluation");
        return Ok(Vec::new());
    }
    let mut budget = budget::today(pool)?;

    let mut new_msgs = Vec::new();
    let mut candidates = triggers::collect_all(pool)?;
    candidates.extend(extra);
    for nudge in candidates {
        if budget.is_exhausted() {
            tracing::info!(
                "proactive: daily budget exhausted ({}), {} candidates skipped",
                budget.cap(),
                "remaining"
            );
            break;
        }
        match enqueue_if_new(pool, &nudge)? {
            Some(msg) => {
                // Atomic claim — if a concurrent pass consumed the last unit
                // between the check above and here, leave the row queued and
                // stop so the cap holds (bug-hunt 2026-06-07 companion #2).
                if budget.try_consume(pool)? {
                    new_msgs.push(msg);
                } else {
                    break;
                }
            }
            None => {
                // Dedupe hit — same (trigger_kind, trigger_ref) is
                // already unresolved. Skip silently; no budget cost.
            }
        }
    }
    Ok(new_msgs)
}

/// Trigger kind for D6 — fleet operation wrap-up. Reconciler writes
/// one of these per `dispatched_by_athena` op when every session has
/// reached a terminal state. Bypasses the budget gate (this is a
/// user-requested action's completion, not a speculative nudge).
pub const FLEET_OP_COMPLETED_TRIGGER_KIND: &str = "fleet_op_completed";

/// Insert a Nudge from a caller outside the trigger evaluator, with
/// the same dedupe guard but no budget cost. Used by:
///   - the D6 reconciler in
///     `commands::companion::fleet_bridge::reconcile_if_dispatched`
///     (fleet operation wrap-ups land here)
///   - any future direct-from-source notification path that needs
///     dedupe-by-(trigger_kind, trigger_ref) but shouldn't compete
///     with the daily nudge budget.
///
/// Returns the persisted message in `queued` status. The caller is
/// responsible for transitioning to `delivered` + emitting the
/// `companion://proactive` Tauri event — typically by re-running
/// `companion_evaluate_proactive_now` (which handles both), but for
/// snappy delivery the caller can also write its own emit path.
pub fn enqueue_external(pool: &UserDbPool, nudge: &Nudge) -> Result<Option<ProactiveMessage>, AppError> {
    enqueue_if_new(pool, nudge)
}

/// Insert a new proactive message *unless* an unresolved one with
/// matching `(trigger_kind, trigger_ref)` already exists. Returns
/// `Some` for new inserts, `None` when deduped.
fn enqueue_if_new(pool: &UserDbPool, nudge: &Nudge) -> Result<Option<ProactiveMessage>, AppError> {
    let conn = pool.get()?;
    // Dedupe: any already-queued or already-delivered message for the
    // same trigger blocks a new one. Engaged/dismissed/expired don't
    // block — those are resolved.
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM companion_proactive_message
             WHERE trigger_kind = ?1
               AND COALESCE(trigger_ref, '') = COALESCE(?2, '')
               AND status IN ('queued', 'delivered')
             LIMIT 1",
            params![nudge.trigger_kind, nudge.trigger_ref],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    if existing.is_some() {
        return Ok(None);
    }

    let id = format!("nudge_{}", short_uuid());
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO companion_proactive_message
         (id, trigger_kind, trigger_ref, message, status, created_at)
         VALUES (?1, ?2, ?3, ?4, 'queued', ?5)",
        params![
            id,
            nudge.trigger_kind,
            nudge.trigger_ref,
            nudge.message,
            now
        ],
    )?;
    Ok(Some(ProactiveMessage {
        id,
        trigger_kind: nudge.trigger_kind.clone(),
        trigger_ref: nudge.trigger_ref.clone(),
        message: nudge.message.clone(),
        status: "queued".into(),
        created_at: now,
        delivered_at: None,
        resolved_at: None,
        scheduled_for: None,
    }))
}

/// Insert a future-dated proactive message — the persistence side of
/// Athena's `schedule_proactive` op. Bypasses the trigger-based dedupe
/// guard (Athena can schedule multiple check-ins for different times)
/// but still runs through the daily delivery budget when the time
/// arrives, via [`deliver_due_scheduled`].
pub fn insert_scheduled(
    pool: &UserDbPool,
    message: &str,
    when_iso: &str,
) -> Result<ProactiveMessage, AppError> {
    let conn = pool.get()?;
    let id = format!("nudge_{}", short_uuid());
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO companion_proactive_message
         (id, trigger_kind, trigger_ref, message, status, created_at, scheduled_for)
         VALUES (?1, ?2, NULL, ?3, 'queued', ?4, ?5)",
        params![id, SCHEDULED_TRIGGER_KIND, message, now, when_iso],
    )?;
    Ok(ProactiveMessage {
        id,
        trigger_kind: SCHEDULED_TRIGGER_KIND.into(),
        trigger_ref: None,
        message: message.to_string(),
        status: "queued".into(),
        created_at: now,
        delivered_at: None,
        resolved_at: None,
        scheduled_for: Some(when_iso.to_string()),
    })
}

/// Sweep for scheduled rows whose time has arrived. Returns the rows
/// the caller should announce on `companion://proactive` (status still
/// `queued`; the caller transitions to `delivered` via [`mark_delivered`]
/// after emitting). Trigger-driven rows (scheduled_for IS NULL) are
/// untouched — they flow through [`evaluate`] only.
///
/// Scheduled check-ins share the SAME daily delivery budget as the
/// trigger path (see [`evaluate_with_extra_candidates`]): rows are
/// processed oldest-first and each released row consumes one unit of
/// today's budget. Once the budget is exhausted the remaining due rows
/// are left `queued` so they release on a later tick — mirroring how the
/// trigger path defers candidates past the cap. Re-reading
/// [`budget::today`] here picks up any increments the trigger path
/// already made in the same evaluation pass, so the two paths can't
/// jointly exceed the cap.
pub fn deliver_due_scheduled(pool: &UserDbPool) -> Result<Vec<ProactiveMessage>, AppError> {
    let conn = pool.get()?;
    let now = Utc::now().to_rfc3339();
    let mut stmt = conn.prepare(
        "SELECT id, trigger_kind, trigger_ref, message, status, created_at, delivered_at, resolved_at, scheduled_for
         FROM companion_proactive_message
         WHERE status = 'queued'
           AND scheduled_for IS NOT NULL
           AND scheduled_for <= ?1
         ORDER BY scheduled_for ASC",
    )?;
    let due = stmt
        .query_map(params![now], |row| {
            Ok(ProactiveMessage {
                id: row.get(0)?,
                trigger_kind: row.get(1)?,
                trigger_ref: row.get(2)?,
                message: row.get(3)?,
                status: row.get(4)?,
                created_at: row.get(5)?,
                delivered_at: row.get(6)?,
                resolved_at: row.get(7)?,
                scheduled_for: row.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    // Drop the read statement/borrow before the budget guard acquires
    // its own pooled connection for the increment writes.
    drop(stmt);
    drop(conn);

    // Gate each due row through the daily budget, exactly like the
    // trigger path gates each candidate. Oldest-first (ORDER BY above)
    // means the earliest commitments win the remaining budget; any
    // overflow stays `queued` and due for the next tick.
    let mut budget = budget::today(pool)?;
    let mut released = Vec::new();
    for msg in due {
        // Atomic claim doubles as the exhaustion check; overflow stays queued
        // and due for the next tick (bug-hunt 2026-06-07 companion #2).
        if !budget.try_consume(pool)? {
            tracing::info!(
                "proactive: daily budget exhausted ({}), remaining scheduled message(s) deferred",
                budget.cap(),
            );
            break;
        }
        released.push(msg);
    }
    Ok(released)
}

pub fn list_messages(
    pool: &UserDbPool,
    only_unresolved: bool,
    limit: u32,
) -> Result<Vec<ProactiveMessage>, AppError> {
    let conn = pool.get()?;
    let where_clause = if only_unresolved {
        "WHERE status IN ('queued', 'delivered')"
    } else {
        ""
    };
    let sql = format!(
        "SELECT id, trigger_kind, trigger_ref, message, status, created_at, delivered_at, resolved_at, scheduled_for
         FROM companion_proactive_message
         {where_clause}
         ORDER BY created_at DESC
         LIMIT ?1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(ProactiveMessage {
                id: row.get(0)?,
                trigger_kind: row.get(1)?,
                trigger_ref: row.get(2)?,
                message: row.get(3)?,
                status: row.get(4)?,
                created_at: row.get(5)?,
                delivered_at: row.get(6)?,
                resolved_at: row.get(7)?,
                scheduled_for: row.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Fetch a single proactive message by id, regardless of status.
///
/// The engage path uses this instead of scanning a capped [`list_messages`]
/// window: on a long-lived install (proactive rows are never pruned) a
/// still-deliverable nudge can fall outside the newest N rows, which made the
/// "Athena reached out" engage button spuriously error with "not found".
/// A direct lookup is O(1) and has no scale ceiling. Returns `Ok(None)` when
/// no row with that id exists.
pub fn get_by_id(pool: &UserDbPool, id: &str) -> Result<Option<ProactiveMessage>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT id, trigger_kind, trigger_ref, message, status, created_at, delivered_at, resolved_at, scheduled_for
             FROM companion_proactive_message
             WHERE id = ?1",
            params![id],
            |row| {
                Ok(ProactiveMessage {
                    id: row.get(0)?,
                    trigger_kind: row.get(1)?,
                    trigger_ref: row.get(2)?,
                    message: row.get(3)?,
                    status: row.get(4)?,
                    created_at: row.get(5)?,
                    delivered_at: row.get(6)?,
                    resolved_at: row.get(7)?,
                    scheduled_for: row.get(8)?,
                })
            },
        )
        .optional()?;
    Ok(row)
}

/// Mark a freshly-enqueued nudge delivered and announce it on the
/// `companion://proactive` Tauri event — the same delivery contract the
/// 5-min scheduler tick applies to trigger-evaluator nudges. For callers
/// (execution triage, message triage) that mint a nudge outside the tick's
/// own evaluate pass and want it visible immediately.
pub fn deliver_now(pool: &UserDbPool, app: &tauri::AppHandle, msg: ProactiveMessage) {
    use tauri::Emitter;
    if let Err(e) = mark_delivered(pool, &msg.id) {
        tracing::warn!(id = %msg.id, error = %e, "proactive: deliver_now mark_delivered failed");
    }
    let payload = crate::commands::companion::proactive::ProactiveDelivery {
        messages: vec![ProactiveMessage {
            status: "delivered".into(),
            ..msg
        }],
    };
    if let Err(e) = app.emit(crate::commands::companion::proactive::PROACTIVE_EVENT, payload) {
        tracing::warn!(error = %e, "proactive: deliver_now event emit failed");
    }
}

/// Transition `queued → delivered` for the given message id.
pub fn mark_delivered(pool: &UserDbPool, id: &str) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE companion_proactive_message
         SET status = 'delivered', delivered_at = ?1
         WHERE id = ?2 AND status = 'queued'",
        params![now, id],
    )?;
    Ok(())
}

/// Resolve a proactive message — either the user engaged (clicked
/// through into a chat turn) or dismissed (no thanks).
pub fn resolve(pool: &UserDbPool, id: &str, engaged: bool) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let new_status = if engaged { "engaged" } else { "dismissed" };
    let conn = pool.get()?;
    let updated = conn.execute(
        "UPDATE companion_proactive_message
         SET status = ?1, resolved_at = ?2
         WHERE id = ?3 AND status IN ('queued', 'delivered')",
        params![new_status, now, id],
    )?;
    if updated == 0 {
        return Err(AppError::Internal(format!(
            "proactive message `{id}` not found or already resolved"
        )));
    }
    // Bump the backlog reminded_count when we engaged a backlog-aging
    // nudge — used by `triggers::backlog_aging` to ratchet down
    // frequency on a re-fire.
    if engaged {
        let trigger_ref: Option<(String, Option<String>)> = conn
            .query_row(
                "SELECT trigger_kind, trigger_ref FROM companion_proactive_message WHERE id = ?1",
                params![id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
            )
            .optional()?;
        if let Some((kind, Some(ref_id))) = trigger_ref {
            if kind == "backlog_aging" {
                let _ = conn.execute(
                    "UPDATE companion_backlog_item
                     SET reminded_count = reminded_count + 1
                     WHERE id = ?1",
                    params![ref_id],
                );
            }
        }
    }
    Ok(())
}

fn short_uuid() -> String {
    Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(10)
        .collect()
}
