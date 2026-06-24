//! One-shot LLM naming for Fleet sessions.
//!
//! Claude Code's OSC terminal title resolves to the generic "Claude Code" for
//! every headless spawn, so each tile would read the same. Instead, when a
//! session is spawned with a task we ask a cheap model (Haiku) for a terse 3-5
//! word label and store it as the session's `title`. Fire-and-forget and
//! UI-independent — it labels the session whether or not anyone is watching it.

use tauri::AppHandle;

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
    "--session-id",
    "--mcp-config",
    "--append-system-prompt-file",
    "--resume",
    "--max-turns",
    "--add-dir",
];

/// Pull the session's task from its spawn args — the first positional argument,
/// skipping flags and their values. `None` for a bare spawn (no task to name).
pub fn task_from_args(args: &[String]) -> Option<String> {
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if a.starts_with("--") {
            i += if VALUE_FLAGS.contains(&a.as_str()) { 2 } else { 1 };
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
    use super::{clean_name, result_field, task_from_args};

    #[test]
    fn clean_name_strips_quotes_and_takes_first_line() {
        assert_eq!(clean_name("\"Eval Engine Refactor\"\nextra"), "Eval Engine Refactor");
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
        assert_eq!(result_field(line), Some("JWT Token Authentication Refactor".to_string()));
        assert_eq!(result_field("not json"), None);
        assert_eq!(result_field("{\"type\":\"result\"}"), None);
    }

    #[test]
    fn task_from_args_skips_flags_and_their_values() {
        // --model's value (sonnet) is skipped; the task is found.
        assert_eq!(
            task_from_args(&["--model".into(), "sonnet".into(), "Modularize the eval engine".into()]),
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
