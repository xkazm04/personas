//! The mandate mesh mirror (spark `mandate-lanes`, WP9): the app-layer half
//! of the `charter_mirror` and `charter_verdict` remote-job kinds.
//!
//! **The home rule.** A charter's home is the device whose database holds its
//! `persona_responsibilities` row (where it was hired, drafted or adopted).
//! Only the home writes the charter or appends to its act log; a paired peer
//! holds a read-only mirror in its own tables (`personas_db::repos::core::
//! charter_mirror`) that no router, sweep or re-read on the peer can see. The
//! full statement, with the per-stream topology, is on
//! `personas_core::models::charter_mirror`.
//!
//! ```text
//!  HOME                                              PEER (paired)
//!  any act recorded (the one chokepoint:
//!    commands::core::mandates::emit_act_recorded)
//!    -> note_act(charter)  [dirty set]
//!  pump: debounce, snapshot(charter), one charter_mirror job per paired peer
//!    (durable outbox; an older still-queued mirror the new one covers is
//!     cancelled as superseded)          ──▶  admit: refused if home here
//!                                             execute: store::apply (idempotent)
//!                                             announce the new acts to the UI
//!                                       ◀──  a verdict on a mirrored mandate
//!  admit: refused unless home here            (forward_if_mirrored, from the doors)
//!  execute: apply_verdict through the SAME
//!    mandate door, origin_device = the peer;
//!    its act mirrors back like any other   ──▶ receipt (applied | reason)
//! ```
//!
//! **What the peer never does**: write a mirrored charter, file an item under
//! it, spend against its cap (caps stay per device), or route it. A verdict
//! decided on a peer reaches the home as a closed [`CharterVerdict`] and is
//! refused there when the envelope moved past what the peer was shown.

use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::db::models::{
    CharterAct, CharterActFilter, CharterMirrorPayload, CharterVerdict, CharterVerdictPayload,
    CharterVerdictReceipt, MandateActOutcome, MandateMirror, RemoteJob, RemoteJobStatus,
    MIRROR_ACTS_PER_JOB, REMOTE_JOB_KIND_CHARTER_MIRROR, REMOTE_JOB_KIND_CHARTER_VERDICT,
};
use crate::db::repos::core::{charter_acts, charter_mirror as store, mandates};
use crate::db::repos::resources::{owned_devices, remote_jobs as jobs_repo};
use crate::db::{DbPool, UserDbPool};
use crate::engine::p2p::remote_jobs::{
    Admission, RemoteJobAssignment, RemoteJobHandle, RemoteJobs,
};
use crate::engine::p2p::NetworkService;
use crate::error::AppError;
use crate::AppState;

/// Acts recorded within this window share one mirror job.
const DEBOUNCE: Duration = Duration::from_millis(1500);
/// The floor under the act-driven wake: every mandate is re-read this often
/// and re-sent only when it changed (spend and open asks move without acts).
const RESYNC_EVERY: Duration = Duration::from_secs(15 * 60);
/// A mirror job stays well under the wire's 64 KB payload cap.
const MAX_MIRROR_BYTES: usize = 60 * 1024;
/// How long a door waits for the home's answer to a forwarded verdict.
const VERDICT_WAIT: Duration = Duration::from_secs(12);
const VERDICT_POLL: Duration = Duration::from_millis(200);

// -- Home: the snapshot -----------------------------------------------------

/// One charter's mirror as of now, or `None` when this device is not its home.
/// The acts are the newest [`MIRROR_ACTS_PER_JOB`], trimmed oldest-first until
/// the payload fits [`MAX_MIRROR_BYTES`].
pub(crate) fn snapshot(
    pool: &DbPool,
    user_db: &UserDbPool,
    charter_id: &str,
    sent_at_ms: f64,
) -> Result<Option<CharterMirrorPayload>, AppError> {
    if !store::is_home_here(pool, charter_id)? {
        return Ok(None);
    }
    let Some(charter) = mandates::get(pool, charter_id)? else {
        return Ok(None);
    };
    let mut one = [charter];
    crate::engine::mandate_reread_view::annotate(pool, user_db, &mut one);
    let [charter] = one;
    let acts = charter_acts::list(
        pool,
        &CharterActFilter {
            charter_id: Some(charter_id.to_string()),
            limit: Some(MIRROR_ACTS_PER_JOB as u32),
            ..Default::default()
        },
    )?;
    let mut payload = CharterMirrorPayload {
        charter,
        acts,
        sent_at_ms,
    };
    while serde_json::to_string(&payload)?.len() > MAX_MIRROR_BYTES {
        if payload.acts.pop().is_none() {
            return Err(AppError::Validation(format!(
                "Mandate {charter_id} is too large to mirror."
            )));
        }
    }
    Ok(Some(payload))
}

