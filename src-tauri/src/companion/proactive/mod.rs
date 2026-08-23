//! Proactive messaging — Athena reaching out on her own initiative.
//!
//! Pipeline:
//!   1. **Triggers** (`triggers.rs`) — pure functions that scan brain
//!      state and produce `Nudge` candidates (goal target approaching,
//!      backlog item aging, cadence ritual due).
//!   2. **Quiet check** (`quiet.rs`) — read active rituals, decide if
//!      now-time is inside any quiet_hours / focus_window. No deliveries
//!      during those windows.
//!   3. **Budget** (`budget.rs`) — two layers: a global daily ceiling
//!      (`budget::GLOBAL_DAILY_CAP`, 12) plus a per-trigger-kind cap
//!      (`budget::kind_cap`, engagement-modulated) so one noisy leg can't
//!      crowd out the others. Stops the drip from becoming spam during
//!      long sessions.
//!   4. **Persistence** ([`evaluate_with_extra_candidates`]) — write
//!      candidates into `companion_proactive_message` as `queued`,
//!      deduped against any already-unresolved message for the same
//!      `(trigger_kind, trigger_ref)`. **No budget is spent here.**
//!   5. **Release** ([`release_pending`]) — the one place a `queued` row
//!      becomes `delivered`. Sweeps the lifecycle, gates each row through
//!      the daily budget, claims the `queued → delivered` transition, and
//!      hands the caller the rows to announce.
//!
//! **Noticing and delivering are deliberately decoupled** (2026-08-07).
//! When budget was spent at insert time, a row that lost its claim stayed
//! `queued` with nothing on earth able to re-deliver it, while the dedupe
//! guard treated `queued` as blocking — so that `(trigger_kind,
//! trigger_ref)` could never nudge again. Twenty rows were stranded that
//! way, the oldest for seven weeks. Now the insert is cheap and
//! unconditional, and [`release_pending`] runs on **every** tick over
//! **every** deliverable `queued` row (trigger-driven and scheduled
//! alike) — so a row that misses a slot simply waits for the next tick,
//! and a crash between insert and delivery costs nothing. Rows that wait
//! too long are aged to `expired` by [`sweep_lifecycle`] rather than
//! replayed stale; the trigger re-fires with fresh text on the next pass.
//!
//! Design intent: keep all the *what* in this module (which messages
//! to draft, and when they may be released) and let the caller handle
//! only the *how* (when to wake up, where to emit).

pub mod backlog_triage;
pub mod baselines;
pub mod budget;
pub mod execution_review;
pub mod fleet_triggers;
pub mod incident_triggers;
pub mod message_triage;
pub mod quiet;
pub mod rollup;
pub mod triggers;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
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

/// Run a full proactive evaluation pass: gather all trigger candidates,
/// drop any blocked by quiet hours or dedupe, persist the rest as
/// `queued`. **Delivery is not this function's job** — call
/// [`release_pending`] afterwards (the tick does) to turn `queued` rows
/// into `delivered` ones under the daily budget.
///
/// Returns `Vec<ProactiveMessage>` for the *newly inserted* rows, all
/// still `queued`. Anything deduped is silently swallowed (still tracked
/// via the existing row).
/// Convenience wrapper with no extra candidates — used by the non-desktop tick
/// (desktop threads `ambient_match` nudges via `evaluate_with_extra_candidates`).
#[cfg(not(feature = "desktop"))]
pub fn evaluate(pool: &UserDbPool, autonomous: bool) -> Result<Vec<ProactiveMessage>, AppError> {
    evaluate_with_extra_candidates(pool, Vec::new(), autonomous)
}

