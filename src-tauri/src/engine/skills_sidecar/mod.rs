//! Per-connector `.claude/skills/` SKILL.md writer.
//!
//! Sibling to `hooks_sidecar.rs`. See `DESIGN.md` for the full rationale and
//! design space. Short version: today the system prompt eagerly bakes every
//! bound connector's `llm_usage_hint` body into a `## Connector Usage Reference`
//! section. This module instead writes a per-connector `SKILL.md` file into
//! `exec_dir/.claude/skills/personas-connector-<slug>/`, so Claude Code's
//! native skill discovery handles the lazy-load and the system prompt section
//! shrinks to a list of names + skill pointers.
//!
//! ## Lockstep with `prompt::assemble_prompt`
//!
//! Both this module and `engine/prompt/mod.rs` read `PERSONAS_SKILLS_SIDECAR`.
//! Set on the runner side → write skill files. Set on the prompt side → render
//! the shrunken section. Both must read the same env var at the same time;
//! the runner is the only writer, so external callers of `assemble_prompt`
//! that don't write to `exec_dir` should not have the env set.

use std::path::{Path, PathBuf};

use crate::engine::prompt::ResolvedConnectorHint;
use crate::error::AppError;

/// Env var that gates the sidecar write AND the prompt-section shrink. Unset
/// → both are no-ops.
pub const SIDECAR_ENV: &str = "PERSONAS_SKILLS_SIDECAR";

/// Skill folder prefix — chosen to avoid colliding with user-authored skills
/// the user might already have in `.claude/skills/`.
const SKILL_PREFIX: &str = "personas-connector-";

/// Returns true when the sidecar feature is enabled via env var.
pub fn is_enabled() -> bool {
    std::env::var(SIDECAR_ENV).ok().as_deref() == Some("1")
}

/// Build the skill folder name for a given connector name. Lower-cases and
/// replaces underscores/whitespace with hyphens; characters outside
/// `[a-z0-9-]` are dropped.
fn slug_for_connector_name(name: &str) -> String {
    let lowered = name.to_ascii_lowercase();
    let mut out = String::with_capacity(lowered.len());
    for ch in lowered.chars() {
        match ch {
            'a'..='z' | '0'..='9' => out.push(ch),
            '_' | ' ' | '\t' => out.push('-'),
            '-' => out.push('-'),
            _ => {} // drop anything else (parentheses, slashes, etc.)
        }
    }
    // Collapse repeated hyphens.
    let mut collapsed = String::with_capacity(out.len());
    let mut prev_hyphen = false;
    for ch in out.chars() {
        if ch == '-' {
            if !prev_hyphen {
                collapsed.push(ch);
            }
            prev_hyphen = true;
        } else {
            collapsed.push(ch);
            prev_hyphen = false;
        }
    }
    // Trim leading/trailing hyphens.
    collapsed.trim_matches('-').to_string()
}

/// Skill folder name (full, with prefix).
pub fn skill_folder_name(connector_name: &str) -> String {
    format!("{SKILL_PREFIX}{}", slug_for_connector_name(connector_name))
}

