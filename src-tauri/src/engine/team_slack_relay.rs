//! Team channel -> Slack relay (outbound half of the team channel bridge).
//!
//! ## Loop architecture
//!
//! A tokio task ticks every [`RELAY_TICK_INTERVAL`]. Each tick enumerates every
//! configured bridge (see `engine/slack_bridge.rs` for what a bridge is) and,
//! per bridge:
//!
//! 1. Loads that bridge's watermark, a `<created_at>|<row id>` composite.
//! 2. Reads `team_channel_messages` (and, when `outboundSteps` is on,
//!    `team_assignment_events`) strictly after it, bounded by
//!    [`MAX_ROWS_PER_TICK`].
//! 3. Filters by the bridge's outbound flags, with the echo guard
//!    (`slack_bridge::is_echo`) applied first and unconditionally.
//! 4. Posts each surviving row through the EXISTING Slack sender
//!    (`notifications::deliver_spec_now` -> `deliver_slack`), so vault
//!    credential resolution, the `chat.postMessage` / webhook fork, and error
//!    handling are shared with normal notification delivery.
//! 5. Advances the watermark to the newest row it can safely pass.
//!
//! ## Watermark storage
//!
//! Mirrors `engine/webhook_notifier.rs`: a persisted composite cursor read and
//! written through a repo, never an in-memory cursor. The notifier owns a
//! single global cursor and gets a dedicated one-row table; a bridge cursor is
//! per (team, Slack channel, stream), so it lives in the existing `app_settings`
//! key-value table under the [`settings_keys::TEAM_SLACK_BRIDGE_CURSOR_PREFIX`]
//! prefix family (the same place per-table cloud-sync cursors live). No
//! migration, same composite value shape, same forward-looking seeding rule.
//!
//! ## Forward-looking bridges (no historical backlog)
//!
//! A bridge with no watermark yet seeds forward to the newest existing row and
//! relays nothing that tick, so wiring a bridge never dumps a team's entire
//! history into a Slack channel. Same contract as a freshly created webhook
//! subscription.
//!
//! ## Leader gating
//!
//! Mandatory. The relay advances a durable watermark and POSTs to a third
//! party; two instances ticking it would double-post every message. A follower
//! idles and resumes within one tick if it later wins leadership.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tokio::sync::Mutex as TokioMutex;

use crate::db::models::{TeamAssignmentEvent, TeamChannelMessage};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::core::settings;
use crate::db::repos::orchestration::team_assignments as assignment_repo;
use crate::db::repos::resources::team_channel as channel_repo;
use crate::db::settings_keys;
use crate::db::DbPool;
use crate::engine::slack_bridge::{self, TeamBridgeSpec};
use crate::error::AppError;
use crate::notifications;

/// Tick interval. Matches `webhook_notifier::DISPATCH_TICK_INTERVAL` and both
/// inbound pollers, so the whole outbound/inbound bridge moves on one cadence.
pub const RELAY_TICK_INTERVAL: Duration = Duration::from_secs(5);

/// Max rows read per (bridge, stream, tick). Bounds burst cost the same way
/// `webhook_notifier::MAX_EVENTS_PER_TICK` does.
const MAX_ROWS_PER_TICK: i64 = 200;

/// Max Slack posts per (bridge, stream, tick). Lower than the read cap on
/// purpose: reads are cheap, posts are rate-limited third-party calls. A larger
/// backlog drains over subsequent ticks because the watermark is left below the
/// first unsent row.
const MAX_POSTS_PER_TICK: usize = 5;

/// Minimum gap between two posts to the same Slack channel. Matches the 1 req/s
/// per-channel budget `notifications::rate_limit_check` enforces for the test
/// delivery path; the relay waits the remainder of the window rather than
/// dropping a message.
const POST_GAP: Duration = Duration::from_secs(1);

/// Slack `text` hard-caps around 40000 chars. Team channel bodies can be a full
/// agent turn, so truncate well short of that: a Slack channel is a glance
/// surface, the full text lives in the app.
const RELAY_TEXT_LIMIT: usize = 3500;

// ---------------------------------------------------------------------------
// Per-bridge consecutive-failure breaker
// ---------------------------------------------------------------------------
//
// Same shape and rationale as `webhook_notifier`'s: the relay owns no
// long-lived struct (every tick is a fresh free-function call over a DbPool),
// and a permanently broken sink (channel deleted, bot removed, token revoked)
// would otherwise be retried on every tick forever, pinning its watermark and
// spamming the log. After BROKEN_FAILURE_THRESHOLD consecutive failures a
// bridge is skipped except for an occasional recovery probe. In-memory only:
// a restart re-probes every bridge, which is the right default.

