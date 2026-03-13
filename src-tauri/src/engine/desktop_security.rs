//! Desktop connector security framework.
//!
//! Provides a capability-based permission model for desktop app connectors.
//! Each connector declares required capabilities (file read, file write,
//! process spawn, network, etc.) and users must explicitly approve them
//! before the connector can operate.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::RwLock;
use ts_rs::TS;

use crate::db::DbPool;
use crate::error::AppError;

// -- Capability declarations ------------------------------------------

/// Granular capabilities a desktop connector can request.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum DesktopCapability {
    /// Read files within specified paths.
    FileRead,
    /// Write/create files within specified paths.
    FileWrite,
    /// Spawn child processes (specific binaries only).
    ProcessSpawn,
    /// Make outbound network requests (localhost only for desktop bridges).
    NetworkLocal,
    /// Access system clipboard.
    ClipboardRead,
    /// Send desktop notifications.
    Notify,
    /// Read environment variables.
    EnvRead,
    /// Access OS-level app APIs (COM, AppleScript, D-Bus).
    SystemApi,
}

impl DesktopCapability {
    /// Human-readable description for the approval UI.
    pub fn description(&self) -> &'static str {
        match self {
            Self::FileRead => "Read files from your filesystem",
            Self::FileWrite => "Create or modify files on your filesystem",
            Self::ProcessSpawn => "Launch desktop applications",
            Self::NetworkLocal => "Connect to services running on your machine",
            Self::ClipboardRead => "Read your clipboard contents",
            Self::Notify => "Send desktop notifications",
            Self::EnvRead => "Read environment variables",
            Self::SystemApi => "Use operating system APIs to control applications",
        }
    }

    /// Risk level for UI display.
    pub fn risk_level(&self) -> &'static str {
        match self {
            Self::FileRead | Self::EnvRead | Self::Notify => "low",
            Self::NetworkLocal | Self::ClipboardRead => "medium",
            Self::FileWrite | Self::ProcessSpawn | Self::SystemApi => "high",
        }
    }
}

// -- Connector manifest ----------------------------------------------

/// Security manifest declaring what a desktop connector needs.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DesktopConnectorManifest {
    /// Connector identifier (e.g., "desktop_vscode").
    pub connector_id: String,
    /// Required capabilities.
    pub capabilities: Vec<DesktopCapability>,
    /// Allowed binary paths this connector may spawn.
    /// Empty means no process spawning allowed.
    pub allowed_binaries: Vec<String>,
    /// Allowed file path prefixes for read/write.
    ///
    /// **Lifecycle**: Built-in manifests (see `get_manifest()`) declare this as
    /// empty.  The caller (typically the connector setup UI or workspace
    /// configuration flow) is responsible for populating `allowed_paths`
    /// *before* the connector performs any file operations.  For example,
    /// the VS Code connector receives the workspace root from the user and
    /// appends it here; the Obsidian connector uses the vault path.
    ///
    /// **Security invariant**: empty `allowed_paths` = *all* file operations
    /// denied (safe default).  If a connector attempts file I/O while this
    /// list is empty, `is_path_allowed()` returns `false`.
    pub allowed_paths: Vec<String>,
    /// Allowed localhost ports for network access.
    pub allowed_ports: Vec<u16>,
    /// Human-readable reason for each capability.
    pub justifications: HashMap<String, String>,
}

impl DesktopConnectorManifest {
    /// Validate that a binary path is in the allowlist.
    ///
    /// Uses filesystem canonicalization when available to resolve symlinks,
    /// NTFS junctions, and 8.3 short names before comparison.
    pub fn is_binary_allowed(&self, binary: &str) -> bool {
        if self.allowed_binaries.is_empty() {
            return false;
        }

        // Try canonical form first (resolves symlinks, junctions, 8.3 names).
        let canonical = std::path::Path::new(binary)
            .canonicalize()
            .map(|p| p.to_string_lossy().replace('\\', "/").to_lowercase());
        let normalized = binary.replace('\\', "/").to_lowercase();

        self.allowed_binaries
            .iter()
            .any(|allowed| {
                let norm_allowed = allowed.replace('\\', "/").to_lowercase();
                let canon_allowed = std::path::Path::new(allowed)
                    .canonicalize()
                    .map(|p| p.to_string_lossy().replace('\\', "/").to_lowercase());

                // Prefer canonical comparison when both sides resolve.
                if let (Ok(ref cb), Ok(ref ca)) = (&canonical, &canon_allowed) {
                    return *cb == *ca || cb.ends_with(&format!("/{ca}"));
                }

                // Fall back to normalized string matching (bare binary names
                // like "docker" won't have a canonical path).
                normalized == norm_allowed || normalized.ends_with(&format!("/{norm_allowed}"))
            })
    }

