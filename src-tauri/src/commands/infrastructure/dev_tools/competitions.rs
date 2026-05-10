//! Competition + Dev-Server management commands for the dev-tools plugin.
//!
//! Extracted from `dev_tools.rs` in the 2026-05-10 architect run
//! ([[Architect/decisions/2026-05-10-dev-tools-split]]) to relieve the
//! god-module: 14 commands + 5 helpers + 1 input struct moved here, all
//! re-exported from `dev_tools.rs` via `pub use competitions::*;` so the
//! existing `lib.rs` invoke_handler registration paths
//! (`commands::infrastructure::dev_tools::dev_tools_start_competition` etc.)
//! continue to resolve unchanged.

use std::sync::Arc;
use tauri::State;

use crate::db::models::{DevCompetition, DevCompetitionSlot};
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

// ============================================================================
// Competitions (multi-clone parallel task execution via Claude Code worktrees)
// ============================================================================

/// Capture project health baseline before a competition starts.
/// Runs quick checks (build, test runner detection, git status) to establish
/// a before-snapshot that can be compared to each competitor's after-state.
fn capture_project_baseline(root_path: &str) -> serde_json::Value {
    let root = std::path::Path::new(root_path);

    // TypeScript check (tsc --noEmit) — count errors
    let tsc_errors = std::process::Command::new("npx")
        .args(["tsc", "--noEmit"])
        .current_dir(root)
        .output()
        .ok()
        .map(|out| {
            if out.status.success() {
                0i32
            } else {
                let stderr = String::from_utf8_lossy(&out.stderr);
                let stdout = String::from_utf8_lossy(&out.stdout);
                let combined = format!("{stdout}\n{stderr}");
                combined.lines().filter(|l| l.contains("error TS")).count() as i32
            }
        });

    // Cargo check (for Rust projects)
    let cargo_errors = if root.join("Cargo.toml").exists() {
        std::process::Command::new("cargo")
            .args(["check", "--message-format=short"])
            .current_dir(root)
            .output()
            .ok()
            .map(|out| {
                if out.status.success() {
                    0i32
                } else {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    stderr.lines().filter(|l| l.contains("error[E")).count() as i32
                }
            })
    } else {
        None
    };

    // Test runner detection
    let has_test_config = root.join("vitest.config.ts").exists()
        || root.join("vitest.config.js").exists()
        || root.join("jest.config.ts").exists()
        || root.join("jest.config.js").exists()
        || root.join("jest.config.cjs").exists()
        || root.join("pytest.ini").exists()
        || root.join("pyproject.toml").exists();

    // Git status — clean or dirty
    let git_clean = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(root)
        .output()
        .ok()
        .map(|out| out.status.success() && String::from_utf8_lossy(&out.stdout).trim().is_empty())
        .unwrap_or(false);

    serde_json::json!({
        "tsc_errors": tsc_errors,
        "cargo_errors": cargo_errors,
        "has_test_runner": has_test_config,
        "git_clean": git_clean,
        "captured_at": chrono::Utc::now().to_rfc3339(),
    })
}

/// Strategy slot config for a single competitor in a competition.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct CompetitionSlotInput {
    pub label: String,
    pub prompt: Option<String>,
}

