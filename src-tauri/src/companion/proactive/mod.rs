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

pub mod budget;
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
}

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
    if quiet::is_quiet_now(pool).unwrap_or(false) {
        tracing::debug!("proactive: quiet hours — skipping evaluation");
        return Ok(Vec::new());
    }
    let mut budget = budget::today(pool)?;

    let mut new_msgs = Vec::new();
    let candidates = triggers::collect_all(pool)?;
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
                budget.increment(pool)?;
                new_msgs.push(msg);
            }
            None => {
                // Dedupe hit — same (trigger_kind, trigger_ref) is
                // already unresolved. Skip silently; no budget cost.
            }
        }
    }
    Ok(new_msgs)
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
    }))
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
        "SELECT id, trigger_kind, trigger_ref, message, status, created_at, delivered_at, resolved_at
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
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
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
