//! Tauri commands for the Langfuse plugin.
//!
//! Two flows live side-by-side:
//! - **Managed self-host** (preferred): `langfuse_stack_*` commands generate
//!   compose+env files, run Docker for the user, and auto-save the
//!   pre-generated init keys into the keyring. Phase 1c moved the heavy
//!   work into a background task — `start`/`stop` return a job id and the
//!   actual progress flows over the `langfuse://stack/progress` event.
//! - **Manual** (advanced): `langfuse_test_connection` + `langfuse_save_config`
//!   for users who already run a Langfuse instance somewhere else.

use std::sync::Arc;

use chrono::Utc;
use tauri::{AppHandle, Manager, State};
use url::Url;

use crate::error::AppError;
use crate::ipc_auth::require_privileged;
use crate::langfuse::client::{fetch_recent_traces, probe};
use crate::langfuse::config;
use crate::langfuse::docker;
use crate::langfuse::exporter;
use crate::langfuse::lifecycle;
use crate::langfuse::templates;
use crate::langfuse::types::{
    LangfuseAdminCredentials, LangfuseConfig, LangfuseJobHandle, LangfuseJobKind,
    LangfuseSaveRequest, LangfuseStackInfo, LangfuseStackState, LangfuseTestResult,
    LangfuseTraceSummary,
};
use crate::AppState;

/// Validate a Langfuse host URL. Mirrors the cloud-orchestrator policy: HTTPS
/// for remote hosts; HTTP only for loopback (so users can test against a
/// locally-running self-host). The DNS-rebinding defense in
/// [`crate::engine::ssrf_safe_dns`] handles the case where a public hostname
/// resolves to a private IP at request time.
fn validate_langfuse_host(raw: &str) -> Result<Url, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Host URL must not be empty".into()));
    }

    let parsed = Url::parse(trimmed)
        .map_err(|e| AppError::Validation(format!("Invalid Langfuse host URL: {e}")))?;

    match parsed.scheme() {
        "https" => Ok(parsed),
        "http" => {
            let host = parsed.host_str().unwrap_or("");
            if host == "localhost" || host == "127.0.0.1" || host == "[::1]" {
                Ok(parsed)
            } else {
                Err(AppError::Validation(
                    "HTTP is only allowed for localhost. Use HTTPS for remote Langfuse \
                     instances to protect your secret key in transit."
                        .into(),
                ))
            }
        }
        other => Err(AppError::Validation(format!(
            "Unsupported URL scheme \"{other}://\". Use HTTPS (or HTTP for localhost)."
        ))),
    }
}

// ---------------------------------------------------------------------------
// Manual connection commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn langfuse_test_connection(
    state: State<'_, Arc<AppState>>,
    host: String,
    public_key: String,
    secret_key: String,
) -> Result<LangfuseTestResult, AppError> {
    require_privileged(&state, "langfuse_test_connection").await?;
    // Reject obviously bad hosts (non-https remote, file://, gopher://, etc.)
    // before we hand the URL + Basic-auth credentials to reqwest.
    validate_langfuse_host(&host)?;
    Ok(probe(&host, &public_key, &secret_key).await)
}

#[tauri::command]
pub async fn langfuse_save_config(
    state: State<'_, Arc<AppState>>,
    request: LangfuseSaveRequest,
) -> Result<LangfuseTestResult, AppError> {
    require_privileged(&state, "langfuse_save_config").await?;

    let LangfuseSaveRequest {
        host,
        public_key,
        secret_key,
        redact_content,
        enabled,
        project_id,
    } = request;

    let trimmed_host = host.trim().trim_end_matches('/').to_string();
    let trimmed_pk = public_key.trim().to_string();
    let trimmed_sk = secret_key.trim().to_string();

    // Validate the host BEFORE keyring writes -- avoids storing credentials
    // alongside an URL we'd refuse to use.
    validate_langfuse_host(&trimmed_host)?;

    if trimmed_pk.is_empty() || trimmed_sk.is_empty() {
        return Err(AppError::Validation(
            "Public and secret keys must not be empty".into(),
        ));
    }

    let result = probe(&trimmed_host, &trimmed_pk, &trimmed_sk).await;
    if !result.ok {
        return Ok(result);
    }

    config::store_host(&trimmed_host).map_err(AppError::Langfuse)?;
    config::store_public_key(&trimmed_pk).map_err(AppError::Langfuse)?;
    config::store_secret_key(&trimmed_sk).map_err(AppError::Langfuse)?;
    config::store_redact(redact_content).map_err(AppError::Langfuse)?;
    config::store_enabled(enabled).map_err(AppError::Langfuse)?;
    config::store_managed(false).map_err(AppError::Langfuse)?;
    config::store_project_id(
        project_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    )
    .map_err(AppError::Langfuse)?;
    config::store_last_test(Utc::now().timestamp(), &result.message).map_err(AppError::Langfuse)?;

    if enabled {
        exporter::install(trimmed_host.clone(), trimmed_pk.clone(), trimmed_sk.clone());
    } else {
        exporter::uninstall();
    }

    tracing::info!(
        host = %trimmed_host,
        enabled = enabled,
        redact = redact_content,
        "Saved manual Langfuse config"
    );

    Ok(result)
}

