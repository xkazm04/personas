//! The call shapes the web dashboard (personas-web) needs from the desktop
//! management API: `POST /api/execute` with a body, `POST
//! /api/executions/{id}/cancel`, and `GET /api/status`.
//!
//! Every route answers through the router's usual envelope
//! `{success, data, error, code}`; `data` carries exactly the web's TypeScript
//! type (`ExecutionAck`, `StatusResponse` in personas-web `src/lib/`), built
//! from `camelCase` structs. Auth is the existing [`super::authorize`] rule,
//! unchanged: `/api/execute` and the cancel route fall into the broad
//! `personas:execute` arm (a per-persona grant cannot reach the body form),
//! and `GET /api/status` is the any-valid-key read.
//!
//! Every check that can run without the live engine is a plain function over
//! the pool, so it is tested without an `AppHandle`.

use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::State as AxumState,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

use super::{err_code, err_json, ok_json, ApiResult, ManagementState};
use crate::db::models::Persona;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::DbPool;

type Refusal = (StatusCode, Json<ApiResult>);

// =============================================================================
// Shared run start
// =============================================================================

/// The checks `POST /api/execute/{persona_id}` and `POST /api/execute` share,
/// in their one order: 404 unknown persona, 400 disabled persona, then the
/// project-binding check on the input the engine will see.
pub(super) fn check_runnable(
    pool: &DbPool,
    persona_id: &str,
    engine_input: Option<&Value>,
) -> Result<Persona, Refusal> {
    let persona = persona_repo::get_by_id(pool, persona_id)
        .map_err(|_| err_json(StatusCode::NOT_FOUND, "Persona not found"))?;

    if !persona.enabled {
        return Err(err_json(StatusCode::BAD_REQUEST, "Persona is disabled"));
    }

    // Project-bound execution: `input_data._projectId` names the folder this
    // run executes in. Checked synchronously, BEFORE anything is queued — the
    // key that may run this persona may only point it at a project in the
    // persona's own workspace (`personas_db::execution_project`). The runner
    // re-checks before it picks the working directory.
    crate::db::execution_project::bound_project_for_input(
        pool,
        persona.home_team_id.as_deref(),
        engine_input,
    )
    .map_err(|e| {
        let status =
            StatusCode::from_u16(e.http_status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        err_code(status, e.code(), &e.message())
    })?;
    Ok(persona)
}

/// Run a persona over the management API and return the new execution's id.
/// `stored_input` is what the execution row keeps; `engine_input` is what the
/// engine receives. Both routes call this; neither re-implements a check.
pub(super) async fn start_persona_run(
    state: &ManagementState,
    persona_id: &str,
    stored_input: Option<String>,
    engine_input: Option<Value>,
) -> Result<String, Refusal> {
    let persona = check_runnable(&state.pool, persona_id, engine_input.as_ref())?;

    // Create execution record
    let execution = exec_repo::create(&state.pool, persona_id, None, stored_input, None, None)
        .map_err(|e| {
            err_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Failed to create execution: {e}"),
            )
        })?;

    // Get tools
    let tools = tool_repo::get_tools_for_persona(&state.pool, persona_id).unwrap_or_default();

    // Start via engine
    let app_state: tauri::State<'_, Arc<crate::AppState>> = state
        .app
        .try_state()
        .ok_or_else(|| err_json(StatusCode::INTERNAL_SERVER_ERROR, "App state not available"))?;

    app_state
        .engine
        .start_execution(
            state.app.clone(),
            state.pool.clone(),
            execution.id.clone(),
            persona,
            tools,
            engine_input,
            None,
        )
        .await
        .map_err(|e| err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(execution.id)
}

// =============================================================================
// Payloads (the web's TypeScript types, camelCase)
// =============================================================================

/// personas-web `ExecutionAck`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExecutionAck {
    pub execution_id: String,
    pub status: &'static str,
}

/// Body of `POST /api/execute`: the web's `executePersona(personaId, prompt)`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteBody {
    persona_id: Option<String>,
    prompt: Option<String>,
}

/// Parse and validate the `POST /api/execute` body. A missing, empty or
/// whitespace-only `personaId` or `prompt`, or a body that is not that JSON
/// object, is 400 `invalid_body`.
pub(super) fn parse_execute_body(body: &[u8]) -> Result<(String, String), Refusal> {
    let invalid = |msg: &str| err_code(StatusCode::BAD_REQUEST, "invalid_body", msg);
    let parsed: ExecuteBody = serde_json::from_slice(body)
        .map_err(|_| invalid("body must be a JSON object {personaId, prompt}"))?;
    let persona_id = parsed.persona_id.filter(|s| !s.trim().is_empty());
    let prompt = parsed.prompt.filter(|s| !s.trim().is_empty());
    match (persona_id, prompt) {
        (Some(p), Some(t)) => Ok((p, t)),
        (None, _) => Err(invalid("personaId is required")),
        (_, None) => Err(invalid("prompt is required")),
    }
}

/// What the engine receives for a raw prompt: the same reading
/// `execute_persona_inner` gives its string input (JSON when it parses, else
/// the text wrapped as `{"user_input": ...}`).
pub(super) fn engine_input_for_prompt(prompt: &str) -> Value {
    serde_json::from_str(prompt).unwrap_or_else(|_| serde_json::json!({ "user_input": prompt }))
}

