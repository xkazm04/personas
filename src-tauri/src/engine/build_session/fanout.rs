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
    siblings: &str,
) -> String {
    let cap_id = capability.get("id").and_then(|v| v.as_str()).unwrap_or("");
    format!(
        "You are resolving ONE capability of an AI persona that is already defined. \
         The persona's identity and its full capability list are fixed — your job is \
         only to flesh out the single capability below.\n\n\
         ## Persona identity (behavior_core)\n{core}\n\n\
         ## The capability to resolve (resolve ONLY this one)\n{cap}\n\n\
         ## The persona's OTHER capabilities (owned by separate resolvers — do NOT \
         resolve or re-implement these; they are listed so you know what is NOT your job)\n{siblings}\n\n\
         ## Available connectors\n{conn}\n\n\
         ## SCOPE RULES (critical — the fan-out resolves each capability in isolation)\n\
         - Resolve ONLY the single capability `{id}`. Its `tool_hints` and `connectors` \
         must serve THIS capability's own job — not a job owned by one of the other \
         capabilities above (e.g. if another capability logs to Airtable or publishes to \
         Notion, do NOT add those write tools/connectors here).\n\
         - Bind a `connectors` value ONLY from the Available connectors list above, and \
         ONLY when THIS capability itself calls that connector. Do NOT invent connectors \
         that aren't listed (no email/gmail/messaging/database/vector-store unless this \
         capability's own job genuinely requires it AND it appears in the list). Prefer \
         native tools; when in doubt, bind fewer connectors, not more.\n\n\
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
        siblings = siblings,
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
    // Summarise the sibling capabilities (id: title) so each isolated sub-agent
    // knows which jobs belong to OTHER capabilities and won't re-implement them
    // or over-bind connectors for them (the fan-out scope-creep failure mode).
    let siblings = capabilities
        .iter()
        .filter_map(|c| {
            let id = c.get("id").and_then(|v| v.as_str())?;
            let title = c
                .get("title")
                .and_then(|v| v.as_str())
                .or_else(|| c.get("summary").and_then(|v| v.as_str()))
                .or_else(|| c.get("description").and_then(|v| v.as_str()))
                .unwrap_or("");
            Some(format!("- {id}: {title}"))
        })
        .collect::<Vec<_>>()
        .join("\n");
    let tasks: Vec<LaneTask<CapabilityResolution>> = capabilities
        .into_iter()
        .filter_map(|cap| {
            let cap_id = cap.get("id").and_then(|v| v.as_str())?.to_string();
            let prompt =
                build_capability_prompt(&behavior_core, &cap, &connector_context, &siblings);
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

/// Persona-wide prose generation (agent_ir Rust-assembly optimization). Runs IN
/// PARALLEL with the capability fan-out — it needs only behavior_core +
/// enumeration, not the resolutions. Produces `{name, system_prompt,
/// structured_prompt}`, which Rust folds into the assembled agent_ir. Moving
/// this off the serial assembly turn is the speedup.
fn build_persona_wide_prompt(behavior_core: &Value, capabilities: &[Value]) -> String {
    let caps_brief: Vec<Value> = capabilities
        .iter()
        .map(|c| {
            serde_json::json!({
                "id": c.get("id"),
                "title": c.get("title"),
                "summary": c.get("summary").or_else(|| c.get("goal")).or_else(|| c.get("description")),
            })
        })
        .collect();
    format!(
        "You are writing the TOP-LEVEL prompt for an AI persona whose identity and \
         capability list are already decided. Do NOT re-resolve capabilities.\n\n\
         ## Identity (behavior_core)\n{core}\n\n\
         ## Capabilities (already enumerated)\n{caps}\n\n\
         Emit EXACTLY one JSON line and NOTHING else:\n\
         {{\"persona_wide\": {{\"name\": \"<2-4 word persona name>\", \"system_prompt\": \
         \"<the full system prompt: role, how it operates across its capabilities, its \
         constraints and voice>\", \"structured_prompt\": {{\"identity\": \"...\", \
         \"instructions\": \"...\", \"toolGuidance\": \"...\", \"examples\": \"...\", \
         \"errorHandling\": \"...\"}}}}}}",
        core = serde_json::to_string_pretty(behavior_core).unwrap_or_default(),
        caps = serde_json::to_string_pretty(&caps_brief).unwrap_or_default(),
    )
}

/// Extract a `persona_wide` object from a CLI stream-json line (assistant/result
/// envelope OR raw), tolerant of markdown fences.
fn extract_persona_wide(line: &str) -> Option<Value> {
    let json: Value = serde_json::from_str(line.trim()).ok()?;
    let text = json
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
        .and_then(|a| a.iter().find_map(|it| it.get("text").and_then(|t| t.as_str())))
        .or_else(|| json.get("result").and_then(|r| r.as_str()));
    if let Some(text) = text {
        let cleaned = text.replace("```json", "").replace("```", "");
        // Fast path: the model emitted one JSON line as instructed.
        for l in cleaned.lines() {
            if let Ok(v) = serde_json::from_str::<Value>(l.trim()) {
                if let Some(pw) = v.get("persona_wide") {
                    return Some(pw.clone());
                }
            }
        }
        // Fallback: pretty-printed / multi-line — parse the whole blob, or slice
        // the balanced-brace object that starts at the `persona_wide` wrapper.
        if let Ok(v) = serde_json::from_str::<Value>(cleaned.trim()) {
            if let Some(pw) = v.get("persona_wide") {
                return Some(pw.clone());
            }
        }
        if let Some(idx) = cleaned.find("\"persona_wide\"") {
            let start = cleaned[..idx].rfind('{')?;
            let mut depth = 0i32;
            for (off, ch) in cleaned[start..].char_indices() {
                match ch {
                    '{' => depth += 1,
                    '}' => {
                        depth -= 1;
                        if depth == 0 {
                            let slice = &cleaned[start..start + off + ch.len_utf8()];
                            if let Ok(v) = serde_json::from_str::<Value>(slice) {
                                return v.get("persona_wide").cloned();
                            }
                            break;
                        }
                    }
                    _ => {}
                }
            }
        }
        return None;
    }
    json.get("persona_wide").cloned()
}

/// Run the persona-wide prose sub-agent (fresh CLI). Returns the parsed
/// `persona_wide` object (Null if it failed) + usage.
async fn resolve_persona_wide(cli_args: CliArgs, prompt: String) -> (Value, TurnUsage) {
    let mut driver = match CliProcessDriver::spawn_temp(&cli_args, "build-prose") {
        Ok(d) => d,
        Err(_) => return (Value::Null, TurnUsage::default()),
    };
    if driver.write_stdin_line(prompt.as_bytes()).await.is_err() {
        driver.kill().await;
        return (Value::Null, TurnUsage::default());
    }
    driver.close_stdin().await;
    let mut usage = TurnUsage::default();
    let mut found = Value::Null;
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
                    if let Some(pw) = extract_persona_wide(&line) {
                        found = pw;
                    }
                }
                Ok(None) | Err(_) => break,
            }
        }
    }
    let _ = driver.finish().await;
    (found, usage)
}

