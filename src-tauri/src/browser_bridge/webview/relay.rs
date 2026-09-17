//! The page relay — ported from athena-portable's `bridge.rs`.
//!
//! Source: `C:\Users\kazda\kiro\athena-portable\apps\desktop\src-tauri\src\bridge.rs`
//! at athena-portable `c5ec8ca`. Wire format:
//! `C:\Users\kazda\kiro\athena-portable\packages\athena-bridge\protocol.md`.
//! Nothing here may invent a message that file does not describe.
//!
//! ```text
//!   Rust ──eval postMessage {dir:"to-page"}──────────────▶ page
//!   Rust ◀──ws frame on /browser-bridge/page-ws?tab&token── page
//! ```
//!
//! Two initialization scripts run in every page webview at document start.
//! The first is `inject.js` (WebMCP detect + polyfill), embedded with
//! `include_str!` so there is one copy. The second is [`relay_script`], a
//! closure with this tab's id, its token and the local server's port baked in,
//! whose whole job is to forward the page's `to-ext` messages back.
//!
//! **What changed in the port, and why.** athena-portable's page half answers
//! by calling a Tauri command; Personas' pages cannot. Tauri ACL-checks every
//! invoke from a REMOTE origin whether or not the app declares an ACL manifest
//! (`tauri-2.11.2/src/webview/mod.rs:1822`), Personas declares none, and the
//! `allow-*` permission a capability would grant is generated only BY an app
//! manifest — turning one on would gate all 1,656 commands app-wide. So the
//! answer channel is the one this bridge already owns: a WebSocket to the
//! shared `local_http` server, the same transport and the same threat model as
//! the extension relay next door. The namespaces are `personas-page` and
//! `personas-hands`. Everything else — the token, the id namespace, the
//! two-timer arrangement, "a reply the relay cannot place is dropped and said
//! so" — is the source's, tests included.
//!
//! **What stands between a hostile page and the relay.**
//!
//! 1. the per-tab **token**, minted in Rust and closed over by the relay
//!    script, which runs before any page script and never puts the value on an
//!    object the page can reach. It is checked BEFORE the socket upgrade, and
//!    it is deliberately NOT the extension's pairing token — a page that could
//!    present that credential could receive the extension's commands;
//! 2. the **id namespace**: every id is `<tab>:<n>-<random>`, a reply is only
//!    matched against a pending request of its own tab, and the random tail
//!    means a page cannot name an id it was never handed. So even a page that
//!    guessed a token could answer only its own questions;
//! 3. **the page was always the responder.** All a page can return is a tool
//!    result, which is what it returns on every surface. Tool results are
//!    untrusted input downstream — the gate, the budget, the approval card —
//!    and this module changes none of that.
//!
//! **The socket's one cost.** The script runs in the page's own world, so the
//! PAGE's `connect-src` governs it: a site with a strict CSP blocks the
//! connection and its hands answer `timeout`. Navigation, tabs, viewport and
//! capture are unaffected. Chromium exempts loopback from mixed-content
//! blocking, so the `https`-page-to-`ws://127.0.0.1` step is fine; CSP is a
//! separate policy and is the one that bites.
//!
//! Nothing here decides anything: this module carries bytes between two
//! processes and times them out.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::Query;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use futures_util::StreamExt;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;

use super::tabs;

/// The page's own namespace (`inject.js`, the WebMCP half).
pub const NS: &str = "personas-page";

/// The generic hands' namespace (`hands.js`).
///
/// A second namespace rather than a second `type` on the first, because
/// `inject.js` answers an unrecognised `type` with `{ok:false, error:"Unknown
/// request …"}` — so a hand sent under the page's namespace would be answered
/// TWICE, once by the page's polyfill and once by the hands script, and which
/// arrived first would decide the result. The relay forwards both namespaces
/// and routes by id, which is minted here and unique across them.
pub const HANDS_NS: &str = "personas-hands";

/// A request, addressed at the page's listener.
const DIR_PAGE: &str = "to-page";

/// A reply or an event, coming back.
const DIR_EXT: &str = "to-ext";

