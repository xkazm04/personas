//! KPI measurement composition (Factory "measurement setup").
//!
//! Two headless Claude passes, both spawned in the PROJECT ROOT (cwd = repo) on
//! the user's monthly subscription so codebase commands can be ACTUALLY RUN to
//! verify they yield a number — the gap the proposal scan leaves open (it
//! hand-writes `{cmd, parse}` but never tests it):
//!
//!   * `dev_tools_compose_kpi_measure(kpi_id)` — compose + TEST a codebase
//!     measurement for ONE existing KPI. Result: `{"kpi_measure": {cmd, parse,
//!     value, evidence}}` or `{"kpi_measure": null}` when it isn't measurable
//!     from the codebase.
//!   * `dev_tools_propose_kpi(project_id, scope, intent)` — turn a one-line user
//!     intent into a COMPLETE KPI proposal (metadata + a tested measurement).
//!     Result: `{"kpi_proposal": {…}}`. Pre-fills the add-KPI form.
//!
//! Neither writes to the DB: the composed result rides back on the job's `extra`
//! channel and the frontend applies it via `createKpi` / `updateKpi` (mirrors
//! the connector compose→verify→activate doctrine — the user confirms).
//!
//! Spawn/stream boilerplate is cloned from `kpi_scan.rs`.

use std::sync::Arc;

use serde_json::{json, Value};
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::background_job::BackgroundJobManager;
use crate::commands::design::analysis::extract_display_text;
use crate::db::repos::dev_tools as repo;
use crate::engine::event_registry::event_name;
use crate::engine::prompt;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

/// Job extra: the single composed result envelope (`{"kpi_measure"|"kpi_proposal": …}`).
#[derive(Clone, Default)]
struct ComposeExtra {
    result: Value,
}

static KPI_COMPOSE_JOBS: BackgroundJobManager<ComposeExtra> = BackgroundJobManager::new(
    "kpi-compose lock poisoned",
    event_name::KPI_COMPOSE_STATUS,
    event_name::KPI_COMPOSE_OUTPUT,
);

/// Compose runs may execute a build/test, so allow a generous ceiling.
const COMPOSE_TIMEOUT_SECS: u64 = 600;

/// How `measure_codebase` will run the composed command on this platform — fed
/// to the prompt so the model targets the right shell.
#[cfg(windows)]
const RUN_SHELL_HINT: &str = "Windows `cmd /C <cmd>` (use Windows-friendly syntax; PowerShell is available as `powershell -Command`)";
#[cfg(not(windows))]
const RUN_SHELL_HINT: &str = "POSIX `sh -c <cmd>`";

// =============================================================================
// Commands
// =============================================================================

/// Compose + test a codebase measurement for one existing KPI. Returns
/// `{task_id}`; poll `dev_tools_get_kpi_compose_status`.
#[tauri::command]
pub async fn dev_tools_compose_kpi_measure(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    kpi_id: String,
) -> Result<Value, AppError> {
    require_auth(&state).await?;
    let kpi = repo::get_kpi(&state.db, &kpi_id)?;
    let project = repo::get_project_by_id(&state.db, &kpi.project_id)?;
    let prompt_text = build_measure_compose_prompt(&kpi);
    launch_compose(app, project.root_path, prompt_text)
}

/// Propose a complete KPI (metadata + tested measurement) from a one-line intent.
/// Returns `{task_id}`; poll `dev_tools_get_kpi_compose_status` — the result's
/// `kpi_proposal` pre-fills the add-KPI form (nothing is persisted).
#[tauri::command]
pub async fn dev_tools_propose_kpi(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    project_id: String,
    context_group_id: Option<String>,
    context_id: Option<String>,
    intent: String,
) -> Result<Value, AppError> {
    require_auth(&state).await?;
    if intent.trim().is_empty() {
        return Err(AppError::Validation("Describe what to measure first.".into()));
    }
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    let scope = scope_block(&state.db, &project_id, context_group_id.as_deref(), context_id.as_deref());
    let prompt_text = build_propose_prompt(&project.name, &scope, intent.trim());
    launch_compose(app, project.root_path, prompt_text)
}

