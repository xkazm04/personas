use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Public-facing view of the saved Langfuse config. Never contains the secret
/// key — the caller can only learn whether one is set.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LangfuseConfig {
    pub host: String,
    pub public_key: String,
    pub secret_key_set: bool,
    pub redact_content: bool,
    pub enabled: bool,
    /// `true` when the connection points at the Personas-managed local stack
    /// (set automatically by `langfuse_stack_start`). `false` for manual
    /// connections to a Langfuse instance the user runs themselves.
    pub managed: bool,
    /// User's preferred port for the local stack. The actual bound port may
    /// differ if the preferred port was busy when starting; check
    /// `LangfuseStackInfo.port` for the live value.
    pub preferred_port: u16,
    /// Langfuse project id used to construct deep-link URLs. For the
    /// managed stack this is always `personas-default` (matches
    /// `LANGFUSE_INIT_PROJECT_ID` in the compose template). For manual
    /// connections the user can supply their project's id so
    /// "Open in Langfuse" links land on the right project.
    pub project_id: Option<String>,
    pub last_tested_at: Option<i64>,
    pub last_test_outcome: Option<String>,
}

/// Payload sent from the frontend when saving a Langfuse connection
/// manually. The managed-stack flow uses `langfuse_stack_start` instead and
/// never goes through this struct.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LangfuseSaveRequest {
    pub host: String,
    pub public_key: String,
    pub secret_key: String,
    pub redact_content: bool,
    pub enabled: bool,
    /// Optional project id for "Open in Langfuse" deep links. Empty / absent
    /// means we don't know — the deep-link button is hidden in that case.
    pub project_id: Option<String>,
}

/// Result of probing a Langfuse host with a given key pair.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LangfuseTestResult {
    pub ok: bool,
    pub http_status: Option<u16>,
    pub message: String,
    pub project_name: Option<String>,
}

/// Plaintext admin credentials for the managed stack. Returned only when
/// the user explicitly asks (via `langfuse_stack_get_admin_credentials`),
/// never as part of `langfuse_get_config`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LangfuseAdminCredentials {
    pub email: String,
    pub password: String,
}

/// Coarse stack-state for the managed self-host. Ordered roughly from "no
/// hope" to "everything's good"; the frontend renders different UI per
/// variant.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum LangfuseStackState {
    /// Docker CLI is not on PATH at all.
    DockerMissing,
    /// Docker CLI works but the daemon isn't responding.
    DockerNotRunning,
    /// `docker compose` and `docker-compose` are both unavailable.
    ComposeMissing,
    /// Docker is fine but we haven't generated compose files yet.
    NotInstalled,
    /// Files exist; no Personas-langfuse containers are running.
    Stopped,
    /// Some containers running but `langfuse-web` is not.
    Partial,
    /// `langfuse-web` is running and the health endpoint replies 2xx.
    Running,
    /// `langfuse-web` is running but the health endpoint isn't reachable.
    Unhealthy,
}

/// Combined snapshot returned by `langfuse_stack_get_info` so the frontend
/// can render the whole stack panel without juggling four separate calls.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LangfuseStackInfo {
    pub state: LangfuseStackState,
    pub docker_installed: bool,
    pub docker_running: bool,
    pub docker_version: Option<String>,
    pub compose_available: bool,
    pub stack_initialized: bool,
    pub port: u16,
    pub host_url: String,
    pub stack_dir: String,
    /// Set when probing produced a recoverable error (e.g. compose ps failed
    /// because Docker was just stopped). Distinct from `LangfuseStackState`
    /// because the state may still be `Running` from a stale snapshot.
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// Phase 1c — background lifecycle progress
// ---------------------------------------------------------------------------

/// Phases of the bring-up flow. Each phase has a fixed estimated duration so
/// the UI can render an aggregate progress bar and ETA without parsing
/// per-image pull progress from `docker compose` output.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum StartPhase {
    /// Generate compose + env files; gen secrets if first run. ~2s.
    Preparing,
    /// `docker compose pull` — the long phase on first run (~3-10 min, image
    /// dependent); near-instant on subsequent starts (cache hit).
    PullingImages,
    /// `docker compose up -d` — bring containers online. ~30s.
    StartingContainers,
    /// HTTP health probe against `/api/public/health`. ~30-90s for first
    /// boot (ClickHouse migrations); seconds after.
    Healthchecking,
}

/// Progress event broadcast to the frontend during a background lifecycle
/// operation (start or stop). Emitted on the `langfuse://stack/progress`
/// Tauri event. Multiple listeners see the same payload.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LangfuseStackProgress {
    /// Unique id for this lifecycle job. Frontend uses this to ignore stale
    /// events from a job it isn't tracking.
    pub job_id: String,
    /// What kind of job is in flight (start/stop/installer-download).
    pub kind: LangfuseJobKind,
    /// Current phase. None when no phase boundary applies (e.g. stop is
    /// monolithic).
    pub phase: Option<StartPhase>,
    /// Aggregate fraction of work done across all phases, in [0, 1].
    pub fraction: f64,
    /// Estimated seconds remaining until the job completes. Backed by fixed
    /// per-phase estimates plus the elapsed-in-current-phase delta.
    pub eta_seconds: u64,
    /// One-line human message — shown under the progress bar. Already i18n'd
    /// where source is English; non-English locales fall through to the
    /// translation registry.
    pub message: String,
}

/// What kind of background lifecycle job a progress event refers to.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum LangfuseJobKind {
    Start,
    Stop,
    InstallerDownload,
}

/// Final event emitted on `langfuse://stack/done` when a background job
/// completes (success or failure). Frontend uses this to clear the
/// in-progress UI state.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LangfuseStackDone {
    pub job_id: String,
    pub kind: LangfuseJobKind,
    pub success: bool,
    pub error: Option<String>,
    /// For `InstallerDownload`, the absolute path of the saved installer.
    pub installer_path: Option<String>,
}

/// Returned by `langfuse_stack_start` so the frontend has a job id to
/// correlate against progress events. The actual start work runs in a
/// detached tokio task — this command does not block.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LangfuseJobHandle {
    pub job_id: String,
    pub kind: LangfuseJobKind,
}
