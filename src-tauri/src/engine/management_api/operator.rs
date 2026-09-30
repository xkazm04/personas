//! Operator approval routes — the local operator deciding pending approvals and
//! cloud pairings over HTTP instead of clicking in the desktop app.
//!
//! Every route here requires `personas:approve` (see `authorize`), a scope
//! held by exactly one key: the file-delivered `operator-local` key
//! (`personas_db::operator_key`). It is never grantable through pairing and
//! never implied by another scope, so kp's `read + build` key, a paired cloud
//! origin, and even a broad `personas:execute` key all get 403 here.
//!
//! The routes do not decide anything themselves:
//! - `POST /api/approvals/{id}/approve|reject` claim the row through the same
//!   `pending` → `running` CAS and run the same functions as the inbox's
//!   Approve / Reject buttons (`approvals::operator_approve` /
//!   `operator_reject`), recording `decidedBy: "operator-api:<key id>"`.
//! - `POST /api/pairings/{nonce}/approve|reject` call the same code as the
//!   Tauri pairing commands (`external_api_keys::approve_pairing_core`,
//!   `pairing::set_rejected`); approving still mints only what the pairing
//!   lane may grant.

use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{Extension, Path, Query, State as AxumState},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::Manager;

use super::{err_code, ok_json, AuthedApiKey, ManagementState};
use crate::commands::companion::approvals::{
    operator_actor, operator_approve, operator_reject, pending_approval_rows,
    OperatorDecisionError, PendingApprovalRow,
};
use crate::db::repos::resources::external_api_keys as key_repo;
use crate::db::DbPool;
use crate::engine::pairing;

/// Mirrors `APPROVAL_FRESHNESS_WINDOW` (24 h): a pending row older than this
/// can no longer be acted on.
const FRESHNESS_HOURS: i64 = 24;
const NOTE_MAX: usize = 2000;

fn fail(status: StatusCode, code: &str, msg: impl AsRef<str>) -> Response {
    err_code(status, code, msg.as_ref()).into_response()
}

/// `fail`, boxed — the helpers below return it as their `Err` (a bare
/// `Response` is large enough that clippy flags every `Result` carrying it).
fn refuse(status: StatusCode, code: &str, msg: impl AsRef<str>) -> Box<Response> {
    Box::new(fail(status, code, msg))
}

/// Parse an optional JSON object body; empty = `{}`.
fn parse_optional_body(body: &Bytes) -> Result<Value, Box<Response>> {
    if body.iter().all(u8::is_ascii_whitespace) {
        return Ok(json!({}));
    }
    match serde_json::from_slice::<Value>(body) {
        Ok(v) if v.is_object() => Ok(v),
        Ok(_) => Err(refuse(
            StatusCode::BAD_REQUEST,
            "invalid_body",
            "body must be a JSON object",
        )),
        Err(e) => Err(refuse(
            StatusCode::BAD_REQUEST,
            "invalid_body",
            format!("malformed body: {e}"),
        )),
    }
}

/// An optional string field, trimmed, bounded.
fn opt_text(body: &Value, field: &str, code: &str) -> Result<Option<String>, Box<Response>> {
    match body.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => {
            let t = s.trim();
            if t.chars().count() > NOTE_MAX {
                Err(refuse(
                    StatusCode::BAD_REQUEST,
                    code,
                    format!("`{field}` exceeds {NOTE_MAX} characters"),
                ))
            } else if t.is_empty() {
                Ok(None)
            } else {
                Ok(Some(t.to_string()))
            }
        }
        Some(_) => Err(refuse(
            StatusCode::BAD_REQUEST,
            code,
            format!("`{field}` must be a string"),
        )),
    }
}

fn app_user_db(state: &ManagementState) -> Result<crate::db::UserDbPool, Box<Response>> {
    match state.app.try_state::<Arc<crate::AppState>>() {
        Some(s) => Ok(s.user_db.clone()),
        None => Err(refuse(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "App state not available",
        )),
    }
}