const BROKEN_FAILURE_THRESHOLD: u32 = 5;
const BROKEN_PROBE_EVERY: u32 = 12;

static CONSECUTIVE_FAILURES: LazyLock<Mutex<HashMap<String, u32>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn breaker_lock() -> std::sync::MutexGuard<'static, HashMap<String, u32>> {
    CONSECUTIVE_FAILURES.lock().unwrap_or_else(|poisoned| {
        tracing::warn!(
            "team_slack_relay breaker mutex poisoned; recovering inner data after a \
             prior panic held this lock"
        );
        poisoned.into_inner()
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BreakerAction {
    /// Healthy: relay normally.
    Deliver,
    /// Broken but due for a recovery probe: try one post.
    Probe,
    /// Broken and not a probe: skip the bridge entirely this tick.
    Skip,
}

fn breaker_decide(key: &str) -> BreakerAction {
    let count = breaker_lock().get(key).copied().unwrap_or(0);
    if count < BROKEN_FAILURE_THRESHOLD {
        BreakerAction::Deliver
    } else if (count - BROKEN_FAILURE_THRESHOLD) % BROKEN_PROBE_EVERY == 0 {
        BreakerAction::Probe
    } else {
        BreakerAction::Skip
    }
}

/// Record a post result. Returns `true` if the bridge is now considered broken.
fn breaker_record(key: &str, ok: bool) -> bool {
    let mut map = breaker_lock();
    if ok {
        map.remove(key);
        false
    } else {
        let count = map.entry(key.to_string()).or_insert(0);
        *count = count.saturating_add(1);
        *count >= BROKEN_FAILURE_THRESHOLD
    }
}

/// Advance the probe cadence for a broken bridge whose tick we skipped.
fn breaker_note_skip(key: &str) {
    let mut map = breaker_lock();
    let count = map
        .entry(key.to_string())
        .or_insert(BROKEN_FAILURE_THRESHOLD);
    *count = count.saturating_add(1);
}

// ---------------------------------------------------------------------------
// Per-Slack-channel outbound pacing
// ---------------------------------------------------------------------------

/// Last post time per Slack channel id. Keyed by channel rather than by bridge
/// because the limit Slack enforces is per channel: two bridges pointed at the
/// same channel share one budget.
static LAST_POST_AT: LazyLock<TokioMutex<HashMap<String, Instant>>> =
    LazyLock::new(|| TokioMutex::new(HashMap::new()));

/// Wait out the per-channel post gap if needed, then claim the slot.
///
/// Uses the existing `notifications::rate_limit_check` as the gate so the
/// relay and the test-delivery path agree on what "too soon" means; where the
/// test path reports `rate_limited` and gives up, the relay sleeps the
/// remainder, because dropping a bridged message is not an option.
async fn pace_channel(channel_id: &str) {
    let wait = {
        let map = LAST_POST_AT.lock().await;
        let now = Instant::now();
        if notifications::rate_limit_check(&map, now, channel_id, "slack").is_some() {
            map.get(channel_id)
                .map(|last| POST_GAP.saturating_sub(now.duration_since(*last)))
        } else {
            None
        }
    };
    if let Some(wait) = wait.filter(|w| !w.is_zero()) {
        tokio::time::sleep(wait).await;
    }
    LAST_POST_AT
        .lock()
        .await
        .insert(channel_id.to_string(), Instant::now());
}

// ---------------------------------------------------------------------------
// Watermarks
// ---------------------------------------------------------------------------

/// Which table a cursor tracks. The two streams advance independently: a bridge
/// can have chatty messages and quiet step events (or the reverse) without one
/// starving the other.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stream {
    Messages,
    Steps,
}

impl Stream {
    fn suffix(self) -> &'static str {
        match self {
            Stream::Messages => "msg",
            Stream::Steps => "step",
        }
    }
}

