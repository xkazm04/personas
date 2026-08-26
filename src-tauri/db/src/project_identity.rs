//! `.personas/project.json` — a managed repo's identity marker.
//!
//! **Why.** `dev_projects.root_path` is `UNIQUE` and was the only identity a
//! project had: move or rename the folder and every context, KPI, idea, task
//! and milestone hanging off the row silently detached, and registering the
//! new path minted a second, empty project. The exporters already write into
//! `<repo>/.personas/` (`backlog-digest.json`, `skill-registry.json`) but none
//! of them wrote *which project this is*.
//!
//! **Shape** (research 2026-08-25, Apache Maka `.maka-workspace.json`): the
//! marker proves *logical identity* — "this folder is project X" — and nothing
//! about the folder's contents. A path change is a diagnostic and is healed by
//! re-pointing `root_path`; an identity **collision** (the marker names a
//! project whose registered folder still exists somewhere else — a `git clone`
//! carried it) is a hard gate, because two folders claiming one id is exactly
//! the state the marker exists to prevent. The refusal names both paths so the
//! operator can delete the marker in the clone or remove the stale checkout.
//!
//! Registration goes through [`register_project`]; the marker is written
//! best-effort (a read-only checkout must not block registration) and read on
//! every register call.

use std::path::{Path, PathBuf};

use personas_core::error::AppError;
use personas_core::models::DevProject;
use serde::{Deserialize, Serialize};

use crate::repos::dev::projects as repo;
use crate::DbPool;

/// Marker file, relative to the repo root.
pub const MARKER_REL_PATH: &str = ".personas/project.json";

/// Bump when the marker's fields change meaning. A reader that sees a higher
/// schema than it knows treats the marker as absent rather than guessing.
pub const MARKER_SCHEMA: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectMarker {
    pub schema: u32,
    /// `dev_projects.id`.
    pub id: String,
    /// Display name at write time — informational, never used for lookup.
    pub name: String,
    /// RFC 3339.
    pub written_at: String,
}

/// How [`resolve_identity`] classified a root path.
#[derive(Debug, Clone)]
pub enum IdentityResolution {
    /// A project is already registered at exactly this path.
    Existing(DevProject),
    /// The marker named a project registered at a path that no longer exists;
    /// `root_path` has been re-pointed here.
    Relocated(DevProject),
    /// No usable marker: register a fresh project.
    Fresh,
}

pub fn marker_path(root: &Path) -> PathBuf {
    root.join(MARKER_REL_PATH)
}

/// Read the marker. `None` when the file is absent, unreadable, unparseable,
/// or newer than this binary understands — every one of those is "no
/// identity claim", never an error, because registration must still work.
pub fn read_marker(root: &Path) -> Option<ProjectMarker> {
    let path = marker_path(root);
    let raw = std::fs::read_to_string(&path).ok()?;
    match serde_json::from_str::<ProjectMarker>(&raw) {
        Ok(m) if m.schema <= MARKER_SCHEMA && !m.id.trim().is_empty() => Some(m),
        Ok(m) => {
            tracing::warn!(
                path = %path.display(),
                schema = m.schema,
                "project marker schema newer than this binary — ignoring"
            );
            None
        }
        Err(e) => {
            tracing::warn!(path = %path.display(), error = %e, "project marker unparseable — ignoring");
            None
        }
    }
}

/// Write (or refresh) the marker for `project` under its root.
pub fn write_marker(root: &Path, project: &DevProject) -> Result<(), AppError> {
    let dir = root.join(".personas");
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::Internal(format!("create .personas dir: {e}")))?;
    let marker = ProjectMarker {
        schema: MARKER_SCHEMA,
        id: project.id.clone(),
        name: project.name.clone(),
        written_at: chrono::Utc::now().to_rfc3339(),
    };
    let pretty = serde_json::to_string_pretty(&marker)
        .map_err(|e| AppError::Internal(format!("serialize project.json: {e}")))?;
    std::fs::write(marker_path(root), pretty)
        .map_err(|e| AppError::Internal(format!("write project.json: {e}")))?;
    Ok(())
}

fn same_path(a: &str, b: &str) -> bool {
    Path::new(a) == Path::new(b)
}

/// Decide what `root_path` is: an already-registered project, a moved one, or
/// a fresh folder. Performs the relocation write when the marker proves a
/// move; refuses on an identity collision.
pub fn resolve_identity(pool: &DbPool, root_path: &str) -> Result<IdentityResolution, AppError> {
    if let Some(existing) = repo::get_project_by_path(pool, root_path)? {
        return Ok(IdentityResolution::Existing(existing));
    }
    let Some(marker) = read_marker(Path::new(root_path)) else {
        return Ok(IdentityResolution::Fresh);
    };
    let claimed = match repo::get_project_by_id(pool, &marker.id) {
        Ok(p) => p,
        // The marker names a project this database has never seen (a repo
        // registered on another machine, or a deleted project). Nothing to
        // relocate; the fresh registration overwrites the marker.
        Err(AppError::NotFound(_)) => return Ok(IdentityResolution::Fresh),
        Err(e) => return Err(e),
    };
    if same_path(&claimed.root_path, root_path) {
        return Ok(IdentityResolution::Existing(claimed));
    }
    if Path::new(&claimed.root_path).exists() {
        return Err(AppError::Validation(format!(
            "This folder carries the identity of project '{}', which is still registered at {}. \
             Two folders cannot share one project. Remove the other checkout, or delete {} in this folder to register it as a new project.",
            claimed.name, claimed.root_path, MARKER_REL_PATH
        )));
    }
    tracing::info!(
        project_id = %claimed.id,
        from = %claimed.root_path,
        to = %root_path,
        "project relocated via .personas/project.json"
    );
    let relocated = repo::update_root_path(pool, &claimed.id, root_path)?;
    Ok(IdentityResolution::Relocated(relocated))
}

