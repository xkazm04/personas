//! Team channel — Design B read-model for the Collab living chat.
//!
//! Unions the team's communication sources server-side into one chronological
//! feed with keyset pagination:
//!
//!   1. `team_assignment_events` — the AUTHORITATIVE step layer (handoffs,
//!      rework, review gates), scoped via the assignment's team and joined to
//!      steps for the speaking persona + step title. Noisy machine kinds
//!      (matching/pending) are filtered out at the SQL level.
//!   2. `persona_events` — bus traffic emitted by team members (artifacts,
//!      PR lifecycle, handshakes). `task_completed` is excluded as telemetry.
//!   3. `team_memories` — shared knowledge (legacy directives included for
//!      back-compat).
//!   4. `team_channel_messages` — the C1 multi-author table: the user's
//!      directives plus (later) persona/athena/director posts, with delivery
//!      receipts in `deliveries`.
//!
//! All timestamps are normalized to `YYYY-MM-DDTHH:MM:SSZ` in SQL (the three
//! tables mix RFC3339 and SQLite-naive formats — the repo-wide clash).

use std::sync::Arc;

use rusqlite::params;
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::repos::resources::team_channel as channel_repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TeamChannelItem {
    pub id: String,
    /// 'step' | 'event' | 'memory' | 'directive'
    pub kind: String,
    /// Normalized RFC3339 UTC (second resolution) — sortable everywhere.
    pub at: String,
    pub persona_id: Option<String>,
    /// step kind / event type / memory category — the row's machine label.
    pub label: String,
    /// Human line: step title, payload summary, or memory title+content.
    pub body: Option<String>,
    pub assignment_id: Option<String>,
    pub step_id: Option<String>,
    /// Raw JSON payload (events) or tags (memories — carries `deliveries`).
    pub extra: Option<String>,
    /// Channel messages only: the message id this one replies to (threading).
    pub reply_to: Option<String>,
}

const DEFAULT_LIMIT: i64 = 60;
const MAX_LIMIT: i64 = 200;

