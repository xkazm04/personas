use crate::db::models::{GitOperationResult, TestRunResult};
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;
use serde::Serialize;
use std::sync::Arc;
use tauri::State;
use ts_rs::TS;

// ============================================================================
// Direction 3: Agent-Driven Implementation Pipeline
// ============================================================================

/// Create a git branch in a project.
#[tauri::command]
pub async fn dev_tools_create_branch(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    branch_name: String,
    base_branch: Option<String>,
) -> Result<GitOperationResult, AppError> {
    require_auth_sync(&state)?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    let base = base_branch.unwrap_or_else(|| "HEAD".to_string());

    let output = tokio::process::Command::new("git")
        .args(["checkout", "-b", &branch_name, &base])
        .current_dir(&project.root_path)
        .output()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to run git: {e}")))?;

    let success = output.status.success();
    let message = if success {
        String::from_utf8_lossy(&output.stdout).to_string()
    } else {
        String::from_utf8_lossy(&output.stderr).to_string()
    };

    Ok(GitOperationResult {
        success,
        message: message.trim().to_string(),
        branch_name: if success { Some(branch_name) } else { None },
        commit_hash: None,
        files_changed: None,
    })
}

/// Apply a unified diff to files in a project.
///
/// **App master mandate chokepoint (P4).** This is the one place in the
/// codebase where a proposal exists as a *diff* before it exists as a change to
/// the working tree, so it is where the forbidden-change classes are enforced.
/// If the project carries an App master mandate, the diff is scanned by the
/// deterministic detector in `personas_engine::app_master` and:
///
/// - a hit **blocks the apply** — the diff is never partially applied, and it
///   is never rewritten into an allowed shape (a rewritten proposal teaches the
///   holder which shapes evade the check, which is worse than the change);
/// - every hit is recorded on the event ledger as a
///   `app_master.forbidden_class_violation` carrying the matched rule and path,
///   which is what the reporter's `forbiddenClassViolations` counts;
/// - the error names the rule and the path, so the refusal can be argued with.
///
/// A project with no App master takes exactly the path it took before.
#[tauri::command]
pub async fn dev_tools_apply_diff(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    diff_content: String,
) -> Result<GitOperationResult, AppError> {
    require_auth_sync(&state)?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    enforce_app_master_mandate(&state.db, &project_id, &diff_content)?;

    let mut child = tokio::process::Command::new("git")
        .args(["apply", "--stat", "--apply", "-"])
        .current_dir(&project.root_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AppError::ProcessSpawn(format!("Failed to spawn git apply: {e}")))?;

    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        stdin.write_all(diff_content.as_bytes()).await.ok();
        drop(stdin);
    }

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| AppError::Internal(format!("git apply failed: {e}")))?;

    let success = output.status.success();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    Ok(GitOperationResult {
        success,
        message: if success {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        },
        branch_name: None,
        commit_hash: None,
        files_changed: None,
    })
}

/// Refuse a diff that touches one of the project's forbidden change classes.
///
/// `Ok(())` for every project with no App master mandate — the gate is strictly
/// additive. `upgrade_goal` is `false` here because nothing at this call site
/// states one: `dev_tools_apply_diff` takes a project and a blob of diff, with
/// no field in which a caller could declare "this change IS the dependency
/// upgrade". Consequence, stated rather than hidden: a mandate that forbids
/// `dependency_bump_to_satisfy_check` blocks *every* manifest edit through this
/// route, and the holder has to route a genuine upgrade through a human. That
/// is the conservative direction to be wrong in, and the fix is a stated goal
/// on the call, not a guess in the detector.
fn enforce_app_master_mandate(
    db: &crate::db::DbPool,
    project_id: &str,
    diff_content: &str,
) -> Result<(), AppError> {
    use personas_engine::app_master;

    let Some(record) = personas_engine::responsibility::mandate_for_project_or_none(db, project_id)
    else {
        return Ok(());
    };
    let violations = app_master::scan_diff(
        diff_content,
        &record.mandate.forbidden_classes,
        app_master::ScanContext {
            upgrade_goal: false,
        },
    );
    if violations.is_empty() {
        return Ok(());
    }
    // Record BEFORE refusing: the count is the backbone's, and a refusal the
    // ledger never saw would make the review packet under-report.
    app_master::record_violations(db, &record, &violations);
    tracing::warn!(
        project_id,
        persona_id = %record.persona_id,
        hits = violations.len(),
        "app_master: blocked a proposal that touches a forbidden change class"
    );
    Err(app_master::MandateRefusal::ForbiddenClasses(violations).into())
}

