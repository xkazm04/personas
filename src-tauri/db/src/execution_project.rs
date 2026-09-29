//! Project-bound executions — `_projectId` in an execution's input.
//!
//! **Why.** A persona's working directory used to be decided entirely by the
//! persona (its `devProjectId` pin, its `homeProjectId`, else a per-persona
//! scratch dir under the temp dir). An external caller that hires one persona
//! and then runs it on many pieces of work — kp's gig specialists, one gig
//! folder per engagement — had no way to say "this run happens in THAT
//! folder". `_projectId` is that per-execution binding: a top-level string in
//! `input_data` naming a registered `dev_projects` row.
//!
//! **The security boundary.** Runs execute the Claude CLI with permissions
//! skipped, so a binding is a grant of write access to a directory. A key that
//! may run persona P must therefore only be able to point P at projects in
//! P's OWN workspace — never at an arbitrary registered repo (the Personas
//! checkout itself is one). The rule, checked here and nowhere else:
//!
//! 1. the project exists, is switched on, and its `root_path` is an existing
//!    directory — otherwise [`ProjectBindingError::NotFound`];
//! 2. the project's folder lies strictly inside one of the configured HTTP
//!    project roots (`PERSONAS_HTTP_PROJECT_ROOTS` when set, else the
//!    persisted `management.http_project_roots` setting — see
//!    [`allowed_project_roots`])
//!    — otherwise [`ProjectBindingError::OutsideAllowedRoots`]. This is what
//!    stops a project someone assigned to the workspace through the UI (this
//!    very checkout, say) from becoming a skip-permissions working directory
//!    for an external key: only folders under the gig roots ever can;
//! 3. the project belongs to a workspace, and that workspace's cross-project
//!    group (see [`crate::workspace_team`]) is exactly the persona's
//!    `home_team_id` — otherwise [`ProjectBindingError::OutsideWorkspace`].
//!
//! Both doors call [`resolve_bound_project`]: the management API before it
//! queues anything (a synchronous refusal the caller can read), and the runner
//! again before it picks a working directory (defense in depth — the project
//! can be deleted, switched off or moved to another workspace between queue
//! and run, and a run that silently fell back to the temp dir would report
//! success for work that never touched the gig folder).

use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

use personas_core::error::AppError;
use personas_core::models::DevProject;

use crate::repos::dev::projects as project_repo;
use crate::DbPool;

/// The `input_data` key that binds one execution to a project.
pub const PROJECT_BINDING_KEY: &str = "_projectId";

/// The env var naming the folders HTTP-registered and HTTP-bound projects must
/// live under. A list in the platform's `PATH` syntax (`;` on Windows, `:`
/// elsewhere), read at request time so an operator can change it without a
/// restart. Unset or empty = no HTTP project may be registered or bound.
pub const HTTP_PROJECT_ROOTS_ENV: &str = "PERSONAS_HTTP_PROJECT_ROOTS";

/// Parse a roots list (the env var's raw value) into canonical directories.
/// Entries that do not exist, or are not directories, are ignored. Pure over
/// its input so tests never touch process-global env.
pub fn project_roots_from(value: Option<OsString>) -> Vec<PathBuf> {
    let Some(value) = value.filter(|v| !v.is_empty()) else {
        return Vec::new();
    };
    std::env::split_paths(&value)
        .filter(|p| !p.as_os_str().is_empty())
        .filter_map(|p| std::fs::canonicalize(p).ok())
        .filter(|p| p.is_dir())
        .collect()
}

/// Where the effective roots came from — reported by the operator GET so a
/// mismatch between instances is visible instead of inferred.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootsSource {
    /// `PERSONAS_HTTP_PROJECT_ROOTS` is set and non-empty in THIS process.
    Env,
    /// The persisted `management.http_project_roots` setting.
    Setting,
    /// Neither: nothing may be registered or bound (fail-closed).
    None,
}

impl RootsSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Env => "env",
            Self::Setting => "setting",
            Self::None => "none",
        }
    }
}

