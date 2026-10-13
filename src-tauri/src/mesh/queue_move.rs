//! Moving a QUEUED local fleet entry to a paired device (spark device-mesh,
//! decision D3: cancel-after-accept).
//!
//! ```text
//!  entry QUEUED here?            no  -> Validation  not_queued
//!  project has a github_url?     no  -> Validation  no_github_url   (Stage 1 resolves by URL)
//!  peer CONNECTED?               no  -> NetworkOffline peer_offline, and NO job is created:
//!                                       an outbox job would wake later and leave two live copies
//!  remote_exec::dispatch (the ONE fleet_session path; branch minted there)
//!    pending | running  -> cancel the local entry, reason `moved:<peer8>`
//!    refused (or other) -> leave the entry; return the job so the caller reads the reason
//!    queued             -> the exchange died mid-send: the outbox job is cancelled
//!                          and the entry kept (never two copies, never zero)
//! ```
//!
//! Where a queued entry keeps its work: the fleet registry's session row
//! (`FleetSession.args` / `.mode`, as `queue::dispatch_of` replays it). A
//! headless entry's prompt follows `queue::TASK_ARG` (`--fleet-task <task>`);
//! an interactive entry's prompt is its last positional (non-flag) argument,
//! the same test `fleet_spawn_session` uses to tell "with task" from "bare".
//!
//! The decision logic is [`move_queued`] over the [`MovePorts`] seam, so it is
//! tested without a network, an `AppHandle` or the fleet registry;
//! [`AppPorts`] is the one real implementation.

use std::sync::Arc;

use tauri::AppHandle;

use crate::commands::fleet::queue::TASK_ARG;
use crate::commands::fleet::registry::registry;
use crate::commands::fleet::types::{FleetSessionMode, FleetSessionState};
use crate::db::models::{FleetSessionJobPayload, RemoteJob, RemoteJobStatus, RemoteSessionMode};
use crate::error::AppError;
use crate::AppState;

/// What a queued entry carries that a dispatch needs.
#[derive(Debug, Clone)]
pub(crate) struct QueuedEntry {
    pub cwd: String,
    pub mode: FleetSessionMode,
    pub args: Vec<String>,
    pub persona_id: Option<String>,
}

/// The project facts a move needs.
#[derive(Debug, Clone)]
pub(crate) struct ProjectRef {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub github_url: Option<String>,
}

/// Everything [`move_queued`] reads or does outside itself.
#[async_trait::async_trait]
pub(crate) trait MovePorts: Send + Sync {
    /// The entry, ONLY while it is queued here.
    fn queued_entry(&self, session_id: &str) -> Option<QueuedEntry>;
    fn projects(&self) -> Result<Vec<ProjectRef>, AppError>;
    async fn is_connected(&self, peer_id: &str) -> bool;
    /// The one remote dispatch path (`remote_exec::dispatch`).
    async fn dispatch(
        &self,
        peer_id: &str,
        payload: FleetSessionJobPayload,
    ) -> Result<RemoteJob, AppError>;
    /// Cancel the local entry with a stated reason.
    fn cancel_entry(&self, session_id: &str, reason: &str) -> Result<(), AppError>;
    /// Withdraw an outbound job still waiting in the outbox.
    fn withdraw_job(&self, job_id: &str, reason: &str) -> Result<RemoteJob, AppError>;
}

/// The prompt a queued entry would start with, or `None`.
pub(crate) fn prompt_of(mode: FleetSessionMode, args: &[String]) -> Option<String> {
    let prompt = match mode {
        FleetSessionMode::Headless => args
            .iter()
            .position(|a| a == TASK_ARG)
            .and_then(|i| args.get(i + 1))
            .cloned(),
        FleetSessionMode::Interactive => args.iter().rev().find(|a| !a.starts_with('-')).cloned(),
    };
    prompt.filter(|p| !p.trim().is_empty())
}

/// `C:\Repo\` and `c:/repo` are one directory on Windows.
fn norm_path(p: &str) -> String {
    let p = p.trim().replace('\\', "/");
    let p = p.trim_end_matches('/').to_string();
    if cfg!(windows) {
        p.to_ascii_lowercase()
    } else {
        p
    }
}

