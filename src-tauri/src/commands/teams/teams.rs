use std::sync::Arc;
use tauri::State;

use crate::db::models::{
    CreateTeamInput, PersonaTeam, PersonaTeamConnection, PersonaTeamMember,
    PipelineRun, TeamCounts, UpdateTeamInput,
};
use crate::db::repos::resources::teams as repo;
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
    use crate::engine::pipeline_executor::{self, PipelineContext};
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

    // Topological sort — exclude feedback edges so the graph is a clean DAG.
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
    let initial_node_statuses: Vec<serde_json::Value> = members
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
        serde_json::to_string(&initial_node_statuses).unwrap_or_else(|_| "[]".into());
    let _ = team_repo::update_pipeline_run(
        &state.db,
        &run_id,
        "running",
        &node_statuses_json,
        None,
    );
    let _ = app.emit(
        event_name::PIPELINE_STATUS,
        serde_json::json!({
            "pipeline_id": run_id,
            "team_id": team_id,
            "status": "running",
            "node_statuses": initial_node_statuses,
        }),
    );

    // Set up cancellation flag.
    let (cancelled, run_guard) =
        state.process_registry.register_run_guarded("pipeline", &run_id);

    let ctx = PipelineContext {
        db: state.db.clone(),
        engine: state.engine.clone(),
        app: app.clone(),
        run_id: run_id.clone(),
        team_id: team_id.clone(),
        input_data,
        members,
        connections,
        execution_order,
        initial_node_statuses,
        cancelled,
    };

    tokio::spawn(async move {
        let _guard = run_guard;
        pipeline_executor::run_pipeline(ctx).await;
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
