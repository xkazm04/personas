//! Cloud-app pairing ceremony (Direction 1).
//!
//! A cloud web app that wants to drive the local management API must be PAIRED
//! by the user first. Two triggers converge on the same in-memory pending store:
//!
//!   1. `personas://pair?origin=…&scopes=…&nonce=…&name=…` deep link, or
//!   2. `POST http://127.0.0.1:9420/pair/request` from the cloud app itself.
//!
//! Both register a `Pending` keyed by the cloud-app-supplied **nonce** and emit
//! `PAIRING_REQUESTED` so the desktop shows an approval modal. Nothing is minted
//! until the user approves in-app (`approve_pairing` command), which mints an
//! **origin-bound, scoped, expiring** key, adds the origin to the CORS allowlist,
//! and stashes the plaintext for a single-use claim. The cloud app then polls
//! `GET /pair/claim?nonce=…` to retrieve the token exactly once — never via the
//! deep-link query string (deep links leak to OS logs).
//!
//! Security: the token is delivered only to the approved `Origin` (the claim
//! checks the request Origin against the pending origin), is single-use + TTL'd,
//! and the token itself is origin-bound so it's useless from any other origin.
//! See docs/architecture/cloud-integration-bridge.md §4.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use ts_rs::TS;

/// How long a pending pairing lives before it's pruned.
const PAIRING_TTL: Duration = Duration::from_secs(300);
/// Minimum nonce length the cloud app must supply (entropy floor).
const MIN_NONCE_LEN: usize = 16;
/// Cap on concurrent pending pairings (anti-spam).
const MAX_PENDING: usize = 32;

#[derive(Clone)]
enum Outcome {
    Pending,
    Approved { token: String, claimed: bool },
    Rejected,
}

#[derive(Clone)]
struct Pending {
    origin: String,
    requested_scopes: Vec<String>,
    app_name: String,
    created: Instant,
    outcome: Outcome,
}

/// Frontend-safe view of a pending pairing (no token). Payload of the
/// `PAIRING_REQUESTED` event and the `list_pending_pairings` command.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PendingPairingView {
    pub nonce: String,
    pub origin: String,
    pub requested_scopes: Vec<String>,
    pub app_name: String,
}

static PENDING: OnceLock<Mutex<HashMap<String, Pending>>> = OnceLock::new();

fn pending() -> &'static Mutex<HashMap<String, Pending>> {
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

fn prune(map: &mut HashMap<String, Pending>) {
    let now = Instant::now();
    map.retain(|_, p| now.duration_since(p.created) < PAIRING_TTL);
}

// ============================================================================
// Store operations (also used by the Tauri commands)
// ============================================================================

/// Register a pending pairing. Returns the frontend-safe view for the event.
pub fn register(
    origin: &str,
    requested_scopes: Vec<String>,
    nonce: &str,
    app_name: &str,
) -> Result<PendingPairingView, String> {
    if nonce.len() < MIN_NONCE_LEN {
        return Err("nonce too short".into());
    }
    if origin.trim().is_empty() {
        return Err("origin required".into());
    }
    let mut map = pending().lock().map_err(|_| "lock poisoned".to_string())?;
    prune(&mut map);
    // If this nonce already resolved (approved or rejected), don't reset it
    // back to Pending -- a benign double-submit (double POST, resent deep
    // link) would otherwise discard an already-minted, unclaimed token and
    // hang the app's claim poll indefinitely.
    if let Some(existing) = map.get(nonce) {
        if !matches!(existing.outcome, Outcome::Pending) {
            return Ok(PendingPairingView {
                nonce: nonce.to_string(),
                origin: existing.origin.clone(),
                requested_scopes: existing.requested_scopes.clone(),
                app_name: existing.app_name.clone(),
            });
        }
    }
    if map.len() >= MAX_PENDING && !map.contains_key(nonce) {
        return Err("too many pending pairings".into());
    }
    let view = PendingPairingView {
        nonce: nonce.to_string(),
        origin: origin.to_string(),
        requested_scopes: requested_scopes.clone(),
        app_name: app_name.to_string(),
    };
    map.insert(
        nonce.to_string(),
        Pending {
            origin: origin.to_string(),
            requested_scopes,
            app_name: app_name.to_string(),
            created: Instant::now(),
            outcome: Outcome::Pending,
        },
    );
    Ok(view)
}

