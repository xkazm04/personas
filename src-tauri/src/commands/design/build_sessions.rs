use std::sync::Arc;

use serde_json::Value;
use tauri::ipc::Channel;
use tauri::State;

use crate::db::models::{
    BuildPhase, ConnectorDefinition, CreateToolDefinitionInput, PersistedBuildSession,
    UpdateBuildSession, UserAnswer,
};
use crate::db::repos::core::build_sessions as build_session_repo;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::connectors as connector_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::engine::build_session as build_session_engine;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Match a tool name against known connector names to infer its credential type.
fn infer_credential_type(tool_name: &str, connectors: &[ConnectorDefinition]) -> Option<String> {
    let lower = tool_name.to_lowercase();
    connectors.iter().find_map(|c| {
        let cn = c.name.to_lowercase();
        if lower.contains(&cn) || cn.contains(&lower) {
            Some(c.name.clone())
        } else {
            None
        }
    })
}

/// Generic tool names that act as transport/utility and rely on connector
/// credentials for the actual API they call. These tools don't carry their
/// own credential type — they need the agent's connectors to know which
/// API key to inject.
const GENERIC_TOOL_NAMES: &[&str] = &[
    "http_request",
    "http",
    "api_call",
    "rest_api",
    "api_request",
    "fetch",
    "curl",
    "request",
];

/// Built-in drive tools that any persona with a `local_drive` connector or a
/// `drive.document.*` subscription implicitly needs. Registered automatically
/// at promote time so `persona_tool_definitions` reflects the intent — the
/// LLM's agent_ir sometimes names only `file_read`/`file_write` (Claude Code
/// built-ins) and omits the drive-specific variants, leaving
/// `execution_config.tool_names` inaccurate.
///
/// NOTE: Registering these rows makes the intent visible in the DB and in the
/// execution config; the *actual* wiring that lets a running Claude Code
/// session invoke these names as tools is tracked separately — Claude Code
/// currently only sees its native Read/Write/Glob plus MCP-exposed tools, so
/// an MCP bridge is the next step for full end-to-end invocation.
const DRIVE_BUILTIN_TOOLS: &[(&str, &str)] = &[
    (
        "drive_write_text",
        "Write a UTF-8 text file into the persona's local drive (relative path).",
    ),
    (
        "drive_read_text",
        "Read a UTF-8 text file from the persona's local drive (relative path).",
    ),
    (
        "drive_list",
        "List entries under a relative path in the persona's local drive.",
    ),
];

/// True when the persona's agent_ir indicates it interacts with the built-in
/// local drive — either via the `local_drive` connector or a `drive.document.*`
/// event subscription.
fn persona_uses_drive(ir: &crate::db::models::AgentIr) -> bool {
    let has_connector = ir.required_connectors.iter().any(|c| {
        c.name()
            .map(|n| {
                let lower = n.to_lowercase();
                lower == "local_drive" || lower == "local-drive" || lower == "localdrive"
            })
            .unwrap_or(false)
    });
    if has_connector {
        return true;
    }

    ir.events.iter().any(|e| {
        e.event_type
            .as_deref()
            .map(|t| t.starts_with("drive.document."))
            .unwrap_or(false)
    })
}

/// Start a new build session for a persona. Returns the session ID.
/// Events are streamed back via the Channel parameter.
/// Optional workflow_json + parser_result_json enable workflow import mode.
///
/// `mode` selects gate-resolution strategy: `"interactive"` (default —
/// ask the user) or `"one_shot"` (LLM resolves every gate, retries test
/// failures up to 3×, auto-promotes on success). When the build was
/// initiated from the in-app Companion chat, `companion_session_id`
/// links the session back so the BuildWatcher job can post a result
/// message into that chat's episode log on terminal phase.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_build_session(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    channel: Channel<Value>,
    persona_id: String,
    intent: String,
    workflow_json: Option<String>,
    parser_result_json: Option<String>,
    language: Option<String>,
    mode: Option<String>,
    companion_session_id: Option<String>,
) -> Result<String, AppError> {
    require_auth(&state).await?;

    let session_id = uuid::Uuid::new_v4().to_string();

    state.build_session_manager.start_session(
        session_id.clone(),
        persona_id,
        intent,
        channel,
        state.db.clone(),
        state.process_registry.clone(),
        workflow_json,
        parser_result_json,
        app,
        language,
        mode,
        companion_session_id,
    )?;

    Ok(session_id)
}

/// Headless variant of `start_build_session` for callers that have no
/// frontend Channel (build-mcp HTTP endpoints, e2e drivers, future
/// external MCP clients). Behavior is identical except the per-call
/// streaming Channel is replaced with a no-op that drops events —
/// callers must rely on the GLOBAL `build-session-event` Tauri emit
/// stream (or poll `get_build_status`) for progress.
///
/// Why a dedicated command rather than making the Channel optional on
/// `start_build_session`: Tauri 2's command-arg deserialization treats
/// `Channel<T>` as required, and adding `Option<Channel<T>>` would
/// break every existing UI caller. A second command keeps the UI path
/// unchanged while exposing a headless surface.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_build_session_headless(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    intent: String,
    workflow_json: Option<String>,
    parser_result_json: Option<String>,
    language: Option<String>,
    mode: Option<String>,
    companion_session_id: Option<String>,
) -> Result<String, AppError> {
    require_auth(&state).await?;

    let session_id = uuid::Uuid::new_v4().to_string();

    // No-op Channel: events fire-and-forget. The global Tauri emit
    // (event_name::BUILD_SESSION_EVENT) still carries every event, so a
    // polling caller can track progress via `get_build_status` and any
    // open Glyph view in the UI keeps updating.
    let dummy_channel: Channel<Value> = Channel::new(|_response| Ok(()));

    state.build_session_manager.start_session(
        session_id.clone(),
        persona_id,
        intent,
        dummy_channel,
        state.db.clone(),
        state.process_registry.clone(),
        workflow_json,
        parser_result_json,
        app,
        language,
        mode,
        companion_session_id,
    )?;

    Ok(session_id)
}

/// Create a build session record from a pre-built design result (template adoption).
/// Does NOT spawn CLI — just inserts the session with agent_ir so test_build_draft works.
/// `resolved_cells_json` carries the pre-extracted dimension data so hydration restores
/// populated matrix cells (instead of the empty `{}` that was previously hardcoded).
#[tauri::command]
pub async fn create_adoption_session(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    intent: String,
    agent_ir_json: String,
    resolved_cells_json: Option<String>,
) -> Result<String, AppError> {
    require_auth(&state).await?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let cells = resolved_cells_json.unwrap_or_else(|| "{}".to_string());

    // Schema v3 templates nest triggers / connectors / events inside
    // `use_cases[i]` and hoist persona-wide concerns into `persona`. The
    // downstream pipeline expects the flat v2 shape — flatten in place.
    // No-op for v1/v2 payloads.
    //
    // 2026-05-09 — Stage B Phase 2: hydrate any `recipe_ref`-shaped UCs from
    // the recipe catalog BEFORE normalization. Templates that have been
    // migrated by Stage B Phase 1b's derive_recipes_from_template have UCs
    // shaped as `{ recipe_ref: { id, version, bindings } }` — those need the
    // recipe's stored UC JSON to be inlined before the v3-flatten pipeline
    // can hoist triggers/connectors/events out of them.
    let pool_for_lookup = state.db.clone();
    let normalized_agent_ir_json = match serde_json::from_str::<serde_json::Value>(&agent_ir_json) {
        Ok(mut payload) => {
            // Phase 2 hydration: recipe_ref → inline UC. No-op when no
            // recipe_refs present.
            let lookup = |id: &str| -> Result<crate::db::models::RecipeDefinition, crate::error::AppError> {
                crate::db::repos::resources::recipes::get_by_id(&pool_for_lookup, id)
            };
            if let Err(e) = crate::engine::template_v3::hydrate_recipe_refs(&mut payload, lookup) {
                tracing::warn!(
                    session_id = %session_id,
                    error = %e,
                    "create_adoption_session: recipe_ref hydration failed; proceeding with un-hydrated payload"
                );
            }

            if crate::engine::template_v3::is_v3_shape(&payload) {
                crate::engine::template_v3::normalize_v3_to_flat(&mut payload);
                tracing::info!(
                    session_id = %session_id,
                    "create_adoption_session: normalized v3 template shape to flat AgentIr"
                );
                serde_json::to_string(&payload).unwrap_or(agent_ir_json)
            } else {
                serde_json::to_string(&payload).unwrap_or(agent_ir_json)
            }
        }
        Err(_) => agent_ir_json,
    };

    let conn = state.db.get()?;
    conn.execute(
        "INSERT INTO build_sessions (id, persona_id, phase, resolved_cells, intent, agent_ir, created_at, updated_at)
         VALUES (?1, ?2, 'draft_ready', ?3, ?4, ?5, ?6, ?6)",
        rusqlite::params![session_id, persona_id, cells, intent, normalized_agent_ir_json, now],
    )?;

    tracing::info!(
        session_id = %session_id,
        persona_id = %persona_id,
        "create_adoption_session: created session for template adoption testing"
    );

    Ok(session_id)
}

/// Persist adoption questionnaire answers for a build session.
///
/// Called by the frontend after the user completes the adoption questionnaire.
/// The answers are stored in `build_sessions.adoption_answers` and applied to
/// the `AgentIr` during `test_build_draft` and `promote_build_draft_inner` via
/// `adoption_answers::substitute_variables` + `inject_configuration_section`.
#[tauri::command]
pub async fn save_adoption_answers(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    adoption_answers_json: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;

    build_session_repo::update(
        &state.db,
        &session_id,
        &UpdateBuildSession {
            adoption_answers: Some(Some(adoption_answers_json)),
            ..Default::default()
        },
    )?;

    tracing::info!(session_id = %session_id, "save_adoption_answers: persisted adoption answers");
    Ok(())
}

/// Send a user answer to a pending question in a build session.
///
/// When `reference` is supplied (C7 — clarifying questions with
/// `accepts_reference: true`), the file / URL / inline content is
/// resolved server-side, fenced via
/// `engine::build_session::reference::inject_reference_into_answer`,
/// and prepended to `answer` before piping to the CLI subprocess. This
/// keeps the CLI-side prompt schema unchanged — the LLM sees one text
/// answer with the reference embedded.
#[tauri::command]
pub async fn answer_build_question(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    cell_key: String,
    answer: String,
    reference: Option<crate::db::models::UserAnswerReference>,
    webhook_source: Option<crate::db::models::UserWebhookSource>,
) -> Result<(), AppError> {
    require_auth(&state).await?;

    // Step 1 — resolve any reference attachment, fence its contents into
    // the answer text. Existing C7 path; unchanged.
    let mut resolved_answer = if let Some(ref r) = reference {
        let source = if let Some(ref p) = r.path {
            crate::engine::build_session::reference::ReferenceSource::File(p.as_str())
        } else if let Some(ref u) = r.url {
            crate::engine::build_session::reference::ReferenceSource::Url(u.as_str())
        } else if let Some(ref c) = r.inline_content {
            crate::engine::build_session::reference::ReferenceSource::Inline {
                name: r.name.as_deref().unwrap_or(""),
                content: c.as_str(),
            }
        } else {
            return Err(AppError::Validation(
                "Reference attachment must include one of path / url / inlineContent".to_string(),
            ));
        };

        let (resolved_name, resolved_content) =
            crate::engine::build_session::reference::materialise_reference(source).await?;

        // Honour the caller's preferred display name when given (overrides
        // the fetcher's default — e.g. file basename or URL).
        let display_name = r
            .name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or(resolved_name);

        crate::engine::build_session::reference::inject_reference_into_answer(
            &answer,
            &display_name,
            &resolved_content,
        )
    } else {
        answer
    };

    // Step 2 — when the user attached a webhook source via the typed
    // payload, validate the URL and append a fenced WEBHOOK SOURCE block
    // to the answer text so the LLM places it on the trigger config's
    // `smee_channel_url` field per session_prompt rule 24.
    if let Some(ref ws) = webhook_source {
        let url = ws.channel_url.trim();
        if !url.starts_with("https://smee.io/") {
            return Err(AppError::Validation(
                "Webhook source channelUrl must start with https://smee.io/".to_string(),
            ));
        }
        resolved_answer = crate::engine::build_session::reference::append_webhook_source_fence(
            &resolved_answer,
            url,
            ws.event_filter.as_deref(),
        );
    }

    let user_answer = UserAnswer {
        cell_key,
        answer: resolved_answer,
        reference,
        webhook_source,
    };
    state
        .build_session_manager
        .send_answer(&session_id, user_answer)
}