/// Parse the persisted setting (a JSON array of paths) into canonical
/// directories; entries that do not exist are ignored, a malformed value is
/// no roots at all (fail-closed).
pub fn project_roots_from_setting(value: Option<&str>) -> Vec<PathBuf> {
    let Some(list) = value.and_then(|v| serde_json::from_str::<Vec<String>>(v).ok()) else {
        return Vec::new();
    };
    list.iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .filter_map(|s| std::fs::canonicalize(s).ok())
        .filter(|p| p.is_dir())
        .collect()
}

/// The resolution order, pure over its inputs: the env var when set and
/// non-empty (an explicit per-process override — even if none of its entries
/// exist, it is not silently replaced by the setting), else the setting, else
/// nothing.
pub fn resolve_project_roots(
    env: Option<OsString>,
    setting: Option<&str>,
) -> (Vec<PathBuf>, RootsSource) {
    match env.filter(|v| !v.is_empty()) {
        Some(v) => (project_roots_from(Some(v)), RootsSource::Env),
        None => match setting {
            Some(raw) => (project_roots_from_setting(Some(raw)), RootsSource::Setting),
            None => (Vec::new(), RootsSource::None),
        },
    }
}

/// The effective HTTP project roots for THIS check, read now — the env
/// override from this process, else the setting from the shared database, so
/// every instance on one database agrees unless one was launched with an
/// explicit override.
pub fn allowed_project_roots_with_source(pool: &DbPool) -> (Vec<PathBuf>, RootsSource) {
    let setting = match crate::repos::core::settings::get(
        pool,
        crate::settings_keys::MANAGEMENT_HTTP_PROJECT_ROOTS,
    ) {
        Ok(v) => v,
        Err(e) => {
            // Fail closed: an unreadable setting is no roots, never "anything".
            tracing::warn!(error = %e, "could not read the HTTP project roots setting");
            None
        }
    };
    resolve_project_roots(std::env::var_os(HTTP_PROJECT_ROOTS_ENV), setting.as_deref())
}

/// [`allowed_project_roots_with_source`] without the source.
pub fn allowed_project_roots(pool: &DbPool) -> Vec<PathBuf> {
    allowed_project_roots_with_source(pool).0
}

/// One path component, normalised for comparison: case-folded on Windows
/// (its filesystems are case-insensitive), byte-exact elsewhere.
fn component_key(c: Component<'_>) -> OsString {
    let raw = c.as_os_str();
    if cfg!(windows) {
        OsString::from(raw.to_string_lossy().to_lowercase())
    } else {
        raw.to_os_string()
    }
}

/// `candidate` lies STRICTLY inside `root`: every component of `root` matches
/// the leading components of `candidate`, and `candidate` has at least one
/// more. Component-wise, never a string prefix — `C:\gigs2` is not inside
/// `C:\gigs`, and `root` itself is not inside `root`. Both paths must already
/// be canonical (the callers canonicalise), so `..` and symlinks cannot fake
/// containment.
pub fn is_strictly_inside(candidate: &Path, root: &Path) -> bool {
    let mut cand = candidate.components();
    for r in root.components() {
        match cand.next() {
            Some(c) if component_key(c) == component_key(r) => {}
            _ => return false,
        }
    }
    cand.next().is_some()
}

/// Canonicalise `path` and report whether it is strictly inside one of
/// `roots` (which [`project_roots_from`] already canonicalised). A path that
/// cannot be canonicalised is inside nothing.
pub fn path_within_roots(path: &Path, roots: &[PathBuf]) -> bool {
    match std::fs::canonicalize(path) {
        Ok(canonical) => roots.iter().any(|r| is_strictly_inside(&canonical, r)),
        Err(_) => false,
    }
}

/// Longest project id the binding accepts. Ids are UUIDs; the bound only
/// keeps an absurd value out of log lines and error messages.
const MAX_PROJECT_ID_LEN: usize = 128;

