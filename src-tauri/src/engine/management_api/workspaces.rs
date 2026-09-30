//! Workspace + project routes on the management API — the HTTP door to what
//! was Tauri-command-only.
//!
//! kp (the sibling hiring app) hires "gig specialist" personas over this
//! bridge and runs them on real freelance gigs. It needs a dedicated
//! workspace for those specialists, one project per gig (the gig's folder on
//! disk), the hire filed in that workspace (`placement` on
//! `POST /api/kp/persona-requests`), and each run executing IN the gig's
//! folder (`_projectId` on `POST /api/execute/{persona_id}`, see
//! `personas_db::execution_project`). This module is the first two:
//!
//! - `POST /api/dev/workspaces` — idempotent by name, through the same repo
//!   function as `dev_tools_workspace_create` (the workspace owns its
//!   cross-project group from birth, rolled back if the group cannot be made).
//! - `POST /api/dev/projects` — through `project_identity::register_project`
//!   (idempotent on the folder, gives the project its own team, writes
//!   `.personas/project.json`), optionally placed in a workspace. A project
//!   already in a DIFFERENT workspace is refused, never moved.
//!
//! Auth: both are writes under `/api/dev/`, so `authorize` demands
//! `personas:build` — the same tier as `/api/build`.
//!
//! Every flow is a plain function over the pool so it is tested without an
//! `AppHandle`; the handlers only map the outcome onto the envelope.

use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use axum::{
    extract::State as AxumState,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use super::{err_code, ok_json, ManagementState};
use crate::db::models::DevWorkspace;
use crate::db::repos::dev_tools as project_repo;
use crate::db::repos::workspaces::org as ws_repo;
use crate::db::DbPool;
use crate::error::AppError;

pub(super) const WORKSPACE_NAME_MAX: usize = 80;
pub(super) const WORKSPACE_DESCRIPTION_MAX: usize = 500;
const WORKSPACE_COLOR_MAX: usize = 32;
const PROJECT_NAME_MAX: usize = 120;
const PROJECT_DESCRIPTION_MAX: usize = 2000;
const PROJECT_TECH_STACK_MAX: usize = 200;
const ROOT_PATH_MAX: usize = 1024;
const ID_MAX: usize = 128;

/// A refusal with its HTTP status and snake_case wire code.
#[derive(Debug)]
pub(super) struct RouteError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl RouteError {
    fn bad(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code,
            message: message.into(),
        }
    }
    fn store(e: AppError) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "internal_error",
            message: e.to_string(),
        }
    }
    fn workspace_not_found(id: &str) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code: "workspace_not_found",
            message: format!("workspace {id} does not exist"),
        }
    }
    pub(super) fn into_response(self) -> Response {
        err_code(self.status, self.code, &self.message).into_response()
    }
}

fn respond(result: Result<Value, RouteError>) -> Response {
    match result {
        Ok(v) => ok_json(v).into_response(),
        Err(e) => e.into_response(),
    }
}

fn parse_body<T: for<'de> Deserialize<'de>>(raw: Value) -> Result<T, RouteError> {
    serde_json::from_value(raw)
        .map_err(|e| RouteError::bad("invalid_body", format!("malformed body: {e}")))
}

/// Trimmed, non-empty, at most `max` characters.
fn required(field: &str, v: &str, max: usize, code: &'static str) -> Result<String, RouteError> {
    let t = v.trim();
    if t.is_empty() {
        return Err(RouteError::bad(
            code,
            format!("`{field}` must not be empty"),
        ));
    }
    if t.chars().count() > max {
        return Err(RouteError::bad(
            code,
            format!("`{field}` exceeds {max} characters"),
        ));
    }
    Ok(t.to_string())
}

/// Trimmed; blank reads as absent; at most `max` characters.
fn optional(
    field: &str,
    v: Option<&str>,
    max: usize,
    code: &'static str,
) -> Result<Option<String>, RouteError> {
    match v.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some(t) if t.chars().count() > max => Err(RouteError::bad(
            code,
            format!("`{field}` exceeds {max} characters"),
        )),
        Some(t) => Ok(Some(t.to_string())),
    }
}