/// Reset a build session to draft_ready phase (e.g., after test rejection for retry).
#[tauri::command]
pub async fn reset_build_session_phase(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;

    build_session_repo::update(
        &state.db,
        &session_id,
        &UpdateBuildSession {
            phase: Some(BuildPhase::DraftReady.as_str().to_string()),
            ..Default::default()
        },
    )?;
    Ok(())
}

/// Cancel an active build session.
#[tauri::command]
pub async fn cancel_build_session(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;

    state
        .build_session_manager
        .cancel_session(&session_id, &state.db, &state.process_registry)
}

/// Read the currently pending clarifying question on a build session, if any.
///
/// Returns the parsed JSON question payload (a `clarifying_question` shape —
/// scope, question text, options, optional connector_category, etc.) or
/// `None` when the session has no question pending. Used by the in-app
/// Companion chat (and the future external MCP wrapper) to inspect the
/// session state without subscribing to the event stream.
#[tauri::command]
pub async fn list_pending_build_questions(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<Option<serde_json::Value>, AppError> {
    require_auth(&state).await?;

    let session = build_session_repo::get_by_id(&state.db, &session_id)?
        .ok_or_else(|| AppError::NotFound(format!("Build session {session_id}")))?;

    Ok(session
        .pending_question
        .as_deref()
        .and_then(|q| serde_json::from_str::<serde_json::Value>(q).ok()))
}

/// Aggregated read-only snapshot of a build session for headless / Companion
/// callers that want to poll progress without subscribing to the event
/// stream. Combines phase, mode, pending question, resolved cells, and a
/// derived `is_terminal` flag in one call.
#[tauri::command]
pub async fn get_build_status(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;

    let session = build_session_repo::get_by_id(&state.db, &session_id)?
        .ok_or_else(|| AppError::NotFound(format!("Build session {session_id}")))?;

    let pending_question = session
        .pending_question
        .as_deref()
        .and_then(|q| serde_json::from_str::<serde_json::Value>(q).ok());
    let resolved_cells: serde_json::Value =
        serde_json::from_str(&session.resolved_cells).unwrap_or_default();

    Ok(serde_json::json!({
        "sessionId": session.id,
        "personaId": session.persona_id,
        "phase": session.phase.as_str(),
        "isTerminal": session.phase.is_terminal(),
        "mode": session.mode.unwrap_or_else(|| "interactive".to_string()),
        "companionSessionId": session.companion_session_id,
        "intent": session.intent,
        "pendingQuestion": pending_question,
        "resolvedCells": resolved_cells,
        "agentIrPresent": session.agent_ir.is_some(),
        "errorMessage": session.error_message,
        "createdAt": session.created_at,
        "updatedAt": session.updated_at,
    }))
}

/// Get the active (non-terminal) build session for a persona, if any.
/// Returns a frontend-friendly representation with parsed JSON fields.
#[tauri::command]
pub async fn get_active_build_session(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Option<PersistedBuildSession>, AppError> {
    require_auth(&state).await?;

    let session = build_session_repo::get_active_for_persona(&state.db, &persona_id)?;
    Ok(session.as_ref().map(PersistedBuildSession::from_session))
}

/// Get the most recent build session for a persona, regardless of phase.
/// Unlike `get_active_build_session`, this includes promoted/completed sessions
/// so the frontend can access resolved_cells for the agent matrix display.
#[tauri::command]
pub async fn get_latest_build_session(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Option<PersistedBuildSession>, AppError> {
    require_auth(&state).await?;

    let session = build_session_repo::get_latest_for_persona(&state.db, &persona_id)?;
    Ok(session.as_ref().map(PersistedBuildSession::from_session))
}

/// List non-terminal build sessions, optionally filtered by persona_id.
#[tauri::command]
pub async fn list_build_sessions(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
) -> Result<Vec<PersistedBuildSession>, AppError> {
    require_auth(&state).await?;

    let sessions = build_session_repo::list_non_terminal(&state.db, persona_id.as_deref())?;
    Ok(sessions
        .iter()
        .map(PersistedBuildSession::from_session)
        .collect())
}

/// Test a build draft by executing each tool against its real API.
///
/// Loads the build session, extracts tools from agent_ir, and runs each tool
/// via `invoke_tool_direct()` with resolved credentials. Returns a per-tool
/// test report with HTTP status codes, latency, and error classification.
#[tauri::command]
pub async fn test_build_draft(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    session_id: String,
    persona_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;

    // A-grade Phase 3 (2026-05-03): brief server-side retry to close the
    // agent_ir-landing race. Pre-Phase-3 the client-side rapid-validation
    // driver had to poll for up to 180s because the LLM's agent_ir
    // CellUpdate write could lag the phase-transition event the frontend
    // observes. Retry the session+persona load up to 3s before falling
    // back to the legacy "no agent_ir" error path.
    let mut session = build_session_repo::get_by_id(&state.db, &session_id)?
        .ok_or_else(|| AppError::NotFound(format!("Build session {session_id}")))?;

    session
        .phase
        .validate_transition(BuildPhase::Testing)
        .map_err(AppError::Validation)?;

    // Parse agent_ir — try session first, fall back to persona's last_design_result.
    // If BOTH are absent, retry briefly: the agent_ir CellUpdate write
    // could be in-flight from runner.rs's event loop. Up to 6 polls × 500ms = 3s.
    let mut agent_ir_str: Option<String> = session.agent_ir.clone();
    let mut design_result_str: Option<String> = None;
    if agent_ir_str.is_none() {
        let mut persona = persona_repo::get_by_id(&state.db, &persona_id)?;
        design_result_str = persona.last_design_result.clone();
        if design_result_str.is_none() {
            tracing::info!(
                session_id = %session_id,
                persona_id = %persona_id,
                "agent_ir + last_design_result both absent — entering brief retry window"
            );
            for attempt in 1..=6u32 {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                if let Some(s) = build_session_repo::get_by_id(&state.db, &session_id)? {
                    if s.agent_ir.is_some() {
                        tracing::info!(
                            session_id = %session_id,
                            attempt,
                            "agent_ir landed during retry"
                        );
                        agent_ir_str = s.agent_ir.clone();
                        session = s;
                        break;
                    }
                    session = s;
                }
                persona = persona_repo::get_by_id(&state.db, &persona_id)?;
                if persona.last_design_result.is_some() {
                    tracing::info!(
                        session_id = %session_id,
                        attempt,
                        "last_design_result landed during retry"
                    );
                    design_result_str = persona.last_design_result.clone();
                    break;
                }
            }
        }
    }

    let mut agent_ir: crate::db::models::AgentIr = if let Some(ref raw) = agent_ir_str {
        serde_json::from_str(raw).map_err(|e| {
            tracing::error!(session_id = %session_id, error = %e, raw_len = raw.len(), "Failed to parse agent_ir");
            AppError::Validation(format!("Build session agent_ir parse error: {e}"))
        })?
    } else if let Some(design_result) = design_result_str {
        tracing::warn!(session_id = %session_id, persona_id = %persona_id, "Session agent_ir is null, using persona last_design_result");
        let ir: crate::db::models::AgentIr = serde_json::from_str(&design_result)
            .map_err(|e| AppError::Validation(format!("Persona design result parse error: {e}")))?;
        // Backfill the session so future calls work
        if let Err(e) = build_session_repo::update(
            &state.db,
            &session_id,
            &UpdateBuildSession {
                agent_ir: Some(Some(design_result.clone())),
                ..Default::default()
            },
        ) {
            tracing::warn!(
                session_id = %session_id,
                error = %e,
                "Failed to backfill session.agent_ir from last_design_result"
            );
        }
        ir
    } else {
        return Err(AppError::Validation(
            "Build session has no agent_ir and persona has no design result \
             (waited 3s for late LLM emit). The build may have failed earlier; \
             check the build session log."
                .to_string(),
        ));
    };

    // Apply adoption questionnaire answers: variable substitution + configuration section.
    // This ensures the test runs with the user's actual configured values, not template placeholders.
    // Fail loudly on parse error — silently skipping leaves the test running on raw `{{placeholder}}`
    // values and dangling credential refs, which produces a cascade of API failures the LLM cannot
    // diagnose because the IR is structurally fine — only the inputs were garbage.
    if let Some(ref raw_answers) = session.adoption_answers {
        match serde_json::from_str::<crate::engine::adoption_answers::AdoptionAnswers>(raw_answers)
        {
            Ok(answers) => {
                crate::engine::adoption_answers::substitute_variables(&mut agent_ir, &answers);
                crate::engine::adoption_answers::inject_configuration_section(
                    &mut agent_ir,
                    &answers,
                );
                crate::engine::adoption_answers::apply_credential_bindings_to_connectors(
                    &mut agent_ir,
                    &answers,
                );
                tracing::info!(session_id = %session_id, answer_count = answers.answers.len(), binding_count = answers.credential_bindings.len(), "Applied adoption answers to agent_ir for testing");
            }
            Err(e) => {
                tracing::error!(
                    session_id = %session_id,
                    error = %e,
                    "Failed to parse build_sessions.adoption_answers as AdoptionAnswers — refusing to run test against template placeholders"
                );
                return Err(AppError::Validation(format!(
                    "build_sessions.adoption_answers is corrupt and could not be parsed ({e}). \
                     Re-run the adoption questionnaire to regenerate the answers, or clear the \
                     field if you intend to test without user values."
                )));
            }
        }
    }

    // Transition to testing phase
    build_session_repo::update(
        &state.db,
        &session_id,
        &UpdateBuildSession {
            phase: Some(BuildPhase::Testing.as_str().to_string()),
            ..Default::default()
        },
    )?;

    // Run real API tests — on failure, revert to draft_ready so the user can retry
    let result =
        build_session_engine::run_tool_tests(&state.db, &app, &session_id, &persona_id, &agent_ir)
            .await;

    match result {
        Ok(report) => {
            // Persist the report to personas.last_test_report so the
            // TestReportModal can render it after promote (A-grade Phase 2,
            // 2026-05-03). Pre-Phase-2 the report was returned inline only;
            // navigating away dropped it. Best-effort write — a serialize
            // failure here should not block the test_complete transition,
            // since the in-flight bridge response still carries the report
            // for the active session.
            match serde_json::to_string(&report) {
                Ok(report_json) => {
                    if let Err(e) = persona_repo::update(
                        &state.db,
                        &persona_id,
                        crate::db::models::UpdatePersonaInput {
                            last_test_report: Some(Some(report_json)),
                            ..Default::default()
                        },
                    ) {
                        tracing::warn!(
                            persona_id = %persona_id,
                            session_id = %session_id,
                            error = %e,
                            "Failed to persist last_test_report; report still returned inline"
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        session_id = %session_id,
                        error = %e,
                        "Failed to serialize test report for persistence; returning inline only"
                    );
                }
            }

            // Transition to test_complete
            build_session_repo::update(
                &state.db,
                &session_id,
                &UpdateBuildSession {
                    phase: Some(BuildPhase::TestComplete.as_str().to_string()),
                    ..Default::default()
                },
            )?;
            Ok(report)
        }
        Err(e) => {
            // Revert to draft_ready so the session isn't stuck in testing
            let _ = build_session_repo::update(
                &state.db,
                &session_id,
                &UpdateBuildSession {
                    phase: Some(BuildPhase::DraftReady.as_str().to_string()),
                    error_message: Some(Some(e.to_string())),
                    ..Default::default()
                },
            );
            Err(e)
        }
    }
}

/// Promote a tested build draft to production.
///
/// Creates ALL records the Editor tabs expect from agent_ir:
/// - PersonaToolDefinition with input/output schemas
/// - PersonaTrigger linked to use cases
/// - PersonaEventSubscription from events dimension
/// - DesignContextData-format design_context with structured DesignUseCase entries
/// - AgentIR-compatible last_design_result for Design tab preview
/// - Notification channels on persona
/// Promote a tested build draft.
///
/// `excluded_use_case_ids` (A-grade Phase 5b, 2026-05-03): capability
/// ids the user chose to exclude via the preview panel. Match against
/// the LLM-emitted Structured-variant id (e.g. `uc_morning_digest`),
/// not the post-promote UUID-rekeyed id which doesn't exist yet.
/// Simple-variant capabilities have no id and pass through unchanged.
/// `None` or empty list means "promote everything in agent_ir".
#[tauri::command]
pub async fn promote_build_draft(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    persona_id: String,
    excluded_use_case_ids: Option<Vec<String>>,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    promote_build_draft_inner(
        &state,
        session_id,
        persona_id,
        excluded_use_case_ids.unwrap_or_default(),
    )
    .await
}

// ============================================================================
// Promote helper types
// ============================================================================

/// Pre-computed tool action: either reuse an existing definition or create a new one.
struct ToolAction {
    name: String,
    existing_def_id: Option<String>,
    create_input: Option<CreateToolDefinitionInput>,
}

/// Structured use cases extracted from agent IR, ready for design_context.
struct UseCaseData {
    structured: Vec<serde_json::Value>,
    ids: Vec<String>,
}

/// All data assembled before the transaction begins.
#[allow(dead_code)]
struct PromotePreparation {
    use_cases: UseCaseData,
    tool_actions: Vec<ToolAction>,
    tool_names: Vec<String>,
    design_context_str: String,
    design_result_str: String,
    notification_channels: Option<String>,
    connectors_needing_setup: Vec<String>,
}

/// Mutable counters tracked during the transaction.
#[allow(dead_code)]
struct PromoteCounters {
    tools_created: u32,
    triggers_created: u32,
    subscriptions_created: u32,
    created_trigger_ids: Vec<String>,
}

// ============================================================================
// Step 1: Build structured DesignUseCase[] from agent_ir
// ============================================================================

fn build_structured_use_cases(ir: &crate::db::models::AgentIr) -> UseCaseData {
    if ir.use_cases.is_empty() {
        return UseCaseData {
            structured: Vec::new(),
            ids: Vec::new(),
        };
    }

    let mut structured = Vec::new();
    let mut ids = Vec::new();

    for (idx, uc) in ir.use_cases.iter().enumerate() {
        let uc_id = format!("uc-{}", uuid::Uuid::new_v4());

        let title = uc.title().to_string();
        let description = uc.description().to_string();
        let category = uc.category().to_string();
        let execution_mode = uc.execution_mode().to_string();

        let suggested_trigger = ir.triggers.get(idx).map(|t| {
            serde_json::json!({
                "type": t.trigger_type.as_deref().unwrap_or("manual"),
                "cron": t.config.as_ref().and_then(|c| c.get("cron")).and_then(|v| v.as_str()),
                "description": t.description.as_deref().unwrap_or(""),
            })
        });

        // Extract per-use-case event subscriptions via typed accessor.
        let event_subs: Vec<serde_json::Value> = uc
            .event_subscriptions()
            .iter()
            .filter_map(|e| {
                let event_type = e.event_type.as_deref().unwrap_or("");
                if event_type.is_empty() {
                    return None;
                }
                Some(serde_json::json!({
                    "event_type": event_type,
                    "source_filter": e.source_filter.as_deref(),
                    "enabled": true,
                }))
            })
            .collect();

        let error_handling = uc.error_handling().to_string();

        // Per-UC model override carried through so the runner's failover
        // chain can seed the primary model from the capability-specific
        // preference. Shape: null | string ("haiku") | full ModelProfile obj.
        //
        // C7 — also carry through review_policy / generation_settings /
        // memory_policy so the dispatch layer's `pick_generation_policy`
        // can route `mode: "auto_triage"` to the second-pass evaluator
        // (auto_triage.rs). Without these fields the runtime falls back
        // to permissive defaults regardless of what the build LLM
        // declared per build prompt rules 16d / 21.
        let (model_override, model_rationale, review_policy, generation_settings, memory_policy) =
            match uc {
                crate::db::models::agent_ir::AgentIrUseCase::Structured(d) => (
                    d.model_override.clone(),
                    // Normalize empty rationale strings to None so the UI never
                    // renders an empty tooltip just because the LLM emitted "".
                    d.model_rationale
                        .as_ref()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty()),
                    d.review_policy.clone(),
                    d.generation_settings.clone(),
                    d.memory_policy.clone(),
                ),
                crate::db::models::agent_ir::AgentIrUseCase::Simple(_) => {
                    (None, None, None, None, None)
                }
            };

        structured.push(serde_json::json!({
            "id": uc_id,
            "title": title,
            "description": description,
            "category": category,
            "execution_mode": execution_mode,
            "suggested_trigger": suggested_trigger,
            "event_subscriptions": event_subs,
            "error_handling": error_handling,
            "model_override": model_override,
            "model_rationale": model_rationale,
            "review_policy": review_policy,
            "generation_settings": generation_settings,
            "memory_policy": memory_policy,
        }));
        ids.push(uc_id);
    }

    UseCaseData { structured, ids }
}

// ============================================================================
// Step 2: Prepare tool actions (resolve existing vs new definitions)
// ============================================================================

fn prepare_tool_actions(
    ir: &crate::db::models::AgentIr,
    db: &crate::db::DbPool,
    all_connectors: &[ConnectorDefinition],
) -> (Vec<ToolAction>, Vec<String>) {
    use crate::db::models::agent_ir::AgentIrTool;

    let mut tool_actions = Vec::new();
    let mut tool_names = Vec::new();
    let mut seen_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    let default_schema = r#"{"type":"object","properties":{},"additionalProperties":true}"#;

    // Pre-extract the first connector from the agent IR for generic tool linkage.
    // Generic tools like "http_request" are transport utilities that don't inherently
    // know which API they serve — the agent's connectors define that.
    let ir_primary_connector: Option<String> = ir
        .required_connectors
        .first()
        .and_then(|c| c.name().map(|n| n.to_string()));

    for tool in &ir.tools {
        let name = tool.name().to_string();
        if name.is_empty() {
            continue;
        }

        let normalized: String = name
            .chars()
            .enumerate()
            .fold(String::new(), |mut acc, (i, c)| {
                if c.is_uppercase() && i > 0 {
                    acc.push('_');
                }
                acc.push(c.to_ascii_lowercase());
                acc
            });

        if !seen_names.insert(normalized.clone()) {
            continue;
        }
        tool_names.push(name.clone());

        // Try to find an existing tool definition by name
        let existing_def = tool_repo::get_definition_by_name(db, &normalized)
            .ok()
            .flatten()
            .or_else(|| tool_repo::get_definition_by_name(db, &name).ok().flatten());

        if let Some(def) = existing_def {
            tool_actions.push(ToolAction {
                name,
                existing_def_id: Some(def.id),
                create_input: None,
            });
            continue;
        }

        let (category, description, input_schema, output_schema, req_cred, impl_guide) = match tool
        {
            AgentIrTool::Structured(d) => {
                let is = d
                    .input_schema
                    .as_ref()
                    .map(|v| serde_json::to_string(v).unwrap_or_default())
                    .or_else(|| {
                        d.parameters.as_ref().map(|p| {
                            serde_json::json!({"type": "object", "properties": p}).to_string()
                        })
                    })
                    .or_else(|| Some(default_schema.to_string()));
                let os = d
                    .output_schema
                    .as_ref()
                    .map(|v| serde_json::to_string(v).unwrap_or_default())
                    .or_else(|| Some(default_schema.to_string()));
                (
                    d.category.as_deref().unwrap_or("api").to_string(),
                    d.description.as_deref().unwrap_or("").to_string(),
                    is,
                    os,
                    d.requires_credential_type.clone(),
                    d.implementation_guide.clone(),
                )
            }
            AgentIrTool::Simple(_) => {
                let inferred_cred = infer_credential_type(&normalized, all_connectors);
                (
                    "api".to_string(),
                    format!("Auto-created from build: {}", name),
                    Some(default_schema.to_string()),
                    Some(default_schema.to_string()),
                    inferred_cred,
                    None,
                )
            }
        };

        // For generic transport tools (http_request, etc.), fall back to the agent's
        // primary connector when name-based inference fails. This bridges the gap
        // between "http_request" and "alpha_vantage" in template-adopted agents.
        let effective_req_cred = req_cred
            .or_else(|| infer_credential_type(&normalized, all_connectors))
            .or_else(|| {
                if GENERIC_TOOL_NAMES.contains(&normalized.as_str()) {
                    ir_primary_connector.clone()
                } else {
                    None
                }
            });

        tool_actions.push(ToolAction {
            name,
            existing_def_id: None,
            create_input: Some(CreateToolDefinitionInput {
                name: normalized,
                category,
                description,
                script_path: String::new(),
                input_schema,
                output_schema,
                requires_credential_type: effective_req_cred,
                implementation_guide: impl_guide,
                is_builtin: Some(false),
            }),
        });
    }

    // Auto-register built-in drive tools for drive-using personas. Prefer
    // existing definitions (idempotent across rebuilds) — only create fresh
    // rows the first time a workspace sees them.
    if persona_uses_drive(ir) {
        for (tool_name, tool_desc) in DRIVE_BUILTIN_TOOLS {
            if !seen_names.insert((*tool_name).to_string()) {
                continue;
            }
            let existing_def = tool_repo::get_definition_by_name(db, tool_name)
                .ok()
                .flatten();
            tool_names.push((*tool_name).to_string());
            if let Some(def) = existing_def {
                tool_actions.push(ToolAction {
                    name: (*tool_name).to_string(),
                    existing_def_id: Some(def.id),
                    create_input: None,
                });
            } else {
                tool_actions.push(ToolAction {
                    name: (*tool_name).to_string(),
                    existing_def_id: None,
                    create_input: Some(CreateToolDefinitionInput {
                        name: (*tool_name).to_string(),
                        category: "drive".to_string(),
                        description: (*tool_desc).to_string(),
                        script_path: String::new(),
                        input_schema: Some(default_schema.to_string()),
                        output_schema: Some(default_schema.to_string()),
                        requires_credential_type: None,
                        implementation_guide: None,
                        is_builtin: Some(true),
                    }),
                });
            }
        }
    }

    (tool_actions, tool_names)
}

// ============================================================================
// Step 2b: Auto-fill missing webhook secrets
// ============================================================================

/// Ensure every webhook trigger has a `webhook_secret` in its config.
/// Templates and adoption flows generate webhook triggers without a secret
/// because the user has no UI to provide one pre-promotion. Rather than
/// blocking promotion, we auto-generate a random secret.
fn ensure_webhook_secrets(ir: &mut crate::db::models::AgentIr) {
    for t in &mut ir.triggers {
        if t.trigger_type.as_deref() != Some("webhook") {
            continue;
        }

        let needs_secret = match &t.config {
            None => true,
            Some(cfg) => {
                let secret = cfg
                    .get("webhook_secret")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                secret.trim().is_empty()
            }
        };

        if needs_secret {
            let generated = uuid::Uuid::new_v4().to_string();
            let config = t.config.get_or_insert_with(|| serde_json::json!({}));
            if let Some(obj) = config.as_object_mut() {
                obj.insert(
                    "webhook_secret".to_string(),
                    serde_json::Value::String(generated.clone()),
                );
            }
            tracing::info!(
                "Auto-generated webhook_secret for webhook trigger (description: {:?})",
                t.description
            );
        }
    }
}

// ============================================================================
// Step 2c: Normalize agent icon to "agent-icon:<catalog_id>" format
// ============================================================================

/// The 20-icon catalog — MUST stay in sync with `src/lib/icons/agentIconCatalog.ts`.
/// Tuple: (id, suggested_hex_color).
const AGENT_ICON_CATALOG: &[(&str, &str)] = &[
    ("assistant", "#8b5cf6"),
    ("code", "#06b6d4"),
    ("data", "#3b82f6"),
    ("security", "#ef4444"),
    ("monitor", "#f59e0b"),
    ("email", "#ec4899"),
    ("document", "#a78bfa"),
    ("support", "#14b8a6"),
    ("automation", "#f97316"),
    ("research", "#6366f1"),
    ("finance", "#22c55e"),
    ("marketing", "#e879f9"),
    ("devops", "#0ea5e9"),
    ("content", "#c084fc"),
    ("sales", "#fb923c"),
    ("hr", "#4ade80"),
    ("legal", "#94a3b8"),
    ("notification", "#fbbf24"),
    ("calendar", "#2dd4bf"),
    ("search", "#818cf8"),
];

/// Normalize `ir.icon` to `agent-icon:<catalog_id>` — the only icon shape the
/// frontend renderers (PersonaIcon, PersonaAvatar) can handle. The build LLM
/// historically returns Lucide PascalCase names ("Mail", "Database") which
/// render as literal text in the avatar and as a default robot in PersonaIcon.
///
/// Resolution order (first match wins):
///   1. Already `agent-icon:<valid id>` → keep
///   2. Bare catalog id (case-insensitive) → prepend prefix
///   3. Known Lucide PascalCase → mapped catalog id
///   4. Dominant connector in `ir.required_connectors` → mapped id
///   5. Keyword scan of `ir.name` + `ir.description` → mapped id
///   6. Fallback `assistant`
///
/// Also fills `ir.color` from the catalog's suggested color when empty, so
/// the snapshot and persona row get a consistent theme-aware accent.
fn normalize_agent_icon(ir: &mut crate::db::models::AgentIr) {
    const PREFIX: &str = "agent-icon:";

    fn lookup_catalog(id: &str) -> Option<&'static str> {
        AGENT_ICON_CATALOG
            .iter()
            .find(|(x, _)| *x == id)
            .map(|(x, _)| *x)
    }

    fn catalog_color(id: &str) -> Option<&'static str> {
        AGENT_ICON_CATALOG
            .iter()
            .find(|(x, _)| *x == id)
            .map(|(_, c)| *c)
    }

    // Lucide PascalCase name → nearest catalog id.
    fn lucide_to_id(name: &str) -> Option<&'static str> {
        match name {
            "Mail" | "MailOpen" | "AtSign" | "Send" | "Inbox" => Some("email"),
            "Database" | "BarChart" | "BarChart2" | "BarChart3" | "PieChart" | "LineChart"
            | "Table" | "Table2" => Some("data"),
            "MessageSquare" | "MessageCircle" | "MessagesSquare" | "Bot" => Some("assistant"),
            "Code" | "Code2" | "GitBranch" | "GitCommit" | "GitPullRequest" | "Github"
            | "Terminal" | "TerminalSquare" => Some("code"),
            "FileText" | "FileCode" | "File" | "Files" | "BookOpen" | "Book" | "Notebook"
            | "NotebookText" => Some("document"),
            "Bell" | "BellRing" | "BellDot" => Some("notification"),
            "Calendar" | "CalendarDays" | "CalendarCheck" | "CalendarClock" | "Clock" | "Timer" => {
                Some("calendar")
            }
            "Search" | "SearchCheck" | "ScanSearch" | "Binoculars" => Some("search"),
            "Shield" | "ShieldCheck" | "ShieldAlert" | "Lock" | "KeyRound" | "Key" => {
                Some("security")
            }
            "DollarSign" | "CircleDollarSign" | "Banknote" | "Wallet" | "CreditCard"
            | "Receipt" => Some("finance"),
            "Users" | "UserPlus" | "UserCheck" | "User" | "UserCog" => Some("hr"),
            "Briefcase" | "Scale" | "Gavel" | "FileSignature" => Some("legal"),
            "Megaphone" | "Speaker" | "Sparkles" | "Palette" | "Image" | "Camera" => {
                Some("marketing")
            }
            "Zap" | "Workflow" | "Cog" | "Settings" | "Settings2" => Some("automation"),
            "Activity" | "Gauge" | "Heart" | "HeartPulse" => Some("monitor"),
            "Headphones" | "LifeBuoy" | "HelpCircle" => Some("support"),
            "Server" | "Cloud" | "CloudCog" | "Container" | "Boxes" => Some("devops"),
            "Flask" | "FlaskConical" | "Microscope" | "Lightbulb" | "GraduationCap" => {
                Some("research")
            }
            "ShoppingCart" | "ShoppingBag" | "Store" | "TrendingUp" | "Target" => Some("sales"),
            "Edit" | "Edit2" | "Edit3" | "Pen" | "PenTool" | "PenLine" | "Type" => Some("content"),
            _ => None,
        }
    }

    // Connector service name → catalog id (lowercase substring match).
    fn connector_to_id(name: &str) -> Option<&'static str> {
        let n = name.to_lowercase();
        let c = |needle: &str| n.contains(needle);
        if c("gmail") || c("outlook") || c("mailgun") || c("sendgrid") || c("mailchimp") {
            return Some("email");
        }
        if c("github") || c("gitlab") || c("bitbucket") {
            return Some("code");
        }
        if c("notion") || c("confluence") {
            return Some("document");
        }
        if c("airtable")
            || c("postgres")
            || c("mysql")
            || c("supabase")
            || c("sheets")
            || c("bigquery")
        {
            return Some("data");
        }
        if c("slack") || c("discord") || c("telegram") || c("teams") || c("whatsapp") {
            return Some("assistant");
        }
        if c("stripe") || c("quickbooks") || c("xero") || c("plaid") {
            return Some("finance");
        }
        if c("hubspot") || c("salesforce") || c("pipedrive") || c("attio") {
            return Some("sales");
        }
        if c("sentry") || c("datadog") || c("newrelic") || c("grafana") {
            return Some("monitor");
        }
        if c("jira") || c("linear") || c("asana") || c("clickup") || c("trello") {
            return Some("devops");
        }
        if c("google-calendar") || c("google_calendar") || c("calcom") || c("calendly") {
            return Some("calendar");
        }
        if c("zendesk") || c("intercom") || c("freshdesk") {
            return Some("support");
        }
        if c("greenhouse") || c("workday") || c("lever") {
            return Some("hr");
        }
        if c("docusign") || c("hellosign") {
            return Some("legal");
        }
        None
    }

    // Keyword scan mirrors `src/lib/icons/autoAssignIcons.ts` KEYWORD_MAP — order matters (first match wins).
    fn keyword_scan(text: &str) -> Option<&'static str> {
        let t = text.to_lowercase();
        let any = |kws: &[&str]| kws.iter().any(|kw| t.contains(kw));
        if any(&["developer", "codebase", "feature flag", "source code"]) {
            return Some("code");
        }
        if any(&["devops", "sentry", "infrastructure", "deploy", "incident"]) {
            return Some("devops");
        }
        if any(&["security", "vulnerability", "sentinel"]) {
            return Some("security");
        }
        if any(&["monitor", "watchdog", "health check"]) {
            return Some("monitor");
        }
        if any(&["email", "inbox", "mail", "digest", "newsletter"]) {
            return Some("email");
        }
        if any(&["document", "documentation", "knowledge base", "wiki"]) {
            return Some("document");
        }
        if any(&[
            "support",
            "helpdesk",
            "ticket",
            "escalation",
            "customer service",
        ]) {
            return Some("support");
        }
        if any(&["automat", "workflow", "orchestrat"]) {
            return Some("automation");
        }
        if any(&["research", "intelligence", "analyst", "insight", "scout"]) {
            return Some("research");
        }
        if any(&[
            "finance",
            "invoice",
            "expense",
            "budget",
            "billing",
            "revenue",
            "accounting",
            "payment",
        ]) {
            return Some("finance");
        }
        if any(&["marketing", "campaign", "seo", "content distribution"]) {
            return Some("marketing");
        }
        if any(&["editorial", "blog", "writer"]) {
            return Some("content");
        }
        if any(&["sales", "crm", "proposal", "outbound"]) {
            return Some("sales");
        }
        if any(&["recruit", "onboard", "hiring", "employee"]) {
            return Some("hr");
        }
        if any(&["legal", "contract", "compliance", "regulation"]) {
            return Some("legal");
        }
        if any(&["notification", "webhook"]) {
            return Some("notification");
        }
        if any(&["calendar", "schedule", "meeting", "appointment", "deadline"]) {
            return Some("calendar");
        }
        if any(&["search", "discover", "explore", "lookup"]) {
            return Some("search");
        }
        if any(&["data", "analytics", "chart", "metric", "dashboard"]) {
            return Some("data");
        }
        None
    }

    // ---- Resolve the canonical catalog id ----
    let resolved_id: &'static str = 'resolve: {
        if let Some(raw) = ir
            .icon
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
        {
            // Case 1: already `agent-icon:<valid id>`
            if let Some(rest) = raw.strip_prefix(PREFIX) {
                if let Some(id) = lookup_catalog(rest) {
                    break 'resolve id;
                }
            }
            // Case 2: bare catalog id (case-insensitive)
            let lower = raw.to_lowercase();
            if let Some(id) = lookup_catalog(&lower) {
                break 'resolve id;
            }
            // Case 3: Lucide PascalCase name
            if let Some(id) = lucide_to_id(raw) {
                break 'resolve id;
            }
        }
        // Case 4: dominant connector
        if let Some(id) = ir
            .required_connectors
            .iter()
            .find_map(|c| c.name().and_then(connector_to_id))
        {
            break 'resolve id;
        }
        // Case 5: keyword scan of name + description
        let text = format!(
            "{} {}",
            ir.name.as_deref().unwrap_or(""),
            ir.description.as_deref().unwrap_or(""),
        );
        keyword_scan(&text).unwrap_or("assistant")
    };

    let previous = ir.icon.clone();
    ir.icon = Some(format!("{}{}", PREFIX, resolved_id));

    // Backfill color from catalog if empty
    let color_empty = ir
        .color
        .as_deref()
        .map(|s| s.trim().is_empty())
        .unwrap_or(true);
    if color_empty {
        if let Some(col) = catalog_color(resolved_id) {
            ir.color = Some(col.to_string());
        }
    }

    if previous.as_deref() != ir.icon.as_deref() {
        tracing::info!(
            previous = ?previous,
            resolved = %resolved_id,
            "normalize_agent_icon: rewrote persona icon to catalog id"
        );
    }
}

