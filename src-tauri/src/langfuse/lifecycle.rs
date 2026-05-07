//! Background lifecycle for the managed Langfuse stack.
//!
//! Phase 1c. The Tauri commands kick off detached tokio tasks that emit
//! progress events to the frontend so the UI can render a live progress bar
//! and the user can navigate away from the plugin page without losing
//! visibility. On completion, an OS notification fires.
//!
//! Events:
//!   - `langfuse://stack/progress` — periodic, phase-tagged
//!   - `langfuse://stack/done`     — terminal, success-or-error
//!
//! Concurrency: at most one `start` and one `stop` may be in flight at a
//! time (per `START_IN_FLIGHT` / `STOP_IN_FLIGHT` atomic guards). The
//! installer download runs on its own job lane and doesn't share the lock.
//!
//! Phase estimates (seconds, used for ETA + linear progress interp):
//!   - Preparing            2
//!   - PullingImages      180  (cold first run; near-instant on cache hit)
//!   - StartingContainers  30
//!   - Healthchecking      60
//! Total: 272 s. Cached re-starts feel ~90 s real-world.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::error::AppError;
use crate::langfuse::types::{
    LangfuseJobKind, LangfuseStackDone, LangfuseStackProgress, StartPhase,
};
use crate::langfuse::{config, docker, exporter, templates};

pub const EVT_PROGRESS: &str = "langfuse://stack/progress";
pub const EVT_DONE: &str = "langfuse://stack/done";

/// Cumulative offset (in seconds) at the start of each phase, against
/// [`TOTAL_SECS`]. Used to compute aggregate fraction and ETA.
fn phase_offset_secs(phase: StartPhase) -> u64 {
    match phase {
        StartPhase::Preparing => 0,
        StartPhase::PullingImages => 2,
        StartPhase::StartingContainers => 2 + 180,
        StartPhase::Healthchecking => 2 + 180 + 30,
    }
}

fn phase_estimate_secs(phase: StartPhase) -> u64 {
    match phase {
        StartPhase::Preparing => 2,
        StartPhase::PullingImages => 180,
        StartPhase::StartingContainers => 30,
        StartPhase::Healthchecking => 60,
    }
}

const TOTAL_SECS: u64 = 2 + 180 + 30 + 60;

// ---------------------------------------------------------------------------
// Single-job guards
// ---------------------------------------------------------------------------

static START_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static STOP_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

/// RAII guard that releases the start-job atomic when dropped. Drops at
/// task completion, including panics.
pub struct StartGuard;
impl StartGuard {
    fn try_acquire() -> Option<Self> {
        START_IN_FLIGHT
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self)
    }
}
impl Drop for StartGuard {
    fn drop(&mut self) {
        START_IN_FLIGHT.store(false, Ordering::Release);
    }
}

