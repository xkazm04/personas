//! Persona channel — the channels-v2 Lane B read-model (W3) and follow-up
//! loop (W4). Structural twin of `commands/teams/team_channel.rs`.
//!
//! A basic (non-team) persona's conversation is a server-side UNION over the
//! five persona-scoped sources, one chronological feed with composite keyset
//! pagination:
//!
//!   1. `team_channel_messages WHERE persona_id = ?` — the chat lane. The
//!      SAME multi-author table the team channel uses, scoped by the e11
//!      `persona_id` column (rows also carry the sentinel
//!      `team_id = 'persona:<id>'`; see the repo fn for why).
//!   2. `persona_reports` — large markdown artifacts. The channel renders a
//!      compact bubble: title + body clamped to 600 chars (the full body is
//!      fetched by the existing `get_report` command on click).
//!   3. `persona_manual_reviews` — quick-decide cards; resolved reviews stay
//!      in place as records (status rides `extra`).
//!   4. `persona_events` filtered `source_id = ? AND source_type LIKE
//!      'persona:%'` — subtle one-line system rows ("<event> was emitted").
//!   5. `persona_memories` — one-line "memory saved" rows (importance in
//!      `extra`).
//!
//! All timestamps normalize to `YYYY-MM-DDTHH:MM:SSZ` in SQL — the sources
//! mix RFC3339 and SQLite-naive formats (the repo-wide clash).

use std::sync::Arc;

use rusqlite::params;
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::background_job::spawn_guarded;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::team_channel as channel_repo;
use crate::engine::event_registry::{emit_event, event_name};
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// One row of a persona's channel — the flat union item (contract locked in
/// docs/plans/channels-v2.md W3). Namespaced ids: `pch-` chat / `prep-`
/// report / `prev-` review / `pev-` event / `pmem-` memory.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaChannelItem {
    pub id: String,
    /// 'chat' | 'report' | 'review' | 'event' | 'memory'
    pub kind: String,
    /// Normalized RFC3339 UTC (second resolution) — sortable everywhere.
    pub at: String,
    /// 'user' | 'persona' | 'athena'. Chat rows carry the row's author;
    /// every other kind is persona output by construction.
    pub author_kind: String,
    pub title: Option<String>,
    /// Chat body / clamped report body / review description. NULL for the
    /// system-line kinds (event, memory).
    pub body: Option<String>,
    /// Report rows: the raw `persona_reports.id` for `get_report` on click.
    pub report_id: Option<String>,
    /// Review rows: the raw `persona_manual_reviews.id` for the quick-decide
    /// commands.
    pub review_id: Option<String>,
    /// Review rows: 'info' | 'warning' | 'critical' | ...
    pub severity: Option<String>,
    /// Review rows: raw JSON string of suggested actions.
    pub suggested_actions: Option<String>,
    pub execution_id: Option<String>,
    /// Chat rows: the CHANNEL ITEM id this one replies to (`pch-`-prefixed,
    /// so it matches sibling item ids directly).
    pub reply_to: Option<String>,
    /// Kind-specific JSON: chat failure markers (`{"failed":true}`), report
    /// truncation (`{"truncated":true}`), review status, memory importance.
    pub extra: Option<String>,
}

const DEFAULT_LIMIT: i64 = 60;
const MAX_LIMIT: i64 = 200;
/// Report bodies render as a compact bubble; the full artifact is one
/// `get_report` away. SQLite `substr` counts characters, not bytes, so the
/// clamp can never split a UTF-8 sequence.
const REPORT_BODY_CLAMP: i64 = 600;

/// The lenses a caller can ask for. Asking for one runs ONLY its queries, so
/// `limit` is spent on rows the caller actually wants (the team channel's
/// starvation fix, inherited).
struct Lenses {
    chat: bool,
    reports: bool,
    reviews: bool,
    events: bool,
    memories: bool,
}

impl Lenses {
    fn parse(kinds: Option<&[String]>) -> Self {
        match kinds {
            None => Lenses {
                chat: true,
                reports: true,
                reviews: true,
                events: true,
                memories: true,
            },
            Some(k) => Lenses {
                chat: k.iter().any(|s| s == "chat"),
                reports: k.iter().any(|s| s == "report"),
                reviews: k.iter().any(|s| s == "review"),
                events: k.iter().any(|s| s == "event"),
                memories: k.iter().any(|s| s == "memory"),
            },
        }
    }
}

/// One page of a persona's channel, newest first.
///
/// Cursor: `before` + `before_id` are an exclusive COMPOSITE keyset cursor —
/// pass the last item's `at` AND `id`. `at` is second-resolution, so the
/// predicate mirrors the sort exactly: `at < c OR (at = c AND id < c_id)`.
/// Omitting `before_id` keeps strict-`at` semantics.
#[tauri::command]
pub fn list_persona_channel(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
    before: Option<String>,
    before_id: Option<String>,
    kinds: Option<Vec<String>>,
) -> Result<Vec<PersonaChannelItem>, AppError> {
    require_auth_sync(&state)?;
    let conn = state.db.get()?;
    read_persona_channel(
        &conn,
        &persona_id,
        limit,
        before.as_deref(),
        before_id.as_deref(),
        kinds.as_deref(),
    )
}

