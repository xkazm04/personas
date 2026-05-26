//! Discord inbound polling loop.
//!
//! Every `POLL_TICK_INTERVAL` seconds we sweep every enabled persona whose
//! `notification_channels` contains at least one `type: "discord"` entry with
//! `config.pollInbound == true` and `config.channelId` set. For each such
//! (persona, channel) we:
//!
//! 1. Read the cursor (`last_message_id`) from `discord_poll_state`.
//! 2. GET `https://discord.com/api/v10/channels/{channel_id}/messages?after={cursor}&limit=50`
//!    using the persona's Discord credential bot_token.
//! 3. For every message that's not from a bot and we haven't already logged in
//!    `discord_inbound_messages`, fire `execute_persona_inner` with input_data
//!    `{ source: "discord", channelId, messageId, author, content, ... }` and
//!    persist `(message_id, execution_id)` so replies can be posted later.
//! 4. Advance the cursor to the newest message id seen.
//!
//! After picking up new messages, we run a second pass that finds rows in
//! `discord_inbound_messages` with `execution_id IS NOT NULL` and
//! `replied_message_id IS NULL` whose persona_execution has finished, then
//! POSTs the execution's final output back to the same channel and records
//! the resulting message id.
//!
//! ## Why polling, not Gateway WebSocket
//!
//! Gateway is the right long-term answer (real-time, no rate-limit waste) but
//! polling is enough for the 1:1 test channel use case, has no external
//! dependency beyond the bot_token credential already in the vault, and
//! survives restarts trivially via the persisted cursor. The Gateway upgrade
//! path is to swap this module's `fetch_new_messages` for a WSS consumer that
//! pushes onto the same dispatch path.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value as JsonValue};
use tauri::AppHandle;

use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::credentials as credential_repo;
use crate::db::DbPool;
use crate::error::AppError;
use crate::notifications;
use crate::AppState;

/// Tick interval. 5s is the same cadence as `webhook_notifier`. Discord's
/// per-route rate limit for GET /channels/{id}/messages is 5 req/5s under
/// most token tiers, so one tick per channel comfortably fits.
pub const POLL_TICK_INTERVAL: Duration = Duration::from_secs(5);

/// HTTP timeout per Discord API request. Keep tight so a single hung GET
/// can't stall the whole tick.
const HTTP_TIMEOUT: Duration = Duration::from_secs(8);

/// Max messages fetched per (channel, tick). 50 is half Discord's hard limit
/// (100). Sized to absorb a chatty channel between ticks while staying inside
/// the route's burst budget.
const FETCH_LIMIT: u32 = 50;