// ── POST /api/dev/workspaces ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CreateWorkspaceBody {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

pub(super) fn create_workspace_flow(
    pool: &DbPool,
    body: &CreateWorkspaceBody,
) -> Result<Value, RouteError> {
    let name = required("name", &body.name, WORKSPACE_NAME_MAX, "invalid_name")?;
    let description = optional(
        "description",
        body.description.as_deref(),
        WORKSPACE_DESCRIPTION_MAX,
        "invalid_description",
    )?;
    let color = optional(
        "color",
        body.color.as_deref(),
        WORKSPACE_COLOR_MAX,
        "invalid_color",
    )?;

    let (ws, created) =
        ws_repo::ensure_workspace(pool, &name, color.as_deref(), description.as_deref())
            .map_err(RouteError::store)?;
    let group =
        crate::db::workspace_team::group_for_workspace(pool, &ws.id).map_err(RouteError::store)?;
    Ok(json!({
        "id": ws.id,
        "name": ws.name,
        // `null` only for a pre-e42 workspace nobody has healed yet — a new
        // one owns its group from birth or is rolled back.
        "groupTeamId": group.map(|g| g.id),
        "created": created,
    }))
}

pub(super) async fn post_workspace(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Json(raw): Json<Value>,
) -> Response {
    respond(
        parse_body::<CreateWorkspaceBody>(raw).and_then(|b| create_workspace_flow(&state.pool, &b)),
    )
}

// ── POST /api/dev/projects ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CreateProjectBody {
    pub name: String,
    pub root_path: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tech_stack: Option<String>,
    #[serde(default)]
    pub workspace_id: Option<String>,
}

/// Resolve a caller-supplied folder to the canonical path a project may be
/// registered at, or refuse.
///
/// Absolute, no `..` component anywhere in what was SENT (a traversal is
/// refused, not resolved), exists, is a directory, and is not a filesystem or
/// drive root. Canonicalised before the directory/root checks so a symlink or
/// a `.` cannot dress a root up as something else; the Windows verbatim prefix
/// (`\\?\C:\…`) is stripped so the stored path matches the classic spelling
/// the rest of the app registers.
pub(super) fn canonical_project_root(raw: &str) -> Result<PathBuf, RouteError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(RouteError::bad(
            "invalid_root_path",
            "`rootPath` must not be empty",
        ));
    }
    if trimmed.chars().count() > ROOT_PATH_MAX {
        return Err(RouteError::bad(
            "invalid_root_path",
            format!("`rootPath` exceeds {ROOT_PATH_MAX} characters"),
        ));
    }
    let sent = Path::new(trimmed);
    if !sent.is_absolute() {
        return Err(RouteError::bad(
            "invalid_root_path",
            "`rootPath` must be an absolute path",
        ));
    }
    if sent.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(RouteError::bad(
            "invalid_root_path",
            "`rootPath` must not contain a `..` component",
        ));
    }
    let canonical = std::fs::canonicalize(sent).map_err(|_| {
        RouteError::bad(
            "root_path_not_found",
            format!("`rootPath` {trimmed} does not exist"),
        )
    })?;
    let canonical = crate::commands::credentials::auth_detect::strip_verbatim_prefix(canonical);
    if !canonical.is_dir() {
        return Err(RouteError::bad(
            "root_path_not_a_directory",
            format!("`rootPath` {trimmed} is not a directory"),
        ));
    }
    if canonical.parent().is_none() {
        return Err(RouteError::bad(
            "root_path_is_filesystem_root",
            "`rootPath` must not be a filesystem or drive root",
        ));
    }
    Ok(canonical)
}

fn in_other_workspace(project_id: &str, current: &str) -> RouteError {
    RouteError {
        status: StatusCode::CONFLICT,
        code: "project_in_other_workspace",
        message: format!(
            "project {project_id} already belongs to workspace {current}; it is never moved by this route"
        ),
    }
}