/// Fetch the most-recent traces from the configured Langfuse host so the
/// plugin page can render a deep-link list without the user opening Langfuse
/// first. Uses the stored public+secret keys; rejects when no connection is
/// configured. Caps at 100 to avoid pulling unbounded history.
#[tauri::command]
pub async fn langfuse_recent_traces(
    state: State<'_, Arc<AppState>>,
    limit: Option<u32>,
) -> Result<Vec<LangfuseTraceSummary>, AppError> {
    require_privileged(&state, "langfuse_recent_traces").await?;

    let host = config::load_host()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Langfuse("Langfuse is not connected.".into()))?;
    let public_key = config::load_public_key()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Langfuse("No Langfuse public key on file.".into()))?;
    let secret_key = config::load_secret_key()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Langfuse("No Langfuse secret key on file.".into()))?;

    fetch_recent_traces(&host, &public_key, &secret_key, limit.unwrap_or(10))
        .await
        .map_err(AppError::Langfuse)
}

#[tauri::command]
pub async fn langfuse_get_config() -> Result<Option<LangfuseConfig>, AppError> {
    let host = config::load_host();
    let public_key = config::load_public_key();
    let secret_key_set = config::load_secret_key().is_some();
    let preferred_port = config::load_preferred_port();
    let project_id = config::load_project_id();

    match (host, public_key) {
        (Some(host), Some(public_key)) => {
            let (last_tested_at, last_test_outcome) = config::load_last_test();
            Ok(Some(LangfuseConfig {
                host,
                public_key,
                secret_key_set,
                redact_content: config::load_redact(),
                enabled: config::load_enabled(),
                managed: config::load_managed(),
                preferred_port,
                project_id,
                last_tested_at,
                last_test_outcome,
            }))
        }
        _ => {
            // Even when the user has never connected, we want to surface the
            // preferred-port setting so the plugin form can show it.
            Ok(Some(LangfuseConfig {
                host: String::new(),
                public_key: String::new(),
                secret_key_set: false,
                redact_content: false,
                enabled: false,
                managed: false,
                preferred_port,
                project_id: None,
                last_tested_at: None,
                last_test_outcome: None,
            }))
        }
    }
}

#[tauri::command]
pub async fn langfuse_clear_config() -> Result<(), AppError> {
    config::clear_all();
    exporter::uninstall();
    tracing::info!("Cleared Langfuse config");
    Ok(())
}

#[tauri::command]
pub async fn langfuse_save_preferred_port(app: AppHandle, port: u16) -> Result<u16, AppError> {
    if port == 0 {
        return Err(AppError::Validation("Port must be greater than 0".into()));
    }
    config::store_preferred_port(port).map_err(AppError::Langfuse)?;

    // If the stack is initialized and isn't currently running, realign the
    // .env now so the "Currently using" label reflects the change immediately.
    // Skip when running — we can't safely rebind without a restart, and
    // pick_free_port would see our own container's port as busy.
    let app_data = resolve_app_data(&app)?;
    if templates::is_initialized(&app_data) {
        let docker_info = docker::detect().await;
        let mut is_running = false;
        if let Some(compose_cmd) = docker_info.compose_cmd.as_ref() {
            let stack_dir = templates::stack_dir(&app_data);
            is_running = matches!(
                docker::presence(&stack_dir, compose_cmd).await,
                Ok(docker::StackPresence::Running)
            );
        }
        if !is_running {
            let new_port = templates::pick_free_port(port)?;
            templates::update_port(&app_data, new_port)?;
        }
    }

    tracing::info!(preferred_port = port, "Saved Langfuse preferred port");
    Ok(port)
}

// ---------------------------------------------------------------------------
// Managed self-host: status snapshot
// ---------------------------------------------------------------------------

fn resolve_app_data(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("Cannot resolve app data dir: {e}")))
}

