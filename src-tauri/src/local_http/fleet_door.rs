//! The `/fleet` DOOR (spark one-control): how a tool that used to spawn its
//! own `claude -p` - lens-scan's `drive.mjs`, the headless App Master worker,
//! bp - hands the run to this app's fleet instead, through the
//! `scripts/fleet/personas-run.mjs` shim, so the cap, the budgets and the
//! five-hour window govern every agent run on the machine.
//!
//! | route | handler | the one call it adapts |
//! |---|---|---|
//! | `POST /fleet/enqueue` | [`enqueue`] | `fleet::door::enqueue` -> `queue::admit` |
//! | `GET  /fleet/sessions/{id}` | [`session`] | `fleet::door::status` |
//! | `GET  /fleet/sessions/{id}/output?from=&waitMs=` | [`output`] | `fleet::door::read_output` |
//! | `POST /fleet/sessions/{id}/cancel` | [`cancel`] | `fleet::door::cancel` |
//!
//! Mounted under the SAME `fleet` prefix as the Claude Code hook receiver
//! (`commands::fleet::hooks`, `/fleet/hooks/{event}`): `boot::services` merges
//! the two routers, because `local_http` nests one router per prefix.
//!
//! ## Authentication
//!
//! Nothing here authenticates: `local_http::start` wraps the whole composed
//! router in `auth::guard` (Host allowlist + the local token from the
//! handshake file), and `fleet` is not on `SELF_AUTHENTICATED_PREFIXES`.
//!
//! ## Validation - SECURITY-SENSITIVE
//!
//! This door starts `claude` runs with permissions skipped (the fleet's
//! headless lane passes `--dangerously-skip-permissions`), so beyond the token
//! it narrows what a caller can ask for:
//!
//! - `origin` is `lens_scan` or `app_master`, nothing else (400). The door
//!   never mints `manual` or any other origin.
//! - `cwd` is an existing directory (400) that is a registered project root,
//!   inside one, or a git worktree whose `git rev-parse --git-common-dir`
//!   resolves inside one (403 otherwise). Compared on canonical paths.
//! - `env` keys are `BP_JOB_ID`, `LENS_SCAN_*` or `APPMASTER_*` in
//!   `[A-Z0-9_]` (400 otherwise); at most 32, values at most 4 KiB, no NUL.
//! - `model` is a model id (`[A-Za-z0-9._:-[]]`, not starting with `-`),
//!   `sessionId` a UUID, `runLabel` printable and short, `outputFormat`
//!   `text` or `stream-json`; unknown body fields are refused (400).
//! - the read and cancel routes answer only for sessions whose origin is one
//!   of the two door origins (403 for anyone else's session).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::extract::{Path as UrlPath, Query, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::commands::fleet::door::{self, DoorOutput, DoorRun};
use crate::commands::fleet::types::FleetSessionState;
use crate::error::AppError;
use crate::AppState;

/// The header carrying the next byte offset of `/output`.
pub const NEXT_OFFSET_HEADER: &str = "x-personas-next-offset";
/// The header saying the output is complete and the state final (`0|1`).
pub const ENDED_HEADER: &str = "x-personas-ended";
/// Default and ceiling of one `/output` long-poll.
const DEFAULT_WAIT_MS: u64 = 20_000;
const MAX_WAIT_MS: u64 = 30_000;
/// Body bounds.
const MAX_PROMPT_BYTES: usize = 1024 * 1024;
const MAX_RUN_LABEL_CHARS: usize = 120;
const MAX_MODEL_CHARS: usize = 100;

/// The `/fleet` door's routes, to be merged into the hook receiver's router.
pub fn router(app: AppHandle) -> Router {
    routes().with_state(DoorState { app: Some(app) })
}

/// The route table, over a state the tests can build without an app.
fn routes() -> Router<DoorState> {
    Router::new()
        .route("/enqueue", post(enqueue))
        .route("/sessions/{id}", get(session))
        .route("/sessions/{id}/output", get(output))
        .route("/sessions/{id}/cancel", post(cancel))
}

/// The handlers' state: the app, which only the route tests leave out (they
/// prove the admission layer and the validation, neither of which needs it).
#[derive(Clone)]
struct DoorState {
    app: Option<AppHandle>,
}

impl DoorState {
    fn app(&self) -> Result<&AppHandle, DoorError> {
        self.app
            .as_ref()
            .ok_or_else(|| DoorError::internal("app not ready"))
    }
}