/// Create a PROPOSED KPI from structured metadata and (for the codebase
/// mechanism) launch a TRULY-BACKGROUND measurement setup that applies the
/// tested measurement + first reading to the KPI when it finishes — so the
/// modal can close immediately and the proposal lands in Teams › KPIs, filling
/// in its measurement on its own. Derived KPIs carry the chosen metric;
/// connector KPIs carry `needed_connector` and are bound via the Connect flow.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn dev_tools_propose_kpi_auto(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    project_id: String,
    context_group_id: Option<String>,
    context_id: Option<String>,
    name: String,
    description: Option<String>,
    category: String,
    tier: String,
    direction: String,
    measure_kind: String,
    cadence: String,
    unit: Option<String>,
    needed_connector: Option<String>,
    derived_metric: Option<String>,
) -> Result<crate::db::models::DevKpi, AppError> {
    require_auth(&state).await?;
    if name.trim().is_empty() {
        return Err(AppError::Validation("Give the KPI a name.".into()));
    }
    let measure_config = if measure_kind == "derived" {
        derived_metric
            .as_deref()
            .filter(|m| !m.is_empty())
            .map(|m| json!({ "metric": m }).to_string())
            .unwrap_or_else(|| "{}".to_string())
    } else {
        "{}".to_string()
    };
    let kpi = repo::create_kpi(
        &state.db, &project_id, name.trim(), description.as_deref(),
        context_group_id.as_deref(), &category, &measure_kind, &measure_config,
        unit.as_deref().unwrap_or(""), &direction,
        None, None, None, &cadence, Some("proposed"), "user", None,
        needed_connector.as_deref(), None, context_id.as_deref(),
    )?;
    if tier != "supporting" {
        let _ = repo::update_kpi(
            &state.db, &kpi.id, None, None, None, None, None, None, None, None, None, None,
            None, None, None, None, None, None, Some(&tier),
        );
    }
    if measure_kind == "codebase" {
        let project = repo::get_project_by_id(&state.db, &project_id)?;
        let prompt_text = build_measure_compose_prompt(&kpi);
        launch_compose_apply(app, state.db.clone(), kpi.id.clone(), project.root_path, prompt_text);
    }
    repo::get_kpi(&state.db, &kpi.id)
}

/// Poll a compose/propose task. Returns `{task_id, status, error, lines, result}`
/// where `result` is the composed envelope once `status == "completed"`.
#[tauri::command]
pub fn dev_tools_get_kpi_compose_status(
    state: State<'_, Arc<AppState>>,
    task_id: String,
) -> Result<Value, AppError> {
    require_auth_sync(&state)?;
    let result = KPI_COMPOSE_JOBS
        .read_extra(&task_id, |e| e.result.clone())
        .unwrap_or(Value::Null);
    match KPI_COMPOSE_JOBS.get_snapshot(&task_id) {
        Some(s) => Ok(json!({
            "task_id": task_id,
            "status": s.status,
            "error": s.error,
            "lines": s.lines,
            "result": result,
        })),
        None => Ok(json!({ "task_id": task_id, "status": "not_found" })),
    }
}

#[tauri::command]
pub async fn dev_tools_cancel_kpi_compose(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    task_id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    if let Some(token) = KPI_COMPOSE_JOBS.get_cancel_token(&task_id)? {
        token.cancel();
        KPI_COMPOSE_JOBS.set_status(&app, &task_id, "cancelled", None);
        Ok(true)
    } else {
        Ok(false)
    }
}

// =============================================================================
// Launch + run
// =============================================================================

fn launch_compose(
    app: tauri::AppHandle,
    root_path: String,
    prompt_text: String,
) -> Result<Value, AppError> {
    let task_id = uuid::Uuid::new_v4().to_string();
    let cancel_token = CancellationToken::new();
    KPI_COMPOSE_JOBS.insert_running(task_id.clone(), cancel_token.clone(), ComposeExtra::default())?;
    KPI_COMPOSE_JOBS.set_status(&app, &task_id, "running", None);

    let app_handle = app.clone();
    let task_for_run = task_id.clone();
    tokio::spawn(async move {
        let result = tokio::select! {
            _ = cancel_token.cancelled() => Err(AppError::Internal("compose cancelled".into())),
            res = run_compose(&app_handle, &task_for_run, &root_path, prompt_text) => res,
        };
        match result {
            Ok(true) => KPI_COMPOSE_JOBS.set_status(&app_handle, &task_for_run, "completed", None),
            Ok(false) => KPI_COMPOSE_JOBS.set_status(
                &app_handle,
                &task_for_run,
                "failed",
                Some("The model returned no measurement.".into()),
            ),
            Err(e) => {
                let msg = format!("{e}");
                KPI_COMPOSE_JOBS.emit_line(&app_handle, &task_for_run, format!("[Error] {msg}"));
                KPI_COMPOSE_JOBS.set_status(&app_handle, &task_for_run, "failed", Some(msg));
            }
        }
    });

    Ok(json!({ "task_id": task_id }))
}

