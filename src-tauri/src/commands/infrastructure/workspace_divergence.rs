//! Workspace divergence pass — cross-project practice synthesis
//! (docs/plans/workspace-knowledge-center.md §7, Arc 2).
//!
//! Where the deterministic miners find *recurrence* (the same finding in ≥2
//! projects) and the harvest skill reads *one* repo, the divergence pass reads
//! the workspace's accumulated library and asks the question only visible in
//! aggregate: **are several member projects solving the same problem in
//! different, locally-reasonable ways?** If so it proposes ONE recommended
//! practice carrying each project's current approach as evidence.
//!
//! Runs in-app as a headless Claude session (not a Fleet terminal) because the
//! input is the library, not a working tree — there is nothing for a human to
//! watch a CLI do. Mirrors `idea_scanner`'s shape exactly: a
//! `BackgroundJobManager` job with live output lines, a status poll, and a
//! cancel token.
//!
//! Per doctrine D8 (agents write across a validated boundary): the session
//! NEVER writes the DB. It emits `DIVERGENCE: {json}` protocol lines which
//! this module validates and routes through the one governed ingest door
//! (`repo::ingest_candidates`), landing `observed` with agent provenance and
//! full dedup gating. Brainiac's project-axis lesson is honored in the prompt:
//! the bar is deliberately conservative because applications legitimately
//! differ — a divergence is only real when the *problem* is shared.
//!
//! ## Why the pattern×context verify ingest is NOT here
//!
//! W2 of `docs/concepts/pattern-context-trace.md` turns file citations into
//! per-context `adopted`/`violating` cells. A `DIVERGENCE` proposal cannot feed
//! it: it carries no file references at all, it is cross-project by
//! construction (`origin_project_id: None`, so there is no single context map
//! to resolve against), and it PROPOSES a new practice rather than ruling on an
//! existing one. W2 therefore lives in `workspace_verify.rs` — the lane that
//! stands inside one member repo and is already contracted to cite `file:line`.

use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex};

use futures_util::FutureExt;
use serde::Deserialize;
use serde_json::json;
use tauri::State;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio_util::sync::CancellationToken;

use crate::background_job::BackgroundJobManager;
use crate::db::repos::dev_workspaces as repo;
use crate::db::repos::dev_workspaces::KnowledgeCandidate;
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

/// Model for the synthesis pass. Clustering + adjudication over a digest is a
/// reasoning task on a small input — Sonnet is the right tier, matching the
/// idea scanner.
const DIVERGENCE_MODEL: &str = "claude-sonnet-4-6";

/// Wall-clock ceiling for one pass. The input is a digest (not a repo walk),
/// so this is generous; a pass that outruns it has gone off the rails.
const DIVERGENCE_TIMEOUT_SECS: u64 = 900;

/// Items handed to the model. Beyond this the digest stops being a prompt and
/// starts being a corpus — the pass is a synthesis over the *governed* library,
/// not a bulk reader.
const MAX_DIGEST_ITEMS: usize = 400;

/// Proposals accepted from one pass. A divergence pass that "finds" more than
/// this is pattern-matching noise, not adjudicating shared problems.
const MAX_PROPOSALS_PER_RUN: usize = 12;

#[derive(Clone, Default)]
struct DivergenceExtra {
    proposed: u32,
    inserted: u32,
}

static DIVERGENCE_JOBS: BackgroundJobManager<DivergenceExtra> = BackgroundJobManager::new(
    "workspace-divergence lock poisoned",
    event_name::DIVERGENCE_SCAN_STATUS,
    event_name::DIVERGENCE_SCAN_OUTPUT,
);

// ── protocol ────────────────────────────────────────────────────────────────