/// Does `newer` make the still-queued `older` pointless? Only when it is the
/// same charter, sent later, and carries every act `older` carried: then
/// delivering `older` first would change nothing the newer one does not.
pub(crate) fn supersedes(newer: &CharterMirrorPayload, older: &CharterMirrorPayload) -> bool {
    if newer.charter.charter_id != older.charter.charter_id || newer.sent_at_ms < older.sent_at_ms {
        return false;
    }
    let held: HashSet<&str> = newer.acts.iter().map(|a| a.id.as_str()).collect();
    older.acts.iter().all(|a| {
        held.contains(a.id.as_str())
            && (a.reverted_at.is_none()
                || newer
                    .acts
                    .iter()
                    .any(|n| n.id == a.id && n.reverted_at.is_some()))
    })
}

/// What a peer would store, without the send time: an unchanged mandate is
/// not sent again.
fn fingerprint(payload: &CharterMirrorPayload) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    serde_json::to_string(&payload.charter)
        .unwrap_or_default()
        .hash(&mut h);
    for a in &payload.acts {
        a.id.hash(&mut h);
        a.reverted_at.hash(&mut h);
    }
    h.finish()
}

// -- Home: the pump -----------------------------------------------------------

/// The dirty set and its wake. A process-global one-way latch: built on first
/// use, never torn down, so an act recorded before [`install`] ran is still
/// mirrored once the pump starts (and the boot resync covers a crash inside
/// the debounce window: the dirty set is in memory, the resync is its floor).
struct Pump {
    dirty: Mutex<HashSet<String>>,
    wake: tokio::sync::Notify,
    /// (peer, charter) -> the fingerprint last sent.
    sent: Mutex<HashMap<(String, String), u64>>,
}

static PUMP: OnceLock<Pump> = OnceLock::new();

fn pump() -> &'static Pump {
    PUMP.get_or_init(|| Pump {
        dirty: Mutex::new(HashSet::new()),
        wake: tokio::sync::Notify::new(),
        sent: Mutex::new(HashMap::new()),
    })
}

/// Mark one charter as changed. Called for EVERY recorded act from the act
/// chokepoint (`emit_act_recorded`); cheap and non-blocking. A charter this
/// device is not home for is dropped when the pump snapshots it.
pub(crate) fn note_act(charter_id: &str) {
    let p = pump();
    p.dirty
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(charter_id.to_string());
    p.wake.notify_one();
}

fn mark_all(pool: &DbPool) {
    match mandates::list(pool) {
        Ok(list) => {
            let p = pump();
            let mut dirty = p.dirty.lock().unwrap_or_else(|e| e.into_inner());
            dirty.extend(list.into_iter().map(|m| m.charter_id));
        }
        Err(e) => tracing::warn!(error = %e, "charter mirror: could not list mandates to resync"),
    }
}

/// Start the pump. Called once from [`super::install`], before the network
/// starts: the first flush queues every mandate for every paired peer (the
/// boot resync), and the outbox carries them when the links come up.
pub(crate) fn install(app: &AppHandle, network: &Arc<NetworkService>) {
    let state = app.state::<Arc<AppState>>().inner().clone();
    let jobs = network.remote_jobs.clone();
    let pump_loop = async move {
        let first = state.db.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || mark_all(&first)).await;
        loop {
            flush(&state, &jobs).await;
            tokio::select! {
                _ = pump().wake.notified() => {}
                _ = tokio::time::sleep(RESYNC_EVERY) => {
                    let pool = state.db.clone();
                    let _ = tauri::async_runtime::spawn_blocking(move || mark_all(&pool)).await;
                }
            }
            tokio::time::sleep(DEBOUNCE).await;
        }
    };
    // The pump has no caller to report to: a panic in it is logged loudly
    // (the mirror then waits for the next boot's resync) instead of
    // vanishing with its JoinHandle.
    tauri::async_runtime::spawn(async move {
        use futures_util::FutureExt;
        if std::panic::AssertUnwindSafe(pump_loop)
            .catch_unwind()
            .await
            .is_err()
        {
            tracing::error!(
                "charter mirror: the pump panicked; mandates mirror again on the next boot"
            );
        }
    });
}