/// Start a competition: spawn N dev_tasks on the same work item, each with
/// a distinct worktree name. Claude Code creates isolated git worktrees so
/// the runs don't clobber each other. Each task's `session_id` is set to
/// "worktree:<name>" which the task executor reads to add --worktree flag.
///
/// `worktree_base_ref` is the optional Claude CLI 2.1.133 `worktree.baseRef`
/// setting — `"head"` (current default, branch from local HEAD) or
/// `"fresh"` (branch from `origin/<default>` for a clean baseline). When
/// set, personas merges the value into `<project_root>/.claude/settings.json`
/// before spawning the slots; preserves any other user-authored keys. NULL
/// leaves settings.json untouched and Claude Code uses its built-in default.
#[tauri::command]
pub fn dev_tools_start_competition(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    task_title: String,
    task_description: Option<String>,
    source_idea_id: Option<String>,
    source_goal_id: Option<String>,
    slots: Vec<CompetitionSlotInput>,
    worktree_base_ref: Option<String>,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;

    if slots.len() < 2 || slots.len() > 4 {
        return Err(AppError::Validation(
            "Competition requires 2–4 slots".into(),
        ));
    }
    if task_title.trim().is_empty() {
        return Err(AppError::Validation("Task title cannot be empty".into()));
    }
    if let Some(ref v) = worktree_base_ref {
        if !crate::engine::worktree_settings::VALID_BASE_REFS.contains(&v.as_str()) {
            return Err(AppError::Validation(
                "worktree_base_ref must be 'head' or 'fresh'".into(),
            ));
        }
    }

    // Verify project exists
    let project = repo::get_project_by_id(&state.db, &project_id)?;

    // Baseline capture — measure project health BEFORE competitors run.
    // Non-blocking: if any check fails, we still create the competition.
    let baseline = capture_project_baseline(&project.root_path);

    // Apply worktree.baseRef into <project_root>/.claude/settings.json if
    // requested. Best-effort: a failure here logs and falls through so the
    // competition still runs with whatever settings.json (if any) already
    // says. Claude CLI < 2.1.133 silently ignores the unknown key, so the
    // write is forward-compatible.
    if let Some(ref base_ref) = worktree_base_ref {
        if let Err(e) = crate::engine::worktree_settings::apply_worktree_base_ref(
            std::path::Path::new(&project.root_path),
            base_ref,
        ) {
            tracing::warn!(
                error = %e,
                project_id = %project_id,
                "worktree_settings: skipping merge — competition will use existing settings.json"
            );
        }
    }

    // Create competition row
    let competition = repo::create_competition(
        &state.db,
        &project_id,
        &task_title,
        task_description.as_deref(),
        source_idea_id.as_deref(),
        source_goal_id.as_deref(),
        slots.len() as i32,
        worktree_base_ref.as_deref(),
    )?;

    // Persist the baseline on the competition record (best-effort update)
    if let Ok(baseline_str) = serde_json::to_string(&baseline) {
        let _ = state.db.get().map(|conn| {
            conn.execute(
                "UPDATE dev_competitions SET baseline_json = ?1 WHERE id = ?2",
                rusqlite::params![baseline_str, competition.id],
            )
        });
    }

    // Short competition tag used inside worktree names (Claude Code trims + normalizes)
    let comp_tag: String = competition.id.chars().take(8).collect();

    let mut created_slots: Vec<DevCompetitionSlot> = Vec::new();
    for (idx, slot_input) in slots.iter().enumerate() {
        // Derive a stable, unique, URL-safe worktree name.
        let slug: String = slot_input
            .label
            .to_lowercase()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect::<String>()
            .trim_matches('-')
            .chars()
            .take(20)
            .collect();
        let worktree_name = format!(
            "comp-{}-{}-{}",
            comp_tag,
            idx,
            if slug.is_empty() {
                "slot".to_string()
            } else {
                slug
            }
        );

        // Compose the per-slot prompt: base task + strategy prompt override if given
        let composed_description = match &slot_input.prompt {
            Some(p) => {
                let base = task_description.as_deref().unwrap_or("");
                format!("{base}\n\n## Strategy override — {}\n{p}", slot_input.label)
            }
            None => task_description.clone().unwrap_or_default(),
        };

        // Create the dev_task for this slot
        let task = repo::create_task(
            &state.db,
            Some(&project_id),
            &format!("{} · {}", task_title, slot_input.label),
            Some(&composed_description),
            source_idea_id.as_deref(),
            source_goal_id.as_deref(),
            Some("queued"),
            None,
        )?;

        // Tag the task with its worktree name via session_id
        // (convention: session_id = "worktree:<name>" → task executor adds --worktree)
        let session_value = format!("worktree:{}", worktree_name);
        let _ = repo::update_task(
            &state.db,
            &task.id,
            None,
            None,
            None,
            Some(Some(&session_value)),
            None,
            None,
            None,
            None,
            None,
        );

        let slot = repo::create_competition_slot(
            &state.db,
            &competition.id,
            &task.id,
            &slot_input.label,
            slot_input.prompt.as_deref(),
            &worktree_name,
            idx as i32,
        )?;
        created_slots.push(slot);
    }

    Ok(serde_json::json!({
        "competition": competition,
        "slots": created_slots,
    }))
}

#[tauri::command]
pub fn dev_tools_list_competitions(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    status: Option<String>,
) -> Result<Vec<DevCompetition>, AppError> {
    require_auth_sync(&state)?;
    repo::list_competitions_by_project(&state.db, &project_id, status.as_deref())
}

