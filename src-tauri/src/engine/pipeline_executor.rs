//! Pipeline executor — runs a team's pipeline graph node-by-node.
//!
//! Extracted from the monolithic `execute_team` command to separate concerns:
//! - **Scheduling**: topological sort, predecessor map, execution order
//! - **Node runner**: per-node execution + polling loop
//! - **Status emitter**: DB persistence + Tauri event emission
//! - **Memory creator**: auto-creates team memories from node outputs
//! - **Condition evaluator**: conditional branching on connection edges
//! - **Command runner**: deterministic (non-LLM) pipeline nodes
//! - **Approval gates**: pause pipeline for human review

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Deserialize;
use tauri::Emitter;

use crate::db::models::{
    CreateTeamMemoryInput, NodeConfig, PersonaTeamConnection, PersonaTeamMember,
};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::resources::team_memories as team_memories_repo;
use crate::db::repos::resources::teams as team_repo;
use crate::db::DbPool;
use crate::engine::event_registry::event_name;
use crate::engine::ExecutionEngine;
use crate::ActiveProcessRegistry;

// ============================================================================
// Node status helpers
// ============================================================================

/// Update fields on a node status entry identified by `member_id`.
fn update_node_status(
    statuses: &mut [serde_json::Value],
    member_id: &str,
    fields: &[(&str, serde_json::Value)],
) {
    for ns in statuses.iter_mut() {
        if ns.get("member_id").and_then(|v| v.as_str()) == Some(member_id) {
            if let Some(obj) = ns.as_object_mut() {
                for (key, value) in fields {
                    obj.insert((*key).into(), value.clone());
                }
            }
        }
    }
}

// ============================================================================
// Status emitter
// ============================================================================

/// Persists pipeline status to the DB and emits a Tauri event.
struct StatusEmitter<'a> {
    db: &'a DbPool,
    app: &'a tauri::AppHandle,
    run_id: &'a str,
    team_id: &'a str,
}

impl<'a> StatusEmitter<'a> {
    fn emit(
        &self,
        status: &str,
        node_statuses: &[serde_json::Value],
        memories_created: Option<u32>,
    ) {
        let json = serde_json::to_string(node_statuses).unwrap_or_else(|_| "[]".into());
        let _ = team_repo::update_pipeline_run(self.db, self.run_id, status, &json, None);
        let mut payload = serde_json::json!({
            "pipeline_id": self.run_id,
            "team_id": self.team_id,
            "status": status,
            "node_statuses": node_statuses,
        });
        if let Some(count) = memories_created {
            payload["memories_created"] = serde_json::json!(count);
        }
        let _ = self.app.emit(event_name::PIPELINE_STATUS, payload);
    }
}

// ============================================================================
// Scheduling — predecessor map from connections
// ============================================================================

/// Build a map of `target_member_id → [source_member_ids]` from non-feedback edges.
pub fn build_predecessor_map(
    connections: &[PersonaTeamConnection],
) -> HashMap<String, Vec<String>> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for c in connections {
        if c.connection_type != "feedback" {
            map.entry(c.target_member_id.clone())
                .or_default()
                .push(c.source_member_id.clone());
        }
    }
    map
}

// ============================================================================
// Condition evaluator — conditional branching on connection edges
// ============================================================================

/// A simple condition specification for conditional pipeline edges.
#[derive(Debug, Clone, Deserialize)]
struct ConditionSpec {
    field: String,
    op: String,
    value: Option<String>,
}

/// Evaluate a condition JSON against a predecessor node's output.
///
/// Returns `true` if the condition is met (or if the condition is malformed —
/// fail-open is the safe default so pipelines don't break on bad config).
fn evaluate_condition(condition_json: &str, predecessor_output: Option<&str>) -> bool {
    let spec: ConditionSpec = match serde_json::from_str(condition_json) {
        Ok(s) => s,
        Err(_) => return true,
    };
    let output_value = predecessor_output
        .and_then(|o| serde_json::from_str::<serde_json::Value>(o).ok())
        .and_then(|v| v.get(&spec.field).cloned())
        .and_then(|v| match v {
            serde_json::Value::String(s) => Some(s),
            other => Some(other.to_string()),
        });

    match spec.op.as_str() {
        "equals" => output_value.as_deref() == spec.value.as_deref(),
        "not_equals" => output_value.as_deref() != spec.value.as_deref(),
        "contains" => output_value
            .as_deref()
            .map(|v| v.contains(spec.value.as_deref().unwrap_or("")))
            .unwrap_or(false),
        "exists" => output_value.is_some(),
        _ => true,
    }
}

