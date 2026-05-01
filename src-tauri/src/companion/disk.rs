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

    // Constitution: write fresh iff missing. Once on disk it's user-owned;
    // we never overwrite arbitrary edits from the embedded copy.
    //
    // BUT: when a known-marker section is missing on disk, we treat that
    // as a pre-upgrade copy and replace once. This lets us roll out new
    // canonical sections (like the doctrine paragraph) without bricking
    // existing installs. Users who customize will get a `.bak` of their
    // version next to it.
    // Marker-based upgrade: if the on-disk constitution is missing any of
    // the canonical sections, we replace it (after backing up the old
    // version once). New section markers added here will reach existing
    // installs on the next app start.
    let const_path = root.join("constitution.md");
    const REQUIRED_MARKERS: &[&str] =
        &["# Reference docs", "# Proposing actions", "update_identity"];
    let needs_upgrade = std::fs::read_to_string(&const_path)
        .map(|c| !REQUIRED_MARKERS.iter().all(|m| c.contains(m)))
        .unwrap_or(false);
    if needs_upgrade {
        let _ = std::fs::copy(&const_path, root.join("constitution.bak.md"));
        std::fs::write(&const_path, CONSTITUTION_MD)?;
        tracing::info!("companion: upgraded constitution.md (new sections added; old saved as constitution.bak.md)");
    } else {
        write_if_absent(&const_path, CONSTITUTION_MD)?;
    }

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