// ============================================================================
// Step 3: Validate triggers before the transaction
// ============================================================================

fn validate_triggers(ir: &crate::db::models::AgentIr) -> Result<(), AppError> {
    for t in &ir.triggers {
        let raw_type = t.trigger_type.as_deref().unwrap_or("manual");
        let trigger_type = trigger_repo::normalize_trigger_type(raw_type);
        let config_str = t
            .config
            .as_ref()
            .map(|v| serde_json::to_string(v).unwrap_or_default());
        trigger_repo::validate_trigger_type(trigger_type)?;
        trigger_repo::validate_config(trigger_type, config_str.as_deref())?;
    }
    Ok(())
}

// ============================================================================
// Step 4: Build design_context and design_result JSON
// ============================================================================

fn build_design_json(
    ir: &crate::db::models::AgentIr,
    structured_use_cases: &[serde_json::Value],
    tool_names: &[String],
) -> (String, String) {
    let ir_triggers: Option<&Vec<crate::db::models::agent_ir::AgentIrTrigger>> =
        if ir.triggers.is_empty() {
            None
        } else {
            Some(&ir.triggers)
        };
    let ir_events: Option<&Vec<crate::db::models::agent_ir::AgentIrEvent>> = if ir.events.is_empty()
    {
        None
    } else {
        Some(&ir.events)
    };
    let ir_use_cases_json: Vec<serde_json::Value> = ir
        .use_cases
        .iter()
        .filter_map(|uc| serde_json::to_value(uc).ok())
        .collect();

    let connectors = ir.effective_connectors_json();
    let summary = ir.design_summary();

    let design_context = serde_json::json!({
        "useCases": structured_use_cases,
        "summary": summary,
        "builderMeta": {
            "creationMethod": "matrix"
        }
    });

    let design_result = serde_json::json!({
        "suggested_tools": tool_names,
        "suggested_connectors": connectors,
        "suggested_triggers": ir_triggers.map(|t| serde_json::to_value(t).unwrap_or_default()),
        "structured_prompt": ir.structured_prompt.clone(),
        "full_prompt_markdown": ir.system_prompt.as_deref(),
        "suggested_event_subscriptions": ir_events.map(|e| serde_json::to_value(e).unwrap_or_default()),
        "suggested_notification_channels": ir.messages.clone(),
        "use_case_flows": ir_use_cases_json,
        "service_flow": serde_json::to_value(&ir.service_flow).unwrap_or_default(),
        // C7 — preserve the v3 persona block (mission, principles[],
        // constraints[], decision_principles[], etc.) so downstream
        // consumers like auto_triage's extract_principles_from_design_result
        // can read structured arrays without re-parsing prompt prose.
        "persona": ir.persona.clone(),
    });

    (
        serde_json::to_string(&design_context).unwrap_or_default(),
        serde_json::to_string(&design_result).unwrap_or_default(),
    )
}

