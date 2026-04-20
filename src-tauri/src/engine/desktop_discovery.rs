//! Desktop application discovery engine.
//!
//! Detects installed desktop applications and MCP servers available on the
//! user's machine. Supports importing Claude Desktop's MCP configuration
//! as first-class connectors.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use ts_rs::TS;

use crate::error::AppError;

/// A discovered desktop application.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DiscoveredApp {
    /// Internal connector name (e.g., "desktop_vscode").
    pub connector_name: String,
    /// Display name.
    pub label: String,
    /// Whether the app binary was found on the system.
    pub installed: bool,
    /// Detected binary path (if found).
    pub binary_path: Option<String>,
    /// App version (if detectable).
    pub version: Option<String>,
    /// Whether this app is currently running.
    pub running: bool,
    /// Category for UI grouping.
    pub category: String,
}

/// An MCP server configuration imported from Claude Desktop.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ImportedMcpServer {
    /// Server name from the config key.
    pub name: String,
    /// Display label (humanized from name).
    pub label: String,
    /// Command to start the server.
    pub command: String,
    /// Command arguments.
    pub args: Vec<String>,
    /// Environment variables.
    pub env: HashMap<String, String>,
    /// Source config file path.
    pub source: String,
}

// -- App detection ---------------------------------------------------

/// Known desktop apps and their detection strategies.
struct AppDetector {
    connector_name: &'static str,
    label: &'static str,
    category: &'static str,
    /// Binary names to search in PATH.
    binaries: &'static [&'static str],
    /// Additional well-known install locations (Windows).
    #[cfg(target_os = "windows")]
    install_paths: &'static [&'static str],
}

const KNOWN_APPS: &[AppDetector] = &[
    AppDetector {
        connector_name: "desktop_docker",
        label: "Docker",
        category: "desktop",
        binaries: &["docker", "docker.exe"],
        #[cfg(target_os = "windows")]
        install_paths: &[
            r"C:\Program Files\Docker\Docker\resources\bin\docker.exe",
        ],
    },
    AppDetector {
        connector_name: "desktop_obsidian",
        label: "Obsidian",
        category: "desktop",
        binaries: &["obsidian", "obsidian.exe"],
        // Obsidian is typically NOT on PATH on Windows; it installs per-user under
        // %LOCALAPPDATA%. Both the legacy `...\Obsidian\Obsidian.exe` layout and
        // the newer `...\Programs\Obsidian\Obsidian.exe` layout are supported.
        #[cfg(target_os = "windows")]
        install_paths: &[
            r"C:\Users\*\AppData\Local\Programs\Obsidian\Obsidian.exe",
            r"C:\Users\*\AppData\Local\Obsidian\Obsidian.exe",
            r"C:\Program Files\Obsidian\Obsidian.exe",
            r"C:\Program Files (x86)\Obsidian\Obsidian.exe",
        ],
    },
    AppDetector {
        connector_name: "desktop_browser",
        label: "Browser (Chrome/Edge)",
        category: "desktop",
        binaries: &["chrome", "google-chrome", "msedge.exe", "chrome.exe"],
        #[cfg(target_os = "windows")]
        install_paths: &[
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        ],
    },
];

// -- CLI detection ---------------------------------------------------

/// Known general-purpose SaaS CLIs that can be surfaced to users as
/// connector-installation hints.
///
/// Unlike `KNOWN_APPS` (desktop GUI apps), these are command-line tools that
/// agents can shell out to directly. Detection is PATH-based only -- CLIs
/// don't have well-known install paths the way GUI apps do.
struct CliDetector {
    /// Internal connector name (e.g., "cli_gh", "cli_gcloud").
    connector_name: &'static str,
    /// Display name.
    label: &'static str,
    /// Binary names to search in PATH.
    binaries: &'static [&'static str],
    /// The connector name in `scripts/connectors/builtin/` that this CLI
    /// maps to, if any. `None` means the CLI exists but personas has no
    /// connector for it yet -- the discovery flow surfaces this as
    /// "installed, no connector".
    #[allow(dead_code)]
    suggested_connector: Option<&'static str>,
}