/// Frontend-safe list of the currently-pending pairings (safety net for a modal
/// host that missed the event).
pub fn list_views() -> Vec<PendingPairingView> {
    let mut map = match pending().lock() {
        Ok(m) => m,
        Err(_) => return Vec::new(),
    };
    prune(&mut map);
    map.iter()
        .filter(|(_, p)| matches!(p.outcome, Outcome::Pending))
        .map(|(nonce, p)| PendingPairingView {
            nonce: nonce.clone(),
            origin: p.origin.clone(),
            requested_scopes: p.requested_scopes.clone(),
            app_name: p.app_name.clone(),
        })
        .collect()
}

/// Read the pending origin + app name for the approve command (which mints the
/// origin-bound key). Returns `None` if the nonce is unknown / already resolved.
pub fn pending_origin(nonce: &str) -> Option<(String, String)> {
    let map = pending().lock().ok()?;
    let p = map.get(nonce)?;
    if matches!(p.outcome, Outcome::Pending) {
        Some((p.origin.clone(), p.app_name.clone()))
    } else {
        None
    }
}

/// Mark a pending pairing approved and stash the minted plaintext token for the
/// single-use claim.
pub fn set_approved(nonce: &str, token: String) -> Result<(), String> {
    let mut map = pending().lock().map_err(|_| "lock poisoned".to_string())?;
    let p = map.get_mut(nonce).ok_or("no such pending pairing")?;
    p.outcome = Outcome::Approved {
        token,
        claimed: false,
    };
    Ok(())
}

/// Mark a pending pairing rejected.
pub fn set_rejected(nonce: &str) {
    if let Ok(mut map) = pending().lock() {
        if let Some(p) = map.get_mut(nonce) {
            p.outcome = Outcome::Rejected;
        }
    }
}

enum ClaimResult {
    Token(String),
    Pending,
    Rejected,
    Gone,
    NotFound,
    OriginMismatch,
}

fn claim(nonce: &str, origin: &str) -> ClaimResult {
    let mut map = match pending().lock() {
        Ok(m) => m,
        Err(_) => return ClaimResult::NotFound,
    };
    prune(&mut map);
    let Some(p) = map.get_mut(nonce) else {
        return ClaimResult::NotFound;
    };
    match &mut p.outcome {
        Outcome::Pending => ClaimResult::Pending,
        Outcome::Rejected => ClaimResult::Rejected,
        Outcome::Approved { token, claimed } => {
            if *claimed {
                return ClaimResult::Gone;
            }
            // Token is delivered only to the approved origin (defense in depth —
            // the token is origin-bound anyway).
            if p.origin != origin {
                return ClaimResult::OriginMismatch;
            }
            *claimed = true;
            ClaimResult::Token(token.clone())
        }
    }
}

/// Parse a `personas://pair?origin=…&scopes=…&nonce=…&name=…` deep link and
/// register the pending pairing. `scopes` is a comma-separated list.
pub fn register_from_deep_link(url_str: &str) -> Result<PendingPairingView, String> {
    let parsed = url::Url::parse(url_str).map_err(|e| format!("bad url: {e}"))?;
    let mut origin = String::new();
    let mut nonce = String::new();
    let mut name = String::new();
    let mut scopes: Vec<String> = Vec::new();
    for (k, v) in parsed.query_pairs() {
        match k.as_ref() {
            "origin" => origin = v.to_string(),
            "nonce" => nonce = v.to_string(),
            "name" => name = v.to_string(),
            "scopes" => {
                scopes = v
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            }
            _ => {}
        }
    }
    if name.is_empty() {
        name = origin.clone();
    }
    register(&origin, scopes, &nonce, &name)
}

// ============================================================================
// HTTP router (permissive CORS — the pairing entry point is pre-auth)
// ============================================================================

#[derive(Deserialize)]
struct PairRequestBody {
    nonce: String,
    #[serde(default)]
    scopes: Vec<String>,
    name: Option<String>,
}