/// Like `launch_compose`, but on success it APPLIES the composed measurement to
/// `kpi_id` (measure_config + a first recorded reading, seeding the baseline
/// when none was set) before marking the job complete. Fire-and-forget: the
/// caller returns immediately and the proposed KPI fills in its measurement on
/// its own.
fn launch_compose_apply(
    app: tauri::AppHandle,
    pool: crate::db::DbPool,
    kpi_id: String,
    root_path: String,
    prompt_text: String,
) -> String {
    let task_id = uuid::Uuid::new_v4().to_string();
    let cancel_token = CancellationToken::new();
    let _ = KPI_COMPOSE_JOBS.insert_running(task_id.clone(), cancel_token.clone(), ComposeExtra::default());
    KPI_COMPOSE_JOBS.set_status(&app, &task_id, "running", None);

    let app_handle = app.clone();
    let task = task_id.clone();
    tokio::spawn(async move {
        let result = tokio::select! {
            _ = cancel_token.cancelled() => Err(AppError::Internal("compose cancelled".into())),
            res = run_compose(&app_handle, &task, &root_path, prompt_text) => res,
        };
        match result {
            Ok(true) => {
                if let Some(env) = KPI_COMPOSE_JOBS.read_extra(&task, |e| e.result.clone()) {
                    let _ = tokio::task::spawn_blocking(move || {
                        apply_composed_measure(&pool, &kpi_id, &env);
                    })
                    .await;
                }
                KPI_COMPOSE_JOBS.set_status(&app_handle, &task, "completed", None);
            }
            Ok(false) => KPI_COMPOSE_JOBS.set_status(
                &app_handle,
                &task,
                "failed",
                Some("The model returned no measurement.".into()),
            ),
            Err(e) => {
                let msg = format!("{e}");
                KPI_COMPOSE_JOBS.emit_line(&app_handle, &task, format!("[Error] {msg}"));
                KPI_COMPOSE_JOBS.set_status(&app_handle, &task, "failed", Some(msg));
            }
        }
    });
    task_id
}

/// Write a composed `{"kpi_measure": {cmd, parse, value}}` envelope onto a KPI:
/// set its measure_config, record the verified reading, and seed the baseline
/// if the user left it blank. Best-effort — failures are swallowed (background).
fn apply_composed_measure(pool: &crate::db::DbPool, kpi_id: &str, env: &Value) {
    let Some(m) = env.get("kpi_measure") else { return };
    let cmd = m.get("cmd").and_then(|v| v.as_str()).unwrap_or("");
    let parse = m.get("parse").and_then(|v| v.as_str()).unwrap_or("");
    if cmd.is_empty() || parse.is_empty() {
        return;
    }
    let config = json!({ "cmd": cmd, "parse": parse }).to_string();
    let _ = repo::update_kpi(
        pool, kpi_id, None, None, None, None, None, None, Some(&config), None, None, None,
        None, None, None, None, None, None, None,
    );
    if let Some(value) = m.get("value").and_then(|v| v.as_f64()) {
        let _ = repo::record_kpi_measurement(pool, kpi_id, value, "ai-compose", None, None);
        if matches!(repo::get_kpi(pool, kpi_id), Ok(k) if k.baseline_value.is_none()) {
            let _ = repo::update_kpi(
                pool, kpi_id, None, None, None, None, None, None, None, None, None,
                Some(Some(value)), None, None, None, None, None, None, None,
            );
        }
    }
}

/// Pull the first `{"kpi_measure": …}` / `{"kpi_proposal": …}` envelope out of a
/// protocol line, tolerating trailing prose after the JSON object.
fn extract_result(line: &str) -> Option<Value> {
    let t = line.trim();
    if !(t.contains("\"kpi_measure\"") || t.contains("\"kpi_proposal\"")) {
        return None;
    }
    let start = t.find('{')?;
    serde_json::Deserializer::from_str(&t[start..])
        .into_iter::<Value>()
        .next()
        .and_then(Result::ok)
}