/// The read-model itself, over a bare connection — the command is auth +
/// this. Split out so cursor and lens behaviour are testable against a real
/// SQLite schema without standing up an AppState.
pub(crate) fn read_persona_channel(
    conn: &rusqlite::Connection,
    persona_id: &str,
    limit: Option<i64>,
    before: Option<&str>,
    before_id: Option<&str>,
    kinds: Option<&[String]>,
) -> Result<Vec<PersonaChannelItem>, AppError> {
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let cursor = before.unwrap_or("9999-12-31T23:59:59Z");
    // Empty string sorts below every real id, so `at = cursor AND id < ''` is
    // never true — the strict-`at` behaviour when no id is supplied.
    let cursor_id = before_id.unwrap_or("");
    let lenses = Lenses::parse(kinds);
    let mut items: Vec<PersonaChannelItem> = Vec::new();

    // --- 1. Chat lane ---
    if lenses.chat {
        let mut stmt = conn.prepare(
            "SELECT id,
                    strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) AS at,
                    author_kind, body, reply_to, deliveries
             FROM team_channel_messages
             WHERE persona_id = ?1
               AND (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) < ?2
                    OR (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) = ?2
                        AND ('pch-' || id) < ?4))
             ORDER BY at DESC, id DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![persona_id, cursor, limit, cursor_id], |r| {
            let reply_to: Option<String> = r.get(4)?;
            Ok(PersonaChannelItem {
                id: format!("pch-{}", r.get::<_, String>(0)?),
                kind: "chat".into(),
                at: r.get(1)?,
                author_kind: r.get(2)?,
                title: None,
                body: r.get(3)?,
                report_id: None,
                review_id: None,
                severity: None,
                suggested_actions: None,
                execution_id: None,
                reply_to: reply_to.map(|t| format!("pch-{t}")),
                // Persona-channel chat rows never carry delivery receipts
                // (consumer='display', sentinel team_id — the orchestrator
                // cannot reach them), so the column is the failure marker:
                // `{"failed":true}` on a run-died record.
                extra: r.get(5)?,
            })
        })?;
        items.extend(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?,
        );
    }

    // --- 2. Reports (compact bubble: title + clamped body) ---
    if lenses.reports {
        let mut stmt = conn.prepare(
            "SELECT id,
                    strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) AS at,
                    title,
                    substr(content, 1, ?5) AS body,
                    length(content) > ?5 AS truncated,
                    execution_id
             FROM persona_reports
             WHERE persona_id = ?1
               AND (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) < ?2
                    OR (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) = ?2
                        AND ('prep-' || id) < ?4))
             ORDER BY at DESC, id DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(
            params![persona_id, cursor, limit, cursor_id, REPORT_BODY_CLAMP],
            |r| {
                let raw_id: String = r.get(0)?;
                let mut body: String = r.get(3)?;
                let truncated: bool = r.get(4)?;
                if truncated {
                    body.push('…');
                }
                Ok(PersonaChannelItem {
                    id: format!("prep-{raw_id}"),
                    kind: "report".into(),
                    at: r.get(1)?,
                    author_kind: "persona".into(),
                    title: r.get(2)?,
                    body: Some(body),
                    report_id: Some(raw_id),
                    review_id: None,
                    severity: None,
                    suggested_actions: None,
                    execution_id: r.get(5)?,
                    reply_to: None,
                    extra: truncated.then(|| "{\"truncated\":true}".to_string()),
                })
            },
        )?;
        items.extend(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?,
        );
    }

    // --- 3. Human reviews (pending → resolved as ONE row: the card is a
    //         record, not a toast — status rides `extra`) ---
    if lenses.reviews {
        let mut stmt = conn.prepare(
            "SELECT id,
                    strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) AS at,
                    title, description, severity, suggested_actions,
                    execution_id, status, resolved_at
             FROM persona_manual_reviews
             WHERE persona_id = ?1
               AND (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) < ?2
                    OR (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) = ?2
                        AND ('prev-' || id) < ?4))
             ORDER BY at DESC, id DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![persona_id, cursor, limit, cursor_id], |r| {
            let raw_id: String = r.get(0)?;
            let status: String = r.get(7)?;
            let resolved_at: Option<String> = r.get(8)?;
            let extra = serde_json::json!({
                "status": status,
                "resolvedAt": resolved_at,
            })
            .to_string();
            Ok(PersonaChannelItem {
                id: format!("prev-{raw_id}"),
                kind: "review".into(),
                at: r.get(1)?,
                author_kind: "persona".into(),
                title: r.get(2)?,
                body: r.get(3)?,
                report_id: None,
                review_id: Some(raw_id),
                severity: r.get(4)?,
                suggested_actions: r.get(5)?,
                execution_id: r.get(6)?,
                reply_to: None,
                extra: Some(extra),
            })
        })?;
        items.extend(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?,
        );
    }

    // --- 4. Bus events (system lines; payload deliberately not surfaced —
    //         the row renders as "<event_type> was emitted") ---
    if lenses.events {
        let mut stmt = conn.prepare(
            "SELECT id,
                    strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) AS at,
                    event_type
             FROM persona_events
             WHERE source_id = ?1
               AND source_type LIKE 'persona:%'
               AND (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) < ?2
                    OR (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) = ?2
                        AND ('pev-' || id) < ?4))
             ORDER BY at DESC, id DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![persona_id, cursor, limit, cursor_id], |r| {
            Ok(PersonaChannelItem {
                id: format!("pev-{}", r.get::<_, String>(0)?),
                kind: "event".into(),
                at: r.get(1)?,
                author_kind: "persona".into(),
                title: r.get(2)?,
                body: None,
                report_id: None,
                review_id: None,
                severity: None,
                suggested_actions: None,
                execution_id: None,
                reply_to: None,
                extra: None,
            })
        })?;
        items.extend(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?,
        );
    }

    // --- 5. Memories ("memory saved" lines; importance/category in extra) ---
    if lenses.memories {
        let mut stmt = conn.prepare(
            "SELECT id,
                    strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) AS at,
                    title, importance, category
             FROM persona_memories
             WHERE persona_id = ?1
               AND (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) < ?2
                    OR (strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) = ?2
                        AND ('pmem-' || id) < ?4))
             ORDER BY at DESC, id DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![persona_id, cursor, limit, cursor_id], |r| {
            let importance: Option<i32> = r.get(3)?;
            let category: Option<String> = r.get(4)?;
            let extra = serde_json::json!({
                "importance": importance,
                "category": category,
            })
            .to_string();
            Ok(PersonaChannelItem {
                id: format!("pmem-{}", r.get::<_, String>(0)?),
                kind: "memory".into(),
                at: r.get(1)?,
                author_kind: "persona".into(),
                title: r.get(2)?,
                body: None,
                report_id: None,
                review_id: None,
                severity: None,
                suggested_actions: None,
                execution_id: None,
                reply_to: None,
                extra: Some(extra),
            })
        })?;
        items.extend(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?,
        );
    }

    // Must mirror the per-query ORDER BY exactly — the composite cursor pages
    // on (at, id), so the merge has to rank on (at, id) too.
    items.sort_by(|a, b| b.at.cmp(&a.at).then(b.id.cmp(&a.id)));
    items.truncate(limit as usize);
    Ok(items)
}

