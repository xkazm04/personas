//! Two full nodes, one process, the real wire.
//!
//! Every other test of the job lane drives `RemoteJobs::handle_message` with
//! hand-built frames and no network. These drive two complete
//! [`NetworkService`]s against each other over the REAL QUIC transport and the
//! REAL v4 channel-bound handshake, dialled by `127.0.0.1:<port>` (no mDNS),
//! each with its own in-memory database and its own injected Ed25519 identity
//! (`NetworkService::new_with_test_identity`: the process identity lives in
//! statics two nodes would share).
//!
//! Pairing is established by writing the `owned_devices` rows directly, the
//! same rows the fingerprint ceremony writes; the ceremony has its own tests
//! and needs a human-confirm step this test has no use for.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use ed25519_dalek::SigningKey;
use tokio::sync::Notify;

use personas_core::error::AppError;
use personas_db::models::{
    DeviceAgent, DeviceHostLoad, DeviceQueueEntry, DeviceSnapshot, FleetSessionJobPayload,
    FleetSessionJobReceipt, GpuClass, MeshLiveness, MeshVerbPayload, MeshVerbReceipt, RemoteJob,
    RemoteJobStatus, RemoteSessionCommand, RemoteSessionMode, ResourceAxis,
    REMOTE_JOB_KIND_CLI_MAIL, REMOTE_JOB_KIND_FLEET_SESSION, REMOTE_JOB_KIND_MESH_VERB,
    SNAPSHOT_STALE_AFTER_MS,
};
use personas_db::repos::resources::owned_devices as owned_repo;
use personas_db::repos::resources::remote_jobs as repo;
use personas_db::DbPool;

use super::mesh::DeviceSnapshotProvider;
use super::protocol::{self, Message};
use super::remote_jobs::{RemoteJobAssignment, RemoteJobExecutor, RemoteJobHandle};
use super::NetworkService;
use crate::event_registry::event_name;
use personas_db::models::DeviceReachability;

const WAIT: Duration = Duration::from_secs(20);

fn install_crypto_provider() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

fn test_pool() -> DbPool {
    // The production-shaped fixture: a file-backed pool with the production
    // pragmas (foreign keys on), one fresh database per call.
    personas_db::init_test_db().expect("test db")
}

struct Node {
    svc: NetworkService,
    id: String,
    name: String,
    port: u16,
    pool: DbPool,
}

async fn node(name: &str) -> Node {
    install_crypto_provider();
    let pool = test_pool();
    let key = SigningKey::generate(&mut rand::rngs::OsRng);
    // The row the process identity would have written; `owned_devices` needs it
    // to anchor a device group. Never read for signing (the key is injected).
    seed_identity(&pool, &key, name).expect("seed local_identity");
    let svc = NetworkService::new_with_test_identity(pool.clone(), key, name.to_string())
        .expect("service");
    let port = svc.start_transport_for_test().await.expect("bind");
    let id = svc.connections.local_peer_id().to_string();
    Node {
        svc,
        id,
        name: name.to_string(),
        port,
        pool,
    }
}

fn seed_identity(pool: &DbPool, key: &SigningKey, name: &str) -> Result<(), AppError> {
    pool.get()?.execute(
        "INSERT INTO local_identity (id, peer_id, public_key, display_name) VALUES (1, ?1, ?2, ?3)",
        rusqlite::params![
            crate::identity::public_key_to_peer_id(&key.verifying_key()),
            key.verifying_key().as_bytes().to_vec(),
            name
        ],
    )?;
    Ok(())
}

/// `on` records `peer` as one of its own paired devices.
fn trust(on: &Node, peer: &Node) {
    let group = owned_repo::ensure_device_group_id(&on.pool).expect("group");
    owned_repo::register_paired_device(&on.pool, &peer.id, &group, &peer.name, "pk").expect("pair");
}

/// `on` learns where `peer` listens: the row mDNS would have written.
fn know_address(on: &Node, peer: &Node) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    on.pool.get()?.execute(
        "INSERT INTO discovered_peers
           (peer_id, display_name, addresses, last_seen_at, first_seen_at, is_connected, metadata, trust_status)
         VALUES (?1, ?2, ?3, ?4, ?4, 0, NULL, 'unverified')",
        rusqlite::params![
            peer.id,
            peer.name,
            format!("[\"127.0.0.1:{}\"]", peer.port),
            now
        ],
    )?;
    Ok(())
}

