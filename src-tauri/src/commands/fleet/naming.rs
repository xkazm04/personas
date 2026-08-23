//! Session naming for Fleet sessions — the CLI `--name` path and the LLM
//! fallback.
//!
//! Claude Code accepts `-n, --name <name>`, which sets the display name in the
//! prompt box, the `/resume` picker, the terminal title AND `claude agents
//! --json` — so a name passed at spawn survives the app being down. That is
//! the primary path: [`cli_safe_label`] derives `athena-<role>` for every
//! dispatched session and `pty::spawn_session_named` passes it as `--name`.
//!
//! The Haiku one-shot below ([`name_session_from_task`]) is now ONLY the
//! fallback for bare spawns that carry no role (and so no CLI name). It is an
//! extra CLI process with a 30 s timeout per session, so `pty.rs` skips it
//! whenever a name was already passed at spawn. (Historically it existed
//! because every headless spawn's OSC title resolved to the generic "Claude
//! Code"; `--name` closed that gap.)

use tauri::AppHandle;

/// Hard cap on the CLI-facing name: short enough to survive an argv round-trip
/// plus a terminal title cleanly (decision: ASCII lowercase-kebab, ≤ 24 chars).
pub const CLI_NAME_MAX_CHARS: usize = 24;

/// Number of session-id characters appended when a CLI name is already taken.
const DISCRIMINATOR_CHARS: usize = 3;

/// Collapse arbitrary text into ASCII lowercase-kebab: runs of
/// non-alphanumerics become a single `-`, leading/trailing dashes are dropped.
fn kebab(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut pending_dash = false;
    for c in raw.chars() {
        if c.is_ascii_alphanumeric() {
            if pending_dash && !out.is_empty() {
                out.push('-');
            }
            pending_dash = false;
            out.push(c.to_ascii_lowercase());
        } else {
            pending_dash = true;
        }
    }
    out
}

fn truncate_kebab(s: &str, max: usize) -> String {
    s.chars()
        .take(max)
        .collect::<String>()
        .trim_end_matches('-')
        .to_string()
}

/// Derive the CLI-safe session name for a dispatched role:
/// `athena-<role>` in ASCII lowercase-kebab, truncated to
/// [`CLI_NAME_MAX_CHARS`], never ending in a dash. The `athena` prefix is
/// sourced from `ATHENA_SESSION_NAME_SENTINEL` because
/// `FleetRegistry::is_athena_owned` prefix-matches it to gate the autonomous
/// `fleet_send_input` / `fleet_kill` paths — it is load-bearing, not
/// decoration. The `·` and project label stay in the registry display name;
/// they are not passed to the CLI.
///
/// Returns an empty string for an empty/unsanitisable role, which the spawn
/// path treats as "no CLI name" (→ Haiku fallback).
pub fn cli_safe_label(role: &str) -> String {
    let role = kebab(role);
    if role.is_empty() {
        return String::new();
    }
    truncate_kebab(
        &format!("{}-{role}", super::registry::ATHENA_SESSION_NAME_SENTINEL),
        CLI_NAME_MAX_CHARS,
    )
}

/// The part of a registry display name that corresponds to the CLI name:
/// everything before the first ` · ` separator
/// (`"athena-writer · personas"` → `"athena-writer"`).
pub fn cli_part_of_display_name(name: &str) -> &str {
    name.split(" · ").next().unwrap_or(name).trim()
}

/// Resolve a collision: if `label` is already in `taken`, append `-<xyz>` where
/// `xyz` is the first [`DISCRIMINATOR_CHARS`] of `session_id`, trimming the
/// base so the result still fits [`CLI_NAME_MAX_CHARS`]. Two live sessions on
/// one machine are both auto-named `kp-5e` today, and two dispatch roles in
/// one operation can collide the same way — the name must stay addressable.
pub fn disambiguate(label: &str, taken: &[String], session_id: &str) -> String {
    if label.is_empty() || !taken.iter().any(|t| t == label) {
        return label.to_string();
    }
    let disc: String = session_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(DISCRIMINATOR_CHARS)
        .collect::<String>()
        .to_ascii_lowercase();
    if disc.is_empty() {
        return label.to_string();
    }
    let base = truncate_kebab(label, CLI_NAME_MAX_CHARS.saturating_sub(disc.len() + 1));
    format!("{base}-{disc}")
}

/// The argv fragment that carries the CLI name: `["--name", label]`, or
/// nothing when the label is empty or the spawn is a `--resume` (a resumed
/// session already has its name; passing another would rename it).
pub fn cli_name_args(label: Option<&str>, spawn_args: &[String]) -> Vec<String> {
    let label = label.map(str::trim).unwrap_or("");
    if label.is_empty() || spawn_args.iter().any(|a| a == "--resume") {
        return Vec::new();
    }
    vec!["--name".to_string(), label.to_string()]
}