pub struct StopGuard;
impl StopGuard {
    fn try_acquire() -> Option<Self> {
        STOP_IN_FLIGHT
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self)
    }
}
impl Drop for StopGuard {
    fn drop(&mut self) {
        STOP_IN_FLIGHT.store(false, Ordering::Release);
    }
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

fn emit_progress(
    app: &AppHandle,
    job_id: &str,
    kind: LangfuseJobKind,
    phase: Option<StartPhase>,
    phase_done_fraction: f64,
    message: &str,
) {
    let phase_done = phase_done_fraction.clamp(0.0, 1.0);
    let (fraction, eta_seconds) = match phase {
        Some(p) => {
            let elapsed_in_phase = (phase_done * phase_estimate_secs(p) as f64) as u64;
            let total_elapsed = phase_offset_secs(p).saturating_add(elapsed_in_phase);
            let frac = (total_elapsed as f64 / TOTAL_SECS as f64).clamp(0.0, 0.99);
            (frac, TOTAL_SECS.saturating_sub(total_elapsed))
        }
        None => (phase_done.min(0.99), 0),
    };
    let payload = LangfuseStackProgress {
        job_id: job_id.to_string(),
        kind,
        phase,
        fraction,
        eta_seconds,
        message: message.to_string(),
    };
    let _ = app.emit(EVT_PROGRESS, &payload);
}

fn emit_done(
    app: &AppHandle,
    job_id: &str,
    kind: LangfuseJobKind,
    success: bool,
    error: Option<String>,
    installer_path: Option<String>,
) {
    let payload = LangfuseStackDone {
        job_id: job_id.to_string(),
        kind,
        success,
        error: error.clone(),
        installer_path,
    };
    let _ = app.emit(EVT_DONE, &payload);

    // OS notification on terminal events for jobs the user kicked off
    // explicitly. Quiet on stop unless it failed — stopping is fast.
    let (title, body) = match (kind, success) {
        (LangfuseJobKind::Start, true) => (
            "Langfuse is ready",
            "The local stack is running. Open Langfuse to log in.".to_string(),
        ),
        (LangfuseJobKind::Start, false) => (
            "Langfuse setup failed",
            error.clone().unwrap_or_else(|| "Unknown error".into()),
        ),
        (LangfuseJobKind::Stop, false) => (
            "Langfuse stop failed",
            error.clone().unwrap_or_else(|| "Unknown error".into()),
        ),
        (LangfuseJobKind::InstallerDownload, true) => (
            "Docker installer downloaded",
            "Run the installer from your Downloads folder to finish setup.".to_string(),
        ),
        (LangfuseJobKind::InstallerDownload, false) => (
            "Docker installer download failed",
            error.clone().unwrap_or_else(|| "Unknown error".into()),
        ),
        _ => return,
    };
    crate::notifications::send(app, title, &body);
}

// ---------------------------------------------------------------------------
// Public spawners
// ---------------------------------------------------------------------------

/// Kick off a background `start` job. Returns the new job id immediately.
/// The actual work runs in a detached tokio task; observe `EVT_PROGRESS` and
/// `EVT_DONE` to render progress.
pub fn spawn_start(app: AppHandle) -> Result<String, AppError> {
    let guard = StartGuard::try_acquire()
        .ok_or_else(|| AppError::Langfuse("Another start is already running.".into()))?;

    let job_id = Uuid::new_v4().to_string();
    let job_id_for_task = job_id.clone();

    tauri::async_runtime::spawn(async move {
        let _g = guard; // hold for the lifetime of the task
        let result = run_start(&app, &job_id_for_task).await;
        match result {
            Ok(()) => emit_done(&app, &job_id_for_task, LangfuseJobKind::Start, true, None, None),
            Err(e) => emit_done(
                &app,
                &job_id_for_task,
                LangfuseJobKind::Start,
                false,
                Some(e.to_string()),
                None,
            ),
        }
    });

    Ok(job_id)
}

/// Kick off a background `stop` job. Returns the new job id immediately.
pub fn spawn_stop(app: AppHandle) -> Result<String, AppError> {
    let guard = StopGuard::try_acquire()
        .ok_or_else(|| AppError::Langfuse("Another stop is already running.".into()))?;

    let job_id = Uuid::new_v4().to_string();
    let job_id_for_task = job_id.clone();

    tauri::async_runtime::spawn(async move {
        let _g = guard;
        let result = run_stop(&app, &job_id_for_task).await;
        match result {
            Ok(()) => emit_done(&app, &job_id_for_task, LangfuseJobKind::Stop, true, None, None),
            Err(e) => emit_done(
                &app,
                &job_id_for_task,
                LangfuseJobKind::Stop,
                false,
                Some(e.to_string()),
                None,
            ),
        }
    });

    Ok(job_id)
}

// ---------------------------------------------------------------------------
// Start flow
// ---------------------------------------------------------------------------

async fn run_start(app: &AppHandle, job_id: &str) -> Result<(), AppError> {
    // === Phase 1: Preparing ===
    emit_progress(
        app,
        job_id,
        LangfuseJobKind::Start,
        Some(StartPhase::Preparing),
        0.0,
        "Checking Docker…",
    );

    let docker_info = docker::detect().await;
    if !docker_info.installed {
        return Err(AppError::Langfuse("Docker is not installed.".into()));
    }
    if !docker_info.running {
        return Err(AppError::Langfuse(
            "Docker is installed but the daemon isn't running. Start Docker Desktop first.".into(),
        ));
    }
    let compose_cmd = docker_info.compose_cmd.ok_or_else(|| {
        AppError::Langfuse("Neither `docker compose` nor `docker-compose` is available.".into())
    })?;

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("Cannot resolve app data dir: {e}")))?;
    let stack_dir = templates::stack_dir(&app_data);

    emit_progress(
        app,
        job_id,
        LangfuseJobKind::Start,
        Some(StartPhase::Preparing),
        0.5,
        "Generating stack secrets…",
    );

    let preferred_port = config::load_preferred_port();

    // Decide what port to use. If our stack is already running, keep its
    // existing port (don't churn the running container). Otherwise scan for
    // a free port at-or-above the preferred one.
    let secrets = if templates::is_initialized(&app_data) {
        let presence = docker::presence(&stack_dir, &compose_cmd)
            .await
            .unwrap_or(docker::StackPresence::Absent);
        if matches!(presence, docker::StackPresence::Running) {
            templates::read_env(&stack_dir.join(templates::ENV_FILE))?
        } else {
            let new_port = templates::pick_free_port(preferred_port)?;
            let current = templates::read_env(&stack_dir.join(templates::ENV_FILE))?;
            if current.port != new_port {
                templates::update_port(&app_data, new_port)?
            } else {
                current
            }
        }
    } else {
        templates::ensure_files(&app_data, preferred_port)?
    };

    emit_progress(
        app,
        job_id,
        LangfuseJobKind::Start,
        Some(StartPhase::Preparing),
        1.0,
        "Stack files ready.",
    );

    // === Phase 2: Pulling images ===
    let pull_message = "Pulling Langfuse images (this can take a few minutes on first run)…";
    let ticker = spawn_phase_ticker(
        app.clone(),
        job_id.to_string(),
        StartPhase::PullingImages,
        pull_message.to_string(),
    );
    let pull_result = docker::pull(&stack_dir, &compose_cmd).await;
    ticker.abort();
    pull_result?;
    emit_progress(
        app,
        job_id,
        LangfuseJobKind::Start,
        Some(StartPhase::PullingImages),
        1.0,
        "Images ready.",
    );

    // === Phase 3: Starting containers ===
    let start_message = "Starting containers…";
    let ticker = spawn_phase_ticker(
        app.clone(),
        job_id.to_string(),
        StartPhase::StartingContainers,
        start_message.to_string(),
    );
    let up_result = docker::up(&stack_dir, &compose_cmd).await;
    ticker.abort();
    up_result?;
    emit_progress(
        app,
        job_id,
        LangfuseJobKind::Start,
        Some(StartPhase::StartingContainers),
        1.0,
        "Containers up.",
    );

    // === Phase 4: Healthchecking ===
    let hc_message = "Waiting for Langfuse to respond…";
    let ticker = spawn_phase_ticker(
        app.clone(),
        job_id.to_string(),
        StartPhase::Healthchecking,
        hc_message.to_string(),
    );
    let probe_result = docker::probe_health(&secrets.host_url, 8 * 60).await;
    ticker.abort();
    probe_result?;
    emit_progress(
        app,
        job_id,
        LangfuseJobKind::Start,
        Some(StartPhase::Healthchecking),
        1.0,
        "Langfuse is responding.",
    );

    // Persist config + install the OTLP exporter so traces start flowing.
    config::store_host(&secrets.host_url).map_err(AppError::Langfuse)?;
    config::store_public_key(&secrets.init_public_key).map_err(AppError::Langfuse)?;
    config::store_secret_key(&secrets.init_secret_key).map_err(AppError::Langfuse)?;
    config::store_enabled(true).map_err(AppError::Langfuse)?;
    config::store_managed(true).map_err(AppError::Langfuse)?;
    config::store_project_id(Some(config::MANAGED_PROJECT_ID)).map_err(AppError::Langfuse)?;
    config::store_admin_credentials(&secrets.init_user_email, &secrets.init_user_password)
        .map_err(AppError::Langfuse)?;
    config::store_last_test(chrono::Utc::now().timestamp(), "Stack started successfully")
        .map_err(AppError::Langfuse)?;

    exporter::install(
        secrets.host_url.clone(),
        secrets.init_public_key.clone(),
        secrets.init_secret_key.clone(),
    );

    Ok(())
}