// ============================================================================
// Step 5: Encrypt notification channels (pre-transaction)
// ============================================================================

fn prepare_notification_channels(
    ir: &crate::db::models::AgentIr,
) -> Result<Option<String>, AppError> {
    let channel_val = ir.notification_channel_array();
    let raw = channel_val.map(|v| serde_json::to_string(v).unwrap_or_default());
    match &raw {
        Some(json) if !json.trim().is_empty() => {
            Ok(Some(persona_repo::encrypt_notification_channels(json)?))
        }
        other => Ok(other.clone()),
    }
}

// ============================================================================
// Step 6: Identify connectors needing credential setup
// ============================================================================

fn find_connectors_needing_setup(ir: &crate::db::models::AgentIr) -> Vec<String> {
    use crate::db::models::agent_ir::AgentIrConnector;
    ir.required_connectors
        .iter()
        .filter(|c| match c {
            AgentIrConnector::Simple(_) => true, // simple string = no credential info
            AgentIrConnector::Structured(d) => !d.has_credential.unwrap_or(false),
        })
        .filter_map(|c| c.name().map(|n| n.to_string()))
        .collect()
}

/// Built-in local connectors that don't require a vault credential.
/// Mirrors the same list in commands::design::template_adopt.
const BUILTIN_LOCAL_CONNECTORS: &[&str] = &[
    "local_drive",
    "personas_database",
    "personas_messages",
    "personas_vector_db",
];