/// Poll `$cond` (which may `.await`) every 20 ms until it holds, or panic
/// naming `$what` after [`WAIT`]. A macro rather than a helper taking an async
/// closure, so the condition can borrow the nodes freely.
macro_rules! wait_for {
    ($what:expr, $cond:expr) => {{
        let deadline = tokio::time::Instant::now() + WAIT;
        loop {
            if $cond {
                break;
            }
            if tokio::time::Instant::now() >= deadline {
                panic!("timed out waiting for: {}", $what);
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }};
}

async fn connect(a: &Node, b: &Node) {
    a.svc.connect_peer(&b.id).await.expect("connect");
    wait_for!("both ends see the link", {
        a.svc.connections.is_connected(&b.id).await && b.svc.connections.is_connected(&a.id).await
    });
}

async fn drop_link(a: &Node, b: &Node) {
    a.svc
        .connections
        .disconnect_peer(&b.id)
        .await
        .expect("disconnect");
    wait_for!("both ends see the link down", {
        !a.svc.connections.is_connected(&b.id).await && !b.svc.connections.is_connected(&a.id).await
    });
}

fn status(pool: &DbPool, job_id: &str) -> Option<RemoteJobStatus> {
    repo::get(pool, job_id).ok().flatten().map(|j| j.status)
}

fn emitted(node: &Node, event: &str) -> Vec<serde_json::Value> {
    node.svc
        .remote_jobs
        .emitted
        .lock()
        .unwrap()
        .iter()
        .filter(|(e, _)| *e == event)
        .map(|(_, v)| v.clone())
        .collect()
}

const MIRROR_1: &str = r#"{"sessionId":"s-1","title":"Fix flaky test","state":"running"}"#;
const MIRROR_2: &str = r#"{"sessionId":"s-1","title":"Fix flaky test","state":"awaiting_input","stateReason":"needs a yes"}"#;

/// The running device's stand-in executor.
///
/// - instruction `"hold"`: one note, then waits for `release`, then two more
///   notes and completes (the link is dropped while it waits).
/// - any other instruction: one note, then completes.
/// - `fleet_session`: waits until the originator subscribes, mirrors twice,
///   writes three output chunks, waits for one steering command, then
///   completes with a receipt.
#[derive(Clone, Default)]
struct Stub {
    release: Arc<Notify>,
    command_seen: Arc<Notify>,
    commands: Arc<Mutex<Vec<(String, RemoteSessionCommand, Option<String>)>>>,
    /// Every job's task, kept so the test can prove none of them panicked.
    tasks: Arc<Mutex<Vec<tokio::task::JoinHandle<()>>>>,
}

#[async_trait::async_trait]
impl RemoteJobExecutor for Stub {
    async fn execute(&self, job: RemoteJobAssignment, handle: RemoteJobHandle) {
        let stub = self.clone();
        let tasks = self.tasks.clone();
        tasks.lock().unwrap().push(tokio::spawn(async move {
            if job.kind == REMOTE_JOB_KIND_FLEET_SESSION {
                for _ in 0..500 {
                    if handle.output_subscribed() {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
                handle.mirror(MIRROR_1);
                handle.mirror(MIRROR_2);
                for chunk in [&b"one"[..], b"two", b"three"] {
                    handle.output(chunk);
                    tokio::time::sleep(Duration::from_millis(300)).await;
                }
                stub.command_seen.notified().await;
                let receipt = FleetSessionJobReceipt {
                    session_id: "s-1".into(),
                    branch: "remote/aaaa/bbbb".into(),
                    pushed_sha: Some("abc123".into()),
                    push_error: None,
                    verified: None,
                };
                handle
                    .complete_with_receipt("pushed remote/aaaa/bbbb", &receipt)
                    .await
                    .expect("complete with receipt");
            } else if job.instruction == "hold" {
                handle.progress("one").await.expect("note 1");
                stub.release.notified().await;
                handle.progress("two").await.expect("note 2");
                handle.progress("three").await.expect("note 3");
                handle.complete("held and done").await.expect("complete");
            } else {
                handle.progress("only").await.expect("note");
                handle
                    .complete(format!("did: {}", job.instruction))
                    .await
                    .expect("complete");
            }
        }));
    }

    async fn command(
        &self,
        job_id: &str,
        command: RemoteSessionCommand,
        text: Option<String>,
    ) -> Result<(), AppError> {
        self.commands
            .lock()
            .unwrap()
            .push((job_id.to_string(), command, text));
        self.command_seen.notify_one();
        Ok(())
    }
}

/// Steps 1-7 of the WP1 brief on one pair of nodes: handshake, an instruction
/// with notes, a dropped link mid-job with exactly-once resume, an offline send
/// that queues and drains, and a fleet session with mirrors, a live output
/// tail, a steering command and a receipt.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn two_nodes_carry_jobs_across_a_drop_an_outbox_and_a_fleet_session() {
    let laptop = node("Laptop").await; // originates
    let desktop = node("Desktop").await; // runs
    trust(&laptop, &desktop);
    trust(&desktop, &laptop);
    know_address(&laptop, &desktop).expect("address");
    let stub = Stub::default();
    desktop
        .svc
        .remote_jobs
        .set_executor(Arc::new(stub.clone()))
        .await;

    // Reachability before any link: seen on the LAN (a row), not connected.
    assert_eq!(
        laptop.svc.device_reachability(&desktop.id).await,
        DeviceReachability::Stale
    );
    assert_eq!(
        laptop.svc.device_reachability("never-seen").await,
        DeviceReachability::Offline
    );

    // 1-2. Real QUIC + the real v4 handshake, by 127.0.0.1:<port>.
    connect(&laptop, &desktop).await;
    assert_eq!(
        laptop.svc.device_reachability(&desktop.id).await,
        DeviceReachability::Connected
    );

    // 3. An instruction whose notes stream back.
    let jobs = &laptop.svc.remote_jobs;
    let held = jobs
        .send_instruction(&desktop.id, None, "hold")
        .await
        .expect("send");
    assert_eq!(held.status, RemoteJobStatus::Running, "acked on the wire");
    wait_for!("note 1 reaches the originator", {
        repo::list_notes(&laptop.pool, &held.id).unwrap().len() == 1
    });

    // 4. Drop the link mid-job; the runner finishes while it is down.
    drop_link(&laptop, &desktop).await;
    stub.release.notify_one();
    wait_for!("the runner finishes offline", {
        status(&desktop.pool, &held.id) == Some(RemoteJobStatus::Completed)
    });
    assert_eq!(
        repo::list_notes(&laptop.pool, &held.id).unwrap().len(),
        1,
        "notes 2 and 3 were written while the link was down"
    );
    assert_eq!(
        status(&laptop.pool, &held.id),
        Some(RemoteJobStatus::Running)
    );

    // Reconnect: the link-up resume replays exactly what is missing.
    connect(&laptop, &desktop).await;
    wait_for!("the result arrives after resume", {
        status(&laptop.pool, &held.id) == Some(RemoteJobStatus::Completed)
    });
    let notes: Vec<(u32, String)> = repo::list_notes(&laptop.pool, &held.id)
        .unwrap()
        .into_iter()
        .map(|n| (n.seq, n.text))
        .collect();
    assert_eq!(
        notes,
        vec![(1, "one".into()), (2, "two".into()), (3, "three".into())],
        "every note exactly once, in order"
    );
    let completions = emitted(&laptop, event_name::REMOTE_JOB_UPDATED)
        .into_iter()
        .filter(|j| j["id"] == held.id.as_str() && j["status"] == "completed")
        .count();
    assert_eq!(completions, 1, "the result is applied exactly once");
    // A second resume of the same peer finds nothing to do.
    jobs.resume_with_peer(&desktop.id).await;
    assert_eq!(repo::list_notes(&laptop.pool, &held.id).unwrap().len(), 3);

    // 5. Send while the peer is offline: queued, then drained on link-up.
    drop_link(&laptop, &desktop).await;
    assert_eq!(
        laptop.svc.device_reachability(&desktop.id).await,
        DeviceReachability::Stale
    );
    let queued = jobs
        .send_instruction(&desktop.id, None, "queued work")
        .await
        .expect("an offline send is queued, not refused");
    assert_eq!(queued.status, RemoteJobStatus::Queued);
    assert!(
        repo::get(&desktop.pool, &queued.id).unwrap().is_none(),
        "nothing reached the runner while offline"
    );
    connect(&laptop, &desktop).await;
    wait_for!("the outbox drains and the job completes", {
        status(&laptop.pool, &queued.id) == Some(RemoteJobStatus::Completed)
    });
    let done = repo::get(&laptop.pool, &queued.id).unwrap().unwrap();
    assert_eq!(done.summary.as_deref(), Some("did: queued work"));
    assert!(repo::list_queued_for_peer(&laptop.pool, &desktop.id)
        .unwrap()
        .is_empty());

    // 6. A fleet session: mirrors, a live output tail, then a receipt.
    let payload = serde_json::to_string(&FleetSessionJobPayload {
        project_id: "p1".into(),
        github_url: "https://github.com/o/r".into(),
        project_name: "Repo".into(),
        prompt: "fix the flaky test".into(),
        mode: RemoteSessionMode::Interactive,
        branch: "remote/aaaa/bbbb".into(),
        persona_id: None,
    })
    .unwrap();
    let session = jobs
        .send_job(
            &desktop.id,
            REMOTE_JOB_KIND_FLEET_SESSION,
            "fix the flaky test",
            Some(payload.clone()),
        )
        .await
        .expect("send fleet session");
    assert_eq!(session.status, RemoteJobStatus::Running);
    let on_runner = repo::get(&desktop.pool, &session.id).unwrap().unwrap();
    assert_eq!(
        on_runner.payload_json.as_deref(),
        Some(payload.as_str()),
        "the runner keeps the payload"
    );

    jobs.subscribe_output(&session.id, true)
        .await
        .expect("subscribe");
    wait_for!("the latest mirror is persisted on the originator", {
        repo::get_mirror(&laptop.pool, &session.id)
            .unwrap()
            .is_some_and(|m| m.view_json == MIRROR_2)
    });
    wait_for!("all output reaches the originator", {
        let bytes: Vec<u8> = emitted(&laptop, event_name::REMOTE_SESSION_OUTPUT)
            .iter()
            .filter(|c| c["jobId"] == session.id.as_str())
            .flat_map(|c| B64.decode(c["chunkB64"].as_str().unwrap()).unwrap())
            .collect();
        bytes == b"onetwothree"
    });
    let seqs: Vec<u64> = emitted(&laptop, event_name::REMOTE_SESSION_OUTPUT)
        .iter()
        .map(|c| c["seq"].as_u64().unwrap())
        .collect();
    assert!(
        seqs.windows(2).all(|w| w[0] < w[1]),
        "output seq is strictly increasing: {seqs:?}"
    );
    assert!(
        emitted(&laptop, event_name::REMOTE_SESSION_UPDATED)
            .iter()
            .any(|v| v["jobId"] == session.id.as_str()
                && v["state"] == "awaiting_input"
                && v["projectLabel"] == "Repo"
                && v["peerDisplayName"] == "Desktop"),
        "the mirror surfaced as a RemoteSessionView"
    );
    let view = jobs
        .session_view(&session.id)
        .unwrap()
        .expect("a fleet_session job has a view");
    assert_eq!(view.title.as_deref(), Some("Fix flaky test"));

    // 7. Steer it; the runner's executor sees the command and acks.
    jobs.send_command(
        &session.id,
        RemoteSessionCommand::SendInput,
        Some("y".into()),
    )
    .await
    .expect("command accepted");
    assert_eq!(
        stub.commands.lock().unwrap().as_slice(),
        &[(
            session.id.clone(),
            RemoteSessionCommand::SendInput,
            Some("y".to_string())
        )]
    );
    wait_for!("the session completes with its receipt", {
        status(&laptop.pool, &session.id) == Some(RemoteJobStatus::Completed)
    });
    let finished = repo::get(&laptop.pool, &session.id).unwrap().unwrap();
    let receipt = finished.receipt.expect("receipt stored on the originator");
    assert_eq!(receipt.pushed_sha.as_deref(), Some("abc123"));
    assert_eq!(receipt.branch, "remote/aaaa/bbbb");
    assert!(matches!(
        jobs.send_command(&session.id, RemoteSessionCommand::Kill, None)
            .await,
        Err(AppError::Validation(_))
    ));

    let tasks: Vec<_> = std::mem::take(&mut *stub.tasks.lock().unwrap());
    assert_eq!(tasks.len(), 3, "one executor task per accepted job");
    for task in tasks {
        task.await.expect("no executor task panicked");
    }
}

/// Step 8: a third identity completes the handshake (any LAN peer may) but was
/// never paired. Its job is refused with a reason, and nothing it sends is
/// written or surfaced.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_unpaired_identity_is_refused_and_leaves_nothing_behind() {
    let home = node("Home").await;
    let stranger = node("Stranger").await;
    // The stranger believes home is its device; home has never heard of it.
    trust(&stranger, &home);
    know_address(&stranger, &home).expect("address");
    connect(&stranger, &home).await;

    let job = stranger
        .svc
        .remote_jobs
        .send_instruction(&home.id, None, "delete everything")
        .await
        .expect("an answered refusal is not an error");
    assert_eq!(job.status, RemoteJobStatus::Refused);
    assert!(
        job.refusal_reason.unwrap_or_default().contains("paired"),
        "the refusal says why"
    );

    // Raw live frames straight onto the wire, bypassing every sender-side check.
    for frame in [
        Message::RemoteSessionMirror {
            job_id: job.id.clone(),
            view_json: MIRROR_1.into(),
        },
        Message::RemoteSessionOutput {
            job_id: job.id.clone(),
            seq: 1,
            chunk_b64: B64.encode(b"x"),
        },
        Message::RemoteJobCommand {
            job_id: job.id.clone(),
            command: "kill".into(),
            text: None,
        },
    ] {
        let (mut send, _recv) = stranger
            .svc
            .connections
            .open_stream(&home.id)
            .await
            .expect("stream");
        protocol::write_message(&mut send, &frame)
            .await
            .expect("write");
    }
    tokio::time::sleep(Duration::from_millis(300)).await;

    // Device mesh: a verb and a snapshot from the same stranger fare no
    // better. The verb is refused with a reason; the snapshot is dropped.
    let verb = stranger
        .svc
        .remote_jobs
        .send_mesh_verb(
            &home.id,
            &MeshVerbPayload::PersonaSetEnabled {
                persona_id: "p1".into(),
                enabled: true,
            },
        )
        .await
        .expect("an answered refusal is not an error");
    assert_eq!(verb.status, RemoteJobStatus::Refused);
    assert!(verb.refusal_reason.unwrap_or_default().contains("paired"));
    let (mut send, _recv) = stranger
        .svc
        .connections
        .open_stream(&home.id)
        .await
        .expect("stream");
    protocol::write_message(
        &mut send,
        &Message::DeviceSnapshot {
            json: serde_json::to_string(&snapshot_of(&stranger, 0.5)).unwrap(),
        },
    )
    .await
    .expect("write");
    tokio::time::sleep(Duration::from_millis(300)).await;

    assert!(
        repo::list(&home.pool, None, 50).unwrap().is_empty(),
        "no row for an unpaired sender"
    );
    assert!(
        home.svc.remote_jobs.emitted.lock().unwrap().is_empty(),
        "nothing from an unpaired sender reaches the UI"
    );
    assert!(
        home.svc
            .mesh
            .cached(&stranger.id, super::mesh::now_ms())
            .0
            .is_none(),
        "a stranger's snapshot is never cached"
    );
    assert!(home.svc.mesh.emitted.lock().unwrap().is_empty());
}

// -- Device mesh (spark device-mesh, WP2a) ------------------------------------

/// A device's snapshot body as its provider would build it. The engine
/// overwrites `peer_id`, `display_name` and `sent_at_ms` on the way out.
fn snapshot_of(node: &Node, cpu: f64) -> DeviceSnapshot {
    DeviceSnapshot {
        peer_id: node.id.clone(),
        display_name: node.name.clone(),
        app_version: "0.0.0-test".into(),
        sent_at_ms: 0.0,
        host: DeviceHostLoad {
            cpu_share: cpu,
            ram_share: 0.25,
            gpu_share: None,
        },
        running: 1,
        queued: 1,
        agents: vec![DeviceAgent {
            persona_id: format!("{}-writer", node.name),
            name: "Writer".into(),
            enabled: true,
            project_id: Some("proj".into()),
            project_enabled: Some(true),
            dominant: Some(ResourceAxis::Cpu),
            running: true,
        }],
        queue: vec![DeviceQueueEntry {
            session_id: "s-1".into(),
            title: "Queued work".into(),
            project_label: Some("Repo".into()),
            rank: 1,
            machine_units: 2,
            gpu: GpuClass::None,
        }],
    }
}

/// The app layer's provider, standing in: a fixed body per node.
struct FixedProvider(DeviceSnapshot);

#[async_trait::async_trait]
impl DeviceSnapshotProvider for FixedProvider {
    async fn build(&self) -> Result<DeviceSnapshot, AppError> {
        Ok(self.0.clone())
    }
}

async fn provide(node: &Node, cpu: f64) {
    node.svc
        .mesh
        .set_provider(Arc::new(FixedProvider(snapshot_of(node, cpu))))
        .await;
}

fn snapshot_events(node: &Node) -> Vec<serde_json::Value> {
    node.svc
        .mesh
        .emitted
        .lock()
        .unwrap()
        .iter()
        .filter(|(e, _)| *e == event_name::DEVICE_SNAPSHOT)
        .map(|(_, v)| v.clone())
        .collect()
}

/// Snapshots flow BOTH ways over the real wire (on link-up and on a
/// broadcast), a snapshot claiming to be another device is refused, and a
/// view older than the stale window turns `unknown` - announced exactly once.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn snapshots_flow_both_ways_refuse_impostors_and_go_stale() {
    let laptop = node("Laptop").await;
    let desktop = node("Desktop").await;
    trust(&laptop, &desktop);
    trust(&desktop, &laptop);
    know_address(&laptop, &desktop).expect("address");
    provide(&laptop, 0.10).await;
    provide(&desktop, 0.70).await;

    // Link-up sends each side's snapshot to the other.
    connect(&laptop, &desktop).await;
    wait_for!("laptop holds desktop's snapshot", {
        laptop
            .svc
            .mesh
            .cached(&desktop.id, super::mesh::now_ms())
            .0
            .is_some()
    });
    wait_for!("desktop holds laptop's snapshot", {
        desktop
            .svc
            .mesh
            .cached(&laptop.id, super::mesh::now_ms())
            .0
            .is_some()
    });
    let (snap, received_at, liveness) = laptop.svc.mesh.cached(&desktop.id, super::mesh::now_ms());
    let snap = snap.unwrap();
    assert_eq!(snap.peer_id, desktop.id, "stamped by the sending engine");
    assert_eq!(snap.host.cpu_share, 0.70);
    assert_eq!(snap.agents[0].dominant, Some(ResourceAxis::Cpu));
    assert_eq!(liveness, MeshLiveness::Live);
    assert!(snap.sent_at_ms > 0.0);

    // The view was announced on arrival, live and connected.
    let events = snapshot_events(&laptop);
    let last = events
        .iter()
        .rev()
        .find(|v| v["peerId"] == desktop.id.as_str())
        .expect("a device-snapshot event for desktop");
    assert_eq!(last["liveness"], "live");
    assert_eq!(last["reachability"], "connected");
    assert_eq!(last["isSelf"], false);
    assert_eq!(
        last["displayName"], "Desktop",
        "the paired name, not the claim"
    );

    // A broadcast carries a CHANGE across: desktop's load moves.
    provide(&desktop, 0.90).await;
    assert_eq!(
        desktop.svc.mesh.broadcast().await,
        1,
        "one paired peer is connected"
    );
    wait_for!("laptop sees desktop's new load", {
        laptop
            .svc
            .mesh
            .cached(&desktop.id, super::mesh::now_ms())
            .0
            .is_some_and(|s| s.host.cpu_share == 0.90)
    });

    // An impostor frame: desktop (paired, authenticated) claims to be laptop.
    let before = laptop.svc.mesh.cached(&desktop.id, super::mesh::now_ms()).1;
    let mut forged = snapshot_of(&desktop, 0.01);
    forged.peer_id = laptop.id.clone();
    let (mut send, _recv) = desktop
        .svc
        .connections
        .open_stream(&laptop.id)
        .await
        .expect("stream");
    protocol::write_message(
        &mut send,
        &Message::DeviceSnapshot {
            json: serde_json::to_string(&forged).unwrap(),
        },
    )
    .await
    .expect("write");
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        laptop
            .svc
            .mesh
            .cached(&laptop.id, super::mesh::now_ms())
            .0
            .is_none(),
        "nothing is stored under the claimed id"
    );
    assert_eq!(
        laptop.svc.mesh.cached(&desktop.id, super::mesh::now_ms()).1,
        before,
        "nor does the impostor frame refresh the sender's own entry"
    );

    // The roster: this device first, then the paired one with its snapshot.
    let roster = laptop.svc.mesh_device_snapshots().await.expect("roster");
    assert_eq!(roster.len(), 2);
    assert!(roster[0].is_self && roster[0].peer_id == laptop.id);
    assert_eq!(roster[0].liveness, MeshLiveness::Live);
    assert_eq!(
        roster[0].snapshot.as_ref().map(|s| s.host.cpu_share),
        Some(0.10)
    );
    assert_eq!(roster[1].peer_id, desktop.id);
    assert_eq!(roster[1].liveness, MeshLiveness::Live);
    assert!(roster[1].received_at_ms.is_some());

    // Staleness: past the window by THIS device's clock, the view turns
    // unknown, and the transition is announced exactly once.
    let at = received_at.unwrap();
    let still = laptop
        .svc
        .mesh_expire_at(at + SNAPSHOT_STALE_AFTER_MS - 1_000.0)
        .await;
    assert!(still.is_empty(), "not stale inside the window");
    let stale_at = laptop
        .svc
        .mesh
        .cached(&desktop.id, super::mesh::now_ms())
        .1
        .unwrap()
        + SNAPSHOT_STALE_AFTER_MS
        + 1_000.0;
    let turned = laptop.svc.mesh_expire_at(stale_at).await;
    assert_eq!(turned, vec![desktop.id.clone()]);
    assert_eq!(
        laptop.svc.mesh.cached(&desktop.id, stale_at).2,
        MeshLiveness::Unknown
    );
    let unknown_events = snapshot_events(&laptop)
        .into_iter()
        .filter(|v| v["peerId"] == desktop.id.as_str() && v["liveness"] == "unknown")
        .count();
    assert_eq!(unknown_events, 1, "announced on the transition");
    assert!(
        laptop
            .svc
            .mesh_expire_at(stale_at + 15_000.0)
            .await
            .is_empty(),
        "and never again while it stays stale"
    );
}