/// Spawn a ticker task that emits a phase-progress event every 2 seconds.
/// Caller `.abort()`s the returned handle when the underlying work
/// completes; the abort will cancel mid-sleep.
fn spawn_phase_ticker(
    app: AppHandle,
    job_id: String,
    phase: StartPhase,
    message: String,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let total = phase_estimate_secs(phase) as f64;
        let start = Instant::now();
        // Emit an initial 0.0 immediately so the UI doesn't sit on the
        // previous phase's terminal value during the gap.
        emit_progress(
            &app,
            &job_id,
            LangfuseJobKind::Start,
            Some(phase),
            0.0,
            &message,
        );
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let elapsed_s = start.elapsed().as_secs_f64();
            // Cap interpolation at 0.95 so the UI doesn't claim "done" before
            // the actual subprocess returns.
            let frac = (elapsed_s / total).min(0.95);
            emit_progress(
                &app,
                &job_id,
                LangfuseJobKind::Start,
                Some(phase),
                frac,
                &message,
            );
        }
    })
}

// ---------------------------------------------------------------------------
// Stop flow
// ---------------------------------------------------------------------------

async fn run_stop(app: &AppHandle, job_id: &str) -> Result<(), AppError> {
    emit_progress(
        app,
        job_id,
        LangfuseJobKind::Stop,
        None,
        0.1,
        "Stopping containers…",
    );

    let docker_info = docker::detect().await;
    let compose_cmd = docker_info
        .compose_cmd
        .ok_or_else(|| AppError::Langfuse("Docker compose is unavailable.".into()))?;

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("Cannot resolve app data dir: {e}")))?;
    let stack_dir = templates::stack_dir(&app_data);

    docker::down(&stack_dir, &compose_cmd, false).await?;

    emit_progress(
        app,
        job_id,
        LangfuseJobKind::Stop,
        None,
        1.0,
        "Stopped.",
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Reset (wipe data) + image refresh
// ---------------------------------------------------------------------------

/// `compose down -v` — drops every named volume the stack owns. The next
/// `start` regenerates a fresh database. The .env (containing init keys
/// and admin password) is left intact so the rebuilt stack comes back with
/// the same credentials the user already saved.
pub async fn reset_volumes(app: &AppHandle) -> Result<(), AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("Cannot resolve app data dir: {e}")))?;
    let stack_dir = templates::stack_dir(&app_data);
    let docker_info = docker::detect().await;
    let compose_cmd = docker_info
        .compose_cmd
        .ok_or_else(|| AppError::Langfuse("Docker compose is unavailable.".into()))?;
    docker::down(&stack_dir, &compose_cmd, true).await?;
    tracing::warn!("Reset Langfuse stack volumes (data wiped)");
    Ok(())
}