const KNOWN_CLIS: &[CliDetector] = &[
    CliDetector {
        connector_name: "cli_gh",
        label: "GitHub CLI",
        binaries: &["gh", "gh.exe"],
        suggested_connector: Some("github"),
    },
    CliDetector {
        connector_name: "cli_gcloud",
        label: "Google Cloud CLI",
        binaries: &["gcloud", "gcloud.cmd"],
        suggested_connector: None, // no gcloud connector yet
    },
    CliDetector {
        connector_name: "cli_stripe",
        label: "Stripe CLI",
        binaries: &["stripe", "stripe.exe"],
        suggested_connector: None, // no stripe connector yet
    },
    CliDetector {
        connector_name: "cli_linear",
        label: "Linear CLI",
        binaries: &["linear", "linear.exe"],
        suggested_connector: Some("linear"),
    },
    CliDetector {
        connector_name: "cli_supabase",
        label: "Supabase CLI",
        binaries: &["supabase", "supabase.exe"],
        suggested_connector: Some("supabase"),
    },
    CliDetector {
        connector_name: "cli_vercel",
        label: "Vercel CLI",
        binaries: &["vercel", "vercel.exe"],
        suggested_connector: Some("vercel"),
    },
    CliDetector {
        connector_name: "cli_ob",
        label: "Obsidian Headless CLI",
        binaries: &["ob"],
        suggested_connector: Some("obsidian"),
    },
];

/// Scan the system for general-purpose SaaS CLIs on $PATH.
///
/// CLIs are detected by probing `which` for each candidate binary name.
/// Unlike `discover_apps`, no process-list check is done (CLIs are not
/// long-running). Version detection runs `<bin> --version` with a 1s
/// timeout per binary when a match is found.
pub async fn discover_clis() -> Vec<DiscoveredApp> {
    let mut results = Vec::new();

    for cli in KNOWN_CLIS {
        let (installed, binary_path) = detect_cli_binary(cli);

        // Populate version by running `<bin> --version` with a 1s timeout
        // if the binary was found. Keeps discovery fast (1s cap per binary).
        let version = if let Some(ref path) = binary_path {
            get_app_version(path).await
        } else {
            None
        };

        results.push(DiscoveredApp {
            connector_name: cli.connector_name.to_string(),
            label: cli.label.to_string(),
            installed,
            binary_path,
            version,
            running: false, // CLIs aren't long-running processes
            category: "cli".to_string(),
        });
    }

    results
}

/// Probe `which` for each candidate binary name in a CLI detector.
fn detect_cli_binary(cli: &CliDetector) -> (bool, Option<String>) {
    for bin in cli.binaries {
        if let Ok(path) = which::which(bin) {
            return (true, Some(path.to_string_lossy().to_string()));
        }
    }
    (false, None)
}

/// Scan the system for known desktop applications.
pub async fn discover_apps() -> Vec<DiscoveredApp> {
    // Fetch the full process list once and check all apps against it in memory
    let running_processes = get_all_running_processes().await;

    let mut results = Vec::new();

    for app in KNOWN_APPS {
        let (installed, binary_path) = detect_binary(app);
        let running = if installed {
            is_process_in_list(app.connector_name, &running_processes)
        } else {
            false
        };

        results.push(DiscoveredApp {
            connector_name: app.connector_name.to_string(),
            label: app.label.to_string(),
            installed,
            binary_path,
            version: None,
            running,
            category: app.category.to_string(),
        });
    }

    results
}