/// Why a binding was refused. Each variant maps to one wire code — the
/// management API answers with [`ProjectBindingError::code`], the runner fails
/// the execution with [`ProjectBindingError::message`].
#[derive(Debug)]
pub enum ProjectBindingError {
    /// `_projectId` is present but is not a non-empty string.
    Invalid(String),
    /// No such project, it is switched off, or its folder is gone.
    NotFound(String),
    /// The project's folder is not strictly inside a configured HTTP root.
    OutsideAllowedRoots(String),
    /// The project is not in the workspace whose group the persona is homed in.
    OutsideWorkspace(String),
    /// The store failed while checking — not a verdict on the binding.
    Store(AppError),
}

impl ProjectBindingError {
    /// The snake_case wire code.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Invalid(_) => "invalid_project_id",
            Self::NotFound(_) => "project_not_found",
            Self::OutsideAllowedRoots(_) => "project_outside_allowed_roots",
            Self::OutsideWorkspace(_) => "project_outside_persona_workspace",
            Self::Store(_) => "project_binding_check_failed",
        }
    }

    /// The HTTP status the management API answers with.
    pub fn http_status(&self) -> u16 {
        match self {
            Self::Invalid(_) => 400,
            Self::NotFound(_) => 404,
            Self::OutsideAllowedRoots(_) | Self::OutsideWorkspace(_) => 403,
            Self::Store(_) => 500,
        }
    }

    /// A human-readable sentence (never carries secrets — ids and paths only).
    pub fn message(&self) -> String {
        match self {
            Self::Invalid(m)
            | Self::NotFound(m)
            | Self::OutsideAllowedRoots(m)
            | Self::OutsideWorkspace(m) => m.clone(),
            Self::Store(e) => format!("could not check the project binding: {e}"),
        }
    }
}

impl std::fmt::Display for ProjectBindingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code(), self.message())
    }
}

/// Read the binding out of an execution's `input_data`.
///
/// `Ok(None)` when there is no binding: no input, input that is not a JSON
/// object, no `_projectId` key, or an explicit `null`. `Err(Invalid)` when the
/// key is present with anything other than a non-empty string — a caller that
/// meant to bind a run and sent the wrong shape must hear about it, not have
/// the run land in the temp dir.
pub fn requested_project_id(
    input: Option<&serde_json::Value>,
) -> Result<Option<String>, ProjectBindingError> {
    let Some(raw) = input
        .and_then(|v| v.as_object())
        .and_then(|o| o.get(PROJECT_BINDING_KEY))
    else {
        return Ok(None);
    };
    match raw {
        serde_json::Value::Null => Ok(None),
        serde_json::Value::String(s) => {
            let id = s.trim();
            if id.is_empty() {
                Err(ProjectBindingError::Invalid(format!(
                    "`{PROJECT_BINDING_KEY}` must not be empty"
                )))
            } else if id.chars().count() > MAX_PROJECT_ID_LEN {
                Err(ProjectBindingError::Invalid(format!(
                    "`{PROJECT_BINDING_KEY}` exceeds {MAX_PROJECT_ID_LEN} characters"
                )))
            } else {
                Ok(Some(id.to_string()))
            }
        }
        _ => Err(ProjectBindingError::Invalid(format!(
            "`{PROJECT_BINDING_KEY}` must be a string"
        ))),
    }
}

/// Resolve and authorize a binding of `project_id` for a persona homed in
/// `persona_home_team_id`, against the roots configured right now. Returns the
/// project the run may use as its working directory. See the module doc.
pub fn resolve_bound_project(
    pool: &DbPool,
    persona_home_team_id: Option<&str>,
    project_id: &str,
) -> Result<DevProject, ProjectBindingError> {
    resolve_bound_project_with_roots(
        pool,
        persona_home_team_id,
        project_id,
        &allowed_project_roots(pool),
    )
}

