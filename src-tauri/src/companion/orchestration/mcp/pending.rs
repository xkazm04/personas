//! Pending MCP request hub — blocking RPC bridge to Athena's chat UI.
//!
//! `request_guidance` and `request_approval` are blocking MCP tool
//! calls — the claude session is paused on the HTTP response until
//! Athena (or the user) replies. We can't keep them in axum's handler
//! state directly because the reply comes from a Tauri command on the
//! frontend, not from within axum.
//!
//! Pattern: at request time, mint an id, register a oneshot::Sender in
//! [`PendingHub`], emit a Tauri event with the id + payload so the
//! frontend can render it, then await the oneshot::Receiver in the
//! axum handler. When the frontend resolves the request via
//! [`companion_mcp_resolve_request`], we look up the sender and ship
//! the response back.
//!
//! TTL: pending requests are dropped if not resolved within
//! [`REQUEST_TTL`]. The session sees the MCP call return with an
//! "expired" error and can decide how to proceed (typically: continue
//! with its best guess).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::oneshot;
use uuid::Uuid;

/// How long a blocking MCP call waits for a frontend resolution before
/// timing out. Tuned for "user steps away to fetch coffee" but bounded
/// so a forgotten card doesn't hang a claude session indefinitely.
pub const REQUEST_TTL: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RequestKind {
    Guidance,
    Approval,
}

impl RequestKind {
    pub fn event_name(self) -> &'static str {
        match self {
            RequestKind::Guidance => "athena://mcp/guidance-request",
            RequestKind::Approval => "athena://mcp/approval-request",
        }
    }
}

/// Payload emitted to the frontend when a session calls one of the
/// blocking tools. `request_id` is what the frontend echoes back via
/// `companion_mcp_resolve_request`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestNotice {
    pub request_id: String,
    pub fleet_session_id: String,
    pub kind: RequestKind,
    pub payload: Value,
}

struct PendingEntry {
    sender: oneshot::Sender<Result<Value, String>>,
    created_at: Instant,
    kind: RequestKind,
    fleet_session_id: String,
}

#[derive(Default)]
struct PendingHub {
    by_id: HashMap<String, PendingEntry>,
}

static HUB: OnceLock<Mutex<PendingHub>> = OnceLock::new();

fn hub() -> &'static Mutex<PendingHub> {
    HUB.get_or_init(|| Mutex::new(PendingHub::default()))
}

/// Submit a new pending request. Returns the request id (so the caller
/// can emit it to the frontend) and a receiver that resolves when the
/// frontend calls [`resolve`] or the TTL fires.
pub fn submit(
    fleet_session_id: &str,
    kind: RequestKind,
) -> (String, oneshot::Receiver<Result<Value, String>>) {
    let id = format!("mcpreq_{}", Uuid::new_v4().simple());
    let (tx, rx) = oneshot::channel::<Result<Value, String>>();
    let mut h = hub().lock().unwrap_or_else(|p| p.into_inner());
    sweep_expired(&mut h);
    h.by_id.insert(
        id.clone(),
        PendingEntry {
            sender: tx,
            created_at: Instant::now(),
            kind,
            fleet_session_id: fleet_session_id.to_string(),
        },
    );
    (id, rx)
}

/// Frontend resolution path. Returns true if a pending request was
/// matched and the response sent to its waiter.
pub fn resolve(request_id: &str, response: Result<Value, String>) -> bool {
    let entry = {
        let mut h = hub().lock().unwrap_or_else(|p| p.into_inner());
        h.by_id.remove(request_id)
    };
    match entry {
        Some(e) => e.sender.send(response).is_ok(),
        None => false,
    }
}

/// Cancel any pending requests bound to this Fleet session. Called on
/// session exit so the blocking MCP call returns immediately with an
/// "exited" error instead of waiting for TTL.
pub fn cancel_for_session(fleet_session_id: &str) {
    let mut h = hub().lock().unwrap_or_else(|p| p.into_inner());
    let ids: Vec<String> = h
        .by_id
        .iter()
        .filter(|(_, e)| e.fleet_session_id == fleet_session_id)
        .map(|(id, _)| id.clone())
        .collect();
    for id in ids {
        if let Some(e) = h.by_id.remove(&id) {
            let _ = e.sender.send(Err("session exited before request resolved".to_string()));
        }
    }
}

/// Inspect pending requests for diagnostics. Returns (id, kind,
/// fleet_session_id) tuples.
pub fn snapshot() -> Vec<(String, RequestKind, String)> {
    let h = hub().lock().unwrap_or_else(|p| p.into_inner());
    h.by_id
        .iter()
        .map(|(id, e)| (id.clone(), e.kind, e.fleet_session_id.clone()))
        .collect()
}

fn sweep_expired(h: &mut PendingHub) {
    let now = Instant::now();
    let expired: Vec<String> = h
        .by_id
        .iter()
        .filter(|(_, e)| now.duration_since(e.created_at) > REQUEST_TTL)
        .map(|(id, _)| id.clone())
        .collect();
    for id in expired {
        if let Some(e) = h.by_id.remove(&id) {
            let _ = e.sender.send(Err("request expired".to_string()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reset() {
        let mut h = hub().lock().unwrap_or_else(|p| p.into_inner());
        h.by_id.clear();
    }

    #[tokio::test(flavor = "current_thread")]
    async fn submit_and_resolve_round_trip() {
        reset();
        let (id, rx) = submit("sess-1", RequestKind::Guidance);
        assert!(id.starts_with("mcpreq_"));
        assert!(resolve(&id, Ok(serde_json::json!({"text": "go for it"}))));
        let r = rx.await.unwrap().unwrap();
        assert_eq!(r["text"], "go for it");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn resolve_unknown_id_returns_false() {
        reset();
        assert!(!resolve("mcpreq_does-not-exist", Ok(Value::Null)));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn cancel_for_session_releases_waiters() {
        reset();
        let (_id, rx) = submit("sess-cancel", RequestKind::Approval);
        cancel_for_session("sess-cancel");
        let r = rx.await.unwrap();
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("exited"));
    }

    #[test]
    fn snapshot_reports_pending() {
        reset();
        let (id1, _rx1) = submit("sess-A", RequestKind::Guidance);
        let (id2, _rx2) = submit("sess-B", RequestKind::Approval);
        let snap = snapshot();
        assert_eq!(snap.len(), 2);
        let ids: Vec<_> = snap.iter().map(|(i, _, _)| i.clone()).collect();
        assert!(ids.contains(&id1));
        assert!(ids.contains(&id2));
    }
}