#[tauri::command]
pub fn dev_tools_get_competition(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let competition = repo::get_competition_by_id(&state.db, &id)?;
    let project = repo::get_project_by_id(&state.db, &competition.project_id)?;
    let slots = repo::list_competition_slots(&state.db, &id)?;

    // Lazy diff analysis: for every slot whose task is completed but hasn't been
    // analyzed yet, compute the diff + stats + hash and persist it.
    let mut analyzed_slots: Vec<crate::db::models::DevCompetitionSlot> = Vec::new();
    for slot in slots {
        let task = repo::get_task_by_id(&state.db, &slot.task_id).ok();
        let needs_analysis = slot.diff_analyzed_at.is_none()
            && task
                .as_ref()
                .map(|t| t.status == "completed")
                .unwrap_or(false);

        let updated_slot = if needs_analysis {
            if let Some((_diff_text, diff_hash, files, added, removed)) =
                compute_slot_diff(&project.root_path, &slot.worktree_name)
            {
                let stats_json = serde_json::json!({
                    "files_changed": files,
                    "lines_added": added,
                    "lines_removed": removed,
                })
                .to_string();
                // Empty diff → auto-disqualify
                let (dq, reason) = if files == 0 && added == 0 && removed == 0 {
                    (true, Some("Empty diff — no files changed"))
                } else {
                    (false, None)
                };
                repo::update_slot_diff_analysis(
                    &state.db,
                    &slot.id,
                    Some(&diff_hash),
                    Some(&stats_json),
                    dq,
                    reason,
                )
                .unwrap_or(slot)
            } else {
                slot
            }
        } else {
            slot
        };
        analyzed_slots.push(updated_slot);
    }

    // Duplicate detection: any two slots with the same non-null diff_hash →
    // keep the earliest (lowest slot_index) as-is and mark the others as
    // duplicates. Only flip if not already disqualified for a different reason.
    let mut first_seen: std::collections::HashMap<String, i32> = std::collections::HashMap::new();
    for slot in &analyzed_slots {
        if let Some(ref h) = slot.diff_hash {
            first_seen.entry(h.clone()).or_insert(slot.slot_index);
        }
    }
    let mut after_dedup: Vec<crate::db::models::DevCompetitionSlot> = Vec::new();
    for slot in analyzed_slots {
        let is_dup = match (&slot.diff_hash, slot.disqualified) {
            (Some(h), false) => first_seen
                .get(h)
                .map(|&idx| idx < slot.slot_index)
                .unwrap_or(false),
            _ => false,
        };
        let resolved_slot = if is_dup {
            repo::update_slot_diff_analysis(
                &state.db,
                &slot.id,
                slot.diff_hash.as_deref(),
                slot.diff_stats_json.as_deref(),
                true,
                Some("Duplicate of an earlier competitor's diff"),
            )
            .unwrap_or(slot)
        } else {
            slot
        };
        after_dedup.push(resolved_slot);
    }

    // Also auto-advance competition status to awaiting_review if all tasks are done
    let enriched_slots: Vec<serde_json::Value> = after_dedup
        .iter()
        .map(|s| {
            let task = repo::get_task_by_id(&state.db, &s.task_id).ok();
            serde_json::json!({ "slot": s, "task": task })
        })
        .collect();

    let all_finished = enriched_slots.iter().all(|entry| {
        entry
            .get("task")
            .and_then(|t| t.get("status"))
            .and_then(|s| s.as_str())
            .map(|s| matches!(s, "completed" | "failed" | "cancelled"))
            .unwrap_or(false)
    });
    let updated_competition = if all_finished && competition.status == "running" {
        repo::update_competition_status(&state.db, &id, "awaiting_review", None, None, None)
            .unwrap_or(competition)
    } else {
        competition
    };

    Ok(serde_json::json!({
        "competition": updated_competition,
        "slots": enriched_slots,
    }))
}

