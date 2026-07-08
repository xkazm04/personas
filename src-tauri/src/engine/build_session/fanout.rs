//! Per-capability resolution fan-out — build-orchestration Phase 3 (the big lift).
//!
//! The core new mechanic for the multi-agent build. Today the build is ONE Claude
//! CLI conversation the model drives across `--continue` turns. This inverts the
//! control: once `behavior_core` + `capability_enumeration` exist, each capability
//! is resolved in its OWN CLI conversation (fresh temp dir, NO `--continue`), in
//! parallel, bounded by the Phase 2 `orchestrator::run_lanes` scheduler. Each
//! sub-agent gets the persona identity + the single capability + connector context
//! and emits `capability_resolution` events for that capability only; the caller
//! merges them back into `resolved_cells` and then runs the serial agent_ir
//! assembly (one lead turn) as before.
//!
//! ## STATUS — first draft, NOT yet wired, NOT runtime-verified
//! This module is the fan-out MECHANIC. The remaining Phase 3 step is to wire it
//! into `run_session` behind the `multiagent` flag:
//!   1. run the serial head (turn 0) until `behavior_core` + `capability_enumeration`
//!      land; extract the behavior_core JSON + the capability list from the parsed
//!      events (or `resolved_cells`), and build the connector-context blob;
//!   2. call [`fan_out_resolution`]; dual-emit each returned event; fold the
//!      resolutions into `resolved_cells`;
//!   3. run one lead turn to assemble `agent_ir` from the merged capabilities,
//!      then continue to DraftReady → oneshot test/promote as today.
//! The prompt grounding + the merge/assembly correctness need live iteration
//! against the `lite-web-summary` baseline (a `cargo check` can't prove them),
//! which is why the wiring is deferred to a verifiable session. Gated on
//! `multiagent`; the sequential path is untouched.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use serde_json::Value;
use tauri::ipc::Channel;

use super::super::cli_process::{read_line_limited, CliProcessDriver};
use super::super::types::CliArgs;
use super::orchestrator::{lane, run_lanes, LaneTask};
use super::parser::parse_build_line;
use crate::db::models::{BuildEvent, BuildPhase, UpdateBuildSession};
use crate::db::repos::core::build_sessions as build_session_repo;
use crate::db::DbPool;
use crate::ActiveProcessRegistry;

/// One capability's resolved fields — the `capability_resolution` events the
/// sub-agent emitted (lane-stamped), plus an `error` if the lane failed.
pub struct CapabilityResolution {
    pub capability_id: String,
    pub events: Vec<BuildEvent>,
    pub error: Option<String>,
    pub usage: TurnUsage,
}

/// Build the focused prompt for one capability's sub-agent. It carries the
/// persona identity (`behavior_core`) + the single capability + connector
/// context, and instructs the model to emit ONLY that capability's
/// `capability_resolution` events (no other capabilities, no clarifying
/// questions, no agent_ir). Self-sufficient: sub-agents get no `--continue`
/// history, so all context is in this prompt.
pub fn build_capability_prompt(
    behavior_core: &Value,
    capability: &Value,
    connector_context: &str,
) -> String {
    let cap_id = capability.get("id").and_then(|v| v.as_str()).unwrap_or("");
    format!(
        "You are resolving ONE capability of an AI persona that is already defined. \
         The persona's identity and its full capability list are fixed — your job is \
         only to flesh out the single capability below.\n\n\
         ## Persona identity (behavior_core)\n{core}\n\n\
         ## The capability to resolve (resolve ONLY this one)\n{cap}\n\n\
         ## Available connectors\n{conn}\n\n\
         ## Your task\n\
         Emit the v3 `capability_resolution` events for capability `{id}` and NOTHING \
         else. Resolve each applicable field: suggested_trigger, connectors, tool_hints, \
         event_subscriptions, input_schema, sample_input, review_policy, memory_policy, \
         notification_channels, error_handling. Do NOT resolve other capabilities; do NOT \
         emit behavior_core / capability_enumeration / persona_resolution / agent_ir; do \
         NOT ask clarifying questions — pick sensible defaults.\n\n\
         Output raw JSON only, one event per line, each of the form:\n\
         {{\"capability_resolution\": {{\"id\": \"{id}\", \"field\": \"<field-name>\", \
         \"value\": <field-value>, \"status\": \"resolved\"}}}}\n",
        core = serde_json::to_string_pretty(behavior_core).unwrap_or_default(),
        cap = serde_json::to_string_pretty(capability).unwrap_or_default(),
        conn = connector_context,
        id = cap_id,
    )
}

