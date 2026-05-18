//! Idempotent installer/uninstaller for the Claude Code hook entries
//! that drive the Fleet plugin.
//!
//! Patches `~/.claude/settings.json`, adding one hook per lifecycle event
//! Fleet cares about. Every entry we add carries a sentinel marker
//! (`"_fleet": true`) so we can uninstall surgically without disturbing
//! user-authored hooks.
//!
//! # Format
//!
//! Claude Code expects hooks in this shape:
//!
//! ```json
//! {
//!   "hooks": {
//!     "Stop": [
//!       { "matcher": "*", "hooks": [
//!         { "type": "command", "command": "curl -s -X POST -d @- ..." }
//!       ]}
//!     ]
//!   }
//! }
//! ```
//!
//! We use `curl` as the universal HTTP client since it ships with every
//! modern Claude Code install context (Windows 10+ includes it; macOS
//! and Linux always). The command POSTs the hook payload via stdin so
//! we never have to escape JSON on the command line.

use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};

use super::types::FleetHookStatus;

/// Hook event names we install. These match the Claude Code hook system's
/// camelCase event names (which become lowercase URL segments on our side).
const FLEET_EVENTS: &[&str] = &[
    "SessionStart",
    "Notification",
    "Stop",
    "PreToolUse",
    // Added for operative memory enrichment — PostToolUse carries the
    // tool_result which lets us flag failures (non-zero exit_code,
    // error_message) and clear the "current_tool" busy line. Without
    // it, Athena's digest would always show sessions stuck at their
    // last tool name with no idea whether it succeeded.
    "PostToolUse",
    "SessionEnd",
    "UserPromptSubmit",
];

const FLEET_MARKER: &str = "_fleet";

/// Return the path to `~/.claude/settings.json`, ensuring the parent
/// directory exists. Returns None if the home directory isn't resolvable
/// (rare — but never panic).
fn settings_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(home.join(".claude").join("settings.json"))
}

/// Read the settings file (or return an empty object if missing/unparseable).
/// We intentionally don't propagate parse errors — a malformed
/// settings.json on the user's machine is theirs to fix, but our installer
/// shouldn't crash on it. We *do* refuse to write back over a malformed
/// file (see [`install_hooks`]).
fn read_settings(path: &PathBuf) -> Result<Value, String> {
    if !path.exists() {
        return Ok(json!({}));
    }
    let s = fs::read_to_string(path).map_err(|e| format!("read settings: {e}"))?;
    if s.trim().is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(&s).map_err(|e| format!("parse settings: {e}"))
}

/// Build the hook command string that CC will invoke. The command POSTs
/// the hook payload on stdin to our local receiver. Port is baked in at
/// install time — if the user restarts the app with a different bound
/// port, [`check_hooks`] surfaces the mismatch.
fn build_command(port: u16, event_lower: &str) -> String {
    // `curl -s -X POST --data-binary @-` reads stdin verbatim and POSTs it.
    // -m 2 = 2-second timeout (we never want hooks to stall the user's CC).
    // ConnectTimeout 1s — localhost should be sub-ms when up.
    format!(
        "curl -s -m 2 --connect-timeout 1 -X POST --data-binary @- \
         -H \"Content-Type: application/json\" \
         http://127.0.0.1:{port}/fleet/hooks/{event_lower}"
    )
}

/// Install (or re-install) the Fleet hook entries.
///
/// Replaces any prior Fleet-tagged entries; preserves every other hook
/// the user has configured. Returns the resulting [`FleetHookStatus`].
pub fn install_hooks(port: u16) -> Result<FleetHookStatus, String> {
    let path = settings_path().ok_or("home directory not resolvable")?;
    let mut settings = read_settings(&path)?;

    // Ensure root object.
    if !settings.is_object() {
        return Err("settings.json root must be a JSON object".into());
    }
    let root = settings
        .as_object_mut()
        .ok_or("settings.json root is not an object")?;

    // Ensure root.hooks is an object.
    let hooks = root
        .entry("hooks".to_string())
        .or_insert_with(|| json!({}));
    if !hooks.is_object() {
        return Err("settings.json `hooks` must be an object".into());
    }
    let hooks_map = hooks
        .as_object_mut()
        .ok_or("settings.json `hooks` is not an object")?;

    for event in FLEET_EVENTS {
        let event_lower = event.to_ascii_lowercase();
        let entry = json!({
            "matcher": "*",
            FLEET_MARKER: true,
            "hooks": [
                {
                    "type": "command",
                    "command": build_command(port, &event_lower),
                    FLEET_MARKER: true,
                }
            ]
        });

        // Get or create the per-event array.
        let arr_value = hooks_map
            .entry(event.to_string())
            .or_insert_with(|| json!([]));
        if !arr_value.is_array() {
            return Err(format!("settings.json hooks.{event} must be an array"));
        }
        let arr = arr_value
            .as_array_mut()
            .ok_or("hooks event array missing")?;

        // Remove any existing fleet-tagged entries so we don't duplicate
        // on re-install (or after a port change).
        arr.retain(|item| !is_fleet_tagged(item));
        arr.push(entry);
    }

    // Ensure parent dir, write atomically.
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create ~/.claude: {e}"))?;
    }
    let pretty = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("serialize settings: {e}"))?;
    fs::write(&path, pretty).map_err(|e| format!("write settings: {e}"))?;

    check_hooks_inner(&settings, port)
}