/// Force refresh a single slot's diff analysis (e.g. after a manual git operation).
#[tauri::command]
pub fn dev_tools_refresh_competition_slot(
    state: State<'_, Arc<AppState>>,
    slot_id: String,
) -> Result<crate::db::models::DevCompetitionSlot, AppError> {
    require_auth_sync(&state)?;
    // Look up the slot → competition → project to get the root_path
    let conn = state.db.get()?;
    let slot: crate::db::models::DevCompetitionSlot = conn
        .query_row(
            "SELECT * FROM dev_competition_slots WHERE id = ?1",
            rusqlite::params![slot_id],
            |row| {
                Ok(crate::db::models::DevCompetitionSlot {
                    id: row.get("id")?,
                    competition_id: row.get("competition_id")?,
                    task_id: row.get("task_id")?,
                    strategy_label: row.get("strategy_label")?,
                    strategy_prompt: row.get("strategy_prompt")?,
                    worktree_name: row.get("worktree_name")?,
                    branch_name: row.get("branch_name")?,
                    slot_index: row.get("slot_index")?,
                    disqualified: row.get::<_, i32>("disqualified").unwrap_or(0) != 0,
                    disqualify_reason: row
                        .get::<_, Option<String>>("disqualify_reason")
                        .ok()
                        .flatten(),
                    diff_hash: row.get::<_, Option<String>>("diff_hash").ok().flatten(),
                    diff_stats_json: row
                        .get::<_, Option<String>>("diff_stats_json")
                        .ok()
                        .flatten(),
                    diff_analyzed_at: row
                        .get::<_, Option<String>>("diff_analyzed_at")
                        .ok()
                        .flatten(),
                    created_at: row.get("created_at")?,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Slot {slot_id}")),
            other => AppError::Database(other),
        })?;
    drop(conn);

    let competition = repo::get_competition_by_id(&state.db, &slot.competition_id)?;
    let project = repo::get_project_by_id(&state.db, &competition.project_id)?;

    if let Some((_diff_text, diff_hash, files, added, removed)) =
        compute_slot_diff(&project.root_path, &slot.worktree_name)
    {
        let stats_json = serde_json::json!({
            "files_changed": files,
            "lines_added": added,
            "lines_removed": removed,
        })
        .to_string();
        let (dq, reason) = if files == 0 && added == 0 && removed == 0 {
            (true, Some("Empty diff — no files changed"))
        } else {
            (false, None)
        };
        repo::update_slot_diff_analysis(
            &state.db,
            &slot.id,
            Some(&diff_hash),
            Some(&stats_json),
            dq,
            reason,
        )
    } else {
        Ok(slot)
    }
}

/// Return the unified diff text for a slot's worktree branch (for preview UI).
#[tauri::command]
pub fn dev_tools_get_competition_slot_diff(
    state: State<'_, Arc<AppState>>,
    slot_id: String,
) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    let conn = state.db.get()?;
    let (worktree_name, competition_id): (String, String) = conn
        .query_row(
            "SELECT worktree_name, competition_id FROM dev_competition_slots WHERE id = ?1",
            rusqlite::params![slot_id],
            |row| Ok((row.get("worktree_name")?, row.get("competition_id")?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Slot {slot_id}")),
            other => AppError::Database(other),
        })?;
    drop(conn);

    let competition = repo::get_competition_by_id(&state.db, &competition_id)?;
    let project = repo::get_project_by_id(&state.db, &competition.project_id)?;

    match compute_slot_diff(&project.root_path, &worktree_name) {
        Some((diff_text, _, _, _, _)) => Ok(diff_text),
        None => Ok(String::new()),
    }
}

/// Compute the unified diff + stats for a competitor worktree branch vs the
/// project's current HEAD. Returns (diff_text, diff_hash, files_changed, lines_added, lines_removed).
/// Best-effort: returns None if git fails or the branch doesn't exist.
fn compute_slot_diff(
    project_root: &str,
    worktree_name: &str,
) -> Option<(String, String, i32, i32, i32)> {
    use sha2::{Digest, Sha256};

    let branch = format!("worktree-{}", worktree_name);
    let worktree_path = std::path::PathBuf::from(project_root)
        .join(".claude")
        .join("worktrees")
        .join(worktree_name);

    // Strategy 1: Check committed branch diff (HEAD...branch from project root).
    // This captures changes that Claude committed on the worktree branch.
    let branch_diff = std::process::Command::new("git")
        .args(["diff", "--unified=3"])
        .arg(format!("HEAD...{}", branch))
        .current_dir(project_root)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    // Strategy 2: Check UNCOMMITTED changes inside the worktree directory.
    // Claude Code sometimes makes changes but doesn't commit them.
    let uncommitted_diff = if worktree_path.exists() {
        std::process::Command::new("git")
            .args(["diff", "--unified=3", "HEAD"])
            .current_dir(&worktree_path)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .unwrap_or_default()
    } else {
        String::new()
    };

    // Use whichever diff is larger (more informative).
    // If Claude committed, branch_diff has the changes.
    // If Claude didn't commit, uncommitted_diff has the working-tree changes.
    let use_branch_diff = branch_diff.len() >= uncommitted_diff.len();
    let diff_text = if use_branch_diff {
        branch_diff
    } else {
        uncommitted_diff
    };

    if diff_text.is_empty() {
        // Last resort: check for untracked new files in the worktree
        if worktree_path.exists() {
            let untracked = std::process::Command::new("git")
                .args(["status", "--porcelain"])
                .current_dir(&worktree_path)
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                .unwrap_or_default();
            if untracked.trim().is_empty() {
                // Genuinely no changes at all
            }
        }
    }

    // Hash the diff for duplicate detection
    let mut hasher = Sha256::new();
    hasher.update(diff_text.as_bytes());
    let diff_hash = format!("{:x}", hasher.finalize());

    // Compute stats — use numstat for the same source we picked
    let numstat_args = if use_branch_diff {
        // Branch diff — run from project root
        let out = std::process::Command::new("git")
            .args(["diff", "--numstat"])
            .arg(format!("HEAD...{}", branch))
            .current_dir(project_root)
            .output()
            .ok();
        out
    } else {
        // Uncommitted diff — run from worktree
        std::process::Command::new("git")
            .args(["diff", "--numstat", "HEAD"])
            .current_dir(&worktree_path)
            .output()
            .ok()
    };

    let mut files_changed = 0i32;
    let mut lines_added = 0i32;
    let mut lines_removed = 0i32;
    if let Some(stats_out) = numstat_args {
        let stats_text = String::from_utf8_lossy(&stats_out.stdout);
        for line in stats_text.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 3 {
                files_changed += 1;
                if let Ok(a) = parts[0].parse::<i32>() {
                    lines_added += a;
                }
                if let Ok(r) = parts[1].parse::<i32>() {
                    lines_removed += r;
                }
            }
        }
    }

    Some((
        diff_text,
        diff_hash,
        files_changed,
        lines_added,
        lines_removed,
    ))
}

/// Open a competition slot's worktree directory for review.
/// Returns the absolute path that the frontend can open in a terminal/editor.
#[tauri::command]
pub fn dev_tools_switch_to_worktree(
    state: State<'_, Arc<AppState>>,
    slot_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;

    let conn = state.db.get()?;
    let (worktree_name, competition_id): (String, String) = conn
        .query_row(
            "SELECT worktree_name, competition_id FROM dev_competition_slots WHERE id = ?1",
            rusqlite::params![slot_id],
            |row| Ok((row.get("worktree_name")?, row.get("competition_id")?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Slot {slot_id}")),
            other => AppError::Database(other),
        })?;
    drop(conn);

    let competition = repo::get_competition_by_id(&state.db, &competition_id)?;
    let project = repo::get_project_by_id(&state.db, &competition.project_id)?;

    let worktree_path = std::path::PathBuf::from(&project.root_path)
        .join(".claude")
        .join("worktrees")
        .join(&worktree_name);

    let branch_name = format!("worktree-{}", worktree_name);

    if !worktree_path.exists() {
        return Err(AppError::Validation(format!(
            "Worktree directory does not exist: {}. The competition may have been cleaned up.",
            worktree_path.display()
        )));
    }

    // Reveal the worktree directory in the OS file manager
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg(worktree_path.to_string_lossy().as_ref())
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg(worktree_path.to_string_lossy().as_ref())
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open")
            .arg(worktree_path.to_string_lossy().as_ref())
            .spawn();
    }

    Ok(serde_json::json!({
        "worktree_path": worktree_path.to_string_lossy(),
        "branch_name": branch_name,
        "project_root": project.root_path,
    }))
}

/// Remove a Claude Code worktree by shelling out to `git worktree remove --force`.
/// Returns true if removal succeeded, false (and logs a warning) on any failure.
/// Non-fatal by design: if cleanup fails, the competition status change still proceeds.
fn remove_claude_worktree(project_root: &str, worktree_name: &str) -> bool {
    let worktree_path = std::path::PathBuf::from(project_root)
        .join(".claude")
        .join("worktrees")
        .join(worktree_name);

    // If the directory doesn't exist, nothing to clean up.
    if !worktree_path.exists() {
        return true;
    }

    // `git worktree remove --force <path>` — force is required because Claude Code
    // may leave the working tree dirty (uncommitted changes from the competitor run).
    let output = std::process::Command::new("git")
        .args(["worktree", "remove", "--force"])
        .arg(&worktree_path)
        .current_dir(project_root)
        .output();

    match output {
        Ok(out) if out.status.success() => {
            tracing::info!("Removed Claude Code worktree: {}", worktree_name);
            true
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            tracing::warn!(
                "git worktree remove failed for {}: {}. Falling back to rm -rf.",
                worktree_name,
                stderr
            );
            // Fallback: direct filesystem removal if the git command refuses
            // (e.g. worktree was never properly registered).
            match std::fs::remove_dir_all(&worktree_path) {
                Ok(_) => true,
                Err(e) => {
                    tracing::warn!("Failed to remove worktree dir {}: {}", worktree_name, e);
                    false
                }
            }
        }
        Err(e) => {
            tracing::warn!(
                "Failed to invoke git worktree remove for {}: {}",
                worktree_name,
                e
            );
            false
        }
    }
}

/// Also delete the associated branch (git worktree remove leaves the branch behind).
/// Best-effort; logs warnings on failure.
fn remove_claude_worktree_branch(project_root: &str, worktree_name: &str) -> bool {
    // Claude Code names the branch `worktree-<name>`.
    let branch_name = format!("worktree-{}", worktree_name);
    let output = std::process::Command::new("git")
        .args(["branch", "-D", &branch_name])
        .current_dir(project_root)
        .output();
    match output {
        Ok(out) if out.status.success() => true,
        Ok(out) => {
            tracing::debug!(
                "git branch -D {} did not succeed (may not exist): {}",
                branch_name,
                String::from_utf8_lossy(&out.stderr)
            );
            false
        }
        Err(e) => {
            tracing::debug!("Failed to invoke git branch -D {}: {}", branch_name, e);
            false
        }
    }
}

#[tauri::command]
pub fn dev_tools_pick_competition_winner(
    state: State<'_, Arc<AppState>>,
    id: String,
    winner_task_id: String,
    reviewer_notes: Option<String>,
    winner_insight: Option<String>,
) -> Result<DevCompetition, AppError> {
    require_auth_sync(&state)?;

    let competition = repo::get_competition_by_id(&state.db, &id)?;
    let slots = repo::list_competition_slots(&state.db, &id)?;

    // Verify the winner is part of this competition
    let winner_slot = slots
        .iter()
        .find(|s| s.task_id == winner_task_id)
        .ok_or_else(|| {
            AppError::Validation("Winner task_id is not part of this competition".into())
        })?;

    // Resolve project root so we can clean up loser worktrees on the filesystem
    let project = repo::get_project_by_id(&state.db, &competition.project_id)?;

    // Cleanup every LOSER worktree (winner's worktree stays so user can review/merge/push)
    let mut cleaned = 0u32;
    let mut failed = 0u32;
    for slot in &slots {
        if slot.task_id == winner_task_id {
            continue;
        }
        if remove_claude_worktree(&project.root_path, &slot.worktree_name) {
            let _ = remove_claude_worktree_branch(&project.root_path, &slot.worktree_name);
            cleaned += 1;
        } else {
            failed += 1;
        }
    }
    tracing::info!(
        "Competition {} resolved: cleaned {} loser worktrees ({} failures), winner worktree {} kept for review",
        id, cleaned, failed, winner_slot.worktree_name,
    );

    // Persist the resolved status + insight (insight propagation to persona memory
    // happens lazily — the next Dev Clone execution injects winning insights via
    // a new shared memory helper, see dev_tools_apply_winner_insight below).
    let resolved = repo::update_competition_status(
        &state.db,
        &id,
        "resolved",
        Some(&winner_task_id),
        reviewer_notes.as_deref(),
        winner_insight.as_deref(),
    )?;

    // Best-effort: if a winner insight was provided, write it to the Dev Clone
    // persona's memory so the next execution can learn from it. Non-fatal.
    if let Some(ref insight_text) = winner_insight {
        let _ = apply_winner_insight_to_dev_clone_memory(
            &state.db,
            &id,
            &winner_slot.strategy_label,
            insight_text,
        );

        // Also push to Obsidian vault (best-effort — vault may not be configured)
        let _ = crate::commands::obsidian_brain::push_competition_insight_to_vault(
            &state.db,
            &id,
            &winner_slot.strategy_label,
            insight_text,
            &project.name,
            &resolved.task_title,
        );
    }

    Ok(resolved)
}

/// Find the Dev Clone persona by name and create a "learned" memory entry
/// containing the winning approach from a competition. Best-effort — failure
/// never blocks the winner-pick flow.
fn apply_winner_insight_to_dev_clone_memory(
    pool: &crate::db::DbPool,
    competition_id: &str,
    winning_strategy: &str,
    insight_text: &str,
) -> Result<(), AppError> {
    use crate::db::models::CreatePersonaMemoryInput;
    use crate::db::models::Json;
    use crate::db::repos::core::memories as mem_repo;
    use crate::db::repos::core::personas as persona_repo;

    // Find a persona whose name contains "dev clone" (case-insensitive)
    let personas = persona_repo::get_all(pool)?;
    let dev_clone = personas.iter().find(|p| {
        let name = p.name.to_lowercase();
        name.contains("dev clone") || name.contains("dev-clone")
    });

    let Some(persona) = dev_clone else {
        tracing::info!("No Dev Clone persona found — skipping memory insight");
        return Ok(());
    };

    let title = format!("Winning approach from competition {}", &competition_id[..8]);
    let content = format!(
        "In competition {}, the `{}` strategy won. Key insight:\n\n{}",
        competition_id, winning_strategy, insight_text
    );

    let _ = mem_repo::create(
        pool,
        CreatePersonaMemoryInput {
            persona_id: persona.id.clone(),
            source_execution_id: None,
            title,
            content,
            category: Some("learned".to_string()),
            importance: Some(7),
            tags: Some(Json(vec![
                "competition".to_string(),
                "winner".to_string(),
                winning_strategy.to_lowercase(),
            ])),
            use_case_id: None,
        },
    );

    tracing::info!(
        "Wrote competition winner insight to Dev Clone persona memory (competition {})",
        competition_id
    );
    Ok(())
}

#[tauri::command]
pub fn dev_tools_get_strategy_leaderboard(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Vec<crate::db::models::DevStrategyStats>, AppError> {
    require_auth_sync(&state)?;
    repo::get_strategy_leaderboard(&state.db, &project_id)
}

#[tauri::command]
pub fn dev_tools_cancel_competition(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    id: String,
) -> Result<DevCompetition, AppError> {
    require_auth_sync(&state)?;

    let competition = repo::get_competition_by_id(&state.db, &id)?;
    let slots = repo::list_competition_slots(&state.db, &id)?;
    let project = repo::get_project_by_id(&state.db, &competition.project_id)?;

    // First: cancel any running competitor tasks so they stop writing to the worktrees
    for slot in &slots {
        let _ = crate::commands::infrastructure::task_executor::cancel_running_task(
            &state.db,
            &app,
            &slot.task_id,
        );
    }

    // Then: remove every worktree and its branch (best-effort)
    for slot in &slots {
        if remove_claude_worktree(&project.root_path, &slot.worktree_name) {
            let _ = remove_claude_worktree_branch(&project.root_path, &slot.worktree_name);
        }
    }
    tracing::info!(
        "Competition {} cancelled: cancelled {} tasks and cleaned all worktrees",
        id,
        slots.len(),
    );

    repo::update_competition_status(&state.db, &id, "cancelled", None, None, None)
}

// ============================================================================
// Dev Server management (launch preview servers per worktree)
// ============================================================================

/// Global registry of running dev servers for competition worktrees.
/// Key: slot_id, Value: (child PID, port)
static DEV_SERVERS: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<String, (u32, u16)>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

/// Find a free TCP port by binding to port 0.
fn find_free_port() -> Option<u16> {
    std::net::TcpListener::bind("127.0.0.1:0")
        .ok()
        .map(|l| l.local_addr().unwrap().port())
}

/// Detect the dev server command from package.json in a directory.
fn detect_dev_command(dir: &std::path::Path) -> (String, Vec<String>) {
    let pkg_json = dir.join("package.json");
    if pkg_json.exists() {
        if let Ok(content) = std::fs::read_to_string(&pkg_json) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                let scripts = parsed.get("scripts").and_then(|s| s.as_object());
                if let Some(s) = scripts {
                    // Prefer "dev" script, fall back to "start"
                    if s.contains_key("dev") {
                        return (
                            "npm".to_string(),
                            vec!["run".to_string(), "dev".to_string()],
                        );
                    }
                    if s.contains_key("start") {
                        return (
                            "npm".to_string(),
                            vec!["run".to_string(), "start".to_string()],
                        );
                    }
                }
            }
        }
    }
    // Fallback for Python/Rust
    if dir.join("manage.py").exists() {
        return (
            "python".to_string(),
            vec!["manage.py".to_string(), "runserver".to_string()],
        );
    }
    (
        "npm".to_string(),
        vec!["run".to_string(), "dev".to_string()],
    )
}

