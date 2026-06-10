//! Revitalize — background "sleep cycle" for the Obsidian vault.
//!
//! Spawns the Claude Code CLI inside the configured vault and lets it
//! consolidate memory notes the way sleep consolidates human memory:
//! deleting stale notes, merging duplicates into canonical notes, and
//! refreshing structure/links. Follows the app-wide background-CLI
//! pattern (`BackgroundJobManager` + status/output Tauri events), see
//! `commands::design::n8n_transform` for the reference implementation.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::background_job::{BackgroundJobManager, BackgroundTaskSnapshot, JobEntry};
use crate::commands::design::analysis::extract_display_text;
use crate::db::models::ObsidianVaultConfig;
use crate::db::repos::core::settings as settings_repo;
use crate::engine::event_registry::event_name;
use crate::engine::prompt;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

/// Hard cap for one revitalize pass. Must stay safely under the job
/// manager's ~10.5-minute stale-running sweep, otherwise snapshot polling
/// would mark a still-streaming job as failed. The prompt bounds the work
/// per pass instead; users re-run for large vaults.
const REVITALIZE_TIMEOUT_SECS: u64 = 540;

/// Soft per-pass note budget given to the model (keeps a pass inside the
/// time cap on large vaults).
const NOTES_PER_PASS: usize = 40;

// ── Job state ─────────────────────────────────────────────────────────

#[derive(Clone, Default)]
pub struct RevitalizeExtra {
    pub vault_path: String,
    pub vault_name: String,
    /// Final merged summary (model-reported actions + measured deltas).
    pub summary: Option<serde_json::Value>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevitalizeSnapshotExtras {
    vault_path: String,
    vault_name: String,
    summary: Option<serde_json::Value>,
}

pub type RevitalizeSnapshot = BackgroundTaskSnapshot<RevitalizeSnapshotExtras>;

static REVITALIZE_JOBS: BackgroundJobManager<RevitalizeExtra> = BackgroundJobManager::new(
    "obsidian revitalize job lock poisoned",
    event_name::OBSIDIAN_REVITALIZE_STATUS,
    event_name::OBSIDIAN_REVITALIZE_OUTPUT,
);

// ── Options & vault measurement ───────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevitalizeOptions {
    /// Delete notes that are stale, superseded, or content-free.
    pub prune_stale: bool,
    /// Merge near-duplicate / overlapping notes into one canonical note.
    pub merge_duplicates: bool,
    /// Refresh frontmatter, titles, and [[wiki-links]] on surviving notes.
    pub refresh_structure: bool,
    /// Optional free-form operator guidance appended to the prompt.
    pub instructions: Option<String>,
}

#[derive(Clone, Copy, Default)]
struct VaultScanStats {
    note_count: u64,
    total_bytes: u64,
}

impl VaultScanStats {
    /// Rough token estimate (bytes / 4) — a readout, not an accounting unit.
    fn est_tokens(&self) -> u64 {
        self.total_bytes / 4
    }
}

/// Count markdown notes + bytes under `root`, skipping dot-directories
/// (`.obsidian`, `.trash`, …). Iterative walk: vaults can nest deeply.
fn scan_vault_notes(root: &Path) -> VaultScanStats {
    let mut stats = VaultScanStats::default();
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if !name.starts_with('.') {
                    stack.push(path);
                }
            } else if path.extension().map(|e| e == "md").unwrap_or(false) {
                stats.note_count += 1;
                stats.total_bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
    }
    stats
}

// ── Prompt ────────────────────────────────────────────────────────────