async fn run_compose(
    app: &tauri::AppHandle,
    task_id: &str,
    root_path: &str,
    prompt_text: String,
) -> Result<bool, AppError> {
    KPI_COMPOSE_JOBS.emit_line(app, task_id, "[Milestone] Composing & testing measurement…");

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let exec_dir = std::path::PathBuf::from(root_path);
    let mut cmd = Command::new(&cli_args.command);
    cmd.args(&cli_args.args)
        .current_dir(&exec_dir)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    for key in &cli_args.env_removals {
        cmd.env_remove(key);
    }
    for (key, val) in &cli_args.env_overrides {
        cmd.env(key, val);
    }
    // Monthly-subscription auth (strip ANTHROPIC_API_KEY etc.) — never fall back
    // to pay-as-you-go API billing. Parity with every other headless spawn.
    crate::engine::cli_process::force_subscription_auth(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::Internal("Claude CLI not found.".into())
        } else {
            AppError::Internal(format!("Failed to spawn Claude CLI: {e}"))
        }
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        let bytes = prompt_text.into_bytes();
        tokio::spawn(async move {
            let _ = stdin.write_all(&bytes).await;
            let _ = stdin.shutdown().await;
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app_clone = app.clone();
        let task_clone = task_id.to_string();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if !line.trim().is_empty() {
                    KPI_COMPOSE_JOBS.emit_line(&app_clone, &task_clone, format!("[stderr] {line}"));
                }
            }
        });
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("Missing stdout pipe".into()))?;
    let mut reader = BufReader::new(stdout).lines();

    let mut found = false;
    let stream = tokio::time::timeout(
        std::time::Duration::from_secs(COMPOSE_TIMEOUT_SECS),
        async {
            while let Ok(Some(line)) = reader.next_line().await {
                let Some(text) = extract_display_text(&line) else { continue };
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    continue;
                }
                KPI_COMPOSE_JOBS.emit_line(app, task_id, trimmed.to_string());
                if found {
                    continue;
                }
                for proto_line in trimmed.lines() {
                    if let Some(envelope) = extract_result(proto_line) {
                        KPI_COMPOSE_JOBS.update_extra(task_id, |e| e.result = envelope.clone());
                        KPI_COMPOSE_JOBS.emit_line(app, task_id, "[Milestone] Measurement composed.");
                        found = true;
                        break;
                    }
                }
            }
        },
    )
    .await;

    if stream.is_err() {
        let _ = child.kill().await;
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), child.wait()).await;
        if found {
            return Ok(true);
        }
        return Err(AppError::Internal(format!(
            "Measurement composition timed out ({}s).",
            COMPOSE_TIMEOUT_SECS
        )));
    }
    let _ = child.wait().await;
    Ok(found)
}

// =============================================================================
// Prompts
// =============================================================================

fn build_measure_compose_prompt(kpi: &crate::db::models::DevKpi) -> String {
    let current = if kpi.measure_config.trim().is_empty() || kpi.measure_config.trim() == "{}" {
        "(none yet)".to_string()
    } else {
        kpi.measure_config.clone()
    };
    let better = if kpi.direction == "down" { "lower is better" } else { "higher is better" };
    format!(
        r#"You are composing a deterministic, TESTED measurement for ONE engineering KPI. You are in the repository root and you SHOULD run commands to verify your work.

KPI: "{name}"
What it measures: {desc}
Category: {category} · unit: {unit} · {better}.
Current methodic (may be empty/placeholder): {current}

## Your job
Compose a SINGLE command, runnable from the repo root, whose output lets exactly ONE number — the KPI's current value in "{unit}" — be parsed, plus a `parse` strategy. Then ACTUALLY RUN it and confirm a number comes out. Iterate until it works (fix syntax, pick the right globs/flags, prefer scripts already in package.json). Keep it fast (avoid full production builds where possible) and deterministic.

The command will be executed via {shell}. A non-zero exit is FINE (linters exit non-zero when issues exist) — what matters is parseable output.

`parse` is one of:
- "coverage_pct"  — a coverage percentage from jest/vitest/nyc/pytest output
- "count_lines"   — count of non-empty stdout lines (e.g. `grep -rn ... | ...`)
- "regex:<pattern with exactly ONE capture group>"  — e.g. "regex:(\d+) errors?"
- "json_path:<dot.path>"  — read the path from the LAST JSON line of stdout

## Output
When the command works and you have verified the parsed number, emit EXACTLY ONE line and nothing else on it:
{{"kpi_measure": {{"cmd": "<command>", "parse": "<strategy>", "value": <the number you parsed>, "evidence": "<one sentence: what you ran and what it returned>"}}}}

If this KPI genuinely CANNOT be measured from the codebase (it needs a 3rd-party connector or human judgement), emit exactly:
{{"kpi_measure": null}}
"#,
        name = kpi.name,
        desc = kpi.description.as_deref().unwrap_or("(no description)"),
        category = kpi.category,
        unit = if kpi.unit.is_empty() { "(unitless)" } else { &kpi.unit },
        better = better,
        current = current,
        shell = RUN_SHELL_HINT,
    )
}