/// [`create_project_flow_with_roots`] against the HTTP project roots
/// configured right now (`PERSONAS_HTTP_PROJECT_ROOTS`, read per request).
pub(super) fn create_project_flow(
    pool: &DbPool,
    body: &CreateProjectBody,
) -> Result<Value, RouteError> {
    create_project_flow_with_roots(
        pool,
        body,
        &crate::db::execution_project::allowed_project_roots(pool),
    )
}

fn forbidden(code: &'static str, message: impl Into<String>) -> RouteError {
    RouteError {
        status: StatusCode::FORBIDDEN,
        code,
        message: message.into(),
    }
}

/// Register (or return) a project, fail-closed on the allowed roots: with no
/// root configured nothing is registered, and a folder is accepted only when
/// its canonical path lies STRICTLY inside one of `allowed_roots` (the root
/// itself is not a project; comparison is component-wise, case-insensitive on
/// Windows — see `execution_project::is_strictly_inside`).
pub(super) fn create_project_flow_with_roots(
    pool: &DbPool,
    body: &CreateProjectBody,
    allowed_roots: &[PathBuf],
) -> Result<Value, RouteError> {
    use crate::db::execution_project::{path_within_roots, HTTP_PROJECT_ROOTS_ENV};
    let name = required("name", &body.name, PROJECT_NAME_MAX, "invalid_name")?;
    let description = optional(
        "description",
        body.description.as_deref(),
        PROJECT_DESCRIPTION_MAX,
        "invalid_description",
    )?;
    let tech_stack = optional(
        "techStack",
        body.tech_stack.as_deref(),
        PROJECT_TECH_STACK_MAX,
        "invalid_tech_stack",
    )?;
    let workspace_id = optional(
        "workspaceId",
        body.workspace_id.as_deref(),
        ID_MAX,
        "invalid_workspace_id",
    )?;
    if allowed_roots.is_empty() {
        return Err(forbidden(
            "project_roots_not_configured",
            format!(
                "no HTTP project roots are configured: the operator sets them with PUT /api/settings/http-project-roots (or {HTTP_PROJECT_ROOTS_ENV} overrides per process)"
            ),
        ));
    }
    let root = canonical_project_root(&body.root_path)?;
    if !path_within_roots(&root, allowed_roots) {
        return Err(forbidden(
            "root_path_outside_allowed_roots",
            format!(
                "`rootPath` {} is not strictly inside any allowed HTTP project root",
                root.display()
            ),
        ));
    }
    let root_str = root.to_string_lossy().to_string();

    // The workspace is checked BEFORE anything is registered, so a 404 leaves
    // nothing behind.
    let workspace: Option<DevWorkspace> = match workspace_id.as_deref() {
        None => None,
        Some(id) => match ws_repo::get_workspace_by_id(pool, id) {
            Ok(ws) => Some(ws),
            Err(AppError::NotFound(_)) => return Err(RouteError::workspace_not_found(id)),
            Err(e) => return Err(RouteError::store(e)),
        },
    };

    // What was there before decides `created`, and lets an existing project
    // in another workspace be refused before registration touches it.
    let before = project_repo::get_project_by_path(pool, &root_str).map_err(RouteError::store)?;
    if let (Some(existing), Some(ws)) = (&before, &workspace) {
        if let Some(current) = existing.workspace_id.as_deref().filter(|c| *c != ws.id) {
            return Err(in_other_workspace(&existing.id, current));
        }
    }
    let marker_id = crate::db::project_identity::read_marker(&root).map(|m| m.id);

    let register = || {
        crate::db::project_identity::register_project(
            pool,
            &name,
            &root_str,
            description.as_deref(),
            None,
            tech_stack.as_deref(),
            None,
            None,
        )
    };
    let project = match register() {
        Ok(p) => p,
        // `root_path` is UNIQUE: a concurrent registration of the same folder
        // that won the INSERT is the project we wanted.
        Err(e) => match project_repo::get_project_by_path(pool, &root_str) {
            Ok(Some(p)) => p,
            _ => {
                return Err(match e {
                    // The marker names a project still registered elsewhere —
                    // a clone carrying another checkout's identity.
                    AppError::Validation(m) => RouteError {
                        status: StatusCode::CONFLICT,
                        code: "project_identity_conflict",
                        message: m,
                    },
                    other => RouteError::store(other),
                });
            }
        },
    };
    // Existing at this path, or relocated here through its marker, is not a
    // creation.
    let created = before.is_none() && marker_id.as_deref() != Some(project.id.as_str());

    let project = match &workspace {
        None => project,
        Some(ws) => match project.workspace_id.as_deref() {
            Some(current) if current == ws.id => project,
            // Only reachable through a marker relocation; same refusal.
            Some(current) => return Err(in_other_workspace(&project.id, current)),
            None => ws_repo::assign_project(pool, &project.id, Some(&ws.id))
                .map_err(RouteError::store)?,
        },
    };

    Ok(json!({
        "id": project.id,
        "name": project.name,
        "rootPath": project.root_path,
        "workspaceId": project.workspace_id,
        "created": created,
    }))
}