/// Render the SKILL.md body for one connector hint. Pure function for unit
/// tests; the writer is a thin wrapper.
pub fn build_skill_md(hint: &ResolvedConnectorHint) -> String {
    let mut out = String::new();

    // YAML frontmatter — Claude Code's native skill discovery reads `name`
    // and `description` to enrol the skill into the system prompt's skill
    // catalog, so the agent can match it by relevance. Without frontmatter,
    // the SKILL.md is loadable but loses the auto-trigger affordance.
    let folder = skill_folder_name(&hint.name);
    let description = build_skill_description(hint);
    out.push_str("---\n");
    out.push_str(&format!("name: {folder}\n"));
    out.push_str(&format!(
        "description: \"{}\"\n",
        escape_yaml_double_quoted(&description)
    ));
    out.push_str("---\n\n");

    out.push_str(&format!("# {}\n\n", hint.label));
    out.push_str(&format!(
        "Use this skill when the persona's task involves **{}**.\n\n",
        hint.label
    ));
    out.push_str("## Overview\n\n");
    out.push_str(hint.hint.overview.trim());
    out.push_str("\n\n");

    if !hint.hint.examples.is_empty() {
        out.push_str("## Examples\n\n");
        for example in &hint.hint.examples {
            out.push_str("```\n");
            out.push_str(example.trim_end());
            out.push('\n');
            out.push_str("```\n\n");
        }
    }

    if let Some(gotchas) = &hint.hint.gotchas {
        if !gotchas.is_empty() {
            out.push_str("## Gotchas\n\n");
            for g in gotchas {
                out.push_str(&format!("- {}\n", g.trim()));
            }
            out.push('\n');
        }
    }

    out.push_str("## How to invoke\n\n");
    out.push_str(
        "Authenticated calls go through the credential proxy described in your \
         system prompt's `## Available Credentials` section — POST to \
         `$PERSONAS_PROXY_URL/<credential_id>` with Bearer auth from \
         `$PERSONAS_PROXY_KEY`. Credential secrets are NOT in the environment.\n",
    );

    out
}

/// Write one `SKILL.md` file per connector hint into
/// `exec_dir/.claude/skills/personas-connector-<slug>/SKILL.md`.
///
/// Reads `PERSONAS_SKILLS_SIDECAR` and short-circuits to `Ok(false)` when
/// unset — the caller does not need to branch on the env check itself.
/// Returns `Ok(true)` after writing at least one file. Returns
/// `Ok(false)` when no hints were passed.
///
/// This is best-effort: an I/O failure on a single file is logged and
/// skipped, never propagated. Skill discovery is a nice-to-have, not a hard
/// requirement, mirroring the philosophy of `hooks_sidecar`.
pub fn install_sidecar(
    exec_dir: &Path,
    hints: &[ResolvedConnectorHint],
) -> Result<bool, AppError> {
    install_sidecar_inner(exec_dir, hints, is_enabled())
}

/// Inner implementation that takes the enable decision explicitly. Pulled
/// out so unit tests don't need to mutate process-global env state, which
/// races under cargo's parallel test runner.
fn install_sidecar_inner(
    exec_dir: &Path,
    hints: &[ResolvedConnectorHint],
    enabled: bool,
) -> Result<bool, AppError> {
    if !enabled {
        return Ok(false);
    }

    if hints.is_empty() {
        tracing::debug!("skills_sidecar: no connector hints to write — skipping");
        return Ok(false);
    }

    let skills_root = exec_dir.join(".claude").join("skills");
    if let Err(e) = std::fs::create_dir_all(&skills_root) {
        tracing::warn!(
            error = %e,
            dir = %skills_root.display(),
            "skills_sidecar: failed to create .claude/skills/ — skipping sidecar"
        );
        return Ok(false);
    }

    let mut wrote_any = false;
    for hint in hints {
        let folder_name = skill_folder_name(&hint.name);
        let folder_path = skills_root.join(&folder_name);
        if let Err(e) = std::fs::create_dir_all(&folder_path) {
            tracing::warn!(
                error = %e,
                dir = %folder_path.display(),
                connector = %hint.name,
                "skills_sidecar: failed to create skill folder — skipping connector"
            );
            continue;
        }

        let skill_md_path = folder_path.join("SKILL.md");
        let body = build_skill_md(hint);
        match std::fs::write(&skill_md_path, body) {
            Ok(()) => {
                wrote_any = true;
                tracing::debug!(
                    path = %skill_md_path.display(),
                    connector = %hint.name,
                    "skills_sidecar: wrote SKILL.md"
                );
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    path = %skill_md_path.display(),
                    connector = %hint.name,
                    "skills_sidecar: failed to write SKILL.md — skipping connector"
                );
            }
        }
    }

    Ok(wrote_any)
}

