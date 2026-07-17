//! Per-persona skill scratchpad — the agent's growable runtime knowledge layer.
//!
//! Inspired by browser-use's "browser harness" walkthrough (research run
//! 2026-05-09): the harness ships a single `helpers.py` file that the agent
//! appends to over time, baking new capabilities into every future run.
//! Personas already has memories (facts) and recipes (user-defined
//! capabilities); this is the third layer — durable per-persona TECHNIQUE
//! notes that the agent itself authors during execution.
//!
//! ## Enablement
//!
//! ON by default, gated by the registered `scratchpad_enabled` setting
//! ([`crate::db::settings_keys::SCRATCHPAD_ENABLED`], default `true`). The
//! setting is read once from the DB at engine startup and cached process-wide
//! via [`seed_enabled_from_settings`]; [`is_enabled`] consults that cache.
//!
//! **Precedence** (highest first):
//! 1. Env var `PERSONAS_SKILL_SCRATCHPAD` — `"1"` forces ON, `"0"` forces OFF
//!    (dev/QA override; wins over the DB setting).
//! 2. The DB-seeded `scratchpad_enabled` setting.
//! 3. Default `true` when neither the env var nor the cache has been set
//!    (e.g. headless/test callers that never seeded).
//!
//! ## File location
//!
//! One file per persona at
//! `{dirs::data_dir()}/com.personas.desktop/skill_scratchpads/{persona_id}.md`.
//! Append-only by convention — the agent edits via plain shell append; no MCP
//! tool is required. The absolute path is exposed inline in the prompt so the
//! agent can `cat >> "..."` directly.
//!
//! ## Rotation
//!
//! The agent appends out-of-band (shell `cat >>`), so the file grows without
//! bound. The engine trims it on the next touch: [`read_for_prompt`] rotates
//! any file over [`MAX_FILE_BYTES`] down to a keep-tail before injecting, so
//! disk (and the source of the injection window) stays bounded across runs.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};

use crate::error::AppError;

/// Env var that overrides the scratchpad enable state. `"1"` forces ON, `"0"`
/// forces OFF; any other/unset value defers to the DB-seeded setting.
pub const SCRATCHPAD_ENV: &str = "PERSONAS_SKILL_SCRATCHPAD";

/// Registered settings key that gates the scratchpad surface. MUST equal
/// [`crate::db::settings_keys::SCRATCHPAD_ENABLED`] — asserted by a unit test
/// (cross-module constant-equality discipline).
pub const SETTING_KEY: &str = "scratchpad_enabled";

/// Subdirectory under app_data where scratchpads live.
const SCRATCHPAD_DIR: &str = "skill_scratchpads";

/// Maximum bytes of scratchpad content to inject into a single prompt to keep
/// token cost bounded. Files larger than this get tail-trimmed for injection
/// (see [`format_injection`]) — this is the PROMPT window, distinct from the
/// on-disk [`MAX_FILE_BYTES`] rotation bound.
const MAX_INJECTION_BYTES: usize = 8 * 1024;

/// On-disk rotation bound. When the scratchpad file exceeds this, the engine
/// rewrites it keeping the most recent [`MAX_FILE_BYTES`] bytes (whole trailing
/// lines) so the file can't grow without limit. Larger than the injection
/// window so several runs' worth of history survives rotation.
const MAX_FILE_BYTES: usize = 64 * 1024;

/// Application-data subdirectory used by all personas storage on this machine.
const APP_DATA_SUBDIR: &str = "com.personas.desktop";

/// Process-global cache of the DB-seeded enable state. `0` = unseeded (fall
/// back to [`DEFAULT_ENABLED`]), `1` = OFF, `2` = ON. Seeded once at engine
/// startup; the env var still overrides it at read time.
static ENABLED_CACHE: AtomicU8 = AtomicU8::new(0);
const CACHE_OFF: u8 = 1;
const CACHE_ON: u8 = 2;

