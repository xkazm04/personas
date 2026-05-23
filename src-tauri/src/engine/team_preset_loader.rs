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
//!
//! ## Locale overlays
//!
//! Each preset manifest may have sibling translation files named
//! `<id>.<lang>.json` (e.g. `backlog-execution.zh.json`). When the loader
//! is called with `Some(lang)`, it parses canonical English first, then
//! recursively merges any overlay file's fields on top BEFORE validation
//! + typed deserialization. The merge is deep:
//!
//!   - objects: overlay keys override canonical, missing keys preserved
//!   - arrays: zip by index — overlays must keep canonical member/conn
//!     order, identical to the array-overlay rule for templates' partial
//!     overlays (see `src/lib/personas/templates/templateOverlays.ts`)
//!   - primitives: overlay wins
//!
//! Structural fields (`id`, `schema_version`, `member.role`,
//! `member.template_id`, `connection.from`/`to`) MUST stay identical
//! between canonical and overlay; an overlay that drifts on those
//! values will fail role-uniqueness or unknown-role validation at the
//! end and the loader will skip the whole preset rather than silently
//! split it into two views.
//!
//! Overlay miss/parse failures are non-fatal — the canonical English
//! is returned and the failure is logged as a tracing warning. Same
//! rationale as the templates pipeline: translation lag must never
//! break the gallery.

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::db::models::{
    PresetAdoptionSchema, PresetMemberAdoptionSchema, TeamPreset,
};
use crate::error::AppError;

const PRESETS_RELATIVE_DIR: &str = "scripts/templates/_team_presets";
const SUPPORTED_SCHEMA_VERSION: i32 = 1;

fn presets_dir() -> PathBuf {
    PathBuf::from(PRESETS_RELATIVE_DIR)
}

/// Recursive deep-merge: overlay onto canonical in place.
/// - Objects merge by key.
/// - Arrays zip by index (overlay items beyond canonical length are dropped
///   — translators are expected to keep the same length as canonical).
/// - Primitives: overlay replaces canonical.
/// - Null overlay slot preserves canonical (lets a partial overlay file
///   leave structural fields untouched explicitly).
fn merge_overlay(canonical: &mut Value, overlay: Value) {
    match overlay {
        Value::Null => { /* preserve canonical */ }
        Value::Object(o) => {
            if let Value::Object(c) = canonical {
                for (k, v) in o {
                    match c.get_mut(&k) {
                        Some(slot) => merge_overlay(slot, v),
                        None => {
                            c.insert(k, v);
                        }
                    }
                }
            } else {
                *canonical = Value::Object(o);
            }
        }
        Value::Array(o) => {
            if let Value::Array(c) = canonical {
                for (i, v) in o.into_iter().enumerate() {
                    if let Some(slot) = c.get_mut(i) {
                        merge_overlay(slot, v);
                    }
                }
            } else {
                *canonical = Value::Array(o);
            }
        }
        other => {
            *canonical = other;
        }
    }
}

/// Apply a sibling `<id>.<lang>.json` overlay onto a canonical JSON value,
/// if the file exists and parses. Missing/broken overlay → canonical
/// untouched, warning logged. Never returns an error: translation lag
/// must not break the gallery.
fn apply_locale_overlay(canonical: &mut Value, dir: &Path, id: &str, lang: &str) {
    // Reject anything that could escape the presets dir or hit an unintended
    // file. Locale codes are 2-3 lowercase letters in the i18n manifest;
    // be conservative and silently no-op anything else.
    if !lang.chars().all(|c| c.is_ascii_lowercase()) || lang.len() < 2 || lang.len() > 3 {
        return;
    }
    let overlay_path = dir.join(format!("{id}.{lang}.json"));
    if !overlay_path.exists() {
        return;
    }
    let content = match std::fs::read_to_string(&overlay_path) {
        Ok(s) => s,
        Err(err) => {
            tracing::warn!(file = ?overlay_path, error = %err, "team_preset_loader: overlay read failed");
            return;
        }
    };
    let overlay: Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(err) => {
            tracing::warn!(file = ?overlay_path, error = %err, "team_preset_loader: overlay parse failed");
            return;
        }
    };
    merge_overlay(canonical, overlay);
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

