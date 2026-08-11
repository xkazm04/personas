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
const VERIFY_TIMEOUT_SECS: u64 = 1_200;
/// Practices checked in one pass. Verification reads real code per item, so a
/// huge batch is both slow and lower quality than several focused passes.
/// Practices per verification run.
///
/// Was 25, which never actually ran: before `to_process` became evidence-driven
/// this pass only considered cells already at `adopted`, and a project whose
/// cells were all `proposed` errored out before spawning anything. The first
/// real run at 25 (2026-07-27, 168 eligible cells) hit the wall timeout with
/// ZERO verdicts — 25 practices each needing real grep work does not fit a
/// 15-minute window, and the session emitted nothing until it was killed.
///
/// Eight is sized off that measurement: the same window, ~2 minutes per
/// practice, with margin. Coverage comes from repeated runs — the pass is
/// resumable by construction, since a verified cell is no longer `proposed`.
const MAX_VERIFY_PER_RUN: usize = 8;

#[derive(Clone, Default)]
struct VerifyExtra {
    checked: u32,
    diverged: u32,
    /// How many practices this run was ASKED to rule on. Without it a run that
    /// lost most of its verdicts is indistinguishable from a small run.
    selected: u32,
    /// Selected minus checked — verdicts the session claimed or should have
    /// produced that never landed. Surfaced rather than swallowed.
    lost: u32,
    /// Context cells this run attributed from the verdicts' file citations
    /// (pattern-context-trace.md W2).
    cells_adopted: i32,
    cells_violating: i32,
    /// Cited files that resolved to no context in the project's map. Reported,
    /// never dropped — a run that attributed 2 of 9 citations must not read
    /// like one that attributed everything it had.
    unattributed_files: u32,
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
    /// Does the practice apply to this repo AT ALL?
    ///
    /// `applicability` is a static envelope of stacks/frameworks, it FAILS OPEN
    /// (no envelope = applies everywhere), and harvested practices mostly carry
    /// no envelope. The first real verify run showed what that costs: seven
    /// Next.js/SaaS practices were queued as work owed by a Tauri desktop app,
    /// on verdicts that literally read "No Next.js API layer is present; all
    /// backend communication is via Tauri IPC". A correct observation turned
    /// into a wrong conclusion, because the only outcomes were holds/doesn't.
    ///
    /// The verifier is the one thing that actually reads the repo, so it is the
    /// right place to make the call the envelope cannot. Defaults true so an
    /// older session that omits the field behaves exactly as before.
    #[serde(default = "applies_by_default")]
    applies: bool,
    /// Files where the practice IS followed — the citations that become
    /// `adopted` context cells (docs/concepts/pattern-context-trace.md W2).
    #[serde(default)]
    applied_files: Vec<String>,
    /// Files where it applies and is NOT followed → `violating` cells.
    #[serde(default)]
    absent_files: Vec<String>,
}

fn applies_by_default() -> bool {
    true
}

