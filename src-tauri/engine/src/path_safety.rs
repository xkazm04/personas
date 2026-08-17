//! Path safety checks for file watcher triggers and sandboxed file access.
//!
//! Two distinct models live here, and picking the wrong one is the classic
//! mistake (see `docs/concepts/golden-paths/filesystem-boundary.md`):
//!
//! * **Anchored** — the app owns the root, the caller supplies a *relative*
//!   fragment. [`resolve_within_root`] resolves and proves containment; an
//!   escape requires defeating `canonicalize`. Use this whenever the boundary
//!   has a name (a vault, the managed drive, a project dir).
//! * **Blocklist** — the caller supplies an *absolute* path the user picked
//!   through an OS dialog and the app checks it is not somewhere known-bad
//!   ([`validate_file_access_path`], [`validate_watch_path`]). Weaker by
//!   construction: an escape only needs a location nobody enumerated.
//!
//! The blocklist half also validates that watch paths don't target sensitive
//! system directories, the app's own data directory, or locations outside the
//! user's home tree — defence-in-depth against malicious persona templates
//! that could leak file names and change patterns from sensitive directories.

use std::path::{Component, Path, PathBuf};

/// Sensitive directory prefixes that must never be watched (normalised to forward slashes, lowercase).
/// Covers Windows and Unix system directories.
const BLOCKED_PREFIXES_UNIX: &[&str] = &[
    "/etc", "/var", "/usr", "/bin", "/sbin", "/boot", "/proc", "/sys", "/dev", "/lib", "/lib64",
    "/root", "/run", "/snap",
];

const BLOCKED_PREFIXES_WINDOWS: &[&str] = &[
    "c:/windows",
    "c:/program files",
    "c:/program files (x86)",
    "c:/programdata",
    "c:/recovery",
    "c:/$recycle.bin",
];

/// Returns true if `path` points at a well-known secret / private-key / wallet
/// location that must never be read by a privileged flow (e.g. signing). Mirrors
/// the renderer's `SENSITIVE_PATH_PATTERNS` (src/api/signing/index.ts) so a
/// direct IPC caller (a persona tool, a future feature) can't bypass the
/// frontend guard and turn `sign_document` into an exfil oracle over SSH keys /
/// cloud credentials / wallets. Normalises separators + case; matches on path
/// segments and key-bearing extensions.
pub fn is_sensitive_credential_path(path: &str) -> bool {
    let n = path.replace('\\', "/").to_lowercase();

    // Directory-scoped secrets.
    if n.contains("/.ssh/")
        || n.contains("/.gnupg/")
        || n.contains("/.aws/credentials")
        || n.contains("/.config/gcloud/")
    {
        return true;
    }

    // Key-bearing file extensions.
    const KEY_EXTS: &[&str] = &[".pem", ".p12", ".pfx", ".key", ".jks", ".keystore"];
    if KEY_EXTS.iter().any(|e| n.ends_with(e)) {
        return true;
    }

    // Final path component checks.
    let file = n.rsplit('/').next().unwrap_or(n.as_str());
    const SSH_KEYS: &[&str] = &["id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"];
    const PRIVATE_KEY_NAMES: &[&str] = &["private_key", "private-key", "privatekey"];
    if SSH_KEYS
        .iter()
        .chain(PRIVATE_KEY_NAMES.iter())
        .any(|k| file == *k || file.starts_with(&format!("{k}.")))
    {
        return true;
    }
    matches!(file, "wallet.dat" | ".npmrc" | ".netrc")
}

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
    Some(app_dir.to_string_lossy().replace('\\', "/").to_lowercase())
}

/// Check whether a normalised path is under the current user's home directory.
fn is_under_user_home(normalised: &str) -> bool {
    match dirs::home_dir() {
        Some(home) => {
            let home_norm = home.to_string_lossy().replace('\\', "/").to_lowercase();
            normalised == home_norm || normalised.starts_with(&format!("{home_norm}/"))
        }
        None => {
            // Fail CLOSED: this predicate is the last line of defence in both
            // `validate_watch_path` and `resolve_and_guard` (save/file-access),
            // gating everything the blocked-prefix lists don't already name. An
            // unresolvable home directory must not silently widen that into an
            // allow-all for every path outside the (small, fixed) system-dir
            // blocklist -- mirrors `desktop_security.rs::is_path_allowed`'s
            // "can't resolve -> deny" contract for the same reason.
            tracing::warn!(
                "is_under_user_home: could not resolve the home directory; denying (fail-closed)"
            );
            false
        }
    }
}

// -- Save-path validation (export / seal commands) -----------------------