// =============================================================================
// POST /api/execute
// =============================================================================

pub(super) async fn post_execute(
    AxumState(state): AxumState<Arc<ManagementState>>,
    body: Bytes,
) -> Response {
    let (persona_id, prompt) = match parse_execute_body(&body) {
        Ok(v) => v,
        Err(r) => return r.into_response(),
    };
    // The stored input is the raw prompt text, what the remote `run_persona`
    // verb stores; the engine gets it parsed the way that path parses it.
    let engine_input = engine_input_for_prompt(&prompt);
    match start_persona_run(&state, &persona_id, Some(prompt), Some(engine_input)).await {
        Ok(execution_id) => ok_json(ExecutionAck {
            execution_id,
            status: "queued",
        })
        .into_response(),
        Err(r) => r.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::CreatePersonaInput;

    fn pool() -> DbPool {
        crate::db::init_test_db().expect("migrated test db")
    }

    fn persona(pool: &DbPool, enabled: bool) -> String {
        persona_repo::create(
            pool,
            CreatePersonaInput {
                name: "Dashboard persona".into(),
                system_prompt: "You are a test agent.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(enabled),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .expect("create persona")
        .id
    }

    /// The status and `code` a refusal answers with.
    fn refusal(r: Refusal) -> (StatusCode, Option<String>) {
        (r.0, r.1 .0.code.clone())
    }

    /// The refusal of a result that must have refused (`ApiResult` is not
    /// `Debug`, so `expect_err` is unavailable).
    fn refused<T>(r: Result<T, Refusal>) -> Refusal {
        match r {
            Ok(_) => panic!("expected a refusal"),
            Err(refusal) => refusal,
        }
    }

    fn refused_not<T>(r: Result<T, Refusal>) -> T {
        match r {
            Ok(v) => v,
            Err(_) => panic!("expected success"),
        }
    }

    fn keys(v: &impl Serialize) -> Vec<String> {
        let mut k: Vec<String> = serde_json::to_value(v)
            .unwrap()
            .as_object()
            .expect("object")
            .keys()
            .cloned()
            .collect();
        k.sort();
        k
    }

    #[test]
    fn execution_ack_has_exactly_the_web_keys() {
        let ack = ExecutionAck {
            execution_id: "e1".into(),
            status: "queued",
        };
        assert_eq!(keys(&ack), ["executionId", "status"]);
    }

    #[test]
    fn a_body_missing_or_empty_in_either_field_is_invalid_body() {
        for body in [
            &b"not json"[..],
            b"[]",
            b"{}",
            br#"{"personaId":"p1"}"#,
            br#"{"prompt":"hi"}"#,
            br#"{"personaId":"","prompt":"hi"}"#,
            br#"{"personaId":"p1","prompt":""}"#,
            br#"{"personaId":"p1","prompt":"   "}"#,
            br#"{"personaId":7,"prompt":"hi"}"#,
        ] {
            let err = refused(parse_execute_body(body));
            assert_eq!(
                refusal(err),
                (StatusCode::BAD_REQUEST, Some("invalid_body".into())),
                "{}",
                String::from_utf8_lossy(body)
            );
        }
    }

    #[test]
    fn a_valid_body_keeps_the_raw_prompt_text() {
        let (p, t) = refused_not(parse_execute_body(
            br#"{"personaId":"p1","prompt":"  summarise\nthis  "}"#,
        ));
        assert_eq!(p, "p1");
        assert_eq!(t, "  summarise\nthis  ");
    }

    #[test]
    fn the_engine_reads_a_plain_prompt_as_user_input_and_json_as_json() {
        assert_eq!(
            engine_input_for_prompt("hello"),
            serde_json::json!({ "user_input": "hello" })
        );
        assert_eq!(
            engine_input_for_prompt(r#"{"a":1}"#),
            serde_json::json!({ "a": 1 })
        );
    }

    #[test]
    fn an_unknown_persona_is_404() {
        let pool = pool();
        let err = refused(check_runnable(&pool, "no-such-persona", None));
        assert_eq!(refusal(err).0, StatusCode::NOT_FOUND);
    }

    #[test]
    fn a_disabled_persona_is_400() {
        let pool = pool();
        let id = persona(&pool, false);
        let err = refused(check_runnable(&pool, &id, None));
        assert_eq!(refusal(err).0, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn an_unknown_persona_is_refused_before_the_project_binding_is_read() {
        // 404 wins over a binding the persona could not honour anyway.
        let pool = pool();
        let input = serde_json::json!({ "_projectId": "p-nowhere" });
        let err = refused(check_runnable(&pool, "no-such-persona", Some(&input)));
        assert_eq!(refusal(err).0, StatusCode::NOT_FOUND);
    }

    #[test]
    fn a_project_binding_the_persona_cannot_honour_is_refused_with_its_code() {
        let pool = pool();
        let id = persona(&pool, true);
        let input = serde_json::json!({ "_projectId": "p-nowhere" });
        let (status, code) = refusal(refused(check_runnable(&pool, &id, Some(&input))));
        assert!(status.is_client_error(), "{status}");
        assert!(code.is_some(), "a binding refusal carries its code");
    }

    #[test]
    fn an_enabled_persona_without_a_binding_passes_the_checks() {
        let pool = pool();
        let id = persona(&pool, true);
        assert!(check_runnable(&pool, &id, None).is_ok());
    }
}