/// `compose pull` — refresh image tags (`langfuse:3` etc. roll forward
/// when Langfuse cuts a new minor). User has to Stop+Start to actually run
/// the refreshed images.
pub async fn refresh_images(app: &AppHandle) -> Result<(), AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("Cannot resolve app data dir: {e}")))?;
    let stack_dir = templates::stack_dir(&app_data);
    let docker_info = docker::detect().await;
    let compose_cmd = docker_info
        .compose_cmd
        .ok_or_else(|| AppError::Langfuse("Docker compose is unavailable.".into()))?;
    docker::pull(&stack_dir, &compose_cmd).await?;
    tracing::info!("Refreshed Langfuse stack images");
    Ok(())
}

// ---------------------------------------------------------------------------
// Installer download
// ---------------------------------------------------------------------------

/// Kick off a background download of the Docker Desktop installer to the
/// user's Downloads folder. Real byte-progress (not a fake interpolation)
/// since the HTTP response carries content-length.
pub fn spawn_installer_download(app: AppHandle) -> Result<String, AppError> {
    let job_id = Uuid::new_v4().to_string();
    let job_id_for_task = job_id.clone();

    tauri::async_runtime::spawn(async move {
        let result = run_installer_download(&app, &job_id_for_task).await;
        match result {
            Ok(path) => emit_done(
                &app,
                &job_id_for_task,
                LangfuseJobKind::InstallerDownload,
                true,
                None,
                Some(path.to_string_lossy().to_string()),
            ),
            Err(e) => emit_done(
                &app,
                &job_id_for_task,
                LangfuseJobKind::InstallerDownload,
                false,
                Some(e.to_string()),
                None,
            ),
        }
    });

    Ok(job_id)
}