/// Register a project at `root_path`: idempotent on an existing path, heals a
/// moved repo through its marker, otherwise creates the row — and in every
/// case leaves a current marker in the folder (best-effort).
#[allow(clippy::too_many_arguments)]
pub fn register_project(
    pool: &DbPool,
    name: &str,
    root_path: &str,
    description: Option<&str>,
    status: Option<&str>,
    tech_stack: Option<&str>,
    github_url: Option<&str>,
    team_id: Option<&str>,
) -> Result<DevProject, AppError> {
    let project = match resolve_identity(pool, root_path)? {
        IdentityResolution::Existing(p) | IdentityResolution::Relocated(p) => p,
        IdentityResolution::Fresh => repo::create_project(
            pool,
            name,
            root_path,
            description,
            status,
            tech_stack,
            github_url,
            team_id,
        )?,
    };
    if let Err(e) = write_marker(Path::new(root_path), &project) {
        // A read-only or vanished folder must not fail registration — the
        // row is the authority; the marker is the breadcrumb.
        tracing::warn!(project_id = %project.id, error = %e, "could not write .personas/project.json");
    }
    Ok(project)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    /// A fresh directory under the OS temp dir; removed on drop.
    struct TempRoot(PathBuf);
    impl TempRoot {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!(
                "personas_project_identity_{tag}_{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&p).unwrap();
            Self(p)
        }
        fn s(&self) -> &str {
            self.0.to_str().unwrap()
        }
    }
    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn register(pool: &DbPool, name: &str, root: &str) -> DevProject {
        register_project(pool, name, root, None, None, None, None, None).unwrap()
    }

    #[test]
    fn registration_writes_marker_and_is_idempotent_on_same_path() {
        let pool = init_test_db().unwrap();
        let root = TempRoot::new("idem");
        let first = register(&pool, "Demo", root.s());
        let m = read_marker(&root.0).expect("marker written");
        assert_eq!(m.id, first.id);
        assert_eq!(m.schema, MARKER_SCHEMA);

        let again = register(&pool, "Demo renamed", root.s());
        assert_eq!(
            again.id, first.id,
            "same path → same project, no duplicate row"
        );
    }

    #[test]
    fn moved_repo_is_relocated_through_its_marker() {
        let pool = init_test_db().unwrap();
        let old = TempRoot::new("old");
        let project = register(&pool, "Mover", old.s());

        // Simulate `mv old new`: the marker travels, the old folder disappears.
        let new = TempRoot::new("new");
        std::fs::create_dir_all(new.0.join(".personas")).unwrap();
        std::fs::copy(marker_path(&old.0), marker_path(&new.0)).unwrap();
        std::fs::remove_dir_all(&old.0).unwrap();

        match resolve_identity(&pool, new.s()).unwrap() {
            IdentityResolution::Relocated(p) => {
                assert_eq!(p.id, project.id);
                assert_eq!(p.root_path, new.s());
            }
            other => panic!("expected Relocated, got {other:?}"),
        }
        let reread = repo::get_project_by_id(&pool, &project.id).unwrap();
        assert_eq!(reread.root_path, new.s(), "row re-pointed, not duplicated");
    }

    #[test]
    fn clone_carrying_a_live_identity_is_refused_with_both_paths() {
        let pool = init_test_db().unwrap();
        let original = TempRoot::new("orig");
        let project = register(&pool, "Cloned", original.s());

        let clone = TempRoot::new("clone");
        std::fs::create_dir_all(clone.0.join(".personas")).unwrap();
        std::fs::copy(marker_path(&original.0), marker_path(&clone.0)).unwrap();

        let err = register_project(&pool, "Cloned", clone.s(), None, None, None, None, None)
            .expect_err("collision must be refused");
        let msg = err.to_string();
        assert!(msg.contains(original.s()), "names the original path: {msg}");
        assert!(msg.contains(MARKER_REL_PATH), "tells how to recover: {msg}");
        assert_eq!(
            repo::get_project_by_id(&pool, &project.id)
                .unwrap()
                .root_path,
            original.s(),
            "original row untouched"
        );
    }

    #[test]
    fn unknown_or_garbage_marker_falls_back_to_fresh() {
        let pool = init_test_db().unwrap();
        let root = TempRoot::new("fresh");
        assert!(matches!(
            resolve_identity(&pool, root.s()).unwrap(),
            IdentityResolution::Fresh
        ));

        std::fs::create_dir_all(root.0.join(".personas")).unwrap();
        std::fs::write(marker_path(&root.0), "not json").unwrap();
        assert!(matches!(
            resolve_identity(&pool, root.s()).unwrap(),
            IdentityResolution::Fresh
        ));

        std::fs::write(
            marker_path(&root.0),
            format!(
                r#"{{"schema":{},"id":"unknown-id","name":"x","written_at":"now"}}"#,
                MARKER_SCHEMA
            ),
        )
        .unwrap();
        assert!(matches!(
            resolve_identity(&pool, root.s()).unwrap(),
            IdentityResolution::Fresh
        ));

        std::fs::write(
            marker_path(&root.0),
            format!(
                r#"{{"schema":{},"id":"future","name":"x","written_at":"now"}}"#,
                MARKER_SCHEMA + 1
            ),
        )
        .unwrap();
        assert!(
            read_marker(&root.0).is_none(),
            "newer schema is treated as absent"
        );
    }
}