/// Given a list of connector names flagged as needing setup, prune those
/// that are either built-in locals OR have a matching vault credential.
/// Returns the actually-missing set so the promote step can decide whether
/// to mark the persona as `needs_credentials`. A vault lookup failure is
/// treated as "missing" — better to surface a warning than silently allow
/// a misconfigured persona to run.
fn vault_missing_connectors(
    pool: &crate::db::DbPool,
    flagged: &[String],
) -> Vec<String> {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return flagged.to_vec(),
    };
    let mut missing = Vec::new();
    for name in flagged {
        let n = name.trim();
        if n.is_empty() {
            continue;
        }
        if BUILTIN_LOCAL_CONNECTORS.iter().any(|b| b.eq_ignore_ascii_case(n)) {
            continue;
        }
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM persona_credentials WHERE LOWER(service_type) = LOWER(?1) LIMIT 1",
                rusqlite::params![n],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !exists {
            missing.push(n.to_string());
        }
    }
    missing
}

// ============================================================================
// Transaction: create tool definitions + assign to persona
// ============================================================================

fn create_tools_in_tx(
    tx: &rusqlite::Transaction<'_>,
    persona_id: &str,
    tool_actions: &[ToolAction],
    now: &str,
) -> Result<u32, AppError> {
    let mut tools_created = 0u32;

    for action in tool_actions {
        let def_id = if let Some(ref existing_id) = action.existing_def_id {
            existing_id.clone()
        } else if let Some(ref input) = action.create_input {
            if input.name.trim().is_empty() {
                return Err(AppError::Validation("Tool name cannot be empty".into()));
            }
            let def_id = uuid::Uuid::new_v4().to_string();
            let is_builtin = input.is_builtin.unwrap_or(false) as i32;
            let insert_result = tx.execute(
                "INSERT INTO persona_tool_definitions
                 (id, name, category, description, script_path,
                  input_schema, output_schema, requires_credential_type,
                  implementation_guide, is_builtin,
                  created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
                rusqlite::params![
                    def_id,
                    input.name,
                    input.category,
                    input.description,
                    input.script_path,
                    input.input_schema,
                    input.output_schema,
                    input.requires_credential_type,
                    input.implementation_guide,
                    is_builtin,
                    now,
                ],
            );
            match insert_result {
                Ok(_) => def_id,
                Err(rusqlite::Error::SqliteFailure(e, _))
                    if e.code == rusqlite::ErrorCode::ConstraintViolation =>
                {
                    tx.query_row(
                        "SELECT id FROM persona_tool_definitions WHERE LOWER(name) = LOWER(?1)",
                        rusqlite::params![input.name],
                        |row| row.get::<_, String>(0),
                    )
                    .map_err(|e| {
                        AppError::Internal(format!(
                            "Tool '{}' exists but could not be looked up: {e}",
                            action.name
                        ))
                    })?
                }
                Err(e) => return Err(AppError::Database(e)),
            }
        } else {
            continue;
        };

        // Assign tool to persona (skip if already assigned)
        let existing_assignment: Option<String> = tx
            .query_row(
                "SELECT id FROM persona_tools WHERE persona_id = ?1 AND tool_id = ?2",
                rusqlite::params![persona_id, def_id],
                |row| row.get(0),
            )
            .ok();

        if existing_assignment.is_none() {
            let assign_id = uuid::Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO persona_tools (id, persona_id, tool_id, tool_config, created_at)
                 VALUES (?1, ?2, ?3, NULL, ?4)",
                rusqlite::params![assign_id, persona_id, def_id, now],
            )
            .map_err(AppError::Database)?;
        }
        tools_created += 1;
    }

    Ok(tools_created)
}

// ============================================================================
// Cross-persona chain detection
// ============================================================================
//
// The event bus self-scopes persona-emitted events to the emitting persona
// unless the subscription has an explicit `source_filter` (see
// `engine::bus.rs::match_event` lines 131-145). That defends two unrelated
// personas with overlapping event names from triggering each other's runs,
// but it also blocks intentional cross-persona chains (Persona X emits
// `news.draft.captured`; Persona Y listens for the same event from elsewhere).
//
// At promote time we know the full emit set the persona produces. Any LISTEN
// subscription whose event_type is NOT in that set must be coming from a
// different persona — defaulting `source_filter = "*"` for those entries
// makes the chain wire up automatically. Intra-persona self-loops (event
// emitted AND listened to by the same persona) keep the null source_filter
// so the bus's self-scoping protects them.
//
// Used by both `create_triggers_in_tx` (event_listener trigger configs) and
// `create_event_subscriptions_in_tx` (persona_event_subscriptions rows).
fn collect_persona_emit_event_types(
    ir: &crate::db::models::AgentIr,
    use_cases: &UseCaseData,
) -> std::collections::HashSet<String> {
    let mut emits: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Persona-level legacy events list.
    for evt in &ir.events {
        if evt.direction.as_deref() == Some("emit") {
            if let Some(et) = evt.event_type.as_deref() {
                if !et.is_empty() {
                    emits.insert(et.to_string());
                }
            }
        }
    }

    // Per-UC event_subscriptions[direction == "emit"].
    for uc in &use_cases.structured {
        if let Some(subs) = uc.get("event_subscriptions").and_then(|v| v.as_array()) {
            for sub in subs {
                if sub.get("direction").and_then(|v| v.as_str()) == Some("emit") {
                    if let Some(et) = sub.get("event_type").and_then(|v| v.as_str()) {
                        if !et.is_empty() {
                            emits.insert(et.to_string());
                        }
                    }
                }
            }
        }
    }

    emits
}

// ============================================================================
// Transaction: create triggers linked to use cases
// ============================================================================

fn create_triggers_in_tx(
    tx: &rusqlite::Transaction<'_>,
    persona_id: &str,
    ir: &crate::db::models::AgentIr,
    use_case_ids: &[String],
    persona_emits: &std::collections::HashSet<String>,
    now: &str,
) -> Result<(u32, Vec<String>), AppError> {
    let mut triggers_created = 0u32;
    let mut created_trigger_ids = Vec::new();

    for (idx, t) in ir.triggers.iter().enumerate() {
        let raw_type = t.trigger_type.as_deref().unwrap_or("manual");
        let trigger_type = trigger_repo::normalize_trigger_type(raw_type).to_string();
        // Normalise event-listener configs so the dispatcher's
        // `listen_event_type` lookup finds them. The v3 build prompt uses
        // `event_type` because that's the user-facing field name on
        // `event_subscriptions`; the persistence layer's runtime matcher keys
        // off `listen_event_type`. Translate here at the boundary so the LLM
        // doesn't have to know the storage detail.
        let config = t.config.as_ref().map(|v| {
            if trigger_type == "event_listener" {
                if let Some(obj) = v.as_object() {
                    let mut patched = obj.clone();
                    if !patched.contains_key("listen_event_type") {
                        if let Some(et) = patched
                            .get("event_type")
                            .and_then(|x| x.as_str())
                            .map(str::to_string)
                        {
                            patched.insert(
                                "listen_event_type".to_string(),
                                serde_json::Value::String(et),
                            );
                        }
                    }
                    // Cross-persona chain default: when this trigger listens
                    // for an event that no UC in this same persona emits, the
                    // event has to come from a different persona. The bus's
                    // self-scoping rule would silently drop those matches
                    // unless source_filter is set, so default to "*" (any
                    // source) when the LLM didn't specify one.
                    let listen_et = patched
                        .get("listen_event_type")
                        .and_then(|x| x.as_str())
                        .map(str::to_string);
                    if !patched.contains_key("source_filter") {
                        if let Some(et) = listen_et {
                            if !persona_emits.contains(&et) {
                                patched.insert(
                                    "source_filter".to_string(),
                                    serde_json::Value::String("*".to_string()),
                                );
                            }
                        }
                    }
                    return serde_json::to_string(&patched).unwrap_or_default();
                }
            }
            serde_json::to_string(v).unwrap_or_default()
        });
        let use_case_id = use_case_ids
            .get(idx)
            .or_else(|| use_case_ids.last())
            .cloned();
        let encrypted_config = config
            .as_deref()
            .map(trigger_repo::encrypt_config)
            .transpose()?;

        let trigger_id = uuid::Uuid::new_v4().to_string();
        let status = "active";

        tx.execute(
            "INSERT INTO persona_triggers
             (id, persona_id, trigger_type, config, enabled, status, use_case_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?7)",
            rusqlite::params![
                trigger_id, persona_id, trigger_type, encrypted_config,
                status, use_case_id, now,
            ],
        ).map_err(AppError::Database)?;

        created_trigger_ids.push(trigger_id);
        triggers_created += 1;
    }

    Ok((triggers_created, created_trigger_ids))
}

// ============================================================================
// Transaction: create event subscriptions
// ============================================================================