/// Check if a node should be skipped because an incoming conditional edge's
/// condition is not met by its source node's output.
fn should_skip_node(
    member_id: &str,
    connections: &[PersonaTeamConnection],
    node_outputs: &HashMap<String, Option<String>>,
) -> bool {
    connections.iter().any(|c| {
        c.target_member_id == *member_id
            && c.connection_type == "conditional"
            && c.condition.is_some()
            && !evaluate_condition(
                c.condition.as_deref().unwrap(),
                node_outputs
                    .get(&c.source_member_id)
                    .and_then(|o| o.as_deref()),
            )
    })
}

// ============================================================================
// Memory creator
// ============================================================================

/// Auto-create a team memory from a completed node's output.
/// Returns `true` if a memory was successfully created.
fn create_node_memory(
    db: &DbPool,
    team_id: &str,
    run_id: &str,
    member_id: &str,
    persona_id: &str,
    persona_name: &str,
    output_text: &str,
) -> bool {
    let truncated = if output_text.len() > 500 {
        format!("{}...", &output_text[..500])
    } else {
        output_text.to_string()
    };
    team_memories_repo::create(
        db,
        CreateTeamMemoryInput {
            team_id: team_id.to_string(),
            run_id: Some(run_id.to_string()),
            member_id: Some(member_id.to_string()),
            persona_id: Some(persona_id.to_string()),
            title: format!("{} output (run {})", persona_name, &run_id[..8]),
            content: truncated,
            category: Some("observation".into()),
            importance: Some(3),
            tags: Some(format!("auto,run:{}", &run_id[..8])),
        },
    )
    .is_ok()
}

// ============================================================================
// Parse node config helper
// ============================================================================

fn parse_node_config(member: &PersonaTeamMember) -> NodeConfig {
    member
        .config
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default()
}

// ============================================================================
// Node runner — execute a single node and poll until completion
// ============================================================================

/// Outcome of running a single pipeline node.
enum NodeOutcome {
    /// Node completed successfully with optional output.
    Completed(Option<String>),
    /// Node failed (or was cancelled). If `cancelled` is true the whole
    /// pipeline was cancelled by the user.
    Failed { cancelled: bool },
}

/// Execute a single node — dispatches to persona (LLM) or command (deterministic).
#[allow(clippy::ptr_arg)]
async fn run_node(
    db: &DbPool,
    engine: &ExecutionEngine,
    app: &tauri::AppHandle,
    member: &PersonaTeamMember,
    node_config: &NodeConfig,
    resolved_input: Option<serde_json::Value>,
    cancelled: &Arc<AtomicBool>,
    statuses: &mut Vec<serde_json::Value>,
) -> NodeOutcome {
    match node_config.node_type.as_deref().unwrap_or("persona") {
        "command" => {
            run_command_node(node_config, member, resolved_input, cancelled, statuses).await
        }
        _ => {
            run_persona_node(
                db,
                engine,
                app,
                member,
                node_config,
                resolved_input,
                cancelled,
                statuses,
            )
            .await
        }
    }
}