fn build_revitalize_prompt(config: &ObsidianVaultConfig, options: &RevitalizeOptions) -> String {
    let mut goals = Vec::new();
    if options.prune_stale {
        goals.push(
            "- DELETE notes that are stale, superseded by newer notes, or content-free \
             (empty bodies, pure boilerplate). Prefer deleting the older note when two \
             notes disagree and one is clearly newer.",
        );
    }
    if options.merge_duplicates {
        goals.push(
            "- AGGREGATE overlapping or duplicate notes: merge their unique content into \
             one canonical note, keep the best title, then delete the absorbed notes. \
             Add [[wiki-links]] from related notes to the canonical one where helpful.",
        );
    }
    if options.refresh_structure {
        goals.push(
            "- UPDATE surviving notes in place: fix broken [[wiki-links]], normalize \
             frontmatter, tighten rambling prose without losing facts, and make titles \
             descriptive.",
        );
    }

    let memories_hint = format!(
        "Memory notes live under `{personas}/<agent name>/{memories}/` (per-agent memories) — \
         treat that subtree as the primary target. Other folders ({connectors}, {research}, \
         {knowledge}, {athena}) are secondary; only touch them when clearly beneficial.",
        personas = config.folder_mapping.personas_folder,
        memories = config.folder_mapping.memories_folder,
        connectors = config.folder_mapping.connectors_folder,
        research = config.folder_mapping.research_folder,
        knowledge = config.folder_mapping.knowledge_folder,
        athena = config.folder_mapping.athena_folder,
    );

    let extra = options
        .instructions
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("\nOperator guidance (follow within the safety rules):\n{s}\n"))
        .unwrap_or_default();

    format!(
        "You are running a memory-consolidation pass over an Obsidian vault — like the brain \
during sleep: prune what no longer matters, strengthen and connect what does. Your working \
directory IS the vault root.

{memories_hint}

Goals for this pass:
{goals}

Safety rules (non-negotiable):
- Operate ONLY on `.md` files inside this vault. Never touch the `.obsidian/` directory, any \
dot-directory, attachments, or non-markdown files.
- Never invent facts. When merging, preserve every distinct fact from the source notes.
- Keep user-authored daily notes and meeting notes intact unless they are exact duplicates.
- Bound the pass: review at most {notes_per_pass} notes this run, prioritising the most \
redundant/stale clusters first. A follow-up run continues the work.

Work method: first list the target folder(s) to map the terrain, read the candidate notes, \
then act (delete / merge / rewrite). Narrate each action in one short line as you go, e.g. \
`Merged 'API keys (old)' + 'API keys v2' -> 'API keys'`.

When you are done, output as the FINAL line exactly one line in this format (raw JSON, no \
code fence):
REVITALIZE_SUMMARY: {{\"filesDeleted\": <n>, \"filesMerged\": <n>, \"filesUpdated\": <n>, \
\"filesReviewed\": <n>, \"summary\": \"<one-paragraph human summary>\", \
\"highlights\": [\"<up to 5 notable actions>\"]}}
{extra}",
        memories_hint = memories_hint,
        goals = goals.join("\n"),
        notes_per_pass = NOTES_PER_PASS,
        extra = extra,
    )
}

/// Extract the trailing `REVITALIZE_SUMMARY: {...}` line from CLI output.
fn parse_summary_line(output: &str) -> Option<serde_json::Value> {
    for line in output.lines().rev() {
        if let Some(rest) = line.trim().strip_prefix("REVITALIZE_SUMMARY:") {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(rest.trim()) {
                return Some(value);
            }
        }
    }
    None
}

fn u64_field(value: Option<&serde_json::Value>, key: &str) -> u64 {
    value
        .and_then(|v| v.get(key))
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
}

// ── CLI runner ────────────────────────────────────────────────────────

/// Spawn the Claude CLI with the vault as CWD and stream display lines to
/// `on_line`. Mirrors `n8n_transform::run_claude_prompt_text_inner`, minus
/// the temp-dir CWD (the vault IS the working set here) and the n8n-specific
/// section accumulator.
async fn run_claude_in_vault(
    prompt_text: String,
    vault_path: &Path,
    on_line: &(dyn Fn(&str) + Send + Sync),
    timeout_secs: u64,
) -> Result<String, String> {
    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let mut cmd = Command::new(&cli_args.command);
    cmd.args(&cli_args.args)
        .current_dir(vault_path)
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

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code"
                .to_string()
        } else {
            format!("Failed to spawn Claude CLI: {e}")
        }
    })?;

    // Write the prompt from a separate task to avoid stdin/stdout deadlock.
    if let Some(mut stdin) = child.stdin.take() {
        let prompt_bytes = prompt_text.into_bytes();
        tokio::spawn(async move {
            let _ = stdin.write_all(&prompt_bytes).await;
            let _ = stdin.shutdown().await;
        });
    }

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Missing stderr pipe".to_string())?;
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut buf = String::new();
        let _ = tokio::io::AsyncReadExt::read_to_string(&mut reader, &mut buf).await;
        buf
    });

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Missing stdout pipe".to_string())?;
    let mut reader = BufReader::new(stdout).lines();
    let mut text_output = String::new();
    let mut last_emitted: Option<String> = None;

    let streamed = tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), async {
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            if let Some(text) = extract_display_text(&line) {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    continue;
                }
                text_output.push_str(trimmed);
                text_output.push('\n');
                if last_emitted.as_deref() == Some(trimmed) {
                    continue;
                }
                on_line(trimmed);
                last_emitted = Some(trimmed.to_string());
            }
        }
    })
    .await;

    if streamed.is_err() {
        let _ = child.kill().await;
        let _ = child.wait().await;
        return Err(format!(
            "Revitalize pass timed out after {timeout_secs}s — re-run to continue where it left off"
        ));
    }

    let exit_status = child
        .wait()
        .await
        .map_err(|e| format!("Failed waiting for Claude CLI: {e}"))?;
    let stderr_output = stderr_task.await.unwrap_or_default();

    if !exit_status.success() {
        let msg = stderr_output
            .trim()
            .lines()
            .last()
            .unwrap_or("unknown error")
            .to_string();
        return Err(format!("Claude CLI exited with error: {msg}"));
    }
    if text_output.trim().is_empty() {
        return Err("Claude produced no output".into());
    }
    Ok(text_output)
}