/// Allowed file extensions for save operations.
#[allow(dead_code)]
const ALLOWED_SAVE_EXTENSIONS: &[&str] = &["persona", "enclave"];

/// Shared core of `validate_save_path` / `validate_file_access_path`: resolve
/// `raw` to its canonical (symlink-free) form and block system directories,
/// the app data directory, and anything outside the user's home tree.
///
/// `canonicalize_file` controls whether the file itself is canonicalized when
/// it already exists (`validate_file_access_path`'s behavior — read/write of
/// an existing file) or whether only the parent is resolved and the filename
/// re-appended (`validate_save_path`'s behavior — the file doesn't exist yet).
/// `op_verb` / `boundary_label` customize the error wording per caller (e.g.
/// "Writing to" / "Save path" vs "Access to" / "File path").
///
/// Consolidated from two ~80%-identical copies (see refactor-bughunt-2026-07-10,
/// tauri-engine-4-10 #8).
fn resolve_and_guard(
    raw: &std::path::Path,
    trimmed: &str,
    canonicalize_file: bool,
    op_verb: &str,
    boundary_label: &str,
) -> Result<std::path::PathBuf, String> {
    let canonical_path = if canonicalize_file {
        match raw.canonicalize() {
            Ok(canon) => canon,
            Err(_) => resolve_parent(raw, trimmed)?,
        }
    } else {
        resolve_parent(raw, trimmed)?
    };

    let mut canonical_str = canonical_path
        .to_string_lossy()
        .replace('\\', "/")
        .to_lowercase();

    // Strip Windows extended-path prefix (\\?\) that canonicalize() may add
    if canonical_str.starts_with("//?/") {
        canonical_str = canonical_str[4..].to_string();
    }

    // Block system directories
    for prefix in BLOCKED_PREFIXES_UNIX.iter().chain(BLOCKED_PREFIXES_WINDOWS) {
        if canonical_str == *prefix || canonical_str.starts_with(&format!("{prefix}/")) {
            return Err(format!(
                "{op_verb} system directory is not allowed: {trimmed}"
            ));
        }
    }

    // Block the app data directory
    if let Some(app_data) = app_data_dir_normalised() {
        if canonical_str == app_data || canonical_str.starts_with(&format!("{app_data}/")) {
            return Err(format!(
                "{op_verb} the application data directory is not allowed: {trimmed}"
            ));
        }
    }

    // Must be under user home
    if !is_under_user_home(&canonical_str) {
        return Err(format!(
            "{boundary_label} must be under your home directory: {trimmed}"
        ));
    }

    Ok(canonical_path)
}

/// Canonicalize the parent directory (which must already exist) and re-append
/// the filename — used when the target file itself doesn't exist yet, or as
/// the fallback when `raw.canonicalize()` fails.
fn resolve_parent(raw: &std::path::Path, trimmed: &str) -> Result<std::path::PathBuf, String> {
    let parent = raw
        .parent()
        .ok_or_else(|| format!("Cannot determine parent directory for: {trimmed}"))?;
    let file_name = raw
        .file_name()
        .ok_or_else(|| format!("Cannot determine file name for: {trimmed}"))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("Parent directory does not exist or is inaccessible: {e}"))?;
    Ok(canonical_parent.join(file_name))
}

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

    resolve_and_guard(raw, trimmed, false, "Writing to", "Save path")
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

    // Resolve the REAL path before the security checks, to defeat symlink
    // escapes (e.g. a home-anchored symlink `~/notes -> /etc` would let
    // `~/notes/shadow` pass every textual gate yet open `/etc/shadow`).
    // Canonicalize the file when it exists; otherwise canonicalize the parent
    // (which must exist) and re-append the file name.
    resolve_and_guard(raw, trimmed, true, "Access to", "File path")
}

// -- Anchored resolution (app-owned root + caller-supplied fragment) -------

