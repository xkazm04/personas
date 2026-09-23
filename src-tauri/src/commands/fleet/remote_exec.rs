//! The fleet's remote executor: a `fleet_session` job that a paired device
//! sent here runs as an ORDINARY fleet session, and this module is the whole
//! seam between the two.
//!
//! ```text
//!  originating device                     THIS device (running)
//!  dispatch()  ── fleet_session job ──▶  admit()    project lookup, cheap git checks
//!                                        execute()  worktree on the minted branch,
//!                                                   queue::admit(origin = Remote)
//!                                        on_state() one mirror + one note per transition
//!                                        forward_output()  lossy tail, never blocks
//!                                        command()  send_input / kill / wake
//!  harvest (companion)  ◀── receipt ──   completion: rev-list, push, ls-remote
//! ```
//!
//! ## Where the session authors: an isolated worktree, never the project root
//!
//! The session works on the branch the originator minted. It is checked out in
//! its own `git worktree` under the app data directory, exactly as the
//! unattended workers do (`personas_engine::unattended_worktree`, whose module
//! doc records the night a `git checkout -b` in the shared checkout left the
//! operator's tree and dev server on an agent's branch). A branch switch is a
//! whole-checkout event; a machine that someone else also works on is exactly
//! where a remote session must not make one. The worktree is retired on
//! completion when it is clean, and kept when it is not.
//!
//! ## The link table
//!
//! [`RemoteLinks`] maps a fleet session id to the job that spawned it. It is
//! created AFTER `queue::admit` returns (create-then-stamp): `DispatchRequest`
//! and `FleetSessionInner` each have ~20 literal construction sites, and two
//! optional fields on every one of them would buy nothing that a side table
//! owned by this module does not. `FleetSessionInner::to_dto` reads the origin
//! from here; `persist` stamps it onto the durable row and restores it on boot.
//!
//! Lock order: the registry's session map, THEN this table. Nothing here calls
//! into the registry while holding the table's lock.
//!
//! ## Liveness
//!
//! The originator reads a running session whose last mirror is older than
//! 45 s as `unknown` (design decision D8). A session can sit in one state far
//! longer than that, so a per-job worker re-mirrors every
//! [`HEARTBEAT_EVERY`] besides the one mirror each state transition sends. The
//! same worker delivers the progress notes and the completion, in order, so a
//! note can never land after the job it belongs to has finished.
//!
//! A lite build (`--features desktop`) has no device link: nothing here is
//! ever admitted, and only the provenance half (`origin_of`, `restore_from`,
//! `carry_over`) runs, for tiles restored from a build that had one.
#![cfg_attr(not(feature = "p2p"), allow(dead_code))]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Duration;

use crate::db::models::{
    DevProject, FleetSessionJobPayload, FleetSessionJobReceipt, RemoteSessionMode,
};
use crate::db::DbPool;
use crate::error::AppError;

use super::registry::registry;
use super::types::{state_to_token, FleetSession};

/// How often a running remote session is re-mirrored when nothing changed.
/// A third of the originator's 45 s liveness window, so two lost frames in a
/// row still keep the tile honest.
pub const HEARTBEAT_EVERY: Duration = Duration::from_secs(15);
/// `run_label` prefix of every session this module admits.
pub const RUN_LABEL_PREFIX: &str = "remote:";
/// Ceiling on the completion push. A push that prompts for credentials would
/// otherwise hold the job `running` forever.
const PUSH_TIMEOUT: Duration = Duration::from_secs(120);
/// Ceiling on every other git call (rev-list, ls-remote, fetch, worktree add).
const GIT_TIMEOUT: Duration = Duration::from_secs(60);

// -- Pure rules ------------------------------------------------------------

/// `https://github.com/Owner/Repo.git/` and `https://github.com/owner/repo`
/// name the same repository: compared case-insensitively without a trailing
/// slash or `.git` suffix. (The same rule as `app_master_hire`'s private copy.)
pub fn normalize_repo_url(u: &str) -> String {
    u.trim()
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

/// The local project a payload names: by `github_url` first, then by id, then
/// by exact name (design decision D4). `None` is the `project_not_found`
/// refusal.
pub fn resolve_project<'a>(
    projects: &'a [DevProject],
    payload: &FleetSessionJobPayload,
) -> Option<&'a DevProject> {
    let url = normalize_repo_url(&payload.github_url);
    if !url.is_empty() {
        if let Some(p) = find_by_github_url(projects, &url) {
            return Some(p);
        }
    }
    let id = payload.project_id.trim();
    if let Some(p) = projects.iter().find(|p| !id.is_empty() && p.id == id) {
        return Some(p);
    }
    let name = payload.project_name.trim();
    projects.iter().find(|p| !name.is_empty() && p.name == name)
}

/// The project whose git remote is `url` (already normalized or not).
pub fn find_by_github_url<'a>(projects: &'a [DevProject], url: &str) -> Option<&'a DevProject> {
    let url = normalize_repo_url(url);
    if url.is_empty() {
        return None;
    }
    projects.iter().find(|p| {
        p.github_url
            .as_deref()
            .is_some_and(|g| normalize_repo_url(g) == url)
    })
}

/// Up to eight lowercase alphanumerics of an id, for a readable branch.
fn short8(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>()
        .to_ascii_lowercase()
}

/// The branch a dispatch works on: `remote/<origin peer short8>/<job short8>`.
/// Minted on the ORIGINATING device, never taken from the caller.
pub fn mint_branch(origin_peer_id: &str, job_key: &str) -> String {
    format!("remote/{}/{}", short8(origin_peer_id), short8(job_key))
}

/// The session's opening message: the operator's own task, then the branch
/// rules the receipt depends on. This is a CLI session's first user message,
/// not a prompt the engine's assembler builds, so there is no runtime fence to
/// extend; the text comes from a paired device, which the pairing gate trusts.
pub fn compose_prompt(task: &str, branch: &str, origin_name: &str) -> String {
    format!(
        "{task}\n\n---\nYou were sent this from {origin}. You are working on branch `{branch}`, \
         already checked out in an isolated worktree of this project. Commit your work on this \
         branch. Do not push; the app pushes when you finish. Never switch branches. When the \
         task is complete, end your final message with `FLEET:DONE — <one-line summary>`.",
        task = task.trim(),
        origin = if origin_name.trim().is_empty() {
            "another of your devices"
        } else {
            origin_name.trim()
        },
    )
}

/// One progress note per state transition, in plain words.
pub fn state_note(token: &str, exit_code: Option<i32>) -> String {
    match token {
        "queued" => "queued on this device".into(),
        "spawning" => "starting".into(),
        "running" => "running".into(),
        "awaiting_input" => "waiting for input".into(),
        "idle" => "idle".into(),
        "stale" => "quiet, no recent activity".into(),
        "finished" => "finished".into(),
        "hibernated" => "asleep".into(),
        "exited" => match exit_code {
            Some(code) => format!("exited (code {code})"),
            None => "exited".into(),
        },
        other => other.replace('_', " "),
    }
}