/// Per-kind row counts for a persona's channel (the facet rail). Each count
/// uses the SAME predicate as the lens it describes — the rail's invariant is
/// that a facet's count equals what selecting it returns.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaChannelKindCounts {
    // i64 in SQL but `number` on the wire — ts-rs maps i64 to `bigint`, which
    // will not do arithmetic with plain numbers. A row count cannot approach
    // 2^53. (Same reasoning as ChannelKindCounts.)
    #[ts(type = "number")]
    pub chat: i64,
    #[ts(type = "number")]
    pub report: i64,
    #[ts(type = "number")]
    pub review: i64,
    #[ts(type = "number")]
    pub event: i64,
    #[ts(type = "number")]
    pub memory: i64,
}

#[tauri::command]
pub fn count_persona_channel_kinds(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<PersonaChannelKindCounts, AppError> {
    require_auth_sync(&state)?;
    let conn = state.db.get()?;
    count_kinds(&conn, &persona_id)
}

pub(crate) fn count_kinds(
    conn: &rusqlite::Connection,
    persona_id: &str,
) -> Result<PersonaChannelKindCounts, AppError> {
    let chat: i64 = conn.query_row(
        "SELECT count(*) FROM team_channel_messages WHERE persona_id = ?1",
        params![persona_id],
        |r| r.get(0),
    )?;
    let report: i64 = conn.query_row(
        "SELECT count(*) FROM persona_reports WHERE persona_id = ?1",
        params![persona_id],
        |r| r.get(0),
    )?;
    let review: i64 = conn.query_row(
        "SELECT count(*) FROM persona_manual_reviews WHERE persona_id = ?1",
        params![persona_id],
        |r| r.get(0),
    )?;
    let event: i64 = conn.query_row(
        "SELECT count(*) FROM persona_events
         WHERE source_id = ?1 AND source_type LIKE 'persona:%'",
        params![persona_id],
        |r| r.get(0),
    )?;
    let memory: i64 = conn.query_row(
        "SELECT count(*) FROM persona_memories WHERE persona_id = ?1",
        params![persona_id],
        |r| r.get(0),
    )?;
    Ok(PersonaChannelKindCounts {
        chat,
        report,
        review,
        event,
        memory,
    })
}

// ---------------------------------------------------------------------------
// W4 — the follow-up loop
// ---------------------------------------------------------------------------

/// The created user chat row, echoed back so the frontend can retire its
/// optimistic ghost. `id` is the RAW row id (== `client_id` when supplied);
/// the corresponding channel item id is `pch-` + this.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PostedPersonaChannelMessage {
    pub id: String,
    /// Normalized RFC3339 UTC (second resolution).
    pub at: String,
}

/// Frontend-refresh signal, emitted after the user insert AND after the
/// persona's reply/failure insert. TS payload registered in
/// `src/lib/eventRegistry.ts`.
#[derive(Debug, Clone, Serialize)]
struct PersonaChannelMessageEvent {
    persona_id: String,
}

/// How many prior chat rows ride into the execution as conversation context —
/// the Slack-poller `input_data` shape plus `priorMessages`.
const PRIOR_MESSAGES: i64 = 6;
/// How long the reply-waiter polls a spawned execution before recording a
/// timeout row. `execute_persona_inner` returns at SPAWN time, not at
/// completion (the engine runs the agent asynchronously; Slack learns the
/// outcome from a poll loop too), so the waiter is a bounded poll — a hard
/// deadline, not a perpetual loop.
const REPLY_DEADLINE_SECS: u64 = 30 * 60;
const REPLY_POLL_SECS: u64 = 2;

/// Post a user message into a persona's channel and kick off the follow-up
/// execution. Returns as soon as the row is durable; the reply arrives later
/// as its own row (announced via the `persona-channel-message` event).
///
/// `client_id`: optional frontend-minted row id (optimistic-echo retire
/// contract — the echo row and the server row share an id, so the merge
/// retires the ghost instead of duplicating it).
#[tauri::command]
pub async fn post_persona_channel_message(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    content: String,
    client_id: Option<String>,
) -> Result<PostedPersonaChannelMessage, AppError> {
    require_auth_sync(&state)?;
    // Validates the persona exists AND captures the display name the reply
    // row will carry as author_label.
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;

    let (message_id, at) = channel_repo::create_persona_channel_message(
        &state.db,
        channel_repo::CreatePersonaChannelMessageInput {
            id: client_id,
            persona_id: persona_id.clone(),
            author_kind: "user".into(),
            author_id: None, // NULL author = the user
            author_label: None,
            body: content.clone(),
            reply_to: None,
            failed: false,
        },
    )?;
    emit_event(
        &app,
        event_name::PERSONA_CHANNEL_MESSAGE,
        &PersonaChannelMessageEvent {
            persona_id: persona_id.clone(),
        },
    );

    dispatch_channel_followup(
        state.inner().clone(),
        app,
        &persona_id,
        &persona.name,
        &message_id,
        &content,
    )?;

    Ok(PostedPersonaChannelMessage { id: message_id, at })
}

