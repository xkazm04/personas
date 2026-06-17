//! Slack inbound polling loop.
//!
//! The Slack analogue of `engine/discord_poller.rs`. Every `POLL_TICK_INTERVAL`
//! seconds we sweep every enabled persona whose `notification_channels`
//! contains at least one `type: "slack"` entry with `config.pollInbound == true`
//! and `config.channelId` set. For each such (persona, channel) we:
//!
//! 1. Read the cursor (`last_ts`) from `slack_poll_state`.
//! 2. GET `https://slack.com/api/conversations.history?channel={id}&oldest={ts}`
//!    using the persona's Slack credential bot_token.
//! 3. For every message that isn't from a bot and we haven't already logged in
//!    `slack_inbound_messages`, fire `execute_persona_inner` with input_data
//!    `{ source: "slack", channelId, messageId, author, content, ... }` and
//!    persist `(channel_id, message_ts)` so replies can be posted later.
//! 4. Advance the cursor to the newest `ts` seen.
//!
//! After picking up new messages, we run a second pass that finds rows in
//! `slack_inbound_messages` with `execution_id IS NOT NULL` and
//! `replied_message_ts IS NULL` whose persona_execution has finished, then
//! POSTs the execution's final output back to the same thread via
//! `chat.postMessage` and records the resulting message `ts`.
//!
//! ## Why polling, not the Events API / Socket Mode
//!
//! The Events API (push) is the right long-term answer, but polling is enough
//! for the 1:1 test-channel use case, needs no inbound HTTP endpoint or Socket
//! Mode connection (just the bot_token already in the vault), and survives
//! restarts trivially via the persisted cursor. The upgrade path is to swap
//! `fetch_new_messages` for a Socket Mode / Events consumer that pushes onto
//! the same dispatch path. As with Discord, a burst of more than `FETCH_LIMIT`
//! messages between two ticks can outrun the cursor; the realtime upgrade
//! removes that ceiling.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value as JsonValue};
use tauri::AppHandle;

use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::credentials as credential_repo;
use crate::db::DbPool;
use crate::engine::channel_reply::build_reply_text;
use crate::error::AppError;
use crate::notifications;
use crate::AppState;

/// Tick interval. 5s matches the Discord poller and `webhook_notifier`.
/// Slack's Web API Tier 3 (conversations.history) allows ~50 req/min, so one
/// GET per channel per 5s tick fits comfortably for a handful of channels.
pub const POLL_TICK_INTERVAL: Duration = Duration::from_secs(5);

/// HTTP timeout per Slack API request. Keep tight so a single hung GET can't
/// stall the whole tick.
const HTTP_TIMEOUT: Duration = Duration::from_secs(8);

/// Max messages fetched per (channel, tick). 50 absorbs a chatty channel
/// between ticks while staying well inside the rate budget.
const FETCH_LIMIT: u32 = 50;

/// Max replies attempted per tick. Bounds the outbound burst when a backlog of
/// finished executions piles up after a restart.
const MAX_REPLIES_PER_TICK: usize = 25;

/// Slack `text` hard-caps around 40000 chars in chat.postMessage. Truncate with
/// headroom so a long Claude reply doesn't error the whole post.
const SLACK_TEXT_LIMIT: usize = 39000;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Run the polling loop forever. Spawned from `lib.rs` startup.
pub async fn run_poller(pool: DbPool, app: AppHandle, state: Arc<AppState>) {
    // Grace period — same as the Discord poller — so startup tracing finishes
    // before we start churning the DB.
    tokio::time::sleep(Duration::from_secs(10)).await;
    loop {
        // Leader-only (multi-driver orchestration, ADR 2026-05-26): the poller
        // fetches inbound Slack messages and dispatches persona runs that reply
        // back to the channel — two instances would double-reply. A follower
        // idles and resumes within one tick on promotion.
        if state.leadership.is_leader() {
            match tick(&pool, &app, &state).await {
                Ok(report) if report.picked + report.replied > 0 => {
                    tracing::debug!(
                        picked = report.picked,
                        replied = report.replied,
                        "slack_poller: tick complete"
                    );
                }
                Ok(_) => {}
                Err(e) => tracing::warn!(error = %e, "slack_poller tick failed"),
            }
        }
        tokio::time::sleep(POLL_TICK_INTERVAL).await;
    }
}

#[derive(Debug, Default)]
struct TickReport {
    picked: usize,
    replied: usize,
}