/// Default when neither the env override nor the DB cache resolves — the
/// registered setting's default (ON). Single source of truth with the
/// allowlist so the two can't drift.
const DEFAULT_ENABLED: bool = crate::db::settings_keys::SCRATCHPAD_ENABLED_DEFAULT;

/// Seed the process-global enable cache from an explicit bool. Called by
/// [`seed_enabled_from_settings`]; exposed for tests.
pub fn seed_enabled(enabled: bool) {
    ENABLED_CACHE.store(if enabled { CACHE_ON } else { CACHE_OFF }, Ordering::Relaxed);
}

/// Read the `scratchpad_enabled` setting from the DB and seed the cache. Called
/// once at engine construction. A missing/invalid row keeps [`DEFAULT_ENABLED`].
pub fn seed_enabled_from_settings(pool: &crate::db::DbPool) {
    let enabled = crate::db::repos::core::settings::get(pool, SETTING_KEY)
        .ok()
        .flatten()
        .map(|s| s.trim() != "false")
        .unwrap_or(DEFAULT_ENABLED);
    seed_enabled(enabled);
}

/// True when the scratchpad surface is enabled. Env var wins (`"1"`/`"0"`),
/// else the DB-seeded cache, else [`DEFAULT_ENABLED`]. See the module-level
/// "Enablement" doc for the full precedence contract.
pub fn is_enabled() -> bool {
    match std::env::var(SCRATCHPAD_ENV).ok().as_deref() {
        Some("1") => return true,
        Some("0") => return false,
        _ => {}
    }
    match ENABLED_CACHE.load(Ordering::Relaxed) {
        CACHE_ON => true,
        CACHE_OFF => false,
        _ => DEFAULT_ENABLED,
    }
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
    // Rotate on touch: the agent appends out-of-band, so bound the file here
    // before reading it for injection. Best-effort — a rotation failure never
    // blocks the read.
    rotate_if_needed(&path);
    let content = std::fs::read_to_string(&path).ok()?;
    if content.trim().is_empty() {
        return None;
    }
    Some((
        path.to_string_lossy().into_owned(),
        format_injection(&content),
    ))
}