/// The relay's own deadline for one request, deliberately longer than the
/// page's 30 s: the page's abort is supposed to win and produce a real error,
/// and this timer only covers a page that is gone, frozen, or has no bridge.
const CALL_TIMEOUT: Duration = Duration::from_secs(35);

/// The page's half of the bridge, embedded at compile time.
pub const INJECT_JS: &str = include_str!("inject.js");

/// The largest answer one frame may carry. `hands.js` bounds its own reads at
/// 4,000 characters and the shell cuts again at `SNAPSHOT_CAP_CHARS`; this is
/// the third wall, on the socket, for a page that sends something neither
/// script produced. Generous enough that no honest answer is lost, small
/// enough that a page cannot make the shell hold megabytes per frame.
const MAX_FRAME_BYTES: usize = 256 * 1024;

/// The relay's whole state: what is parked, and which token each tab's scripts
/// were built with.
///
/// A module static, not Tauri managed state — the same `OnceLock` pattern the
/// module next door uses and for the same reason: the axum route that feeds
/// this map is mounted on a stateless `Router` and has no `AppHandle` to ask.
#[derive(Default)]
pub struct Relay {
    state: Mutex<RelayState>,
    seq: AtomicU64,
}

static RELAY: OnceLock<Relay> = OnceLock::new();

/// The process-wide relay. Every caller reaches it through here.
pub fn shared() -> &'static Relay {
    RELAY.get_or_init(Relay::default)
}

#[derive(Default)]
struct RelayState {
    /// Request id → the caller waiting for it. An entry leaves by exactly one
    /// of two paths: the reply that matches it, or the timer that gave up.
    pending: HashMap<String, oneshot::Sender<Value>>,
    /// Tab id → the token its initialization script closed over, which is also
    /// what that tab's page socket authenticates with.
    nonces: HashMap<u32, String>,
}

/// What [`Relay::settle`] did with a message the page sent. Every variant is a
/// *result*: a reply the relay cannot place is dropped and said so, never a
/// panic and never an error the page can read anything out of.
#[derive(Debug, PartialEq, Eq)]
enum Settled {
    /// The unsolicited change notification.
    Toolchange,
    /// Handed to the waiting request.
    Delivered,
    /// Dropped, for the reason named.
    Ignored(&'static str),
}

impl Relay {
    fn lock(&self) -> MutexGuard<'_, RelayState> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// This tab's nonce, minted on the first script build and kept for the life
    /// of the tab. Deliberately *not* per document: an initialization script
    /// re-runs on every navigation and each run has to close over a value the
    /// shell still recognises.
    fn token_for(&self, tab: u32) -> String {
        self.lock()
            .nonces
            .entry(tab)
            .or_insert_with(random_token)
            .clone()
    }

    fn token_matches(&self, tab: u32, token: &str) -> bool {
        self.lock().nonces.get(&tab).is_some_and(|n| n == token)
    }

    /// Drop everything a closed tab owned: its nonce, so a stale script cannot
    /// answer, and any request still parked for it, so nobody waits 35 s for a
    /// page that is gone.
    fn forget_tab(&self, tab: u32) {
        let mut state = self.lock();
        state.nonces.remove(&tab);
        let prefix = format!("{tab}:");
        state.pending.retain(|id, _| !id.starts_with(&prefix));
    }

    /// `<tab>:<n>-<random>`. The counter keeps ids readable in a log; the
    /// random tail is what stops a page naming a request it was never handed.
    fn next_id(&self, tab: u32) -> String {
        let n = self.seq.fetch_add(1, Ordering::Relaxed);
        format!("{tab}:{n}-{}", random_token())
    }

    /// Park a request and hand back its id and the receiver the caller awaits.
    fn park(&self, tab: u32) -> (String, oneshot::Receiver<Value>) {
        let id = self.next_id(tab);
        let (tx, rx) = oneshot::channel();
        self.lock().pending.insert(id.clone(), tx);
        (id, rx)
    }

    /// Forget a parked request. The timeout path's half of the id map's
    /// invariant: a request leaves the map exactly once, whether it was
    /// answered or given up on.
    fn forget(&self, id: &str) -> bool {
        self.lock().pending.remove(id).is_some()
    }

