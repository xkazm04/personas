//! Registry probe - "is this folder an ai-registry working copy?"
//!
//! A READER. It looks at `registry.yaml`, `catalog.json` and git metadata of a
//! local folder and answers with one `RegistryProbe`. Nothing is written and
//! nothing is ingested into SQLite. A folder that is not a registry is
//! `valid: false` + `reason`, never an `Err`: the operator is browsing, and
//! browsing into the wrong folder is not a fault.
//!
//! (This file used to hold the Project x registry coverage read model as well;
//! it was removed with the Overview Patterns tab on 2026-10-04. The probe and
//! its git helper survive because the workspace registry wiring and the
//! Council's registry galaxy both use them.)
//!
//! ## The YAML subset
//!
//! `registry.yaml` is parsed with a hand-rolled minimal reader (top-level
//! scalars + the names of the two-space-indented keys under `lanes:`), the
//! no-yaml-crate decision the corpus tooling also made. Unknown structure is
//! ignored, exactly as the registry's own header demands of a reader.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/// Result of asking "is this folder a registry?" — `valid: false` + `reason`
/// for a mere non-registry folder, never an `Err`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RegistryProbe {
    pub valid: bool,
    /// `name:` from `registry.yaml`.
    pub name: Option<String>,
    /// `registry.fullName` from `catalog.json` (e.g. `xkazm04/ai-registry`).
    pub full_name: Option<String>,
    /// Lane names declared under `lanes:` in `registry.yaml`.
    pub lanes: Vec<String>,
    /// Bundle names from `catalog.json` (`bundles[].name`).
    pub domains: Vec<String>,
    /// Short HEAD sha of the working copy, when git can read it.
    pub head_sha: Option<String>,
    /// Uncommitted changes present. A live working copy being dirty is normal
    /// and reported, never refused (plan risk §3).
    pub dirty: bool,
    /// Why `valid` is false. `None` when valid.
    pub reason: Option<String>,
}

// ---------------------------------------------------------------------------
// registry.yaml — minimal hand-rolled subset
// ---------------------------------------------------------------------------

/// What this reader takes from `registry.yaml`: the top-level `name:` scalar
/// and the lane names declared under `lanes:`. Everything else is ignored, as
/// the file's own compatibility guarantee requires of a reader.
#[derive(Debug, Default, PartialEq, Eq)]
struct RegistryYaml {
    name: Option<String>,
    lanes: Vec<String>,
}

/// Strip a trailing ` # comment` (whitespace before the `#` required, same
/// rule as the frontmatter parser's).
fn strip_comment(s: &str) -> &str {
    let bytes = s.as_bytes();
    for (i, b) in bytes.iter().enumerate() {
        if *b != b'#' || i == 0 {
            continue;
        }
        let mut start = i;
        while start > 0 && bytes[start - 1].is_ascii_whitespace() {
            start -= 1;
        }
        if start < i {
            return &s[..start];
        }
    }
    s
}

