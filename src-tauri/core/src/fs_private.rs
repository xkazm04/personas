//! Make a file or directory readable by the current user and nobody else.
//!
//! # Why this is a module and not three call sites
//!
//! Inheritance is not a safe default for a secret. Measured on the operator's
//! own machine, 2026-08-22, with `icacls`:
//!
//! ```text
//! C:\Users\mkdol                 SYSTEM:(F)  Administrators:(F)  mkdol:(F)
//! C:\Users\mkdol\.personas       CodexSandboxUsers:(OI)(CI)(RX)   <-- + inherited
//! C:\Users\mkdol\.claude         CodexSandboxUsers:(OI)(CI)(RX)   <-- + inherited
//! C:\Users\mkdol\AppData\Local\Temp
//!                                CodexSandboxUsers:(OI)(CI)(M,DC) <-- MODIFY
//! ```
//!
//! The profile root is clean; three of its subtrees are not, because sandbox
//! tooling added explicit inheritable ACEs to them. So a file created under
//! `~/.personas` is born readable by `CodexSandboxUsers` — which is exactly
//! the "sandboxed process running as another principal" half of the threat
//! model that `local_http`'s shared secret exists to defeat. Relying on the
//! user-profile ACL would have published the token to the attacker.
//!
//! `%LOCALAPPDATA%\Temp` is worse: **Modify**, so a temp directory is not a
//! private scratch space either — anything planted inside one is planted by a
//! principal that should not be able to write there.
//!
//! # What this does
//!
//! Windows: `icacls <path> /inheritance:r /grant:r <user>:(F)` — strip every
//! inherited ACE, then grant the current user and nobody else. Directories
//! additionally get `(OI)(CI)` so children are born private too. Verified to
//! reduce the DACL above to a single `DOLLARSTORE\mkdol:(F)` entry.
//!
//! Unix: `0600` for a file, `0700` for a directory.
//!
//! # Adoption note
//!
//! The Windows half is NOT new code — it is `crypto.rs`'s
//! `restrict_file_permissions`, which has protected the master-key fallback
//! file since long before this module. It moved here so the same primitive
//! covers the three places that need it instead of being copied a second and
//! third time; `crypto.rs` now delegates.

use std::path::Path;

/// Restrict a **file** to the current user. Returns a human-readable error
/// rather than a typed one: every caller either propagates it into its own
/// error type or logs it, and none branches on the variant.
pub fn restrict_file_to_current_user(path: &Path) -> Result<(), String> {
    restrict(path, false)
}

/// Restrict a **directory** to the current user, and make that restriction
/// inheritable so files created inside it are private on arrival.
pub fn restrict_dir_to_current_user(path: &Path) -> Result<(), String> {
    restrict(path, true)
}

/// Re-grant the current user access to a path that has become unreadable
/// (a file created under a different elevation level or session), WITHOUT
/// touching inheritance.
///
/// Deliberately not the same operation as [`restrict_file_to_current_user`].
/// This one is additive and best-effort: the caller is trying to recover
/// access it has already lost, so stripping inherited ACEs here could remove
/// the very entry that would have let it back in. Windows uses `/grant`
/// (additive) rather than `/grant:r` (replace) for that reason; on Unix the
/// two operations coincide, because 0600 both grants the owner and excludes
/// everyone else.
pub fn grant_current_user_access(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        let username = whoami::username();
        run_icacls(path, &["/grant".to_string(), format!("{username}:(F)")])
    }
    #[cfg(not(windows))]
    {
        restrict(path, false)
    }
}

