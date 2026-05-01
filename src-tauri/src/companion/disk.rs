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

use crate::companion::templates::{CONSTITUTION_MD, IDENTITY_MD_TEMPLATE};
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
pub fn ensure_initialized() -> Result<PathBuf, AppError> {
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

    // Constitution: write fresh on every init iff missing. Once on disk it's
    // user-owned; we never overwrite it from the embedded copy. Constitution
    // upgrades are deliberate edits — see CONSTITUTION_VERSION in templates.
    write_if_absent(&root.join("constitution.md"), CONSTITUTION_MD)?;

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
