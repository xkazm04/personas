//! Per-persona skill scratchpad — the agent's growable runtime knowledge layer.
//!
//! Inspired by browser-use's "browser harness" walkthrough (research run
//! 2026-05-09): the harness ships a single `helpers.py` file that the agent
//! appends to over time, baking new capabilities into every future run.
//! Personas already has memories (facts) and recipes (user-defined
//! capabilities); this is the third layer — durable per-persona TECHNIQUE
//! notes that the agent itself authors during execution.
//!
//! ## Safety
//!
//! Opt-in via env var `PERSONAS_SKILL_SCRATCHPAD=1` while the feature bakes.
//! When unset, every entry point is a complete no-op. This mirrors the
//! `hooks_sidecar` opt-in pattern.
//!
//! ## File location
//!
//! One file per persona at
//! `{dirs::data_dir()}/com.personas.desktop/skill_scratchpads/{persona_id}.md`.
//! Append-only by convention — the agent edits via plain shell append; no MCP
//! tool is required. The absolute path is exposed inline in the prompt so the
//! agent can `cat >> "..."` directly.
//!
//! ## Test-run guard (deferred)
//!
//! The env-var being set is the user's explicit opt-in; lab/eval/genome/test
//! callers control whether to set it for a given run. A finer-grained
//! per-execution suppression is deferred to a future iteration — this v1
//! intentionally trusts the env var as the single switch.

use std::path::PathBuf;

use crate::error::AppError;

/// Env var that gates the entire scratchpad surface. Unset → no-op.
pub const SCRATCHPAD_ENV: &str = "PERSONAS_SKILL_SCRATCHPAD";

/// Subdirectory under app_data where scratchpads live.
const SCRATCHPAD_DIR: &str = "skill_scratchpads";

/// Maximum bytes of scratchpad content to inject into a single prompt to keep
/// token cost bounded. Files larger than this get tail-trimmed.
const MAX_INJECTION_BYTES: usize = 8 * 1024;

/// Application-data subdirectory used by all personas storage on this machine.
const APP_DATA_SUBDIR: &str = "com.personas.desktop";

/// True when the scratchpad surface is enabled.
pub fn is_enabled() -> bool {
    std::env::var(SCRATCHPAD_ENV).ok().as_deref() == Some("1")
}

/// Resolve the scratchpad path for a persona. Creates the parent directory if
/// missing. Does NOT create the file itself.
pub fn scratchpad_path(persona_id: &str) -> Result<PathBuf, AppError> {
    let base = dirs::data_dir()
        .ok_or_else(|| AppError::Internal("dirs::data_dir() unavailable".into()))?
        .join(APP_DATA_SUBDIR)
        .join(SCRATCHPAD_DIR);
    std::fs::create_dir_all(&base)?;
    let safe_id = sanitize_id(persona_id);
    Ok(base.join(format!("{safe_id}.md")))
}

/// Read the persona's scratchpad and return a `(absolute_path, content)`
/// tuple ready for prompt injection. Returns `None` when the feature is
/// disabled, the persona id is empty, or the file is missing/empty/unreadable.
/// Tail-trims large files so prompt cost stays bounded.
pub fn read_for_prompt(persona_id: &str) -> Option<(String, String)> {
    if !is_enabled() {
        return None;
    }
    if persona_id.is_empty() {
        return None;
    }
    let path = scratchpad_path(persona_id).ok()?;
    let content = std::fs::read_to_string(&path).ok()?;
    if content.trim().is_empty() {
        return None;
    }
    Some((
        path.to_string_lossy().into_owned(),
        format_injection(&content),
    ))
}

/// Tail-trim a scratchpad body that exceeds the budget, prepending a marker
/// so the agent knows the view is partial.
fn format_injection(content: &str) -> String {
    if content.len() <= MAX_INJECTION_BYTES {
        return content.to_string();
    }
    let cut = content.len() - MAX_INJECTION_BYTES;
    let trailing = &content[cut..];
    let trimmed = trailing
        .find('\n')
        .map(|i| &trailing[i + 1..])
        .unwrap_or(trailing);
    format!(
        "_(scratchpad truncated — showing the most recent {} bytes of {} total; older entries are in the file)_\n\n{}",
        trimmed.len(),
        content.len(),
        trimmed
    )
}

/// Strip everything that isn't `[A-Za-z0-9_-]` from a persona id so it's safe
/// to use as a filename component on every supported OS.
fn sanitize_id(persona_id: &str) -> String {
    let cleaned: String = persona_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "_unknown".to_string()
    } else {
        cleaned
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_enabled_false_when_env_unset() {
        // SAFETY: tests in this crate do not run in parallel with other tests
        // touching the same env var.
        std::env::remove_var(SCRATCHPAD_ENV);
        assert!(!is_enabled());
    }

    #[test]
    fn is_enabled_true_when_env_set_to_1() {
        std::env::set_var(SCRATCHPAD_ENV, "1");
        assert!(is_enabled());
        std::env::remove_var(SCRATCHPAD_ENV);
    }

    #[test]
    fn sanitize_id_keeps_safe_chars() {
        assert_eq!(sanitize_id("abc-123_xyz"), "abc-123_xyz");
    }

    #[test]
    fn sanitize_id_replaces_bad_chars() {
        assert_eq!(sanitize_id("a/b\\c..d"), "a_b_c__d");
    }

    #[test]
    fn sanitize_id_handles_empty() {
        assert_eq!(sanitize_id(""), "_unknown");
        assert_eq!(sanitize_id("///"), "___");
    }

    #[test]
    fn format_injection_passthrough_when_small() {
        let small = "## Skill A\nhello";
        assert_eq!(format_injection(small), small);
    }

    #[test]
    fn format_injection_truncates_when_large() {
        let big = "x".repeat(MAX_INJECTION_BYTES + 1024);
        let out = format_injection(&big);
        assert!(out.starts_with("_(scratchpad truncated"));
        assert!(out.len() < big.len());
    }

    #[test]
    fn read_for_prompt_returns_none_when_disabled() {
        std::env::remove_var(SCRATCHPAD_ENV);
        assert!(read_for_prompt("any-persona").is_none());
    }

    #[test]
    fn read_for_prompt_returns_none_for_empty_id() {
        std::env::set_var(SCRATCHPAD_ENV, "1");
        assert!(read_for_prompt("").is_none());
        std::env::remove_var(SCRATCHPAD_ENV);
    }
}