/// The project whose checkout contains `cwd` (the deepest root wins, so a
/// nested project beats its parent).
pub(crate) fn project_for_cwd<'a>(projects: &'a [ProjectRef], cwd: &str) -> Option<&'a ProjectRef> {
    let cwd = norm_path(cwd);
    projects
        .iter()
        .filter(|p| {
            let root = norm_path(&p.root_path);
            !root.is_empty() && (cwd == root || cwd.starts_with(&format!("{root}/")))
        })
        .max_by_key(|p| norm_path(&p.root_path).len())
}

/// Move one queued entry to `peer_id`. See the module docs for every branch.
pub(crate) async fn move_queued(
    ports: &dyn MovePorts,
    session_id: &str,
    peer_id: &str,
) -> Result<RemoteJob, AppError> {
    let session_id = session_id.trim();
    let peer_id = peer_id.trim();
    let entry = ports.queued_entry(session_id).ok_or_else(|| {
        AppError::Validation(format!(
            "not_queued: session {session_id} is not waiting in this device's queue"
        ))
    })?;
    let projects = ports.projects()?;
    let project = project_for_cwd(&projects, &entry.cwd).ok_or_else(|| {
        AppError::Validation(format!(
            "no_project: {} is not inside a project on this device",
            entry.cwd
        ))
    })?;
    // Stage 1 has no shared project id: the other device finds the project
    // by this URL, so a project without one cannot move.
    let github_url = project.github_url.clone().unwrap_or_default();
    personas_core::validation::require_non_empty(
        &format!("no_github_url: the GitHub URL of project {}", project.name),
        &github_url,
    )?;
    let prompt = prompt_of(entry.mode, &entry.args).ok_or_else(|| {
        AppError::Validation(format!(
            "no_prompt: session {session_id} carries no task to move"
        ))
    })?;
    if !ports.is_connected(peer_id).await {
        return Err(AppError::NetworkOffline(format!(
            "peer_offline: that device is not connected. A move needs it online, or the \
             work would run twice when it wakes. Session {session_id} stays queued here."
        )));
    }
    let payload = FleetSessionJobPayload {
        project_id: project.id.clone(),
        github_url,
        project_name: project.name.clone(),
        prompt,
        mode: match entry.mode {
            FleetSessionMode::Interactive => RemoteSessionMode::Interactive,
            FleetSessionMode::Headless => RemoteSessionMode::Headless,
        },
        // Minted by the dispatch path, never by the caller.
        branch: String::new(),
        persona_id: entry.persona_id.clone(),
    };
    let job = ports.dispatch(peer_id, payload).await?;
    match job.status {
        RemoteJobStatus::Pending | RemoteJobStatus::Running => {
            let reason = format!("moved:{}", super::peer8(peer_id));
            ports.cancel_entry(session_id, &reason).map_err(|e| {
                tracing::error!(session_id, job_id = %job.id, error = %e, "queue move: the peer took it but the local entry could not be cancelled");
                AppError::Validation(format!(
                    "moved_but_not_cancelled: the other device accepted job {} but session \
                     {session_id} could not be cancelled here ({e}); cancel it by hand",
                    job.id
                ))
            })?;
            Ok(job)
        }
        RemoteJobStatus::Queued => {
            // The send got no answer: the job fell back to the outbox and
            // would be sent on the next link-up while the entry still waits
            // here. Withdraw it; the entry stays the one copy.
            ports.withdraw_job(
                &job.id,
                "Move abandoned: the other device stopped answering. The entry stayed queued here.",
            )
        }
        // Refused (with the peer's reason) or otherwise not taken: the entry
        // stays exactly where it was.
        _ => Ok(job),
    }
}

/// The real ports: the fleet registry, the projects table, the device link,
/// `remote_exec::dispatch` and the reason-carrying queue cancel.
pub(crate) struct AppPorts {
    pub app: AppHandle,
    pub state: Arc<AppState>,
}

#[async_trait::async_trait]
impl MovePorts for AppPorts {
    fn queued_entry(&self, session_id: &str) -> Option<QueuedEntry> {
        registry()
            .dto_of(session_id)
            .filter(|s| s.state == FleetSessionState::Queued)
            .map(|s| QueuedEntry {
                cwd: s.cwd,
                mode: s.mode,
                args: s.args,
                persona_id: s.persona_id,
            })
    }

    fn projects(&self) -> Result<Vec<ProjectRef>, AppError> {
        Ok(
            crate::db::repos::dev_tools::list_projects(&self.state.db, None)?
                .into_iter()
                .map(|p| ProjectRef {
                    id: p.id,
                    name: p.name,
                    root_path: p.root_path,
                    github_url: p.github_url,
                })
                .collect(),
        )
    }