/// Remove every Fleet-tagged hook entry.
pub fn uninstall_hooks() -> Result<FleetHookStatus, String> {
    let path = settings_path().ok_or("home directory not resolvable")?;
    if !path.exists() {
        return Ok(FleetHookStatus {
            installed: false,
            present_events: vec![],
            missing_events: FLEET_EVENTS.iter().map(|s| s.to_string()).collect(),
            installed_port: None,
            port_matches: false,
        });
    }

    let mut settings = read_settings(&path)?;
    if let Some(hooks_map) = settings
        .get_mut("hooks")
        .and_then(|h| h.as_object_mut())
    {
        for arr_value in hooks_map.values_mut() {
            if let Some(arr) = arr_value.as_array_mut() {
                arr.retain(|item| !is_fleet_tagged(item));
            }
        }
        // Drop empty arrays so the settings file doesn't accumulate cruft.
        hooks_map.retain(|_, v| {
            !v.as_array().map(|a| a.is_empty()).unwrap_or(false)
        });
    }

    let pretty = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("serialize settings: {e}"))?;
    fs::write(&path, pretty).map_err(|e| format!("write settings: {e}"))?;

    Ok(FleetHookStatus {
        installed: false,
        present_events: vec![],
        missing_events: FLEET_EVENTS.iter().map(|s| s.to_string()).collect(),
        installed_port: None,
        port_matches: false,
    })
}

/// Inspect `settings.json` and report the install status. `port` is the
/// currently-bound local_http port — used to compute `port_matches`.
pub fn check_hooks(port: u16) -> Result<FleetHookStatus, String> {
    let path = settings_path().ok_or("home directory not resolvable")?;
    let settings = read_settings(&path)?;
    check_hooks_inner(&settings, port)
}

fn check_hooks_inner(settings: &Value, current_port: u16) -> Result<FleetHookStatus, String> {
    let hooks_map = settings
        .get("hooks")
        .and_then(|h| h.as_object())
        .cloned()
        .unwrap_or_default();

    let mut present = Vec::new();
    let mut installed_port: Option<u16> = None;

    for event in FLEET_EVENTS {
        let Some(arr) = hooks_map.get(*event).and_then(|v| v.as_array()) else {
            continue;
        };
        let has_fleet = arr.iter().any(is_fleet_tagged);
        if !has_fleet {
            continue;
        }
        present.push((*event).to_string());

        // Pull the port out of the curl command so we can detect drift.
        if installed_port.is_none() {
            for entry in arr {
                if !is_fleet_tagged(entry) {
                    continue;
                }
                if let Some(inner_hooks) = entry.get("hooks").and_then(|v| v.as_array()) {
                    for h in inner_hooks {
                        if let Some(cmd) = h.get("command").and_then(|v| v.as_str()) {
                            if let Some(p) = extract_port(cmd) {
                                installed_port = Some(p);
                                break;
                            }
                        }
                    }
                }
                if installed_port.is_some() {
                    break;
                }
            }
        }
    }

    let missing: Vec<String> = FLEET_EVENTS
        .iter()
        .filter(|e| !present.contains(&(**e).to_string()))
        .map(|e| (*e).to_string())
        .collect();

    let installed = !present.is_empty();
    let port_matches = installed_port == Some(current_port);

    Ok(FleetHookStatus {
        installed,
        present_events: present,
        missing_events: missing,
        installed_port,
        port_matches,
    })
}

/// Does this hook entry (or inner command) carry our Fleet marker?
fn is_fleet_tagged(v: &Value) -> bool {
    v.get(FLEET_MARKER)
        .and_then(|m| m.as_bool())
        .unwrap_or(false)
}

/// Parse the port out of the curl command we install. Matches
/// `127.0.0.1:<port>/fleet/`.
fn extract_port(cmd: &str) -> Option<u16> {
    let marker = "127.0.0.1:";
    let start = cmd.find(marker)? + marker.len();
    let tail = &cmd[start..];
    let end = tail.find('/').unwrap_or(tail.len());
    tail[..end].parse::<u16>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_port_works() {
        let cmd = "curl ... http://127.0.0.1:17401/fleet/hooks/stop";
        assert_eq!(extract_port(cmd), Some(17401));
    }

    #[test]
    fn extract_port_missing() {
        assert_eq!(extract_port("nothing here"), None);
    }

    #[test]
    fn fleet_marker_detection() {
        assert!(is_fleet_tagged(&json!({"_fleet": true})));
        assert!(!is_fleet_tagged(&json!({"_fleet": false})));
        assert!(!is_fleet_tagged(&json!({})));
    }

    #[test]
    fn check_handles_empty_settings() {
        let status = check_hooks_inner(&json!({}), 17400).unwrap();
        assert!(!status.installed);
        assert_eq!(status.present_events.len(), 0);
        assert_eq!(status.missing_events.len(), FLEET_EVENTS.len());
    }
}
