//! Detect authenticated services via CLI probing and browser cookie inspection.
//!
//! Returns a list of services the user is currently authenticated to, enabling
//! the AI Setup wizard to pre-select connectors for batch provisioning.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use tokio::process::Command;
use tokio::time::timeout;

use std::sync::Arc;
use tauri::State;

use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

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
    /// Command to run.
    cmd: &'static str,
    /// Arguments.
    args: &'static [&'static str],
    /// Function to parse output and extract identity.
    parse: fn(&str) -> Option<String>,
}

const CLI_PROBES: &[CliProbe] = &[
    CliProbe {
        service_type: "github",
        cmd: "gh",
        args: &["auth", "status"],
        parse: parse_gh_identity,
    },
    CliProbe {
        service_type: "aws",
        cmd: "aws",
        args: &["sts", "get-caller-identity", "--output", "text", "--query", "Arn"],
        parse: parse_aws_identity,
    },
    CliProbe {
        service_type: "google_cloud",
        cmd: "gcloud",
        args: &["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"],
        parse: parse_simple_identity,
    },
    CliProbe {
        service_type: "azure",
        cmd: "az",
        args: &["account", "show", "--query", "user.name", "-o", "tsv"],
        parse: parse_simple_identity,
    },
    CliProbe {
        service_type: "docker",
        cmd: "docker",
        args: &["info", "--format", "{{.ID}}"],
        parse: parse_docker_identity,
    },
    CliProbe {
        service_type: "kubernetes",
        cmd: "kubectl",
        args: &["config", "current-context"],
        parse: parse_simple_identity,
    },
    CliProbe {
        service_type: "heroku",
        cmd: "heroku",
        args: &["auth:whoami"],
        parse: parse_simple_identity,
    },
    CliProbe {
        service_type: "vercel",
        cmd: "vercel",
        args: &["whoami"],
        parse: parse_simple_identity,
    },
    CliProbe {
        service_type: "netlify",
        cmd: "netlify",
        args: &["status"],
        parse: parse_netlify_identity,
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
async fn probe_cli_tools() -> Vec<AuthDetection> {
    let handles: Vec<_> = CLI_PROBES
        .iter()
        .map(|probe| {
            let service_type = probe.service_type.to_string();
            let cmd = probe.cmd.to_string();
            let args: Vec<String> = probe.args.iter().map(|a| a.to_string()).collect();
            let parse = probe.parse;

            tokio::spawn(async move {
                let result = timeout(Duration::from_secs(3), async {
                    let output = Command::new(&cmd)
                        .args(&args)
                        .stdout(std::process::Stdio::piped())
                        .stderr(std::process::Stdio::piped())
                        .spawn()
                        .ok()?
                        .wait_with_output()
                        .await
                        .ok()?;

                    // Some CLIs (like gh) write to stderr on success
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    let combined = format!("{}\n{}", stdout, stderr);

                    if output.status.success() {
                        parse(&combined)
                    } else {
                        // Some CLIs exit non-zero but still indicate auth (gh auth status)
                        parse(&combined)
                    }
                })
                .await;

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