// ── GET /api/approvals ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub(super) struct ApprovalsQuery {
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    action: Option<String>,
}

/// SQLite `datetime('now')` text → (RFC 3339 created, RFC 3339 expires).
fn created_and_expiry(raw: &str) -> (String, Option<String>) {
    match chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S") {
        Ok(naive) => {
            let created = naive.and_utc();
            (
                created.to_rfc3339(),
                Some((created + chrono::Duration::hours(FRESHNESS_HOURS)).to_rfc3339()),
            )
        }
        Err(_) => (raw.to_string(), None),
    }
}

/// The few facts a human needs before deciding a kp hire, read off the raw
/// params. `null` for every other action — the rationale carries those.
pub(super) fn kp_hire_summary(pool: &DbPool, params: &Value) -> Value {
    let workspace_id = params
        .pointer("/placement/workspaceId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let workspace_name = workspace_id.and_then(|id| {
        crate::db::repos::workspaces::org::get_workspace_by_id(pool, id)
            .ok()
            .map(|w| w.name)
    });
    json!({
        "personaName": params.pointer("/spec/name").and_then(Value::as_str),
        "jobTitle": params.pointer("/kp/jobTitle").and_then(Value::as_str),
        "jobId": params.pointer("/kp/jobId").and_then(Value::as_str),
        "placementWorkspaceId": workspace_id,
        "placementWorkspaceName": workspace_name,
        "maxBudgetUsd": params.pointer("/spec/maxBudgetUsd").and_then(Value::as_f64),
        "connectors": params
            .pointer("/spec/connectors")
            .and_then(Value::as_array)
            .map(|a| a.len())
            .unwrap_or(0),
        "appMaster": params.get("appMaster").is_some_and(|v| !v.is_null()),
    })
}

pub(super) fn approval_view(
    pool: &DbPool,
    row: &PendingApprovalRow,
    key_names: &HashMap<String, String>,
) -> Value {
    let (created_at, expires_at) = created_and_expiry(&row.created_at);
    let summary = if row.action == "kp_hire_request" {
        kp_hire_summary(pool, &row.params)
    } else {
        Value::Null
    };
    let requested_by = row.requested_by_key_id.as_ref().map(|id| {
        json!({
            "keyId": id,
            "keyName": key_names.get(id),
        })
    });
    json!({
        "id": row.id,
        "action": row.action,
        "createdAt": created_at,
        "expiresAt": expires_at,
        "rationale": row.rationale,
        "summary": summary,
        "requestedBy": requested_by,
    })
}

pub(super) async fn list_approvals(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Query(q): Query<ApprovalsQuery>,
) -> Response {
    match q.status.as_deref().map(str::trim) {
        None | Some("") | Some("pending") => {}
        Some(other) => {
            return fail(
                StatusCode::BAD_REQUEST,
                "unsupported_status",
                format!("only `status=pending` is listed, not `{other}`"),
            )
        }
    }
    let user_db = match app_user_db(&state) {
        Ok(p) => p,
        Err(r) => return *r,
    };
    let rows = match pending_approval_rows(&user_db) {
        Ok(r) => r,
        Err(e) => {
            return fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                e.to_string(),
            )
        }
    };
    let key_names: HashMap<String, String> = key_repo::list(&state.pool)
        .map(|keys| keys.into_iter().map(|k| (k.id, k.name)).collect())
        .unwrap_or_default();
    let wanted = q.action.as_deref().map(str::trim).filter(|a| !a.is_empty());
    let items: Vec<Value> = rows
        .iter()
        .filter(|r| wanted.map_or(true, |a| r.action == a))
        .map(|r| approval_view(&state.pool, r, &key_names))
        .collect();
    ok_json(json!({ "approvals": items })).into_response()
}

// ── POST /api/approvals/{id}/approve|reject ─────────────────────────────────

