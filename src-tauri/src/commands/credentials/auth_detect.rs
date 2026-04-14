//! Detect authenticated services via CLI probing and browser cookie inspection.
//!
//! Returns a list of services the user is currently authenticated to, enabling
//! the AI Setup wizard to pre-select connectors for batch provisioning.
//!
//! **Security**: CLI probes resolve tool paths via the `which` crate and validate
//! them against per-tool allowlists of known install directories to mitigate PATH
//! hijacking. Output is capped at [`MAX_CLI_OUTPUT_BYTES`] to prevent memory
//! exhaustion from a malicious binary.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::timeout;

use std::sync::Arc;
use tauri::State;

use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Maximum bytes we will read from a CLI subprocess (stdout + stderr combined).
/// Prevents memory exhaustion if a malicious binary produces unbounded output.
pub(crate) const MAX_CLI_OUTPUT_BYTES: usize = 256 * 1024; // 256 KiB

/// Result of probing a single service for existing authentication.
#[derive(Debug, Clone, Serialize)]
pub struct AuthDetection {
    /// Matches a connector definition `name` (e.g., "github", "slack").
    pub service_type: String,
    /// Detection method: "cli", "cookie", or "filesystem".
    pub method: String,
    /// Whether the user appears to be authenticated.
    pub authenticated: bool,
    /// Optional identity string (e.g., "user@gmail.com", "gh:octocat").
    pub identity: Option<String>,
    /// Confidence level: "high" (CLI confirmed), "medium" (cookie found), "low".
    pub confidence: String,
}

// -- CLI Probes ---------------------------------------------------------

/// CLI tool probe definition.
struct CliProbe {
    /// Connector service_type this maps to.
    service_type: &'static str,
    /// Command to run (bare name, resolved via [`resolve_cli_path`]).
    cmd: &'static str,
    /// Arguments.
    args: &'static [&'static str],
    /// Function to parse output and extract identity.
    parse: fn(&str) -> Option<String>,
    /// Allowed parent directories for the resolved binary path.
    /// If empty, any location found by `which` is accepted (fallback).
    allowed_dirs: &'static [&'static str],
}

// -- Path validation --------------------------------------------------------

/// Known safe installation directories per platform.
/// These are checked against the *parent directory* of the resolved binary.
#[cfg(target_os = "windows")]
const SAFE_DIRS: &[&str] = &[
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\ProgramData",
    "C:\\Windows\\System32",
];

#[cfg(target_os = "macos")]
const SAFE_DIRS: &[&str] = &[
    "/usr/local/bin",
    "/usr/bin",
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/Applications",
];

#[cfg(target_os = "linux")]
const SAFE_DIRS: &[&str] = &[
    "/usr/local/bin",
    "/usr/bin",
    "/usr/sbin",
    "/snap/bin",
    "/opt",
];

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
const SAFE_DIRS: &[&str] = &[];

/// Additional safe directories expanded at runtime from user environment.
/// Covers common user-scoped install locations for CLIs that don't ship to
/// system-wide paths (npm-global, gcloud bundled installer, flyctl, scoop).
fn user_safe_dirs() -> &'static [String] {
    use std::sync::OnceLock;
    static DIRS: OnceLock<Vec<String>> = OnceLock::new();
    DIRS.get_or_init(|| {
        let mut out: Vec<String> = Vec::new();
        #[cfg(target_os = "windows")]
        {
            if let Ok(local) = std::env::var("LOCALAPPDATA") {
                out.push(format!("{}\\Google\\Cloud SDK", local));
                out.push(format!("{}\\Programs", local));
                out.push(format!("{}\\Microsoft\\WinGet\\Packages", local));
            }
            if let Ok(appdata) = std::env::var("APPDATA") {
                out.push(format!("{}\\npm", appdata));
            }
            if let Ok(profile) = std::env::var("USERPROFILE") {
                out.push(format!("{}\\.fly\\bin", profile));
                out.push(format!("{}\\scoop\\shims", profile));
                out.push(format!("{}\\scoop\\apps", profile));
                out.push(format!("{}\\AppData\\Roaming\\npm", profile));
            }
        }
        #[cfg(target_os = "macos")]
        {
            if let Ok(home) = std::env::var("HOME") {
                out.push(format!("{}/.fly/bin", home));
                out.push(format!("{}/.local/bin", home));
                out.push(format!("{}/.npm-global/bin", home));
                out.push(format!("{}/google-cloud-sdk/bin", home));
            }
        }
        #[cfg(target_os = "linux")]
        {
            if let Ok(home) = std::env::var("HOME") {
                out.push(format!("{}/.fly/bin", home));
                out.push(format!("{}/.local/bin", home));
                out.push(format!("{}/.npm-global/bin", home));
                out.push(format!("{}/google-cloud-sdk/bin", home));
            }
        }
        out
    }).as_slice()
}

