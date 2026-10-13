//! THIS device's `DeviceSnapshot`, built from the sources the Monitor itself
//! reads, so a peer's strip shows exactly what this device's own board shows:
//!
//! | field | source |
//! |---|---|
//! | `host.cpu_share` / `ram_share` | the app's `SystemMetricsSampler` (the footer gauge's) |
//! | `host.gpu_share` | `None`: WP1's GPU reader is per-process and owned by its sampler; no whole-host value exists |
//! | `running` | live fleet sessions + persona executions that have started |
//! | `queued` / `queue` | `fleet_queue_snapshot` (held `not_before` entries included, A3) |
//! | `agents` | every persona, its project switch (`home_team_id` -> `dev_projects.team_id`), the dominant axis of its newest measured run, and whether a run of it is live |
//!
//! The engine stamps `peer_id`, `display_name` and `sent_at_ms`.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::commands::fleet::queue::FleetQueueEntry;
use crate::commands::fleet::registry::{is_live_state, registry};
use crate::db::models::{
    DeviceAgent, DeviceHostLoad, DeviceQueueEntry, DeviceSnapshot, Persona, ResourceAxis,
};
use crate::db::DbPool;
use crate::engine::p2p::mesh::DeviceSnapshotProvider;
use crate::error::AppError;
use crate::AppState;

/// The provider installed on `NetworkService::mesh` at boot.
pub struct AppSnapshotProvider {
    app: AppHandle,
}