fn create_event_subscriptions_in_tx(
    tx: &rusqlite::Transaction<'_>,
    persona_id: &str,
    ir: &crate::db::models::AgentIr,
    use_cases: &UseCaseData,
    persona_emits: &std::collections::HashSet<String>,
    now: &str,
) -> Result<u32, AppError> {
    let mut subscriptions_created = 0u32;

    // Helper: only LISTEN-direction subscriptions become persona_event_subscriptions
    // rows (EMIT-direction entries are documentation for the agent's outbound
    // signals). Accept both "subscribe" (legacy v1/v2) and "listen" (v3.1) as
    // synonyms — the v3 build prompt emits "listen" explicitly.
    fn is_listen(d: Option<&str>) -> bool {
        match d.unwrap_or("subscribe") {
            "subscribe" | "listen" => true,
            _ => false,
        }
    }

    // Track (event_type, source_filter) pairs we've already inserted so the
    // same subscription declared both on a UC and at the persona level doesn't
    // produce a duplicate row.
    let mut seen: std::collections::HashSet<(String, Option<String>)> =
        std::collections::HashSet::new();

    // -- Per-UC subscriptions (v3 primary location) --------------------------
    //
    // Previously: this loop only built a lookup table and never inserted
    // anything. The v3 prompt puts event_subscriptions ONLY on use_cases,
    // so nothing ended up in persona_event_subscriptions and the event bus
    // found no subscriber for `drive.document.added` etc. Now we create a
    // row per listen subscription found on any use case.
    for uc in &use_cases.structured {
        let uc_id = uc.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if uc_id.is_empty() {
            continue;
        }
        let subs = match uc.get("event_subscriptions").and_then(|v| v.as_array()) {
            Some(s) => s,
            None => continue,
        };
        for sub in subs {
            let event_type = match sub.get("event_type").and_then(|v| v.as_str()) {
                Some(et) if !et.is_empty() => et.to_string(),
                _ => continue,
            };
            let direction = sub.get("direction").and_then(|v| v.as_str());
            if !is_listen(direction) {
                continue;
            }
            // Cross-persona chain default — see `collect_persona_emit_event_types`.
            // When this persona doesn't emit this event itself, the event has to
            // arrive from a different persona; default source_filter to "*" so
            // the bus's self-scoping rule doesn't silently drop the match.
            let source_filter: Option<String> = sub
                .get("source_filter")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| {
                    if persona_emits.contains(&event_type) {
                        None
                    } else {
                        Some("*".to_string())
                    }
                });

            let key = (event_type.clone(), source_filter.clone());
            if !seen.insert(key) {
                continue;
            }

            let sub_id = uuid::Uuid::new_v4().to_string();
            let rows = tx.execute(
                "INSERT OR IGNORE INTO persona_event_subscriptions
                 (id, persona_id, event_type, source_filter, enabled, use_case_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?6)",
                rusqlite::params![sub_id, persona_id, event_type, source_filter, uc_id, now],
            ).map_err(AppError::Database)?;
            if rows > 0 {
                subscriptions_created += 1;
            }
        }
    }

    // -- Persona-level ir.events (legacy path) -------------------------------
    //
    // Still supported for older LLM outputs / templates that hoist events.
    // Per-UC entries take precedence (inserted above); this loop only fills in
    // entries that did NOT appear per-UC.
    //
    // Build a reverse lookup so persona-level events can still be attributed
    // to the first UC that mentioned the same event_type, keeping the
    // use_case_id column non-null whenever possible.
    let mut event_to_use_case: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for uc in &use_cases.structured {
        let uc_id = uc.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if let Some(subs) = uc.get("event_subscriptions").and_then(|v| v.as_array()) {
            for sub in subs {
                if let Some(et) = sub.get("event_type").and_then(|v| v.as_str()) {
                    if !et.is_empty() {
                        event_to_use_case
                            .entry(et.to_string())
                            .or_insert_with(|| uc_id.to_string());
                    }
                }
            }
        }
    }

    for evt in &ir.events {
        let event_type = evt.event_type.as_deref().unwrap_or("").to_string();
        if event_type.is_empty() {
            continue;
        }
        if !is_listen(evt.direction.as_deref()) {
            continue;
        }

        // Same cross-persona-chain default as the per-UC loop above.
        let source_filter: Option<String> = evt.source_filter.clone().or_else(|| {
            if persona_emits.contains(&event_type) {
                None
            } else {
                Some("*".to_string())
            }
        });
        let key = (event_type.clone(), source_filter.clone());
        if !seen.insert(key) {
            continue;
        }

        let use_case_id: Option<&str> = event_to_use_case.get(&event_type).map(|s| s.as_str());
        let sub_id = uuid::Uuid::new_v4().to_string();
        let rows = tx.execute(
            "INSERT OR IGNORE INTO persona_event_subscriptions
             (id, persona_id, event_type, source_filter, enabled, use_case_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?6)",
            rusqlite::params![sub_id, persona_id, event_type, source_filter, use_case_id, now],
        ).map_err(AppError::Database)?;

        if rows > 0 {
            subscriptions_created += 1;
        }
    }

    Ok(subscriptions_created)
}

// ============================================================================
// Transaction: create output assertions from v3.1 `output_assertions[]`
// ============================================================================

/// Persist every entry in `ir.output_assertions` as a row in
/// `output_assertions`. The normalizer (`template_v3::hoist_output_assertions`)
/// already merged persona-level + per-UC entries and injected the baseline
/// NotContains assertion. Each row is enabled by default; authors can opt out
/// per-assertion with `"enabled": false`.
fn create_output_assertions_in_tx(
    tx: &rusqlite::Transaction<'_>,
    persona_id: &str,
    ir: &crate::db::models::AgentIr,
    now: &str,
) -> Result<u32, AppError> {
    let mut created = 0u32;
    for a in &ir.output_assertions {
        let name = a
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Unnamed assertion");
        let description = a.get("description").and_then(|v| v.as_str());
        let assertion_type = a
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("not_contains");
        let config_value = a
            .get("config")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        let config = serde_json::to_string(&config_value).unwrap_or_else(|_| "{}".into());
        let severity = a
            .get("severity")
            .and_then(|v| v.as_str())
            .unwrap_or("warning");
        let on_failure = a
            .get("on_failure")
            .and_then(|v| v.as_str())
            .unwrap_or("log");
        let enabled: i32 = if a.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true) {
            1
        } else {
            0
        };

        let id = uuid::Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO output_assertions
             (id, persona_id, name, description, assertion_type, config, severity, on_failure, enabled, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
            rusqlite::params![id, persona_id, name, description, assertion_type, config, severity, on_failure, enabled, now],
        ).map_err(AppError::Database)?;
        created += 1;
    }
    Ok(created)
}

// ============================================================================
// Transaction: update persona row with promoted fields
// ============================================================================

fn update_persona_in_tx(
    tx: &rusqlite::Transaction<'_>,
    persona_id: &str,
    ir: &crate::db::models::AgentIr,
    notification_channels: &Option<String>,
    design_context_str: &str,
    design_result_str: &str,
    now: &str,
) -> Result<(), AppError> {
    let structured_prompt_str: Option<String> = ir
        .structured_prompt
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_default());

    // Rule 28 mirror: when the persona has exactly one use_case with a
    // recommended model, promote that model up to the persona-level
    // `model_profile` so the runtime defaults match the build's
    // recommendation even on simple personas. Multi-use-case personas
    // keep their existing persona default — per-UC `model_override` in
    // `design_context.useCases[]` already drives runtime selection there.
    let solo_model_profile_json: Option<String> = solo_use_case_model_profile(ir);

    tx.execute(
        "UPDATE personas SET
            name = COALESCE(?1, name),
            description = COALESCE(?2, description),
            system_prompt = COALESCE(?3, system_prompt),
            structured_prompt = COALESCE(?4, structured_prompt),
            icon = COALESCE(?5, icon),
            color = COALESCE(?6, color),
            enabled = 1,
            notification_channels = COALESCE(?7, notification_channels),
            design_context = ?8,
            last_design_result = ?9,
            model_profile = COALESCE(?10, model_profile),
            updated_at = ?11
         WHERE id = ?12",
        rusqlite::params![
            ir.name.as_deref(),
            ir.description.as_deref(),
            ir.system_prompt.as_deref(),
            structured_prompt_str,
            ir.icon.as_deref(),
            ir.color.as_deref(),
            notification_channels,
            design_context_str,
            design_result_str,
            solo_model_profile_json,
            now,
            persona_id,
        ],
    )
    .map_err(AppError::Database)?;

    tracing::info!(
        persona_id = %persona_id,
        has_name = ir.name.is_some(),
        has_structured_prompt = ir.structured_prompt.is_some(),
        seeded_solo_model = solo_model_profile_json.is_some(),
        "promote_build_draft: persona update succeeded (in transaction)"
    );

    Ok(())
}

/// When the IR has exactly ONE structured use_case with a non-null
/// `model_override`, normalize that override into the persona-level
/// `model_profile` JSON shape (`{"model": "..."}` or full ModelProfile).
/// Returns `None` for multi-use-case personas, simple-string use cases,
/// or use cases without an override — in those cases the existing
/// persona model_profile stays untouched (per `COALESCE(?, model_profile)`).
fn solo_use_case_model_profile(ir: &crate::db::models::AgentIr) -> Option<String> {
    if ir.use_cases.len() != 1 {
        return None;
    }
    let only = ir.use_cases.first()?;
    let data = match only {
        crate::db::models::agent_ir::AgentIrUseCase::Structured(d) => d,
        crate::db::models::agent_ir::AgentIrUseCase::Simple(_) => return None,
    };
    let override_val = data.model_override.clone()?;
    if override_val.is_null() {
        return None;
    }
    // Two accepted shapes:
    //   "claude-sonnet-4-6"          → wrap into {"model": "..."}
    //   {"model": "...", "effort":…}  → forward verbatim
    let normalized = match override_val {
        serde_json::Value::String(s) => serde_json::json!({"model": s}),
        v @ serde_json::Value::Object(_) => v,
        _ => return None,
    };
    serde_json::to_string(&normalized).ok()
}

// ============================================================================
// Transaction: create version snapshot
// ============================================================================

fn create_version_snapshot_in_tx(
    tx: &rusqlite::Transaction<'_>,
    persona_id: &str,
    ir: &crate::db::models::AgentIr,
    design_context_str: &str,
    design_result_str: &str,
    resolved_cells: &str,
    now: &str,
) -> Result<(), AppError> {
    let sp_str: Option<String> = ir
        .structured_prompt
        .as_ref()
        .and_then(|v| serde_json::to_string(v).ok());
    let version_id = uuid::Uuid::new_v4().to_string();
    let version_number: i32 = tx.query_row(
        "SELECT COALESCE(MAX(version_number), 0) + 1 FROM persona_prompt_versions WHERE persona_id = ?1",
        rusqlite::params![persona_id],
        |row| row.get(0),
    ).map_err(AppError::Database)?;

    tx.execute(
        "INSERT INTO persona_prompt_versions
         (id, persona_id, version_number, structured_prompt, system_prompt, change_summary, tag, created_at,
          design_context, last_design_result, resolved_cells, icon, color)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
        rusqlite::params![
            version_id, persona_id, version_number, sp_str,
            ir.system_prompt.as_deref().map(|s| s.to_string()),
            Some("Promoted from PersonaMatrix build".to_string()),
            "experimental", now,
            Some(design_context_str), Some(design_result_str),
            Some(resolved_cells.to_string()),
            ir.icon.as_deref().map(|s| s.to_string()),
            ir.color.as_deref().map(|s| s.to_string()),
        ],
    ).map_err(AppError::Database)?;

    Ok(())
}

// ============================================================================
// Post-transaction: update trigger schedules (best-effort)
// ============================================================================

fn update_trigger_schedules(db: &crate::db::DbPool, trigger_ids: &[String]) {
    for trigger_id in trigger_ids {
        if let Ok(trigger) = trigger_repo::get_by_id(db, trigger_id) {
            if let Some(next_at) =
                crate::engine::scheduler::compute_next_trigger_at(&trigger, chrono::Utc::now())
            {
                let _ = db.get().map(|c| {
                    c.execute(
                        "UPDATE persona_triggers SET next_trigger_at = ?1, updated_at = ?2 WHERE id = ?3",
                        rusqlite::params![next_at, chrono::Utc::now().to_rfc3339(), trigger_id],
                    ).ok();
                });
            }
        }
    }
}

// ============================================================================
// Inner promote logic — orchestrator
// ============================================================================