async fn flush(state: &Arc<AppState>, jobs: &Arc<RemoteJobs>) {
    let ids: Vec<String> = {
        let mut dirty = pump().dirty.lock().unwrap_or_else(|e| e.into_inner());
        dirty.drain().collect()
    };
    if ids.is_empty() {
        return;
    }
    let pool = state.db.clone();
    let user_db = state.user_db.clone();
    let built = crate::commands::blocking::run_blocking("charter_mirror::flush", move || {
        let peers = owned_devices::list_owned_devices(&pool)?;
        if peers.is_empty() {
            return Ok((Vec::new(), Vec::new()));
        }
        let now = chrono::Utc::now().timestamp_millis() as f64;
        let mut payloads = Vec::new();
        for id in &ids {
            match snapshot(&pool, &user_db, id, now) {
                Ok(Some(p)) => payloads.push(p),
                Ok(None) => {}
                Err(e) => {
                    tracing::warn!(charter_id = %id, error = %e, "charter mirror: snapshot failed")
                }
            }
        }
        Ok((peers, payloads))
    })
    .await;
    let (peers, payloads) = match built {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!(error = %e, "charter mirror: flush failed");
            return;
        }
    };
    for peer in &peers {
        for payload in &payloads {
            let key = (peer.peer_id.clone(), payload.charter.charter_id.clone());
            let fp = fingerprint(payload);
            let unchanged = pump()
                .sent
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get(&key)
                == Some(&fp);
            if unchanged {
                continue;
            }
            match jobs.send_charter_mirror(&peer.peer_id, payload).await {
                Ok(job) => {
                    pump()
                        .sent
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(key, fp);
                    let pool = state.db.clone();
                    let fresh = payload.clone();
                    let peer_id = peer.peer_id.clone();
                    let _ = tauri::async_runtime::spawn_blocking(move || {
                        supersede_queued(&pool, &peer_id, &job.id, &fresh)
                    })
                    .await;
                }
                Err(e) => {
                    tracing::warn!(peer_id = %peer.peer_id, error = %e, "charter mirror: send failed")
                }
            }
        }
    }
}

/// Cancel the still-queued mirrors to `peer_id` that `fresh` covers, so a
/// peer offline for a week receives one mirror per mandate, not one per act.
pub(crate) fn supersede_queued(
    pool: &DbPool,
    peer_id: &str,
    fresh_job_id: &str,
    fresh: &CharterMirrorPayload,
) -> u32 {
    let queued = match jobs_repo::list_queued_for_peer(pool, peer_id) {
        Ok(q) => q,
        Err(e) => {
            tracing::warn!(peer_id, error = %e, "charter mirror: outbox unreadable");
            return 0;
        }
    };
    let mut n = 0;
    for job in queued {
        if job.id == fresh_job_id || job.kind != REMOTE_JOB_KIND_CHARTER_MIRROR {
            continue;
        }
        let Some(older) = job
            .payload_json
            .as_deref()
            .and_then(|p| serde_json::from_str::<CharterMirrorPayload>(p).ok())
        else {
            continue;
        };
        if supersedes(fresh, &older)
            && jobs_repo::mark_cancelled(
                pool,
                &job.id,
                "Superseded by a newer mirror of the same mandate.",
            )
            .unwrap_or(false)
        {
            n += 1;
        }
    }
    n
}

// -- Peer and home: the two inbound kinds ------------------------------------

/// Before anything is persisted: a mirror is refused by the charter's home,
/// a verdict by every device that is not its home.
pub(crate) async fn admit(app: &AppHandle, job: &RemoteJobAssignment) -> Admission {
    let pool = app.state::<Arc<AppState>>().db.clone();
    let kind = job.kind.clone();
    let payload = job.payload_json.clone().unwrap_or_default();
    let verdict = crate::commands::blocking::run_blocking("charter_mirror::admit", move || {
        admission(&pool, &kind, &payload)
    })
    .await;
    match verdict {
        Ok(a) => a,
        Err(e) => Admission::Refuse(format!("This device could not read its mandates: {e}")),
    }
}