/// The ONE place this crate spawns a process.
///
/// Kept as a single function on purpose. `personas-core` is the
/// dependency-free foundation crate, so it cannot reach
/// `personas-engine`'s `cli_process` chokepoint — a core module that spawns
/// therefore has to be its own small chokepoint instead of scattering
/// `Command::new` across the crate. Fixed argv, no env, no stdin, no
/// timeout needed: `icacls` is a short-lived OS utility, and every argument
/// is either a literal or a path we already hold.
#[cfg(windows)]
fn run_icacls(path: &Path, args: &[String]) -> Result<(), String> {
    let path_str = path.to_string_lossy();
    let mut argv: Vec<String> = vec![path_str.to_string()];
    argv.extend_from_slice(args);

    let output = std::process::Command::new("icacls")
        .args(&argv)
        .output()
        .map_err(|e| format!("could not run icacls on {path_str}: {e}"))?;

    if output.status.success() {
        return Ok(());
    }
    Err(format!(
        "icacls failed on {path_str} (exit {}): {}",
        output.status,
        String::from_utf8_lossy(&output.stderr).trim()
    ))
}

#[cfg(windows)]
fn restrict(path: &Path, inheritable: bool) -> Result<(), String> {
    let username = whoami::username();
    // `(OI)(CI)` = object-inherit + container-inherit, so children of a
    // directory are born with this DACL instead of the stripped parent's.
    let grant = if inheritable {
        format!("{username}:(OI)(CI)(F)")
    } else {
        format!("{username}:(F)")
    };
    run_icacls(
        path,
        &["/inheritance:r".to_string(), "/grant:r".to_string(), grant],
    )
}

#[cfg(unix)]
fn restrict(path: &Path, inheritable: bool) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mode = if inheritable { 0o700 } else { 0o600 };
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
        .map_err(|e| format!("could not chmod {} to {mode:o}: {e}", path.display()))
}

#[cfg(not(any(windows, unix)))]
fn restrict(path: &Path, _inheritable: bool) -> Result<(), String> {
    Err(format!(
        "cannot restrict permissions on this platform for {}",
        path.display()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The contract callers depend on: after this returns Ok, the path exists
    /// and the current process can still read and write it. (Proving the
    /// NEGATIVE — that another principal cannot — needs a second account and
    /// is out of reach of a unit test; the DACL was verified by hand with
    /// `icacls`, and that measurement is recorded in this module's header.)
    #[test]
    fn restricting_a_file_keeps_it_usable_by_its_owner() {
        let dir = tempfile::tempdir().expect("tempdir");
        let f = dir.path().join("secret.json");
        std::fs::write(&f, b"{\"token\":\"x\"}").expect("write");
        restrict_file_to_current_user(&f).expect("restrict");
        assert_eq!(
            std::fs::read_to_string(&f).expect("read back"),
            "{\"token\":\"x\"}"
        );
        std::fs::write(&f, b"{\"token\":\"y\"}").expect("rewrite after restrict");
    }

    /// The repair path (`crypto.rs::repair_key_file_permissions`) must remain
    /// usable after running, and must be safe to run on a file that is already
    /// restricted — that is the situation it exists for.
    #[test]
    fn granting_access_is_idempotent_and_non_destructive() {
        let dir = tempfile::tempdir().expect("tempdir");
        let f = dir.path().join("key.bin");
        std::fs::write(&f, b"key-bytes").expect("write");
        restrict_file_to_current_user(&f).expect("restrict");

        grant_current_user_access(&f).expect("first repair");
        grant_current_user_access(&f).expect("second repair is a no-op, not an error");
        assert_eq!(std::fs::read(&f).expect("still readable"), b"key-bytes");
    }

    #[test]
    fn restricting_a_dir_keeps_it_writable_by_its_owner() {
        let dir = tempfile::tempdir().expect("tempdir");
        let sub = dir.path().join("scratch");
        std::fs::create_dir_all(&sub).expect("mkdir");
        restrict_dir_to_current_user(&sub).expect("restrict");
        let inner = sub.join("child.txt");
        std::fs::write(&inner, b"ok").expect("write inside restricted dir");
        assert_eq!(std::fs::read_to_string(&inner).expect("read"), "ok");
    }
}