/// Inner promote logic — callable from both Tauri command and test automation.
///
/// All entity creation (tools, triggers, event subscriptions, persona update,
/// version snapshot, session phase transition) is wrapped in a single SQLite
/// transaction so that a failure at any step rolls back the entire promotion,
/// preventing partially-promoted orphan state.
/// `excluded_use_case_ids`: capability ids the user excluded via the Phase
/// 5b preview panel. Match against the LLM-emitted Structured-variant id
/// (e.g. `uc_morning_digest`). Simple-variant capabilities have no id and
/// are never excluded by this path. Empty list = promote everything.
pub async fn promote_build_draft_inner(
    state: &Arc<AppState>,
    session_id: String,
    persona_id: String,
    excluded_use_case_ids: Vec<String>,
) -> Result<serde_json::Value, AppError> {
    let mut session = build_session_repo::get_by_id(&state.db, &session_id)?
        .ok_or_else(|| AppError::NotFound(format!("Build session {session_id}")))?;

    session
        .phase
        .validate_transition(BuildPhase::Promoted)
        .map_err(AppError::Validation)?;

    // Brief retry on agent_ir absence: the build pipeline emits `phase:
    // test_complete` slightly before the agent_ir column is written. A caller
    // that promotes immediately on `test_complete` (e.g. the test bridge)
    // hits a ~100–300ms race where the row exists but `agent_ir` is still
    // null. Re-fetch up to ~2s before failing. See C5-handoff-2026-04-26 §2.
    if session.agent_ir.is_none() {
        for attempt in 1..=20u32 {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            match build_session_repo::get_by_id(&state.db, &session_id)? {
                Some(refreshed) if refreshed.agent_ir.is_some() => {
                    tracing::info!(
                        session_id = %session_id,
                        attempt,
                        "promote_build_draft: agent_ir became available after retry"
                    );
                    session = refreshed;
                    break;
                }
                Some(refreshed) => {
                    session = refreshed;
                }
                None => {
                    return Err(AppError::NotFound(format!(
                        "Build session {session_id} disappeared while waiting for agent_ir"
                    )));
                }
            }
        }
    }

    // Belt-and-braces normalization (§5.3 item 5 of C4-build-from-scratch-v3-handoff.md):
    // CLI build-from-scratch sessions bypass create_adoption_session, so their
    // agent_ir may still be v3-shaped when we hit this promote path. Run the
    // same normalizer here — no-op if already flat.
    let mut ir: crate::db::models::AgentIr = match &session.agent_ir {
        None => {
            return Err(AppError::Validation(
                "Build session has no agent_ir (field is null after retry)".to_string(),
            ))
        }
        Some(raw) => {
            let mut payload: serde_json::Value = serde_json::from_str(raw).map_err(|e| {
                tracing::error!(session_id = %session_id, error = %e, "Failed to parse agent_ir as JSON for promotion");
                AppError::Validation(format!("Build session agent_ir parse error: {e}"))
            })?;
            // 2026-05-09 — Stage B Phase 2: hydrate recipe_refs before the
            // existing flatten step. No-op for sessions whose stored agent_ir
            // is already inline (build-from-scratch, or pre-Phase-2 templates).
            let pool_for_lookup = state.db.clone();
            let lookup = |id: &str| -> Result<crate::db::models::RecipeDefinition, AppError> {
                crate::db::repos::resources::recipes::get_by_id(&pool_for_lookup, id)
            };
            if let Err(e) = crate::engine::template_v3::hydrate_recipe_refs(&mut payload, lookup) {
                tracing::warn!(
                    session_id = %session_id,
                    error = %e,
                    "promote_build_draft: recipe_ref hydration failed; proceeding with un-hydrated payload"
                );
            }
            if crate::engine::template_v3::is_v3_shape(&payload) {
                crate::engine::template_v3::normalize_v3_to_flat(&mut payload);
                tracing::info!(
                    session_id = %session_id,
                    "promote_build_draft: normalized v3 agent_ir to flat AgentIr"
                );
            }
            serde_json::from_value(payload).map_err(|e| {
                tracing::error!(session_id = %session_id, error = %e, "Failed to deserialize agent_ir into AgentIr struct after normalization");
                AppError::Validation(format!("Build session agent_ir shape error: {e}"))
            })?
        }
    };

    tracing::info!(
        persona_id = %persona_id,
        has_name = ir.name.is_some(),
        has_system_prompt = ir.system_prompt.is_some(),
        system_prompt_len = ir.system_prompt.as_deref().map(|s| s.len()).unwrap_or(0),
        has_structured_prompt = ir.structured_prompt.is_some(),
        "promote_build_draft: extracted IR fields"
    );

    // Apply adoption questionnaire answers: variable substitution + configuration section +
    // credential binding rewrite. This ensures the promoted persona's prompt carries the
    // user's configured values AND its required_connectors point to the concrete connectors
    // the user picked (so the matrix shows the right services and runtime credential
    // resolution finds the right vault entries).
    if let Some(ref raw_answers) = session.adoption_answers {
        if let Ok(answers) =
            serde_json::from_str::<crate::engine::adoption_answers::AdoptionAnswers>(raw_answers)
        {
            crate::engine::adoption_answers::substitute_variables(&mut ir, &answers);
            crate::engine::adoption_answers::inject_configuration_section(&mut ir, &answers);
            crate::engine::adoption_answers::apply_credential_bindings_to_connectors(
                &mut ir, &answers,
            );
            tracing::info!(persona_id = %persona_id, answer_count = answers.answers.len(), binding_count = answers.credential_bindings.len(), "Applied adoption answers to agent_ir for promotion");
        }
    }

    // Auto-generate webhook_secret for webhook triggers that lack one.
    // Templates and adoption flows produce webhook triggers without a secret
    // since the user has no UI to set one before promotion.
    ensure_webhook_secrets(&mut ir);

    // Coerce `ir.icon` to the `agent-icon:<id>` form the frontend renderers
    // expect. The build LLM historically returns Lucide PascalCase names
    // which render as either a default robot (PersonaIcon) or literal text
    // (PersonaAvatar). This fills `ir.color` from the catalog too when empty.
    normalize_agent_icon(&mut ir);

    // ================================================================
    // Pre-transaction preparation (read-only + encryption)
    // ================================================================

    // A-grade Phase 5b (2026-05-03): apply user-driven capability
    // exclusions from the preview panel before building structured use
    // cases. Match against the LLM-emitted Structured variant id
    // (uc_morning_digest), not the post-promote UUID-rekeyed id which
    // doesn't exist yet. Simple variants have no id to match — they
    // pass through unchanged. Removes the matching entries from
    // `ir.use_cases` AND any aligned `ir.triggers` slot so the promoted
    // persona doesn't carry phantom trigger rows referencing dropped UCs.
    if !excluded_use_case_ids.is_empty() {
        let excluded: std::collections::HashSet<&str> =
            excluded_use_case_ids.iter().map(|s| s.as_str()).collect();
        let original_count = ir.use_cases.len();
        // Track which indices we drop so the parallel `triggers` array
        // (positionally aligned to use_cases per build_structured_use_cases'
        // contract) can be filtered to match.
        let mut keep_indices: Vec<usize> = Vec::with_capacity(original_count);
        for (idx, uc) in ir.use_cases.iter().enumerate() {
            let drop = match uc {
                crate::db::models::agent_ir::AgentIrUseCase::Structured(d) => {
                    d.id.as_deref().is_some_and(|id| excluded.contains(id))
                }
                crate::db::models::agent_ir::AgentIrUseCase::Simple(_) => false,
            };
            if !drop {
                keep_indices.push(idx);
            }
        }
        if keep_indices.len() < original_count {
            let kept_set: std::collections::HashSet<usize> = keep_indices.iter().copied().collect();
            ir.use_cases = ir
                .use_cases
                .iter()
                .enumerate()
                .filter(|(idx, _)| kept_set.contains(idx))
                .map(|(_, uc)| uc.clone())
                .collect();
            // Filter triggers in-place by positional alignment so a UC
            // dropped at index N no longer has its corresponding trigger
            // promoted into persona_triggers. Triggers without a matching
            // UC are kept (e.g. persona-wide triggers that were never
            // aligned in the first place); only positionally-aligned
            // entries are filtered.
            if ir.triggers.len() == original_count {
                ir.triggers = ir
                    .triggers
                    .iter()
                    .enumerate()
                    .filter(|(idx, _)| kept_set.contains(idx))
                    .map(|(_, t)| t.clone())
                    .collect();
            }
            tracing::info!(
                session_id = %session_id,
                persona_id = %persona_id,
                excluded_count = original_count - keep_indices.len(),
                requested_excluded = excluded_use_case_ids.len(),
                kept_count = keep_indices.len(),
                "Applied user-driven capability exclusions before promote"
            );
        }
    }

    let use_cases = build_structured_use_cases(&ir);
    let all_connectors = connector_repo::get_all(&state.db).unwrap_or_default();
    let (tool_actions, tool_names) = prepare_tool_actions(&ir, &state.db, &all_connectors);
    validate_triggers(&ir)?;
    let notification_channels = prepare_notification_channels(&ir)?;
    let (design_context_str, design_result_str) =
        build_design_json(&ir, &use_cases.structured, &tool_names);
    let connectors_needing_setup = find_connectors_needing_setup(&ir);

    // ================================================================
    // BEGIN TRANSACTION — all writes are atomic from here
    // ================================================================
    let mut conn = state
        .db
        .get()
        .map_err(|e| AppError::Internal(format!("Pool error: {e}")))?;
    let tx = conn.transaction().map_err(AppError::Database)?;
    let now = chrono::Utc::now().to_rfc3339();

    let tools_created = create_tools_in_tx(&tx, &persona_id, &tool_actions, &now)?;
    // Compute the persona's own emit-event set once; both trigger config
    // patching and subscription insertion need it to decide whether an inbound
    // listen is intra-persona (self-loop) or cross-persona (chain) so the
    // promote path can default `source_filter = "*"` for chain inbounds.
    let persona_emits = collect_persona_emit_event_types(&ir, &use_cases);
    let (triggers_created, created_trigger_ids) =
        create_triggers_in_tx(&tx, &persona_id, &ir, &use_cases.ids, &persona_emits, &now)?;
    let subscriptions_created =
        create_event_subscriptions_in_tx(&tx, &persona_id, &ir, &use_cases, &persona_emits, &now)?;
    let assertions_created = create_output_assertions_in_tx(&tx, &persona_id, &ir, &now)?;
    update_persona_in_tx(
        &tx,
        &persona_id,
        &ir,
        &notification_channels,
        &design_context_str,
        &design_result_str,
        &now,
    )?;
    create_version_snapshot_in_tx(
        &tx,
        &persona_id,
        &ir,
        &design_context_str,
        &design_result_str,
        &session.resolved_cells,
        &now,
    )?;

    // Transition build session to Promoted
    tx.execute(
        "UPDATE build_sessions SET phase = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![BuildPhase::Promoted.as_str(), now, session_id],
    )
    .map_err(AppError::Database)?;

    // ================================================================
    // COMMIT — all entities are persisted atomically
    // ================================================================
    tx.commit().map_err(AppError::Database)?;

    // C1 (Glyph side) — if any connector lacks a credential AND lacks a
    // built-in fallback, mark setup_status='needs_credentials' so the
    // dashboard surfaces a warning. The IR's `has_credential` flag is the
    // primary signal (carried through from the build conversation), and
    // we also verify against the vault directly in case the user's
    // credential was deleted after the build session started.
    let runtime_missing = vault_missing_connectors(&state.db, &connectors_needing_setup);
    if !runtime_missing.is_empty() {
        if let Ok(conn) = state.db.get() {
            let _ = conn.execute(
                "UPDATE personas SET setup_status = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params!["needs_credentials", chrono::Utc::now().to_rfc3339(), persona_id],
            );
            tracing::info!(
                persona_id = %persona_id,
                missing_count = runtime_missing.len(),
                missing = ?runtime_missing,
                "promote: persona marked needs_credentials"
            );
        }
    }

    // Post-transaction: best-effort scheduler updates
    update_trigger_schedules(&state.db, &created_trigger_ids);

    // C7 — auto-create smee_relays rows for every webhook trigger that
    // carried a `smee_channel_url` from the build prompt rule 24 flow.
    // Best-effort: a failure here doesn't unwind the promote (the webhook
    // trigger still works on `POST /webhook/<id>` directly; the user can
    // attach a smee binding manually via SmeeRelayTab if this fails).
    let smee_relays_created = auto_create_smee_relays(&state.db, &persona_id, &ir);
    if smee_relays_created > 0 {
        // Notify the relay manager to pick up the new rows immediately.
        state.smee_relay_notifier.notify();
        tracing::info!(
            persona_id = %persona_id,
            count = smee_relays_created,
            "Auto-created smee_relays rows from webhook triggers"
        );
    }

    Ok(serde_json::json!({
        "persona": { "id": persona_id },
        "triggers_created": triggers_created,
        "tools_created": tools_created,
        "subscriptions_created": subscriptions_created,
        "assertions_created": assertions_created,
        "smee_relays_created": smee_relays_created,
        "connectors_needing_setup": connectors_needing_setup,
    }))
}

// ============================================================================
// C7 — Smee relay auto-binding from webhook triggers
// ============================================================================

