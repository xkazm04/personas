use std::sync::Arc;

use tauri::State;

use serde::Deserialize;
use ts_rs::TS;

use crate::db::models::{
    CreateN8nSessionInput, N8nSessionResponse, N8nSessionSummary, SessionStatus,
    UpdateN8nSessionInput,
};
use crate::db::repos::resources::n8n_sessions as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

use super::n8n_limits::MAX_WORKFLOW_JSON_BYTES;

/// Marker substring used by the frontend error registry to map this error to a
/// localized "not a valid n8n workflow export" message + suggestion. Keep in
/// sync with the `n8n_invalid_shape` rule in `src/i18n/useTranslatedError.ts`.
const N8N_INVALID_SHAPE_MARKER: &str = "is not a valid n8n workflow export";

/// Verify the parsed JSON has the structural shape of an n8n workflow export
/// before the session is created. n8n exports always carry a top-level object
/// with `nodes` (array), `connections` (object), and `name` (string). Anything
/// else (Postman collection, OpenAPI spec, arbitrary JSON) is rejected here so
/// the LLM transform never burns time and tokens guessing what to do with it.
fn validate_n8n_workflow_shape(value: &serde_json::Value) -> Result<(), AppError> {
    let Some(obj) = value.as_object() else {
        return Err(AppError::Validation(format!(
            "Workflow input {N8N_INVALID_SHAPE_MARKER}: top-level value must be a JSON object. \
             See https://docs.n8n.io/workflows/export-import/ for how to export a workflow."
        )));
    };

    let mut missing: Vec<&'static str> = Vec::new();

    match obj.get("nodes") {
        Some(v) if v.is_array() => {}
        Some(_) => missing.push("nodes (must be an array)"),
        None => missing.push("nodes"),
    }
    match obj.get("connections") {
        Some(v) if v.is_object() => {}
        Some(_) => missing.push("connections (must be an object)"),
        None => missing.push("connections"),
    }
    match obj.get("name") {
        Some(v) if v.is_string() => {}
        Some(_) => missing.push("name (must be a string)"),
        None => missing.push("name"),
    }

    if !missing.is_empty() {
        return Err(AppError::Validation(format!(
            "Workflow input {N8N_INVALID_SHAPE_MARKER}: missing or invalid fields [{}]. \
             See https://docs.n8n.io/workflows/export-import/ for how to export a workflow.",
            missing.join(", "),
        )));
    }

    Ok(())
}

/// Single-struct parameter for the `update_n8n_session` command,
/// replacing 11 individual arguments.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UpdateN8nSessionParams {
    pub id: String,
    pub workflow_name: Option<String>,
    pub status: Option<SessionStatus>,
    pub parser_result: Option<Option<String>>,
    pub draft_json: Option<Option<String>>,
    pub user_answers: Option<Option<String>>,
    pub step: Option<String>,
    pub error: Option<Option<String>>,
    pub persona_id: Option<Option<String>>,
    pub transform_id: Option<Option<String>>,
    pub questions_json: Option<Option<String>>,
}

#[tauri::command]
pub async fn create_n8n_session(
    state: State<'_, Arc<AppState>>,
    workflow_name: String,
    raw_workflow_json: String,
    step: String,
    status: SessionStatus,
) -> Result<N8nSessionResponse, AppError> {
    require_auth(&state).await?;
    if raw_workflow_json.len() > MAX_WORKFLOW_JSON_BYTES {
        return Err(AppError::Validation(format!(
            "Workflow JSON too large (>{} MB). Use a smaller workflow export.",
            MAX_WORKFLOW_JSON_BYTES / (1024 * 1024)
        )));
    }

    let parsed: serde_json::Value = serde_json::from_str(&raw_workflow_json).map_err(|_| {
        AppError::Validation(
            "Workflow input is not valid JSON. Please export a valid n8n workflow file.".into(),
        )
    })?;
    validate_n8n_workflow_shape(&parsed)?;

    repo::create(
        &state.db,
        &CreateN8nSessionInput {
            workflow_name,
            raw_workflow_json,
            step,
            status,
        },
    )
    .map(N8nSessionResponse::from)
}

