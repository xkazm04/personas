//! Dry-run simulation for the build wizard.
//!
//! Lets the user preview a capability's runtime behaviour before promoting
//! the draft persona — they get the actual agent output (messages, emitted
//! events, manual reviews) without sending real notifications.
//!
//! Why this needs its own command instead of just exposing
//! `simulate_use_case` to the build flow:
//!
//! - `simulate_use_case` requires `persona.design_context` to be populated
//!   so it can resolve the capability JSON. Today that column is only
//!   written at promote time (`build_sessions.rs::update_persona_in_tx`).
//!
//! - Pre-promote we have `session.agent_ir` (built up over the build
//!   conversation) but not yet a design_context snapshot.
//!
//! This command bridges the gap: it takes a build session id, builds a
//! minimal design_context snapshot from `session.agent_ir`, persists it
//! to the draft persona row (which is `enabled=false`, has no triggers,
//! no event subscriptions — confirmed safe by C7 risk-grep against
//! schedulers/bus/director), and then delegates to the standard
//! `execute_persona_inner` with `is_simulation=true`. Promote will
//! overwrite the snapshot with the final design_context.
//!
//! Audit-tag note: simulation rows persist with `is_simulation=true` and
//! the dispatch layer (`engine::dispatch.rs`) suppresses real notification
//! delivery — see the `is_simulation` field on `DispatchContext`.

use std::sync::Arc;
use tauri::State;

use crate::db::models::{
    AgentIr, BuildPhase, PersonaExecution, PersonaManualReview, PersonaMemory,
};
use crate::db::repos::communication::manual_reviews as review_repo;
use crate::db::repos::core::build_sessions as build_session_repo;
use crate::db::repos::core::memories as mem_repo;
use crate::db::repos::core::personas as persona_repo;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_privileged};
use crate::AppState;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ---------------------------------------------------------------------------
// Pure helper — build a minimal design_context from an AgentIr
// ---------------------------------------------------------------------------

/// Build a snake-case `design_context` JSON snapshot from an `AgentIr` that
/// the runtime simulator paths (`execute_persona_inner`, `simulate_use_case`)
/// can consume. Snake-case key `use_cases` matches what those readers expect
/// today — see `commands/execution/executions.rs:174` and
/// `commands/core/use_cases.rs:568`.
///
/// Each UC entry preserves `id`, `sample_input`, `time_filter`, and
/// `model_override` from the IR. When the IR omits an `id`, one is
/// fabricated as `uc_idx_<N>` so dry-run can still address the UC.
///
/// Pure: no I/O, no DB. Suitable for unit testing without a tauri runtime.
pub fn build_simulation_design_context(ir: &AgentIr) -> Result<String, AppError> {
    use crate::db::models::agent_ir::AgentIrUseCase;

    let mut snapshot_use_cases: Vec<serde_json::Value> = Vec::with_capacity(ir.use_cases.len());

    for (idx, uc) in ir.use_cases.iter().enumerate() {
        let entry = match uc {
            AgentIrUseCase::Structured(d) => {
                let mut value = serde_json::to_value(d).map_err(|e| {
                    AppError::Validation(format!(
                        "failed to serialize structured use case at index {idx}: {e}"
                    ))
                })?;
                ensure_id(&mut value, idx, d.title.as_deref());
                value
            }
            AgentIrUseCase::Simple(text) => {
                serde_json::json!({
                    "id": fabricated_id(idx, Some(text.as_str())),
                    "title": text,
                    "description": text,
                    "category": "general",
                    "execution_mode": "e2e",
                })
            }
        };
        snapshot_use_cases.push(entry);
    }

    let snapshot = serde_json::json!({
        "use_cases": snapshot_use_cases,
        "summary": ir.design_summary(),
        "_simulation_snapshot": true,
    });

    serde_json::to_string(&snapshot)
        .map_err(|e| AppError::Validation(format!("failed to serialize design_context snapshot: {e}")))
}

fn ensure_id(value: &mut serde_json::Value, idx: usize, title: Option<&str>) {
    let needs_id = match value.get("id") {
        Some(serde_json::Value::String(s)) => s.trim().is_empty(),
        Some(serde_json::Value::Null) | None => true,
        _ => false,
    };
    if needs_id {
        if let Some(obj) = value.as_object_mut() {
            obj.insert(
                "id".to_string(),
                serde_json::Value::String(fabricated_id(idx, title)),
            );
        }
    }
}