/// Like [`evaluate`] but accepts a list of pre-built `Nudge`s to merge
/// into the candidate set after the standard `triggers::collect_all`.
/// Used by the desktop-feature path to thread `ambient_match` Nudges
/// (which require async + the ambient_ctx + rule_engine handles) into
/// the synchronous evaluation pipeline. Quiet hours / dedupe guards
/// still apply to the merged set — extra candidates aren't privileged.
///
/// The daily budget is **not** consulted here. Noticing is free; only
/// [`release_pending`] spends attention. That is what keeps a candidate
/// that arrives on a full day from being lost: it waits as `queued` and
/// releases on a later tick, or ages out and re-fires fresh.
pub fn evaluate_with_extra_candidates(
    pool: &UserDbPool,
    extra: Vec<Nudge>,
    autonomous: bool,
) -> Result<Vec<ProactiveMessage>, AppError> {
    if quiet::is_quiet_now(pool).unwrap_or(false) {
        tracing::debug!("proactive: quiet hours — skipping evaluation");
        return Ok(Vec::new());
    }

    let mut new_msgs = Vec::new();
    let mut candidates = triggers::collect_all(pool, autonomous)?;
    candidates.extend(extra);
    for nudge in candidates {
        // `None` = dedupe hit; the same (trigger_kind, trigger_ref) is already
        // unresolved. Skip silently — the existing row still owns that nudge.
        if let Some(msg) = enqueue_if_new(pool, &nudge)? {
            new_msgs.push(msg);
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
/// Returns the persisted message in `queued` status. The caller is expected
/// to transition it to `delivered` + emit the `companion://proactive` event
/// itself — [`deliver_now`] does both in one call.
///
/// If the caller's own delivery fails or never happens, the row is **not**
/// lost: [`release_pending`] sees every `queued` row, so the nudge is picked
/// up on the next tick (spending a budget unit at that point) or aged out by
/// [`sweep_lifecycle`]. The budget bypass is therefore a property of the
/// *direct* delivery path, not a licence to strand a row.
pub fn enqueue_external(
    pool: &UserDbPool,
    nudge: &Nudge,
) -> Result<Option<ProactiveMessage>, AppError> {
    enqueue_if_new(pool, nudge)
}

/// How long resolved (terminal-status) proactive messages are retained before
/// the prune in [`sweep_lifecycle`] removes them. The table had no
/// retention, so it grew unbounded — slowing queries and the dedupe scan.
const PROACTIVE_RETENTION_WINDOW: &str = "-30 days";

/// How long a `delivered` card waits for the user to engage/dismiss before
/// [`sweep_lifecycle`] ages it to `expired`. An ignored "Athena reached out"
/// card otherwise stays `delivered` forever, which (a) permanently
/// dedupe-blocks re-nudging for that `(trigger_kind, trigger_ref)` and (b)
/// keeps the row out of the retention prune (which skips queued/delivered), so
/// ignored cards accumulate unbounded. Aging to `expired` unblocks both:
/// dedupe excludes `expired`, and the prune reaps it once past
/// [`PROACTIVE_RETENTION_WINDOW`].
const PROACTIVE_DELIVERED_EXPIRY_WINDOW: &str = "-7 days";

/// How long a trigger-driven `queued` row may wait for a delivery slot before
/// [`sweep_lifecycle`] ages it to `expired`.
///
/// A nudge is a statement about *now* — "this goal has stalled", "this fleet
/// session went quiet". Releasing a day-old one replays text derived from
/// state that has since moved, and it costs a budget unit that a current
/// observation could have used. Expiring instead is strictly better because
/// the trigger is idempotent: if the condition still holds, the very next
/// [`evaluate_with_extra_candidates`] pass re-inserts the same
/// `(trigger_kind, trigger_ref)` with freshly-derived text (the sweep runs
/// *before* the dedupe check in [`enqueue_if_new`], so there is no dead tick
/// in between). If the condition resolved itself, nothing re-fires — which is
/// the correct outcome and the one the old code could never reach.
const PROACTIVE_QUEUED_EXPIRY_WINDOW: &str = "-1 day";

/// Same, for Athena's own `schedule_proactive` commitments — deliberately far
/// more generous than [`PROACTIVE_QUEUED_EXPIRY_WINDOW`]. A scheduled check-in
/// was explicitly asked for and has **no re-fire path**: no trigger will ever
/// re-create it, so expiring one destroys a user-visible promise. A week of
/// grace covers "the app was closed over a holiday" while still refusing to
/// deliver a months-late "I'll check back in 10 minutes".
const PROACTIVE_SCHEDULED_EXPIRY_WINDOW: &str = "-7 days";

/// The whole status lifecycle in one sweep, run before every insert and before
/// every release. Best-effort throughout — a failed sweep degrades to the
/// previous behaviour rather than blocking the pass.
///
/// All four comparisons wrap the stored column in `datetime(...)`. The values
/// are RFC3339 with a `T` separator and nanosecond precision
/// (`2026-06-19T22:43:54.334468300+00:00`) while `datetime('now', …)` produces
/// `2026-08-06 14:32:33` — a raw string comparison disagrees with a real time
/// comparison whenever the dates match, because `'T'` (0x54) sorts after `' '`
/// (0x20). Normalizing both sides removes an up-to-one-day boundary skew that
/// the previous inline sweeps carried.
fn sweep_lifecycle(conn: &Connection) {
    // 1. Trigger-driven rows that never won a delivery slot in time. They
    //    unblock their own dedupe on the way out, so the trigger can restate
    //    the case with current data.
    if let Err(e) = conn.execute(
        "UPDATE companion_proactive_message
         SET status = 'expired'
         WHERE status = 'queued'
           AND scheduled_for IS NULL
           AND datetime(created_at) < datetime('now', ?1)",
        params![PROACTIVE_QUEUED_EXPIRY_WINDOW],
    ) {
        tracing::warn!(error = %e, "proactive: stale-queued sweep failed");
    }
    // 2. Scheduled commitments whose moment passed so long ago that honouring
    //    them would be noise. Future-dated rows never match (their
    //    `scheduled_for` is ahead of any past threshold).
    let _ = conn.execute(
        "UPDATE companion_proactive_message
         SET status = 'expired'
         WHERE status = 'queued'
           AND scheduled_for IS NOT NULL
           AND datetime(scheduled_for) < datetime('now', ?1)",
        params![PROACTIVE_SCHEDULED_EXPIRY_WINDOW],
    );
    // 3. Delivered cards the user neither engaged nor dismissed.
    let _ = conn.execute(
        "UPDATE companion_proactive_message
         SET status = 'expired'
         WHERE status = 'delivered'
           AND datetime(COALESCE(delivered_at, created_at)) < datetime('now', ?1)",
        params![PROACTIVE_DELIVERED_EXPIRY_WINDOW],
    );
    // 4. Retention prune — terminal-status rows only; 1–3 feed it.
    let _ = conn.execute(
        "DELETE FROM companion_proactive_message
         WHERE status NOT IN ('queued', 'delivered')
           AND datetime(created_at) < datetime('now', ?1)",
        params![PROACTIVE_RETENTION_WINDOW],
    );
}

/// Insert a new proactive message *unless* an unresolved one with
/// matching `(trigger_kind, trigger_ref)` already exists. Returns
/// `Some` for new inserts, `None` when deduped.
fn enqueue_if_new(pool: &UserDbPool, nudge: &Nudge) -> Result<Option<ProactiveMessage>, AppError> {
    let conn = pool.get()?;
    // Sweep FIRST, dedupe second. Order matters: a row that has aged past its
    // window is no longer a live claim on this (trigger_kind, trigger_ref), and
    // retiring it before the dedupe check lets the trigger restate its case on
    // the same pass instead of waiting a tick.
    sweep_lifecycle(&conn);
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
/// arrives, via [`release_pending`] on the scheduler tick.
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

/// **The one delivery path.** Sweep the lifecycle, then release every
/// deliverable `queued` row — trigger-driven and `athena_scheduled` alike —
/// under the unchanged daily budget, claiming `queued → delivered` as it goes.
/// Returns the rows the caller should announce on `companion://proactive`,
/// already carrying `status = "delivered"` and their real `delivered_at`.
///
/// Replaces the old `deliver_due_scheduled`, which took only
/// `scheduled_for IS NOT NULL` and had exactly one caller — the manual
/// `companion_evaluate_proactive_now` command, which nothing in `src/` ever
/// invoked. So the scheduled lane had no caller in normal operation, and the
/// trigger lane had no re-delivery at all. One sweep on the tick fixes both.
///
/// Guarantees:
/// - **No permanent strand.** A row that misses a slot stays `queued` and is
///   re-examined on the next tick; if it waits past its window
///   ([`sweep_lifecycle`]) it becomes `expired`, which unblocks its dedupe.
///   Every `queued` row therefore ends up delivered or expired.
/// - **Crash-safe.** Budget is claimed and the row is marked `delivered` here,
///   adjacently, and the caller only emits afterwards. A crash anywhere before
///   the mark leaves a `queued` row the next tick picks up; a crash after it
///   leaves a `delivered` row the chat's unresolved listing still surfaces and
///   the 7-day expiry still retires. Neither state is terminal-and-invisible,
///   which is what the insert-time budget claim used to produce.
/// - **Volume unchanged.** [`budget::GLOBAL_DAILY_CAP`] and the per-kind caps
///   are untouched; this only decides *which* observations get to spend them.
///
/// Oldest-first, so the earliest commitment wins the remaining budget. A
/// per-kind cap only skips its own row (`continue`) — the old code `break`-ed
/// the whole pass on any refusal, letting one capped kind starve every kind
/// behind it in `collect_all` order. Only the global ceiling stops the loop.
pub fn release_pending(pool: &UserDbPool) -> Result<Vec<ProactiveMessage>, AppError> {
    {
        let conn = pool.get()?;
        sweep_lifecycle(&conn);
    }
    // Quiet hours suppress *delivery*, not noticing: rows stay queued and
    // release once the window closes (well inside their expiry window).
    if quiet::is_quiet_now(pool).unwrap_or(false) {
        tracing::debug!("proactive: quiet hours — holding deliveries");
        return Ok(Vec::new());
    }

    // Scope the read so the statement/connection are released before the
    // budget guard acquires its own pooled connection for the write path.
    let mut due: Vec<ProactiveMessage> = Vec::new();
    {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, trigger_kind, trigger_ref, message, status, created_at, delivered_at, resolved_at, scheduled_for
             FROM companion_proactive_message
             WHERE status = 'queued'
               AND (scheduled_for IS NULL OR datetime(scheduled_for) <= datetime('now'))
             ORDER BY COALESCE(scheduled_for, created_at) ASC",
        )?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            due.push(ProactiveMessage {
                id: row.get(0)?,
                trigger_kind: row.get(1)?,
                trigger_ref: row.get(2)?,
                message: row.get(3)?,
                status: row.get(4)?,
                created_at: row.get(5)?,
                delivered_at: row.get(6)?,
                resolved_at: row.get(7)?,
                scheduled_for: row.get(8)?,
            });
        }
    }
    if due.is_empty() {
        return Ok(Vec::new());
    }

    let mut budget = budget::today(pool)?;
    let mut released = Vec::new();
    for msg in due {
        if budget.is_exhausted() {
            tracing::info!(
                cap = budget.cap(),
                "proactive: daily ceiling reached, remaining nudges deferred to a later tick"
            );
            break;
        }
        // Atomic claim against BOTH the global ceiling and the per-kind cap.
        if !budget.try_consume(pool, &msg.trigger_kind)? {
            if budget.is_exhausted() {
                tracing::info!(
                    cap = budget.cap(),
                    "proactive: daily ceiling reached, remaining nudges deferred to a later tick"
                );
                break;
            }
            // Per-kind cap only — other kinds still have room today.
            tracing::debug!(kind = %msg.trigger_kind, "proactive: per-kind cap reached, deferring");
            continue;
        }
        // Claim the transition. `None` means a concurrent pass delivered it
        // first — don't announce it twice (the budget unit is already spent;
        // it self-corrects at the UTC date rollover).
        match claim_delivered(pool, &msg.id) {
            Ok(Some(delivered_at)) => released.push(ProactiveMessage {
                status: "delivered".into(),
                delivered_at: Some(delivered_at),
                ..msg
            }),
            Ok(None) => {
                tracing::debug!(id = %msg.id, "proactive: row already delivered by a concurrent pass");
            }
            Err(e) => {
                // The row stays `queued`; the next tick retries it.
                tracing::warn!(id = %msg.id, error = %e, "proactive: could not claim delivery");
            }
        }
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
/// window: on a long-lived install a still-deliverable nudge can fall outside
/// the newest N rows (the retention prune in [`enqueue_if_new`] only reaps
/// terminal-status rows, so unresolved ones accumulate), which made the
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
    if let Err(e) = app.emit(
        crate::commands::companion::proactive::PROACTIVE_EVENT,
        payload,
    ) {
        tracing::warn!(error = %e, "proactive: deliver_now event emit failed");
    }
}

/// Claim the `queued → delivered` transition for one row. Returns the
/// `delivered_at` stamp when THIS call performed the transition, `None` when
/// the row was no longer `queued` (a concurrent pass got there first, or the
/// user resolved it). The conditional `status = 'queued'` in the UPDATE is what
/// makes the claim exclusive — callers use the return value to decide whether
/// they own the announcement.
fn claim_delivered(pool: &UserDbPool, id: &str) -> Result<Option<String>, AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let updated = conn.execute(
        "UPDATE companion_proactive_message
         SET status = 'delivered', delivered_at = ?1
         WHERE id = ?2 AND status = 'queued'",
        params![now, id],
    )?;
    Ok((updated == 1).then_some(now))
}

/// Transition `queued → delivered` for the given message id. Fire-and-forget
/// wrapper over [`claim_delivered`] for the direct-delivery paths
/// ([`deliver_now`], the fleet reconciler) that emit unconditionally.
pub fn mark_delivered(pool: &UserDbPool, id: &str) -> Result<(), AppError> {
    claim_delivered(pool, id).map(|_| ())
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;

    /// Single private `:memory:` connection — `budget::try_consume` opens a
    /// write transaction, and a second pooled connection on shared-cache
    /// in-memory would dead-lock (SQLITE_LOCKED). Mirrors `budget::tests`.
    fn test_pool() -> UserDbPool {
        let manager = SqliteConnectionManager::memory();
        let pool = Pool::builder().max_size(1).build(manager).expect("pool");
        pool.get()
            .unwrap()
            .execute_batch(
                "CREATE TABLE companion_proactive_message (
                    id TEXT PRIMARY KEY,
                    trigger_kind TEXT NOT NULL,
                    trigger_ref TEXT,
                    message TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    delivered_at TEXT,
                    resolved_at TEXT,
                    scheduled_for TEXT);
                 CREATE TABLE companion_proactive_budget (
                    date TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0);
                 CREATE TABLE companion_attention_budget (
                    date TEXT NOT NULL, trigger_kind TEXT NOT NULL,
                    count INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (date, trigger_kind));",
            )
            .unwrap();
        pool
    }

    fn nudge(kind: &str, reference: &str) -> Nudge {
        Nudge {
            trigger_kind: kind.into(),
            trigger_ref: Some(reference.into()),
            message: format!("{kind} / {reference}"),
        }
    }

    fn status_of(pool: &UserDbPool, id: &str) -> String {
        get_by_id(pool, id)
            .unwrap()
            .map(|m| m.status)
            .unwrap_or_else(|| "<pruned>".into())
    }

    fn count_rows(pool: &UserDbPool) -> i64 {
        pool.get()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM companion_proactive_message",
                [],
                |r| r.get(0),
            )
            .unwrap()
    }

    /// Insert a row directly so a test can control `created_at` /
    /// `scheduled_for` (both are SQL expressions, e.g. `datetime('now','-3 days')`).
    fn seed(pool: &UserDbPool, id: &str, kind: &str, created_sql: &str, scheduled_sql: &str) {
        pool.get()
            .unwrap()
            .execute(
                &format!(
                    "INSERT INTO companion_proactive_message
                     (id, trigger_kind, trigger_ref, message, status, created_at, scheduled_for)
                     VALUES (?1, ?2, ?1, 'seeded', 'queued', {created_sql}, {scheduled_sql})"
                ),
                params![id, kind],
            )
            .unwrap();
    }

    /// AC1 — a queued row that loses its budget slot is neither deleted nor
    /// stranded: it stays `queued` and the NEXT release pass is still able to
    /// see it. The pre-fix code either rolled the insert back or left a row no
    /// code path could ever re-deliver.
    #[test]
    fn queued_rows_that_miss_a_slot_survive_for_the_next_pass() {
        let pool = test_pool();
        // dev_goal* share a per-kind cap of 2.
        for i in 0..5 {
            assert!(
                enqueue_external(&pool, &nudge("dev_goal_stalled", &format!("goal{i}")))
                    .unwrap()
                    .is_some()
            );
        }
        let released = release_pending(&pool).unwrap();
        assert_eq!(released.len(), 2, "per-kind cap releases 2");
        assert!(released.iter().all(|m| m.status == "delivered"));
        assert!(released.iter().all(|m| m.delivered_at.is_some()));

        // Nothing was discarded — the other three are still there, still queued,
        // and still visible to a later pass.
        assert_eq!(count_rows(&pool), 5);
        let queued_left = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM companion_proactive_message WHERE status = 'queued'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!(queued_left, 3);

        // Same UTC day → the cap still holds, and re-running is idempotent
        // rather than double-delivering.
        assert!(release_pending(&pool).unwrap().is_empty());
        assert_eq!(count_rows(&pool), 5);
    }

    /// A kind at its cap must not starve the kinds behind it. The old loop
    /// `break`-ed on any refusal, so one capped kind early in `collect_all`
    /// order silenced every kind after it for the whole pass.
    #[test]
    fn per_kind_cap_does_not_starve_other_kinds() {
        let pool = test_pool();
        for i in 0..3 {
            enqueue_external(&pool, &nudge("dev_goal_stalled", &format!("goal{i}"))).unwrap();
        }
        enqueue_external(&pool, &nudge("incident_blocker", "inc1")).unwrap();

        let released = release_pending(&pool).unwrap();
        assert_eq!(released.len(), 3, "2 goal nudges (cap) + the incident");
        assert!(
            released
                .iter()
                .any(|m| m.trigger_kind == "incident_blocker"),
            "the incident must not be starved by the capped goal kind"
        );
    }

    /// AC2 — the escape hatch for rows already stranded in the wild. A queued
    /// row past its window ages to `expired`, which unblocks the dedupe, and
    /// the trigger restates its case with fresh text on the SAME pass.
    #[test]
    fn stale_queued_row_expires_and_its_trigger_refires_immediately() {
        let pool = test_pool();
        seed(
            &pool,
            "old",
            "dev_goal_stalled",
            "datetime('now','-3 days')",
            "NULL",
        );

        // Same (trigger_kind, trigger_ref) as the stale row.
        let fresh = enqueue_external(&pool, &nudge("dev_goal_stalled", "old"))
            .unwrap()
            .expect("stale row must not dedupe-block the fresh nudge");

        assert_eq!(status_of(&pool, "old"), "expired");
        assert_eq!(status_of(&pool, &fresh.id), "queued");
        assert_eq!(release_pending(&pool).unwrap().len(), 1);
        assert_eq!(status_of(&pool, &fresh.id), "delivered");
    }

    /// A queued row still inside its window is delivered, not expired.
    #[test]
    fn fresh_queued_row_is_delivered_not_expired() {
        let pool = test_pool();
        seed(
            &pool,
            "recent",
            "fleet_stale",
            "datetime('now','-2 hours')",
            "NULL",
        );
        let released = release_pending(&pool).unwrap();
        assert_eq!(released.len(), 1);
        assert_eq!(status_of(&pool, "recent"), "delivered");
    }

    /// AC3 — the scheduled lane rides the same sweep, so it now runs on the
    /// tick instead of only via a manual command with no callers.
    #[test]
    fn due_scheduled_check_in_releases() {
        let pool = test_pool();
        let when = (Utc::now() - Duration::minutes(2)).to_rfc3339();
        let msg = insert_scheduled(&pool, "checking back as promised", &when).unwrap();
        assert_eq!(msg.trigger_kind, SCHEDULED_TRIGGER_KIND);

        let released = release_pending(&pool).unwrap();
        assert_eq!(released.len(), 1);
        assert_eq!(released[0].id, msg.id);
        assert_eq!(status_of(&pool, &msg.id), "delivered");
    }

    #[test]
    fn future_scheduled_check_in_is_left_queued() {
        let pool = test_pool();
        let when = (Utc::now() + Duration::days(1)).to_rfc3339();
        let msg = insert_scheduled(&pool, "tomorrow", &when).unwrap();
        assert!(release_pending(&pool).unwrap().is_empty());
        assert_eq!(status_of(&pool, &msg.id), "queued");
    }

    /// A commitment gets a week of grace (no trigger will ever re-create it),
    /// but not forever — a months-late "I'll check back in 10 minutes" expires.
    #[test]
    fn far_overdue_scheduled_check_in_expires_instead_of_firing_late() {
        let pool = test_pool();
        // 10 days past due (beyond the 7-day grace) but created inside the
        // 30-day retention window, so it ages to `expired` and stays readable.
        seed(
            &pool,
            "ancient",
            SCHEDULED_TRIGGER_KIND,
            "datetime('now','-20 days')",
            "datetime('now','-10 days')",
        );
        seed(
            &pool,
            "late_but_ok",
            SCHEDULED_TRIGGER_KIND,
            "datetime('now','-3 days')",
            "datetime('now','-2 days')",
        );
        let released = release_pending(&pool).unwrap();
        assert_eq!(status_of(&pool, "ancient"), "expired");
        assert_eq!(
            released.len(),
            1,
            "the 2-day-late commitment is still honoured"
        );
        assert_eq!(released[0].id, "late_but_ok");
    }

    /// The two halves of the sweep compose: a row aged to `expired` that is
    /// ALSO past the retention window is removed in the same pass, not left
    /// behind. (Learned the hard way — the first draft of the test above used
    /// a 40-day-old row and asserted `expired`, and the prune had already
    /// taken it.)
    #[test]
    fn expired_rows_past_the_retention_window_are_pruned() {
        let pool = test_pool();
        seed(
            &pool,
            "ancient",
            SCHEDULED_TRIGGER_KIND,
            "datetime('now','-40 days')",
            "datetime('now','-35 days')",
        );
        release_pending(&pool).unwrap();
        assert_eq!(
            status_of(&pool, "ancient"),
            "<pruned>",
            "expired AND past retention → the row is gone entirely"
        );
    }

    /// AC4 — the full status walk a nudge must be able to make. `engaged` was
    /// unreachable in production only because delivery never happened; the
    /// transition itself works from both `queued` and `delivered`.
    #[test]
    fn a_nudge_can_reach_engaged() {
        let pool = test_pool();
        let msg = enqueue_external(&pool, &nudge("fleet_stale", "sess1"))
            .unwrap()
            .unwrap();
        assert_eq!(status_of(&pool, &msg.id), "queued");

        let released = release_pending(&pool).unwrap();
        assert_eq!(released.len(), 1);
        assert_eq!(status_of(&pool, &msg.id), "delivered");

        resolve(&pool, &msg.id, true).unwrap();
        assert_eq!(status_of(&pool, &msg.id), "engaged");

        // Already resolved — a second engage is an error, not a silent no-op.
        assert!(resolve(&pool, &msg.id, true).is_err());
    }

    /// Every queued row ends up delivered or expired — never permanently
    /// stranded. This is the invariant the 20 rows in the live DB violated.
    #[test]
    fn no_queued_row_stays_queued_forever() {
        let pool = test_pool();
        for i in 0..4 {
            seed(
                &pool,
                &format!("s{i}"),
                "dev_goal_target",
                "datetime('now','-5 minutes')",
                "NULL",
            );
        }
        // Day 1: the per-kind cap releases 2, leaving 2 queued.
        assert_eq!(release_pending(&pool).unwrap().len(), 2);
        // Simulate them aging past the window rather than waiting a real day.
        pool.get()
            .unwrap()
            .execute(
                "UPDATE companion_proactive_message
                 SET created_at = datetime('now','-2 days') WHERE status = 'queued'",
                [],
            )
            .unwrap();
        release_pending(&pool).unwrap();
        let still_queued: i64 = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM companion_proactive_message WHERE status = 'queued'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(still_queued, 0, "no row may remain queued indefinitely");
    }
}