/// Pull a verdict out of a line.
///
/// Deliberately tolerant about what surrounds the JSON. The strict
/// `strip_prefix` version required `VERDICT:` at the very start of the line,
/// and a real run lost SEVEN of eight verdicts to it — the session reported
/// "SUMMARY: 8 verified" while one landed. A model that writes `- VERDICT: {…}`
/// or appends a trailing word has still done the work; refusing to read it just
/// throws away a repo scan. The JSON span itself is still parsed strictly.
fn parse_verdict(line: &str) -> Option<Verdict> {
    let idx = line.find("VERDICT:")?;
    let rest = &line[idx + "VERDICT:".len()..];
    let start = rest.find('{')?;
    let end = rest.rfind('}')?;
    if end < start {
        return None;
    }
    match serde_json::from_str::<Verdict>(&rest[start..=end]) {
        Ok(v) => Some(v),
        Err(e) => {
            tracing::warn!(error = %e, line = %line, "verify: unparseable verdict line");
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
- **applies = false** — the practice targets a stack, framework or concern **this repository does not have**, so there is nothing here to follow or drift from. This is NOT the same as `holds = false`. A Next.js API-layer practice in a Tauri desktop app, or a Postgres-tenancy practice in a repo with no database, does not apply — saying "the code does not do this" would file real work against a repo that should never do it. When `applies` is false, `holds` is ignored; say in the evidence WHY the practice is out of scope for this stack.

METHOD: check the code, don't guess. Grep for the pattern's real call sites and counter-examples. A practice can be partially applied — if the dominant path follows it and a corner does not, that still holds; if the dominant path has drifted, it does not.

BE CONSERVATIVE ABOUT FAILING. A false "diverged" costs a human an investigation and erodes trust in the matrix. If you cannot find clear evidence either way, report holds = true with evidence saying the check was inconclusive — silence is safer than a false alarm.

CITE THE FILES. `applied_files` are the repo-relative paths where the practice IS followed; `absent_files` are the paths where it applies and is NOT followed. These are attributed to the project's context map, so the app can report WHERE the practice reached rather than a single project-wide yes/no — a whole-project "adopted" reads as 100% when the truth is usually a handful of modules. Cite the specific files you actually opened, `path/to/file.ext` or `path/to/file.ext:120`, repo-relative. Both lists may be empty when you found nothing concrete; do not invent paths.

OUTPUT CONTRACT — one line per practice, nothing else on that line:
VERDICT: {{"n":<the number above>,"applies":true|false,"holds":true|false,"evidence":"what you found, with file:line","applied_files":["src/a.ts:12"],"absent_files":["src/b.ts"]}}

**EMIT EACH VERDICT THE MOMENT YOU DECIDE IT — before you start looking at the next practice.** Do not gather all your findings and print them at the end. Verdicts are consumed as they stream, and a run that is cut short keeps every verdict it has already emitted; one that batches its output to the end loses all of them. (A 25-practice run did exactly that and returned nothing.)

Work through the list in order, one at a time: investigate practice 1, emit its VERDICT line, then move to practice 2. When finished emit:
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

    // Verification is no longer only about DRIFT. Since `to_process` became
    // evidence-driven, this pass answers two questions at once:
    //   - `adopted` cells: does canon this repo applied still hold? (drift)
    //   - `proposed`/`to_process` cells: does this repo comply at all? (work)
    // A cell is verifiable in either state; the verdict's MEANING comes from
    // the prior state (repo::adoption_state_after_verdict).
    let adoption = repo::list_adoption(&state.db, &workspace_id)?;
    let prior_state: std::collections::HashMap<String, String> = adoption
        .iter()
        .filter(|a| a.project_id == project_id && a.state != "na")
        .map(|a| (a.practice_id.clone(), a.state.clone()))
        .collect();
    if prior_state.is_empty() {
        return Err(AppError::Validation(
            "This project has no applicable adopted practices yet — nothing to verify.".into(),
        ));
    }
    let knowledge = repo::list_knowledge(&state.db, &workspace_id, None)?;
    let mut candidates: Vec<WorkspaceKnowledge> = knowledge
        .into_iter()
        .filter(|k| prior_state.contains_key(&k.id))
        .collect();
    // A run is capped, so ORDER decides what gets verified. Actionable kinds
    // first: `kind` cannot tell you whether a repo complies, but it is a fine
    // pre-filter for which practices are worth spending a verification on — a
    // `fact` has no work behind it either way. Then never-verified cells
    // (`proposed`) ahead of re-checks, so the queue fills before it refreshes.
    candidates.sort_by_key(|k| {
        let actionable = if repo::is_actionable_kind(&k.kind) { 0 } else { 1 };
        let unseen = match prior_state.get(&k.id).map(String::as_str) {
            Some("proposed") => 0,
            Some("to_process") => 1,
            _ => 2,
        };
        (actionable, unseen, k.id.clone())
    });
    let practices: Vec<WorkspaceKnowledge> =
        candidates.into_iter().take(MAX_VERIFY_PER_RUN).collect();

    let refs: Vec<&WorkspaceKnowledge> = practices.iter().collect();
    let prompt = build_verify_prompt(&project.name, &refs);
    let ids: Vec<String> = practices.iter().map(|k| k.id.clone()).collect();
    let titles: Vec<String> = practices.iter().map(|k| k.title.clone()).collect();

    let job_id = format!("verify-{}", uuid::Uuid::new_v4());
    let token = CancellationToken::new();
    VERIFY_JOBS.insert_running(job_id.clone(), token.clone(), VerifyExtra::default())?;

    let db = state.db.clone();
    let priors = prior_state;
    let jid = job_id.clone();
    let pid = project_id.clone();
    let wid = workspace_id.clone();
    let app_for_panic = app.clone();
    let jid_for_panic = jid.clone();
    tauri::async_runtime::spawn(async move {
        let work = AssertUnwindSafe(async move {
            match run_verify(
                &app, &jid, &db, &wid, &pid, &ids, &titles, &priors, prompt, root, token,
            )
            .await
            {
                Ok((checked, diverged)) => {
                    VERIFY_JOBS.emit_line(
                        &app,
                        &jid,
                        format!("[Complete] {checked} verified · {diverged} need work"),
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

/// Terminal-status probe for the companion's verify-pass watcher
/// (`approval_exec_knowledge::execute_evaluate_pattern`). Returns
/// `(status, checked, diverged)` — `None` when the job is unknown (evicted or
/// never existed, which the watcher treats as terminal).
pub(crate) fn verify_job_probe(job_id: &str) -> Option<(String, u32, u32)> {
    let jobs = VERIFY_JOBS.lock().ok()?;
    jobs.get(job_id)
        .map(|j| (j.status.clone(), j.extra.checked, j.extra.diverged))
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
            "selected": job.extra.selected,
            "lost": job.extra.lost,
            "cells_adopted": job.extra.cells_adopted,
            "cells_violating": job.extra.cells_violating,
            "unattributed_files": job.extra.unattributed_files,
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
    workspace_id: &str,
    project_id: &str,
    ids: &[String],
    titles: &[String],
    // Cell state BEFORE this pass, per practice id. The verdict is the same
    // signal either way; what it means depends on where the cell already was.
    priors: &std::collections::HashMap<String, String>,
    prompt: String,
    root: std::path::PathBuf,
    token: CancellationToken,
) -> Result<(u32, u32), AppError> {
    VERIFY_JOBS.emit_line(
        app,
        job_id,
        format!("[Milestone] Verifying {} practices…", ids.len()),
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
    let mut cells_adopted = 0i32;
    let mut cells_violating = 0i32;
    let mut unattributed: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<usize> = std::collections::HashSet::new();
    for v in &verdicts {
        if !seen.insert(v.n) {
            continue; // a repeated verdict for one item — first wins
        }
        let practice_id = &ids[v.n - 1];
        let prior = priors
            .get(practice_id)
            .map(String::as_str)
            .unwrap_or("proposed");
        let state = repo::adoption_state_after_verdict(prior, v.holds, v.applies);
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

        // W2 — attribute the verdict's file citations to contexts
        // (docs/concepts/pattern-context-trace.md). This is the ONLY lane
        // allowed to write `adopted`/`violating` cells, precisely because it is
        // the only one that cites evidence. Skipped when the practice does not
        // apply to this repo at all: `applies=false` is a statement about the
        // stack, not about any context's code.
        if !v.applies {
            continue;
        }
        // Prefer the structured lists; fall back to the paths the model wrote
        // into its prose, which every verdict predating the new fields carries.
        let (applied, absent) = if v.applied_files.is_empty() && v.absent_files.is_empty() {
            let cited = v
                .evidence
                .as_deref()
                .map(repo::extract_file_citations)
                .unwrap_or_default();
            if v.holds {
                (cited, Vec::new())
            } else {
                (Vec::new(), cited)
            }
        } else {
            (v.applied_files.clone(), v.absent_files.clone())
        };
        if applied.is_empty() && absent.is_empty() {
            continue;
        }
        match repo::apply_verified_context_evidence(
            db,
            workspace_id,
            project_id,
            practice_id,
            &applied,
            &absent,
        ) {
            Ok(sum) => {
                cells_adopted += sum.adopted_cells;
                cells_violating += sum.violating_cells;
                unattributed.extend(sum.unattributed);
            }
            Err(e) => {
                // Attribution is a reporting refinement on top of a verdict
                // that already landed — never fail the run over it.
                tracing::warn!(error = %e, practice_id, "verify: context attribution failed");
            }
        }
    }
    if cells_adopted + cells_violating > 0 || !unattributed.is_empty() {
        unattributed.sort();
        unattributed.dedup();
        VERIFY_JOBS.emit_line(
            app,
            job_id,
            format!(
                "[Attribution] {cells_adopted} contexts follow · {cells_violating} do not · {} cited files matched no context",
                unattributed.len()
            ),
        );
        if !unattributed.is_empty() {
            VERIFY_JOBS.emit_line(
                app,
                job_id,
                format!("[Unattributed] {}", unattributed.join(", ")),
            );
        }
    }
    // Reconcile what we were asked to do against what actually landed. A pass
    // that ruled on 1 of 8 must not read like a clean run: the whole point of
    // this feature is that a surface never reports more coverage than it has.
    let selected = ids.len() as u32;
    let lost = selected.saturating_sub(checked);
    if lost > 0 {
        VERIFY_JOBS.emit_line(
            app,
            job_id,
            format!(
                "[Warning] {lost} of {selected} practices produced no usable verdict — they stay unverified and will be re-selected next run"
            ),
        );
    }
    VERIFY_JOBS.update_extra(job_id, |e| {
        e.checked = checked;
        e.diverged = diverged;
        e.selected = selected;
        e.lost = lost;
        e.cells_adopted = cells_adopted;
        e.cells_violating = cells_violating;
        e.unattributed_files = unattributed.len() as u32;
    });
    Ok((checked, diverged))
}
