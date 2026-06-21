//! Per-turn version history for web-build projects (C7). Each build turn commits
//! a snapshot of the project; this lists those snapshots and restores the working
//! tree to one. Scaffolded projects are git repos (create-next-app runs git init),
//! so all of this is best-effort and degrades silently when git isn't available.

use crate::error::AppError;
use serde::Serialize;
use std::path::Path;
use std::process::Command;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BuildVersion {
    pub sha: String,
    pub message: String,
    pub when: String,
}

/// Commit the project's current state as a turn snapshot (best-effort). Skips
/// silently when it isn't a git repo or there's nothing to commit.
pub fn commit_snapshot(project_dir: &Path, summary: &str) {
    let first = summary.trim().lines().next().unwrap_or("build turn");
    let msg = format!("athena: {}", first.chars().take(72).collect::<String>());
    let _ = Command::new("git")
        .current_dir(project_dir)
        .args(["add", "-A"])
        .output();
    let _ = Command::new("git")
        .current_dir(project_dir)
        .args(["commit", "-m", &msg, "--no-verify"])
        .output();
}

/// List recent turn snapshots (newest first, capped). Empty when not a repo.
pub fn list_versions(project_dir: &Path) -> Result<Vec<BuildVersion>, AppError> {
    let out = Command::new("git")
        .current_dir(project_dir)
        .args(["log", "-n", "40", "--pretty=format:%h\u{1f}%s\u{1f}%cr"])
        .output()
        .map_err(|e| AppError::Internal(format!("git log failed: {e}")))?;
    if !out.status.success() {
        return Ok(Vec::new());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let versions = text
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\u{1f}');
            let sha = parts.next()?.trim().to_string();
            if sha.is_empty() {
                return None;
            }
            Some(BuildVersion {
                sha,
                message: parts.next().unwrap_or("").trim().to_string(),
                when: parts.next().unwrap_or("").trim().to_string(),
            })
        })
        .collect();
    Ok(versions)
}

/// Restore the working tree to a prior snapshot (files only — git history is kept,
/// so the next turn simply commits forward from here). Non-destructive to history.
pub fn restore(project_dir: &Path, sha: &str) -> Result<(), AppError> {
    // Guard against arg injection — a git short-sha is hex-ish.
    if sha.is_empty() || sha.len() > 64 || !sha.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::Validation("invalid version id".into()));
    }
    let out = Command::new("git")
        .current_dir(project_dir)
        .args(["checkout", sha, "--", "."])
        .output()
        .map_err(|e| AppError::Internal(format!("git restore failed: {e}")))?;
    if !out.status.success() {
        return Err(AppError::Internal(format!(
            "git restore failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    Ok(())
}