fn decision_error(e: OperatorDecisionError) -> Response {
    match e {
        OperatorDecisionError::NotFound => fail(
            StatusCode::NOT_FOUND,
            "approval_not_found",
            "no approval with that id",
        ),
        OperatorDecisionError::NotPending(status) => fail(
            StatusCode::CONFLICT,
            "approval_not_pending",
            format!("the approval is `{status}`, not pending"),
        ),
        OperatorDecisionError::Failed(e) => fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "approval_execution_failed",
            e.to_string(),
        ),
    }
}

pub(super) async fn approve_approval(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Extension(key): Extension<AuthedApiKey>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let body = match parse_optional_body(&body) {
        Ok(b) => b,
        Err(r) => return *r,
    };
    let note = match opt_text(&body, "note", "invalid_note") {
        Ok(n) => n,
        Err(r) => return *r,
    };
    let app = state.app.clone();
    match operator_approve(&app, &id, &key.id, note.as_deref()).await {
        Ok(d) => {
            let persona_id = d
                .result
                .as_ref()
                .and_then(|r| r.get("personaId"))
                .and_then(Value::as_str)
                .map(String::from);
            let build_session_id = d
                .result
                .as_ref()
                .and_then(|r| r.get("buildSessionId"))
                .and_then(Value::as_str)
                .map(String::from);
            ok_json(json!({
                "id": d.outcome.id,
                "action": d.action,
                // `approved` | `approved_failed` (the decision is recorded
                // either way; the executor failing is reported, not hidden).
                "status": d.outcome.status,
                "message": d.outcome.message,
                "decidedBy": operator_actor(&key.id),
                "personaId": persona_id,
                "buildSessionId": build_session_id,
                // A kp hire's persona is a draft whose one-shot build has just
                // started; poll GET /api/kp/persona-requests/{id} for `active`.
                "building": d.action == "kp_hire_request"
                    && d.outcome.status == "approved"
                    && build_session_id.is_some(),
            }))
            .into_response()
        }
        Err(e) => decision_error(e),
    }
}

pub(super) async fn reject_approval(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Extension(key): Extension<AuthedApiKey>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let body = match parse_optional_body(&body) {
        Ok(b) => b,
        Err(r) => return *r,
    };
    let reason = match opt_text(&body, "reason", "invalid_reason") {
        Ok(n) => n,
        Err(r) => return *r,
    };
    let app = state.app.clone();
    match operator_reject(&app, &id, &key.id, reason.as_deref()).await {
        Ok(d) => ok_json(json!({
            "id": d.outcome.id,
            "action": d.action,
            "status": d.outcome.status,
            "message": d.outcome.message,
            "decidedBy": operator_actor(&key.id),
        }))
        .into_response(),
        Err(e) => decision_error(e),
    }
}

// ── pairings ────────────────────────────────────────────────────────────────

pub(super) async fn list_pending_pairings() -> Response {
    let items: Vec<Value> = pairing::list_views()
        .into_iter()
        .map(|v| {
            json!({
                "nonce": v.nonce,
                "origin": v.origin,
                "appName": v.app_name,
                // Already moulded to the pairing lane's ceiling.
                "requestedScopes": v.requested_scopes,
            })
        })
        .collect();
    ok_json(json!({ "pairings": items })).into_response()
}

