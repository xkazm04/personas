//! Path safety checks for file watcher triggers.
//!
//! Validates that watch paths don't target sensitive system directories,
//! the app's own data directory, or locations outside the user's home tree.
//! Defence-in-depth against malicious persona templates that could leak
//! file names and change patterns from sensitive directories.


/// Sensitive directory prefixes that must never be watched (normalised to forward slashes, lowercase).
/// Covers Windows and Unix system directories.
const BLOCKED_PREFIXES_UNIX: &[&str] = &[
    "/etc",
    "/var",
    "/usr",
    "/bin",
    "/sbin",
    "/boot",
    "/proc",
    "/sys",
    "/dev",
    "/lib",
    "/lib64",
    "/root",
    "/run",
    "/snap",
];

const BLOCKED_PREFIXES_WINDOWS: &[&str] = &[
    "c:/windows",
    "c:/program files",
    "c:/program files (x86)",
    "c:/programdata",
    "c:/recovery",
    "c:/$recycle.bin",
];

/// Validate a single watch path.
///
/// Returns `Ok(())` if the path is safe to watch, or `Err(reason)` if it
/// targets a sensitive or disallowed location.
#[allow(dead_code)]
pub fn validate_watch_path(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Watch path cannot be empty".into());
    }

    // Canonicalize separators and case for comparison
    let normalised = trimmed.replace('\\', "/").to_lowercase();

    // Reject paths with traversal components
    if normalised.contains("/../") || normalised.ends_with("/..") || normalised == ".." {
        return Err(format!("Path traversal not allowed: {trimmed}"));
    }

    // Block Unix system directories
    for prefix in BLOCKED_PREFIXES_UNIX {
        if normalised == *prefix || normalised.starts_with(&format!("{prefix}/")) {
            return Err(format!(
                "Watching system directory is not allowed: {trimmed}"
            ));
        }
    }

    // Block Windows system directories
    for prefix in BLOCKED_PREFIXES_WINDOWS {
        if normalised == *prefix || normalised.starts_with(&format!("{prefix}/")) {
            return Err(format!(
                "Watching system directory is not allowed: {trimmed}"
            ));
        }
    }

    // Block the app data directory (contains SQLite DB, config, etc.)
    if let Some(app_data) = app_data_dir_normalised() {
        if normalised == app_data || normalised.starts_with(&format!("{app_data}/")) {
            return Err(format!(
                "Watching the application data directory is not allowed: {trimmed}"
            ));
        }
    }

    // Ensure path is under user home (allowlist default)
    if !is_under_user_home(&normalised) {
        return Err(format!(
            "Watch path must be under your home directory: {trimmed}"
        ));
    }

    Ok(())
}

/// Validate all watch paths extracted from a trigger config JSON string.
/// Returns the first error encountered, if any.
#[allow(dead_code)]
pub fn validate_file_watcher_paths(trigger_type: &str, config: Option<&str>) -> Result<(), String> {
    if trigger_type != "file_watcher" {
        return Ok(());
    }
    let paths = config
        .and_then(|c| serde_json::from_str::<serde_json::Value>(c).ok())
        .and_then(|v| {
            v.get("watch_paths")?.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|s| s.as_str().map(String::from))
                    .collect::<Vec<_>>()
            })
        })
        .unwrap_or_default();

    for p in &paths {
        validate_watch_path(p)?;
    }
    Ok(())
}

/// Get the normalised app data directory path, if determinable.
fn app_data_dir_normalised() -> Option<String> {
    // Tauri app data: %APPDATA%/com.personas.desktop (Win) or
    // ~/.local/share/com.personas.desktop (Linux) or
    // ~/Library/Application Support/com.personas.desktop (macOS)
    let base = dirs::data_dir()?;
    let app_dir = base.join("com.personas.desktop");
    Some(
        app_dir
            .to_string_lossy()
            .replace('\\', "/")
            .to_lowercase(),
    )
}

/// Check whether a normalised path is under the current user's home directory.
fn is_under_user_home(normalised: &str) -> bool {
    if let Some(home) = dirs::home_dir() {
        let home_norm = home.to_string_lossy().replace('\\', "/").to_lowercase();
        normalised == home_norm || normalised.starts_with(&format!("{home_norm}/"))
    } else {
        // If we can't determine home, allow the path (fail-open for usability;
        // the blocked-prefix checks above still apply).
        true
    }
}

// -- Save-path validation (export / seal commands) -----------------------

/// Allowed file extensions for save operations.
#[allow(dead_code)]
const ALLOWED_SAVE_EXTENSIONS: &[&str] = &["persona", "enclave"];