/// The view the ORIGINATING device stores for this session. Partial on
/// purpose: the originator reads the live fields (session id, title, state,
/// reason, last activity) and supplies the identity fields from its own row.
pub fn mirror_view_json(
    dto: &FleetSession,
    github_url: &str,
    project_label: &str,
    now_ms: f64,
) -> String {
    serde_json::json!({
        "sessionId": dto.id,
        "projectLabel": project_label,
        "githubUrl": github_url,
        "title": dto.title.clone().or_else(|| dto.name.clone()),
        "state": state_to_token(dto.state),
        "stateReason": dto.state_reason,
        "mode": super::types::mode_to_token(dto.mode),
        "createdAtMs": dto.created_at_ms as f64,
        "lastActivityMs": dto.last_activity_ms as f64,
        "mirrorAtMs": now_ms,
        "jobStatus": "running",
    })
    .to_string()
}

/// Did the session end the way a finished job does? A clean exit, a session
/// that reached `finished`, or one the ORIGINATOR ended with `kill` (the only
/// way an interactive session ends on purpose) completes the job; anything
/// else fails it.
pub fn ended_well(exit_code: Option<i32>, saw_finished: bool, ended_by_command: bool) -> bool {
    exit_code == Some(0) || saw_finished || ended_by_command
}

/// The one-line summary the originator shows.
pub fn completion_summary(
    project_label: &str,
    exit_code: Option<i32>,
    completed: bool,
    receipt: &FleetSessionJobReceipt,
) -> String {
    let ending = match (completed, exit_code) {
        (true, _) => "finished".to_string(),
        (false, Some(code)) => format!("exited (code {code})"),
        (false, None) => "exited".to_string(),
    };
    let work = match (&receipt.pushed_sha, &receipt.push_error) {
        (Some(sha), None) => format!("branch {} pushed at {}", receipt.branch, sha7(sha)),
        (Some(sha), Some(err)) => format!(
            "branch {} is at {} on the remote, but the last push failed: {err}",
            receipt.branch,
            sha7(sha)
        ),
        (None, Some(err)) => format!("branch {}: {err}", receipt.branch),
        (None, None) => format!("branch {}: nothing pushed", receipt.branch),
    };
    format!("{project_label} {ending}; {work}")
}

/// Refuse a dispatch whose project has no git remote: the work comes back as
/// a pushed branch, so without one nothing could come back. The ONE check,
/// shared by the "Run on" command and Athena's `remote_fleet_dispatch`.
pub fn require_git_remote(payload: &FleetSessionJobPayload) -> Result<(), AppError> {
    // The shared rule decides; only the sentence is ours, because "githubUrl
    // cannot be empty" would not tell the operator why a remote is needed.
    personas_core::validation::require_non_empty("githubUrl", &payload.github_url).map_err(|_| {
        AppError::Validation(format!(
            "\"{}\" needs a git remote to run on another device: the work comes back as a \
             pushed branch. Set the project's GitHub URL first.",
            payload.project_name
        ))
    })
}

/// The first seven characters of a SHA, for prose.
pub fn sha7(sha: &str) -> &str {
    sha.get(..7).unwrap_or(sha)
}

/// The first non-empty line of git's error, without the argv prefix the
/// helper adds (`git [..] failed: `).
fn first_line(err: &str) -> String {
    let body = err.split_once("failed: ").map(|(_, b)| b).unwrap_or(err);
    body.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("git failed")
        .to_string()
}

// -- Git: the receipt and the harvest ----------------------------------------

async fn git(dir: &Path, args: &[&str], limit: Duration) -> Result<String, String> {
    match tokio::time::timeout(limit, crate::engine::git_checkpoint::run_git(dir, args)).await {
        Ok(result) => result,
        Err(_) => Err(format!(
            "git {} failed: timed out after {} s",
            args.first().copied().unwrap_or(""),
            limit.as_secs()
        )),
    }
}

/// The SHA `origin` holds for `branch`, read from `git ls-remote`.
async fn remote_sha(dir: &Path, branch: &str) -> Result<Option<String>, String> {
    let refname = format!("refs/heads/{branch}");
    let out = git(dir, &["ls-remote", "origin", &refname], GIT_TIMEOUT).await?;
    Ok(out.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        match (parts.next(), parts.next()) {
            (Some(sha), Some(r)) if r == refname => Some(sha.to_string()),
            _ => None,
        }
    }))
}

/// Build the receipt for a finished session, on the RUNNING device.
///
/// Commits ahead of `main_branch` are pushed unless `origin` already holds the
/// local head, and `pushed_sha` is whatever `git ls-remote` says afterwards,
/// never what the model claimed.
pub async fn build_receipt(
    dir: &Path,
    main_branch: &str,
    branch: &str,
    session_id: &str,
) -> FleetSessionJobReceipt {
    let mut receipt = FleetSessionJobReceipt {
        session_id: session_id.to_string(),
        branch: branch.to_string(),
        pushed_sha: None,
        push_error: None,
        verified: None,
    };
    let range = format!("{main_branch}..{branch}");
    let ahead = match git(dir, &["rev-list", "--count", &range], GIT_TIMEOUT).await {
        Ok(n) => n.trim().parse::<u64>().unwrap_or(0),
        Err(e) => {
            receipt.push_error = Some(first_line(&e));
            return receipt;
        }
    };
    if ahead == 0 {
        receipt.push_error = Some("no commits".into());
        return receipt;
    }
    let head = git(dir, &["rev-parse", branch], GIT_TIMEOUT).await.ok();
    let on_remote = remote_sha(dir, branch).await.ok().flatten();
    if head.is_none() || on_remote != head {
        if let Err(e) = git(dir, &["push", "-u", "origin", branch], PUSH_TIMEOUT).await {
            receipt.push_error = Some(first_line(&e));
        }
    }
    match remote_sha(dir, branch).await {
        Ok(sha) => receipt.pushed_sha = sha,
        Err(e) => {
            receipt.push_error.get_or_insert_with(|| first_line(&e));
        }
    }
    receipt
}

/// The ORIGINATING device's check: fetch the branch into the local project
/// and ask whether the receipt's commit is really there.
pub async fn verify_pushed(root: &Path, branch: &str, sha: &str) -> bool {
    if let Err(e) = git(root, &["fetch", "origin", branch], PUSH_TIMEOUT).await {
        // Not fatal on its own: an earlier fetch may already hold the commit.
        tracing::debug!(branch, error = %e, "remote harvest: fetch failed");
    }
    let object = format!("{sha}^{{commit}}");
    git(root, &["cat-file", "-e", &object], GIT_TIMEOUT)
        .await
        .is_ok()
}

/// The harvest's verdict for one receipt: `Some(true|false)` when this device
/// has the project (matched by `github_url`) and a SHA was pushed, `None`
/// otherwise. "Could not verify" is not "broken".
pub async fn verify_receipt(
    pool: &DbPool,
    payload: &FleetSessionJobPayload,
    receipt: &FleetSessionJobReceipt,
) -> Option<bool> {
    let sha = receipt.pushed_sha.as_deref()?;
    let projects = crate::db::repos::dev_tools::list_projects(pool, None).ok()?;
    let project = find_by_github_url(&projects, &payload.github_url)?;
    let root = PathBuf::from(&project.root_path);
    if !root.is_dir() {
        return None;
    }
    Some(verify_pushed(&root, &receipt.branch, sha).await)
}

// -- The link table ----------------------------------------------------------

