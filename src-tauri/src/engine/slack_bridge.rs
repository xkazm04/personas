//! Team channel <-> Slack channel bridge: the shared binding layer.
//!
//! ## What a bridge is
//!
//! A bridge is NOT a table. It is a `ChannelSpecV2` entry on some persona's
//! `notification_channels` JSON that carries `teamBridge: true` in its config
//! (operator decision, 2026-08-04: no new schema for a binding that already has
//! a natural home). The persona owning the spec supplies the Slack credential;
//! the config supplies the team id, the Slack channel id, and the direction
//! flags:
//!
//! ```json
//! {
//!   "type": "slack",
//!   "enabled": true,
//!   "credential_id": "cred-...",
//!   "use_case_ids": "*",
//!   "config": {
//!     "teamBridge": true,
//!     "teamId": "team-...",
//!     "channel": "C0123ABCD",
//!     "pollInbound": true,
//!     "outboundMessages": true,
//!     "outboundDirectives": false,
//!     "outboundSteps": true
//!   }
//! }
//! ```
//!
//! `teamBridge` is the discriminator: a plain Slack notification channel (no
//! `teamBridge` key) is never picked up here, so wiring a bridge cannot change
//! how existing notification channels behave.
//!
//! ## Both directions read this module
//!
//! - **Outbound (WP1, `engine/team_slack_relay.rs`)** mirrors new
//!   `team_channel_messages` / `team_assignment_events` rows into Slack.
//! - **Inbound (WP2, `engine/slack_poller.rs`)** reads the same bridges,
//!   honours [`TeamBridgeSpec::poll_inbound`], and writes Slack messages back
//!   into `team_channel_messages` with `author_kind = `[`SLACK_AUTHOR_KIND`].
//!
//! That last part is load-bearing: [`is_echo`] is the single loop-prevention
//! invariant shared by both halves. Anything authored by Slack must never be
//! mirrored back to Slack, whatever the outbound flags say.

use serde_json::Value as JsonValue;

use crate::db::models::{ChannelSpecV2, ChannelSpecV2Type};
use crate::db::repos::core::personas as persona_repo;
use crate::db::DbPool;
use crate::error::AppError;
use crate::notifications;

/// `author_kind` written by the inbound half (WP2) for rows that originated in
/// Slack. The outbound relay must never mirror these back: that is the bridge
/// loop, and it is unbounded.
pub const SLACK_AUTHOR_KIND: &str = "slack";

/// Author kinds that count as "agent chatter" for the `outboundMessages` flag.
const MESSAGE_AUTHOR_KINDS: &[&str] = &["persona", "athena", "director", "system"];

/// Author kind that counts as an operator directive for `outboundDirectives`.
const DIRECTIVE_AUTHOR_KIND: &str = "user";

/// One resolved team <-> Slack binding.
///
/// Not a ts-rs type on purpose: the frontend edits the raw `ChannelSpecV2`
/// config, so there is no bound struct to keep in sync (and therefore no
/// camelCase ratchet obligation).
#[derive(Debug, Clone)]
// `persona_id` / `credential_id` / `poll_inbound` are the inbound half's inputs
// (WP2, `engine/slack_poller.rs`): the persona to execute as, the Slack token to
// read with, and whether to read at all. Parsed here so both directions share
// one binding parser.
#[allow(dead_code)]
pub struct TeamBridgeSpec {
    /// Persona whose `notification_channels` carries this spec. Supplies the
    /// Slack credential and is the identity the inbound half executes as.
    pub persona_id: String,
    /// Personas team whose channel is bridged.
    pub team_id: String,
    /// Slack channel id (e.g. `C0123ABCD`).
    pub slack_channel_id: String,
    /// Vault credential id holding the Slack `bot_token`.
    pub credential_id: String,
    /// WP2: pull Slack messages into the team channel.
    pub poll_inbound: bool,
    /// Mirror persona/athena/director/system channel messages out to Slack.
    pub outbound_messages: bool,
    /// Mirror operator directives (`author_kind = "user"`) out to Slack.
    pub outbound_directives: bool,
    /// Mirror assignment step events out to Slack.
    pub outbound_steps: bool,
    /// The originating spec, kept verbatim so delivery reuses the existing
    /// vault-merge + `deliver_slack` path rather than re-deriving auth.
    pub spec: ChannelSpecV2,
}

