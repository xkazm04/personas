//! The `/mesh` door (spark device-mesh, WP2b): how a terminal's Claude Code
//! session drives ITS OWN Personas app through the device mesh - discover,
//! pair (the human types the code, decision D5), send verbs and mail, move
//! queued work and record probe verdicts. Two such sessions on two machines
//! coordinate through their apps, never through the operator.
//!
//! The wire contract is FROZEN by the Director (`mesh-door-contract.md` plus
//! its 2026-10-13 amendments) and the onboarding client in `scripts/mesh/` is
//! built against it:
//!
//! | route | handler | the one call it adapts |
//! |---|---|---|
//! | `GET  /mesh/status` | [`status`] | `NetworkService` facts |
//! | `GET  /mesh/diagnostics` | [`diagnostics`] | `mesh::diagnostics::run` |
//! | `GET  /mesh/devices` | [`devices`] | `mesh_device_snapshots` + `discovered_peers` |
//! | `POST /mesh/connect` | [`connect`] | `connect_peer` / `connect_to_address` (LAN addresses only) |
//! | `POST /mesh/pair/request` | [`pair_request`] | `DevicePairing::request` |
//! | `GET  /mesh/pair/pending` | [`pair_pending`] | `DevicePairing::list_pending` (never the code) |
//! | `POST /mesh/pair/confirm` | [`pair_confirm`] | `DevicePairing::confirm_with_code` |
//! | `POST /mesh/verb` | [`verb`] | `RemoteJobs::send_mesh_verb` |
//! | `POST /mesh/dispatch` | [`dispatch`] | `remote_exec::dispatch` |
//! | `POST /mesh/session-command` | [`session_command`] | `RemoteJobs::send_command` |
//! | `POST /mesh/queue/move` | [`queue_move`] | `mesh::queue_move::move_queued` |
//! | `POST /mesh/queue/enqueue-test` | [`enqueue_test`] | `fleet::queue::admit` (onboarding header) |
//! | `POST /mesh/queue/cancel-test` | [`cancel_test`] | `fleet::queue::cancel_dispatch` (onboarding header) |
//! | `GET  /mesh/projects` | [`projects`] | `dev_projects` list |
//! | `POST /mesh/mail` | [`send_mail`] | `RemoteJobs::send_cli_mail` |
//! | `GET  /mesh/mail` | [`read_mail`] | `RemoteJobs::list_cli_mail` |
//! | `GET  /mesh/jobs/{id}` | [`job`] | `remote_jobs::get` |
//! | `POST /mesh/probe` | [`probe`] | `mesh_probes::insert` |
//!
//! ## Authentication
//!
//! Nothing here authenticates: `local_http::start` wraps the WHOLE composed
//! router in `auth::guard` (Host allowlist + the local token), and `mesh` is
//! not on `SELF_AUTHENTICATED_PREFIXES`. The route tests below drive the real
//! `build_app` composition to prove a request without the token never reaches
//! a handler. Auth-layer refusals stay plain text (contract amendment A5);
//! every refusal a handler makes is `{error, code}`. No route echoes the token.
//!
//! ## Shape
//!
//! Each handler parses, makes ONE call through the [`MeshDoor`] seam and maps
//! the result. [`AppDoor`] is the one real implementation; the tests drive the
//! same handlers over a stub door, so the wire mapping is tested without an
//! `AppHandle` or a network.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::db::models::{
    CliMail, FleetSessionJobPayload, MeshDeviceView, MeshProbeVerdict, MeshVerbPayload, RemoteJob,
    RemoteSessionCommand,
};
use crate::engine::p2p::device_pairing::PairCodeError;
use crate::error::AppError;
use crate::mesh::diagnostics::DiagnosticCheck;
use crate::AppState;

/// The header the two onboarding-only routes require (`x-mesh-onboard: 1`).
pub const ONBOARD_HEADER: &str = "x-mesh-onboard";
/// Run label of the held entry `enqueue-test` creates; `cancel-test` touches
/// nothing else.
pub const ONBOARD_RUN_LABEL: &str = "mesh-onboard";
/// The held entry's whole prompt.
pub const ENQUEUE_TEST_PROMPT: &str = "Reply with the single word MESH-OK and exit.";
/// How far ahead the held entry's gate sits: long enough that it is never
/// promoted on this device during an onboarding run.
pub const ENQUEUE_TEST_HOLD_MS: i64 = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Errors: `{ error, code }`
// ---------------------------------------------------------------------------

/// A refusal made by a `/mesh` handler. Serialises as `{ error, code }`, the
/// `code` from the contract's closed list.
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
    fn not_found(error: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", error)
    }
    fn refused(error: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, "refused", error)
    }
    fn p2p_unavailable(error: impl Into<String>) -> Self {
        Self::new(StatusCode::SERVICE_UNAVAILABLE, "p2p_unavailable", error)
    }
    fn peer_not_paired(peer_id: &str) -> Self {
        Self::new(
            StatusCode::FORBIDDEN,
            "peer_not_paired",
            format!("{peer_id} is not one of this device's paired devices; pair first"),
        )
    }
    fn internal(error: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal", error)
    }
}

/// An engine/repo error, by its CAUSE.
impl From<AppError> for DoorError {
    fn from(e: AppError) -> Self {
        let text = e.to_string();
        match e {
            AppError::Validation(_) => Self::bad_request(text),
            AppError::NotFound(_) => Self::not_found(text),
            AppError::Forbidden(_) => Self::refused(text),
            // A peer that is not connected, or a group conflict: the request
            // was well formed and the world said no.
            AppError::NetworkOffline(_) | AppError::DeviceGroupConflict(_) => {
                Self::new(StatusCode::CONFLICT, "refused", text)
            }
            _ => Self::internal(text),
        }
    }
}