/// Resolve one capability in its own CLI conversation (fresh temp dir, no
/// `--continue`). Returns the capability's `capability_resolution` events
/// (lane-stamped), filtering out anything else the sub-agent may have emitted.
/// Errors are captured on the returned struct — never panics the lane.
async fn resolve_one_capability(
    cli_args: CliArgs,
    prompt: String,
    session_id: String,
    capability_id: String,
) -> CapabilityResolution {
    let lane_id = format!("cap-{capability_id}");
    // Timing markers: the log timestamps of these across lanes reveal whether
    // the fan-out is truly concurrent or serializing (subscription throttling).
    tracing::info!(cap = %capability_id, "fan-out lane: start");
    let mut driver = match CliProcessDriver::spawn_temp(&cli_args, "build-cap") {
        Ok(d) => d,
        Err(e) => {
            return CapabilityResolution {
                capability_id,
                events: vec![],
                error: Some(format!("spawn failed: {e}")),
                usage: TurnUsage::default(),
            }
        }
    };
    if let Err(e) = driver.write_stdin_line(prompt.as_bytes()).await {
        driver.kill().await;
        return CapabilityResolution {
            capability_id,
            events: vec![],
            error: Some(format!("write failed: {e}")),
            usage: TurnUsage::default(),
        };
    }
    driver.close_stdin().await;

    let mut raw_events: Vec<BuildEvent> = Vec::new();
    let mut usage = TurnUsage::default();
    if let Some(mut reader) = driver.take_stdout_reader() {
        loop {
            match read_line_limited(&mut reader).await {
                Ok(Some(line)) => {
                    if let Some(u) = super::parser::extract_result_usage(&line) {
                        usage.add(TurnUsage {
                            cost_usd: u.cost_usd,
                            input_tokens: u.input_tokens,
                            output_tokens: u.output_tokens,
                        });
                    }
                    raw_events.extend(parse_build_line(&line, &session_id));
                }
                Ok(None) | Err(_) => break,
            }
        }
    }
    let _ = driver.finish().await;

    // Keep only THIS capability's resolution events; stamp the lane.
    let mut events = Vec::new();
    for mut ev in raw_events {
        if let BuildEvent::CapabilityResolutionUpdate {
            capability_id: cid,
            lane,
            ..
        } = &mut ev
        {
            if *cid == capability_id {
                *lane = Some(lane_id.clone());
                events.push(ev);
            }
        }
    }
    tracing::info!(cap = %capability_id, events = events.len(), cost = usage.cost_usd, "fan-out lane: done");
    CapabilityResolution {
        capability_id,
        events,
        error: None,
        usage,
    }
}