/// Run tests for a project by detecting the test runner.
#[tauri::command]
pub async fn dev_tools_run_tests(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    test_command: Option<String>,
) -> Result<TestRunResult, AppError> {
    require_auth_sync(&state)?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    let root = std::path::Path::new(&project.root_path);

    // Auto-detect test command if not provided
    let cmd = if let Some(ref c) = test_command {
        c.clone()
    } else if root.join("Cargo.toml").exists() {
        "cargo test --no-fail-fast 2>&1".to_string()
    } else if root.join("package.json").exists() {
        "npm test -- --passWithNoTests 2>&1".to_string()
    } else if root.join("pyproject.toml").exists() || root.join("setup.py").exists() {
        "python -m pytest -v 2>&1".to_string()
    } else {
        return Err(AppError::Validation(
            "Could not detect test runner. Provide test_command.".into(),
        ));
    };

    let start = std::time::Instant::now();

    let output = if cfg!(target_os = "windows") {
        tokio::process::Command::new("cmd")
            .args(["/C", &cmd])
            .current_dir(&project.root_path)
            .output()
            .await
    } else {
        tokio::process::Command::new("sh")
            .args(["-c", &cmd])
            .current_dir(&project.root_path)
            .output()
            .await
    };

    let duration_ms = start.elapsed().as_millis() as i64;

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let full_output = format!("{stdout}\n{stderr}");
            let success = out.status.success();

            // Parse test counts heuristically from output
            let (total, passed, failed, skipped) = parse_test_counts(&full_output);

            Ok(TestRunResult {
                project_id,
                success,
                total_tests: total,
                passed,
                failed,
                skipped,
                duration_ms,
                output: full_output,
                error: if success { None } else { Some(stderr) },
            })
        }
        Err(e) => Ok(TestRunResult {
            project_id,
            success: false,
            total_tests: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            duration_ms,
            output: String::new(),
            error: Some(format!("Failed to execute test command: {e}")),
        }),
    }
}

/// Parse test counts from common test runner outputs.
fn parse_test_counts(output: &str) -> (i32, i32, i32, i32) {
    // Cargo test: "test result: ok. X passed; Y failed; Z ignored"
    if let Some(caps) = regex::Regex::new(r"(\d+) passed[;,]\s*(\d+) failed[;,]\s*(\d+) ignored")
        .ok()
        .and_then(|re| re.captures(output))
    {
        let p: i32 = caps
            .get(1)
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(0);
        let f: i32 = caps
            .get(2)
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(0);
        let s: i32 = caps
            .get(3)
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(0);
        return (p + f + s, p, f, s);
    }
    // Jest/Vitest: "Tests: X passed, Y failed, Z total"
    if let Some(caps) =
        regex::Regex::new(r"Tests:\s+(?:(\d+) passed)?[,\s]*(?:(\d+) failed)?[,\s]*(\d+) total")
            .ok()
            .and_then(|re| re.captures(output))
    {
        let p: i32 = caps
            .get(1)
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(0);
        let f: i32 = caps
            .get(2)
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(0);
        let t: i32 = caps
            .get(3)
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(0);
        return (t, p, f, t - p - f);
    }
    // pytest: "X passed, Y failed"
    if let Some(caps) = regex::Regex::new(r"(\d+) passed")
        .ok()
        .and_then(|re| re.captures(output))
    {
        let p: i32 = caps
            .get(1)
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(0);
        let f: i32 = regex::Regex::new(r"(\d+) failed")
            .ok()
            .and_then(|re| re.captures(output))
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(0);
        return (p + f, p, f, 0);
    }
    (0, 0, 0, 0)
}

