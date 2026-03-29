//! Pipeline executor — runs a team's pipeline graph node-by-node.
//!
//! Extracted from the monolithic `execute_team` command to separate concerns:
//! - **Scheduling**: topological sort, predecessor map, execution order
//! - **Node runner**: per-node execution + polling loop
//! - **Status emitter**: DB persistence + Tauri event emission
//! - **Memory creator**: auto-creates team memories from node outputs

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::Emitter;

use crate::db::models::{
    CreateTeamMemoryInput, PersonaTeamConnection, PersonaTeamMember,
};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::resources::team_memories as team_memories_repo;
use crate::db::repos::resources::teams as team_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::DbPool;
use crate::engine::event_registry::event_name;
use crate::engine::ExecutionEngine;

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
        let status_json = serde_json::to_string(node_statuses).unwrap_or_default();
        let _ = team_repo::update_pipeline_run(
            self.db,
            self.run_id,
            status,
            &status_json,
            None,
        );
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

/// Execute a single node: create an execution, start it, poll for completion.
async fn run_node(
    db: &DbPool,
    engine: &ExecutionEngine,
    app: &tauri::AppHandle,
    member: &PersonaTeamMember,
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

    let tools = tool_repo::get_tools_for_persona(db, &member.persona_id).unwrap_or_default();

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