/// Validate a save path for write operations (bundle export, enclave seal).
///
/// Ensures:
/// 1. Path is not empty
/// 2. No `..` traversal components after canonicalisation
/// 3. Resolved path is under the user's home directory
/// 4. Not targeting system directories or the app data directory
/// 5. No symlink escapes — the parent directory must already exist and
///    its canonical form must also be within the allowed sandbox
/// 6. File extension is one of the expected types
#[allow(dead_code)]
pub fn validate_save_path(path: &str) -> Result<std::path::PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Save path cannot be empty".into());
    }

    let raw = std::path::Path::new(trimmed);

    // Reject paths with traversal components in the raw input
    let normalised = trimmed.replace('\\', "/").to_lowercase();
    if normalised.contains("/../")
        || normalised.ends_with("/..")
        || normalised == ".."
        || normalised.starts_with("../")
    {
        return Err(format!("Path traversal not allowed: {trimmed}"));
    }

    // Extension check
    match raw.extension().and_then(|e| e.to_str()) {
        Some(ext) => {
            let ext_lower = ext.to_lowercase();
            if !ALLOWED_SAVE_EXTENSIONS.contains(&ext_lower.as_str()) {
                return Err(format!(
                    "Unsupported file extension '.{ext}'. Allowed: {}",
                    ALLOWED_SAVE_EXTENSIONS.join(", ")
                ));
            }
        }
        None => {
            return Err(format!(
                "Save path must have a file extension. Allowed: {}",
                ALLOWED_SAVE_EXTENSIONS.join(", ")
            ));
        }
    }

    // The parent directory must exist so we can canonicalize it and detect
    // symlink escapes. We canonicalize the parent (not the file itself,
    // since the file doesn't exist yet) and then re-append the filename.
    let parent = raw.parent().ok_or_else(|| {
        format!("Cannot determine parent directory for: {trimmed}")
    })?;

    let file_name = raw.file_name().ok_or_else(|| {
        format!("Cannot determine file name for: {trimmed}")
    })?;

    let canonical_parent = parent.canonicalize().map_err(|e| {
        format!("Parent directory does not exist or is inaccessible: {e}")
    })?;

    let canonical_path = canonical_parent.join(file_name);
    let mut canonical_str = canonical_path
        .to_string_lossy()
        .replace('\\', "/")
        .to_lowercase();

    // Strip Windows extended-path prefix (\\?\) that canonicalize() may add
    if canonical_str.starts_with("//?/") {
        canonical_str = canonical_str[4..].to_string();
    }

    // Block system directories
    for prefix in BLOCKED_PREFIXES_UNIX {
        if canonical_str == *prefix || canonical_str.starts_with(&format!("{prefix}/")) {
            return Err(format!(
                "Writing to system directory is not allowed: {trimmed}"
            ));
        }
    }
    for prefix in BLOCKED_PREFIXES_WINDOWS {
        if canonical_str == *prefix || canonical_str.starts_with(&format!("{prefix}/")) {
            return Err(format!(
                "Writing to system directory is not allowed: {trimmed}"
            ));
        }
    }

    // Block the app data directory
    if let Some(app_data) = app_data_dir_normalised() {
        if canonical_str == app_data || canonical_str.starts_with(&format!("{app_data}/")) {
            return Err(format!(
                "Writing to the application data directory is not allowed: {trimmed}"
            ));
        }
    }

    // Must be under user home
    if !is_under_user_home(&canonical_str) {
        return Err(format!(
            "Save path must be under your home directory: {trimmed}"
        ));
    }

    Ok(canonical_path)
}

// -- General file-access validation --------------------------------------

/// Allowed file extensions for OCR operations (images and documents).
pub const ALLOWED_OCR_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "pdf", "bmp", "tiff", "tif",
];

/// Allowed file extensions for sidecar read/write operations.
#[cfg(feature = "p2p")]
pub const ALLOWED_SIDECAR_EXTENSIONS: &[&str] = &["json"];