/// Start a dev server in a competition slot's worktree.
/// Returns the port and URL for the frontend to display.
#[tauri::command]
pub fn dev_tools_start_slot_server(
    state: State<'_, Arc<AppState>>,
    slot_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;

    // Check if already running
    {
        let servers = DEV_SERVERS.lock().unwrap();
        if let Some((pid, port)) = servers.get(&slot_id) {
            return Ok(serde_json::json!({
                "status": "already_running",
                "port": port,
                "pid": pid,
                "url": format!("http://localhost:{}", port),
            }));
        }
    }

    // Look up the worktree path
    let conn = state.db.get()?;
    let (worktree_name, competition_id): (String, String) = conn
        .query_row(
            "SELECT worktree_name, competition_id FROM dev_competition_slots WHERE id = ?1",
            rusqlite::params![slot_id],
            |row| Ok((row.get("worktree_name")?, row.get("competition_id")?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Slot {slot_id}")),
            other => AppError::Database(other),
        })?;
    drop(conn);

    let competition = repo::get_competition_by_id(&state.db, &competition_id)?;
    let project = repo::get_project_by_id(&state.db, &competition.project_id)?;

    let worktree_path = std::path::PathBuf::from(&project.root_path)
        .join(".claude")
        .join("worktrees")
        .join(&worktree_name);

    if !worktree_path.exists() {
        return Err(AppError::Validation(
            "Worktree directory does not exist".into(),
        ));
    }

    let port =
        find_free_port().ok_or_else(|| AppError::Internal("Could not find a free port".into()))?;

    let (cmd_name, mut cmd_args) = detect_dev_command(&worktree_path);

    // Inject port via common env var patterns
    // Next.js/Vite: PORT env var. Also pass --port for Vite.
    let is_vite = worktree_path.join("vite.config.ts").exists()
        || worktree_path.join("vite.config.js").exists();

    if is_vite {
        cmd_args.push("--".to_string());
        cmd_args.push("--port".to_string());
        cmd_args.push(port.to_string());
    }

    let mut command = std::process::Command::new(&cmd_name);
    command
        .args(&cmd_args)
        .current_dir(&worktree_path)
        .env("PORT", port.to_string())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let child = command
        .spawn()
        .map_err(|e| AppError::Internal(format!("Failed to start dev server: {e}")))?;

    let pid = child.id();
    tracing::info!(
        "Started dev server for slot {} on port {} (PID {})",
        slot_id,
        port,
        pid
    );

    DEV_SERVERS
        .lock()
        .unwrap()
        .insert(slot_id.clone(), (pid, port));

    Ok(serde_json::json!({
        "status": "started",
        "port": port,
        "pid": pid,
        "url": format!("http://localhost:{}", port),
        "command": format!("{} {}", cmd_name, cmd_args.join(" ")),
    }))
}

/// Stop a running dev server for a competition slot.
#[tauri::command]
pub fn dev_tools_stop_slot_server(
    state: State<'_, Arc<AppState>>,
    slot_id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    let entry = DEV_SERVERS.lock().unwrap().remove(&slot_id);
    if let Some((pid, port)) = entry {
        tracing::info!(
            "Stopping dev server for slot {} (PID {}, port {})",
            slot_id,
            pid,
            port
        );

        // Kill the process tree
        #[cfg(windows)]
        {
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .output();
        }
        #[cfg(not(windows))]
        {
            let _ = std::process::Command::new("kill")
                .args(["-9", &pid.to_string()])
                .output();
        }

        Ok(true)
    } else {
        Ok(false)
    }
}

/// Delete a resolved or cancelled competition and its slots from the database.
/// Also cleans up any remaining worktrees.
#[tauri::command]
pub fn dev_tools_delete_competition(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    let competition = repo::get_competition_by_id(&state.db, &id)?;
    if competition.status != "resolved" && competition.status != "cancelled" {
        return Err(AppError::Validation(
            "Can only delete resolved or cancelled competitions".into(),
        ));
    }
    // Cleanup any remaining worktrees (winner's worktree may still exist)
    if let Ok(project) = repo::get_project_by_id(&state.db, &competition.project_id) {
        if let Ok(slots) = repo::list_competition_slots(&state.db, &id) {
            for slot in &slots {
                let _ = remove_claude_worktree(&project.root_path, &slot.worktree_name);
                let _ = remove_claude_worktree_branch(&project.root_path, &slot.worktree_name);
            }
        }
    }
    // CASCADE delete: slots are deleted automatically via foreign key
    let conn = state.db.get()?;
    let count = conn.execute(
        "DELETE FROM dev_competitions WHERE id = ?1",
        rusqlite::params![id],
    )?;
    Ok(count > 0)
}