/// [`admit`]'s decision over a pool (the testable half).
pub(crate) fn admission(pool: &DbPool, kind: &str, payload: &str) -> Result<Admission, AppError> {
    let charter_id = match kind {
        REMOTE_JOB_KIND_CHARTER_MIRROR => {
            serde_json::from_str::<CharterMirrorPayload>(payload)?
                .charter
                .charter_id
        }
        REMOTE_JOB_KIND_CHARTER_VERDICT => {
            serde_json::from_str::<CharterVerdictPayload>(payload)?.charter_id
        }
        _ => return Ok(Admission::Refuse("Not a mandate job.".into())),
    };
    let home_here = store::is_home_here(pool, &charter_id)?;
    Ok(match (kind, home_here) {
        (REMOTE_JOB_KIND_CHARTER_MIRROR, true) => Admission::Refuse(
            "This device is that mandate's home; it does not take a mirror of it.".into(),
        ),
        (REMOTE_JOB_KIND_CHARTER_VERDICT, false) => {
            Admission::Refuse("That mandate does not live on this device.".into())
        }
        _ => Admission::Accept,
    })
}

/// Run one accepted job. The wire already runs the executor on its own task
/// (a slow one cannot stall the ack), and the work itself is a blocking-pool
/// write, so this awaits it: every path ends in exactly one terminal report.
pub(crate) async fn execute(app: AppHandle, job: RemoteJobAssignment, handle: RemoteJobHandle) {
    if job.kind == REMOTE_JOB_KIND_CHARTER_MIRROR {
        store_mirror(&app, job, handle).await;
    } else {
        apply_forwarded(&app, job, handle).await;
    }
}

async fn store_mirror(app: &AppHandle, job: RemoteJobAssignment, handle: RemoteJobHandle) {
    let pool = app.state::<Arc<AppState>>().db.clone();
    let (home, name) = (job.peer_id.clone(), job.origin_display_name.clone());
    let payload = job.payload_json.unwrap_or_default();
    let applied = crate::commands::blocking::run_blocking("charter_mirror::store", move || {
        let payload: CharterMirrorPayload = serde_json::from_str(&payload)?;
        store::apply(&pool, &home, &name, &payload)
    })
    .await;
    let done = match applied {
        Ok(a) => {
            for act in &a.new_acts {
                crate::commands::core::mandates::announce_act(app, act);
            }
            handle
                .complete(format!("Mirrored ({} new acts).", a.new_acts.len()))
                .await
        }
        Err(e) => handle.fail(format!("The mirror was not stored: {e}")).await,
    };
    if let Err(e) = done {
        tracing::warn!(error = %e, "charter mirror: could not report a mirror job");
    }
}

async fn apply_forwarded(app: &AppHandle, job: RemoteJobAssignment, handle: RemoteJobHandle) {
    let pool = app.state::<Arc<AppState>>().db.clone();
    let origin = job.origin_display_name.clone();
    let payload = job.payload_json.unwrap_or_default();
    let applied = crate::commands::blocking::run_blocking("charter_mirror::verdict", move || {
        let payload: CharterVerdictPayload = serde_json::from_str(&payload)?;
        let act = apply_verdict(&pool, &origin, &payload)?;
        let mandate = mandates::get(&pool, &act.charter_id)?
            .ok_or_else(|| AppError::NotFound(format!("Mandate {}", act.charter_id)))?;
        Ok(MandateActOutcome { mandate, act })
    })
    .await;
    let receipt = match applied {
        Ok(outcome) => {
            // The chokepoint: the act reaches this device's UI AND mirrors
            // back to every peer, the asking one included.
            crate::commands::core::mandates::emit_act_recorded(app, &outcome.act);
            CharterVerdictReceipt {
                applied: true,
                outcome: Some(outcome),
                reason: None,
            }
        }
        Err(e) => CharterVerdictReceipt {
            applied: false,
            outcome: None,
            reason: Some(refusal_for_peer(&e)),
        },
    };
    if let Err(e) = handle.finish_charter_verdict(&receipt).await {
        tracing::warn!(error = %e, "charter mirror: could not report a verdict job");
    }
}