/// Run a persona (LLM) node — the original execution path.
async fn run_persona_node(
    db: &DbPool,
    engine: &ExecutionEngine,
    app: &tauri::AppHandle,
    member: &PersonaTeamMember,
    node_config: &NodeConfig,
    resolved_input: Option<serde_json::Value>,
    cancelled: &Arc<AtomicBool>,
    statuses: &mut Vec<serde_json::Value>,
) -> NodeOutcome {
    // Load persona + tools
    let persona = match persona_repo::get_by_id(db, &member.persona_id) {
        Ok(p) => p,
        Err(_) => {
            update_node_status(statuses, &member.id, &[
                ("status", serde_json::json!("failed")),
                ("error", serde_json::json!("Persona not found")),
            ]);
            return NodeOutcome::Failed { cancelled: false };
        }
    };

    // Apply model profile override if configured
    let mut persona = persona;
    if let Some(ref override_profile) = node_config.model_profile_override {
        persona.model_profile = Some(override_profile.clone());
    }

    let tools = crate::db::repos::resources::tools::get_tools_for_persona(db, &member.persona_id)
        .unwrap_or_default();

    // Create execution record
    let exec = match exec_repo::create(
        db,
        &member.persona_id,
        None,
        resolved_input.as_ref().map(|v| v.to_string()),
        None,
        None,
    ) {
        Ok(e) => e,
        Err(_) => {
            update_node_status(statuses, &member.id, &[
                ("status", serde_json::json!("failed")),
                ("error", serde_json::json!("Failed to create execution")),
            ]);
            return NodeOutcome::Failed { cancelled: false };
        }
    };

    // Attach execution_id to node status
    update_node_status(statuses, &member.id, &[
        ("execution_id", serde_json::json!(exec.id)),
    ]);

    // Start execution
    if let Err(e) = engine
        .start_execution(
            app.clone(),
            db.clone(),
            exec.id.clone(),
            persona,
            tools,
            resolved_input,
            None,
        )
        .await
    {
        update_node_status(statuses, &member.id, &[
            ("status", serde_json::json!("failed")),
            ("error", serde_json::json!(format!("{}", e))),
        ]);
        return NodeOutcome::Failed { cancelled: false };
    }

    // Poll for completion (up to 600s)
    for _ in 0..600 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        // Check cancellation
        if cancelled.load(Ordering::Relaxed) {
            let persona_id = Some(member.persona_id.clone());
            let _ = engine
                .cancel_execution(&exec.id, db, persona_id.as_deref())
                .await;
            update_node_status(statuses, &member.id, &[
                ("status", serde_json::json!("cancelled")),
                ("error", serde_json::json!("Pipeline cancelled by user")),
            ]);
            return NodeOutcome::Failed { cancelled: true };
        }

        if let Ok(execution) = exec_repo::get_by_id(db, &exec.id) {
            match execution.status.as_str() {
                "completed" => {
                    update_node_status(statuses, &member.id, &[
                        ("status", serde_json::json!("completed")),
                        ("output", serde_json::json!(execution.output_data)),
                    ]);
                    return NodeOutcome::Completed(execution.output_data.clone());
                }
                "failed" | "cancelled" => {
                    update_node_status(statuses, &member.id, &[
                        ("status", serde_json::json!("failed")),
                        ("error", serde_json::json!(execution.error_message)),
                    ]);
                    return NodeOutcome::Failed { cancelled: false };
                }
                _ => {}
            }
        }
    }

    // Timed out
    update_node_status(statuses, &member.id, &[
        ("status", serde_json::json!("failed")),
        ("error", serde_json::json!("Execution timed out")),
    ]);
    NodeOutcome::Failed { cancelled: false }
}

