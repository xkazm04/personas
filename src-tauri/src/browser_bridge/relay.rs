//! WebSocket relay between the bridge and the Chrome extension.
//!
//! One extension connection at a time (last connect wins — a reconnecting
//! service worker must displace its zombie predecessor). The MCP side calls
//! [`send_command`]; each command becomes one JSON frame
//! `{"id": n, "method": "...", "params": {...}}` and resolves when the
//! extension answers `{"id": n, "result": ...}` or `{"id": n, "error": "..."}`.
//! Frames without an `id` are events (console lines, lifecycle pings) —
//! logged at debug in Phase 1, surfaced to the UI in a later phase.
//!
//! MV3 note for the Phase 2 extension: WebSocket traffic resets the service
//! worker idle timer (Chrome 116+), so the extension should exchange a
//! keepalive frame every <30s. Anything without an `id` works — it lands in
//! the event arm here and costs nothing.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock, RwLock};
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::Query;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot};

/// Outbound frame queue bound. Far above the handful of commands the pending
/// map ever holds at once (each has a caller awaiting with a timeout), small
/// enough that a stalled extension socket (suspended MV3 service worker,
/// half-open TCP) is detected within kilobytes instead of growing an
/// unbounded queue until memory is the backstop. Local decision, not an
/// inherited number: sized to ~an order of magnitude above peak observed
/// in-flight commands (single digits).
const RELAY_QUEUE_CAP: usize = 256;

struct Shared {
    /// Writer half of the live extension connection (None = disconnected).
    /// Each connection gets a generation number so a stale socket's teardown
    /// can't clear a newer connection's sender. BOUNDED ([`RELAY_QUEUE_CAP`]):
    /// the send site sheds new commands loudly when the extension stops
    /// draining, rather than queueing without limit.
    sender: RwLock<Option<(u64, mpsc::Sender<Message>)>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    next_request_id: AtomicU64,
    next_conn_id: AtomicU64,
}

static SHARED: OnceLock<Shared> = OnceLock::new();

fn shared() -> &'static Shared {
    SHARED.get_or_init(|| Shared {
        sender: RwLock::new(None),
        pending: Mutex::new(HashMap::new()),
        next_request_id: AtomicU64::new(1),
        next_conn_id: AtomicU64::new(1),
    })
}

pub fn is_connected() -> bool {
    shared()
        .sender
        .read()
        .unwrap_or_else(|p| p.into_inner())
        .is_some()
}

#[derive(serde::Deserialize)]
pub struct WsQuery {
    token: Option<String>,
}

/// `GET /browser-bridge/ws?token=<pairing token>` (or the
/// `X-Browser-Bridge-Token` header). Rejects bad tokens BEFORE the upgrade —
/// an arbitrary web page can reach this port, so the handshake is the gate.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    headers: HeaderMap,
) -> Response {
    let presented = q.token.or_else(|| {
        headers
            .get("x-browser-bridge-token")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    });
    let expected = super::pairing_token();
    if presented.as_deref() != Some(expected.as_str()) {
        tracing::warn!("browser-bridge: WS connect rejected (bad or missing pairing token)");
        return (StatusCode::UNAUTHORIZED, "bad or missing pairing token").into_response();
    }
    ws.on_upgrade(handle_socket).into_response()
}

async fn handle_socket(socket: WebSocket) {
    let conn_id = shared().next_conn_id.fetch_add(1, Ordering::Relaxed);
    let (tx, mut rx) = mpsc::channel::<Message>(RELAY_QUEUE_CAP);

    // Install as THE connection (last wins). A displaced predecessor's writer
    // task ends when its rx counterpart drops here.
    {
        let mut guard = shared().sender.write().unwrap_or_else(|p| p.into_inner());
        if guard.is_some() {
            tracing::info!("browser-bridge: new extension connection displaces the previous one");
        }
        *guard = Some((conn_id, tx));
    }
    // Commands in flight on the OLD connection can never be answered now.
    fail_all_pending("extension reconnected mid-command");
    tracing::info!(conn_id, "browser-bridge: extension connected");

    let (mut sink, mut stream) = socket.split();

    // Writer: forward queued frames to the socket.
    let writer = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Reader: route responses to their pending oneshots.
    while let Some(msg) = stream.next().await {
        match msg {
            Ok(Message::Text(text)) => on_frame(text.as_str()),
            Ok(Message::Close(_)) | Err(_) => break,
            // Ping/Pong are answered at the protocol layer by axum/tungstenite.
            Ok(_) => {}
        }
    }

    // Teardown — only clear the slot if it's still OUR connection.
    {
        let mut guard = shared().sender.write().unwrap_or_else(|p| p.into_inner());
        if guard.as_ref().is_some_and(|(id, _)| *id == conn_id) {
            *guard = None;
        }
    }
    fail_all_pending("extension disconnected");
    writer.abort();
    tracing::info!(conn_id, "browser-bridge: extension disconnected");
}