/// Snapshot of Docker presence + stack state. Cheap to call repeatedly;
/// frontends are expected to poll while the stack starts.
#[tauri::command]
pub async fn langfuse_stack_get_info(app: AppHandle) -> Result<LangfuseStackInfo, AppError> {
    let app_data = resolve_app_data(&app)?;
    let stack_dir = templates::stack_dir(&app_data);
    let stack_dir_str = stack_dir.to_string_lossy().to_string();

    let docker_info = docker::detect().await;
    let stack_initialized = templates::is_initialized(&app_data);

    let preferred_port = config::load_preferred_port();
    let (port, host_url) = if stack_initialized {
        let env_path = stack_dir.join(templates::ENV_FILE);
        match templates::read_env(&env_path) {
            Ok(s) => (s.port, s.host_url),
            Err(_) => (preferred_port, format!("http://localhost:{preferred_port}")),
        }
    } else {
        (preferred_port, format!("http://localhost:{preferred_port}"))
    };

    let mut info = LangfuseStackInfo {
        state: LangfuseStackState::NotInstalled,
        docker_installed: docker_info.installed,
        docker_running: docker_info.running,
        docker_version: docker_info.version.clone(),
        compose_available: docker_info.compose_cmd.is_some(),
        stack_initialized,
        port,
        host_url: host_url.clone(),
        stack_dir: stack_dir_str,
        error: None,
    };

    if !docker_info.installed {
        info.state = LangfuseStackState::DockerMissing;
        return Ok(info);
    }
    if !docker_info.running {
        info.state = LangfuseStackState::DockerNotRunning;
        return Ok(info);
    }
    let compose_cmd = match docker_info.compose_cmd {
        Some(c) => c,
        None => {
            info.state = LangfuseStackState::ComposeMissing;
            return Ok(info);
        }
    };

    if !stack_initialized {
        info.state = LangfuseStackState::NotInstalled;
        return Ok(info);
    }

    match docker::presence(&stack_dir, &compose_cmd).await {
        Ok(docker::StackPresence::Absent) => {
            info.state = LangfuseStackState::Stopped;
        }
        Ok(docker::StackPresence::Partial) => {
            info.state = LangfuseStackState::Partial;
        }
        Ok(docker::StackPresence::Running) => {
            let healthy = docker::quick_health(&host_url).await;
            info.state = if healthy {
                LangfuseStackState::Running
            } else {
                LangfuseStackState::Unhealthy
            };
        }
        Err(e) => {
            info.error = Some(e.to_string());
            info.state = LangfuseStackState::Stopped;
        }
    }

    Ok(info)
}

// ---------------------------------------------------------------------------
// Background-spawning lifecycle commands
// ---------------------------------------------------------------------------

/// Kick off a background **start**. Returns a `LangfuseJobHandle` immediately.
/// Frontend listens to the `langfuse://stack/progress` and
/// `langfuse://stack/done` events for live updates and an OS notification
/// fires when the job terminates. Trying to start while another start is in
/// flight returns an error.
#[tauri::command]
pub async fn langfuse_stack_start(app: AppHandle) -> Result<LangfuseJobHandle, AppError> {
    let job_id = lifecycle::spawn_start(app)?;
    Ok(LangfuseJobHandle {
        job_id,
        kind: LangfuseJobKind::Start,
    })
}

/// Kick off a background **stop**. Returns a `LangfuseJobHandle` immediately.
#[tauri::command]
pub async fn langfuse_stack_stop(app: AppHandle) -> Result<LangfuseJobHandle, AppError> {
    let job_id = lifecycle::spawn_stop(app)?;
    Ok(LangfuseJobHandle {
        job_id,
        kind: LangfuseJobKind::Stop,
    })
}

#[tauri::command]
pub async fn langfuse_stack_get_admin_credentials(
) -> Result<Option<LangfuseAdminCredentials>, AppError> {
    Ok(config::load_admin_credentials()
        .map(|(email, password)| LangfuseAdminCredentials { email, password }))
}

#[tauri::command]
pub async fn langfuse_stack_open_ui(app: AppHandle) -> Result<(), AppError> {
    let info = langfuse_stack_get_info(app.clone()).await?;
    if !matches!(
        info.state,
        LangfuseStackState::Running | LangfuseStackState::Unhealthy
    ) {
        return Err(AppError::Langfuse(
            "Langfuse is not running. Click Start first.".into(),
        ));
    }
    open::that(info.host_url.as_str())
        .map_err(|e| AppError::Langfuse(format!("Failed to open browser: {e}")))?;
    Ok(())
}

