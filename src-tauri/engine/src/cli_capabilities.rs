//! In-app probe of the Claude Code CLI's exposed capabilities (P4 Phase 1).
//!
//! Spawns a bounded `claude -p` mirroring personas' production `build_cli_args`
//! flag set, reads the `system/init` event's tool/agent registry, and reports
//! whether the deep-fanout tools (`Workflow`/`Task`) are available. These tools
//! are **tier-gated** (`Workflow` is Max/Team), so a future "deep fan-out"
//! persona capability must gate on this — the same class of cross-account
//! determinism problem the `--effort` pin solved (codebase-stack §2).
//! Empirically validated in `p4_fanout_DESIGN.md` (Phase 0).
//!
//! # Scope of a probe result: the session, not the machine + account
//!
//! This module used to say the probe reported what is available "on this
//! machine + account". That is one axis short and the missing one is not
//! observable from anything cached here. Three things decide whether a
//! capability exists in a given run:
//!
//! - the **artifact** — what the installed binary shipped (`cli_version`);
//! - the **account** — what the plan is entitled to (the tier gate above);
//! - the **session** — what the CLI switched on when *this child process*
//!   started. The CLI resolves part of its surface from a remotely-fetched
//!   flag payload at startup, caches the previous session's payload on disk,
//!   and honours per-process environment overrides.
//!
//! Measured 2026-09-04 on one machine, one account, one `claude_code_version`,
//! two spawns minutes apart: the `system/init` payload reported 24 vs 25
//! `skills`, 59 vs 61 `slash_commands` and 1 vs 2 `plugins` depending only on
//! an environment variable set on the child. `tools` (30) and `agents` (5)
//! did not move under that particular flag — which is why the fields this
//! struct currently derives happened to stay stable, and is not a guarantee
//! that they will. A probe result is therefore evidence about the session it
//! was taken in; it does not generalise to another machine on the same
//! version, and it can change on the next spawn with nothing local altered.
//!
//! Two consequences are load-bearing for callers:
//! `probed_at` is stamped when the probe actually ran, never when a cached
//! copy is served, and `served_from_cache` says which of those happened — a
//! value returned without spawning anything must not be readable as a fresh
//! observation. A caller gating a surface on these fields should prefer a
//! labelled degrade over a hard hide, because the requirement may be met now
//! and unmet on the next launch.
//!
//! Reads only until the `system/init` line, then kills the child — init is
//! emitted at session start, before any LLM turn, so a probe costs ~$0.

use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncBufReadExt;
use ts_rs::TS;

use crate::cli_process::CliProcessDriver;
use crate::prompt::build_cli_args;

/// Max time to wait for the `system/init` event before giving up.
const PROBE_TIMEOUT: Duration = Duration::from_secs(30);

/// What the spawned Claude Code CLI exposes — read from its `system/init` event.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CliCapabilities {
    /// Model the CLI resolved to (e.g. `claude-opus-4-8[1m]`).
    pub model: String,
    /// CLI version from the init event (e.g. `2.1.177`).
    pub cli_version: Option<String>,
    /// Full tool registry exposed to a headless execution.
    pub tools: Vec<String>,
    /// Subagent types available to the `Task` tool (e.g. `claude`, `Explore`).
    pub agents: Vec<String>,
    /// `Workflow` tool present — the dynamic many-agent orchestration tool.
    pub has_workflow: bool,
    /// `Task` tool present — single / parallel subagent delegation.
    pub has_task: bool,
    /// `true` when fan-out is possible at all (either tool present).
    pub deep_fanout_available: bool,
    /// RFC3339 timestamp of the probe itself — the moment the child CLI
    /// reported this surface, never the moment this struct was handed out.
    pub probed_at: String,
    /// `true` when this value was replayed from the in-process cache rather
    /// than obtained by spawning a CLI. A cached capability set is a past
    /// session's observation (see the module docs on the session axis), so it
    /// is marked rather than served as if it had just been measured.
    pub served_from_cache: bool,
}

static CACHE: LazyLock<Mutex<Option<CliCapabilities>>> = LazyLock::new(|| Mutex::new(None));

/// Probe the CLI's capabilities, returning the cached result unless `force`.
pub async fn get_or_probe(force: bool) -> Result<CliCapabilities, String> {
    if !force {
        if let Some(mut c) = CACHE.lock().unwrap().clone() {
            // Replay, not a measurement: say so rather than letting the caller
            // read a past session's surface as the current one.
            c.served_from_cache = true;
            return Ok(c);
        }
    }
    let caps = probe().await?;
    *CACHE.lock().unwrap() = Some(caps.clone());
    Ok(caps)
}

async fn probe() -> Result<CliCapabilities, String> {
    // Mirror production's exact flag set (incl. env removals like CLAUDECODE) so
    // the probed tool surface matches what a real persona execution sees.
    let cli_args = build_cli_args(None, None);
    let mut driver = CliProcessDriver::spawn_temp(&cli_args, "personas-capprobe")?;
    // A trivial prompt; write_stdin closes stdin so the CLI proceeds to init.
    driver.write_stdin(b"capability probe").await;
    let Some(mut reader) = driver.take_stdout_reader() else {
        driver.kill().await;
        return Err("probe: failed to capture CLI stdout".to_string());
    };

    let init = tokio::time::timeout(PROBE_TIMEOUT, async {
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => return None, // EOF before init
                Ok(_) => {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) {
                        if v.get("type").and_then(|t| t.as_str()) == Some("system")
                            && v.get("subtype").and_then(|s| s.as_str()) == Some("init")
                        {
                            return Some(v);
                        }
                    }
                }
                Err(_) => return None,
            }
        }
    })
    .await;

    driver.kill().await;

    let init = init
        .map_err(|_| "probe: timed out waiting for CLI init event".to_string())?
        .ok_or_else(|| "probe: CLI exited before emitting an init event".to_string())?;

    let str_array = |key: &str| -> Vec<String> {
        init.get(key)
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    };
    let tools = str_array("tools");
    let agents = str_array("agents");
    let has_workflow = tools.iter().any(|t| t == "Workflow");
    let has_task = tools.iter().any(|t| t == "Task");

    Ok(CliCapabilities {
        model: init
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown")
            .to_string(),
        cli_version: init
            .get("claude_code_version")
            .and_then(|v| v.as_str())
            .map(String::from),
        deep_fanout_available: has_workflow || has_task,
        has_workflow,
        has_task,
        tools,
        agents,
        probed_at: chrono::Utc::now().to_rfc3339(),
        served_from_cache: false,
    })
}