/// Compose a one-line description for the YAML frontmatter. Seeds from
/// `hint.label` and the first sentence of `hint.hint.overview`. Capped at
/// ~140 chars so the skill catalog stays readable in the system prompt.
fn build_skill_description(hint: &ResolvedConnectorHint) -> String {
    let overview = hint.hint.overview.trim();
    let first_sentence = overview
        .split(&['.', '\n'][..])
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| hint.label.as_str());
    let raw = format!("Use when working with {}: {}.", hint.label, first_sentence);

    if raw.chars().count() <= 140 {
        raw
    } else {
        let truncated: String = raw.chars().take(137).collect();
        format!("{truncated}...")
    }
}

/// Escape a string for use as a YAML double-quoted scalar value. Only the
/// two YAML-meaningful characters need escaping (`\` and `"`); newlines
/// collapse to spaces so the description stays on one line.
fn escape_yaml_double_quoted(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' | '\r' | '\t' => out.push(' '),
            other => out.push(other),
        }
    }
    out
}

/// Convenience: where a given connector's SKILL.md would live for an
/// `exec_dir`. Used by the test suite and available for direct callers.
#[allow(dead_code)]
pub fn skill_md_path(exec_dir: &Path, connector_name: &str) -> PathBuf {
    exec_dir
        .join(".claude")
        .join("skills")
        .join(skill_folder_name(connector_name))
        .join("SKILL.md")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::LlmUsageHint;
    use tempfile::tempdir;

    fn sample_hint() -> ResolvedConnectorHint {
        ResolvedConnectorHint {
            name: "github".to_string(),
            label: "GitHub".to_string(),
            hint: LlmUsageHint {
                overview: "GitHub REST API v3 — repos, issues, PRs.".to_string(),
                examples: vec![
                    "curl -H \"Authorization: Bearer $TOKEN\" https://api.github.com/repos/x/y"
                        .to_string(),
                ],
                gotchas: Some(vec![
                    "Pagination defaults to 30 — use ?per_page=100.".to_string()
                ]),
            },
        }
    }

    #[test]
    fn slug_for_connector_name_handles_simple_cases() {
        assert_eq!(slug_for_connector_name("github"), "github");
        assert_eq!(slug_for_connector_name("Google_Calendar"), "google-calendar");
        assert_eq!(slug_for_connector_name("aws cloud"), "aws-cloud");
        assert_eq!(slug_for_connector_name("x_twitter"), "x-twitter");
        // Drops symbols, collapses repeats, trims edges
        assert_eq!(slug_for_connector_name("__foo--bar__"), "foo-bar");
        assert_eq!(slug_for_connector_name("(Test)/Stuff"), "teststuff");
    }

    #[test]
    fn skill_folder_name_uses_prefix() {
        assert_eq!(skill_folder_name("github"), "personas-connector-github");
        assert_eq!(
            skill_folder_name("Google_Calendar"),
            "personas-connector-google-calendar"
        );
    }

    #[test]
    fn build_skill_md_renders_full_body() {
        let body = build_skill_md(&sample_hint());
        assert!(body.starts_with("---\n"), "body must open with YAML frontmatter");
        assert!(body.contains("\n# GitHub\n"));
        assert!(body.contains("## Overview"));
        assert!(body.contains("GitHub REST API v3"));
        assert!(body.contains("## Examples"));
        assert!(body.contains("api.github.com/repos/x/y"));
        assert!(body.contains("## Gotchas"));
        assert!(body.contains("Pagination defaults to 30"));
        assert!(body.contains("## How to invoke"));
        assert!(body.contains("$PERSONAS_PROXY_URL"));
    }

    #[test]
    fn build_skill_md_emits_yaml_frontmatter_with_name_and_description() {
        let body = build_skill_md(&sample_hint());

        // Frontmatter is a closed --- ... --- block before any heading
        let opening = body.find("---\n").expect("opening fence");
        assert_eq!(opening, 0, "frontmatter must be the first line");
        let after_opening = &body[4..];
        let closing_offset = after_opening.find("\n---\n").expect("closing fence");
        let frontmatter = &after_opening[..closing_offset];

        assert!(
            frontmatter.contains("name: personas-connector-github"),
            "frontmatter should set name to the skill folder name; got: {frontmatter:?}"
        );
        // Description encourages auto-trigger by relevance — the article's
        // load-bearing point is "description encourages the agent to use the
        // skill in the right circumstance."
        assert!(
            frontmatter.contains("description: \""),
            "frontmatter should set a quoted description; got: {frontmatter:?}"
        );
        assert!(
            frontmatter.contains("GitHub"),
            "description should mention the connector label; got: {frontmatter:?}"
        );

        // Heading appears after the closing fence, not before
        let heading_pos = body.find("# GitHub\n").expect("heading present");
        let final_fence_pos = body.find("\n---\n").unwrap();
        assert!(heading_pos > final_fence_pos);
    }

    #[test]
    fn build_skill_description_caps_long_overviews() {
        let mut h = sample_hint();
        h.hint.overview =
            "X".repeat(400) + ". A trailing sentence that should be cut off entirely.";
        let desc = build_skill_description(&h);
        assert!(desc.chars().count() <= 140, "description must cap at 140 chars; got {} chars", desc.chars().count());
        assert!(desc.ends_with("..."), "long descriptions get a truncation marker");
    }

    #[test]
    fn build_skill_description_falls_back_to_label_when_overview_empty() {
        let mut h = sample_hint();
        h.hint.overview = String::new();
        let desc = build_skill_description(&h);
        // Falls back to label as the "first sentence" so we still produce
        // a usable description rather than "Use when working with GitHub: ."
        assert!(desc.contains("GitHub"));
        assert!(!desc.contains(": ."));
    }

    #[test]
    fn escape_yaml_double_quoted_handles_specials() {
        assert_eq!(escape_yaml_double_quoted("plain"), "plain");
        assert_eq!(escape_yaml_double_quoted("a\"b"), "a\\\"b");
        assert_eq!(escape_yaml_double_quoted("path\\to"), "path\\\\to");
        assert_eq!(escape_yaml_double_quoted("line1\nline2"), "line1 line2");
    }

    #[test]
    fn build_skill_md_handles_missing_gotchas() {
        let mut h = sample_hint();
        h.hint.gotchas = None;
        let body = build_skill_md(&h);
        assert!(!body.contains("## Gotchas"));
    }

    #[test]
    fn build_skill_md_handles_empty_examples() {
        let mut h = sample_hint();
        h.hint.examples = vec![];
        let body = build_skill_md(&h);
        assert!(!body.contains("## Examples"));
    }

    #[test]
    fn install_sidecar_disabled_is_noop() {
        let dir = tempdir().expect("tempdir");
        let result = install_sidecar_inner(dir.path(), &[sample_hint()], false).expect("ok");
        assert!(!result, "expected no-op when disabled");
        // No skills directory should have been created.
        assert!(!dir.path().join(".claude").join("skills").exists());
    }

    #[test]
    fn install_sidecar_writes_one_file_per_hint() {
        let dir = tempdir().expect("tempdir");
        let mut hints = vec![sample_hint()];
        let mut second = sample_hint();
        second.name = "slack".to_string();
        second.label = "Slack".to_string();
        hints.push(second);

        let result = install_sidecar_inner(dir.path(), &hints, true).expect("ok");
        assert!(result, "expected wrote_any=true");

        let github_path = skill_md_path(dir.path(), "github");
        let slack_path = skill_md_path(dir.path(), "slack");
        assert!(github_path.exists(), "github SKILL.md missing");
        assert!(slack_path.exists(), "slack SKILL.md missing");

        let github_body = std::fs::read_to_string(&github_path).expect("read");
        assert!(github_body.contains("# GitHub"));
        let slack_body = std::fs::read_to_string(&slack_path).expect("read");
        assert!(slack_body.contains("# Slack"));
    }

    #[test]
    fn install_sidecar_empty_hints_is_noop() {
        let dir = tempdir().expect("tempdir");
        let result = install_sidecar_inner(dir.path(), &[], true).expect("ok");
        assert!(!result, "expected no-op when no hints");
        assert!(!dir.path().join(".claude").join("skills").exists());
    }
}
