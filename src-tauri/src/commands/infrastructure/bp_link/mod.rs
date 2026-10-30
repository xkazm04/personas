//! bp link (spark roadmap S6, first half): Personas reads bp's shared focus and
//! bp's product table over bp's loopback HTTP, from Rust.
//!
//! WHY RUST. The shipped CSP's `connect-src` names no localhost, bp sends no
//! CORS headers, and bp refuses the webview's origin (`tauri.localhost`, which
//! every Tauri 2 app on the machine shares). A request from here sends no
//! Origin and no `Sec-Fetch-Site`, so it passes bp's `localHost`, `localOnly`
//! and `jsonOnly` guards with no bp change (bp
//! `docs/concepts/one-morning/personas-adoption.md` section 2.1).
//!
//! WHAT. Personas is a FOLLOWER only: it says hello, follows, unfollows and
//! forgets; it never publishes (G7 is the owner's decision). The webview drives
//! the cadence while a Blueprint surface is visible (a 1 Hz read, a hello every
//! 15 s), so nothing here runs in the background and nothing outlives the
//! surface. When bp is down, a read does not knock on bp again for
//! [`OFFLINE_RETRY`]: it answers the last offline report at once, so the 1 Hz
//! surface says "offline" every 5 s instead of failing every second.
//!
//! WHERE. The base URL is the existing `lens_scan.bp_url` setting (default
//! `http://localhost:3010`), held to a loopback host: the setting can never
//! point these calls off the machine.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;
use ts_rs::TS;

use crate::commands::blocking::run_blocking;
use crate::db::repos::core::settings;
use crate::db::repos::dev::projects;
use crate::db::settings_keys;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// bp's own dev and start port (`bpLink.ts` `BP_URL_DEFAULT`).
pub const BP_URL_DEFAULT: &str = "http://localhost:3010";
/// How long a read waits on bp. bp answers the focus record from memory.
const READ_TIMEOUT: Duration = Duration::from_millis(1500);
/// After a failed read, the next real attempt waits this long.
pub const OFFLINE_RETRY: Duration = Duration::from_secs(5);
/// Personas' reader ids are `personas:<window>` (bp: `^[\w.:-]{1,80}$`).
const READER_PREFIX: &str = "personas:";

// ---------------------------------------------------------------------------
// Wire
// ---------------------------------------------------------------------------

/// One read of bp's shared focus.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BpFocusRead {
    /// The base URL read (after the loopback check).
    pub base: String,
    /// bp answered.
    pub online: bool,
    /// bp's `SharedView`, passed through as bp sent it; the webview validates
    /// it with the ported `readFocusPlace`. Absent when offline.
    #[ts(type = "unknown")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view: Option<Value>,
    /// Why bp did not answer (connection refused, a status, a timeout).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Offline only: milliseconds until the next real attempt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_in_ms: Option<u32>,
}

/// The presence moves a follower makes (`POST /api/session/focus` ops). No
/// `publish`: Personas does not publish the shared focus.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum BpFocusOp {
    Hello,
    Follow,
    Unfollow,
    Forget,
}

/// One bp product, with the Personas project at the same root (if any).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BpProductLink {
    /// bp's registry slug: what a `FocusPlace.product` names.
    pub slug: String,
    pub name: String,
    /// The root bp registered, as bp sent it.
    pub root: String,
    /// The `dev_projects` row whose `root_path` is the same folder; absent =
    /// "Not in Personas".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Pure parts (tested in tests.rs)
// ---------------------------------------------------------------------------

/// The setting as a base URL, held to loopback. Unset or blank = the default.
/// Anything that is not `http(s)://localhost|127.0.0.1|[::1][:port]` with no
/// path is refused rather than silently replaced: a typo must not send these
/// calls somewhere else.
pub fn loopback_base(setting: Option<&str>) -> Result<String, AppError> {
    let raw = setting.and_then(non_blank).unwrap_or(BP_URL_DEFAULT);
    let raw = raw.trim_end_matches('/');
    let url = reqwest::Url::parse(raw)
        .map_err(|e| AppError::Validation(format!("lens_scan.bp_url is not a URL: {e}")))?;
    let host_ok = matches!(
        url.host(),
        Some(url::Host::Domain("localhost"))
            | Some(url::Host::Ipv4(std::net::Ipv4Addr::LOCALHOST))
            | Some(url::Host::Ipv6(std::net::Ipv6Addr::LOCALHOST))
    );
    if !matches!(url.scheme(), "http" | "https") || !host_ok {
        return Err(AppError::Validation(format!(
            "lens_scan.bp_url must be a loopback http URL (localhost, 127.0.0.1 or [::1]), got {raw}"
        )));
    }
    if !is_bare_origin(&url) {
        return Err(AppError::Validation(format!(
            "lens_scan.bp_url must be a bare origin, got {raw}"
        )));
    }
    Ok(raw.to_string())
}

