//! Minimal Chrome DevTools Protocol client over one loopback WebSocket.
//!
//! Request/response is driven inline (no reader task): `call` sends a command
//! and reads messages until the matching id arrives, counting the page-load
//! events it passes on the way. The session is `&mut`-exclusive, so nothing
//! else needs the socket, and there is no spawned task whose death could go
//! unreported.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio::time::{timeout, Instant};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{client_async, WebSocketStream};

use super::LaneError;
use crate::commands::fleet::claude_accounts::relogin::ReloginReason;

pub(super) const CALL_TIMEOUT: Duration = Duration::from_secs(15);

pub(super) struct Cdp {
    ws: WebSocketStream<TcpStream>,
    next_id: u64,
    loads: u64,
    closed: bool,
}

fn other(detail: impl Into<String>) -> LaneError {
    LaneError::new(ReloginReason::Other, detail)
}

fn timed_out(what: &str) -> LaneError {
    LaneError::new(ReloginReason::Timeout, format!("{what} timed out"))
}

impl Cdp {
    /// Connect to `path` (e.g. `/devtools/page/<id>`) on 127.0.0.1:`port`. Only
    /// the path is taken from Chrome's advertised URL; the host is always ours.
    pub(super) async fn connect(port: u16, path: &str) -> Result<Self, LaneError> {
        let tcp = timeout(
            Duration::from_secs(5),
            TcpStream::connect(("127.0.0.1", port)),
        )
        .await
        .map_err(|_| timed_out("cdp tcp connect"))?
        .map_err(|e| other(format!("cdp tcp connect: {e}")))?;
        let url = format!("ws://127.0.0.1:{port}{path}");
        let (ws, _) = timeout(Duration::from_secs(5), client_async(url, tcp))
            .await
            .map_err(|_| timed_out("cdp handshake"))?
            .map_err(|e| other(format!("cdp handshake: {e}")))?;
        Ok(Self {
            ws,
            next_id: 0,
            loads: 0,
            closed: false,
        })
    }

    pub(super) fn is_closed(&self) -> bool {
        self.closed
    }

    pub(super) fn load_count(&self) -> u64 {
        self.loads
    }

    async fn next_message(&mut self, deadline: Instant) -> Result<Value, LaneError> {
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(timed_out("cdp read"));
            }
            match timeout(remaining, self.ws.next()).await {
                Err(_) => return Err(timed_out("cdp read")),
                Ok(None) => {
                    self.closed = true;
                    return Err(other("cdp closed"));
                }
                Ok(Some(Err(e))) => {
                    self.closed = true;
                    return Err(other(format!("cdp closed: {e}")));
                }
                Ok(Some(Ok(Message::Text(t)))) => {
                    let Ok(v) = serde_json::from_str::<Value>(t.as_str()) else {
                        continue;
                    };
                    if v.get("method").and_then(Value::as_str) == Some("Page.loadEventFired") {
                        self.loads += 1;
                    }
                    return Ok(v);
                }
                Ok(Some(Ok(Message::Close(_)))) => {
                    self.closed = true;
                    return Err(other("cdp closed"));
                }
                Ok(Some(Ok(_))) => {}
            }
        }
    }

    /// Send one command and return its `result`. A protocol `error` becomes a
    /// `LaneError` carrying only Chrome's message, never the params (which may
    /// hold a secret being typed).
    pub(super) async fn call(
        &mut self,
        method: &str,
        params: Value,
        within: Duration,
    ) -> Result<Value, LaneError> {
        self.next_id += 1;
        let id = self.next_id;
        let msg = json!({ "id": id, "method": method, "params": params }).to_string();
        if let Err(e) = self.ws.send(Message::text(msg)).await {
            self.closed = true;
            return Err(other(format!("{method}: cdp send failed: {e}")));
        }
        let deadline = Instant::now() + within;
        loop {
            let v = self.next_message(deadline).await?;
            if v.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }
            if let Some(err) = v.get("error") {
                let m = err
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("protocol error");
                return Err(other(format!("{method}: {m}")));
            }
            return Ok(v.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    /// Pump events until a load event beyond `baseline` arrives.
    pub(super) async fn wait_load(
        &mut self,
        baseline: u64,
        within: Duration,
    ) -> Result<(), LaneError> {
        let deadline = Instant::now() + within;
        while self.loads <= baseline {
            self.next_message(deadline).await?;
        }
        Ok(())
    }

    /// `Runtime.evaluate` with `returnByValue`; a thrown exception is an error
    /// whose text is NOT forwarded (it can echo page content).
    pub(super) async fn evaluate(&mut self, expression: &str) -> Result<Value, LaneError> {
        let r = self
            .call(
                "Runtime.evaluate",
                json!({ "expression": expression, "returnByValue": true }),
                CALL_TIMEOUT,
            )
            .await?;
        if r.get("exceptionDetails").is_some() {
            return Err(other("script exception"));
        }
        Ok(r.pointer("/result/value").cloned().unwrap_or(Value::Null))
    }
}