fn parse_registry_yaml(raw: &str) -> RegistryYaml {
    let mut out = RegistryYaml::default();
    let mut in_lanes = false;
    for line in raw.lines() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.trim_start().starts_with('#') {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        if indent == 0 {
            // A new top-level key closes the lanes block.
            in_lanes = line.trim_end() == "lanes:";
            if in_lanes {
                continue;
            }
            if let Some(rest) = line.strip_prefix("name:") {
                let v = strip_comment(rest).trim();
                if !v.is_empty() {
                    out.name = Some(v.trim_matches('"').trim_matches('\'').to_string());
                }
            }
            continue;
        }
        if !in_lanes || indent != 2 {
            // Only DIRECT children of `lanes:` are lane names; deeper keys
            // (`path:`, `resolution:` …) are lane properties, not lanes.
            continue;
        }
        let body = line.trim();
        if let Some(key) = body.strip_suffix(':') {
            if !key.is_empty()
                && key
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            {
                out.lanes.push(key.to_string());
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// catalog.json - defensive Value walk
// ---------------------------------------------------------------------------

/// What a probe takes from `catalog.json`: the registry's full name and the
/// names of its bundles.
#[derive(Debug, Default)]
struct Catalog {
    full_name: Option<String>,
    /// bundle name -> contentHash (when present).
    bundle_hashes: BTreeMap<String, String>,
}

fn parse_catalog(raw: &str) -> Result<Catalog, String> {
    let v: serde_json::Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    let mut out = Catalog {
        full_name: v
            .pointer("/registry/fullName")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
        ..Catalog::default()
    };
    for b in v
        .get("bundles")
        .and_then(|x| x.as_array())
        .into_iter()
        .flatten()
    {
        if let (Some(name), Some(hash)) = (
            b.get("name").and_then(|x| x.as_str()),
            b.get("contentHash").and_then(|x| x.as_str()),
        ) {
            out.bundle_hashes.insert(name.to_string(), hash.to_string());
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Git — CLI, read-only
// ---------------------------------------------------------------------------

/// Run a git subcommand in `dir`. `None` when git is unavailable or the
/// command failed — the caller records a warning and carries on; coverage
/// without git metadata is degraded, not broken.
fn git_read(dir: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub(super) fn git_head_short(dir: &Path) -> Option<String> {
    git_read(dir, &["rev-parse", "--short", "HEAD"]).filter(|s| !s.is_empty())
}

fn git_dirty(dir: &Path) -> Option<bool> {
    git_read(dir, &["status", "--porcelain"]).map(|s| !s.is_empty())
}

// ---------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------

pub(super) fn probe_registry_root(path: &str) -> RegistryProbe {
    let invalid = |reason: String| RegistryProbe {
        valid: false,
        name: None,
        full_name: None,
        lanes: Vec::new(),
        domains: Vec::new(),
        head_sha: None,
        dirty: false,
        reason: Some(reason),
    };

    let trimmed = path.trim();
    if trimmed.is_empty() {
        return invalid("No folder was given.".to_string());
    }
    let root = PathBuf::from(trimmed);
    if !root.is_dir() {
        return invalid(format!("\"{}\" is not a directory.", root.display()));
    }
    let yaml_path = root.join("registry.yaml");
    if !yaml_path.is_file() {
        return invalid(format!(
            "\"{}\" carries no registry.yaml — a registry declares itself there.",
            root.display()
        ));
    }
    let yaml = match std::fs::read_to_string(&yaml_path) {
        Ok(raw) => parse_registry_yaml(&raw),
        Err(e) => return invalid(format!("registry.yaml could not be read: {e}")),
    };

    // catalog.json is optional for a probe — a registry mid-build is still a
    // registry. Its absence just means fullName/domains stay unknown.
    let catalog = std::fs::read_to_string(root.join("catalog.json"))
        .ok()
        .and_then(|raw| parse_catalog(&raw).ok());
    let (full_name, domains) = match catalog {
        Some(c) => (c.full_name, c.bundle_hashes.keys().cloned().collect()),
        None => (None, Vec::new()),
    };

    RegistryProbe {
        valid: true,
        name: yaml.name,
        full_name,
        lanes: yaml.lanes,
        domains,
        head_sha: git_head_short(&root),
        dirty: git_dirty(&root).unwrap_or(false),
        reason: None,
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Ask whether a local folder is a registry working copy. A non-registry
/// folder is `valid: false` + `reason` — never an `Err`; the operator is
/// browsing, and browsing into the wrong folder is not a fault.
#[tauri::command]
pub async fn dev_tools_registry_probe(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<RegistryProbe, AppError> {
    require_auth(&state).await?;
    tokio::task::spawn_blocking(move || probe_registry_root(&path))
        .await
        .map_err(|e| AppError::Internal(format!("registry probe join error: {e}")))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // NOTE: a normal string, not `\`-continued lines — Rust's `\<newline>`
    // continuation strips the next line's leading whitespace, which silently
    // deletes exactly the indentation this fixture exists to exercise.
    const FIXTURE_YAML: &str = "# comment line\nregistry: 1\nname: fixture-registry\ntitle: Fixture registry\nlanes:\n  knowledge:\n    path: knowledge/\n    depth: nested\n  skills:\n    path: skills/\n  practices:\n    path: practices/  # trailing comment\n  memory:\n    path: memory/\nguarantees:\n  write_path: pull-request\n";

    fn fixture_catalog() -> String {
        serde_json::json!({
            "generatedAt": "2026-08-18T00:00:00Z",
            "registry": { "fullName": "acme/fixture-registry" },
            "bundles": [
                { "name": "software-engineering", "contentHash": "sha256:aaaa" },
                { "name": "recruiting", "contentHash": "sha256:bbbb" }
            ]
        })
        .to_string()
    }

    fn write_fixture_registry(dir: &Path) {
        std::fs::write(dir.join("registry.yaml"), FIXTURE_YAML).unwrap();
        std::fs::write(dir.join("catalog.json"), fixture_catalog()).unwrap();
    }

    // -- registry.yaml subset ----------------------------------------------

    #[test]
    fn yaml_subset_reads_name_and_direct_lane_children_only() {
        let y = parse_registry_yaml(FIXTURE_YAML);
        assert_eq!(y.name.as_deref(), Some("fixture-registry"));
        // `path:`/`depth:` are 4-space lane properties, `guarantees:` closes
        // the block — none of them may leak in as lanes.
        assert_eq!(y.lanes, vec!["knowledge", "skills", "practices", "memory"]);
    }

    #[test]
    fn probe_answers_valid_and_invalid_without_err() {
        let tmp = tempfile::tempdir().expect("tempdir");

        let p = probe_registry_root(tmp.path().to_str().unwrap());
        assert!(!p.valid);
        assert!(p.reason.as_deref().unwrap().contains("registry.yaml"));

        let p = probe_registry_root("");
        assert!(!p.valid);

        write_fixture_registry(tmp.path());
        let p = probe_registry_root(tmp.path().to_str().unwrap());
        assert!(p.valid);
        assert_eq!(p.name.as_deref(), Some("fixture-registry"));
        assert_eq!(p.full_name.as_deref(), Some("acme/fixture-registry"));
        assert_eq!(p.lanes, vec!["knowledge", "skills", "practices", "memory"]);
        assert_eq!(p.domains, vec!["recruiting", "software-engineering"]);
        assert!(p.reason.is_none());
    }
}