/// The scopes an operator approval mints: the body's `scopes` when given (each
/// must be pairable), else the request's own — already moulded to the ceiling.
pub(super) fn pairing_scopes(
    body: &Value,
    requested: &[String],
) -> Result<Vec<String>, Box<Response>> {
    let scopes: Vec<String> = match body.get("scopes") {
        None | Some(Value::Null) => requested.to_vec(),
        Some(Value::Array(a)) => {
            let mut out = Vec::with_capacity(a.len());
            for s in a {
                match s.as_str() {
                    Some(s) => out.push(s.trim().to_string()),
                    None => {
                        return Err(refuse(
                            StatusCode::BAD_REQUEST,
                            "invalid_body",
                            "`scopes` must be an array of strings",
                        ))
                    }
                }
            }
            out
        }
        Some(_) => {
            return Err(refuse(
                StatusCode::BAD_REQUEST,
                "invalid_body",
                "`scopes` must be an array of strings",
            ))
        }
    };
    let outside = pairing::unpairable_scopes(&scopes);
    if !outside.is_empty() {
        return Err(refuse(
            StatusCode::BAD_REQUEST,
            "scope_not_pairable",
            format!(
                "these scopes cannot be granted to a paired origin: {}",
                outside.join(", ")
            ),
        ));
    }
    if scopes.is_empty() {
        return Err(refuse(
            StatusCode::BAD_REQUEST,
            "no_scopes",
            "nothing to grant: the request named no pairable scope and none was given",
        ));
    }
    Ok(scopes)
}

pub(super) async fn approve_pairing(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Extension(key): Extension<AuthedApiKey>,
    Path(nonce): Path<String>,
    body: Bytes,
) -> Response {
    let body = match parse_optional_body(&body) {
        Ok(b) => b,
        Err(r) => return *r,
    };
    let Some(view) = pairing::list_views().into_iter().find(|v| v.nonce == nonce) else {
        return fail(
            StatusCode::NOT_FOUND,
            "pairing_not_found",
            "no pending pairing with that nonce (expired or already resolved)",
        );
    };
    let scopes = match pairing_scopes(&body, &view.requested_scopes) {
        Ok(s) => s,
        Err(r) => return *r,
    };
    let expires_in_days = match body.get("expiresInDays") {
        None | Some(Value::Null) => None,
        Some(v) => match v.as_u64().filter(|d| (1..=3650).contains(d)) {
            Some(d) => Some(d as u32),
            None => {
                return fail(
                    StatusCode::BAD_REQUEST,
                    "invalid_body",
                    "`expiresInDays` must be an integer between 1 and 3650",
                )
            }
        },
    };
    let actor = operator_actor(&key.id);
    match crate::commands::credentials::external_api_keys::approve_pairing_core(
        &state.pool,
        &nonce,
        scopes,
        expires_in_days,
        &actor,
    ) {
        Ok((key_id, granted)) => {
            tracing::info!(origin = %view.origin, actor = %actor, "operator api: pairing approved");
            ok_json(json!({
                "nonce": nonce,
                "status": "approved",
                "origin": view.origin,
                "keyId": key_id,
                "scopes": granted,
                "decidedBy": actor,
            }))
            .into_response()
        }
        Err(crate::error::AppError::NotFound(m)) => {
            fail(StatusCode::NOT_FOUND, "pairing_not_found", m)
        }
        Err(crate::error::AppError::Validation(m)) => {
            fail(StatusCode::BAD_REQUEST, "scope_not_pairable", m)
        }
        Err(e) => fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            e.to_string(),
        ),
    }
}

pub(super) async fn reject_pairing(
    Extension(key): Extension<AuthedApiKey>,
    Path(nonce): Path<String>,
) -> Response {
    let Some((origin, _)) = pairing::pending_origin(&nonce) else {
        return fail(
            StatusCode::NOT_FOUND,
            "pairing_not_found",
            "no pending pairing with that nonce (expired or already resolved)",
        );
    };
    pairing::set_rejected(&nonce);
    let actor = operator_actor(&key.id);
    tracing::info!(origin = %origin, actor = %actor, "operator api: pairing rejected");
    ok_json(json!({
        "nonce": nonce,
        "status": "rejected",
        "origin": origin,
        "decidedBy": actor,
    }))
    .into_response()
}

// ── /api/settings/http-project-roots ────────────────────────────────────────

const MAX_ROOTS: usize = 32;

