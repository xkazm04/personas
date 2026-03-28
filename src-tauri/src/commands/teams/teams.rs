use std::sync::Arc;
use tauri::State;

use crate::db::models::{
    CreateTeamInput, CreateTeamMemoryInput, PersonaTeam, PersonaTeamConnection, PersonaTeamMember,
    PipelineRun, TeamCounts, UpdateTeamInput,
};
use crate::db::repos::resources::teams as repo;
use crate::db::repos::resources::team_memories as team_memories_repo;
use crate::engine::event_registry::event_name;
use crate::engine::optimizer::{self, PipelineAnalytics};
use crate::engine::topology_heuristic;
use crate::engine::topology_types::TopologyBlueprint;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

#[tauri::command]
pub fn list_teams(state: State<'_, Arc<AppState>>) -> Result<Vec<PersonaTeam>, AppError> {
    require_auth_sync(&state)?;
    repo::get_all(&state.db)
}

#[tauri::command]
pub fn get_team_counts(state: State<'_, Arc<AppState>>) -> Result<Vec<TeamCounts>, AppError> {
    require_auth_sync(&state)?;
    repo::get_all_team_counts(&state.db)
}

#[tauri::command]
pub fn get_team(state: State<'_, Arc<AppState>>, id: String) -> Result<PersonaTeam, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn create_team(
    state: State<'_, Arc<AppState>>,
    input: CreateTeamInput,
) -> Result<PersonaTeam, AppError> {
    require_auth_sync(&state)?;
    repo::create(&state.db, input)
}

#[tauri::command]
pub fn update_team(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateTeamInput,
) -> Result<PersonaTeam, AppError> {
    require_auth_sync(&state)?;
    repo::update(&state.db, &id, input)
}

#[tauri::command]
pub fn delete_team(state: State<'_, Arc<AppState>>, id: String) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete(&state.db, &id)
}

#[tauri::command]
pub fn clone_team(
    state: State<'_, Arc<AppState>>,
    source_team_id: String,
) -> Result<PersonaTeam, AppError> {
    require_auth_sync(&state)?;
    repo::clone_team(&state.db, &source_team_id)
}

#[tauri::command]
pub fn list_team_members(
    state: State<'_, Arc<AppState>>,
    team_id: String,
) -> Result<Vec<PersonaTeamMember>, AppError> {
    require_auth_sync(&state)?;
    repo::get_members(&state.db, &team_id)
}

#[tauri::command]
pub fn add_team_member(
    state: State<'_, Arc<AppState>>,
    team_id: String,
    persona_id: String,
    role: Option<String>,
    position_x: Option<f64>,
    position_y: Option<f64>,
    config: Option<String>,
) -> Result<PersonaTeamMember, AppError> {
    require_auth_sync(&state)?;
    repo::add_member(&state.db, &team_id, &persona_id, role, position_x, position_y, config)
}

#[tauri::command]
pub fn update_team_member(
    state: State<'_, Arc<AppState>>,
    id: String,
    role: Option<String>,
    position_x: Option<f64>,
    position_y: Option<f64>,
    config: Option<String>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::update_member(&state.db, &id, role, position_x, position_y, config)
}

#[tauri::command]
pub fn remove_team_member(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::remove_member(&state.db, &id)
}

#[tauri::command]
pub fn list_team_connections(
    state: State<'_, Arc<AppState>>,
    team_id: String,
) -> Result<Vec<PersonaTeamConnection>, AppError> {
    require_auth_sync(&state)?;
    repo::get_connections(&state.db, &team_id)
}

#[tauri::command]
pub fn create_team_connection(
    state: State<'_, Arc<AppState>>,
    team_id: String,
    source_member_id: String,
    target_member_id: String,
    connection_type: Option<String>,
    condition: Option<String>,
    label: Option<String>,
) -> Result<PersonaTeamConnection, AppError> {
    require_auth_sync(&state)?;
    repo::create_connection(&state.db, &team_id, &source_member_id, &target_member_id, connection_type, condition, label)
}