/// One page of the team's channel, newest first. `before` is an exclusive
/// RFC3339 cursor (pass the last item's `at` to page older).
#[tauri::command]
pub fn list_team_channel(
    state: State<'_, Arc<AppState>>,
    team_id: String,
    limit: Option<i64>,
    before: Option<String>,
) -> Result<Vec<TeamChannelItem>, AppError> {
    require_auth_sync(&state)?;
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let cursor = before.as_deref().unwrap_or("9999-12-31T23:59:59Z");
    let conn = state.db.get()?;
    let mut items: Vec<TeamChannelItem> = Vec::new();

    // --- 1. Step layer (authoritative) ---
    {
        let mut stmt = conn.prepare(
            "SELECT e.id,
                    strftime('%Y-%m-%dT%H:%M:%SZ', datetime(e.created_at)) AS at,
                    e.kind, e.payload, e.assignment_id, e.step_id,
                    s.assigned_persona_id, s.title
             FROM team_assignment_events e
             JOIN team_assignments a ON a.id = e.assignment_id
             LEFT JOIN team_assignment_steps s ON s.id = e.step_id
             WHERE a.team_id = ?1
               AND e.kind IN ('created','step_running','step_done','step_failed','step_skipped',
                              'status_awaiting_review','status_done','qa_changes_requested_rework')
               AND strftime('%Y-%m-%dT%H:%M:%SZ', datetime(e.created_at)) < ?2
             ORDER BY at DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![team_id, cursor, limit], |r| {
            Ok(TeamChannelItem {
                id: format!("tae-{}", r.get::<_, String>(0)?),
                kind: "step".into(),
                at: r.get(1)?,
                label: r.get(2)?,
                extra: r.get(3)?,
                assignment_id: r.get(4)?,
                step_id: r.get(5)?,
                persona_id: r.get(6)?,
                body: r.get(7)?,
                reply_to: None,
            })
        })?;
        items.extend(rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?);
    }

    // --- 2. Bus traffic from team members ---
    {
        let mut stmt = conn.prepare(
            "SELECT e.id,
                    strftime('%Y-%m-%dT%H:%M:%SZ', datetime(e.created_at)) AS at,
                    e.event_type, e.payload, e.source_id, e.payload_iv
             FROM persona_events e
             WHERE e.source_id IN (SELECT persona_id FROM persona_team_members WHERE team_id = ?1)
               AND e.event_type != 'task_completed'
               AND e.event_type NOT LIKE '\\_chain\\_%' ESCAPE '\\'
               AND strftime('%Y-%m-%dT%H:%M:%SZ', datetime(e.created_at)) < ?2
             ORDER BY at DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![team_id, cursor, limit], |r| {
            // `persona_events.payload` is AES-encrypted at rest when `payload_iv`
            // is set (mirrors events::row_to_event). Decrypt here — reading the
            // raw column would surface ciphertext as a "hashed" message body.
            let raw_payload: Option<String> = r.get(3)?;
            let payload_iv: Option<String> = r.get(5).unwrap_or(None);
            let extra = match (raw_payload, payload_iv) {
                (Some(ct), Some(ref iv)) if !iv.is_empty() => {
                    crate::engine::crypto::decrypt_from_db(&ct, iv).ok()
                }
                (p, _) => p, // plaintext or none
            };
            Ok(TeamChannelItem {
                id: format!("pe-{}", r.get::<_, String>(0)?),
                kind: "event".into(),
                at: r.get(1)?,
                label: r.get(2)?,
                extra,
                persona_id: r.get(4)?,
                body: None,
                assignment_id: None,
                step_id: None,
                reply_to: None,
            })
        })?;
        items.extend(rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?);
    }

    // --- 3. Shared memory (directives now live in the channel table; legacy
    //         category='directive' rows are still read for back-compat) ---
    {
        let mut stmt = conn.prepare(
            "SELECT id,
                    strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) AS at,
                    category, title, content, persona_id, tags
             FROM team_memories
             WHERE team_id = ?1
               AND strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) < ?2
             ORDER BY at DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![team_id, cursor, limit], |r| {
            let category: String = r.get(2)?;
            let title: String = r.get(3)?;
            let content: String = r.get(4)?;
            Ok(TeamChannelItem {
                id: format!("tm-{}", r.get::<_, String>(0)?),
                kind: if category == "directive" { "directive".into() } else { "memory".into() },
                at: r.get(1)?,
                label: category,
                body: Some(if title == content { content } else { format!("{title} — {content}") }),
                persona_id: r.get(5)?,
                extra: r.get(6)?,
                assignment_id: None,
                step_id: None,
                reply_to: None,
            })
        })?;
        items.extend(rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?);
    }

    // --- 4. Channel messages (C1 — multi-author table; authoritative store
    //         for new directives and, later, persona/athena/director posts) ---
    {
        let mut stmt = conn.prepare(
            "SELECT id,
                    strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) AS at,
                    author_kind, author_id, body, deliveries, assignment_id, reply_to
             FROM team_channel_messages
             WHERE team_id = ?1
               AND strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) < ?2
             ORDER BY at DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![team_id, cursor, limit], |r| {
            let author_kind: String = r.get(2)?;
            let deliveries: Option<String> = r.get(5)?;
            // The frontend's receipt parser expects a `{"deliveries":[…]}`
            // wrapper (it shares the team_memories tags shape); wrap the bare
            // column array so directives render their seen-by chips unchanged.
            let extra = deliveries.map(|d| format!("{{\"deliveries\":{d}}}"));
            // author_kind → the UI's item kind. 'user' is a directive; the
            // other kinds render via the multi-author path (C1c).
            let kind = if author_kind == "user" { "directive".to_string() } else { author_kind.clone() };
            Ok(TeamChannelItem {
                id: r.get::<_, String>(0)?,
                kind,
                at: r.get(1)?,
                label: author_kind,
                body: r.get(4)?,
                persona_id: r.get(3)?,
                extra,
                assignment_id: r.get(6)?,
                step_id: None,
                reply_to: r.get(7)?,
            })
        })?;
        items.extend(rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?);
    }

    items.sort_by(|a, b| b.at.cmp(&a.at).then(b.id.cmp(&a.id)));
    items.truncate(limit as usize);
    Ok(items)
}

/// Post a user directive into the team channel. C1: stored in the
/// authoritative `team_channel_messages` table (`author_kind='user'`,
/// `consumer='inject'`). The orchestrator injects recent channel messages
/// addressed to a persona at each step boundary and records delivery receipts
/// on the message (see the orchestrator hook).
#[tauri::command]
pub fn post_team_directive(
    state: State<'_, Arc<AppState>>,
    team_id: String,
    content: String,
    reply_to: Option<String>,
) -> Result<crate::db::models::TeamChannelMessage, AppError> {
    require_auth_sync(&state)?;
    channel_repo::create(
        &state.db,
        crate::db::models::CreateChannelMessageInput {
            team_id,
            author_kind: "user".into(),
            author_id: None, // NULL author = the user
            body: content,
            addressed_to: None, // whole team
            reply_to, // threading: the channel message this replies to
            assignment_id: None,
            consumer: Some("inject".into()),
        },
    )
}

/// Athena (the companion) posts a message into a team channel (C2).
/// `author_kind='athena'`, `consumer='inject'` so it reaches the addressed
/// persona's next step (whole-team when `addressed_to` is None). Used both
/// interactively (Athena posts directly when the user asks) and, under
/// autonomous mode, via the approval executor's `post_team_message` op (which
/// is on the autoapprove allowlist → free when autonomous, gated otherwise).
#[tauri::command]
pub fn companion_post_team_message(
    state: State<'_, Arc<AppState>>,
    team_id: String,
    body: String,
    addressed_to: Option<Vec<String>>,
) -> Result<crate::db::models::TeamChannelMessage, AppError> {
    require_auth_sync(&state)?;
    channel_repo::create(
        &state.db,
        crate::db::models::CreateChannelMessageInput {
            team_id,
            author_kind: "athena".into(),
            author_id: None,
            body,
            addressed_to,
            reply_to: None,
            assignment_id: None,
            consumer: Some("inject".into()),
        },
    )
}