/// Validate and canonicalise the operator's roots: each absolute, no `..`,
/// an existing directory, not a filesystem or drive root (the same checks a
/// project folder gets — `workspaces::canonical_project_root`). Deduplicated,
/// order kept.
pub(super) fn validate_roots(body: &Value) -> Result<Vec<String>, Box<Response>> {
    let Some(list) = body.get("roots").and_then(Value::as_array) else {
        return Err(refuse(
            StatusCode::BAD_REQUEST,
            "invalid_body",
            "body must be `{\"roots\": [\"<absolute dir>\", ...]}`",
        ));
    };
    if list.len() > MAX_ROOTS {
        return Err(refuse(
            StatusCode::BAD_REQUEST,
            "invalid_body",
            format!("at most {MAX_ROOTS} roots"),
        ));
    }
    let mut out: Vec<String> = Vec::with_capacity(list.len());
    for entry in list {
        let Some(raw) = entry.as_str() else {
            return Err(refuse(
                StatusCode::BAD_REQUEST,
                "invalid_body",
                "`roots` must be an array of strings",
            ));
        };
        let canonical = super::workspaces::canonical_project_root(raw)
            .map_err(|e| Box::new(e.into_response()))?;
        let text = canonical.to_string_lossy().to_string();
        if !out.contains(&text) {
            out.push(text);
        }
    }
    Ok(out)
}

fn roots_view(pool: &DbPool) -> Value {
    use crate::db::execution_project::{allowed_project_roots_with_source, RootsSource};
    let stored: Vec<String> = crate::db::repos::core::settings::get(
        pool,
        crate::db::settings_keys::MANAGEMENT_HTTP_PROJECT_ROOTS,
    )
    .ok()
    .flatten()
    .and_then(|v| serde_json::from_str(&v).ok())
    .unwrap_or_default();
    let (effective, source) = allowed_project_roots_with_source(pool);
    json!({
        // What the shared database holds — every instance reads this.
        "roots": stored,
        // What THIS process enforces right now (canonical), and why.
        "effectiveRoots": effective
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect::<Vec<_>>(),
        "source": source.as_str(),
        "envOverride": source == RootsSource::Env,
    })
}

/// `GET /api/settings/http-project-roots` — any valid key (a read).
pub(super) async fn get_http_project_roots(
    AxumState(state): AxumState<Arc<ManagementState>>,
) -> Response {
    ok_json(roots_view(&state.pool)).into_response()
}