/// `app_settings` keys only allow ASCII alphanumerics, `-` and `_` after the
/// prefix (`settings_keys::validate_key`). Team ids are uuid-shaped and Slack
/// channel ids are alphanumeric, so this is a no-op in practice; it exists so a
/// hand-edited config can never produce a key the settings repo rejects.
fn sanitize(part: &str) -> String {
    part.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Full `app_settings` key for one bridge stream's watermark.
pub fn cursor_key(bridge: &TeamBridgeSpec, stream: Stream) -> String {
    format!(
        "{}{}_{}_{}",
        settings_keys::TEAM_SLACK_BRIDGE_CURSOR_PREFIX,
        sanitize(&bridge.team_id),
        sanitize(&bridge.slack_channel_id),
        stream.suffix()
    )
}

/// Split a stored `<created_at>|<id>` composite. A value without the separator
/// is treated as a bare timestamp with no id tiebreaker, matching how
/// `webhook_notifier` reads its legacy watermarks.
pub fn split_cursor(raw: &str) -> (String, String) {
    match raw.split_once('|') {
        Some((at, id)) => (at.to_string(), id.to_string()),
        None => (raw.to_string(), String::new()),
    }
}

fn read_cursor(pool: &DbPool, key: &str) -> Result<Option<(String, String)>, AppError> {
    Ok(settings::get(pool, key)?
        .filter(|v| !v.trim().is_empty())
        .map(|v| split_cursor(&v)))
}

fn write_cursor(pool: &DbPool, key: &str, at: &str, id: &str) -> Result<(), AppError> {
    settings::set(pool, key, &format!("{at}|{id}"))
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

fn truncate(body: &str) -> String {
    if body.chars().count() <= RELAY_TEXT_LIMIT {
        return body.to_string();
    }
    let head: String = body.chars().take(RELAY_TEXT_LIMIT).collect();
    format!("{head}... (truncated, full text in Personas)")
}

/// Display name for a message author. Persona-authored rows resolve the persona
/// name (cached per tick so a chatty team is one lookup per persona, not one
/// per message); everything else has a fixed label.
fn author_label(
    pool: &DbPool,
    row: &TeamChannelMessage,
    names: &mut HashMap<String, String>,
) -> String {
    match row.author_kind.as_str() {
        "athena" => "Athena".to_string(),
        "user" => "You".to_string(),
        "system" => "Personas".to_string(),
        "persona" | "director" => {
            let Some(id) = row.author_id.as_deref() else {
                return "Agent".to_string();
            };
            if let Some(name) = names.get(id) {
                return name.clone();
            }
            let name = persona_repo::get_by_id(pool, id)
                .map(|p| p.name)
                .unwrap_or_else(|_| "Agent".to_string());
            names.insert(id.to_string(), name.clone());
            name
        }
        other => other.to_string(),
    }
}

/// `(title, body)` for a mirrored channel message. `deliver_slack` renders this
/// as `*title*\nbody`, so the title carries the author and the body the text.
fn format_message(
    pool: &DbPool,
    row: &TeamChannelMessage,
    names: &mut HashMap<String, String>,
) -> (String, String) {
    (author_label(pool, row, names), truncate(&row.body))
}

/// `(title, body)` for a mirrored assignment step event.
fn format_step_event(event: &TeamAssignmentEvent) -> (String, String) {
    let detail = event
        .payload
        .as_deref()
        .and_then(|p| serde_json::from_str::<serde_json::Value>(p).ok())
        .and_then(|v| {
            ["title", "message", "summary", "status"]
                .iter()
                .find_map(|k| v.get(*k).and_then(|x| x.as_str()).map(str::to_string))
        });
    let body = match detail {
        Some(d) => format!("{}: {}", event.kind, d),
        None => event.kind.clone(),
    };
    ("Assignment update".to_string(), truncate(&body))
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

/// Relay one tick across every configured bridge. Returns the number of Slack
/// posts made.
pub async fn tick(pool: &DbPool, app: &AppHandle) -> Result<usize, AppError> {
    let bridges = slack_bridge::list_bridges(pool)?;
    if bridges.is_empty() {
        return Ok(0);
    }

    let mut posted = 0usize;
    let mut names: HashMap<String, String> = HashMap::new();

    for bridge in &bridges {
        if !bridge.has_outbound() {
            continue;
        }
        let key = bridge.key();
        if breaker_decide(&key) == BreakerAction::Skip {
            breaker_note_skip(&key);
            continue;
        }

        if bridge.outbound_messages || bridge.outbound_directives {
            match relay_messages(pool, app, bridge, &mut names).await {
                Ok(n) => posted += n,
                Err(e) => tracing::warn!(
                    bridge = %key,
                    error = %e,
                    "team_slack_relay: message relay failed"
                ),
            }
        }
        if bridge.outbound_steps {
            match relay_steps(pool, app, bridge).await {
                Ok(n) => posted += n,
                Err(e) => tracing::warn!(
                    bridge = %key,
                    error = %e,
                    "team_slack_relay: step relay failed"
                ),
            }
        }
    }

    Ok(posted)
}

async fn relay_messages(
    pool: &DbPool,
    app: &AppHandle,
    bridge: &TeamBridgeSpec,
    names: &mut HashMap<String, String>,
) -> Result<usize, AppError> {
    let cursor_key = cursor_key(bridge, Stream::Messages);
    let Some((at, id)) = read_cursor(pool, &cursor_key)? else {
        // Forward-looking: seed past everything that already exists so wiring a
        // bridge never replays the team's history into Slack.
        if let Some((at, id)) = channel_repo::newest_cursor_for_team(pool, &bridge.team_id)? {
            write_cursor(pool, &cursor_key, &at, &id)?;
        }
        return Ok(0);
    };

    let rows = channel_repo::list_for_team_after(
        pool,
        &bridge.team_id,
        Some(&at),
        Some(&id),
        MAX_ROWS_PER_TICK,
    )?;
    if rows.is_empty() {
        return Ok(0);
    }

    let breaker_key = bridge.key();
    let mut advance: Option<(String, String)> = None;
    let mut posts = 0usize;

    for row in &rows {
        // Rows this bridge does not mirror (echoes from Slack, muted author
        // kinds) still move the cursor: they are decided, not deferred.
        if !slack_bridge::should_mirror_message(bridge, &row.author_kind) {
            advance = Some((row.created_at.clone(), row.id.clone()));
            continue;
        }
        if posts >= MAX_POSTS_PER_TICK {
            // Leave the cursor below this row; the next tick resumes here.
            break;
        }

        let (title, body) = format_message(pool, row, names);
        pace_channel(&bridge.slack_channel_id).await;
        match notifications::deliver_spec_now(app, &bridge.spec, &title, &body).await {
            Ok(()) => {
                breaker_record(&breaker_key, true);
                posts += 1;
                advance = Some((row.created_at.clone(), row.id.clone()));
            }
            Err(e) => {
                let now_broken = breaker_record(&breaker_key, false);
                tracing::warn!(
                    bridge = %breaker_key,
                    message_id = %row.id,
                    now_broken,
                    error = %e,
                    "team_slack_relay: Slack post failed; holding watermark"
                );
                // Stop at the first failure and do NOT pass this row, so a
                // transient Slack outage retries instead of dropping messages.
                break;
            }
        }
    }

    if let Some((at, id)) = advance {
        write_cursor(pool, &cursor_key, &at, &id)?;
    }
    Ok(posts)
}

async fn relay_steps(
    pool: &DbPool,
    app: &AppHandle,
    bridge: &TeamBridgeSpec,
) -> Result<usize, AppError> {
    let cursor_key = cursor_key(bridge, Stream::Steps);
    let Some((at, id)) = read_cursor(pool, &cursor_key)? else {
        if let Some((at, id)) =
            assignment_repo::newest_event_cursor_for_team(pool, &bridge.team_id)?
        {
            write_cursor(pool, &cursor_key, &at, &id)?;
        }
        return Ok(0);
    };

    let events = assignment_repo::list_events_for_team_after(
        pool,
        &bridge.team_id,
        Some(&at),
        Some(&id),
        MAX_ROWS_PER_TICK,
    )?;
    if events.is_empty() {
        return Ok(0);
    }

    let breaker_key = bridge.key();
    let mut advance: Option<(String, String)> = None;
    let mut posts = 0usize;

    for event in &events {
        if posts >= MAX_POSTS_PER_TICK {
            break;
        }
        let (title, body) = format_step_event(event);
        pace_channel(&bridge.slack_channel_id).await;
        match notifications::deliver_spec_now(app, &bridge.spec, &title, &body).await {
            Ok(()) => {
                breaker_record(&breaker_key, true);
                posts += 1;
                advance = Some((event.created_at.clone(), event.id.clone()));
            }
            Err(e) => {
                let now_broken = breaker_record(&breaker_key, false);
                tracing::warn!(
                    bridge = %breaker_key,
                    event_id = %event.id,
                    now_broken,
                    error = %e,
                    "team_slack_relay: Slack post failed; holding watermark"
                );
                break;
            }
        }
    }

    if let Some((at, id)) = advance {
        write_cursor(pool, &cursor_key, &at, &id)?;
    }
    Ok(posts)
}

// ---------------------------------------------------------------------------
// Loop runner - spawned from lib.rs setup
// ---------------------------------------------------------------------------

pub async fn run_relay(pool: DbPool, app: AppHandle) {
    // Same startup grace period as the other engine loops.
    tokio::time::sleep(Duration::from_secs(10)).await;
    loop {
        // Leader-only: the relay advances durable watermarks and POSTs to
        // Slack, so two instances would double-post every bridged message.
        if crate::engine::leadership::is_engine_leader(&app) {
            match tick(&pool, &app).await {
                Ok(0) => {}
                Ok(n) => tracing::debug!(posted = n, "team_slack_relay: mirrored rows to Slack"),
                Err(e) => tracing::warn!(error = %e, "team_slack_relay tick failed"),
            }
        }
        tokio::time::sleep(RELAY_TICK_INTERVAL).await;
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{ChannelScopeV2, ChannelSpecV2, ChannelSpecV2Type};
    use serde_json::json;

    fn bridge(config: serde_json::Value) -> TeamBridgeSpec {
        let spec = ChannelSpecV2 {
            channel_type: ChannelSpecV2Type::Slack,
            enabled: true,
            credential_id: Some("cred-1".into()),
            use_case_ids: ChannelScopeV2::All("*".into()),
            event_filter: None,
            config: Some(config),
        };
        slack_bridge::parse_bridge("p1", &spec).expect("fixture must be a bridge")
    }

    fn full_bridge() -> TeamBridgeSpec {
        bridge(json!({
            "teamBridge": true,
            "teamId": "team-1",
            "channel": "C0123ABCD",
            "outboundMessages": true,
            "outboundDirectives": true,
            "outboundSteps": true,
        }))
    }

    fn message(author_kind: &str) -> TeamChannelMessage {
        TeamChannelMessage {
            id: "tcm-1".into(),
            team_id: "team-1".into(),
            author_kind: author_kind.into(),
            author_id: None,
            body: "hello".into(),
            addressed_to: None,
            reply_to: None,
            assignment_id: None,
            consumer: "display".into(),
            deliveries: None,
            created_at: "2026-08-04 10:00:00".into(),
        }
    }

    // --- Echo guard ----------------------------------------------------------

    #[test]
    fn echo_rows_are_never_relayed() {
        let b = full_bridge();
        assert!(!slack_bridge::should_mirror_message(
            &b,
            &message(slack_bridge::SLACK_AUTHOR_KIND).author_kind
        ));
    }

    // --- Flag matrix (relay's view of the selection) -------------------------

    #[test]
    fn flag_matrix_selects_the_right_rows() {
        let messages_only = bridge(json!({
            "teamBridge": true, "teamId": "t", "channel": "C1",
            "outboundMessages": true,
        }));
        assert!(slack_bridge::should_mirror_message(
            &messages_only,
            "persona"
        ));
        assert!(slack_bridge::should_mirror_message(
            &messages_only,
            "athena"
        ));
        assert!(!slack_bridge::should_mirror_message(&messages_only, "user"));
        assert!(!messages_only.outbound_steps);

        let directives_only = bridge(json!({
            "teamBridge": true, "teamId": "t", "channel": "C1",
            "outboundDirectives": true,
        }));
        assert!(slack_bridge::should_mirror_message(
            &directives_only,
            "user"
        ));
        assert!(!slack_bridge::should_mirror_message(
            &directives_only,
            "persona"
        ));

        let steps_only = bridge(json!({
            "teamBridge": true, "teamId": "t", "channel": "C1",
            "outboundSteps": true,
        }));
        assert!(steps_only.outbound_steps);
        assert!(!slack_bridge::should_mirror_message(&steps_only, "persona"));
        assert!(!slack_bridge::should_mirror_message(&steps_only, "user"));
        // Steps-only still has outbound work, so the relay must not skip it.
        assert!(steps_only.has_outbound());
    }

    // --- Cursors -------------------------------------------------------------

    #[test]
    fn cursor_keys_are_per_bridge_and_per_stream() {
        let b = full_bridge();
        let msg = cursor_key(&b, Stream::Messages);
        let step = cursor_key(&b, Stream::Steps);
        assert_ne!(msg, step);
        assert!(msg.starts_with(settings_keys::TEAM_SLACK_BRIDGE_CURSOR_PREFIX));
        assert!(msg.ends_with("_msg"));
        assert!(step.ends_with("_step"));
        // The settings repo only accepts alnum/-/_ after the prefix.
        let suffix = msg
            .strip_prefix(settings_keys::TEAM_SLACK_BRIDGE_CURSOR_PREFIX)
            .unwrap();
        assert!(suffix
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert!(settings_keys::validate_key(&msg).is_ok());
        assert!(settings_keys::validate_key(&step).is_ok());
    }

    #[test]
    fn cursor_key_sanitizes_exotic_ids() {
        let b = bridge(json!({
            "teamBridge": true, "teamId": "team/one two", "channel": "C:1",
            "outboundMessages": true,
        }));
        let key = cursor_key(&b, Stream::Messages);
        assert!(settings_keys::validate_key(&key).is_ok());
    }

    #[test]
    fn cursor_splits_composite_and_legacy_values() {
        assert_eq!(
            split_cursor("2026-08-04 10:00:00|tcm-9"),
            ("2026-08-04 10:00:00".to_string(), "tcm-9".to_string())
        );
        // Legacy bare-timestamp value: no id tiebreaker.
        assert_eq!(
            split_cursor("2026-08-04 10:00:00"),
            ("2026-08-04 10:00:00".to_string(), String::new())
        );
    }

    // --- Formatting ----------------------------------------------------------

    #[test]
    fn step_event_body_prefers_a_payload_detail() {
        let mut event = TeamAssignmentEvent {
            id: "ev-1".into(),
            assignment_id: "as-1".into(),
            step_id: Some("st-1".into()),
            kind: "step_completed".into(),
            payload: Some(json!({ "title": "Draft the brief" }).to_string()),
            created_at: "2026-08-04 10:00:00".into(),
        };
        let (title, body) = format_step_event(&event);
        assert_eq!(title, "Assignment update");
        assert_eq!(body, "step_completed: Draft the brief");

        event.payload = None;
        assert_eq!(format_step_event(&event).1, "step_completed");

        // Unparseable payload degrades to the bare kind rather than erroring.
        event.payload = Some("{not json".into());
        assert_eq!(format_step_event(&event).1, "step_completed");
    }

    #[test]
    fn long_bodies_are_truncated() {
        let long = "x".repeat(RELAY_TEXT_LIMIT + 500);
        let out = truncate(&long);
        assert!(out.starts_with(&"x".repeat(100)));
        assert!(out.ends_with("(truncated, full text in Personas)"));
        assert!(out.chars().count() < RELAY_TEXT_LIMIT + 100);
        // Short bodies pass through untouched.
        assert_eq!(truncate("hi"), "hi");
    }

    // --- Breaker -------------------------------------------------------------
    // Unique keys per test: the map is a process-wide static.

    #[test]
    fn breaker_starts_healthy_and_resets_on_success() {
        let k = "relay-breaker-healthy";
        assert_eq!(breaker_decide(k), BreakerAction::Deliver);
        for _ in 0..(BROKEN_FAILURE_THRESHOLD - 1) {
            assert!(!breaker_record(k, false));
            assert_eq!(breaker_decide(k), BreakerAction::Deliver);
        }
        assert!(!breaker_record(k, true));
        assert_eq!(breaker_decide(k), BreakerAction::Deliver);
    }

    #[test]
    fn breaker_trips_then_probes_then_skips() {
        let k = "relay-breaker-trip";
        for i in 1..=BROKEN_FAILURE_THRESHOLD {
            assert_eq!(breaker_record(k, false), i >= BROKEN_FAILURE_THRESHOLD);
        }
        assert_eq!(breaker_decide(k), BreakerAction::Probe);
        breaker_note_skip(k);
        assert_eq!(breaker_decide(k), BreakerAction::Skip);
    }

    #[test]
    fn breaker_recovers_on_a_successful_probe() {
        let k = "relay-breaker-recover";
        for _ in 0..BROKEN_FAILURE_THRESHOLD {
            breaker_record(k, false);
        }
        assert_ne!(breaker_decide(k), BreakerAction::Deliver);
        assert!(!breaker_record(k, true));
        assert_eq!(breaker_decide(k), BreakerAction::Deliver);
    }
}