    /// Place one `to-ext` message. Pure enough to test: it reads the map, it
    /// writes the map, and it touches no app handle.
    fn settle(&self, tab: u32, body: Value) -> Settled {
        // `toolchange` is unsolicited and carries no id.
        if body.get("type").and_then(Value::as_str) == Some("toolchange") {
            return Settled::Toolchange;
        }
        let Some(id) = body.get("id").and_then(Value::as_str) else {
            return Settled::Ignored("a reply without an id");
        };
        if !id.starts_with(&format!("{tab}:")) {
            return Settled::Ignored("an id belonging to another tab");
        }
        let Some(tx) = self.lock().pending.remove(id) else {
            // The late reply: the timer already resolved this call and forgot
            // the id. The ordinary end of a slow page, not an error.
            return Settled::Ignored("an unknown or expired id");
        };
        if tx.send(body).is_err() {
            return Settled::Ignored("a caller that had already stopped waiting");
        }
        Settled::Delivered
    }

    #[cfg(test)]
    fn parked(&self) -> usize {
        self.lock().pending.len()
    }
}

/// The two initialization scripts a page webview is built with, in the order
/// they must run.
///
/// `port` is the shared `local_http` server's, which the page dials back on.
/// `None` means the server is not up yet and there is no answer channel to
/// hand the page — the caller refuses rather than building a tab whose hands
/// can never answer.
pub fn scripts(tab: u32, port: u16) -> (&'static str, String) {
    let token = shared().token_for(tab);
    (INJECT_JS, relay_script(tab, &token, port))
}

/// Drop a closed tab's relay state.
pub fn forget_tab(tab: u32) {
    shared().forget_tab(tab);
}

/// The forwarder. Everything it needs is baked in as a JSON literal, so nothing
/// in it can be broken out of, and the token lives only in this closure's
/// scope — never on an object the page can reach.
///
/// **A socket, not an `invoke`.** athena-portable's page half calls a Tauri
/// command; Personas' pages cannot. Tauri ACL-checks every invoke from a
/// REMOTE origin whether or not the app declares an ACL manifest
/// (`tauri-2.11.2/src/webview/mod.rs:1822`), Personas declares none, and the
/// `allow-*` permission that would grant one is generated only by an app
/// manifest — which would gate all 1,656 commands app-wide. So the answer
/// channel is the one this bridge already owns: a WebSocket to the shared
/// `local_http` server, the same transport and the same reasoning as the
/// extension relay next door (`browser_bridge/mod.rs`, "any web page's JS can
/// open a socket to 127.0.0.1, so the handshake must carry a secret"). Chromium
/// exempts loopback from mixed-content blocking, so an `https` page may open
/// `ws://127.0.0.1`.
///
/// **What it costs, stated rather than hidden.** This runs in the page's own
/// world, so the PAGE's `connect-src` governs it: a site with a strict CSP
/// blocks the socket and its hands answer `timeout`. An `invoke` would not have
/// been subject to that. It is the price of the channel, not a defect in it.
fn relay_script(tab: u32, token: &str, port: u16) -> String {
    let ns = json_literal(NS);
    let hands_ns = json_literal(HANDS_NS);
    let dir = json_literal(DIR_EXT);
    let url = json_literal(&format!(
        "ws://127.0.0.1:{port}/browser-bridge/page-ws?tab={tab}&token={token}"
    ));
    format!(
        r#"(() => {{
  "use strict";
  const NS = {ns};
  const HANDS = {hands_ns};
  const DIR = {dir};
  const URL = {url};
  /** Answers produced before the socket is open. Bounded: a page whose CSP
   *  blocks the socket must not grow a queue for the life of the document. */
  const PENDING_CAP = 64;
  let sock = null;
  let queue = [];

  function ensure() {{
    if (sock && (sock.readyState === 0 || sock.readyState === 1)) return sock;
    try {{
      sock = new WebSocket(URL);
    }} catch (e) {{
      // A CSP that forbids the connection throws here. No bridge, no answers,
      // and the page is not ours to break.
      sock = null;
      return null;
    }}
    sock.addEventListener("open", () => {{
      const held = queue;
      queue = [];
      for (const line of held) {{
        try {{ sock.send(line); }} catch (e) {{ /* gone again */ }}
      }}
    }});
    sock.addEventListener("close", () => {{ sock = null; }});
    sock.addEventListener("error", () => {{ /* close follows */ }});
    return sock;
  }}
  ensure();

  window.addEventListener("message", (event) => {{
    // A frame is not the page, exactly as in inject.js: only this document
    // answers for itself.
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    if ((msg.__ns !== NS && msg.__ns !== HANDS) || msg.dir !== DIR) return;
    const payload = {{}};
    for (const key of Object.keys(msg)) {{
      if (key !== "__ns" && key !== "dir") payload[key] = msg[key];
    }}
    let line;
    try {{ line = JSON.stringify(payload); }} catch (e) {{ return; }}
    const open = ensure();
    if (open && open.readyState === 1) {{
      try {{ open.send(line); return; }} catch (e) {{ /* fall through to the queue */ }}
    }}
    if (queue.length < PENDING_CAP) queue.push(line);
  }});
}})();
"#
    )
}

