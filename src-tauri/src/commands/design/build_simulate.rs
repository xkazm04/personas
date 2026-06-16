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
use crate::ipc_auth::{require_auth};
use crate::AppState;
use personas_macros::requires;

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

    serde_json::to_string(&snapshot).map_err(|e| {
        AppError::Validation(format!("failed to serialize design_context snapshot: {e}"))
    })
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
    // Dry-run snapshots a simulation design_context onto the persona row that is
    // only ever restored by promote_build_draft. A *Promoted* session will never
    // promote again, so simulating from it would permanently overwrite the live
    // design_context with the stripped snapshot (broken trigger->use_case UUIDs,
    // lost channels/policies). Refuse it — post-promotion dry-run goes through the
    // runtime capability-simulate path, which never mutates design_context.
    let phase_ok = matches!(
        session.phase,
        BuildPhase::DraftReady | BuildPhase::Testing | BuildPhase::TestComplete
    );
    if !phase_ok {
        let hint = if matches!(session.phase, BuildPhase::Promoted) {
            "persona is already promoted — use the capability simulate action, \
             which does not overwrite design_context"
        } else {
            "draft must reach 'draft_ready' first"
        };
        return Err(AppError::Validation(format!(
            "Cannot simulate from phase '{}' — {}",
            session.phase.as_str(),
            hint
        )));
    }

    let persona_id = session.persona_id.clone();

    // Serialize simulations for THIS persona — they share the one
    // design_context column (see sim_lock_for / DesignContextRestore). Held for
    // the whole command; different personas still simulate in parallel. Acquired
    // before reading prior_design_context so no other sim's snapshot is live.
    let sim_lock_arc = sim_lock_for(&persona_id);
    let _sim_lock = sim_lock_arc.lock().await;

    // Read persona once, up front. Two reasons:
    //   1. fallback agent_ir source when session.agent_ir is null;
    //   2. capture the *current* design_context BEFORE the snapshot
    //      overwrite below — needed to resolve post-promote UUID-form
    //      use_case ids back to the LLM-emitted names that live in the
    //      snapshot. See `resolve_simulation_use_case_id`.
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
    let prior_design_context = persona.design_context.clone();

    // Parse agent_ir (session first, fall back to persona.last_design_result)
    let mut agent_ir: AgentIr = if let Some(ref raw) = session.agent_ir {
        serde_json::from_str(raw)
            .map_err(|e| AppError::Validation(format!("Build session agent_ir parse error: {e}")))?
    } else {
        let design_result = persona.last_design_result.clone().ok_or_else(|| {
            AppError::Validation(
                "Build session has no agent_ir and persona has no design result".to_string(),
            )
        })?;
        serde_json::from_str(&design_result)
            .map_err(|e| AppError::Validation(format!("Persona design result parse error: {e}")))?
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

    // From here the persona row carries a throwaway snapshot. Restore its prior
    // design_context on EVERY exit path below (the `?`s and the final execute)
    // via this RAII guard, which drops while the per-persona lock is still held.
    let _restore = DesignContextRestore {
        pool: state.db.clone(),
        persona_id: persona_id.clone(),
        prior: prior_design_context.clone(),
    };

    tracing::info!(
        session_id = %session_id,
        persona_id = %persona_id,
        use_case_id = %use_case_id,
        snapshot_bytes = snapshot.len(),
        "simulate_build_draft: snapshot persisted, dispatching execution"
    );

    // Resolve the use_case from the snapshot to construct the simulation input.
    let snap_value: serde_json::Value = serde_json::from_str(&snapshot)
        .map_err(|e| AppError::Validation(format!("simulation snapshot is not valid JSON: {e}")))?;

    // Caller may pass either:
    //   (a) the LLM-emitted snake_case id (matches the snapshot directly), OR
    //   (b) the post-promote UUID id (matches the persona's prior
    //       design_context's `useCases[].id` — UI fetches via
    //       `getPersonaDetail` use these).
    // Normalize (b) → (a) by position before the snapshot lookup.
    let resolved_use_case_id =
        resolve_simulation_use_case_id(&use_case_id, &snap_value, prior_design_context.as_deref());

    let use_case = snap_value
        .get("use_cases")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            arr.iter().find(|uc| {
                uc.get("id").and_then(|v| v.as_str()) == Some(resolved_use_case_id.as_str())
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

    let input_data = Some(
        crate::commands::core::use_cases::testable::build_simulation_input(
            use_case,
            input_override.as_deref(),
        )?,
    );

    crate::commands::execution::executions::execute_persona_inner(
        &state,
        app,
        persona_id,
        /* trigger_id */ None,
        input_data,
        Some(resolved_use_case_id),
        /* continuation */ None,
        /* idempotency_key */ None,
        /* is_simulation */ true,
    )
    .await
}

/// Per-persona serialization for build-draft simulations. Two concurrent sims
/// for the SAME persona both UPDATE the shared `personas.design_context` column;
/// without serialization the second's write can land between the first's write
/// and its execute-read, so a dry-run runs against the wrong snapshot and the
/// restore guards race to leave a stale snapshot behind. Different personas
/// still simulate in parallel.
fn sim_lock_for(persona_id: &str) -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCKS: std::sync::LazyLock<
        std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<tokio::sync::Mutex<()>>>>,
    > = std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    let mut map = LOCKS.lock().unwrap_or_else(|e| e.into_inner());
    map.entry(persona_id.to_string())
        .or_insert_with(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

/// RAII guard that restores a persona's pre-simulation `design_context` when the
/// command returns (success, error, OR an early `?`). `simulate_build_draft`
/// writes a STRIPPED snapshot (use_cases + summary only) onto the shared,
/// persistent column so `execute_persona_inner` can read it; without restoring,
/// an abandoned — or even a normal — dry-run would leave the persona pointing at
/// that throwaway snapshot (losing live triggers/channels/policies until the
/// next promote), which other readers (getPersonaDetail, the matrix) consume as
/// truth.
struct DesignContextRestore {
    pool: crate::db::DbPool,
    persona_id: String,
    prior: Option<String>,
}

impl Drop for DesignContextRestore {
    fn drop(&mut self) {
        if let Ok(conn) = self.pool.get() {
            let now = chrono::Utc::now().to_rfc3339();
            let _ = conn.execute(
                "UPDATE personas SET design_context = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![&self.prior, &now, &self.persona_id],
            );
        }
    }
}

/// Normalize a caller-supplied `use_case_id` into one that matches the
/// simulation snapshot's `use_cases[].id` set.
///
/// Two id forms reach this command:
/// 1. **LLM-emitted snake_case** (e.g. `uc_generate_invoice`) — matches
///    the snapshot directly because the snapshot is built from
///    `session.agent_ir`, which preserves LLM names.
/// 2. **Post-promote UUID** (e.g. `uc-b98e7b9a-3617-…`) — surfaced by
///    `getPersonaDetail` after the build promote re-keyed UC ids in
///    `personas.design_context`. Doesn't match the snapshot, but the
///    persona's *prior* design_context (captured before the snapshot
///    overwrite) does carry it. Resolve by array-position to the
///    snapshot id at the same index.
///
/// When neither path resolves, the original `requested` id is returned so
/// the caller's existing "id not found" error surfaces with the input it
/// was actually given. Pure: no I/O.
fn resolve_simulation_use_case_id(
    requested: &str,
    snapshot: &serde_json::Value,
    prior_design_context: Option<&str>,
) -> String {
    let Some(snap_arr) = snapshot.get("use_cases").and_then(|v| v.as_array()) else {
        return requested.to_string();
    };

    // Path 1 — direct snapshot id match.
    if snap_arr
        .iter()
        .any(|uc| uc.get("id").and_then(|v| v.as_str()) == Some(requested))
    {
        return requested.to_string();
    }

    // Path 2 — UUID lookup against the persona's pre-overwrite design_context.
    let Some(dc_raw) = prior_design_context else {
        return requested.to_string();
    };
    let Ok(dc_value) = serde_json::from_str::<serde_json::Value>(dc_raw) else {
        return requested.to_string();
    };
    let Some(prior_arr) = crate::engine::design_context::pick_use_cases_array(&dc_value) else {
        return requested.to_string();
    };
    let Some(position) = prior_arr
        .iter()
        .position(|uc| uc.get("id").and_then(|v| v.as_str()) == Some(requested))
    else {
        return requested.to_string();
    };
    let Some(snap_at_position) = snap_arr.get(position) else {
        return requested.to_string();
    };
    let Some(snap_id) = snap_at_position.get("id").and_then(|v| v.as_str()) else {
        return requested.to_string();
    };

    tracing::info!(
        requested_id = %requested,
        resolved_id = %snap_id,
        position,
        "simulate_build_draft: resolved post-promote UUID to LLM-emitted id by position"
    );
    snap_id.to_string()
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
#[requires(privileged)]
pub async fn get_simulation_artefacts(
    state: State<'_, Arc<AppState>>,
    execution_id: String,
) -> Result<SimulationArtefacts, AppError> {

    // Propagate read failures instead of masking them as an empty bundle. A
    // locked DB / pool exhaustion / malformed row must NOT render as a clean
    // dry-run: this panel is exactly where a user decides a capability is safe
    // to promote, so "could not read" has to be distinguishable from "genuinely
    // produced nothing" (the frontend surfaces the error rather than showing an
    // all-clear preview).
    let reviews = review_repo::get_by_execution(&state.db, &execution_id)?;
    let memories = mem_repo::get_by_execution(&state.db, &execution_id)?;

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
        assert_eq!(
            v.get("_simulation_snapshot").unwrap(),
            &serde_json::json!(true)
        );
    }

    #[test]
    fn build_simulation_design_context_preserves_structured_id_and_sample_input() {
        let mut ir = AgentIr::default();
        ir.use_cases
            .push(AgentIrUseCase::Structured(AgentIrUseCaseData {
                id: Some("uc_morning_digest".to_string()),
                title: Some("Morning Digest".to_string()),
                sample_input: Some(serde_json::json!({"max": 5})),
                ..Default::default()
            }));

        let snap = build_simulation_design_context(&ir).unwrap();
        let v: serde_json::Value = serde_json::from_str(&snap).unwrap();
        let ucs = v.get("use_cases").unwrap().as_array().unwrap();
        assert_eq!(ucs.len(), 1);
        assert_eq!(
            ucs[0].get("id").unwrap().as_str().unwrap(),
            "uc_morning_digest"
        );
        assert_eq!(
            ucs[0].get("sample_input").unwrap(),
            &serde_json::json!({"max": 5})
        );
    }

    #[test]
    fn build_simulation_design_context_fabricates_id_when_missing() {
        let mut ir = AgentIr::default();
        ir.use_cases
            .push(AgentIrUseCase::Structured(AgentIrUseCaseData {
                id: None,
                title: Some("Weekly Recap".to_string()),
                ..Default::default()
            }));

        let snap = build_simulation_design_context(&ir).unwrap();
        let v: serde_json::Value = serde_json::from_str(&snap).unwrap();
        let ucs = v.get("use_cases").unwrap().as_array().unwrap();
        let id = ucs[0].get("id").unwrap().as_str().unwrap();
        assert!(
            id.starts_with("uc_0_"),
            "fabricated id should start with uc_0_, got {id}"
        );
        assert!(
            id.contains("weekly"),
            "fabricated id should contain title slug, got {id}"
        );
    }

    #[test]
    fn build_simulation_design_context_fabricates_id_for_simple_variant() {
        let mut ir = AgentIr::default();
        ir.use_cases
            .push(AgentIrUseCase::Simple("Send daily digest".to_string()));
        let snap = build_simulation_design_context(&ir).unwrap();
        let v: serde_json::Value = serde_json::from_str(&snap).unwrap();
        let ucs = v.get("use_cases").unwrap().as_array().unwrap();
        let id = ucs[0].get("id").unwrap().as_str().unwrap();
        assert!(id.starts_with("uc_0_"));
    }

    #[test]
    fn build_simulation_design_context_handles_multiple_use_cases() {
        let mut ir = AgentIr::default();
        ir.use_cases
            .push(AgentIrUseCase::Structured(AgentIrUseCaseData {
                id: Some("uc_a".to_string()),
                title: Some("First".to_string()),
                ..Default::default()
            }));
        ir.use_cases
            .push(AgentIrUseCase::Structured(AgentIrUseCaseData {
                id: Some("uc_b".to_string()),
                title: Some("Second".to_string()),
                ..Default::default()
            }));
        ir.use_cases
            .push(AgentIrUseCase::Simple("Third bare".to_string()));

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
        ir.use_cases
            .push(AgentIrUseCase::Structured(AgentIrUseCaseData {
                id: Some("uc_x".to_string()),
                ..Default::default()
            }));
        let snap = build_simulation_design_context(&ir).unwrap();
        assert!(
            snap.contains("\"use_cases\""),
            "snapshot must use snake_case key"
        );
        assert!(
            !snap.contains("\"useCases\""),
            "snapshot must not use camelCase key"
        );
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

    // ── resolve_simulation_use_case_id ──────────────────────────────────────

    fn snap_with_ids(ids: &[&str]) -> serde_json::Value {
        serde_json::json!({
            "use_cases": ids.iter().map(|id| serde_json::json!({"id": id})).collect::<Vec<_>>(),
            "_simulation_snapshot": true,
        })
    }

    fn dc_camelcase_with_ids(ids: &[&str]) -> String {
        serde_json::to_string(&serde_json::json!({
            "useCases": ids.iter().map(|id| serde_json::json!({"id": id})).collect::<Vec<_>>(),
        }))
        .unwrap()
    }

    fn dc_snakecase_with_ids(ids: &[&str]) -> String {
        serde_json::to_string(&serde_json::json!({
            "use_cases": ids.iter().map(|id| serde_json::json!({"id": id})).collect::<Vec<_>>(),
        }))
        .unwrap()
    }

    #[test]
    fn resolver_returns_llm_id_unchanged_when_snapshot_already_matches() {
        let snap = snap_with_ids(&["uc_generate_invoice", "uc_send_summary"]);
        // Even with a prior design_context that has UUIDs, an LLM-shape match
        // short-circuits — no UUID rewrite required.
        let prior = dc_camelcase_with_ids(&["uc-aaaa", "uc-bbbb"]);
        let out = resolve_simulation_use_case_id("uc_send_summary", &snap, Some(&prior));
        assert_eq!(out, "uc_send_summary");
    }

    #[test]
    fn resolver_maps_post_promote_uuid_to_llm_id_via_position() {
        let snap = snap_with_ids(&["uc_generate_invoice", "uc_send_summary"]);
        let prior = dc_camelcase_with_ids(&[
            "uc-b98e7b9a-3617-49e1-a587-b5bc6886eb35",
            "uc-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        ]);
        let out = resolve_simulation_use_case_id(
            "uc-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            &snap,
            Some(&prior),
        );
        // Position 1 in prior dc → position 1 in snapshot → uc_send_summary.
        assert_eq!(out, "uc_send_summary");
    }

    #[test]
    fn resolver_handles_snake_case_prior_design_context() {
        // Prior may have been a previous simulation snapshot (snake_case)
        // rather than a post-promote design_context (camelCase). Both shapes
        // should resolve via `pick_use_cases_array`.
        let snap = snap_with_ids(&["uc_a", "uc_b"]);
        let prior = dc_snakecase_with_ids(&["foo_id", "bar_id"]);
        let out = resolve_simulation_use_case_id("bar_id", &snap, Some(&prior));
        assert_eq!(out, "uc_b");
    }

    #[test]
    fn resolver_returns_input_when_no_match_anywhere() {
        let snap = snap_with_ids(&["uc_a", "uc_b"]);
        let prior = dc_camelcase_with_ids(&["uc-x", "uc-y"]);
        // "ghost-id" is in neither — caller's not-found error path takes over.
        let out = resolve_simulation_use_case_id("ghost-id", &snap, Some(&prior));
        assert_eq!(out, "ghost-id");
    }

    #[test]
    fn resolver_returns_input_when_prior_design_context_is_none() {
        let snap = snap_with_ids(&["uc_a", "uc_b"]);
        let out = resolve_simulation_use_case_id("uc-zzzz", &snap, None);
        assert_eq!(out, "uc-zzzz");
    }

    #[test]
    fn resolver_returns_input_when_prior_design_context_is_unparseable() {
        let snap = snap_with_ids(&["uc_a"]);
        let out = resolve_simulation_use_case_id("uc-zzzz", &snap, Some("{not json"));
        assert_eq!(out, "uc-zzzz");
    }

    #[test]
    fn resolver_returns_input_when_position_exceeds_snapshot_length() {
        // Prior had 3 UCs, snapshot only has 2 — caller must have stale ids.
        let snap = snap_with_ids(&["uc_a", "uc_b"]);
        let prior = dc_camelcase_with_ids(&["uc-x", "uc-y", "uc-z"]);
        // "uc-z" lives at prior position 2, which is out of bounds in snap.
        let out = resolve_simulation_use_case_id("uc-z", &snap, Some(&prior));
        assert_eq!(out, "uc-z");
    }
}
