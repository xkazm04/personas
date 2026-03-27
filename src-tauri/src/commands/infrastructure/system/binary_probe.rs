use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Cached result of a CLI binary probe (version check or path existence).
#[derive(Debug, Clone)]
pub struct BinaryProbeResult {
    pub exists_in_path: bool,
    pub version: Option<String>,
}

/// TTL-based cache for CLI binary probe results.
///
/// Avoids redundant `where`/`which` and `--version` process spawns when
/// multiple call sites (health check, BYOM connection test) probe the same
/// binaries within a short window.
pub struct BinaryProbeCache {
    entries: Mutex<HashMap<String, (Instant, BinaryProbeResult)>>,
    ttl: Duration,
}

impl BinaryProbeCache {
    pub fn new(ttl: Duration) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            ttl,
        }
    }

    /// Get a cached probe result for `command`, or run the probe and cache it.
    pub fn get_or_probe(&self, command: &str) -> BinaryProbeResult {
        let mut map = self.entries.lock().unwrap_or_else(|e| e.into_inner());

        if let Some((ts, result)) = map.get(command) {
            if ts.elapsed() < self.ttl {
                return result.clone();
            }
        }

        // Cache miss or expired — run the actual probe
        let exists = command_exists_in_path(command);
        let version = command_version(command).ok();
        let result = BinaryProbeResult {
            exists_in_path: exists,
            version,
        };
        map.insert(command.to_string(), (Instant::now(), result.clone()));
        result
    }
}

pub(crate) fn command_exists_in_path(command: &str) -> bool {
    let probe = if cfg!(target_os = "windows") {
        std::process::Command::new("where").arg(command).output()
    } else {
        std::process::Command::new("which").arg(command).output()
    };

    matches!(probe, Ok(output) if output.status.success())
}

pub(crate) fn command_version(command: &str) -> Result<String, String> {
    match std::process::Command::new(command)
        .arg("--version")
        .output()
    {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // Find the first line that looks like a version (contains a digit).
            // CLI tools sometimes emit non-version output (e.g. update-check
            // warnings) before or instead of the actual version string.
            let version = stdout
                .lines()
                .find(|line| line.chars().any(|c| c.is_ascii_digit()))
                .unwrap_or("unknown")
                .trim()
                .to_string();
            Ok(version)
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if stderr.is_empty() {
                Err("Command failed with no error output".into())
            } else {
                Err(stderr)
            }
        }
        Err(e) => Err(e.to_string()),
    }
}