/// Trim the on-disk scratchpad to [`MAX_FILE_BYTES`] keep-tail when it grows
/// past the bound, preserving whole trailing lines and prepending a marker so
/// the reader knows older entries were rotated out. No-op when the file is
/// missing or within bounds. Best-effort: any I/O error is swallowed (the caller
/// still reads whatever is on disk).
fn rotate_if_needed(path: &Path) {
    let Ok(content) = std::fs::read_to_string(path) else {
        return;
    };
    if content.len() <= MAX_FILE_BYTES {
        return;
    }
    let cut = content.len() - MAX_FILE_BYTES;
    let trailing = &content[cut..];
    // Start at a line boundary so a rotated file never opens mid-line.
    let tail = trailing
        .find('\n')
        .map(|i| &trailing[i + 1..])
        .unwrap_or(trailing);
    let rotated = format!(
        "_(scratchpad rotated — older entries trimmed to keep the file under {} KB)_\n\n{}",
        MAX_FILE_BYTES / 1024,
        tail
    );
    if let Err(e) = std::fs::write(path, rotated) {
        tracing::warn!(
            error = %e,
            path = %path.display(),
            "skill_scratchpad: rotation write failed (non-fatal)"
        );
    }
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
    fn setting_key_matches_settings_keys_constant() {
        // Cross-module constant-equality discipline (round-10 P1): the key this
        // module reads MUST equal the one registered in the allowlist, or the
        // seeded read would silently miss and set() would reject the toggle.
        assert_eq!(SETTING_KEY, crate::db::settings_keys::SCRATCHPAD_ENABLED);
    }

    #[test]
    fn is_enabled_defaults_on_when_env_unset_and_cache_unset() {
        // SAFETY: tests in this crate do not run in parallel with other tests
        // touching the same env var. The cache is left unseeded here, so the
        // DEFAULT_ENABLED (true) applies — the feature now ships ON.
        std::env::remove_var(SCRATCHPAD_ENV);
        assert!(is_enabled());
    }

    #[test]
    fn env_var_overrides_both_ways() {
        std::env::set_var(SCRATCHPAD_ENV, "1");
        assert!(is_enabled());
        std::env::set_var(SCRATCHPAD_ENV, "0");
        assert!(!is_enabled());
        std::env::remove_var(SCRATCHPAD_ENV);
    }

    #[test]
    fn seed_enabled_toggles_cache_when_env_unset() {
        std::env::remove_var(SCRATCHPAD_ENV);
        seed_enabled(false);
        assert!(!is_enabled());
        seed_enabled(true);
        assert!(is_enabled());
        // Reset the process-global cache so sibling tests see the unseeded
        // default. (AtomicU8 has no "unset" store helper; re-store the default.)
        seed_enabled(true);
    }

    #[test]
    fn rotate_if_needed_trims_oversized_file_keeping_tail() {
        use std::io::Write;
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("scratch.md");
        let mut f = std::fs::File::create(&path).expect("create");
        // Write well over the bound as many short lines so tail-trim has line
        // boundaries to snap to; include a unique marker near the end.
        for i in 0..(MAX_FILE_BYTES / 8 + 2000) {
            writeln!(f, "line {i}").expect("write");
        }
        writeln!(f, "UNIQUE_TAIL_MARKER").expect("write");
        drop(f);
        assert!(std::fs::metadata(&path).unwrap().len() as usize > MAX_FILE_BYTES);

        rotate_if_needed(&path);

        let after = std::fs::read_to_string(&path).expect("read");
        assert!(after.len() <= MAX_FILE_BYTES + 128, "rotated file within bound + marker");
        assert!(after.starts_with("_(scratchpad rotated"), "rotation marker present");
        assert!(after.contains("UNIQUE_TAIL_MARKER"), "most-recent tail preserved");
    }

    #[test]
    fn rotate_if_needed_noop_when_small() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("scratch.md");
        std::fs::write(&path, "## small\nnote").expect("write");
        rotate_if_needed(&path);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "## small\nnote");
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
        // Force OFF via the env override (default is now ON).
        std::env::set_var(SCRATCHPAD_ENV, "0");
        assert!(read_for_prompt("any-persona").is_none());
        std::env::remove_var(SCRATCHPAD_ENV);
    }

    #[test]
    fn read_for_prompt_returns_none_for_empty_id() {
        std::env::set_var(SCRATCHPAD_ENV, "1");
        assert!(read_for_prompt("").is_none());
        std::env::remove_var(SCRATCHPAD_ENV);
    }

    #[test]
    fn appended_note_survives_to_next_prompt_build() {
        // Simulate the agent appending a technique, then a later run building
        // its prompt: the note must be read back and injected. Skips gracefully
        // when the sandbox has no data_dir (scratchpad_path would err).
        std::env::set_var(SCRATCHPAD_ENV, "1");
        let persona_id = format!("test-scratchpad-{}", std::process::id());
        let Ok(path) = scratchpad_path(&persona_id) else {
            std::env::remove_var(SCRATCHPAD_ENV);
            return;
        };
        let _ = std::fs::remove_file(&path);
        std::fs::write(&path, "## How to ping\nUse curl -sS.\n").expect("seed note");

        let injected = read_for_prompt(&persona_id);
        // Cleanup before asserting so a failure never leaks the fixture file.
        let _ = std::fs::remove_file(&path);
        std::env::remove_var(SCRATCHPAD_ENV);

        let (returned_path, body) = injected.expect("note should be read back");
        assert_eq!(returned_path, path.to_string_lossy());
        assert!(body.contains("How to ping"));
        assert!(body.contains("curl -sS"));
    }
}
