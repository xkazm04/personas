//! `dev_registries` + `dev_workspace_registries` — the workspace -> knowledge
//! registry wiring, and the one derived scalar the execution runner reads.
//!
//! ## What moved here, and from where
//!
//! This wiring lived in the browser (`localStorage`, `devtools.registryLinks.v1`)
//! while every gate that needs it — Curator's eligibility, her loop, her
//! dispatch — is in Rust. One TypeScript function, `syncKnowledgeRootSetting`,
//! computed `app_settings.knowledge_registry_root` from the blob so that the
//! consult lane had something to read; that function is deleted and
//! [`knowledge_root`] is its replacement. The KEY is unchanged, so
//! `engine::knowledge_consult` is untouched.
//!
//! ## The chokepoint
//!
//! Every mutator here ends in [`sync_knowledge_root`], for the reason the
//! TypeScript `commit()` gave: done once, in the one place every mutation
//! passes through, there is no path that changes the wiring without updating
//! what the backend reads. A registry whose lanes lost `knowledge`, a clone
//! path corrected, a workspace leaving the last holder — each has to move the
//! setting, and none of them is the mutator an author would remember.
//!
//! **One root, deliberately.** A registry can be held by several workspaces
//! while an execution belongs to a project, so there is no per-run mapping to
//! consult yet; the knowledge-lane holder with the lowest id wins. That
//! ordering is now SQLite's `ORDER BY id` (byte order) rather than the
//! browser's `localeCompare` — a locale-dependent pick is not the same answer
//! on two machines, and "stable" was the only property the rule ever claimed.
//!
//! ## A linked registry is also a project
//!
//! The clone is a real directory an agent session can be dispatched into, so
//! [`link_workspace`] registers it through the identity-aware door
//! (`crate::project_identity::register_project`) with `kind = 'registry'`,
//! `enabled = 0` and no workspace. The door is idempotent on `root_path`, so a
//! second workspace holding the same registry FINDS that row rather than
//! failing on `root_path UNIQUE`.

use rusqlite::{params, OptionalExtension};

use crate::models::{
    DevProject, DevRegistry, DevRegistryInput, RegistryLinkSnapshot, RegistryPairingState,
    WorkspaceRegistryLink,
};
use crate::DbPool;
use personas_core::error::AppError;

const COLUMNS: &str = "id, full_name, url, default_branch, credential_id, clone_path, state, \
                       session_id, lanes_json, domains_json, sha, paired_at, error, \
                       created_at, updated_at";

/// `dev_projects.kind` for a knowledge-registry checkout. The other member of
/// the closed set is `'code'`, which is the column's DEFAULT and therefore what
/// every project that predates the column reads as.
pub const PROJECT_KIND_REGISTRY: &str = "registry";

/// The lane a registry must publish for the consult lane to point at it.
const KNOWLEDGE_LANE: &str = "knowledge";

/// Row -> model. Hand-written rather than `row_mapper!` because three columns
/// are not fields: `lanes_json` / `domains_json` are JSON documents the model
/// carries as vectors, and `state` is a closed set the model carries as an
/// enum.
fn row_to_registry(row: &rusqlite::Row) -> rusqlite::Result<DevRegistry> {
    let state_raw: String = row.get("state")?;
    Ok(DevRegistry {
        id: row.get("id")?,
        full_name: row.get("full_name")?,
        url: row.get("url")?,
        default_branch: row.get("default_branch")?,
        credential_id: row.get("credential_id")?,
        clone_path: row.get("clone_path")?,
        // A value outside the CHECK cannot be written through this app; if a
        // hand-edited row carries one, `Unlinked` is the reading that claims
        // least rather than the one that claims the registry is ready.
        state: RegistryPairingState::parse(&state_raw).unwrap_or(RegistryPairingState::Unlinked),
        session_id: row.get("session_id")?,
        lanes: parse_string_array(&row.get::<_, String>("lanes_json")?),
        domains: parse_string_array(&row.get::<_, String>("domains_json")?),
        sha: row.get("sha")?,
        paired_at: row.get("paired_at")?,
        error: row.get("error")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// A stored inventory that will not parse reads as EMPTY, not as an error: the
/// lanes are a discovered fact that the next probe replaces, and a malformed
/// document must not make the registry unreadable in the panel that would let
/// the operator re-probe it.
fn parse_string_array(raw: &str) -> Vec<String> {
    match serde_json::from_str::<Vec<String>>(raw) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, raw = %raw, "dev_registries: unreadable inventory - reporting none");
            Vec::new()
        }
    }
}