// ---------------------------------------------------------------------------
// Errors: `{ error, code }`
// ---------------------------------------------------------------------------

/// A refusal made by a door handler. Serialises as `{ error, code }`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DoorError {
    status: StatusCode,
    code: &'static str,
    error: String,
}

impl DoorError {
    fn new(status: StatusCode, code: &'static str, error: impl Into<String>) -> Self {
        Self {
            status,
            code,
            error: error.into(),
        }
    }
    fn bad_request(error: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "bad_request", error)
    }
    fn forbidden(error: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, "forbidden", error)
    }
    fn internal(error: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal", error)
    }
}

impl From<AppError> for DoorError {
    fn from(e: AppError) -> Self {
        let text = e.to_string();
        match e {
            // The queue's own refusals (`queue_full`, `exceeds_budget`) are
            // Validation too: a well-formed request the fleet said no to.
            AppError::Validation(ref m) if is_queue_refusal(m) => {
                Self::new(StatusCode::CONFLICT, "refused", text)
            }
            AppError::Validation(_) => Self::bad_request(text),
            AppError::NotFound(_) => Self::new(StatusCode::NOT_FOUND, "not_found", text),
            AppError::Forbidden(_) => Self::forbidden(text),
            AppError::ProcessSpawn(_) => Self::new(StatusCode::BAD_GATEWAY, "spawn_failed", text),
            _ => Self::internal(text),
        }
    }
}

/// The queue's typed refusals start with their token (`queue::REFUSAL_*`).
fn is_queue_refusal(message: &str) -> bool {
    use crate::commands::fleet::queue::{REFUSAL_EXCEEDS_BUDGET, REFUSAL_QUEUE_FULL};
    [REFUSAL_QUEUE_FULL, REFUSAL_EXCEEDS_BUDGET]
        .iter()
        .any(|t| message.starts_with(t))
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    error: &'a str,
    code: &'a str,
}

impl IntoResponse for DoorError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorBody {
                error: &self.error,
                code: self.code,
            }),
        )
            .into_response()
    }
}

// ---------------------------------------------------------------------------
// Validation (pure)
// ---------------------------------------------------------------------------

/// `POST /fleet/enqueue`'s body.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnqueueBody {
    pub cwd: String,
    pub prompt: String,
    pub origin: String,
    #[serde(default)]
    pub run_label: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    pub output_format: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub env: Option<BTreeMap<String, String>>,
}

/// Everything about the body except the cwd rule, which needs the disk and
/// the projects table. Pure.
pub fn validate_body(body: EnqueueBody) -> Result<DoorRun, DoorError> {
    let origin = door::door_origin(body.origin.trim()).ok_or_else(|| {
        DoorError::bad_request(format!(
            "origin must be `lens_scan` or `app_master`, not `{}` - this door mints no other origin",
            body.origin
        ))
    })?;
    let output = DoorOutput::parse(body.output_format.trim()).ok_or_else(|| {
        DoorError::bad_request(format!(
            "outputFormat must be `text` or `stream-json`, not `{}`",
            body.output_format
        ))
    })?;
    if body.prompt.trim().is_empty() {
        return Err(DoorError::bad_request("prompt is empty"));
    }
    if body.prompt.len() > MAX_PROMPT_BYTES {
        return Err(DoorError::bad_request(format!(
            "prompt is {} bytes, over the {MAX_PROMPT_BYTES}-byte limit",
            body.prompt.len()
        )));
    }
    if body.cwd.trim().is_empty() {
        return Err(DoorError::bad_request("cwd is empty"));
    }
    let run_label = match body.run_label.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(l) if l.chars().count() > MAX_RUN_LABEL_CHARS || l.chars().any(char::is_control) => {
            return Err(DoorError::bad_request(format!(
                "runLabel must be at most {MAX_RUN_LABEL_CHARS} printable characters"
            )))
        }
        Some(l) => Some(l.to_string()),
    };
    let model = match body.model.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(m) if model_id_ok(m) => Some(m.to_string()),
        Some(m) => {
            return Err(DoorError::bad_request(format!(
                "model `{m}` is not a model id"
            )))
        }
    };
    let session_id = match body.session_id.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(s) if uuid::Uuid::parse_str(s).is_ok() => Some(s.to_string()),
        Some(s) => {
            return Err(DoorError::bad_request(format!(
                "sessionId `{s}` is not a UUID"
            )))
        }
    };
    let env_map = body.env.unwrap_or_default();
    if env_map.len() > door::MAX_ENV_ENTRIES {
        return Err(DoorError::bad_request(format!(
            "env carries {} entries, over the limit of {}",
            env_map.len(),
            door::MAX_ENV_ENTRIES
        )));
    }
    let mut env = Vec::with_capacity(env_map.len());
    for (k, v) in env_map {
        if !door::env_key_allowed(&k) {
            return Err(DoorError::bad_request(format!(
                "env key `{k}` is not allowed - only BP_JOB_ID, LENS_SCAN_* and APPMASTER_*"
            )));
        }
        if v.len() > door::MAX_ENV_VALUE_LEN || v.contains('\0') {
            return Err(DoorError::bad_request(format!(
                "env value of `{k}` must be at most {} bytes with no NUL",
                door::MAX_ENV_VALUE_LEN
            )));
        }
        env.push((k, v));
    }
    Ok(DoorRun {
        cwd: body.cwd.trim().to_string(),
        prompt: body.prompt,
        origin,
        run_label,
        model,
        output,
        session_id,
        env,
    })
}