/// Resolve a CLI tool name to an absolute path and validate it.
///
/// Returns `None` if the tool is not found or resolves to a directory outside
/// the allowed locations (tool-specific allowlist + platform-wide safe dirs).
pub(crate) fn resolve_cli_path(cmd: &str, extra_allowed: &[&str]) -> Option<PathBuf> {
    let resolved = which::which(cmd).ok()?;

    // Canonicalize to resolve symlinks and normalise the path
    let canonical = std::fs::canonicalize(&resolved).unwrap_or_else(|_| resolved.clone());

    if is_path_allowed(&canonical, extra_allowed) {
        tracing::debug!(cmd, path = %canonical.display(), "CLI probe: path validated");
        Some(canonical)
    } else {
        tracing::warn!(
            cmd,
            path = %canonical.display(),
            "CLI probe: rejected — resolved path is not in an allowed directory"
        );
        None
    }
}

/// Check whether `binary_path` resides under one of the allowed directories.
fn is_path_allowed(binary_path: &Path, extra_allowed: &[&str]) -> bool {
    let path_str = binary_path.to_string_lossy();

    let static_iter = SAFE_DIRS.iter().copied().chain(extra_allowed.iter().copied());
    for dir in static_iter {
        if path_matches_dir(&path_str, dir) {
            return true;
        }
    }
    for dir in user_safe_dirs() {
        if path_matches_dir(&path_str, dir.as_str()) {
            return true;
        }
    }
    false
}

#[cfg(target_os = "windows")]
fn path_matches_dir(path_str: &str, dir: &str) -> bool {
    path_str.to_lowercase().starts_with(&dir.to_lowercase())
}

#[cfg(not(target_os = "windows"))]
fn path_matches_dir(path_str: &str, dir: &str) -> bool {
    path_str.starts_with(dir)
}

/// Read up to `limit` bytes from an `AsyncRead`, returning the buffer.
pub(crate) async fn read_limited(
    reader: &mut (impl tokio::io::AsyncRead + Unpin),
    limit: usize,
) -> std::io::Result<Vec<u8>> {
    let mut buf = Vec::with_capacity(limit.min(8192));
    reader.take(limit as u64).read_to_end(&mut buf).await?;
    Ok(buf)
}

const CLI_PROBES: &[CliProbe] = &[
    CliProbe {
        service_type: "github",
        cmd: "gh",
        args: &["auth", "status"],
        parse: parse_gh_identity,
        allowed_dirs: &[],
    },
    CliProbe {
        service_type: "aws",
        cmd: "aws",
        args: &["sts", "get-caller-identity", "--output", "text", "--query", "Arn"],
        parse: parse_aws_identity,
        allowed_dirs: &[],
    },
    CliProbe {
        service_type: "google_cloud",
        cmd: "gcloud",
        args: &["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"],
        parse: parse_simple_identity,
        // gcloud often installs to ~/google-cloud-sdk/bin or /usr/lib/google-cloud-sdk/bin
        allowed_dirs: &[],
    },
    CliProbe {
        service_type: "azure",
        cmd: "az",
        args: &["account", "show", "--query", "user.name", "-o", "tsv"],
        parse: parse_simple_identity,
        allowed_dirs: &[],
    },
    CliProbe {
        service_type: "docker",
        cmd: "docker",
        args: &["info", "--format", "{{.ID}}"],
        parse: parse_docker_identity,
        allowed_dirs: &[],
    },
    CliProbe {
        service_type: "kubernetes",
        cmd: "kubectl",
        args: &["config", "current-context"],
        parse: parse_simple_identity,
        allowed_dirs: &[],
    },
    CliProbe {
        service_type: "heroku",
        cmd: "heroku",
        args: &["auth:whoami"],
        parse: parse_simple_identity,
        allowed_dirs: &[],
    },
    CliProbe {
        service_type: "vercel",
        cmd: "vercel",
        args: &["whoami"],
        parse: parse_simple_identity,
        allowed_dirs: &[],
    },
    CliProbe {
        service_type: "netlify",
        cmd: "netlify",
        args: &["status"],
        parse: parse_netlify_identity,
        allowed_dirs: &[],
    },
];