/// Build the follow-up input envelope for one posted user message and spawn
/// the guarded reply-waiter — the ONE dispatch door both the live post path
/// above and the attention loop's arrivals-recovery lane
/// (`engine::subscription::attention`) go through. Safe to call again for the
/// same message: the `channel:{persona_id}:{message_id}` idempotency key makes
/// `execute_persona_inner` return the existing execution instead of
/// double-running, and the fresh waiter then writes the reply the dead one
/// never did.
pub(crate) fn dispatch_channel_followup(
    state: Arc<AppState>,
    app: tauri::AppHandle,
    persona_id: &str,
    persona_name: &str,
    message_id: &str,
    content: &str,
) -> Result<(), AppError> {
    // Conversation context: the last few chat rows around this one, oldest
    // first, as the {author, content} pairs the dispatch prompt renders.
    let prior_messages: Vec<serde_json::Value> = {
        let conn = state.db.get()?;
        let mut stmt = conn.prepare(
            "SELECT author_kind, body FROM team_channel_messages
             WHERE persona_id = ?1 AND id != ?2
             ORDER BY created_at DESC, id DESC LIMIT ?3",
        )?;
        let mut rows: Vec<serde_json::Value> = stmt
            .query_map(params![persona_id, message_id, PRIOR_MESSAGES], |r| {
                Ok(serde_json::json!({
                    "author": r.get::<_, String>(0)?,
                    "content": r.get::<_, String>(1)?,
                }))
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        rows.reverse();
        rows
    };

    // Byte-shaped like the Slack poller's input_data (slack_poller.rs), with
    // source 'channel' and the persona id as the channel id — so the dispatch
    // prompt and `channel_reply::extract_reply_from_output` work unchanged.
    // `liveContext` situates the reply in the persona's current state (recent
    // runs + bus events) instead of chat history alone.
    let input_data = serde_json::json!({
        "source": "channel",
        "channelId": persona_id,
        "messageId": message_id,
        "author": "user",
        "content": content,
        "priorMessages": prior_messages,
        "liveContext":
            crate::engine::channel_live_context::build_live_context(&state.db, persona_id, None),
    });
    // Mirrors Slack's `slack:{channel}:{ts}` key: one execution per posted
    // message, ever — a retry of the spawn dedupes instead of double-running.
    let idempotency_key = format!("channel:{persona_id}:{message_id}");

    let persona_id = persona_id.to_string();
    let persona_name = persona_name.to_string();
    let message_id = message_id.to_string();
    let task_persona_id = persona_id.clone();
    let task_message_id = message_id.clone();
    let task_name = persona_name.clone();
    let panic_pool = state.db.clone();
    let panic_app = app.clone();
    let panic_persona_id = persona_id.clone();
    let panic_message_id = message_id.clone();
    let panic_name = persona_name;
    spawn_guarded(
        "persona_channel_followup",
        persona_id,
        async move {
            run_channel_followup(
                state,
                app,
                task_persona_id,
                task_name,
                task_message_id,
                input_data.to_string(),
                idempotency_key,
            )
            .await;
        },
        move |panic_msg| async move {
            // Failure is not empty success (W4 §8): even a panic leaves a
            // record in the conversation.
            record_failure(
                &panic_pool,
                &panic_app,
                &panic_persona_id,
                &panic_name,
                &panic_message_id,
                &format!("run crashed: {panic_msg}"),
            );
        },
    );
    Ok(())
}

/// The spawned half: execute, wait for the terminal state, write the reply
/// (or the failure record) back into the channel.
async fn run_channel_followup(
    state: Arc<AppState>,
    app: tauri::AppHandle,
    persona_id: String,
    persona_name: String,
    message_id: String,
    input_data: String,
    idempotency_key: String,
) {
    // Captured before `input_data` moves into the execution: the inbound
    // message text, for the living-agent channel episode minted on reply.
    let inbound_content: String = serde_json::from_str::<serde_json::Value>(&input_data)
        .ok()
        .and_then(|v| {
            v.get("content")
                .and_then(|c| c.as_str())
                .map(str::to_string)
        })
        .unwrap_or_default();

    let execution = crate::commands::execution::executions::execute_persona_inner(
        &state,
        app.clone(),
        persona_id.clone(),
        None,
        Some(input_data),
        None,
        None,
        Some(idempotency_key),
        false,
    )
    .await;

    let execution = match execution {
        Ok(exec) => exec,
        Err(e) => {
            record_failure(
                &state.db,
                &app,
                &persona_id,
                &persona_name,
                &message_id,
                &format!("run failed to start: {e}"),
            );
            return;
        }
    };

    // Bounded poll until the execution reaches a terminal state.
    // `build_reply_text` returns Ok(None) while queued/running, Ok(Some) on
    // completed/failed, Err on cancelled/vanished — the same contract the
    // Slack reply loop consumes.
    let deadline =
        tokio::time::Instant::now() + tokio::time::Duration::from_secs(REPLY_DEADLINE_SECS);
    loop {
        match crate::engine::channel_reply::build_reply_text(&state.db, &execution.id) {
            Ok(Some(text)) => {
                // Distinguish a real reply from a failure record: the row's
                // `extra` marks `{"failed":true}` so the conversation renders
                // it honestly. (A completed run's report — if the dispatch
                // wrote one — reaches the channel via the report lens; the
                // chat row carries only the short reply text.)
                let failed = execution_failed(&state.db, &execution.id);
                // OP-grammar + episode + self-model filing (WP3): the helper
                // strips any `propose_manifest_diff` line, mints the OPERATOR
                // episode, files surviving diffs behind the human gate, and
                // hands back the text the conversation should show. Log-only
                // throughout — none of it may affect the conversation.
                let visible = absorb_persona_reply(
                    &state.db,
                    &persona_id,
                    &persona_name,
                    &execution.id,
                    &message_id,
                    &inbound_content,
                    &text,
                    failed,
                );
                insert_persona_row(
                    &state.db,
                    &app,
                    &persona_id,
                    &persona_name,
                    &message_id,
                    &visible,
                    failed,
                );
                return;
            }
            Ok(None) => {
                if tokio::time::Instant::now() >= deadline {
                    record_failure(
                        &state.db,
                        &app,
                        &persona_id,
                        &persona_name,
                        &message_id,
                        "run did not finish within 30 minutes — check the execution log",
                    );
                    return;
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(REPLY_POLL_SECS)).await;
            }
            Err(e) => {
                record_failure(
                    &state.db,
                    &app,
                    &persona_id,
                    &persona_name,
                    &message_id,
                    &format!("run ended without a reply: {e}"),
                );
                return;
            }
        }
    }
}

/// The living-agent half of one operator-chat exchange (WP3):
///
/// 1. strip any `{"op":"propose_manifest_diff",...}` line from the reply
///    (Athena's OP-line pattern — the JSON is never shown to the operator);
/// 2. mint ONE episode for the exchange with role **`operator`** — this file
///    is the app's OWN operator chat (rows authored by the user from the
///    Personas UI, `author_id` NULL); the external bridges (Slack/Discord
///    pollers, team channels) have their own reply loops and stay `channel`;
/// 3. file surviving diffs through the manifest propose door, motivation
///    citing the conversation (the minted episode id + the message id).
///    Propose-only, human-gated, and skipped entirely when the episode mint
///    failed — a proposal without its grounding episode has no provenance.
///
/// Returns the text the chat row should carry. Best-effort throughout: an
/// episode or filing failure warns and never affects the conversation.
#[allow(clippy::too_many_arguments)]
fn absorb_persona_reply(
    pool: &crate::db::DbPool,
    persona_id: &str,
    persona_name: &str,
    execution_id: &str,
    message_id: &str,
    inbound_content: &str,
    text: &str,
    failed: bool,
) -> String {
    use crate::engine::persona_brain::growth;

    // A failure marker is an error message, never a reply carrying ops.
    let (visible, ops) = if failed {
        (text.to_string(), Vec::new())
    } else {
        growth::extract_manifest_diff_ops(text)
    };
    // A reply that was ONLY the op line still needs a visible record.
    let visible = if visible.trim().is_empty() && !ops.is_empty() {
        "_(persona filed a self-model proposal for review)_".to_string()
    } else {
        visible
    };

    let episode_body = format!("## User\n{inbound_content}\n\n## {persona_name}\n{visible}");
    match crate::engine::persona_brain::episodes::record(
        pool,
        persona_id,
        crate::engine::persona_brain::episodes::EpisodeRole::Operator,
        "channel",
        Some(execution_id),
        None,
        &episode_body,
    ) {
        Ok(episode_id) => {
            if !ops.is_empty() {
                match growth::file_channel_manifest_diffs(
                    pool,
                    persona_id,
                    &ops,
                    &episode_id,
                    message_id,
                ) {
                    Ok(Some(proposal_id)) => tracing::info!(
                        persona_id = %persona_id,
                        proposal_id = %proposal_id,
                        "persona channel: self-model diffs filed for review"
                    ),
                    Ok(None) => {}
                    Err(e) => tracing::warn!(
                        persona_id = %persona_id,
                        error = %e,
                        "persona channel: self-model diff filing failed (best-effort)"
                    ),
                }
            }
        }
        Err(e) => {
            tracing::warn!(
                persona_id = %persona_id,
                error = %e,
                dropped_ops = ops.len(),
                "persona channel: episode mint failed (best-effort); any reply ops dropped with it"
            );
        }
    }
    visible
}

fn execution_failed(pool: &crate::db::DbPool, execution_id: &str) -> bool {
    pool.get()
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT status FROM persona_executions WHERE id = ?1",
                params![execution_id],
                |r| r.get::<_, String>(0),
            )
            .ok()
        })
        .map(|s| s == "failed")
        .unwrap_or(false)
}