/// `opus`, `claude-opus-5-5`, `claude-sonnet-4-5[1m]`, `us.anthropic.x:0`.
fn model_id_ok(m: &str) -> bool {
    !m.starts_with('-')
        && m.chars().count() <= MAX_MODEL_CHARS
        && m.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-' | '[' | ']'))
}

/// Is `inner` the directory `root` or inside it? Both canonical.
fn within(inner: &Path, root: &Path) -> bool {
    inner.starts_with(root)
}

/// The cwd rule. `roots` are the registered `dev_projects.root_path`s;
/// `common_dir` answers `git rev-parse --git-common-dir` for a directory
/// (absolute, or relative to it), `None` when it is not a git checkout.
pub fn check_cwd(
    cwd: &Path,
    roots: &[String],
    common_dir: &dyn Fn(&Path) -> Option<PathBuf>,
) -> Result<(), DoorError> {
    let canonical = std::fs::canonicalize(cwd)
        .ok()
        .filter(|p| p.is_dir())
        .ok_or_else(|| {
            DoorError::bad_request(format!(
                "cwd {} is not an existing directory",
                cwd.display()
            ))
        })?;
    let roots: Vec<PathBuf> = roots
        .iter()
        .map(|r| r.trim())
        .filter(|r| !r.is_empty())
        .filter_map(|r| std::fs::canonicalize(r).ok())
        .collect();
    if roots.iter().any(|r| within(&canonical, r)) {
        return Ok(());
    }
    // A git worktree outside every root (an App Master builder's): allowed
    // when its repository - the common dir - lives inside a registered one.
    let shared = common_dir(&canonical)
        .map(|d| {
            if d.is_absolute() {
                d
            } else {
                canonical.join(d)
            }
        })
        .and_then(|d| std::fs::canonicalize(d).ok());
    if let Some(shared) = shared {
        if roots.iter().any(|r| within(&shared, r)) {
            return Ok(());
        }
    }
    Err(DoorError::forbidden(format!(
        "cwd {} is not inside a registered project, nor a git worktree of one - register the \
         project in Personas first",
        cwd.display()
    )))
}