/// The receiving device's stand-in for the app's mesh executor: it knows one
/// persona (`p1`), one project (`proj`) and one queued session (`s-1`).
#[derive(Clone, Default)]
struct MeshStub {
    seen: Arc<Mutex<Vec<MeshVerbPayload>>>,
}

#[async_trait::async_trait]
impl RemoteJobExecutor for MeshStub {
    async fn execute(&self, job: RemoteJobAssignment, handle: RemoteJobHandle) {
        assert_eq!(job.kind, REMOTE_JOB_KIND_MESH_VERB);
        let payload: MeshVerbPayload =
            serde_json::from_str(job.payload_json.as_deref().unwrap()).unwrap();
        self.seen.lock().unwrap().push(payload.clone());
        let known = match &payload {
            MeshVerbPayload::Ping => true,
            MeshVerbPayload::PersonaSetEnabled { persona_id, .. } => persona_id == "p1",
            MeshVerbPayload::ProjectSetEnabled { project_id, .. } => project_id == "proj",
            MeshVerbPayload::QueueReorder { session_ids } => session_ids.iter().all(|s| s == "s-1"),
            MeshVerbPayload::QueueCancel { session_id }
            | MeshVerbPayload::QueueStartNow { session_id } => session_id == "s-1",
        };
        let receipt = MeshVerbReceipt {
            verb: payload.verb().into(),
            ok: known,
            detail: Some(if !known {
                "not_found: not on this device".into()
            } else if payload == MeshVerbPayload::Ping {
                "0.0.0-test desktop,p2p".into()
            } else {
                "done".into()
            }),
        };
        // `execute` already runs on its own task (the engine spawns it), and
        // finishing is one row write plus one frame: done inline.
        handle.finish_mesh_verb(&receipt).await.expect("finish");
    }
}