fn fabricated_id(idx: usize, title: Option<&str>) -> String {
    let slug = title
        .map(|s| {
            s.chars()
                .map(|c| {
                    if c.is_ascii_alphanumeric() {
                        c.to_ascii_lowercase()
                    } else {
                        '_'
                    }
                })
                .collect::<String>()
        })
        .map(|s| {
            // Collapse runs of underscores and trim leading/trailing
            let collapsed = s
                .split('_')
                .filter(|p| !p.is_empty())
                .collect::<Vec<_>>()
                .join("_");
            collapsed
        })
        .filter(|s| !s.is_empty());

    match slug {
        Some(s) => format!("uc_{}_{}", idx, &s[..s.len().min(40)]),
        None => format!("uc_idx_{idx}"),
    }
}

// ---------------------------------------------------------------------------
// Command: simulate_build_draft
// ---------------------------------------------------------------------------

/// Dry-run a capability against a draft persona's `agent_ir` without
/// promoting. Snapshots a `design_context` onto the persona row, calls
/// `execute_persona_inner` with `is_simulation=true`, and returns the
/// resulting `PersonaExecution`.
///
/// The snapshot persists on the row but is overwritten by `promote_build_draft`
/// when the user finalises the build. If the user abandons the build, the
/// row is `enabled=false` and unreachable — `deleteAgent` cleans it up.
///
/// The phase-machine is *not* mutated — simulation is a side action callable
/// from any of `draft_ready`, `test_complete` (and `testing` in case of
/// retry). This avoids needing a new BuildPhase variant for this slice.
#[tauri::command]
pub async fn simulate_build_draft(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    session_id: String,
    use_case_id: String,
    input_override: Option<String>,
) -> Result<PersonaExecution, AppError> {
    require_auth(&state).await?;

    // Load session — establish persona_id + agent_ir
    let session = build_session_repo::get_by_id(&state.db, &session_id)?
        .ok_or_else(|| AppError::NotFound(format!("Build session {session_id}")))?;

    // Restrict to phases where a draft IR is reasonably "complete enough"
    // for dry-run. Resolving / awaiting_input etc. would simulate against an
    // incomplete IR; refuse with a clear error.
    let phase_ok = matches!(
        session.phase,
        BuildPhase::DraftReady
            | BuildPhase::Testing
            | BuildPhase::TestComplete
            | BuildPhase::Promoted
    );
    if !phase_ok {
        return Err(AppError::Validation(format!(
            "Cannot simulate from phase '{}' — draft must reach 'draft_ready' first",
            session.phase.as_str()
        )));
    }

    let persona_id = session.persona_id.clone();

    // Parse agent_ir (session first, fall back to persona.last_design_result)
    let mut agent_ir: AgentIr = if let Some(ref raw) = session.agent_ir {
        serde_json::from_str(raw).map_err(|e| {
            AppError::Validation(format!("Build session agent_ir parse error: {e}"))
        })?
    } else {
        let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
        let design_result = persona.last_design_result.ok_or_else(|| {
            AppError::Validation(
                "Build session has no agent_ir and persona has no design result".to_string(),
            )
        })?;
        serde_json::from_str(&design_result).map_err(|e| {
            AppError::Validation(format!("Persona design result parse error: {e}"))
        })?
    };

    // Apply adoption answers if present so simulate sees the user's actual
    // configured values (mirrors test_build_draft's behaviour).
    if let Some(ref raw_answers) = session.adoption_answers {
        if let Ok(answers) =
            serde_json::from_str::<crate::engine::adoption_answers::AdoptionAnswers>(raw_answers)
        {
            crate::engine::adoption_answers::substitute_variables(&mut agent_ir, &answers);
            crate::engine::adoption_answers::inject_configuration_section(&mut agent_ir, &answers);
            crate::engine::adoption_answers::apply_credential_bindings_to_connectors(
                &mut agent_ir,
                &answers,
            );
        }
    }

    // Build + persist the design_context snapshot.
    let snapshot = build_simulation_design_context(&agent_ir)?;
    let now = chrono::Utc::now().to_rfc3339();
    {
        let conn = state.db.get()?;
        conn.execute(
            "UPDATE personas SET design_context = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![&snapshot, &now, &persona_id],
        )?;
    }

    tracing::info!(
        session_id = %session_id,
        persona_id = %persona_id,
        use_case_id = %use_case_id,
        snapshot_bytes = snapshot.len(),
        "simulate_build_draft: snapshot persisted, dispatching execution"
    );

    // Resolve the use_case from the snapshot to construct the simulation input.
    let snap_value: serde_json::Value = serde_json::from_str(&snapshot).map_err(|e| {
        AppError::Validation(format!("simulation snapshot is not valid JSON: {e}"))
    })?;
    let use_case = snap_value
        .get("use_cases")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            arr.iter().find(|uc| {
                uc.get("id").and_then(|v| v.as_str()) == Some(use_case_id.as_str())
            })
        })
        .ok_or_else(|| {
            AppError::Validation(format!(
                "use_case_id '{}' not found in draft agent_ir — available ids: {:?}",
                use_case_id,
                snap_value
                    .get("use_cases")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|uc| {
                                uc.get("id").and_then(|i| i.as_str()).map(String::from)
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default()
            ))
        })?;

    let input_data = Some(crate::commands::core::use_cases::testable::build_simulation_input(
        use_case,
        input_override.as_deref(),
    )?);

    crate::commands::execution::executions::execute_persona_inner(
        &state,
        app,
        persona_id,
        /* trigger_id */ None,
        input_data,
        Some(use_case_id),
        /* continuation */ None,
        /* idempotency_key */ None,
        /* is_simulation */ true,
    )
    .await
}