/// The reason a refused verdict's receipt carries to the peer. A refusal on
/// the merits (`Validation`, `NotFound`, `Forbidden`) is the peer's to read;
/// anything else (a database, pool or serialisation failure) is this device's
/// internals and stays in its own log, so the receipt names the door only.
pub(crate) fn refusal_for_peer(e: &AppError) -> String {
    match e {
        AppError::Validation(m) | AppError::NotFound(m) | AppError::Forbidden(m) => m.clone(),
        other => {
            tracing::warn!(error = %other, "charter mirror: a forwarded verdict failed at home");
            "The home device could not apply it; its log has the cause.".to_string()
        }
    }
}

/// Apply a verdict a paired peer sent home, through the SAME door the home's
/// own UI uses, with the peer recorded as the act's `origin_device`. Refused
/// (`Validation`) when the envelope moved past what the peer was shown, and
/// (`NotFound`) when the mandate, or the act to revert, is not this
/// mandate's here.
pub(crate) fn apply_verdict(
    pool: &DbPool,
    origin: &str,
    payload: &CharterVerdictPayload,
) -> Result<CharterAct, AppError> {
    if let Some(problem) = payload.problem() {
        return Err(AppError::Validation(problem));
    }
    let id = payload.charter_id.as_str();
    let current = mandates::get(pool, id)?
        .ok_or_else(|| AppError::NotFound(format!("Mandate {id} does not live on this device")))?;
    let version = current.envelope.envelope_version;
    if version != payload.seen_envelope_version {
        return Err(AppError::Validation(format!(
            "The mandate changed on its home device since it was decided (envelope {} is now {version}). Look again and decide.",
            payload.seen_envelope_version
        )));
    }
    let origin = Some(origin);
    match &payload.verdict {
        CharterVerdict::Sign { envelope } => mandates::sign(pool, id, envelope, origin),
        CharterVerdict::Amend { change } => mandates::amend(pool, id, change, origin),
        CharterVerdict::Suspend => mandates::suspend(pool, id, origin),
        CharterVerdict::Resume => mandates::resume(pool, id, origin),
        CharterVerdict::Drop { reason } => {
            mandates::drop_draft(pool, id, reason.as_deref(), origin)
        }
        CharterVerdict::Keep { reason } => mandates::keep(pool, id, reason, origin),
        CharterVerdict::Revert { act_id } => {
            let ours = charter_acts::get(pool, act_id)?.is_some_and(|a| a.charter_id == id);
            if !ours {
                return Err(AppError::NotFound(format!(
                    "Act {act_id} is not an act of mandate {id}"
                )));
            }
            crate::engine::mandate_sweep::revert_with_undo_from(pool, act_id, origin)
        }
    }
}

// -- Peer: the doors' gate ---------------------------------------------------

/// Where a mandate door must run for `charter_id`: `None` = here (home, or
/// unknown, which the local door answers), `Some` = the home device and the
/// envelope version this device's mirror shows.
pub(crate) fn home_route(
    pool: &DbPool,
    charter_id: &str,
) -> Result<Option<(MandateMirror, i64)>, AppError> {
    if store::is_home_here(pool, charter_id)? {
        return Ok(None);
    }
    Ok(store::get(pool, charter_id)?.and_then(|m| {
        let version = m.envelope.envelope_version;
        m.mirror.map(|home| (home, version))
    }))
}

/// Everything [`forward`] does outside itself.
#[async_trait::async_trait]
pub(crate) trait VerdictPort: Send + Sync {
    async fn send(
        &self,
        home_peer_id: &str,
        payload: &CharterVerdictPayload,
    ) -> Result<RemoteJob, AppError>;
    fn reload(&self, job_id: &str) -> Result<Option<RemoteJob>, AppError>;
    fn receipt(&self, job_id: &str) -> Result<Option<String>, AppError>;
}

struct WirePort {
    jobs: Arc<RemoteJobs>,
    pool: DbPool,
}