/// Insert a persona-authored chat row and announce it.
fn insert_persona_row(
    pool: &crate::db::DbPool,
    app: &tauri::AppHandle,
    persona_id: &str,
    persona_name: &str,
    reply_to: &str,
    body: &str,
    failed: bool,
) {
    let result = channel_repo::create_persona_channel_message(
        pool,
        channel_repo::CreatePersonaChannelMessageInput {
            id: None,
            persona_id: persona_id.to_string(),
            author_kind: "persona".into(),
            author_id: Some(persona_id.to_string()),
            author_label: Some(persona_name.to_string()),
            body: body.to_string(),
            reply_to: Some(reply_to.to_string()),
            failed,
        },
    );
    match result {
        Ok(_) => emit_event(
            app,
            event_name::PERSONA_CHANNEL_MESSAGE,
            &PersonaChannelMessageEvent {
                persona_id: persona_id.to_string(),
            },
        ),
        Err(e) => tracing::error!(
            persona_id = %persona_id,
            error = %e,
            "persona channel: failed to persist reply row"
        ),
    }
}

/// W4 §8 — failure is not empty success: the conversation records the death.
fn record_failure(
    pool: &crate::db::DbPool,
    app: &tauri::AppHandle,
    persona_id: &str,
    persona_name: &str,
    reply_to: &str,
    message: &str,
) {
    insert_persona_row(
        pool,
        app,
        persona_id,
        persona_name,
        reply_to,
        &format!("_(persona {message})_"),
        true,
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use rusqlite::Connection;

    const PERSONA: &str = "persona-1";

    fn seed_persona(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
             VALUES (?1, 'P', 'sp', datetime('now'), datetime('now'))",
            params![id],
        )
        .unwrap();
    }

    fn chat(conn: &Connection, id: &str, at: &str, author_kind: &str) {
        conn.execute(
            "INSERT INTO team_channel_messages
                (id, team_id, author_kind, body, consumer, created_at, persona_id)
             VALUES (?1, ?2, ?3, 'hello', 'display', ?4, ?5)",
            params![id, format!("persona:{PERSONA}"), author_kind, at, PERSONA],
        )
        .unwrap();
    }

    fn report(conn: &Connection, id: &str, at: &str, content: &str) {
        conn.execute(
            "INSERT INTO persona_reports (id, persona_id, execution_id, title, content, created_at)
             VALUES (?1, ?2, 'exec-1', 'Report', ?3, ?4)",
            params![id, PERSONA, content, at],
        )
        .unwrap();
    }

    fn execution(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO persona_executions (id, persona_id, status, created_at)
             VALUES (?1, ?2, 'completed', datetime('now'))",
            params![id, PERSONA],
        )
        .unwrap();
    }

    fn review(conn: &Connection, id: &str, at: &str, status: &str) {
        conn.execute(
            "INSERT INTO persona_manual_reviews
                (id, execution_id, persona_id, title, description, severity,
                 suggested_actions, status, created_at, updated_at)
             VALUES (?1, 'exec-1', ?2, 'Approve?', 'desc', 'warning',
                     '[\"approve\",\"reject\"]', ?3, ?4, ?4)",
            params![id, PERSONA, status, at],
        )
        .unwrap();
    }

    fn event(conn: &Connection, id: &str, at: &str, event_type: &str) {
        conn.execute(
            "INSERT INTO persona_events (id, event_type, source_type, source_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, event_type, format!("persona:{PERSONA}"), PERSONA, at],
        )
        .unwrap();
    }

    fn memory(conn: &Connection, id: &str, at: &str, importance: i32) {
        conn.execute(
            "INSERT INTO persona_memories
                (id, persona_id, title, content, importance, created_at, updated_at)
             VALUES (?1, ?2, 'learned', 'c', ?3, ?4, ?4)",
            params![id, PERSONA, importance, at],
        )
        .unwrap();
    }

    fn ids(items: &[PersonaChannelItem]) -> Vec<String> {
        items.iter().map(|i| i.id.clone()).collect()
    }

    /// All five sources blend into one feed ranked (at DESC, id DESC).
    #[test]
    fn union_blends_all_five_sources_in_order() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        seed_persona(&conn, PERSONA);
        execution(&conn, "exec-1");

        chat(&conn, "c1", "2026-08-20 10:00:04", "user");
        report(&conn, "r1", "2026-08-20 10:00:03", "short body");
        review(&conn, "v1", "2026-08-20 10:00:02", "pending");
        event(&conn, "e1", "2026-08-20 10:00:01", "task_completed");
        memory(&conn, "m1", "2026-08-20 10:00:00", 4);

        let items = read_persona_channel(&conn, PERSONA, Some(10), None, None, None).unwrap();
        assert_eq!(
            ids(&items),
            vec!["pch-c1", "prep-r1", "prev-v1", "pev-e1", "pmem-m1"]
        );
        let kinds: Vec<&str> = items.iter().map(|i| i.kind.as_str()).collect();
        assert_eq!(kinds, vec!["chat", "report", "review", "event", "memory"]);
    }

    /// The composite (at, id) cursor keeps siblings that share the boundary
    /// second — the exact regression the team channel's cursor exists for.
    #[test]
    fn composite_cursor_pages_across_a_shared_second() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        seed_persona(&conn, PERSONA);

        for i in 0..5 {
            chat(&conn, &format!("c{i}"), "2026-08-20 10:00:00", "user");
        }
        chat(&conn, "older", "2026-08-20 09:00:00", "user");

        let p1 = read_persona_channel(&conn, PERSONA, Some(2), None, None, None).unwrap();
        assert_eq!(ids(&p1), vec!["pch-c4", "pch-c3"]);

        let last = p1.last().unwrap();
        let p2 = read_persona_channel(
            &conn,
            PERSONA,
            Some(2),
            Some(&last.at),
            Some(&last.id),
            None,
        )
        .unwrap();
        assert_eq!(
            ids(&p2),
            vec!["pch-c2", "pch-c1"],
            "siblings in the boundary second must survive"
        );

        let last = p2.last().unwrap();
        let p3 = read_persona_channel(
            &conn,
            PERSONA,
            Some(2),
            Some(&last.at),
            Some(&last.id),
            None,
        )
        .unwrap();
        assert_eq!(ids(&p3), vec!["pch-c0", "pch-older"]);

        // Nothing lost, nothing served twice.
        let mut all = [ids(&p1), ids(&p2), ids(&p3)].concat();
        all.sort();
        all.dedup();
        assert_eq!(all.len(), 6);
    }

    /// Filtering to one lens spends the page budget on THAT lens (the
    /// starvation fix, inherited from the team channel).
    #[test]
    fn kind_filter_is_pushed_down() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        seed_persona(&conn, PERSONA);

        for i in 0..30 {
            chat(
                &conn,
                &format!("chatty{i:02}"),
                "2026-08-20 12:00:00",
                "user",
            );
        }
        memory(&conn, "m1", "2026-08-20 08:00:00", 5);

        let blended = read_persona_channel(&conn, PERSONA, Some(5), None, None, None).unwrap();
        assert!(blended.iter().all(|i| i.kind == "chat"));

        let kinds = vec!["memory".to_string()];
        let mem = read_persona_channel(&conn, PERSONA, Some(5), None, None, Some(&kinds)).unwrap();
        assert_eq!(ids(&mem), vec!["pmem-m1"]);
    }

    /// Report bodies are clamped to 600 chars, marked truncated, and carry
    /// the raw report id for the on-click full fetch.
    #[test]
    fn report_bodies_are_clamped_and_marked() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        seed_persona(&conn, PERSONA);

        let long = "x".repeat(1000);
        report(&conn, "big", "2026-08-20 10:00:01", &long);
        report(&conn, "small", "2026-08-20 10:00:00", "tiny");

        let kinds = vec!["report".to_string()];
        let items =
            read_persona_channel(&conn, PERSONA, Some(10), None, None, Some(&kinds)).unwrap();
        assert_eq!(ids(&items), vec!["prep-big", "prep-small"]);

        let big = &items[0];
        assert_eq!(big.body.as_ref().unwrap().chars().count(), 601); // 600 + ellipsis
        assert_eq!(big.extra.as_deref(), Some("{\"truncated\":true}"));
        assert_eq!(big.report_id.as_deref(), Some("big"));
        assert_eq!(big.execution_id.as_deref(), Some("exec-1"));

        let small = &items[1];
        assert_eq!(small.body.as_deref(), Some("tiny"));
        assert_eq!(small.extra, None);
    }

    /// Review rows carry severity + suggested_actions + status-in-extra, so
    /// resolved reviews render as records rather than vanishing.
    #[test]
    fn review_rows_carry_decision_surface_and_status() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        seed_persona(&conn, PERSONA);
        execution(&conn, "exec-1");
        review(&conn, "v1", "2026-08-20 10:00:00", "resolved");

        let kinds = vec!["review".to_string()];
        let items =
            read_persona_channel(&conn, PERSONA, Some(10), None, None, Some(&kinds)).unwrap();
        let v = &items[0];
        assert_eq!(v.review_id.as_deref(), Some("v1"));
        assert_eq!(v.severity.as_deref(), Some("warning"));
        assert_eq!(
            v.suggested_actions.as_deref(),
            Some("[\"approve\",\"reject\"]")
        );
        let extra: serde_json::Value = serde_json::from_str(v.extra.as_ref().unwrap()).unwrap();
        assert_eq!(extra["status"], "resolved");
    }

    /// Scoping: another persona's rows, team rows (persona_id NULL), and
    /// events with a non-persona source_type never leak in.
    #[test]
    fn channel_is_scoped_to_the_persona() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        seed_persona(&conn, PERSONA);
        seed_persona(&conn, "persona-2");

        chat(&conn, "mine", "2026-08-20 10:00:00", "user");
        // Another persona's chat row.
        conn.execute(
            "INSERT INTO team_channel_messages
                (id, team_id, author_kind, body, consumer, created_at, persona_id)
             VALUES ('theirs', 'persona:persona-2', 'user', 'b', 'display',
                     '2026-08-20 10:00:00', 'persona-2')",
            [],
        )
        .unwrap();
        // A real TEAM row: persona_id NULL.
        conn.execute(
            "INSERT INTO team_channel_messages
                (id, team_id, author_kind, body, consumer, created_at)
             VALUES ('team-row', 'team-1', 'user', 'b', 'inject', '2026-08-20 10:00:00')",
            [],
        )
        .unwrap();
        // An event whose source_id matches but whose source_type is not a
        // persona (polymorphic column — the predicate must hold both halves).
        event(&conn, "pe-mine", "2026-08-20 10:00:00", "artifact_created");
        conn.execute(
            "INSERT INTO persona_events (id, event_type, source_type, source_id, created_at)
             VALUES ('pe-trigger', 'fired', 'trigger', ?1, '2026-08-20 10:00:00')",
            params![PERSONA],
        )
        .unwrap();

        let items = read_persona_channel(&conn, PERSONA, Some(50), None, None, None).unwrap();
        assert_eq!(ids(&items), vec!["pev-pe-mine", "pch-mine"]);
    }

    /// The facet counts agree with the lenses they describe.
    #[test]
    fn counts_agree_with_lenses() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        seed_persona(&conn, PERSONA);
        execution(&conn, "exec-1");

        for i in 0..3 {
            chat(&conn, &format!("c{i}"), "2026-08-20 10:00:00", "user");
        }
        report(&conn, "r1", "2026-08-20 10:00:00", "body");
        review(&conn, "v1", "2026-08-20 10:00:00", "pending");
        event(&conn, "e1", "2026-08-20 10:00:00", "artifact_created");
        memory(&conn, "m1", "2026-08-20 10:00:00", 5);
        memory(&conn, "m2", "2026-08-20 10:00:00", 5);

        let counts = count_kinds(&conn, PERSONA).unwrap();
        for (kind, expected) in [
            ("chat", counts.chat),
            ("report", counts.report),
            ("review", counts.review),
            ("event", counts.event),
            ("memory", counts.memory),
        ] {
            let lens = read_persona_channel(
                &conn,
                PERSONA,
                Some(200),
                None,
                None,
                Some(&[kind.to_string()]),
            )
            .unwrap();
            assert_eq!(
                lens.len() as i64,
                expected,
                "count for '{kind}' must equal what its lens returns"
            );
        }
        assert_eq!(counts.chat, 3);
        assert_eq!(counts.memory, 2);
    }

    /// The W4 write path: repo insert sets the sentinel team_id + persona_id,
    /// honors a client id, reply threading survives the read-model (both ids
    /// `pch-`-prefixed), and the failure marker rides `extra`.
    #[test]
    fn persona_chat_write_path_round_trips() {
        let pool = init_test_db().unwrap();
        let conn = pool.get().unwrap();
        seed_persona(&conn, PERSONA);

        let (user_id, user_at) = channel_repo::create_persona_channel_message(
            &pool,
            channel_repo::CreatePersonaChannelMessageInput {
                id: Some("client-abc".into()),
                persona_id: PERSONA.into(),
                author_kind: "user".into(),
                author_id: None,
                author_label: None,
                body: "do the thing".into(),
                reply_to: None,
                failed: false,
            },
        )
        .unwrap();
        assert_eq!(user_id, "client-abc", "client id IS the row id");
        assert!(user_at.ends_with('Z'), "at is normalized RFC3339");

        let (reply_id, _) = channel_repo::create_persona_channel_message(
            &pool,
            channel_repo::CreatePersonaChannelMessageInput {
                id: None,
                persona_id: PERSONA.into(),
                author_kind: "persona".into(),
                author_id: Some(PERSONA.into()),
                author_label: Some("P".into()),
                body: "_(persona run failed: boom)_".into(),
                reply_to: Some(user_id.clone()),
                failed: true,
            },
        )
        .unwrap();

        // Sentinel + scope column both set.
        let (team_id, pid): (String, Option<String>) = conn
            .query_row(
                "SELECT team_id, persona_id FROM team_channel_messages WHERE id = ?1",
                params![user_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(team_id, format!("persona:{PERSONA}"));
        assert_eq!(pid.as_deref(), Some(PERSONA));

        let items = read_persona_channel(&conn, PERSONA, Some(10), None, None, None).unwrap();
        assert_eq!(items.len(), 2);
        let reply = items
            .iter()
            .find(|i| i.id == format!("pch-{reply_id}"))
            .unwrap();
        assert_eq!(reply.reply_to.as_deref(), Some("pch-client-abc"));
        assert_eq!(reply.author_kind, "persona");
        assert_eq!(reply.extra.as_deref(), Some("{\"failed\":true}"));

        // The user row is invisible to the TEAM read-model (sentinel team).
        let team_items = crate::commands::teams::team_channel::read_channel(
            &conn,
            "team-1",
            Some(10),
            None,
            None,
            None,
        )
        .unwrap();
        assert!(team_items.is_empty());
    }

    /// WP3 — the operator-chat exchange: role `operator` on the minted
    /// episode, OP line stripped from the visible reply, surviving self-model
    /// diffs filed as ONE pending proposal grounded in that episode.
    #[test]
    fn absorb_reply_mints_operator_episode_strips_op_line_and_files_diffs() {
        // PERSONAS_HOME is process-global — take the brain module's one
        // sanctioned lock (companion::brain::test_home) rather than racing it.
        let _home =
            crate::companion::brain::test_home::TestHome::new("persona_channel_absorb_reply");
        let pool = init_test_db().unwrap();
        {
            let conn = pool.get().unwrap();
            seed_persona(&conn, PERSONA);
        }

        let reply = "Good question — the digest is mine now.\n\
             {\"op\":\"propose_manifest_diff\",\"diffs\":[{\"section\":\"My work / What I own\",\"op\":\"append\",\"new_text\":\"the weekly digest (pep_chat)\"}],\"motivation\":\"operator confirmed it in chat\"}\n\
             I'll start Monday.";
        let visible = absorb_persona_reply(
            &pool,
            PERSONA,
            "P",
            "exec-1",
            "msg-1",
            "who owns the digest?",
            reply,
            false,
        );
        assert!(visible.contains("Good question"));
        assert!(visible.contains("I'll start Monday."));
        assert!(
            !visible.contains("propose_manifest_diff"),
            "the OP line never reaches the conversation"
        );

        // The episode: role operator (this file IS the operator chat), body
        // holds the STRIPPED exchange.
        let episodes = crate::db::repos::core::episodes::list_recent(&pool, PERSONA, 10).unwrap();
        assert_eq!(episodes.len(), 1);
        assert_eq!(episodes[0].role, "operator");
        assert_eq!(episodes[0].source, "channel");
        assert!(episodes[0].body_excerpt.contains("who owns the digest?"));
        assert!(!episodes[0].body_excerpt.contains("propose_manifest_diff"));

        // The proposal: one pending self_model_diff batch citing the episode.
        let raw_rows =
            crate::db::repos::core::memory_review_proposal::list(&pool, Some(PERSONA), true, 10)
                .unwrap();
        assert_eq!(raw_rows.len(), 1);
        assert_eq!(
            raw_rows[0].kind,
            crate::engine::persona_brain::manifest::KIND_SELF_MODEL_DIFF
        );
        let raw = crate::db::repos::core::memory_review_proposal::get_raw(&pool, &raw_rows[0].id)
            .unwrap()
            .unwrap();
        let payload: serde_json::Value = serde_json::from_str(&raw.proposal_json).unwrap();
        let rationale = payload["rationale"].as_str().unwrap();
        assert!(rationale.contains("operator confirmed it in chat"));
        assert!(
            rationale.contains(&episodes[0].id),
            "motivation cites the minted episode: {rationale}"
        );
        assert!(rationale.contains("msg-1"));
        // Propose-only: the manifest itself is untouched (never even seeded).
        assert!(crate::engine::persona_brain::manifest::read(PERSONA).is_none());
    }

    /// A failure marker is never parsed for ops, and a reply that was ONLY
    /// an op line still leaves a visible record.
    #[test]
    fn absorb_reply_failure_and_op_only_edges() {
        let _home =
            crate::companion::brain::test_home::TestHome::new("persona_channel_absorb_edges");
        let pool = init_test_db().unwrap();
        {
            let conn = pool.get().unwrap();
            seed_persona(&conn, PERSONA);
        }

        // failed=true: text passes through verbatim, nothing filed.
        let marker = "_(persona run failed: {\"op\":\"propose_manifest_diff\"} boom)_";
        let visible = absorb_persona_reply(&pool, PERSONA, "P", "exec-1", "m1", "in", marker, true);
        assert_eq!(visible, marker);

        // An op-only reply: the fallback line keeps the exchange visible.
        let op_only = "{\"op\":\"propose_manifest_diff\",\"diffs\":[{\"section\":\"My self-reads / Open questions\",\"op\":\"append\",\"new_text\":\"why do builds flake? (pep_x)\"}],\"motivation\":\"chat surfaced it\"}";
        let visible =
            absorb_persona_reply(&pool, PERSONA, "P", "exec-2", "m2", "in", op_only, false);
        assert_eq!(
            visible,
            "_(persona filed a self-model proposal for review)_"
        );
        assert_eq!(
            crate::db::repos::core::memory_review_proposal::count_pending_for_persona(
                &pool,
                PERSONA,
                crate::engine::persona_brain::manifest::KIND_SELF_MODEL_DIFF,
            )
            .unwrap(),
            1
        );
        // Both exchanges minted operator episodes.
        let episodes = crate::db::repos::core::episodes::list_recent(&pool, PERSONA, 10).unwrap();
        assert_eq!(episodes.len(), 2);
        assert!(episodes.iter().all(|e| e.role == "operator"));
    }
}
