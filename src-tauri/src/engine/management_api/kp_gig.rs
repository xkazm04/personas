//! The kp bridge's one-persona-per-gig additions (2026-09-29, bridge doc §10.14).
//!
//! kp's gig desk moved from one reusable specialist persona serving dozens of
//! gigs to ONE persona per gig: hired when the operator accepts a gig's plan,
//! retired when the gig ends. Four additive pieces of the wire live here, all
//! reached from `POST /api/kp/persona-requests` except the last:
//!
//! - **`spec.modelProfile: {model, effort?}`** — [`validate_model_profile`]
//!   bounds it at intake and stores ONLY `{model, effort}`; the approval
//!   executor writes it as the new persona's `model_profile`. A kp key can
//!   therefore choose the model and the effort of a persona it asks for, never
//!   a provider endpoint or a token (the two `ModelProfile` fields that decide
//!   where a prompt is sent and with what credential).
//! - **`placement.projectId`** — [`validate_hire_project`] holds it to the
//!   boundary a per-run `_projectId` binding meets (inside the allowed HTTP
//!   project roots, in the hire's workspace); the executor writes it as
//!   `design_context.homeProjectId`, the persona → project link.
//! - **the gig persona policy** — the intake asks
//!   `personas_db::kp_gig_policy::evaluate_request` and, when the request is
//!   inside every bound, approves it through
//!   `approvals::policy_approve_kp_hire` (the Approve click's executor).
//! - **`POST /api/kp/personas/{personaId}/retire`** — [`retire_kp_persona`]:
//!   the key that asked for a persona can end its tenure; no other key can.

use std::sync::Arc;

use axum::{
    extract::{Extension, Path, State as AxumState},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{json, Value};
use tauri::Manager;

use super::{err_code, ok_json, AuthedApiKey, ManagementState};
use crate::db::models::{DevProject, DevWorkspace};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::workspaces::org as ws_repo;
use crate::db::DbPool;
use crate::error::AppError;

/// Efforts a kp hire may name. The CLI's own vocabulary (`claude --effort`),
/// which is one wider than `model_routing::EFFORT_LEVELS` (`max`).
pub(super) const MODEL_PROFILE_EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];
/// Longest model id a kp hire may name.
pub(super) const MODEL_ID_MAX: usize = personas_db::kp_gig_policy::MAX_MODEL_CHARS;
const ID_MAX: usize = 128;

/// A refusal with its status and snake_case wire code.
#[derive(Debug, PartialEq)]
pub(super) struct Refusal {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl Refusal {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }
    fn internal(e: impl std::fmt::Display) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            e.to_string(),
        )
    }
    pub(super) fn into_response(self) -> Response {
        err_code(self.status, self.code, &self.message).into_response()
    }
}

// ── spec.modelProfile ────────────────────────────────────────────────────────

/// The model a kp hire asked for, normalized.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct HireModelProfile {
    pub model: String,
    pub effort: Option<String>,
}

impl HireModelProfile {
    /// The stored shape: exactly `{model, effort?}`, whatever else was sent.
    pub(super) fn to_value(&self) -> Value {
        let mut v = json!({ "model": self.model });
        if let Some(e) = &self.effort {
            v["effort"] = json!(e);
        }
        v
    }
}