/// `personas:<window>`, checked against bp's reader-id rule.
pub fn reader_id(window: &str) -> Result<String, AppError> {
    personas_core::validation::require_non_empty("window", window)?;
    let id = format!("{READER_PREFIX}{window}");
    let ok = id.len() <= 80
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | ':' | '-'));
    if ok {
        Ok(id)
    } else {
        Err(AppError::Validation(format!(
            "a window label must make a bp reader id (letters, digits, . _ : -, at most 80): {window}"
        )))
    }
}

/// The JSON body of one presence move.
pub fn move_body(op: BpFocusOp, reader: &str) -> Value {
    let who = |op: &str| serde_json::json!({ "op": op, "reader": reader, "surface": "personas", "label": "Personas" });
    match op {
        BpFocusOp::Hello => who("hello"),
        BpFocusOp::Follow => {
            let mut b = who("follow");
            b["of"] = Value::String("*".into());
            b
        }
        BpFocusOp::Unfollow => serde_json::json!({ "op": "unfollow", "reader": reader }),
        BpFocusOp::Forget => serde_json::json!({ "op": "forget", "reader": reader }),
    }
}

/// A root as both sides can compare it: forward slashes, no verbatim prefix,
/// no trailing slash, case-folded (Windows paths are case-insensitive, and two
/// registrations of one folder differ in nothing else).
pub fn normalize_root(root: &str) -> String {
    let r = root.trim().replace('\\', "/");
    let r = r.strip_prefix("//?/").unwrap_or(&r);
    r.trim_end_matches('/').to_lowercase()
}

/// bp's products, each joined to the Personas project at the same root. A
/// product with no such project keeps `project_id` absent.
pub fn link_products(bp: &[Value], personas: &[(String, String)]) -> Vec<BpProductLink> {
    bp.iter()
        .filter_map(|p| {
            let s = |k: &str| p.get(k).and_then(Value::as_str).map(str::to_string);
            let (slug, root) = (s("slug")?, s("root")?);
            let key = normalize_root(&root);
            let project_id = personas
                .iter()
                .find(|(_, r)| normalize_root(r) == key)
                .map(|(id, _)| id.clone());
            Some(BpProductLink {
                name: s("name").unwrap_or_else(|| slug.clone()),
                slug,
                root,
                project_id,
            })
        })
        .collect()
}

/// The offline back-off, per base: after a failed attempt, the next real one
/// waits [`OFFLINE_RETRY`]; attempts in between answer the last report at once.
#[derive(Debug, Default)]
pub struct OfflineGate {
    last: std::collections::HashMap<String, (Instant, BpFocusRead)>,
}

impl OfflineGate {
    /// The held offline report, when the back-off is still running.
    pub fn held(&self, base: &str, now: Instant) -> Option<BpFocusRead> {
        let (at, read) = self.last.get(base)?;
        let since = now.saturating_duration_since(*at);
        let left = OFFLINE_RETRY.checked_sub(since).filter(|d| !d.is_zero())?;
        Some(BpFocusRead {
            retry_in_ms: Some(u32::try_from(left.as_millis()).unwrap_or(u32::MAX)),
            ..read.clone()
        })
    }

    /// Record a real attempt: a failure starts the back-off, a success ends it.
    pub fn record(&mut self, read: &BpFocusRead, now: Instant) {
        if read.online {
            self.last.remove(&read.base);
        } else {
            self.last.insert(read.base.clone(), (now, read.clone()));
        }
    }
}

/// The setting trimmed, or None when it is blank.
fn non_blank(s: &str) -> Option<&str> {
    let t = s.trim();
    (!t.is_empty()).then_some(t)
}

/// A bare origin: no path, no query, no credentials.
fn is_bare_origin(url: &reqwest::Url) -> bool {
    url.path() == "/"
        && url.query().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

fn gate() -> &'static Mutex<OfflineGate> {
    static GATE: std::sync::OnceLock<Mutex<OfflineGate>> = std::sync::OnceLock::new();
    GATE.get_or_init(|| Mutex::new(OfflineGate::default()))
}

// ---------------------------------------------------------------------------
// HTTP (loopback only; the base passed loopback_base)
// ---------------------------------------------------------------------------

/// `GET <base>/api/session/focus`, behind the offline gate.
pub async fn read_focus(http: &reqwest::Client, base: &str) -> BpFocusRead {
    gated(base, move || async move {
        get_json(http, &format!("{base}/api/session/focus"))
            .await
            .map(|view| online_read(base, Some(view)))
    })
    .await
}

/// A presence move behind the same offline gate: bp down answers
/// `online: false` (a hello every 15 s while bp is not running is not an
/// error), while bp refusing the move is one.
pub async fn move_focus(
    http: &reqwest::Client,
    base: &str,
    op: BpFocusOp,
    reader: &str,
) -> Result<BpFocusRead, AppError> {
    let mut refused = None;
    let slot = &mut refused;
    let read = gated(base, move || async move {
        match send_move(http, base, op, reader).await {
            Ok(body) => Ok(online_read(base, body.get("view").cloned())),
            Err(MoveError::Down(e)) => Err(e),
            Err(MoveError::Refused(e)) => {
                *slot = Some(e);
                Ok(online_read(base, None))
            }
        }
    })
    .await;
    match refused {
        Some(e) => Err(e),
        None => Ok(read),
    }
}