#[tauri::command]
pub fn update_team_connection(
    state: State<'_, Arc<AppState>>,
    id: String,
    connection_type: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::update_connection_type(&state.db, &id, &connection_type)
}

#[tauri::command]
pub fn delete_team_connection(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_connection(&state.db, &id)
}

// ============================================================================
// Pipeline Helpers
// ============================================================================

/// Update a node's fields in the pipeline status array by member_id.
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
// Pipeline Runs
// ============================================================================

#[tauri::command]
pub fn list_pipeline_runs(
    state: State<'_, Arc<AppState>>,
    team_id: String,
) -> Result<Vec<PipelineRun>, AppError> {
    require_auth_sync(&state)?;
    repo::list_pipeline_runs(&state.db, &team_id)
}

#[tauri::command]
pub fn get_pipeline_run(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<PipelineRun, AppError> {
    require_auth_sync(&state)?;
    repo::get_pipeline_run(&state.db, &id)
}

#[tauri::command]
pub async fn execute_team(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    team_id: String,
    input_data: Option<String>,
) -> Result<String, AppError> {
    require_auth(&state).await?;
    use crate::db::repos::resources::teams as team_repo;
    use crate::db::repos::core::personas as persona_repo;
    use crate::db::repos::resources::tools as tool_repo;
    use tauri::Emitter;

    // Reject if this team already has a running pipeline to prevent concurrent
    // execution races (duplicate LLM calls, conflicting pipeline-status events).
    if team_repo::has_running_pipeline(&state.db, &team_id)? {
        return Err(AppError::Validation(
            "This team already has a pipeline running. Wait for it to complete or cancel it first.".into(),
        ));
    }

    // Create pipeline run
    let run_id = team_repo::create_pipeline_run(&state.db, &team_id, input_data.as_deref())?;

    // Load members and connections
    let members = team_repo::get_members(&state.db, &team_id)?;
    let connections = team_repo::get_connections(&state.db, &team_id)?;

    if members.is_empty() {
        team_repo::update_pipeline_run(
            &state.db,
            &run_id,
            "failed",
            "[]",
            Some("No members in team"),
        )?;
        return Ok(run_id);
    }

    // Topological sort via shared module -- exclude feedback edges so the graph
    // is a clean DAG. Feedback edges (e.g. reviewer->orchestrator) are intentional
    // back-edges that should not affect execution order or data flow.
    let member_ids: Vec<String> = members.iter().map(|m| m.id.clone()).collect();
    let edges: Vec<(&str, &str)> = connections
        .iter()
        .filter(|c| c.connection_type != "feedback")
        .map(|c| (c.source_member_id.as_str(), c.target_member_id.as_str()))
        .collect();
    let topo = crate::engine::topology_graph::NamedTopologyGraph::new(&member_ids, &edges);
    let sort_result = topo.topological_sort();

    if sort_result.has_cycle() {
        tracing::warn!(
            team_id = %team_id,
            cycle_nodes = ?sort_result.cycle_nodes,
            "Pipeline contains a non-feedback cycle -- cyclic nodes will be appended after acyclic ones",
        );

        // Emit cycle warning to frontend with affected member IDs
        let _ = app.emit(
            event_name::PIPELINE_CYCLE_WARNING,
            serde_json::json!({
                "team_id": team_id,
                "pipeline_id": run_id,
                "cycle_member_ids": sort_result.cycle_nodes,
            }),
        );
    }

    // Acyclic nodes in order, then any remaining cycle nodes appended at the end
    let mut execution_order = sort_result.order;
    execution_order.extend(sort_result.cycle_nodes);

    // Build initial node statuses
    let node_statuses: Vec<serde_json::Value> = members
        .iter()
        .map(|m| {
            serde_json::json!({
                "member_id": m.id,
                "persona_id": m.persona_id,
                "status": "idle",
            })
        })
        .collect();

    let node_statuses_json =
        serde_json::to_string(&node_statuses).unwrap_or_else(|_| "[]".into());
    let _ = team_repo::update_pipeline_run(
        &state.db,
        &run_id,
        "running",
        &node_statuses_json,
        None,
    );

    // Emit initial status
    let _ = app.emit(
        event_name::PIPELINE_STATUS,
        serde_json::json!({
            "pipeline_id": run_id,
            "team_id": team_id,
            "status": "running",
            "node_statuses": node_statuses,
        }),
    );

    // Set up cancellation flag.
    // The guard ensures unregister_run is called even if the task panics.
    let (cancelled, run_guard) =
        state.process_registry.register_run_guarded("pipeline", &run_id);

    // Clone what we need for the async task
    let db = state.db.clone();
    let engine = state.engine.clone();
    let run_id_clone = run_id.clone();

    // Build predecessor map from non-feedback edges so each node receives
    // output from its actual predecessor(s) rather than a global last_output.
    let predecessor_map: std::collections::HashMap<String, Vec<String>> = {
        let mut map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
        for c in &connections {
            if c.connection_type != "feedback" {
                map.entry(c.target_member_id.clone())
                    .or_default()
                    .push(c.source_member_id.clone());
            }
        }
        map
    };

    tokio::spawn(async move {
        let _guard = run_guard;
        let mut node_outputs: std::collections::HashMap<String, Option<String>> = std::collections::HashMap::new();
        let mut final_statuses = node_statuses.clone();
        let mut has_failure = false;
        let mut memories_created: u32 = 0;

        for member_id in &execution_order {
            let member = match members.iter().find(|m| &m.id == member_id) {
                Some(m) => m,
                None => continue,
            };

            // Update this node to "running"
            update_node_status(&mut final_statuses, member_id, &[
                ("status", serde_json::json!("running")),
            ]);
            let status_json = serde_json::to_string(&final_statuses).unwrap_or_default();
            let _ = team_repo::update_pipeline_run(
                &db,
                &run_id_clone,
                "running",
                &status_json,
                None,
            );
            let _ = app.emit(
                event_name::PIPELINE_STATUS,
                serde_json::json!({
                    "pipeline_id": run_id_clone,
                    "team_id": team_id,
                    "status": "running",
                    "node_statuses": final_statuses,
                }),
            );

            // Load persona + tools
            let persona = match persona_repo::get_by_id(&db, &member.persona_id) {
                Ok(p) => p,
                Err(_) => {
                    update_node_status(&mut final_statuses, member_id, &[
                        ("status", serde_json::json!("failed")),
                        ("error", serde_json::json!("Persona not found")),
                    ]);
                    has_failure = true;
                    continue;
                }
            };
            let persona_name = persona.name.clone();

            let tools =
                tool_repo::get_tools_for_persona(&db, &member.persona_id).unwrap_or_default();

            // Resolve input for this node: use predecessor output(s) if available,
            // otherwise fall back to the pipeline-level input_data for root nodes.
            let resolved_input = if let Some(preds) = predecessor_map.get(member_id) {
                // Use the last predecessor's output that is available
                preds
                    .iter()
                    .rev()
                    .find_map(|pid| node_outputs.get(pid).and_then(|o| o.clone()))
                    .or_else(|| input_data.clone())
            } else {
                // Root node (no non-feedback predecessors) -- use pipeline input
                input_data.clone()
            };

            // Load top 20 team memories by importance for context injection
            let team_memories = team_memories_repo::get_for_injection(&db, &team_id, 20)
                .unwrap_or_default();

            let memory_context: Option<String> = if team_memories.is_empty() {
                None
            } else {
                let entries: Vec<String> = team_memories.iter().map(|m| {
                    format!("- [{}] {}: {}", m.category, m.title, m.content)
                }).collect();
                Some(format!(
                    "## Team Memory Context\nShared memories from past runs:\n{}",
                    entries.join("\n")
                ))
            };

            // Build input_data for this node
            let node_input = resolved_input.as_ref().map(|output| {
                let mut obj = serde_json::json!({
                    "pipeline_input": output,
                    "pipeline_context": {
                        "run_id": run_id_clone,
                        "member_id": member_id,
                        "role": member.role,
                    }
                });
                if let Some(ref ctx) = memory_context {
                    obj["team_memory_context"] = serde_json::json!(ctx);
                }
                obj
            });

            // Create execution
            let exec = match crate::db::repos::execution::executions::create(
                &db,
                &member.persona_id,
                None,
                node_input
                    .as_ref()
                    .map(|v| v.to_string()),
                None,
                None,
            ) {
                Ok(e) => e,
                Err(_) => {
                    update_node_status(&mut final_statuses, member_id, &[
                        ("status", serde_json::json!("failed")),
                        ("error", serde_json::json!("Failed to create execution")),
                    ]);
                    has_failure = true;
                    continue;
                }
            };

            // Update node status with execution_id
            update_node_status(&mut final_statuses, member_id, &[
                ("execution_id", serde_json::json!(exec.id)),
            ]);

            // Run execution
            if let Err(e) = engine
                .start_execution(
                    app.clone(),
                    db.clone(),
                    exec.id.clone(),
                    persona,
                    tools,
                    node_input,
                    None,
                )
                .await
            {
                update_node_status(&mut final_statuses, member_id, &[
                    ("status", serde_json::json!("failed")),
                    ("error", serde_json::json!(format!("{}", e))),
                ]);
                has_failure = true;
                continue;
            }

            // Wait for execution to complete by polling (check cancellation each tick)
            let mut completed = false;
            let mut was_cancelled = false;
            for _ in 0..600 {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;

                // Check cancellation flag
                if cancelled.load(std::sync::atomic::Ordering::Relaxed) {
                    was_cancelled = true;
                    // Cancel the underlying execution too
                    let persona_id = Some(member.persona_id.clone());
                    let _ = engine
                        .cancel_execution(&exec.id, &db, persona_id.as_deref())
                        .await;
                    update_node_status(&mut final_statuses, member_id, &[
                        ("status", serde_json::json!("cancelled")),
                        ("error", serde_json::json!("Pipeline cancelled by user")),
                    ]);
                    has_failure = true;
                    completed = true;
                    break;
                }

                if let Ok(execution) =
                    crate::db::repos::execution::executions::get_by_id(&db, &exec.id)
                {
                    match execution.status.as_str() {
                        "completed" => {
                            node_outputs.insert(member_id.clone(), execution.output_data.clone());
                            update_node_status(&mut final_statuses, member_id, &[
                                ("status", serde_json::json!("completed")),
                                ("output", serde_json::json!(execution.output_data)),
                            ]);

                            // Auto-create team memory from node output
                            if let Some(ref output_text) = execution.output_data {
                                let truncated = if output_text.len() > 500 {
                                    format!("{}...", &output_text[..500])
                                } else {
                                    output_text.clone()
                                };
                                if team_memories_repo::create(&db, CreateTeamMemoryInput {
                                    team_id: team_id.clone(),
                                    run_id: Some(run_id_clone.clone()),
                                    member_id: Some(member_id.clone()),
                                    persona_id: Some(member.persona_id.clone()),
                                    title: format!("{} output (run {})", persona_name, &run_id_clone[..8]),
                                    content: truncated,
                                    category: Some("observation".into()),
                                    importance: Some(3),
                                    tags: Some(format!("auto,run:{}", &run_id_clone[..8])),
                                }).is_ok() {
                                    memories_created += 1;
                                }
                            }

                            completed = true;
                            break;
                        }
                        "failed" | "cancelled" => {
                            update_node_status(&mut final_statuses, member_id, &[
                                ("status", serde_json::json!("failed")),
                                ("error", serde_json::json!(execution.error_message)),
                            ]);
                            has_failure = true;
                            completed = true;
                            break;
                        }
                        _ => {}
                    }
                }
            }

            if !completed {
                update_node_status(&mut final_statuses, member_id, &[
                    ("status", serde_json::json!("failed")),
                    ("error", serde_json::json!("Execution timed out")),
                ]);
                has_failure = true;
            }

            if was_cancelled {
                break;
            }

            // Emit updated status
            let status_json = serde_json::to_string(&final_statuses).unwrap_or_default();
            let _ = team_repo::update_pipeline_run(
                &db,
                &run_id_clone,
                "running",
                &status_json,
                None,
            );
            let _ = app.emit(
                event_name::PIPELINE_STATUS,
                serde_json::json!({
                    "pipeline_id": run_id_clone,
                    "team_id": team_id,
                    "status": "running",
                    "node_statuses": final_statuses,
                    "memories_created": memories_created,
                }),
            );

            if has_failure {
                break;
            }
        }

        // Mark any remaining idle nodes so the UI doesn't show them as pending
        // after the pipeline is terminal.
        let skip_label = if cancelled.load(std::sync::atomic::Ordering::Relaxed) {
            "cancelled"
        } else if has_failure {
            "skipped"
        } else {
            "" // all nodes completed — nothing to patch
        };
        if !skip_label.is_empty() {
            for ns in final_statuses.iter_mut() {
                if ns.get("status").and_then(|v| v.as_str()) == Some("idle") {
                    if let Some(obj) = ns.as_object_mut() {
                        obj.insert("status".into(), serde_json::json!(skip_label));
                    }
                }
            }
        }

        // Finalize
        let final_status = if cancelled.load(std::sync::atomic::Ordering::Relaxed) {
            "cancelled"
        } else if has_failure {
            "failed"
        } else {
            "completed"
        };
        let final_json = serde_json::to_string(&final_statuses).unwrap_or_default();
        let _ = team_repo::update_pipeline_run(
            &db,
            &run_id_clone,
            final_status,
            &final_json,
            None,
        );
        let _ = app.emit(
            event_name::PIPELINE_STATUS,
            serde_json::json!({
                "pipeline_id": run_id_clone,
                "team_id": team_id,
                "status": final_status,
                "node_statuses": final_statuses,
                "memories_created": memories_created,
            }),
        );

        // Evict excess auto-generated memories if over the cap
        if memories_created > 0 {
            if let Err(e) = team_memories_repo::evict_excess(&db, &team_id, None) {
                tracing::warn!(team_id = %team_id, error = %e, "Failed to evict excess team memories");
            }
        }

        // Guard handles unregister_run on drop.
    });

    Ok(run_id)
}

/// Cancel a running pipeline by setting its cancellation flag.
#[tauri::command]
pub fn cancel_pipeline(
    state: State<'_, Arc<AppState>>,
    run_id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    state.process_registry.cancel_run("pipeline", &run_id);
    tracing::info!(run_id = %run_id, "Pipeline cancellation requested");
    Ok(true)
}

// ============================================================================
// Pipeline Analytics & Topology Optimizer
// ============================================================================

#[tauri::command]
pub fn get_pipeline_analytics(
    state: State<'_, Arc<AppState>>,
    team_id: String,
) -> Result<PipelineAnalytics, AppError> {
    require_auth_sync(&state)?;
    let runs = repo::list_pipeline_runs(&state.db, &team_id)?;
    let members = repo::get_members(&state.db, &team_id)?;
    let connections = repo::get_connections(&state.db, &team_id)?;

    Ok(optimizer::analyze_pipeline(&team_id, &runs, &members, &connections))
}

#[tauri::command]
pub fn suggest_topology(
    state: State<'_, Arc<AppState>>,
    query: String,
    team_id: Option<String>,
) -> Result<TopologyBlueprint, AppError> {
    require_auth_sync(&state)?;
    use crate::db::repos::core::personas as persona_repo;

    let personas = persona_repo::get_all(&state.db)?;
    let existing_member_ids: Vec<String> = if let Some(ref tid) = team_id {
        repo::get_members(&state.db, tid)?
            .iter()
            .map(|m| m.persona_id.clone())
            .collect()
    } else {
        vec![]
    };

    Ok(topology_heuristic::suggest_topology(&query, &personas, &existing_member_ids))
}

/// LLM model for team building -- needs reasoning for composition decisions.
const TEAM_BUILDER_MODEL: &str = "claude-sonnet-4-6";
const TEAM_BUILDER_TIMEOUT_SECS: u64 = 120;

/// Shared helper that runs the LLM topology pipeline: builds the prompt, calls
/// Claude, parses the response, and falls back to keyword-based topology when
/// the LLM returns empty members.
async fn run_llm_topology_request(
    db: &crate::db::DbPool,
    query: &str,
    existing_member_ids: &[String],
    empty_output_msg: &str,
) -> Result<TopologyBlueprint, AppError> {
    use crate::commands::credentials::ai_artifact_flow::run_claude_prompt;
    use crate::db::repos::communication::reviews as review_repo;
    use crate::db::repos::core::personas as persona_repo;
    use crate::engine::llm_topology;
    use crate::engine::prompt;

    let personas = persona_repo::get_all(db)?;
    let templates = review_repo::get_reviews(db, None, Some(50))?;

    let prompt_text = llm_topology::build_llm_topology_prompt(
        query,
        &personas,
        &templates,
        existing_member_ids,
    );

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push(TEAM_BUILDER_MODEL.to_string());
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("1".to_string());

    let output_text = run_claude_prompt(
        prompt_text,
        &cli_args,
        TEAM_BUILDER_TIMEOUT_SECS,
        empty_output_msg,
    )
    .await
    .map_err(AppError::Internal)?;

    match llm_topology::parse_llm_topology_response(&output_text, &personas) {
        Some(bp) if !bp.members.is_empty() => Ok(bp),
        _ => Ok(topology_heuristic::suggest_topology(query, &personas, existing_member_ids)),
    }
}

#[tauri::command]
pub async fn suggest_topology_llm(
    state: State<'_, Arc<AppState>>,
    query: String,
    team_id: Option<String>,
) -> Result<TopologyBlueprint, AppError> {
    require_auth(&state).await?;

    let existing_member_ids: Vec<String> = if let Some(ref tid) = team_id {
        repo::get_members(&state.db, tid)?
            .iter()
            .map(|m| m.persona_id.clone())
            .collect()
    } else {
        vec![]
    };

    run_llm_topology_request(
        &state.db,
        &query,
        &existing_member_ids,
        "Claude produced no output for team composition",
    )
    .await
}

// ============================================================================
// Workflow Compiler — natural language → team pipeline
// ============================================================================

/// Compile a natural-language workflow description into a persisted team with
/// members, connections, and topology.  Uses the LLM topology builder to select
/// personas and infer connections, then persists the result.
///
/// Falls back to keyword-based topology if the LLM returns empty members.
#[tauri::command]
pub async fn compile_workflow(
    state: State<'_, Arc<AppState>>,
    description: String,
) -> Result<crate::engine::workflow_compiler::CompiledWorkflow, AppError> {
    require_auth(&state).await?;
    use crate::db::repos::core::personas as persona_repo;
    use crate::engine::workflow_compiler;

    let description = description.trim().to_string();
    if description.is_empty() {
        return Err(AppError::Validation(
            "Workflow description cannot be empty".into(),
        ));
    }

    let personas = persona_repo::get_all(&state.db)?;
    if personas.iter().filter(|p| p.enabled).count() < 2 {
        return Err(AppError::Validation(
            "At least 2 enabled personas are required to compose a workflow".into(),
        ));
    }

    let blueprint = run_llm_topology_request(
        &state.db,
        &description,
        &[],
        "Claude produced no output for workflow compilation",
    )
    .await?;

    if blueprint.members.is_empty() {
        return Err(AppError::Internal(
            "Could not find matching personas for this workflow description".into(),
        ));
    }

    // Persist as a new team
    workflow_compiler::persist_blueprint(&state.db, &blueprint, &description)
}
