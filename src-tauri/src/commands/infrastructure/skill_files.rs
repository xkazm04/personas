//! Skill file browser — lists, reads, and updates `.claude/skills/` files.
//!
//! Used by the dev-tools Skills tab to manage Claude Code skill definitions
//! without requiring terminal access.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;
use ts_rs::TS;

use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Sidecar provenance file written next to a skill's `SKILL.md` on install.
/// Records where the skill was copied from and the content hash at install
/// time, so a later scan can classify the installed copy as in-sync / diverged
/// / local-only. Chosen over frontmatter mutation deliberately: the install
/// must NOT rewrite the user's `SKILL.md` body (that would itself register as
/// drift and risk corrupting hand-authored content). The file is dot-prefixed
/// so it's excluded from the skill's reference-file listing and content hash.
const PROVENANCE_FILE: &str = ".personas-skill-meta.json";

/// Per-skill sync-state tokens surfaced in [`SkillEntry::sync_state`]. Kept in
/// lockstep with the frontend token map in `SkillLibraryRow`.
const SYNC_IN_SYNC: &str = "in_sync";
const SYNC_DIVERGED: &str = "diverged";
const SYNC_LOCAL_ONLY: &str = "local_only";

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SkillEntry {
    /// Skill directory name (e.g. "research", "add-template")
    pub name: String,
    /// Full path to the skill directory
    pub path: String,
    /// Content of SKILL.md (the main skill definition)
    pub description: Option<String>,
    /// Number of reference files in the skill directory (excluding SKILL.md)
    pub reference_file_count: i32,
    /// Names of reference files
    pub reference_files: Vec<String>,
    /// Provenance-derived sync state vs the source the skill was installed from:
    /// `"in_sync"` (installed copy still matches its source), `"diverged"`
    /// (hashes differ — the copy or its source changed), or `"local_only"`
    /// (no provenance sidecar — hand-authored or installed before tracking).
    pub sync_state: String,
    /// Where this skill was installed from, when provenance exists:
    /// `"global"` (the user-global library) or `"project"`. `None` for
    /// local-only skills.
    pub source_kind: Option<String>,
}

/// On-disk provenance sidecar ([`PROVENANCE_FILE`]). Internal — not exported to
/// TS; the frontend consumes the derived [`SkillEntry::sync_state`] instead.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SkillProvenance {
    /// `"global"` or `"project"`.
    source_kind: String,
    /// Registered source project id when `source_kind == "project"`.
    source_project_id: Option<String>,
    /// Absolute path of the source skill directory at install time.
    source_path: String,
    /// Content hash of the source skill directory at install time.
    content_hash: String,
    /// RFC3339 timestamp of the install.
    installed_at: String,
}

/// One file-level entry in an install diff preview.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SkillFileDelta {
    /// Relative path within the skill directory.
    pub file: String,
    /// `"changed"`, `"added"` (in source, not target), or `"removed"`
    /// (in target, not source).
    pub status: String,
    /// Source file size in bytes (0 when `status == "removed"`).
    pub source_bytes: i64,
    /// Target file size in bytes (0 when `status == "added"`).
    pub target_bytes: i64,
}

/// Diff summary returned by [`skill_files_install_preview`] so the UI can show
/// what a re-install would overwrite BEFORE it commits the copy.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallPreview {
    pub skill_name: String,
    /// Absolute path the skill would be installed to.
    pub target_path: String,
    /// Whether a skill already exists at the target (a re-install / overwrite).
    pub target_exists: bool,
    pub changed_count: i32,
    pub added_count: i32,
    pub removed_count: i32,
    /// Per-file deltas (capped for display).
    pub deltas: Vec<SkillFileDelta>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SkillFileContent {
    pub skill_name: String,
    pub file_name: String,
    pub content: String,
}

/// Outcome of installing (copying) a skill into a target project's
/// `.claude/skills`. Returned by [`skill_files_install`].
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallResult {
    /// Whether files were written. `false` with `reason = "exists"` means the
    /// skill already exists in the target and `overwrite` was not set.
    pub installed: bool,
    /// Absolute path of the installed skill directory (or single-file `.md`).
    pub target_path: String,
    /// Number of files copied (0 when `installed == false`).
    pub file_count: i32,
    /// Machine reason token when `installed == false` (currently only
    /// `"exists"`). `None` on success.
    pub reason: Option<String>,
}