    /// Validate that a file path is within allowed prefixes.
    ///
    /// Returns `false` (deny) when `allowed_paths` is empty -- see the
    /// `allowed_paths` field documentation for the population lifecycle.
    ///
    /// Security: resolves symlinks, NTFS junctions, 8.3 short names, and
    /// alternate data streams before comparing.  For new files that don't
    /// exist yet, the *parent* directory is canonicalized to prevent
    /// symlink-in-parent attacks.
    pub fn is_path_allowed(&self, path: &str) -> bool {
        if self.allowed_paths.is_empty() {
            tracing::warn!(
                connector_id = %self.connector_id,
                requested_path = %path,
                "File access denied: allowed_paths is empty (not yet populated by workspace config)"
            );
            return false;
        }

        // Reject paths containing traversal segments before any prefix check.
        // This prevents escapes like "/allowed/../etc/passwd".
        let normalized = path.replace('\\', "/").to_lowercase();
        if normalized.split('/').any(|seg| seg == "..") {
            tracing::warn!(
                connector_id = %self.connector_id,
                requested_path = %path,
                "File access denied: path contains '..' traversal segments"
            );
            return false;
        }

        // Reject NTFS alternate data streams (e.g., "file.txt:hidden").
        // A colon after the drive letter prefix (like "C:") indicates an ADS.
        if has_ntfs_ads(&normalized) {
            tracing::warn!(
                connector_id = %self.connector_id,
                requested_path = %path,
                "File access denied: path contains NTFS alternate data stream"
            );
            return false;
        }

        // Resolve the real filesystem path.  If the file already exists,
        // canonicalize resolves symlinks, junctions, and 8.3 short names.
        // If the file doesn't exist yet, canonicalize the parent directory
        // (which must exist for any write to succeed) and append the filename.
        let p = std::path::Path::new(path);
        let check_path = match p.canonicalize() {
            Ok(canon) => canon.to_string_lossy().replace('\\', "/").to_lowercase(),
            Err(_) => {
                // File doesn't exist -- canonicalize parent to block
                // symlink-in-parent attacks, then append the filename.
                if let (Some(parent), Some(file_name)) = (p.parent(), p.file_name()) {
                    match parent.canonicalize() {
                        Ok(canon_parent) => {
                            let mut full = canon_parent
                                .to_string_lossy()
                                .replace('\\', "/")
                                .to_lowercase();
                            full.push('/');
                            full.push_str(&file_name.to_string_lossy().to_lowercase());
                            full
                        }
                        // Parent also doesn't exist -- deny.
                        Err(_) => {
                            tracing::warn!(
                                connector_id = %self.connector_id,
                                requested_path = %path,
                                "File access denied: cannot resolve parent directory"
                            );
                            return false;
                        }
                    }
                } else {
                    return false;
                }
            }
        };

        self.allowed_paths
            .iter()
            .any(|prefix| {
                // Canonicalize the prefix too so that both sides use
                // the same real-path representation.
                let canon_prefix = std::path::Path::new(prefix)
                    .canonicalize()
                    .map(|cp| cp.to_string_lossy().replace('\\', "/").to_lowercase())
                    .unwrap_or_else(|_| prefix.replace('\\', "/").to_lowercase());

                check_path.starts_with(&canon_prefix)
            })
    }

    /// Validate that a port is in the allowlist.
    pub fn is_port_allowed(&self, port: u16) -> bool {
        self.allowed_ports.contains(&port)
    }
}

// -- Approval store --------------------------------------------------

/// Tracks user approvals for desktop connector capabilities.
/// Persisted to the database; cached in memory for fast checks.
#[derive(Debug)]
pub struct DesktopApprovalStore {
    /// connector_id -> set of approved capabilities
    approved: RwLock<HashMap<String, HashSet<DesktopCapability>>>,
}

impl DesktopApprovalStore {
    pub fn new() -> Self {
        Self {
            approved: RwLock::new(HashMap::new()),
        }
    }

    /// Load approvals from the database.
    pub fn load_from_db(&self, pool: &DbPool) -> Result<(), AppError> {
        let conn = pool.get().map_err(|e| AppError::Internal(e.to_string()))?;

        // Create table if not exists
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS desktop_connector_approvals (
                connector_id TEXT NOT NULL,
                capability TEXT NOT NULL,
                approved_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (connector_id, capability)
            );"
        ).map_err(|e| AppError::Internal(format!("Failed to create approvals table: {e}")))?;

