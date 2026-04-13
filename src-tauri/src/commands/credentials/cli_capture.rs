//! Capture credentials from locally installed, already-authenticated CLIs.
//!
//! Provides an alternative to manual paste and browser-based AutoCred flows by
//! shelling out to trusted CLI binaries (gcloud, gh, vercel, netlify, heroku)
//! and extracting their active tokens + context metadata.
//!
//! **Security model**: capture specs are compile-time constants, never loaded
//! from the catalog or user input. Binaries are resolved with the same
//! `resolve_cli_path` allowlist as [`auth_detect`], environment is sanitized,
//! and all subprocess output is capped at [`MAX_CLI_OUTPUT_BYTES`].
//!
//! Captured credentials carry `metadata.source = "cli"` so the refresh engine
//! can re-run the capture command before token expiry instead of prompting
//! the user again.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::State;
use tokio::process::Command;
use tokio::time::timeout;

use crate::commands::credentials::auth_detect::{
    resolve_cli_path, read_limited, sanitized_env, MAX_CLI_OUTPUT_BYTES,
};
use crate::db::models::PersonaCredential;
use crate::db::repos::resources::credentials as cred_repo;
use crate::db::DbPool;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

// =============================================================================
// Spec types
// =============================================================================

/// A single subprocess invocation used during capture.
struct CliStep {
    /// Bare binary name, resolved via `resolve_cli_path`.
    cmd: &'static str,
    /// Arguments passed verbatim. Must never interpolate user input.
    args: &'static [&'static str],
}

/// Per-field capture: runs a CLI step and stores its trimmed stdout under
/// `field_key` in the captured field map.
struct CaptureField {
    /// Credential field key (must match the connector's `fields[].key`).
    field_key: &'static str,
    /// Whether the captured value is a secret (token) or context (project id).
    sensitive: bool,
    step: CliStep,
}

/// Full capture spec for a single service.
struct CaptureSpec {
    /// Connector `service_type` (must match the JSON catalog `name`).
    service_type: &'static str,
    /// Binary that must be present and on the allowlist.
    binary: &'static str,
    /// Step that returns non-error output only when the user is authenticated.
    auth_check: CliStep,
    /// Ordered field captures. Token field should come first so partial failure
    /// still surfaces a useful error.
    fields: &'static [CaptureField],
    /// Lifetime of the captured token in seconds, or `None` for long-lived
    /// tokens that don't require proactive refresh.
    token_ttl_seconds: Option<i64>,
    /// Short hint shown when `auth_check` reports the user is not logged in.
    auth_instruction: &'static str,
}

// =============================================================================
// Built-in specs
// =============================================================================