fn to_json_array(values: &[String]) -> String {
    serde_json::to_string(values).unwrap_or_else(|_| "[]".to_string())
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

pub fn list(pool: &DbPool) -> Result<Vec<DevRegistry>, AppError> {
    timed_query!("dev_registries", "dev_registries::list", {
        let conn = pool.get()?;
        let mut stmt =
            conn.prepare(&format!("SELECT {COLUMNS} FROM dev_registries ORDER BY id"))?;
        let rows = stmt.query_map([], row_to_registry)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// One registry by id. `Ok(None)` is "no such registry", never an error — the
/// caller distinguishes an absent wiring from a failed read.
pub fn get(pool: &DbPool, id: &str) -> Result<Option<DevRegistry>, AppError> {
    timed_query!("dev_registries", "dev_registries::get", {
        let conn = pool.get()?;
        conn.query_row(
            &format!("SELECT {COLUMNS} FROM dev_registries WHERE id = ?1"),
            params![id],
            row_to_registry,
        )
        .optional()
        .map_err(AppError::Database)
    })
}

/// Every workspace -> registry hold, workspace-ordered.
pub fn links(pool: &DbPool) -> Result<Vec<WorkspaceRegistryLink>, AppError> {
    timed_query!("dev_registries", "dev_registries::links", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT workspace_id, registry_id, linked_at FROM dev_workspace_registries
             ORDER BY workspace_id",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(WorkspaceRegistryLink {
                workspace_id: r.get("workspace_id")?,
                registry_id: r.get("registry_id")?,
                linked_at: r.get("linked_at")?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// The registry a workspace holds, or `None`.
pub fn registry_for_workspace(
    pool: &DbPool,
    workspace_id: &str,
) -> Result<Option<DevRegistry>, AppError> {
    timed_query!(
        "dev_registries",
        "dev_registries::registry_for_workspace",
        {
            let conn = pool.get()?;
            conn.query_row(
                &format!(
                    "SELECT {COLUMNS} FROM dev_registries r
                     JOIN dev_workspace_registries l ON l.registry_id = r.id
                     WHERE l.workspace_id = ?1"
                ),
                params![workspace_id],
                row_to_registry,
            )
            .optional()
            .map_err(AppError::Database)
        }
    )
}

/// Every workspace holding this registry. The multi-holder fact made queryable
/// — a UI that cannot show it lets someone "leave" a registry three other
/// workspaces are reading.
pub fn workspaces_on(pool: &DbPool, registry_id: &str) -> Result<Vec<String>, AppError> {
    timed_query!("dev_registries", "dev_registries::workspaces_on", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT workspace_id FROM dev_workspace_registries
             WHERE registry_id = ?1 ORDER BY workspace_id",
        )?;
        let rows = stmt.query_map(params![registry_id], |r| r.get::<_, String>("workspace_id"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// The knowledge-lane clone path the execution runner should consult: the
/// lowest-id registry that publishes a `knowledge` lane and names a working
/// copy. `None` means no registry qualifies, which is the same answer as no
/// registry at all — the consult lane is an enrichment and its absence is not
/// an error.
///
/// `json_each` rather than a `LIKE '%"knowledge"%'` scan: the substring form
/// also matches a DOMAIN called `knowledge`, or a lane named
/// `knowledge-archive`, and a wrong root here means executions read a corpus
/// the operator never wired.
pub fn knowledge_root(pool: &DbPool) -> Result<Option<String>, AppError> {
    timed_query!("dev_registries", "dev_registries::knowledge_root", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT clone_path FROM dev_registries
              WHERE TRIM(clone_path) <> ''
                AND EXISTS (SELECT 1 FROM json_each(lanes_json) WHERE value = ?1)
              ORDER BY id
              LIMIT 1",
            params![KNOWLEDGE_LANE],
            |r| r.get::<_, String>("clone_path"),
        )
        .optional()
        .map_err(AppError::Database)
    })
}

/// Every registry at least one workspace holds, lowest id first. Curator's
/// prerequisite is built from this: a registry nobody holds is a row, not a
/// wiring.
pub fn mapped(pool: &DbPool) -> Result<Vec<DevRegistry>, AppError> {
    timed_query!("dev_registries", "dev_registries::mapped", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM dev_registries r
              WHERE EXISTS (SELECT 1 FROM dev_workspace_registries l WHERE l.registry_id = r.id)
              ORDER BY r.id"
        ))?;
        let rows = stmt.query_map([], row_to_registry)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// The whole wiring in one read — what the client's store loads at startup.
pub fn snapshot(pool: &DbPool) -> Result<RegistryLinkSnapshot, AppError> {
    Ok(RegistryLinkSnapshot {
        registries: list(pool)?,
        links: links(pool)?,
        knowledge_root: knowledge_root(pool)?,
    })
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/// Insert or replace a registry, keeping `created_at` from the first write.
///
/// A full-row upsert rather than a field-wise patch on purpose: the client
/// holds the whole snapshot in memory and every mutation it makes is a merge
/// followed by a write, so a partial-update door would be a second way to say
/// the same thing with its own rules about which absent field means "leave".
pub fn upsert(pool: &DbPool, input: &DevRegistryInput) -> Result<DevRegistry, AppError> {
    personas_core::validation::require_non_empty("Registry id", &input.id)?;
    personas_core::validation::require_non_empty("Registry clone path", &input.clone_path)?;

    timed_query!("dev_registries", "dev_registries::upsert", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_registries
                (id, full_name, url, default_branch, credential_id, clone_path, state,
                 session_id, lanes_json, domains_json, sha, paired_at, error,
                 created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
             ON CONFLICT(id) DO UPDATE SET
                full_name = excluded.full_name,
                url = excluded.url,
                default_branch = excluded.default_branch,
                credential_id = excluded.credential_id,
                clone_path = excluded.clone_path,
                state = excluded.state,
                session_id = excluded.session_id,
                lanes_json = excluded.lanes_json,
                domains_json = excluded.domains_json,
                sha = excluded.sha,
                paired_at = excluded.paired_at,
                error = excluded.error,
                updated_at = excluded.updated_at",
            params![
                input.id,
                input.full_name,
                input.url,
                input.default_branch,
                input.credential_id,
                input.clone_path.trim(),
                input.state.as_str(),
                input.session_id,
                to_json_array(&input.lanes),
                to_json_array(&input.domains),
                input.sha,
                input.paired_at,
                input.error,
                now,
            ],
        )?;
        drop(conn);

        // A registry whose clone only appeared after pairing gets its project
        // row here rather than at link time, which is the one moment the path
        // was guaranteed not to exist yet.
        ensure_registry_project(pool, &input.id, input.clone_path.trim(), &input.full_name);
        sync_knowledge_root(pool)?;
        get(pool, &input.id)?.ok_or_else(|| AppError::NotFound(format!("Registry {}", input.id)))
    })
}

/// Give a workspace a registry to hold. Replaces whatever it held — the
/// workspace side is the primary key, so "switch registry" is this call and not
/// an unlink followed by a link.
///
/// Registers the clone as a `kind = 'registry'` project on the way through; see
/// the module header for why that is here rather than at the call site.
pub fn link_workspace(
    pool: &DbPool,
    workspace_id: &str,
    registry_id: &str,
) -> Result<DevRegistry, AppError> {
    personas_core::validation::require_non_empty("Workspace id", workspace_id)?;
    let registry = get(pool, registry_id)?
        .ok_or_else(|| AppError::NotFound(format!("Registry {registry_id}")))?;

    timed_query!("dev_registries", "dev_registries::link_workspace", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_workspace_registries (workspace_id, registry_id, linked_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(workspace_id) DO UPDATE SET
                registry_id = excluded.registry_id,
                linked_at = excluded.linked_at",
            params![workspace_id, registry_id, now],
        )?;
        drop(conn);
        ensure_registry_project(
            pool,
            &registry.id,
            registry.clone_path.trim(),
            &registry.full_name,
        );
        sync_knowledge_root(pool)?;
        Ok(registry)
    })
}

/// Detach a workspace. The registry survives while any other workspace holds
/// it, and is deleted with the last one — the same rule the browser store had,
/// and the reason a registry row is never orphaned wiring nobody can see.
pub fn unlink_workspace(pool: &DbPool, workspace_id: &str) -> Result<bool, AppError> {
    timed_query!("dev_registries", "dev_registries::unlink_workspace", {
        let mut conn = pool.get()?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let registry_id: Option<String> = tx
            .query_row(
                "SELECT registry_id FROM dev_workspace_registries WHERE workspace_id = ?1",
                params![workspace_id],
                |r| r.get("registry_id"),
            )
            .optional()?;
        let Some(registry_id) = registry_id else {
            tx.commit()?;
            return Ok(false);
        };
        tx.execute(
            "DELETE FROM dev_workspace_registries WHERE workspace_id = ?1",
            params![workspace_id],
        )?;
        let still_held: i64 = tx.query_row(
            "SELECT COUNT(*) AS n FROM dev_workspace_registries WHERE registry_id = ?1",
            params![registry_id],
            |r| r.get("n"),
        )?;
        if still_held == 0 {
            tx.execute(
                "DELETE FROM dev_registries WHERE id = ?1",
                params![registry_id],
            )?;
        }
        tx.commit()?;
        drop(conn);
        sync_knowledge_root(pool)?;
        Ok(true)
    })
}

/// One-time adoption of the browser blob: write whatever the client still holds
/// and return the resulting wiring.
///
/// Refuses nothing and aborts on nothing. A registry the import cannot store
/// (two entries claiming one working copy, say) is logged and skipped, because
/// the alternative is an import that fails whole and leaves the operator with
/// a store that reads empty and a blob nobody will look at again.
pub fn import(
    pool: &DbPool,
    registries: &[DevRegistryInput],
    links_in: &[WorkspaceRegistryLink],
) -> Result<RegistryLinkSnapshot, AppError> {
    for input in registries {
        if let Err(e) = upsert(pool, input) {
            tracing::warn!(
                registry_id = %input.id,
                error = %e,
                "registry import: skipping a registry the store refused",
            );
        }
    }
    for link in links_in {
        if let Err(e) = link_workspace(pool, &link.workspace_id, &link.registry_id) {
            tracing::warn!(
                workspace_id = %link.workspace_id,
                registry_id = %link.registry_id,
                error = %e,
                "registry import: skipping a hold the store refused",
            );
        }
    }
    snapshot(pool)
}

// ---------------------------------------------------------------------------
// The two things every write has to keep true
// ---------------------------------------------------------------------------

/// Mirror [`knowledge_root`] into `app_settings` for the RUNNER.
///
/// The consult lane runs inside executions that have no frontend at all — a
/// schedule firing at 3am has no window to ask — so one scalar crosses into
/// settings, and only one: the path. The key is
/// `settings_keys::KNOWLEDGE_REGISTRY_ROOT`, unchanged, so
/// `engine::knowledge_consult` reads exactly what it always read.
pub fn sync_knowledge_root(pool: &DbPool) -> Result<(), AppError> {
    let key = crate::settings_keys::KNOWLEDGE_REGISTRY_ROOT;
    match knowledge_root(pool)? {
        Some(path) => crate::repos::core::settings::set(pool, key, &path),
        None => crate::repos::core::settings::delete(pool, key).map(|_| ()),
    }
}

/// Register a registry's working copy as a dev project, so a session can be
/// dispatched into it.
///
/// Three properties, each deliberate:
///
/// - **Only when the directory exists.** `register_project` writes a
///   `.personas/project.json` marker and creates the folder to do it. On the
///   GitHub path the clone has not happened yet, and creating the destination
///   would leave `git clone` refusing a non-empty directory.
/// - **Idempotent on the path.** The identity door returns the existing row for
///   a path it already knows, so a second workspace holding the same registry
///   FINDS that project rather than failing `root_path UNIQUE`.
/// - **Best effort.** A read-only checkout, or one carrying another project's
///   identity marker, must not make the registry unwireable. The failure is a
///   warning: the link is the operator's act and the project row is a
///   convenience for dispatch.
fn ensure_registry_project(pool: &DbPool, id: &str, clone_path: &str, full_name: &str) {
    if clone_path.is_empty() || !std::path::Path::new(clone_path).is_dir() {
        return;
    }
    let name = if full_name.trim().is_empty() {
        id
    } else {
        full_name.trim()
    };
    match crate::project_identity::register_project(
        pool, name, clone_path, None, None, None, None, None,
    ) {
        Ok(project) => match mark_as_registry(pool, &project.id) {
            Ok(true) => tracing::info!(
                registry_id = %id,
                project_id = %project.id,
                clone_path = %clone_path,
                "registry checkout adopted as a project - sessions can be dispatched into it",
            ),
            Ok(false) => {}
            Err(e) => {
                tracing::warn!(project_id = %project.id, error = %e, "registry project: could not stamp kind");
            }
        },
        Err(e) => {
            tracing::warn!(
                registry_id = %id,
                clone_path = %clone_path,
                error = %e,
                "registry project: the checkout could not be registered - dispatch into it will not be offered",
            );
        }
    }
}

/// Stamp an already-registered project as a registry checkout: `kind` says what
/// it is, `enabled = 0` keeps every trigger off it, and `workspace_id = NULL`
/// keeps it out of the territory a workspace draws.
///
/// Create-then-stamp rather than a widened `register_project` signature: that
/// function is at its argument limit and is called from eight places that know
/// nothing about registries.
///
/// `Ok(true)` when the row FLIPPED. The `kind <> ?2` guard makes the write
/// idempotent, so the count is the only thing that can tell "we just adopted a
/// checkout" from "it was already ours" — and the first is worth a log line
/// while the second is noise on every link.
fn mark_as_registry(pool: &DbPool, project_id: &str) -> Result<bool, AppError> {
    timed_query!("dev_projects", "dev_projects::mark_as_registry", {
        let conn = pool.get()?;
        let changed = conn.execute(
            "UPDATE dev_projects
                SET kind = ?2, enabled = 0, workspace_id = NULL,
                    updated_at = ?3
              WHERE id = ?1 AND kind <> ?2",
            params![
                project_id,
                PROJECT_KIND_REGISTRY,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        Ok(changed > 0)
    })
}

/// The dev project registered for a registry's working copy, if any. Exposed
/// for surfaces that want to reach from a registry to the row that lets it be
/// dispatched into.
pub fn project_for(pool: &DbPool, clone_path: &str) -> Result<Option<DevProject>, AppError> {
    crate::repos::dev::projects::get_project_by_path(pool, clone_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    /// Through the workspaces repo rather than a hand-written INSERT: a
    /// fixture that builds its own row is a fixture that stops matching the
    /// production shape the moment a column is added.
    fn workspace(pool: &DbPool, name: &str) -> String {
        crate::repos::workspaces::org::create_workspace(pool, name, None, None, false)
            .unwrap()
            .id
    }

    fn input(id: &str, clone_path: &str, lanes: &[&str]) -> DevRegistryInput {
        DevRegistryInput {
            id: id.to_string(),
            full_name: id.to_string(),
            url: String::new(),
            default_branch: "main".to_string(),
            credential_id: String::new(),
            clone_path: clone_path.to_string(),
            state: RegistryPairingState::Paired,
            session_id: None,
            lanes: lanes.iter().map(|s| s.to_string()).collect(),
            domains: Vec::new(),
            sha: None,
            paired_at: None,
            error: None,
        }
    }

    /// A fresh directory under the OS temp dir; removed on drop. A registry's
    /// clone path has to EXIST for the project registration to fire, so the
    /// tests that care about that use a real folder.
    struct TempRoot(std::path::PathBuf);
    impl TempRoot {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!(
                "personas_dev_registries_{tag}_{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&p).unwrap();
            Self(p)
        }
        fn s(&self) -> String {
            self.0.to_string_lossy().to_string()
        }
    }
    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn a_registry_round_trips_with_its_inventory() {
        let pool = init_test_db().unwrap();
        let stored = upsert(
            &pool,
            &input("org/reg", "/clones/reg", &["knowledge", "skills"]),
        )
        .expect("upsert");
        assert_eq!(stored.lanes, vec!["knowledge", "skills"]);
        assert_eq!(stored.state, RegistryPairingState::Paired);
        assert_eq!(list(&pool).unwrap().len(), 1);

        // A second upsert is an update, not a second row, and `created_at`
        // survives it.
        let again =
            upsert(&pool, &input("org/reg", "/clones/reg", &["knowledge"])).expect("re-upsert");
        assert_eq!(again.created_at, stored.created_at);
        assert_eq!(again.lanes, vec!["knowledge"]);
        assert_eq!(list(&pool).unwrap().len(), 1);
    }

    /// The rule `syncKnowledgeRootSetting` implemented in TypeScript, now a
    /// single query: lowest id, knowledge lane, non-blank path.
    #[test]
    fn the_knowledge_root_is_the_lowest_id_holder_of_the_knowledge_lane() {
        let pool = init_test_db().unwrap();
        upsert(&pool, &input("org/zeta", "/z", &["knowledge"])).unwrap();
        upsert(&pool, &input("org/alpha", "/a", &["knowledge"])).unwrap();
        assert_eq!(knowledge_root(&pool).unwrap().as_deref(), Some("/a"));

        // A registry with no knowledge lane is not a corpus, whatever else it
        // publishes: pointing the consult lane at it makes every execution walk
        // a directory that is not there.
        let pool2 = init_test_db().unwrap();
        upsert(
            &pool2,
            &input("org/skills-only", "/s", &["skills", "usage"]),
        )
        .unwrap();
        assert_eq!(knowledge_root(&pool2).unwrap(), None);
    }

    /// `json_each` and not a substring scan: a DOMAIN called `knowledge`, or a
    /// lane called `knowledge-archive`, must not be read as the lane.
    #[test]
    fn a_lane_that_merely_contains_the_word_does_not_qualify() {
        let pool = init_test_db().unwrap();
        let mut near = input("org/near", "/n", &["knowledge-archive"]);
        near.domains = vec!["knowledge".to_string()];
        upsert(&pool, &near).unwrap();
        assert_eq!(knowledge_root(&pool).unwrap(), None);
    }

    /// The chokepoint: every mutator leaves `app_settings` agreeing with the
    /// rows, including the unlink that empties them.
    #[test]
    fn the_settings_mirror_follows_every_mutation() {
        let pool = init_test_db().unwrap();
        let key = crate::settings_keys::KNOWLEDGE_REGISTRY_ROOT;
        let ws1 = workspace(&pool, "Alpha");

        upsert(&pool, &input("org/reg", "/clones/reg", &["knowledge"])).unwrap();
        link_workspace(&pool, &ws1, "org/reg").unwrap();
        assert_eq!(
            crate::repos::core::settings::get(&pool, key)
                .unwrap()
                .as_deref(),
            Some("/clones/reg")
        );

        // A corrected clone path moves the pointer with it.
        upsert(&pool, &input("org/reg", "/clones/right", &["knowledge"])).unwrap();
        assert_eq!(
            crate::repos::core::settings::get(&pool, key)
                .unwrap()
                .as_deref(),
            Some("/clones/right")
        );

        // Unlinking the last holder deletes the registry AND clears the key -
        // a stale pointer means executions keep reading a repo the operator
        // believes they disconnected.
        assert!(unlink_workspace(&pool, &ws1).unwrap());
        assert!(list(&pool).unwrap().is_empty());
        assert_eq!(crate::repos::core::settings::get(&pool, key).unwrap(), None);
    }

    #[test]
    fn one_registry_is_held_by_many_workspaces_and_survives_all_but_the_last() {
        let pool = init_test_db().unwrap();
        let ws1 = workspace(&pool, "Alpha");
        let ws2 = workspace(&pool, "Beta");
        upsert(&pool, &input("org/reg", "/clones/reg", &["knowledge"])).unwrap();
        link_workspace(&pool, &ws1, "org/reg").unwrap();
        link_workspace(&pool, &ws2, "org/reg").unwrap();
        let mut both = vec![ws1.clone(), ws2.clone()];
        both.sort();
        assert_eq!(workspaces_on(&pool, "org/reg").unwrap(), both);

        unlink_workspace(&pool, &ws1).unwrap();
        assert_eq!(list(&pool).unwrap().len(), 1, "another workspace holds it");
        assert_eq!(
            registry_for_workspace(&pool, &ws2).unwrap().map(|r| r.id),
            Some("org/reg".to_string())
        );
        assert_eq!(registry_for_workspace(&pool, &ws1).unwrap(), None);
    }

    /// Switching a workspace's registry REPLACES the hold rather than adding
    /// one. The table's primary key is what makes that true; this proves the
    /// upsert speaks it.
    #[test]
    fn a_workspace_holds_at_most_one_registry() {
        let pool = init_test_db().unwrap();
        let ws1 = workspace(&pool, "Alpha");
        upsert(&pool, &input("org/first", "/first", &[])).unwrap();
        upsert(&pool, &input("org/second", "/second", &[])).unwrap();
        link_workspace(&pool, &ws1, "org/first").unwrap();
        link_workspace(&pool, &ws1, "org/second").unwrap();
        assert_eq!(
            registry_for_workspace(&pool, &ws1).unwrap().map(|r| r.id),
            Some("org/second".to_string())
        );
        assert_eq!(links(&pool).unwrap().len(), 1);
    }

    /// The §5 invariant: two workspaces on one registry register ONE project,
    /// with `kind = 'registry'`, switched off, in no workspace.
    #[test]
    fn the_checkout_becomes_one_registry_project_however_often_it_is_linked() {
        let pool = init_test_db().unwrap();
        let root = TempRoot::new("project");
        let ws1 = workspace(&pool, "Alpha");
        let ws2 = workspace(&pool, "Beta");
        upsert(&pool, &input("org/reg", &root.s(), &["knowledge"])).unwrap();
        link_workspace(&pool, &ws1, "org/reg").unwrap();
        link_workspace(&pool, &ws2, "org/reg").unwrap();

        let projects = crate::repos::dev::projects::list_projects(&pool, None).unwrap();
        let registry_projects: Vec<_> = projects
            .iter()
            .filter(|p| p.kind == PROJECT_KIND_REGISTRY)
            .collect();
        assert_eq!(
            registry_projects.len(),
            1,
            "a second hold finds the row, never mints a second"
        );
        let project = registry_projects[0];
        assert!(!project.enabled, "no trigger may start a run in a registry");
        assert_eq!(project.workspace_id, None);
        assert_eq!(
            project_for(&pool, &root.s()).unwrap().map(|p| p.id),
            Some(project.id.clone())
        );
    }

    /// A clone path that does not exist yet (the GitHub path, before the
    /// pairing session has cloned anything) must NOT be registered - creating
    /// the folder to hold a marker is what makes `git clone` refuse it later.
    #[test]
    fn a_checkout_that_is_not_there_yet_registers_nothing() {
        let pool = init_test_db().unwrap();
        let ws1 = workspace(&pool, "Alpha");
        let missing =
            std::env::temp_dir().join(format!("personas_absent_{}", uuid::Uuid::new_v4()));
        upsert(
            &pool,
            &input("org/reg", &missing.to_string_lossy(), &["knowledge"]),
        )
        .unwrap();
        link_workspace(&pool, &ws1, "org/reg").unwrap();
        assert!(crate::repos::dev::projects::list_projects(&pool, None)
            .unwrap()
            .is_empty());
        assert!(!missing.exists(), "the clone destination was not created");
    }

    /// The blob adoption: what the browser held becomes rows, and a second run
    /// is a no-op rather than a duplicate.
    #[test]
    fn the_import_is_idempotent() {
        let pool = init_test_db().unwrap();
        let ws1 = workspace(&pool, "Alpha");
        let registries = vec![input("org/reg", "/clones/reg", &["knowledge"])];
        let held = vec![WorkspaceRegistryLink {
            workspace_id: ws1.clone(),
            registry_id: "org/reg".to_string(),
            linked_at: "2026-09-23T00:00:00Z".to_string(),
        }];

        let first = import(&pool, &registries, &held).unwrap();
        assert_eq!(first.registries.len(), 1);
        assert_eq!(first.links.len(), 1);
        assert_eq!(first.knowledge_root.as_deref(), Some("/clones/reg"));

        let second = import(&pool, &registries, &held).unwrap();
        assert_eq!(second.registries.len(), 1);
        assert_eq!(second.links.len(), 1);
    }

    /// An import that carries one bad entry lands the rest. The alternative is
    /// an all-or-nothing adoption that leaves the operator with an empty store
    /// and a blob nobody will look at again.
    #[test]
    fn a_refused_entry_does_not_take_the_import_with_it() {
        let pool = init_test_db().unwrap();
        let registries = vec![
            input("org/good", "/clones/good", &["knowledge"]),
            // Two registries cannot share one working copy.
            input("org/twin", "/clones/good", &[]),
        ];
        let done = import(&pool, &registries, &[]).unwrap();
        assert_eq!(done.registries.len(), 1);
        assert_eq!(done.registries[0].id, "org/good");
    }

    /// `mapped` is Curator's prerequisite: a registry nobody holds is a row,
    /// not a wiring.
    #[test]
    fn only_a_held_registry_counts_as_mapped() {
        let pool = init_test_db().unwrap();
        let ws1 = workspace(&pool, "Alpha");
        upsert(&pool, &input("org/held", "/held", &[])).unwrap();
        upsert(&pool, &input("org/loose", "/loose", &[])).unwrap();
        assert!(mapped(&pool).unwrap().is_empty());
        link_workspace(&pool, &ws1, "org/held").unwrap();
        let rows = mapped(&pool).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "org/held");
    }
}