pub(super) async fn post_project(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Json(raw): Json<Value>,
) -> Response {
    respond(parse_body::<CreateProjectBody>(raw).and_then(|b| create_project_flow(&state.pool, &b)))
}

// ── placement on POST /api/kp/persona-requests ──────────────────────────────

/// Validate the optional top-level `placement` of a hire request and return
/// the workspace it names. `Ok(None)` when the body carries no placement (or
/// an explicit `null`): today's behaviour, unchanged. An unknown workspace is
/// `workspace_not_found` at 400 — the request is refused before anything is
/// queued. The body itself is stored verbatim by the caller.
pub(super) fn validate_hire_placement(
    pool: &DbPool,
    raw_body: &Value,
) -> Result<Option<DevWorkspace>, RouteError> {
    let placement = match raw_body.get("placement") {
        None | Some(Value::Null) => return Ok(None),
        Some(p) => p,
    };
    let Some(id) = placement
        .get("workspaceId")
        .and_then(|v| v.as_str())
        .map(str::trim)
    else {
        return Err(RouteError::bad(
            "invalid_placement",
            "`placement` must be an object with a string `workspaceId`",
        ));
    };
    match ws_repo::get_workspace_by_id(pool, id) {
        Ok(ws) => Ok(Some(ws)),
        Err(AppError::NotFound(_)) => Err(RouteError {
            status: StatusCode::BAD_REQUEST,
            code: "workspace_not_found",
            message: format!("`placement.workspaceId` {id} does not exist"),
        }),
        Err(e) => Err(RouteError::store(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    struct TempRoot(PathBuf);
    impl TempRoot {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir()
                .join(format!("personas_mgmt_ws_{tag}_{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&p).unwrap();
            // Canonical form, so assertions compare like with like.
            let p = crate::commands::credentials::auth_detect::strip_verbatim_prefix(
                std::fs::canonicalize(&p).unwrap(),
            );
            Self(p)
        }
        fn s(&self) -> String {
            self.0.to_string_lossy().to_string()
        }
    }
    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn ws_body(name: &str) -> CreateWorkspaceBody {
        CreateWorkspaceBody {
            name: name.into(),
            description: None,
            color: None,
        }
    }

    fn project_body(name: &str, root: &str, ws: Option<&str>) -> CreateProjectBody {
        CreateProjectBody {
            name: name.into(),
            root_path: root.into(),
            description: None,
            tech_stack: Some("markdown".into()),
            workspace_id: ws.map(String::from),
        }
    }

    /// The OS temp dir as the one allowed root — every `TempRoot` is a strict
    /// descendant. Explicit, so no test touches the process-global env.
    fn tmp_roots() -> Vec<PathBuf> {
        vec![std::fs::canonicalize(std::env::temp_dir()).unwrap()]
    }

    // Shadows the env-reading flow for the tests below (local items beat the
    // glob import).
    fn create_project_flow(pool: &DbPool, body: &CreateProjectBody) -> Result<Value, RouteError> {
        create_project_flow_with_roots(pool, body, &tmp_roots())
    }

    // ── allowed roots ──

    #[test]
    fn no_configured_roots_refuses_and_registers_nothing() {
        let pool = init_test_db().unwrap();
        let gig = TempRoot::new("noroots");
        let e = create_project_flow_with_roots(&pool, &project_body("Gig", &gig.s(), None), &[])
            .unwrap_err();
        assert_eq!(
            (e.status, e.code),
            (StatusCode::FORBIDDEN, "project_roots_not_configured")
        );
        assert!(project_repo::get_project_by_path(&pool, &gig.s())
            .unwrap()
            .is_none());
        assert!(!gig.0.join(".personas").exists(), "no marker written");

        // An env value naming only missing folders parses to no roots at all.
        let only_missing = std::env::join_paths([gig.0.join("nope")]).unwrap();
        assert!(crate::db::execution_project::project_roots_from(Some(only_missing)).is_empty());
    }

    #[test]
    fn a_folder_outside_every_root_is_refused() {
        let pool = init_test_db().unwrap();
        let gigs = TempRoot::new("gigs");
        let elsewhere = TempRoot::new("elsewhere");
        let roots = vec![std::fs::canonicalize(&gigs.0).unwrap()];
        let e = create_project_flow_with_roots(
            &pool,
            &project_body("Gig", &elsewhere.s(), None),
            &roots,
        )
        .unwrap_err();
        assert_eq!(
            (e.status, e.code),
            (StatusCode::FORBIDDEN, "root_path_outside_allowed_roots")
        );
        assert!(project_repo::get_project_by_path(&pool, &elsewhere.s())
            .unwrap()
            .is_none());
    }

    /// `…\gigs_<uuid>2` shares the root's string prefix and is still outside.
    #[test]
    fn a_sibling_sharing_the_roots_prefix_is_refused() {
        let pool = init_test_db().unwrap();
        let gigs = TempRoot::new("prefix");
        let sibling = PathBuf::from(format!("{}2", gigs.s()));
        std::fs::create_dir_all(&sibling).unwrap();
        let roots = vec![std::fs::canonicalize(&gigs.0).unwrap()];
        let e = create_project_flow_with_roots(
            &pool,
            &project_body("Gig", sibling.to_str().unwrap(), None),
            &roots,
        )
        .unwrap_err();
        let _ = std::fs::remove_dir_all(&sibling);
        assert_eq!(e.code, "root_path_outside_allowed_roots");
    }

    #[test]
    fn the_root_itself_is_not_a_project() {
        let pool = init_test_db().unwrap();
        let gigs = TempRoot::new("rootself");
        let roots = vec![std::fs::canonicalize(&gigs.0).unwrap()];
        let e =
            create_project_flow_with_roots(&pool, &project_body("Gigs", &gigs.s(), None), &roots)
                .unwrap_err();
        assert_eq!(e.code, "root_path_outside_allowed_roots");
    }

    #[test]
    fn a_descendant_of_a_root_is_registered() {
        let pool = init_test_db().unwrap();
        let gigs = TempRoot::new("descend");
        let gig = gigs.0.join("acme-landing-page");
        std::fs::create_dir_all(&gig).unwrap();
        let roots = vec![std::fs::canonicalize(&gigs.0).unwrap()];
        let p = create_project_flow_with_roots(
            &pool,
            &project_body("Acme", gig.to_str().unwrap(), None),
            &roots,
        )
        .unwrap();
        assert_eq!(p["created"], true);
        assert_eq!(p["rootPath"], gig.to_string_lossy().as_ref());
    }

    // ── workspaces ──

    #[test]
    fn workspace_create_returns_its_group_and_is_idempotent_by_name() {
        let pool = init_test_db().unwrap();
        let first = create_workspace_flow(
            &pool,
            &CreateWorkspaceBody {
                name: "  Freelance agents ".into(),
                description: Some("gig specialists".into()),
                color: Some("#10b981".into()),
            },
        )
        .unwrap();
        assert_eq!(first["name"], "Freelance agents");
        assert_eq!(first["created"], true);
        let group_id = first["groupTeamId"]
            .as_str()
            .expect("group created")
            .to_string();
        let group =
            crate::db::workspace_team::group_for_workspace(&pool, first["id"].as_str().unwrap())
                .unwrap()
                .unwrap();
        assert_eq!(group.id, group_id);

        let again = create_workspace_flow(&pool, &ws_body("FREELANCE AGENTS")).unwrap();
        assert_eq!(again["created"], false);
        assert_eq!(again["id"], first["id"]);
        assert_eq!(again["groupTeamId"], first["groupTeamId"]);
        let stored = ws_repo::get_workspace_by_id(&pool, first["id"].as_str().unwrap()).unwrap();
        assert_eq!(
            stored.color.as_deref(),
            Some("#10b981"),
            "existing is not modified"
        );
    }

    #[test]
    fn workspace_create_validates_with_codes() {
        let pool = init_test_db().unwrap();
        let e = create_workspace_flow(&pool, &ws_body("   ")).unwrap_err();
        assert_eq!(
            (e.status, e.code),
            (StatusCode::BAD_REQUEST, "invalid_name")
        );
        let e = create_workspace_flow(&pool, &ws_body(&"x".repeat(81))).unwrap_err();
        assert_eq!(e.code, "invalid_name");
        assert!(create_workspace_flow(&pool, &ws_body(&"x".repeat(80))).is_ok());
        let e = create_workspace_flow(
            &pool,
            &CreateWorkspaceBody {
                name: "ok".into(),
                description: Some("d".repeat(501)),
                color: None,
            },
        )
        .unwrap_err();
        assert_eq!(e.code, "invalid_description");
        let e = parse_body::<CreateWorkspaceBody>(json!({"description": "no name"})).unwrap_err();
        assert_eq!(e.code, "invalid_body");
    }

    // ── projects ──

    #[test]
    fn project_root_must_be_absolute_existing_dir_and_not_a_root() {
        let e = canonical_project_root("relative/gig").unwrap_err();
        assert_eq!(e.code, "invalid_root_path");
        let e = canonical_project_root("   ").unwrap_err();
        assert_eq!(e.code, "invalid_root_path");

        let root = TempRoot::new("checks");
        let traversal = format!(
            "{}{}..{}x",
            root.s(),
            std::path::MAIN_SEPARATOR,
            std::path::MAIN_SEPARATOR
        );
        assert_eq!(
            canonical_project_root(&traversal).unwrap_err().code,
            "invalid_root_path"
        );

        let missing = root.0.join("does-not-exist");
        assert_eq!(
            canonical_project_root(missing.to_str().unwrap())
                .unwrap_err()
                .code,
            "root_path_not_found"
        );

        let file = root.0.join("a-file.txt");
        std::fs::write(&file, "x").unwrap();
        assert_eq!(
            canonical_project_root(file.to_str().unwrap())
                .unwrap_err()
                .code,
            "root_path_not_a_directory"
        );

        // The filesystem / drive root of the temp dir's own volume.
        let fs_root: PathBuf = root
            .0
            .ancestors()
            .last()
            .expect("a path has a root")
            .to_path_buf();
        assert_eq!(
            canonical_project_root(fs_root.to_str().unwrap())
                .unwrap_err()
                .code,
            "root_path_is_filesystem_root"
        );

        assert_eq!(canonical_project_root(&root.s()).unwrap(), root.0);
    }

    #[test]
    fn project_create_is_idempotent_on_the_folder() {
        let pool = init_test_db().unwrap();
        let root = TempRoot::new("idem");
        let first = create_project_flow(&pool, &project_body("Gig 1", &root.s(), None)).unwrap();
        assert_eq!(first["created"], true);
        assert_eq!(first["rootPath"], root.s());
        assert_eq!(first["workspaceId"], Value::Null);
        assert!(
            root.0.join(".personas/project.json").exists(),
            "marker written"
        );

        // Same folder, sent with a trailing separator.
        let again = create_project_flow(
            &pool,
            &project_body(
                "Renamed",
                &format!("{}{}", root.s(), std::path::MAIN_SEPARATOR),
                None,
            ),
        )
        .unwrap();
        assert_eq!(again["created"], false);
        assert_eq!(again["id"], first["id"]);
        assert_eq!(
            again["name"], "Gig 1",
            "an existing project is returned, not renamed"
        );
    }

    #[test]
    fn project_create_places_in_a_workspace_and_refuses_another() {
        let pool = init_test_db().unwrap();
        let ws = create_workspace_flow(&pool, &ws_body("Freelance")).unwrap();
        let ws_id = ws["id"].as_str().unwrap().to_string();
        let other = create_workspace_flow(&pool, &ws_body("Bank")).unwrap();
        let other_id = other["id"].as_str().unwrap().to_string();

        // Unknown workspace: 404, nothing registered.
        let root = TempRoot::new("place");
        let e = create_project_flow(&pool, &project_body("Gig", &root.s(), Some("ws-nope")))
            .unwrap_err();
        assert_eq!(
            (e.status, e.code),
            (StatusCode::NOT_FOUND, "workspace_not_found")
        );
        assert!(project_repo::get_project_by_path(&pool, &root.s())
            .unwrap()
            .is_none());

        // New project straight into the workspace.
        let p = create_project_flow(&pool, &project_body("Gig", &root.s(), Some(&ws_id))).unwrap();
        assert_eq!(p["created"], true);
        assert_eq!(p["workspaceId"], ws_id.as_str());

        // Same workspace again: idempotent.
        let p2 = create_project_flow(&pool, &project_body("Gig", &root.s(), Some(&ws_id))).unwrap();
        assert_eq!(p2["created"], false);
        assert_eq!(p2["workspaceId"], ws_id.as_str());

        // A different workspace: 409, never moved.
        let e = create_project_flow(&pool, &project_body("Gig", &root.s(), Some(&other_id)))
            .unwrap_err();
        assert_eq!(
            (e.status, e.code),
            (StatusCode::CONFLICT, "project_in_other_workspace")
        );
        let stored = project_repo::get_project_by_id(&pool, p["id"].as_str().unwrap()).unwrap();
        assert_eq!(stored.workspace_id.as_deref(), Some(ws_id.as_str()));

        // An existing project with NO workspace is assigned.
        let loose = TempRoot::new("loose");
        let l = create_project_flow(&pool, &project_body("Loose", &loose.s(), None)).unwrap();
        assert_eq!(l["workspaceId"], Value::Null);
        let l2 =
            create_project_flow(&pool, &project_body("Loose", &loose.s(), Some(&ws_id))).unwrap();
        assert_eq!(l2["created"], false);
        assert_eq!(l2["id"], l["id"]);
        assert_eq!(l2["workspaceId"], ws_id.as_str());
    }

    // ── placement ──

    #[test]
    fn hire_placement_is_optional_and_validated() {
        let pool = init_test_db().unwrap();
        let ws = ws_repo::create_workspace(&pool, "Freelance", None, None, false).unwrap();

        assert!(validate_hire_placement(&pool, &json!({"spec": {}}))
            .unwrap()
            .is_none());
        assert!(validate_hire_placement(&pool, &json!({"placement": null}))
            .unwrap()
            .is_none());

        let found =
            validate_hire_placement(&pool, &json!({"placement": {"workspaceId": ws.id}})).unwrap();
        assert_eq!(found.unwrap().id, ws.id);

        let e = validate_hire_placement(&pool, &json!({"placement": {"workspaceId": "nope"}}))
            .unwrap_err();
        assert_eq!(
            (e.status, e.code),
            (StatusCode::BAD_REQUEST, "workspace_not_found")
        );

        for bad in [
            json!({"placement": {}}),
            json!({"placement": "ws"}),
            json!({"placement": {"workspaceId": 3}}),
        ] {
            let e = validate_hire_placement(&pool, &bad).unwrap_err();
            assert_eq!(e.code, "invalid_placement", "{bad}");
        }
    }
}
