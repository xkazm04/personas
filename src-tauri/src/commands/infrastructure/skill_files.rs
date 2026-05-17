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
    let mut entries = Vec::new();

    let read_dir = std::fs::read_dir(&dir)
        .map_err(|e| AppError::Internal(format!("Failed to read skills directory: {e}")))?;

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
    Ok(entries)
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