/// Build the `## Available connectors` block for the fan-out sub-agents from the
/// vault. Without it (`connector_context` was `String::new()` since Phase 3), the
/// per-capability sub-agents can't bind a capability to Airtable/Notion/etc. and
/// resolve connector reactions as native web tools instead. Lists each vault
/// credential by `service_type` (what the sub-agent should emit in `connectors`)
/// plus the connector catalog by category.
fn build_connector_context(pool: &DbPool) -> String {
    use crate::db::repos::resources::connectors as connector_repo;
    use crate::db::repos::resources::credentials as credential_repo;
    let creds = credential_repo::get_all(pool).unwrap_or_default();
    let conns = connector_repo::get_all(pool).unwrap_or_default();
    let mut lines: Vec<String> = Vec::new();
    if !creds.is_empty() {
        lines.push(
            "Bound vault credentials — a capability that writes to / reads from one of \
             these MUST emit a `connectors` field naming its service_type:"
                .to_string(),
        );
        for c in &creds {
            lines.push(format!("- {} (service_type: {})", c.name, c.service_type));
        }
    }
    if !conns.is_empty() {
        lines.push("Connector catalog:".to_string());
        for c in &conns {
            lines.push(format!("- {} (category: {})", c.name, c.category));
        }
    }
    if lines.is_empty() {
        "(no external connectors available — use only native tools)".to_string()
    } else {
        lines.join("\n")
    }
}

