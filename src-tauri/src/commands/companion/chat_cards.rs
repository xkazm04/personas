//! Durable inline chat-cards.
//!
//! Inline chat-cards used to be one-shot Tauri events into a non-persisted
//! Zustand array: the dispatcher emitted them, the frontend appended them to
//! the latest bubble, and the next send (or a dev refresh, or a panel reset)
//! wiped them. For *informational* kinds that is fine — they are UI snippets
//! that ride along with a reply.
//!
//! For **actionable** kinds it was a data-loss bug. `fleet_plan` and
//! `ship_milestone` are proposals the operator is expected to confirm; the
//! plan JSON is stripped from the assistant text before episode persistence,
//! so once the transient array was cleared the proposal was unrecoverable.
//! An Aug 2026 session lost six dispatched builds that way.
//!
//! So: actionable cards get a row here BEFORE the event is emitted, the row id
//! rides in the event payload, and the frontend resolves the row (dispatched /
//! dismissed) through `companion_resolve_chat_card`. A pending row outlives a
//! refresh and is re-hydrated on mount / conversation switch.
//!
//! Plain rusqlite on the user DB, same convention as the sibling companion
//! command modules (see `sidecars.rs`).

use std::sync::Arc;

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::UserDbPool;
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

/// Card kinds that are ACTIONABLE — a proposal the operator confirms, which
/// writes something real (spawns CLI sessions, creates a milestone). Only
/// these get a durable row; everything else stays transient by design.
pub const ACTIONABLE_KINDS: &[&str] = &["fleet_plan", "ship_milestone"];

/// Statuses a card row may hold. `pending` is the only actionable state.
const VALID_STATUSES: &[&str] = &["pending", "dispatched", "dismissed", "superseded"];

/// Hard cap on a stored config/result blob (chars). A fleet plan is a handful
/// of rows; this is the backstop against a runaway dispatcher payload.
const MAX_JSON_CHARS: usize = 200_000;

/// Cap on rows returned per conversation — the recovery strip is meant to
/// surface a few stranded proposals, not paginate history.
const MAX_LIST_ROWS: usize = 50;