impl AppSnapshotProvider {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

#[async_trait::async_trait]
impl DeviceSnapshotProvider for AppSnapshotProvider {
    async fn build(&self) -> Result<DeviceSnapshot, AppError> {
        let state = self
            .app
            .try_state::<Arc<AppState>>()
            .ok_or_else(|| AppError::Internal("device snapshot: app state not ready".into()))?
            .inner()
            .clone();
        let host = host_load(&state);
        let queue = crate::commands::fleet::queue::fleet_queue_snapshot(
            self.app.clone(),
            self.app.state::<Arc<AppState>>(),
        )
        .await?;

        // Live fleet sessions, once: the count, the persona set, and the
        // title/project label each queued entry is shown with.
        let sessions = registry().list_dto();
        let live_fleet = sessions.iter().filter(|s| is_live_state(s.state)).count();
        let mut running_personas: HashSet<String> = sessions
            .iter()
            .filter(|s| is_live_state(s.state))
            .filter_map(|s| s.persona_id.clone())
            .collect();
        let labels: HashMap<&str, (Option<String>, String)> = sessions
            .iter()
            .map(|s| {
                let title = s.title.clone().or_else(|| s.name.clone());
                (s.id.as_str(), (title, s.project_label.clone()))
            })
            .collect();
        let queue_entries = queue
            .entries
            .iter()
            .map(|e| queue_entry(e, labels.get(e.session_id.as_str())))
            .collect();

        let db = state.db.clone();
        let rows = tokio::task::spawn_blocking(move || read_rows(&db))
            .await
            .map_err(|e| AppError::Internal(format!("device snapshot read: {e}")))??;
        let running_executions = rows.running_execution_personas.len();
        running_personas.extend(rows.running_execution_personas.iter().cloned());

        Ok(DeviceSnapshot {
            // Stamped by the engine.
            peer_id: String::new(),
            display_name: String::new(),
            sent_at_ms: 0.0,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            host,
            running: u32::try_from(live_fleet + running_executions).unwrap_or(u32::MAX),
            queued: queue.queued,
            agents: agents(&rows, &running_personas),
            queue: queue_entries,
        })
    }
}

/// Whole-host CPU and RAM as shares of capacity. The sampler's first reading
/// has no CPU delta yet (`sample_valid: false`); it reads as 0 then, and the
/// next tick is real.
fn host_load(state: &AppState) -> DeviceHostLoad {
    let m = state
        .system_metrics
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .sample();
    DeviceHostLoad {
        cpu_share: (f64::from(m.cpu_percent) / 100.0).clamp(0.0, 1.0),
        ram_share: (f64::from(m.mem_used_percent) / 100.0).clamp(0.0, 1.0),
        gpu_share: None,
    }
}

/// One queued fleet entry as a peer reads it. A held entry (`not_before`
/// still ahead) is included like any other: it is queued here.
fn queue_entry(e: &FleetQueueEntry, label: Option<&(Option<String>, String)>) -> DeviceQueueEntry {
    let (title, project) = match label {
        Some((title, project)) => (title.clone(), Some(project.clone())),
        None => (None, None),
    };
    DeviceQueueEntry {
        session_id: e.session_id.clone(),
        title: title.unwrap_or_else(|| "Queued session".to_string()),
        project_label: project.filter(|p| !p.trim().is_empty()),
        rank: e.rank,
        machine_units: e.machine_units,
        gpu: e.gpu,
    }
}

/// The three facts of a project an agent line needs.
pub(crate) struct ProjectSwitch {
    pub id: String,
    pub team_id: Option<String>,
    pub enabled: bool,
}

/// The database half of a snapshot, read on a blocking thread.
pub(crate) struct Rows {
    pub personas: Vec<Persona>,
    pub projects: Vec<ProjectSwitch>,
    pub dominant: HashMap<String, ResourceAxis>,
    /// The persona of every execution that has STARTED (a queued execution
    /// is not running).
    pub running_execution_personas: Vec<String>,
}

fn read_rows(db: &DbPool) -> Result<Rows, AppError> {
    let running = crate::db::repos::execution::executions::get_running_lean(db)?
        .into_iter()
        .filter(|r| r.started_at.is_some())
        .map(|r| r.persona_id)
        .collect();
    Ok(Rows {
        personas: crate::db::repos::core::personas::get_all_lean(db)?,
        projects: crate::db::repos::dev_tools::list_projects(db, None)?
            .into_iter()
            .map(|p| ProjectSwitch {
                id: p.id,
                team_id: p.team_id,
                enabled: p.enabled,
            })
            .collect(),
        dominant: crate::db::repos::resources::run_resources::latest_dominant_by_persona(db)?,
        running_execution_personas: running,
    })
}

/// Every persona as a `DeviceAgent`. The project is the one the run gate uses
/// (`personas.home_team_id = dev_projects.team_id`); when several projects
/// share the team, a switched-OFF one wins, exactly as
/// `persona_project_disabled` decides that the persona may not run.
pub(crate) fn agents(rows: &Rows, running: &HashSet<String>) -> Vec<DeviceAgent> {
    let mut by_team: HashMap<&str, &ProjectSwitch> = HashMap::new();
    for project in &rows.projects {
        let Some(team) = project.team_id.as_deref() else {
            continue;
        };
        match by_team.get(team) {
            Some(existing) if !existing.enabled || project.enabled => {}
            _ => {
                by_team.insert(team, project);
            }
        }
    }
    let mut out: Vec<DeviceAgent> = rows
        .personas
        .iter()
        .map(|p| {
            let project = p
                .home_team_id
                .as_deref()
                .and_then(|team| by_team.get(team).copied());
            DeviceAgent {
                persona_id: p.id.clone(),
                name: p.name.clone(),
                enabled: p.enabled,
                project_id: project.map(|pr| pr.id.clone()),
                project_enabled: project.map(|pr| pr.enabled),
                dominant: rows.dominant.get(&p.id).copied(),
                running: running.contains(&p.id),
            }
        })
        .collect();
    out.sort_by_key(|a| a.name.to_lowercase());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(id: &str, team: Option<&str>, enabled: bool) -> ProjectSwitch {
        ProjectSwitch {
            id: id.into(),
            team_id: team.map(str::to_string),
            enabled,
        }
    }

    fn persona(id: &str, team: Option<&str>, enabled: bool) -> Persona {
        Persona {
            id: id.into(),
            name: id.into(),
            home_team_id: team.map(str::to_string),
            enabled,
            ..Persona::default()
        }
    }

    #[test]
    fn agents_carry_the_project_switch_dominant_and_running() {
        let rows = Rows {
            personas: vec![
                persona("writer", Some("t1"), true),
                persona("auditor", Some("t2"), false),
                persona("loner", None, true),
            ],
            projects: vec![
                project("p-on", Some("t1"), true),
                project("p-off", Some("t2"), false),
                // A second project on t2 that is ON: the OFF one still wins,
                // because the run gate refuses on any switched-off home.
                project("p-on2", Some("t2"), true),
            ],
            dominant: HashMap::from([("writer".to_string(), ResourceAxis::Ram)]),
            running_execution_personas: vec![],
        };
        let running = HashSet::from(["writer".to_string()]);
        let agents = agents(&rows, &running);
        let by_id = |id: &str| agents.iter().find(|a| a.persona_id == id).unwrap();

        let w = by_id("writer");
        assert_eq!(w.project_id.as_deref(), Some("p-on"));
        assert_eq!(w.project_enabled, Some(true));
        assert_eq!(w.dominant, Some(ResourceAxis::Ram));
        assert!(w.running && w.enabled);

        let a = by_id("auditor");
        assert_eq!(a.project_id.as_deref(), Some("p-off"));
        assert_eq!(a.project_enabled, Some(false));
        assert_eq!(a.dominant, None, "no measured run yet is null, not a guess");
        assert!(!a.running && !a.enabled);

        let l = by_id("loner");
        assert_eq!(l.project_id, None);
        assert_eq!(l.project_enabled, None, "no project is null, never false");
    }
}