// ---------------------------------------------------------------------------
// The page's socket
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
pub struct PageWsQuery {
    tab: u32,
    token: String,
}

/// `GET /browser-bridge/page-ws?tab=<id>&token=<per-tab token>`.
///
/// Authenticated BEFORE the upgrade, per TAB, against the token that tab's
/// initialization script closed over. Deliberately NOT the pairing token: a
/// page is not the extension, and one that could present the extension's
/// credential could receive the extension's commands.
///
/// The socket is **one-way**. Requests still go out over `eval` +
/// `postMessage` (a webview has no other inbound door); this carries answers
/// back, and a frame the shell sends would have nowhere to be read.
pub async fn page_ws_handler(ws: WebSocketUpgrade, Query(q): Query<PageWsQuery>) -> Response {
    if !shared().token_matches(q.tab, &q.token) {
        // Not detailed to the caller: a wrong token is a stale script from a
        // closed tab or a page trying it on, and the two are the caller's to
        // tell apart, never ours to explain.
        tracing::warn!(tab = q.tab, "browser page-ws: connect rejected (bad token)");
        return (StatusCode::UNAUTHORIZED, "bad or missing tab token").into_response();
    }
    let tab = q.tab;
    ws.on_upgrade(move |socket| page_socket(tab, socket))
        .into_response()
}

/// One page's answer stream. Every text frame is one `to-ext` payload — the
/// same object `browser_page_reply` used to take — and is placed by
/// [`Relay::settle`], which drops anything it cannot match.
async fn page_socket(tab: u32, mut socket: WebSocket) {
    tracing::debug!(tab, "browser page-ws: page connected");
    while let Some(msg) = socket.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                if text.len() > MAX_FRAME_BYTES {
                    tracing::warn!(
                        tab,
                        bytes = text.len(),
                        cap = MAX_FRAME_BYTES,
                        "browser page-ws: oversized frame dropped"
                    );
                    continue;
                }
                match serde_json::from_str::<Value>(text.as_str()) {
                    Ok(payload) => place(tab, payload),
                    Err(e) => {
                        tracing::debug!(tab, error = %e, "browser page-ws: unparseable frame")
                    }
                }
            }
            Ok(Message::Close(_)) | Err(_) => break,
            // Ping/Pong are answered at the protocol layer by axum.
            Ok(_) => {}
        }
    }
    tracing::debug!(tab, "browser page-ws: page disconnected");
}

/// Place one answer. The token was checked at the handshake and the id
/// namespace is checked here, so a page can answer only its own requests.
fn place(tab: u32, payload: Value) {
    match shared().settle(tab, payload) {
        Settled::Toolchange | Settled::Delivered => {}
        Settled::Ignored(why) => {
            tracing::debug!(tab, reason = %why, "browser relay: dropped a reply");
        }
    }
}

/// Send one `to-page` message on the page's namespace and wait for its answer.
pub async fn ask(app: &AppHandle, tab: u32, body: Value) -> Result<Value, String> {
    ask_with(app, tab, NS, body, CALL_TIMEOUT).await
}