const CAPTURE_SPECS: &[CaptureSpec] = &[
    // Google Cloud Platform -- short-lived 1h access token + project id.
    CaptureSpec {
        service_type: "gcp_cloud",
        binary: "gcloud",
        auth_check: CliStep {
            cmd: "gcloud",
            args: &["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"],
        },
        fields: &[
            CaptureField {
                field_key: "service_account_json",
                sensitive: true,
                step: CliStep {
                    cmd: "gcloud",
                    args: &["auth", "print-access-token"],
                },
            },
            CaptureField {
                field_key: "project_id",
                sensitive: false,
                step: CliStep {
                    cmd: "gcloud",
                    args: &["config", "get-value", "project"],
                },
            },
        ],
        token_ttl_seconds: Some(3600),
        auth_instruction: "Run `gcloud auth login` in a terminal, then retry.",
    },
    // GitHub -- long-lived PAT managed by gh.
    CaptureSpec {
        service_type: "github",
        binary: "gh",
        auth_check: CliStep {
            cmd: "gh",
            args: &["auth", "status"],
        },
        fields: &[CaptureField {
            field_key: "token",
            sensitive: true,
            step: CliStep {
                cmd: "gh",
                args: &["auth", "token"],
            },
        }],
        token_ttl_seconds: None,
        auth_instruction: "Run `gh auth login` in a terminal, then retry.",
    },
    // Vercel -- long-lived token from `vercel` CLI login.
    CaptureSpec {
        service_type: "vercel",
        binary: "vercel",
        auth_check: CliStep {
            cmd: "vercel",
            args: &["whoami"],
        },
        fields: &[CaptureField {
            field_key: "token",
            sensitive: true,
            step: CliStep {
                cmd: "vercel",
                args: &["tokens", "list", "--confirm"],
            },
        }],
        token_ttl_seconds: None,
        auth_instruction: "Run `vercel login` in a terminal, then retry.",
    },
    // Netlify -- long-lived personal access token.
    CaptureSpec {
        service_type: "netlify",
        binary: "netlify",
        auth_check: CliStep {
            cmd: "netlify",
            args: &["status"],
        },
        fields: &[CaptureField {
            field_key: "token",
            sensitive: true,
            step: CliStep {
                cmd: "netlify",
                args: &["api", "createAccessToken", "--data", "{\"description\":\"personas-desktop\"}"],
            },
        }],
        token_ttl_seconds: None,
        auth_instruction: "Run `netlify login` in a terminal, then retry.",
    },
    // Heroku -- long-lived OAuth token via heroku/authorizations.
    CaptureSpec {
        service_type: "heroku",
        binary: "heroku",
        auth_check: CliStep {
            cmd: "heroku",
            args: &["auth:whoami"],
        },
        fields: &[CaptureField {
            field_key: "api_key",
            sensitive: true,
            step: CliStep {
                cmd: "heroku",
                args: &["auth:token"],
            },
        }],
        token_ttl_seconds: None,
        auth_instruction: "Run `heroku login` in a terminal, then retry.",
    },
];

fn find_spec(service_type: &str) -> Option<&'static CaptureSpec> {
    CAPTURE_SPECS.iter().find(|s| s.service_type == service_type)
}

// =============================================================================
// Error & result types
// =============================================================================

/// Structured failure so the frontend can show targeted guidance.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CliCaptureError {
    /// Spec not registered for this service_type.
    UnknownService,
    /// Binary not found or resolved path is outside the allowlist.
    BinaryMissing { binary: String },
    /// Binary present but `auth_check` failed -- user needs to log in.
    Unauthenticated { instruction: String },
    /// `auth_check` or a capture step exceeded the subprocess timeout.
    Timeout,
    /// A capture step exited with a non-zero status or produced empty output.
    CaptureFailed { step: String, detail: String },
}

impl std::fmt::Display for CliCaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownService => write!(f, "No CLI capture spec for this service"),
            Self::BinaryMissing { binary } => {
                write!(f, "CLI binary `{}` not found or not allowlisted", binary)
            }
            Self::Unauthenticated { instruction } => {
                write!(f, "CLI is not authenticated. {}", instruction)
            }
            Self::Timeout => write!(f, "CLI subprocess timed out"),
            Self::CaptureFailed { step, detail } => {
                write!(f, "CLI step `{}` failed: {}", step, detail)
            }
        }
    }
}

impl From<CliCaptureError> for AppError {
    fn from(err: CliCaptureError) -> Self {
        match err {
            CliCaptureError::UnknownService => AppError::NotFound(err.to_string()),
            CliCaptureError::BinaryMissing { .. }
            | CliCaptureError::Unauthenticated { .. }
            | CliCaptureError::Timeout
            | CliCaptureError::CaptureFailed { .. } => AppError::Internal(err.to_string()),
        }
    }
}

/// Successful capture payload returned to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct CliCaptureResult {
    pub service_type: String,
    /// field_key -> captured value (both secret and non-secret).
    pub fields: HashMap<String, String>,
    pub token_ttl_seconds: Option<i64>,
    /// ISO-8601 timestamp of capture (for metadata.captured_at).
    pub captured_at: String,
    /// Computed `oauth_token_expires_at` if the spec has a TTL.
    pub expires_at: Option<String>,
}

// =============================================================================
// Subprocess runner
// =============================================================================