/// Fan out per-capability resolution across `capabilities`, at most
/// `max_parallel` concurrent (via `orchestrator::run_lanes`). Each capability
/// resolves in its own CLI conversation. Results come back one per capability,
/// in input order.
pub async fn fan_out_resolution(
    cli_args: CliArgs,
    session_id: String,
    behavior_core: Value,
    capabilities: Vec<Value>,
    connector_context: String,
    max_parallel: usize,
) -> Vec<CapabilityResolution> {
    let tasks: Vec<LaneTask<CapabilityResolution>> = capabilities
        .into_iter()
        .filter_map(|cap| {
            let cap_id = cap.get("id").and_then(|v| v.as_str())?.to_string();
            let prompt = build_capability_prompt(&behavior_core, &cap, &connector_context);
            let args = cli_args.clone();
            let sid = session_id.clone();
            let cid = cap_id.clone();
            Some(lane(
                cap_id,
                resolve_one_capability(args, prompt, sid, cid),
            ))
        })
        .collect();

    run_lanes(max_parallel, tasks)
        .await
        .into_iter()
        .map(|o| match o.result {
            Ok(res) => res,
            // A lane that panicked (should not happen — errors are captured on
            // the struct) surfaces here as an error-only resolution.
            Err(e) => CapabilityResolution {
                capability_id: o.lane,
                events: vec![],
                error: Some(e),
                usage: TurnUsage::default(),
            },
        })
        .collect()
}

/// Cost/token usage summed from a run's stream-json `result` lines.
#[derive(Default, Clone, Copy)]
pub struct TurnUsage {
    pub cost_usd: f64,
    pub input_tokens: i64,
    pub output_tokens: i64,
}

impl TurnUsage {
    fn add(&mut self, other: TurnUsage) {
        self.cost_usd += other.cost_usd;
        self.input_tokens += other.input_tokens;
        self.output_tokens += other.output_tokens;
    }
}

/// Run one serial CLI turn in the shared session dir, returning the parsed
/// events + the turn's CLI usage. `continue_session` adds `--continue` so the
/// assembly turn resumes the head turn's conversation (behavior_core + enum).
async fn run_cli_turn(
    cli_args: &CliArgs,
    exec_dir: &Path,
    prompt: &[u8],
    session_id: &str,
    continue_session: bool,
) -> Result<(Vec<BuildEvent>, TurnUsage), String> {
    let mut args = cli_args.clone();
    if continue_session {
        args.args.push("--continue".to_string());
    }
    let mut driver = CliProcessDriver::spawn(&args, exec_dir.to_path_buf())
        .map_err(|e| format!("spawn failed: {e}"))?;
    driver
        .write_stdin_line(prompt)
        .await
        .map_err(|e| format!("write failed: {e}"))?;
    driver.close_stdin().await;
    let mut events = Vec::new();
    let mut usage = TurnUsage::default();
    if let Some(mut reader) = driver.take_stdout_reader() {
        loop {
            match read_line_limited(&mut reader).await {
                Ok(Some(line)) => {
                    if let Some(u) = super::parser::extract_result_usage(&line) {
                        usage.add(TurnUsage {
                            cost_usd: u.cost_usd,
                            input_tokens: u.input_tokens,
                            output_tokens: u.output_tokens,
                        });
                    }
                    events.extend(parse_build_line(&line, session_id));
                }
                Ok(None) | Err(_) => break,
            }
        }
    }
    let _ = driver.wait().await;
    Ok((events, usage))
}

/// Pull the capability list out of a `capability_enumeration` payload, tolerant
/// of the shapes the LLM emits (a bare array, or `{capabilities|use_cases|...: [..]}`).
fn extract_capabilities(enumeration: &Value) -> Vec<Value> {
    if let Some(arr) = enumeration.as_array() {
        return arr.clone();
    }
    for key in ["capabilities", "use_cases", "useCases", "capability_enumeration"] {
        if let Some(arr) = enumeration.get(key).and_then(|v| v.as_array()) {
            return arr.clone();
        }
    }
    Vec::new()
}