/// What the completion needs to know about the session's work.
#[derive(Debug, Clone)]
pub struct Work {
    /// The project's own checkout (where `git worktree` is administered).
    pub root: PathBuf,
    /// The isolated worktree the session runs in (its `cwd`).
    pub worktree: PathBuf,
    pub main_branch: String,
    pub branch: String,
    pub project_label: String,
    pub github_url: String,
    pub mode: RemoteSessionMode,
}

/// What a state transition asks the executor to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatePlan {
    pub job_id: String,
    /// `Some` exactly when the session just reached the end of its job.
    pub completion: Option<CompletionPlan>,
}

/// Everything the completion reads, snapshotted when it was claimed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompletionPlan {
    pub session_id: String,
    pub saw_finished: bool,
    pub ended_by_command: bool,
}

struct Link {
    job_id: String,
    origin_peer_id: String,
    /// `None` for a link restored after a restart: the provenance survives,
    /// the job does not (the startup sweep failed it).
    work: Option<Work>,
    last_state: Option<String>,
    saw_finished: bool,
    ended_by_command: bool,
    completing: bool,
    #[cfg(feature = "p2p")]
    live: Option<live::Live>,
}

/// Session id → the job that spawned it. See the module doc.
#[derive(Default)]
pub struct RemoteLinks {
    map: Mutex<HashMap<String, Link>>,
    /// Entry count, read without the lock so a LOCAL session's PTY reader pays
    /// one atomic load and nothing else.
    count: AtomicUsize,
}

