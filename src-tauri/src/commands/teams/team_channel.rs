//! Team channel — Design B read-model for the Collab living chat.
//!
//! Unions the team's three communication sources server-side into one
//! chronological feed with keyset pagination:
//!
//!   1. `team_assignment_events` — the AUTHORITATIVE step layer (handoffs,
//!      rework, review gates), scoped via the assignment's team and joined to
//!      steps for the speaking persona + step title. Noisy machine kinds
//!      (matching/pending) are filtered out at the SQL level.
//!   2. `persona_events` — bus traffic emitted by team members (artifacts,
//!      PR lifecycle, handshakes). `task_completed` is excluded as telemetry.
//!   3. `team_memories` — shared knowledge; `category='directive'` rows are
//!      the user's messages and carry delivery receipts in `tags`.
//!
//! All timestamps are normalized to `YYYY-MM-DDTHH:MM:SSZ` in SQL (the three
//! tables mix RFC3339 and SQLite-naive formats — the repo-wide clash).

use std::sync::Arc;

use rusqlite::params;
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::repos::resources::team_memories as memories_repo;
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
            })
        })?;
        items.extend(rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?);
    }

    // --- 2. Bus traffic from team members ---
    {
        let mut stmt = conn.prepare(
            "SELECT e.id,
                    strftime('%Y-%m-%dT%H:%M:%SZ', datetime(e.created_at)) AS at,
                    e.event_type, e.payload, e.source_id
             FROM persona_events e
             WHERE e.source_id IN (SELECT persona_id FROM persona_team_members WHERE team_id = ?1)
               AND e.event_type != 'task_completed'
               AND e.event_type NOT LIKE '\\_chain\\_%' ESCAPE '\\'
               AND strftime('%Y-%m-%dT%H:%M:%SZ', datetime(e.created_at)) < ?2
             ORDER BY at DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![team_id, cursor, limit], |r| {
            Ok(TeamChannelItem {
                id: format!("pe-{}", r.get::<_, String>(0)?),
                kind: "event".into(),
                at: r.get(1)?,
                label: r.get(2)?,
                extra: r.get(3)?,
                persona_id: r.get(4)?,
                body: None,
                assignment_id: None,
                step_id: None,
            })
        })?;
        items.extend(rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?);
    }

    // --- 3. Shared memory + the user's directives ---
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
            })
        })?;
        items.extend(rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?);
    }

    items.sort_by(|a, b| b.at.cmp(&a.at).then(b.id.cmp(&a.id)));
    items.truncate(limit as usize);
    Ok(items)
}

/// Post a user directive into the team channel. Stored as a high-importance
/// `team_memories` row (`category='directive'`) so it (a) rides into prompts
/// via the USER DIRECTIVES block + memory injection, and (b) accumulates
/// step-boundary delivery receipts in `tags` (see the orchestrator hook).
#[tauri::command]
pub fn post_team_directive(
    state: State<'_, Arc<AppState>>,
    team_id: String,
    content: String,
) -> Result<crate::db::models::TeamMemory, AppError> {
    require_auth_sync(&state)?;
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err(AppError::Validation("Directive cannot be empty".into()));
    }
    let title: String = {
        let one_line = content.replace(['\n', '\r'], " ");
        if one_line.chars().count() > 80 {
            one_line.chars().take(80).collect::<String>() + "…"
        } else {
            one_line
        }
    };
    memories_repo::create(
        &state.db,
        crate::db::models::CreateTeamMemoryInput {
            team_id,
            run_id: None,
            member_id: None,
            persona_id: None, // NULL author = the user
            title,
            content,
            category: Some("directive".into()),
            importance: Some(10),
            tags: None,
        },
    )
}
