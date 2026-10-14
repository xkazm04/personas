//! The `mesh_verb` executor: what THIS device does when a paired device asks
//! it to run one closed verb (spark device-mesh, decision D1).
//!
//! The engine has already checked the sender is paired and the payload parses
//! (`RemoteJobs::accept_request`), and has persisted the job as `running`.
//! Every verb then goes through the door its local twin uses, never a copy:
//!
//! | verb | door |
//! |---|---|
//! | `ping` | none: the receipt carries `"<version> <features>"` |
//! | `persona_set_enabled` | `cloud::remote_commands::apply_enabled` (the project-off refusal and the OFF->ON wake included) |
//! | `project_set_enabled` | `dev_projects::set_enabled` (what `dev_tools_set_project_enabled` calls) |
//! | `queue_reorder` / `queue_cancel` / `queue_start_now` | the `fleet_queue_reorder` / `fleet_queue_cancel` / `fleet_queue_start_now` commands themselves |
//!
//! Every outcome is a [`MeshVerbReceipt`]: `ok` with a detail, or `ok: false`
//! with the reason (`not_found: ...`, `project_off: ...`, `not_queued: ...`).
//! A verb never acts on something this device does not have, and a failure is
//! never reported as a success.

use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::commands::fleet::registry::registry;
use crate::commands::fleet::types::FleetSessionState;
use crate::db::models::{MeshVerbPayload, MeshVerbReceipt};
use crate::db::DbPool;
use crate::engine::p2p::remote_jobs::{RemoteJobAssignment, RemoteJobHandle};
use crate::error::AppError;
use crate::AppState;

/// `RemoteJobExecutor::execute` for `mesh_verb`. Returns at once; the verb
/// runs in a task whose outcome a watcher owns, so a panic still finishes the
/// job (`ok: false`) instead of leaving it `running` on both devices.
pub async fn execute(app: AppHandle, job: RemoteJobAssignment, handle: RemoteJobHandle) {
    let payload = job
        .payload_json
        .as_deref()
        .and_then(|p| serde_json::from_str::<MeshVerbPayload>(p).ok());
    let Some(payload) = payload else {
        // Unreachable past the engine's own check; answered rather than assumed.
        let receipt = refused("unknown", "bad_payload: the verb did not parse");
        if let Err(e) = handle.finish_mesh_verb(&receipt).await {
            tracing::warn!(job_id = %job.job_id, error = %e, "mesh verb: result not recorded");
        }
        return;
    };
    let verb = payload.verb();
    let job_id = job.job_id.clone();
    let inner = tokio::spawn(async move { run(&app, &payload).await });
    tokio::spawn(async move {
        let receipt = match inner.await {
            Ok(receipt) => receipt,
            Err(join) => {
                tracing::error!(job_id = %job_id, panicked = join.is_panic(), error = %join, "mesh verb: the executor died");
                refused(verb, "internal: the verb crashed before it finished")
            }
        };
        tracing::info!(job_id = %job_id, verb = %receipt.verb, ok = receipt.ok, "mesh verb finished");
        if let Err(e) = handle.finish_mesh_verb(&receipt).await {
            tracing::warn!(job_id = %job_id, error = %e, "mesh verb: result not recorded");
        }
    });
}

/// Run one verb on this device and say what happened.
async fn run(app: &AppHandle, payload: &MeshVerbPayload) -> MeshVerbReceipt {
    let verb = payload.verb();
    let Some(state) = app.try_state::<Arc<AppState>>().map(|s| s.inner().clone()) else {
        return refused(verb, "not_ready: this device is still starting");
    };
    let receipt = match payload {
        MeshVerbPayload::Ping => ok(verb, ping_detail()),
        MeshVerbPayload::PersonaSetEnabled { .. } | MeshVerbPayload::ProjectSetEnabled { .. } => {
            let db = state.db.clone();
            let owned = payload.clone();
            match tokio::task::spawn_blocking(move || run_db_verb(&db, &owned)).await {
                Ok(Some(receipt)) => receipt,
                Ok(None) => refused(verb, "internal: not a database verb"),
                Err(e) => refused(verb, &format!("internal: {e}")),
            }
        }
        MeshVerbPayload::QueueReorder { session_ids } => queue_reorder(app, session_ids).await,
        MeshVerbPayload::QueueCancel { session_id } => {
            if let Some(missing) = not_here(session_id) {
                return missing.into_receipt(verb);
            }
            outcome(
                verb,
                crate::commands::fleet::queue::fleet_queue_cancel(
                    app.clone(),
                    app.state::<Arc<AppState>>(),
                    session_id.clone(),
                )
                .await
                .map(|_| "cancelled".to_string()),
            )
        }
        MeshVerbPayload::QueueStartNow { session_id } => {
            if let Some(missing) = not_here(session_id) {
                return missing.into_receipt(verb);
            }
            outcome(
                verb,
                crate::commands::fleet::queue::fleet_queue_start_now(
                    app.clone(),
                    app.state::<Arc<AppState>>(),
                    session_id.clone(),
                )
                .await
                .map(|a| format!("started {}", a.session_id)),
            )
        }
    };
    if receipt.ok && !matches!(payload, MeshVerbPayload::Ping) {
        // A peer just changed something every other device's strip shows.
        if let Some(net) = state.network.as_ref() {
            net.mesh.note_changed();
        }
    }
    receipt
}