/// Returns true if `filename` looks like a locale-overlay sibling
/// (`<id>.<lang>.json` with `<lang>` a 2-3 lowercase letter code) rather
/// than a canonical preset manifest. Used by `list_presets` to skip
/// overlay files in the gallery scan — they get folded into their
/// canonical parent during the per-preset locale-overlay step.
fn is_overlay_filename(filename: &str) -> bool {
    let stem = match filename.strip_suffix(".json") {
        Some(s) => s,
        None => return false,
    };
    let Some(idx) = stem.rfind('.') else {
        return false;
    };
    let lang = &stem[idx + 1..];
    !lang.is_empty()
        && lang.len() >= 2
        && lang.len() <= 3
        && lang.chars().all(|c| c.is_ascii_lowercase())
}

/// Read every `*.json` from `scripts/templates/_team_presets/`, parse it,
/// validate, and return the sorted list. Invalid presets are LOGGED and
/// SKIPPED — one bad manifest shouldn't take the whole gallery offline.
///
/// When `language` is `Some(lang)`, each canonical preset is overlaid
/// with its `<id>.<lang>.json` sibling (if present) so the gallery shows
/// translated names + descriptions. `None` returns canonical English.
pub fn list_presets(language: Option<&str>) -> Vec<TeamPreset> {
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
        let filename = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if is_overlay_filename(filename) {
            // Sibling translation, picked up via apply_locale_overlay
            // when its canonical parent loads. Skip the standalone scan.
            continue;
        }
        let canonical_id = filename.trim_end_matches(".json");
        let content = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(err) => {
                tracing::warn!(file = ?path, error = %err, "team_preset_loader: read failed");
                continue;
            }
        };
        let mut raw: Value = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(err) => {
                tracing::warn!(file = ?path, error = %err, "team_preset_loader: parse failed");
                continue;
            }
        };
        if let Some(lang) = language {
            apply_locale_overlay(&mut raw, &dir, canonical_id, lang);
        }
        let parsed: TeamPreset = match serde_json::from_value(raw) {
            Ok(p) => p,
            Err(err) => {
                tracing::warn!(file = ?path, error = %err, "team_preset_loader: typed parse failed");
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
///
/// When `language` is `Some(lang)`, the canonical preset is overlaid
/// with its `<id>.<lang>.json` sibling (if present). The persisted team
/// + group + member names that flow out of the adopter therefore match
/// what the user saw in the preview modal — a Chinese-locale user
/// clicking the preset gets a Chinese-named team, no language-switch
/// drift after adoption.
pub fn get_preset(id: &str, language: Option<&str>) -> Result<TeamPreset, AppError> {
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(AppError::Validation(
            "Team preset id must not contain path separators".into(),
        ));
    }
    let dir = presets_dir();
    let path = dir.join(format!("{id}.json"));
    if !path.exists() {
        return Err(AppError::NotFound(format!("Team preset '{id}'")));
    }
    let content = std::fs::read_to_string(&path).map_err(|e| {
        AppError::Validation(format!(
            "Failed to read team preset file '{}': {e}",
            path.display()
        ))
    })?;
    let mut raw: Value = serde_json::from_str(&content)
        .map_err(|e| AppError::Validation(format!("Failed to parse team preset '{id}': {e}")))?;
    if let Some(lang) = language {
        apply_locale_overlay(&mut raw, &dir, id, lang);
    }
    let parsed: TeamPreset = serde_json::from_value(raw).map_err(|e| {
        AppError::Validation(format!(
            "Failed to deserialize team preset '{id}' into typed model: {e}"
        ))
    })?;
    validate(&parsed)?;
    Ok(parsed)
}

/// Locate a single template's canonical JSON by its `id` (the `id` field
/// inside the template manifest, which also matches the base filename
/// minus `.json` and any locale suffix). Walks every category directory
/// under `scripts/templates/` once per call; not cached because the
/// adopter calls it N times per adoption (~6) and the read cost is
/// dwarfed by `instant_adopt_template_inner`'s own work.
///
/// The function deliberately skips locale-suffixed files (e.g.
/// `idea-harvester.zh.json`) — those are translations of the canonical
/// `idea-harvester.json`, and adoption always goes through the
/// canonical English source so `check_template_integrity` resolves
/// against the right checksum.
///
/// Returns `NotFound` with the requested id when no canonical file
/// matches.
pub fn load_template_design_by_id(template_id: &str) -> Result<String, AppError> {
    if template_id.is_empty() {
        return Err(AppError::Validation("template_id is empty".into()));
    }
    if template_id.contains('/') || template_id.contains('\\') || template_id.contains("..") {
        return Err(AppError::Validation(
            "template_id must not contain path separators".into(),
        ));
    }
    let templates_dir = std::path::Path::new("scripts/templates");
    if !templates_dir.exists() {
        return Err(AppError::NotFound(format!(
            "Templates directory missing; cannot resolve '{template_id}'"
        )));
    }
    let categories = std::fs::read_dir(templates_dir)
        .map_err(|e| AppError::Validation(format!("read_dir templates: {e}")))?;
    let target_filename = format!("{template_id}.json");
    for cat_entry in categories.flatten() {
        let cat_path = cat_entry.path();
        if !cat_path.is_dir() {
            continue;
        }
        // Skip private folders like `_team_presets/`.
        if cat_path
            .file_name()
            .map(|n| n.to_string_lossy().starts_with('_'))
            .unwrap_or(true)
        {
            continue;
        }
        let candidate = cat_path.join(&target_filename);
        if candidate.exists() {
            return std::fs::read_to_string(&candidate).map_err(|e| {
                AppError::Validation(format!(
                    "Failed to read template file '{}': {e}",
                    candidate.display()
                ))
            });
        }
    }
    Err(AppError::NotFound(format!(
        "Template '{template_id}' not found under scripts/templates/<category>/"
    )))
}

/// Truncate a description to ~120 chars on a word boundary, with an
/// ellipsis if shortened. Used to surface a short reminder of what each
/// member role does in the combined questionnaire UI without piping the
/// full multi-paragraph identity description across IPC.
fn truncate_description(s: &str) -> String {
    const LIMIT: usize = 120;
    let trimmed = s.trim();
    if trimmed.chars().count() <= LIMIT {
        return trimmed.to_string();
    }
    let mut out = String::new();
    let mut count = 0usize;
    for ch in trimmed.chars() {
        if count >= LIMIT {
            break;
        }
        out.push(ch);
        count += 1;
    }
    // Back off to the nearest space so we don't cut a word in half.
    if let Some(idx) = out.rfind(' ') {
        out.truncate(idx);
    }
    out.push('…');
    out
}

/// Build the combined questionnaire schema for `preset_id`. For each
/// member: locate its template's canonical design JSON, extract
/// `payload.adoption_questions[]` and the human-readable name +
/// (truncated) description. Members whose templates are missing or
/// unreadable are skipped at the LOAD level for the questionnaire view
/// — the adopter itself surfaces missing-template errors at adopt
/// time, so this skip is purely UI-cosmetic and avoids breaking the
/// whole questionnaire on one bad member.
///
/// `language` flows through to `get_preset` so the preset-level
/// metadata (preset_name, member roles) reflects the active locale.
/// Template-level localization (template_name, adoption_question
/// labels) is intentionally NOT applied here — those live in the
/// template's own overlay system which is consumed downstream by the
/// frontend. Threading it here would require loading every template's
/// overlay twice, and the frontend already merges overlays for the
/// single-template adoption flow, so the same code path picks up
/// translated question labels when it renders.
pub fn get_adoption_schema(
    preset_id: &str,
    language: Option<&str>,
) -> Result<PresetAdoptionSchema, AppError> {
    let preset = get_preset(preset_id, language)?;

    let mut members: Vec<PresetMemberAdoptionSchema> =
        Vec::with_capacity(preset.members.len());
    let mut total_questions: i32 = 0;
    let mut configurable: i32 = 0;

    for m in &preset.members {
        let design_json = match load_template_design_by_id(&m.template_id) {
            Ok(s) => s,
            Err(err) => {
                tracing::warn!(
                    role = %m.role,
                    template = %m.template_id,
                    error = %err,
                    "preset adoption schema: template not found, skipping member"
                );
                continue;
            }
        };
        let design: Value = match serde_json::from_str(&design_json) {
            Ok(v) => v,
            Err(err) => {
                tracing::warn!(
                    role = %m.role,
                    template = %m.template_id,
                    error = %err,
                    "preset adoption schema: template parse failed, skipping"
                );
                continue;
            }
        };

        let template_name = design
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(&m.template_id)
            .to_string();
        let template_description = design
            .pointer("/payload/persona/identity/description")
            .and_then(|v| v.as_str())
            .map(truncate_description);
        let questions: Vec<Value> = design
            .pointer("/payload/adoption_questions")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let q_count = questions.len();
        total_questions += q_count as i32;
        if q_count > 0 {
            configurable += 1;
        }

        members.push(PresetMemberAdoptionSchema {
            role: m.role.clone(),
            template_id: m.template_id.clone(),
            template_name,
            template_description,
            questions,
        });
    }

    Ok(PresetAdoptionSchema {
        preset_id: preset.id,
        preset_name: preset.name,
        member_count: preset.members.len() as i32,
        configurable_member_count: configurable,
        total_question_count: total_questions,
        members,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn merge_overlay_object_keys_override() {
        let mut canonical = json!({"name": "EN", "color": "#000", "team": {"name": "EN"}});
        let overlay = json!({"name": "DE", "team": {"name": "DE"}});
        merge_overlay(&mut canonical, overlay);
        assert_eq!(canonical["name"], "DE");
        assert_eq!(canonical["color"], "#000", "untouched canonical preserved");
        assert_eq!(canonical["team"]["name"], "DE");
    }

    #[test]
    fn merge_overlay_arrays_zip_by_index() {
        let mut canonical = json!([
            {"label": "first-en", "from": "a", "to": "b"},
            {"label": "second-en", "from": "b", "to": "c"}
        ]);
        let overlay = json!([
            {"label": "first-de"},
            {"label": "second-de"}
        ]);
        merge_overlay(&mut canonical, overlay);
        assert_eq!(canonical[0]["label"], "first-de");
        assert_eq!(canonical[0]["from"], "a", "structural field preserved");
        assert_eq!(canonical[1]["label"], "second-de");
        assert_eq!(canonical[1]["to"], "c", "structural field preserved");
    }

    #[test]
    fn merge_overlay_short_overlay_array_leaves_tail_canonical() {
        let mut canonical = json!([{"label": "a"}, {"label": "b"}, {"label": "c"}]);
        let overlay = json!([{"label": "X"}]);
        merge_overlay(&mut canonical, overlay);
        assert_eq!(canonical[0]["label"], "X");
        assert_eq!(canonical[1]["label"], "b");
        assert_eq!(canonical[2]["label"], "c");
    }

    #[test]
    fn merge_overlay_null_preserves_canonical() {
        let mut canonical = json!({"keep": "yes"});
        let overlay = Value::Null;
        merge_overlay(&mut canonical, overlay);
        assert_eq!(canonical["keep"], "yes");
    }

    #[test]
    fn is_overlay_filename_detects_locale_siblings() {
        assert!(is_overlay_filename("backlog-execution.zh.json"));
        assert!(is_overlay_filename("daily-ops.de.json"));
        assert!(is_overlay_filename("foo.es.json"));
        // 3-letter codes also accepted (none in our manifest today but the
        // overlay rule is "2-3 lowercase letters" — keep consistent).
        assert!(is_overlay_filename("foo.fil.json"));

        // Canonical filenames have NO inner dot in the stem.
        assert!(!is_overlay_filename("backlog-execution.json"));
        assert!(!is_overlay_filename("README.md"));
        // NOTE: `foo.bar.json` IS treated as an overlay (`bar` matches the
        // 2-3 lowercase rule). That's a known false-positive — the canonical
        // parent `foo.json` wouldn't exist and the overlay would never be
        // applied, but the list-scan would skip it from the gallery. The
        // alternative (allow-list of known locale codes) would mean
        // touching the loader every time the i18n manifest grew. The
        // false-positive cost (an author accidentally naming a real
        // preset `foo.bar.json` and being confused why it doesn't show
        // up) is lower than the maintenance cost of the allow-list.
    }

    #[test]
    fn is_overlay_filename_rejects_uppercase_and_long_codes() {
        assert!(!is_overlay_filename("foo.ZH.json"));
        assert!(!is_overlay_filename("foo.toolong.json"));
        assert!(!is_overlay_filename("foo.1a.json"));
        assert!(!is_overlay_filename("foo.x.json"), "single letter rejected");
    }
}
