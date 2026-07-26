//! Adoption verification — does an adopted practice still hold in the repo
//! that adopted it? (docs/plans/workspace-knowledge-center.md §8, Arc 3.)
//!
//! Adoption is a claim about a codebase, and codebases move. Without a way to
//! re-check, an adoption matrix decays into a wish list. This runs a headless
//! session **inside one member repo** and asks, per adopted practice, whether
//! the code still reflects it.
//!
//! ## The one rule: surface, never auto-un-adopt
//!
//! A failed verdict flips that project's matrix cell to `diverged` and records
//! why. It NEVER changes the practice's workspace-level `adopted` status, and
//! it never silently removes an adoption — a model's opinion is evidence for a
//! human, not a governance decision. `diverged` is a visible "this repo has
//! drifted", which is precisely the signal the matrix exists to carry.
//!
//! Verdicts are matched by **index**, not by echoed UUID: asking a model to
//! reproduce identifiers verbatim is a well-known failure mode, and a mismatched
//! id would silently mark the wrong practice.

use std::panic::AssertUnwindSafe;
use std::sync::Arc;

use futures_util::FutureExt;
use serde::Deserialize;
use serde_json::json;
use tauri::State;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio_util::sync::CancellationToken;

use crate::background_job::BackgroundJobManager;
use crate::db::models::WorkspaceKnowledge;
use crate::db::repos::dev_tools as dev_repo;
use crate::db::repos::dev_workspaces as repo;
use crate::engine::event_registry::event_name;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

/// Extract a printable message from a panic payload returned by `catch_unwind`.
/// Mirrors the canonical pattern at `commands/execution/lab.rs::extract_panic_message`.
fn extract_panic_message(panic: Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = panic.downcast_ref::<&str>() {
        return s.to_string();
    }
    if let Some(s) = panic.downcast_ref::<String>() {
        return s.clone();
    }
    "unknown panic".to_string()
}

const VERIFY_MODEL: &str = "claude-sonnet-4-6";
const VERIFY_TIMEOUT_SECS: u64 = 900;
/// Practices checked in one pass. Verification reads real code per item, so a
/// huge batch is both slow and lower quality than several focused passes.
const MAX_VERIFY_PER_RUN: usize = 25;

#[derive(Clone, Default)]
struct VerifyExtra {
    checked: u32,
    diverged: u32,
}

static VERIFY_JOBS: BackgroundJobManager<VerifyExtra> = BackgroundJobManager::new(
    "workspace-verify lock poisoned",
    event_name::VERIFY_SCAN_STATUS,
    event_name::VERIFY_SCAN_OUTPUT,
);

/// One verdict line. `n` is the 1-based index from the prompt's list — see the
/// module docs on why this is index-based rather than id-based.
#[derive(Debug, Deserialize)]
struct Verdict {
    n: usize,
    holds: bool,
    evidence: Option<String>,
}

fn parse_verdict(line: &str) -> Option<Verdict> {
    let rest = line.trim().strip_prefix("VERDICT:")?;
    match serde_json::from_str::<Verdict>(rest.trim()) {
        Ok(v) => Some(v),
        Err(e) => {
            tracing::warn!(error = %e, "verify: unparseable verdict line");
            None
        }
    }
}