/// Max time for a single capture step. Capture commands are expected to return
/// in <1s; we cap at 5s to tolerate cold-started CLIs on Windows.
const STEP_TIMEOUT: Duration = Duration::from_secs(5);

/// Run a single CLI step in a sandboxed subprocess. Returns trimmed stdout on
/// success or a structured error describing what went wrong.
async fn run_step(
    bin_path: &PathBuf,
    step: &CliStep,
) -> Result<String, CliCaptureError> {
    let args: Vec<String> = step.args.iter().map(|a| a.to_string()).collect();

    let mut child = Command::new(bin_path)
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .env_clear()
        .envs(sanitized_env())
        .spawn()
        .map_err(|e| CliCaptureError::CaptureFailed {
            step: step.cmd.to_string(),
            detail: format!("spawn failed: {}", e),
        })?;

    let result = timeout(STEP_TIMEOUT, async {
        let mut stdout_reader = child.stdout.take().ok_or(())?;
        let mut stderr_reader = child.stderr.take().ok_or(())?;

        let (stdout_bytes, stderr_bytes) = tokio::join!(
            read_limited(&mut stdout_reader, MAX_CLI_OUTPUT_BYTES),
            read_limited(&mut stderr_reader, MAX_CLI_OUTPUT_BYTES),
        );

        let status = child.wait().await.map_err(|_| ())?;

        let stdout = String::from_utf8_lossy(&stdout_bytes.unwrap_or_default()).to_string();
        let stderr = String::from_utf8_lossy(&stderr_bytes.unwrap_or_default()).to_string();
        Ok::<(bool, String, String), ()>((status.success(), stdout, stderr))
    })
    .await;

    match result {
        Ok(Ok((success, stdout, stderr))) => {
            let trimmed = stdout.trim().to_string();
            if success && !trimmed.is_empty() {
                Ok(trimmed)
            } else if !success {
                Err(CliCaptureError::CaptureFailed {
                    step: step.cmd.to_string(),
                    detail: stderr.trim().chars().take(240).collect(),
                })
            } else {
                Err(CliCaptureError::CaptureFailed {
                    step: step.cmd.to_string(),
                    detail: "empty stdout".to_string(),
                })
            }
        }
        Ok(Err(_)) => {
            let _ = child.kill().await;
            Err(CliCaptureError::CaptureFailed {
                step: step.cmd.to_string(),
                detail: "pipe/wait failed".to_string(),
            })
        }
        Err(_) => {
            let _ = child.kill().await;
            Err(CliCaptureError::Timeout)
        }
    }
}

/// Drive the full capture flow: auth check, then every field step.
async fn run_spec(spec: &'static CaptureSpec) -> Result<CliCaptureResult, CliCaptureError> {
    // Resolve + allowlist-validate the binary once (all steps share the same path).
    let binary_name = spec.binary;
    let bin_path = tokio::task::spawn_blocking(move || resolve_cli_path(binary_name, &[]))
        .await
        .unwrap_or(None)
        .ok_or_else(|| CliCaptureError::BinaryMissing {
            binary: spec.binary.to_string(),
        })?;

    // Auth check: treat any failure as "not logged in". `gh auth status` exits
    // non-zero with useful stderr in this case; we pass that through.
    if let Err(e) = run_step(&bin_path, &spec.auth_check).await {
        // Distinguish missing binary errors (already handled above) from auth
        // failures. If we get here the binary ran but the step failed.
        let hint = match &e {
            CliCaptureError::CaptureFailed { detail, .. } if !detail.is_empty() => {
                format!("{} ({})", spec.auth_instruction, detail)
            }
            _ => spec.auth_instruction.to_string(),
        };
        return Err(CliCaptureError::Unauthenticated { instruction: hint });
    }

    // Capture each field sequentially so we surface the first failing step.
    let mut fields: HashMap<String, String> = HashMap::new();
    for cf in spec.fields {
        let value = run_step(&bin_path, &cf.step).await?;
        // Audit-friendly debug only -- never log the value for sensitive fields.
        if cf.sensitive {
            tracing::info!(
                target: "audit",
                service_type = spec.service_type,
                field = cf.field_key,
                "CLI capture: secret field captured"
            );
        } else {
            tracing::debug!(
                service_type = spec.service_type,
                field = cf.field_key,
                value = %value,
                "CLI capture: context field captured"
            );
        }
        fields.insert(cf.field_key.to_string(), value);
    }

    let captured_at = chrono::Utc::now();
    let expires_at = spec
        .token_ttl_seconds
        .map(|ttl| (captured_at + chrono::Duration::seconds(ttl)).to_rfc3339());

    Ok(CliCaptureResult {
        service_type: spec.service_type.to_string(),
        fields,
        token_ttl_seconds: spec.token_ttl_seconds,
        captured_at: captured_at.to_rfc3339(),
        expires_at,
    })
}