/// Max replies attempted per tick. Bounds the outbound burst when a backlog
/// of finished executions piles up after a restart.
const MAX_REPLIES_PER_TICK: usize = 25;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Run the polling loop forever. Spawned from `lib.rs` startup.
pub async fn run_poller(pool: DbPool, app: AppHandle, state: Arc<AppState>) {
    // Grace period — same as webhook_notifier — so startup tracing finishes
    // before we start churning the DB.
    tokio::time::sleep(Duration::from_secs(10)).await;
    loop {
        // Leader-only (multi-driver orchestration, ADR 2026-05-26): the poller
        // fetches inbound Discord messages and dispatches persona runs that
        // reply back to the channel — two instances would double-reply. A
        // follower idles and resumes within one tick on promotion.
        if state.leadership.is_leader() {
            match tick(&pool, &app, &state).await {
                Ok(report) if report.picked + report.replied > 0 => {
                    tracing::debug!(
                        picked = report.picked,
                        replied = report.replied,
                        "discord_poller: tick complete"
                    );
                }
                Ok(_) => {}
                Err(e) => tracing::warn!(error = %e, "discord_poller tick failed"),
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

    // ── Pass 1: find personas with inbound Discord channels ───────────────
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
                crate::db::models::ChannelSpecV2Type::Discord
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
            let Some(channel_id) = config
                .get("channelId")
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
                    "discord_poller: channel poll failed"
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
            "Discord credential {} has no bot_token field",
            credential_id
        ))
    })?;

    let messages = fetch_new_messages(&bot_token, channel_id, cursor.as_deref()).await?;
    if messages.is_empty() {
        // Touch the polled-at timestamp so the UI can show liveness without
        // creating a row mutation when the cursor doesn't move.
        touch_cursor(pool, persona_id, channel_id)?;
        return Ok(0);
    }

    let mut dispatched = 0usize;
    let mut newest_id: Option<String> = cursor.clone();
    // Count non-bot messages whose content came back empty. If EVERY human
    // message in a fetch is empty, the bot almost certainly lacks the
    // privileged Message Content Intent — Discord strips `content` from
    // REST responses without it. We surface that as a warning instead of
    // silently doing nothing forever.
    let mut human_msgs = 0usize;
    let mut empty_human_msgs = 0usize;

    // Discord returns messages newest-first. Reverse so we dispatch in
    // chronological order — easier to read in logs and matches the order a
    // human watching the channel would see them.
    for msg in messages.into_iter().rev() {
        // Track newest seen regardless of whether we dispatch, so a bot's
        // own message still advances the cursor.
        if newest_id
            .as_deref()
            .map(|c| compare_snowflakes(&msg.id, c).is_gt())
            .unwrap_or(true)
        {
            newest_id = Some(msg.id.clone());
        }

        if msg.author_is_bot {
            continue;
        }
        human_msgs += 1;
        if msg.content.trim().is_empty() {
            // Either an attachment/sticker/embed-only message, or — if this
            // is true for every human message — a missing Message Content
            // Intent. The post-loop check below disambiguates.
            empty_human_msgs += 1;
            continue;
        }
        if message_already_logged(pool, &msg.id)? {
            continue;
        }

        let input_data = json!({
            "source": "discord",
            "channelId": channel_id,
            "messageId": msg.id,
            "author": {
                "id": msg.author_id,
                "username": msg.author_username,
            },
            "content": msg.content,
            "timestamp": msg.timestamp,
        });

        let idempotency_key = format!("discord:{}:{}", channel_id, msg.id);
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
            &msg.id,
            persona_id,
            channel_id,
            credential_id,
            &msg.author_id,
            execution_id.as_deref(),
            error.as_deref(),
        )?;

        if error.is_some() {
            tracing::warn!(
                persona_id = persona_id,
                channel_id = channel_id,
                message_id = %msg.id,
                error = ?error,
                "discord_poller: execute_persona_inner failed"
            );
        } else {
            dispatched += 1;
        }
    }

    if let Some(id) = newest_id {
        write_cursor(pool, persona_id, channel_id, &id)?;
    }

    // Every human message in this fetch had empty content — the bot is
    // almost certainly missing the privileged Message Content Intent.
    if human_msgs > 0 && empty_human_msgs == human_msgs {
        tracing::warn!(
            persona_id = persona_id,
            channel_id = channel_id,
            messages = human_msgs,
            "discord_poller: all {} user message(s) had empty content — enable the \
             Message Content Intent for this bot in the Discord Developer Portal \
             (Application → Bot → Privileged Gateway Intents), or the poller can \
             never see what users type",
            human_msgs,
        );
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
                    &row.message_id,
                    "credential missing bot_token at reply time",
                )?;
                continue;
            }
        };
        let reply_text = match build_reply_text(pool, &row.execution_id) {
            Ok(Some(t)) => t,
            Ok(None) => continue, // execution still running — leave for next tick
            Err(e) => {
                mark_reply_error(pool, &row.message_id, &e.to_string())?;
                continue;
            }
        };
        match post_reply(&bot_token, &row.channel_id, &row.message_id, &reply_text).await {
            Ok(reply_id) => {
                mark_replied(pool, &row.message_id, &reply_id)?;
                sent += 1;
            }
            Err(e) => mark_reply_error(pool, &row.message_id, &e.to_string())?,
        }
    }
    Ok(sent)
}

// ---------------------------------------------------------------------------
// Discord HTTP
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct DiscordMessage {
    id: String,
    content: String,
    author_id: String,
    author_username: String,
    author_is_bot: bool,
    timestamp: String,
}