async fn tick(pool: &DbPool, app: &AppHandle, state: &Arc<AppState>) -> Result<TickReport, AppError> {
    let mut report = TickReport::default();

    // ── Pass 1: find personas with inbound Slack channels ─────────────────
    let personas = persona_repo::get_enabled(pool)?;
    for persona in personas {
        let channels = match notifications::parse_channels_v2(persona.notification_channels.as_deref()) {
            Some(c) => c,
            None => continue,
        };

        for channel in channels {
            if !channel.enabled {
                continue;
            }
            if !matches!(
                channel.channel_type,
                crate::db::models::ChannelSpecV2Type::Slack
            ) {
                continue;
            }
            let Some(config) = channel.config.as_ref() else { continue };
            let poll_inbound = config
                .get("pollInbound")
                .and_then(JsonValue::as_bool)
                .or_else(|| config.get("poll_inbound").and_then(JsonValue::as_bool))
                .unwrap_or(false);
            if !poll_inbound {
                continue;
            }
            // The messaging picker stores the Slack channel id under `channel`
            // (DESTINATION_FIELDS slack key); accept channelId/channel_id too.
            let Some(channel_id) = config
                .get("channel")
                .or_else(|| config.get("channelId"))
                .or_else(|| config.get("channel_id"))
                .and_then(JsonValue::as_str)
                .map(str::to_owned)
            else { continue };
            let Some(credential_id) = channel.credential_id.as_deref() else { continue };

            match poll_channel(pool, app, state, &persona.id, &channel_id, credential_id).await {
                Ok(n) => report.picked += n,
                Err(e) => tracing::warn!(
                    persona_id = %persona.id,
                    channel_id = %channel_id,
                    error = %e,
                    "slack_poller: channel poll failed"
                ),
            }
        }
    }

    // ── Pass 2: post replies for finished executions ──────────────────────
    report.replied = process_pending_replies(pool).await?;

    Ok(report)
}

// ---------------------------------------------------------------------------
// Per-channel polling
// ---------------------------------------------------------------------------

async fn poll_channel(
    pool: &DbPool,
    app: &AppHandle,
    state: &Arc<AppState>,
    persona_id: &str,
    channel_id: &str,
    credential_id: &str,
) -> Result<usize, AppError> {
    let cursor = read_cursor(pool, persona_id, channel_id)?;

    let bot_token = load_bot_token(pool, credential_id).ok_or_else(|| {
        AppError::Validation(format!(
            "Slack credential {} has no bot_token field",
            credential_id
        ))
    })?;

    let messages = fetch_new_messages(&bot_token, channel_id, cursor.as_deref()).await?;
    if messages.is_empty() {
        // Touch the polled-at timestamp so the UI can show liveness without a
        // row mutation when the cursor doesn't move.
        touch_cursor(pool, persona_id, channel_id)?;
        return Ok(0);
    }

    let mut dispatched = 0usize;
    let mut newest_ts: Option<String> = cursor.clone();

    // Slack returns messages newest-first. Reverse so we dispatch in
    // chronological order — easier to read in logs and matches the order a
    // human watching the channel would see them.
    for msg in messages.into_iter().rev() {
        // Track newest seen regardless of whether we dispatch, so a bot's own
        // message still advances the cursor.
        if newest_ts
            .as_deref()
            .map(|c| compare_ts(&msg.ts, c).is_gt())
            .unwrap_or(true)
        {
            newest_ts = Some(msg.ts.clone());
        }

        // Skip anything authored by a bot/integration (our own replies carry a
        // bot_id) and system events (channel_join, etc. carry a subtype).
        // Normal user messages — top-level and thread replies — have neither.
        if msg.is_bot || msg.has_subtype {
            continue;
        }
        if msg.text.trim().is_empty() {
            continue;
        }
        if message_already_logged(pool, channel_id, &msg.ts)? {
            continue;
        }

        // Reply in-thread: thread under the message's existing thread root if
        // it's already a thread reply, otherwise start a thread on the message.
        let reply_thread_ts = if msg.thread_ts.is_empty() {
            msg.ts.clone()
        } else {
            msg.thread_ts.clone()
        };

        let input_data = json!({
            "source": "slack",
            "channelId": channel_id,
            "messageId": msg.ts,
            "author": {
                "id": msg.user,
            },
            "content": msg.text,
            "timestamp": msg.ts,
        });

        let idempotency_key = format!("slack:{}:{}", channel_id, msg.ts);
        let execution_result = crate::commands::execution::executions::execute_persona_inner(
            state,
            app.clone(),
            persona_id.to_string(),
            None,
            Some(input_data.to_string()),
            None,
            None,
            Some(idempotency_key),
            false,
        )
        .await;

        let (execution_id, error) = match execution_result {
            Ok(exec) => (Some(exec.id), None),
            Err(e) => (None, Some(e.to_string())),
        };

        log_inbound_message(
            pool,
            &msg.ts,
            channel_id,
            persona_id,
            credential_id,
            &msg.user,
            &reply_thread_ts,
            execution_id.as_deref(),
            error.as_deref(),
        )?;

        if error.is_some() {
            tracing::warn!(
                persona_id = persona_id,
                channel_id = channel_id,
                message_ts = %msg.ts,
                error = ?error,
                "slack_poller: execute_persona_inner failed"
            );
        } else {
            dispatched += 1;
        }
    }

    if let Some(ts) = newest_ts {
        write_cursor(pool, persona_id, channel_id, &ts)?;
    }

    Ok(dispatched)
}