async fn settled(pool: &DbPool, job_id: &str) -> RemoteJob {
    wait_for!("the job settles", {
        status(pool, job_id).is_some_and(|s| s.is_terminal())
    });
    repo::get(pool, job_id).unwrap().unwrap()
}

/// One-box dial by address (the `/mesh/connect {address}` door): no
/// `discovered_peers` row beforehand, the peer id is LEARNED from the signed
/// handshake, and the address is then recorded so the auto-connect sweep can
/// re-dial it. Pairing is untouched: the new link is authenticated, not
/// trusted. The env-gated public door refuses outside an isolated instance.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_peer_dialled_by_address_proves_its_id_and_is_remembered() {
    let laptop = node("Laptop").await;
    let desktop = node("Desktop").await;
    let address = format!("127.0.0.1:{}", desktop.port);

    let learned = laptop
        .svc
        .connect_to_address_unchecked(&address)
        .await
        .expect("dial by address");
    assert_eq!(learned, desktop.id, "the id the handshake proved");
    wait_for!("both ends see the link", {
        laptop.svc.connections.is_connected(&desktop.id).await
            && desktop.svc.connections.is_connected(&laptop.id).await
    });
    assert!(
        laptop.svc.mdns.has_discovered_row(&desktop.id).unwrap(),
        "the dialled address is recorded"
    );
    assert!(
        owned_repo::get_owned_device(&laptop.pool, &desktop.id)
            .unwrap()
            .is_none(),
        "connected is not paired"
    );
    // Dialling yourself is refused after the handshake names you.
    let self_addr = format!("127.0.0.1:{}", laptop.port);
    assert!(laptop
        .svc
        .connect_to_address_unchecked(&self_addr)
        .await
        .is_err());
    assert!(matches!(
        laptop
            .svc
            .connect_to_address_unchecked("not-an-address")
            .await,
        Err(AppError::Validation(_))
    ));
    if super::one_box::isolated_data_dir().is_none() {
        assert!(matches!(
            laptop.svc.connect_to_address(&address).await,
            Err(AppError::Forbidden(_))
        ));
    }
}