async fn fetch_new_messages(
    bot_token: &str,
    channel_id: &str,
    after_id: Option<&str>,
) -> Result<Vec<DiscordMessage>, AppError> {
    let mut url = format!(
        "https://discord.com/api/v10/channels/{}/messages?limit={}",
        channel_id, FETCH_LIMIT
    );
    if let Some(id) = after_id.filter(|s| !s.is_empty()) {
        url.push_str(&format!("&after={}", id));
    }

    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client error: {e}")))?;

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bot {}", bot_token))
        .header("User-Agent", "Personas-Desktop/1.0 (Discord poller)")
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Discord GET messages failed: {e}")))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!(
            "Discord GET messages {}: {}",
            status,
            body.chars().take(300).collect::<String>()
        )));
    }

    let raw: Vec<JsonValue> = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Discord JSON decode failed: {e}")))?;

    let mut out = Vec::with_capacity(raw.len());
    for v in raw {
        let Some(id) = v.get("id").and_then(JsonValue::as_str) else { continue };
        let content = v
            .get("content")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        let author = v.get("author").cloned().unwrap_or(JsonValue::Null);
        let author_id = author
            .get("id")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        let author_username = author
            .get("username")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        let author_is_bot = author
            .get("bot")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false);
        let timestamp = v
            .get("timestamp")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        out.push(DiscordMessage {
            id: id.to_string(),
            content,
            author_id,
            author_username,
            author_is_bot,
            timestamp,
        });
    }
    Ok(out)
}

async fn post_reply(
    bot_token: &str,
    channel_id: &str,
    in_reply_to_message_id: &str,
    text: &str,
) -> Result<String, AppError> {
    let url = format!(
        "https://discord.com/api/v10/channels/{}/messages",
        channel_id
    );
    let body = json!({
        "content": truncate_for_discord(text),
        "message_reference": { "message_id": in_reply_to_message_id },
        "allowed_mentions": { "parse": [] },
    });

    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client error: {e}")))?;

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bot {}", bot_token))
        .header("User-Agent", "Personas-Desktop/1.0 (Discord poller)")
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Discord POST message failed: {e}")))?;

    let status = resp.status();
    let resp_body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Internal(format!(
            "Discord POST message {}: {}",
            status,
            resp_body.chars().take(300).collect::<String>()
        )));
    }
    let parsed: JsonValue = serde_json::from_str(&resp_body)
        .map_err(|e| AppError::Internal(format!("Discord POST decode failed: {e}")))?;
    let id = parsed
        .get("id")
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .to_string();
    Ok(id)
}

/// Discord caps message content at 2000 chars for unboosted bots. Truncate
/// with a marker so a long Claude reply doesn't 400 the whole post.
fn truncate_for_discord(text: &str) -> String {
    const LIMIT: usize = 1990; // leave headroom for the marker
    if text.chars().count() <= LIMIT {
        return text.to_string();
    }
    let mut out: String = text.chars().take(LIMIT).collect();
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
            "SELECT last_message_id FROM discord_poll_state
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
    message_id: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO discord_poll_state (persona_id, channel_id, last_message_id, last_polled_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(persona_id, channel_id) DO UPDATE SET
             last_message_id = excluded.last_message_id,
             last_polled_at = excluded.last_polled_at",
        params![persona_id, channel_id, message_id],
    )?;
    Ok(())
}

fn touch_cursor(pool: &DbPool, persona_id: &str, channel_id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO discord_poll_state (persona_id, channel_id, last_message_id, last_polled_at)
         VALUES (?1, ?2, '', datetime('now'))
         ON CONFLICT(persona_id, channel_id) DO UPDATE SET
             last_polled_at = excluded.last_polled_at",
        params![persona_id, channel_id],
    )?;
    Ok(())
}