/// Run a deterministic command node — executes a shell command, no LLM involved.
async fn run_command_node(
    config: &NodeConfig,
    member: &PersonaTeamMember,
    input: Option<serde_json::Value>,
    cancelled: &Arc<AtomicBool>,
    statuses: &mut Vec<serde_json::Value>,
) -> NodeOutcome {
    let cmd = match &config.command {
        Some(c) => c.clone(),
        None => {
            update_node_status(statuses, &member.id, &[
                ("status", serde_json::json!("failed")),
                (
                    "error",
                    serde_json::json!("Command node missing 'command' field in config"),
                ),
            ]);
            return NodeOutcome::Failed { cancelled: false };
        }
    };

    // Check cancellation before starting
    if cancelled.load(Ordering::Relaxed) {
        update_node_status(statuses, &member.id, &[
            ("status", serde_json::json!("cancelled")),
            ("error", serde_json::json!("Pipeline cancelled by user")),
        ]);
        return NodeOutcome::Failed { cancelled: true };
    }

    let mut command = if cfg!(target_os = "windows") {
        let mut c = tokio::process::Command::new("cmd");
        c.args(["/C", &cmd]);
        c
    } else {
        let mut c = tokio::process::Command::new("sh");
        c.args(["-c", &cmd]);
        c
    };

    // Inject predecessor output as PIPELINE_INPUT env var
    if let Some(ref input_val) = input {
        command.env("PIPELINE_INPUT", input_val.to_string());
    }

    let output = match command.output().await {
        Ok(o) => o,
        Err(e) => {
            update_node_status(statuses, &member.id, &[
                ("status", serde_json::json!("failed")),
                (
                    "error",
                    serde_json::json!(format!("Command failed to start: {}", e)),
                ),
            ]);
            return NodeOutcome::Failed { cancelled: false };
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if output.status.success() {
        update_node_status(statuses, &member.id, &[
            ("status", serde_json::json!("completed")),
            ("output", serde_json::json!(stdout)),
        ]);
        NodeOutcome::Completed(Some(stdout))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        update_node_status(statuses, &member.id, &[
            ("status", serde_json::json!("failed")),
            (
                "error",
                serde_json::json!(format!(
                    "Exit code {}: {}",
                    output.status, stderr
                )),
            ),
        ]);
        NodeOutcome::Failed { cancelled: false }
    }
}

// ============================================================================
// Approval gate — pause pipeline for human review
// ============================================================================

/// Poll for human approval of a pipeline node.
///
/// Uses the `ActiveProcessRegistry` with domain `"pipeline_approval"` and a
/// composite key of `"{run_id}:{member_id}"`. The approval flag starts `false`;
/// calling `approve_pipeline_node` sets it to `true` via `cancel_run`.
///
/// Returns `true` if approved, `false` if the pipeline was cancelled or timed out.
async fn poll_for_approval(
    registry: &ActiveProcessRegistry,
    run_id: &str,
    member_id: &str,
    cancelled: &Arc<AtomicBool>,
) -> bool {
    let approval_key = format!("{}:{}", run_id, member_id);
    let flag = registry.register_run("pipeline_approval", &approval_key);

    // Poll up to 1 hour (3600 seconds)
    for _ in 0..3600 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        // Check if pipeline was cancelled
        if cancelled.load(Ordering::Relaxed) {
            registry.unregister_run("pipeline_approval", &approval_key);
            return false;
        }

        // Check if approval was granted (flag set to true)
        if flag.load(Ordering::Relaxed) {
            registry.unregister_run("pipeline_approval", &approval_key);
            return true;
        }
    }

    // Timed out — clean up
    registry.unregister_run("pipeline_approval", &approval_key);
    false
}

// ============================================================================
// Pipeline runner — orchestrate all nodes
// ============================================================================

/// All data needed to run a pipeline, gathered before spawning the async task.
pub struct PipelineContext {
    pub db: DbPool,
    pub engine: Arc<ExecutionEngine>,
    pub app: tauri::AppHandle,
    pub run_id: String,
    pub team_id: String,
    pub input_data: Option<String>,
    pub members: Vec<PersonaTeamMember>,
    pub connections: Vec<PersonaTeamConnection>,
    pub execution_order: Vec<String>,
    pub initial_node_statuses: Vec<serde_json::Value>,
    pub cancelled: Arc<AtomicBool>,
    pub process_registry: Arc<ActiveProcessRegistry>,
}

/// Run the full pipeline. This is the async task body that `execute_team`
/// spawns via `tokio::spawn`.
pub async fn run_pipeline(ctx: PipelineContext) {
    let predecessor_map = build_predecessor_map(&ctx.connections);
    let emitter = StatusEmitter {
        db: &ctx.db,
        app: &ctx.app,
        run_id: &ctx.run_id,
        team_id: &ctx.team_id,
    };

    let mut node_outputs: HashMap<String, Option<String>> = HashMap::new();
    let mut statuses = ctx.initial_node_statuses.clone();
    let mut has_failure = false;
    let mut memories_created: u32 = 0;

    for member_id in &ctx.execution_order {
        let member = match ctx.members.iter().find(|m| &m.id == member_id) {
            Some(m) => m,
            None => continue,
        };

        let node_config = parse_node_config(member);

        // ── Conditional branching ────────────────────────────────────
        // Skip this node if an incoming conditional edge's condition is not
        // met by the source node's output.
        if should_skip_node(member_id, &ctx.connections, &node_outputs) {
            update_node_status(&mut statuses, member_id, &[
                ("status", serde_json::json!("skipped")),
                (
                    "skip_reason",
                    serde_json::json!("condition_not_met"),
                ),
            ]);
            emitter.emit("running", &statuses, Some(memories_created));
            continue;
        }

        // ── Approval gate ────────────────────────────────────────────
        // If this node requires human approval, pause and wait.
        if node_config.approval_gate.unwrap_or(false) {
            let persona_name = persona_repo::get_by_id(&ctx.db, &member.persona_id)
                .map(|p| p.name.clone())
                .unwrap_or_else(|_| "Unknown".into());

            // Find last predecessor output for context
            let pred_output = predecessor_map
                .get(member_id)
                .and_then(|preds| {
                    preds
                        .iter()
                        .rev()
                        .find_map(|pid| node_outputs.get(pid).and_then(|o| o.clone()))
                });

            // Emit approval-needed event
            let _ = ctx.app.emit(
                event_name::PIPELINE_APPROVAL_NEEDED,
                serde_json::json!({
                    "run_id": ctx.run_id,
                    "team_id": ctx.team_id,
                    "member_id": member_id,
                    "persona_name": persona_name,
                    "predecessor_output": pred_output,
                }),
            );

            update_node_status(&mut statuses, member_id, &[
                ("status", serde_json::json!("awaiting_approval")),
            ]);
            emitter.emit("awaiting_approval", &statuses, Some(memories_created));

            let approved = poll_for_approval(
                &ctx.process_registry,
                &ctx.run_id,
                member_id,
                &ctx.cancelled,
            )
            .await;

            if !approved {
                let reason = if ctx.cancelled.load(Ordering::Relaxed) {
                    "Pipeline cancelled by user"
                } else {
                    "Approval timed out (1 hour)"
                };
                update_node_status(&mut statuses, member_id, &[
                    ("status", serde_json::json!("rejected")),
                    ("error", serde_json::json!(reason)),
                ]);
                has_failure = true;
                emitter.emit("running", &statuses, Some(memories_created));
                break;
            }
        }

        // Mark node running
        update_node_status(&mut statuses, member_id, &[
            ("status", serde_json::json!("running")),
        ]);
        emitter.emit("running", &statuses, None);

        // Resolve input: predecessor output(s) or pipeline-level input_data
        let resolved_input = resolve_node_input(
            &predecessor_map,
            member_id,
            &node_outputs,
            &ctx.input_data,
        );

        // Load team memories for context injection
        let memory_context = load_memory_context(&ctx.db, &ctx.team_id);

        // Build the JSON input payload
        let node_input = build_node_input(
            resolved_input.as_deref(),
            &ctx.run_id,
            member_id,
            &member.role,
            memory_context.as_deref(),
        );

        // Execute the node
        let persona_name = persona_repo::get_by_id(&ctx.db, &member.persona_id)
            .map(|p| p.name.clone())
            .unwrap_or_default();

        match run_node(
            &ctx.db,
            &ctx.engine,
            &ctx.app,
            member,
            &node_config,
            node_input,
            &ctx.cancelled,
            &mut statuses,
        )
        .await
        {
            NodeOutcome::Completed(output) => {
                // Auto-create team memory
                if let Some(ref text) = output {
                    if create_node_memory(
                        &ctx.db,
                        &ctx.team_id,
                        &ctx.run_id,
                        member_id,
                        &member.persona_id,
                        &persona_name,
                        text,
                    ) {
                        memories_created += 1;
                    }
                }
                node_outputs.insert(member_id.clone(), output);
            }
            NodeOutcome::Failed { cancelled } => {
                has_failure = true;
                if cancelled {
                    break;
                }
            }
        }

        // Emit updated status
        emitter.emit("running", &statuses, Some(memories_created));

        if has_failure {
            break;
        }
    }

    // Mark remaining idle nodes as skipped/cancelled
    let was_cancelled = ctx.cancelled.load(Ordering::Relaxed);
    let skip_label = if was_cancelled {
        "cancelled"
    } else if has_failure {
        "skipped"
    } else {
        ""
    };
    if !skip_label.is_empty() {
        for ns in statuses.iter_mut() {
            if ns.get("status").and_then(|v| v.as_str()) == Some("idle") {
                if let Some(obj) = ns.as_object_mut() {
                    obj.insert("status".into(), serde_json::json!(skip_label));
                }
            }
        }
    }

    // Finalize
    let final_status = if was_cancelled {
        "cancelled"
    } else if has_failure {
        "failed"
    } else {
        "completed"
    };
    emitter.emit(final_status, &statuses, Some(memories_created));

    // Evict excess auto-generated memories
    if memories_created > 0 {
        if let Err(e) = team_memories_repo::evict_excess(&ctx.db, &ctx.team_id, None) {
            tracing::warn!(
                team_id = %ctx.team_id,
                error = %e,
                "Failed to evict excess team memories",
            );
        }
    }
}

// ============================================================================
// Input resolution helpers
// ============================================================================

/// Resolve input for a node: use predecessor output if available, else pipeline input.
fn resolve_node_input(
    predecessor_map: &HashMap<String, Vec<String>>,
    member_id: &str,
    node_outputs: &HashMap<String, Option<String>>,
    pipeline_input: &Option<String>,
) -> Option<String> {
    if let Some(preds) = predecessor_map.get(member_id) {
        preds
            .iter()
            .rev()
            .find_map(|pid| node_outputs.get(pid).and_then(|o| o.clone()))
            .or_else(|| pipeline_input.clone())
    } else {
        pipeline_input.clone()
    }
}

/// Load top team memories and format as context string.
fn load_memory_context(db: &DbPool, team_id: &str) -> Option<String> {
    let team_memories = team_memories_repo::get_for_injection(db, team_id, 20)
        .unwrap_or_default();
    if team_memories.is_empty() {
        return None;
    }
    let entries: Vec<String> = team_memories
        .iter()
        .map(|m| format!("- [{}] {}: {}", m.category, m.title, m.content))
        .collect();
    Some(format!(
        "## Team Memory Context\nShared memories from past runs:\n{}",
        entries.join("\n"),
    ))
}

/// Build the JSON input payload for a pipeline node.
fn build_node_input(
    resolved_input: Option<&str>,
    run_id: &str,
    member_id: &str,
    role: &str,
    memory_context: Option<&str>,
) -> Option<serde_json::Value> {
    resolved_input.map(|output| {
        let mut obj = serde_json::json!({
            "pipeline_input": output,
            "pipeline_context": {
                "run_id": run_id,
                "member_id": member_id,
                "role": role,
            }
        });
        if let Some(ctx) = memory_context {
            obj["team_memory_context"] = serde_json::json!(ctx);
        }
        obj
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_evaluate_condition_equals_match() {
        let cond = r#"{"field":"type","op":"equals","value":"bug"}"#;
        let output = r#"{"type":"bug","detail":"crash on startup"}"#;
        assert!(evaluate_condition(cond, Some(output)));
    }

    #[test]
    fn test_evaluate_condition_equals_no_match() {
        let cond = r#"{"field":"type","op":"equals","value":"bug"}"#;
        let output = r#"{"type":"feature","detail":"add button"}"#;
        assert!(!evaluate_condition(cond, Some(output)));
    }

    #[test]
    fn test_evaluate_condition_not_equals() {
        let cond = r#"{"field":"type","op":"not_equals","value":"bug"}"#;
        let output = r#"{"type":"feature"}"#;
        assert!(evaluate_condition(cond, Some(output)));
    }

    #[test]
    fn test_evaluate_condition_contains() {
        let cond = r#"{"field":"summary","op":"contains","value":"crash"}"#;
        let output = r#"{"summary":"app crash on login"}"#;
        assert!(evaluate_condition(cond, Some(output)));
    }

    #[test]
    fn test_evaluate_condition_contains_no_match() {
        let cond = r#"{"field":"summary","op":"contains","value":"crash"}"#;
        let output = r#"{"summary":"slow performance"}"#;
        assert!(!evaluate_condition(cond, Some(output)));
    }

    #[test]
    fn test_evaluate_condition_exists() {
        let cond = r#"{"field":"error","op":"exists"}"#;
        let output = r#"{"error":"something broke"}"#;
        assert!(evaluate_condition(cond, Some(output)));
    }

    #[test]
    fn test_evaluate_condition_exists_missing() {
        let cond = r#"{"field":"error","op":"exists"}"#;
        let output = r#"{"type":"bug"}"#;
        assert!(!evaluate_condition(cond, Some(output)));
    }

    #[test]
    fn test_evaluate_condition_malformed_passes_through() {
        let cond = r#"not valid json"#;
        let output = r#"{"type":"bug"}"#;
        assert!(evaluate_condition(cond, Some(output)));
    }

    #[test]
    fn test_evaluate_condition_unknown_op_passes_through() {
        let cond = r#"{"field":"type","op":"greater_than","value":"5"}"#;
        let output = r#"{"type":"10"}"#;
        assert!(evaluate_condition(cond, Some(output)));
    }

    #[test]
    fn test_evaluate_condition_no_output() {
        let cond = r#"{"field":"type","op":"equals","value":"bug"}"#;
        assert!(!evaluate_condition(cond, None));
    }

    #[test]
    fn test_node_config_deserialize_full() {
        let json = r#"{
            "modelProfileOverride": "claude-haiku",
            "nodeType": "command",
            "command": "echo hello",
            "approvalGate": true
        }"#;
        let config: NodeConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.model_profile_override.as_deref(), Some("claude-haiku"));
        assert_eq!(config.node_type.as_deref(), Some("command"));
        assert_eq!(config.command.as_deref(), Some("echo hello"));
        assert_eq!(config.approval_gate, Some(true));
    }

    #[test]
    fn test_node_config_deserialize_empty() {
        let json = r#"{}"#;
        let config: NodeConfig = serde_json::from_str(json).unwrap();
        assert!(config.model_profile_override.is_none());
        assert!(config.node_type.is_none());
        assert!(config.command.is_none());
        assert!(config.approval_gate.is_none());
    }

    #[test]
    fn test_node_config_default() {
        let config = NodeConfig::default();
        assert!(config.model_profile_override.is_none());
        assert!(config.node_type.is_none());
        assert!(config.command.is_none());
        assert!(config.approval_gate.is_none());
    }

    #[test]
    fn test_build_predecessor_map_filters_feedback() {
        let connections = vec![
            PersonaTeamConnection {
                id: "c1".into(),
                team_id: "t1".into(),
                source_member_id: "a".into(),
                target_member_id: "b".into(),
                connection_type: "sequential".into(),
                condition: None,
                label: None,
                created_at: "".into(),
            },
            PersonaTeamConnection {
                id: "c2".into(),
                team_id: "t1".into(),
                source_member_id: "b".into(),
                target_member_id: "a".into(),
                connection_type: "feedback".into(),
                condition: None,
                label: None,
                created_at: "".into(),
            },
        ];
        let map = build_predecessor_map(&connections);
        assert_eq!(map.get("b").map(|v| v.len()), Some(1));
        assert!(map.get("a").is_none());
    }

    #[test]
    fn test_should_skip_node_conditional_met() {
        let connections = vec![PersonaTeamConnection {
            id: "c1".into(),
            team_id: "t1".into(),
            source_member_id: "a".into(),
            target_member_id: "b".into(),
            connection_type: "conditional".into(),
            condition: Some(r#"{"field":"type","op":"equals","value":"bug"}"#.into()),
            label: None,
            created_at: "".into(),
        }];
        let mut outputs = HashMap::new();
        outputs.insert("a".into(), Some(r#"{"type":"bug"}"#.into()));
        assert!(!should_skip_node("b", &connections, &outputs));
    }

    #[test]
    fn test_should_skip_node_conditional_not_met() {
        let connections = vec![PersonaTeamConnection {
            id: "c1".into(),
            team_id: "t1".into(),
            source_member_id: "a".into(),
            target_member_id: "b".into(),
            connection_type: "conditional".into(),
            condition: Some(r#"{"field":"type","op":"equals","value":"bug"}"#.into()),
            label: None,
            created_at: "".into(),
        }];
        let mut outputs = HashMap::new();
        outputs.insert("a".into(), Some(r#"{"type":"feature"}"#.into()));
        assert!(should_skip_node("b", &connections, &outputs));
    }

    #[test]
    fn test_should_skip_node_sequential_never_skips() {
        let connections = vec![PersonaTeamConnection {
            id: "c1".into(),
            team_id: "t1".into(),
            source_member_id: "a".into(),
            target_member_id: "b".into(),
            connection_type: "sequential".into(),
            condition: None,
            label: None,
            created_at: "".into(),
        }];
        let outputs = HashMap::new();
        assert!(!should_skip_node("b", &connections, &outputs));
    }
}