/// Every `MeshVerbPayload` variant crosses the wire and comes back as a
/// receipt on the originator; an unknown target is `ok: false, not_found`
/// (a failed job, never a silent success); an offline peer's verb waits in
/// the outbox and runs when the link returns.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn every_mesh_verb_travels_and_its_receipt_comes_back() {
    let laptop = node("Laptop").await;
    let desktop = node("Desktop").await;
    trust(&laptop, &desktop);
    trust(&desktop, &laptop);
    know_address(&laptop, &desktop).expect("address");
    let stub = MeshStub::default();
    desktop
        .svc
        .remote_jobs
        .set_executor(Arc::new(stub.clone()))
        .await;
    connect(&laptop, &desktop).await;

    let verbs = [
        MeshVerbPayload::Ping,
        MeshVerbPayload::PersonaSetEnabled {
            persona_id: "p1".into(),
            enabled: false,
        },
        MeshVerbPayload::ProjectSetEnabled {
            project_id: "proj".into(),
            enabled: true,
        },
        MeshVerbPayload::QueueReorder {
            session_ids: vec!["s-1".into()],
        },
        MeshVerbPayload::QueueCancel {
            session_id: "s-1".into(),
        },
        MeshVerbPayload::QueueStartNow {
            session_id: "s-1".into(),
        },
    ];
    let jobs = &laptop.svc.remote_jobs;
    for verb in &verbs {
        let sent = jobs.send_mesh_verb(&desktop.id, verb).await.expect("send");
        assert_eq!(sent.kind, REMOTE_JOB_KIND_MESH_VERB);
        let done = settled(&laptop.pool, &sent.id).await;
        assert_eq!(done.status, RemoteJobStatus::Completed, "{verb:?}");
        let receipt = done.mesh_receipt.expect("the receipt came back");
        assert_eq!(receipt.verb, verb.verb());
        assert!(receipt.ok);
        assert!(done.receipt.is_none(), "never read as a fleet receipt");
        if *verb == MeshVerbPayload::Ping {
            assert_eq!(receipt.detail.as_deref(), Some("0.0.0-test desktop,p2p"));
        }
    }
    assert_eq!(
        stub.seen.lock().unwrap().as_slice(),
        &verbs,
        "the runner received exactly what was sent"
    );

    // Unknown target: ok:false with the reason, as a FAILED job.
    let ghost = jobs
        .send_mesh_verb(
            &desktop.id,
            &MeshVerbPayload::PersonaSetEnabled {
                persona_id: "ghost".into(),
                enabled: true,
            },
        )
        .await
        .expect("send");
    let ghost = settled(&laptop.pool, &ghost.id).await;
    assert_eq!(ghost.status, RemoteJobStatus::Failed);
    let r = ghost
        .mesh_receipt
        .expect("a refusal still carries its receipt");
    assert!(!r.ok);
    assert!(r.detail.unwrap().starts_with("not_found"));

    // Offline: queued in the outbox, run on the next link-up.
    drop_link(&laptop, &desktop).await;
    let queued = jobs
        .send_mesh_verb(&desktop.id, &MeshVerbPayload::Ping)
        .await
        .expect("queued, not refused");
    assert_eq!(queued.status, RemoteJobStatus::Queued);
    connect(&laptop, &desktop).await;
    let drained = settled(&laptop.pool, &queued.id).await;
    assert_eq!(drained.status, RemoteJobStatus::Completed);
    assert!(drained.mesh_receipt.unwrap().ok);
}