/// Cheap, fast model for the one-shot name — mirrors the smart-search default.
const NAMING_MODEL: &str = "claude-haiku-4-5-20251001";
const NAMING_TIMEOUT_SECS: u64 = 30;

/// Extract a clean, short title from the model's raw reply: first non-empty
/// line that isn't stream-json noise, stripped of surrounding quotes/periods,
/// capped to a tab-title length.
///
/// The skip-JSON guard matters because global Claude Code hooks make every
/// headless spawn emit `{"type":"system","subtype":"hook_started",…}` (and
/// thinking/result) lines, which leak into the streamed `text_output`. Without
/// the guard the first line — a hook event — would become the title. We prefer
/// the parsed `result` field upstream; this is the backstop.
fn clean_name(raw: &str) -> String {
    raw.lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with('{') && !l.starts_with('['))
        .unwrap_or("")
        .trim_matches(|c: char| c == '"' || c == '\'' || c == '.' || c.is_whitespace())
        .chars()
        .take(48)
        .collect::<String>()
        .trim()
        .to_string()
}

/// Pull the final answer from a stream-json `result` line — the clean, canonical
/// model output, free of the hook/thinking/system noise that pollutes the
/// streamed `text_output` when global hooks are installed. `None` if the line
/// isn't a parseable object with a string `result`.
fn result_field(result_line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(result_line).ok()?;
    v.get("result")?.as_str().map(str::to_string)
}

/// Claude flags that take a following value — so we don't mistake the value
/// (e.g. the model id after `--model`) for the task prompt.
const VALUE_FLAGS: &[&str] = &[
    "--model",
    // Fleet plans can pick a reasoning level per session; without this entry
    // `medium` would be read as the task prompt and become the session title.
    "--effort",
    "--session-id",
    "--mcp-config",
    "--append-system-prompt-file",
    "--resume",
    "--max-turns",
    "--add-dir",
    // The CLI display name (`-n, --name <name>`); its value is not the task.
    "--name",
];

/// Pull the session's task from its spawn args — the first positional argument,
/// skipping flags and their values. `None` for a bare spawn (no task to name).
pub fn task_from_args(args: &[String]) -> Option<String> {
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if a.starts_with("--") {
            i += if VALUE_FLAGS.contains(&a.as_str()) {
                2
            } else {
                1
            };
        } else {
            let t = a.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
            i += 1;
        }
    }
    None
}

