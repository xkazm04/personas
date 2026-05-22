//! Filesystem reader for team-preset manifests.
//!
//! Mirrors the on-demand load pattern of `engine::build_session::templates`:
//! manifests live under `scripts/templates/_team_presets/*.json`, are read
//! once per IPC call (no in-process cache yet — presets are tiny and called
//! rarely), and parse into the typed `TeamPreset` model in `db/models`.
//!
//! Why no cache? The cycle-1 template index caches because it's hit on every
//! build session (similarity matching). Preset listing is hit only when the
//! user opens the Presets gallery — rare enough that the cost of reading
//! ~10 small JSON files per click is invisible, while the cost of stale
//! caches across DEV-time edits to the manifest is real annoyance.
//!
//! Two validations the loader DOES perform up-front (so the gallery never
//! shows broken cards):
//!   1. `schema_version == 1` — newer versions get a structured error
//!      rather than a silent mis-parse.
//!   2. `member.role` values are unique within a preset — connections
//!      reference roles by string, so a duplicate would silently bind to
//!      the first occurrence and confuse the adopter.
//!
//! Templates referenced by `member.template_id` are NOT validated here —
//! that coupling would force the loader to read the entire template catalog
//! on every list call. The adopter validates per-template at adoption time
//! and returns a precise error if one is missing.

use std::path::PathBuf;

use crate::db::models::TeamPreset;
use crate::error::AppError;

const PRESETS_RELATIVE_DIR: &str = "scripts/templates/_team_presets";
const SUPPORTED_SCHEMA_VERSION: i32 = 1;

fn presets_dir() -> PathBuf {
    PathBuf::from(PRESETS_RELATIVE_DIR)
}

/// Validate a parsed preset and return it, or an explanatory error.
fn validate(preset: &TeamPreset) -> Result<(), AppError> {
    if preset.schema_version != SUPPORTED_SCHEMA_VERSION {
        return Err(AppError::Validation(format!(
            "Team preset '{}' uses schema_version={} but this build supports {}",
            preset.id, preset.schema_version, SUPPORTED_SCHEMA_VERSION
        )));
    }

    let mut seen_roles = std::collections::HashSet::new();
    for m in &preset.members {
        if !seen_roles.insert(m.role.as_str()) {
            return Err(AppError::Validation(format!(
                "Team preset '{}' has duplicate member role '{}' — roles must be unique within a preset",
                preset.id, m.role
            )));
        }
    }

    // Connection role references must resolve to known members; otherwise
    // the adopter would silently drop the edge. Catch at load time.
    for c in &preset.connections {
        if !seen_roles.contains(c.from.as_str()) {
            return Err(AppError::Validation(format!(
                "Team preset '{}' connection references unknown source role '{}'",
                preset.id, c.from
            )));
        }
        if !seen_roles.contains(c.to.as_str()) {
            return Err(AppError::Validation(format!(
                "Team preset '{}' connection references unknown target role '{}'",
                preset.id, c.to
            )));
        }
    }

    Ok(())
}

/// Read every `*.json` from `scripts/templates/_team_presets/`, parse it,
/// validate, and return the sorted list. Invalid presets are LOGGED and
/// SKIPPED — one bad manifest shouldn't take the whole gallery offline.
pub fn list_presets() -> Vec<TeamPreset> {
    let dir = presets_dir();
    if !dir.exists() {
        return Vec::new();
    }

    let mut out: Vec<TeamPreset> = Vec::new();
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(err) => {
            tracing::warn!(error = %err, "team_preset_loader::list_presets: read_dir failed");
            return Vec::new();
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e != "json").unwrap_or(true) {
            continue;
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(err) => {
                tracing::warn!(file = ?path, error = %err, "team_preset_loader: read failed");
                continue;
            }
        };
        let parsed: TeamPreset = match serde_json::from_str(&content) {
            Ok(p) => p,
            Err(err) => {
                tracing::warn!(file = ?path, error = %err, "team_preset_loader: parse failed");
                continue;
            }
        };
        if let Err(err) = validate(&parsed) {
            tracing::warn!(file = ?path, error = %err, "team_preset_loader: validation failed");
            continue;
        }
        out.push(parsed);
    }

    // Sort by name for stable gallery ordering; ids are stable but
    // not intentionally human-readable.
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Read one preset by id (filename minus `.json`). Returns `NotFound` if
/// the file is missing, `Validation` for parse / schema-version / unique-
/// role / unknown-role-reference failures.
pub fn get_preset(id: &str) -> Result<TeamPreset, AppError> {
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(AppError::Validation(
            "Team preset id must not contain path separators".into(),
        ));
    }
    let path = presets_dir().join(format!("{id}.json"));
    if !path.exists() {
        return Err(AppError::NotFound(format!("Team preset '{id}'")));
    }
    let content = std::fs::read_to_string(&path).map_err(|e| {
        AppError::Validation(format!(
            "Failed to read team preset file '{}': {e}",
            path.display()
        ))
    })?;
    let parsed: TeamPreset = serde_json::from_str(&content)
        .map_err(|e| AppError::Validation(format!("Failed to parse team preset '{id}': {e}")))?;
    validate(&parsed)?;
    Ok(parsed)
}