// ============================================================================
// Helpers
// ============================================================================

/// Resolve the `.claude/skills` directory.
///
/// When `project_id` is provided we look up that specific row's `root_path`
/// — this is the path users get when they pick a project in the dev-tools
/// Skills tab. With no `project_id` we fall back to scanning all projects
/// (preserves legacy callers that haven't been updated to forward the
/// active id yet) and finally the current working directory.
fn skills_dir(state: &AppState, project_id: Option<&str>) -> Result<PathBuf, AppError> {
    let candidates: Vec<PathBuf> = {
        let mut c = Vec::new();
        if let Ok(conn) = state.db.get() {
            if let Some(id) = project_id {
                if let Ok(rp) = conn.query_row::<String, _, _>(
                    "SELECT root_path FROM dev_projects WHERE id = ?1",
                    [id],
                    |row| row.get(0),
                ) {
                    c.push(PathBuf::from(&rp).join(".claude").join("skills"));
                }
            } else if let Ok(mut projects) =
                conn.prepare("SELECT root_path FROM dev_projects LIMIT 5")
            {
                if let Ok(mut rows) = projects.query([]) {
                    while let Ok(Some(row)) = rows.next() {
                        if let Ok(rp) = row.get::<_, String>(0) {
                            c.push(PathBuf::from(&rp).join(".claude").join("skills"));
                        }
                    }
                }
            }
        }
        if let Ok(cwd) = std::env::current_dir() {
            c.push(cwd.join(".claude").join("skills"));
        }
        c
    };

    for candidate in &candidates {
        if candidate.is_dir() {
            return Ok(candidate.clone());
        }
    }

    Err(AppError::NotFound(
        "No .claude/skills directory found. Make sure a dev project with Claude Code skills is configured.".into(),
    ))
}

/// Resolve `~/.claude/skills` — the user-global Claude Code skills library,
/// available to every project. `None` if the home dir can't be resolved.
pub(crate) fn global_skills_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("skills"))
}

/// Resolve a registered project's `.claude/skills` directory from its id.
/// Errors `NotFound` if the project id isn't in `dev_projects`.
fn project_skills_dir(state: &AppState, project_id: &str) -> Result<PathBuf, AppError> {
    let conn = state
        .db
        .get()
        .map_err(|e| AppError::Internal(format!("db connection failed: {e}")))?;
    let root_path = conn
        .query_row::<String, _, _>(
            "SELECT root_path FROM dev_projects WHERE id = ?1",
            [project_id],
            |row| row.get(0),
        )
        .map_err(|_| AppError::NotFound(format!("project not found: {project_id}")))?;
    Ok(PathBuf::from(&root_path).join(".claude").join("skills"))
}

/// Reject skill names that aren't a single safe path segment. Guards the
/// install path against writing outside the target `.claude/skills`.
fn validate_skill_name(name: &str) -> Result<(), AppError> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.contains(':')
    {
        return Err(AppError::Validation(format!("invalid skill name: {name}")));
    }
    Ok(())
}

/// Recursively copy `src` into `dst`, returning the count of files written.
/// Creates `dst` (and parents) as needed. Used to install a skill directory
/// (SKILL.md + reference files, possibly nested) into a target repo.
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<i32, AppError> {
    std::fs::create_dir_all(dst)
        .map_err(|e| AppError::Internal(format!("create target dir failed: {e}")))?;
    let mut count = 0;
    let read_dir = std::fs::read_dir(src)
        .map_err(|e| AppError::Internal(format!("read source dir failed: {e}")))?;
    for entry in read_dir.flatten() {
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            count += copy_dir_recursive(&path, &target)?;
        } else {
            std::fs::copy(&path, &target)
                .map_err(|e| AppError::Internal(format!("copy file failed: {e}")))?;
            count += 1;
        }
    }
    Ok(count)
}