// ── Tauri commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn obsidian_revitalize_start(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    options: RevitalizeOptions,
) -> Result<String, AppError> {
    require_auth(&state).await?;

    if !options.prune_stale && !options.merge_duplicates && !options.refresh_structure {
        return Err(AppError::Validation(
            "Select at least one optimization goal".into(),
        ));
    }

    // Resolve the active vault from the persisted config (same source the
    // rest of the Brain plugin uses).
    let config: ObsidianVaultConfig = match settings_repo::get(&state.db, super::SETTINGS_KEY)? {
        Some(json) => serde_json::from_str(&json)
            .map_err(|e| AppError::Internal(format!("Failed to parse vault config: {e}")))?,
        None => {
            return Err(AppError::Validation(
                "No vault configured. Connect a vault in Setup first.".into(),
            ))
        }
    };
    let vault_dir = PathBuf::from(&config.vault_path);
    if !vault_dir.is_dir() {
        return Err(AppError::Validation(format!(
            "Vault path does not exist: {}",
            config.vault_path
        )));
    }

    let job_id = format!("revitalize-{}", Uuid::new_v4());
    let cancel_token = CancellationToken::new();

    // One revitalize at a time, app-wide — two concurrent passes would edit
    // the same notes underneath each other.
    {
        let mut jobs = REVITALIZE_JOBS.lock()?;
        if jobs.values().any(|j| j.status == "running") {
            return Err(AppError::Validation(
                "A revitalize pass is already running".into(),
            ));
        }
        REVITALIZE_JOBS.evict_stale(&mut jobs);
        jobs.insert(
            job_id.clone(),
            JobEntry {
                status: "running".into(),
                error: None,
                lines: Vec::new(),
                cancel_token: Some(cancel_token.clone()),
                created_at: std::time::Instant::now(),
                extra: RevitalizeExtra {
                    vault_path: config.vault_path.clone(),
                    vault_name: config.vault_name.clone(),
                    summary: None,
                },
            },
        );
    }
    REVITALIZE_JOBS.set_status(&app, &job_id, "running", None);

    let prompt_text = build_revitalize_prompt(&config, &options);
    let app_for_task = app.clone();
    let job_for_task = job_id.clone();
    let token_for_task = cancel_token;

    tokio::spawn(async move {
        let started = std::time::Instant::now();
        let before = scan_vault_notes(&vault_dir);
        REVITALIZE_JOBS.emit_line(
            &app_for_task,
            &job_for_task,
            format!(
                "[Milestone] Vault scan: {} notes, ~{} tokens. Starting consolidation...",
                before.note_count,
                before.est_tokens()
            ),
        );

        let on_line = {
            let app = app_for_task.clone();
            let id = job_for_task.clone();
            move |line: &str| {
                REVITALIZE_JOBS.emit_line(&app, &id, line.to_string());
            }
        };

        let result = tokio::select! {
            _ = token_for_task.cancelled() => Err("Cancelled by user".to_string()),
            res = run_claude_in_vault(
                prompt_text,
                &vault_dir,
                &on_line,
                REVITALIZE_TIMEOUT_SECS,
            ) => res,
        };

        match result {
            Ok(output) => {
                let after = scan_vault_notes(&vault_dir);
                let model_summary = parse_summary_line(&output);
                let summary = serde_json::json!({
                    "filesDeleted": u64_field(model_summary.as_ref(), "filesDeleted"),
                    "filesMerged": u64_field(model_summary.as_ref(), "filesMerged"),
                    "filesUpdated": u64_field(model_summary.as_ref(), "filesUpdated"),
                    "filesReviewed": u64_field(model_summary.as_ref(), "filesReviewed"),
                    "summary": model_summary
                        .as_ref()
                        .and_then(|v| v.get("summary"))
                        .and_then(|v| v.as_str())
                        .unwrap_or(""),
                    "highlights": model_summary
                        .as_ref()
                        .and_then(|v| v.get("highlights"))
                        .cloned()
                        .unwrap_or_else(|| serde_json::json!([])),
                    "notesBefore": before.note_count,
                    "notesAfter": after.note_count,
                    "bytesBefore": before.total_bytes,
                    "bytesAfter": after.total_bytes,
                    "estTokensBefore": before.est_tokens(),
                    "estTokensAfter": after.est_tokens(),
                    "durationSecs": started.elapsed().as_secs(),
                });
                REVITALIZE_JOBS.update_extra(&job_for_task, |extra| {
                    extra.summary = Some(summary);
                });
                REVITALIZE_JOBS.set_status(&app_for_task, &job_for_task, "completed", None);
            }
            Err(err) => {
                tracing::warn!(job_id = %job_for_task, error = %err, "obsidian revitalize pass failed");
                REVITALIZE_JOBS.set_status(&app_for_task, &job_for_task, "failed", Some(err));
            }
        }
    });

    Ok(job_id)
}

#[tauri::command]
pub fn obsidian_revitalize_snapshot(
    state: State<'_, Arc<AppState>>,
    job_id: String,
) -> Result<RevitalizeSnapshot, AppError> {
    require_auth_sync(&state)?;
    REVITALIZE_JOBS
        .get_task_snapshot(&job_id, |extra| RevitalizeSnapshotExtras {
            vault_path: extra.vault_path.clone(),
            vault_name: extra.vault_name.clone(),
            summary: extra.summary.clone(),
        })
        .ok_or_else(|| AppError::NotFound("Revitalize job not found".into()))
}

/// The currently-running revitalize job id, if any — lets the panel
/// re-attach after a remount without the frontend persisting the id.
#[tauri::command]
pub fn obsidian_revitalize_active(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<String>, AppError> {
    require_auth_sync(&state)?;
    let jobs = REVITALIZE_JOBS.lock()?;
    Ok(jobs
        .iter()
        .find(|(_, j)| j.status == "running")
        .map(|(id, _)| id.clone()))
}

#[tauri::command]
pub fn obsidian_revitalize_cancel(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    job_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    REVITALIZE_JOBS.cancel_or_preempt(&app, &job_id, RevitalizeExtra::default())
}