/// [`resolve_bound_project`] against an explicit roots list.
pub fn resolve_bound_project_with_roots(
    pool: &DbPool,
    persona_home_team_id: Option<&str>,
    project_id: &str,
    allowed_roots: &[PathBuf],
) -> Result<DevProject, ProjectBindingError> {
    let project = check_project_folder(pool, project_id, allowed_roots)?;

    let outside = || {
        ProjectBindingError::OutsideWorkspace(format!(
            "project {project_id} is not in the workspace this persona belongs to"
        ))
    };
    let Some(workspace_id) = project.workspace_id.as_deref() else {
        return Err(outside());
    };
    let group = crate::workspace_team::group_for_workspace(pool, workspace_id)
        .map_err(ProjectBindingError::Store)?;
    match (group, persona_home_team_id) {
        (Some(g), Some(home)) if g.id == home => Ok(project),
        _ => Err(outside()),
    }
}

/// Resolve the project a kp hire names as the new persona's HOME
/// (`placement.projectId` on `POST /api/kp/persona-requests`, written as
/// `design_context.homeProjectId`) — checked at intake, before any persona
/// exists.
///
/// A home project is the persona's default working directory
/// (`runner::pick_exec_dir_lane`'s `HomeProject` lane), so it is held to the
/// same boundary a per-run `_projectId` binding is: rules 1 and 2 of the module
/// doc unchanged, and rule 3 read against the workspace the hire will be FILED
/// in — `placement_workspace_id` when the request named one, else the
/// project's own workspace (the caller then files the hire there). A project
/// with no workspace, or one in a different workspace than the placement, is
/// [`ProjectBindingError::OutsideWorkspace`]. The approval executor re-checks
/// with [`resolve_bound_project`] against the persona's actual home team once
/// it is filed, because the project can move or vanish while the request waits.
pub fn resolve_hire_project(
    pool: &DbPool,
    placement_workspace_id: Option<&str>,
    project_id: &str,
) -> Result<DevProject, ProjectBindingError> {
    resolve_hire_project_with_roots(
        pool,
        placement_workspace_id,
        project_id,
        &allowed_project_roots(pool),
    )
}

/// [`resolve_hire_project`] against an explicit roots list.
pub fn resolve_hire_project_with_roots(
    pool: &DbPool,
    placement_workspace_id: Option<&str>,
    project_id: &str,
    allowed_roots: &[PathBuf],
) -> Result<DevProject, ProjectBindingError> {
    let project = check_project_folder(pool, project_id, allowed_roots)?;
    match (project.workspace_id.as_deref(), placement_workspace_id) {
        (Some(own), Some(placed)) if own == placed => Ok(project),
        (Some(_), None) => Ok(project),
        (None, _) => Err(ProjectBindingError::OutsideWorkspace(format!(
            "project {project_id} belongs to no workspace, so no hire can be filed beside it"
        ))),
        (Some(_), Some(placed)) => Err(ProjectBindingError::OutsideWorkspace(format!(
            "project {project_id} is not in the placement workspace {placed}"
        ))),
    }
}

/// Rules 1 and 2 of the module doc: the project exists, is switched on, its
/// folder is an existing directory, and that folder is strictly inside one of
/// `allowed_roots`.
fn check_project_folder(
    pool: &DbPool,
    project_id: &str,
    allowed_roots: &[PathBuf],
) -> Result<DevProject, ProjectBindingError> {
    let project = match project_repo::get_project_by_id(pool, project_id) {
        Ok(p) => p,
        Err(AppError::NotFound(_)) => {
            return Err(ProjectBindingError::NotFound(format!(
                "project {project_id} does not exist"
            )))
        }
        Err(e) => return Err(ProjectBindingError::Store(e)),
    };
    if !project.enabled {
        return Err(ProjectBindingError::NotFound(format!(
            "project {project_id} is switched off"
        )));
    }
    if !Path::new(&project.root_path).is_dir() {
        return Err(ProjectBindingError::NotFound(format!(
            "project {project_id}'s folder {} is not an existing directory",
            project.root_path
        )));
    }

    if !path_within_roots(Path::new(&project.root_path), allowed_roots) {
        return Err(ProjectBindingError::OutsideAllowedRoots(
            if allowed_roots.is_empty() {
                format!(
                    "project {project_id} cannot be bound: no HTTP project roots are configured \
                 (neither {HTTP_PROJECT_ROOTS_ENV} nor the management.http_project_roots \
                 setting names an existing directory)"
                )
            } else {
                format!(
                "project {project_id}'s folder is not inside any of the allowed HTTP project roots"
            )
            },
        ));
    }
    Ok(project)
}