fn installer_url() -> Option<(&'static str, &'static str)> {
    // (URL, output filename)
    if cfg!(target_os = "windows") {
        Some((
            "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe",
            "Docker Desktop Installer.exe",
        ))
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            Some(("https://desktop.docker.com/mac/main/arm64/Docker.dmg", "Docker.dmg"))
        } else {
            Some(("https://desktop.docker.com/mac/main/amd64/Docker.dmg", "Docker.dmg"))
        }
    } else {
        // Linux: the install path varies by distro, no single installer.
        None
    }
}

async fn run_installer_download(app: &AppHandle, job_id: &str) -> Result<PathBuf, AppError> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let (url, filename) = installer_url().ok_or_else(|| {
        AppError::Langfuse(
            "Auto-download is not supported on this OS. Visit docker.com/products/docker-desktop/ to install manually.".into(),
        )
    })?;

    let downloads_dir = app
        .path()
        .download_dir()
        .map_err(|e| AppError::Internal(format!("Cannot resolve downloads dir: {e}")))?;
    std::fs::create_dir_all(&downloads_dir).map_err(AppError::Io)?;
    let target = downloads_dir.join(filename);

    let progress_msg = format!("Downloading {filename}…");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30 * 60))
        .build()
        .map_err(|e| AppError::Langfuse(format!("HTTP client build failed: {e}")))?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Langfuse(format!("Download request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Langfuse(format!(
            "Docker download returned HTTP {}",
            resp.status()
        )));
    }

    let total_bytes = resp.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(&target).await.map_err(AppError::Io)?;
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();

    // Initial 0% emit so the UI shows the bar immediately.
    let payload = LangfuseStackProgress {
        job_id: job_id.to_string(),
        kind: LangfuseJobKind::InstallerDownload,
        phase: None,
        fraction: 0.0,
        eta_seconds: 0,
        message: progress_msg.clone(),
    };
    let _ = app.emit(EVT_PROGRESS, &payload);

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Langfuse(format!("Download stream error: {e}")))?;
        file.write_all(&chunk).await.map_err(AppError::Io)?;
        downloaded += chunk.len() as u64;

        // Throttle progress emission to ~5/s so we don't spam the event bus.
        if last_emit.elapsed() >= Duration::from_millis(200) {
            last_emit = Instant::now();
            let fraction = if total_bytes > 0 {
                (downloaded as f64 / total_bytes as f64).clamp(0.0, 0.99)
            } else {
                0.0
            };
            let eta_seconds = if total_bytes > 0 && downloaded > 0 {
                let elapsed_secs = last_emit.elapsed().as_secs_f64().max(0.001);
                let bytes_per_sec = downloaded as f64 / elapsed_secs.max(0.5);
                let remaining = total_bytes.saturating_sub(downloaded) as f64;
                (remaining / bytes_per_sec.max(1.0)) as u64
            } else {
                0
            };
            let payload = LangfuseStackProgress {
                job_id: job_id.to_string(),
                kind: LangfuseJobKind::InstallerDownload,
                phase: None,
                fraction,
                eta_seconds,
                message: progress_msg.clone(),
            };
            let _ = app.emit(EVT_PROGRESS, &payload);
        }
    }

    file.flush().await.map_err(AppError::Io)?;
    Ok(target)
}

/// Open the downloaded installer file via the OS handler. Triggers the
/// platform's normal install UX (UAC on Windows, .dmg mount on macOS).
pub fn run_installer(path: &std::path::Path) -> Result<(), AppError> {
    open::that(path)
        .map_err(|e| AppError::Langfuse(format!("Failed to launch installer: {e}")))?;
    Ok(())
}