fn parse_gh_identity(output: &str) -> Option<String> {
    // "gh auth status" outputs lines like: "Logged in to github.com account octocat"
    for line in output.lines() {
        let lower = line.to_lowercase();
        if lower.contains("logged in") {
            // Try to extract the account name
            if let Some(pos) = lower.find("account ") {
                let rest = &line[pos + 8..];
                let name = rest.split_whitespace().next().unwrap_or(rest.trim());
                return Some(format!("gh:{}", name.trim_end_matches('.')));
            }
            return Some("authenticated".into());
        }
    }
    None
}

fn parse_aws_identity(output: &str) -> Option<String> {
    let trimmed = output.trim();
    if !trimmed.is_empty() && trimmed.starts_with("arn:") {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn parse_simple_identity(output: &str) -> Option<String> {
    let trimmed = output.trim();
    if !trimmed.is_empty() {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn parse_docker_identity(output: &str) -> Option<String> {
    let trimmed = output.trim();
    if !trimmed.is_empty() {
        Some("docker-daemon".into())
    } else {
        None
    }
}

fn parse_netlify_identity(output: &str) -> Option<String> {
    for line in output.lines() {
        if line.contains("Email:") || line.contains("email:") {
            let email = line.split(':').nth(1).map(|s| s.trim().to_string());
            if email.as_deref().is_some_and(|e| !e.is_empty()) {
                return email;
            }
        }
        if line.to_lowercase().contains("logged in") {
            return Some("authenticated".into());
        }
    }
    // If we got any output without error, probably authenticated
    if !output.trim().is_empty() && !output.to_lowercase().contains("not logged in") {
        return Some("authenticated".into());
    }
    None
}

/// Run all CLI probes in parallel with a per-probe timeout.
///
/// Each probe resolves the CLI tool to an absolute path and validates it against
/// an allowlist before execution. Output is capped at [`MAX_CLI_OUTPUT_BYTES`].
async fn probe_cli_tools() -> Vec<AuthDetection> {
    // Pre-resolve all CLI paths on a blocking thread (filesystem I/O + symlink resolution).
    // This also performs the allowlist validation before any process is spawned.
    let resolved: Vec<Option<PathBuf>> = tokio::task::spawn_blocking(|| {
        CLI_PROBES
            .iter()
            .map(|probe| resolve_cli_path(probe.cmd, probe.allowed_dirs))
            .collect()
    })
    .await
    .unwrap_or_default();

    let handles: Vec<_> = CLI_PROBES
        .iter()
        .zip(resolved.into_iter())
        .map(|(probe, maybe_path)| {
            let service_type = probe.service_type.to_string();
            let args: Vec<String> = probe.args.iter().map(|a| a.to_string()).collect();
            let parse = probe.parse;

            tokio::spawn(async move {
                // Skip probes whose binary path failed validation
                let bin_path = maybe_path?;

                // Spawn child outside the timeout so we can kill it if the
                // deadline fires. Dropping a tokio::process::Child without
                // calling kill() orphans the process on both Unix and Windows.
                let mut cmd = Command::new(&bin_path);
                cmd.args(&args)
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    // Clear env to prevent credential leaks to the subprocess.
                    // Re-add only PATH (needed for child subprocesses) and
                    // HOME/USERPROFILE (needed by many CLIs for config dirs).
                    .env_clear()
                    .envs(sanitized_env());
                // Prevent empty console windows flashing on Windows.
                // tokio's Command exposes creation_flags inherently.
                #[cfg(windows)]
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                let mut child = match cmd.spawn()
                {
                    Ok(c) => c,
                    Err(_) => return None,
                };

                let result = timeout(Duration::from_secs(3), async {
                    // Read stdout and stderr with size limits
                    let mut stdout_reader = child.stdout.take()?;
                    let mut stderr_reader = child.stderr.take()?;

                    let (stdout_bytes, stderr_bytes) = tokio::join!(
                        read_limited(&mut stdout_reader, MAX_CLI_OUTPUT_BYTES),
                        read_limited(&mut stderr_reader, MAX_CLI_OUTPUT_BYTES),
                    );

                    let status = child.wait().await.ok()?;

                    let stdout_raw = stdout_bytes.unwrap_or_default();
                    let stderr_raw = stderr_bytes.unwrap_or_default();
                    let stdout = String::from_utf8_lossy(&stdout_raw);
                    let stderr = String::from_utf8_lossy(&stderr_raw);
                    let combined = format!("{}\n{}", stdout, stderr);

                    if status.success() {
                        parse(&combined)
                    } else {
                        // Some CLIs exit non-zero but still indicate auth (gh auth status)
                        parse(&combined)
                    }
                })
                .await;

                // If the timeout fired, explicitly kill the child process to
                // prevent orphaned processes from accumulating.
                if result.is_err() {
                    let _ = child.kill().await;
                }

                match result {
                    Ok(Some(identity)) => Some(AuthDetection {
                        service_type,
                        method: "cli".into(),
                        authenticated: true,
                        identity: Some(identity),
                        confidence: "high".into(),
                    }),
                    _ => None,
                }
            })
        })
        .collect();

    let mut results = Vec::new();
    for handle in handles {
        if let Ok(Some(detection)) = handle.await {
            results.push(detection);
        }
    }
    results
}

/// Build a minimal environment for CLI subprocesses.
///
/// We clear the full environment to avoid leaking secrets (e.g., API keys in
/// env vars) and only pass through variables required for the CLI tools to
/// locate their config and resolve further paths.
pub(crate) fn sanitized_env() -> Vec<(String, String)> {
    let mut env = Vec::new();

    // PATH is needed so the CLI tool itself can find its own sub-binaries
    if let Ok(path) = std::env::var("PATH") {
        env.push(("PATH".into(), path));
    }

    // HOME / USERPROFILE — most CLIs read config from the home directory
    #[cfg(target_os = "windows")]
    {
        if let Ok(v) = std::env::var("USERPROFILE") {
            env.push(("USERPROFILE".into(), v));
        }
        if let Ok(v) = std::env::var("APPDATA") {
            env.push(("APPDATA".into(), v));
        }
        if let Ok(v) = std::env::var("LOCALAPPDATA") {
            env.push(("LOCALAPPDATA".into(), v));
        }
        if let Ok(v) = std::env::var("SYSTEMROOT") {
            env.push(("SYSTEMROOT".into(), v));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(v) = std::env::var("HOME") {
            env.push(("HOME".into(), v));
        }
    }

    env
}

// -- Browser Cookie Probes ----------------------------------------------

/// Known service domain -> connector service_type mapping.
const COOKIE_DOMAIN_MAP: &[(&str, &str)] = &[
    (".github.com", "github"),
    (".google.com", "google_workspace"),
    (".slack.com", "slack"),
    (".linear.app", "linear"),
    (".notion.so", "notion"),
    (".atlassian.net", "jira"),
    (".openai.com", "openai"),
    (".anthropic.com", "anthropic"),
    (".vercel.com", "vercel"),
    (".netlify.com", "netlify"),
    (".sentry.io", "sentry"),
    (".datadog.com", "datadog"),
    (".stripe.com", "stripe"),
    (".twilio.com", "twilio"),
    (".sendgrid.com", "sendgrid"),
    (".supabase.co", "supabase"),
    (".firebase.google.com", "firebase"),
    (".heroku.com", "heroku"),
    (".gitlab.com", "gitlab"),
    (".bitbucket.org", "bitbucket"),
    (".trello.com", "trello"),
    (".airtable.com", "airtable"),
    (".figma.com", "figma"),
    (".discord.com", "discord"),
];

/// Get paths to browser cookie databases (Chrome + Edge on Windows/macOS/Linux).
fn browser_cookie_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            // Chrome
            paths.push(PathBuf::from(&local_app_data).join("Google/Chrome/User Data/Default/Network/Cookies"));
            // Edge
            paths.push(PathBuf::from(&local_app_data).join("Microsoft/Edge/User Data/Default/Network/Cookies"));
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let home = PathBuf::from(home);
            // Chrome
            paths.push(home.join("Library/Application Support/Google/Chrome/Default/Cookies"));
            // Edge
            paths.push(home.join("Library/Application Support/Microsoft Edge/Default/Cookies"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let home = PathBuf::from(home);
            // Chrome
            paths.push(home.join(".config/google-chrome/Default/Cookies"));
            // Chromium
            paths.push(home.join(".config/chromium/Default/Cookies"));
        }
    }

    paths
}

/// Read browser cookie databases and check for session cookies from known domains.
///
/// We copy the DB to a temp file to avoid locking conflicts with the running browser.
/// We only check for cookie *existence* and expiry -- no decryption needed.
fn probe_browser_cookies() -> Vec<AuthDetection> {
    let mut detected: HashMap<String, AuthDetection> = HashMap::new();

    for cookie_path in browser_cookie_paths() {
        if !cookie_path.exists() {
            continue;
        }

        // Audit log: cookie access is a sensitive operation
        tracing::info!(
            target: "audit",
            "Auth detection: probing browser cookies (read-only copy) for service session detection"
        );

        // Copy to a secure temp file (auto-deleted on drop, even on panic)
        let temp_file = match tempfile::NamedTempFile::new() {
            Ok(f) => f,
            Err(_) => continue,
        };
        let temp_path = temp_file.path().to_path_buf();

        if std::fs::copy(&cookie_path, &temp_path).is_err() {
            continue;
        }

        // Open as SQLite and query for session cookies
        if let Ok(conn) = rusqlite::Connection::open_with_flags(
            &temp_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) {
            // Query for non-expired session cookies from known domains
            // Chrome stores expiry as microseconds since 1601-01-01
            // A value of 0 means session cookie (expires when browser closes)
            // We check both session cookies (expires_utc = 0) and non-expired persistent cookies
            let now_chrome_epoch = chrome_epoch_now();

            for &(domain, service_type) in COOKIE_DOMAIN_MAP {
                if detected.contains_key(service_type) {
                    continue; // Already detected via another browser
                }

                let query = "SELECT COUNT(*) FROM cookies WHERE host_key LIKE ?1 AND (expires_utc = 0 OR expires_utc > ?2) LIMIT 1";
                let domain_pattern = format!("%{}", domain);

                match conn.query_row(query, rusqlite::params![domain_pattern, now_chrome_epoch], |row| {
                    row.get::<_, i64>(0)
                }) {
                    Ok(count) if count > 0 => {
                        detected.insert(
                            service_type.to_string(),
                            AuthDetection {
                                service_type: service_type.to_string(),
                                method: "cookie".into(),
                                authenticated: true,
                                identity: Some(format!("session cookie for {}", domain.trim_start_matches('.'))),
                                confidence: "medium".into(),
                            },
                        );
                    }
                    _ => {}
                }
            }
        }
        // temp_file is dropped here, auto-removing the temp file
    }

    detected.into_values().collect()
}

/// Chrome epoch: microseconds since 1601-01-01 00:00:00 UTC.
/// We compute the current time in this epoch for cookie expiry comparison.
fn chrome_epoch_now() -> i64 {
    // Offset between Unix epoch (1970) and Chrome epoch (1601) in microseconds
    const CHROME_EPOCH_OFFSET: i64 = 11_644_473_600_000_000;
    let unix_micros = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_micros() as i64;
    unix_micros + CHROME_EPOCH_OFFSET
}

// -- Public API ---------------------------------------------------------

/// How long cached auth detection results remain valid.
const AUTH_DETECT_CACHE_TTL: Duration = Duration::from_secs(300); // 5 minutes

/// Invalidate the auth detection cache so the next call to
/// [`detect_authenticated_services`] returns fresh results.
///
/// Call this after any event that changes authentication state (e.g. a
/// successful OAuth flow) so downstream consumers (NegotiatorPanel, etc.)
/// immediately see the updated picture.
#[allow(dead_code)]
pub async fn invalidate_auth_detect_cache(state: &AppState) {
    *state.auth_detect_cache.lock().await = None;
    tracing::debug!("Auth detection cache invalidated");
}

/// Detect all authenticated services using CLI probing and browser cookies.
///
/// Results are cached for 5 minutes to avoid re-spawning 9 CLI subprocesses
/// and copying browser cookie databases on repeated wizard calls.
#[tauri::command]
pub async fn detect_authenticated_services(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<AuthDetection>, AppError> {
    require_auth(&state).await?;

    // Return cached results if still fresh
    {
        let cache = state.auth_detect_cache.lock().await;
        if let Some((cached_at, ref results)) = *cache {
            if cached_at.elapsed() < AUTH_DETECT_CACHE_TTL {
                tracing::debug!("Returning cached auth detection results");
                return Ok(results.clone());
            }
        }
    }

    // Run CLI probes (async) and cookie probes (sync, in blocking thread) in parallel
    let (cli_results, cookie_results) = tokio::join!(
        probe_cli_tools(),
        tokio::task::spawn_blocking(probe_browser_cookies),
    );

    let mut results = cli_results;

    // Merge cookie results, preferring CLI (higher confidence)
    let cli_services: std::collections::HashSet<String> =
        results.iter().map(|r| r.service_type.clone()).collect();

    if let Ok(cookies) = cookie_results {
        for detection in cookies {
            if !cli_services.contains(&detection.service_type) {
                results.push(detection);
            }
        }
    }

    // Cache the results
    *state.auth_detect_cache.lock().await = Some((std::time::Instant::now(), results.clone()));

    Ok(results)
}