        let mut stmt = conn
            .prepare("SELECT connector_id, capability FROM desktop_connector_approvals")
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let rows = stmt
            .query_map([], |row| {
                let connector_id: String = row.get(0)?;
                let capability_str: String = row.get(1)?;
                Ok((connector_id, capability_str))
            })
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let mut map = HashMap::new();
        for row in rows {
            let (connector_id, cap_str) = row.map_err(|e| AppError::Internal(e.to_string()))?;
            if let Ok(cap) = serde_json::from_str::<DesktopCapability>(&format!("\"{cap_str}\"")) {
                map.entry(connector_id)
                    .or_insert_with(HashSet::new)
                    .insert(cap);
            }
        }

        *self.approved.write().unwrap() = map;
        Ok(())
    }

    /// Check if all required capabilities for a connector are approved.
    pub fn is_fully_approved(&self, manifest: &DesktopConnectorManifest) -> bool {
        let guard = self.approved.read().unwrap();
        if let Some(approved_caps) = guard.get(&manifest.connector_id) {
            manifest.capabilities.iter().all(|c| approved_caps.contains(c))
        } else {
            false
        }
    }

    /// Get unapproved capabilities for a connector.
    pub fn pending_capabilities(
        &self,
        manifest: &DesktopConnectorManifest,
    ) -> Vec<DesktopCapability> {
        let guard = self.approved.read().unwrap();
        let approved_caps = guard.get(&manifest.connector_id);
        manifest
            .capabilities
            .iter()
            .filter(|c| {
                approved_caps.map_or(true, |set| !set.contains(c))
            })
            .cloned()
            .collect()
    }

    /// Grant approval for specific capabilities.
    pub fn approve(
        &self,
        pool: &DbPool,
        connector_id: &str,
        capabilities: &[DesktopCapability],
    ) -> Result<(), AppError> {
        let conn = pool.get().map_err(|e| AppError::Internal(e.to_string()))?;

        for cap in capabilities {
            let cap_str = serde_json::to_string(cap)
                .map_err(|e| AppError::Internal(e.to_string()))?
                .trim_matches('"')
                .to_string();

            conn.execute(
                "INSERT OR IGNORE INTO desktop_connector_approvals (connector_id, capability) VALUES (?1, ?2)",
                rusqlite::params![connector_id, cap_str],
            )
            .map_err(|e| AppError::Internal(format!("Failed to save approval: {e}")))?;
        }

        // Update in-memory cache
        let mut guard = self.approved.write().unwrap();
        let entry = guard.entry(connector_id.to_string()).or_default();
        for cap in capabilities {
            entry.insert(cap.clone());
        }

        tracing::info!(
            connector_id,
            capabilities = ?capabilities,
            "Desktop connector capabilities approved"
        );

        Ok(())
    }

    /// Revoke all approvals for a connector.
    pub fn revoke(
        &self,
        pool: &DbPool,
        connector_id: &str,
    ) -> Result<(), AppError> {
        let conn = pool.get().map_err(|e| AppError::Internal(e.to_string()))?;

        conn.execute(
            "DELETE FROM desktop_connector_approvals WHERE connector_id = ?1",
            rusqlite::params![connector_id],
        )
        .map_err(|e| AppError::Internal(format!("Failed to revoke approvals: {e}")))?;

        self.approved.write().unwrap().remove(connector_id);

        tracing::info!(connector_id, "Desktop connector approvals revoked");
        Ok(())
    }
}

// -- Helpers ---------------------------------------------------------

/// Detect NTFS alternate data streams in a forward-slash-normalised,
/// lowercased path.  A colon is legal only as part of the drive letter
/// prefix (e.g. `c:/`).  Any subsequent colon (e.g. `c:/dir/file.txt:ads`)
/// indicates an alternate data stream.
fn has_ntfs_ads(normalized: &str) -> bool {
    // Strip the optional drive-letter prefix ("x:").
    let after_drive = if normalized.len() >= 2
        && normalized.as_bytes()[0].is_ascii_alphabetic()
        && normalized.as_bytes()[1] == b':'
    {
        &normalized[2..]
    } else {
        normalized
    };
    after_drive.contains(':')
}

// -- Built-in manifests ----------------------------------------------