/// Open the user's default browser at our local-http auto-login shim,
/// which performs a NextAuth credentials sign-in on the user's behalf so
/// they land inside Langfuse without typing anything.
///
/// `return_to` is forwarded to NextAuth's `callbackUrl`. Pass a path
/// (e.g. `/project/personas-default/traces/<id>`) to deep-link, or `None`
/// to land on the default dashboard.
#[tauri::command]
pub async fn langfuse_open_authenticated_ui(
    app: AppHandle,
    return_to: Option<String>,
) -> Result<(), AppError> {
    let info = langfuse_stack_get_info(app.clone()).await?;
    if !matches!(info.state, LangfuseStackState::Running) {
        return Err(AppError::Langfuse(
            "Langfuse is not running. Click Start first.".into(),
        ));
    }
    if config::load_admin_credentials().is_none() {
        // Manual connections don't have admin creds — fall back to the
        // plain open-in-browser path so we don't leave the user staring
        // at a NextAuth sign-in form they have to fill themselves.
        return langfuse_stack_open_ui(app).await;
    }

    let port = crate::local_http::port().ok_or_else(|| {
        AppError::Langfuse(
            "Local HTTP service isn't running — restart the app to enable auto-login.".into(),
        )
    })?;
    let nonce = crate::local_http::mint_nonce();

    let url = build_auto_login_url(port, &nonce, return_to.as_deref());
    open::that(&url).map_err(|e| AppError::Langfuse(format!("Failed to open browser: {e}")))?;
    Ok(())
}

fn build_auto_login_url(port: u16, nonce: &str, return_to: Option<&str>) -> String {
    // Use `localhost` (not `127.0.0.1`) so the response's `Set-Cookie:
    // Domain=localhost` is accepted by the browser. Cookies can only be
    // set for the request host or a parent domain; `Domain=localhost`
    // from a `127.0.0.1` request would be rejected, breaking the
    // cross-port cookie share that this whole flow depends on.
    let mut url = format!("http://localhost:{port}/langfuse/auto-login?nonce={nonce}");
    if let Some(path) = return_to.map(str::trim).filter(|s| !s.is_empty()) {
        url.push_str("&return_to=");
        url.push_str(&urlencoding::encode(path));
    }
    url
}

/// Test-only helper: return the auto-login URL without spawning a browser.
/// Behaves exactly like [`langfuse_open_authenticated_ui`] up to the
/// `open::that` call so the flow can be exercised end-to-end via HTTP.
#[cfg(feature = "test-automation")]
#[tauri::command]
pub async fn langfuse_make_authenticated_url(
    app: AppHandle,
    return_to: Option<String>,
) -> Result<String, AppError> {
    let info = langfuse_stack_get_info(app).await?;
    if !matches!(info.state, LangfuseStackState::Running) {
        return Err(AppError::Langfuse(
            "Langfuse is not running. Click Start first.".into(),
        ));
    }
    if config::load_admin_credentials().is_none() {
        return Err(AppError::Langfuse(
            "No admin credentials in keyring.".into(),
        ));
    }
    let port = crate::local_http::port()
        .ok_or_else(|| AppError::Langfuse("local_http isn't running".into()))?;
    let nonce = crate::local_http::mint_nonce();
    Ok(build_auto_login_url(port, &nonce, return_to.as_deref()))
}

// ---------------------------------------------------------------------------
// Docker installer download + run
// ---------------------------------------------------------------------------

/// Kick off a background download of the Docker Desktop installer for this
/// OS to the user's Downloads folder. Returns a job handle immediately;
/// progress events flow on `langfuse://stack/progress`, completion on
/// `langfuse://stack/done` (with the saved path in `installer_path`).
/// Returns an error on Linux (where there's no single Docker Desktop
/// installer to download).
#[tauri::command]
pub async fn langfuse_docker_download_installer(
    app: AppHandle,
) -> Result<LangfuseJobHandle, AppError> {
    let job_id = lifecycle::spawn_installer_download(app)?;
    Ok(LangfuseJobHandle {
        job_id,
        kind: LangfuseJobKind::InstallerDownload,
    })
}

/// Open the downloaded Docker installer file via the OS handler. The user
/// completes the install through the platform's normal flow (UAC on
/// Windows, .dmg drag-and-drop on macOS).
#[tauri::command]
pub async fn langfuse_docker_run_installer(path: String) -> Result<(), AppError> {
    let path_buf = std::path::PathBuf::from(&path);
    if !path_buf.is_file() {
        return Err(AppError::Validation(format!(
            "Installer not found at {path}"
        )));
    }
    lifecycle::run_installer(&path_buf)
}

/// Reset the local stack — `compose down -v` wipes all data volumes.
/// The .env stays put so the next start re-uses the same admin login.
#[tauri::command]
pub async fn langfuse_stack_reset(app: AppHandle) -> Result<(), AppError> {
    lifecycle::reset_volumes(&app).await
}

/// Refresh Docker images via `compose pull`. User restarts the stack to
/// actually run the pulled images.
#[tauri::command]
pub async fn langfuse_stack_refresh_images(app: AppHandle) -> Result<(), AppError> {
    lifecycle::refresh_images(&app).await
}
