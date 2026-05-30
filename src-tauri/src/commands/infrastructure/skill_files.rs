//! Skill file browser — lists, reads, and updates `.claude/skills/` files.
//!
//! Used by the dev-tools Skills tab to manage Claude Code skill definitions
//! without requiring terminal access.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

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
fn global_skills_dir() -> Option<PathBuf> {
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

/// Scan a `.claude/skills` directory into [`SkillEntry`] rows. Returns an
/// empty vec when the directory is missing or unreadable — callers that need
/// a hard error (the project-scoped list) resolve + check the dir first via
/// [`skills_dir`]; the global list tolerates a missing library.
fn scan_skills_dir(dir: &Path) -> Vec<SkillEntry> {
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
                let desc = content.as_ref().and_then(|c| {
                    c.lines()
                        .find(|l| !l.trim().is_empty() && !l.trim().starts_with('#'))
                        .map(|l| l.trim().chars().take(200).collect())
                });
                entries.push(SkillEntry {
                    name,
                    path: path.to_string_lossy().to_string(),
                    description: desc,
                    reference_file_count: 0,
                    reference_files: vec![],
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

        // Count reference files (everything except SKILL.md)
        let mut ref_files = Vec::new();
        if let Ok(sub_entries) = std::fs::read_dir(&path) {
            for sub in sub_entries.flatten() {
                let fname = sub.file_name().to_string_lossy().to_string();
                if fname.to_lowercase() != "skill.md" {
                    ref_files.push(fname);
                }
            }
        }

        entries.push(SkillEntry {
            name,
            path: path.to_string_lossy().to_string(),
            description,
            reference_file_count: ref_files.len() as i32,
            reference_files: ref_files,
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    entries
}

fn read_first_line_description(skill_md_path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(skill_md_path).ok()?;
    // Extract the first non-empty, non-heading line as a short description
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        return Some(trimmed.chars().take(200).collect());
    }
    None
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
}
