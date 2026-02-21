use std::sync::Arc;
use tauri::State;

use crate::db::models::{
    CreateTeamInput, PersonaTeam, PersonaTeamConnection, PersonaTeamMember, PipelineRun,
    TeamCounts, UpdateTeamInput,
};
use crate::db::repos::resources::teams as repo;
use crate::engine::optimizer::{self, PipelineAnalytics};
use crate::engine::topology::{self, TopologyBlueprint};
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub fn list_teams(state: State<'_, Arc<AppState>>) -> Result<Vec<PersonaTeam>, AppError> {
    repo::get_all(&state.db)
}

#[tauri::command]
pub fn get_team_counts(state: State<'_, Arc<AppState>>) -> Result<Vec<TeamCounts>, AppError> {
    repo::get_all_team_counts(&state.db)
}

#[tauri::command]
pub fn get_team(state: State<'_, Arc<AppState>>, id: String) -> Result<PersonaTeam, AppError> {
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn create_team(
    state: State<'_, Arc<AppState>>,
    input: CreateTeamInput,
) -> Result<PersonaTeam, AppError> {
    repo::create(&state.db, input)
}

#[tauri::command]
pub fn update_team(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateTeamInput,
) -> Result<PersonaTeam, AppError> {
    repo::update(&state.db, &id, input)
}

#[tauri::command]
pub fn delete_team(state: State<'_, Arc<AppState>>, id: String) -> Result<bool, AppError> {
    repo::delete(&state.db, &id)
}

#[tauri::command]
pub fn list_team_members(
    state: State<'_, Arc<AppState>>,
    team_id: String,
) -> Result<Vec<PersonaTeamMember>, AppError> {
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
    repo::update_member(&state.db, &id, role, position_x, position_y, config)
}

#[tauri::command]
pub fn remove_team_member(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    repo::remove_member(&state.db, &id)
}

#[tauri::command]
pub fn list_team_connections(
    state: State<'_, Arc<AppState>>,
    team_id: String,
) -> Result<Vec<PersonaTeamConnection>, AppError> {
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
    repo::create_connection(&state.db, &team_id, &source_member_id, &target_member_id, connection_type, condition, label)
}

#[tauri::command]
pub fn update_team_connection(
    state: State<'_, Arc<AppState>>,
    id: String,
    connection_type: String,
) -> Result<(), AppError> {
    repo::update_connection_type(&state.db, &id, &connection_type)
}

#[tauri::command]
pub fn delete_team_connection(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
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
    repo::list_pipeline_runs(&state.db, &team_id)
}

#[tauri::command]
pub fn get_pipeline_run(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<PipelineRun, AppError> {
    repo::get_pipeline_run(&state.db, &id)
}

#[tauri::command]
pub async fn execute_team(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    team_id: String,
    input_data: Option<String>,
) -> Result<String, AppError> {
    use crate::db::repos::resources::teams as team_repo;
    use crate::db::repos::core::personas as persona_repo;
    use crate::db::repos::resources::tools as tool_repo;
    use tauri::Emitter;

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

    // Topological sort using Kahn's algorithm
    let member_ids: Vec<String> = members.iter().map(|m| m.id.clone()).collect();
    let mut in_degree: std::collections::HashMap<String, usize> =
        member_ids.iter().map(|id| (id.clone(), 0)).collect();
    let mut adjacency: std::collections::HashMap<String, Vec<String>> =
        member_ids.iter().map(|id| (id.clone(), vec![])).collect();

    for conn in &connections {
        if let Some(deg) = in_degree.get_mut(&conn.target_member_id) {
            *deg += 1;
        }
        if let Some(adj) = adjacency.get_mut(&conn.source_member_id) {
            adj.push(conn.target_member_id.clone());
        }
    }

    let mut queue: std::collections::VecDeque<String> = in_degree
        .iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(id, _)| id.clone())
        .collect();

    let mut execution_order: Vec<String> = Vec::new();
    while let Some(node_id) = queue.pop_front() {
        execution_order.push(node_id.clone());
        if let Some(neighbors) = adjacency.get(&node_id) {
            for neighbor in neighbors {
                if let Some(deg) = in_degree.get_mut(neighbor) {
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(neighbor.clone());
                    }
                }
            }
        }
    }

    // If not all nodes are in the order, there's a cycle -- add remaining
    for id in &member_ids {
        if !execution_order.contains(id) {
            execution_order.push(id.clone());
        }
    }

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
        "pipeline-status",
        serde_json::json!({
            "pipeline_id": run_id,
            "team_id": team_id,
            "status": "running",
            "node_statuses": node_statuses,
        }),
    );

    // Clone what we need for the async task
    let db = state.db.clone();
    let engine = state.engine.clone();
    let run_id_clone = run_id.clone();

    tokio::spawn(async move {
        let mut last_output: Option<String> = input_data.clone();
        let mut final_statuses = node_statuses.clone();
        let mut has_failure = false;

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
                "pipeline-status",
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

            let tools =
                tool_repo::get_tools_for_persona(&db, &member.persona_id).unwrap_or_default();

            // Build input_data for this node
            let node_input = last_output.as_ref().map(|output| {
                serde_json::json!({
                    "pipeline_input": output,
                    "pipeline_context": {
                        "run_id": run_id_clone,
                        "member_id": member_id,
                        "role": member.role,
                    }
                })
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

            // Wait for execution to complete by polling
            let mut completed = false;
            for _ in 0..600 {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                if let Ok(execution) =
                    crate::db::repos::execution::executions::get_by_id(&db, &exec.id)
                {
                    match execution.status.as_str() {
                        "completed" => {
                            last_output = execution.output_data.clone();
                            update_node_status(&mut final_statuses, member_id, &[
                                ("status", serde_json::json!("completed")),
                                ("output", serde_json::json!(execution.output_data)),
                            ]);
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
                "pipeline-status",
                serde_json::json!({
                    "pipeline_id": run_id_clone,
                    "team_id": team_id,
                    "status": "running",
                    "node_statuses": final_statuses,
                }),
            );

            if has_failure {
                break;
            }
        }

        // Finalize
        let final_status = if has_failure { "failed" } else { "completed" };
        let final_json = serde_json::to_string(&final_statuses).unwrap_or_default();
        let _ = team_repo::update_pipeline_run(
            &db,
            &run_id_clone,
            final_status,
            &final_json,
            None,
        );
        let _ = app.emit(
            "pipeline-status",
            serde_json::json!({
                "pipeline_id": run_id_clone,
                "team_id": team_id,
                "status": final_status,
                "node_statuses": final_statuses,
            }),
        );
    });

    Ok(run_id)
}

// ============================================================================
// Pipeline Analytics & Topology Optimizer
// ============================================================================

#[tauri::command]
pub fn get_pipeline_analytics(
    state: State<'_, Arc<AppState>>,
    team_id: String,
) -> Result<PipelineAnalytics, AppError> {
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

    Ok(topology::suggest_topology(&query, &personas, &existing_member_ids))
}