// ---------------------------------------------------------------------------
// Reply pass
// ---------------------------------------------------------------------------

async fn process_pending_replies(pool: &DbPool) -> Result<usize, AppError> {
    let pending = list_pending_replies(pool, MAX_REPLIES_PER_TICK)?;
    if pending.is_empty() {
        return Ok(0);
    }
    let mut sent = 0usize;
    for row in pending {
        let bot_token = match load_bot_token(pool, &row.credential_id) {
            Some(t) => t,
            None => {
                mark_reply_error(
                    pool,
                    &row.channel_id,
                    &row.message_ts,
                    "credential missing bot_token at reply time",
                )?;
                continue;
            }
        };
        let reply_text = match build_reply_text(pool, &row.execution_id) {
            Ok(Some(t)) => t,
            Ok(None) => continue, // execution still running — leave for next tick
            Err(e) => {
                mark_reply_error(pool, &row.channel_id, &row.message_ts, &e.to_string())?;
                continue;
            }
        };
        match post_reply(&bot_token, &row.channel_id, &row.thread_ts, &reply_text).await {
            Ok(reply_ts) => {
                mark_replied(pool, &row.channel_id, &row.message_ts, &reply_ts)?;
                sent += 1;
            }
            Err(e) => mark_reply_error(pool, &row.channel_id, &row.message_ts, &e.to_string())?,
        }
    }
    Ok(sent)
}

// ---------------------------------------------------------------------------
// Slack HTTP
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct SlackMessage {
    ts: String,
    text: String,
    user: String,
    thread_ts: String,
    is_bot: bool,
    has_subtype: bool,
}

async fn fetch_new_messages(
    bot_token: &str,
    channel_id: &str,
    after_ts: Option<&str>,
) -> Result<Vec<SlackMessage>, AppError> {
    let mut url = format!(
        "https://slack.com/api/conversations.history?channel={}&limit={}",
        channel_id, FETCH_LIMIT
    );
    if let Some(ts) = after_ts.filter(|s| !s.is_empty()) {
        // `oldest` + `inclusive=false` returns only messages strictly newer
        // than the cursor.
        url.push_str(&format!("&oldest={}&inclusive=false", ts));
    }

    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client error: {e}")))?;

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", bot_token))
        .header("User-Agent", "Personas-Desktop/1.0 (Slack poller)")
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Slack conversations.history failed: {e}")))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!(
            "Slack conversations.history HTTP {}: {}",
            status,
            body.chars().take(300).collect::<String>()
        )));
    }

    let payload: JsonValue = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Slack JSON decode failed: {e}")))?;

    // Slack returns HTTP 200 with {"ok":false,"error":"..."} for most failures
    // (not_in_channel, missing_scope, invalid_auth, ...).
    if !payload.get("ok").and_then(JsonValue::as_bool).unwrap_or(false) {
        let err = payload
            .get("error")
            .and_then(JsonValue::as_str)
            .unwrap_or("unknown");
        return Err(AppError::Internal(format!(
            "Slack conversations.history not ok: {} (invite the bot to the channel \
             and grant channels:history / groups:history if this is not_in_channel / missing_scope)",
            err
        )));
    }

    // Burst detection: Slack returns the *newest* page within [oldest, now],
    // so when `has_more` is true a burst exceeded FETCH_LIMIT between ticks and
    // the messages older than this page are skipped once the cursor jumps to the
    // newest ts. That used to happen silently. Surface it loudly so the data
    // loss is diagnosable; the durable fix is the Socket Mode / Events realtime
    // consumer noted in the module docs.
    if payload
        .get("has_more")
        .and_then(JsonValue::as_bool)
        .unwrap_or(false)
    {
        tracing::warn!(
            channel_id = channel_id,
            fetch_limit = FETCH_LIMIT,
            "slack_poller: conversations.history has_more=true — a burst exceeded the per-tick \
             fetch limit; messages older than this page will be skipped as the cursor advances. \
             A realtime (Socket Mode / Events) consumer is the durable fix."
        );
    }

    let raw = payload
        .get("messages")
        .and_then(JsonValue::as_array)
        .cloned()
        .unwrap_or_default();

    let mut out = Vec::with_capacity(raw.len());
    for v in raw {
        let Some(ts) = v.get("ts").and_then(JsonValue::as_str) else { continue };
        let text = v
            .get("text")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        let user = v
            .get("user")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        let thread_ts = v
            .get("thread_ts")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        let is_bot = v.get("bot_id").is_some();
        let has_subtype = v.get("subtype").is_some();
        out.push(SlackMessage {
            ts: ts.to_string(),
            text,
            user,
            thread_ts,
            is_bot,
            has_subtype,
        });
    }
    Ok(out)
}