/// Collect the files under a skill `dir` as a map of `relative_path -> size`,
/// excluding the [`PROVENANCE_FILE`] sidecar. Deterministic (BTreeMap keeps
/// paths sorted). Returns an empty map when the dir is unreadable.
fn collect_skill_files(dir: &Path) -> BTreeMap<String, u64> {
    fn walk(base: &Path, cur: &Path, out: &mut BTreeMap<String, u64>) {
        let Ok(read_dir) = std::fs::read_dir(cur) else {
            return;
        };
        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(base, &path, out);
            } else {
                if path.file_name().and_then(|n| n.to_str()) == Some(PROVENANCE_FILE) {
                    continue;
                }
                let rel = path
                    .strip_prefix(base)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                out.insert(rel, size);
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, dir, &mut out);
    out
}

/// Content hash of a skill directory: SHA-256 over each file's relative path
/// and bytes, in sorted order, excluding the provenance sidecar. Returns `None`
/// if the directory can't be read. Two directories with identical file trees
/// hash equal regardless of filesystem walk order.
pub(crate) fn hash_skill_dir(dir: &Path) -> Option<String> {
    if !dir.is_dir() {
        return None;
    }
    let files = collect_skill_files(dir);
    let mut hasher = Sha256::new();
    for rel in files.keys() {
        let bytes = std::fs::read(dir.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR))).ok()?;
        hasher.update(rel.as_bytes());
        hasher.update([0u8]);
        hasher.update((bytes.len() as u64).to_le_bytes());
        hasher.update(&bytes);
    }
    Some(hex::encode(hasher.finalize()))
}

/// Write the [`PROVENANCE_FILE`] sidecar into an installed skill directory.
/// Best-effort — an I/O failure is logged and swallowed (the copy already
/// succeeded; provenance is a nice-to-have that degrades the skill to
/// `local_only` if absent).
fn write_provenance(target_dir: &Path, source_dir: &Path, source_kind: &str, source_project_id: Option<&str>) {
    let Some(content_hash) = hash_skill_dir(source_dir) else {
        return;
    };
    let prov = SkillProvenance {
        source_kind: source_kind.to_string(),
        source_project_id: source_project_id.map(str::to_string),
        source_path: source_dir.to_string_lossy().into_owned(),
        content_hash,
        installed_at: chrono::Utc::now().to_rfc3339(),
    };
    match serde_json::to_string_pretty(&prov) {
        Ok(json) => {
            if let Err(e) = std::fs::write(target_dir.join(PROVENANCE_FILE), json) {
                tracing::warn!(error = %e, dir = %target_dir.display(), "skill_files: failed to write provenance sidecar");
            }
        }
        Err(e) => tracing::warn!(error = %e, "skill_files: failed to serialize provenance"),
    }
}