/// Iterate `ir.triggers`, find webhook triggers carrying `smee_channel_url`,
/// and create matching `smee_relays` rows pointing at this persona.
///
/// Idempotent: when a relay for the same `(channel_url, persona_id)` already
/// exists we skip silently. When a relay for the same URL exists pointing
/// at a DIFFERENT persona, we log a warning and skip (do NOT repoint —
/// that's a user-managed concern).
///
/// Returns the count of relays actually created. Best-effort — individual
/// failures are logged but never bubble up to fail the promote.
fn auto_create_smee_relays(
    pool: &crate::db::DbPool,
    persona_id: &str,
    ir: &crate::db::models::AgentIr,
) -> u32 {
    use crate::db::models::CreateSmeeRelayInput;
    use crate::db::repos::communication::smee_relays as smee_repo;

    let mut created = 0u32;

    for (idx, trigger) in ir.triggers.iter().enumerate() {
        if trigger.trigger_type.as_deref() != Some("webhook") {
            continue;
        }
        let Some(cfg) = trigger.config.as_ref() else {
            continue;
        };
        let Some(channel_url) = cfg
            .get("smee_channel_url")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };

        // Idempotency probe — direct query to keep this self-contained
        // without a new repo method. If we find an existing relay for the
        // same URL we skip; only matters for re-promote loops.
        let existing_persona_id: Option<Option<String>> = pool
            .get()
            .ok()
            .and_then(|conn| {
                conn.query_row(
                    "SELECT target_persona_id FROM smee_relays WHERE channel_url = ?1",
                    rusqlite::params![channel_url],
                    |row| row.get::<_, Option<String>>(0),
                )
                .ok()
                .map(Some)
            })
            .flatten();

        if let Some(existing) = existing_persona_id {
            match existing {
                Some(ref pid) if pid == persona_id => {
                    tracing::debug!(
                        persona_id = %persona_id,
                        channel_url = %channel_url,
                        "smee_relay already bound to this persona — skipping auto-create"
                    );
                }
                Some(other_pid) => {
                    tracing::warn!(
                        persona_id = %persona_id,
                        other_persona_id = %other_pid,
                        channel_url = %channel_url,
                        "smee_relay URL already bound to a different persona — refusing to repoint"
                    );
                }
                None => {
                    tracing::warn!(
                        persona_id = %persona_id,
                        channel_url = %channel_url,
                        "smee_relay URL exists with no persona binding — leaving for manual rebind"
                    );
                }
            }
            continue;
        }

        let event_filter = cfg
            .get("smee_event_filter")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        let label = format!(
            "Build · trigger {}",
            trigger
                .description
                .as_deref()
                .map(|d| d.chars().take(48).collect::<String>())
                .filter(|d| !d.is_empty())
                .unwrap_or_else(|| format!("#{idx}"))
        );

        let input = CreateSmeeRelayInput {
            label,
            channel_url: channel_url.to_string(),
            event_filter,
            target_persona_id: Some(persona_id.to_string()),
            allowed_repos: None,
        };

        match smee_repo::create(pool, input) {
            Ok(_) => created += 1,
            Err(e) => tracing::warn!(
                persona_id = %persona_id,
                channel_url = %channel_url,
                error = %e,
                "auto_create_smee_relays: smee_repo::create failed — relay can be added later via SmeeRelayTab"
            ),
        }
    }

    created
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{AgentIr, AgentIrEvent};

    fn uc_with_subs(id: &str, subs: serde_json::Value) -> serde_json::Value {
        serde_json::json!({ "id": id, "event_subscriptions": subs })
    }

    #[test]
    fn collect_emit_set_from_per_uc_subs() {
        let ir = AgentIr::default();
        let use_cases = UseCaseData {
            structured: vec![uc_with_subs(
                "uc-1",
                serde_json::json!([
                    {"event_type": "news.draft.captured", "direction": "emit"},
                    {"event_type": "external.thing.happened", "direction": "listen"},
                ]),
            )],
            ids: vec!["uc-1".into()],
        };
        let emits = collect_persona_emit_event_types(&ir, &use_cases);
        assert!(emits.contains("news.draft.captured"));
        assert!(!emits.contains("external.thing.happened"));
    }

    #[test]
    fn collect_emit_set_from_persona_level_events() {
        let ir = AgentIr {
            events: vec![
                AgentIrEvent {
                    event_type: Some("a.b.published".into()),
                    direction: Some("emit".into()),
                    source_filter: None,
                },
                AgentIrEvent {
                    event_type: Some("c.d.received".into()),
                    direction: Some("listen".into()),
                    source_filter: None,
                },
            ],
            ..Default::default()
        };
        let use_cases = UseCaseData {
            structured: vec![],
            ids: vec![],
        };
        let emits = collect_persona_emit_event_types(&ir, &use_cases);
        assert!(emits.contains("a.b.published"));
        assert!(!emits.contains("c.d.received"));
    }

    #[test]
    fn collect_emit_set_unions_persona_and_uc_sources() {
        let ir = AgentIr {
            events: vec![AgentIrEvent {
                event_type: Some("alpha.x.emitted".into()),
                direction: Some("emit".into()),
                source_filter: None,
            }],
            ..Default::default()
        };
        let use_cases = UseCaseData {
            structured: vec![uc_with_subs(
                "uc-1",
                serde_json::json!([{"event_type": "beta.y.emitted", "direction": "emit"}]),
            )],
            ids: vec!["uc-1".into()],
        };
        let emits = collect_persona_emit_event_types(&ir, &use_cases);
        assert_eq!(emits.len(), 2);
        assert!(emits.contains("alpha.x.emitted"));
        assert!(emits.contains("beta.y.emitted"));
    }

    #[test]
    fn collect_emit_set_ignores_non_emit_directions() {
        let ir = AgentIr {
            events: vec![AgentIrEvent {
                event_type: Some("x.y.z".into()),
                direction: Some("subscribe".into()),
                source_filter: None,
            }],
            ..Default::default()
        };
        let use_cases = UseCaseData {
            structured: vec![uc_with_subs(
                "uc-1",
                serde_json::json!([{"event_type": "p.q.r"}]), // missing direction
            )],
            ids: vec!["uc-1".into()],
        };
        let emits = collect_persona_emit_event_types(&ir, &use_cases);
        assert!(emits.is_empty());
    }

    // ----------------------------------------------------------------------
    // C7 — auto_create_smee_relays
    // ----------------------------------------------------------------------

    use crate::db::models::agent_ir::AgentIrTrigger;

    fn webhook_trigger(smee_url: Option<&str>, event_filter: Option<&str>) -> AgentIrTrigger {
        let mut config = serde_json::Map::new();
        config.insert("webhook_secret".into(), serde_json::json!("a".repeat(32)));
        if let Some(url) = smee_url {
            config.insert("smee_channel_url".into(), serde_json::json!(url));
        }
        if let Some(f) = event_filter {
            config.insert("smee_event_filter".into(), serde_json::json!(f));
        }
        AgentIrTrigger {
            trigger_type: Some("webhook".to_string()),
            config: Some(serde_json::Value::Object(config)),
            description: Some("github push handler".to_string()),
            use_case_id: Some("uc-1".to_string()),
        }
    }

    fn schedule_trigger() -> AgentIrTrigger {
        AgentIrTrigger {
            trigger_type: Some("schedule".to_string()),
            config: Some(serde_json::json!({"cron": "0 7 * * *"})),
            description: Some("daily".to_string()),
            use_case_id: Some("uc-2".to_string()),
        }
    }

    fn seed_test_persona(pool: &crate::db::DbPool, persona_id: &str) {
        let conn = pool.get().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO personas (id, project_id, name, system_prompt, enabled, sensitive, headless, max_concurrent, timeout_ms, trust_level, created_at, updated_at)
             VALUES (?1, 'default', 'TestPersona', 'system', 0, 0, 0, 1, 60000, 'untrusted', ?2, ?2)",
            rusqlite::params![persona_id, now],
        ).unwrap();
    }

    #[test]
    fn auto_create_skips_when_no_webhook_triggers() {
        let pool = crate::db::init_test_db().unwrap();
        seed_test_persona(&pool, "p_a");
        let ir = AgentIr {
            triggers: vec![schedule_trigger()],
            ..Default::default()
        };
        let count = auto_create_smee_relays(&pool, "p_a", &ir);
        assert_eq!(count, 0);
    }

    #[test]
    fn auto_create_skips_webhook_trigger_without_smee_url() {
        let pool = crate::db::init_test_db().unwrap();
        seed_test_persona(&pool, "p_a");
        let ir = AgentIr {
            triggers: vec![webhook_trigger(None, None)],
            ..Default::default()
        };
        let count = auto_create_smee_relays(&pool, "p_a", &ir);
        assert_eq!(count, 0);
    }

    #[test]
    fn auto_create_creates_relay_for_webhook_trigger_with_smee_url() {
        let pool = crate::db::init_test_db().unwrap();
        seed_test_persona(&pool, "p_a");
        let url = "https://smee.io/test-channel-1";
        let ir = AgentIr {
            triggers: vec![webhook_trigger(Some(url), Some("github.push"))],
            ..Default::default()
        };
        let count = auto_create_smee_relays(&pool, "p_a", &ir);
        assert_eq!(count, 1);

        // Confirm the row landed with the right shape
        let conn = pool.get().unwrap();
        let (target_persona_id, event_filter, label): (Option<String>, Option<String>, String) =
            conn.query_row(
                "SELECT target_persona_id, event_filter, label FROM smee_relays WHERE channel_url = ?1",
                rusqlite::params![url],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            ).unwrap();
        assert_eq!(target_persona_id.as_deref(), Some("p_a"));
        assert_eq!(event_filter.as_deref(), Some("github.push"));
        assert!(label.starts_with("Build · trigger"));
    }

    #[test]
    fn auto_create_is_idempotent_for_same_persona_url_pair() {
        let pool = crate::db::init_test_db().unwrap();
        seed_test_persona(&pool, "p_a");
        let url = "https://smee.io/idempotent-channel";
        let ir = AgentIr {
            triggers: vec![webhook_trigger(Some(url), None)],
            ..Default::default()
        };
        assert_eq!(auto_create_smee_relays(&pool, "p_a", &ir), 1);
        // Second invocation finds existing row → skip
        assert_eq!(auto_create_smee_relays(&pool, "p_a", &ir), 0);
    }

    #[test]
    fn auto_create_refuses_to_repoint_existing_url_to_different_persona() {
        let pool = crate::db::init_test_db().unwrap();
        seed_test_persona(&pool, "p_a");
        seed_test_persona(&pool, "p_b");
        let url = "https://smee.io/shared-channel";
        let ir_a = AgentIr {
            triggers: vec![webhook_trigger(Some(url), None)],
            ..Default::default()
        };
        assert_eq!(auto_create_smee_relays(&pool, "p_a", &ir_a), 1);

        // p_b tries to claim the same URL — must skip silently
        let ir_b = AgentIr {
            triggers: vec![webhook_trigger(Some(url), None)],
            ..Default::default()
        };
        assert_eq!(auto_create_smee_relays(&pool, "p_b", &ir_b), 0);

        // Original binding to p_a is preserved
        let conn = pool.get().unwrap();
        let target: Option<String> = conn
            .query_row(
                "SELECT target_persona_id FROM smee_relays WHERE channel_url = ?1",
                rusqlite::params![url],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(target.as_deref(), Some("p_a"));
    }

    #[test]
    fn auto_create_handles_mixed_trigger_types() {
        let pool = crate::db::init_test_db().unwrap();
        seed_test_persona(&pool, "p_mix");
        let ir = AgentIr {
            triggers: vec![
                schedule_trigger(),
                webhook_trigger(Some("https://smee.io/mix-1"), None),
                webhook_trigger(None, None), // webhook but no smee URL
                webhook_trigger(Some("https://smee.io/mix-2"), Some("a,b")),
            ],
            ..Default::default()
        };
        let count = auto_create_smee_relays(&pool, "p_mix", &ir);
        assert_eq!(count, 2);
    }

    #[test]
    fn auto_create_skips_blank_smee_url() {
        let pool = crate::db::init_test_db().unwrap();
        seed_test_persona(&pool, "p_a");
        let ir = AgentIr {
            triggers: vec![webhook_trigger(Some("   "), None)],
            ..Default::default()
        };
        assert_eq!(auto_create_smee_relays(&pool, "p_a", &ir), 0);
    }
}
// touch 1777378957