impl TeamBridgeSpec {
    /// Stable identity for per-bridge bookkeeping (watermarks, rate limiting,
    /// the failure breaker). Two specs pointing at the same (team, channel)
    /// are the same bridge even if they live on different personas.
    pub fn key(&self) -> String {
        format!("{}:{}", self.team_id, self.slack_channel_id)
    }

    /// True when at least one outbound direction is enabled. A bridge that is
    /// inbound-only costs the relay nothing.
    pub fn has_outbound(&self) -> bool {
        self.outbound_messages || self.outbound_directives || self.outbound_steps
    }
}

/// True when this row originated in Slack and must not be mirrored back.
///
/// The one invariant both halves of the bridge depend on. Kept as a named
/// function (rather than an inline comparison) so the guard has exactly one
/// definition and one test.
pub fn is_echo(author_kind: &str) -> bool {
    author_kind == SLACK_AUTHOR_KIND
}

/// Whether a `team_channel_messages` row should be mirrored to Slack, given the
/// bridge's outbound flags.
///
/// Echo rows are rejected first and unconditionally: no flag combination can
/// re-export a message that arrived from Slack. Unknown author kinds are
/// rejected too, so a future writer has to opt in here deliberately instead of
/// leaking into an operator's Slack channel by default.
pub fn should_mirror_message(bridge: &TeamBridgeSpec, author_kind: &str) -> bool {
    if is_echo(author_kind) {
        return false;
    }
    if author_kind == DIRECTIVE_AUTHOR_KIND {
        return bridge.outbound_directives;
    }
    if MESSAGE_AUTHOR_KINDS.contains(&author_kind) {
        return bridge.outbound_messages;
    }
    false
}

/// Read a string out of a bridge config, tolerating the three spellings this
/// codebase has accumulated for the same key (`channel` from the messaging
/// picker, `channelId` from the inbound poller docs, `channel_id` from the
/// legacy notification config).
fn config_str<'a>(config: &'a JsonValue, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|k| config.get(*k).and_then(JsonValue::as_str))
        .filter(|s| !s.trim().is_empty())
}

fn config_bool(config: &JsonValue, keys: &[&str]) -> Option<bool> {
    keys.iter()
        .find_map(|k| config.get(*k).and_then(JsonValue::as_bool))
}

/// Parse one `ChannelSpecV2` into a bridge, or `None` if it is not one.
///
/// Pure and total: every rejection path (disabled, wrong channel type, missing
/// credential, missing `teamBridge` discriminator, missing team/channel id) is
/// a `None`, never an error, because a persona's channel list legitimately
/// contains plenty of non-bridge specs.
pub fn parse_bridge(persona_id: &str, spec: &ChannelSpecV2) -> Option<TeamBridgeSpec> {
    if !spec.enabled {
        return None;
    }
    if !matches!(spec.channel_type, ChannelSpecV2Type::Slack) {
        return None;
    }
    let config = spec.config.as_ref()?;

    // The discriminator. Without it this is an ordinary Slack notification
    // channel and must keep behaving as one.
    if !config_bool(config, &["teamBridge", "team_bridge"]).unwrap_or(false) {
        return None;
    }

    let team_id = config_str(config, &["teamId", "team_id"])?.to_string();
    let slack_channel_id = config_str(config, &["channel", "channelId", "channel_id"])?.to_string();
    let credential_id = spec.credential_id.as_deref().filter(|c| !c.is_empty())?;

    Some(TeamBridgeSpec {
        persona_id: persona_id.to_string(),
        team_id,
        slack_channel_id,
        credential_id: credential_id.to_string(),
        poll_inbound: config_bool(config, &["pollInbound", "poll_inbound"]).unwrap_or(false),
        outbound_messages: config_bool(config, &["outboundMessages", "outbound_messages"])
            .unwrap_or(false),
        outbound_directives: config_bool(config, &["outboundDirectives", "outbound_directives"])
            .unwrap_or(false),
        outbound_steps: config_bool(config, &["outboundSteps", "outbound_steps"]).unwrap_or(false),
        spec: spec.clone(),
    })
}