fn message_already_logged(pool: &DbPool, message_id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM discord_inbound_messages WHERE message_id = ?1",
        params![message_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

#[allow(clippy::too_many_arguments)]
fn log_inbound_message(
    pool: &DbPool,
    message_id: &str,
    persona_id: &str,
    channel_id: &str,
    credential_id: &str,
    author_id: &str,
    execution_id: Option<&str>,
    error: Option<&str>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT OR IGNORE INTO discord_inbound_messages
             (message_id, persona_id, channel_id, credential_id, author_id, execution_id, error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            message_id,
            persona_id,
            channel_id,
            credential_id,
            author_id,
            execution_id,
            error,
        ],
    )?;
    Ok(())
}

#[derive(Debug)]
struct PendingReply {
    message_id: String,
    channel_id: String,
    credential_id: String,
    execution_id: String,
}

fn list_pending_replies(pool: &DbPool, limit: usize) -> Result<Vec<PendingReply>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT message_id, channel_id, credential_id, execution_id
         FROM discord_inbound_messages
         WHERE execution_id IS NOT NULL
           AND replied_message_id IS NULL
           AND error IS NULL
         ORDER BY received_at ASC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit as i64], |row| {
        Ok(PendingReply {
            message_id: row.get(0)?,
            channel_id: row.get(1)?,
            credential_id: row.get(2)?,
            execution_id: row.get(3)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

fn mark_replied(pool: &DbPool, message_id: &str, replied_message_id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE discord_inbound_messages
         SET replied_message_id = ?1, replied_at = datetime('now')
         WHERE message_id = ?2",
        params![replied_message_id, message_id],
    )?;
    Ok(())
}

fn mark_reply_error(pool: &DbPool, message_id: &str, error: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE discord_inbound_messages SET error = ?1 WHERE message_id = ?2",
        params![error, message_id],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Credential + execution helpers
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

/// Returns Ok(Some(text)) when the execution has finished and we have a body
/// to post, Ok(None) when it's still running, Err when the execution row is
/// missing or in a state we shouldn't reply for (cancelled, etc.).
fn build_reply_text(pool: &DbPool, execution_id: &str) -> Result<Option<String>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT status, output_data, error_message FROM persona_executions WHERE id = ?1",
            params![execution_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()?;
    let (status, output, error_message) = match row {
        Some(r) => r,
        None => {
            return Err(AppError::Validation(format!(
                "execution {} disappeared before reply",
                execution_id
            )))
        }
    };

    match status.as_str() {
        "completed" => {
            let text = output
                .as_deref()
                .map(extract_reply_from_output)
                .unwrap_or_default();
            let trimmed = text.trim();
            if trimmed.is_empty() {
                Ok(Some("_(persona produced no reply text)_".to_string()))
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        "failed" => Ok(Some(format!(
            "_(persona run failed: {})_",
            error_message
                .as_deref()
                .or(output.as_deref())
                .unwrap_or("unknown error")
                .chars()
                .take(200)
                .collect::<String>()
        ))),
        "cancelled" => Err(AppError::Validation(format!(
            "execution {} was cancelled",
            execution_id
        ))),
        _ => Ok(None), // queued/running — try again next tick
    }
}

/// Pull the user-facing reply text out of a persona execution's
/// `output_data`.
///
/// A persona with notification channels emits the **dispatch protocol** —
/// standalone JSON objects interleaved with prose: `{"user_message": {...}}`,
/// `{"agent_memory": {...}}`, `{"emit_event": {...}}`, etc. The reply we
/// want to post to Discord is `user_message.content`. So we scan the output
/// for every brace-delimited JSON object and return the first
/// `user_message.content` we find.
///
/// Falls back to legacy envelope keys (`reply`/`message`/`text`/...) and
/// finally the raw output, so a persona that just prints plain text still
/// works.
fn extract_reply_from_output(output: &str) -> String {
    if let Some(content) = find_protocol_user_message(output) {
        return content;
    }
    let trimmed = output.trim();
    if trimmed.starts_with('{') {
        if let Ok(v) = serde_json::from_str::<JsonValue>(trimmed) {
            for key in &["reply", "message", "text", "content", "result", "output"] {
                if let Some(s) = v.get(*key).and_then(JsonValue::as_str) {
                    if !s.trim().is_empty() {
                        return s.to_string();
                    }
                }
            }
        }
    }
    output.to_string()
}

/// Scan `output` for the first dispatch-protocol `user_message` block and
/// return its `content`. Walks every `{`-delimited JSON object (protocol
/// blocks are emitted as standalone objects, often multi-line).
fn find_protocol_user_message(output: &str) -> Option<String> {
    let bytes = output.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            if let Some(end) = match_json_object(bytes, i) {
                if let Ok(v) = serde_json::from_str::<JsonValue>(&output[i..=end]) {
                    if let Some(content) = v
                        .get("user_message")
                        .and_then(|um| um.get("content"))
                        .and_then(JsonValue::as_str)
                        .filter(|s| !s.trim().is_empty())
                    {
                        return Some(content.to_string());
                    }
                }
                i = end + 1;
                continue;
            }
        }
        i += 1;
    }
    None
}

/// Index of the `}` that closes the `{` at `start`, respecting JSON string
/// literals (so braces inside strings don't throw off the depth count).
fn match_json_object(bytes: &[u8], start: usize) -> Option<usize> {
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for (offset, &b) in bytes.iter().enumerate().skip(start) {
        if in_string {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
        } else {
            match b {
                b'"' => in_string = true,
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(offset);
                    }
                }
                _ => {}
            }
        }
    }
    None
}

/// Discord IDs are snowflake u64s; their natural string ordering only matches
/// numeric ordering when both strings are the same length. Compare numerically
/// so a 19-digit id is not treated as "less than" an 18-digit one.
fn compare_snowflakes(a: &str, b: &str) -> std::cmp::Ordering {
    match (a.parse::<u64>(), b.parse::<u64>()) {
        (Ok(an), Ok(bn)) => an.cmp(&bn),
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
    fn snowflake_compare_handles_different_lengths() {
        assert!(compare_snowflakes("1000000000000000000", "999999999999999999").is_gt());
        assert!(compare_snowflakes("100", "200").is_lt());
        assert!(compare_snowflakes("100", "100").is_eq());
    }

    #[test]
    fn truncate_for_discord_keeps_short_text() {
        assert_eq!(truncate_for_discord("hello"), "hello");
    }

    #[test]
    fn truncate_for_discord_caps_long_text() {
        let long = "x".repeat(3000);
        let out = truncate_for_discord(&long);
        assert!(out.ends_with("… (truncated)"));
        assert!(out.chars().count() <= 2000);
    }

    #[test]
    fn extract_reply_pulls_known_keys() {
        let envelope = r#"{"reply":"hi there"}"#;
        assert_eq!(extract_reply_from_output(envelope), "hi there");
        assert_eq!(extract_reply_from_output("plain text"), "plain text");
    }

    #[test]
    fn extract_reply_falls_back_when_no_known_key() {
        let envelope = r#"{"other":"foo"}"#;
        assert_eq!(extract_reply_from_output(envelope), envelope);
    }

    #[test]
    fn extract_reply_pulls_user_message_from_dispatch_protocol() {
        // Real-world shape: prose preamble, then standalone protocol blocks.
        let output = "I'll reply via the protocol output.\n\n\
            Here's my reply:\n\n\
            {\"user_message\": {\"title\": \"Reply\", \"content\": \"Hey! I'm your assistant.\", \"priority\": \"normal\"}}\n\n\
            {\"agent_memory\": {\"title\": \"note\", \"content\": \"something\", \"importance\": 3}}\n\n\
            {\"outcome_assessment\": {\"accomplished\": true}}";
        assert_eq!(
            extract_reply_from_output(output),
            "Hey! I'm your assistant.",
        );
    }

    #[test]
    fn extract_reply_handles_braces_inside_strings() {
        // A `}` inside the content string must not end the object early.
        let output =
            r#"{"user_message": {"content": "use {curly} braces like {this}"}}"#;
        assert_eq!(
            extract_reply_from_output(output),
            "use {curly} braces like {this}",
        );
    }
}