/// The D5 outcomes, on the wire. The expected code is never in the text.
impl From<PairCodeError> for DoorError {
    fn from(e: PairCodeError) -> Self {
        match e {
            PairCodeError::NoPending => {
                Self::new(StatusCode::NOT_FOUND, "no_pending_pairing", e.to_string())
            }
            PairCodeError::Mismatch { .. } => {
                Self::new(StatusCode::CONFLICT, "code_mismatch", e.to_string())
            }
            PairCodeError::Confirm(inner) => inner.into(),
        }
    }
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

fn reply<T: Serialize>(result: Result<T, DoorError>) -> Response {
    match result {
        Ok(body) => Json(body).into_response(),
        Err(e) => e.into_response(),
    }
}

/// Parse a JSON body into `T`, refusing with `{error, code: bad_request}`
/// (axum's own `Json` rejection is plain text, which the contract forbids).
/// Through the tree's bounded decoder (`safe_json`: size and depth limits
/// checked before serde allocates).
fn parse<T: serde::de::DeserializeOwned>(body: &Bytes) -> Result<T, DoorError> {
    let text = std::str::from_utf8(body)
        .map_err(|e| DoorError::bad_request(format!("body is not UTF-8: {e}")))?;
    crate::engine::safe_json::from_str_as(text)
        .map_err(|e| DoorError::bad_request(format!("body: {e}")))
}

fn require_onboard_header(headers: &HeaderMap) -> Result<(), DoorError> {
    match headers.get(ONBOARD_HEADER).and_then(|v| v.to_str().ok()) {
        Some(v) if v.trim() == "1" => Ok(()),
        _ => Err(DoorError::refused(format!(
            "onboarding only: send the header `{ONBOARD_HEADER}: 1`"
        ))),
    }
}

// ---------------------------------------------------------------------------
// Wire shapes (camelCase; an absent value is `null`, never omitted)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusOut {
    pub app_version: String,
    pub p2p: bool,
    pub network_running: bool,
    pub peer_id: Option<String>,
    pub display_name: Option<String>,
    pub quic_port: Option<u16>,
    pub data_dir_isolated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticsOut {
    pub checks: Vec<DiagnosticCheck>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredOut {
    pub peer_id: String,
    pub display_name: String,
    pub last_seen_ms: Option<f64>,
    pub paired: bool,
    pub connected: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DevicesOut {
    pub devices: Vec<MeshDeviceView>,
    pub discovered: Vec<DiscoveredOut>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectIn {
    pub peer_id: Option<String>,
    pub address: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectOut {
    pub connected: bool,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PeerIn {
    peer_id: String,
}

#[derive(Debug, Clone, Serialize)]
struct CodeOut {
    code: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingOut {
    pub peer_id: String,
    pub display_name: String,
    pub role: crate::engine::p2p::device_pairing::PairingRole,
    pub expires_at_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
struct PendingList {
    pending: Vec<PendingOut>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfirmIn {
    peer_id: String,
    code: String,
}

#[derive(Debug, Clone, Serialize)]
struct PairedOut {
    paired: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerbIn {
    peer_id: String,
    payload: MeshVerbPayload,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DispatchIn {
    peer_id: String,
    payload: FleetSessionJobPayload,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionCommandIn {
    job_id: String,
    command: RemoteSessionCommand,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommandOut {
    pub accepted: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveIn {
    session_id: String,
    peer_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnqueueIn {
    project_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionOut {
    session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelIn {
    session_id: String,
}

#[derive(Debug, Clone, Serialize)]
struct CancelledOut {
    cancelled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOut {
    pub id: String,
    pub name: String,
    pub github_url: Option<String>,
    pub root_path: String,
}

#[derive(Debug, Clone, Serialize)]
struct ProjectList {
    projects: Vec<ProjectOut>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MailIn {
    peer_id: String,
    topic: String,
    body: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct MailQuery {
    since: Option<String>,
    topic: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct MailList {
    mail: Vec<CliMail>,
}

#[derive(Debug, Clone, Serialize)]
struct RecordedOut {
    recorded: bool,
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/// Everything the handlers call. One method per route, each ONE call into
/// the engine, a repo or the fleet.
#[async_trait::async_trait]
pub trait MeshDoor: Send + Sync {
    async fn status(&self) -> Result<StatusOut, DoorError>;
    async fn diagnostics(&self) -> Result<Vec<DiagnosticCheck>, DoorError>;
    async fn devices(&self) -> Result<DevicesOut, DoorError>;
    async fn connect(&self, req: ConnectIn) -> Result<ConnectOut, DoorError>;
    async fn pair_request(&self, peer_id: &str) -> Result<String, DoorError>;
    async fn pair_pending(&self) -> Result<Vec<PendingOut>, DoorError>;
    async fn pair_confirm(&self, peer_id: &str, code: &str) -> Result<(), DoorError>;
    async fn verb(&self, peer_id: &str, payload: MeshVerbPayload) -> Result<RemoteJob, DoorError>;
    async fn dispatch(
        &self,
        peer_id: &str,
        payload: FleetSessionJobPayload,
    ) -> Result<RemoteJob, DoorError>;
    async fn session_command(
        &self,
        job_id: &str,
        command: RemoteSessionCommand,
        text: Option<String>,
    ) -> Result<CommandOut, DoorError>;
    async fn queue_move(&self, session_id: &str, peer_id: &str) -> Result<RemoteJob, DoorError>;
    async fn enqueue_test(&self, project_id: &str) -> Result<String, DoorError>;
    async fn cancel_test(&self, session_id: &str) -> Result<bool, DoorError>;
    async fn projects(&self) -> Result<Vec<ProjectOut>, DoorError>;
    async fn send_mail(
        &self,
        peer_id: &str,
        topic: &str,
        body: &str,
    ) -> Result<RemoteJob, DoorError>;
    async fn read_mail(
        &self,
        since_ms: f64,
        topic: Option<&str>,
    ) -> Result<Vec<CliMail>, DoorError>;
    async fn job(&self, id: &str) -> Result<RemoteJob, DoorError>;
    async fn probe(&self, verdict: MeshProbeVerdict) -> Result<(), DoorError>;
}

type Door = State<Arc<dyn MeshDoor>>;

/// The router `boot::services` mounts at `/mesh`.
pub fn router(app: AppHandle) -> Router {
    router_with(Arc::new(AppDoor { app }))
}

/// The same routes over any door (the tests pass a stub).
pub fn router_with(door: Arc<dyn MeshDoor>) -> Router {
    Router::new()
        .route("/status", get(status))
        .route("/diagnostics", get(diagnostics))
        .route("/devices", get(devices))
        .route("/connect", post(connect))
        .route("/pair/request", post(pair_request))
        .route("/pair/pending", get(pair_pending))
        .route("/pair/confirm", post(pair_confirm))
        .route("/verb", post(verb))
        .route("/dispatch", post(dispatch))
        .route("/session-command", post(session_command))
        .route("/queue/move", post(queue_move))
        .route("/queue/enqueue-test", post(enqueue_test))
        .route("/queue/cancel-test", post(cancel_test))
        .route("/projects", get(projects))
        .route("/mail", get(read_mail).post(send_mail))
        .route("/jobs/{id}", get(job))
        .route("/probe", post(probe))
        .with_state(door)
}

// ---------------------------------------------------------------------------
// Handlers (thin: parse, one call, map)
// ---------------------------------------------------------------------------

async fn status(State(door): Door) -> Response {
    reply(door.status().await)
}

async fn diagnostics(State(door): Door) -> Response {
    reply(
        door.diagnostics()
            .await
            .map(|checks| DiagnosticsOut { checks }),
    )
}

async fn devices(State(door): Door) -> Response {
    reply(door.devices().await)
}

async fn connect(State(door): Door, body: Bytes) -> Response {
    let run = async {
        let req: ConnectIn = parse(&body)?;
        match (&req.peer_id, &req.address) {
            (Some(_), None) | (None, Some(_)) => door.connect(req).await,
            _ => Err(DoorError::bad_request(
                "send exactly one of `peerId` or `address`",
            )),
        }
    };
    reply(run.await)
}

async fn pair_request(State(door): Door, body: Bytes) -> Response {
    let run = async {
        let req: PeerIn = parse(&body)?;
        let code = door.pair_request(req.peer_id.trim()).await?;
        Ok(CodeOut { code })
    };
    reply(run.await)
}

async fn pair_pending(State(door): Door) -> Response {
    reply(
        door.pair_pending()
            .await
            .map(|pending| PendingList { pending }),
    )
}

async fn pair_confirm(State(door): Door, body: Bytes) -> Response {
    let run = async {
        let req: ConfirmIn = parse(&body)?;
        door.pair_confirm(req.peer_id.trim(), &req.code).await?;
        Ok(PairedOut { paired: true })
    };
    reply(run.await)
}

async fn verb(State(door): Door, body: Bytes) -> Response {
    let run = async {
        let req: VerbIn = parse(&body)?;
        door.verb(req.peer_id.trim(), req.payload).await
    };
    reply(run.await)
}

async fn dispatch(State(door): Door, body: Bytes) -> Response {
    let run = async {
        let req: DispatchIn = parse(&body)?;
        door.dispatch(req.peer_id.trim(), req.payload).await
    };
    reply(run.await)
}

async fn session_command(State(door): Door, body: Bytes) -> Response {
    let run = async {
        let req: SessionCommandIn = parse(&body)?;
        door.session_command(req.job_id.trim(), req.command, req.text)
            .await
    };
    reply(run.await)
}

async fn queue_move(State(door): Door, body: Bytes) -> Response {
    let run = async {
        let req: MoveIn = parse(&body)?;
        door.queue_move(req.session_id.trim(), req.peer_id.trim())
            .await
    };
    reply(run.await)
}

async fn enqueue_test(State(door): Door, headers: HeaderMap, body: Bytes) -> Response {
    let run = async {
        require_onboard_header(&headers)?;
        let req: EnqueueIn = parse(&body)?;
        let session_id = door.enqueue_test(req.project_id.trim()).await?;
        Ok(SessionOut { session_id })
    };
    reply(run.await)
}

async fn cancel_test(State(door): Door, headers: HeaderMap, body: Bytes) -> Response {
    let run = async {
        require_onboard_header(&headers)?;
        let req: CancelIn = parse(&body)?;
        let cancelled = door.cancel_test(req.session_id.trim()).await?;
        Ok(CancelledOut { cancelled })
    };
    reply(run.await)
}

async fn projects(State(door): Door) -> Response {
    reply(
        door.projects()
            .await
            .map(|projects| ProjectList { projects }),
    )
}

async fn send_mail(State(door): Door, body: Bytes) -> Response {
    let run = async {
        let req: MailIn = parse(&body)?;
        door.send_mail(req.peer_id.trim(), &req.topic, &req.body)
            .await
    };
    reply(run.await)
}

async fn read_mail(State(door): Door, Query(q): Query<MailQuery>) -> Response {
    let run = async {
        let since = match q.since.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            None => 0.0,
            Some(raw) => raw
                .parse::<f64>()
                .ok()
                .filter(|v| v.is_finite())
                .ok_or_else(|| DoorError::bad_request(format!("since: '{raw}' is not a number")))?,
        };
        let topic = q.topic.as_deref().filter(|t| !t.is_empty());
        door.read_mail(since, topic).await
    };
    reply(run.await.map(|mail| MailList { mail }))
}

async fn job(State(door): Door, Path(id): Path<String>) -> Response {
    reply(door.job(id.trim()).await)
}

async fn probe(State(door): Door, body: Bytes) -> Response {
    let run = async {
        let verdict: MeshProbeVerdict = parse(&body)?;
        door.probe(verdict).await?;
        Ok(RecordedOut { recorded: true })
    };
    reply(run.await)
}

// ---------------------------------------------------------------------------
// The real door
// ---------------------------------------------------------------------------

/// The app behind the door. Resolves `AppState` per request, because this
/// server binds BEFORE boot manages the state (see `dev_tools_http::db`):
/// a request that lands in that window gets a retryable 503, never a panic.
pub struct AppDoor {
    pub app: AppHandle,
}

fn now_ms() -> f64 {
    crate::engine::p2p::mesh::now_ms()
}

fn rfc3339_ms(raw: &str) -> Option<f64> {
    chrono::DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|t| t.timestamp_millis() as f64)
}

impl AppDoor {
    fn state(&self) -> Result<Arc<AppState>, DoorError> {
        self.app
            .try_state::<Arc<AppState>>()
            .map(|s| s.inner().clone())
            .ok_or_else(|| {
                DoorError::new(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "internal",
                    "the app is still booting: retry in a moment",
                )
            })
    }

    fn network(state: &AppState) -> Result<Arc<crate::engine::p2p::NetworkService>, DoorError> {
        state.network.clone().ok_or_else(|| {
            DoorError::p2p_unavailable("this device's P2P network service did not start")
        })
    }

    /// The pairing gate, checked here so an unpaired peer reads as the
    /// contract's `peer_not_paired` rather than a generic refusal. The engine
    /// re-checks it on every send.
    fn require_paired(state: &AppState, peer_id: &str) -> Result<(), DoorError> {
        match crate::db::repos::resources::owned_devices::get_owned_device(&state.db, peer_id)? {
            Some(_) => Ok(()),
            None => Err(DoorError::peer_not_paired(peer_id)),
        }
    }
}

#[async_trait::async_trait]
impl MeshDoor for AppDoor {
    async fn status(&self) -> Result<StatusOut, DoorError> {
        let state = self.state()?;
        let net = state.network.clone();
        let (running, port) = match &net {
            Some(n) => (n.is_running().await, n.listening_port().await),
            None => (false, None),
        };
        Ok(StatusOut {
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            p2p: true,
            network_running: running,
            peer_id: net
                .as_ref()
                .map(|n| n.connections.local_peer_id().to_string()),
            display_name: net
                .as_ref()
                .map(|n| n.connections.local_display_name().to_string()),
            quic_port: port,
            data_dir_isolated: crate::engine::p2p::one_box::is_isolated(),
        })
    }

    async fn diagnostics(&self) -> Result<Vec<DiagnosticCheck>, DoorError> {
        let state = self.state()?;
        let facts = match state.network.clone() {
            Some(n) => {
                let local = n.connections.local_peer_id().to_string();
                let cutoff = now_ms() - crate::mesh::diagnostics::PEER_SEEN_WINDOW_MS as f64;
                let seen = n
                    .mdns
                    .get_discovered_peers()
                    .unwrap_or_default()
                    .iter()
                    .filter(|p| p.peer_id != local)
                    .filter(|p| rfc3339_ms(&p.last_seen_at).is_some_and(|t| t >= cutoff))
                    .count();
                crate::mesh::diagnostics::LinkFacts {
                    network_running: n.is_running().await,
                    quic_port: n.listening_port().await,
                    configured_port: crate::engine::p2p::one_box::p2p_port_override()
                        .unwrap_or(n.get_config().await.port),
                    peers_seen_recently: seen,
                    exe: std::env::current_exe().ok(),
                }
            }
            None => crate::mesh::diagnostics::LinkFacts {
                network_running: false,
                quic_port: None,
                configured_port: crate::engine::p2p::types::NetworkConfig::default().port,
                peers_seen_recently: 0,
                exe: std::env::current_exe().ok(),
            },
        };
        Ok(crate::mesh::diagnostics::run(&facts).await)
    }

    async fn devices(&self) -> Result<DevicesOut, DoorError> {
        let state = self.state()?;
        let net = Self::network(&state)?;
        let devices = net.mesh_device_snapshots().await?;
        let local = net.connections.local_peer_id().to_string();
        let mut discovered = Vec::new();
        for p in net.mdns.get_discovered_peers()? {
            if p.peer_id == local {
                continue;
            }
            let paired = crate::db::repos::resources::owned_devices::get_owned_device(
                &state.db, &p.peer_id,
            )?
            .is_some();
            discovered.push(DiscoveredOut {
                connected: net.connections.is_connected(&p.peer_id).await,
                last_seen_ms: rfc3339_ms(&p.last_seen_at),
                display_name: p.display_name,
                peer_id: p.peer_id,
                paired,
            });
        }
        Ok(DevicesOut {
            devices,
            discovered,
        })
    }

    async fn connect(&self, req: ConnectIn) -> Result<ConnectOut, DoorError> {
        let state = self.state()?;
        let net = Self::network(&state)?;
        if let Some(address) = req.address {
            // SECURITY-SENSITIVE: an operator-named address. The engine
            // refuses anything outside the local network (`lan_dial_refusal`)
            // and the link is authenticated, not trusted: pairing still needs
            // the typed code.
            let peer_id = net.connect_to_address(&address).await?;
            return Ok(ConnectOut {
                connected: true,
                detail: Some(format!("connected to {peer_id}")),
            });
        }
        let peer_id = req.peer_id.unwrap_or_default();
        let peer_id = peer_id.trim();
        match net.connect_peer(peer_id).await {
            Ok(()) => Ok(ConnectOut {
                connected: net.connections.is_connected(peer_id).await,
                detail: None,
            }),
            // A dial that did not land is an answer, not a door failure.
            Err(e) => Ok(ConnectOut {
                connected: false,
                detail: Some(e.to_string()),
            }),
        }
    }

    async fn pair_request(&self, peer_id: &str) -> Result<String, DoorError> {
        let state = self.state()?;
        let view = Self::network(&state)?.pairing.request(peer_id).await?;
        Ok(view.fingerprint)
    }

    async fn pair_pending(&self) -> Result<Vec<PendingOut>, DoorError> {
        let state = self.state()?;
        let ttl_ms = crate::engine::p2p::device_pairing::PAIRING_TTL.as_millis() as f64;
        Ok(Self::network(&state)?
            .pairing
            .list_pending()
            .await
            .into_iter()
            // The view carries the fingerprint; it is dropped HERE, never
            // serialised: the responder's human types it from the other screen.
            .map(|v| PendingOut {
                expires_at_ms: rfc3339_ms(&v.requested_at).unwrap_or_else(now_ms) + ttl_ms,
                peer_id: v.peer_id,
                display_name: v.display_name,
                role: v.role,
            })
            .collect())
    }

    async fn pair_confirm(&self, peer_id: &str, code: &str) -> Result<(), DoorError> {
        let state = self.state()?;
        Self::network(&state)?
            .pairing
            .confirm_with_code(peer_id, code)
            .await?;
        Ok(())
    }

    async fn verb(&self, peer_id: &str, payload: MeshVerbPayload) -> Result<RemoteJob, DoorError> {
        let state = self.state()?;
        let net = Self::network(&state)?;
        Self::require_paired(&state, peer_id)?;
        Ok(net.remote_jobs.send_mesh_verb(peer_id, &payload).await?)
    }

    async fn dispatch(
        &self,
        peer_id: &str,
        payload: FleetSessionJobPayload,
    ) -> Result<RemoteJob, DoorError> {
        let state = self.state()?;
        Self::network(&state)?;
        Self::require_paired(&state, peer_id)?;
        Ok(crate::commands::fleet::remote_exec::dispatch(&state, peer_id, payload).await?)
    }

    async fn session_command(
        &self,
        job_id: &str,
        command: RemoteSessionCommand,
        text: Option<String>,
    ) -> Result<CommandOut, DoorError> {
        let state = self.state()?;
        let net = Self::network(&state)?;
        match net.remote_jobs.send_command(job_id, command, text).await {
            Ok(()) => Ok(CommandOut {
                accepted: true,
                reason: None,
            }),
            // The running device declined, or could not be reached: an
            // answer the caller reads, not a door failure.
            Err(e @ (AppError::Execution(_) | AppError::NetworkOffline(_))) => Ok(CommandOut {
                accepted: false,
                reason: Some(e.to_string()),
            }),
            Err(e) => Err(e.into()),
        }
    }

    async fn queue_move(&self, session_id: &str, peer_id: &str) -> Result<RemoteJob, DoorError> {
        let state = self.state()?;
        Self::network(&state)?;
        Self::require_paired(&state, peer_id)?;
        let ports = crate::mesh::queue_move::AppPorts {
            app: self.app.clone(),
            state,
        };
        Ok(crate::mesh::queue_move::move_queued(&ports, session_id, peer_id).await?)
    }

    async fn enqueue_test(&self, project_id: &str) -> Result<String, DoorError> {
        use crate::commands::fleet::queue::{self, DispatchOrigin, DispatchRequest};
        use crate::commands::fleet::types::{FleetSessionMode, FleetSessionState};
        let state = self.state()?;
        let project = crate::db::repos::dev_tools::get_project_by_id(&state.db, project_id)?;
        let not_before = chrono::Utc::now().timestamp_millis() + ENQUEUE_TEST_HOLD_MS;
        // The fleet's ONE admission door. A gate in the future is QUEUED even
        // under the cap (`queue::admit_sync`'s `gate_ahead`), and promotion
        // skips a row whose gate is still ahead (`head_to_promote`).
        let admission = queue::admit(
            &self.app,
            DispatchRequest {
                cwd: project.root_path,
                name: None,
                title: Some(format!("{ONBOARD_RUN_LABEL} test entry")),
                args: queue::headless_args(ENQUEUE_TEST_PROMPT, Vec::new()),
                mode: FleetSessionMode::Headless,
                run_label: Some(ONBOARD_RUN_LABEL.to_string()),
                origin: DispatchOrigin::Manual,
                persona_id: None,
                goal_id: None,
                cycle_index: None,
                not_before_ms: Some(not_before),
                profile: None,
            },
        )
        .await?;
        if admission.state != FleetSessionState::Queued {
            tracing::error!(session_id = %admission.session_id, "mesh enqueue-test: the held entry STARTED instead of queueing");
            return Err(DoorError::internal(format!(
                "the held entry {} started instead of waiting in the queue",
                admission.session_id
            )));
        }
        Ok(admission.session_id)
    }

    async fn cancel_test(&self, session_id: &str) -> Result<bool, DoorError> {
        use crate::commands::fleet::queue;
        self.state()?;
        let Some(req) = queue::dispatch_of_session(session_id) else {
            return Err(DoorError::not_found(format!(
                "no fleet session {session_id} on this device"
            )));
        };
        if req.run_label.as_deref() != Some(ONBOARD_RUN_LABEL) {
            return Err(DoorError::bad_request(format!(
                "cancel-test only cancels `{ONBOARD_RUN_LABEL}` entries; {session_id} is not one"
            )));
        }
        // Already moved, cancelled or started: nothing to cancel, said plainly.
        Ok(queue::cancel_dispatch(&self.app, session_id).is_ok())
    }

    async fn projects(&self) -> Result<Vec<ProjectOut>, DoorError> {
        let state = self.state()?;
        Ok(crate::db::repos::dev_tools::list_projects(&state.db, None)?
            .into_iter()
            .map(|p| ProjectOut {
                id: p.id,
                name: p.name,
                github_url: p.github_url,
                root_path: p.root_path,
            })
            .collect())
    }

    async fn send_mail(
        &self,
        peer_id: &str,
        topic: &str,
        body: &str,
    ) -> Result<RemoteJob, DoorError> {
        let state = self.state()?;
        let net = Self::network(&state)?;
        Self::require_paired(&state, peer_id)?;
        Ok(net.remote_jobs.send_cli_mail(peer_id, topic, body).await?)
    }

    async fn read_mail(
        &self,
        since_ms: f64,
        topic: Option<&str>,
    ) -> Result<Vec<CliMail>, DoorError> {
        let state = self.state()?;
        Ok(Self::network(&state)?
            .remote_jobs
            .list_cli_mail(since_ms, topic)?)
    }

    async fn job(&self, id: &str) -> Result<RemoteJob, DoorError> {
        let state = self.state()?;
        crate::db::repos::resources::remote_jobs::get(&state.db, id)?
            .ok_or_else(|| DoorError::not_found(format!("no remote job {id}")))
    }

    async fn probe(&self, verdict: MeshProbeVerdict) -> Result<(), DoorError> {
        let state = self.state()?;
        Ok(crate::db::repos::resources::mesh_probes::insert(
            &state.db, &verdict,
        )?)
    }
}

// ---------------------------------------------------------------------------
// Route tests: the REAL `local_http::build_app` composition over a stub door
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, SocketAddrV4};
    use std::sync::Mutex;

    use crate::db::models::{RemoteJobDirection, RemoteJobStatus};
    use crate::local_http::auth;

    const PEER: &str = "BBBBpeer";
    const CODE: &str = "042-917";

    /// A scripted app: one pending responder pairing with code [`CODE`], one
    /// paired peer, a mailbox, and a log of every door call.
    #[derive(Default)]
    struct Stub {
        calls: Mutex<Vec<String>>,
        pending: Mutex<bool>,
        paired: Mutex<bool>,
        mail: Mutex<Vec<CliMail>>,
    }

    impl Stub {
        fn new() -> Arc<Self> {
            let s = Self::default();
            *s.pending.lock().unwrap() = true;
            Arc::new(s)
        }
        fn called(&self, what: &str) {
            self.calls.lock().unwrap().push(what.to_string());
        }
        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }

    fn job_row(id: &str, kind: &str) -> RemoteJob {
        RemoteJob {
            id: id.into(),
            direction: RemoteJobDirection::Outbound,
            peer_id: PEER.into(),
            peer_display_name: "Desk B".into(),
            kind: kind.into(),
            instruction: "x".into(),
            payload_json: None,
            receipt: None,
            mesh_receipt: None,
            status: RemoteJobStatus::Running,
            summary: None,
            refusal_reason: None,
            last_seq: 0,
            created_at: "2026-10-13T00:00:00Z".into(),
            updated_at: "2026-10-13T00:00:00Z".into(),
            completed_at: None,
        }
    }

    #[async_trait::async_trait]
    impl MeshDoor for Stub {
        async fn status(&self) -> Result<StatusOut, DoorError> {
            self.called("status");
            Ok(StatusOut {
                app_version: "0.0.0".into(),
                p2p: true,
                network_running: false,
                peer_id: None,
                display_name: None,
                quic_port: None,
                data_dir_isolated: false,
            })
        }
        async fn diagnostics(&self) -> Result<Vec<DiagnosticCheck>, DoorError> {
            Ok(Vec::new())
        }
        async fn devices(&self) -> Result<DevicesOut, DoorError> {
            Ok(DevicesOut {
                devices: Vec::new(),
                discovered: Vec::new(),
            })
        }
        async fn connect(&self, req: ConnectIn) -> Result<ConnectOut, DoorError> {
            self.called("connect");
            Ok(ConnectOut {
                connected: req.peer_id.is_some(),
                detail: None,
            })
        }
        async fn pair_request(&self, _peer_id: &str) -> Result<String, DoorError> {
            Ok(CODE.into())
        }
        async fn pair_pending(&self) -> Result<Vec<PendingOut>, DoorError> {
            Ok(Vec::new())
        }
        /// The engine's verdicts, mapped by the real `From<PairCodeError>`.
        async fn pair_confirm(&self, _peer_id: &str, code: &str) -> Result<(), DoorError> {
            self.called("pair_confirm");
            if !*self.pending.lock().unwrap() {
                return Err(PairCodeError::NoPending.into());
            }
            let digits = crate::engine::p2p::device_pairing::code_digits;
            if digits(code) != digits(CODE) {
                return Err(PairCodeError::Mismatch {
                    attempts_left: 4,
                    withdrawn: false,
                }
                .into());
            }
            *self.pending.lock().unwrap() = false;
            *self.paired.lock().unwrap() = true;
            Ok(())
        }
        async fn verb(
            &self,
            _peer_id: &str,
            _payload: MeshVerbPayload,
        ) -> Result<RemoteJob, DoorError> {
            Ok(job_row("job-verb", "mesh_verb"))
        }
        async fn dispatch(
            &self,
            _peer_id: &str,
            _payload: FleetSessionJobPayload,
        ) -> Result<RemoteJob, DoorError> {
            Ok(job_row("job-fleet", "fleet_session"))
        }
        async fn session_command(
            &self,
            _job_id: &str,
            _command: RemoteSessionCommand,
            _text: Option<String>,
        ) -> Result<CommandOut, DoorError> {
            Ok(CommandOut {
                accepted: false,
                reason: Some("not running".into()),
            })
        }
        async fn queue_move(
            &self,
            _session_id: &str,
            _peer_id: &str,
        ) -> Result<RemoteJob, DoorError> {
            Ok(job_row("job-move", "fleet_session"))
        }
        async fn enqueue_test(&self, _project_id: &str) -> Result<String, DoorError> {
            self.called("enqueue_test");
            Ok("sess-held".into())
        }
        async fn cancel_test(&self, _session_id: &str) -> Result<bool, DoorError> {
            self.called("cancel_test");
            Ok(true)
        }
        async fn projects(&self) -> Result<Vec<ProjectOut>, DoorError> {
            Ok(vec![ProjectOut {
                id: "p1".into(),
                name: "personas".into(),
                github_url: None,
                root_path: "C:/personas".into(),
            }])
        }
        /// Loops the mail back into this device's own mailbox, the way the
        /// peer's door would hold it.
        async fn send_mail(
            &self,
            peer_id: &str,
            topic: &str,
            body: &str,
        ) -> Result<RemoteJob, DoorError> {
            if !*self.paired.lock().unwrap() {
                return Err(DoorError::peer_not_paired(peer_id));
            }
            let id = format!("mail-{}", self.mail.lock().unwrap().len());
            self.mail.lock().unwrap().push(CliMail {
                job_id: id.clone(),
                peer_id: peer_id.into(),
                topic: topic.into(),
                body: body.into(),
                received_at_ms: 1_000.0,
            });
            Ok(job_row(&id, "cli_mail"))
        }
        async fn read_mail(
            &self,
            since_ms: f64,
            topic: Option<&str>,
        ) -> Result<Vec<CliMail>, DoorError> {
            Ok(self
                .mail
                .lock()
                .unwrap()
                .iter()
                .filter(|m| m.received_at_ms >= since_ms)
                .filter(|m| topic.is_none_or(|t| m.topic.starts_with(t)))
                .cloned()
                .collect())
        }
        async fn job(&self, id: &str) -> Result<RemoteJob, DoorError> {
            Err(DoorError::not_found(format!("no remote job {id}")))
        }
        async fn probe(&self, _verdict: MeshProbeVerdict) -> Result<(), DoorError> {
            self.called("probe");
            Ok(())
        }
    }

    /// Serve the stub through `local_http::build_app`: the same composition,
    /// with the same admission layer, the app serves.
    async fn serve(stub: Arc<Stub>) -> (String, tokio::task::JoinHandle<()>) {
        let (app, _) = crate::local_http::build_app(vec![("mesh".to_string(), router_with(stub))]);
        let listener = tokio::net::TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (format!("http://127.0.0.1:{port}/mesh"), task)
    }

    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("client")
    }

    fn authed(rb: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        rb.header(auth::TOKEN_HEADER, auth::local_token())
    }

    async fn json(res: reqwest::Response) -> (reqwest::StatusCode, serde_json::Value) {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        // A body that is not JSON comes back as its raw text, never as a stand-in.
        let body = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => serde_json::Value::String(text),
        };
        (status, body)
    }

    #[tokio::test]
    async fn without_the_token_nothing_reaches_a_handler() {
        let stub = Stub::new();
        let (base, task) = serve(stub.clone()).await;
        let res = client().get(format!("{base}/status")).send().await.unwrap();
        assert_eq!(res.status(), reqwest::StatusCode::UNAUTHORIZED);
        let res = client()
            .post(format!("{base}/pair/confirm"))
            .json(&serde_json::json!({ "peerId": PEER, "code": CODE }))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), reqwest::StatusCode::UNAUTHORIZED);
        assert!(
            stub.calls().is_empty(),
            "no handler ran: {:?}",
            stub.calls()
        );
        task.abort();
    }

    #[tokio::test]
    async fn status_has_every_contract_key_with_nulls_not_omissions() {
        let (base, task) = serve(Stub::new()).await;
        let (code, body) = json(
            authed(client().get(format!("{base}/status")))
                .send()
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(code, reqwest::StatusCode::OK);
        let obj = body.as_object().expect("an object");
        for key in [
            "appVersion",
            "p2p",
            "networkRunning",
            "peerId",
            "displayName",
            "quicPort",
            "dataDirIsolated",
        ] {
            assert!(obj.contains_key(key), "missing {key}: {body}");
        }
        assert!(body["peerId"].is_null() && body["quicPort"].is_null());
        assert!(
            !body.to_string().contains(&auth::local_token()),
            "no route echoes the token"
        );
        task.abort();
    }

    #[tokio::test]
    async fn pair_confirm_refuses_a_wrong_code_keeps_the_entry_and_pairs_on_the_right_one() {
        let stub = Stub::new();
        let (base, task) = serve(stub.clone()).await;
        let confirm = |code: &'static str| {
            authed(client().post(format!("{base}/pair/confirm")))
                .json(&serde_json::json!({ "peerId": PEER, "code": code }))
                .send()
        };

        let (status, body) = json(confirm("042-918").await.unwrap()).await;
        assert_eq!(status, reqwest::StatusCode::CONFLICT);
        assert_eq!(body["code"], "code_mismatch", "{body}");
        assert!(!body["error"].as_str().unwrap().contains("917"), "{body}");
        assert!(
            *stub.pending.lock().unwrap(),
            "the entry stays for a retype"
        );

        let (status, body) = json(confirm("042 917").await.unwrap()).await;
        assert_eq!(status, reqwest::StatusCode::OK, "{body}");
        assert_eq!(body, serde_json::json!({ "paired": true }));

        let (status, body) = json(confirm("042-917").await.unwrap()).await;
        assert_eq!(status, reqwest::StatusCode::NOT_FOUND);
        assert_eq!(body["code"], "no_pending_pairing", "{body}");
        task.abort();
    }

    #[tokio::test]
    async fn mail_round_trips_and_is_refused_before_pairing() {
        let stub = Stub::new();
        let (base, task) = serve(stub.clone()).await;
        let send = || {
            authed(client().post(format!("{base}/mail")))
                .json(&serde_json::json!({ "peerId": PEER, "topic": "onboard/hello", "body": "{\"hi\":1}" }))
                .send()
        };
        let (status, body) = json(send().await.unwrap()).await;
        assert_eq!(status, reqwest::StatusCode::FORBIDDEN);
        assert_eq!(body["code"], "peer_not_paired", "{body}");

        *stub.paired.lock().unwrap() = true;
        let (status, body) = json(send().await.unwrap()).await;
        assert_eq!(status, reqwest::StatusCode::OK, "{body}");
        assert_eq!(body["kind"], "cli_mail");
        assert!(body["meshReceipt"].is_null(), "absent is null: {body}");

        let (status, body) = json(
            authed(client().get(format!("{base}/mail?since=0&topic=onboard/")))
                .send()
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(status, reqwest::StatusCode::OK);
        assert_eq!(body["mail"][0]["topic"], "onboard/hello", "{body}");
        assert_eq!(body["mail"][0]["body"], "{\"hi\":1}");

        let (status, body) = json(
            authed(client().get(format!("{base}/mail?since=soon")))
                .send()
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(status, reqwest::StatusCode::BAD_REQUEST);
        assert_eq!(body["code"], "bad_request");
        task.abort();
    }

    #[tokio::test]
    async fn the_onboarding_routes_need_their_header() {
        let stub = Stub::new();
        let (base, task) = serve(stub.clone()).await;
        for (route, body) in [
            (
                "queue/enqueue-test",
                serde_json::json!({ "projectId": "p1" }),
            ),
            (
                "queue/cancel-test",
                serde_json::json!({ "sessionId": "sess-held" }),
            ),
        ] {
            let (status, out) = json(
                authed(client().post(format!("{base}/{route}")))
                    .json(&body)
                    .send()
                    .await
                    .unwrap(),
            )
            .await;
            assert_eq!(status, reqwest::StatusCode::FORBIDDEN, "{route}");
            assert_eq!(out["code"], "refused", "{route}: {out}");
        }
        assert!(stub.calls().is_empty(), "{:?}", stub.calls());

        let (status, out) = json(
            authed(client().post(format!("{base}/queue/enqueue-test")))
                .header(ONBOARD_HEADER, "1")
                .json(&serde_json::json!({ "projectId": "p1" }))
                .send()
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(status, reqwest::StatusCode::OK);
        assert_eq!(out, serde_json::json!({ "sessionId": "sess-held" }));
        task.abort();
    }

    #[tokio::test]
    async fn an_unknown_route_is_an_empty_404_and_a_bad_body_is_a_typed_400() {
        let (base, task) = serve(Stub::new()).await;
        let res = authed(client().get(format!("{base}/nope")))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), reqwest::StatusCode::NOT_FOUND);
        assert_eq!(res.text().await.unwrap(), "", "unrouted: empty body (A5)");

        let (status, body) = json(
            authed(client().post(format!("{base}/connect")))
                .header("content-type", "application/json")
                .body("{not json")
                .send()
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(status, reqwest::StatusCode::BAD_REQUEST);
        assert_eq!(body["code"], "bad_request", "{body}");

        let (status, body) = json(
            authed(client().post(format!("{base}/connect")))
                .json(&serde_json::json!({ "peerId": "a", "address": "127.0.0.1:1" }))
                .send()
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(
            status,
            reqwest::StatusCode::BAD_REQUEST,
            "exactly one of the two"
        );
        assert_eq!(body["code"], "bad_request");

        let (status, body) = json(
            authed(client().get(format!("{base}/jobs/job-x")))
                .send()
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(status, reqwest::StatusCode::NOT_FOUND);
        assert_eq!(body["code"], "not_found");
        task.abort();
    }

    #[tokio::test]
    async fn a_probe_with_skipped_is_accepted() {
        let stub = Stub::new();
        let (base, task) = serve(stub.clone()).await;
        let (status, body) = json(
            authed(client().post(format!("{base}/probe")))
                .json(&serde_json::json!({
                    "peerId": PEER, "testId": "t5_fleet_push", "passed": false,
                    "skipped": true, "detail": "skipped: no --allow-push", "atMs": 1.0
                }))
                .send()
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(status, reqwest::StatusCode::OK, "{body}");
        assert_eq!(body, serde_json::json!({ "recorded": true }));
        assert_eq!(stub.calls(), vec!["probe".to_string()]);
        task.abort();
    }

    #[test]
    fn engine_errors_map_to_contract_codes_by_cause() {
        let code = |e: AppError| DoorError::from(e).code;
        assert_eq!(code(AppError::Validation("x".into())), "bad_request");
        assert_eq!(code(AppError::NotFound("x".into())), "not_found");
        assert_eq!(code(AppError::Forbidden("x".into())), "refused");
        assert_eq!(code(AppError::NetworkOffline("x".into())), "refused");
        assert_eq!(code(AppError::Internal("x".into())), "internal");
        let mismatch = DoorError::from(PairCodeError::Mismatch {
            attempts_left: 0,
            withdrawn: true,
        });
        assert_eq!(
            (mismatch.status, mismatch.code),
            (StatusCode::CONFLICT, "code_mismatch")
        );
    }
}