/// Multi-agent one-shot build (build-orchestration Phase 3). Rust-orchestrated:
/// a serial head turn (behavior_core + enumeration), a bounded parallel fan-out
/// of per-capability resolution, then a serial assembly turn (agent_ir). Reuses
/// the existing `oneshot::run_post_draft` back-half for test → promote.
///
/// FIRST DRAFT — the prompt grounding + merge/assembly need live iteration.
/// Called only when `multiagent && one_shot`; the sequential path is untouched.
#[allow(clippy::too_many_arguments)]
pub async fn run_multiagent_oneshot(
    pool: DbPool,
    app_handle: tauri::AppHandle,
    channel: Channel<Value>,
    session_id: String,
    persona_id: String,
    cli_args: CliArgs,
    exec_dir: PathBuf,
    initial_prompt: Arc<str>,
    connector_context: String,
    max_parallel: usize,
    cancel_flag: Arc<AtomicBool>,
    registry: Arc<ActiveProcessRegistry>,
) -> Result<(), String> {
    let emit = |ev: &BuildEvent| {
        let _ = super::events::dual_emit(&pool, &channel, &app_handle, ev);
    };

    // ── 1. Head turn: behavior_core + capability_enumeration only ──────────
    let _ = super::events::update_phase(&pool, &session_id, BuildPhase::Analyzing);
    let head_prompt = format!(
        "{initial}\n\n## THIS TURN ONLY\n\
         Emit ONLY the behavior_core event, then the capability_enumeration event, \
         then STOP. Do NOT resolve capability fields (no capability_resolution), do NOT \
         emit persona_resolution, and do NOT emit agent_ir — those happen in later steps. \
         Output raw JSON only, one event per line.",
        initial = initial_prompt,
    );
    let (head, head_usage) =
        run_cli_turn(&cli_args, &exec_dir, head_prompt.as_bytes(), &session_id, false).await?;
    for ev in &head {
        emit(ev);
    }
    if cancel_flag.load(std::sync::atomic::Ordering::Acquire) {
        return Err("cancelled".to_string());
    }

    let behavior_core = head
        .iter()
        .find_map(|e| match e {
            BuildEvent::BehaviorCoreUpdate { data, .. } => Some(data.clone()),
            _ => None,
        })
        .unwrap_or_else(|| serde_json::json!({}));
    let capabilities = head
        .iter()
        .find_map(|e| match e {
            BuildEvent::CapabilityEnumerationUpdate { data, .. } => Some(extract_capabilities(data)),
            _ => None,
        })
        .unwrap_or_default();
    if capabilities.is_empty() {
        return Err("head turn produced no capability_enumeration".to_string());
    }
    tracing::info!(
        session_id = %session_id,
        caps = capabilities.len(),
        "multiagent: enumerated capabilities, fanning out resolution"
    );

    // ── 2. Fan-out: resolve each capability in parallel ────────────────────
    let _ = super::events::update_phase(&pool, &session_id, BuildPhase::Resolving);
    let resolutions = fan_out_resolution(
        cli_args.clone(),
        session_id.clone(),
        behavior_core,
        capabilities,
        connector_context,
        max_parallel,
    )
    .await;

    let mut injection_lines: Vec<String> = Vec::new();
    let mut total_usage = head_usage;
    for res in &resolutions {
        total_usage.add(res.usage);
        for ev in &res.events {
            emit(ev);
            if let BuildEvent::CapabilityResolutionUpdate {
                capability_id,
                field,
                value,
                ..
            } = ev
            {
                injection_lines.push(format!(
                    "{{\"id\":\"{capability_id}\",\"field\":\"{field}\",\"value\":{value}}}"
                ));
            }
        }
        if let Some(err) = &res.error {
            tracing::warn!(session_id = %session_id, cap = %res.capability_id, error = %err, "multiagent: lane error");
        }
    }
    let num_turns = 2 + resolutions.len() as i64; // head + N caps + assembly
    if cancel_flag.load(std::sync::atomic::Ordering::Acquire) {
        return Err("cancelled".to_string());
    }

    // ── 3. Assembly turn: emit agent_ir from the merged resolutions ────────
    let assembly_prompt = format!(
        "The capabilities were resolved in parallel. Here are ALL resolved capability fields \
         (one per line):\n{lines}\n\nUsing the behavior_core (already in context) and these \
         resolved capabilities, emit any remaining persona-wide fields (persona_resolution) and \
         then the final agent_ir. Do NOT re-resolve capabilities. Output raw JSON only, one \
         event per line, ending with the agent_ir event.",
        lines = injection_lines.join("\n"),
    );
    // Assembly turn — with ONE recovery retry. The serial path does the same
    // (log: "All N resolved but no agent_ir — sending recovery prompt"): the LLM
    // sometimes finishes resolutions but forgets to emit agent_ir. A hard fail
    // here was the multiagent path's reliability gap; the retry closes it.
    let mut ir: Option<Value> = None;
    for attempt in 0..2u8 {
        let prompt = if attempt == 0 {
            assembly_prompt.clone()
        } else {
            "You did NOT emit the agent_ir event. Emit it NOW as a single JSON line \
             {\"agent_ir\": { ... }} containing the full persona (name, system prompt, tools, \
             connectors, and use_cases with their resolved fields). Output that one line only."
                .to_string()
        };
        let (asm, asm_usage) =
            run_cli_turn(&cli_args, &exec_dir, prompt.as_bytes(), &session_id, true).await?;
        total_usage.add(asm_usage);
        for ev in &asm {
            emit(ev);
        }
        ir = asm.iter().find_map(|e| match e {
            BuildEvent::CellUpdate { cell_key, data, .. } if cell_key == "agent_ir" => {
                Some(data.clone())
            }
            _ => None,
        });
        if ir.is_some() {
            break;
        }
        tracing::warn!(session_id = %session_id, attempt, "multiagent: assembly produced no agent_ir; retrying");
    }

    // Telemetry: persist total CLI cost/tokens (head + all fan-out lanes + assembly).
    super::events::record_build_usage(
        &pool,
        &session_id,
        total_usage.cost_usd,
        total_usage.input_tokens,
        total_usage.output_tokens,
        num_turns,
    );

    let ir_str = match ir {
        Some(v) => serde_json::to_string(&v).map_err(|e| format!("serialize agent_ir: {e}"))?,
        None => return Err("assembly produced no agent_ir after retry".to_string()),
    };

    // ── 4. Save agent_ir + DraftReady, then hand to the oneshot back-half ──
    build_session_repo::update(
        &pool,
        &session_id,
        &UpdateBuildSession {
            agent_ir: Some(Some(ir_str)),
            phase: Some(BuildPhase::DraftReady.as_str().to_string()),
            ..Default::default()
        },
    )
    .map_err(|e| format!("save agent_ir: {e}"))?;

    super::oneshot::run_post_draft(app_handle.clone(), session_id, persona_id, cancel_flag, registry)
        .await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn prompt_is_scoped_to_one_capability() {
        let core = json!({ "mission": "Summarize the web", "voice": "concise" });
        let cap = json!({ "id": "uc_summarize_url", "title": "Summarize a URL", "summary": "Fetch + summarize a page" });
        let p = build_capability_prompt(&core, &cap, "WebSearch, WebFetch (native, no credential)");
        // Targets exactly this capability id, in the required event shape.
        assert!(p.contains("uc_summarize_url"), "prompt must name the capability id");
        assert!(p.contains("capability_resolution"), "prompt must ask for capability_resolution events");
        assert!(p.contains("ONLY this one"), "prompt must scope to a single capability");
        // Grounds the sub-agent in the persona identity + connectors.
        assert!(p.contains("Summarize the web"), "prompt must inject behavior_core");
        assert!(p.contains("WebFetch"), "prompt must inject connector context");
        // Suppresses the things a sub-agent must not do.
        assert!(p.contains("do NOT") || p.contains("Do NOT") || p.contains("DO NOT"));
    }

    #[test]
    fn prompt_handles_missing_id_without_panicking() {
        let p = build_capability_prompt(&json!({}), &json!({ "title": "x" }), "");
        assert!(p.contains("capability_resolution"));
    }
}
