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
    FleetSessionJobPayload, FleetSessionJobReceipt, RemoteJobStatus, RemoteSessionCommand,
    RemoteSessionMode, REMOTE_JOB_KIND_FLEET_SESSION,
};
use personas_db::repos::resources::owned_devices as owned_repo;
use personas_db::repos::resources::remote_jobs as repo;
use personas_db::DbPool;

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
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let id = COUNTER.fetch_add(1, Ordering::Relaxed);
    let uri = format!("file:p2p_loopback_testdb_{id}?mode=memory&cache=shared");
    let pool = r2d2::Pool::builder()
        .max_size(8)
        .build(r2d2_sqlite::SqliteConnectionManager::file(&uri))
        .expect("pool");
    {
        let conn = pool.get().expect("conn");
        conn.execute_batch("PRAGMA foreign_keys = ON;").expect("fk");
        personas_db::migrations::run(&conn).expect("migrations");
        personas_db::migrations::run_incremental(&conn).expect("incremental");
    }
    pool
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
    pool.get()
        .expect("conn")
        .execute(
            "INSERT INTO local_identity (id, peer_id, public_key, display_name) VALUES (1, ?1, ?2, ?3)",
            rusqlite::params![
                crate::identity::public_key_to_peer_id(&key.verifying_key()),
                key.verifying_key().as_bytes().to_vec(),
                name
            ],
        )
        .expect("seed local_identity");
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

/// `on` records `peer` as one of its own paired devices.
fn trust(on: &Node, peer: &Node) {
    let group = owned_repo::ensure_device_group_id(&on.pool).expect("group");
    owned_repo::register_paired_device(&on.pool, &peer.id, &group, &peer.name, "pk").expect("pair");
}

/// `on` learns where `peer` listens: the row mDNS would have written.
fn know_address(on: &Node, peer: &Node) {
    let now = chrono::Utc::now().to_rfc3339();
    on.pool
        .get()
        .expect("conn")
        .execute(
            "INSERT INTO discovered_peers
               (peer_id, display_name, addresses, last_seen_at, first_seen_at, is_connected, metadata, trust_status)
             VALUES (?1, ?2, ?3, ?4, ?4, 0, NULL, 'unverified')",
            rusqlite::params![
                peer.id,
                peer.name,
                format!("[\"127.0.0.1:{}\"]", peer.port),
                now
            ],
        )
        .expect("discovered row");
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
}

#[async_trait::async_trait]
impl RemoteJobExecutor for Stub {
    async fn execute(&self, job: RemoteJobAssignment, handle: RemoteJobHandle) {
        let stub = self.clone();
        tokio::spawn(async move {
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
        });
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
    know_address(&laptop, &desktop);
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
    know_address(&stranger, &home);
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

    assert!(
        repo::list(&home.pool, None, 50).unwrap().is_empty(),
        "no row for an unpaired sender"
    );
    assert!(
        home.svc.remote_jobs.emitted.lock().unwrap().is_empty(),
        "nothing from an unpaired sender reaches the UI"
    );
}