/// Both halves in one call: `Ok(None)` when the input carries no binding,
/// `Ok(Some(project))` when it carries a valid one.
pub fn bound_project_for_input(
    pool: &DbPool,
    persona_home_team_id: Option<&str>,
    input: Option<&serde_json::Value>,
) -> Result<Option<DevProject>, ProjectBindingError> {
    bound_project_for_input_with_roots(
        pool,
        persona_home_team_id,
        input,
        &allowed_project_roots(pool),
    )
}

/// [`bound_project_for_input`] against an explicit roots list.
pub fn bound_project_for_input_with_roots(
    pool: &DbPool,
    persona_home_team_id: Option<&str>,
    input: Option<&serde_json::Value>,
    allowed_roots: &[PathBuf],
) -> Result<Option<DevProject>, ProjectBindingError> {
    match requested_project_id(input)? {
        None => Ok(None),
        Some(id) => {
            resolve_bound_project_with_roots(pool, persona_home_team_id, &id, allowed_roots)
                .map(Some)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;
    use crate::repos::workspaces::org as ws_repo;
    use serde_json::json;
    use std::path::PathBuf;

    struct TempRoot(PathBuf);
    impl TempRoot {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!(
                "personas_exec_project_{tag}_{}",
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

    /// The OS temp dir as the one allowed root: every `TempRoot` is a strict
    /// descendant of it. Explicit, so no test touches the process-global env.
    fn roots() -> Vec<PathBuf> {
        vec![std::fs::canonicalize(std::env::temp_dir()).unwrap()]
    }

    // Shadow the env-reading entry points (local items beat the glob import).
    fn resolve_bound_project(
        pool: &DbPool,
        home: Option<&str>,
        id: &str,
    ) -> Result<DevProject, ProjectBindingError> {
        resolve_bound_project_with_roots(pool, home, id, &roots())
    }
    fn bound_project_for_input(
        pool: &DbPool,
        home: Option<&str>,
        input: Option<&serde_json::Value>,
    ) -> Result<Option<DevProject>, ProjectBindingError> {
        bound_project_for_input_with_roots(pool, home, input, &roots())
    }

    #[test]
    fn roots_list_parses_platform_separators_and_ignores_missing_entries() {
        assert!(project_roots_from(None).is_empty(), "unset");
        assert!(
            project_roots_from(Some(OsString::new())).is_empty(),
            "empty"
        );

        let a = TempRoot::new("root_a");
        let b = TempRoot::new("root_b");
        let missing = a.0.join("does-not-exist");
        let joined = std::env::join_paths([a.0.clone(), missing, b.0.clone()]).unwrap();
        let parsed = project_roots_from(Some(joined));
        assert_eq!(
            parsed,
            vec![
                std::fs::canonicalize(&a.0).unwrap(),
                std::fs::canonicalize(&b.0).unwrap()
            ],
            "the missing entry is dropped, the others canonicalised in order"
        );

        let only_missing = std::env::join_paths([a.0.join("nope")]).unwrap();
        assert!(project_roots_from(Some(only_missing)).is_empty());
    }

    #[test]
    fn env_overrides_the_setting_and_neither_means_none() {
        let a = TempRoot::new("res_env");
        let b = TempRoot::new("res_setting");
        let setting = serde_json::to_string(&vec![b.s()]).unwrap();
        let canon = |p: &Path| std::fs::canonicalize(p).unwrap();

        let (roots, src) =
            resolve_project_roots(Some(std::env::join_paths([&a.0]).unwrap()), Some(&setting));
        assert_eq!((roots, src), (vec![canon(&a.0)], RootsSource::Env));

        // An empty env var is unset.
        let (roots, src) = resolve_project_roots(Some(OsString::new()), Some(&setting));
        assert_eq!((roots, src), (vec![canon(&b.0)], RootsSource::Setting));

        let (roots, src) = resolve_project_roots(None, Some(&setting));
        assert_eq!((roots, src), (vec![canon(&b.0)], RootsSource::Setting));

        assert_eq!(
            resolve_project_roots(None, None),
            (vec![], RootsSource::None)
        );

        // A malformed setting, or one naming only missing folders, is no roots.
        assert!(resolve_project_roots(None, Some("not json")).0.is_empty());
        let gone = serde_json::to_string(&vec![a.0.join("gone")]).unwrap();
        assert!(resolve_project_roots(None, Some(&gone)).0.is_empty());
    }

    /// The pool-reading entry point sees the persisted setting — the thing a
    /// second instance on the same database reads.
    #[test]
    fn the_persisted_setting_is_read_from_the_database() {
        if std::env::var_os(HTTP_PROJECT_ROOTS_ENV).is_some_and(|v| !v.is_empty()) {
            return; // an env override on the test runner would mask the setting
        }
        let pool = init_test_db().unwrap();
        assert_eq!(
            allowed_project_roots_with_source(&pool).1,
            RootsSource::None
        );
        let root = TempRoot::new("persisted");
        crate::repos::core::settings::set_operator_only(
            &pool,
            crate::settings_keys::MANAGEMENT_HTTP_PROJECT_ROOTS,
            &serde_json::to_string(&vec![root.s()]).unwrap(),
        )
        .unwrap();
        let (roots, src) = allowed_project_roots_with_source(&pool);
        assert_eq!(src, RootsSource::Setting);
        assert_eq!(roots, vec![std::fs::canonicalize(&root.0).unwrap()]);
    }

    #[test]
    fn containment_is_strict_and_component_wise() {
        let root = Path::new("/srv/gigs");
        assert!(is_strictly_inside(Path::new("/srv/gigs/acme"), root));
        assert!(is_strictly_inside(Path::new("/srv/gigs/acme/deep"), root));
        assert!(
            !is_strictly_inside(Path::new("/srv/gigs"), root),
            "the root itself"
        );
        assert!(
            !is_strictly_inside(Path::new("/srv/gigs2"), root),
            "sibling prefix"
        );
        assert!(
            !is_strictly_inside(Path::new("/srv/gigs2/acme"), root),
            "sibling prefix"
        );
        assert!(!is_strictly_inside(Path::new("/srv"), root), "an ancestor");
        assert!(!is_strictly_inside(Path::new("/etc/gigs/acme"), root));
    }

    #[cfg(windows)]
    #[test]
    fn containment_ignores_case_on_windows() {
        let root = Path::new(r"C:\Gigs");
        assert!(is_strictly_inside(Path::new(r"c:\gigs\Acme"), root));
        assert!(!is_strictly_inside(Path::new(r"C:\gigs2\acme"), root));
        assert!(!is_strictly_inside(Path::new(r"c:\GIGS"), root));
    }

    #[test]
    fn real_paths_are_checked_after_canonicalisation() {
        let root = TempRoot::new("real");
        let child = root.0.join("gig");
        std::fs::create_dir_all(&child).unwrap();
        let sibling = TempRoot::new("real_sibling"); // `…real_<uuid>` vs `…real_sibling_<uuid>`
        let roots = vec![std::fs::canonicalize(&root.0).unwrap()];

        assert!(path_within_roots(&child, &roots));
        assert!(!path_within_roots(&root.0, &roots), "the root itself");
        assert!(!path_within_roots(&sibling.0, &roots));
        // A `..` walk out of the root resolves to the sibling, and is refused.
        let escape = child
            .join("..")
            .join("..")
            .join(sibling.0.file_name().unwrap());
        assert!(!path_within_roots(&escape, &roots));
        assert!(!path_within_roots(&root.0.join("missing"), &roots));
        assert!(!path_within_roots(&child, &[]), "no roots, nothing inside");
    }

    #[test]
    fn a_project_outside_the_allowed_roots_is_refused() {
        let pool = init_test_db().unwrap();
        let root = TempRoot::new("outside");
        let (_ws, group, project) = fixture(&pool, &root);
        let elsewhere = TempRoot::new("other_root");
        let other_roots = vec![std::fs::canonicalize(&elsewhere.0).unwrap()];

        let err = resolve_bound_project_with_roots(&pool, Some(&group), &project.id, &other_roots)
            .unwrap_err();
        assert_eq!(err.code(), "project_outside_allowed_roots");
        assert_eq!(err.http_status(), 403);

        // Unset roots: nothing can be bound.
        let err =
            resolve_bound_project_with_roots(&pool, Some(&group), &project.id, &[]).unwrap_err();
        assert_eq!(err.code(), "project_outside_allowed_roots");
        assert!(err.message().contains(HTTP_PROJECT_ROOTS_ENV));

        // The project's own folder as the root: the root itself is not inside.
        let self_root = vec![std::fs::canonicalize(&root.0).unwrap()];
        let err = resolve_bound_project_with_roots(&pool, Some(&group), &project.id, &self_root)
            .unwrap_err();
        assert_eq!(err.code(), "project_outside_allowed_roots");

        // And under the right root it binds.
        assert!(resolve_bound_project(&pool, Some(&group), &project.id).is_ok());
    }

    /// A workspace, its group id, and a project in it.
    fn fixture(pool: &DbPool, root: &TempRoot) -> (String, String, DevProject) {
        let ws = ws_repo::create_workspace(pool, "Freelance", None, None, false).unwrap();
        let group = crate::workspace_team::group_for_workspace(pool, &ws.id)
            .unwrap()
            .unwrap();
        let project = crate::project_identity::register_project(
            pool,
            "Gig",
            root.s(),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let project = ws_repo::assign_project(pool, &project.id, Some(&ws.id)).unwrap();
        (ws.id, group.id, project)
    }

    #[test]
    fn requested_id_reads_only_a_top_level_non_empty_string() {
        assert!(requested_project_id(None).unwrap().is_none());
        assert!(requested_project_id(Some(&json!("text")))
            .unwrap()
            .is_none());
        assert!(requested_project_id(Some(&json!({"task": "x"})))
            .unwrap()
            .is_none());
        assert!(requested_project_id(Some(&json!({"_projectId": null})))
            .unwrap()
            .is_none());
        // Nested is not top-level.
        assert!(
            requested_project_id(Some(&json!({"x": {"_projectId": "p"}})))
                .unwrap()
                .is_none()
        );
        assert_eq!(
            requested_project_id(Some(&json!({"_projectId": "  p1 "})))
                .unwrap()
                .as_deref(),
            Some("p1")
        );
        for bad in [
            json!({"_projectId": ""}),
            json!({"_projectId": 7}),
            json!({"_projectId": ["p"]}),
        ] {
            let err = requested_project_id(Some(&bad)).unwrap_err();
            assert_eq!(err.code(), "invalid_project_id", "{bad}");
            assert_eq!(err.http_status(), 400);
        }
    }

    #[test]
    fn a_project_in_the_personas_workspace_binds() {
        let pool = init_test_db().unwrap();
        let root = TempRoot::new("valid");
        let (_ws, group, project) = fixture(&pool, &root);
        let bound = resolve_bound_project(&pool, Some(&group), &project.id).unwrap();
        assert_eq!(bound.id, project.id);
        assert_eq!(bound.root_path, root.s());

        let via_input = bound_project_for_input(
            &pool,
            Some(&group),
            Some(&json!({"_projectId": project.id, "task": "go"})),
        )
        .unwrap()
        .unwrap();
        assert_eq!(via_input.id, project.id);
    }

    #[test]
    fn an_unknown_project_is_not_found() {
        let pool = init_test_db().unwrap();
        let err = resolve_bound_project(&pool, Some("g"), "no-such-project").unwrap_err();
        assert_eq!(err.code(), "project_not_found");
        assert_eq!(err.http_status(), 404);
    }

    #[test]
    fn a_switched_off_project_is_not_found() {
        let pool = init_test_db().unwrap();
        let root = TempRoot::new("off");
        let (_ws, group, project) = fixture(&pool, &root);
        project_repo::set_enabled(&pool, &project.id, false).unwrap();
        let err = resolve_bound_project(&pool, Some(&group), &project.id).unwrap_err();
        assert_eq!(err.code(), "project_not_found");
    }

    #[test]
    fn a_project_whose_folder_is_gone_is_not_found() {
        let pool = init_test_db().unwrap();
        let root = TempRoot::new("gone");
        let (_ws, group, project) = fixture(&pool, &root);
        std::fs::remove_dir_all(&root.0).unwrap();
        let err = resolve_bound_project(&pool, Some(&group), &project.id).unwrap_err();
        assert_eq!(err.code(), "project_not_found");
    }

    #[test]
    fn a_project_with_no_workspace_is_outside() {
        let pool = init_test_db().unwrap();
        let root = TempRoot::new("nows");
        let (_ws, group, project) = fixture(&pool, &root);
        ws_repo::assign_project(&pool, &project.id, None).unwrap();
        let err = resolve_bound_project(&pool, Some(&group), &project.id).unwrap_err();
        assert_eq!(err.code(), "project_outside_persona_workspace");
        assert_eq!(err.http_status(), 403);
    }

    #[test]
    fn a_project_in_another_workspace_or_an_unhomed_persona_is_outside() {
        let pool = init_test_db().unwrap();
        let root = TempRoot::new("other");
        let (_ws, group, project) = fixture(&pool, &root);

        // A persona homed in a DIFFERENT workspace's group.
        let other = ws_repo::create_workspace(&pool, "Bank", None, None, false).unwrap();
        let other_group = crate::workspace_team::group_for_workspace(&pool, &other.id)
            .unwrap()
            .unwrap();
        let err = resolve_bound_project(&pool, Some(&other_group.id), &project.id).unwrap_err();
        assert_eq!(err.code(), "project_outside_persona_workspace");

        // A persona homed in the PROJECT's own team is not the workspace group.
        let err =
            resolve_bound_project(&pool, project.team_id.as_deref(), &project.id).unwrap_err();
        assert_eq!(err.code(), "project_outside_persona_workspace");

        // A persona with no home at all.
        let err = resolve_bound_project(&pool, None, &project.id).unwrap_err();
        assert_eq!(err.code(), "project_outside_persona_workspace");

        // And the right group still binds.
        assert!(resolve_bound_project(&pool, Some(&group), &project.id).is_ok());
    }

    #[test]
    fn a_hire_home_project_is_held_to_the_binding_boundary() {
        let pool = init_test_db().unwrap();
        let root = TempRoot::new("hire_home");
        let (ws, _group, project) = fixture(&pool, &root);

        // Named placement that matches, or no placement (the project's own
        // workspace becomes the filing): accepted.
        assert!(resolve_hire_project_with_roots(&pool, Some(&ws), &project.id, &roots()).is_ok());
        assert!(resolve_hire_project_with_roots(&pool, None, &project.id, &roots()).is_ok());

        // A different placement workspace: refused, never re-filed.
        let other = ws_repo::create_workspace(&pool, "Other", None, None, false).unwrap();
        let err = resolve_hire_project_with_roots(&pool, Some(&other.id), &project.id, &roots())
            .unwrap_err();
        assert_eq!(err.code(), "project_outside_persona_workspace");

        // Outside the allowed roots, or with none configured: refused.
        let err = resolve_hire_project_with_roots(&pool, Some(&ws), &project.id, &[]).unwrap_err();
        assert_eq!(err.code(), "project_outside_allowed_roots");

        // Unknown id.
        let err = resolve_hire_project_with_roots(&pool, None, "nope", &roots()).unwrap_err();
        assert_eq!(err.code(), "project_not_found");

        // A project in no workspace cannot anchor a hire.
        let loose_root = TempRoot::new("hire_loose");
        let loose = crate::project_identity::register_project(
            &pool,
            "Loose",
            loose_root.s(),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let err = resolve_hire_project_with_roots(&pool, None, &loose.id, &roots()).unwrap_err();
        assert_eq!(err.code(), "project_outside_persona_workspace");
    }
}