/// [`ask`] on the hands' namespace. Same pending map, same deadline, same id
/// space.
pub async fn ask_hands(app: &AppHandle, tab: u32, body: Value) -> Result<Value, String> {
    ask_with(app, tab, HANDS_NS, body, CALL_TIMEOUT).await
}

async fn ask_with(
    app: &AppHandle,
    tab: u32,
    ns: &str,
    body: Value,
    timeout: Duration,
) -> Result<Value, String> {
    let webview = app
        .get_webview(&tabs::label_for(tab))
        .ok_or_else(|| format!("no tab {tab}"))?;

    let relay = shared();
    let (id, rx) = relay.park(tab);
    let script = post_script(&envelope(ns, DIR_PAGE, &id, body))?;
    if let Err(e) = webview.eval(script) {
        relay.forget(&id);
        return Err(format!("cannot reach tab {tab}: {e}"));
    }
    Ok(awaited(relay, id, rx, timeout).await)
}

/// The wait, and the one place a request is given up on. Separate from
/// [`ask_with`] so the timer and the id map can be tested without a window.
async fn awaited(
    relay: &Relay,
    id: String,
    rx: oneshot::Receiver<Value>,
    timeout: Duration,
) -> Value {
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(value)) => value,
        // The sender was dropped without sending: the map was cleared from
        // under us (a closed tab).
        Ok(Err(_)) => json!({ "ok": false, "error": "the relay was dropped" }),
        Err(_) => {
            relay.forget(&id);
            json!({ "ok": false, "reason": "timeout", "error": "timeout" })
        }
    }
}

// ---------------------------------------------------------------------------
// The envelope, and the one place a JSON value becomes a line of JavaScript.
// ---------------------------------------------------------------------------