/// A short scope hint for the propose prompt: which context group / context the
/// KPI is being added under, with a couple of representative file paths.
fn scope_block(
    pool: &crate::db::DbPool,
    project_id: &str,
    context_group_id: Option<&str>,
    context_id: Option<&str>,
) -> String {
    if let Some(cid) = context_id {
        if let Ok(ctx) = repo::get_context_by_id(pool, cid) {
            let files: Vec<String> = serde_json::from_str::<Vec<String>>(&ctx.file_paths)
                .unwrap_or_default()
                .into_iter()
                .take(8)
                .collect();
            let desc = ctx
                .description
                .as_deref()
                .map(|d| format!(" — {d}"))
                .unwrap_or_default();
            let files_block = if files.is_empty() {
                String::new()
            } else {
                format!(
                    "\nRepresentative files:\n{}",
                    files.iter().map(|f| format!("  - {f}")).collect::<Vec<_>>().join("\n")
                )
            };
            return format!("Scope: the \"{}\" context{}.{}", ctx.name, desc, files_block);
        }
    }
    if let Some(gid) = context_group_id {
        if let Some(g) = repo::list_context_groups(pool, project_id)
            .unwrap_or_default()
            .into_iter()
            .find(|g| g.id == gid)
        {
            return format!(
                "Scope: the \"{}\" context group (a feature area of the project).",
                g.name
            );
        }
    }
    "Scope: project-wide (cross-cutting).".to_string()
}

fn build_propose_prompt(project_name: &str, scope: &str, intent: &str) -> String {
    format!(
        r#"You are an engineering-metrics analyst proposing ONE Key Performance Indicator for the project "{project_name}" from the user's intent, then composing a TESTED measurement for it. You are in the repository root and you SHOULD run commands to verify.

User intent: "{intent}"
{scope}

## Steps
1. Turn the intent into a concrete, outcome-oriented KPI: a precise `name`, a one-line `description`, a `category` (technical | quality | traffic | value), a `tier` (north_star | primary | supporting), a `unit`, a `direction` ("up" if higher is better else "down"), a plausible current `baseline_hint`, an ambitious-but-reachable ~4-6 week `suggested_target`, and a `cadence` (manual | daily | weekly).
2. Pick how it is measured and fill `measure_kind` + `measure_config`:
   - codebase  → {{"cmd": "<command>", "parse": "coverage_pct"|"count_lines"|"regex:(...)"|"json_path:..."}} — and ACTUALLY RUN the command from the repo root to verify it yields a number; set `baseline_hint` from that real value. The command runs via {shell}; non-zero exit is fine.
   - derived   → {{"metric": "qa_bounce_rate"|"exec_failure_rate"|"incident_rate"|"parked_review_age_days"}} (measured from the orchestrator's own DB).
   - connector → set `metric_type` to one of unique_visitors|api_requests|llm_tokens|llm_cost|revenue|open_errors and `measure_config` to {{}}; if the data source is a 3rd-party tool not yet connected, also set `needed_connector` to the service name (e.g. "posthog", "stripe").
   - manual    → {{"instruction": "<what the human rates/enters>"}} (for value/business KPIs judged by a person).
3. Prefer codebase for technical KPIs, connector for traffic/value, and whatever fits for quality.

## Output
Emit EXACTLY ONE line and nothing else on it:
{{"kpi_proposal": {{"name": "...", "description": "...", "category": "technical", "tier": "supporting", "measure_kind": "codebase", "measure_config": {{}}, "unit": "%", "direction": "up", "baseline_hint": null, "suggested_target": null, "cadence": "weekly", "rationale": "<one sentence: why this metric steers value>", "needed_connector": "", "metric_type": ""}}}}
"#,
        project_name = project_name,
        intent = intent,
        scope = scope,
        shell = RUN_SHELL_HINT,
    )
}