fn online_read(base: &str, view: Option<Value>) -> BpFocusRead {
    BpFocusRead {
        base: base.into(),
        online: true,
        view,
        error: None,
        retry_in_ms: None,
    }
}

/// One real attempt, unless the offline back-off still holds; its outcome is
/// recorded either way.
async fn gated<F, Fut>(base: &str, attempt: F) -> BpFocusRead
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<BpFocusRead, String>>,
{
    if let Some(held) = gate()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .held(base, Instant::now())
    {
        return held;
    }
    let read = attempt().await.unwrap_or_else(|error| BpFocusRead {
        base: base.into(),
        online: false,
        view: None,
        error: Some(error),
        retry_in_ms: Some(u32::try_from(OFFLINE_RETRY.as_millis()).unwrap_or(u32::MAX)),
    });
    gate()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .record(&read, Instant::now());
    read
}

async fn get_json(http: &reqwest::Client, url: &str) -> Result<Value, String> {
    let r = http
        .get(url)
        .timeout(READ_TIMEOUT)
        .send()
        .await
        .map_err(|e| short(&e))?;
    let status = r.status();
    if !status.is_success() {
        return Err(format!("bp answered {status}"));
    }
    r.json::<Value>()
        .await
        .map_err(|e| format!("bp's answer is not JSON: {}", short(&e)))
}

/// Why a move did not land: bp is not there, or bp said no.
pub enum MoveError {
    Down(String),
    Refused(AppError),
}

/// `POST <base>/api/session/focus` with one presence move; bp's `{ moved, view }`.
pub async fn send_move(
    http: &reqwest::Client,
    base: &str,
    op: BpFocusOp,
    reader: &str,
) -> Result<Value, MoveError> {
    let r = http
        .post(format!("{base}/api/session/focus"))
        .timeout(READ_TIMEOUT)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&move_body(op, reader))
        .send()
        .await
        .map_err(|e| MoveError::Down(short(&e)))?;
    let status = r.status();
    let body: Value = r.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let why = body
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("no reason given");
        return Err(MoveError::Refused(AppError::Validation(format!(
            "bp refused {op:?}: {status} {why}"
        ))));
    }
    Ok(body)
}

/// A reqwest error in one line (the URL is the loopback base: nothing to hide).
fn short(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "timed out".into()
    } else if e.is_connect() {
        "not running (connection refused)".into()
    } else {
        e.to_string()
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async fn base_of(state: &State<'_, Arc<AppState>>) -> Result<String, AppError> {
    let db = state.db.clone();
    let setting = run_blocking("bp_link_base", move || {
        settings::get(&db, settings_keys::LENS_SCAN_BP_URL)
    })
    .await?;
    loopback_base(setting.as_deref())
}

/// One read of bp's shared focus (the webview asks once a second while a
/// Blueprint surface is visible). Never an error for bp being down: that is
/// `online: false`, held for [`OFFLINE_RETRY`].
#[tauri::command]
pub async fn bp_focus_read(state: State<'_, Arc<AppState>>) -> Result<BpFocusRead, AppError> {
    require_auth(&state).await?;
    let base = base_of(&state).await?;
    Ok(read_focus(&crate::SHARED_HTTP, &base).await)
}

/// One presence move as `personas:<window>`: hello (every 15 s while
/// visible), follow `*`, unfollow, forget (on close). bp down is
/// `online: false` (held like a read), never an error; bp refusing is one.
#[tauri::command]
pub async fn bp_focus_move(
    state: State<'_, Arc<AppState>>,
    window: String,
    op: BpFocusOp,
) -> Result<BpFocusRead, AppError> {
    require_auth(&state).await?;
    let reader = reader_id(&window)?;
    let base = base_of(&state).await?;
    move_focus(&crate::SHARED_HTTP, &base, op, &reader).await
}

/// bp's products (`GET /api/products`), each with the Personas project at the
/// same root: the slug table a `FocusPlace.product` is looked up in, instead
/// of guessing the slug from the folder name.
#[tauri::command]
pub async fn bp_products(state: State<'_, Arc<AppState>>) -> Result<Vec<BpProductLink>, AppError> {
    require_auth(&state).await?;
    let base = base_of(&state).await?;
    let bp = get_json(&crate::SHARED_HTTP, &format!("{base}/api/products"))
        .await
        .map_err(|e| AppError::Internal(format!("bp's product list: {e}")))?;
    let bp = bp.as_array().cloned().unwrap_or_default();
    let db = state.db.clone();
    let personas = run_blocking("bp_products_roots", move || {
        Ok(projects::list_projects(&db, None)?
            .into_iter()
            .map(|p| (p.id, p.root_path))
            .collect::<Vec<_>>())
    })
    .await?;
    Ok(link_products(&bp, &personas))
}

#[cfg(test)]
mod tests;