/// CLI mail: stored and completed on arrival, read back oldest first by
/// topic prefix; a body over 16 KB is refused on BOTH sides - by the sender
/// before anything is written, and by the receiver for a frame that skipped
/// the sender's check.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cli_mail_round_trips_and_an_oversized_body_is_refused() {
    let laptop = node("Laptop").await;
    let desktop = node("Desktop").await;
    trust(&laptop, &desktop);
    trust(&desktop, &laptop);
    know_address(&laptop, &desktop).expect("address");
    connect(&laptop, &desktop).await;
    let since = super::mesh::now_ms() - 1_000.0;

    let jobs = &laptop.svc.remote_jobs;
    for (topic, body) in [
        ("onboard/t1", "first"),
        ("onboard/t7", "echo 42"),
        ("other", "x"),
    ] {
        let sent = jobs
            .send_cli_mail(&desktop.id, topic, body)
            .await
            .expect("send");
        assert_eq!(sent.kind, REMOTE_JOB_KIND_CLI_MAIL);
        let done = settled(&laptop.pool, &sent.id).await;
        assert_eq!(
            done.status,
            RemoteJobStatus::Completed,
            "delivered = completed"
        );
    }
    let mail = desktop
        .svc
        .remote_jobs
        .list_cli_mail(since, Some("onboard/"))
        .expect("read");
    assert_eq!(
        mail.iter()
            .map(|m| (m.topic.as_str(), m.body.as_str()))
            .collect::<Vec<_>>(),
        vec![("onboard/t1", "first"), ("onboard/t7", "echo 42")],
        "oldest first, filtered by prefix"
    );
    assert!(mail.iter().all(|m| m.peer_id == laptop.id));
    assert_eq!(
        desktop
            .svc
            .remote_jobs
            .list_cli_mail(since, None)
            .unwrap()
            .len(),
        3
    );
    assert!(desktop
        .svc
        .remote_jobs
        .list_cli_mail(super::mesh::now_ms() + 60_000.0, None)
        .unwrap()
        .is_empty());
    // Reading does not delete.
    assert_eq!(
        desktop
            .svc
            .remote_jobs
            .list_cli_mail(since, None)
            .unwrap()
            .len(),
        3
    );

    // Over 16 KB, sender side: refused before any row exists.
    let big = "x".repeat(personas_db::models::CLI_MAIL_MAX_BYTES + 1);
    let before = repo::list(&laptop.pool, None, 100).unwrap().len();
    assert!(matches!(
        jobs.send_cli_mail(&desktop.id, "onboard/big", &big).await,
        Err(AppError::Validation(_))
    ));
    assert_eq!(repo::list(&laptop.pool, None, 100).unwrap().len(), before);

    // Over 16 KB, receiver side: a raw request that skipped the check.
    let (mut send, mut recv) = laptop
        .svc
        .connections
        .open_stream(&desktop.id)
        .await
        .expect("stream");
    protocol::write_message(
        &mut send,
        &Message::RemoteJobRequest {
            job_id: "raw-big-mail".into(),
            kind: REMOTE_JOB_KIND_CLI_MAIL.into(),
            instruction: "CLI mail: onboard/big".into(),
            origin_display_name: "Laptop".into(),
            payload_json: Some(
                serde_json::json!({ "topic": "onboard/big", "body": big }).to_string(),
            ),
        },
    )
    .await
    .expect("write");
    let ack = tokio::time::timeout(WAIT, protocol::decode(&mut recv))
        .await
        .expect("answered in time")
        .expect("an ack");
    match ack {
        Message::RemoteJobAck {
            accepted, reason, ..
        } => {
            assert!(!accepted);
            assert!(
                reason.unwrap_or_default().contains("too large"),
                "the refusal names the limit"
            );
        }
        other => panic!("expected a refusal ack, got {other:?}"),
    }
    assert!(repo::get(&desktop.pool, "raw-big-mail").unwrap().is_none());
}