/// Working-tree snapshot for one managed project, as the Dev Tools project
/// card renders it.
///
/// snake_case (no `rename_all`) — the call site in `api/devTools` already
/// declared this exact shape inline, down to `changed_files_count`.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct GitStatusSummary {
    pub project_id: String,
    pub project_name: String,
    /// Empty string on a detached HEAD (`git branch --show-current` prints
    /// nothing), which the card renders as "no branch".
    pub branch: String,
    pub is_clean: bool,
    pub changed_files_count: usize,
    /// Raw `git status --porcelain` lines, status prefix included.
    pub changed_files: Vec<String>,
    /// Up to five `git log --oneline` lines.
    pub recent_commits: Vec<String>,
}

/// Get git status for a project.
#[tauri::command]
pub async fn dev_tools_get_git_status(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<GitStatusSummary, AppError> {
    require_auth_sync(&state)?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;

    let branch_output = tokio::process::Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(&project.root_path)
        .output()
        .await
        .map_err(|e| AppError::Internal(format!("git branch failed: {e}")))?;

    let status_output = tokio::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&project.root_path)
        .output()
        .await
        .map_err(|e| AppError::Internal(format!("git status failed: {e}")))?;

    let log_output = tokio::process::Command::new("git")
        .args(["log", "--oneline", "-5"])
        .current_dir(&project.root_path)
        .output()
        .await
        .map_err(|e| AppError::Internal(format!("git log failed: {e}")))?;

    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();
    let status = String::from_utf8_lossy(&status_output.stdout).to_string();
    let log = String::from_utf8_lossy(&log_output.stdout).to_string();

    let changed_files: Vec<&str> = status.lines().filter(|l| !l.is_empty()).collect();

    Ok(GitStatusSummary {
        project_id,
        project_name: project.name,
        branch,
        is_clean: changed_files.is_empty(),
        changed_files_count: changed_files.len(),
        changed_files: changed_files.iter().map(|l| (*l).to_string()).collect(),
        recent_commits: log.lines().map(str::to_string).collect(),
    })
}

/// Commit staged/all changes in a project.
#[tauri::command]
pub async fn dev_tools_commit_changes(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    message: String,
    stage_all: Option<bool>,
) -> Result<GitOperationResult, AppError> {
    require_auth_sync(&state)?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;

    if stage_all.unwrap_or(true) {
        let add_output = tokio::process::Command::new("git")
            .args(["add", "-A"])
            .current_dir(&project.root_path)
            .output()
            .await
            .map_err(|e| AppError::Internal(format!("git add failed: {e}")))?;

        if !add_output.status.success() {
            return Ok(GitOperationResult {
                success: false,
                message: String::from_utf8_lossy(&add_output.stderr)
                    .trim()
                    .to_string(),
                branch_name: None,
                commit_hash: None,
                files_changed: None,
            });
        }
    }

    let output = tokio::process::Command::new("git")
        .args(["commit", "-m", &message])
        .current_dir(&project.root_path)
        .output()
        .await
        .map_err(|e| AppError::Internal(format!("git commit failed: {e}")))?;

    let success = output.status.success();
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    // Extract commit hash from output
    let commit_hash = regex::Regex::new(r"\[[\w/]+ ([a-f0-9]+)\]")
        .ok()
        .and_then(|re| re.captures(&stdout))
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());

    // Count files changed
    let files_changed = regex::Regex::new(r"(\d+) file")
        .ok()
        .and_then(|re| re.captures(&stdout))
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<i32>().ok());

    Ok(GitOperationResult {
        success,
        message: if success {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        },
        branch_name: None,
        commit_hash,
        files_changed,
    })
}