/// The protocol's envelope with `body`'s fields at the top level beside it.
fn envelope(ns: &str, dir: &str, id: &str, body: Value) -> Value {
    let mut message = json!({ "__ns": ns, "dir": dir, "id": id });
    if let (Some(target), Some(source)) = (message.as_object_mut(), body.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
    message
}

/// `window.postMessage(<the message>, location.origin);`
///
/// The message is JSON-encoded **once** — `serde_json` is what escapes the
/// quotes, the newlines and the control characters — and then three sequences
/// JSON allows raw are spelled as escapes by [`js_safe`], because a JSON
/// document and a JavaScript expression are not quite the same language.
fn post_script(message: &Value) -> Result<String, String> {
    let json = serde_json::to_string(message).map_err(|e| e.to_string())?;
    Ok(format!(
        "window.postMessage({}, location.origin);",
        js_safe(&json)
    ))
}

/// The three sequences a JSON string may hold raw and a script host may not.
///
/// `U+2028` and `U+2029` were line terminators in JavaScript before ES2019.
/// `</` is escaped so the same text is safe the day somebody puts it inside a
/// `<script>` element — a page's tool output is untrusted text that has already
/// travelled through a model, and `</script>` is the first thing anyone tries.
/// `\/` and `\u2028` are both valid JSON escapes, so the value on the other
/// side is unchanged.
fn js_safe(json: &str) -> String {
    json.replace("</", "<\\/")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

/// A Rust string as a JavaScript string literal.
fn json_literal(value: &str) -> String {
    // INVARIANT: `serde_json::to_string` on a `&str` cannot fail — there is no
    // non-serialisable string — so this is the `static`-initialiser-shaped
    // exception the no-unwrap rule names, kept as a total function instead.
    js_safe(&serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string()))
}

/// 128 bits of hex, from the same source the bridge's pairing token uses.
fn random_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn the_embedded_bridge_is_the_file_beside_this_one() {
        assert!(
            INJECT_JS.contains(NS),
            "inject.js is not the bridge, or has stopped naming its own namespace"
        );
        assert!(INJECT_JS.contains("modelContext"));
    }

    #[test]
    fn the_two_namespaces_are_different_and_neither_is_athenas() {
        // A hand sent under the page's namespace would be answered twice — once
        // by the polyfill's "unknown request" and once by the hands script.
        assert_ne!(NS, HANDS_NS);
        assert!(!NS.contains("athena") && !HANDS_NS.contains("athena"));
    }

    #[test]
    fn request_ids_stay_in_their_tabs_namespace_and_are_not_guessable() {
        let relay = Relay::default();
        let mut seen = HashSet::new();
        for _ in 0..2_000 {
            let id = relay.next_id(1);
            assert!(id.starts_with("1:"), "{id} left its tab's namespace");
            assert!(seen.insert(id), "an id repeated");
        }
        assert!(relay.next_id(2).starts_with("2:"));

        let (a, b) = (relay.next_id(3), relay.next_id(3));
        assert_ne!(
            a.split_once('-').map(|(_, tail)| tail),
            b.split_once('-').map(|(_, tail)| tail),
            "the tail is not derivable from the counter"
        );
    }

    #[test]
    fn a_tabs_nonce_is_stable_and_another_tabs_is_not_it() {
        let relay = Relay::default();
        let first = relay.token_for(1);
        assert_eq!(
            first,
            relay.token_for(1),
            "re-injection gets the same nonce"
        );
        assert_ne!(first, relay.token_for(2));
        assert!(relay.token_matches(1, &first));
        assert!(!relay.token_matches(1, "guessed"));
        assert!(!relay.token_matches(9, &first), "no tab 9 has been built");
    }

    #[test]
    fn closing_a_tab_drops_its_nonce_and_everything_parked_for_it() {
        let relay = Relay::default();
        let nonce = relay.token_for(4);
        let (_id, _rx) = relay.park(4);
        let (other, _rx2) = relay.park(5);
        assert_eq!(relay.parked(), 2);

        relay.forget_tab(4);
        assert!(
            !relay.token_matches(4, &nonce),
            "a stale script cannot answer"
        );
        assert_eq!(relay.parked(), 1, "tab 4's request is gone");
        assert!(other.starts_with("5:"), "and tab 5's is not");
    }

    #[tokio::test]
    async fn a_request_nobody_answers_times_out_and_is_forgotten() {
        let relay = Relay::default();
        let (id, rx) = relay.park(7);
        assert_eq!(relay.parked(), 1);

        let answer = awaited(&relay, id.clone(), rx, Duration::from_millis(10)).await;
        assert_eq!(answer["reason"], json!("timeout"));
        assert_eq!(
            relay.parked(),
            0,
            "the id map does not grow a leak per call"
        );

        assert_eq!(
            relay.settle(7, json!({ "id": id, "ok": true, "output": "late" })),
            Settled::Ignored("an unknown or expired id")
        );
    }

    #[tokio::test]
    async fn an_answer_that_arrives_in_time_is_the_calls_result() {
        let relay = Relay::default();
        let (id, rx) = relay.park(2);
        assert_eq!(
            relay.settle(
                2,
                json!({ "id": id.clone(), "ok": true, "output": "12 rows" })
            ),
            Settled::Delivered
        );
        let answer = awaited(&relay, id, rx, Duration::from_secs(5)).await;
        assert_eq!(answer["output"], json!("12 rows"));
        assert_eq!(relay.parked(), 0);
    }

    #[test]
    fn a_reply_the_relay_cannot_place_is_dropped_and_never_panics() {
        let relay = Relay::default();
        let (id, _rx) = relay.park(1);

        assert_eq!(
            relay.settle(1, json!({ "ok": true })),
            Settled::Ignored("a reply without an id")
        );
        assert_eq!(
            relay.settle(1, json!({ "id": 17, "ok": true })),
            Settled::Ignored("a reply without an id"),
            "an id that is not a string is not an id"
        );
        assert_eq!(
            relay.settle(1, json!({ "id": "9:0-beef", "ok": true })),
            Settled::Ignored("an id belonging to another tab")
        );
        assert_eq!(
            relay.settle(2, json!({ "id": id, "ok": true })),
            Settled::Ignored("an id belonging to another tab"),
            "tab 2 cannot answer tab 1's still-parked request"
        );
        assert_eq!(relay.parked(), 1, "and none of that unparked anything");
    }

    #[test]
    fn toolchange_is_the_one_message_with_no_id() {
        let relay = Relay::default();
        assert_eq!(
            relay.settle(4, json!({ "id": null, "type": "toolchange" })),
            Settled::Toolchange
        );
    }

    #[test]
    fn a_payload_full_of_teeth_survives_becoming_javascript() {
        let nasty = "</script><script>alert(\"x\")</script>\u{2028}\u{2029}\"quoted\"\n\\ ☕";
        let message = envelope(
            NS,
            DIR_PAGE,
            "1:0-abc",
            json!({ "type": "call", "input": nasty }),
        );
        let script = post_script(&message).expect("the message encodes");

        assert!(script.starts_with("window.postMessage("));
        assert!(script.ends_with(", location.origin);"));
        assert!(
            !script.contains("</script>"),
            "a closing script tag survived"
        );
        assert!(!script.contains('\u{2028}') && !script.contains('\u{2029}'));
        assert!(!script.contains('\n'), "one statement, one line");

        let argument = script
            .trim_start_matches("window.postMessage(")
            .trim_end_matches(", location.origin);");
        let parsed: Value = serde_json::from_str(argument).expect("still JSON");
        assert_eq!(parsed["input"], json!(nasty), "the round trip is the point");
        assert_eq!(parsed["__ns"], json!(NS));
        assert_eq!(parsed["dir"], json!(DIR_PAGE));
    }

    #[test]
    fn the_relay_script_bakes_its_values_in_as_literals() {
        // The token rides inside a URL the script builds, so a token with a
        // quote in it could never end the statement it sits in.
        let script = relay_script(3, "no\"such\\token</script>", 17320);
        assert!(script.contains("ws://127.0.0.1:17320/browser-bridge/page-ws?tab=3&token="));
        assert!(
            !script.contains("</script>"),
            "a closing script tag survived: {script}"
        );
        assert!(
            script.contains("event.source !== window"),
            "a frame is not the page"
        );
        assert!(
            script.contains("PENDING_CAP"),
            "a page whose CSP blocks the socket must not grow an unbounded queue"
        );
    }

    #[test]
    fn the_answer_channel_is_the_socket_and_not_an_invoke() {
        // The whole reason this file diverges from its source. A page webview
        // cannot invoke a Tauri command at all (remote origins are ACL-checked
        // with no app manifest to grant them), so a script that tried would be
        // a script whose hands silently never answer.
        let script = relay_script(1, "t", 1);
        assert!(!script.contains("__TAURI_INTERNALS__"));
        assert!(!script.contains("browser_page_reply"));
        assert!(script.contains("new WebSocket(URL)"));
    }

    #[test]
    fn a_tab_answers_only_with_its_own_token() {
        // The handshake's whole job. `page_ws_handler` needs a live axum
        // upgrade, so what is asserted here is the decision it makes.
        let relay = Relay::default();
        let mine = relay.token_for(11);
        let theirs = relay.token_for(12);

        assert!(relay.token_matches(11, &mine));
        assert!(
            !relay.token_matches(11, &theirs),
            "another tab's token is not this tab's"
        );
        assert!(!relay.token_matches(11, "guessed"));
        assert!(!relay.token_matches(99, &mine), "no tab 99 has been built");

        relay.forget_tab(11);
        assert!(
            !relay.token_matches(11, &mine),
            "a closed tab's socket cannot reconnect on its old token"
        );
    }

    #[test]
    fn a_page_token_is_never_the_extensions_pairing_token() {
        // A page that could present the extension's credential could receive
        // the extension's commands. The two share no value and no route.
        let relay = Relay::default();
        assert_ne!(relay.token_for(1), crate::browser_bridge::pairing_token());
    }

    #[test]
    fn an_oversized_frame_is_refused_before_it_is_parsed() {
        // The third wall, on the socket. `hands.js` bounds its reads and the
        // shell cuts again at the snapshot cap; this one is for a page that
        // sends something neither script produced.
        assert!(MAX_FRAME_BYTES >= 64 * 1024, "an honest answer must fit");
        assert!(
            MAX_FRAME_BYTES <= 1024 * 1024,
            "a page must not be able to hand the shell a megabyte per frame"
        );
    }
}