/// Get the security manifest for a known desktop connector.
pub fn get_manifest(connector_name: &str) -> Option<DesktopConnectorManifest> {
    match connector_name {
        "desktop_vscode" => Some(DesktopConnectorManifest {
            connector_id: "desktop_vscode".into(),
            capabilities: vec![
                DesktopCapability::ProcessSpawn,
                DesktopCapability::FileRead,
                DesktopCapability::NetworkLocal,
            ],
            allowed_binaries: vec![
                "code".into(), "code.cmd".into(), "code.exe".into(),
                "code-insiders".into(), "code-insiders.cmd".into(),
            ],
            allowed_paths: vec![], // see allowed_paths field docs for population lifecycle
            allowed_ports: vec![],
            justifications: HashMap::from([
                ("process_spawn".into(), "Launch VS Code CLI to open files, run tasks, and manage extensions".into()),
                ("file_read".into(), "Read project files for context and analysis".into()),
                ("network_local".into(), "Connect to VS Code's extension host API".into()),
            ]),
        }),

        "desktop_docker" => Some(DesktopConnectorManifest {
            connector_id: "desktop_docker".into(),
            capabilities: vec![
                DesktopCapability::ProcessSpawn,
                DesktopCapability::NetworkLocal,
            ],
            allowed_binaries: vec![
                "docker".into(), "docker.exe".into(),
                "docker-compose".into(), "docker-compose.exe".into(),
            ],
            allowed_paths: vec![],
            allowed_ports: vec![2375, 2376], // Docker API
            justifications: HashMap::from([
                ("process_spawn".into(), "Run Docker CLI commands to manage containers".into()),
                ("network_local".into(), "Connect to Docker Engine API".into()),
            ]),
        }),

        "desktop_terminal" => Some(DesktopConnectorManifest {
            connector_id: "desktop_terminal".into(),
            capabilities: vec![
                DesktopCapability::ProcessSpawn,
                DesktopCapability::FileRead,
                DesktopCapability::FileWrite,
                DesktopCapability::EnvRead,
            ],
            allowed_binaries: vec![
                "bash".into(), "sh".into(), "zsh".into(),
                "powershell.exe".into(), "pwsh.exe".into(), "cmd.exe".into(),
            ],
            allowed_paths: vec![], // see allowed_paths field docs for population lifecycle
            allowed_ports: vec![],
            justifications: HashMap::from([
                ("process_spawn".into(), "Execute shell commands".into()),
                ("file_read".into(), "Read command output and scripts".into()),
                ("file_write".into(), "Write script files for execution".into()),
                ("env_read".into(), "Access environment for PATH and tool detection".into()),
            ]),
        }),

        "desktop_obsidian" => Some(DesktopConnectorManifest {
            connector_id: "desktop_obsidian".into(),
            capabilities: vec![
                DesktopCapability::FileRead,
                DesktopCapability::FileWrite,
                DesktopCapability::NetworkLocal,
            ],
            allowed_binaries: vec![],
            allowed_paths: vec![], // see allowed_paths field docs for population lifecycle
            allowed_ports: vec![27123, 27124], // Obsidian Local REST API plugin
            justifications: HashMap::from([
                ("file_read".into(), "Read notes from your Obsidian vault".into()),
                ("file_write".into(), "Create and update notes in your vault".into()),
                ("network_local".into(), "Connect to Obsidian's Local REST API plugin".into()),
            ]),
        }),

        "desktop_browser" => Some(DesktopConnectorManifest {
            connector_id: "desktop_browser".into(),
            capabilities: vec![
                DesktopCapability::ProcessSpawn,
                DesktopCapability::NetworkLocal,
            ],
            allowed_binaries: vec![
                "chrome".into(), "chrome.exe".into(), "google-chrome".into(),
                "msedge.exe".into(), "firefox".into(), "firefox.exe".into(),
            ],
            allowed_paths: vec![],
            allowed_ports: vec![9222, 9229], // Chrome DevTools Protocol
            justifications: HashMap::from([
                ("process_spawn".into(), "Launch browser with debugging enabled".into()),
                ("network_local".into(), "Connect to browser DevTools Protocol for automation".into()),
            ]),
        }),

        _ => None,
    }
}

/// Validate that a desktop connector action is permitted.
pub fn check_permission(
    store: &DesktopApprovalStore,
    connector_name: &str,
    capability: &DesktopCapability,
) -> Result<(), AppError> {
    let manifest = get_manifest(connector_name).ok_or_else(|| {
        AppError::Validation(format!("Unknown desktop connector: {connector_name}"))
    })?;

    if !manifest.capabilities.contains(capability) {
        return Err(AppError::Validation(format!(
            "Desktop connector '{connector_name}' does not declare capability '{}'",
            serde_json::to_string(capability).unwrap_or_default()
        )));
    }

    let guard = store.approved.read().unwrap();
    let is_approved = guard
        .get(&manifest.connector_id)
        .is_some_and(|set| set.contains(capability));

    if !is_approved {
        return Err(AppError::Forbidden(format!(
            "Desktop connector '{connector_name}' requires approval for: {}",
            capability.description()
        )));
    }

    Ok(())
}