/// The database verbs, through the exact doors their local twins use.
/// `None` for every other verb. Synchronous: call it off the async runtime.
pub(crate) fn run_db_verb(pool: &DbPool, payload: &MeshVerbPayload) -> Option<MeshVerbReceipt> {
    let verb = payload.verb();
    match payload {
        MeshVerbPayload::PersonaSetEnabled {
            persona_id,
            enabled,
        } => Some(outcome(
            verb,
            crate::cloud::remote_commands::apply_enabled(pool, persona_id, *enabled).map(|o| {
                let changed = o.result["changed"].as_bool().unwrap_or(false);
                changed_detail(*enabled, changed)
            }),
        )),
        MeshVerbPayload::ProjectSetEnabled {
            project_id,
            enabled,
        } => Some(outcome(
            verb,
            crate::db::repos::dev::projects::set_enabled(pool, project_id, *enabled)
                .map(|changed| changed_detail(*enabled, changed.is_some())),
        )),
        _ => None,
    }
}

/// Reorder this device's queue. Every id must be a QUEUED session here:
/// the reorder command itself ignores unknown ids, which would let a stale
/// peer view report a success that reordered nothing it meant.
async fn queue_reorder(app: &AppHandle, session_ids: &[String]) -> MeshVerbReceipt {
    let verb = "queue_reorder";
    let missing: Vec<&str> = session_ids
        .iter()
        .filter(|id| {
            !matches!(
                registry().session_state(id),
                Some(FleetSessionState::Queued)
            )
        })
        .map(String::as_str)
        .collect();
    if !missing.is_empty() {
        return refused(
            verb,
            &format!(
                "not_found: not queued on this device: {}",
                missing.join(", ")
            ),
        );
    }
    outcome(
        verb,
        crate::commands::fleet::queue::fleet_queue_reorder(
            app.clone(),
            app.state::<Arc<AppState>>(),
            session_ids.to_vec(),
        )
        .await
        .map(|s| format!("{} queued", s.queued)),
    )
}

/// Why a session id does not name something this device has.
struct Missing(String);

impl Missing {
    fn into_receipt(self, verb: &str) -> MeshVerbReceipt {
        refused(verb, &self.0)
    }
}

/// `Some` when the session is unknown here (`not_found`). A known session in
/// another state is left to the queue door, which answers `not queued`.
fn not_here(session_id: &str) -> Option<Missing> {
    registry()
        .session_state(session_id)
        .is_none()
        .then(|| Missing(format!("not_found: no session {session_id} on this device")))
}

/// `"<version> <comma-separated build features>"`, the ping's useful work.
pub fn ping_detail() -> String {
    let features: Vec<&str> = [
        ("desktop", cfg!(feature = "desktop")),
        ("p2p", cfg!(feature = "p2p")),
        ("ml", cfg!(feature = "ml")),
        ("test-automation", cfg!(feature = "test-automation")),
        ("scraper", cfg!(feature = "scraper")),
        ("ollama", cfg!(feature = "ollama")),
    ]
    .into_iter()
    .filter_map(|(name, on)| on.then_some(name))
    .collect();
    format!("{} {}", env!("CARGO_PKG_VERSION"), features.join(","))
}

fn changed_detail(enabled: bool, changed: bool) -> String {
    let to = if enabled { "on" } else { "off" };
    if changed {
        format!("switched {to}")
    } else {
        format!("already {to}")
    }
}

fn ok(verb: &str, detail: String) -> MeshVerbReceipt {
    MeshVerbReceipt {
        verb: verb.to_string(),
        ok: true,
        detail: Some(detail),
    }
}

fn refused(verb: &str, reason: &str) -> MeshVerbReceipt {
    MeshVerbReceipt {
        verb: verb.to_string(),
        ok: false,
        detail: Some(reason.to_string()),
    }
}

