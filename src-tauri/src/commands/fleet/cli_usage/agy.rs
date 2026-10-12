//! Antigravity (`agy`) usage, read from the CLI's own `/quota` command.
//!
//! `agy -p "/quota" --output-format json` answers locally: no agent turn, no
//! tokens, no quota spent (`num_turns: 0`; the CLI's changelog says `/usage`,
//! `/quota` and `/credits` are free in print mode). It reports, per MODEL GROUP
//! ("Gemini Models", "Claude and GPT models"), a 5-hour and a weekly bucket as a
//! `remaining_fraction` with an absolute UTC reset - which is exactly the
//! two-window grammar the strip already paints, one plan per group.
//!
//! The payload is an UNDOCUMENTED shape of agy (observed 2026-10-12). It is read
//! defensively: anything that stops matching is a card `reason`, never an error.
//!
//! HARD RULES this file keeps:
//! * the argv is an array and the prompt is `/quota` verbatim. A SHELL on
//!   Windows (Git Bash / MSYS) rewrites a leading slash into a path and the CLI
//!   would then send a real prompt to the model, once per poll. Spawn through
//!   `capture_output` only.
//! * `num_turns` must be 0. A reply that spent a turn is discarded and the card
//!   says `unreadable` - the poll must never bill the user.
//! * it never opens `oauth_creds.json` or any token, and never logs the reply
//!   (the account email can appear in agy's own logs, not in this payload, but
//!   nothing here needs the text).

use std::ffi::OsString;
use std::path::PathBuf;

use serde_json::Value;

use super::super::claude_usage::now_ms;
use super::{CliProvider, CliProviderUsage, CliUsageReason, CliUsageWindow};

/// The prompt that makes agy print its quota without a model turn.
pub const QUOTA_PROMPT: &str = "/quota";
/// `--output-format json` carries the structured `command.data` object; the
/// plain output is tab-separated text with the same numbers.
pub const QUOTA_ARGS: [&str; 4] = ["-p", QUOTA_PROMPT, "--output-format", "json"];

const FIVE_HOUR_MINUTES: i64 = 5 * 60;
const WEEK_MINUTES: i64 = 7 * 24 * 60;

/// Where agy's binary lives: `PERSONAS_AGY_EXE`, then the installer's
/// `%LOCALAPPDATA%\agy\bin`, then `~/.local/bin`, then PATH.
pub fn resolve_agy_exe() -> Option<PathBuf> {
    resolve_agy_exe_from(
        std::env::var_os("PERSONAS_AGY_EXE"),
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
        dirs::home_dir(),
        std::env::var_os("PATH"),
    )
}

/// The pure core of [`resolve_agy_exe`]: inputs injected, no env mutation in tests.
pub fn resolve_agy_exe_from(
    env_override: Option<OsString>,
    local_app_data: Option<PathBuf>,
    home: Option<PathBuf>,
    path: Option<OsString>,
) -> Option<PathBuf> {
    let exe_name = if cfg!(windows) { "agy.exe" } else { "agy" };
    if let Some(p) = env_override {
        let p = PathBuf::from(p);
        return p.is_file().then_some(p);
    }
    let known = [
        local_app_data.map(|d| d.join("agy").join("bin").join(exe_name)),
        home.map(|h| h.join(".local").join("bin").join(exe_name)),
    ];
    if let Some(p) = known.into_iter().flatten().find(|p| p.is_file()) {
        return Some(p);
    }
    let path = path?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(exe_name))
        .find(|p| p.is_file())
}

/// `"5h"` / `"weekly"` to minutes. An unknown window is skipped, not guessed.
fn window_minutes(window: &str) -> Option<i64> {
    match window {
        "5h" => Some(FIVE_HOUR_MINUTES),
        "weekly" => Some(WEEK_MINUTES),
        _ => None,
    }
}

fn reset_ms(bucket: &Value) -> Option<i64> {
    let s = bucket.get("reset_time")?.as_str()?;
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.timestamp_millis())
}

/// One group's buckets as windows, `group` stamped on each so the strip can
/// make a plan per group.
fn group_windows(group: &Value) -> Vec<CliUsageWindow> {
    let name = group.get("name").and_then(Value::as_str).map(str::trim);
    let Some(name) = name.filter(|n| !n.is_empty()) else {
        return Vec::new();
    };
    group
        .get("buckets")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|b| {
            let minutes = window_minutes(b.get("window")?.as_str()?)?;
            let remaining = b.get("remaining_fraction")?.as_f64()?;
            if !remaining.is_finite() {
                return None;
            }
            // Used, never left: the strip's one vocabulary. Clamped because a
            // fraction a hair outside 0..1 must not paint a negative bar.
            let used = ((1.0 - remaining) * 100.0).clamp(0.0, 100.0);
            let id = b.get("id").and_then(Value::as_str).unwrap_or("bucket");
            Some(CliUsageWindow {
                key: id.to_string(),
                window_minutes: minutes,
                used_percent: used,
                resets_at_ms: reset_ms(b),
                group: Some(name.to_string()),
            })
        })
        .collect()
}