#[tauri::command]
pub async fn get_n8n_session(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<N8nSessionResponse, AppError> {
    require_auth(&state).await?;
    repo::get(&state.db, &id).map(N8nSessionResponse::from)
}

#[tauri::command]
pub async fn list_n8n_sessions(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<N8nSessionResponse>, AppError> {
    require_auth(&state).await?;
    repo::list(&state.db).map(|v| v.into_iter().map(N8nSessionResponse::from).collect())
}

#[tauri::command]
pub async fn list_n8n_session_summaries(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<N8nSessionSummary>, AppError> {
    require_auth(&state).await?;
    repo::list_summaries(&state.db)
}

#[tauri::command]
pub async fn update_n8n_session(
    state: State<'_, Arc<AppState>>,
    params: UpdateN8nSessionParams,
) -> Result<N8nSessionResponse, AppError> {
    require_auth(&state).await?;
    repo::update(
        &state.db,
        &params.id,
        &UpdateN8nSessionInput {
            workflow_name: params.workflow_name,
            status: params.status,
            parser_result: params.parser_result,
            draft_json: params.draft_json,
            user_answers: params.user_answers,
            step: params.step,
            error: params.error,
            persona_id: params.persona_id,
            transform_id: params.transform_id,
            questions_json: params.questions_json,
        },
    )
    .map(N8nSessionResponse::from)
}

#[tauri::command]
pub async fn delete_n8n_session(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    repo::delete(&state.db, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(s: &str) -> serde_json::Value {
        serde_json::from_str(s).expect("test fixture must be valid JSON")
    }

    fn err_msg(result: Result<(), AppError>) -> String {
        match result.expect_err("expected validation error") {
            AppError::Validation(s) => s,
            other => panic!("expected Validation, got {other:?}"),
        }
    }

    #[test]
    fn accepts_minimal_n8n_workflow() {
        let v = parse(r#"{"name":"My Flow","nodes":[],"connections":{}}"#);
        assert!(validate_n8n_workflow_shape(&v).is_ok());
    }

    #[test]
    fn accepts_realistic_n8n_workflow() {
        let v = parse(
            r#"{
                "name": "Slack notifier",
                "nodes": [{"id": "1", "type": "n8n-nodes-base.start"}],
                "connections": {"Start": {"main": [[]]}},
                "active": false,
                "versionId": "abc"
            }"#,
        );
        assert!(validate_n8n_workflow_shape(&v).is_ok());
    }

    #[test]
    fn rejects_top_level_array() {
        let v = parse("[1,2,3]");
        let msg = err_msg(validate_n8n_workflow_shape(&v));
        assert!(msg.contains(N8N_INVALID_SHAPE_MARKER));
        assert!(msg.contains("docs.n8n.io"));
    }

    #[test]
    fn rejects_top_level_string() {
        let v = parse(r#""just a string""#);
        let msg = err_msg(validate_n8n_workflow_shape(&v));
        assert!(msg.contains(N8N_INVALID_SHAPE_MARKER));
    }

    #[test]
    fn rejects_postman_collection() {
        // Postman collection v2.1 — common mis-upload candidate
        let v = parse(
            r#"{
                "info": {"name": "My API", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
                "item": []
            }"#,
        );
        let msg = err_msg(validate_n8n_workflow_shape(&v));
        assert!(msg.contains(N8N_INVALID_SHAPE_MARKER));
        assert!(msg.contains("nodes"));
        assert!(msg.contains("connections"));
        assert!(msg.contains("name"));
    }

    #[test]
    fn rejects_openapi_spec() {
        let v = parse(
            r#"{
                "openapi": "3.0.0",
                "info": {"title": "Pet Store", "version": "1.0.0"},
                "paths": {}
            }"#,
        );
        let msg = err_msg(validate_n8n_workflow_shape(&v));
        assert!(msg.contains(N8N_INVALID_SHAPE_MARKER));
        // OpenAPI has `info.title` but no top-level `name`/`nodes`/`connections`.
        assert!(msg.contains("nodes"));
        assert!(msg.contains("connections"));
        assert!(msg.contains("name"));
    }

    #[test]
    fn rejects_when_nodes_is_not_array() {
        let v = parse(r#"{"name":"X","nodes":"oops","connections":{}}"#);
        let msg = err_msg(validate_n8n_workflow_shape(&v));
        assert!(msg.contains("nodes (must be an array)"));
    }

    #[test]
    fn rejects_when_connections_is_not_object() {
        let v = parse(r#"{"name":"X","nodes":[],"connections":[]}"#);
        let msg = err_msg(validate_n8n_workflow_shape(&v));
        assert!(msg.contains("connections (must be an object)"));
    }

    #[test]
    fn rejects_when_name_is_not_string() {
        let v = parse(r#"{"name":42,"nodes":[],"connections":{}}"#);
        let msg = err_msg(validate_n8n_workflow_shape(&v));
        assert!(msg.contains("name (must be a string)"));
    }
}