// ---------------------------------------------------------------------------
// Command: get_simulation_artefacts
// ---------------------------------------------------------------------------

/// Bundled view of artefacts a simulation execution produced for the dry-run
/// preview panel. Two tables ship in v1: `manual_reviews` (already has
/// `get_by_execution`) and `memories` (already has `get_by_execution`).
///
/// **`messages` and `events` deferred to a follow-up slice** — neither repo
/// exposes a `get_by_execution` helper today (`persona_messages` has the
/// column but no scoped accessor; `persona_events` uses `source_id` for
/// execution linkage which needs a small new query). The Execution Detail
/// tab (post-promote) covers those views; v1 dry-run focuses on the
/// user-visible artefacts (review queue + remembered facts).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SimulationArtefacts {
    pub execution_id: String,
    pub reviews: Vec<PersonaManualReview>,
    pub memories: Vec<PersonaMemory>,
}

/// Fetch artefacts a single (simulation) execution produced. Used by the
/// build wizard's dry-run preview panel. Privileged because callers can read
/// any execution's artefacts — same gate as observability commands that
/// touch arbitrary executions.
#[tauri::command]
pub async fn get_simulation_artefacts(
    state: State<'_, Arc<AppState>>,
    execution_id: String,
) -> Result<SimulationArtefacts, AppError> {
    require_privileged(&state, "get_simulation_artefacts").await?;

    let reviews = review_repo::get_by_execution(&state.db, &execution_id).unwrap_or_default();
    let memories = mem_repo::get_by_execution(&state.db, &execution_id).unwrap_or_default();

    Ok(SimulationArtefacts {
        execution_id,
        reviews,
        memories,
    })
}