/// Read the provenance sidecar from an installed skill directory, if present.
fn read_provenance(skill_dir: &Path) -> Option<SkillProvenance> {
    let raw = std::fs::read_to_string(skill_dir.join(PROVENANCE_FILE)).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Classify an installed skill directory's sync state against the source it was
/// installed from. `local_only` when no provenance; `in_sync` when the installed
/// copy still hashes equal to its current source; `diverged` otherwise
/// (installed copy edited, source changed upstream, or source now unreadable).
fn classify_sync_state(skill_dir: &Path) -> (String, Option<String>) {
    let Some(prov) = read_provenance(skill_dir) else {
        return (SYNC_LOCAL_ONLY.to_string(), None);
    };
    let source_kind = Some(prov.source_kind.clone());
    let installed_hash = hash_skill_dir(skill_dir);
    let source_hash = hash_skill_dir(Path::new(&prov.source_path));
    let state = match (installed_hash, source_hash) {
        (Some(inst), Some(src)) if inst == src => SYNC_IN_SYNC,
        _ => SYNC_DIVERGED,
    };
    (state.to_string(), source_kind)
}

/// Scan a `.claude/skills` directory into [`SkillEntry`] rows. Returns an
/// empty vec when the directory is missing or unreadable — callers that need
/// a hard error (the project-scoped list) resolve + check the dir first via
/// [`skills_dir`]; the global list tolerates a missing library.
pub(crate) fn scan_skills_dir(dir: &Path) -> Vec<SkillEntry> {
    let mut entries = Vec::new();
    let Ok(read_dir) = std::fs::read_dir(dir) else {
        return entries;
    };

    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            // Single-file skill (e.g. skill-name.md directly in skills/)
            if path.extension().and_then(|e| e.to_str()) == Some("md") {
                let name = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string();
                let content = std::fs::read_to_string(&path).ok();
                let desc = content.as_deref().and_then(extract_skill_description);
                entries.push(SkillEntry {
                    name,
                    path: path.to_string_lossy().to_string(),
                    description: desc,
                    reference_file_count: 0,
                    reference_files: vec![],
                    // Single-file `<name>.md` skills carry no provenance sidecar
                    // (nowhere to put one without a dir); always local-only.
                    sync_state: SYNC_LOCAL_ONLY.to_string(),
                    source_kind: None,
                });
            }
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();

        // Look for SKILL.md or skill.md
        let skill_md = path.join("SKILL.md");
        let skill_md_alt = path.join("skill.md");
        let skill_md_path = if skill_md.exists() {
            Some(skill_md)
        } else if skill_md_alt.exists() {
            Some(skill_md_alt)
        } else {
            None
        };

        let description = skill_md_path
            .as_ref()
            .and_then(|p| read_first_line_description(p));

        // Count reference files (everything except SKILL.md and the internal
        // provenance sidecar, which is engine-managed, not user content).
        let mut ref_files = Vec::new();
        if let Ok(sub_entries) = std::fs::read_dir(&path) {
            for sub in sub_entries.flatten() {
                let fname = sub.file_name().to_string_lossy().to_string();
                if fname.to_lowercase() != "skill.md" && fname != PROVENANCE_FILE {
                    ref_files.push(fname);
                }
            }
        }

        let (sync_state, source_kind) = classify_sync_state(&path);

        entries.push(SkillEntry {
            name,
            path: path.to_string_lossy().to_string(),
            description,
            reference_file_count: ref_files.len() as i32,
            reference_files: ref_files,
            sync_state,
            source_kind,
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    entries
}

fn read_first_line_description(skill_md_path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(skill_md_path).ok()?;
    extract_skill_description(&content)
}

/// Short description for a skill's SKILL.md. Prefers the YAML frontmatter
/// `description:` field (Claude Code skills are frontmatter-first); falls back
/// to the first non-empty, non-heading body line. Without this, a frontmatter
/// skill would surface its `---` delimiter as the description.
fn extract_skill_description(content: &str) -> Option<String> {
    let lines: Vec<&str> = content.lines().collect();
    let has_frontmatter = lines.first().map(|l| l.trim()) == Some("---");

    if has_frontmatter {
        // Scan the frontmatter block for `description:`.
        for line in &lines[1..] {
            let t = line.trim();
            if t == "---" {
                break;
            }
            if let Some(rest) = t.strip_prefix("description:") {
                let v = rest.trim().trim_matches(['"', '\'']).trim();
                if !v.is_empty() {
                    return Some(v.chars().take(200).collect());
                }
            }
        }
        // No description key — fall through to the first body line after the
        // closing `---`.
        if let Some(close) = lines.iter().skip(1).position(|l| l.trim() == "---") {
            for line in &lines[close + 2..] {
                let t = line.trim();
                if t.is_empty() || t.starts_with('#') {
                    continue;
                }
                return Some(t.chars().take(200).collect());
            }
        }
        return None;
    }

    // No frontmatter: first non-empty, non-heading line.
    lines
        .iter()
        .map(|l| l.trim())
        .find(|t| !t.is_empty() && !t.starts_with('#'))
        .map(|t| t.chars().take(200).collect())
}

// ============================================================================
// Commands
// ============================================================================

#[tauri::command]
pub fn skill_files_list(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
) -> Result<Vec<SkillEntry>, AppError> {
    require_auth_sync(&state)?;

    let dir = skills_dir(&state, project_id.as_deref())?;
    Ok(scan_skills_dir(&dir))
}

/// List skills from the user-global library (`~/.claude/skills`) — the
/// source for the Fleet skill drawer's "Global library" view. Returns an
/// empty list (not an error) when the user has no global skills yet.
#[tauri::command]
pub fn skill_files_list_global(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<SkillEntry>, AppError> {
    require_auth_sync(&state)?;

    let Some(dir) = global_skills_dir() else {
        return Ok(Vec::new());
    };
    Ok(scan_skills_dir(&dir))
}

/// Install (copy) a skill into a target project's `.claude/skills`.
///
/// `source_project_id = None` reads from the global library
/// (`~/.claude/skills`); `Some(id)` reads from that project's skills. The
/// skill may be a directory (`<name>/SKILL.md` + reference files) or a
/// single-file `<name>.md`. With `overwrite = false`, an existing target
/// skill is left untouched and the result carries `reason = "exists"`.
#[tauri::command]
pub fn skill_files_install(
    state: State<'_, Arc<AppState>>,
    skill_name: String,
    source_project_id: Option<String>,
    target_project_id: String,
    overwrite: bool,
) -> Result<SkillInstallResult, AppError> {
    require_auth_sync(&state)?;
    validate_skill_name(&skill_name)?;

    let source_dir = match source_project_id.as_deref() {
        Some(pid) => project_skills_dir(&state, pid)?,
        None => {
            global_skills_dir().ok_or_else(|| AppError::Internal("no home directory".into()))?
        }
    };
    let target_skills = project_skills_dir(&state, &target_project_id)?;

    // A skill is either a directory or a single `<name>.md` file.
    let src_dir = source_dir.join(&skill_name);
    let src_md = source_dir.join(format!("{skill_name}.md"));

    if src_dir.is_dir() {
        let target_dir = target_skills.join(&skill_name);
        if target_dir.exists() && !overwrite {
            return Ok(SkillInstallResult {
                installed: false,
                target_path: target_dir.to_string_lossy().into_owned(),
                file_count: 0,
                reason: Some("exists".into()),
            });
        }
        let file_count = copy_dir_recursive(&src_dir, &target_dir)?;
        // Stamp provenance so a later scan can detect drift. Source kind mirrors
        // where we read from: global library vs a registered project.
        let (source_kind, source_pid) = match source_project_id.as_deref() {
            Some(pid) => ("project", Some(pid)),
            None => ("global", None),
        };
        write_provenance(&target_dir, &src_dir, source_kind, source_pid);
        Ok(SkillInstallResult {
            installed: true,
            target_path: target_dir.to_string_lossy().into_owned(),
            file_count,
            reason: None,
        })
    } else if src_md.is_file() {
        std::fs::create_dir_all(&target_skills)
            .map_err(|e| AppError::Internal(format!("create target dir failed: {e}")))?;
        let target_md = target_skills.join(format!("{skill_name}.md"));
        if target_md.exists() && !overwrite {
            return Ok(SkillInstallResult {
                installed: false,
                target_path: target_md.to_string_lossy().into_owned(),
                file_count: 0,
                reason: Some("exists".into()),
            });
        }
        std::fs::copy(&src_md, &target_md)
            .map_err(|e| AppError::Internal(format!("copy file failed: {e}")))?;
        Ok(SkillInstallResult {
            installed: true,
            target_path: target_md.to_string_lossy().into_owned(),
            file_count: 1,
            reason: None,
        })
    } else {
        Err(AppError::NotFound(format!(
            "source skill not found: {skill_name}"
        )))
    }
}

/// Preview what a (re-)install of `skill_name` into `target_project_id` would
/// change, WITHOUT writing anything. Compares the source skill's files against
/// whatever is already at the target so the UI can show a diff summary before
/// the user commits an overwrite. Directory skills only; single-file `.md`
/// skills return an empty diff with `target_exists` reflecting presence.
#[tauri::command]
pub fn skill_files_install_preview(
    state: State<'_, Arc<AppState>>,
    skill_name: String,
    source_project_id: Option<String>,
    target_project_id: String,
) -> Result<SkillInstallPreview, AppError> {
    require_auth_sync(&state)?;
    validate_skill_name(&skill_name)?;

    let source_dir = match source_project_id.as_deref() {
        Some(pid) => project_skills_dir(&state, pid)?,
        None => {
            global_skills_dir().ok_or_else(|| AppError::Internal("no home directory".into()))?
        }
    };
    let target_skills = project_skills_dir(&state, &target_project_id)?;

    let src_dir = source_dir.join(&skill_name);
    let src_md = source_dir.join(format!("{skill_name}.md"));

    if src_dir.is_dir() {
        let target_dir = target_skills.join(&skill_name);
        let target_exists = target_dir.exists();
        let source_files = collect_skill_files(&src_dir);
        let target_files = if target_exists {
            collect_skill_files(&target_dir)
        } else {
            BTreeMap::new()
        };

        let mut deltas = Vec::new();
        let (mut changed, mut added, mut removed) = (0i32, 0i32, 0i32);
        for (file, &src_bytes) in &source_files {
            match target_files.get(file) {
                Some(&tgt_bytes) if tgt_bytes == src_bytes => {} // unchanged
                Some(&tgt_bytes) => {
                    changed += 1;
                    deltas.push(SkillFileDelta {
                        file: file.clone(),
                        status: "changed".into(),
                        source_bytes: src_bytes as i64,
                        target_bytes: tgt_bytes as i64,
                    });
                }
                None => {
                    added += 1;
                    deltas.push(SkillFileDelta {
                        file: file.clone(),
                        status: "added".into(),
                        source_bytes: src_bytes as i64,
                        target_bytes: 0,
                    });
                }
            }
        }
        for (file, &tgt_bytes) in &target_files {
            if !source_files.contains_key(file) {
                removed += 1;
                deltas.push(SkillFileDelta {
                    file: file.clone(),
                    status: "removed".into(),
                    source_bytes: 0,
                    target_bytes: tgt_bytes as i64,
                });
            }
        }
        // Cap the per-file list for display; the counts remain exact.
        deltas.truncate(50);

        Ok(SkillInstallPreview {
            skill_name,
            target_path: target_dir.to_string_lossy().into_owned(),
            target_exists,
            changed_count: changed,
            added_count: added,
            removed_count: removed,
            deltas,
        })
    } else if src_md.is_file() {
        let target_md = target_skills.join(format!("{skill_name}.md"));
        let target_exists = target_md.exists();
        let source_bytes = std::fs::metadata(&src_md).map(|m| m.len()).unwrap_or(0);
        let target_bytes = std::fs::metadata(&target_md).map(|m| m.len()).unwrap_or(0);
        let file = format!("{skill_name}.md");
        let (deltas, changed) = if !target_exists {
            (
                vec![SkillFileDelta {
                    file,
                    status: "added".into(),
                    source_bytes: source_bytes as i64,
                    target_bytes: 0,
                }],
                0,
            )
        } else if source_bytes != target_bytes {
            (
                vec![SkillFileDelta {
                    file,
                    status: "changed".into(),
                    source_bytes: source_bytes as i64,
                    target_bytes: target_bytes as i64,
                }],
                1,
            )
        } else {
            (Vec::new(), 0)
        };
        Ok(SkillInstallPreview {
            skill_name,
            target_path: target_md.to_string_lossy().into_owned(),
            target_exists,
            changed_count: changed,
            added_count: if !target_exists { 1 } else { 0 },
            removed_count: 0,
            deltas,
        })
    } else {
        Err(AppError::NotFound(format!(
            "source skill not found: {skill_name}"
        )))
    }
}

#[tauri::command]
pub fn skill_files_read(
    state: State<'_, Arc<AppState>>,
    skill_name: String,
    file_name: String,
    project_id: Option<String>,
) -> Result<SkillFileContent, AppError> {
    require_auth_sync(&state)?;

    let dir = skills_dir(&state, project_id.as_deref())?;
    let file_path = dir.join(&skill_name).join(&file_name);

    // Also try the skill as a direct .md file
    let file_path = if file_path.exists() {
        file_path
    } else {
        let alt = dir.join(format!("{skill_name}.md"));
        if alt.exists() && file_name == format!("{skill_name}.md") {
            alt
        } else {
            return Err(AppError::NotFound(format!(
                "Skill file not found: {skill_name}/{file_name}"
            )));
        }
    };

    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| AppError::Internal(format!("Failed to read skill file: {e}")))?;

    Ok(SkillFileContent {
        skill_name,
        file_name,
        content,
    })
}

#[tauri::command]
pub fn skill_files_write(
    state: State<'_, Arc<AppState>>,
    skill_name: String,
    file_name: String,
    content: String,
    project_id: Option<String>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;

    let dir = skills_dir(&state, project_id.as_deref())?;
    let file_path = dir.join(&skill_name).join(&file_name);

    if !file_path.exists() {
        return Err(AppError::NotFound(format!(
            "Skill file not found: {skill_name}/{file_name}. Cannot create new files from UI."
        )));
    }

    // Validate the path is still within the skills directory (prevent path traversal)
    let canonical_dir = dir
        .canonicalize()
        .map_err(|e| AppError::Internal(format!("Failed to canonicalize skills dir: {e}")))?;
    let canonical_file = file_path
        .canonicalize()
        .map_err(|e| AppError::Internal(format!("Failed to canonicalize file path: {e}")))?;
    if !canonical_file.starts_with(&canonical_dir) {
        return Err(AppError::Validation("Path traversal detected".into()));
    }

    std::fs::write(&file_path, &content)
        .map_err(|e| AppError::Internal(format!("Failed to write skill file: {e}")))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_skill_name_accepts_simple_segments() {
        assert!(validate_skill_name("research").is_ok());
        assert!(validate_skill_name("add-template").is_ok());
        assert!(validate_skill_name("code_review").is_ok());
    }

    #[test]
    fn validate_skill_name_rejects_traversal_and_separators() {
        assert!(validate_skill_name("").is_err());
        assert!(validate_skill_name("..").is_err());
        assert!(validate_skill_name("../evil").is_err());
        assert!(validate_skill_name("a/b").is_err());
        assert!(validate_skill_name("a\\b").is_err());
        assert!(validate_skill_name("C:\\windows").is_err());
    }

    #[test]
    fn extract_description_prefers_frontmatter() {
        let md = "---\nname: scan-security-auditor\ndescription: \"Find security holes.\"\n---\n# Security Auditor\nbody text\n";
        assert_eq!(extract_skill_description(md).as_deref(), Some("Find security holes."));
    }

    #[test]
    fn extract_description_frontmatter_without_desc_uses_body() {
        let md = "---\nname: x\n---\n# Heading\nFirst real line.\n";
        assert_eq!(extract_skill_description(md).as_deref(), Some("First real line."));
    }

    #[test]
    fn extract_description_no_frontmatter_uses_first_line() {
        let md = "# Title\nDo the thing.\n";
        assert_eq!(extract_skill_description(md).as_deref(), Some("Do the thing."));
    }

    fn write_skill(dir: &Path, body: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("SKILL.md"), body).unwrap();
    }

    #[test]
    fn hash_skill_dir_excludes_provenance_and_is_stable() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("skill");
        write_skill(&dir, "---\nname: x\n---\n# X\n");
        let h1 = hash_skill_dir(&dir).unwrap();
        // Adding the provenance sidecar must NOT change the content hash.
        std::fs::write(dir.join(PROVENANCE_FILE), "{\"noise\":true}").unwrap();
        let h2 = hash_skill_dir(&dir).unwrap();
        assert_eq!(h1, h2, "provenance sidecar excluded from hash");
        // Editing real content DOES change it.
        write_skill(&dir, "---\nname: x\n---\n# X changed\n");
        assert_ne!(h1, hash_skill_dir(&dir).unwrap());
    }

    #[test]
    fn classify_sync_state_local_only_without_provenance() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("skill");
        write_skill(&dir, "# hand-authored\n");
        let (state, kind) = classify_sync_state(&dir);
        assert_eq!(state, SYNC_LOCAL_ONLY);
        assert!(kind.is_none());
    }

    #[test]
    fn classify_sync_state_in_sync_then_diverged() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("source");
        let target = tmp.path().join("target");
        write_skill(&source, "---\nname: x\n---\n# X\nbody\n");
        // Simulate an install: copy + provenance stamp.
        copy_dir_recursive(&source, &target).unwrap();
        write_provenance(&target, &source, "global", None);

        let (state, kind) = classify_sync_state(&target);
        assert_eq!(state, SYNC_IN_SYNC, "fresh install matches its source");
        assert_eq!(kind.as_deref(), Some("global"));

        // Upstream source changes → diverged.
        write_skill(&source, "---\nname: x\n---\n# X v2\nnew body\n");
        assert_eq!(classify_sync_state(&target).0, SYNC_DIVERGED);

        // Bring target in line again, then locally edit the target → diverged.
        std::fs::write(target.join("SKILL.md"), "---\nname: x\n---\n# X v2\nnew body\n").unwrap();
        assert_eq!(classify_sync_state(&target).0, SYNC_IN_SYNC);
        std::fs::write(target.join("SKILL.md"), "---\nname: x\n---\n# locally hacked\n").unwrap();
        assert_eq!(classify_sync_state(&target).0, SYNC_DIVERGED);
    }
}