/// Validate `spec.modelProfile`. `Ok(None)` when absent or `null` (the hire
/// then gets no model profile, exactly as before). Refusals answer 400
/// `invalid_model_profile`: `model` must be a non-empty string of at most
/// [`MODEL_ID_MAX`] characters with no whitespace or control characters (it
/// becomes one argv token, `--model <id>`); `effort`, when present, one of
/// [`MODEL_PROFILE_EFFORTS`]. Any other key (a `provider`, a `base_url`, an
/// `auth_token`) is dropped, never stored.
pub(super) fn validate_model_profile(
    raw_body: &Value,
) -> Result<Option<HireModelProfile>, Refusal> {
    let bad = |m: &str| {
        Refusal::new(
            StatusCode::BAD_REQUEST,
            "invalid_model_profile",
            format!("`spec.modelProfile` {m}"),
        )
    };
    let obj = match raw_body.pointer("/spec/modelProfile") {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::Object(o)) => o,
        Some(_) => return Err(bad("must be an object `{model, effort?}`")),
    };
    let model = obj
        .get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .ok_or_else(|| bad("must carry a string `model`"))?;
    if model.is_empty() || model.chars().count() > MODEL_ID_MAX {
        return Err(bad(&format!(
            "`model` must be 1..{MODEL_ID_MAX} characters"
        )));
    }
    if model.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(bad(
            "`model` must not contain whitespace or control characters",
        ));
    }
    let effort = match obj.get("effort") {
        None | Some(Value::Null) => None,
        Some(Value::String(e)) if MODEL_PROFILE_EFFORTS.contains(&e.trim()) => {
            Some(e.trim().to_string())
        }
        Some(_) => {
            return Err(bad(&format!(
                "`effort` must be one of {}",
                MODEL_PROFILE_EFFORTS.join(", ")
            )))
        }
    };
    Ok(Some(HireModelProfile {
        model: model.to_string(),
        effort,
    }))
}

// ── placement.projectId ──────────────────────────────────────────────────────

/// The project a kp hire names as its home, and — when the request named no
/// `placement.workspaceId` — the project's workspace, which the hire is then
/// filed under (the intake writes its id into the stored placement).
#[derive(Debug)]
pub(super) struct HireProjectLink {
    pub project: DevProject,
    pub derived_workspace: Option<DevWorkspace>,
}

/// Validate `placement.projectId`. `Ok(None)` when absent or `null`.
///
/// Held to the boundary of a per-run `_projectId` binding
/// (`execution_project::resolve_hire_project`): the project exists, is on, its
/// folder exists and lies strictly inside the allowed HTTP project roots, and
/// it is in the placement workspace — or, with no placement workspace, in some
/// workspace, which becomes the placement. Refusals: 400 `invalid_placement`;
/// 404 `project_not_found`; 403 `project_outside_allowed_roots` ·
/// `project_outside_persona_workspace`.
pub(super) fn validate_hire_project(
    pool: &DbPool,
    raw_body: &Value,
    placement: Option<&DevWorkspace>,
) -> Result<Option<HireProjectLink>, Refusal> {
    let id = match raw_body.pointer("/placement/projectId") {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::String(s)) if !s.trim().is_empty() && s.trim().chars().count() <= ID_MAX => {
            s.trim().to_string()
        }
        Some(_) => {
            return Err(Refusal::new(
                StatusCode::BAD_REQUEST,
                "invalid_placement",
                format!(
                "`placement.projectId` must be a non-empty string of at most {ID_MAX} characters"
            ),
            ))
        }
    };
    let project = personas_db::execution_project::resolve_hire_project(
        pool,
        placement.map(|w| w.id.as_str()),
        &id,
    )
    .map_err(|e| {
        let status = StatusCode::from_u16(e.http_status()).unwrap_or(StatusCode::BAD_REQUEST);
        Refusal::new(status, e.code(), e.message())
    })?;
    let derived_workspace = match (placement, project.workspace_id.as_deref()) {
        (None, Some(ws_id)) => {
            Some(ws_repo::get_workspace_by_id(pool, ws_id).map_err(Refusal::internal)?)
        }
        _ => None,
    };
    Ok(Some(HireProjectLink {
        project,
        derived_workspace,
    }))
}

// ── the gig persona policy, as the intake reads it ──────────────────────────