/// True when `kind` is one of the actionable kinds that earns a durable row.
pub fn is_actionable_kind(kind: &str) -> bool {
    ACTIONABLE_KINDS.contains(&kind)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CompanionChatCard {
    pub id: String,
    pub conversation_id: String,
    pub episode_id: Option<String>,
    pub kind: String,
    pub title: Option<String>,
    /// Widget config, serialized exactly as the dispatcher emitted it.
    pub config_json: String,
    /// `pending` | `dispatched` | `dismissed` | `superseded`.
    pub status: String,
    /// Outcome blob written when the card resolves (e.g. the dispatch message
    /// plus the rows that were actually confirmed).
    pub result_json: Option<String>,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

fn clamp_blob(value: String) -> Result<String, AppError> {
    if value.chars().count() > MAX_JSON_CHARS {
        return Err(AppError::Validation(
            "chat card: payload exceeds the size limit".into(),
        ));
    }
    Ok(value)
}

/// Insert one actionable card row and return its id. Called from the turn
/// pipeline BEFORE the chat-cards event is emitted, so the id can ride along.
pub fn insert_card(
    pool: &UserDbPool,
    conversation_id: &str,
    episode_id: Option<&str>,
    kind: &str,
    title: Option<&str>,
    config_json: String,
) -> Result<String, AppError> {
    let conversation_id = conversation_id.trim();
    if conversation_id.is_empty() {
        return Err(AppError::Validation(
            "chat card: conversation id is required".into(),
        ));
    }
    if kind.trim().is_empty() {
        return Err(AppError::Validation("chat card: kind is required".into()));
    }
    let config_json = clamp_blob(config_json)?;
    let id = uuid::Uuid::new_v4().to_string();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_chat_card
             (id, conversation_id, episode_id, kind, title, config_json, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending')",
        params![
            id,
            conversation_id,
            episode_id,
            kind.trim(),
            title,
            config_json
        ],
    )?;
    Ok(id)
}

/// Read a conversation's cards, newest first. `pending_only` is what the
/// recovery strip uses — it wants the stranded proposals, not the archive.
pub fn list_cards(
    pool: &UserDbPool,
    conversation_id: &str,
    pending_only: bool,
) -> Result<Vec<CompanionChatCard>, AppError> {
    let conversation_id = conversation_id.trim();
    if conversation_id.is_empty() {
        return Ok(Vec::new());
    }
    let sql = if pending_only {
        "SELECT id, conversation_id, episode_id, kind, title, config_json, status,
                result_json, created_at, resolved_at
           FROM companion_chat_card
          WHERE conversation_id = ?1 AND status = 'pending'
          ORDER BY created_at DESC, rowid DESC
          LIMIT ?2"
    } else {
        "SELECT id, conversation_id, episode_id, kind, title, config_json, status,
                result_json, created_at, resolved_at
           FROM companion_chat_card
          WHERE conversation_id = ?1
          ORDER BY created_at DESC, rowid DESC
          LIMIT ?2"
    };
    let conn = pool.get()?;
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map(params![conversation_id, MAX_LIST_ROWS as i64], |r| {
            Ok(CompanionChatCard {
                id: r.get(0)?,
                conversation_id: r.get(1)?,
                episode_id: r.get(2)?,
                kind: r.get(3)?,
                title: r.get(4)?,
                config_json: r.get(5)?,
                status: r.get(6)?,
                result_json: r.get(7)?,
                created_at: r.get(8)?,
                resolved_at: r.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Resolve a card. Terminal statuses are sticky: once a card is `dispatched`
/// it can never be walked back to `pending`, because the sessions it started
/// are real. Re-resolving to the SAME status is a no-op (idempotent retry).
pub fn resolve_card(
    pool: &UserDbPool,
    id: &str,
    status: &str,
    result_json: Option<String>,
) -> Result<(), AppError> {
    if !VALID_STATUSES.contains(&status) {
        return Err(AppError::Validation(format!(
            "chat card: unknown status `{status}`"
        )));
    }
    if status == "pending" {
        return Err(AppError::Validation(
            "chat card: cannot un-resolve a card back to pending".into(),
        ));
    }
    let result_json = result_json.map(clamp_blob).transpose()?;
    let conn = pool.get()?;
    let current: Option<String> = conn
        .query_row(
            "SELECT status FROM companion_chat_card WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .ok();
    let Some(current) = current else {
        return Err(AppError::NotFound(format!("chat card `{id}` not found")));
    };
    if current == "dispatched" && status != "dispatched" {
        return Err(AppError::Validation(
            "chat card: already dispatched — its sessions are live and cannot be dismissed".into(),
        ));
    }
    conn.execute(
        "UPDATE companion_chat_card
            SET status = ?2,
                result_json = COALESCE(?3, result_json),
                resolved_at = COALESCE(resolved_at, datetime('now'))
          WHERE id = ?1",
        params![id, status, result_json],
    )?;
    Ok(())
}

/// Atomically CLAIM a pending card for dispatch. Returns `Ok(())` only for the
/// caller that flipped `pending → dispatched`; every later caller gets an
/// error. This is the idempotency guard for `companion_dispatch_fleet_plan` —
/// a double-click, a replayed event, or a re-mounted card can no longer spawn
/// a second fleet of CLI sessions.
pub fn claim_for_dispatch(conn: &Connection, id: &str) -> Result<(), AppError> {
    let changed = conn.execute(
        "UPDATE companion_chat_card
            SET status = 'dispatched', resolved_at = datetime('now')
          WHERE id = ?1 AND status = 'pending'",
        params![id],
    )?;
    if changed == 1 {
        return Ok(());
    }
    let existing: Option<String> = conn
        .query_row(
            "SELECT status FROM companion_chat_card WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .ok();
    match existing.as_deref() {
        Some("dispatched") => Err(AppError::Validation(
            "This plan was already dispatched — open Fleet to see its sessions.".into(),
        )),
        Some(other) => Err(AppError::Validation(format!(
            "This plan is no longer actionable (status: {other})."
        ))),
        None => Err(AppError::NotFound(format!("chat card `{id}` not found"))),
    }
}

/// Release a claim taken by [`claim_for_dispatch`] when the dispatch itself
/// failed before doing anything real. Best-effort: a failure to roll the row
/// back leaves it dispatched-with-no-result, which is the safe direction.
pub fn release_claim(conn: &Connection, id: &str) {
    if let Err(e) = conn.execute(
        "UPDATE companion_chat_card
            SET status = 'pending', resolved_at = NULL
          WHERE id = ?1 AND status = 'dispatched' AND result_json IS NULL",
        params![id],
    ) {
        tracing::warn!(error = %e, card_id = %id, "chat card claim release failed");
    }
}

/// Write the dispatch outcome onto an already-claimed row.
pub fn record_dispatch_result(conn: &Connection, id: &str, result_json: String) {
    let Ok(result_json) = clamp_blob(result_json) else {
        tracing::warn!(card_id = %id, "chat card dispatch result too large — not stored");
        return;
    };
    if let Err(e) = conn.execute(
        "UPDATE companion_chat_card SET result_json = ?2 WHERE id = ?1",
        params![id, result_json],
    ) {
        tracing::warn!(error = %e, card_id = %id, "chat card dispatch result write failed");
    }
}

#[tauri::command]
pub fn companion_list_chat_cards(
    state: State<'_, Arc<AppState>>,
    conversation_id: String,
    pending_only: Option<bool>,
) -> Result<Vec<CompanionChatCard>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    list_cards(
        &state.user_db,
        &conversation_id,
        pending_only.unwrap_or(true),
    )
}

#[tauri::command]
pub fn companion_resolve_chat_card(
    state: State<'_, Arc<AppState>>,
    id: String,
    status: String,
    result_json: Option<String>,
) -> Result<(), AppError> {
    ipc_auth::require_auth_sync(&state)?;
    resolve_card(&state.user_db, &id, &status, result_json)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_pool() -> UserDbPool {
        use r2d2_sqlite::SqliteConnectionManager;
        let manager = SqliteConnectionManager::memory();
        let pool = r2d2::Pool::builder().max_size(1).build(manager).unwrap();
        pool.get()
            .unwrap()
            .execute_batch(
                "CREATE TABLE companion_chat_card (
                    id              TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    episode_id      TEXT,
                    kind            TEXT NOT NULL,
                    title           TEXT,
                    config_json     TEXT NOT NULL DEFAULT '{}',
                    status          TEXT NOT NULL DEFAULT 'pending',
                    result_json     TEXT,
                    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                    resolved_at     TEXT
                );",
            )
            .unwrap();
        pool
    }

    #[test]
    fn only_actionable_kinds_are_durable() {
        assert!(is_actionable_kind("fleet_plan"));
        assert!(is_actionable_kind("ship_milestone"));
        assert!(!is_actionable_kind("persona_overview"));
    }

    #[test]
    fn insert_then_list_pending() {
        let pool = test_pool();
        let id = insert_card(
            &pool,
            "conv_1",
            Some("ep_1"),
            "fleet_plan",
            Some("Ship it"),
            r#"{"rows":[]}"#.into(),
        )
        .unwrap();
        let rows = list_cards(&pool, "conv_1", true).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, id);
        assert_eq!(rows[0].status, "pending");
        assert_eq!(rows[0].episode_id.as_deref(), Some("ep_1"));
        // Another conversation sees nothing.
        assert!(list_cards(&pool, "conv_2", true).unwrap().is_empty());
    }

    #[test]
    fn resolve_moves_out_of_pending_and_dispatch_is_sticky() {
        let pool = test_pool();
        let id = insert_card(&pool, "c", None, "fleet_plan", None, "{}".into()).unwrap();
        resolve_card(&pool, &id, "dismissed", None).unwrap();
        assert!(list_cards(&pool, "c", true).unwrap().is_empty());
        assert_eq!(
            list_cards(&pool, "c", false).unwrap()[0].status,
            "dismissed"
        );

        let id2 = insert_card(&pool, "c", None, "fleet_plan", None, "{}".into()).unwrap();
        resolve_card(&pool, &id2, "dispatched", Some(r#"{"m":"ok"}"#.into())).unwrap();
        // A dispatched card can never be dismissed — the sessions are real.
        assert!(resolve_card(&pool, &id2, "dismissed", None).is_err());
        // …but re-resolving to dispatched is an idempotent no-op.
        resolve_card(&pool, &id2, "dispatched", None).unwrap();

        assert!(resolve_card(&pool, &id2, "pending", None).is_err());
        assert!(resolve_card(&pool, "nope", "dismissed", None).is_err());
        assert!(resolve_card(&pool, &id2, "banana", None).is_err());
    }

    #[test]
    fn claim_is_single_winner() {
        let pool = test_pool();
        let id = insert_card(&pool, "c", None, "fleet_plan", None, "{}".into()).unwrap();
        {
            // The pool is single-connection (an in-memory SQLite DB is per
            // connection), so the handle must be dropped before any helper
            // that checks the pool out again.
            let conn = pool.get().unwrap();
            claim_for_dispatch(&conn, &id).unwrap();
            // Second dispatch of the same card is refused — this is the guard
            // that stops a double-confirm from spawning two fleets.
            assert!(claim_for_dispatch(&conn, &id).is_err());
            record_dispatch_result(&conn, &id, r#"{"message":"3 sessions"}"#.into());
        }
        let row = &list_cards(&pool, "c", false).unwrap()[0];
        assert_eq!(row.status, "dispatched");
        assert!(row.result_json.as_deref().unwrap().contains("3 sessions"));
        assert!(row.resolved_at.is_some());
    }

    #[test]
    fn release_returns_an_unfulfilled_claim_to_pending() {
        let pool = test_pool();
        let id = insert_card(&pool, "c", None, "fleet_plan", None, "{}".into()).unwrap();
        {
            let conn = pool.get().unwrap();
            claim_for_dispatch(&conn, &id).unwrap();
            release_claim(&conn, &id);
        }
        assert_eq!(list_cards(&pool, "c", true).unwrap().len(), 1);
        {
            // A claim that DID produce a result is never released.
            let conn = pool.get().unwrap();
            claim_for_dispatch(&conn, &id).unwrap();
            record_dispatch_result(&conn, &id, "{}".into());
            release_claim(&conn, &id);
        }
        assert_eq!(
            list_cards(&pool, "c", false).unwrap()[0].status,
            "dispatched"
        );
    }

    #[test]
    fn rejects_blank_ids_and_oversized_config() {
        let pool = test_pool();
        assert!(insert_card(&pool, "  ", None, "fleet_plan", None, "{}".into()).is_err());
        assert!(insert_card(&pool, "c", None, "  ", None, "{}".into()).is_err());
        let huge = "x".repeat(MAX_JSON_CHARS + 1);
        assert!(insert_card(&pool, "c", None, "fleet_plan", None, huge).is_err());
    }
}