impl RemoteLinks {
    /// A cache of live wiring, not an invariant: a panic while a guard was
    /// held leaves nothing worth refusing to read.
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Link>> {
        self.map.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn any(&self) -> bool {
        self.count.load(Ordering::Relaxed) > 0
    }

    fn insert(&self, session_id: &str, link: Link) {
        let mut map = self.lock();
        if map.insert(session_id.to_string(), link).is_none() {
            self.count.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn remove(&self, session_id: &str) -> Option<Link> {
        let mut map = self.lock();
        let removed = map.remove(session_id);
        if removed.is_some() {
            self.count.fetch_sub(1, Ordering::Relaxed);
        }
        removed
    }

    /// Register a session this process admitted for `job_id`.
    pub fn link(&self, session_id: &str, job_id: &str, origin_peer_id: &str, work: Work) {
        self.insert(
            session_id,
            Link {
                job_id: job_id.to_string(),
                origin_peer_id: origin_peer_id.to_string(),
                work: Some(work),
                last_state: None,
                saw_finished: false,
                ended_by_command: false,
                completing: false,
                #[cfg(feature = "p2p")]
                live: None,
            },
        );
    }

    /// Put back the provenance of a session restored after a restart. Never
    /// replaces a live link.
    pub fn restore(&self, session_id: &str, job_id: &str, origin_peer_id: &str) {
        if self.lock().contains_key(session_id) {
            return;
        }
        self.insert(
            session_id,
            Link {
                job_id: job_id.to_string(),
                origin_peer_id: origin_peer_id.to_string(),
                work: None,
                last_state: None,
                saw_finished: false,
                ended_by_command: false,
                completing: false,
                #[cfg(feature = "p2p")]
                live: None,
            },
        );
    }

    /// `(remote_job_id, origin_peer_id)` for a dispatched session.
    pub fn origin_of(&self, session_id: &str) -> Option<(String, String)> {
        if !self.any() {
            return None;
        }
        self.lock()
            .get(session_id)
            .map(|l| (l.job_id.clone(), l.origin_peer_id.clone()))
    }

    /// The session currently running `job_id` in this process.
    pub fn session_for_job(&self, job_id: &str) -> Option<String> {
        self.lock()
            .iter()
            .find(|(_, l)| l.job_id == job_id && l.work.is_some())
            .map(|(sid, _)| sid.clone())
    }

    /// Is this session running a remote job in this process?
    pub fn is_running_here(&self, session_id: &str) -> bool {
        self.any()
            && self
                .lock()
                .get(session_id)
                .is_some_and(|l| l.work.is_some() && !l.completing)
    }

    /// The work of a live link.
    pub fn work_of(&self, session_id: &str) -> Option<Work> {
        self.lock().get(session_id).and_then(|l| l.work.clone())
    }

    /// The originator ended the session with `kill`: a deliberate end, which
    /// completes the job rather than failing it.
    pub fn mark_command_kill(&self, session_id: &str) {
        if let Some(l) = self.lock().get_mut(session_id) {
            l.ended_by_command = true;
        }
    }

    /// A wake replaced the session with a new id; the job follows it. The next
    /// state emit on the new id is a transition, so it mirrors at once.
    pub fn carry_over(&self, old_id: &str, new_id: &str) {
        if let Some(mut link) = self.remove(old_id) {
            link.last_state = None;
            self.insert(new_id, link);
        }
    }

    /// Record a state emit and say what it asks for. `None` for a local
    /// session, a restored link, a repeat of the same state, or a session
    /// whose completion is already under way: exactly one plan per transition.
    ///
    /// The job ends when the session exits, or, for a HEADLESS session, when
    /// its turn finished (a headless session holds its stdin open and would
    /// otherwise sit idle forever; the completion then ends its process).
    pub fn observe(&self, session_id: &str, state: &str) -> Option<StatePlan> {
        if !self.any() {
            return None;
        }
        let mut map = self.lock();
        let link = map.get_mut(session_id)?;
        let work = link.work.as_ref()?;
        if link.completing || link.last_state.as_deref() == Some(state) {
            return None;
        }
        link.last_state = Some(state.to_string());
        if state == "finished" {
            link.saw_finished = true;
        }
        let ends =
            state == "exited" || (state == "finished" && work.mode == RemoteSessionMode::Headless);
        let completion = ends.then(|| {
            link.completing = true;
            CompletionPlan {
                session_id: session_id.to_string(),
                saw_finished: link.saw_finished,
                ended_by_command: link.ended_by_command,
            }
        });
        Some(StatePlan {
            job_id: link.job_id.clone(),
            completion,
        })
    }

    /// Claim the completion of a session that vanished from the registry
    /// without an exit (the operator removed its tile). `None` when there is
    /// nothing to claim.
    pub fn claim_vanished(&self, session_id: &str) -> Option<CompletionPlan> {
        let mut map = self.lock();
        let link = map.get_mut(session_id)?;
        if link.completing || link.work.is_none() {
            return None;
        }
        link.completing = true;
        Some(CompletionPlan {
            session_id: session_id.to_string(),
            saw_finished: link.saw_finished,
            ended_by_command: link.ended_by_command,
        })
    }
}

/// The process-wide link table.
pub fn links() -> &'static RemoteLinks {
    static LINKS: OnceLock<RemoteLinks> = OnceLock::new();
    LINKS.get_or_init(RemoteLinks::default)
}

/// `(remote_job_id, origin_peer_id)` of a session a paired device dispatched
/// here; read by `FleetSessionInner::to_dto` and the persistence writer.
pub fn origin_of(session_id: &str) -> Option<(String, String)> {
    links().origin_of(session_id)
}

/// Is `session_id` running a remote job in this process? The headless lane
/// asks, so a remote session's finished turn is settled like a one-shot
/// worker's.
pub fn is_remote(session_id: &str) -> bool {
    links().is_running_here(session_id)
}

/// A wake gave the session a new id; carry the job over to it.
pub fn carry_over(old_id: &str, new_id: &str) {
    links().carry_over(old_id, new_id);
}

/// Boot: restore the provenance of every rehydrated session a paired device
/// had dispatched here, so its tile keeps its "from <device>" chip.
pub fn restore_from(pool: &DbPool) {
    let origins = match crate::db::repos::fleet_sessions::list_remote_origins(pool) {
        Ok(o) => o,
        Err(e) => {
            tracing::warn!(error = %e, "remote sessions: could not read remote origins");
            return;
        }
    };
    for o in origins {
        if registry().session_state(&o.session_id).is_some() {
            links().restore(&o.session_id, &o.remote_job_id, &o.origin_peer_id);
        }
    }
}

/// Retire a finished session's worktree when it is clean. Kept when anything
/// is uncommitted, because that is work, and the branch survives either way.
async fn retire_worktree(work: &Work) {
    if work.worktree == work.root || !work.worktree.is_dir() {
        return;
    }
    match git(&work.worktree, &["status", "--porcelain"], GIT_TIMEOUT).await {
        Ok(s) if s.trim().is_empty() => {}
        Ok(_) => {
            tracing::info!(worktree = %work.worktree.display(), "remote session: worktree kept, it has uncommitted work");
            return;
        }
        Err(e) => {
            tracing::debug!(error = %e, "remote session: worktree status unreadable; kept");
            return;
        }
    }
    // Unlink the borrowed dependency directories FIRST: a forced removal
    // deletes recursively, and walking into a junction would delete the
    // project's real `node_modules`.
    for name in crate::engine::app_master_gates::BORROWED_DEP_DIRS {
        crate::engine::app_master_gates::unlink_borrowed(&work.worktree, name);
    }
    let path = work.worktree.to_string_lossy().to_string();
    if let Err(e) = git(
        &work.root,
        &["worktree", "remove", "--force", &path],
        GIT_TIMEOUT,
    )
    .await
    {
        tracing::debug!(error = %e, "remote session: worktree not retired");
    }
}

#[cfg(feature = "p2p")]
pub use live::{admit, command, dispatch, execute};

/// Feed a session's terminal bytes to the originator's live tail. Called from
/// the two output fan-out points (the PTY reader and the headless display
/// line). A local session pays one atomic load. LOSSY and non-blocking: the
/// engine drops the oldest chunk rather than wait.
#[inline]
pub fn forward_output(session_id: &str, bytes: &[u8]) {
    #[cfg(feature = "p2p")]
    live::forward_output(session_id, bytes);
    #[cfg(not(feature = "p2p"))]
    let _ = (session_id, bytes);
}

/// The state door's hook (`pty::emit_session_state`, and the exit path): one
/// mirror and one progress note per transition of a remote session, and the
/// completion when the job is over. Never blocks the caller.
pub fn on_state(session_id: &str, token: &str) {
    #[cfg(feature = "p2p")]
    live::on_state(session_id, token);
    #[cfg(not(feature = "p2p"))]
    let _ = (session_id, token);
}

#[cfg(feature = "p2p")]
mod live {
    //! The half that talks to the engine's job handle. Only a build with the
    //! device link has one.

    use std::path::PathBuf;

    use tauri::AppHandle;
    use tokio::sync::mpsc;

    use crate::db::models::{
        FleetSessionJobPayload, RemoteJob, RemoteSessionCommand, RemoteSessionMode,
        REMOTE_JOB_KIND_FLEET_SESSION,
    };
    use crate::engine::p2p::remote_jobs::{Admission, RemoteJobAssignment, RemoteJobHandle};
    use crate::error::AppError;
    use crate::AppState;

    use super::super::queue::{self, DispatchOrigin, DispatchRequest};
    use super::super::types::{FleetSessionMode, FleetSessionState};
    use super::*;

    /// The live wiring of one link: the job handle (mirror + output, both
    /// sync) and the ordered queue its worker drains.
    pub(super) struct Live {
        pub handle: RemoteJobHandle,
        pub tx: mpsc::UnboundedSender<Msg>,
    }

    pub(super) enum Msg {
        Note(String),
        Complete(CompletionPlan),
    }

    fn now_ms() -> f64 {
        chrono::Utc::now().timestamp_millis() as f64
    }

    fn state_of(app: &AppHandle) -> Option<std::sync::Arc<AppState>> {
        use tauri::Manager;
        app.try_state::<std::sync::Arc<AppState>>()
            .map(|s| s.inner().clone())
    }

    /// Ask for a live link's wiring under the table lock.
    fn with_live<R>(session_id: &str, f: impl FnOnce(&Live) -> R) -> Option<R> {
        let map = links().lock();
        map.get(session_id).and_then(|l| l.live.as_ref()).map(f)
    }

    pub(super) fn forward_output(session_id: &str, bytes: &[u8]) {
        if !links().any() {
            return;
        }
        with_live(session_id, |live| {
            if live.handle.output_subscribed() {
                live.handle.output(bytes);
            }
        });
    }

    pub(super) fn on_state(session_id: &str, token: &str) {
        let Some(plan) = links().observe(session_id, token) else {
            return;
        };
        let Some(work) = links().work_of(session_id) else {
            return;
        };
        let dto = registry().dto_of(session_id);
        let exit_code = dto.as_ref().and_then(|d| d.exit_code);
        let sent = with_live(session_id, |live| {
            if let Some(dto) = dto.as_ref() {
                live.handle.mirror(mirror_view_json(
                    dto,
                    &work.github_url,
                    &work.project_label,
                    now_ms(),
                ));
            }
            let _ = live.tx.send(Msg::Note(state_note(token, exit_code)));
            if let Some(c) = plan.completion.clone() {
                let _ = live.tx.send(Msg::Complete(c));
            }
        });
        if sent.is_none() {
            tracing::debug!(session_id, job_id = %plan.job_id, "remote session: state seen before its wiring");
        }
    }

    // -- Running side: the executor ------------------------------------------

    fn parse_payload(job: &RemoteJobAssignment) -> Result<FleetSessionJobPayload, String> {
        let payload: FleetSessionJobPayload = job
            .payload_json
            .as_deref()
            .and_then(|p| serde_json::from_str(p).ok())
            .ok_or_else(|| "bad_payload".to_string())?;
        if payload.prompt.trim().is_empty() {
            return Err("bad_payload: the session has no prompt".into());
        }
        if !crate::engine::unattended_worktree::is_ref_shaped(&payload.branch)
            || !payload.branch.starts_with("remote/")
        {
            return Err(format!(
                "bad_payload: '{}' is not a remote session branch",
                payload.branch
            ));
        }
        Ok(payload)
    }

    fn local_project(
        app: &AppHandle,
        payload: &FleetSessionJobPayload,
    ) -> Result<crate::db::models::DevProject, String> {
        let state = state_of(app)
            .ok_or_else(|| "project_not_found: this device is still starting".to_string())?;
        let projects = crate::db::repos::dev_tools::list_projects(&state.db, None)
            .map_err(|e| format!("project_not_found: projects unreadable ({e})"))?;
        resolve_project(&projects, payload).cloned().ok_or_else(|| {
            format!(
                "project_not_found: no project here matches {}",
                if payload.github_url.trim().is_empty() {
                    payload.project_name.clone()
                } else {
                    payload.github_url.clone()
                }
            )
        })
    }

    /// The project's main branch in its checkout, or the refusal.
    async fn main_branch_of(project: &crate::db::models::DevProject) -> Result<String, String> {
        let root = PathBuf::from(&project.root_path);
        let is_repo = git(&root, &["rev-parse", "--is-inside-work-tree"], GIT_TIMEOUT)
            .await
            .is_ok_and(|s| s.trim() == "true");
        if !is_repo {
            return Err(format!(
                "branch_setup_failed: {} is not a git checkout",
                project.root_path
            ));
        }
        crate::engine::app_master_gates::resolve_main_branch(&root, project.main_branch.as_deref())
            .await
            .ok_or_else(|| "branch_setup_failed: no main branch resolves here".to_string())
    }

    /// `RemoteJobExecutor::admit` for `fleet_session`: a lookup and two cheap
    /// git reads, nothing that writes. The worktree is made in `execute`,
    /// because the ack waits on this and a large checkout can outlast it.
    pub async fn admit(app: &AppHandle, job: &RemoteJobAssignment) -> Admission {
        let checked = async {
            let payload = parse_payload(job)?;
            let project = local_project(app, &payload)?;
            main_branch_of(&project).await?;
            Ok::<(), String>(())
        }
        .await;
        match checked {
            Ok(()) => Admission::Accept,
            Err(reason) => Admission::Refuse(reason),
        }
    }

    /// Create (or re-enter) the session's worktree on its branch.
    async fn prepare_worktree(
        app: &AppHandle,
        project: &crate::db::models::DevProject,
        branch: &str,
        main: &str,
    ) -> Result<PathBuf, String> {
        use crate::engine::unattended_worktree::{project_worktrees_dir, worktree_leaf_name};
        let root = PathBuf::from(&project.root_path);
        let worktrees = crate::commands::infrastructure::dev_tools::authoring_worktrees_root(app)?;
        let dir = project_worktrees_dir(&worktrees, &project.id);
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
        let path = dir.join(worktree_leaf_name(branch));
        let path_str = path.to_string_lossy().to_string();
        if path.is_dir() {
            // A redelivered job re-enters its own worktree.
            let head = git(&path, &["rev-parse", "--abbrev-ref", "HEAD"], GIT_TIMEOUT).await;
            if head.as_deref().map(str::trim) == Ok(branch) {
                return Ok(path);
            }
            return Err(format!("{path_str} exists on another branch"));
        }
        let exists = git(
            &root,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("refs/heads/{branch}"),
            ],
            GIT_TIMEOUT,
        )
        .await
        .is_ok();
        let mut args: Vec<&str> = Vec::new();
        if cfg!(windows) {
            args.extend(["-c", "core.longpaths=true"]);
        }
        args.extend(["worktree", "add"]);
        if exists {
            args.extend([path_str.as_str(), branch]);
        } else {
            args.extend(["-b", branch, path_str.as_str(), main]);
        }
        git(&root, &args, GIT_TIMEOUT).await?;
        crate::engine::app_master_gates::borrow_installed_deps(&root, &path);
        Ok(path)
    }

    /// `RemoteJobExecutor::execute` for `fleet_session`. Returns at once; the
    /// work runs in a task whose outcome this function's watcher owns, so a
    /// panic fails the job instead of leaving it `running` on both devices.
    pub async fn execute(app: AppHandle, job: RemoteJobAssignment, handle: RemoteJobHandle) {
        let watcher = handle.clone();
        let job_id = job.job_id.clone();
        let inner = tokio::spawn(async move { start(app, job, handle).await });
        tokio::spawn(async move {
            let reason = match inner.await {
                Ok(Ok(())) => return,
                Ok(Err(reason)) => reason,
                Err(join) if join.is_panic() => {
                    tracing::error!(job_id = %job_id, error = %join, "remote session: the executor panicked");
                    "remote_dispatch_failed: the executor crashed before the session started".into()
                }
                Err(join) => {
                    tracing::warn!(job_id = %job_id, error = %join, "remote session: the executor was cancelled");
                    "remote_dispatch_failed: the executor was stopped before the session started"
                        .into()
                }
            };
            if let Err(e) = watcher.fail(reason).await {
                tracing::warn!(job_id = %job_id, error = %e, "remote session: fail() failed");
            }
        });
    }

    async fn start(
        app: AppHandle,
        job: RemoteJobAssignment,
        handle: RemoteJobHandle,
    ) -> Result<(), String> {
        let payload = parse_payload(&job)?;
        let project = local_project(&app, &payload)?;
        let main = main_branch_of(&project).await?;
        let root = PathBuf::from(&project.root_path);
        let worktree = prepare_worktree(&app, &project, &payload.branch, &main)
            .await
            .map_err(|e| format!("branch_setup_failed: {}", first_line(&e)))?;
        let work = Work {
            root: root.clone(),
            worktree: worktree.clone(),
            main_branch: main,
            branch: payload.branch.clone(),
            project_label: project.name.clone(),
            github_url: payload.github_url.clone(),
            mode: payload.mode,
        };
        let prompt = compose_prompt(&payload.prompt, &payload.branch, &job.origin_display_name);
        let (mode, args) = match payload.mode {
            RemoteSessionMode::Interactive => (FleetSessionMode::Interactive, vec![prompt]),
            RemoteSessionMode::Headless => (
                FleetSessionMode::Headless,
                queue::headless_args(&prompt, Vec::new()),
            ),
        };
        let admission = queue::admit(
            &app,
            DispatchRequest {
                cwd: worktree.to_string_lossy().into_owned(),
                name: Some(project.name.clone()),
                title: None,
                args,
                mode,
                run_label: Some(format!("{RUN_LABEL_PREFIX}{}", short8(&job.job_id))),
                origin: DispatchOrigin::Remote,
                persona_id: payload.persona_id.clone(),
                goal_id: None,
                cycle_index: None,
                not_before_ms: None,
                profile: None,
            },
        )
        .await;
        let admission = match admission {
            Ok(a) => a,
            Err(e) => {
                retire_worktree(&work).await;
                return Err(format!("remote_dispatch_failed: {e}"));
            }
        };
        let session_id = admission.session_id;

        // Create-then-stamp: the link, its wiring, its worker.
        links().link(&session_id, &job.job_id, &job.peer_id, work);
        let (tx, rx) = mpsc::unbounded_channel();
        if let Some(l) = links().lock().get_mut(&session_id) {
            l.live = Some(Live {
                handle: handle.clone(),
                tx,
            });
        }
        spawn_worker(app.clone(), job.job_id.clone(), handle, rx);

        // Make the provenance durable and visible, then announce the state
        // the session is already in (a spawn emits before the link exists).
        super::super::persist::note_changed(&app, &session_id);
        super::super::pty::emit_registry_changed(&app, "updated", &session_id);
        if let Some(state) = registry().session_state(&session_id) {
            on_state(&session_id, state_to_token(state));
        }
        tracing::info!(job_id = %job.job_id, session_id = %session_id, "remote session admitted");
        Ok(())
    }

    /// The per-job worker: notes in order, a heartbeat mirror, and the
    /// completion last. Supervised: a panic fails the job.
    fn spawn_worker(
        app: AppHandle,
        job_id: String,
        handle: RemoteJobHandle,
        rx: mpsc::UnboundedReceiver<Msg>,
    ) {
        let watcher = handle.clone();
        let inner = tokio::spawn(worker(app, job_id.clone(), handle, rx));
        tokio::spawn(async move {
            if let Err(join) = inner.await {
                tracing::error!(job_id = %job_id, panicked = join.is_panic(), error = %join, "remote session: the job worker died");
                if let Some(sid) = links().session_for_job(&job_id) {
                    links().remove(&sid);
                }
                let _ = watcher
                    .fail("remote_dispatch_failed: the session's reporter crashed")
                    .await;
            }
        });
    }

    async fn worker(
        app: AppHandle,
        job_id: String,
        handle: RemoteJobHandle,
        mut rx: mpsc::UnboundedReceiver<Msg>,
    ) {
        let mut beat = tokio::time::interval(HEARTBEAT_EVERY);
        beat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        beat.tick().await;
        loop {
            tokio::select! {
                msg = rx.recv() => match msg {
                    Some(Msg::Note(text)) => {
                        if let Err(e) = handle.progress(text).await {
                            tracing::debug!(job_id = %job_id, error = %e, "remote session: note not recorded");
                        }
                    }
                    Some(Msg::Complete(plan)) => {
                        complete(&app, &handle, plan).await;
                        return;
                    }
                    None => return,
                },
                _ = beat.tick() => {
                    let Some(session_id) = links().session_for_job(&job_id) else { return };
                    match registry().dto_of(&session_id) {
                        Some(dto) => {
                            if let Some(work) = links().work_of(&session_id) {
                                handle.mirror(mirror_view_json(&dto, &work.github_url, &work.project_label, now_ms()));
                            }
                        }
                        // The tile was removed without an exit: the job is over.
                        None => {
                            if let Some(plan) = links().claim_vanished(&session_id) {
                                complete(&app, &handle, plan).await;
                            }
                            return;
                        }
                    }
                }
            }
        }
    }

    /// Build the receipt, report the verdict, release the session.
    async fn complete(app: &AppHandle, handle: &RemoteJobHandle, plan: CompletionPlan) {
        let Some(work) = links().work_of(&plan.session_id) else {
            return;
        };
        let dto = registry().dto_of(&plan.session_id);
        let exit_code = dto.as_ref().and_then(|d| d.exit_code);
        let receipt = build_receipt(
            &work.worktree,
            &work.main_branch,
            &work.branch,
            &plan.session_id,
        )
        .await;
        let completed = ended_well(exit_code, plan.saw_finished, plan.ended_by_command);
        let summary = completion_summary(&work.project_label, exit_code, completed, &receipt);
        let reported = if completed {
            handle.complete_with_receipt(summary, &receipt).await
        } else {
            // `fail` carries no receipt (WP1's API); the summary names the
            // branch and what happened to it instead.
            handle.fail(summary).await
        };
        if let Err(e) = reported {
            tracing::warn!(job_id = %handle.job_id(), error = %e, "remote session: result not recorded");
        }
        links().remove(&plan.session_id);

        // A headless session holds its stdin open after its turn: end it so it
        // gives its slot back. An interactive one has already exited.
        let alive = dto
            .as_ref()
            .is_some_and(|d| d.child_pid.is_some() && d.state != FleetSessionState::Exited);
        if alive && work.mode == RemoteSessionMode::Headless {
            let outcome = registry().close_pty_handles_reporting(&plan.session_id);
            if let Some(err) = outcome.failure() {
                tracing::warn!(session_id = %plan.session_id, error = %err, "remote session: could not end the finished process");
            }
            super::super::pty::emit_registry_changed(app, "updated", &plan.session_id);
            // Give the process a moment to release its cwd before the worktree
            // is retired.
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        retire_worktree(&work).await;
    }

    /// `RemoteJobExecutor::command` for `fleet_session`: the originator's
    /// steering, mapped onto the fleet's own verbs. A refusal carries the
    /// `remote_command_refused` token the frontend's error registry matches.
    pub async fn command(
        app: &AppHandle,
        job_id: &str,
        command: RemoteSessionCommand,
        text: Option<String>,
    ) -> Result<(), AppError> {
        let refused = |why: &str| AppError::Validation(format!("remote_command_refused: {why}"));
        let session_id = links()
            .session_for_job(job_id)
            .ok_or_else(|| refused("session_exited"))?;
        let state = registry().session_state(&session_id);
        if matches!(state, None | Some(FleetSessionState::Exited))
            || !links().is_running_here(&session_id)
        {
            return Err(refused("session_exited"));
        }
        match command {
            RemoteSessionCommand::SendInput => {
                let text = text
                    .filter(|t| !t.trim().is_empty())
                    .ok_or_else(|| refused("send_input needs text"))?;
                // Steering input is submitted, the way `fleet_send_input`
                // presses Enter: a line that only sits in the composer
                // answers nothing.
                let text = if text.ends_with(['\r', '\n']) {
                    text
                } else {
                    format!("{text}\r")
                };
                super::super::commands::fleet_write_input(session_id, text)
                    .await
                    .map_err(|e| refused(&e))
            }
            RemoteSessionCommand::Kill => {
                links().mark_command_kill(&session_id);
                if state == Some(FleetSessionState::Queued) {
                    return queue::cancel_dispatch(app, &session_id)
                        .map_err(|e| refused(&e.to_string()));
                }
                super::super::commands::fleet_kill_session(app.clone(), session_id)
                    .await
                    .map_err(|e| refused(&e))
            }
            RemoteSessionCommand::Wake => {
                super::super::commands::fleet_wake_session(app.clone(), session_id, None, None)
                    .await
                    .map(|_| ())
                    .map_err(|e| refused(&e))
            }
        }
    }

    // -- Originating side: the one dispatch path ------------------------------

    /// Send one fleet session to a paired device. The ONE implementation both
    /// the `dispatch_remote_fleet_session` command and Athena's
    /// `remote_fleet_dispatch` op call.
    ///
    /// The branch is minted HERE (`remote/<this device short8>/<key short8>`),
    /// whatever the caller sent. The engine mints the job id inside
    /// `send_job`, so the key is a fresh UUID rather than the job id: unique
    /// per dispatch and readable, which is what the branch needs.
    pub async fn dispatch(
        state: &AppState,
        peer_id: &str,
        mut payload: FleetSessionJobPayload,
    ) -> Result<RemoteJob, AppError> {
        let jobs = state
            .network
            .as_ref()
            .map(|net| net.remote_jobs.clone())
            .ok_or_else(|| {
                AppError::NetworkOffline(
                    "remote_peer_offline: the device link is not running yet. Try again in a moment."
                        .into(),
                )
            })?;
        require_git_remote(&payload)?;
        personas_core::validation::require_non_empty("prompt", &payload.prompt)?;
        let local = crate::engine::identity::get_or_create_identity(&state.db)?.peer_id;
        payload.branch = mint_branch(&local, &uuid::Uuid::new_v4().to_string());
        let instruction = dispatch_line(&payload);
        let payload_json = serde_json::to_string(&payload)?;
        jobs.send_job(
            peer_id.trim(),
            REMOTE_JOB_KIND_FLEET_SESSION,
            &instruction,
            Some(payload_json),
        )
        .await
    }

    /// The human line the job history shows for a dispatch.
    fn dispatch_line(payload: &FleetSessionJobPayload) -> String {
        let prompt: String = payload.prompt.trim().chars().take(240).collect();
        format!("Fleet session on {}: {prompt}", payload.project_name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn work(mode: RemoteSessionMode) -> Work {
        Work {
            root: PathBuf::from("C:/repo"),
            worktree: PathBuf::from("C:/wt/abcd1234"),
            main_branch: "main".into(),
            branch: "remote/aaaa1111/bbbb2222".into(),
            project_label: "Repo".into(),
            github_url: "https://github.com/o/r".into(),
            mode,
        }
    }

    fn payload(url: &str, id: &str, name: &str) -> FleetSessionJobPayload {
        FleetSessionJobPayload {
            project_id: id.into(),
            github_url: url.into(),
            project_name: name.into(),
            prompt: "fix it".into(),
            mode: RemoteSessionMode::Headless,
            branch: "remote/aaaa1111/bbbb2222".into(),
            persona_id: None,
        }
    }

    // -- Project resolution ---------------------------------------------------

    #[test]
    fn a_project_resolves_by_url_then_id_then_name_and_otherwise_not_at_all() {
        let db = crate::db::init_test_db().unwrap();
        let repo = crate::db::repos::dev_tools::create_project;
        let by_url = repo(
            &db,
            "Alpha",
            "C:/alpha",
            None,
            None,
            None,
            Some("https://github.com/Owner/Repo.git/"),
            None,
        )
        .unwrap();
        let by_id = repo(&db, "Beta", "C:/beta", None, None, None, None, None).unwrap();
        let by_name = repo(&db, "Gamma", "C:/gamma", None, None, None, None, None).unwrap();
        let projects = crate::db::repos::dev_tools::list_projects(&db, None).unwrap();

        // The URL wins over an id and a name that point elsewhere, and matches
        // across case, `.git` and a trailing slash.
        let p = payload("https://github.com/owner/repo", &by_id.id, "Gamma");
        assert_eq!(resolve_project(&projects, &p).unwrap().id, by_url.id);
        // No URL match: the id.
        let p = payload("https://github.com/other/thing", &by_id.id, "Gamma");
        assert_eq!(resolve_project(&projects, &p).unwrap().id, by_id.id);
        // No URL, no id: the exact name.
        let p = payload("", "no-such-id", "Gamma");
        assert_eq!(resolve_project(&projects, &p).unwrap().id, by_name.id);
        // A near-miss name is not a match: this is `project_not_found`.
        let p = payload("https://github.com/x/y", "no-such-id", "gamma");
        assert!(resolve_project(&projects, &p).is_none());
    }

    // -- The branch -------------------------------------------------------------

    #[test]
    fn the_branch_is_minted_from_the_two_ids_whatever_the_caller_sent() {
        let branch = mint_branch("12D3-KooW-xyz9", "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b");
        assert_eq!(branch, "remote/12d3koow/0f1e2d3c");
        assert!(crate::engine::unattended_worktree::is_ref_shaped(&branch));
        assert_ne!(
            mint_branch("peer", "a"),
            mint_branch("peer", "b"),
            "one branch per dispatch"
        );
    }

    #[test]
    fn the_prompt_carries_the_branch_rules() {
        let p = compose_prompt("  fix the flaky test ", "remote/a/b", "Laptop");
        assert!(p.starts_with("fix the flaky test"));
        assert!(p.contains("`remote/a/b`"));
        assert!(p.contains("Do not push"));
        assert!(p.contains("Laptop"));
    }

    // -- The state hook -----------------------------------------------------------

    #[test]
    fn the_hook_fires_once_per_transition_and_never_for_a_local_session() {
        let links = RemoteLinks::default();
        assert!(
            links.observe("local", "running").is_none(),
            "an empty table costs nothing"
        );
        links.link(
            "remote",
            "job-1",
            "peer-a",
            work(RemoteSessionMode::Interactive),
        );
        assert!(
            links.observe("local", "running").is_none(),
            "a local session never mirrors"
        );

        let mut fired = Vec::new();
        for token in [
            "spawning",
            "running",
            "running",
            "awaiting_input",
            "awaiting_input",
            "running",
            "finished",
        ] {
            if let Some(plan) = links.observe("remote", token) {
                assert_eq!(plan.job_id, "job-1");
                assert!(
                    plan.completion.is_none(),
                    "an interactive session ends on exit"
                );
                fired.push(token);
            }
        }
        assert_eq!(
            fired,
            vec![
                "spawning",
                "running",
                "awaiting_input",
                "running",
                "finished"
            ],
            "exactly one per transition, none for a repeat"
        );

        let end = links
            .observe("remote", "exited")
            .expect("exit is a transition");
        let c = end.completion.expect("exit completes the job");
        assert!(c.saw_finished);
        assert!(
            links.observe("remote", "stale").is_none(),
            "nothing after the completion was claimed"
        );
    }

    #[test]
    fn a_headless_session_completes_when_its_turn_finishes() {
        let links = RemoteLinks::default();
        links.link("h", "job-2", "peer-a", work(RemoteSessionMode::Headless));
        assert!(links.observe("h", "running").unwrap().completion.is_none());
        let plan = links.observe("h", "finished").unwrap();
        assert!(plan.completion.is_some());
        assert!(
            links.observe("h", "exited").is_none(),
            "the exit that follows is not a second completion"
        );
    }

    #[test]
    fn a_restored_link_keeps_its_provenance_and_is_otherwise_inert() {
        let links = RemoteLinks::default();
        links.restore("r", "job-3", "peer-b");
        assert_eq!(
            links.origin_of("r"),
            Some(("job-3".to_string(), "peer-b".to_string()))
        );
        assert!(links.observe("r", "running").is_none());
        assert!(!links.is_running_here("r"));
        assert!(links.session_for_job("job-3").is_none());
    }

    #[test]
    fn a_wake_carries_the_job_to_the_new_session_and_mirrors_at_once() {
        let links = RemoteLinks::default();
        links.link(
            "old",
            "job-4",
            "peer-a",
            work(RemoteSessionMode::Interactive),
        );
        links.observe("old", "hibernated");
        links.mark_command_kill("old");
        links.carry_over("old", "new");
        assert!(links.origin_of("old").is_none());
        assert_eq!(links.session_for_job("job-4").as_deref(), Some("new"));
        assert!(
            links.observe("new", "hibernated").is_some(),
            "the new id's first state is a transition"
        );
        let c = links.observe("new", "exited").unwrap().completion.unwrap();
        assert!(c.ended_by_command, "the kill intent travels with the job");
    }

    #[test]
    fn the_verdict_and_the_summary() {
        assert!(ended_well(Some(0), false, false));
        assert!(ended_well(Some(1), true, false));
        assert!(ended_well(None, false, true));
        assert!(!ended_well(Some(1), false, false));

        let r = FleetSessionJobReceipt {
            session_id: "s".into(),
            branch: "remote/a/b".into(),
            pushed_sha: Some("0123456789abcdef".into()),
            push_error: None,
            verified: None,
        };
        assert_eq!(
            completion_summary("Repo", Some(0), true, &r),
            "Repo finished; branch remote/a/b pushed at 0123456"
        );
        let none = FleetSessionJobReceipt {
            pushed_sha: None,
            push_error: Some("no commits".into()),
            ..r
        };
        assert_eq!(
            completion_summary("Repo", Some(3), false, &none),
            "Repo exited (code 3); branch remote/a/b: no commits"
        );
        assert_eq!(state_note("awaiting_input", None), "waiting for input");
        assert_eq!(state_note("exited", Some(2)), "exited (code 2)");
    }

    #[test]
    fn git_errors_lose_their_argv_prefix() {
        assert_eq!(
            first_line("git [\"push\"] failed: fatal: could not read Username\nmore"),
            "fatal: could not read Username"
        );
        assert_eq!(first_line("plain"), "plain");
    }

    // -- The receipt and the harvest, against a real bare remote ------------------

    /// A throwaway git fixture: a bare "origin", a working clone that plays the
    /// RUNNING device, and a second clone that plays the ORIGINATING one.
    struct Fixture {
        _dir: tempfile::TempDir,
        runner: PathBuf,
        origin_clone: PathBuf,
        bare: PathBuf,
    }

    /// Git through the app's own git argv owner, with a throwaway identity.
    fn sh(dir: &Path, args: &[&str]) -> String {
        let mut full = vec![
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@example.com",
            "-c",
            "init.defaultBranch=main",
        ];
        full.extend_from_slice(args);
        crate::engine::git_checkpoint::run_git_blocking(dir, &full)
            .unwrap_or_else(|e| panic!("git {args:?}: {e}"))
    }

    fn ref_exists(dir: &Path, refname: &str) -> bool {
        crate::engine::git_checkpoint::run_git_blocking(
            dir,
            &["rev-parse", "--verify", "--quiet", refname],
        )
        .is_ok()
    }

    fn fixture() -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let bare = dir.path().join("origin.git");
        let runner = dir.path().join("runner");
        let origin_clone = dir.path().join("originator");
        std::fs::create_dir_all(&runner).unwrap();
        sh(dir.path(), &["init", "--bare", bare.to_str().unwrap()]);
        sh(&runner, &["init", "-b", "main"]);
        std::fs::write(runner.join("a.txt"), "a").unwrap();
        sh(&runner, &["add", "a.txt"]);
        sh(&runner, &["commit", "-m", "base"]);
        sh(
            &runner,
            &["remote", "add", "origin", bare.to_str().unwrap()],
        );
        sh(&runner, &["push", "-u", "origin", "main"]);
        sh(
            dir.path(),
            &[
                "clone",
                bare.to_str().unwrap(),
                origin_clone.to_str().unwrap(),
            ],
        );
        Fixture {
            _dir: dir,
            runner,
            origin_clone,
            bare,
        }
    }

    #[tokio::test]
    async fn a_receipt_pushes_the_branch_and_reads_the_sha_from_the_remote() {
        let f = fixture();
        sh(&f.runner, &["checkout", "-b", "remote/p/j"]);
        std::fs::write(f.runner.join("b.txt"), "b").unwrap();
        sh(&f.runner, &["add", "b.txt"]);
        sh(&f.runner, &["commit", "-m", "work"]);

        let r = build_receipt(&f.runner, "main", "remote/p/j", "s1").await;
        let on_remote = sh(&f.bare, &["rev-parse", "refs/heads/remote/p/j"]);
        assert_eq!(r.pushed_sha.as_deref(), Some(on_remote.as_str()));
        assert_eq!(r.push_error, None);
        assert_eq!(r.verified, None, "the running device never verifies");
        assert_eq!(r.session_id, "s1");

        // The harvest on the originating device: true for the pushed SHA,
        // false for one that does not exist.
        assert!(verify_pushed(&f.origin_clone, "remote/p/j", &on_remote).await);
        assert!(
            !verify_pushed(
                &f.origin_clone,
                "remote/p/j",
                "0000000000000000000000000000000000000001"
            )
            .await
        );

        // A second receipt finds origin already holding the head: same SHA.
        let again = build_receipt(&f.runner, "main", "remote/p/j", "s1").await;
        assert_eq!(again.pushed_sha, r.pushed_sha);
    }

    #[tokio::test]
    async fn a_branch_with_no_commits_pushes_nothing() {
        let f = fixture();
        sh(&f.runner, &["branch", "remote/p/empty"]);
        let r = build_receipt(&f.runner, "main", "remote/p/empty", "s2").await;
        assert_eq!(r.pushed_sha, None);
        assert_eq!(r.push_error.as_deref(), Some("no commits"));
        assert!(
            !ref_exists(&f.bare, "refs/heads/remote/p/empty"),
            "nothing reached the remote"
        );
    }

    #[tokio::test]
    async fn the_harvest_is_none_without_a_local_project_or_a_sha() {
        let f = fixture();
        let db = crate::db::init_test_db().unwrap();
        let receipt = FleetSessionJobReceipt {
            session_id: "s".into(),
            branch: "main".into(),
            pushed_sha: Some(sh(&f.runner, &["rev-parse", "main"])),
            push_error: None,
            verified: None,
        };
        let p = payload(f.bare.to_str().unwrap(), "x", "Repo");
        assert_eq!(
            verify_receipt(&db, &p, &receipt).await,
            None,
            "no local project: could not verify, not broken"
        );

        crate::db::repos::dev_tools::create_project(
            &db,
            "Repo",
            f.origin_clone.to_str().unwrap(),
            None,
            None,
            None,
            Some(f.bare.to_str().unwrap()),
            None,
        )
        .unwrap();
        assert_eq!(verify_receipt(&db, &p, &receipt).await, Some(true));
        let unpushed = FleetSessionJobReceipt {
            pushed_sha: None,
            ..receipt
        };
        assert_eq!(
            verify_receipt(&db, &p, &unpushed).await,
            None,
            "nothing pushed: nothing to verify"
        );
    }

    #[test]
    fn the_mirror_carries_the_live_fields_as_numbers() {
        let dto = registry_free_dto();
        let json: serde_json::Value =
            serde_json::from_str(&mirror_view_json(&dto, "https://g/o/r", "Repo", 42.0)).unwrap();
        assert_eq!(json["sessionId"], "s-1");
        assert_eq!(json["state"], "awaiting_input");
        assert_eq!(json["projectLabel"], "Repo");
        assert_eq!(json["mode"], "headless");
        assert!(json["lastActivityMs"].is_f64());
        assert_eq!(json["mirrorAtMs"], 42.0);
        assert_eq!(json["jobStatus"], "running");
    }

    fn registry_free_dto() -> FleetSession {
        use super::super::types::{FleetSessionMode, FleetSessionState};
        FleetSession {
            id: "s-1".into(),
            claude_session_id: None,
            cwd: "C:/wt".into(),
            project_label: "abcd1234".into(),
            name: Some("Repo".into()),
            title: None,
            args: Vec::new(),
            mode: FleetSessionMode::Headless,
            state: FleetSessionState::AwaitingInput,
            last_activity_ms: 7,
            last_pty_output_ms: 0,
            last_grew_ms: 0,
            created_at_ms: 1,
            child_pid: None,
            exit_code: None,
            state_reason: Some("question".into()),
            athena_active: false,
            dozing: false,
            limit_reset_at_ms: None,
            stale_kind: None,
            queue_rank: None,
            queued_at_ms: None,
            not_before_ms: None,
            origin: Some("remote".into()),
            persona_id: None,
            goal_id: None,
            cycle_index: None,
            remote_job_id: Some("job".into()),
            origin_peer_id: Some("peer".into()),
        }
    }
}