/// The note the approval card carries when a request aimed at the policy
/// (`fit.kind` is the gig-persona kind) but missed it, so the operator sees why
/// a gig hire is waiting for them. `None` for every other request.
pub(super) fn policy_miss_note(
    params: &Value,
    outcome: &Result<(), personas_db::kp_gig_policy::PolicyMiss>,
) -> Option<String> {
    let aimed = params.pointer("/fit/kind").and_then(Value::as_str)
        == Some(personas_db::kp_gig_policy::FIT_KIND);
    match outcome {
        Err(miss) if aimed => Some(format!(
            " — gig persona policy did not apply: {}",
            miss.reason()
        )),
        _ => None,
    }
}

// ── POST /api/kp/personas/{personaId}/retire ─────────────────────────────────

/// What a retire did.
#[derive(Debug, PartialEq)]
pub(super) struct RetireOutcome {
    /// The tenure was already over: the persona was archived before, or is
    /// gone altogether.
    pub already: bool,
    /// The persona row still exists (archived).
    pub archived: bool,
    /// The linked App master mandate still owed a `retired` carry-out.
    pub mandate_project_id: Option<String>,
    pub carry_out_mandate: bool,
    /// How many keys lost `personas:execute:persona:<id>` just now.
    pub grants_revoked: usize,
}

/// The DB half of [`retire_kp_persona`]: ownership, archive, grant revocation.
/// `key_id` is the key the middleware resolved.
///
/// **Archive, not delete — and that is the contract, not a shortcut.**
/// `persona_executions.persona_id` is `ON DELETE CASCADE`, so the hard delete
/// `delete_persona` performs destroys every past execution of the persona; kp
/// asked for them to be kept. The archive is `personas::archive_persona`, the
/// function the `archive_persona` command and the headless `kp/test/retire`
/// call: lifecycle `archived`, nothing cascades — executions, the project, its
/// milestones and goals all stay. The access half is what `delete_persona`
/// also does: the kp key loses its per-persona execute grant.
pub(super) fn retire_for_key(
    pool: &DbPool,
    user_db: &crate::db::UserDbPool,
    key_id: &str,
    persona_id: &str,
) -> Result<RetireOutcome, Refusal> {
    let owned = personas_engine::kp_execute_grant::key_hired_persona(user_db, key_id, persona_id)
        .map_err(Refusal::internal)?;
    let exists = match persona_repo::get_by_id(pool, persona_id) {
        Ok(_) => true,
        Err(AppError::NotFound(_)) => false,
        Err(e) => return Err(Refusal::internal(e)),
    };
    if !owned {
        return Err(if exists {
            Refusal::new(
                StatusCode::FORBIDDEN,
                "persona_not_hired_by_this_key",
                format!("persona {persona_id} was not hired through a request this key submitted"),
            )
        } else {
            Refusal::new(
                StatusCode::NOT_FOUND,
                "persona_not_found",
                format!("persona {persona_id} not found"),
            )
        });
    }
    if !exists {
        // Ours, and already gone (an operator deleted it). Nothing to archive;
        // the grant revocation below is idempotent and clears any leftover.
        let revoked =
            personas_engine::kp_execute_grant::revoke_on_retire(pool, user_db, persona_id);
        return Ok(RetireOutcome {
            already: true,
            archived: false,
            mandate_project_id: None,
            carry_out_mandate: false,
            grants_revoked: revoked.len(),
        });
    }
    let (_persona, plan, mandate_project_id) = match super::retire_persona_db(pool, persona_id) {
        Ok(v) => v,
        Err(AppError::Validation(m)) => {
            return Err(Refusal::new(
                StatusCode::BAD_REQUEST,
                "persona_not_retirable",
                m,
            ))
        }
        Err(e) => return Err(Refusal::internal(e)),
    };
    let revoked = personas_engine::kp_execute_grant::revoke_on_retire(pool, user_db, persona_id);
    Ok(RetireOutcome {
        already: plan.already_retired(),
        archived: true,
        carry_out_mandate: plan.carry_out_mandate && mandate_project_id.is_some(),
        mandate_project_id,
        grants_revoked: revoked.len(),
    })
}

