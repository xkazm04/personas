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
        connector_name: "desktop_vscode",
        label: "VS Code",
        category: "desktop",
        binaries: &["code", "code.cmd", "code-insiders", "code-insiders.cmd"],
        #[cfg(target_os = "windows")]
        install_paths: &[
            r"C:\Program Files\Microsoft VS Code\bin\code.cmd",
            r"C:\Users\*\AppData\Local\Programs\Microsoft VS Code\bin\code.cmd",
        ],
    },
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
        connector_name: "desktop_terminal",
        label: "Terminal",
        category: "desktop",
        binaries: &["bash", "powershell.exe", "pwsh.exe", "pwsh", "zsh"],
        #[cfg(target_os = "windows")]
        install_paths: &[
            r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
        ],
    },
    AppDetector {
        connector_name: "desktop_obsidian",
        label: "Obsidian",
        category: "desktop",
        binaries: &["obsidian", "obsidian.exe"],
        #[cfg(target_os = "windows")]
        install_paths: &[
            r"C:\Users\*\AppData\Local\Obsidian\Obsidian.exe",
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
        "desktop_vscode" => &["code", "code.exe"],
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

/// Check if a process is currently running.
async fn is_process_running(connector_name: &str) -> bool {
    let process_names: &[&str] = match connector_name {
        "desktop_vscode" => &["code", "Code.exe", "code.exe"],
        "desktop_docker" => &["docker", "Docker Desktop.exe", "dockerd"],
        "desktop_obsidian" => &["obsidian", "Obsidian.exe"],
        "desktop_browser" => &["chrome", "chrome.exe", "msedge.exe"],
        _ => return false,
    };

    #[cfg(target_os = "windows")]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        // Use tasklist -- minimal overhead
        for name in process_names {
            let mut cmd = tokio::process::Command::new("tasklist");
            cmd.args(["/FI", &format!("IMAGENAME eq {name}"), "/NH"]);
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

            let output = cmd.output().await;

            if let Ok(out) = output {
                let stdout = String::from_utf8_lossy(&out.stdout);
                if stdout.contains(name) {
                    return true;
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        for name in process_names {
            let output = tokio::process::Command::new("pgrep")
                .args(["-x", name])
                .output()
                .await;

            if let Ok(out) = output {
                if out.status.success() {
                    return true;
                }
            }
        }
    }

    false
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

/// Get the app version by running the binary with --version.
#[allow(dead_code)]
pub async fn get_app_version(binary_path: &str) -> Option<String> {
    let mut cmd = tokio::process::Command::new(binary_path);
    cmd.arg("--version");

    #[cfg(target_os = "windows")]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = cmd.output().await.ok()?;

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