#[async_trait::async_trait]
impl VerdictPort for WirePort {
    async fn send(
        &self,
        home_peer_id: &str,
        payload: &CharterVerdictPayload,
    ) -> Result<RemoteJob, AppError> {
        self.jobs.send_charter_verdict(home_peer_id, payload).await
    }
    fn reload(&self, job_id: &str) -> Result<Option<RemoteJob>, AppError> {
        jobs_repo::get(&self.pool, job_id)
    }
    fn receipt(&self, job_id: &str) -> Result<Option<String>, AppError> {
        jobs_repo::get_receipt_json(&self.pool, job_id)
    }
}

/// Send one verdict home and wait (up to [`VERDICT_WAIT`]) for its answer.
///
/// - applied at home: the home's outcome (its act, its refreshed mandate,
///   marked mirrored here); the act also arrives as an ordinary mirror;
/// - refused at home: `Validation` with the home's reason;
/// - home offline: `NetworkOffline` saying it was sent and waits in the
///   outbox (it applies when the home is reachable, unless the mandate
///   moved first, which the home then refuses);
/// - no answer in time: `NetworkOffline` saying it is on its way.
pub(crate) async fn forward(
    port: &dyn VerdictPort,
    home: &MandateMirror,
    payload: CharterVerdictPayload,
    wait: Duration,
) -> Result<MandateActOutcome, AppError> {
    let mut job = port.send(&home.home_peer_id, &payload).await?;
    let deadline = tokio::time::Instant::now() + wait;
    let name = &home.home_name;
    loop {
        match job.status {
            RemoteJobStatus::Completed => {
                let receipt: Option<CharterVerdictReceipt> = port
                    .receipt(&job.id)?
                    .and_then(|r| serde_json::from_str(&r).ok());
                return match receipt.and_then(|r| r.outcome) {
                    Some(mut outcome) => {
                        outcome.mandate.mirror = Some(home.clone());
                        Ok(outcome)
                    }
                    None => Err(AppError::NetworkOffline(format!(
                        "\"{name}\" applied it; the result is on its way to this device."
                    ))),
                };
            }
            RemoteJobStatus::Refused | RemoteJobStatus::Failed | RemoteJobStatus::Cancelled => {
                let reason = job
                    .refusal_reason
                    .clone()
                    .or_else(|| job.summary.clone())
                    .unwrap_or_else(|| format!("\"{name}\" did not apply it."));
                return Err(AppError::Validation(reason));
            }
            RemoteJobStatus::Queued => {
                return Err(AppError::NetworkOffline(format!(
                    "Sent home to \"{name}\". It applies there when \"{name}\" is reachable, unless the mandate changes there first."
                )))
            }
            _ => {}
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(AppError::NetworkOffline(format!(
                "Sent home to \"{name}\"; its answer has not arrived yet."
            )));
        }
        tokio::time::sleep(VERDICT_POLL).await;
        if let Some(fresh) = port.reload(&job.id)? {
            job = fresh;
        }
    }
}

/// The doors' gate: when `charter_id` is a mandate this device only mirrors,
/// send `verdict` home instead of writing anything here and return what the
/// home answered. `None` = the door runs here as usual.
pub(crate) async fn forward_if_mirrored(
    state: &Arc<AppState>,
    charter_id: &str,
    verdict: CharterVerdict,
) -> Option<Result<MandateActOutcome, AppError>> {
    let pool = state.db.clone();
    let id = charter_id.to_string();
    let route = crate::commands::blocking::run_blocking("charter_mirror::route", move || {
        home_route(&pool, &id)
    })
    .await;
    let (home, seen) = match route {
        Ok(Some(r)) => r,
        Ok(None) => return None,
        Err(e) => return Some(Err(e)),
    };
    let Some(network) = state.network.as_ref() else {
        return Some(Err(AppError::NetworkOffline(format!(
            "This mandate lives on \"{}\" and the device link is not running here.",
            home.home_name
        ))));
    };
    let port = WirePort {
        jobs: network.remote_jobs.clone(),
        pool: state.db.clone(),
    };
    let payload = CharterVerdictPayload {
        charter_id: charter_id.to_string(),
        verdict,
        seen_envelope_version: seen,
    };
    Some(forward(&port, &home, payload, VERDICT_WAIT).await)
}

#[cfg(test)]
mod tests;