/// Enumerate every bridge configured across all enabled personas.
///
/// Mirrors `slack_poller::tick`'s scan: `personas::get_enabled` ->
/// `parse_channels_v2` -> filter. Personas whose `notification_channels` is
/// legacy shape-A/B (i.e. `parse_channels_v2` returns `None`) simply have no
/// bridges; bridging is a shape-v2-only feature.
pub fn list_bridges(pool: &DbPool) -> Result<Vec<TeamBridgeSpec>, AppError> {
    let mut out = Vec::new();
    for persona in persona_repo::get_enabled(pool)? {
        let Some(channels) =
            notifications::parse_channels_v2(persona.notification_channels.as_deref())
        else {
            continue;
        };
        for spec in &channels {
            if let Some(bridge) = parse_bridge(&persona.id, spec) {
                out.push(bridge);
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn spec_from(config: JsonValue, enabled: bool, credential: Option<&str>) -> ChannelSpecV2 {
        ChannelSpecV2 {
            channel_type: ChannelSpecV2Type::Slack,
            enabled,
            credential_id: credential.map(str::to_string),
            use_case_ids: crate::db::models::ChannelScopeV2::All("*".into()),
            event_filter: None,
            config: Some(config),
        }
    }

    fn bridge_config() -> JsonValue {
        json!({
            "teamBridge": true,
            "teamId": "team-1",
            "channel": "C0123ABCD",
            "outboundMessages": true,
            "outboundDirectives": true,
            "outboundSteps": true,
        })
    }

    fn a_bridge() -> TeamBridgeSpec {
        parse_bridge("p1", &spec_from(bridge_config(), true, Some("cred-1"))).unwrap()
    }

    // --- Discriminator -------------------------------------------------------

    #[test]
    fn parses_a_bridge_spec() {
        let b = a_bridge();
        assert_eq!(b.persona_id, "p1");
        assert_eq!(b.team_id, "team-1");
        assert_eq!(b.slack_channel_id, "C0123ABCD");
        assert_eq!(b.credential_id, "cred-1");
        assert!(b.has_outbound());
    }

    #[test]
    fn plain_slack_notification_spec_is_not_a_bridge() {
        // The regression that matters: an existing Slack notification channel
        // must not start relaying a team's channel just because the relay
        // shipped.
        let spec = spec_from(json!({ "channel": "C0123ABCD" }), true, Some("cred-1"));
        assert!(parse_bridge("p1", &spec).is_none());
        // Explicit false is as good as absent.
        let spec = spec_from(
            json!({ "teamBridge": false, "teamId": "team-1", "channel": "C1" }),
            true,
            Some("cred-1"),
        );
        assert!(parse_bridge("p1", &spec).is_none());
    }

    #[test]
    fn non_slack_or_disabled_or_uncredentialed_specs_are_skipped() {
        let mut telegram = spec_from(bridge_config(), true, Some("cred-1"));
        telegram.channel_type = ChannelSpecV2Type::Telegram;
        assert!(parse_bridge("p1", &telegram).is_none());

        assert!(parse_bridge("p1", &spec_from(bridge_config(), false, Some("cred-1"))).is_none());
        assert!(parse_bridge("p1", &spec_from(bridge_config(), true, None)).is_none());
        assert!(parse_bridge("p1", &spec_from(bridge_config(), true, Some(""))).is_none());
    }

    #[test]
    fn missing_team_or_channel_is_not_a_bridge() {
        let no_team = spec_from(
            json!({ "teamBridge": true, "channel": "C1" }),
            true,
            Some("cred-1"),
        );
        assert!(parse_bridge("p1", &no_team).is_none());
        let no_channel = spec_from(
            json!({ "teamBridge": true, "teamId": "team-1" }),
            true,
            Some("cred-1"),
        );
        assert!(parse_bridge("p1", &no_channel).is_none());
    }

    // --- Key drift -----------------------------------------------------------

    #[test]
    fn tolerates_channel_key_drift() {
        for key in ["channel", "channelId", "channel_id"] {
            let mut config = serde_json::Map::new();
            config.insert("teamBridge".into(), json!(true));
            config.insert("teamId".into(), json!("team-1"));
            config.insert(key.to_string(), json!("C9"));
            let spec = spec_from(JsonValue::Object(config), true, Some("cred-1"));
            let b = parse_bridge("p1", &spec)
                .unwrap_or_else(|| panic!("bridge should parse with config key {key}"));
            assert_eq!(b.slack_channel_id, "C9");
        }
    }

    #[test]
    fn tolerates_snake_case_flag_drift() {
        let spec = spec_from(
            json!({
                "team_bridge": true,
                "team_id": "team-2",
                "channel_id": "C7",
                "poll_inbound": true,
                "outbound_messages": true,
                "outbound_directives": true,
                "outbound_steps": true,
            }),
            true,
            Some("cred-1"),
        );
        let b = parse_bridge("p1", &spec).expect("snake_case bridge should parse");
        assert_eq!(b.team_id, "team-2");
        assert!(b.poll_inbound && b.outbound_messages && b.outbound_directives && b.outbound_steps);
    }

    #[test]
    fn flags_default_to_off() {
        let spec = spec_from(
            json!({ "teamBridge": true, "teamId": "t", "channel": "C1" }),
            true,
            Some("cred-1"),
        );
        let b = parse_bridge("p1", &spec).unwrap();
        assert!(!b.poll_inbound);
        assert!(!b.outbound_messages);
        assert!(!b.outbound_directives);
        assert!(!b.outbound_steps);
        assert!(!b.has_outbound());
    }

    // --- Echo guard ----------------------------------------------------------

    #[test]
    fn echo_guard_rejects_slack_authored_rows() {
        assert!(is_echo(SLACK_AUTHOR_KIND));
        assert!(!is_echo("persona"));

        let mut b = a_bridge();
        // Every outbound flag on: the guard still wins.
        b.outbound_messages = true;
        b.outbound_directives = true;
        b.outbound_steps = true;
        assert!(!should_mirror_message(&b, SLACK_AUTHOR_KIND));
    }

    // --- Flag matrix ---------------------------------------------------------

    #[test]
    fn outbound_messages_flag_selects_agent_authors() {
        let mut b = a_bridge();
        b.outbound_messages = true;
        b.outbound_directives = false;
        for kind in MESSAGE_AUTHOR_KINDS {
            assert!(should_mirror_message(&b, kind), "{kind} should mirror");
        }
        assert!(!should_mirror_message(&b, "user"));

        b.outbound_messages = false;
        for kind in MESSAGE_AUTHOR_KINDS {
            assert!(!should_mirror_message(&b, kind), "{kind} should be muted");
        }
    }

    #[test]
    fn outbound_directives_flag_selects_user_authors() {
        let mut b = a_bridge();
        b.outbound_messages = false;
        b.outbound_directives = true;
        assert!(should_mirror_message(&b, "user"));
        assert!(!should_mirror_message(&b, "persona"));

        b.outbound_directives = false;
        assert!(!should_mirror_message(&b, "user"));
    }

    #[test]
    fn unknown_author_kind_is_never_mirrored() {
        let mut b = a_bridge();
        b.outbound_messages = true;
        b.outbound_directives = true;
        assert!(!should_mirror_message(&b, "some-future-writer"));
    }

    #[test]
    fn bridge_key_is_team_plus_channel() {
        let b = a_bridge();
        assert_eq!(b.key(), "team-1:C0123ABCD");
    }
}