/// Get the full process list from a single OS call.
async fn get_all_running_processes() -> std::collections::HashSet<String> {
    let mut processes = std::collections::HashSet::new();

    #[cfg(target_os = "windows")]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        let mut cmd = tokio::process::Command::new("tasklist");
        cmd.args(["/FO", "CSV", "/NH"]);
        cmd.creation_flags(0x08000000);

        if let Ok(output) = cmd.output().await {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                // CSV format: "Image Name","PID","Session Name","Session#","Mem Usage"
                if let Some(name) = line.split(',').next() {
                    let name = name.trim_matches('"').to_lowercase();
                    if !name.is_empty() {
                        processes.insert(name);
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(output) = tokio::process::Command::new("ps")
            .args(["-eo", "comm"])
            .output()
            .await
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines().skip(1) {
                let name = line.trim().to_lowercase();
                if !name.is_empty() {
                    processes.insert(name);
                }
            }
        }
    }

    processes
}

/// Check if any of a connector's known process names are in the cached process list.
fn is_process_in_list(connector_name: &str, processes: &std::collections::HashSet<String>) -> bool {
    let process_names: &[&str] = match connector_name {
        "desktop_docker" => &["docker", "docker desktop.exe", "dockerd"],
        "desktop_obsidian" => &["obsidian", "obsidian.exe"],
        "desktop_browser" => &["chrome", "chrome.exe", "msedge.exe"],
        _ => return false,
    };

    process_names.iter().any(|name| processes.contains(&name.to_lowercase()))
}

/// Check whether a desktop app is installed, by connector name.
///
/// Returns `(installed, binary_path)`.  Used by the healthcheck engine to
/// verify local-tool connectors without an HTTP endpoint.
pub fn is_desktop_app_installed(connector_name: &str) -> (bool, Option<String>) {
    match KNOWN_APPS.iter().find(|a| a.connector_name == connector_name) {
        Some(app) => detect_binary(app),
        None => (false, None),
    }
}

/// Check if a binary exists on the system.
fn detect_binary(app: &AppDetector) -> (bool, Option<String>) {
    // Check PATH first
    for bin in app.binaries {
        if let Ok(path) = which::which(bin) {
            return (true, Some(path.to_string_lossy().to_string()));
        }
    }

    // Check well-known install paths (Windows)
    #[cfg(target_os = "windows")]
    {
        for pattern in app.install_paths {
            if pattern.contains('*') {
                // Glob pattern -- try expanding
                if let Some(expanded) = expand_windows_glob(pattern) {
                    if expanded.exists() {
                        return (true, Some(expanded.to_string_lossy().to_string()));
                    }
                }
            } else {
                let path = PathBuf::from(pattern);
                if path.exists() {
                    return (true, Some(pattern.to_string()));
                }
            }
        }
    }

    (false, None)
}

/// Expand simple Windows glob patterns (only handles `*` in path segments).
#[cfg(target_os = "windows")]
fn expand_windows_glob(pattern: &str) -> Option<PathBuf> {
    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() != 2 {
        return None;
    }

    let prefix = PathBuf::from(parts[0]);
    let suffix = parts[1];

    let parent = prefix.parent()?;
    if !parent.exists() {
        return None;
    }

    let entries = std::fs::read_dir(parent).ok()?;
    for entry in entries.flatten() {
        let candidate = entry.path();
        let full = PathBuf::from(format!("{}{}", candidate.to_string_lossy(), suffix));
        if full.exists() {
            return Some(full);
        }
    }

    None
}

// -- Claude Desktop MCP config import --------------------------------

/// Claude Desktop configuration file structure.
#[derive(Debug, Deserialize)]
struct ClaudeDesktopConfig {
    #[serde(rename = "mcpServers", default)]
    mcp_servers: HashMap<String, ClaudeMcpServerEntry>,
}

#[derive(Debug, Deserialize)]
struct ClaudeMcpServerEntry {
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: HashMap<String, String>,
}

/// Find and read Claude Desktop's MCP configuration.
pub async fn import_claude_desktop_mcp_servers() -> Result<Vec<ImportedMcpServer>, AppError> {
    let config_paths = get_claude_config_paths();

    for config_path in &config_paths {
        if config_path.exists() {
            let content = tokio::fs::read_to_string(config_path)
                .await
                .map_err(|e| AppError::Internal(format!(
                    "Failed to read Claude Desktop config at {}: {e}",
                    config_path.display()
                )))?;

            let config: ClaudeDesktopConfig = serde_json::from_str(&content)
                .map_err(|e| AppError::Internal(format!(
                    "Failed to parse Claude Desktop config: {e}"
                )))?;

            let servers: Vec<ImportedMcpServer> = config
                .mcp_servers
                .into_iter()
                .map(|(name, entry)| {
                    let full_command = if entry.args.is_empty() {
                        entry.command.clone()
                    } else {
                        format!("{} {}", entry.command, entry.args.join(" "))
                    };

                    ImportedMcpServer {
                        label: humanize_mcp_name(&name),
                        name,
                        command: full_command,
                        args: entry.args,
                        env: entry.env,
                        source: config_path.to_string_lossy().to_string(),
                    }
                })
                .collect();

            tracing::info!(
                count = servers.len(),
                config = %config_path.display(),
                "Imported MCP servers from Claude Desktop config"
            );

            return Ok(servers);
        }
    }

    Ok(vec![]) // No config found -- not an error
}

/// Get possible Claude Desktop config file locations.
fn get_claude_config_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            paths.push(PathBuf::from(&appdata).join("Claude").join("claude_desktop_config.json"));
        }
        if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
            paths.push(PathBuf::from(&localappdata).join("Claude").join("claude_desktop_config.json"));
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            paths.push(PathBuf::from(&home)
                .join("Library/Application Support/Claude/claude_desktop_config.json"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(config) = std::env::var("XDG_CONFIG_HOME") {
            paths.push(PathBuf::from(&config).join("claude/claude_desktop_config.json"));
        }
        if let Ok(home) = std::env::var("HOME") {
            paths.push(PathBuf::from(&home).join(".config/claude/claude_desktop_config.json"));
        }
    }

    paths
}