/// `POST /api/kp/personas/{personaId}/retire` — end the tenure of a persona
/// this key hired. `personas:build` (the `/api/kp/` write tier). Idempotent.
///
/// Answers `{retired: true, already, personaId, archived, executeGrantsRevoked}`;
/// 403 `persona_not_hired_by_this_key` for a persona another key (or no kp
/// hire) produced; 404 `persona_not_found` for an id this key never hired and
/// nobody has.
pub(super) async fn retire_kp_persona(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Extension(key): Extension<AuthedApiKey>,
    Path(persona_id): Path<String>,
) -> Response {
    let persona_id = persona_id.trim().to_string();
    if persona_id.is_empty() || persona_id.chars().count() > ID_MAX {
        return Refusal::new(
            StatusCode::BAD_REQUEST,
            "invalid_persona_id",
            format!("the persona id must be 1..{ID_MAX} characters"),
        )
        .into_response();
    }
    let Some(app_state) = state.app.try_state::<Arc<crate::AppState>>() else {
        return Refusal::internal("App state not available").into_response();
    };
    let outcome = match retire_for_key(&state.pool, &app_state.user_db, &key.id, &persona_id) {
        Ok(o) => o,
        Err(r) => return r.into_response(),
    };
    // An App master hired through kp also holds a mandate; it ends through
    // the one carry-out every retirement reaches.
    let mut mandate_carried_out = false;
    if outcome.carry_out_mandate {
        if let Some(project_id) = outcome.mandate_project_id.as_deref() {
            mandate_carried_out = super::carry_out_retired_mandate(
                &app_state,
                project_id,
                format!(
                    "retired over the kp bridge by key `{}`; autopilot off and cadence triggers disabled",
                    key.id
                ),
            );
        }
    }
    tracing::info!(
        persona_id = %persona_id,
        key_id = %key.id,
        already = outcome.already,
        grants_revoked = outcome.grants_revoked,
        "kp bridge: persona retired by the key that hired it"
    );
    ok_json(json!({
        "retired": true,
        "already": outcome.already,
        "personaId": persona_id,
        // The row is kept (archived), never deleted: its executions, project,
        // milestones and goals stay readable. `false` only when the persona
        // was already deleted before this call.
        "archived": outcome.archived,
        "executeGrantsRevoked": outcome.grants_revoked,
        "mandate": outcome.mandate_project_id.map(|project_id| json!({
            "projectId": project_id,
            "carriedOut": mandate_carried_out,
        })),
    }))
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_profile_is_bounded_and_stored_as_model_and_effort_only() {
        assert_eq!(validate_model_profile(&json!({"spec": {}})), Ok(None));
        assert_eq!(
            validate_model_profile(&json!({"spec": {"modelProfile": null}})),
            Ok(None)
        );
        use personas_core::model_ids::OPUS_5_5;
        let got = validate_model_profile(&json!({"spec": {"modelProfile": {
            "model": format!(" {OPUS_5_5} "), "effort": "high",
            "base_url": "https://evil.example", "auth_token": "sk-x", "provider": "x"
        }}}))
        .unwrap()
        .unwrap();
        assert_eq!(
            got,
            HireModelProfile {
                model: OPUS_5_5.into(),
                effort: Some("high".into())
            }
        );
        assert_eq!(
            got.to_value(),
            json!({"model": OPUS_5_5, "effort": "high"}),
            "an endpoint or token sent by kp is never stored"
        );
        for effort in MODEL_PROFILE_EFFORTS {
            assert!(validate_model_profile(
                &json!({"spec": {"modelProfile": {"model": "m", "effort": effort}}})
            )
            .is_ok());
        }
        let no_effort = validate_model_profile(&json!({"spec": {"modelProfile": {"model": "m"}}}))
            .unwrap()
            .unwrap();
        assert_eq!(no_effort.effort, None);
        assert_eq!(no_effort.to_value(), json!({"model": "m"}));
    }

    #[test]
    fn a_bad_model_profile_is_refused_with_the_input_invalid_code() {
        for bad in [
            json!(personas_core::model_ids::OPUS_5_5),
            json!({"effort": "high"}),
            json!({"model": ""}),
            json!({"model": "   "}),
            json!({"model": 5}),
            json!({"model": "x".repeat(MODEL_ID_MAX + 1)}),
            json!({"model": "claude opus"}),
            json!({"model": "claude-opus\n--dangerously"}),
            json!({"model": "m", "effort": "extreme"}),
            json!({"model": "m", "effort": 3}),
        ] {
            let e = validate_model_profile(&json!({"spec": {"modelProfile": bad}})).unwrap_err();
            assert_eq!(e.status, StatusCode::BAD_REQUEST, "{bad}");
            assert_eq!(e.code, "invalid_model_profile", "{bad}");
        }
        // Exactly at the bound passes.
        assert!(validate_model_profile(
            &json!({"spec": {"modelProfile": {"model": "x".repeat(MODEL_ID_MAX)}}})
        )
        .is_ok());
    }

    #[test]
    fn a_policy_miss_is_noted_only_for_a_request_that_aimed_at_the_policy() {
        use personas_db::kp_gig_policy::PolicyMiss;
        let aimed = json!({"fit": {"kind": "kp.gig-persona.v1"}});
        let note = policy_miss_note(&aimed, &Err(PolicyMiss::ModelNotAllowed("m".into()))).unwrap();
        assert!(note.contains("gig persona policy did not apply"), "{note}");
        assert!(note.contains("model `m`"), "{note}");
        assert_eq!(policy_miss_note(&aimed, &Ok(())), None);
        assert_eq!(
            policy_miss_note(&json!({}), &Err(PolicyMiss::FitKind)),
            None,
            "an ordinary hire's card does not mention a policy it never asked for"
        );
    }

    // ── placement.projectId ─────────────────────────────────────────────────

    struct TempRoot(std::path::PathBuf);
    impl TempRoot {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir()
                .join(format!("personas_kp_gig_{tag}_{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A workspace + a project in it, with the OS temp dir as the allowed root
    /// (the persisted setting — never the process-global env var).
    fn gig_fixture(pool: &DbPool, root: &TempRoot) -> (DevWorkspace, DevProject) {
        let roots = serde_json::to_string(&vec![std::fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .to_string_lossy()
            .to_string()])
        .unwrap();
        crate::db::repos::core::settings::set_operator_only(
            pool,
            crate::db::settings_keys::MANAGEMENT_HTTP_PROJECT_ROOTS,
            &roots,
        )
        .unwrap();
        let ws = ws_repo::create_workspace(pool, "Gigs - security", None, None, false).unwrap();
        let project = crate::db::project_identity::register_project(
            pool,
            "gig",
            root.0.to_str().unwrap(),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let project = ws_repo::assign_project(pool, &project.id, Some(&ws.id)).unwrap();
        (ws, project)
    }

    #[test]
    fn placement_project_is_checked_and_its_workspace_derived_when_unnamed() {
        // The env override would shadow the setting this test writes.
        if std::env::var_os(personas_db::execution_project::HTTP_PROJECT_ROOTS_ENV).is_some() {
            return;
        }
        let pool = crate::db::init_test_db().unwrap();
        let root = TempRoot::new("link");
        let (ws, project) = gig_fixture(&pool, &root);

        assert!(validate_hire_project(&pool, &json!({}), None)
            .unwrap()
            .is_none());
        assert!(
            validate_hire_project(&pool, &json!({"placement": {"projectId": null}}), None)
                .unwrap()
                .is_none()
        );

        let named = validate_hire_project(
            &pool,
            &json!({"placement": {"workspaceId": ws.id, "projectId": project.id}}),
            Some(&ws),
        )
        .unwrap()
        .unwrap();
        assert_eq!(named.project.id, project.id);
        assert!(named.derived_workspace.is_none());

        let derived = validate_hire_project(
            &pool,
            &json!({"placement": {"projectId": project.id}}),
            None,
        )
        .unwrap()
        .unwrap();
        assert_eq!(derived.derived_workspace.unwrap().id, ws.id);

        let other = ws_repo::create_workspace(&pool, "Gigs - web", None, None, false).unwrap();
        let e = validate_hire_project(
            &pool,
            &json!({"placement": {"workspaceId": other.id, "projectId": project.id}}),
            Some(&other),
        )
        .unwrap_err();
        assert_eq!(
            (e.status, e.code),
            (StatusCode::FORBIDDEN, "project_outside_persona_workspace")
        );

        let e = validate_hire_project(&pool, &json!({"placement": {"projectId": "nope"}}), None)
            .unwrap_err();
        assert_eq!(
            (e.status, e.code),
            (StatusCode::NOT_FOUND, "project_not_found")
        );

        let e = validate_hire_project(&pool, &json!({"placement": {"projectId": 7}}), None)
            .unwrap_err();
        assert_eq!(
            (e.status, e.code),
            (StatusCode::BAD_REQUEST, "invalid_placement")
        );
    }

    // ── retire ──────────────────────────────────────────────────────────────

    fn kp_key(pool: &DbPool, name: &str) -> String {
        crate::db::repos::resources::external_api_keys::create(
            pool,
            name,
            vec!["personas:read".into(), "personas:build".into()],
            None,
            Some("http://localhost:3000".into()),
            None,
        )
        .unwrap()
        .record
        .id
    }

    fn persona(pool: &DbPool, name: &str) -> String {
        persona_repo::create(
            pool,
            crate::db::models::CreatePersonaInput {
                name: name.into(),
                system_prompt: "You are a gig persona.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
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
        .unwrap()
        .id
    }

    /// A kp hire row as the intake writes it, approved, with the executor's
    /// result stamp — and the grant the executor then issues.
    fn hired(
        pool: &DbPool,
        user_db: &crate::db::UserDbPool,
        approval_id: &str,
        key: &str,
        persona_id: &str,
    ) {
        super::super::insert_kp_hire_approval(
            user_db,
            approval_id,
            &json!({"requestId": approval_id}),
            "gig hire",
            Some(key),
        )
        .unwrap();
        let conn = user_db.get().unwrap();
        let payload: String = conn
            .query_row(
                "SELECT payload FROM companion_approval WHERE id = ?1",
                rusqlite::params![approval_id],
                |r| r.get(0),
            )
            .unwrap();
        let mut v: Value = serde_json::from_str(&payload).unwrap();
        v["result"] = json!({"personaId": persona_id, "personaName": "gig", "buildSessionId": "s"});
        conn.execute(
            "UPDATE companion_approval SET payload = ?2, status = 'approved' WHERE id = ?1",
            rusqlite::params![approval_id, v.to_string()],
        )
        .unwrap();
        drop(conn);
        personas_engine::kp_execute_grant::grant_on_hire_approval(
            pool,
            user_db,
            approval_id,
            persona_id,
        );
    }

    fn scopes(pool: &DbPool, key: &str) -> Vec<String> {
        crate::db::repos::resources::external_api_keys::list(pool)
            .unwrap()
            .into_iter()
            .find(|k| k.id == key)
            .unwrap()
            .parsed_scopes()
    }

    #[test]
    fn the_hiring_key_retires_its_persona_and_keeps_its_history() {
        let pool = crate::db::init_test_db().unwrap();
        let user_db = crate::db::init_test_user_db().unwrap();
        let key = kp_key(&pool, "kp");
        let p = persona(&pool, "Gig persona");
        hired(&pool, &user_db, "appr_r1", &key, &p);
        let grant = format!("personas:execute:persona:{p}");
        assert!(scopes(&pool, &key).contains(&grant));

        // A project with a milestone in it, and a past execution of the persona.
        let root = TempRoot::new("retire");
        let project = crate::db::project_identity::register_project(
            &pool,
            "gig",
            root.0.to_str().unwrap(),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let milestone = crate::db::repos::dev::milestones::create_milestone(
            &pool,
            &project.id,
            "Deliver the gig",
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO persona_executions (id, persona_id, status, created_at)
             VALUES ('exec_r1', ?1, 'completed', datetime('now'))",
            rusqlite::params![p],
        )
        .unwrap();
        drop(conn);

        let out = retire_for_key(&pool, &user_db, &key, &p).unwrap();
        assert!(!out.already);
        assert!(out.archived);
        assert_eq!(out.grants_revoked, 1);
        assert!(
            !scopes(&pool, &key).contains(&grant),
            "the grant is revoked"
        );
        let row = persona_repo::get_by_id(&pool, &p).unwrap();
        assert_eq!(row.lifecycle, "archived");
        // Kept: the project and the persona's past executions.
        assert!(crate::db::repos::dev_tools::get_project_by_id(&pool, &project.id).is_ok());
        let milestones: i64 = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM dev_milestones WHERE id = ?1",
                rusqlite::params![milestone.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            milestones, 1,
            "the project's milestone survives the retirement"
        );
        let n: i64 = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM persona_executions WHERE persona_id = ?1",
                rusqlite::params![p],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1, "past executions survive the retirement");

        // Idempotent: a repeat retire says so and removes nothing.
        let again = retire_for_key(&pool, &user_db, &key, &p).unwrap();
        assert!(again.already);
        assert_eq!(again.grants_revoked, 0);

        // An operator-deleted persona this key hired: already, 200.
        persona_repo::delete(&pool, &p).unwrap();
        let gone = retire_for_key(&pool, &user_db, &key, &p).unwrap();
        assert!(gone.already);
        assert!(!gone.archived);
    }

    #[test]
    fn another_keys_persona_is_forbidden_and_an_unknown_id_is_not_found() {
        let pool = crate::db::init_test_db().unwrap();
        let user_db = crate::db::init_test_user_db().unwrap();
        let owner = kp_key(&pool, "kp-a");
        let stranger = kp_key(&pool, "kp-b");
        let p = persona(&pool, "Gig persona");
        hired(&pool, &user_db, "appr_r2", &owner, &p);

        let e = retire_for_key(&pool, &user_db, &stranger, &p).unwrap_err();
        assert_eq!(
            (e.status, e.code),
            (StatusCode::FORBIDDEN, "persona_not_hired_by_this_key")
        );
        assert_eq!(
            persona_repo::get_by_id(&pool, &p).unwrap().lifecycle,
            "active"
        );
        assert!(scopes(&pool, &owner).contains(&format!("personas:execute:persona:{p}")));

        // A persona no kp request produced is not the key's to end either.
        let manual = persona(&pool, "Operator's own");
        let e = retire_for_key(&pool, &user_db, &owner, &manual).unwrap_err();
        assert_eq!(e.status, StatusCode::FORBIDDEN);

        let e = retire_for_key(&pool, &user_db, &owner, "no-such-persona").unwrap_err();
        assert_eq!(
            (e.status, e.code),
            (StatusCode::NOT_FOUND, "persona_not_found")
        );
    }

    // ── the gig persona policy's approval (approvals::approval_policy) ──────

    use crate::commands::companion::approvals::{
        claim_for_policy, claim_pending, operator_actor, stamp_decision,
    };
    use personas_db::kp_gig_policy::POLICY_ACTOR;

    fn policy_row(user_db: &crate::db::UserDbPool, id: &str, key: &str) {
        super::super::insert_kp_hire_approval(
            user_db,
            id,
            &json!({"requestId": id, "fit": {"kind": personas_db::kp_gig_policy::FIT_KIND}}),
            "KP job 'gig' requests an AI hire",
            Some(key),
        )
        .unwrap();
    }

    fn status_and_payload(user_db: &crate::db::UserDbPool, id: &str) -> (String, Value) {
        let conn = user_db.get().unwrap();
        let (status, payload): (String, String) = conn
            .query_row(
                "SELECT status, payload FROM companion_approval WHERE id = ?1",
                rusqlite::params![id],
                |r| Ok((r.get("status")?, r.get("payload")?)),
            )
            .unwrap();
        (status, serde_json::from_str(&payload).unwrap())
    }

    #[test]
    fn the_policy_claims_the_row_and_names_itself_as_the_decider() {
        let pool = crate::db::init_test_db().unwrap();
        let user_db = crate::db::init_test_user_db().unwrap();
        let key = kp_key(&pool, "kp");
        policy_row(&user_db, "appr_pol1", &key);

        let (action, params) = claim_for_policy(&user_db, "appr_pol1").unwrap();
        assert_eq!(action, "kp_hire_request");
        assert_eq!(params["requestId"], "appr_pol1");
        let (status, payload) = status_and_payload(&user_db, "appr_pol1");
        assert_eq!(status, "running", "the same CAS every decision path takes");
        assert_eq!(payload["decidedBy"], POLICY_ACTOR);
        assert!(payload["decisionNote"]
            .as_str()
            .unwrap()
            .contains("gig persona policy"));
        // Exactly one decider wins: a click racing the policy loses the claim.
        assert!(claim_for_policy(&user_db, "appr_pol1").is_err());
        assert!(claim_pending(&user_db, "appr_pol1").is_err());
    }

    /// The executor grants through `grant_on_hire_approval(approval_id)`, which
    /// reads the submitter off the row. The policy's claim and stamp leave that
    /// column alone, so the grant is the one an operator approval issues: this
    /// key, this persona, this exact scope.
    #[test]
    fn a_policy_approval_leads_to_the_same_execute_grant_as_an_operator_approval() {
        use personas_engine::kp_execute_grant::{grant_on_hire_approval, HireGrant};
        let pool = crate::db::init_test_db().unwrap();
        let user_db = crate::db::init_test_user_db().unwrap();
        let key = kp_key(&pool, "kp");

        policy_row(&user_db, "appr_pol2", &key);
        claim_for_policy(&user_db, "appr_pol2").unwrap();
        assert_eq!(
            grant_on_hire_approval(&pool, &user_db, "appr_pol2", "persona-gig-1"),
            HireGrant::Granted {
                key_id: key.clone(),
                scope: "personas:execute:persona:persona-gig-1".into(),
            }
        );

        // The operator API's claim + stamp on a sibling row: the identical grant.
        policy_row(&user_db, "appr_op", &key);
        claim_pending(&user_db, "appr_op").unwrap();
        stamp_decision(&user_db, "appr_op", &operator_actor("op-key"), None).unwrap();
        assert_eq!(
            grant_on_hire_approval(&pool, &user_db, "appr_op", "persona-gig-2"),
            HireGrant::Granted {
                key_id: key,
                scope: "personas:execute:persona:persona-gig-2".into(),
            }
        );
    }

    #[test]
    fn the_policy_decides_kp_hire_requests_only() {
        let user_db = crate::db::init_test_user_db().unwrap();
        user_db
            .get()
            .unwrap()
            .execute(
                "INSERT INTO companion_approval (id, session_id, kind, payload, status, created_at)
                 VALUES ('appr_other', 'default', 'op_execute', ?1, 'pending', datetime('now'))",
                rusqlite::params![json!({"action": "run_persona", "params": {}}).to_string()],
            )
            .unwrap();
        let err = claim_for_policy(&user_db, "appr_other").unwrap_err();
        assert!(
            err.to_string().contains("decides `kp_hire_request` only"),
            "{err}"
        );
    }
}