/// One proposed cross-project practice. Emitted by the session as
/// `DIVERGENCE: {json}`; this struct and the OUTPUT CONTRACT in
/// [`build_divergence_prompt`] are two halves of one contract — keep aligned.
#[derive(Debug, Deserialize)]
struct DivergenceProposal {
    title: String,
    statement: String,
    /// Why this is one shared problem rather than legitimate difference.
    rationale: Option<String>,
    /// Per-project current approaches — the evidence that makes it a divergence.
    #[serde(default)]
    approaches: Vec<ProjectApproach>,
    topic: Option<String>,
    ftype: Option<String>,
    abstraction: Option<String>,
    kind: Option<String>,
    confidence: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct ProjectApproach {
    project: String,
    approach: String,
}

/// Pull a proposal out of a line.
///
/// Deliberately tolerant about what surrounds the JSON — mirrors
/// `workspace_verify::parse_verdict`. The strict `strip_prefix` version
/// requires `DIVERGENCE:` at the very start of the line, so a model that
/// decorates it (`- DIVERGENCE: {...}`, a leading bullet) silently drops a
/// proposal it actually produced. The JSON span itself is still parsed
/// strictly.
fn parse_divergence_line(line: &str) -> Option<DivergenceProposal> {
    let idx = line.find("DIVERGENCE:")?;
    let rest = &line[idx + "DIVERGENCE:".len()..];
    let start = rest.find('{')?;
    let end = rest.rfind('}')?;
    if end < start {
        return None;
    }
    match serde_json::from_str::<DivergenceProposal>(&rest[start..=end]) {
        Ok(p) => Some(p),
        Err(e) => {
            tracing::warn!(error = %e, "divergence: unparseable protocol line");
            None
        }
    }
}

// ── prompt ──────────────────────────────────────────────────────────────────

/// Compose the digest + instructions. The digest is the *library*, so the pass
/// reasons over what the workspace already knows rather than re-reading repos.
fn build_divergence_prompt(
    workspace_name: &str,
    members: &[(String, Option<String>)],
    items: &[crate::db::models::WorkspaceKnowledge],
    project_name_of: &dyn Fn(&Option<String>) -> String,
) -> String {
    let roster = members
        .iter()
        .map(|(name, stack)| match stack {
            Some(s) if !s.trim().is_empty() => format!("- {name} — {s}"),
            _ => format!("- {name}"),
        })
        .collect::<Vec<_>>()
        .join("\n");

    let digest = items
        .iter()
        .take(MAX_DIGEST_ITEMS)
        .map(|k| {
            format!(
                "- [{}|{}|{}] ({}) {} — {}",
                k.status,
                k.abstraction.as_deref().unwrap_or("?"),
                k.ftype.as_deref().unwrap_or("?"),
                project_name_of(&k.origin_project_id),
                k.title,
                k.statement.chars().take(200).collect::<String>(),
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let taxonomy_block = crate::db::repos::workspace_taxonomy::prompt_block();

    format!(
        r#"You are adjudicating PRACTICE DIVERGENCE across the projects in the "{workspace_name}" workspace.

MEMBER PROJECTS
{roster}

THE WORKSPACE'S CURRENT KNOWLEDGE LIBRARY (status|abstraction|finding-type) (origin project) title — statement
{digest}

YOUR QUESTION — the one only visible in aggregate:
Are several member projects solving THE SAME PROBLEM in DIFFERENT, locally-reasonable ways? Where they are, propose ONE recommended practice and carry each project's current approach as evidence.

THE BAR IS DELIBERATELY CONSERVATIVE. Applications legitimately differ — a different stack, domain, or scale is NOT a divergence. Propose only when:
- the underlying PROBLEM is genuinely shared (not merely a similar-sounding label), AND
- at least TWO named member projects demonstrably take different approaches, AND
- one approach is defensibly better for the workspace, or a single convention would clearly beat the split.
If a difference is justified, say nothing about it. Proposing nothing is a valid and common result — a workspace whose projects legitimately differ should yield zero proposals. Never invent a divergence to fill the output.

ALTITUDE: propose durable DESIGN doctrine (architecture, module boundaries, data flow, extensibility, error/state strategy). Do NOT propose lint-level mechanics (formatting, import order, a raw class name, a hardcoded string) — those belong in a linter, not a practice library.

TOPIC — the library uses a CLOSED, precedence-ordered vocabulary. `topic` is exactly two segments, `area/cluster`, and answers WHERE the practice lives; `ftype` separately answers what shape it is, so do not encode shape in the topic. Walk these areas IN ORDER and take the FIRST that genuinely governs your proposal — if the practice would be meaningless without that concern, it governs. `architecture` sits near the end deliberately: it is the codebase's own skeleton, so reach for it only when no subsystem area applies.
{taxonomy_block}
Use a listed cluster whenever one fits. If none fits you may name a new cluster, but ONLY under one of the areas above — never invent an area.

OUTPUT CONTRACT — emit one line per proposal, nothing else on that line:
DIVERGENCE: {{"title":"short imperative","statement":"the recommended practice, 1-2 sentences","rationale":"why this is one shared problem rather than legitimate difference","approaches":[{{"project":"<member name>","approach":"what it does today"}}],"topic":"area/cluster","ftype":"architecture|module-boundary|data-flow|extensibility|api-design|state-mgmt|error-strategy|concurrency-reliability|perf-strategy","abstraction":"macro|meso","kind":"pattern|decision|pitfall","confidence":0.0-1.0}}

At most {MAX_PROPOSALS_PER_RUN} proposals. When finished emit:
SUMMARY: <n> divergences proposed

Do not write any files. Do not modify the repository. Your output lines are the entire deliverable."#
    )
}

// ── commands ────────────────────────────────────────────────────────────────

/// Start a divergence pass over a workspace. Returns the job id immediately;
/// the pass streams progress on the divergence-scan events and lands accepted
/// proposals as `observed` knowledge through the governed ingest door.
#[tauri::command]
pub async fn dev_tools_workspace_run_divergence(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
) -> Result<String, AppError> {
    require_auth(&state).await?;
    let ws = repo::get_workspace_by_id(&state.db, &workspace_id)?;
    let members = repo::list_workspace_projects(&state.db, &workspace_id)?;
    if members.len() < 2 {
        return Err(AppError::Validation(
            "A divergence pass needs at least 2 projects in the workspace — there is nothing to compare across.".into(),
        ));
    }
    let items = repo::list_knowledge(&state.db, &workspace_id, None)?;
    let live: Vec<_> = items.into_iter().filter(|k| k.status != "rejected").collect();
    if live.len() < 4 {
        return Err(AppError::Validation(
            "Not enough harvested knowledge to compare yet — run the miners or a harvest first.".into(),
        ));
    }

    // Ground the session in a real member repo so it can spot-check a claim if
    // it wants; the digest is the actual input.
    let exec_dir = members
        .iter()
        .map(|p| std::path::PathBuf::from(&p.root_path))
        .find(|p| p.is_dir());

    let name_by_id: std::collections::HashMap<String, String> =
        members.iter().map(|p| (p.id.clone(), p.name.clone())).collect();
    let project_name_of = move |id: &Option<String>| -> String {
        match id {
            Some(i) => name_by_id.get(i).cloned().unwrap_or_else(|| "(removed)".into()),
            None => "workspace".into(),
        }
    };
    let roster: Vec<(String, Option<String>)> = members
        .iter()
        .map(|p| (p.name.clone(), p.tech_stack.clone()))
        .collect();
    let prompt = build_divergence_prompt(&ws.name, &roster, &live, &project_name_of);

    let job_id = format!("divergence-{}", uuid::Uuid::new_v4());
    let token = CancellationToken::new();
    DIVERGENCE_JOBS.insert_running(job_id.clone(), token.clone(), DivergenceExtra::default())?;

    let db = state.db.clone();
    let jid = job_id.clone();
    let wid = workspace_id.clone();
    let valid_projects: Vec<String> = members.iter().map(|p| p.name.clone()).collect();
    let app_for_panic = app.clone();
    let jid_for_panic = jid.clone();
    tauri::async_runtime::spawn(async move {
        let work = AssertUnwindSafe(async move {
            let result =
                run_divergence(&app, &jid, &db, &wid, prompt, exec_dir, &valid_projects, token).await;
            match result {
                Ok(counts) => {
                    DIVERGENCE_JOBS.emit_line(
                        &app,
                        &jid,
                        format!(
                            "[Complete] {} proposed · {} landed as observed",
                            counts.0, counts.1
                        ),
                    );
                    DIVERGENCE_JOBS.set_status(&app, &jid, "completed", None);
                }
                Err(e) => {
                    DIVERGENCE_JOBS.emit_line(&app, &jid, format!("[Failed] {e}"));
                    DIVERGENCE_JOBS.set_status(&app, &jid, "failed", Some(e.to_string()));
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
                "workspace divergence task panicked — marking job as failed"
            );
            DIVERGENCE_JOBS.emit_line(&app_for_panic, &jid_for_panic, format!("[Failed] {msg}"));
            DIVERGENCE_JOBS.set_status(&app_for_panic, &jid_for_panic, "failed", Some(msg));
        }
    });

    Ok(job_id)
}

/// Poll a divergence pass. Mirrors `dev_tools_get_idea_scan_status`.
#[tauri::command]
pub fn dev_tools_workspace_get_divergence_status(
    state: State<'_, Arc<AppState>>,
    job_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let jobs = DIVERGENCE_JOBS.lock()?;
    if let Some(job) = jobs.get(&job_id) {
        Ok(json!({
            "job_id": job_id,
            "status": job.status,
            "error": job.error,
            "lines": job.lines,
            "proposed": job.extra.proposed,
            "inserted": job.extra.inserted,
        }))
    } else {
        Ok(json!({ "job_id": job_id, "status": "not_found" }))
    }
}

#[tauri::command]
pub fn dev_tools_workspace_cancel_divergence(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    job_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    DIVERGENCE_JOBS.cancel(&app, &job_id)
}

// ── core ────────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
async fn run_divergence(
    app: &tauri::AppHandle,
    job_id: &str,
    db: &crate::db::DbPool,
    workspace_id: &str,
    prompt: String,
    exec_dir: Option<std::path::PathBuf>,
    valid_projects: &[String],
    token: CancellationToken,
) -> Result<(u32, u32), AppError> {
    DIVERGENCE_JOBS.emit_line(app, job_id, "[Milestone] Comparing practices across the workspace…");

    let mut child = crate::engine::cli_process::spawn_headless_claude(
        prompt,
        DIVERGENCE_MODEL,
        &[],
        exec_dir.as_deref(),
        true,
    )?;

    // stderr → bounded ring + live panel, so auth/rate-limit failures are visible.
    let stderr_ring: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    if let Some(stderr) = child.stderr.take() {
        let ring = stderr_ring.clone();
        let app_c = app.clone();
        let jid = job_id.to_string();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                if let Ok(mut r) = ring.lock() {
                    if r.len() < 8 * 1024 {
                        r.push_str(&line);
                        r.push('\n');
                    }
                }
                DIVERGENCE_JOBS.emit_line(&app_c, &jid, format!("[stderr] {line}"));
            }
        });
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("Missing stdout pipe".into()))?;
    let mut reader = BufReader::new(stdout).lines();

    let mut proposals: Vec<DivergenceProposal> = Vec::new();
    let spend_ctx = crate::db::repos::llm_spend::SpendCtx {
        source: "workspace",
        trigger_kind: "divergence_scan",
        model: Some(DIVERGENCE_MODEL),
        project_id: None,
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
                if let Some(p) = parse_divergence_line(t) {
                    if proposals.len() >= MAX_PROPOSALS_PER_RUN {
                        DIVERGENCE_JOBS.emit_line(
                            app,
                            job_id,
                            format!("[Cap] {MAX_PROPOSALS_PER_RUN} proposals reached — ignoring the rest"),
                        );
                        continue;
                    }
                    DIVERGENCE_JOBS.emit_line(
                        app,
                        job_id,
                        format!("[Divergence #{}] {}", proposals.len() + 1, p.title),
                    );
                    proposals.push(p);
                } else if let Some(sum) = t.strip_prefix("SUMMARY:") {
                    DIVERGENCE_JOBS.emit_line(app, job_id, format!("[Summary]{sum}"));
                } else {
                    DIVERGENCE_JOBS.record_line(job_id, t.to_string());
                }
            }
        }
    };

    tokio::select! {
        _ = token.cancelled() => {
            let _ = child.kill().await;
            return Err(AppError::Validation("Divergence pass cancelled".into()));
        }
        r = tokio::time::timeout(std::time::Duration::from_secs(DIVERGENCE_TIMEOUT_SECS), stream) => {
            if r.is_err() && proposals.is_empty() {
                let tail = stderr_ring.lock().map(|r| r.clone()).unwrap_or_default();
                return Err(AppError::Internal(format!(
                    "Divergence pass timed out after {DIVERGENCE_TIMEOUT_SECS}s with no proposals. {tail}"
                )));
            }
        }
    }
    let _ = child.wait().await;

    let proposed = proposals.len() as u32;
    DIVERGENCE_JOBS.update_extra(job_id, |e| e.proposed = proposed);
    if proposals.is_empty() {
        DIVERGENCE_JOBS.emit_line(
            app,
            job_id,
            "[Result] No divergences found — the workspace's projects differ legitimately, or there isn't enough shared ground yet.",
        );
        return Ok((0, 0));
    }

    // ── the one governed door ──
    let known: std::collections::HashSet<&str> = valid_projects.iter().map(|s| s.as_str()).collect();
    let candidates: Vec<KnowledgeCandidate> = proposals
        .iter()
        .map(|p| {
            // Evidence is the per-project split — drop approaches naming a
            // project that isn't a member (hallucination guard).
            let approaches: Vec<String> = p
                .approaches
                .iter()
                .filter(|a| known.contains(a.project.as_str()))
                .map(|a| format!("- **{}** — {}", a.project, a.approach))
                .collect();
            let mut detail = String::new();
            if let Some(r) = &p.rationale {
                detail.push_str(&format!("**Why this is one shared problem**\n\n{r}\n\n"));
            }
            if !approaches.is_empty() {
                detail.push_str(&format!("**Current approaches**\n\n{}\n", approaches.join("\n")));
            }
            KnowledgeCandidate {
                // Not produced by a territory scan (miner / divergence pass).
                harvest_scope: None,
                kind: p.kind.clone().filter(|k| repo::KNOWLEDGE_KINDS.contains(&k.as_str()))
                    .unwrap_or_else(|| "decision".into()),
                title: p.title.clone(),
                statement: p.statement.clone(),
                detail_md: (!detail.is_empty()).then_some(detail),
                topic: p.topic.clone(),
                abstraction: p.abstraction.clone().filter(|a| a == "macro" || a == "meso"),
                ftype: p.ftype.clone(),
                durability: Some("durable".into()),
                governing_id: None,
                evidence_count: Some(
                    p.approaches.iter().filter(|a| known.contains(a.project.as_str())).count() as i64,
                ),
                applicability: None,
                origin_project_id: None, // cross-project by construction
                dedup_key: Some(format!(
                    "divergence:{}",
                    crate::db::repos::dev_tools::normalize_idea_title(&p.title)
                )),
                confidence: p.confidence,
                extends: None,
                layer: None,
                evidence: Vec::new(),
            }
        })
        .collect();

    let summary = repo::ingest_candidates(db, workspace_id, &candidates, "agent", Some(DIVERGENCE_MODEL))?;
    for skip in &summary.skipped {
        DIVERGENCE_JOBS.emit_line(app, job_id, format!("[Skipped] {skip}"));
    }
    let inserted = summary.inserted;
    DIVERGENCE_JOBS.update_extra(job_id, |e| e.inserted = inserted);
    Ok((proposed, inserted))
}

#[cfg(test)]
mod parse_divergence_line_tests {
    use super::parse_divergence_line;

    #[test]
    fn parses_marker_at_start_of_line() {
        let line = r#"DIVERGENCE: {"title":"t","statement":"s","approaches":[]}"#;
        let p = parse_divergence_line(line).expect("should parse");
        assert_eq!(p.title, "t");
    }

    #[test]
    fn parses_decorated_marker_line() {
        // A model that prefixes the protocol line with a bullet or other
        // decoration has still done the work — the strict start-of-line
        // `strip_prefix` used to drop this silently (see workspace_verify's
        // parse_verdict docstring for the real-world "lost 7 of 8" incident).
        let line = r#"- DIVERGENCE: {"title":"t","statement":"s","approaches":[]}"#;
        let p = parse_divergence_line(line).expect("decorated line should still parse");
        assert_eq!(p.title, "t");
    }

    #[test]
    fn rejects_line_without_marker() {
        let line = r#"{"title":"t","statement":"s","approaches":[]}"#;
        assert!(parse_divergence_line(line).is_none());
    }

    #[test]
    fn rejects_unparseable_payload() {
        let line = "DIVERGENCE: {not json}";
        assert!(parse_divergence_line(line).is_none());
    }
}