/// `POST /pair/request` — a cloud app initiates pairing. The authoritative
/// origin is the request's `Origin` header (NOT a body field), so a page can
/// only ever pair itself. Creates a pending pairing and surfaces the approval
/// modal. Nothing is minted here.
async fn handle_pair_request(
    State(app): State<AppHandle>,
    headers: HeaderMap,
    Json(body): Json<PairRequestBody>,
) -> impl IntoResponse {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    if origin.is_empty() {
        return (StatusCode::BAD_REQUEST, "Origin header required").into_response();
    }
    let name = body.name.unwrap_or_else(|| origin.clone());
    match register(&origin, body.scopes, &body.nonce, &name) {
        Ok(view) => {
            let _ = app.emit(
                crate::engine::event_registry::event_name::PAIRING_REQUESTED,
                &view,
            );
            (
                StatusCode::ACCEPTED,
                Json(serde_json::json!({ "status": "pending" })),
            )
                .into_response()
        }
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

#[derive(Deserialize)]
struct ClaimQuery {
    nonce: String,
}

/// `GET /pair/claim?nonce=…` — the cloud app polls for its token after the user
/// approves. Returns the token exactly once (single-use), only to the approved
/// origin.
async fn handle_pair_claim(headers: HeaderMap, Query(q): Query<ClaimQuery>) -> impl IntoResponse {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    match claim(&q.nonce, &origin) {
        ClaimResult::Token(token) => (
            StatusCode::OK,
            Json(serde_json::json!({ "token": token })),
        )
            .into_response(),
        ClaimResult::Pending => (
            StatusCode::ACCEPTED,
            Json(serde_json::json!({ "status": "pending" })),
        )
            .into_response(),
        ClaimResult::Rejected => (StatusCode::FORBIDDEN, "pairing rejected").into_response(),
        ClaimResult::Gone => (StatusCode::GONE, "already claimed").into_response(),
        ClaimResult::NotFound => (StatusCode::NOT_FOUND, "unknown or expired").into_response(),
        ClaimResult::OriginMismatch => (StatusCode::FORBIDDEN, "origin mismatch").into_response(),
    }
}

/// Router for the pairing entry points. Permissive CORS (any origin) because the
/// cloud origin is not paired yet — the nonce + user approval + origin-checked
/// single-use claim are the security, not CORS. Merged into the webhook server
/// alongside the (restrictive-CORS) management router.
pub fn pairing_router(app: AppHandle) -> Router {
    use tower_http::cors::{Any, CorsLayer};
    Router::new()
        .route("/pair/request", post(handle_pair_request))
        .route("/pair/claim", get(handle_pair_claim))
        .with_state(app)
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
                .allow_headers([header::CONTENT_TYPE])
                .allow_private_network(true),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nonce(seed: &str) -> String {
        format!("nonce-{seed}-0123456789abcdef")
    }

    #[test]
    fn register_rejects_short_nonce_and_empty_origin() {
        assert!(register("https://a.example", vec![], "short", "A").is_err());
        assert!(register("", vec![], &nonce("x"), "A").is_err());
    }

    #[test]
    fn approve_then_claim_is_single_use_and_origin_checked() {
        let n = nonce("claim");
        register("https://c.example", vec!["personas:read".into()], &n, "Cloud").unwrap();
        // Pending → claim returns Pending.
        assert!(matches!(claim(&n, "https://c.example"), ClaimResult::Pending));

        set_approved(&n, "pk_deadbeef".into()).unwrap();
        // Wrong origin → mismatch (no token leaked).
        assert!(matches!(
            claim(&n, "https://evil.example"),
            ClaimResult::OriginMismatch
        ));
        // Correct origin → token, once.
        match claim(&n, "https://c.example") {
            ClaimResult::Token(t) => assert_eq!(t, "pk_deadbeef"),
            _ => panic!("expected token"),
        }
        // Second claim → gone.
        assert!(matches!(claim(&n, "https://c.example"), ClaimResult::Gone));
    }

    #[test]
    fn rejected_pairing_never_yields_token() {
        let n = nonce("reject");
        register("https://r.example", vec![], &n, "R").unwrap();
        set_rejected(&n);
        assert!(matches!(claim(&n, "https://r.example"), ClaimResult::Rejected));
    }

    #[test]
    fn deep_link_parses_origin_scopes_nonce() {
        let n = nonce("dl");
        let url = format!(
            "personas://pair?origin=https://d.example&nonce={n}&name=DeepApp&scopes=personas:read,personas:execute:persona:p1"
        );
        let view = register_from_deep_link(&url).expect("parse");
        assert_eq!(view.origin, "https://d.example");
        assert_eq!(view.app_name, "DeepApp");
        assert_eq!(
            view.requested_scopes,
            vec![
                "personas:read".to_string(),
                "personas:execute:persona:p1".to_string()
            ]
        );
        // pending_origin reflects it.
        assert_eq!(pending_origin(&n).unwrap().0, "https://d.example");
    }
}