/// `PUT /api/settings/http-project-roots` `{roots: string[]}` — the operator
/// only (`personas:approve`). Writes through `set_operator_only`, the one door
/// the generic settings writers cannot reach. An empty list clears the setting
/// (fail-closed: nothing may be registered or bound).
pub(super) async fn put_http_project_roots(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Extension(key): Extension<AuthedApiKey>,
    body: Bytes,
) -> Response {
    let body = match parse_optional_body(&body) {
        Ok(b) => b,
        Err(r) => return *r,
    };
    let roots = match validate_roots(&body) {
        Ok(r) => r,
        Err(r) => return *r,
    };
    let setting = crate::db::settings_keys::MANAGEMENT_HTTP_PROJECT_ROOTS;
    let written = if roots.is_empty() {
        crate::db::repos::core::settings::delete_operator_only(&state.pool, setting).map(|_| ())
    } else {
        match serde_json::to_string(&roots) {
            Ok(json) => {
                crate::db::repos::core::settings::set_operator_only(&state.pool, setting, &json)
            }
            Err(e) => Err(crate::error::AppError::Internal(e.to_string())),
        }
    };
    if let Err(e) = written {
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            e.to_string(),
        );
    }
    tracing::info!(
        actor = %operator_actor(&key.id),
        count = roots.len(),
        "operator api: HTTP project roots set"
    );
    ok_json(roots_view(&state.pool)).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn created_at_maps_to_rfc3339_with_a_24h_expiry() {
        let (c, e) = created_and_expiry("2026-09-25 10:00:00");
        assert_eq!(c, "2026-09-25T10:00:00+00:00");
        assert_eq!(e.as_deref(), Some("2026-09-26T10:00:00+00:00"));
        let (raw, none) = created_and_expiry("garbage");
        assert_eq!(raw, "garbage");
        assert!(none.is_none());
    }

    #[test]
    fn a_kp_hire_summary_names_the_hire_and_its_placement() {
        let pool = crate::db::init_test_db().unwrap();
        let ws = crate::db::repos::workspaces::org::create_workspace(
            &pool,
            "Freelance",
            None,
            None,
            false,
        )
        .unwrap();
        let s = kp_hire_summary(
            &pool,
            &json!({
                "kp": {"jobTitle": "Landing page", "jobId": "gig-1"},
                "spec": {"name": "Web specialist", "maxBudgetUsd": 12.5, "connectors": ["github"]},
                "placement": {"workspaceId": ws.id},
            }),
        );
        assert_eq!(s["personaName"], "Web specialist");
        assert_eq!(s["jobTitle"], "Landing page");
        assert_eq!(s["placementWorkspaceName"], "Freelance");
        assert_eq!(s["maxBudgetUsd"], 12.5);
        assert_eq!(s["connectors"], 1);
        assert_eq!(s["appMaster"], false);
    }

    /// The operator cannot hand a paired origin more than pairing may grant,
    /// and cannot mint an empty key.
    #[test]
    fn operator_pairing_approval_stays_under_the_ceiling() {
        let requested = vec!["personas:read".to_string()];
        assert_eq!(
            pairing_scopes(&json!({}), &requested).unwrap(),
            vec!["personas:read".to_string()]
        );
        for bad in [
            json!({"scopes": ["personas:approve"]}),
            json!({"scopes": ["proxy"]}),
            json!({"scopes": ["personas:read", "personas:test"]}),
        ] {
            assert!(pairing_scopes(&bad, &requested).is_err(), "{bad}");
        }
        assert!(pairing_scopes(&json!({}), &[]).is_err(), "no scopes");
        assert!(pairing_scopes(&json!({"scopes": "personas:read"}), &requested).is_err());
    }

    async fn code_of(r: Box<Response>) -> String {
        let bytes = axum::body::to_bytes(r.into_body(), 1 << 16).await.unwrap();
        serde_json::from_slice::<Value>(&bytes).unwrap()["code"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[tokio::test]
    async fn roots_are_validated_like_project_folders() {
        let base = std::env::temp_dir().join(format!("personas_roots_{}", uuid::Uuid::new_v4()));
        let gigs = base.join("gigs");
        std::fs::create_dir_all(&gigs).unwrap();
        let file = base.join("f.txt");
        std::fs::write(&file, "x").unwrap();
        let g = gigs.to_str().unwrap();

        let ok = validate_roots(&json!({"roots": [g, g]})).unwrap();
        assert_eq!(ok.len(), 1, "deduplicated");
        assert!(validate_roots(&json!({"roots": []})).unwrap().is_empty());

        let fs_root = gigs
            .ancestors()
            .last()
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        let cases = [
            (json!({}), "invalid_body"),
            (json!({"roots": [3]}), "invalid_body"),
            (json!({"roots": ["relative/gigs"]}), "invalid_root_path"),
            (
                json!({"roots": [base.join("missing").to_str().unwrap()]}),
                "root_path_not_found",
            ),
            (
                json!({"roots": [file.to_str().unwrap()]}),
                "root_path_not_a_directory",
            ),
            (json!({"roots": [fs_root]}), "root_path_is_filesystem_root"),
        ];
        for (body, want) in cases {
            assert_eq!(
                code_of(validate_roots(&body).unwrap_err()).await,
                want,
                "{body}"
            );
        }
        let _ = std::fs::remove_dir_all(&base);
    }
}