/// Lexical half of [`resolve_within_root`]: reject a caller-supplied fragment
/// that is not safely joinable to an app-owned root. **No filesystem access**,
/// so it is also usable where the fragment is not a local path at all (e.g.
/// the Obsidian Local REST API's `/vault/{fragment}` URL space, where a `..`
/// would escape the `/vault/` namespace into other API endpoints).
///
/// Rejects, on every platform so behaviour is uniform and testable:
///   * NUL bytes (defeat the OS call before it is ever made — the textual
///     pre-check `open_log_file_safely` shows is the correct first step);
///   * absolute forms, including POSIX `/x` and UNC `\\server\share`;
///   * any `..` segment (after normalising `\` to `/`, so `..\..\x` is
///     rejected on Unix too even though it is not an escape there);
///   * a leading drive letter (`C:`, `C:/x`, `C:foo`) — `Path::join` DISCARDS
///     the base when the argument carries a prefix, so `root.join("C:evil")`
///     evaluates to `C:evil`, outside the root entirely. Only the LEADING
///     segment is checked, because that is the only position Win32 parses a
///     drive prefix in; `notes/a:b.md` is a legal Unix filename and stays legal.
///
/// On Windows it additionally rejects `:` anywhere in a segment, which closes
/// NTFS alternate data streams (`note.md:hidden`). That check is deliberately
/// `cfg`-gated rather than universal: `:` is *illegal* in a Win32 filename, so
/// on Windows it has no false positives, while on Unix it is a perfectly legal
/// filename character (`2026-08-13 10:30 standup.md`) that must keep working.
/// Contrast `desktop_bridges::validate_path_safety`, whose Windows-only
/// sensitive-directory list gates a hazard that is *not* platform-specific —
/// that one is a bug, this one is not.
pub fn validate_relative_fragment(rel: &str) -> Result<(), String> {
    if rel.contains('\0') {
        return Err("Path may not contain NUL bytes".into());
    }

    let trimmed = rel.trim();
    let normalised = trimmed.replace('\\', "/");

    if normalised.starts_with('/') {
        return Err(format!("Path must be relative, not absolute: {trimmed}"));
    }

    // `C:`, `C:/…`, `C:foo`. Win32 parses a drive prefix only at the START of a
    // path, and that is exactly where it is dangerous: `Path::join` discards its
    // base when the argument carries a prefix. Checking only the leading segment
    // keeps a legal Unix filename like `notes/a:b.md` working.
    let leading = normalised.split('/').next().unwrap_or("").as_bytes();
    if leading.len() >= 2 && leading[1] == b':' && leading[0].is_ascii_alphabetic() {
        return Err(format!("Path may not contain a drive letter: {trimmed}"));
    }

    for seg in normalised.split('/') {
        if seg == ".." {
            return Err(format!("Path may not contain '..': {trimmed}"));
        }
        #[cfg(windows)]
        if seg.contains(':') {
            return Err(format!(
                "Path may not contain ':' (NTFS alternate data stream): {trimmed}"
            ));
        }
    }

    // Second belt: let the platform's own parser have a look. This catches
    // any prefix/root form the textual pass above did not anticipate.
    let candidate = Path::new(trimmed);
    if candidate.is_absolute() {
        return Err(format!("Path must be relative, not absolute: {trimmed}"));
    }
    for comp in candidate.components() {
        match comp {
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir => {
                return Err(format!("Path may not contain '..': {trimmed}"));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!("Path must be relative: {trimmed}"));
            }
        }
    }

    Ok(())
}