/// Turn an MCP server name into a human-readable label.
fn humanize_mcp_name(name: &str) -> String {
    name.replace(['-', '_'], " ")
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => {
                    let mut s = first.to_uppercase().to_string();
                    s.extend(chars);
                    s
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `discover_clis()` MUST return one entry per `KNOWN_CLIS` manifest
    /// entry in order, so the frontend can rely on stable shape.
    #[tokio::test]
    async fn test_discover_clis_returns_full_manifest() {
        let results = discover_clis().await;
        assert_eq!(
            results.len(),
            KNOWN_CLIS.len(),
            "discover_clis() must return one entry per KNOWN_CLIS"
        );

        // Verify each entry has the expected connector_name and label.
        for (idx, cli) in KNOWN_CLIS.iter().enumerate() {
            assert_eq!(results[idx].connector_name, cli.connector_name);
            assert_eq!(results[idx].label, cli.label);
            assert_eq!(results[idx].category, "cli");
            // CLIs should never be reported as running -- they aren't
            // long-lived processes.
            assert!(!results[idx].running);
            // Uninstalled CLIs must have no version.
            if !results[idx].installed {
                assert!(results[idx].version.is_none());
            }
        }
    }

    /// A CliDetector whose binaries do not exist anywhere on PATH must
    /// produce `installed: false` with no `binary_path`.
    #[test]
    fn test_detect_cli_binary_missing_returns_false() {
        let cli = CliDetector {
            connector_name: "cli_nope",
            label: "Nonexistent",
            binaries: &["__definitely_not_a_real_binary_name_12345__"],
            suggested_connector: None,
        };
        let (found, path) = detect_cli_binary(&cli);
        assert!(!found);
        assert!(path.is_none());
    }

    /// The manifest must list the 7 CLIs the handoff called out as the
    /// initial seed. This locks the contract so future edits don't
    /// accidentally drop an entry.
    #[test]
    fn test_known_clis_manifest_shape() {
        let names: Vec<&str> = KNOWN_CLIS.iter().map(|c| c.connector_name).collect();
        for expected in &[
            "cli_gh",
            "cli_gcloud",
            "cli_stripe",
            "cli_linear",
            "cli_supabase",
            "cli_vercel",
            "cli_ob",
        ] {
            assert!(
                names.contains(expected),
                "KNOWN_CLIS missing expected entry: {expected}"
            );
        }
    }
}

/// Get the app version by running the binary with --version (1s timeout).
pub async fn get_app_version(binary_path: &str) -> Option<String> {
    let mut cmd = tokio::process::Command::new(binary_path);
    cmd.arg("--version");

    #[cfg(target_os = "windows")]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        cmd.output(),
    )
    .await
    .ok()?  // timeout
    .ok()?; // IO error

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        // Take first line, trim common prefixes
        let version = stdout
            .lines()
            .next()?
            .trim()
            .to_string();
        Some(version)
    } else {
        None
    }
}