async fn post_reply(
    bot_token: &str,
    channel_id: &str,
    thread_ts: &str,
    text: &str,
) -> Result<String, AppError> {
    let url = "https://slack.com/api/chat.postMessage";
    let mut body = json!({
        "channel": channel_id,
        "text": truncate_for_slack(text),
    });
    if !thread_ts.is_empty() {
        body["thread_ts"] = json!(thread_ts);
    }

    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client error: {e}")))?;

    let resp = client
        .post(url)
        .header("Authorization", format!("Bearer {}", bot_token))
        .header("User-Agent", "Personas-Desktop/1.0 (Slack poller)")
        .header("Content-Type", "application/json; charset=utf-8")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Slack chat.postMessage failed: {e}")))?;

    let resp_body = resp.text().await.unwrap_or_default();
    let parsed: JsonValue = serde_json::from_str(&resp_body)
        .map_err(|e| AppError::Internal(format!("Slack chat.postMessage decode failed: {e}")))?;
    if !parsed.get("ok").and_then(JsonValue::as_bool).unwrap_or(false) {
        let err = parsed
            .get("error")
            .and_then(JsonValue::as_str)
            .unwrap_or("unknown");
        return Err(AppError::Internal(format!(
            "Slack chat.postMessage not ok: {}",
            err
        )));
    }
    let ts = parsed
        .get("ts")
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .to_string();
    Ok(ts)
}

/// Slack caps `text` around 40000 chars. Truncate with a marker so a long
/// Claude reply doesn't error the whole post.
fn truncate_for_slack(text: &str) -> String {
    if text.chars().count() <= SLACK_TEXT_LIMIT {
        return text.to_string();
    }
    let mut out: String = text.chars().take(SLACK_TEXT_LIMIT).collect();
    out.push_str("\n… (truncated)");
    out
}

// ---------------------------------------------------------------------------
// Cursor + log persistence
// ---------------------------------------------------------------------------

fn read_cursor(pool: &DbPool, persona_id: &str, channel_id: &str) -> Result<Option<String>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT last_ts FROM slack_poll_state
             WHERE persona_id = ?1 AND channel_id = ?2",
            params![persona_id, channel_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(row.filter(|s| !s.is_empty()))
}

fn write_cursor(
    pool: &DbPool,
    persona_id: &str,
    channel_id: &str,
    ts: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO slack_poll_state (persona_id, channel_id, last_ts, last_polled_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(persona_id, channel_id) DO UPDATE SET
             last_ts = excluded.last_ts,
             last_polled_at = excluded.last_polled_at",
        params![persona_id, channel_id, ts],
    )?;
    Ok(())
}

fn touch_cursor(pool: &DbPool, persona_id: &str, channel_id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO slack_poll_state (persona_id, channel_id, last_ts, last_polled_at)
         VALUES (?1, ?2, '', datetime('now'))
         ON CONFLICT(persona_id, channel_id) DO UPDATE SET
             last_polled_at = excluded.last_polled_at",
        params![persona_id, channel_id],
    )?;
    Ok(())
}