    async fn is_connected(&self, peer_id: &str) -> bool {
        match self.state.network.as_ref() {
            Some(net) => net.connections.is_connected(peer_id).await,
            None => false,
        }
    }

    async fn dispatch(
        &self,
        peer_id: &str,
        payload: FleetSessionJobPayload,
    ) -> Result<RemoteJob, AppError> {
        crate::commands::fleet::remote_exec::dispatch(&self.state, peer_id, payload).await
    }

    fn cancel_entry(&self, session_id: &str, reason: &str) -> Result<(), AppError> {
        crate::commands::fleet::queue::cancel_dispatch_with_reason(&self.app, session_id, reason)
    }

    fn withdraw_job(&self, job_id: &str, reason: &str) -> Result<RemoteJob, AppError> {
        use crate::db::repos::resources::remote_jobs as repo;
        repo::mark_cancelled(&self.state.db, job_id, reason)?;
        repo::get(&self.state.db, job_id)?
            .ok_or_else(|| AppError::NotFound(format!("remote job {job_id}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    const PEER: &str = "PeerXyz123456789";

    /// A scripted world: one queued entry, one project, a link that is up or
    /// down, and a peer that answers with a fixed status.
    struct Fake {
        entry: Option<QueuedEntry>,
        github_url: Option<String>,
        connected: bool,
        answer: RemoteJobStatus,
        dispatched: Mutex<Vec<FleetSessionJobPayload>>,
        cancelled: Mutex<Vec<(String, String)>>,
        withdrawn: Mutex<Vec<String>>,
    }

    impl Fake {
        fn new(answer: RemoteJobStatus) -> Self {
            Self {
                entry: Some(QueuedEntry {
                    cwd: "C:\\code\\personas\\".into(),
                    mode: FleetSessionMode::Headless,
                    args: vec![TASK_ARG.into(), "Reply with MESH-OK".into()],
                    persona_id: Some("persona-1".into()),
                }),
                github_url: Some("https://github.com/o/personas".into()),
                connected: true,
                answer,
                dispatched: Mutex::new(Vec::new()),
                cancelled: Mutex::new(Vec::new()),
                withdrawn: Mutex::new(Vec::new()),
            }
        }
        fn job(&self, status: RemoteJobStatus) -> RemoteJob {
            RemoteJob {
                id: "job-1".into(),
                direction: crate::db::models::RemoteJobDirection::Outbound,
                peer_id: PEER.into(),
                peer_display_name: "Studio".into(),
                kind: "fleet_session".into(),
                instruction: "Fleet session".into(),
                payload_json: None,
                receipt: None,
                mesh_receipt: None,
                status,
                summary: None,
                refusal_reason: (status == RemoteJobStatus::Refused)
                    .then(|| "project_not_found: no project here".into()),
                last_seq: 0,
                created_at: "now".into(),
                updated_at: "now".into(),
                completed_at: None,
            }
        }
    }

    #[async_trait::async_trait]
    impl MovePorts for Fake {
        fn queued_entry(&self, session_id: &str) -> Option<QueuedEntry> {
            (session_id == "s-1").then(|| self.entry.clone()).flatten()
        }
        fn projects(&self) -> Result<Vec<ProjectRef>, AppError> {
            Ok(vec![
                ProjectRef {
                    id: "parent".into(),
                    name: "Code".into(),
                    root_path: "c:/code".into(),
                    github_url: Some("https://github.com/o/code".into()),
                },
                ProjectRef {
                    id: "proj-1".into(),
                    name: "Personas".into(),
                    root_path: "C:/code/personas".into(),
                    github_url: self.github_url.clone(),
                },
            ])
        }
        async fn is_connected(&self, _peer_id: &str) -> bool {
            self.connected
        }
        async fn dispatch(
            &self,
            _peer_id: &str,
            payload: FleetSessionJobPayload,
        ) -> Result<RemoteJob, AppError> {
            self.dispatched.lock().unwrap().push(payload);
            Ok(self.job(self.answer))
        }
        fn cancel_entry(&self, session_id: &str, reason: &str) -> Result<(), AppError> {
            self.cancelled
                .lock()
                .unwrap()
                .push((session_id.into(), reason.into()));
            Ok(())
        }
        fn withdraw_job(&self, job_id: &str, _reason: &str) -> Result<RemoteJob, AppError> {
            self.withdrawn.lock().unwrap().push(job_id.into());
            Ok(self.job(RemoteJobStatus::Cancelled))
        }
    }

    #[tokio::test]
    async fn an_accepted_move_cancels_the_local_entry_as_moved() {
        for answer in [RemoteJobStatus::Running, RemoteJobStatus::Pending] {
            let fake = Fake::new(answer);
            let job = move_queued(&fake, "s-1", PEER).await.expect("moved");
            assert_eq!(job.status, answer);
            assert_eq!(
                fake.cancelled.lock().unwrap().as_slice(),
                &[("s-1".to_string(), "moved:peerxyz1".to_string())]
            );
            let sent = fake.dispatched.lock().unwrap();
            assert_eq!(sent.len(), 1);
            assert_eq!(
                sent[0].project_id, "proj-1",
                "the deepest project root wins"
            );
            assert_eq!(sent[0].github_url, "https://github.com/o/personas");
            assert_eq!(sent[0].prompt, "Reply with MESH-OK");
            assert_eq!(sent[0].mode, RemoteSessionMode::Headless);
            assert_eq!(sent[0].persona_id.as_deref(), Some("persona-1"));
            assert_eq!(sent[0].branch, "", "the dispatch path mints the branch");
        }
    }

    #[tokio::test]
    async fn a_refused_move_keeps_the_entry_and_returns_the_reason() {
        let fake = Fake::new(RemoteJobStatus::Refused);
        let job = move_queued(&fake, "s-1", PEER).await.expect("an answer");
        assert_eq!(job.status, RemoteJobStatus::Refused);
        assert!(job.refusal_reason.unwrap().starts_with("project_not_found"));
        assert!(fake.cancelled.lock().unwrap().is_empty(), "the entry stays");
    }

    #[tokio::test]
    async fn an_offline_peer_gets_no_job_and_the_entry_stays() {
        let mut fake = Fake::new(RemoteJobStatus::Running);
        fake.connected = false;
        let err = move_queued(&fake, "s-1", PEER).await.expect_err("offline");
        assert!(
            matches!(err, AppError::NetworkOffline(ref m) if m.starts_with("peer_offline")),
            "{err:?}"
        );
        assert!(
            fake.dispatched.lock().unwrap().is_empty(),
            "no job was created"
        );
        assert!(fake.cancelled.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_project_without_a_github_url_is_a_validation_error() {
        let mut fake = Fake::new(RemoteJobStatus::Running);
        fake.github_url = Some("  ".into());
        let err = move_queued(&fake, "s-1", PEER).await.expect_err("no url");
        assert!(
            matches!(err, AppError::Validation(ref m) if m.starts_with("no_github_url")),
            "{err:?}"
        );
        assert!(fake.dispatched.lock().unwrap().is_empty());
        assert!(fake.cancelled.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn only_a_queued_entry_can_move() {
        let fake = Fake::new(RemoteJobStatus::Running);
        let err = move_queued(&fake, "s-other", PEER)
            .await
            .expect_err("not queued");
        assert!(
            matches!(err, AppError::Validation(ref m) if m.starts_with("not_queued")),
            "{err:?}"
        );
        assert!(fake.dispatched.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_send_that_fell_back_to_the_outbox_is_withdrawn_and_the_entry_kept() {
        let fake = Fake::new(RemoteJobStatus::Queued);
        let job = move_queued(&fake, "s-1", PEER).await.expect("an answer");
        assert_eq!(job.status, RemoteJobStatus::Cancelled);
        assert_eq!(
            fake.withdrawn.lock().unwrap().as_slice(),
            &["job-1".to_string()]
        );
        assert!(
            fake.cancelled.lock().unwrap().is_empty(),
            "never zero copies"
        );
    }

    #[test]
    fn prompts_are_read_where_each_mode_keeps_them() {
        let h = vec![
            "--model".into(),
            "opus".into(),
            TASK_ARG.into(),
            "do it".into(),
        ];
        assert_eq!(
            prompt_of(FleetSessionMode::Headless, &h).as_deref(),
            Some("do it")
        );
        assert_eq!(prompt_of(FleetSessionMode::Headless, &["x".into()]), None);
        let i = vec![
            "--permission-mode".into(),
            "plan".into(),
            "fix the bug".into(),
        ];
        assert_eq!(
            prompt_of(FleetSessionMode::Interactive, &i).as_deref(),
            Some("fix the bug")
        );
        assert_eq!(
            prompt_of(FleetSessionMode::Interactive, &["--resume".into()]),
            None
        );
    }
}