/// Shape agy's `/quota` JSON reply into a card. Pure: the spawn is the
/// caller's, so format drift and the no-turn rule are pinned by tests.
pub fn card_from_reply(stdout: &str, now_ms: i64) -> CliProviderUsage {
    let unreadable =
        || CliProviderUsage::absent(CliProvider::Agy, true, CliUsageReason::Unreadable);
    let Ok(reply) = serde_json::from_str::<Value>(stdout.trim()) else {
        return unreadable();
    };
    // A reply that spent a turn means `/quota` went to the model: the poll
    // would bill the user every minute. Never trust its numbers either.
    if reply.get("num_turns").and_then(Value::as_i64) != Some(0) {
        return unreadable();
    }
    let groups = reply
        .pointer("/command/data/groups")
        .and_then(Value::as_array);
    let windows: Vec<CliUsageWindow> = groups
        .into_iter()
        .flatten()
        .flat_map(group_windows)
        .collect();
    if windows.is_empty() {
        return unreadable();
    }
    CliProviderUsage {
        provider: CliProvider::Agy,
        installed: true,
        version: None,
        plan_type: None,
        windows,
        as_of_ms: Some(now_ms),
        projected: false,
        reason: None,
    }
}

/// [`card_from_reply`] with the wall clock.
pub fn card_from_reply_now(stdout: &str) -> CliProviderUsage {
    card_from_reply(stdout, now_ms())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The reply observed on 2026-10-12 (description strings trimmed).
    const REPLY: &str = r#"{"conversation_id":"","status":"SUCCESS","response":"x","duration_seconds":0,"num_turns":0,
      "usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":0},
      "command":{"name":"usage","data":{"description":"d","groups":[
        {"name":"Gemini Models","buckets":[
          {"id":"gemini-weekly","name":"Weekly Limit Remaining","window":"weekly","remaining_fraction":0.9992309212684631,"reset_time":"2026-10-19T10:06:22Z"},
          {"id":"gemini-5h","name":"Five Hour Limit Remaining","window":"5h","remaining_fraction":0.25,"reset_time":"2026-10-12T15:06:22Z"}]},
        {"name":"Claude and GPT models","buckets":[
          {"id":"3p-weekly","window":"weekly","remaining_fraction":1,"reset_time":"2026-10-18T20:04:58Z"},
          {"id":"3p-5h","window":"5h","remaining_fraction":1,"reset_time":"2026-10-12T15:26:12Z"}]}]}}}"#;

    #[test]
    fn the_observed_reply_becomes_two_groups_of_two_windows() {
        let card = card_from_reply(REPLY, 42);
        assert_eq!(card.provider, CliProvider::Agy);
        assert!(card.installed && card.reason.is_none() && !card.projected);
        assert_eq!(card.as_of_ms, Some(42));
        assert_eq!(card.windows.len(), 4);
        let g5 = &card.windows[1];
        assert_eq!(g5.key, "gemini-5h");
        assert_eq!(g5.group.as_deref(), Some("Gemini Models"));
        assert_eq!(g5.window_minutes, 300);
        assert!((g5.used_percent - 75.0).abs() < 1e-9);
        assert_eq!(g5.resets_at_ms, Some(1_791_817_582_000));
        assert_eq!(card.windows[0].window_minutes, 10_080);
        assert_eq!(
            card.windows[3].group.as_deref(),
            Some("Claude and GPT models")
        );
        assert_eq!(card.windows[3].used_percent, 0.0);
    }

    #[test]
    fn a_reply_that_spent_a_turn_is_never_trusted() {
        let billed = REPLY.replace("\"num_turns\":0", "\"num_turns\":1");
        let card = card_from_reply(&billed, 1);
        assert_eq!(card.reason, Some(CliUsageReason::Unreadable));
        assert!(card.windows.is_empty());
        // And a reply with no num_turns at all is the same: absence is not zero.
        let none = REPLY.replace("\"num_turns\":0,", "");
        assert_eq!(
            card_from_reply(&none, 1).reason,
            Some(CliUsageReason::Unreadable)
        );
    }

    #[test]
    fn drift_degrades_to_a_reason_not_a_panic() {
        for bad in [
            "",
            "not json",
            "{}",
            r#"{"num_turns":0}"#,
            r#"{"num_turns":0,"command":{"data":{"groups":[]}}}"#,
        ] {
            assert_eq!(
                card_from_reply(bad, 1).reason,
                Some(CliUsageReason::Unreadable),
                "{bad}"
            );
        }
    }

    #[test]
    fn unknown_windows_and_out_of_range_fractions_are_handled() {
        let odd = r#"{"num_turns":0,"command":{"data":{"groups":[{"name":"G","buckets":[
            {"id":"a","window":"monthly","remaining_fraction":0.5},
            {"id":"b","window":"5h","remaining_fraction":1.2},
            {"id":"c","window":"weekly","remaining_fraction":-0.3,"reset_time":"garbage"}]}]}}}"#;
        let card = card_from_reply(odd, 1);
        assert_eq!(card.windows.len(), 2);
        assert_eq!(card.windows[0].used_percent, 0.0);
        assert_eq!(card.windows[1].used_percent, 100.0);
        assert_eq!(card.windows[1].resets_at_ms, None);
    }

    #[test]
    fn the_exe_ladder_prefers_the_override_and_never_falls_through_it() {
        let dir = std::env::temp_dir().join(format!("agy-ladder-{}", std::process::id()));
        let bin = dir.join("agy").join("bin");
        std::fs::create_dir_all(&bin).expect("mkdir");
        let name = if cfg!(windows) { "agy.exe" } else { "agy" };
        std::fs::write(bin.join(name), b"").expect("write");

        let found = resolve_agy_exe_from(None, Some(dir.clone()), None, None);
        assert_eq!(found, Some(bin.join(name)));
        // An override that does not exist is "not installed", not "try the next rung".
        let missing = resolve_agy_exe_from(Some("nope".into()), Some(dir.clone()), None, None);
        assert_eq!(missing, None);
        std::fs::remove_dir_all(&dir).ok();
    }
}