fn build_verify_prompt(project_name: &str, practices: &[&WorkspaceKnowledge]) -> String {
    let list = practices
        .iter()
        .enumerate()
        .map(|(i, k)| {
            format!(
                "{}. **{}**\n   {}",
                i + 1,
                k.title.trim(),
                k.statement.trim()
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    format!(
        r#"You are verifying whether previously-adopted engineering practices STILL HOLD in this repository (**{project_name}**). You are standing in that repo — read its actual code.

ADOPTED PRACTICES TO VERIFY
{list}

FOR EACH, decide: does this codebase currently reflect the practice?
- **holds = true** — the code follows it (allow for reasonable local adaptation; the practice is a doctrine, not a literal template).
- **holds = false** — the code has drifted, or never actually implemented it, or now contradicts it.

METHOD: check the code, don't guess. Grep for the pattern's real call sites and counter-examples. A practice can be partially applied — if the dominant path follows it and a corner does not, that still holds; if the dominant path has drifted, it does not.

BE CONSERVATIVE ABOUT FAILING. A false "diverged" costs a human an investigation and erodes trust in the matrix. If you cannot find clear evidence either way, report holds = true with evidence saying the check was inconclusive — silence is safer than a false alarm.

OUTPUT CONTRACT — one line per practice, nothing else on that line:
VERDICT: {{"n":<the number above>,"holds":true|false,"evidence":"what you found, with file:line"}}

Emit exactly one VERDICT line per practice listed. When finished emit:
SUMMARY: <n> verified

Do not modify any file. Your output lines are the entire deliverable."#
    )
}

/// Start an adoption-verification pass for one member project.
#[tauri::command]
pub async fn dev_tools_workspace_verify_adoptions(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    project_id: String,
) -> Result<String, AppError> {
    require_auth(&state).await?;
    let project = dev_repo::get_project_by_id(&state.db, &project_id)?;
    if project.workspace_id.as_deref() != Some(workspace_id.as_str()) {
        return Err(AppError::Validation(
            "Project is not a member of this workspace".into(),
        ));
    }
    let root = std::path::PathBuf::from(&project.root_path);
    if !root.is_dir() {
        return Err(AppError::Validation(format!(
            "Project root is not a directory: {}",
            project.root_path
        )));
    }

    // Only practices this project has actually adopted are verifiable — a
    // proposed one has nothing to have drifted from.
    let adoption = repo::list_adoption(&state.db, &workspace_id)?;
    let adopted_here: std::collections::HashSet<String> = adoption
        .iter()
        .filter(|a| a.project_id == project_id && a.state == "adopted")
        .map(|a| a.practice_id.clone())
        .collect();
    if adopted_here.is_empty() {
        return Err(AppError::Validation(
            "This project has not adopted any practices yet — nothing to verify.".into(),
        ));
    }
    let knowledge = repo::list_knowledge(&state.db, &workspace_id, None)?;
    let practices: Vec<WorkspaceKnowledge> = knowledge
        .into_iter()
        .filter(|k| adopted_here.contains(&k.id))
        .take(MAX_VERIFY_PER_RUN)
        .collect();

    let refs: Vec<&WorkspaceKnowledge> = practices.iter().collect();
    let prompt = build_verify_prompt(&project.name, &refs);
    let ids: Vec<String> = practices.iter().map(|k| k.id.clone()).collect();
    let titles: Vec<String> = practices.iter().map(|k| k.title.clone()).collect();

    let job_id = format!("verify-{}", uuid::Uuid::new_v4());
    let token = CancellationToken::new();
    VERIFY_JOBS.insert_running(job_id.clone(), token.clone(), VerifyExtra::default())?;

    let db = state.db.clone();
    let jid = job_id.clone();
    let pid = project_id.clone();
    let app_for_panic = app.clone();
    let jid_for_panic = jid.clone();
    tauri::async_runtime::spawn(async move {
        let work = AssertUnwindSafe(async move {
            match run_verify(&app, &jid, &db, &pid, &ids, &titles, prompt, root, token).await {
                Ok((checked, diverged)) => {
                    VERIFY_JOBS.emit_line(
                        &app,
                        &jid,
                        format!("[Complete] {checked} verified · {diverged} diverged"),
                    );
                    VERIFY_JOBS.set_status(&app, &jid, "completed", None);
                }
                Err(e) => {
                    VERIFY_JOBS.emit_line(&app, &jid, format!("[Failed] {e}"));
                    VERIFY_JOBS.set_status(&app, &jid, "failed", Some(e.to_string()));
                }
            }
        })
        .catch_unwind()
        .await;

        if let Err(panic) = work {
            let msg = extract_panic_message(panic);
            tracing::error!(
                job_id = %jid_for_panic,
                panic = %msg,
                "workspace adoption-verify task panicked — marking job as failed"
            );
            VERIFY_JOBS.emit_line(&app_for_panic, &jid_for_panic, format!("[Failed] {msg}"));
            VERIFY_JOBS.set_status(&app_for_panic, &jid_for_panic, "failed", Some(msg));
        }
    });

    Ok(job_id)
}

#[tauri::command]
pub fn dev_tools_workspace_get_verify_status(
    state: State<'_, Arc<AppState>>,
    job_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let jobs = VERIFY_JOBS.lock()?;
    if let Some(job) = jobs.get(&job_id) {
        Ok(json!({
            "job_id": job_id,
            "status": job.status,
            "error": job.error,
            "lines": job.lines,
            "checked": job.extra.checked,
            "diverged": job.extra.diverged,
        }))
    } else {
        Ok(json!({ "job_id": job_id, "status": "not_found" }))
    }
}

#[tauri::command]
pub fn dev_tools_workspace_cancel_verify(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    job_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    VERIFY_JOBS.cancel(&app, &job_id)
}

#[allow(clippy::too_many_arguments)]
async fn run_verify(
    app: &tauri::AppHandle,
    job_id: &str,
    db: &crate::db::DbPool,
    project_id: &str,
    ids: &[String],
    titles: &[String],
    prompt: String,
    root: std::path::PathBuf,
    token: CancellationToken,
) -> Result<(u32, u32), AppError> {
    VERIFY_JOBS.emit_line(
        app,
        job_id,
        format!("[Milestone] Verifying {} adopted practices…", ids.len()),
    );

    let mut child = crate::engine::cli_process::spawn_headless_claude(
        prompt,
        VERIFY_MODEL,
        &[],
        Some(&root),
        true,
    )?;
    if let Some(stderr) = child.stderr.take() {
        let app_c = app.clone();
        let jid = job_id.to_string();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if !line.trim().is_empty() {
                    VERIFY_JOBS.emit_line(&app_c, &jid, format!("[stderr] {line}"));
                }
            }
        });
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("Missing stdout pipe".into()))?;
    let mut reader = BufReader::new(stdout).lines();

    let mut verdicts: Vec<Verdict> = Vec::new();
    let spend_ctx = crate::db::repos::llm_spend::SpendCtx {
        source: "workspace",
        trigger_kind: "adoption_verify",
        model: Some(VERIFY_MODEL),
        project_id: Some(project_id),
        persona_id: None,
    };

    let stream = async {
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            crate::db::repos::llm_spend::observe_line(db, &spend_ctx, &line);
            let Some(text) = crate::commands::design::analysis::extract_display_text(&line) else {
                continue;
            };
            for proto in text.lines() {
                let t = proto.trim();
                if let Some(v) = parse_verdict(t) {
                    // An out-of-range index is a model error, not a verdict —
                    // dropping it is safer than mismarking a neighbour.
                    if v.n == 0 || v.n > ids.len() {
                        VERIFY_JOBS.emit_line(app, job_id, format!("[Ignored] verdict for unknown item #{}", v.n));
                        continue;
                    }
                    let title = &titles[v.n - 1];
                    VERIFY_JOBS.emit_line(
                        app,
                        job_id,
                        format!("[{}] {title}", if v.holds { "Holds" } else { "Diverged" }),
                    );
                    verdicts.push(v);
                } else if let Some(sum) = t.strip_prefix("SUMMARY:") {
                    VERIFY_JOBS.emit_line(app, job_id, format!("[Summary]{sum}"));
                } else {
                    VERIFY_JOBS.record_line(job_id, t.to_string());
                }
            }
        }
    };

    tokio::select! {
        _ = token.cancelled() => {
            let _ = child.kill().await;
            return Err(AppError::Validation("Verification cancelled".into()));
        }
        r = tokio::time::timeout(std::time::Duration::from_secs(VERIFY_TIMEOUT_SECS), stream) => {
            if r.is_err() && verdicts.is_empty() {
                return Err(AppError::Internal(format!(
                    "Verification timed out after {VERIFY_TIMEOUT_SECS}s with no verdicts"
                )));
            }
        }
    }
    let _ = child.wait().await;

    // Apply. `diverged` marks THIS project's cell only — the practice stays
    // adopted at the workspace level. Never auto-un-adopt.
    let mut checked = 0u32;
    let mut diverged = 0u32;
    let mut seen: std::collections::HashSet<usize> = std::collections::HashSet::new();
    for v in &verdicts {
        if !seen.insert(v.n) {
            continue; // a repeated verdict for one item — first wins
        }
        let practice_id = &ids[v.n - 1];
        let state = if v.holds { "adopted" } else { "diverged" };
        let note = v.evidence.as_deref().map(|e| {
            let trimmed = e.trim();
            crate::utils::text::truncate_on_char_boundary(trimmed, 600).to_string()
        });
        if let Err(e) = repo::set_adoption(db, practice_id, project_id, state, note.as_deref(), None) {
            tracing::warn!(error = %e, practice_id, "verify: failed to record verdict");
            continue;
        }
        checked += 1;
        if !v.holds {
            diverged += 1;
        }
    }
    VERIFY_JOBS.update_extra(job_id, |e| {
        e.checked = checked;
        e.diverged = diverged;
    });
    Ok((checked, diverged))
}
