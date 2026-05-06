//! Disk layout for companion-brain. Idempotent first-run init.
//!
//! Layout:
//! ```text
//! ~/.personas/companion-brain/
//! ├── constitution.md          (copy of templates::CONSTITUTION_MD)
//! ├── identity.md              (copy of templates::IDENTITY_MD_TEMPLATE)
//! ├── episodes/                (append-only conversation + observation log)
//! ├── semantic/                (distilled facts: user/, projects/, world/)
//! │   ├── user/
//! │   ├── projects/
//! │   └── world/
//! ├── procedural/              (workflow preferences, "how to handle X")
//! └── reflections/             (identity-update journals from consolidation)
//! ```

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;

use crate::companion::templates::{CONSTITUTION_MD, CONSTITUTION_VERSION, IDENTITY_MD_TEMPLATE};
use crate::db::repos::core::settings as settings_repo;
use crate::db::settings_keys;
use crate::db::DbPool;
use crate::error::AppError;

/// Resolve `~/.personas/companion-brain/`. Honors PERSONAS_HOME override
/// for tests (same convention used elsewhere in the codebase).
pub fn brain_root() -> Result<PathBuf, AppError> {
    let base = if let Ok(override_dir) = std::env::var("PERSONAS_HOME") {
        PathBuf::from(override_dir)
    } else {
        dirs::home_dir()
            .ok_or_else(|| AppError::Internal("could not resolve home directory".into()))?
            .join(".personas")
    };
    Ok(base.join("companion-brain"))
}

/// Create the directory tree and seed constitution + identity if absent.
/// Safe to call repeatedly. Returns the resolved root.
///
/// Constitution upgrade is gated on a stored canonical version
/// (`companion_constitution_version` in `app_settings`). When the embedded
/// `CONSTITUTION_VERSION` is newer than the stored value (or no stamp exists
/// at all), the on-disk file is replaced with a timestamped backup left
/// next to it (`constitution.bak-YYYYMMDDTHHMMSS.md`) so a second upgrade
/// in a future release can't trample the user's original customization.
pub fn ensure_initialized(pool: &DbPool) -> Result<PathBuf, AppError> {
    let root = brain_root()?;
    fs::create_dir_all(&root)?;

    for sub in [
        "episodes",
        "semantic",
        "semantic/user",
        "semantic/projects",
        "semantic/world",
        "procedural",
        "reflections",
    ] {
        fs::create_dir_all(root.join(sub))?;
    }

    // Constitution: write fresh iff missing. Once on disk it's user-owned;
    // we never overwrite arbitrary edits from the embedded copy unless the
    // canonical version stamp has bumped — and even then we keep a
    // timestamped `.bak-<ts>.md` of whatever was there.
    let const_path = root.join("constitution.md");
    let stored_version: Option<u32> =
        settings_repo::get(pool, settings_keys::COMPANION_CONSTITUTION_VERSION)?
            .and_then(|s| s.parse::<u32>().ok());

    if !const_path.exists() {
        // First-run path: seed and stamp.
        fs::write(&const_path, CONSTITUTION_MD)?;
        settings_repo::set(
            pool,
            settings_keys::COMPANION_CONSTITUTION_VERSION,
            &CONSTITUTION_VERSION.to_string(),
        )?;
        tracing::info!(
            version = CONSTITUTION_VERSION,
            "companion: seeded constitution.md"
        );
    } else if stored_version.map_or(true, |v| v < CONSTITUTION_VERSION) {
        // Upgrade path. Always timestamp the backup so a second upgrade
        // doesn't clobber the first one, and only run upgrade once per
        // version bump regardless of what edits the user has made.
        let backup_name = format!("constitution.bak-{}.md", Utc::now().format("%Y%m%dT%H%M%S"));
        let backup_path = root.join(&backup_name);
        let _ = fs::copy(&const_path, &backup_path);
        fs::write(&const_path, CONSTITUTION_MD)?;
        settings_repo::set(
            pool,
            settings_keys::COMPANION_CONSTITUTION_VERSION,
            &CONSTITUTION_VERSION.to_string(),
        )?;
        tracing::info!(
            from = ?stored_version,
            to = CONSTITUTION_VERSION,
            backup = %backup_name,
            "companion: upgraded constitution.md"
        );
    }
    // else: user is on the current canonical version — leave their edits alone.

    // Identity: substitute the creation timestamp, then write iff missing.
    let now = Utc::now().to_rfc3339();
    let identity = IDENTITY_MD_TEMPLATE.replace("PLACEHOLDER_CREATED_AT", &now);
    write_if_absent(&root.join("identity.md"), &identity)?;

    Ok(root)
}

fn write_if_absent(path: &Path, contents: &str) -> Result<(), AppError> {
    if path.exists() {
        return Ok(());
    }
    fs::write(path, contents)?;
    tracing::info!(path = %path.display(), "Seeded companion-brain file");
    Ok(())
}