/// Fire-and-forget: ask a cheap model to name this session from its task, then
/// store it as the title and notify the UI. Best-effort — any failure is silent
/// (the tile keeps its project label until something better lands).
pub fn name_session_from_task(app: AppHandle, session_id: String, task: String) {
    tokio::spawn(async move {
        let mut cli_args = crate::engine::prompt::build_cli_args(None, None);
        cli_args.args.push("--model".to_string());
        cli_args.args.push(NAMING_MODEL.to_string());
        cli_args.args.push("--max-turns".to_string());
        cli_args.args.push("1".to_string());

        let prompt = format!(
            "Give a terse 3-5 word Title Case label for this coding/agent session — \
             like a terminal tab title. Output ONLY the label: no quotes, no trailing \
             punctuation, no preamble or explanation. The session's task:\n\n{}",
            task.chars().take(2000).collect::<String>()
        );

        let out = match crate::commands::credentials::ai_artifact_flow::spawn_claude_and_collect(
            &cli_args,
            prompt,
            NAMING_TIMEOUT_SECS,
            |_, _| {},
            None,
        )
        .await
        {
            Ok(out) => out,
            Err(e) => {
                tracing::debug!(session_id = %session_id, error = %e, "fleet name: skipped");
                return;
            }
        };

        // Prefer the canonical `result` field (clean final answer); fall back to
        // the streamed text_output, which clean_name de-noises as a backstop.
        let raw = out
            .result_line
            .as_deref()
            .and_then(result_field)
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| out.text_output.clone());
        let name = clean_name(&raw);
        if name.is_empty() {
            return;
        }
        // `set_title` ignores the generic "Claude Code", so this name sticks.
        if super::registry::registry().set_title(&session_id, &name) {
            super::pty::emit_registry_changed(&app, "updated", &session_id);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        clean_name, cli_name_args, cli_part_of_display_name, cli_safe_label, disambiguate,
        result_field, task_from_args, CLI_NAME_MAX_CHARS,
    };
    use crate::commands::fleet::registry::ATHENA_SESSION_NAME_SENTINEL;

    #[test]
    fn cli_safe_label_is_kebab_and_keeps_the_sentinel_prefix() {
        assert_eq!(
            cli_safe_label("writer"),
            format!("{ATHENA_SESSION_NAME_SENTINEL}-writer")
        );
        // Spaces, case, the registry's `·` and unicode all collapse to kebab.
        assert_eq!(
            cli_safe_label("Code Reviewer · qa"),
            format!("{ATHENA_SESSION_NAME_SENTINEL}-code-reviewer-qa")
        );
        assert_eq!(cli_safe_label("   "), "");
        assert_eq!(cli_safe_label("·"), "");
        for label in [cli_safe_label("writer"), cli_safe_label("QA/Guardian_2")] {
            assert!(label.starts_with(ATHENA_SESSION_NAME_SENTINEL));
            assert!(label
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'));
        }
    }

    #[test]
    fn cli_safe_label_truncates_to_the_cap_without_a_trailing_dash() {
        let long = cli_safe_label("a-very-long-role-name-that-overflows-the-cap");
        assert!(long.chars().count() <= CLI_NAME_MAX_CHARS);
        assert!(!long.ends_with('-'));
        assert!(long.starts_with(ATHENA_SESSION_NAME_SENTINEL));
        // "athena-" is 7 chars; a 17-char role puts a dash exactly at the cut.
        let boundary = cli_safe_label("abcdefghijklmnopq-xyz");
        assert!(!boundary.ends_with('-'));
        assert!(boundary.chars().count() <= CLI_NAME_MAX_CHARS);
    }

    #[test]
    fn disambiguate_appends_session_id_chars_only_on_collision() {
        let taken = vec!["athena-writer".to_string(), "athena-qa".to_string()];
        assert_eq!(
            disambiguate("athena-writer", &taken, "3f2a9c-uuid"),
            "athena-writer-3f2"
        );
        assert_eq!(
            disambiguate("athena-reviewer", &taken, "3f2a9c"),
            "athena-reviewer"
        );
        assert_eq!(disambiguate("", &taken, "3f2a9c"), "");
        // Still within the cap when the base already sits at the cap.
        let full = cli_safe_label("abcdefghijklmnopqrstuvwxyz");
        let out = disambiguate(&full, std::slice::from_ref(&full), "ABC123");
        assert!(out.chars().count() <= CLI_NAME_MAX_CHARS);
        assert!(out.ends_with("-abc"));
        assert!(out.starts_with(ATHENA_SESSION_NAME_SENTINEL));
    }

    #[test]
    fn cli_part_of_display_name_drops_the_project_suffix() {
        assert_eq!(
            cli_part_of_display_name("athena-writer · personas"),
            "athena-writer"
        );
        assert_eq!(cli_part_of_display_name("athena-writer"), "athena-writer");
    }

    #[test]
    fn cli_name_args_omitted_for_empty_label_or_resume() {
        let fresh = vec!["Do the thing".to_string()];
        assert_eq!(
            cli_name_args(Some("athena-writer"), &fresh),
            vec!["--name".to_string(), "athena-writer".to_string()]
        );
        assert!(cli_name_args(None, &fresh).is_empty());
        assert!(cli_name_args(Some("  "), &fresh).is_empty());
        let resumed = vec!["--resume".to_string(), "abc".to_string()];
        assert!(cli_name_args(Some("athena-writer"), &resumed).is_empty());
    }

    #[test]
    fn clean_name_strips_quotes_and_takes_first_line() {
        assert_eq!(
            clean_name("\"Eval Engine Refactor\"\nextra"),
            "Eval Engine Refactor"
        );
        assert_eq!(clean_name("  Auth Bug Fix.  "), "Auth Bug Fix");
        assert_eq!(clean_name(""), "");
    }

    #[test]
    fn clean_name_skips_stream_json_noise() {
        // Global hooks make headless spawns emit system/hook lines first; the
        // real label follows. clean_name must skip the JSON and find the label.
        let polluted = "{\"type\":\"system\",\"subtype\":\"hook_started\",\"hook_id\":\"x\"}\n\
                        {\"type\":\"system\",\"subtype\":\"init\"}\n\
                        JWT Token Authentication Refactor";
        assert_eq!(clean_name(polluted), "JWT Token Authentication Refactor");
        // All-noise (no label line) → empty, so the tile keeps its label.
        assert_eq!(clean_name("{\"type\":\"result\",\"result\":\"x\"}"), "");
    }

    #[test]
    fn result_field_extracts_clean_answer() {
        let line = "{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"JWT Token Authentication Refactor\"}";
        assert_eq!(
            result_field(line),
            Some("JWT Token Authentication Refactor".to_string())
        );
        assert_eq!(result_field("not json"), None);
        assert_eq!(result_field("{\"type\":\"result\"}"), None);
    }

    #[test]
    fn task_from_args_skips_flags_and_their_values() {
        // --model's value (sonnet) is skipped; the task is found.
        assert_eq!(
            task_from_args(&[
                "--model".into(),
                "sonnet".into(),
                "Modularize the eval engine".into()
            ]),
            Some("Modularize the eval engine".into())
        );
        assert_eq!(
            task_from_args(&["Modularize the eval engine".into()]),
            Some("Modularize the eval engine".into())
        );
        // Only flags + values, no task → None.
        assert_eq!(task_from_args(&["--model".into(), "sonnet".into()]), None);
        assert_eq!(task_from_args(&["--resume".into()]), None);
        assert_eq!(task_from_args(&[]), None);
    }
}
