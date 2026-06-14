//! In-app probe of the Claude Code CLI's exposed capabilities (P4 Phase 1).
//!
//! Spawns a bounded `claude -p` mirroring personas' production `build_cli_args`
//! flag set, reads the `system/init` event's tool/agent registry, and reports
//! whether the deep-fanout tools (`Workflow`/`Task`) are available on this
//! machine + account. These tools are **tier-gated** (`Workflow` is Max/Team),
//! so a future "deep fan-out" persona capability must gate on this — the same
//! class of cross-account determinism problem the `--effort` pin solved
//! (codebase-stack §2). Empirically validated in `p4_fanout_DESIGN.md` (Phase 0).
//!
//! Reads only until the `system/init` line, then kills the child — init is
//! emitted at session start, before any LLM turn, so a probe costs ~$0.

use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncBufReadExt;
use ts_rs::TS;

use crate::engine::cli_process::CliProcessDriver;
use crate::engine::prompt::build_cli_args;

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
    /// RFC3339 timestamp of the probe.
    pub probed_at: String,
}

static CACHE: LazyLock<Mutex<Option<CliCapabilities>>> = LazyLock::new(|| Mutex::new(None));

/// Probe the CLI's capabilities, returning the cached result unless `force`.
pub async fn get_or_probe(force: bool) -> Result<CliCapabilities, String> {
    if !force {
        if let Some(c) = CACHE.lock().unwrap().clone() {
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
    })
}