/// Flatten a tool-hints value into a plain name list. Accepts a string array
/// (`["WebSearch","WebFetch"]`), an object whose values are name arrays
/// (`{"primary":["WebSearch"],"fallback":["WebFetch"]}` → both), or a bare
/// string. Scalar prose values inside an object (e.g. `"notes":"Use WebFetch…"`)
/// are skipped by the has-space heuristic so only tool tokens survive.
fn coerce_string_list(v: &Value) -> Vec<String> {
    let mut out = Vec::new();
    match v {
        Value::Array(a) => {
            for it in a {
                if let Some(s) = it.as_str() {
                    out.push(s.to_string());
                }
            }
        }
        Value::Object(m) => {
            for val in m.values() {
                match val {
                    Value::Array(a) => {
                        for it in a {
                            if let Some(s) = it.as_str() {
                                out.push(s.to_string());
                            }
                        }
                    }
                    Value::String(s) if !s.contains(' ') => out.push(s.clone()),
                    _ => {}
                }
            }
        }
        Value::String(s) => out.push(s.clone()),
        _ => {}
    }
    out
}

/// Coerce a value to a string for AgentIrUseCaseData's `Option<String>` fields.
/// Strings pass through; objects/arrays are JSON-serialized so their content is
/// preserved as text instead of breaking the untagged-enum parse; null → None.
fn coerce_to_string(v: &Value) -> Option<String> {
    match v {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        other => serde_json::to_string(other).ok(),
    }
}

