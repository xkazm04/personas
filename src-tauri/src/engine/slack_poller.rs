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
//! ## Two kinds of inbound channel (the bridge fork)
//!
//! The sweep above is the ORIGINAL path and still serves plain Slack
//! notification channels unchanged. A spec that additionally carries the
//! `teamBridge` discriminator (see `engine/slack_bridge.rs`) is a TEAM channel
//! bridge and takes a different branch entirely: its messages become
//! `team_channel_messages` rows with `author_kind = 'slack'` and
//! `consumer = 'inject'` — Slack participants DRIVE the team, reaching its
//! personas at the next step boundary like an operator directive — and no
//! execution is dispatched, so no threaded reply is owed either (the outbound
//! half, `engine/team_slack_relay.rs`, carries the team's side back).
//!
//! The fork is strictly on the discriminator, so wiring a bridge cannot change
//! what an existing notification channel does.
//!
//! ## Why polling, not the Events API / Socket Mode
//!
//! The Events API (push) is the right long-term answer, but polling is enough
//! for the 1:1 test-channel use case, needs no inbound HTTP endpoint or Socket
//! Mode connection (just the bot_token already in the vault), and survives
//! restarts trivially via the persisted cursor. The upgrade path is to swap
//! `fetch_new_messages` for a Socket Mode / Events consumer that pushes onto
//! the same dispatch path. A burst of more than `FETCH_LIMIT` messages between
//! two ticks is drained by paging `conversations.history` backward (via
//! `latest`) before the cursor advances, up to `MAX_DRAIN_PAGES`; the realtime
//! upgrade removes that per-tick ceiling entirely.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value as JsonValue};
use tauri::AppHandle;

use crate::db::models::CreateChannelMessageInput;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::credentials as credential_repo;
use crate::db::repos::resources::team_channel as channel_repo;
use crate::db::DbPool;
use crate::engine::channel_reply::build_reply_text;
use crate::engine::slack_bridge::{self, TeamBridgeSpec, SLACK_AUTHOR_KIND};
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