/// `git rev-parse --git-common-dir` through the app's one git argv owner.
fn git_common_dir(dir: &Path) -> Option<PathBuf> {
    crate::engine::git_checkpoint::run_git_blocking(dir, &["rev-parse", "--git-common-dir"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

/// A session id from the URL: the registry mints UUIDs, so anything else is
/// refused before it can reach a lookup or a file path.
fn session_id_ok(id: &str) -> Result<&str, DoorError> {
    let id = id.trim();
    if uuid::Uuid::parse_str(id).is_ok() {
        Ok(id)
    } else {
        Err(DoorError::bad_request(format!(
            "`{id}` is not a session id"
        )))
    }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnqueueOut {
    session_id: String,
    /// `running` (started now) or `queued` (waiting for a slot).
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    rank: Option<u32>,
}

fn state_of(app: &AppHandle) -> Result<Arc<AppState>, DoorError> {
    app.try_state::<Arc<AppState>>()
        .map(|s| s.inner().clone())
        .ok_or_else(|| DoorError::internal("app state not ready"))
}

/// `POST /fleet/enqueue`.
async fn enqueue(
    State(door_state): State<DoorState>,
    body: Bytes,
) -> Result<Json<EnqueueOut>, DoorError> {
    // Bounded decode (size and depth checked before serde allocates).
    let text = std::str::from_utf8(&body)
        .map_err(|e| DoorError::bad_request(format!("body is not UTF-8: {e}")))?;
    let parsed: EnqueueBody = crate::engine::safe_json::from_str_as(text)
        .map_err(|e| DoorError::bad_request(format!("body: {e}")))?;
    let run = validate_body(parsed)?;
    let app = door_state.app()?.clone();
    let state = state_of(&app)?;
    let cwd = run.cwd.clone();
    tokio::task::spawn_blocking(move || {
        let roots: Vec<String> = crate::db::repos::dev_tools::list_projects(&state.db, None)?
            .into_iter()
            .map(|p| p.root_path)
            .collect();
        Ok::<_, DoorError>(check_cwd(Path::new(&cwd), &roots, &git_common_dir))
    })
    .await
    .map_err(|e| DoorError::internal(format!("cwd check task: {e}")))???;
    let admission = door::enqueue(&app, run).await?;
    Ok(Json(EnqueueOut {
        session_id: admission.session_id,
        state: if matches!(admission.state, FleetSessionState::Queued) {
            "queued"
        } else {
            "running"
        },
        rank: admission.rank,
    }))
}

/// `GET /fleet/sessions/{id}`.
async fn session(UrlPath(id): UrlPath<String>) -> Result<Json<door::DoorStatus>, DoorError> {
    let id = session_id_ok(&id)?;
    Ok(Json(door::status(id)?))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutputQuery {
    #[serde(default)]
    from: u64,
    #[serde(default)]
    wait_ms: Option<u64>,
}

/// `GET /fleet/sessions/{id}/output?from=<byteOffset>&waitMs=<ms>`.
async fn output(
    State(door_state): State<DoorState>,
    UrlPath(id): UrlPath<String>,
    Query(q): Query<OutputQuery>,
) -> Result<Response, DoorError> {
    let id = session_id_ok(&id)?;
    let app = door_state.app()?;
    let wait = Duration::from_millis(q.wait_ms.unwrap_or(DEFAULT_WAIT_MS).min(MAX_WAIT_MS));
    let chunk = door::read_output(app, id, q.from, wait).await?;
    let mut res = Response::new(Body::from(chunk.bytes));
    let headers = res.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(NEXT_OFFSET_HEADER, HeaderValue::from(chunk.next));
    headers.insert(
        ENDED_HEADER,
        HeaderValue::from_static(if chunk.ended { "1" } else { "0" }),
    );
    Ok(res)
}

/// `POST /fleet/sessions/{id}/cancel`.
async fn cancel(
    State(door_state): State<DoorState>,
    UrlPath(id): UrlPath<String>,
) -> Result<Json<door::CancelOutcome>, DoorError> {
    let id = session_id_ok(&id)?;
    Ok(Json(door::cancel(door_state.app()?, id)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::fleet::queue::DispatchOrigin;

    fn body() -> EnqueueBody {
        EnqueueBody {
            cwd: "C:/code/personas".into(),
            prompt: "/lens-scan measure dev".into(),
            origin: "lens_scan".into(),
            run_label: Some("bp".into()),
            model: Some("claude-opus-5-5[1m]".into()),
            output_format: "text".into(),
            session_id: None,
            env: Some(BTreeMap::from([(
                "BP_JOB_ID".to_string(),
                "job-1".to_string(),
            )])),
        }
    }

    fn code_of(r: Result<DoorRun, DoorError>) -> (StatusCode, &'static str) {
        let e = r.expect_err("refused");
        (e.status, e.code)
    }

    #[test]
    fn a_well_formed_body_validates() {
        let run = validate_body(body()).expect("valid");
        assert_eq!(run.origin, DispatchOrigin::LensScan);
        assert_eq!(run.output, DoorOutput::Text);
        assert_eq!(run.env, vec![("BP_JOB_ID".into(), "job-1".into())]);
        assert_eq!(run.model.as_deref(), Some("claude-opus-5-5[1m]"));
        let mut b = body();
        b.origin = "app_master".into();
        b.output_format = "stream-json".into();
        b.session_id = Some("0f6b3c3e-0000-4000-8000-000000000001".into());
        b.env = Some(BTreeMap::from([("APPMASTER_RUN".into(), "r1".into())]));
        let run = validate_body(b).expect("valid");
        assert_eq!(run.origin, DispatchOrigin::AppMaster);
        assert_eq!(run.output, DoorOutput::StreamJson);
    }

    #[test]
    fn the_door_mints_no_origin_but_its_two() {
        for bad in [
            "manual",
            "autopilot",
            "dev_runner",
            "remote",
            "",
            "LENS_SCAN",
        ] {
            let mut b = body();
            b.origin = bad.into();
            assert_eq!(
                code_of(validate_body(b)),
                (StatusCode::BAD_REQUEST, "bad_request"),
                "{bad}"
            );
        }
    }

    #[test]
    fn env_keys_outside_the_allowlist_are_refused() {
        for bad in [
            "PATH",
            "ANTHROPIC_API_KEY",
            "CLAUDE_CONFIG_DIR",
            "bp_job_id",
        ] {
            let mut b = body();
            b.env = Some(BTreeMap::from([(bad.to_string(), "x".to_string())]));
            assert_eq!(
                code_of(validate_body(b)),
                (StatusCode::BAD_REQUEST, "bad_request"),
                "{bad}"
            );
        }
        let mut b = body();
        b.env = Some(BTreeMap::from([("LENS_SCAN_X".into(), "a\0b".into())]));
        assert!(validate_body(b).is_err(), "NUL in a value");
        let mut b = body();
        b.env = Some(
            (0..=door::MAX_ENV_ENTRIES)
                .map(|i| (format!("LENS_SCAN_{i}"), "v".to_string()))
                .collect(),
        );
        assert!(validate_body(b).is_err(), "too many entries");
    }

    #[test]
    fn the_flags_a_caller_can_shape_are_checked() {
        let cases: Vec<Box<dyn Fn(&mut EnqueueBody)>> = vec![
            Box::new(|b| b.output_format = "json".into()),
            Box::new(|b| b.model = Some("--dangerously-skip-permissions".into())),
            Box::new(|b| b.model = Some("opus; rm -rf".into())),
            Box::new(|b| b.session_id = Some("not-a-uuid".into())),
            Box::new(|b| b.run_label = Some("a\nb".into())),
            Box::new(|b| b.prompt = "   ".into()),
            Box::new(|b| b.cwd = " ".into()),
        ];
        for (i, shape) in cases.iter().enumerate() {
            let mut b = body();
            shape(&mut b);
            assert!(validate_body(b).is_err(), "case {i}");
        }
        let unknown = serde_json::from_str::<EnqueueBody>(
            r#"{"cwd":"c","prompt":"p","origin":"lens_scan","outputFormat":"text","args":["--x"]}"#,
        );
        assert!(unknown.is_err(), "unknown fields are refused");
    }

    #[test]
    fn the_cwd_must_sit_in_a_registered_project_or_a_worktree_of_one() {
        let pool = personas_db::init_test_db().expect("test db");
        let root = tempfile::tempdir().unwrap();
        let inside = root.path().join("src").join("deep");
        std::fs::create_dir_all(&inside).unwrap();
        let outside = tempfile::tempdir().unwrap();
        let worktree = tempfile::tempdir().unwrap();
        crate::db::repos::dev_tools::create_project(
            &pool,
            "Fixture",
            &root.path().display().to_string(),
            None,
            None,
            None,
            None,
            None,
        )
        .expect("project row");
        let roots: Vec<String> = crate::db::repos::dev_tools::list_projects(&pool, None)
            .unwrap()
            .into_iter()
            .map(|p| p.root_path)
            .collect();
        let no_git = |_: &Path| -> Option<PathBuf> { None };

        assert!(check_cwd(root.path(), &roots, &no_git).is_ok());
        assert!(check_cwd(&inside, &roots, &no_git).is_ok());
        let e = check_cwd(outside.path(), &roots, &no_git).expect_err("outside");
        assert_eq!(e.status, StatusCode::FORBIDDEN);
        let e = check_cwd(&root.path().join("missing"), &roots, &no_git).expect_err("missing");
        assert_eq!(e.status, StatusCode::BAD_REQUEST);

        // A worktree elsewhere whose common dir is the project's `.git`.
        let git_dir = root.path().join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        let into_project = |_: &Path| -> Option<PathBuf> { Some(git_dir.clone()) };
        assert!(check_cwd(worktree.path(), &roots, &into_project).is_ok());
        // ...and one whose repository is somewhere else entirely.
        let foreign_git = outside.path().join(".git");
        std::fs::create_dir_all(&foreign_git).unwrap();
        let elsewhere = |_: &Path| -> Option<PathBuf> { Some(foreign_git.clone()) };
        assert_eq!(
            check_cwd(worktree.path(), &roots, &elsewhere)
                .expect_err("foreign repo")
                .status,
            StatusCode::FORBIDDEN
        );
        // A relative common dir resolves against the cwd.
        let rel = |_: &Path| -> Option<PathBuf> { Some(PathBuf::from("../.git")) };
        assert!(check_cwd(&root.path().join("src"), &roots, &rel).is_ok());
        // No project registered at all: nothing is inside.
        assert!(check_cwd(root.path(), &[], &no_git).is_err());
    }

    #[test]
    fn a_door_run_is_pinned_local_and_its_tokens_round_trip() {
        for (token, origin) in [
            ("lens_scan", DispatchOrigin::LensScan),
            ("app_master", DispatchOrigin::AppMaster),
        ] {
            assert_eq!(origin.token(), token);
            assert_eq!(DispatchOrigin::parse(Some(token)), origin);
            assert_eq!(door::door_origin(token), Some(origin));
            assert!(door::is_pinned_local(Some(token)));
            assert_eq!(
                serde_json::to_value(origin).unwrap(),
                serde_json::Value::String(token.into())
            );
        }
        assert!(!door::is_pinned_local(Some("manual")));
        assert!(!door::is_pinned_local(None));
    }

    #[test]
    fn session_ids_in_the_url_must_be_uuids() {
        assert!(session_id_ok("0f6b3c3e-0000-4000-8000-000000000001").is_ok());
        for bad in [
            "../../etc/passwd",
            "abc",
            "",
            "0f6b3c3e-0000-4000-8000-00000000000g",
        ] {
            assert!(session_id_ok(bad).is_err(), "{bad}");
        }
    }

    // -- the real composition: the admission layer in front of these routes --

    async fn serve() -> (String, tokio::task::JoinHandle<()>) {
        let (app, _) = crate::local_http::build_app(vec![(
            "fleet".to_string(),
            routes().with_state(DoorState { app: None }),
        )]);
        let listener = tokio::net::TcpListener::bind(std::net::SocketAddrV4::new(
            std::net::Ipv4Addr::LOCALHOST,
            0,
        ))
        .await
        .expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (format!("http://127.0.0.1:{port}/fleet"), task)
    }

    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("client")
    }

    #[tokio::test]
    async fn without_the_token_no_door_route_reaches_a_handler() {
        let (base, task) = serve().await;
        let sid = "0f6b3c3e-0000-4000-8000-000000000001";
        for res in [
            client()
                .post(format!("{base}/enqueue"))
                .json(&serde_json::json!({"cwd": "c", "prompt": "p", "origin": "lens_scan", "outputFormat": "text"}))
                .send()
                .await,
            client().get(format!("{base}/sessions/{sid}")).send().await,
            client().get(format!("{base}/sessions/{sid}/output")).send().await,
            client()
                .post(format!("{base}/sessions/{sid}/cancel"))
                .send()
                .await,
        ] {
            assert_eq!(res.unwrap().status(), reqwest::StatusCode::UNAUTHORIZED);
        }
        task.abort();
    }

    #[tokio::test]
    async fn with_the_token_a_bad_body_is_refused_before_anything_runs() {
        let (base, task) = serve().await;
        let authed = |rb: reqwest::RequestBuilder| {
            rb.header(
                crate::local_http::auth::TOKEN_HEADER,
                crate::local_http::auth::local_token(),
            )
        };
        let res = authed(client().post(format!("{base}/enqueue")))
            .json(&serde_json::json!({"cwd": "c", "prompt": "p", "origin": "manual", "outputFormat": "text"}))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), reqwest::StatusCode::BAD_REQUEST);
        let body: serde_json::Value = res.json().await.unwrap();
        assert_eq!(body["code"], "bad_request");
        let res = authed(client().post(format!("{base}/enqueue")))
            .body("{not json")
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), reqwest::StatusCode::BAD_REQUEST);
        let res = authed(client().get(format!("{base}/sessions/..%2F..%2Fx")))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), reqwest::StatusCode::BAD_REQUEST);
        let res = authed(client().get(format!(
            "{base}/sessions/0f6b3c3e-0000-4000-8000-0000000000ff"
        )))
        .send()
        .await
        .unwrap();
        assert_eq!(res.status(), reqwest::StatusCode::NOT_FOUND);
        task.abort();
    }
}