/// A door's result as a receipt. The reason keeps the door's own token
/// (`project_off: ...`); a missing row reads `not_found: ...`.
fn outcome(verb: &str, result: Result<String, AppError>) -> MeshVerbReceipt {
    match result {
        Ok(detail) => ok(verb, detail),
        Err(AppError::NotFound(what)) => refused(verb, &format!("not_found: {what}")),
        Err(AppError::Validation(why)) => refused(verb, &why),
        Err(e) => refused(verb, &format!("failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    use crate::db::repos::core::personas as persona_repo;
    use crate::db::repos::dev::projects as project_repo;

    /// A persona made through the real door, switched `enabled`, homed in
    /// `team` when given. Returns its id.
    fn seed_persona(pool: &DbPool, name: &str, enabled: bool, team: Option<&str>) -> String {
        let p = persona_repo::create(
            pool,
            crate::db::models::CreatePersonaInput {
                name: name.into(),
                system_prompt: "Prompt.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: None,
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap();
        persona_repo::set_enabled(pool, &p.id, enabled).unwrap();
        if let Some(team) = team {
            persona_repo::set_home_team(pool, &p.id, team).unwrap();
        }
        p.id
    }

    /// A project with its own team, switched `enabled`. Returns (id, team).
    fn seed_project(pool: &DbPool, name: &str, enabled: bool) -> (String, String) {
        let project = project_repo::create_project(
            pool,
            name,
            &format!("/tmp/{name}"),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let project = crate::db::project_team::ensure_project_team(pool, &project).unwrap();
        project_repo::set_enabled(pool, &project.id, enabled).unwrap();
        (project.id, project.team_id.expect("team linked"))
    }

    fn enabled(pool: &DbPool, id: &str) -> bool {
        crate::db::repos::core::personas::get_by_id(pool, id)
            .unwrap()
            .enabled
    }

    fn persona_verb(id: &str, on: bool) -> MeshVerbPayload {
        MeshVerbPayload::PersonaSetEnabled {
            persona_id: id.into(),
            enabled: on,
        }
    }

    /// `persona_set_enabled` IS `apply_enabled`: it switches, reports a
    /// no-op as a no-op, refuses a persona whose project is off with the same
    /// `project_off` token, and answers an unknown persona `not_found`.
    #[test]
    fn persona_set_enabled_reuses_apply_enabled_including_project_off() {
        let pool = init_test_db().unwrap();
        let (_, team_off) = seed_project(&pool, "Gated", false);
        let free = seed_persona(&pool, "Free", false, None);
        let homed = seed_persona(&pool, "Homed", false, Some(&team_off));

        let r = run_db_verb(&pool, &persona_verb(&free, true)).unwrap();
        assert!(r.ok, "{r:?}");
        assert_eq!(r.verb, "persona_set_enabled");
        assert_eq!(r.detail.as_deref(), Some("switched on"));
        assert!(enabled(&pool, &free));
        let again = run_db_verb(&pool, &persona_verb(&free, true)).unwrap();
        assert_eq!(again.detail.as_deref(), Some("already on"));

        let off = run_db_verb(&pool, &persona_verb(&homed, true)).unwrap();
        assert!(!off.ok);
        assert_eq!(off.detail.as_deref(), Some("project_off: Gated"));
        assert!(!enabled(&pool, &homed), "a refused verb changes nothing");
        // Switching OFF is never refused by the project gate.
        assert!(run_db_verb(&pool, &persona_verb(&homed, false)).unwrap().ok);

        let ghost = run_db_verb(&pool, &persona_verb("ghost", false)).unwrap();
        assert!(!ghost.ok);
        assert!(
            ghost
                .detail
                .as_deref()
                .unwrap_or_default()
                .starts_with("not_found"),
            "{ghost:?}"
        );

        // The same refusal the cloud verb gives, token for token.
        match crate::cloud::remote_commands::apply_enabled(&pool, &homed, true) {
            Err(AppError::Validation(why)) => assert_eq!(off.detail.as_deref(), Some(why.as_str())),
            other => panic!("apply_enabled should refuse project_off: {other:?}"),
        }
    }

    #[test]
    fn project_set_enabled_switches_and_refuses_an_unknown_project() {
        let pool = init_test_db().unwrap();
        let (proj, _) = seed_project(&pool, "Proj", false);
        let on = MeshVerbPayload::ProjectSetEnabled {
            project_id: proj,
            enabled: true,
        };
        let r = run_db_verb(&pool, &on).unwrap();
        assert!(r.ok && r.detail.as_deref() == Some("switched on"), "{r:?}");
        let ghost = MeshVerbPayload::ProjectSetEnabled {
            project_id: "ghost".into(),
            enabled: true,
        };
        let r = run_db_verb(&pool, &ghost).unwrap();
        assert!(
            !r.ok
                && r.detail
                    .as_deref()
                    .unwrap_or_default()
                    .starts_with("not_found")
        );
        assert!(run_db_verb(&pool, &MeshVerbPayload::Ping).is_none());
    }

    #[test]
    fn an_unknown_queue_session_is_not_found_before_any_door() {
        let missing = not_here("no-such-session").expect("unknown here");
        let r = missing.into_receipt("queue_cancel");
        assert!(!r.ok);
        assert!(r.detail.unwrap().starts_with("not_found"));
    }

    #[test]
    fn ping_names_the_version_and_the_features() {
        let d = ping_detail();
        assert!(d.starts_with(env!("CARGO_PKG_VERSION")), "{d}");
        assert!(d.contains("p2p"), "this build has the mesh: {d}");
    }
}