/// Max `conversations.history` pages drained in one tick when a burst exceeds
/// `FETCH_LIMIT`. Bounds the backward walk so a pathological channel can't spin
/// the tick forever: up to `MAX_DRAIN_PAGES * FETCH_LIMIT` (= 1000) messages are
/// pulled per tick, beyond which the oldest stragglers fall to the next tick. A
/// 5s tick draining 1000 messages already far exceeds Slack's rate limits and
/// any realistic human channel, so this is a safety valve, not an expected path.
const MAX_DRAIN_PAGES: usize = 20;

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
                Ok(report) if report.picked + report.replied + report.ingested > 0 => {
                    tracing::debug!(
                        picked = report.picked,
                        replied = report.replied,
                        ingested = report.ingested,
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
    /// Messages written into a team channel by the bridge fork (WP2). Counted
    /// apart from `picked` because no execution was dispatched for them.
    ingested: usize,
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

            // ── Bridge fork ───────────────────────────────────────────────
            // A spec carrying the `teamBridge` discriminator (see
            // `engine/slack_bridge.rs`) is a TEAM channel bridge: its inbound
            // messages become `team_channel_messages` rows, NOT persona
            // executions. Everything below this fork is the pre-existing
            // notification-channel path and must stay byte-identical — a plain
            // Slack channel with `pollInbound` on keeps firing executions.
            if let Some(bridge) = slack_bridge::parse_bridge(&persona.id, &channel) {
                match ingest_bridge_channel(pool, &bridge).await {
                    Ok(n) => report.ingested += n,
                    Err(e) => tracing::warn!(
                        bridge = %bridge.key(),
                        error = %e,
                        "slack_poller: bridge ingest failed"
                    ),
                }
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
// Bridge ingest (WP2) — Slack message -> team_channel_messages
// ---------------------------------------------------------------------------
//
// A bridged channel does NOT execute a persona per message. Slack participants
// drive the team the way the operator does: their message lands in
// `team_channel_messages` with `consumer = 'inject'`, so it reaches the team's
// personas at the next step boundary exactly like a directive. The bridge's job
// is therefore ingestion + identity, not dispatch.
//
// Bookkeeping reuses the poller's existing tables verbatim: `slack_poll_state`
// for the cursor and `slack_inbound_messages` (PK channel_id+message_ts) for
// dedup. Bridge rows carry the carrier persona in `persona_id` and leave
// `execution_id` NULL — which also keeps them out of `list_pending_replies`,
// so the reply pass never tries to answer a bridged message (the OUTBOUND relay
// is what carries the team's side back to Slack).

/// Per-bridge consecutive-failure breaker. Same shape and rationale as
/// `team_slack_relay`'s: the poller owns no long-lived struct, and a
/// permanently broken channel (bot removed, token revoked, channel archived)
/// would otherwise be re-hit every 5s forever with nothing but a `warn!` to
/// show for it. In-memory only — a restart re-probes every bridge.
const BRIDGE_FAILURE_THRESHOLD: u32 = 5;
const BRIDGE_PROBE_EVERY: u32 = 12;

static BRIDGE_FAILURES: LazyLock<Mutex<HashMap<String, u32>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn breaker_lock() -> std::sync::MutexGuard<'static, HashMap<String, u32>> {
    BRIDGE_FAILURES.lock().unwrap_or_else(|poisoned| {
        tracing::warn!(
            "slack_poller bridge breaker mutex poisoned; recovering inner data after a \
             prior panic held this lock"
        );
        poisoned.into_inner()
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BreakerAction {
    /// Healthy: poll normally.
    Poll,
    /// Broken but due for a recovery probe: try one poll.
    Probe,
    /// Broken and not a probe: skip this bridge entirely this tick.
    Skip,
}

fn breaker_decide(key: &str) -> BreakerAction {
    let count = breaker_lock().get(key).copied().unwrap_or(0);
    if count < BRIDGE_FAILURE_THRESHOLD {
        BreakerAction::Poll
    } else if (count - BRIDGE_FAILURE_THRESHOLD) % BRIDGE_PROBE_EVERY == 0 {
        BreakerAction::Probe
    } else {
        BreakerAction::Skip
    }
}

/// Record a poll result. Returns `true` if the bridge is now considered broken.
fn breaker_record(key: &str, ok: bool) -> bool {
    let mut map = breaker_lock();
    if ok {
        map.remove(key);
        false
    } else {
        let count = map.entry(key.to_string()).or_insert(0);
        *count = count.saturating_add(1);
        *count >= BRIDGE_FAILURE_THRESHOLD
    }
}

/// Advance the probe cadence for a broken bridge whose tick we skipped.
fn breaker_note_skip(key: &str) {
    let mut map = breaker_lock();
    let count = map.entry(key.to_string()).or_insert(BRIDGE_FAILURE_THRESHOLD);
    *count = count.saturating_add(1);
}

/// Our own Slack bot user id per credential (`auth.test`), and resolved display
/// names per `credential:user` (`users.info`). Both are process-lifetime caches:
/// a workspace's bot identity never changes, and a display name changing
/// mid-session is not worth an API call per message.
static BOT_USER_IDS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static DISPLAY_NAMES: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn cache_get(cache: &Mutex<HashMap<String, String>>, key: &str) -> Option<String> {
    cache.lock().ok()?.get(key).cloned()
}

fn cache_put(cache: &Mutex<HashMap<String, String>>, key: &str, value: &str) {
    if let Ok(mut map) = cache.lock() {
        map.insert(key.to_string(), value.to_string());
    }
}

/// `GET`-shaped Slack Web API call returning the decoded body, erroring on both
/// HTTP failure and Slack's `{"ok": false}` 200s.
async fn slack_get(bot_token: &str, url: &str) -> Result<JsonValue, AppError> {
    let resp = shared_http_client()
        .get(url)
        .header("Authorization", format!("Bearer {}", bot_token))
        .header("User-Agent", "Personas-Desktop/1.0 (Slack poller)")
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Slack GET failed: {e}")))?;
    let payload: JsonValue = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Slack JSON decode failed: {e}")))?;
    if !payload.get("ok").and_then(JsonValue::as_bool).unwrap_or(false) {
        let err = payload
            .get("error")
            .and_then(JsonValue::as_str)
            .unwrap_or("unknown");
        return Err(AppError::Internal(format!("Slack API not ok: {err}")));
    }
    Ok(payload)
}

/// Our own bot user id for this credential — the echo guard's other half.
///
/// `slack_bridge::is_echo` stops team rows that CAME from Slack from being
/// relayed back out; this stops the messages the relay POSTed from being read
/// back in. Without it a single bridged message ping-pongs forever.
/// `auth.test` is the same endpoint the Slack connector healthcheck uses.
async fn resolve_bot_user_id(bot_token: &str, credential_id: &str) -> Result<String, AppError> {
    if let Some(cached) = cache_get(&BOT_USER_IDS, credential_id) {
        return Ok(cached);
    }
    let payload = slack_get(bot_token, "https://slack.com/api/auth.test").await?;
    let user_id = payload
        .get("user_id")
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .to_string();
    if user_id.is_empty() {
        return Err(AppError::Internal(
            "Slack auth.test returned no user_id; cannot guard against echoing our own posts"
                .into(),
        ));
    }
    cache_put(&BOT_USER_IDS, credential_id, &user_id);
    Ok(user_id)
}

/// Human display name for a Slack user id. Falls back to the id itself: an
/// unresolvable name must never cost us the message.
async fn resolve_display_name(bot_token: &str, credential_id: &str, user_id: &str) -> String {
    if user_id.is_empty() {
        return String::new();
    }
    let key = format!("{credential_id}:{user_id}");
    if let Some(cached) = cache_get(&DISPLAY_NAMES, &key) {
        return cached;
    }
    let url = format!("https://slack.com/api/users.info?user={user_id}");
    let name = match slack_get(bot_token, &url).await {
        Ok(payload) => {
            let user = payload.get("user");
            let profile = user.and_then(|u| u.get("profile"));
            ["display_name", "real_name"]
                .iter()
                .find_map(|k| {
                    profile
                        .and_then(|p| p.get(*k))
                        .and_then(JsonValue::as_str)
                        .filter(|s| !s.trim().is_empty())
                })
                .or_else(|| {
                    user.and_then(|u| u.get("name"))
                        .and_then(JsonValue::as_str)
                        .filter(|s| !s.trim().is_empty())
                })
                .unwrap_or(user_id)
                .to_string()
        }
        Err(e) => {
            tracing::debug!(
                user_id = user_id,
                error = %e,
                "slack_poller: users.info failed; falling back to the raw Slack user id"
            );
            user_id.to_string()
        }
    };
    cache_put(&DISPLAY_NAMES, &key, &name);
    name
}

/// Should this Slack message become a team channel row?
///
/// Pure so the four drop reasons — our own bot, any other bot/integration,
/// join/leave/system subtypes, empty text — are testable without HTTP. Dedup is
/// NOT decided here: it needs the DB.
fn should_ingest(msg: &SlackMessage, bot_user_id: &str) -> bool {
    if msg.is_bot || msg.has_subtype {
        return false;
    }
    // Our own posts come back through conversations.history. They usually carry
    // a bot_id (caught above), but a token posting as a user would not.
    if !bot_user_id.is_empty() && msg.user == bot_user_id {
        return false;
    }
    !msg.text.trim().is_empty()
}

/// Ingest one bridged channel, gated by the per-bridge breaker.
async fn ingest_bridge_channel(
    pool: &DbPool,
    bridge: &TeamBridgeSpec,
) -> Result<usize, AppError> {
    let key = bridge.key();
    if breaker_decide(&key) == BreakerAction::Skip {
        breaker_note_skip(&key);
        return Ok(0);
    }
    let result = ingest_bridge_inner(pool, bridge).await;
    let now_broken = breaker_record(&key, result.is_ok());
    if let Err(e) = &result {
        tracing::warn!(
            bridge = %key,
            now_broken,
            error = %e,
            "slack_poller: bridge poll failed; backing this channel off"
        );
    }
    result
}

async fn ingest_bridge_inner(
    pool: &DbPool,
    bridge: &TeamBridgeSpec,
) -> Result<usize, AppError> {
    let persona_id = &bridge.persona_id;
    let channel_id = &bridge.slack_channel_id;

    let bot_token = load_bot_token(pool, &bridge.credential_id).ok_or_else(|| {
        AppError::Validation(format!(
            "Slack credential {} has no bot_token field",
            bridge.credential_id
        ))
    })?;
    let bot_user_id = resolve_bot_user_id(&bot_token, &bridge.credential_id).await?;

    let cursor = read_cursor(pool, persona_id, channel_id)?;
    let messages = fetch_new_messages(&bot_token, channel_id, cursor.as_deref()).await?;
    if messages.is_empty() {
        touch_cursor(pool, persona_id, channel_id)?;
        return Ok(0);
    }

    // Chronological, matching the execution path: Slack returns newest-first.
    let ordered: Vec<SlackMessage> = messages.into_iter().rev().collect();

    // The cursor advances past dropped messages too — a bot post or a join
    // event is decided, not deferred — so compute it over the WHOLE page.
    let newest = newest_ts(&ordered, cursor.as_deref());

    let selected = select_ingestable(pool, channel_id, &ordered, &bot_user_id)?;

    // Names are resolved only for messages that will actually land, so a
    // channel full of bot noise costs no users.info calls.
    let mut pairs: Vec<(SlackMessage, String)> = Vec::with_capacity(selected.len());
    for msg in selected {
        let name = resolve_display_name(&bot_token, &bridge.credential_id, &msg.user).await;
        pairs.push((msg, name));
    }

    let ingested = persist_bridge_messages(pool, bridge, &pairs)?;

    if let Some(ts) = newest {
        write_cursor(pool, persona_id, channel_id, &ts)?;
    }

    Ok(ingested)
}

/// Newest `ts` across a page, never regressing below the existing cursor.
fn newest_ts(messages: &[SlackMessage], cursor: Option<&str>) -> Option<String> {
    let mut newest = cursor.map(str::to_string);
    for msg in messages {
        if newest
            .as_deref()
            .map(|c| compare_ts(&msg.ts, c).is_gt())
            .unwrap_or(true)
        {
            newest = Some(msg.ts.clone());
        }
    }
    newest
}

/// The messages from one page that should become team channel rows: everything
/// [`should_ingest`] accepts and `slack_inbound_messages` has not already seen.
fn select_ingestable(
    pool: &DbPool,
    channel_id: &str,
    messages: &[SlackMessage],
    bot_user_id: &str,
) -> Result<Vec<SlackMessage>, AppError> {
    let mut out = Vec::new();
    for msg in messages {
        if !should_ingest(msg, bot_user_id) {
            continue;
        }
        if message_already_logged(pool, channel_id, &msg.ts)? {
            continue;
        }
        out.push(msg.clone());
    }
    Ok(out)
}

/// Write the selected messages into the bridged team's channel and log each one
/// as seen. Returns how many landed.
///
/// `consumer = 'inject'` is the whole point: a Slack participant reaches the
/// team's personas at the next step boundary, exactly like an operator
/// directive. `addressed_to = None` = the whole team.
fn persist_bridge_messages(
    pool: &DbPool,
    bridge: &TeamBridgeSpec,
    pairs: &[(SlackMessage, String)],
) -> Result<usize, AppError> {
    let mut ingested = 0usize;
    for (msg, display_name) in pairs {
        let write = channel_repo::create_external(
            pool,
            CreateChannelMessageInput {
                team_id: bridge.team_id.clone(),
                author_kind: SLACK_AUTHOR_KIND.to_string(),
                author_id: Some(msg.user.clone()).filter(|s| !s.is_empty()),
                body: msg.text.clone(),
                addressed_to: None,
                reply_to: None,
                assignment_id: None,
                consumer: Some("inject".into()),
            },
            display_name,
        );
        let error = match write {
            Ok(_) => {
                ingested += 1;
                None
            }
            Err(e) => Some(e.to_string()),
        };

        let thread_ts = if msg.thread_ts.is_empty() {
            msg.ts.clone()
        } else {
            msg.thread_ts.clone()
        };

        // Logged either way: this row IS the dedup key, so recording a failed
        // write as seen is deliberate — retrying a body SQLite rejected would
        // fail identically every tick.
        log_inbound_message(
            pool,
            &msg.ts,
            &bridge.slack_channel_id,
            &bridge.persona_id,
            &bridge.credential_id,
            &msg.user,
            &thread_ts,
            None, // no execution: bridged messages drive the team, not a run
            error.as_deref(),
        )?;

        if let Some(err) = &error {
            tracing::warn!(
                bridge = %bridge.key(),
                message_ts = %msg.ts,
                error = %err,
                "slack_poller: bridge message could not be written to the team channel"
            );
        }
    }
    Ok(ingested)
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

/// Fetch a single `conversations.history` page. `oldest`/`latest` bound the
/// window as Unix-ts strings; when either is set we pass `inclusive=false` so
/// both boundary messages are excluded — the cursor (`oldest`) and the previous
/// page's edge (`latest`) are never re-returned. Messages come back in Slack's
/// native newest-first order, paired with `has_more`.
async fn fetch_history_page(
    client: &reqwest::Client,
    bot_token: &str,
    channel_id: &str,
    oldest: Option<&str>,
    latest: Option<&str>,
) -> Result<(Vec<SlackMessage>, bool), AppError> {
    let mut url = format!(
        "https://slack.com/api/conversations.history?channel={}&limit={}",
        channel_id, FETCH_LIMIT
    );
    let mut bounded = false;
    if let Some(ts) = oldest.filter(|s| !s.is_empty()) {
        url.push_str(&format!("&oldest={}", ts));
        bounded = true;
    }
    if let Some(ts) = latest.filter(|s| !s.is_empty()) {
        url.push_str(&format!("&latest={}", ts));
        bounded = true;
    }
    if bounded {
        // Strictly-between semantics: never re-return the cursor (oldest) or the
        // prior page's oldest message (latest).
        url.push_str("&inclusive=false");
    }

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

    let has_more = payload
        .get("has_more")
        .and_then(JsonValue::as_bool)
        .unwrap_or(false);

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
    Ok((out, has_more))
}

/// Numerically-oldest `ts` in a page (Slack `ts` ordering is not lexical, so we
/// compare via `compare_ts`).
fn page_min_ts(msgs: &[SlackMessage]) -> Option<String> {
    msgs.iter()
        .map(|m| m.ts.clone())
        .min_by(|a, b| compare_ts(a, b))
}

/// One shared connection-pooled client for the whole poller. Building a fresh
/// Client per poll/reply (on a 5-second loop) re-established TLS connections
/// and threw away the pool every tick.
fn shared_http_client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(HTTP_TIMEOUT)
            .build()
            .expect("failed to build Slack HTTP client")
    })
}

async fn fetch_new_messages(
    bot_token: &str,
    channel_id: &str,
    after_ts: Option<&str>,
) -> Result<Vec<SlackMessage>, AppError> {
    let client = shared_http_client();

    let after_ts = after_ts.filter(|s| !s.is_empty());

    // First page: the newest FETCH_LIMIT messages within (after_ts, now].
    let (mut all, mut has_more) =
        fetch_history_page(client, bot_token, channel_id, after_ts, None).await?;

    // Steady state (<= FETCH_LIMIT new messages this tick) → single page, done.
    // First poll (no cursor) → take only the newest page and let the cursor jump
    // to its newest ts, exactly as before: we deliberately do NOT replay the
    // channel's entire backlog on first connect, which an unbounded drain would.
    if !has_more || after_ts.is_none() {
        return Ok(all);
    }

    // Burst path: a cursor exists and the channel overflowed FETCH_LIMIT between
    // ticks. `conversations.history` returns the *newest* page within
    // [oldest, now], so advancing the cursor to that page's newest ts would
    // strand every message between the cursor and this page — the silent data
    // loss this fixes. Drain the gap instead: walk `latest` down to each page's
    // oldest ts (exclusive) until the whole (after_ts, now] range is pulled, then
    // the caller advances the cursor to the true newest ts of the drained set.
    // `latest` strictly decreases each iteration so the loop terminates naturally
    // once the range is exhausted; `MAX_DRAIN_PAGES` is the hard backstop against
    // an unbounded walk. Any boundary/overlap re-fetch is deduped downstream by
    // `message_already_logged` + `INSERT OR IGNORE` + the per-message
    // idempotency_key, so a message is never dispatched twice.
    let mut pages = 1usize;
    let mut frontier = page_min_ts(&all);
    while has_more && pages < MAX_DRAIN_PAGES {
        let Some(latest) = frontier.clone() else { break };
        let (page, more) =
            fetch_history_page(client, bot_token, channel_id, after_ts, Some(&latest)).await?;
        has_more = more;
        if page.is_empty() {
            break;
        }
        frontier = page_min_ts(&page);
        all.extend(page);
        pages += 1;
    }

    // Only reachable for a burst beyond MAX_DRAIN_PAGES * FETCH_LIMIT messages in
    // a single tick — past Slack's rate limits and any human channel. Surface it
    // loudly; the durable fix is the Socket Mode / Events realtime consumer.
    if has_more {
        tracing::warn!(
            channel_id = channel_id,
            drained_pages = pages,
            drained_messages = all.len(),
            "slack_poller: conversations.history still has_more after draining the per-tick \
             page cap; the oldest messages of an extreme burst will be skipped as the cursor \
             advances. A realtime (Socket Mode / Events) consumer is the durable fix."
        );
    }

    Ok(all)
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

    let client = shared_http_client();

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

    fn msg(ts: &str) -> SlackMessage {
        SlackMessage {
            ts: ts.to_string(),
            text: String::new(),
            user: String::new(),
            thread_ts: String::new(),
            is_bot: false,
            has_subtype: false,
        }
    }

    #[test]
    fn page_min_ts_picks_numerically_oldest_for_backward_drain() {
        // The drain steps `latest` to each page's oldest ts; that edge must be
        // the numerically-smallest, not the lexically-smallest, or the next page
        // would overlap or skip. "1716981234.9" is lexically < "...234.10".
        let page = vec![
            msg("1716981234.090000"),
            msg("1716981234.100000"),
            msg("1716981234.030000"),
        ];
        assert_eq!(page_min_ts(&page).as_deref(), Some("1716981234.030000"));
        assert_eq!(page_min_ts(&[]), None);
    }

    // -----------------------------------------------------------------------
    // Bridge fork (WP2)
    // -----------------------------------------------------------------------

    use crate::db::models::{ChannelScopeV2, ChannelSpecV2, ChannelSpecV2Type};
    use serde_json::json;

    const BOT: &str = "UBOT";
    const TEAM: &str = "team-1";

    fn spec(config: serde_json::Value) -> ChannelSpecV2 {
        ChannelSpecV2 {
            channel_type: ChannelSpecV2Type::Slack,
            enabled: true,
            credential_id: Some("cred-1".into()),
            use_case_ids: ChannelScopeV2::All("*".into()),
            event_filter: None,
            config: Some(config),
        }
    }

    fn a_bridge() -> TeamBridgeSpec {
        slack_bridge::parse_bridge(
            "p1",
            &spec(json!({
                "teamBridge": true,
                "teamId": TEAM,
                "channel": "C1",
                "pollInbound": true,
            })),
        )
        .expect("fixture must parse as a bridge")
    }

    fn human(ts: &str, user: &str, text: &str) -> SlackMessage {
        SlackMessage {
            ts: ts.to_string(),
            text: text.to_string(),
            user: user.to_string(),
            thread_ts: String::new(),
            is_bot: false,
            has_subtype: false,
        }
    }

    /// THE regression guard. The fork is strictly on the `teamBridge`
    /// discriminator, so every Slack notification channel in the field — the
    /// ones that fire persona executions today — must still miss it. If this
    /// ever returns Some, real users' inbound Slack automation silently stops
    /// running.
    #[test]
    fn a_plain_inbound_slack_channel_never_takes_the_bridge_fork() {
        // Exactly the shape the pre-bridge poller path serves.
        let plain = spec(json!({ "pollInbound": true, "channel": "C1" }));
        assert!(slack_bridge::parse_bridge("p1", &plain).is_none());
        // …and a bridge-shaped config missing the discriminator is still plain.
        let almost = spec(json!({ "pollInbound": true, "channel": "C1", "teamId": TEAM }));
        assert!(slack_bridge::parse_bridge("p1", &almost).is_none());
        // The real thing does fork.
        assert!(slack_bridge::parse_bridge("p1", &spec(json!({
            "teamBridge": true, "teamId": TEAM, "channel": "C1", "pollInbound": true,
        }))).is_some());
    }

    /// The echo guard's inbound half. `slack_bridge::is_echo` keeps Slack-authored
    /// team rows from being relayed back out; this keeps the relay's own posts
    /// from being read back in. Both are needed or a message ping-pongs forever.
    #[test]
    fn our_own_posts_and_machine_noise_are_never_ingested() {
        assert!(should_ingest(&human("1.0", "U123", "hello"), BOT));

        // Our own bot user id — the message the outbound relay just posted.
        assert!(!should_ingest(&human("1.0", BOT, "hello"), BOT));

        // Any other bot / integration.
        let mut bot = human("1.0", "U123", "hello");
        bot.is_bot = true;
        assert!(!should_ingest(&bot, BOT));

        // channel_join / channel_leave / file_share … — system noise.
        let mut joined = human("1.0", "U123", "has joined the channel");
        joined.has_subtype = true;
        assert!(!should_ingest(&joined, BOT));

        // Empty / whitespace-only bodies would be an empty channel row.
        assert!(!should_ingest(&human("1.0", "U123", "   "), BOT));

        // An unresolved bot id must not swallow every message.
        assert!(should_ingest(&human("1.0", "U123", "hello"), ""));
    }

    /// A bridged message lands in the team channel exactly once, however many
    /// ticks re-read the same Slack page (the backward drain deliberately
    /// re-fetches boundary messages).
    #[test]
    fn a_bridged_message_lands_once_and_is_idempotent_across_ticks() {
        let pool = crate::db::init_test_db().unwrap();
        let bridge = a_bridge();
        let page = vec![
            human("1716981234.000100", "U123", "first"),
            human("1716981234.000200", "U456", "second"),
        ];

        // Tick 1.
        let selected = select_ingestable(&pool, &bridge.slack_channel_id, &page, BOT).unwrap();
        assert_eq!(selected.len(), 2);
        let pairs: Vec<(SlackMessage, String)> = selected
            .into_iter()
            .map(|m| {
                let name = if m.user == "U123" { "Ada" } else { "Grace" };
                (m, name.to_string())
            })
            .collect();
        assert_eq!(persist_bridge_messages(&pool, &bridge, &pairs).unwrap(), 2);

        // Tick 2 re-reads the same page: nothing is selected, nothing is written.
        let again = select_ingestable(&pool, &bridge.slack_channel_id, &page, BOT).unwrap();
        assert!(again.is_empty(), "dedup is the slack_inbound_messages PK");

        let conn = pool.get().unwrap();
        let rows: i64 = conn
            .query_row(
                "SELECT count(*) FROM team_channel_messages WHERE team_id = ?1",
                params![TEAM],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rows, 2);

        // Shape of what landed: external author kind, Slack user id as author,
        // resolved name as the label, and 'inject' so it reaches the personas
        // at the next step boundary like a directive.
        let (kind, author, label, consumer): (String, String, String, String) = conn
            .query_row(
                "SELECT author_kind, author_id, author_label, consumer
                 FROM team_channel_messages WHERE team_id = ?1 AND body = 'first'",
                params![TEAM],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(kind, SLACK_AUTHOR_KIND);
        assert_eq!(author, "U123");
        assert_eq!(label, "Ada");
        assert_eq!(consumer, "inject");

        // No execution was dispatched, so the reply pass must not owe a reply.
        let exec_rows: i64 = conn
            .query_row(
                "SELECT count(*) FROM slack_inbound_messages WHERE execution_id IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(exec_rows, 0);
        assert!(list_pending_replies(&pool, 10).unwrap().is_empty());
    }

    /// Dropped messages must still advance the cursor, or a channel whose newest
    /// message is a bot post re-reads it forever.
    #[test]
    fn the_cursor_advances_past_messages_we_drop() {
        let mut bot = human("1716981234.000900", "UBOT", "relayed");
        bot.is_bot = true;
        let page = vec![human("1716981234.000100", "U1", "hi"), bot];
        assert_eq!(
            newest_ts(&page, Some("1716981233.000000")).as_deref(),
            Some("1716981234.000900")
        );
        // Never regresses below an existing cursor.
        assert_eq!(
            newest_ts(&[], Some("1716981233.000000")).as_deref(),
            Some("1716981233.000000")
        );
    }

    // --- Breaker (unique keys per test: the map is a process-wide static) ---

    #[test]
    fn bridge_breaker_backs_off_after_repeated_failures_and_recovers() {
        let k = "poller-breaker-trip";
        assert_eq!(breaker_decide(k), BreakerAction::Poll);
        for i in 1..=BRIDGE_FAILURE_THRESHOLD {
            assert_eq!(breaker_record(k, false), i >= BRIDGE_FAILURE_THRESHOLD);
        }
        // Broken: one probe, then skips until the probe cadence comes round.
        assert_eq!(breaker_decide(k), BreakerAction::Probe);
        breaker_note_skip(k);
        assert_eq!(breaker_decide(k), BreakerAction::Skip);
        // A successful probe clears it.
        assert!(!breaker_record(k, true));
        assert_eq!(breaker_decide(k), BreakerAction::Poll);
    }

    #[test]
    fn bridge_breaker_tolerates_transient_failures() {
        let k = "poller-breaker-transient";
        for _ in 0..(BRIDGE_FAILURE_THRESHOLD - 1) {
            assert!(!breaker_record(k, false));
            assert_eq!(breaker_decide(k), BreakerAction::Poll);
        }
        breaker_record(k, true);
        assert_eq!(breaker_decide(k), BreakerAction::Poll);
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