fn on_frame(text: &str) {
    let frame: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "browser-bridge: unparseable frame from extension");
            return;
        }
    };
    let Some(id) = frame.get("id").and_then(|v| v.as_u64()) else {
        // Event frame (keepalive, console push, ...) — Phase 1 just logs it.
        tracing::debug!(frame = %frame, "browser-bridge: extension event");
        return;
    };
    let waiter = {
        let mut pending = shared().pending.lock().unwrap_or_else(|p| p.into_inner());
        pending.remove(&id)
    };
    let Some(waiter) = waiter else {
        tracing::debug!(id, "browser-bridge: response for unknown/timed-out request");
        return;
    };
    let outcome = if let Some(err) = frame.get("error") {
        Err(err
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| err.to_string()))
    } else {
        Ok(frame.get("result").cloned().unwrap_or(Value::Null))
    };
    let _ = waiter.send(outcome);
}

fn fail_all_pending(reason: &str) {
    let drained: Vec<_> = {
        let mut pending = shared().pending.lock().unwrap_or_else(|p| p.into_inner());
        pending.drain().collect()
    };
    for (_, waiter) in drained {
        let _ = waiter.send(Err(reason.to_string()));
    }
}

/// Send one command frame to the extension and await its response.
pub async fn send_command(method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
    let tx = {
        let guard = shared().sender.read().unwrap_or_else(|p| p.into_inner());
        guard
            .as_ref()
            .map(|(_, tx)| tx.clone())
            .ok_or("no browser extension connected to the bridge")?
    };
    let id = shared().next_request_id.fetch_add(1, Ordering::Relaxed);
    let (otx, orx) = oneshot::channel();
    {
        let mut pending = shared().pending.lock().unwrap_or_else(|p| p.into_inner());
        pending.insert(id, otx);
    }
    let frame = json!({ "id": id, "method": method, "params": params }).to_string();
    // Shed policy: reject-NEW, loudly, at the door. Every queued frame has a
    // caller awaiting with a deadline — blocking here would hide the stall
    // inside those deadlines, and dropping OLD frames would break the
    // request/response pairing of commands already counted as sent. A shed is
    // a counted event, not a silent reset.
    if let Err(e) = tx.try_send(Message::Text(frame.into())) {
        let mut pending = shared().pending.lock().unwrap_or_else(|p| p.into_inner());
        pending.remove(&id);
        return Err(match e {
            mpsc::error::TrySendError::Full(_) => {
                tracing::warn!(
                    method,
                    capacity = RELAY_QUEUE_CAP,
                    "browser-bridge: outbound queue full — command shed (extension not draining)"
                );
                format!(
                    "browser-bridge outbound queue full ({RELAY_QUEUE_CAP} frames; extension not draining) — `{method}` shed"
                )
            }
            mpsc::error::TrySendError::Closed(_) => {
                "extension connection closed while sending".to_string()
            }
        });
    }
    match tokio::time::timeout(timeout, orx).await {
        Ok(Ok(outcome)) => outcome,
        Ok(Err(_)) => Err("extension connection dropped while waiting".to_string()),
        Err(_) => {
            let mut pending = shared().pending.lock().unwrap_or_else(|p| p.into_inner());
            pending.remove(&id);
            Err(format!(
                "extension did not answer `{method}` within {}s",
                timeout.as_secs()
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shed policy is witnessed without a socket: install a full bounded
    /// sender as THE connection and prove a new command fails loudly (naming
    /// the condition), removes its pending entry, and does not block.
    #[tokio::test]
    async fn queue_full_sheds_the_new_command_loudly() {
        let (tx, _rx) = mpsc::channel::<Message>(1);
        tx.try_send(Message::Text("occupant".to_string().into()))
            .expect("fill the one-slot queue");
        {
            let mut guard = shared().sender.write().unwrap_or_else(|p| p.into_inner());
            *guard = Some((u64::MAX, tx));
        }

        let err = send_command("noop", json!({}), Duration::from_secs(5))
            .await
            .expect_err("a full queue must shed, not succeed");
        assert!(
            err.contains("queue full"),
            "error names the condition: {err}"
        );
        assert!(err.contains("noop"), "error names the shed command: {err}");
        assert!(
            shared()
                .pending
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .is_empty(),
            "the shed command's pending entry is removed"
        );

        // Leave the global slot clean for any other test in this binary.
        let mut guard = shared().sender.write().unwrap_or_else(|p| p.into_inner());
        *guard = None;
    }
}