/// Resolve a caller-supplied fragment against an **app-owned** `root` and
/// return the canonical path inside it.
///
/// This is the anchored model: the app names the boundary, the caller only
/// names a fragment within it, and containment is asserted on the
/// **canonicalised** form. A lexical `root.join(rel).starts_with(root)` is NOT
/// a containment check — `Path::starts_with` compares whole components and
/// `Path::components()` deliberately preserves `ParentDir`, so
/// `root.join("../../x")` starts with `root` and the un-normalised path then
/// goes to an OS call that *does* resolve the `..`. That exact shape was live
/// in `desktop_bridges::execute_via_filesystem` until this function replaced it.
///
/// `std::fs::canonicalize` alone is insufficient because it fails on paths that
/// do not exist yet, which is the create/write case. So: if the target exists,
/// canonicalise it (which also resolves symlinks); if it does not, probe every
/// component with `symlink_metadata` (which does not follow links) to reject a
/// symlink anywhere along the way, then canonicalise the deepest *existing*
/// ancestor and re-append the not-yet-existing tail. Without the probe, a
/// symlink living in the tail would be appended verbatim and could redirect a
/// write outside the root while still passing containment.
///
/// Returns the resolved `PathBuf` — use only that, never the original string.
/// A guard that returns `Result<()>` invites its caller to go back to the raw
/// input, which is how 18 sites in this repo became check-then-use-original.
///
/// Mirrors `commands::drive::resolve_safe`, which is `pub(crate)` inside the
/// `personas-desktop` crate and therefore unreachable from `engine` / `core` /
/// `mcp_server`. This is that resolver in the shared crate.
pub fn resolve_within_root(root: &Path, rel: &str) -> Result<PathBuf, String> {
    validate_relative_fragment(rel)?;

    // Canonicalise the root ourselves: containment is only meaningful when
    // both sides are canonical, and callers pass roots straight out of config.
    let canonical_root = std::fs::canonicalize(root)
        .map_err(|e| format!("Root directory is not accessible: {e}"))?;

    let trimmed = rel.trim();
    if trimmed.is_empty() || trimmed == "." {
        return Ok(canonical_root);
    }

    let candidate = PathBuf::from(trimmed);
    let joined = canonical_root.join(&candidate);

    let canonical = if joined.exists() {
        std::fs::canonicalize(&joined)
            .map_err(|e| format!("Could not resolve path '{trimmed}': {e}"))?
    } else {
        let mut probe = canonical_root.clone();
        for comp in candidate.components() {
            if let Component::Normal(seg) = comp {
                probe.push(seg);
                if let Ok(meta) = std::fs::symlink_metadata(&probe) {
                    if meta.file_type().is_symlink() {
                        return Err(format!(
                            "Path traverses a symlink, which is not allowed: {trimmed}"
                        ));
                    }
                }
            }
        }

        // Walk up to the deepest ancestor that exists, canonicalise it, and
        // re-append the remaining tail so a create in a new subtree works.
        let mut ancestor = joined
            .parent()
            .ok_or_else(|| format!("Path has no parent directory: {trimmed}"))?
            .to_path_buf();
        loop {
            if ancestor.exists() {
                break;
            }
            match ancestor.parent() {
                Some(p) => ancestor = p.to_path_buf(),
                None => return Err(format!("Path resolves above the root: {trimmed}")),
            }
        }
        let canonical_ancestor = std::fs::canonicalize(&ancestor)
            .map_err(|e| format!("Could not resolve path '{trimmed}': {e}"))?;
        let tail = joined
            .strip_prefix(&ancestor)
            .map_err(|_| format!("Could not resolve path '{trimmed}'"))?;
        canonical_ancestor.join(tail)
    };

    if !canonical.starts_with(&canonical_root) {
        return Err(format!("Path escapes the root directory: {trimmed}"));
    }

    Ok(canonical)
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
                assert!(
                    result.is_err(),
                    "Expected /tmp to be rejected as outside home"
                );
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
            assert!(
                result.is_ok(),
                "Expected valid .persona path to be accepted: {:?}",
                result
            );
        }
    }

    #[test]
    fn test_save_path_allows_valid_enclave_extension() {
        if let Some(home) = dirs::home_dir() {
            let p = home.join("sealed.enclave");
            let result = validate_save_path(&p.to_string_lossy());
            assert!(
                result.is_ok(),
                "Expected valid .enclave path to be accepted: {:?}",
                result
            );
        }
    }

    #[test]
    fn test_save_path_rejects_nonexistent_parent() {
        if let Some(home) = dirs::home_dir() {
            let p = home.join("nonexistent_dir_12345").join("export.persona");
            assert!(validate_save_path(&p.to_string_lossy()).is_err());
        }
    }

    // -- Anchored resolution -------------------------------------------------

    /// The bug this whole section exists to close, pinned as an executable
    /// fact: a lexical `root.join(rel).starts_with(root)` returns TRUE for a
    /// `..` escape, because `Path::starts_with` compares whole components and
    /// `Path::components()` preserves `ParentDir` instead of resolving it.
    /// Four sites in `desktop_bridges.rs` shipped this check while printing
    /// the words "Path traversal detected".
    #[test]
    fn lexical_starts_with_does_not_detect_traversal() {
        let root = Path::new("/vault");
        let escaped = root.join("../../etc/shadow");
        assert!(
            escaped.starts_with(root),
            "if this ever fails, Path::starts_with changed semantics and the \
             doc comments in this module need revisiting"
        );
    }

    struct Sandbox {
        _dir: tempfile::TempDir,
        root: PathBuf,
    }

    /// `<tmp>/root/notes/nested.md` plus `<tmp>/outside/secret.txt`, so a
    /// `../` escape has something real to reach.
    fn sandbox() -> Sandbox {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("root");
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::write(root.join("notes").join("nested.md"), "# nested").unwrap();
        std::fs::create_dir_all(dir.path().join("outside")).unwrap();
        std::fs::write(dir.path().join("outside").join("secret.txt"), "shh").unwrap();
        Sandbox { _dir: dir, root }
    }

    #[test]
    fn resolve_within_root_rejects_parent_traversal() {
        let sb = sandbox();
        for rel in [
            "../outside/secret.txt",
            "notes/../../outside/secret.txt",
            "..",
            "..\\outside\\secret.txt",
            "./../outside/secret.txt",
        ] {
            assert!(
                resolve_within_root(&sb.root, rel).is_err(),
                "traversal fragment must be rejected: {rel}"
            );
        }
    }

    #[test]
    fn resolve_within_root_rejects_absolute_paths() {
        let sb = sandbox();
        assert!(resolve_within_root(&sb.root, "/etc/shadow").is_err());
        assert!(resolve_within_root(&sb.root, "//server/share/x").is_err());
        assert!(resolve_within_root(&sb.root, "\\\\server\\share\\x").is_err());
        // Drive-letter forms: absolute (`C:\…`) and drive-RELATIVE (`C:foo`),
        // the latter of which `Path::join` would silently adopt wholesale.
        assert!(resolve_within_root(&sb.root, "C:\\Windows\\win.ini").is_err());
        assert!(resolve_within_root(&sb.root, "C:/Windows/win.ini").is_err());
        assert!(resolve_within_root(&sb.root, "C:evil.md").is_err());
    }

    #[test]
    fn resolve_within_root_rejects_nul_byte() {
        let sb = sandbox();
        assert!(resolve_within_root(&sb.root, "notes/nested.md\0.png").is_err());
    }

    #[test]
    fn resolve_within_root_allows_legitimate_nested_path() {
        let sb = sandbox();
        let resolved = resolve_within_root(&sb.root, "notes/nested.md")
            .expect("a legitimate vault-relative note must still resolve");
        assert_eq!(std::fs::read_to_string(&resolved).unwrap(), "# nested");
        let canonical_root = std::fs::canonicalize(&sb.root).unwrap();
        assert!(resolved.starts_with(&canonical_root));
    }

    /// The create/write case: `canonicalize` alone fails on a path that does
    /// not exist yet, so the resolver has to canonicalise the deepest existing
    /// ancestor and re-append the tail. Two levels of not-yet-existing
    /// directory, which is what `WriteNote`'s `create_dir_all` relies on.
    #[test]
    fn resolve_within_root_allows_not_yet_existing_path() {
        let sb = sandbox();
        let resolved = resolve_within_root(&sb.root, "new/deeper/note.md")
            .expect("a not-yet-existing target must resolve for create/write");
        let canonical_root = std::fs::canonicalize(&sb.root).unwrap();
        assert!(resolved.starts_with(&canonical_root));
        std::fs::create_dir_all(resolved.parent().unwrap()).unwrap();
        std::fs::write(&resolved, "hello").unwrap();
        assert_eq!(
            std::fs::read_to_string(sb.root.join("new").join("deeper").join("note.md")).unwrap(),
            "hello"
        );
    }

    #[test]
    fn resolve_within_root_empty_fragment_is_the_root() {
        let sb = sandbox();
        let canonical_root = std::fs::canonicalize(&sb.root).unwrap();
        assert_eq!(resolve_within_root(&sb.root, "").unwrap(), canonical_root);
        assert_eq!(resolve_within_root(&sb.root, ".").unwrap(), canonical_root);
    }

    /// A symlink escape is the reason the not-yet-exists branch probes each
    /// component: canonicalising only the deepest *existing* ancestor would
    /// append a symlinked tail verbatim and still pass containment.
    #[cfg(unix)]
    #[test]
    fn resolve_within_root_rejects_symlink_escape() {
        let sb = sandbox();
        let outside = sb.root.parent().unwrap().join("outside");
        std::os::unix::fs::symlink(&outside, sb.root.join("link")).unwrap();
        assert!(resolve_within_root(&sb.root, "link/secret.txt").is_err());
        assert!(resolve_within_root(&sb.root, "link/brand-new.md").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn validate_relative_fragment_rejects_ntfs_ads() {
        assert!(validate_relative_fragment("notes/nested.md:hidden").is_err());
    }

    #[test]
    fn validate_relative_fragment_accepts_ordinary_fragments() {
        for rel in ["a.md", "folder/a.md", "./folder/a.md", "a b/c-d_e.md"] {
            assert!(
                validate_relative_fragment(rel).is_ok(),
                "ordinary fragment must be accepted: {rel}"
            );
        }
    }

    /// The drive-letter rule applies to the LEADING segment only. Win32 parses
    /// a drive prefix nowhere else, and a colon is a legal filename character
    /// on Unix — where an Obsidian note called `10:30 standup.md` is ordinary.
    #[cfg(unix)]
    #[test]
    fn validate_relative_fragment_keeps_unix_colons_working() {
        assert!(validate_relative_fragment("daily/10:30 standup.md").is_ok());
        assert!(validate_relative_fragment("notes/a:b.md").is_ok());
        // …but a LEADING drive letter is still refused everywhere.
        assert!(validate_relative_fragment("C:evil.md").is_err());
    }
}