// ---------------------------------------------------------------------------
// Tests — pure helper only
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::agent_ir::{AgentIrUseCase, AgentIrUseCaseData};

    #[test]
    fn build_simulation_design_context_handles_empty_use_cases() {
        let ir = AgentIr::default();
        let snap = build_simulation_design_context(&ir).unwrap();
        let v: serde_json::Value = serde_json::from_str(&snap).unwrap();
        assert!(v.get("use_cases").unwrap().as_array().unwrap().is_empty());
        assert_eq!(v.get("_simulation_snapshot").unwrap(), &serde_json::json!(true));
    }

    #[test]
    fn build_simulation_design_context_preserves_structured_id_and_sample_input() {
        let mut ir = AgentIr::default();
        ir.use_cases.push(AgentIrUseCase::Structured(AgentIrUseCaseData {
            id: Some("uc_morning_digest".to_string()),
            title: Some("Morning Digest".to_string()),
            sample_input: Some(serde_json::json!({"max": 5})),
            ..Default::default()
        }));

        let snap = build_simulation_design_context(&ir).unwrap();
        let v: serde_json::Value = serde_json::from_str(&snap).unwrap();
        let ucs = v.get("use_cases").unwrap().as_array().unwrap();
        assert_eq!(ucs.len(), 1);
        assert_eq!(ucs[0].get("id").unwrap().as_str().unwrap(), "uc_morning_digest");
        assert_eq!(ucs[0].get("sample_input").unwrap(), &serde_json::json!({"max": 5}));
    }

    #[test]
    fn build_simulation_design_context_fabricates_id_when_missing() {
        let mut ir = AgentIr::default();
        ir.use_cases.push(AgentIrUseCase::Structured(AgentIrUseCaseData {
            id: None,
            title: Some("Weekly Recap".to_string()),
            ..Default::default()
        }));

        let snap = build_simulation_design_context(&ir).unwrap();
        let v: serde_json::Value = serde_json::from_str(&snap).unwrap();
        let ucs = v.get("use_cases").unwrap().as_array().unwrap();
        let id = ucs[0].get("id").unwrap().as_str().unwrap();
        assert!(id.starts_with("uc_0_"), "fabricated id should start with uc_0_, got {id}");
        assert!(id.contains("weekly"), "fabricated id should contain title slug, got {id}");
    }

    #[test]
    fn build_simulation_design_context_fabricates_id_for_simple_variant() {
        let mut ir = AgentIr::default();
        ir.use_cases.push(AgentIrUseCase::Simple("Send daily digest".to_string()));
        let snap = build_simulation_design_context(&ir).unwrap();
        let v: serde_json::Value = serde_json::from_str(&snap).unwrap();
        let ucs = v.get("use_cases").unwrap().as_array().unwrap();
        let id = ucs[0].get("id").unwrap().as_str().unwrap();
        assert!(id.starts_with("uc_0_"));
    }

    #[test]
    fn build_simulation_design_context_handles_multiple_use_cases() {
        let mut ir = AgentIr::default();
        ir.use_cases.push(AgentIrUseCase::Structured(AgentIrUseCaseData {
            id: Some("uc_a".to_string()),
            title: Some("First".to_string()),
            ..Default::default()
        }));
        ir.use_cases.push(AgentIrUseCase::Structured(AgentIrUseCaseData {
            id: Some("uc_b".to_string()),
            title: Some("Second".to_string()),
            ..Default::default()
        }));
        ir.use_cases.push(AgentIrUseCase::Simple("Third bare".to_string()));

        let snap = build_simulation_design_context(&ir).unwrap();
        let v: serde_json::Value = serde_json::from_str(&snap).unwrap();
        let ucs = v.get("use_cases").unwrap().as_array().unwrap();
        assert_eq!(ucs.len(), 3);
        assert_eq!(ucs[0].get("id").unwrap().as_str().unwrap(), "uc_a");
        assert_eq!(ucs[1].get("id").unwrap().as_str().unwrap(), "uc_b");
        // The Simple variant gets a fabricated id at index 2
        let third_id = ucs[2].get("id").unwrap().as_str().unwrap();
        assert!(third_id.starts_with("uc_2_"), "got {third_id}");
    }

    #[test]
    fn build_simulation_design_context_keys_are_snake_case_compatible() {
        // execute_persona_inner reads dc.get("use_cases") (snake_case);
        // make sure the snapshot uses that exact key, not "useCases".
        let mut ir = AgentIr::default();
        ir.use_cases.push(AgentIrUseCase::Structured(AgentIrUseCaseData {
            id: Some("uc_x".to_string()),
            ..Default::default()
        }));
        let snap = build_simulation_design_context(&ir).unwrap();
        assert!(snap.contains("\"use_cases\""), "snapshot must use snake_case key");
        assert!(!snap.contains("\"useCases\""), "snapshot must not use camelCase key");
    }

    #[test]
    fn fabricated_id_is_deterministic_per_index_and_title() {
        let id1 = fabricated_id(2, Some("My Title!"));
        let id2 = fabricated_id(2, Some("My Title!"));
        assert_eq!(id1, id2);
        assert!(id1.contains("my_title"), "got {id1}");
        // Without a title we still get a usable id
        assert_eq!(fabricated_id(5, None), "uc_idx_5");
        assert_eq!(fabricated_id(0, Some("")), "uc_idx_0");
    }
}