// =============================================================================
// Tauri commands
// =============================================================================

/// List service_types that support CLI capture on this machine. The frontend
/// uses this to decide which connector cards should show the "Import from CLI"
/// action. Detection is best-effort and cached indirectly via `which` results.
#[tauri::command]
pub async fn list_cli_capturable_services(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<String>, AppError> {
    require_auth(&state).await?;

    let specs: Vec<&'static CaptureSpec> = CAPTURE_SPECS.iter().collect();
    let resolved = tokio::task::spawn_blocking(move || {
        specs
            .into_iter()
            .filter_map(|s| resolve_cli_path(s.binary, &[]).map(|_| s.service_type.to_string()))
            .collect::<Vec<String>>()
    })
    .await
    .unwrap_or_default();

    Ok(resolved)
}

/// Run the capture spec for `service_type` and return the captured fields.
/// The frontend is responsible for calling `create_credential` with the result.
#[tauri::command]
pub async fn cli_capture_run(
    state: State<'_, Arc<AppState>>,
    service_type: String,
) -> Result<CliCaptureResult, AppError> {
    require_auth(&state).await?;

    let spec = find_spec(&service_type).ok_or(CliCaptureError::UnknownService)?;

    tracing::info!(
        target: "audit",
        service_type = %service_type,
        binary = spec.binary,
        "CLI capture: invoked"
    );

    run_spec(spec).await.map_err(Into::into)
}

// =============================================================================
// Refresh helper (used by oauth_refresh engine)
// =============================================================================

/// Re-run the capture spec for an existing credential whose `metadata.source`
/// is `"cli"`, and update its stored fields + expiry metadata in a transaction.
///
/// Returns a short human-readable summary for audit logs.
pub async fn recapture_for_credential(
    pool: &DbPool,
    cred: &PersonaCredential,
) -> Result<String, AppError> {
    let spec = find_spec(&cred.service_type)
        .ok_or_else(|| AppError::NotFound(format!(
            "No CLI capture spec for service_type `{}`", cred.service_type
        )))?;

    let result = run_spec(spec).await.map_err(AppError::from)?;

    // Persist new field values.
    cred_repo::save_fields(pool, &cred.id, &result.fields)?;

    // Patch metadata with fresh capture timestamp + expiry.
    let mut patch = serde_json::Map::new();
    patch.insert("source".into(), serde_json::Value::String("cli".into()));
    patch.insert(
        "cli_captured_at".into(),
        serde_json::Value::String(result.captured_at.clone()),
    );
    if let Some(exp) = result.expires_at.as_deref() {
        patch.insert(
            "oauth_token_expires_at".into(),
            serde_json::Value::String(exp.to_string()),
        );
    }
    // Reset failure counters on successful recapture.
    patch.insert("oauth_refresh_fail_count".into(), serde_json::Value::Number(0.into()));
    patch.insert(
        "oauth_refresh_backoff_until".into(),
        serde_json::Value::Null,
    );
    cred_repo::patch_metadata_atomic(pool, &cred.id, patch)?;

    Ok(format!(
        "CLI recapture succeeded ({} fields, ttl={:?}s)",
        result.fields.len(),
        result.token_ttl_seconds
    ))
}