fn message_already_logged(pool: &DbPool, channel_id: &str, message_ts: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM slack_inbound_messages WHERE channel_id = ?1 AND message_ts = ?2",
        params![channel_id, message_ts],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

#[allow(clippy::too_many_arguments)]
fn log_inbound_message(
    pool: &DbPool,
    message_ts: &str,
    channel_id: &str,
    persona_id: &str,
    credential_id: &str,
    author_id: &str,
    thread_ts: &str,
    execution_id: Option<&str>,
    error: Option<&str>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT OR IGNORE INTO slack_inbound_messages
             (message_ts, channel_id, persona_id, credential_id, author_id, thread_ts, execution_id, error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            message_ts,
            channel_id,
            persona_id,
            credential_id,
            author_id,
            thread_ts,
            execution_id,
            error,
        ],
    )?;
    Ok(())
}

#[derive(Debug)]
struct PendingReply {
    message_ts: String,
    channel_id: String,
    credential_id: String,
    thread_ts: String,
    execution_id: String,
}

fn list_pending_replies(pool: &DbPool, limit: usize) -> Result<Vec<PendingReply>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT message_ts, channel_id, credential_id, thread_ts, execution_id
         FROM slack_inbound_messages
         WHERE execution_id IS NOT NULL
           AND replied_message_ts IS NULL
           AND error IS NULL
         ORDER BY received_at ASC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit as i64], |row| {
        Ok(PendingReply {
            message_ts: row.get(0)?,
            channel_id: row.get(1)?,
            credential_id: row.get(2)?,
            thread_ts: row.get(3)?,
            execution_id: row.get(4)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

fn mark_replied(
    pool: &DbPool,
    channel_id: &str,
    message_ts: &str,
    replied_message_ts: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE slack_inbound_messages
         SET replied_message_ts = ?1, replied_at = datetime('now')
         WHERE channel_id = ?2 AND message_ts = ?3",
        params![replied_message_ts, channel_id, message_ts],
    )?;
    Ok(())
}

fn mark_reply_error(
    pool: &DbPool,
    channel_id: &str,
    message_ts: &str,
    error: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE slack_inbound_messages SET error = ?1 WHERE channel_id = ?2 AND message_ts = ?3",
        params![error, channel_id, message_ts],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Credential helpers
// ---------------------------------------------------------------------------

fn load_bot_token(pool: &DbPool, credential_id: &str) -> Option<String> {
    let cred = credential_repo::get_by_id(pool, credential_id).ok()?;
    let fields: HashMap<String, String> = credential_repo::get_decrypted_fields(pool, &cred).ok()?;
    fields
        .get("bot_token")
        .or_else(|| fields.get("botToken"))
        .or_else(|| fields.get("token"))
        .filter(|s| !s.trim().is_empty())
        .cloned()
}

/// Slack message `ts` values are stringified Unix timestamps with microsecond
/// precision ("1716981234.123456"). Compare numerically so ordering is correct
/// regardless of string length.
fn compare_ts(a: &str, b: &str) -> std::cmp::Ordering {
    match (a.parse::<f64>(), b.parse::<f64>()) {
        (Ok(an), Ok(bn)) => an.partial_cmp(&bn).unwrap_or(std::cmp::Ordering::Equal),
        _ => a.cmp(b),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ts_compare_is_numeric_not_lexical() {
        // Lexically "1716981234.9" > "1716981234.10", but numerically it's <.
        assert!(compare_ts("1716981234.100000", "1716981234.090000").is_gt());
        assert!(compare_ts("1716981234.000100", "1716981234.000200").is_lt());
        assert!(compare_ts("1716981234.000100", "1716981234.000100").is_eq());
        // Whole-second rollover.
        assert!(compare_ts("1716981235.000000", "1716981234.999999").is_gt());
    }

    #[test]
    fn truncate_for_slack_keeps_short_text() {
        assert_eq!(truncate_for_slack("hello"), "hello");
    }

    #[test]
    fn truncate_for_slack_caps_long_text() {
        let long = "x".repeat(50000);
        let out = truncate_for_slack(&long);
        assert!(out.ends_with("… (truncated)"));
        assert!(out.chars().count() <= SLACK_TEXT_LIMIT + 16);
    }
}