/// Assemble the `agent_ir` JSON in Rust from behavior_core + the enumerated
/// capabilities + each capability's fan-out resolutions + the persona-wide prose.
/// Replaces the serial assembly LLM turn. Field routing: a capability's
/// `connectors` resolution aggregates into top-level `required_connectors`; its
/// `tool_hints` both stays on the use-case AND aggregates into top-level `tools`
/// (deduped); every other resolved field stays on the use-case. `agent_ir` is
/// `#[serde(default)]` throughout, so partial population is safe.
fn assemble_agent_ir(
    behavior_core: &Value,
    capabilities: &[Value],
    resolutions: &[CapabilityResolution],
    prose: &Value,
) -> Value {
    let mut use_cases: Vec<Value> = Vec::new();
    let mut tool_hints: Vec<String> = Vec::new();
    let mut connectors: Vec<Value> = Vec::new();
    let mut seen_tool = std::collections::HashSet::new();
    let mut seen_conn = std::collections::HashSet::new();

    for cap in capabilities {
        let cap_id = cap.get("id").and_then(|v| v.as_str()).unwrap_or_default();
        let mut uc = serde_json::Map::new();
        uc.insert("id".to_string(), serde_json::json!(cap_id));
        if let Some(t) = cap.get("title") {
            uc.insert("title".to_string(), t.clone());
        }
        if let Some(s) = cap
            .get("summary")
            .or_else(|| cap.get("goal"))
            .or_else(|| cap.get("description"))
        {
            uc.insert("capability_summary".to_string(), s.clone());
        }
        if let Some(res) = resolutions.iter().find(|r| r.capability_id == cap_id) {
            for ev in &res.events {
                if let BuildEvent::CapabilityResolutionUpdate { field, value, .. } = ev {
                    match field.as_str() {
                        "connectors" => {
                            if let Some(arr) = value.as_array() {
                                for c in arr {
                                    let name = c
                                        .as_str()
                                        .map(|s| s.to_string())
                                        .or_else(|| c.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()));
                                    if let Some(n) = name {
                                        if seen_conn.insert(n) {
                                            connectors.push(c.clone());
                                        }
                                    }
                                }
                            }
                        }
                        "tool_hints" => {
                            // AgentIrUseCaseData.tool_hints is Option<Vec<String>>;
                            // resolutions emit it as either a string array OR a
                            // richer object ({primary:[…], notes:"…"}). Flatten to
                            // a plain name list so the untagged-enum parse holds,
                            // and aggregate the same names into top-level tools.
                            let hints = coerce_string_list(value);
                            for s in &hints {
                                if seen_tool.insert(s.clone()) {
                                    tool_hints.push(s.clone());
                                }
                            }
                            uc.insert("tool_hints".to_string(), serde_json::json!(hints));
                        }
                        // AgentIrUseCaseData types these as Option<String>. A
                        // resolution may emit a rich object (e.g. structured
                        // error_handling); JSON-stringify so it can't break the
                        // untagged-enum parse while preserving the guidance text.
                        "error_handling" | "description" | "category" | "execution_mode"
                        | "capability_summary" | "title" | "model_rationale" | "id"
                        | "source_recipe_id" | "source_recipe_version" => {
                            if let Some(s) = coerce_to_string(value) {
                                uc.insert(field.clone(), Value::String(s));
                            }
                        }
                        "enabled" => {
                            if value.is_boolean() {
                                uc.insert("enabled".to_string(), value.clone());
                            }
                        }
                        "event_subscriptions" | "events" => {
                            // AgentIrUseCaseEvent is an object {event_type, source_filter};
                            // resolutions often emit a bare string array
                            // (["finding_vetted", …]). Wrap strings so the parse holds.
                            if let Some(arr) = value.as_array() {
                                let coerced: Vec<Value> = arr
                                    .iter()
                                    .filter_map(|e| match e {
                                        Value::String(s) => {
                                            Some(serde_json::json!({ "event_type": s }))
                                        }
                                        Value::Object(_) => Some(e.clone()),
                                        _ => None,
                                    })
                                    .collect();
                                uc.insert(
                                    "event_subscriptions".to_string(),
                                    Value::Array(coerced),
                                );
                            }
                        }
                        // Every remaining field maps to an Option<Value> on
                        // AgentIrUseCaseData (or is unknown and ignored) — safe
                        // to pass through verbatim.
                        _ => {
                            uc.insert(field.clone(), value.clone());
                        }
                    }
                }
            }
        }
        use_cases.push(Value::Object(uc));
    }

    let tools: Vec<Value> = tool_hints.into_iter().map(|t| serde_json::json!(t)).collect();
    let name = prose
        .get("name")
        .filter(|v| v.is_string())
        .cloned()
        .or_else(|| behavior_core.get("name").cloned())
        .unwrap_or(Value::Null);

    serde_json::json!({
        "name": name,
        "system_prompt": prose.get("system_prompt"),
        "structured_prompt": prose.get("structured_prompt"),
        "behavior_core": behavior_core,
        "tools": tools,
        "required_connectors": connectors,
        "use_cases": use_cases,
    })
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

    // ── 2. Fan-out (per-capability resolution) + persona-wide prose, IN PARALLEL.
    // The prose lane needs only behavior_core + enumeration, so it overlaps the
    // capability lanes instead of running as a serial assembly turn afterward.
    let _ = super::events::update_phase(&pool, &session_id, BuildPhase::Resolving);
    // Populate the sub-agents' connector context from the vault when the caller
    // didn't supply one (runner passes String::new()). This is what lets the
    // fan-out bind connector-driven capabilities instead of falling back to
    // native web tools (build-orchestration Phase 3 follow-up (c)).
    let connector_context = if connector_context.trim().is_empty() {
        build_connector_context(&pool)
    } else {
        connector_context
    };
    let prose_prompt = build_persona_wide_prompt(&behavior_core, &capabilities);
    let (resolutions, (prose, prose_usage)) = tokio::join!(
        fan_out_resolution(
            cli_args.clone(),
            session_id.clone(),
            behavior_core.clone(),
            capabilities.clone(),
            connector_context,
            max_parallel,
        ),
        resolve_persona_wide(cli_args.clone(), prose_prompt),
    );

    let mut total_usage = head_usage;
    total_usage.add(prose_usage);
    for res in &resolutions {
        total_usage.add(res.usage);
        for ev in &res.events {
            emit(ev);
        }
        if let Some(err) = &res.error {
            tracing::warn!(session_id = %session_id, cap = %res.capability_id, error = %err, "multiagent: lane error");
        }
    }
    let num_turns = 2 + resolutions.len() as i64; // head + N cap lanes + prose lane
    if cancel_flag.load(std::sync::atomic::Ordering::Acquire) {
        return Err("cancelled".to_string());
    }

    // ── 3. Assemble agent_ir in Rust (no serial assembly LLM turn) ─────────
    // The persona-wide prose lane ran in parallel above; here Rust folds the
    // prose + each capability's resolutions into the final agent_ir. This
    // replaces the ~224s serial assembly turn that was the remaining bottleneck.
    if prose.is_null() {
        return Err("persona-wide prose lane produced no output".to_string());
    }
    let ir = assemble_agent_ir(&behavior_core, &capabilities, &resolutions, &prose);
    let has_system_prompt = ir
        .get("system_prompt")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().len() >= 40)
        .unwrap_or(false);
    if !has_system_prompt {
        return Err("assembled agent_ir has no usable system_prompt".to_string());
    }
    tracing::info!(
        session_id = %session_id,
        use_cases = capabilities.len(),
        "multiagent: assembled agent_ir in Rust"
    );

    // Telemetry: persist total CLI cost/tokens (head + fan-out lanes + prose lane).
    super::events::record_build_usage(
        &pool,
        &session_id,
        total_usage.cost_usd,
        total_usage.input_tokens,
        total_usage.output_tokens,
        num_turns,
    );

    let ir_str = serde_json::to_string(&ir).map_err(|e| format!("serialize agent_ir: {e}"))?;

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
        let siblings = "- uc_other: Do something else";
        let p = build_capability_prompt(&core, &cap, "WebSearch, WebFetch (native, no credential)", siblings);
        // Targets exactly this capability id, in the required event shape.
        assert!(p.contains("uc_summarize_url"), "prompt must name the capability id");
        assert!(p.contains("capability_resolution"), "prompt must ask for capability_resolution events");
        assert!(p.contains("ONLY this one"), "prompt must scope to a single capability");
        // Grounds the sub-agent in the persona identity + connectors.
        assert!(p.contains("Summarize the web"), "prompt must inject behavior_core");
        assert!(p.contains("WebFetch"), "prompt must inject connector context");
        // Injects the sibling list + scope rules so it won't over-bind for other caps.
        assert!(p.contains("uc_other"), "prompt must list sibling capabilities");
        assert!(p.contains("SCOPE RULES"), "prompt must carry the scope constraints");
        // Suppresses the things a sub-agent must not do.
        assert!(p.contains("do NOT") || p.contains("Do NOT") || p.contains("DO NOT"));
    }

    #[test]
    fn prompt_handles_missing_id_without_panicking() {
        let p = build_capability_prompt(&json!({}), &json!({ "title": "x" }), "", "");
        assert!(p.contains("capability_resolution"));
    }
}