/// Validate a file path for read or write access.
///
/// Ensures:
/// 1. Path is not empty
/// 2. No `..` traversal components
/// 3. Not targeting system directories or the app data directory
/// 4. Under the user's home directory
/// 5. If `allowed_extensions` is `Some`, the file must have one of those extensions
pub fn validate_file_access_path(
    path: &str,
    allowed_extensions: Option<&[&str]>,
) -> Result<std::path::PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("File path cannot be empty".into());
    }

    let raw = std::path::Path::new(trimmed);
    let normalised = trimmed.replace('\\', "/").to_lowercase();

    // Reject paths with traversal components
    if normalised.contains("/../")
        || normalised.ends_with("/..")
        || normalised == ".."
        || normalised.starts_with("../")
    {
        return Err(format!("Path traversal not allowed: {trimmed}"));
    }

    // Extension check if an allowlist is provided
    if let Some(allowed) = allowed_extensions {
        match raw.extension().and_then(|e| e.to_str()) {
            Some(ext) => {
                let ext_lower = ext.to_lowercase();
                if !allowed.contains(&ext_lower.as_str()) {
                    return Err(format!(
                        "File type '.{ext}' is not allowed. Allowed: {}",
                        allowed.join(", ")
                    ));
                }
            }
            None => {
                return Err(format!(
                    "File must have an extension. Allowed: {}",
                    allowed.join(", ")
                ));
            }
        }
    }

    // Block system directories
    for prefix in BLOCKED_PREFIXES_UNIX {
        if normalised == *prefix || normalised.starts_with(&format!("{prefix}/")) {
            return Err(format!(
                "Access to system directory is not allowed: {trimmed}"
            ));
        }
    }
    for prefix in BLOCKED_PREFIXES_WINDOWS {
        if normalised == *prefix || normalised.starts_with(&format!("{prefix}/")) {
            return Err(format!(
                "Access to system directory is not allowed: {trimmed}"
            ));
        }
    }

    // Block the app data directory
    if let Some(app_data) = app_data_dir_normalised() {
        if normalised == app_data || normalised.starts_with(&format!("{app_data}/")) {
            return Err(format!(
                "Access to the application data directory is not allowed: {trimmed}"
            ));
        }
    }

    // Must be under user home
    if !is_under_user_home(&normalised) {
        return Err(format!(
            "File path must be under your home directory: {trimmed}"
        ));
    }

    Ok(raw.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rejects_empty_path() {
        assert!(validate_watch_path("").is_err());
        assert!(validate_watch_path("   ").is_err());
    }

    #[test]
    fn test_rejects_traversal() {
        assert!(validate_watch_path("/home/user/../etc/shadow").is_err());
        assert!(validate_watch_path("C:\\Users\\user\\..").is_err());
    }

    #[test]
    fn test_rejects_unix_system_dirs() {
        assert!(validate_watch_path("/etc").is_err());
        assert!(validate_watch_path("/etc/passwd").is_err());
        assert!(validate_watch_path("/var/log").is_err());
        assert!(validate_watch_path("/usr/bin").is_err());
        assert!(validate_watch_path("/proc/self").is_err());
    }

    #[test]
    fn test_rejects_windows_system_dirs() {
        assert!(validate_watch_path("C:\\Windows\\System32").is_err());
        assert!(validate_watch_path("C:\\Program Files\\Something").is_err());
        assert!(validate_watch_path("C:\\ProgramData\\secrets").is_err());
    }

    #[test]
    fn test_allows_user_home_subdirs() {
        // This test depends on the actual home dir of the test runner.
        // We test the helper directly instead.
        if let Some(home) = dirs::home_dir() {
            let sub = home.join("projects").join("myapp");
            let norm = sub.to_string_lossy().replace('\\', "/").to_lowercase();
            assert!(is_under_user_home(&norm));
        }
    }

    #[test]
    fn test_rejects_outside_home() {
        // /tmp is not under home (unless home is /tmp, which is unusual)
        if let Some(home) = dirs::home_dir() {
            let home_str = home.to_string_lossy().to_lowercase();
            if !home_str.contains("tmp") {
                // /tmp is outside home
                let result = validate_watch_path("/tmp/something");
                assert!(result.is_err(), "Expected /tmp to be rejected as outside home");
            }
        }
    }

    #[test]
    fn test_validate_file_watcher_paths_skips_non_file_watcher() {
        assert!(validate_file_watcher_paths("schedule", Some(r#"{"cron":"* * * * *"}"#)).is_ok());
    }

    #[test]
    fn test_validate_file_watcher_paths_rejects_system_dir() {
        let config = r#"{"watch_paths":["/etc/shadow"]}"#;
        assert!(validate_file_watcher_paths("file_watcher", Some(config)).is_err());
    }

    // -- validate_save_path tests -------------------------------------------

    #[test]
    fn test_save_path_rejects_empty() {
        assert!(validate_save_path("").is_err());
        assert!(validate_save_path("   ").is_err());
    }

    #[test]
    fn test_save_path_rejects_traversal() {
        assert!(validate_save_path("../evil.persona").is_err());
        assert!(validate_save_path("/home/user/../../etc/evil.persona").is_err());
    }

    #[test]
    fn test_save_path_rejects_bad_extension() {
        if let Some(home) = dirs::home_dir() {
            let p = home.join("test.exe");
            assert!(validate_save_path(&p.to_string_lossy()).is_err());

            let no_ext = home.join("noextension");
            assert!(validate_save_path(&no_ext.to_string_lossy()).is_err());
        }
    }

    #[test]
    fn test_save_path_allows_valid_persona_extension() {
        if let Some(home) = dirs::home_dir() {
            // Use the home dir itself as the parent (it should exist)
            let p = home.join("export.persona");
            let result = validate_save_path(&p.to_string_lossy());
            assert!(result.is_ok(), "Expected valid .persona path to be accepted: {:?}", result);
        }
    }

    #[test]
    fn test_save_path_allows_valid_enclave_extension() {
        if let Some(home) = dirs::home_dir() {
            let p = home.join("sealed.enclave");
            let result = validate_save_path(&p.to_string_lossy());
            assert!(result.is_ok(), "Expected valid .enclave path to be accepted: {:?}", result);
        }
    }

    #[test]
    fn test_save_path_rejects_nonexistent_parent() {
        if let Some(home) = dirs::home_dir() {
            let p = home.join("nonexistent_dir_12345").join("export.persona");
            assert!(validate_save_path(&p.to_string_lossy()).is_err());
        }
    }
}
