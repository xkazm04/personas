//! Management API -- extends the webhook HTTP server with /api/* routes
//! for persona execution, lab operations, and version management.
//!
//! These endpoints allow external tools (MCP servers, CLI scripts, A2A clients)
//! to control Personas without going through the Tauri IPC layer.
//!
//! All routes are gated by the [`require_api_key`] middleware which validates a
//! `Bearer` token against the `external_api_keys` table. The desktop frontend
//! uses a process-scoped "system" key created on first call to
//! [`get_or_create_system_api_key`].

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use tauri::Manager;

use std::time::Duration;

use axum::{
    extract::{Extension, Path, Query, Request, State as AxumState},
    http::{header, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::db::models::*;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::execution::metrics as metrics_repo;
use crate::db::repos::lab::ab as ab_repo;
use crate::db::repos::lab::arena as arena_repo;
use crate::db::repos::lab::eval as eval_repo;
use crate::db::repos::lab::matrix as matrix_repo;
use crate::db::repos::resources::api_key_audit as api_key_audit_repo;
use crate::db::repos::resources::external_api_keys as api_key_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::DbPool;
use crate::engine::a2a::types::{
    map_status_to_a2a_state, A2AArtifact, A2ARequest, A2AResponse, A2AResponsePart,
    A2AResultMessage, A2AStatusMessage, A2ATask, A2ATaskResponse, A2ATaskStatus, AgentCapabilities,
    AgentCard, AgentSkill, MessageSendParams, TaskIdParams,
};
use crate::engine::test_runner::{self, TestModelConfig};
use crate::engine::types::EphemeralPersona;
use crate::error::AppError;
use crate::ActiveProcessRegistry;

/// `/api/dev/*` — the Ship layer (milestones, goals, scope). See `ship.rs`.
mod ship;

// =============================================================================
// Shared state for the management API
// =============================================================================

#[derive(Clone)]
pub struct ManagementState {
    pub pool: DbPool,
    pub app: AppHandle,
    pub process_registry: Arc<ActiveProcessRegistry>,
    /// Per-key sliding-window limiter shared with the webhook server. Keyed by
    /// `apikey:<key_id>` in the `require_api_key` middleware.
    pub rate_limiter: Arc<crate::engine::rate_limiter::RateLimiter>,
}

// =============================================================================
// Router construction
// =============================================================================

pub fn management_router(state: ManagementState) -> Router {
    let state_arc = Arc::new(state);
    let router = Router::new()
        // Personas
        .route("/api/personas", get(list_personas))
        .route("/api/personas/{persona_id}", get(get_persona))
        // Executions
        .route("/api/execute/{persona_id}", post(execute_persona))
        .route("/api/executions", get(list_executions))
        .route("/api/executions/{id}", get(get_execution))
        // Lab
        .route("/api/lab/arena/{persona_id}", post(start_arena))
        .route("/api/lab/matrix/{persona_id}", post(start_matrix))
        .route("/api/lab/cancel/{run_id}", post(cancel_lab_run))
        .route("/api/lab/runs/{run_id}/delete", post(delete_lab_run))
        .route("/api/lab/runs/{run_id}/status", get(get_lab_run_status))
        .route(
            "/api/lab/improve/{persona_id}/{run_id}",
            post(improve_prompt),
        )
        // Versions
        .route("/api/versions/{persona_id}", get(list_versions))
        .route("/api/versions/{version_id}/tag", post(tag_version))
        .route(
            "/api/versions/{version_id}/rollback",
            post(rollback_version),
        )
        .route("/api/versions/{run_id}/accept", post(accept_draft))
        // Automation settings
        .route(
            "/api/settings/auto-optimize/{persona_id}",
            get(get_auto_optimize).post(set_auto_optimize),
        )
        .route(
            "/api/settings/health-watch/{persona_id}",
            get(get_health_watch).post(set_health_watch),
        )
        // Credential proxy -- route HTTP calls through stored credentials
        .route("/api/proxy/{credential_id}", post(proxy_request))
        // Zero-Plaintext Broker -- mint a short-lived derived handle for one
        // credential (never the secret). Gated on the broad `proxy` scope in
        // `authorize`, so only trusted keys (system key) can mint consumers.
        .route("/api/broker/mint/{credential_id}", post(mint_broker_handle))
        // Local scraper (embedded Pumper) -- the personas-mcp `fetch_readable`
        // tool forwards here so the SSRF-safe fetch runs in the main app where
        // the engine lives (the mcp binary has no engine module).
        // The scraper pivoted to Signals in Phase 1c; the only bridge route kept
        // is dataset read-back (for the query_dataset MCP tool).
        .route("/api/scrape/query", post(scrape_query))
        // A2A Gateway -- agent card discovery + JSON-RPC entry point
        .route("/agent-card/{persona_id}", get(get_agent_card))
        .route("/a2a/{persona_id}", post(handle_a2a_request))
        // Build sessions -- third-party MCP clients drive a persona build
        // end-to-end through these endpoints. Gated by `require_api_key`, which
        // additionally requires the `personas:build` scope for this whole
        // surface (see `authorize`).
        .route("/api/build", post(start_build))
        .route("/api/build/{session_id}", get(build_status))
        .route("/api/build/{session_id}/pending", get(build_pending))
        .route("/api/build/{session_id}/answer", post(build_answer))
        .route("/api/build/{session_id}/test", post(build_test))
        .route("/api/build/{session_id}/promote", post(build_promote))
        .route("/api/build/{session_id}/cancel", post(build_cancel))
        // KP bridge (WP3, intake only) -- the external KP hiring app dispatches
        // a "persona hire request" derived from a job posting. The POST inserts
        // a pending `companion_approval` row (action `kp_hire_request`); a
        // human approves it in the companion approval inbox, which creates the
        // draft persona + build session. POSTs require `personas:build` (same
        // trust tier as /api/build -- see `authorize`); GETs follow the
        // any-valid-key read rule.
        .route("/api/kp/persona-requests", post(kp_create_persona_request))
        .route("/api/kp/persona-requests/{id}", get(kp_get_persona_request))
        .route("/api/kp/connector-catalog", get(kp_connector_catalog))
        // -- Ship layer (management_api/ship.rs). Reads for any valid key;
        // writes demand `personas:build` (see `authorize`). No lifecycle and
        // no deletion routes by design — cutting and shipping are the
        // operator's, in the Ship tab or through Athena's approval-gated op.
        .route("/api/dev/projects", get(ship::list_projects))
        .route(
            "/api/dev/projects/{project_id}/ship",
            get(ship::get_project_ship),
        )
        .route(
            "/api/dev/projects/{project_id}/milestones",
            post(ship::post_milestone),
        )
        .route(
            "/api/dev/projects/{project_id}/use-cases",
            post(ship::post_use_case),
        )
        .route(
            "/api/dev/milestones/{milestone_id}",
            get(ship::get_milestone).post(ship::post_milestone_patch),
        )
        .route(
            "/api/dev/milestones/{milestone_id}/goals",
            post(ship::post_milestone_goals),
        )
        .route(
            "/api/dev/milestones/{milestone_id}/scope",
            post(ship::post_milestone_scope),
        )
        .route("/api/dev/goals/{goal_id}", post(ship::post_goal_patch));

    // Headless bridge test mode (§13). The route is ADDED, not merely refused,
    // so with the mode off it 404s: "there is nothing there" and "you may not
    // have it" are different answers, and a driver that probes for the mode
    // must be able to tell them apart. `/health.headlessBridge` is the
    // affirmative check.
    let router = if personas_engine::headless::enabled() {
        tracing::warn!(
            "HEADLESS BRIDGE: serving POST /api/kp/test/tick, POST /api/kp/test/seed-work and \
             POST /api/kp/test/retire — an on-demand run of the overnight / reconcile / report / \
             probation loop, the backlog seeding it needs to have anything to dispatch, and the \
             tenure end that lets a bench put a persona down again; all gated on the {} scope",
            personas_engine::headless::TEST_SCOPE
        );
        router
            .route("/api/kp/test/tick", post(kp_test_tick))
            .route("/api/kp/test/seed-work", post(kp_test_seed_work))
            .route("/api/kp/test/retire", post(kp_test_retire))
    } else {
        router
    };

    router
        .with_state(state_arc.clone())
        // Auth middleware runs INSIDE the CORS layer so OPTIONS preflight
        // requests do not require an API key.
        .layer(middleware::from_fn_with_state(state_arc, require_api_key))
        .layer(
            CorsLayer::new()
                // NOT allow_origin(Any): this loopback server hosts state-changing,
                // credential-bearing routes (/api/execute, /api/proxy, /api/build,
                // version rollback). With Any, any website the user visits could
                // fetch() these cross-origin and read the response, so a single
                // Bearer-token leak (renderer XSS, a logged token) would be
                // weaponizable from a random browser tab. Restrict to the app's own
                // webview / loopback dev origins; non-browser clients (MCP/CLI) send
                // no Origin and are unaffected by CORS.
                // Also allow user-PAIRED origins (Direction 1): a cloud origin the
                // user explicitly approved via the pairing ceremony is added to
                // PAIRED_ORIGINS, so its browser fetches pass CORS. Arbitrary
                // websites are still rejected.
                .allow_origin(AllowOrigin::predicate(|origin, _parts| {
                    origin
                        .to_str()
                        .map(|o| is_trusted_management_origin(o) || is_paired_origin(o))
                        .unwrap_or(false)
                }))
                // Private Network Access: Chrome gates public→loopback requests
                // behind a preflight carrying `Access-Control-Request-Private-Network`.
                // Echo the grant so paired browser origins can reach 127.0.0.1.
                // Non-browser clients (MCP/CLI) send no PNA header and are unaffected.
                .allow_private_network(true)
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
                .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]),
        )
}

/// Browser origins permitted to call the loopback management API. Only the app's
/// own webview (Tauri v2 production custom scheme — platform-dependent) and
/// loopback dev origins (devUrl is `http://localhost:1420`) are trusted; an
/// arbitrary website's `Origin` is rejected at the CORS layer. Non-browser
/// clients (MCP/CLI) do not send an `Origin` header and are unaffected.
fn is_trusted_management_origin(origin: &str) -> bool {
    matches!(
        origin,
        // Tauri v2 production webview origins (macOS/Linux/iOS use the custom
        // scheme; Windows/Android use the http scheme).
        "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
    ) || origin == "http://localhost"
        || origin == "http://127.0.0.1"
        || origin.starts_with("http://localhost:")
        || origin.starts_with("http://127.0.0.1:")
}

// =============================================================================
// Paired-origin allowlist (Direction 1)
// =============================================================================

/// Process-global set of cloud origins the user has PAIRED (approved via the
/// pairing ceremony). Populated at server start from `external_api_keys`
/// (distinct `bound_origin` of active keys) and mutated by the pairing commands.
/// The CORS predicate reads it so a paired origin's browser fetches pass;
/// nothing else does. Mirrors the `SYSTEM_API_KEY` global-cache pattern.
static PAIRED_ORIGINS: OnceLock<RwLock<HashSet<String>>> = OnceLock::new();

fn paired_origins() -> &'static RwLock<HashSet<String>> {
    PAIRED_ORIGINS.get_or_init(|| RwLock::new(HashSet::new()))
}

/// True if `origin` is a currently-paired cloud origin.
fn is_paired_origin(origin: &str) -> bool {
    paired_origins()
        .read()
        .map(|set| set.contains(origin))
        .unwrap_or(false)
}

/// Add a paired origin to the live CORS allowlist (on pairing approval).
pub fn add_paired_origin(origin: &str) {
    if let Ok(mut set) = paired_origins().write() {
        set.insert(origin.to_string());
    }
}

/// Repopulate the cache from the DB. Called once at server start so approvals
/// survive a restart (they persist as `external_api_keys.bound_origin`).
pub fn load_paired_origins(pool: &DbPool) {
    match api_key_repo::list_paired_origins(pool) {
        Ok(origins) => {
            if let Ok(mut set) = paired_origins().write() {
                set.clear();
                set.extend(origins);
                tracing::info!(
                    count = set.len(),
                    "loaded paired origins into CORS allowlist"
                );
            }
        }
        Err(e) => tracing::warn!(error = %e, "failed to load paired origins (starting empty)"),
    }
}

#[cfg(test)]
mod paired_origin_tests {
    use super::*;
}

// =============================================================================
// API key auth middleware
// =============================================================================

/// Scope strings minted for external API keys (see `external_api_keys::create`
/// and the API-keys UI catalog in `CreateApiKeyDialog.tsx`). `personas:read` is
/// implicit — read routes require only a valid key, so no constant is needed.
const SCOPE_EXECUTE: &str = "personas:execute";
const SCOPE_BUILD: &str = "personas:build";
/// Broad credential-proxy scope. The proxy injects stored secrets server-side,
/// so it is gated on its OWN scope (not `personas:execute`) — a paired cloud key
/// never receives it unless the user grants a specific credential. The internal
/// "system" key holds it so the connector bridge keeps working.
const SCOPE_PROXY: &str = "proxy";
/// Headless bridge test scope (§13). Minted only by the auto-pairing path in
/// `personas_engine::pairing::auto_approve_headless`, and demanded only by
/// `/api/kp/test/*` — which only exists while the mode is on.
const SCOPE_TEST: &str = personas_engine::headless::TEST_SCOPE;
/// Resource-scoped grant prefixes. A key holding `personas:execute:persona:<id>`
/// may execute only persona `<id>`; `proxy:credential:<id>` scopes the proxy to
/// one credential. See docs/architecture/cloud-integration-bridge.md §3.2.
const SCOPE_EXECUTE_PERSONA_PREFIX: &str = "personas:execute:persona:";
const SCOPE_PROXY_CREDENTIAL_PREFIX: &str = "proxy:credential:";

/// Per-key rate limit: max requests per window, keyed by the API key's id.
/// Generous for interactive/dashboard use — the loopback API is single-user.
const API_KEY_RATE_MAX: usize = 120;
const API_KEY_RATE_WINDOW: Duration = Duration::from_secs(60);

/// Authorize a request given the API key's scopes. Returns `Ok(())` if the key
/// may proceed, or `Err(reason)` (→ 403) if it lacks the required scope.
///
/// Resource-aware: a route naming a persona/credential is satisfied by EITHER
/// the broad scope OR the matching per-resource grant. Policy:
/// - `/a2a/*` + `/agent-card/*` — authenticated only. These carry their own
///   per-persona `gateway_exposure` gate, so any valid key may reach them
///   (subject to that gate). Preserves the A2A contract.
/// - `/api/build*` — requires `personas:build` (whole flow, including status
///   GETs, so a key without build scope can neither inspect nor drive builds).
/// - `/api/proxy/{credential_id}` — requires `proxy` OR
///   `proxy:credential:{credential_id}`. NOT `personas:execute`: the proxy
///   injects stored secrets, so it is gated on a dedicated scope.
/// - `/api/execute/{persona_id}` — requires `personas:execute` OR
///   `personas:execute:persona:{persona_id}`.
/// - all other `/api/*` — read verbs (GET/HEAD) need only authentication;
///   mutating verbs (POST/…) require broad `personas:execute`.
///
/// `scopes` comes from `parsed_scopes`, which fails closed (empty vec) on a
/// corrupt column, so a malformed row authorizes nothing scope-gated.
/// Wire shape of `POST /api/scrape/query`. Every field is consumed by
/// `scraper::query_dataset` inside the `#[cfg(feature = "scraper")]` arm of
/// `scrape_query`; the `not(scraper)` arm returns 501 without reading the
/// body, so the fields are dead in a build without `scraper` while remaining
/// the documented request contract for one that has it.
#[cfg_attr(not(feature = "scraper"), allow(dead_code))]
#[derive(Deserialize)]
struct ScrapeQueryBody {
    dataset: String,
    #[serde(default)]
    limit: Option<i64>,
    #[serde(default)]
    changed_only: bool,
}

/// `POST /api/scrape/query` — read records back from a scraper dataset.
async fn scrape_query(
    AxumState(_state): AxumState<Arc<ManagementState>>,
    Json(_body): Json<ScrapeQueryBody>,
) -> Response {
    #[cfg(feature = "scraper")]
    {
        match crate::engine::scraper::query_dataset(
            &_state.pool,
            &_body.dataset,
            _body.limit.unwrap_or(100),
            _body.changed_only,
        ) {
            Ok(records) => Json(records).into_response(),
            Err(e) => (StatusCode::BAD_GATEWAY, e).into_response(),
        }
    }
    #[cfg(not(feature = "scraper"))]
    {
        (
            StatusCode::NOT_IMPLEMENTED,
            "scraper feature not enabled in this build",
        )
            .into_response()
    }
}

fn authorize(method: &Method, path: &str, scopes: &[String]) -> Result<(), &'static str> {
    let has = |needle: &str| scopes.iter().any(|s| s == needle);

    if path.starts_with("/a2a/") || path.starts_with("/agent-card/") {
        return Ok(());
    }
    if path.starts_with("/api/build") {
        return if has(SCOPE_BUILD) {
            Ok(())
        } else {
            Err("api key lacks the personas:build scope")
        };
    }
    if path.starts_with("/api/broker/mint/") {
        // Minting consumer identities is a trust operation: broad `proxy`
        // only. A derived handle must never be able to mint further handles
        // (its scopes are `proxy:credential:<id>` + `cred:<connector>:use`).
        return if has(SCOPE_PROXY) {
            Ok(())
        } else {
            Err("api key lacks the proxy scope required to mint broker handles")
        };
    }
    if let Some(credential_id) = path.strip_prefix("/api/proxy/") {
        let specific = format!("{SCOPE_PROXY_CREDENTIAL_PREFIX}{credential_id}");
        // Broad `proxy`, exact per-credential grant, or ANY per-connector
        // `cred:<connector>:use` grant passes this coarse gate. The connector
        // grant cannot be verified here (matching it against the credential's
        // connector needs a DB read), so the proxy handler re-checks with
        // `credential_broker::authorize_credential_use` — default-deny — before
        // any secret is resolved. A key with no credential grant at all is
        // still rejected right here.
        return if has(SCOPE_PROXY)
            || has(&specific)
            || scopes
                .iter()
                .any(|s| super::credential_broker::is_cred_use_scope(s))
        {
            Ok(())
        } else {
            Err("api key lacks proxy scope for this credential")
        };
    }
    if path.starts_with("/api/kp/test/") {
        // Headless bridge test surface (§13). Deliberately a scope of its own
        // rather than `personas:build`: the tick endpoint spends money and
        // spawns fleet sessions on demand, and the only keys that carry
        // `personas:test` are the ones the headless bridge minted itself.
        // The route only EXISTS while the mode is on, so this arm is the second
        // gate, not the first.
        return if has(SCOPE_TEST) {
            Ok(())
        } else {
            Err("api key lacks the personas:test scope")
        };
    }
    if path.starts_with("/api/kp/") {
        // KP bridge: a mutating intake call queues a request whose approval
        // creates a draft persona + build session -- the same trust tier as
        // /api/build, so POSTs demand the build scope. Reads (status polling,
        // connector catalog) follow the generic any-valid-key GET rule.
        return match *method {
            Method::GET | Method::HEAD | Method::OPTIONS => Ok(()),
            _ if has(SCOPE_BUILD) => Ok(()),
            _ => Err("api key lacks the personas:build scope"),
        };
    }
    if let Some(persona_id) = path.strip_prefix("/api/execute/") {
        let specific = format!("{SCOPE_EXECUTE_PERSONA_PREFIX}{persona_id}");
        return if has(SCOPE_EXECUTE) || has(&specific) {
            Ok(())
        } else {
            Err("api key lacks execute scope for this persona")
        };
    }
    if path.starts_with("/api/dev/") {
        // Ship layer: a milestone or goal written here is work the app will
        // dispatch agents at, so writes sit at the `/api/build` trust tier.
        // Reads follow the generic any-valid-key GET rule.
        return match *method {
            Method::GET | Method::HEAD | Method::OPTIONS => Ok(()),
            _ if has(SCOPE_BUILD) => Ok(()),
            _ => Err("api key lacks the personas:build scope"),
        };
    }
    if path.starts_with("/api/") {
        return match *method {
            Method::GET | Method::HEAD | Method::OPTIONS => Ok(()),
            _ if has(SCOPE_EXECUTE) => Ok(()),
            _ => Err("api key lacks the personas:execute scope"),
        };
    }
    Ok(())
}

/// Require a valid `Authorization: Bearer <token>` header AND the scope the
/// matched route demands. Tokens are checked against `external_api_keys`;
/// disabled / revoked / unknown tokens return 401. An authenticated key that
/// lacks the route's required scope (see [`authorize`]) is
/// rejected with 403 — authentication alone never authorizes mutating or
/// credential-bearing routes. The middleware never logs token plaintext — only
/// the prefix when a match succeeds, for traceability.
/// Consumer identity of the authenticated API key, inserted into request
/// extensions by [`require_api_key`] so credential-bearing handlers (the
/// broker proxy) can attribute + exactly authorize the call. Never carries
/// token material — id, display name, and parsed scopes only.
#[derive(Clone, Debug)]
pub struct AuthedApiKey {
    pub id: String,
    pub name: String,
    pub scopes: Vec<String>,
}

async fn require_api_key(
    AxumState(state): AxumState<Arc<ManagementState>>,
    mut req: Request,
    next: Next,
) -> Result<Response, (StatusCode, Json<ApiResult>)> {
    let token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(str::to_string);

    let Some(token) = token else {
        return Err(err_json_tuple(StatusCode::UNAUTHORIZED, "missing api key"));
    };

    match api_key_repo::find_by_token(&state.pool, &token) {
        Ok(Some(key)) => {
            // Capture request metadata before `next.run` consumes `req`.
            let method = req.method().clone();
            let path = req.uri().path().to_string();
            let origin = req
                .headers()
                .get(header::ORIGIN)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string);

            // Authorization: enforce the per-route (and per-resource) scope. A
            // token that authenticates but lacks the scope a route demands (e.g.
            // a read-only key hitting the credential proxy, a persona-scoped key
            // executing a different persona, or a build) is denied with 403.
            let scopes = key.parsed_scopes();
            if let Err(reason) = authorize(&method, &path, &scopes) {
                tracing::warn!(
                    prefix = %key.key_prefix,
                    method = %method,
                    path = %path,
                    reason,
                    "external api key denied: insufficient scope"
                );
                record_audit(&state.pool, &key.id, &method, &path, 403, origin.as_deref());
                return Err(err_json_tuple(StatusCode::FORBIDDEN, reason));
            }

            // Per-key sliding-window rate limit.
            if let Err(retry_after) = state.rate_limiter.check(
                &format!("apikey:{}", key.id),
                API_KEY_RATE_MAX,
                API_KEY_RATE_WINDOW,
            ) {
                tracing::warn!(
                    prefix = %key.key_prefix,
                    retry_after_secs = retry_after,
                    "external api key rate-limited"
                );
                record_audit(&state.pool, &key.id, &method, &path, 429, origin.as_deref());
                return Ok(rate_limited_response(retry_after));
            }

            tracing::debug!(prefix = %key.key_prefix, "external api key accepted");
            // Expose the consumer identity to handlers (broker proxy uses it
            // for exact grant checks + per-consumer attribution).
            req.extensions_mut().insert(AuthedApiKey {
                id: key.id.clone(),
                name: key.name.clone(),
                scopes: scopes.clone(),
            });
            let resp = next.run(req).await;
            record_audit(
                &state.pool,
                &key.id,
                &method,
                &path,
                resp.status().as_u16(),
                origin.as_deref(),
            );
            Ok(resp)
        }
        Ok(None) => Err(err_json_tuple(StatusCode::UNAUTHORIZED, "invalid api key")),
        Err(e) => {
            tracing::error!(error = %e, "api key lookup failed");
            Err(err_json_tuple(
                StatusCode::INTERNAL_SERVER_ERROR,
                "auth lookup failed",
            ))
        }
    }
}

/// Best-effort per-key audit write. Never fails the request — a broken audit
/// table (e.g. the test-harness migration issue documented in the ADR) must not
/// take the API down.
fn record_audit(
    pool: &DbPool,
    key_id: &str,
    method: &Method,
    path: &str,
    status: u16,
    origin: Option<&str>,
) {
    let persona_id = audit_persona_id(path);
    if let Err(e) = api_key_audit_repo::insert(
        pool,
        key_id,
        method.as_str(),
        path,
        status as i64,
        persona_id.as_deref(),
        origin,
    ) {
        tracing::debug!(error = %e, "api_key_audit insert failed (non-fatal)");
    }
}

/// Extract the target persona id from routes that name one, for the audit row.
fn audit_persona_id(path: &str) -> Option<String> {
    for prefix in ["/api/execute/", "/a2a/", "/agent-card/", "/api/personas/"] {
        if let Some(rest) = path.strip_prefix(prefix) {
            let id = rest.split('/').next().unwrap_or("");
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }
    None
}

/// Build a 429 response carrying `Retry-After`. Returned as `Ok` because the
/// middleware's `Err` variant (a `(StatusCode, Json)` tuple) can't attach
/// headers.
fn rate_limited_response(retry_after_secs: u64) -> Response {
    let mut resp =
        err_json_tuple(StatusCode::TOO_MANY_REQUESTS, "rate limit exceeded").into_response();
    if let Ok(value) = HeaderValue::from_str(&retry_after_secs.to_string()) {
        resp.headers_mut().insert(header::RETRY_AFTER, value);
    }
    resp
}

// =============================================================================
// System API key bootstrap
// =============================================================================

/// Process-scoped cache of the "system" API key plaintext. The key is rotated
/// on every app start: previous system keys are revoked and a fresh one is
/// minted. The frontend fetches it via the `get_system_api_key` Tauri command
/// and uses it to authenticate direct HTTP fetches against the management API.
static SYSTEM_API_KEY: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn system_api_key_cache() -> &'static Mutex<Option<String>> {
    SYSTEM_API_KEY.get_or_init(|| Mutex::new(None))
}

/// Return the cached system API key plaintext, creating one on first call.
/// Concurrent callers race the lock; only the first one through actually mints
/// a fresh key. Subsequent callers return the cached value.
pub fn get_or_create_system_api_key(pool: &DbPool) -> Result<String, AppError> {
    let cache = system_api_key_cache();
    {
        let guard = cache.lock().expect("system api key mutex poisoned");
        if let Some(token) = guard.as_ref() {
            return Ok(token.clone());
        }
    }

    // Revoke any leftover system keys from prior process runs to keep the
    // table tidy and prevent stale tokens from accumulating.
    if let Ok(existing) = api_key_repo::list(pool) {
        for key in existing.iter().filter(|k| k.name == "system" && k.enabled) {
            let _ = api_key_repo::revoke(pool, &key.id);
        }
    }

    // The system key never expires and is not origin-bound (it authenticates
    // the desktop's own in-process fetches + the MCP sidecar bridge). It holds
    // the broad `proxy` scope so the connector bridge keeps working after the
    // credential proxy was gated off `personas:execute` onto `proxy`.
    let resp = api_key_repo::create(
        pool,
        "system",
        vec![
            "personas:read".into(),
            "personas:execute".into(),
            SCOPE_PROXY.into(),
        ],
        None,
        None,
        None,
    )?;

    let mut guard = cache.lock().expect("system api key mutex poisoned");
    // Another thread may have raced us — prefer their value if so.
    if let Some(existing) = guard.as_ref() {
        return Ok(existing.clone());
    }
    *guard = Some(resp.plaintext_token.clone());
    Ok(resp.plaintext_token)
}

// =============================================================================
// Request/Response types
// =============================================================================

#[derive(Deserialize)]
struct ExecuteInput {
    input_data: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct LabStartInput {
    models: Vec<TestModelConfig>,
    #[serde(default)]
    use_case_filter: Option<String>,
    /// Only for matrix: the improvement instruction
    #[serde(default)]
    instruction: Option<String>,
}

#[derive(Deserialize)]
struct ImproveInput {
    /// "arena", "ab", "matrix", or "eval"
    mode: String,
}

#[derive(Deserialize)]
struct TagInput {
    tag: String,
}

#[derive(Deserialize)]
struct ListQuery {
    limit: Option<i64>,
    status: Option<String>,
    persona_id: Option<String>,
}

#[derive(Serialize)]
struct ApiResult {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn ok_json(data: impl Serialize) -> impl IntoResponse {
    Json(ApiResult {
        success: true,
        data: serde_json::to_value(data).ok(),
        error: None,
    })
}

fn err_json(status: StatusCode, msg: &str) -> (StatusCode, Json<ApiResult>) {
    (
        status,
        Json(ApiResult {
            success: false,
            data: None,
            error: Some(msg.to_string()),
        }),
    )
}

/// Variant of `err_json` whose return type is the exact tuple expected by
/// the auth middleware (`Result<Response, (StatusCode, Json<ApiResult>)>`).
fn err_json_tuple(status: StatusCode, msg: &str) -> (StatusCode, Json<ApiResult>) {
    err_json(status, msg)
}

// =============================================================================
// Credential proxy endpoint
// =============================================================================

#[derive(Deserialize)]
struct ProxyRequestBody {
    method: String,
    path: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: Option<String>,
}

/// Proxy an HTTP request through a stored credential's auth strategy.
///
/// Credential secrets never leave the server — external consumers send requests
/// here with a credential ID, and auth headers are injected server-side.
///
/// Zero-Plaintext Broker enforcement (default-deny):
/// 1. The middleware already required SOME credential grant on the key.
/// 2. Here the exact intersection is checked: broad `proxy`, exact
///    `proxy:credential:<id>`, or `cred:<connector>:use` matching THIS
///    credential's connector — before any secret is resolved.
/// 3. The credential's own `scoped_resources` pins are enforced inside
///    `execute_api_request` (scope_enforcement), completing
///    caller-key scopes ∩ credential scoped_resources.
/// 4. Every call — allowed or denied — is written to the credential audit log
///    with the consumer identity, and allowed calls refresh the live
///    `credential_consumer_edges` blast-radius edge.
async fn proxy_request(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(credential_id): Path<String>,
    Extension(consumer): Extension<AuthedApiKey>,
    Json(input): Json<ProxyRequestBody>,
) -> impl IntoResponse {
    use crate::db::repos::resources::audit_log;
    use crate::db::repos::resources::broker_edges;
    use crate::db::repos::resources::credentials as cred_repo;
    use crate::engine::credential_broker;

    // Resolve the credential row (metadata only — no secret fields yet).
    let credential = match cred_repo::get_by_id(&state.pool, &credential_id) {
        Ok(c) => c,
        Err(AppError::NotFound(_)) => {
            return err_json(StatusCode::NOT_FOUND, "Credential not found").into_response()
        }
        Err(e) => {
            return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response()
        }
    };

    // Exact grant check: caller-key scopes ∩ this credential. Default-deny.
    let grant = match credential_broker::authorize_credential_use(
        &consumer.scopes,
        &credential.id,
        &credential.service_type,
    ) {
        Ok(g) => g,
        Err(reason) => {
            tracing::warn!(
                credential_id = %credential.id,
                consumer_key = %consumer.id,
                consumer = %consumer.name,
                "broker: denied credential use — {reason}"
            );
            audit_log::insert_warn(
                &state.pool,
                &credential.id,
                &credential.name,
                "broker_proxy_denied",
                Some(&format!(
                    "consumer={} key_id={} method={} path={}",
                    consumer.name, consumer.id, input.method, input.path
                )),
            );
            return err_json(StatusCode::FORBIDDEN, &reason).into_response();
        }
    };

    let result = crate::engine::api_proxy::execute_api_request(
        &state.pool,
        &credential_id,
        &input.method,
        &input.path,
        input.headers,
        input.body,
    )
    .await;

    // Attributed audit + live blast-radius edge, on success AND upstream error
    // (an errored call still proves the consumer exercised the credential).
    let status = result.as_ref().ok().map(|r| r.status as i64);
    audit_log::insert_warn(
        &state.pool,
        &credential.id,
        &credential.name,
        "broker_proxy_call",
        Some(&format!(
            "consumer={} key_id={} grant={} method={} path={} status={}",
            consumer.name,
            consumer.id,
            grant.as_str(),
            input.method,
            input.path,
            status.map_or_else(|| "error".to_string(), |s| s.to_string()),
        )),
    );
    if let Err(e) = broker_edges::upsert_edge(
        &state.pool,
        &credential.id,
        &consumer.id,
        &consumer.name,
        status,
    ) {
        tracing::warn!(error = %e, "broker: consumer-edge upsert failed (non-fatal)");
    }

    match result {
        Ok(resp) => ok_json(resp).into_response(),
        Err(e) => {
            let msg = format!("{e}");
            err_json(StatusCode::BAD_GATEWAY, &msg).into_response()
        }
    }
}

#[derive(Deserialize)]
struct MintHandleBody {
    consumer_name: String,
    #[serde(default)]
    ttl_minutes: Option<u32>,
}

/// `POST /api/broker/mint/{credential_id}` — mint a short-lived derived handle
/// for one credential. Returns the handle plaintext ONCE; never the secret.
/// Gated on the broad `proxy` scope in `authorize`, so external MCP/CLI
/// clients holding the system-level key can programmatically obtain
/// per-consumer identities ("give me a handle for Sentry").
async fn mint_broker_handle(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(credential_id): Path<String>,
    Extension(consumer): Extension<AuthedApiKey>,
    Json(body): Json<MintHandleBody>,
) -> impl IntoResponse {
    match crate::engine::credential_broker::mint_derived_handle(
        &state.pool,
        &credential_id,
        &body.consumer_name,
        body.ttl_minutes,
    ) {
        Ok(resp) => {
            tracing::info!(
                credential_id = %credential_id,
                minted_prefix = %resp.record.key_prefix,
                minted_by_key = %consumer.id,
                "broker: handle minted via management API"
            );
            ok_json(resp).into_response()
        }
        Err(AppError::NotFound(_)) => {
            err_json(StatusCode::NOT_FOUND, "Credential not found").into_response()
        }
        Err(AppError::Validation(msg)) => err_json(StatusCode::BAD_REQUEST, &msg).into_response(),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

// =============================================================================
// Persona endpoints
// =============================================================================

async fn list_personas(AxumState(state): AxumState<Arc<ManagementState>>) -> impl IntoResponse {
    match persona_repo::get_all(&state.pool) {
        Ok(personas) => {
            let summary: Vec<serde_json::Value> = personas
                .iter()
                .map(|p| {
                    serde_json::json!({
                        "id": p.id,
                        "name": p.name,
                        "description": p.description,
                        "enabled": p.enabled,
                        "icon": p.icon,
                        "color": p.color,
                    })
                })
                .collect();
            ok_json(summary).into_response()
        }
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

async fn get_persona(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
) -> impl IntoResponse {
    match persona_repo::get_by_id(&state.pool, &persona_id) {
        Ok(p) => ok_json(serde_json::json!({
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "enabled": p.enabled,
            "system_prompt": p.system_prompt.chars().take(500).collect::<String>(),
        }))
        .into_response(),
        Err(_) => err_json(StatusCode::NOT_FOUND, "Persona not found").into_response(),
    }
}

// =============================================================================
// Execution endpoints
// =============================================================================

async fn execute_persona(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
    Json(input): Json<ExecuteInput>,
) -> impl IntoResponse {
    let persona = match persona_repo::get_by_id(&state.pool, &persona_id) {
        Ok(p) => p,
        Err(_) => return err_json(StatusCode::NOT_FOUND, "Persona not found").into_response(),
    };

    if !persona.enabled {
        return err_json(StatusCode::BAD_REQUEST, "Persona is disabled").into_response();
    }

    // Create execution record
    let input_str = input.input_data.as_ref().map(|v| v.to_string());
    let execution = match exec_repo::create(&state.pool, &persona_id, None, input_str, None, None) {
        Ok(e) => e,
        Err(e) => {
            return err_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Failed to create execution: {e}"),
            )
            .into_response()
        }
    };

    // Get tools
    let tools = tool_repo::get_tools_for_persona(&state.pool, &persona_id).unwrap_or_default();

    // Start via engine
    let app_state: tauri::State<'_, Arc<crate::AppState>> = match state.app.try_state() {
        Some(s) => s,
        None => {
            return err_json(StatusCode::INTERNAL_SERVER_ERROR, "App state not available")
                .into_response()
        }
    };

    match app_state
        .engine
        .start_execution(
            state.app.clone(),
            state.pool.clone(),
            execution.id.clone(),
            persona,
            tools,
            input.input_data,
            None,
        )
        .await
    {
        Ok(()) => ok_json(serde_json::json!({
            "execution_id": execution.id,
            "status": "queued",
        }))
        .into_response(),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

async fn list_executions(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Query(q): Query<ListQuery>,
) -> impl IntoResponse {
    match exec_repo::get_all_global(
        &state.pool,
        q.limit,
        q.status.as_deref(),
        q.persona_id.as_deref(),
        None,
    ) {
        Ok(rows) => ok_json(rows).into_response(),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

async fn get_execution(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match exec_repo::get_by_id(&state.pool, &id) {
        Ok(exec) => ok_json(exec).into_response(),
        Err(_) => err_json(StatusCode::NOT_FOUND, "Execution not found").into_response(),
    }
}

// =============================================================================
// Lab endpoints
// =============================================================================

async fn start_arena(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
    Json(input): Json<LabStartInput>,
) -> impl IntoResponse {
    let persona = match persona_repo::get_by_id(&state.pool, &persona_id) {
        Ok(p) => p,
        Err(_) => return err_json(StatusCode::NOT_FOUND, "Persona not found").into_response(),
    };
    let tools = tool_repo::get_tools_for_persona(&state.pool, &persona_id).unwrap_or_default();
    let ephemeral = EphemeralPersona::from_persisted(persona, tools);

    if input.models.is_empty() {
        return err_json(StatusCode::BAD_REQUEST, "No models provided").into_response();
    }

    let models_json =
        serde_json::to_string(&input.models.iter().map(|m| &m.id).collect::<Vec<_>>())
            .unwrap_or_default();

    let run = match arena_repo::create_run(
        &state.pool,
        &persona_id,
        &models_json,
        input.use_case_filter.as_deref(),
        // Management-API arena measures the persona's current prompt; no version scope.
        None,
        None,
    ) {
        Ok(r) => r,
        Err(e) => {
            return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response()
        }
    };

    let run_id = run.id.clone();
    let (cancelled, run_guard) = state.process_registry.register_run_guarded("test", &run_id);
    let pool = state.pool.clone();
    let app = state.app.clone();
    let use_case_filter = input.use_case_filter;
    let models = input.models;

    tokio::spawn(async move {
        let _guard = run_guard;
        test_runner::run_arena_test(
            app,
            pool,
            run_id,
            ephemeral,
            models,
            std::env::temp_dir(),
            cancelled,
            use_case_filter,
            None,
        )
        .await;
    });

    ok_json(serde_json::json!({ "run_id": run.id, "status": "started" })).into_response()
}

async fn start_matrix(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
    Json(input): Json<LabStartInput>,
) -> impl IntoResponse {
    let instruction = match input.instruction {
        Some(ref i) if !i.is_empty() => i.clone(),
        _ => {
            return err_json(
                StatusCode::BAD_REQUEST,
                "instruction is required for matrix runs",
            )
            .into_response()
        }
    };

    let persona = match persona_repo::get_by_id(&state.pool, &persona_id) {
        Ok(p) => p,
        Err(_) => return err_json(StatusCode::NOT_FOUND, "Persona not found").into_response(),
    };
    let tools = tool_repo::get_tools_for_persona(&state.pool, &persona_id).unwrap_or_default();
    let ephemeral = EphemeralPersona::from_persisted(persona, tools);

    if input.models.is_empty() {
        return err_json(StatusCode::BAD_REQUEST, "No models provided").into_response();
    }

    let models_json =
        serde_json::to_string(&input.models.iter().map(|m| &m.id).collect::<Vec<_>>())
            .unwrap_or_default();

    let run = match matrix_repo::create_run(
        &state.pool,
        &persona_id,
        &instruction,
        &models_json,
        input.use_case_filter.as_deref(),
    ) {
        Ok(r) => r,
        Err(e) => {
            return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response()
        }
    };

    let run_id = run.id.clone();
    let (cancelled, run_guard) = state.process_registry.register_run_guarded("test", &run_id);
    let pool = state.pool.clone();
    let app = state.app.clone();
    let use_case_filter = input.use_case_filter;
    let models = input.models;

    tokio::spawn(async move {
        let _guard = run_guard;
        test_runner::run_matrix_test(
            app,
            pool,
            run_id,
            ephemeral,
            instruction,
            models,
            cancelled,
            use_case_filter,
        )
        .await;
    });

    ok_json(serde_json::json!({ "run_id": run.id, "status": "started" })).into_response()
}

async fn cancel_lab_run(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(run_id): Path<String>,
) -> impl IntoResponse {
    state.process_registry.cancel_run("test", &run_id);
    let now = chrono::Utc::now().to_rfc3339();

    // Try cancelling in each lab table (only one will match)
    let mut updated = 0usize;
    let mut errors: Vec<(&'static str, String)> = Vec::new();

    macro_rules! try_cancel_lab {
        ($kind:literal, $repo:ident) => {
            match $repo::update_run_status(
                &state.pool,
                &run_id,
                LabRunStatus::Cancelled,
                None,
                None,
                None,
                Some(&now),
            ) {
                Ok(true) => updated += 1,
                Ok(false) => {}
                Err(AppError::NotFound(_)) => {}
                Err(e) => errors.push(($kind, e.to_string())),
            }
        };
    }

    try_cancel_lab!("arena", arena_repo);
    try_cancel_lab!("matrix", matrix_repo);
    try_cancel_lab!("ab", ab_repo);
    try_cancel_lab!("eval", eval_repo);

    if updated == 0 {
        if let Some((kind, error)) = errors.first() {
            tracing::error!(
                run_id = %run_id,
                lab_kind = *kind,
                error = %error,
                "failed to cancel lab run in any lab table"
            );
            return err_json(StatusCode::INTERNAL_SERVER_ERROR, error).into_response();
        }
        return err_json(StatusCode::NOT_FOUND, "Lab run not found").into_response();
    }

    for (kind, error) in errors {
        tracing::warn!(
            run_id = %run_id,
            lab_kind = kind,
            error = %error,
            "lab cancel probe failed; ignoring because another lab table was cancelled"
        );
    }

    ok_json(serde_json::json!({ "run_id": run_id, "status": "cancelled" })).into_response()
}

/// Cancel any active background task tied to the run, then delete the run row.
/// CASCADE foreign keys remove the dependent results table. The handler probes
/// each lab-run table because the route does not carry a type discriminator —
/// only one delete will affect rows for any given id.
async fn delete_lab_run(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(run_id): Path<String>,
) -> impl IntoResponse {
    if state.process_registry.is_run_registered("test", &run_id) {
        state.process_registry.cancel_run("test", &run_id);
        // Brief grace window for the background task to notice + unregister.
        for _ in 0..10 {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            if !state.process_registry.is_run_registered("test", &run_id) {
                break;
            }
        }
        state.process_registry.unregister_run("test", &run_id);
    }

    if let Ok(true) = arena_repo::delete_run(&state.pool, &run_id) {
        return ok_json(serde_json::json!({ "run_id": run_id, "deleted": true, "type": "arena" }))
            .into_response();
    }
    if let Ok(true) = matrix_repo::delete_run(&state.pool, &run_id) {
        return ok_json(serde_json::json!({ "run_id": run_id, "deleted": true, "type": "matrix" }))
            .into_response();
    }
    if let Ok(true) = ab_repo::delete_run(&state.pool, &run_id) {
        return ok_json(serde_json::json!({ "run_id": run_id, "deleted": true, "type": "ab" }))
            .into_response();
    }
    if let Ok(true) = eval_repo::delete_run(&state.pool, &run_id) {
        return ok_json(serde_json::json!({ "run_id": run_id, "deleted": true, "type": "eval" }))
            .into_response();
    }

    err_json(StatusCode::NOT_FOUND, "Lab run not found").into_response()
}

/// Read-only status snapshot for a lab arena run — the headless analogue of
/// `arenaResultsMap` polling the UI uses. Returns the run row plus per-status
/// counts of its results so a caller can show progress without pulling the
/// full result set.
async fn get_lab_run_status(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(run_id): Path<String>,
) -> impl IntoResponse {
    let conn = match state.pool.get() {
        Ok(c) => c,
        Err(e) => {
            return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response()
        }
    };

    let run_row = conn.query_row(
        "SELECT id, persona_id, status, models_tested, scenarios_count, summary, error,
                created_at, completed_at, progress_json, llm_summary
         FROM lab_arena_runs WHERE id = ?1",
        rusqlite::params![run_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "persona_id": row.get::<_, String>(1)?,
                "status": row.get::<_, String>(2)?,
                "models_tested": row.get::<_, String>(3)?,
                "scenarios_count": row.get::<_, i64>(4)?,
                "summary": row.get::<_, Option<String>>(5)?,
                "error": row.get::<_, Option<String>>(6)?,
                "created_at": row.get::<_, String>(7)?,
                "completed_at": row.get::<_, Option<String>>(8)?,
                "progress_json": row.get::<_, Option<String>>(9)?,
                "llm_summary": row.get::<_, Option<String>>(10)?,
            }))
        },
    );

    let run_value = match run_row {
        Ok(v) => v,
        Err(_) => return err_json(StatusCode::NOT_FOUND, "Arena run not found").into_response(),
    };

    let mut counts: HashMap<String, i64> = HashMap::new();
    if let Ok(mut stmt) = conn
        .prepare("SELECT status, COUNT(*) FROM lab_arena_results WHERE run_id = ?1 GROUP BY status")
    {
        let rows = stmt.query_map(rusqlite::params![run_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        });
        if let Ok(rows) = rows {
            for r in rows.flatten() {
                counts.insert(r.0, r.1);
            }
        }
    }
    let total: i64 = counts.values().sum();
    let completed = counts.get("completed").copied().unwrap_or(0);

    ok_json(serde_json::json!({
        "run": run_value,
        "result_counts": counts,
        "results_total": total,
        "results_completed": completed,
    }))
    .into_response()
}

async fn improve_prompt(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path((persona_id, run_id)): Path<(String, String)>,
    Json(input): Json<ImproveInput>,
) -> impl IntoResponse {
    let persona = match persona_repo::get_by_id(&state.pool, &persona_id) {
        Ok(p) => p,
        Err(_) => return err_json(StatusCode::NOT_FOUND, "Persona not found").into_response(),
    };
    let _tools = tool_repo::get_tools_for_persona(&state.pool, &persona_id).unwrap_or_default();

    // Load results based on mode
    let results_text = match load_lab_results_for_improvement(&state.pool, &run_id, &input.mode) {
        Ok(text) => text,
        Err(e) => return err_json(StatusCode::BAD_REQUEST, &e).into_response(),
    };

    // Generate improvement via LLM
    match test_runner::generate_targeted_improvements(&state.pool, &persona, &results_text, None)
        .await
    {
        Ok((_, version_text)) => {
            // Save as new prompt version
            let version_id = metrics_repo::create_prompt_version_if_changed(
                &state.pool,
                &persona_id,
                Some(version_text.clone()),
                None,
            );
            ok_json(serde_json::json!({
                "improved": true,
                "version_id": version_id.ok().flatten(),
                "preview": version_text.chars().take(500).collect::<String>(),
            }))
            .into_response()
        }
        Err(e) => err_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Improvement failed: {e}"),
        )
        .into_response(),
    }
}

fn load_lab_results_for_improvement(
    pool: &DbPool,
    run_id: &str,
    mode: &str,
) -> Result<String, String> {
    let text = match mode {
        "arena" => {
            let results =
                arena_repo::get_results_by_run(pool, run_id).map_err(|e| e.to_string())?;
            serde_json::to_string_pretty(&results).map_err(|e| e.to_string())?
        }
        "matrix" => {
            let results =
                matrix_repo::get_results_by_run(pool, run_id).map_err(|e| e.to_string())?;
            serde_json::to_string_pretty(&results).map_err(|e| e.to_string())?
        }
        "ab" => {
            let results = ab_repo::get_results_by_run(pool, run_id).map_err(|e| e.to_string())?;
            serde_json::to_string_pretty(&results).map_err(|e| e.to_string())?
        }
        "eval" => {
            let results = eval_repo::get_results_by_run(pool, run_id).map_err(|e| e.to_string())?;
            serde_json::to_string_pretty(&results).map_err(|e| e.to_string())?
        }
        _ => {
            return Err(format!(
                "Unknown mode: {mode}. Use arena, matrix, ab, or eval."
            ))
        }
    };
    Ok(text)
}

// =============================================================================
// Version endpoints
// =============================================================================

async fn list_versions(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
) -> impl IntoResponse {
    match metrics_repo::get_prompt_versions(&state.pool, &persona_id, Some(20)) {
        Ok(versions) => ok_json(versions).into_response(),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

async fn tag_version(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(version_id): Path<String>,
    Json(input): Json<TagInput>,
) -> impl IntoResponse {
    match metrics_repo::update_prompt_version_tag(&state.pool, &version_id, &input.tag) {
        Ok(v) => ok_json(v).into_response(),
        Err(e) => err_json(StatusCode::BAD_REQUEST, &e.to_string()).into_response(),
    }
}

async fn rollback_version(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(version_id): Path<String>,
) -> impl IntoResponse {
    match metrics_repo::update_prompt_version_tag(&state.pool, &version_id, "production") {
        Ok(v) => ok_json(v).into_response(),
        Err(e) => err_json(StatusCode::BAD_REQUEST, &e.to_string()).into_response(),
    }
}

async fn accept_draft(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(run_id): Path<String>,
) -> impl IntoResponse {
    let run = match matrix_repo::get_run_by_id(&state.pool, &run_id) {
        Ok(r) => r,
        Err(_) => return err_json(StatusCode::NOT_FOUND, "Matrix run not found").into_response(),
    };

    let draft_json = match run.draft_prompt_json {
        Some(d) => d,
        None => return err_json(StatusCode::BAD_REQUEST, "No draft available").into_response(),
    };

    // Apply draft to persona
    let conn = match state.pool.get() {
        Ok(c) => c,
        Err(e) => {
            return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response()
        }
    };
    let now = chrono::Utc::now().to_rfc3339();
    if let Err(e) = conn.execute(
        "UPDATE personas SET structured_prompt = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![draft_json, now, run.persona_id],
    ) {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response();
    }

    let _ = matrix_repo::accept_draft(&state.pool, &run_id);
    let _ = metrics_repo::create_prompt_version_if_changed(
        &state.pool,
        &run.persona_id,
        Some(draft_json),
        None,
    );

    ok_json(serde_json::json!({ "accepted": true, "persona_id": run.persona_id })).into_response()
}

// =============================================================================
// Automation settings endpoints
// =============================================================================

use crate::db::repos::core::settings;
use crate::db::settings_keys;

#[derive(Deserialize, Serialize)]
struct AutoOptimizeConfig {
    enabled: bool,
    #[serde(default = "default_optimize_cron")]
    cron: String,
    #[serde(default = "default_min_score")]
    min_score: u32,
    #[serde(default = "default_models")]
    models: Vec<String>,
}

fn default_optimize_cron() -> String {
    "0 2 * * 0".into()
} // Sunday 2 AM
fn default_min_score() -> u32 {
    80
}
fn default_models() -> Vec<String> {
    vec!["sonnet".into()]
}

#[derive(Deserialize, Serialize)]
struct HealthWatchConfig {
    enabled: bool,
    #[serde(default = "default_interval_hours")]
    interval_hours: u32,
    #[serde(default = "default_error_threshold")]
    error_threshold: u32,
}

fn default_interval_hours() -> u32 {
    6
}
fn default_error_threshold() -> u32 {
    30
}

async fn get_auto_optimize(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
) -> impl IntoResponse {
    let key = format!("{}{}", settings_keys::AUTO_OPTIMIZE_PREFIX, persona_id);
    match settings::get(&state.pool, &key) {
        Ok(Some(json)) => {
            let config: AutoOptimizeConfig =
                serde_json::from_str(&json).unwrap_or(AutoOptimizeConfig {
                    enabled: false,
                    cron: default_optimize_cron(),
                    min_score: default_min_score(),
                    models: default_models(),
                });
            ok_json(config).into_response()
        }
        _ => ok_json(AutoOptimizeConfig {
            enabled: false,
            cron: default_optimize_cron(),
            min_score: default_min_score(),
            models: default_models(),
        })
        .into_response(),
    }
}

async fn set_auto_optimize(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
    Json(config): Json<AutoOptimizeConfig>,
) -> impl IntoResponse {
    let key = format!("{}{}", settings_keys::AUTO_OPTIMIZE_PREFIX, persona_id);
    let json = match serde_json::to_string(&config) {
        Ok(j) => j,
        Err(e) => {
            tracing::error!(persona_id = %persona_id, error = %e, "failed to serialize auto-optimize config");
            return err_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Failed to serialize config: {e}"),
            )
            .into_response();
        }
    };
    match settings::set(&state.pool, &key, &json) {
        Ok(()) => ok_json(config).into_response(),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

async fn get_health_watch(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
) -> impl IntoResponse {
    let key = format!("{}{}", settings_keys::HEALTH_WATCH_PREFIX, persona_id);
    match settings::get(&state.pool, &key) {
        Ok(Some(json)) => {
            let config: HealthWatchConfig =
                serde_json::from_str(&json).unwrap_or(HealthWatchConfig {
                    enabled: false,
                    interval_hours: default_interval_hours(),
                    error_threshold: default_error_threshold(),
                });
            ok_json(config).into_response()
        }
        _ => ok_json(HealthWatchConfig {
            enabled: false,
            interval_hours: default_interval_hours(),
            error_threshold: default_error_threshold(),
        })
        .into_response(),
    }
}

async fn set_health_watch(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
    Json(config): Json<HealthWatchConfig>,
) -> impl IntoResponse {
    let key = format!("{}{}", settings_keys::HEALTH_WATCH_PREFIX, persona_id);
    let json = match serde_json::to_string(&config) {
        Ok(j) => j,
        Err(e) => {
            tracing::error!(persona_id = %persona_id, error = %e, "failed to serialize health-watch config");
            return err_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Failed to serialize config: {e}"),
            )
            .into_response();
        }
    };
    match settings::set(&state.pool, &key, &json) {
        Ok(()) => ok_json(config).into_response(),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

// =============================================================================
// A2A Gateway -- agent card discovery
// =============================================================================

/// Build an A2A `AgentCard` from a persona's existing fields plus its
/// `design_context.use_cases` (each use case becomes a `skill`). Personas
/// without use cases get a single fallback skill.
fn build_agent_card(persona: &Persona, host_origin: &str) -> AgentCard {
    let ctx = persona.parsed_design_context();

    let skills: Vec<AgentSkill> = match ctx.use_cases.as_ref() {
        Some(uses) if !uses.is_empty() => uses
            .iter()
            .map(|u| AgentSkill {
                id: u.id.clone(),
                name: u.title.clone(),
                description: u.description.clone(),
                tags: u
                    .category
                    .as_ref()
                    .map(|c| vec![c.clone()])
                    .unwrap_or_default(),
                examples: Vec::new(),
                input_modes: vec!["text".into()],
                output_modes: vec!["text".into()],
            })
            .collect(),
        _ => vec![AgentSkill {
            id: "default".into(),
            name: persona.name.clone(),
            description: persona.description.clone().unwrap_or_default(),
            tags: Vec::new(),
            examples: Vec::new(),
            input_modes: vec!["text".into()],
            output_modes: vec!["text".into()],
        }],
    };

    AgentCard {
        name: persona.name.clone(),
        description: persona.description.clone(),
        url: format!("{host_origin}/a2a/{}", persona.id),
        version: env!("CARGO_PKG_VERSION").to_string(),
        capabilities: AgentCapabilities {
            streaming: false,
            push_notifications: false,
            state_transition_history: false,
        },
        skills,
        default_input_modes: vec!["text".into()],
        default_output_modes: vec!["text".into()],
    }
}

/// Derive the request's host origin (`scheme://host`) for use as the
/// canonical URL prefix in agent cards. Falls back to the loopback address
/// when the `Host` header is absent.
fn host_origin_from_request(headers: &axum::http::HeaderMap) -> String {
    let host = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("127.0.0.1:9420");
    // Management API is HTTP-only on localhost; if a proxy ever fronts it,
    // the X-Forwarded-Proto header would override this. Keep simple for now.
    format!("http://{host}")
}

async fn get_agent_card(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
    headers: axum::http::HeaderMap,
) -> Result<Json<AgentCard>, (StatusCode, Json<ApiResult>)> {
    let persona = match persona_repo::find_by_id_if_exposed(&state.pool, &persona_id) {
        Ok(Some(p)) => p,
        Ok(None) => {
            return Err(err_json(StatusCode::NOT_FOUND, "Persona not found"));
        }
        Err(e) => {
            return Err(err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()));
        }
    };
    let origin = host_origin_from_request(&headers);
    Ok(Json(build_agent_card(&persona, &origin)))
}

// =============================================================================
// A2A Gateway -- JSON-RPC entry point
// =============================================================================

/// Dispatch an A2A JSON-RPC request to the per-method handler.
///
/// Implemented methods:
/// - `message/send`   — synchronous execution (blocks until terminal state)
/// - `tasks/get`      — fetch an existing execution by id and return its A2A task shape
/// - `tasks/cancel`   — cooperatively cancel a running execution
///
/// Unsupported methods return JSON-RPC `-32601 Method not found`.
///
// TODO(a2a-streaming): wire up `message/stream` once the engine exposes a
// synchronous-text streaming surface for the management API.
async fn handle_a2a_request(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
    Json(req): Json<A2ARequest>,
) -> impl IntoResponse {
    let req_id = req.id.clone().unwrap_or(serde_json::Value::Null);

    match req.method.as_str() {
        "message/send" => handle_message_send(&state, &persona_id, req_id, req.params).await,
        "tasks/get" => handle_tasks_get(&state, &persona_id, req_id, req.params).await,
        "tasks/cancel" => handle_tasks_cancel(&state, &persona_id, req_id, req.params).await,
        _ => {
            let body = A2AResponse::error(req_id, -32601, "Method not found");
            (
                StatusCode::OK,
                Json(serde_json::to_value(body).unwrap_or_default()),
            )
                .into_response()
        }
    }
}

/// `message/send` — execute the persona synchronously and return the final text.
async fn handle_message_send(
    state: &Arc<ManagementState>,
    persona_id: &str,
    req_id: serde_json::Value,
    raw_params: Option<serde_json::Value>,
) -> Response {
    let params: MessageSendParams = match raw_params
        .ok_or_else(|| "missing".to_string())
        .and_then(|v| serde_json::from_value(v).map_err(|e| e.to_string()))
    {
        Ok(p) => p,
        Err(_) => {
            let body = A2AResponse::error(req_id, -32602, "Invalid params: missing message");
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::to_value(body).unwrap_or_default()),
            )
                .into_response();
        }
    };

    let prompt_text = match params.message.collect_text() {
        Some(t) => t,
        None => {
            let body = A2AResponse::error(
                req_id,
                -32602,
                "Invalid params: message must contain at least one text part",
            );
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::to_value(body).unwrap_or_default()),
            )
                .into_response();
        }
    };

    // Look up persona via the exposure-gated helper. Personas with
    // `gateway_exposure = local_only` are reported as "not exposed" — we
    // never leak their existence to external consumers.
    let persona = match persona_repo::find_by_id_if_exposed(&state.pool, persona_id) {
        Ok(Some(p)) => p,
        Ok(None) => {
            let body = A2AResponse::error(req_id, -32602, "Agent not found or not exposed");
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::to_value(body).unwrap_or_default()),
            )
                .into_response();
        }
        Err(e) => {
            let body = A2AResponse::error(req_id, -32603, format!("Internal error: {e}"));
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::to_value(body).unwrap_or_default()),
            )
                .into_response();
        }
    };

    if !persona.enabled {
        let body = A2AResponse::error(req_id, -32603, "Agent is disabled");
        return (
            StatusCode::OK,
            Json(serde_json::to_value(body).unwrap_or_default()),
        )
            .into_response();
    }

    // InviteOnly is treated identically to Public for now; scope-based
    // filtering arrives with the rate-limiter / per-key scopes finding.
    if matches!(persona.gateway_exposure, PersonaGatewayExposure::InviteOnly) {
        tracing::debug!(
            persona_id = %persona.id,
            "invite_only persona served as public until scopes ship"
        );
    }

    // Wrap the user-supplied text into the engine's input shape and route
    // through the same path used by `/api/execute`.
    let input_value = serde_json::json!({ "input": prompt_text });
    match run_persona_synchronous(state, persona, input_value).await {
        Ok(text) => {
            let body = A2AResponse::success(req_id, A2AResultMessage::text(text));
            (
                StatusCode::OK,
                Json(serde_json::to_value(body).unwrap_or_default()),
            )
                .into_response()
        }
        Err(e) => {
            let body = A2AResponse::error(req_id, -32603, format!("Internal error: {e}"));
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::to_value(body).unwrap_or_default()),
            )
                .into_response()
        }
    }
}

/// `tasks/get` — return the current state of an execution as an A2A Task object.
///
/// The execution's persona must be exposed for the task to be visible. If the
/// persona is `local_only` (or doesn't exist) we report "Task not found"
/// rather than leaking the existence of an internal execution. Cross-persona
/// access is also blocked: a request to `/a2a/{persona_id}` can only inspect
/// tasks belonging to that persona.
async fn handle_tasks_get(
    state: &Arc<ManagementState>,
    persona_id: &str,
    req_id: serde_json::Value,
    raw_params: Option<serde_json::Value>,
) -> Response {
    let params: TaskIdParams = match raw_params
        .ok_or_else(|| "missing".to_string())
        .and_then(|v| serde_json::from_value(v).map_err(|e| e.to_string()))
    {
        Ok(p) => p,
        Err(_) => {
            let body = A2ATaskResponse::error(req_id, -32602, "Invalid params: missing task id");
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::to_value(body).unwrap_or_default()),
            )
                .into_response();
        }
    };

    // Verify the persona is reachable before returning anything about its tasks.
    let persona = match persona_repo::find_by_id_if_exposed(&state.pool, persona_id) {
        Ok(Some(p)) => p,
        Ok(None) => {
            let body = A2ATaskResponse::error(req_id, -32001, "Task not found");
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::to_value(body).unwrap_or_default()),
            )
                .into_response();
        }
        Err(e) => {
            let body = A2ATaskResponse::error(req_id, -32603, format!("Internal error: {e}"));
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::to_value(body).unwrap_or_default()),
            )
                .into_response();
        }
    };

    let row = match exec_repo::get_by_id(&state.pool, &params.id) {
        Ok(r) => r,
        Err(_) => {
            // -32001 is the A2A spec's "TaskNotFoundError" code.
            let body = A2ATaskResponse::error(req_id, -32001, "Task not found");
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::to_value(body).unwrap_or_default()),
            )
                .into_response();
        }
    };

    // Cross-persona access guard: tasks can only be read through the persona
    // that owns them. Without this check, an attacker holding any valid API
    // key could enumerate executions across personas by guessing IDs.
    if row.persona_id != persona.id {
        let body = A2ATaskResponse::error(req_id, -32001, "Task not found");
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::to_value(body).unwrap_or_default()),
        )
            .into_response();
    }

    let task = build_a2a_task(&row, &persona.id);
    let body = A2ATaskResponse::success(req_id, task);
    (
        StatusCode::OK,
        Json(serde_json::to_value(body).unwrap_or_default()),
    )
        .into_response()
}

/// `tasks/cancel` — cooperatively cancel a running execution and return the
/// updated A2A task. Idempotent: cancelling an already-terminal task returns
/// the current state without re-cancelling. The same exposure + cross-persona
/// guards as `tasks/get` apply.
async fn handle_tasks_cancel(
    state: &Arc<ManagementState>,
    persona_id: &str,
    req_id: serde_json::Value,
    raw_params: Option<serde_json::Value>,
) -> Response {
    let params: TaskIdParams = match raw_params
        .ok_or_else(|| "missing".to_string())
        .and_then(|v| serde_json::from_value(v).map_err(|e| e.to_string()))
    {
        Ok(p) => p,
        Err(_) => {
            let body = A2ATaskResponse::error(req_id, -32602, "Invalid params: missing task id");
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::to_value(body).unwrap_or_default()),
            )
                .into_response();
        }
    };

    let persona = match persona_repo::find_by_id_if_exposed(&state.pool, persona_id) {
        Ok(Some(p)) => p,
        Ok(None) => {
            let body = A2ATaskResponse::error(req_id, -32001, "Task not found");
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::to_value(body).unwrap_or_default()),
            )
                .into_response();
        }
        Err(e) => {
            let body = A2ATaskResponse::error(req_id, -32603, format!("Internal error: {e}"));
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::to_value(body).unwrap_or_default()),
            )
                .into_response();
        }
    };

    let row = match exec_repo::get_by_id(&state.pool, &params.id) {
        Ok(r) => r,
        Err(_) => {
            let body = A2ATaskResponse::error(req_id, -32001, "Task not found");
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::to_value(body).unwrap_or_default()),
            )
                .into_response();
        }
    };

    if row.persona_id != persona.id {
        let body = A2ATaskResponse::error(req_id, -32001, "Task not found");
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::to_value(body).unwrap_or_default()),
        )
            .into_response();
    }

    let already_terminal = matches!(
        row.status.as_str(),
        "completed" | "success" | "failed" | "error" | "cancelled" | "timeout"
    );

    if !already_terminal {
        // Reach into the engine via the AppHandle Tauri state; same pattern as
        // `run_persona_synchronous`.
        let app_state: tauri::State<'_, Arc<crate::AppState>> = match state.app.try_state() {
            Some(s) => s,
            None => {
                let body = A2ATaskResponse::error(req_id, -32603, "App state not available");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::to_value(body).unwrap_or_default()),
                )
                    .into_response();
            }
        };

        let _cancelled_ok = app_state
            .engine
            .cancel_execution(&params.id, &state.pool, Some(&persona.id))
            .await;
        // We intentionally ignore the bool return — `cancel_execution` returns
        // false for already-terminal executions, which we already detected
        // above. The post-cancel re-read below is the source of truth either way.
    }

    // Re-read the row to pick up the updated status and emit it back to the client.
    let updated = match exec_repo::get_by_id(&state.pool, &params.id) {
        Ok(r) => r,
        Err(e) => {
            let body = A2ATaskResponse::error(req_id, -32603, format!("Internal error: {e}"));
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::to_value(body).unwrap_or_default()),
            )
                .into_response();
        }
    };
    let task = build_a2a_task(&updated, &persona.id);
    let body = A2ATaskResponse::success(req_id, task);
    (
        StatusCode::OK,
        Json(serde_json::to_value(body).unwrap_or_default()),
    )
        .into_response()
}

/// Convert an `executions` row into the A2A `Task` shape.
fn build_a2a_task(row: &PersonaExecution, persona_id: &str) -> A2ATask {
    let state = map_status_to_a2a_state(row.status.as_str());

    // Best-effort timestamp: use completed_at when present (terminal states),
    // otherwise started_at, otherwise the row's created_at.
    let timestamp = row
        .completed_at
        .clone()
        .or_else(|| row.started_at.clone())
        .unwrap_or_else(|| row.created_at.clone());

    // Attach the output as an artifact when the task is in a successful
    // terminal state. Failures attach the error string as a status message
    // instead — matches the way A2A clients distinguish success vs failure.
    let mut artifacts = Vec::new();
    let mut status_message: Option<A2AStatusMessage> = None;
    match state {
        "completed" => {
            if let Some(out) = row.output_data.as_ref() {
                if !out.is_empty() {
                    artifacts.push(A2AArtifact {
                        artifact_id: format!("{}-output", row.id),
                        name: "result",
                        parts: vec![A2AResponsePart {
                            kind: "text",
                            text: out.clone(),
                        }],
                    });
                }
            }
        }
        "failed" | "canceled" => {
            if let Some(err) = row.error_message.as_ref() {
                if !err.is_empty() {
                    status_message = Some(A2AStatusMessage {
                        kind: "message",
                        role: "agent",
                        parts: vec![A2AResponsePart {
                            kind: "text",
                            text: err.clone(),
                        }],
                        message_id: uuid::Uuid::new_v4().to_string(),
                    });
                }
            }
        }
        _ => {}
    }

    A2ATask {
        id: row.id.clone(),
        context_id: format!("persona-{persona_id}"),
        kind: "task",
        status: A2ATaskStatus {
            state,
            timestamp,
            message: status_message,
        },
        history: Vec::new(),
        artifacts,
    }
}

/// Execute a persona synchronously and return its final text output.
///
/// The existing `/api/execute` handler is fire-and-forget — it returns an
/// execution ID immediately. For A2A we need to block until completion, so
/// we kick off the same engine call and then poll the executions table for
/// terminal status.
async fn run_persona_synchronous(
    state: &ManagementState,
    persona: Persona,
    input: serde_json::Value,
) -> Result<String, AppError> {
    // 1. Create the execution row up front.
    let persona_id = persona.id.clone();
    let input_str = Some(input.to_string());
    let execution = exec_repo::create(&state.pool, &persona_id, None, input_str, None, None)
        .map_err(|e| AppError::Internal(format!("Failed to create execution: {e}")))?;

    let tools = tool_repo::get_tools_for_persona(&state.pool, &persona_id).unwrap_or_default();

    // 2. Hand off to the engine.
    let app_state: tauri::State<'_, Arc<crate::AppState>> = state
        .app
        .try_state()
        .ok_or_else(|| AppError::Internal("App state not available".into()))?;

    app_state
        .engine
        .start_execution(
            state.app.clone(),
            state.pool.clone(),
            execution.id.clone(),
            persona,
            tools,
            Some(input),
            None,
        )
        .await
        .map_err(|e| AppError::Execution(e.to_string()))?;

    // 3. Poll the execution until it reaches a terminal state. The cap is
    //    intentionally generous; the engine has its own per-persona timeout
    //    that will fail the row faster than this loop unwinds.
    const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(250);
    const MAX_WAIT: std::time::Duration = std::time::Duration::from_secs(600);
    let started = std::time::Instant::now();

    loop {
        let row = exec_repo::get_by_id(&state.pool, &execution.id)?;
        let status = row.status.as_str();
        match status {
            "completed" | "success" => {
                return Ok(row.output_data.unwrap_or_else(|| "".to_string()));
            }
            "failed" | "error" | "cancelled" | "timeout" => {
                return Err(AppError::Execution(
                    row.error_message.unwrap_or_else(|| status.to_string()),
                ));
            }
            _ => {
                if started.elapsed() > MAX_WAIT {
                    return Err(AppError::Execution(
                        "A2A execution timed out waiting for terminal status".into(),
                    ));
                }
                tokio::time::sleep(POLL_INTERVAL).await;
            }
        }
    }
}

// =============================================================================
// Build session endpoints — third-party MCP clients drive a persona build
// through these. All routes are auth-gated by `require_api_key` (mounted at
// the router level above). Mirrors the test-automation HTTP surface
// (`test_automation.rs::handle_build_*`) but with the production auth
// middleware in front, so external clients can run a build end-to-end
// without the test-automation feature flag.
// =============================================================================

#[derive(Deserialize)]
struct BuildStartBody {
    persona_id: String,
    intent: String,
    #[serde(default)]
    workflow_json: Option<String>,
    #[serde(default)]
    parser_result_json: Option<String>,
    #[serde(default)]
    language: Option<String>,
    /// `"interactive"` (ask clarifying questions) or `"one_shot"` (autonomous).
    /// Default `interactive` if omitted.
    #[serde(default)]
    mode: Option<String>,
    /// Optional Companion chat session that originated this build.
    #[serde(default)]
    companion_session_id: Option<String>,
    /// Optional user-provided reference context to ground the build (UAT P7).
    #[serde(default)]
    context: Option<String>,
    /// Build orchestration variant ("sequential" | "multiagent"); empty → sequential.
    #[serde(default)]
    orchestration: Option<String>,
}

async fn start_build(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Json(body): Json<BuildStartBody>,
) -> impl IntoResponse {
    let app_state: tauri::State<'_, Arc<crate::AppState>> = match state.app.try_state() {
        Some(s) => s,
        None => {
            return err_json(StatusCode::INTERNAL_SERVER_ERROR, "App state not available")
                .into_response();
        }
    };
    let session_id = uuid::Uuid::new_v4().to_string();
    // No-op channel — global emits drive the UI / watcher pipelines, the
    // headless caller polls /api/build/{id} for state.
    let dummy_channel: tauri::ipc::Channel<serde_json::Value> =
        tauri::ipc::Channel::new(|_| Ok(()));
    match app_state.build_session_manager.start_session(
        session_id.clone(),
        body.persona_id,
        body.intent,
        dummy_channel,
        state.pool.clone(),
        state.process_registry.clone(),
        body.workflow_json,
        body.parser_result_json,
        state.app.clone(),
        body.language,
        body.mode,
        body.companion_session_id,
        body.context,
        body.orchestration,
    ) {
        Ok(sid) => ok_json(serde_json::json!({"session_id": sid})).into_response(),
        Err(e) => err_json(StatusCode::BAD_REQUEST, &e.to_string()).into_response(),
    }
}

async fn build_status(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(session_id): Path<String>,
) -> impl IntoResponse {
    match crate::db::repos::core::build_sessions::get_by_id(&state.pool, &session_id) {
        Ok(Some(session)) => {
            let pending_question = session
                .pending_question
                .as_deref()
                .and_then(|q| serde_json::from_str::<serde_json::Value>(q).ok());
            let resolved_cells: serde_json::Value =
                serde_json::from_str(&session.resolved_cells).unwrap_or_else(|e| {
                    tracing::warn!(session_id = %session.id, error = %e, "unparseable resolved_cells in build_status");
                    serde_json::Value::Null
                });
            ok_json(serde_json::json!({
                "session_id": session.id,
                "persona_id": session.persona_id,
                "phase": session.phase.as_str(),
                "is_terminal": session.phase.is_terminal(),
                "mode": session.mode.unwrap_or_else(|| "interactive".to_string()),
                "companion_session_id": session.companion_session_id,
                "intent": session.intent,
                "pending_question": pending_question,
                "resolved_cells": resolved_cells,
                "agent_ir_present": session.agent_ir.is_some(),
                "error_message": session.error_message,
                "created_at": session.created_at,
                "updated_at": session.updated_at,
                // Build telemetry (build-orchestration Phase 0).
                "phase_timings": session
                    .phase_timings_json
                    .as_deref()
                    .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok()),
                "cost_usd": session.total_cost_usd,
                "input_tokens": session.input_tokens,
                "output_tokens": session.output_tokens,
                "num_turns": session.num_turns,
            }))
            .into_response()
        }
        Ok(None) => err_json(StatusCode::NOT_FOUND, "build session not found").into_response(),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

async fn build_pending(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(session_id): Path<String>,
) -> impl IntoResponse {
    match crate::db::repos::core::build_sessions::get_by_id(&state.pool, &session_id) {
        Ok(Some(session)) => {
            let pending = session
                .pending_question
                .as_deref()
                .and_then(|q| serde_json::from_str::<serde_json::Value>(q).ok());
            ok_json(serde_json::json!({"pending_question": pending})).into_response()
        }
        Ok(None) => err_json(StatusCode::NOT_FOUND, "build session not found").into_response(),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
struct BuildAnswerBody {
    cell_key: String,
    answer: String,
}

async fn build_answer(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(session_id): Path<String>,
    Json(body): Json<BuildAnswerBody>,
) -> impl IntoResponse {
    let app_state: tauri::State<'_, Arc<crate::AppState>> = match state.app.try_state() {
        Some(s) => s,
        None => {
            return err_json(StatusCode::INTERNAL_SERVER_ERROR, "App state not available")
                .into_response();
        }
    };
    let user_answer = crate::db::models::UserAnswer {
        cell_key: body.cell_key,
        answer: body.answer,
        reference: None,
        webhook_source: None,
    };
    match app_state
        .build_session_manager
        .send_answer(&session_id, user_answer)
    {
        Ok(_) => ok_json(serde_json::json!({"status": "queued"})).into_response(),
        Err(e) => err_json(StatusCode::BAD_REQUEST, &e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
struct BuildTestBody {
    persona_id: String,
}

async fn build_test(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(session_id): Path<String>,
    Json(body): Json<BuildTestBody>,
) -> impl IntoResponse {
    let session = match crate::db::repos::core::build_sessions::get_by_id(&state.pool, &session_id)
    {
        Ok(Some(s)) => s,
        Ok(None) => {
            return err_json(StatusCode::NOT_FOUND, "build session not found").into_response();
        }
        Err(e) => {
            return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response()
        }
    };
    let agent_ir_str = match session.agent_ir.clone() {
        Some(s) => s,
        None => {
            return err_json(
                StatusCode::BAD_REQUEST,
                "agent_ir not yet emitted — wait for draft_ready before testing",
            )
            .into_response();
        }
    };
    let mut agent_ir: crate::db::models::AgentIr = match serde_json::from_str(&agent_ir_str) {
        Ok(v) => v,
        Err(e) => {
            return err_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("agent_ir parse error: {e}"),
            )
            .into_response();
        }
    };
    if let Some(ref raw_answers) = session.adoption_answers {
        if let Ok(answers) =
            serde_json::from_str::<crate::engine::adoption_answers::AdoptionAnswers>(raw_answers)
        {
            crate::engine::adoption_answers::substitute_variables(&mut agent_ir, &answers);
            crate::engine::adoption_answers::inject_configuration_section(&mut agent_ir, &answers);
            crate::engine::adoption_answers::apply_credential_bindings_to_connectors(
                &mut agent_ir,
                &answers,
            );
        }
    }
    match crate::engine::build_session::run_tool_tests(
        &state.pool,
        &state.app,
        &session_id,
        &body.persona_id,
        &agent_ir,
    )
    .await
    {
        Ok(report) => ok_json(serde_json::json!({"report": report})).into_response(),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
struct BuildPromoteBody {
    persona_id: String,
    #[serde(default)]
    excluded_use_case_ids: Option<Vec<String>>,
}

async fn build_promote(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(session_id): Path<String>,
    Json(body): Json<BuildPromoteBody>,
) -> impl IntoResponse {
    let app_state: tauri::State<'_, Arc<crate::AppState>> = match state.app.try_state() {
        Some(s) => s,
        None => {
            return err_json(StatusCode::INTERNAL_SERVER_ERROR, "App state not available")
                .into_response();
        }
    };
    match crate::commands::design::build_sessions::promote_build_draft_inner(
        &app_state,
        session_id,
        body.persona_id,
        body.excluded_use_case_ids.unwrap_or_default(),
    )
    .await
    {
        Ok(value) => ok_json(value).into_response(),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

async fn build_cancel(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(session_id): Path<String>,
) -> impl IntoResponse {
    let app_state: tauri::State<'_, Arc<crate::AppState>> = match state.app.try_state() {
        Some(s) => s,
        None => {
            return err_json(StatusCode::INTERNAL_SERVER_ERROR, "App state not available")
                .into_response();
        }
    };
    match app_state.build_session_manager.cancel_session(
        &session_id,
        &state.pool,
        &state.process_registry,
    ) {
        Ok(_) => ok_json(serde_json::json!({"status": "cancelled"})).into_response(),
        Err(e) => err_json(StatusCode::BAD_REQUEST, &e.to_string()).into_response(),
    }
}

// =============================================================================
// KP bridge endpoints (WP3, intake only) — the external KP hiring app posts a
// "persona hire request"; a pending `companion_approval` row (action
// `kp_hire_request`) lands in the companion approval inbox, and the human's
// Approve there creates the draft persona + headless build session (see
// `commands::companion::approvals::approval_exec_core::execute_kp_hire_request`).
// This surface never creates a persona directly.
// =============================================================================

/// Where the request came from — the KP app instance + job.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KpRequestOrigin {
    base_url: String,
    job_id: String,
    job_title: String,
    #[serde(default)]
    workspace: Option<String>,
    /// The kp intake session the hire came from. An App-master hire composed in
    /// the intake dialog has NO job — kp sends `jobId: ""` with this as the
    /// walk-back handle (P4-kp, 2026-08-23), so validation accepts either.
    #[serde(default)]
    intake_id: Option<String>,
}

/// One success metric KP attaches to the hire ("time-to-fill < 14 days").
/// `target` stays a raw JSON value — KP sends numbers for count metrics and
/// strings for banded ones; both are recorded verbatim for the WP4 reporter.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KpSuccessMetric {
    key: String,
    label: String,
    #[serde(default)]
    target: serde_json::Value,
    #[serde(default)]
    unit: Option<String>,
    #[serde(default)]
    direction: Option<String>,
}

/// The requested persona spec, as drafted by the KP app.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KpPersonaSpec {
    name: String,
    mission: String,
    #[serde(default)]
    system_prompt_draft: Option<String>,
    #[serde(default)]
    connectors: Vec<String>,
    #[serde(default)]
    max_budget_usd: Option<f64>,
    #[serde(default)]
    max_turns: Option<i64>,
    #[serde(default)]
    success_metrics: Vec<KpSuccessMetric>,
}

// --- App master (P4) -------------------------------------------------------
//
// kp's `AppMasterSpec` (pipeline/jobfit/appmaster.py, projected to Zod as
// `appMasterSpecSchema`). Mirrored here as a serde struct rather than parsed
// out of a `serde_json::Value` at use time so the shape is checked ONCE, at
// intake, before anything is written — the payload then sits in the approval
// inbox until a human clicks, and the executor re-reads it from the DB.
//
// Every field is `#[serde(default)]`: kp's own coercer already defaults the
// whole shape, and an intake that 400s on a missing optional would refuse
// hires kp considers valid. Unknown fields are ignored by serde, which is
// deliberate — kp owns this schema and may add to it; a strict `deny_unknown`
// here would turn every kp-side addition into a Personas outage.
//
// The strictness that DOES live here is the part Personas has to enforce
// later: the rung must be grantable and the forbidden classes must be in the
// closed vocabulary. Storing a rung of 3 or a class this build cannot detect
// would produce a mandate that *looks* enforced and is not.

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KpAmRepo {
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    root_path: Option<String>,
    #[serde(default = "kp_default_main_branch")]
    main_branch: String,
}

fn kp_default_main_branch() -> String {
    "main".to_string()
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KpAmApp {
    #[serde(default)]
    name: String,
    #[serde(default)]
    repo: KpAmRepo,
    #[serde(default)]
    context_map_ref: Option<String>,
    #[serde(default)]
    dossier_id: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KpAmObjective {
    #[serde(default)]
    kpi_key: String,
    #[serde(default)]
    label: String,
    /// Nullable on purpose: an objective nobody has measured is a real state,
    /// and a 0 here would invent a baseline. Carried through to the seeded KPI
    /// as NULL, never as zero.
    #[serde(default)]
    baseline: Option<f64>,
    #[serde(default)]
    target: Option<f64>,
    #[serde(default)]
    unit: String,
    #[serde(default = "kp_default_direction")]
    direction: String,
    #[serde(default = "kp_default_window_days")]
    window_days: i64,
}

fn kp_default_direction() -> String {
    "gte".to_string()
}

fn kp_default_window_days() -> i64 {
    30
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KpAmMandate {
    #[serde(default)]
    scope_rung: u8,
    #[serde(default)]
    forbidden_classes: Vec<String>,
    #[serde(default)]
    approval_gates: Vec<String>,
    #[serde(default)]
    owner: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KpAmTrigger {
    #[serde(default)]
    kind: String,
    #[serde(default)]
    config: serde_json::Value,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KpAmCadence {
    #[serde(default)]
    triggers: Vec<KpAmTrigger>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KpAmTenure {
    #[serde(default = "kp_default_probation_days")]
    probation_days: i64,
    #[serde(default = "kp_default_probation_days")]
    review_cadence_days: i64,
    #[serde(default)]
    retire_criteria: Vec<String>,
}

fn kp_default_probation_days() -> i64 {
    30
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KpAppMasterSpec {
    #[serde(default)]
    app: KpAmApp,
    #[serde(default)]
    objectives: Vec<KpAmObjective>,
    #[serde(default)]
    mandate: KpAmMandate,
    #[serde(default)]
    cadence: KpAmCadence,
    #[serde(default)]
    tenure: KpAmTenure,
}

/// Bounds. Generous (a paired localhost bridge), but bounded — a buggy kp
/// client must not be able to park an unbounded blob in the approval inbox or
/// seed a thousand KPIs on approval.
const KP_MAX_OBJECTIVES: usize = 16;
const KP_MAX_TRIGGERS: usize = 16;
const KP_MAX_APPROVAL_GATES: usize = 32;
const KP_MAX_RETIRE_CRITERIA: usize = 32;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KpPersonaRequestBody {
    kp: KpRequestOrigin,
    spec: KpPersonaSpec,
    report_token: String,
    /// Present ⇒ this is an **App master** hire (P4). Additive: the old flat
    /// shape keeps working unchanged, and a request without this block takes
    /// exactly the path it took before.
    #[serde(default)]
    app_master: Option<KpAppMasterSpec>,
}

const KP_MAX_CONNECTORS: usize = 32;
const KP_MAX_METRICS: usize = 32;

/// Validate an intake body. Pure — unit-tested below. Limits are deliberately
/// generous (this is a paired localhost bridge, not a public API) but bounded,
/// so a buggy KP client cannot park megabytes in the approval inbox.
fn validate_kp_persona_request(body: &KpPersonaRequestBody) -> Result<(), String> {
    fn req(field: &str, v: &str, max: usize) -> Result<(), String> {
        let t = v.trim();
        if t.is_empty() {
            return Err(format!("`{field}` must not be empty"));
        }
        if t.chars().count() > max {
            return Err(format!("`{field}` exceeds {max} characters"));
        }
        Ok(())
    }
    fn opt(field: &str, v: Option<&str>, max: usize) -> Result<(), String> {
        match v {
            Some(s) if s.chars().count() > max => {
                Err(format!("`{field}` exceeds {max} characters"))
            }
            _ => Ok(()),
        }
    }

    let base = body.kp.base_url.trim();
    if !(base.starts_with("http://") || base.starts_with("https://")) {
        return Err("`kp.baseUrl` must be an http(s) URL".into());
    }
    if base.chars().count() > 500 || base.chars().any(char::is_whitespace) {
        return Err("`kp.baseUrl` is not a sane URL".into());
    }
    // An App-master hire from the kp intake dialog carries no job: kp sends
    // `jobId: ""` + `intakeId` (its P4 sentinel). Refusing the empty jobId here
    // failed every intake-originated dispatch on first live contact
    // (bench sweep #4, 2026-08-24). One of the two handles must be present.
    let intake_handle = body.kp.intake_id.as_deref().map(str::trim).unwrap_or("");
    if body.kp.job_id.trim().is_empty() {
        if body.app_master.is_none() || intake_handle.is_empty() {
            return Err("`kp.jobId` must not be empty (or send `appMaster` + `kp.intakeId` for an intake-originated hire)".into());
        }
        if intake_handle.chars().count() > 128 {
            return Err("`kp.intakeId` exceeds 128 characters".into());
        }
    } else {
        req("kp.jobId", &body.kp.job_id, 128)?;
    }
    req("kp.jobTitle", &body.kp.job_title, 300)?;
    opt("kp.workspace", body.kp.workspace.as_deref(), 200)?;
    req("reportToken", &body.report_token, 500)?;

    req("spec.name", &body.spec.name, 120)?;
    req("spec.mission", &body.spec.mission, 4000)?;
    opt(
        "spec.systemPromptDraft",
        body.spec.system_prompt_draft.as_deref(),
        20_000,
    )?;
    if body.spec.connectors.len() > KP_MAX_CONNECTORS {
        return Err(format!(
            "`spec.connectors` exceeds {KP_MAX_CONNECTORS} entries"
        ));
    }
    for c in &body.spec.connectors {
        req("spec.connectors[]", c, 64)?;
    }
    if let Some(b) = body.spec.max_budget_usd {
        if !b.is_finite() || b < 0.0 {
            return Err("`spec.maxBudgetUsd` must be a finite number >= 0".into());
        }
    }
    if let Some(t) = body.spec.max_turns {
        if !(1..=100_000).contains(&t) {
            return Err("`spec.maxTurns` must be between 1 and 100000".into());
        }
    }
    if body.spec.success_metrics.len() > KP_MAX_METRICS {
        return Err(format!(
            "`spec.successMetrics` exceeds {KP_MAX_METRICS} entries"
        ));
    }
    for m in &body.spec.success_metrics {
        req("spec.successMetrics[].key", &m.key, 120)?;
        req("spec.successMetrics[].label", &m.label, 300)?;
        opt("spec.successMetrics[].unit", m.unit.as_deref(), 60)?;
        opt(
            "spec.successMetrics[].direction",
            m.direction.as_deref(),
            30,
        )?;
    }
    if let Some(am) = &body.app_master {
        validate_kp_app_master(am)?;
    }
    Ok(())
}

/// Validate the `appMaster` block. Pure — unit-tested below.
///
/// Two of these checks are the whole reason this function exists rather than a
/// `serde` derive:
///
/// - **`mandate.scopeRung` must be 0..=2.** Rungs 3 (deploy/merge) and 4
///   (change gates) are not grantable to any holder in v1. Refusing at intake
///   is the difference between "the mandate cannot say that" and "the mandate
///   says it and the enforcement layer is expected to remember to ignore it".
/// - **`mandate.forbiddenClasses` must be in the closed vocabulary.** A class
///   this build cannot detect is a class this build cannot block. Accepting it
///   would store a mandate that reads stricter than it is enforced.
fn validate_kp_app_master(am: &KpAppMasterSpec) -> Result<(), String> {
    let repo = &am.app.repo;
    let has_url = repo
        .url
        .as_deref()
        .map(str::trim)
        .is_some_and(|s| !s.is_empty());
    let has_path = repo
        .root_path
        .as_deref()
        .map(str::trim)
        .is_some_and(|s| !s.is_empty());
    if !has_url && !has_path {
        return Err(
            "`appMaster.app.repo` must carry a `url` or a `rootPath` — an App master \
             is accountable for ONE application and the binding is what makes that true"
                .into(),
        );
    }
    if let Some(u) = repo.url.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if !(u.starts_with("http://") || u.starts_with("https://")) {
            return Err("`appMaster.app.repo.url` must be an http(s) URL".into());
        }
        if u.chars().count() > 500 || u.chars().any(char::is_whitespace) {
            return Err("`appMaster.app.repo.url` is not a sane URL".into());
        }
    }
    if let Some(p) = repo
        .root_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if p.chars().count() > 1000 {
            return Err("`appMaster.app.repo.rootPath` exceeds 1000 characters".into());
        }
    }
    if repo.main_branch.trim().is_empty() || repo.main_branch.chars().count() > 200 {
        return Err("`appMaster.app.repo.mainBranch` must be 1..200 characters".into());
    }
    if am.app.name.chars().count() > 200 {
        return Err("`appMaster.app.name` exceeds 200 characters".into());
    }

    // -- mandate: the two checks that carry the enforcement contract ---------
    if !(0..=personas_engine::app_master::MAX_GRANTABLE_RUNG).contains(&am.mandate.scope_rung) {
        return Err(format!(
            "`appMaster.mandate.scopeRung` must be 0 (read), 1 (retry) or 2 (open branch/PR); \
             got {}. Rung 3 (deploy/merge) and rung 4 (change gates) are never granted in v1.",
            am.mandate.scope_rung
        ));
    }
    for c in &am.mandate.forbidden_classes {
        if personas_engine::app_master::ForbiddenClass::parse(c).is_none() {
            return Err(format!(
                "`appMaster.mandate.forbiddenClasses` contains `{c}`, which is not in the closed \
                 vocabulary (test_deletion_or_skip, suppression_directive, gate_configuration, \
                 dependency_bump_to_satisfy_check, credentials_or_permissions, \
                 delivery_configuration). A class this build cannot detect is a class it cannot block."
            ));
        }
    }
    if am.mandate.approval_gates.len() > KP_MAX_APPROVAL_GATES {
        return Err(format!(
            "`appMaster.mandate.approvalGates` exceeds {KP_MAX_APPROVAL_GATES} entries"
        ));
    }
    for g in &am.mandate.approval_gates {
        if g.trim().is_empty() || g.chars().count() > 500 {
            return Err("`appMaster.mandate.approvalGates[]` must be 1..500 characters".into());
        }
    }
    if am.mandate.owner.chars().count() > 200 {
        return Err("`appMaster.mandate.owner` exceeds 200 characters".into());
    }

    // -- objectives ----------------------------------------------------------
    if am.objectives.len() > KP_MAX_OBJECTIVES {
        return Err(format!(
            "`appMaster.objectives` exceeds {KP_MAX_OBJECTIVES} entries"
        ));
    }
    for o in &am.objectives {
        if o.kpi_key.trim().is_empty() {
            return Err("`appMaster.objectives[].kpiKey` must not be empty".into());
        }
        if o.kpi_key.chars().count() > 120 || o.label.chars().count() > 300 {
            return Err("`appMaster.objectives[]` key/label exceeds its length bound".into());
        }
        if !matches!(o.direction.as_str(), "gte" | "lte") {
            return Err(format!(
                "`appMaster.objectives[].direction` must be `gte` or `lte`, got {:?}",
                o.direction
            ));
        }
        if !(1..=3650).contains(&o.window_days) {
            return Err("`appMaster.objectives[].windowDays` must be between 1 and 3650".into());
        }
        for (what, v) in [("baseline", o.baseline), ("target", o.target)] {
            if v.is_some_and(|n| !n.is_finite()) {
                return Err(format!(
                    "`appMaster.objectives[].{what}` must be a finite number or null"
                ));
            }
        }
        if o.unit.chars().count() > 60 {
            return Err("`appMaster.objectives[].unit` exceeds 60 characters".into());
        }
    }

    // -- cadence -------------------------------------------------------------
    if am.cadence.triggers.len() > KP_MAX_TRIGGERS {
        return Err(format!(
            "`appMaster.cadence.triggers` exceeds {KP_MAX_TRIGGERS} entries"
        ));
    }
    for t in &am.cadence.triggers {
        // The kinds are kp's closed vocabulary. An unknown kind is refused
        // rather than dropped: a cadence silently missing a trigger reads, from
        // kp, as a cadence that was installed.
        if !matches!(t.kind.as_str(), "schedule" | "pr" | "kpi_tick") {
            return Err(format!(
                "`appMaster.cadence.triggers[].kind` must be `schedule`, `pr` or `kpi_tick`, got {:?}",
                t.kind
            ));
        }
    }

    // -- tenure --------------------------------------------------------------
    if !(1..=3650).contains(&am.tenure.probation_days) {
        return Err("`appMaster.tenure.probationDays` must be between 1 and 3650".into());
    }
    if !(1..=3650).contains(&am.tenure.review_cadence_days) {
        return Err("`appMaster.tenure.reviewCadenceDays` must be between 1 and 3650".into());
    }
    if am.tenure.retire_criteria.len() > KP_MAX_RETIRE_CRITERIA {
        return Err(format!(
            "`appMaster.tenure.retireCriteria` exceeds {KP_MAX_RETIRE_CRITERIA} entries"
        ));
    }
    for c in &am.tenure.retire_criteria {
        if c.chars().count() > 500 {
            return Err("`appMaster.tenure.retireCriteria[]` exceeds 500 characters".into());
        }
    }
    Ok(())
}

/// One-line rationale for the approval card — this is the sentence the human
/// reads before deciding, so it names the job, the hire, and the budget.
fn kp_hire_rationale(body: &KpPersonaRequestBody) -> String {
    let budget = match body.spec.max_budget_usd {
        Some(b) => format!(", budget ${b:.0}/mo"),
        None => String::new(),
    };
    // An App master hire binds a repository, seeds KPIs and installs a
    // mandate. The human is agreeing to more than "make a persona", so the
    // card says which app, how far the mandate reaches, and for how long.
    if let Some(am) = &body.app_master {
        let app = if am.app.name.trim().is_empty() {
            am.app
                .repo
                .url
                .as_deref()
                .or(am.app.repo.root_path.as_deref())
                .unwrap_or("an unnamed app")
        } else {
            am.app.name.trim()
        };
        return format!(
            "KP job '{}' requests an APP MASTER for {app}: {} — mandate rung {} ({}), \
             {} objective(s), {}-day probation on `suggest` autopilot{}",
            body.kp.job_title.trim(),
            body.spec.name.trim(),
            am.mandate.scope_rung,
            personas_engine::app_master::rung_label(am.mandate.scope_rung),
            am.objectives.len(),
            am.tenure.probation_days,
            budget
        );
    }
    format!(
        "KP job '{}' requests an AI hire: {} — {} connector(s){}",
        body.kp.job_title.trim(),
        body.spec.name.trim(),
        body.spec.connectors.len(),
        budget
    )
}

/// Insert the pending `companion_approval` row. Payload shape mirrors
/// `dispatcher::insert_approval` / `backlog_triage::insert_triage_approval`
/// exactly (`{action, params, rationale}` under kind `op_execute`), so
/// `companion_list_pending_approvals` and `companion_approve_action` read it
/// without a special case. Takes the pool directly so tests need no AppHandle.
pub(crate) fn insert_kp_hire_approval(
    user_db: &crate::db::UserDbPool,
    request_id: &str,
    params: &serde_json::Value,
    rationale: &str,
) -> Result<(), AppError> {
    let payload = serde_json::json!({
        "action": "kp_hire_request",
        "params": params,
        "rationale": rationale,
    })
    .to_string();
    let conn = user_db.get()?;
    conn.execute(
        "INSERT INTO companion_approval (id, session_id, kind, payload, status, human_review_id, created_at)
         VALUES (?1, ?2, 'op_execute', ?3, 'pending', NULL, datetime('now'))",
        rusqlite::params![
            request_id,
            crate::companion::session::DEFAULT_SESSION_ID,
            payload
        ],
    )?;
    Ok(())
}

/// `POST /api/kp/persona-requests` — queue a hire request for human approval.
async fn kp_create_persona_request(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Json(raw_body): Json<serde_json::Value>,
) -> Response {
    // Deserialize the TYPED body from the raw JSON instead of letting axum do
    // it, because the approval payload must persist the RAW request: kp owns
    // the AppMasterSpec schema and ships fields this struct does not model
    // (budget, role, agent, human, …). Serializing the typed struct back into
    // the payload silently DROPPED all of them — the first enforced-budget
    // night (2026-08-25) read `budget: null` off the stored payload while kp
    // had sent `budget.monthlyUsd: 5`, so the mandate ceiling was never
    // persisted. Validation stays typed; storage stays verbatim.
    let body: KpPersonaRequestBody = match serde_json::from_value(raw_body.clone()) {
        Ok(b) => b,
        Err(e) => {
            return err_json(StatusCode::BAD_REQUEST, &format!("malformed body: {e}"))
                .into_response();
        }
    };
    if let Err(msg) = validate_kp_persona_request(&body) {
        return err_json(StatusCode::BAD_REQUEST, &msg).into_response();
    }
    let app_state: tauri::State<'_, Arc<crate::AppState>> = match state.app.try_state() {
        Some(s) => s,
        None => {
            return err_json(StatusCode::INTERNAL_SERVER_ERROR, "App state not available")
                .into_response();
        }
    };
    let request_id = format!("appr_{}", crate::companion::util::short_id(12));
    // Params = the full validated request body PLUS the approval row's own id
    // (`requestId`) so the approval executor can stamp the created persona /
    // build session back onto this row for the status GET below.
    // The RAW body (see above) — every field kp sent, modeled here or not.
    let mut params = raw_body;
    params["requestId"] = serde_json::Value::String(request_id.clone());
    if let Err(e) = insert_kp_hire_approval(
        &app_state.user_db,
        &request_id,
        &params,
        &kp_hire_rationale(&body),
    ) {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response();
    }

    // Headless bridge (§13): execute the hire NOW, through the same executor
    // the human click reaches, recording `headless_bridge` as the actor. The
    // response reports the real outcome instead of `pending_approval` — a
    // driver that was told "pending" and polled for a decision nobody was
    // going to take would hang forever. `GET /api/kp/persona-requests/{id}`
    // still answers, so a client that polls anyway sees the same fate.
    if personas_engine::headless::enabled() {
        let app = state.app.clone();
        // `app_state` borrows the AppHandle; drop it before the await so the
        // non-Send `tauri::State` guard does not cross a suspension point.
        //
        // INVARIANT: this `drop` is load-bearing and `clippy::drop_non_drop` is
        // wrong about it. The lint fires because `tauri::State` has no `Drop`
        // impl, and its advice ("dropping only extends contained lifetimes")
        // is about destructors — but what this call actually does is MOVE the
        // value out of scope, which removes it from the set the async block
        // holds across the `.await` below. axum requires a `Send` future and
        // `tauri::State` is not `Send`, so removing this line does not tidy
        // anything: it stops the handler compiling.
        #[allow(clippy::drop_non_drop)]
        drop(app_state);
        return match crate::commands::companion::approvals::auto_execute_kp_hire(&app, &request_id)
            .await
        {
            Ok(outcome) => ok_json(serde_json::json!({
                "requestId": request_id,
                // `approved_failed` is reported as `failed`, exactly as the
                // status GET maps it — a hire the executor could not finish is
                // not a hire the operator turned down.
                "status": if outcome.status == "approved" { "approved" } else { "failed" },
                "autoApproved": true,
                "actor": personas_engine::headless::ACTOR,
                "message": outcome.message,
            }))
            .into_response(),
            Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
        };
    }

    ok_json(serde_json::json!({
        "requestId": request_id,
        "status": "pending_approval",
    }))
    .into_response()
}

/// `GET /api/kp/persona-requests/{id}` — poll a hire request's fate.
async fn kp_get_persona_request(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(id): Path<String>,
) -> Response {
    use rusqlite::OptionalExtension;
    let app_state: tauri::State<'_, Arc<crate::AppState>> = match state.app.try_state() {
        Some(s) => s,
        None => {
            return err_json(StatusCode::INTERNAL_SERVER_ERROR, "App state not available")
                .into_response();
        }
    };
    let conn = match app_state.user_db.get() {
        Ok(c) => c,
        Err(e) => {
            return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response()
        }
    };
    // Freshness window matches the approvals module's consent window: a hire
    // request still pending past it can no longer be acted on → "expired".
    let row: Option<(String, String, bool)> = match conn
        .query_row(
            "SELECT status, payload, created_at >= datetime('now', '-24 hours')
             FROM companion_approval WHERE id = ?1",
            rusqlite::params![id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)? != 0,
                ))
            },
        )
        .optional()
    {
        Ok(r) => r,
        Err(e) => {
            return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response()
        }
    };
    let Some((db_status, payload, fresh)) = row else {
        return err_json(StatusCode::NOT_FOUND, "persona request not found").into_response();
    };
    let payload: serde_json::Value = serde_json::from_str(&payload).unwrap_or_default();
    // This GET is reachable by any valid key — refuse to leak the state of
    // approval rows that are not KP hire requests.
    if payload.get("action").and_then(|a| a.as_str()) != Some("kp_hire_request") {
        return err_json(StatusCode::NOT_FOUND, "persona request not found").into_response();
    }
    let status = match (db_status.as_str(), fresh) {
        ("pending", false) => "expired",
        // `running` = the human clicked Approve and the executor is in flight.
        ("pending", true) | ("running", _) => "pending",
        ("approved", _) => "approved",
        // Approved by the human but the executor failed — surfaced distinctly
        // so KP does not tell the recruiter the request was turned down.
        ("approved_failed", _) => "failed",
        ("rejected", _) => "rejected",
        (other, _) => other,
    };
    // Stamped by the approval executor on success (see `execute_kp_hire_request`).
    let result = payload.get("result").cloned().unwrap_or_default();
    let persona_id = result.get("personaId").and_then(|v| v.as_str());
    let persona_name = result.get("personaName").and_then(|v| v.as_str());
    let build_session = result
        .get("buildSessionId")
        .and_then(|v| v.as_str())
        .and_then(|sid| {
            crate::db::repos::core::build_sessions::get_by_id(&state.pool, sid)
                .ok()
                .flatten()
        });
    let build_phase = build_session.as_ref().map(|s| s.phase.as_str().to_string());
    // Why a build died, not just that it did. The runner stamps `error_message`
    // on every terminal failure — including the unattended stall guard's
    // `design_pass_stalled: N turns without resolution` (see
    // `personas_engine::build_stall`). Without it kp's bench driver sees only
    // `buildPhase: "failed"` and has to go read the desktop app's log to learn
    // whether it hit a stall, a validation refusal or a dead CLI.
    let build_failure_reason = build_session
        .as_ref()
        .filter(|s| s.phase == crate::db::models::BuildPhase::Failed)
        .and_then(|s| s.error_message.clone());
    // A build that DIED after a successful approval must not read `approved`
    // forever — kp (and the bench driver) poll this status and would wait out
    // their whole activate window on a hire that can no longer arrive. The
    // first live sweep hit exactly that: promotion held → buildPhase `failed`,
    // wire status still `approved`, 20-minute timeout instead of a fast fail.
    let status = if status == "approved" && build_phase.as_deref() == Some("failed") {
        "failed"
    } else if status == "approved" && build_phase.as_deref() == Some("promoted") {
        // Promote flips the persona's lifecycle to `active` and fires a
        // best-effort `activated` push — which is fire-and-forget and CAN be
        // lost (first live sweep: the spawned task vanished and the hire sat
        // `onboarding` forever on the kp side). The status poll is the pull
        // fallback, so it must state the truth on its own: promoted = active.
        "active"
    } else {
        status
    };
    ok_json(serde_json::json!({
        "requestId": id,
        "status": status,
        "personaId": persona_id,
        "personaName": persona_name,
        "buildPhase": build_phase,
        "buildFailureReason": build_failure_reason,
    }))
    .into_response()
}

/// Static catalog entries derived from the compiled-in builtin connector
/// definitions — authoritative (the DB seed is generated FROM this constant)
/// and free of any DB read. Descriptions come from metadata `summary`,
/// trimmed so the whole catalog stays a lightweight picker payload.
fn builtin_connector_catalog() -> Vec<serde_json::Value> {
    const MAX_DESCRIPTION_CHARS: usize = 200;
    crate::db::builtin_connectors::BUILTIN_CONNECTORS
        .iter()
        .map(|c| {
            let mut description = c
                .metadata
                .and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok())
                .and_then(|v| {
                    v.get("summary")
                        .and_then(|s| s.as_str())
                        .map(|s| s.trim().to_string())
                })
                .unwrap_or_default();
            if description.chars().count() > MAX_DESCRIPTION_CHARS {
                description = description.chars().take(MAX_DESCRIPTION_CHARS).collect();
                description.push('…');
            }
            serde_json::json!({
                "key": c.name,
                "name": c.label,
                "description": description,
            })
        })
        .collect()
}

/// `GET /api/kp/connector-catalog` — what the KP app's hire form can offer.
async fn kp_connector_catalog() -> Response {
    ok_json(builtin_connector_catalog()).into_response()
}

// =============================================================================
// Headless bridge test tick (§13) — the on-demand "night"
// =============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KpTestTickBody {
    /// Scope the overnight + reconcile phases to one project. Absent ⇒ every
    /// project the autopilot mode makes eligible / every mandated project.
    #[serde(default)]
    project_id: Option<String>,
    /// Scope the report phase to one persona. Absent ⇒ every kp-linked persona.
    #[serde(default)]
    persona_id: Option<String>,
    /// Absent ⇒ all four, in [`TICK_PHASES`] order.
    #[serde(default)]
    phases: Option<Vec<String>>,
    /// Headless bench only: treat every undecided App-master mandate as DUE in
    /// the probation phase, so a test exercises the decision without waiting
    /// out `probationDays`. Ignored by every other phase.
    #[serde(default)]
    force_probation: bool,
    /// **AUTHOR before triaging** (§13.13). With an `overnight` phase, run the
    /// idea scanner for `projectId` first, so a compressed night can produce the
    /// proposals it then reports instead of only re-triaging the deck it
    /// inherited. Ignored by every other phase.
    ///
    /// Authoring normally lives in the `idea_replenish` subscription, on a 900s
    /// timer behind a 20h per-project cooldown — pacing rules for an unattended
    /// loop that a compressed night can never reach. The tick bypasses those;
    /// it does **not** bypass the quota cooldown (see
    /// `headless::IDEATION_QUOTA_BLOCKED`).
    #[serde(default)]
    ideate: bool,
    /// **Run this night at this autopilot mode instead of the project's stored
    /// one** — `off | measure | suggest | full`, for THIS TICK ONLY; the stored
    /// mode is read and never written.
    ///
    /// A project on `full` dispatches every accepted idea as a fleet session,
    /// which is the wrong night for a bench whose product is a proposal list.
    /// `suggest` triages and stops, leaving the accepted ideas for the morning
    /// — and the `blockedReason` that says so. An unknown word is a 400, never
    /// a silent fallback to the stored mode.
    #[serde(default)]
    autopilot: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KpTestPhaseResult {
    phase: &'static str,
    /// False ⇒ the phase was in the request but could not run at all; `skipped`
    /// says why. A phase that ran and found nothing to do is `ran: true` with
    /// zero counts — "nothing happened" and "nothing was attempted" are
    /// different findings.
    ran: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    skipped: Option<String>,
    duration_ms: u128,
    /// Phase-specific counts. Shapes are documented per phase in §13.
    #[serde(skip_serializing_if = "Option::is_none")]
    counts: Option<serde_json::Value>,
    /// Per-item detail (night runs, probation decisions). Empty when there is
    /// nothing to itemise.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    details: Vec<serde_json::Value>,
    /// **`overnight` only** — the ideas the night left on the table
    /// (§13.12). Always present on an overnight phase, `[]` included: "the
    /// night produced nothing" is a finding, and a missing key is not. `None`
    /// (absent) on every other phase, which has no backlog to report.
    ///
    /// Additive: `counts`, `details` and `errors` are untouched, because a
    /// driver already deep-scans them.
    #[serde(skip_serializing_if = "Option::is_none")]
    proposals: Option<Vec<personas_engine::headless::NightProposal>>,
    /// **`overnight` only** — the decline log, same rules as `proposals`.
    #[serde(skip_serializing_if = "Option::is_none")]
    declines: Option<Vec<personas_engine::headless::NightDecline>>,
    /// **`overnight` only, and only when the tick asked to `ideate`** (§13.13).
    /// Absent otherwise — the same rule the two lists follow: a night that was
    /// never asked to author must not report a zero for it.
    #[serde(skip_serializing_if = "Option::is_none")]
    ideation: Option<personas_engine::headless::Ideation>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    errors: Vec<String>,
}

/// `POST /api/kp/test/tick` — run one compressed "night" synchronously.
///
/// Exists only while `PERSONAS_HEADLESS_BRIDGE=1` (the route is not added
/// otherwise) and demands the `personas:test` scope. It **reuses** the four
/// existing tick bodies rather than reimplementing them, so a compressed night
/// is the same night: `run_overnight_now_core` (the body of
/// `dev_tools_run_overnight_now`, autopilot gate + App master mandate + budget
/// governor + slot cap intact), `reconcile_tick_summary`, `kp_rollup_tick_summary`
/// and `probation_tick_summary` + the headless decision sweep.
///
/// Synchronous by design: a driver that compresses a night into one call needs
/// the call to *mean* the night is over.
///
/// Two fields let a caller ask for an **ideation night** — a night that
/// proposes and dispatches nothing (§13.13). `ideate` authors before triaging,
/// through the same scanner entry the `idea_replenish` subscription uses;
/// `autopilot` runs the night at a mode this tick names instead of the project's
/// stored one, without writing it back. Both are additive: a tick that sends
/// neither gets exactly the night it got before.
async fn kp_test_tick(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Json(body): Json<KpTestTickBody>,
) -> Response {
    // Second gate. The route only exists while the mode is on, but a stale
    // router is not a thing this handler is willing to assume.
    if !personas_engine::headless::enabled() {
        return err_json(StatusCode::NOT_FOUND, "not found").into_response();
    }

    // The phase vocabulary, the dependency ordering and the refusal of an
    // unknown name all live in `personas_engine::headless` — one spelling,
    // and the one place they can be unit-tested on this machine.
    let requested = match personas_engine::headless::select_tick_phases(body.phases.as_deref()) {
        Ok(phases) => phases,
        Err(unknown) => {
            return err_json(
                StatusCode::BAD_REQUEST,
                &format!(
                    "unknown phase(s): {}. Known phases: {}",
                    unknown.join(", "),
                    personas_engine::headless::TICK_PHASES.join(", ")
                ),
            )
            .into_response();
        }
    };

    // The autopilot override, resolved BEFORE any phase runs (§13.13). A word
    // this vocabulary does not know is a 400 and no night at all — silently
    // running the project's stored mode instead would hand a driver that asked
    // for a quiet `suggest` night a full dispatching one, under a 200.
    let mode_override =
        match personas_engine::headless::select_autopilot_override(body.autopilot.as_deref()) {
            Ok(mode) => mode,
            Err(unknown) => {
                return err_json(
                    StatusCode::BAD_REQUEST,
                    &format!(
                        "unknown autopilot mode: {unknown}. Known modes: {}",
                        personas_engine::headless::AUTOPILOT_MODES.join(", ")
                    ),
                )
                .into_response();
            }
        };

    let started = chrono::Utc::now();
    let pool = state.pool.clone();
    let app = state.app.clone();
    let mut results: Vec<KpTestPhaseResult> = Vec::new();

    for phase in requested {
        let t0 = std::time::Instant::now();
        let result = match phase {
            "overnight" => {
                tick_phase_overnight(
                    &pool,
                    &app,
                    body.project_id.as_deref(),
                    body.ideate,
                    mode_override,
                )
                .await
            }
            "reconcile" => {
                // The driver scopes by persona; reconcile is project-keyed.
                // Resolve the persona's mandate project so a scoped tick never
                // reconciles every mandated project (sweep #25: `projects: 4`
                // and 16 stale branches "accounted" a dispatch in 3 minutes
                // while the worker was still authoring).
                let scoped_project: Option<String> = body.project_id.clone().or_else(|| {
                    body.persona_id.as_deref().and_then(|pid| {
                        personas_engine::app_master::load_mandates(&pool)
                            .into_iter()
                            .find(|(_, r)| r.persona_id == pid)
                            .map(|(project_id, _)| project_id)
                    })
                });
                tick_phase_reconcile(&pool, scoped_project.as_deref()).await
            }
            "report" => tick_phase_report(&pool, body.persona_id.as_deref()).await,
            "probation" => tick_phase_probation(
                &pool,
                &app,
                body.force_probation,
                body.project_id.as_deref(),
                body.persona_id.as_deref(),
            ),
            _ => unreachable!("phase list is closed"),
        };
        results.push(KpTestPhaseResult {
            phase,
            duration_ms: t0.elapsed().as_millis(),
            ..result
        });
    }

    let finished = chrono::Utc::now();
    ok_json(serde_json::json!({
        "headlessBridge": true,
        "actor": personas_engine::headless::ACTOR,
        "startedAt": started.to_rfc3339(),
        "finishedAt": finished.to_rfc3339(),
        "durationMs": (finished - started).num_milliseconds(),
        "projectId": body.project_id,
        "personaId": body.persona_id,
        "phases": results,
    }))
    .into_response()
}

/// A phase result with the fields the loop fills in left at their defaults.
fn phase_stub() -> KpTestPhaseResult {
    KpTestPhaseResult {
        phase: "",
        ran: true,
        skipped: None,
        duration_ms: 0,
        counts: None,
        details: Vec::new(),
        // Only the overnight phase fills these; every other phase leaves them
        // absent rather than reporting an empty backlog it never looked at.
        proposals: None,
        declines: None,
        ideation: None,
        errors: Vec::new(),
    }
}

async fn tick_phase_overnight(
    pool: &crate::db::DbPool,
    app: &AppHandle,
    project_id: Option<&str>,
    ideate: bool,
    mode_override: Option<personas_engine::autopilot::AutopilotMode>,
) -> KpTestPhaseResult {
    use crate::commands::infrastructure::overnight;

    let projects: Vec<String> = match project_id {
        Some(id) => vec![id.to_string()],
        None => overnight::overnight_eligible_projects(pool),
    };
    let mut out = phase_stub();

    // AUTHOR FIRST (§13.13). Before the night triages, give it something of its
    // own to triage — otherwise a fresh tenure's first compressed night can only
    // re-rank the deck it inherited, and the proposal list it reports is the
    // previous operator's, not the holder's. Never fatal: a refused or broken
    // scan is a reading on `ideation`, and the night below runs regardless.
    if ideate {
        out.ideation = Some(run_tick_ideation(pool, app, project_id).await);
    }
    // Present from here on, `[]` included: an overnight phase that reports no
    // key at all is indistinguishable from one whose night produced nothing,
    // and telling those apart is the whole point of the two lists (§13.12).
    out.proposals = Some(Vec::new());
    out.declines = Some(Vec::new());
    if projects.is_empty() {
        out.counts = Some(serde_json::json!({ "projects": 0, "dispatched": 0, "blocked": 0 }));
        return out;
    }

    let (mut dispatched, mut blocked, mut degraded) = (0i64, 0i64, 0i64);
    for id in &projects {
        match overnight::run_overnight_now_core(pool, app, id, mode_override).await {
            Ok(run) => {
                dispatched += run.dispatched_count;
                if run.blocked_reason.is_some() {
                    blocked += 1;
                }
                if run.degraded {
                    degraded += 1;
                }
                out.details
                    .push(serde_json::to_value(&run).unwrap_or(serde_json::Value::Null));
            }
            // A refusal is a RESULT, not a transport failure: an autopilot mode
            // that does not grant ScanAndTriage, or a claim that could not be
            // taken. It belongs in `errors` where the driver can read it.
            Err(e) => out.errors.push(format!("{id}: {e}")),
        }
        // Read AFTER the night ran, per project, whether or not it dispatched:
        // a refusal ("mode suggest triages but does not dispatch") is exactly
        // the case where the proposals it left behind are the only reading
        // there is. Best-effort, and never fails the phase.
        let backlog = personas_engine::headless::night_backlog(pool, id);
        if let Some(proposals) = out.proposals.as_mut() {
            proposals.extend(backlog.proposals);
        }
        if let Some(declines) = out.declines.as_mut() {
            declines.extend(backlog.declines);
        }
    }
    out.counts = Some(serde_json::json!({
        "projects": projects.len(),
        "dispatched": dispatched,
        "blocked": blocked,
        "degraded": degraded,
    }));
    out
}

/// §13.13 — run the idea scanner for the tick's project, through the very entry
/// the `idea_replenish` subscription uses, and wait for it.
///
/// **The same path, minus the pacing.** The lens rotation is
/// `pick_replenish_lenses` (LRU over the project's `dev_scans` history) and the
/// entry is `idea_scanner::run_scan_core`, so the ideas this authors are the
/// ideas that loop would have authored — the backlog aging pass, the backlog
/// backpressure cap and the prompt's whole grounding block included. What is
/// deliberately NOT consulted: `find_replenish_candidate`'s 20h `dev_scans`
/// cooldown and its "fully idle project" picker, and the default-OFF
/// `autonomous_idea_scan` switch. Those exist to stop an unattended 900s loop
/// spending on its own initiative and to choose WHICH project it picks; a test
/// tick names its project and is the operator's initiative. **The quota
/// cooldown is honoured** — that one is a real spend limit, not a pacing rule.
///
/// It waits, because the whole point is that the same phase then triages and
/// reports what this authored: `run_scan_core` returns as soon as it has
/// spawned, so a tick that did not wait would report the deck it inherited and
/// call it the night's work.
async fn run_tick_ideation(
    pool: &crate::db::DbPool,
    app: &AppHandle,
    project_id: Option<&str>,
) -> personas_engine::headless::Ideation {
    use personas_engine::headless::{ideation_decision, Ideation, IdeationDecision};

    // The quota probe is a DB read; keep it off the async runtime's thread the
    // way every other caller does.
    let cooldown = {
        let pool = pool.clone();
        tokio::task::spawn_blocking(move || {
            crate::engine::subscription::quota_cooldown_active(&pool)
        })
        .await
        .unwrap_or(false)
    };
    let project_id = match ideation_decision(true, project_id.is_some(), cooldown) {
        IdeationDecision::Blocked(reason) => return Ideation::blocked(reason),
        // `run_tick_ideation` is only called when the tick asked, so this arm is
        // unreachable — answered rather than unwrapped, because an ideation
        // reading must never be the thing that panics a night.
        IdeationDecision::NotRequested => return Ideation::blocked("ideation was not requested"),
        IdeationDecision::Run => project_id.unwrap_or_default().to_string(),
    };

    let lenses = {
        let pool = pool.clone();
        let pid = project_id.clone();
        tokio::task::spawn_blocking(move || {
            crate::engine::subscription::pick_replenish_lenses(&pool, &pid)
        })
        .await
        .unwrap_or_default()
    };
    if lenses.is_empty() {
        return Ideation::blocked("no ideation lens could be picked for this project");
    }
    let lens = lenses.join(",");

    tracing::info!(
        project_id = %project_id,
        lenses = ?lenses,
        actor = personas_engine::headless::ACTOR,
        "headless tick: authoring before triage (20h scan cooldown bypassed by request)"
    );
    let launched = crate::commands::infrastructure::idea_scanner::run_scan_core(
        app.clone(),
        pool.clone(),
        project_id.clone(),
        lenses,
        None,
        None,
    )
    .await;
    let scan_id = match launched {
        // A refusal is a RESULT — the backlog cap, a missing project, an
        // unresolvable agent. Reported, never raised.
        Err(e) => return Ideation::unmeasured(lens, format!("scan launch refused: {e}")),
        Ok(v) => match v.get("scan_id").and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => return Ideation::unmeasured(lens, "scan launched without an id to wait on"),
        },
    };
    await_ideation_scan(pool, &scan_id, &lens).await
}

/// Poll the scan row until it stops running, or until the wait runs out.
///
/// The scan's own completion handler is what writes `status` and `idea_count`,
/// so the row is the honest place to read both from — and `idea_count` is the
/// scan's count, not this function's guess at one. A scan that ended `error` or
/// outran the wait reports `authored: null`: it may well have written rows
/// before it stopped, and claiming zero would be inventing a measurement.
async fn await_ideation_scan(
    pool: &crate::db::DbPool,
    scan_id: &str,
    lens: &str,
) -> personas_engine::headless::Ideation {
    use personas_engine::headless::Ideation;

    let deadline = std::time::Instant::now()
        + std::time::Duration::from_secs(personas_engine::headless::ideation_timeout_secs());
    loop {
        let scan = {
            let pool = pool.clone();
            let id = scan_id.to_string();
            tokio::task::spawn_blocking(move || {
                crate::db::repos::dev::scans::get_scan_by_id(&pool, &id)
            })
            .await
        };
        match scan {
            Ok(Ok(scan)) if scan.status != "running" => {
                return if scan.status == "complete" {
                    Ideation::authored(lens, scan.idea_count as i64)
                } else {
                    Ideation::unmeasured(
                        lens,
                        format!(
                            "scan {scan_id} ended `{}`: {}",
                            scan.status,
                            scan.error.as_deref().unwrap_or("no reason recorded")
                        ),
                    )
                };
            }
            // The row is gone or unreadable: the tick cannot wait on something
            // it cannot see, and pretending otherwise would burn the whole
            // timeout before saying so.
            Ok(Err(e)) => {
                return Ideation::unmeasured(lens, format!("scan {scan_id} unreadable: {e}"))
            }
            Err(e) => {
                return Ideation::unmeasured(lens, format!("scan {scan_id} wait failed: {e}"))
            }
            Ok(Ok(_)) => {}
        }
        if std::time::Instant::now() >= deadline {
            return Ideation::unmeasured(
                lens,
                format!(
                    "scan {scan_id} still running after {}s — the night ran without waiting further",
                    personas_engine::headless::ideation_timeout_secs()
                ),
            );
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}

async fn tick_phase_reconcile(
    pool: &crate::db::DbPool,
    project_id: Option<&str>,
) -> KpTestPhaseResult {
    let summary =
        crate::engine::app_master_reconcile::reconcile_tick_summary(pool, project_id).await;
    let mut out = phase_stub();
    out.errors = summary.errors.clone();
    out.counts = serde_json::to_value(&summary).ok();
    out
}

async fn tick_phase_report(
    pool: &crate::db::DbPool,
    persona_id: Option<&str>,
) -> KpTestPhaseResult {
    let summary = crate::engine::kp_reporter::kp_rollup_tick_summary(pool, persona_id).await;
    let mut out = phase_stub();
    out.errors = summary.errors.clone();
    out.counts = serde_json::to_value(&summary).ok();
    out
}

fn tick_phase_probation(
    pool: &crate::db::DbPool,
    app: &AppHandle,
    force_due: bool,
    scope_project: Option<&str>,
    scope_persona: Option<&str>,
) -> KpTestPhaseResult {
    use crate::engine::app_master_probation as probation;
    let scope = probation::ProbationScope {
        project_id: scope_project,
        persona_id: scope_persona,
    };

    // Raise first, then decide: a window that closed during this very tick gets
    // its packet and its answer in the same call, which is the whole point of
    // compressing a night.
    // `force_due` goes to BOTH halves: a mandate the raise pass had to defer
    // (never executed, so no review row can anchor) is decided anchorless by
    // the sweep, and it has to agree with the raise pass about what "due" means
    // or a forced tick would raise nothing and decide nothing.
    let raised = probation::probation_tick_summary_with(pool, force_due, scope);
    let decided = probation::headless_probation_sweep(app, pool, force_due, scope);
    let mut out = phase_stub();
    out.details = decided
        .iter()
        .filter_map(|d| serde_json::to_value(d).ok())
        .collect();
    out.counts = Some(serde_json::json!({
        "mandates": raised.mandates,
        "due": raised.due,
        "raised": raised.raised,
        "deferred": raised.deferred,
        "decided": decided.len(),
        "notes": raised.notes,
    }));
    out
}

// =============================================================================
// Headless bridge seeding (§13.9) — give the night something to dispatch
// =============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KpTestSeedWorkBody {
    /// The `dev_projects.id` to seed. Exactly one of this and `personaId` is
    /// required — a seed that guessed its target would be a seed that can put a
    /// bench task on the wrong repository.
    #[serde(default)]
    project_id: Option<String>,
    /// The App-master persona whose bound project should be seeded. Resolved
    /// through the mandate records, which are the same rows the overnight,
    /// reconcile and probation phases read the binding from.
    #[serde(default)]
    persona_id: Option<String>,
    /// The tasks. Capped at
    /// [`crate::db::repos::dev::bench_seed::MAX_SEED_ITEMS`].
    items: Vec<crate::db::repos::dev::bench_seed::BenchSeedItem>,
    /// Optional run salt folded verbatim into each item's dedup key, so the
    /// same seed titles can be re-seeded by a later bench run. Titles cannot
    /// carry this: the ideas normalizer strips bracketed run stamps.
    #[serde(default)]
    dedupe_salt: Option<String>,
}

/// `POST /api/kp/test/seed-work` — write bench tasks into the backlog the
/// overnight engine dispatches from.
///
/// Same gating as [`kp_test_tick`]: the route exists only while
/// `personas_engine::headless::enabled()` (so with the mode off it 404s rather
/// than 403s), and `authorize` demands `personas:test` for the whole
/// `/api/kp/test/` prefix.
///
/// **This endpoint creates work, never permission.** It writes `pending`
/// `dev_ideas` rows plus the one auto-accept triage rule that makes them
/// dispatchable — the mechanical equivalent of run-protocol §4's "create one
/// backlog idea per seed … and accept them". The autopilot capability gate, the
/// App-master mandate rung, the budget governor and the fleet slot cap all
/// still stand between a seeded idea and a proposal branch, and the next
/// `/api/kp/test/tick` overnight phase is what runs them.
///
/// Every submitted item gets exactly one answer — written or skipped, with the
/// id it collided with. A seed that silently vanished would leave a bench
/// reading zero dispatches and blaming the agent.
async fn kp_test_seed_work(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Json(body): Json<KpTestSeedWorkBody>,
) -> Response {
    use crate::db::repos::dev::bench_seed;

    // Second gate. The route only exists while the mode is on, but a stale
    // router is not a thing this handler is willing to assume.
    if !personas_engine::headless::enabled() {
        return err_json(StatusCode::NOT_FOUND, "not found").into_response();
    }

    let pool = state.pool.clone();

    // -- Resolve the target project ------------------------------------------
    let project_id = match (
        body.project_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
        body.persona_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    ) {
        (Some(pid), _) => pid.to_string(),
        (None, Some(persona_id)) => {
            let mandates = personas_engine::app_master::load_mandates(&pool);
            match mandates
                .into_iter()
                .find(|(_, record)| record.persona_id == persona_id)
            {
                Some((project_id, _)) => project_id,
                None => {
                    return err_json(
                        StatusCode::NOT_FOUND,
                        &format!(
                            "persona `{persona_id}` holds no App master mandate, so there is no \
                             project to seed. Pass `projectId` explicitly, or hire first."
                        ),
                    )
                    .into_response();
                }
            }
        }
        (None, None) => {
            return err_json(
                StatusCode::BAD_REQUEST,
                "one of `projectId` or `personaId` is required — seeding will not guess which \
                 repository the tasks belong to",
            )
            .into_response();
        }
    };

    // -- Write ---------------------------------------------------------------
    match bench_seed::seed_bench_work_salted(
        &pool,
        &project_id,
        &body.items,
        body.dedupe_salt.as_deref(),
    ) {
        Ok(outcome) => {
            tracing::warn!(
                project_id = %outcome.project_id,
                seeded = outcome.seeded,
                skipped = outcome.skipped,
                "HEADLESS BRIDGE: seeded bench work onto the backlog"
            );
            ok_json(serde_json::json!({
                "headlessBridge": true,
                "actor": personas_engine::headless::ACTOR,
                "seed": outcome,
                // Said once, here, so a driver never has to infer it: the
                // acceptance command and the trap note are echoed and stored
                // nowhere, because `dispatch_prompt` would put them in front of
                // the agent and run-protocol §8 makes that run invalid.
                "acceptanceStored": false,
                "note": "items are written `pending`; the next tick's overnight triage pass is what accepts and dispatches them, under the unchanged mandate + budget gates",
            }))
            .into_response()
        }
        Err(AppError::Validation(msg)) => err_json(StatusCode::BAD_REQUEST, &msg).into_response(),
        Err(AppError::NotFound(msg)) => {
            err_json(StatusCode::NOT_FOUND, &format!("{msg} not found")).into_response()
        }
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

// =============================================================================
// Headless bridge retirement (§13.11) — end a tenure over the bridge
// =============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KpTestRetireBody {
    /// The persona whose tenure ends. Required: a retirement that guessed its
    /// target would be a retirement that puts down the wrong hire.
    #[serde(default)]
    persona_id: Option<String>,
}

/// What one retirement still has to do, decided **before** anything is written.
///
/// A tenure ends in two records, not one — the persona's lifecycle and the App
/// master mandate the hire created — and they can already disagree (a mandate
/// retired at probation review leaves the persona row untouched). Deciding both
/// halves up front is what makes the route idempotent *per half* rather than
/// per call: a second retire finishes whatever the first left, and answers
/// `alreadyRetired` only when there was nothing left at all.
#[derive(Debug, PartialEq, Eq)]
struct RetirePlan {
    /// The persona is not yet `archived`.
    archive: bool,
    /// A mandate record is linked to this persona and is not yet decided, so
    /// the shared probation carry-out still owes it a `retired`.
    carry_out_mandate: bool,
}

impl RetirePlan {
    /// `None` for the mandate ⇒ this persona holds none (an ordinary hire, or
    /// one whose mandate was already removed); `Some(false)` ⇒ it holds one
    /// that is already decided. Neither is work.
    fn decide(lifecycle: &str, mandate_open: Option<bool>) -> Self {
        Self {
            archive: lifecycle != PersonaLifecycle::Archived.as_str(),
            carry_out_mandate: mandate_open.unwrap_or(false),
        }
    }

    /// Nothing left to do in either record ⇒ the tenure was already over.
    fn already_retired(&self) -> bool {
        !self.archive && !self.carry_out_mandate
    }
}

/// The DB half of [`kp_test_retire`], split out so it is reachable by a test
/// without a Tauri `AppHandle`.
///
/// **Reuses** `personas::archive_persona` — the same repository function the
/// `archive_persona` command calls — so a bridge retirement is the same archive
/// a human performs: lifecycle `archived`, no cascade, system personas refused.
/// Returns the refreshed persona, the plan that was decided, and the
/// `dev_projects.id` of the linked mandate when there is one, which is what the
/// caller hands to the shared probation carry-out.
fn retire_persona_db(
    pool: &DbPool,
    persona_id: &str,
) -> Result<(Persona, RetirePlan, Option<String>), AppError> {
    let persona = persona_repo::get_by_id(pool, persona_id)?;
    // The hire record. `load_mandates` is one prefix query, and the mandate is
    // keyed by project — so the persona is found by scanning, not by guessing a
    // key from an id it does not own.
    let mandate = personas_engine::app_master::load_mandates(pool)
        .into_iter()
        .find(|(_, record)| record.persona_id == persona_id);
    let plan = RetirePlan::decide(
        &persona.lifecycle,
        mandate
            .as_ref()
            .map(|(_, record)| record.probation_decided_at.is_none()),
    );
    let persona = if plan.archive {
        persona_repo::archive_persona(pool, persona_id)?
    } else {
        persona
    };
    Ok((persona, plan, mandate.map(|(project_id, _)| project_id)))
}

/// `POST /api/kp/test/retire` — end one persona's tenure.
///
/// Same gating as [`kp_test_tick`] and [`kp_test_seed_work`]: the route exists
/// only while `personas_engine::headless::enabled()` (so with the mode off it
/// 404s rather than 403s), and `authorize` demands `personas:test` for the whole
/// `/api/kp/test/` prefix.
///
/// **Why the bridge needs it.** The 2026-08 App-master sweeps left 100+ personas
/// behind because nothing could put one down again: hiring was reachable over
/// the bridge and retiring was not, so every bench run added to the roster
/// permanently. A tenure that cannot end is not a tenure.
///
/// **Two records, one shared meaning.** The persona is archived through the
/// repository function the `archive_persona` command calls, and the linked App
/// master mandate is ended through
/// `reviews::apply_app_master_probation_decision` — the *same* carry-out a
/// human's `retire` click and the headless probation sweep reach. So autopilot
/// goes to `off`, the cadence triggers are disabled, the mandate records
/// `retired`, the holder remembers it and kp is told, exactly as they would be
/// on any other retirement. A second implementation of "what retiring means"
/// is the bug this route deliberately does not write.
///
/// Idempotent per half: a persona already `archived` whose mandate is already
/// decided answers `alreadyRetired: true` and writes nothing.
async fn kp_test_retire(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Json(body): Json<KpTestRetireBody>,
) -> Response {
    // Second gate. The route only exists while the mode is on, but a stale
    // router is not a thing this handler is willing to assume.
    if !personas_engine::headless::enabled() {
        return err_json(StatusCode::NOT_FOUND, "not found").into_response();
    }

    let Some(persona_id) = body
        .persona_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
    else {
        return err_json(
            StatusCode::BAD_REQUEST,
            "`personaId` is required — retirement will not guess which tenure to end",
        )
        .into_response();
    };

    let pool = state.pool.clone();
    let (persona, plan, mandate_project_id) = match retire_persona_db(&pool, &persona_id) {
        Ok(v) => v,
        Err(AppError::NotFound(msg)) => {
            return err_json(StatusCode::NOT_FOUND, &format!("{msg} not found")).into_response()
        }
        // System-origin personas (the Director) cannot be archived. That is a
        // refusal with a reason, not a 500.
        Err(AppError::Validation(msg)) => {
            return err_json(StatusCode::BAD_REQUEST, &msg).into_response()
        }
        Err(e) => {
            return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response()
        }
    };

    // The mandate half, through the one carry-out every retirement goes through.
    let mut mandate_carried_out = false;
    if plan.carry_out_mandate {
        if let Some(project_id) = mandate_project_id.as_deref() {
            let app_state = state.app.state::<Arc<crate::AppState>>();
            mandate_carried_out =
                crate::commands::design::reviews::apply_app_master_probation_decision(
                    &app_state,
                    crate::commands::design::reviews::ProbationCarryOut {
                        project_id,
                        decision: "retired",
                        note: Some(format!(
                        "retired over the headless test bridge by `{}`; autopilot off and cadence \
                         triggers disabled",
                        personas_engine::headless::ACTOR
                    )),
                        // Nothing about a bridge retirement is a probation
                        // extension, so the streak is left exactly as it stands.
                        headless_incomplete_streak: None,
                        // There deliberately is no review row: this decision was
                        // not raised, it was requested.
                        review_id: None,
                        // No backbone was read. `None` is written as *no verdict
                        // recorded* — never as a pass.
                        verdict: None,
                        unmeasured: &[],
                    },
                );
        }
    }

    tracing::warn!(
        persona_id = %persona.id,
        project_id = mandate_project_id.as_deref(),
        already_retired = plan.already_retired(),
        actor = personas_engine::headless::ACTOR,
        "HEADLESS BRIDGE: retiring a persona with NO human in the loop"
    );

    ok_json(serde_json::json!({
        "headlessBridge": true,
        "actor": personas_engine::headless::ACTOR,
        "personaId": persona.id,
        "alreadyRetired": plan.already_retired(),
        "lifecycle": persona.lifecycle,
        "mandate": mandate_project_id.map(|project_id| serde_json::json!({
            "projectId": project_id,
            "decision": "retired",
            // False when the mandate was already decided (nothing to do) or
            // when the carry-out found no record to apply it to. A bench must
            // be able to tell "ended just now" from "was already ended".
            "carriedOut": mandate_carried_out,
        })),
        "note": "the persona is archived (no cascade — executions, memories and the violation ledger stay readable) and any linked App master mandate is ended through the same carry-out a probation `retire` reaches",
    }))
    .into_response()
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Temp-file pool with the initial schema applied (no `run_incremental`).
    ///
    /// The management API tests need both the base persona/design tables (A2A
    /// agent-card) and `external_api_keys` (system key). `initial::run` creates
    /// both. We deliberately skip `run_incremental`: it drops `external_api_keys`
    /// in the test binary — a pre-existing, unrelated migration-harness issue
    /// (see docs/architecture/cloud-integration-bridge.md, P1 notes). Because the
    /// capability-token columns are now defined directly in initial.rs's
    /// `CREATE TABLE`, `external_api_keys` here has the shape
    /// `get_or_create_system_api_key`'s INSERT writes.
    fn test_pool() -> DbPool {
        use std::time::Duration;
        let tmp = std::env::temp_dir().join(format!("mgmt_api_test_{}.db", uuid::Uuid::new_v4()));
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&tmp);
        let pool = r2d2::Pool::builder()
            .max_size(2)
            .connection_timeout(Duration::from_secs(5))
            .build(manager)
            .expect("test pool build");
        {
            let conn = pool.get().expect("conn");
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::db::migrations::run(&conn).expect("migrations");
        }
        pool
    }

    // ---- authorize() scope matrix ------------------------------------------

    fn scopes(list: &[&str]) -> Vec<String> {
        list.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn authorize_ship_routes_read_with_any_key_and_write_with_build() {
        assert!(authorize(&Method::GET, "/api/dev/projects", &[]).is_ok());
        assert!(authorize(&Method::GET, "/api/dev/milestones/m1", &[]).is_ok());
        assert!(authorize(&Method::POST, "/api/dev/projects/p1/milestones", &[]).is_err());
        assert!(authorize(
            &Method::POST,
            "/api/dev/projects/p1/milestones",
            &scopes(&["personas:execute"])
        )
        .is_err());
        assert!(authorize(
            &Method::POST,
            "/api/dev/milestones/m1/goals",
            &scopes(&["personas:build"])
        )
        .is_ok());
    }

    #[test]
    fn authorize_a2a_and_agent_card_need_only_auth() {
        assert!(authorize(&Method::POST, "/a2a/persona-1", &[]).is_ok());
        assert!(authorize(&Method::GET, "/agent-card/persona-1", &[]).is_ok());
    }

    #[test]
    fn authorize_reads_open_mutations_need_execute() {
        assert!(authorize(&Method::GET, "/api/personas", &[]).is_ok());
        assert!(authorize(&Method::GET, "/api/executions/abc", &[]).is_ok());
        // A mutating /api/* route (e.g. version tag) needs broad execute.
        assert!(authorize(&Method::POST, "/api/versions/v1/tag", &[]).is_err());
        assert!(authorize(
            &Method::POST,
            "/api/versions/v1/tag",
            &scopes(&["personas:execute"])
        )
        .is_ok());
    }

    #[test]
    fn authorize_build_requires_build_scope() {
        assert!(authorize(&Method::POST, "/api/build", &[]).is_err());
        assert!(authorize(&Method::POST, "/api/build", &scopes(&["personas:execute"])).is_err());
        assert!(authorize(&Method::POST, "/api/build", &scopes(&["personas:build"])).is_ok());
        // Status GETs are gated too.
        assert!(authorize(&Method::GET, "/api/build/sess-1", &[]).is_err());
        assert!(authorize(
            &Method::GET,
            "/api/build/sess-1",
            &scopes(&["personas:build"])
        )
        .is_ok());
    }

    #[test]
    fn authorize_kp_posts_need_build_scope_reads_need_only_auth() {
        // Mutating intake = same trust tier as /api/build.
        assert!(authorize(&Method::POST, "/api/kp/persona-requests", &[]).is_err());
        assert!(authorize(
            &Method::POST,
            "/api/kp/persona-requests",
            &scopes(&["personas:execute"])
        )
        .is_err());
        assert!(authorize(
            &Method::POST,
            "/api/kp/persona-requests",
            &scopes(&["personas:build"])
        )
        .is_ok());
        // Reads follow the any-valid-key GET rule.
        assert!(authorize(&Method::GET, "/api/kp/persona-requests/appr_x", &[]).is_ok());
        assert!(authorize(&Method::GET, "/api/kp/connector-catalog", &[]).is_ok());
    }

    // ---- KP bridge: validation + approval-row insertion ---------------------

    fn kp_body() -> KpPersonaRequestBody {
        serde_json::from_value(serde_json::json!({
            "kp": {
                "baseUrl": "http://localhost:3001",
                "jobId": "job-42",
                "jobTitle": "Senior Rust Engineer",
                "workspace": "acme"
            },
            "spec": {
                "name": "Rust Sourcing Scout",
                "mission": "Source and pre-screen Rust candidates for job-42.",
                "systemPromptDraft": "You are a sourcing scout.",
                "connectors": ["github", "slack"],
                "maxBudgetUsd": 25.0,
                "maxTurns": 40,
                "successMetrics": [
                    {"key": "sourced", "label": "Candidates sourced", "target": 20, "unit": "count", "direction": "up"}
                ]
            },
            "reportToken": "tok_abc123"
        }))
        .expect("fixture body")
    }

    #[test]
    fn kp_validation_accepts_a_sane_request() {
        assert_eq!(validate_kp_persona_request(&kp_body()), Ok(()));
        // Minimal: no optional fields at all.
        let minimal: KpPersonaRequestBody = serde_json::from_value(serde_json::json!({
            "kp": {"baseUrl": "https://kp.example", "jobId": "j", "jobTitle": "t"},
            "spec": {"name": "n", "mission": "m"},
            "reportToken": "tok"
        }))
        .expect("minimal body");
        assert_eq!(validate_kp_persona_request(&minimal), Ok(()));
    }

    #[test]
    fn kp_validation_rejects_bad_fields() {
        let mut b = kp_body();
        b.spec.name = "   ".into();
        assert!(validate_kp_persona_request(&b)
            .unwrap_err()
            .contains("spec.name"));

        let mut b = kp_body();
        b.spec.mission = String::new();
        assert!(validate_kp_persona_request(&b)
            .unwrap_err()
            .contains("spec.mission"));

        let mut b = kp_body();
        b.kp.base_url = "ftp://nope".into();
        assert!(validate_kp_persona_request(&b)
            .unwrap_err()
            .contains("baseUrl"));

        let mut b = kp_body();
        b.spec.max_budget_usd = Some(-1.0);
        assert!(validate_kp_persona_request(&b)
            .unwrap_err()
            .contains("maxBudgetUsd"));

        let mut b = kp_body();
        b.spec.max_turns = Some(0);
        assert!(validate_kp_persona_request(&b)
            .unwrap_err()
            .contains("maxTurns"));

        let mut b = kp_body();
        b.spec.connectors = (0..33).map(|i| format!("c{i}")).collect();
        assert!(validate_kp_persona_request(&b)
            .unwrap_err()
            .contains("connectors"));

        let mut b = kp_body();
        b.report_token = String::new();
        assert!(validate_kp_persona_request(&b)
            .unwrap_err()
            .contains("reportToken"));
    }

    // ---- App master block (P4) ---------------------------------------------

    fn kp_app_master_json() -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": 1,
            "role": {"title": "App master", "population": "agent", "seniority": "senior",
                     "rubricVersion": "app-master-rubric-v1"},
            "app": {
                "name": "kp",
                "repo": {"url": "https://github.com/xkazm04/kp", "rootPath": null, "mainBranch": "main"},
                "contextMapRef": "context-map.json",
                "dossierId": "dos_1"
            },
            "objectives": [
                {"kpiKey": "gate_pass_rate", "label": "Gate pass rate", "baseline": 0.82,
                 "target": 0.95, "unit": "ratio", "direction": "gte", "windowDays": 30},
                {"kpiKey": "p95_build_s", "label": "p95 build seconds", "baseline": null,
                 "target": 120.0, "unit": "s", "direction": "lte", "windowDays": 14}
            ],
            "mandate": {
                "scopeRung": 2,
                "forbiddenClasses": ["test_deletion_or_skip", "gate_configuration"],
                "approvalGates": ["npm run test:unit"],
                "owner": "ana@example.com"
            },
            "cadence": {"triggers": [
                {"kind": "schedule", "config": {"cron": "0 2 * * *"}},
                {"kind": "pr", "config": {}}
            ]},
            "budget": {"monthlyUsd": 40.0, "reservationPolicy": "estimate", "onCap": "drain"},
            "tenure": {"probationDays": 30, "reviewCadenceDays": 30,
                       "retireCriteria": ["no merged proposal in two windows"]},
            "agent": {"name": "kp App Master", "mission": "Own kp's value ledger.",
                      "systemPromptDraft": "", "connectors": ["github"], "maxTurns": null},
            "human": null,
            "coercionNotes": [],
            "promptVersion": "app-master-v1"
        })
    }

    fn kp_app_master_body() -> KpPersonaRequestBody {
        let mut v = serde_json::to_value(kp_body()).unwrap();
        v["appMaster"] = kp_app_master_json();
        serde_json::from_value(v).expect("app master body")
    }

    #[test]
    fn app_master_block_is_optional_and_the_old_shape_still_validates() {
        // The additive contract: a body with no `appMaster` is unchanged.
        assert!(kp_body().app_master.is_none());
        assert_eq!(validate_kp_persona_request(&kp_body()), Ok(()));
    }

    #[test]
    fn an_intake_originated_hire_has_no_job_and_still_validates() {
        // kp's P4 sentinel: an App-master hire composed in the intake dialog
        // sends `jobId: ""` + `kp.intakeId`. Refusing it failed every live
        // intake dispatch (bench sweep #4, 2026-08-24).
        let mut b = kp_app_master_body();
        b.kp.job_id = String::new();
        b.kp.intake_id = Some("intake-abc123".into());
        assert_eq!(validate_kp_persona_request(&b), Ok(()));

        // But an empty jobId with NO appMaster (old shape) stays refused…
        let mut old = kp_body();
        old.kp.job_id = String::new();
        old.kp.intake_id = Some("intake-abc123".into());
        assert!(validate_kp_persona_request(&old)
            .unwrap_err()
            .contains("kp.jobId"));

        // …and so does an App-master body with NEITHER handle.
        let mut none = kp_app_master_body();
        none.kp.job_id = String::new();
        none.kp.intake_id = None;
        assert!(validate_kp_persona_request(&none)
            .unwrap_err()
            .contains("kp.jobId"));
    }

    #[test]
    fn app_master_block_parses_kps_real_spec_shape_and_ignores_unknown_fields() {
        let b = kp_app_master_body();
        assert_eq!(validate_kp_persona_request(&b), Ok(()));
        let am = b.app_master.expect("appMaster parsed");
        assert_eq!(am.app.name, "kp");
        assert_eq!(am.app.repo.main_branch, "main");
        assert_eq!(am.objectives.len(), 2);
        // A null baseline stays null. Reading it as 0.0 would invent a
        // measurement nobody took.
        assert_eq!(am.objectives[1].baseline, None);
        assert_eq!(am.objectives[1].target, Some(120.0));
        assert_eq!(am.mandate.scope_rung, 2);
        assert_eq!(am.cadence.triggers.len(), 2);
        assert_eq!(am.tenure.probation_days, 30);

        // kp owns this schema and will add to it. An addition must not 400.
        let mut v = serde_json::to_value(kp_body()).unwrap();
        let mut spec = kp_app_master_json();
        spec["somethingKpAddsLater"] = serde_json::json!({"nested": true});
        spec["mandate"]["futureField"] = serde_json::json!(7);
        v["appMaster"] = spec;
        let b: KpPersonaRequestBody = serde_json::from_value(v).expect("forward-compatible");
        assert_eq!(validate_kp_persona_request(&b), Ok(()));
    }

    #[test]
    fn app_master_rejects_a_rung_v1_never_grants() {
        for rung in [3u8, 4, 9] {
            let mut v = serde_json::to_value(kp_body()).unwrap();
            let mut spec = kp_app_master_json();
            spec["mandate"]["scopeRung"] = serde_json::json!(rung);
            v["appMaster"] = spec;
            let b: KpPersonaRequestBody = serde_json::from_value(v).unwrap();
            let err = validate_kp_persona_request(&b).unwrap_err();
            assert!(err.contains("scopeRung"), "{err}");
            assert!(err.contains("never granted"), "{err}");
        }
        // 0, 1 and 2 are all grantable.
        for rung in [0u8, 1, 2] {
            let mut v = serde_json::to_value(kp_body()).unwrap();
            let mut spec = kp_app_master_json();
            spec["mandate"]["scopeRung"] = serde_json::json!(rung);
            v["appMaster"] = spec;
            let b: KpPersonaRequestBody = serde_json::from_value(v).unwrap();
            assert_eq!(validate_kp_persona_request(&b), Ok(()), "rung {rung}");
        }
    }

    #[test]
    fn app_master_rejects_a_forbidden_class_outside_the_closed_vocabulary() {
        let mut v = serde_json::to_value(kp_body()).unwrap();
        let mut spec = kp_app_master_json();
        spec["mandate"]["forbiddenClasses"] =
            serde_json::json!(["test_deletion_or_skip", "merge_to_main"]);
        v["appMaster"] = spec;
        let b: KpPersonaRequestBody = serde_json::from_value(v).unwrap();
        let err = validate_kp_persona_request(&b).unwrap_err();
        assert!(err.contains("merge_to_main"), "{err}");
        assert!(err.contains("cannot detect"), "{err}");

        // Every class kp declares IS accepted — the vocabularies must agree or
        // a legitimate mandate is refused at the door.
        let mut v = serde_json::to_value(kp_body()).unwrap();
        let mut spec = kp_app_master_json();
        spec["mandate"]["forbiddenClasses"] = serde_json::json!([
            "test_deletion_or_skip",
            "suppression_directive",
            "gate_configuration",
            "dependency_bump_to_satisfy_check",
            "credentials_or_permissions",
            "delivery_configuration"
        ]);
        v["appMaster"] = spec;
        let b: KpPersonaRequestBody = serde_json::from_value(v).unwrap();
        assert_eq!(validate_kp_persona_request(&b), Ok(()));
    }

    #[test]
    fn app_master_rejects_an_unbound_app_and_a_bad_binding() {
        // No url AND no rootPath: nothing to be accountable for.
        let mut v = serde_json::to_value(kp_body()).unwrap();
        let mut spec = kp_app_master_json();
        spec["app"]["repo"] =
            serde_json::json!({"url": null, "rootPath": null, "mainBranch": "main"});
        v["appMaster"] = spec;
        let b: KpPersonaRequestBody = serde_json::from_value(v).unwrap();
        assert!(validate_kp_persona_request(&b)
            .unwrap_err()
            .contains("app.repo"));

        // A non-http url.
        let mut v = serde_json::to_value(kp_body()).unwrap();
        let mut spec = kp_app_master_json();
        spec["app"]["repo"]["url"] = serde_json::json!("git@github.com:x/y.git");
        v["appMaster"] = spec;
        let b: KpPersonaRequestBody = serde_json::from_value(v).unwrap();
        assert!(validate_kp_persona_request(&b)
            .unwrap_err()
            .contains("http(s)"));

        // A rootPath alone IS a valid binding.
        let mut v = serde_json::to_value(kp_body()).unwrap();
        let mut spec = kp_app_master_json();
        spec["app"]["repo"] =
            serde_json::json!({"url": null, "rootPath": "C:/repos/kp", "mainBranch": "main"});
        v["appMaster"] = spec;
        let b: KpPersonaRequestBody = serde_json::from_value(v).unwrap();
        assert_eq!(validate_kp_persona_request(&b), Ok(()));
    }

    #[test]
    fn app_master_rejects_out_of_vocabulary_and_out_of_bounds_fields() {
        let cases: &[(&str, serde_json::Value, &str)] = &[
            (
                "/objectives/0/direction",
                serde_json::json!("upward"),
                "direction",
            ),
            (
                "/objectives/0/windowDays",
                serde_json::json!(0),
                "windowDays",
            ),
            ("/objectives/0/kpiKey", serde_json::json!("  "), "kpiKey"),
            (
                "/cadence/triggers/0/kind",
                serde_json::json!("cron"),
                "kind",
            ),
            (
                "/tenure/probationDays",
                serde_json::json!(0),
                "probationDays",
            ),
            (
                "/tenure/reviewCadenceDays",
                serde_json::json!(99999),
                "reviewCadenceDays",
            ),
        ];
        for (ptr, val, needle) in cases {
            let mut v = serde_json::to_value(kp_body()).unwrap();
            let mut spec = kp_app_master_json();
            *spec.pointer_mut(ptr).expect(ptr) = val.clone();
            v["appMaster"] = spec;
            let b: KpPersonaRequestBody = serde_json::from_value(v).unwrap();
            let err = validate_kp_persona_request(&b).unwrap_err();
            assert!(err.contains(needle), "{ptr}: {err}");
        }
        // Bounded collections.
        let mut v = serde_json::to_value(kp_body()).unwrap();
        let mut spec = kp_app_master_json();
        spec["objectives"] = serde_json::Value::Array(
            (0..17)
                .map(|i| {
                    serde_json::json!({"kpiKey": format!("k{i}"), "label": "x", "unit": "",
                                            "direction": "gte", "windowDays": 30})
                })
                .collect(),
        );
        v["appMaster"] = spec;
        let b: KpPersonaRequestBody = serde_json::from_value(v).unwrap();
        assert!(validate_kp_persona_request(&b)
            .unwrap_err()
            .contains("objectives"));
    }

    #[test]
    fn the_approval_card_tells_the_human_this_is_an_app_master_hire() {
        let plain = kp_hire_rationale(&kp_body());
        assert!(!plain.contains("APP MASTER"), "{plain}");

        let am = kp_hire_rationale(&kp_app_master_body());
        // The human is agreeing to a repo binding, a mandate and a probation —
        // the card must name all three, not just "make a persona".
        assert!(am.contains("APP MASTER"), "{am}");
        assert!(am.contains("kp"), "{am}");
        assert!(am.contains("rung 2"), "{am}");
        assert!(am.contains("open branch/PR"), "{am}");
        assert!(am.contains("2 objective(s)"), "{am}");
        assert!(am.contains("30-day probation"), "{am}");
        assert!(am.contains("suggest"), "{am}");
    }

    /// In-memory user-db pool with just the `companion_approval` table (schema
    /// copied from db/src/lib.rs), mirroring the rollup.rs test pattern.
    fn kp_test_user_pool() -> crate::db::UserDbPool {
        let manager = r2d2_sqlite::SqliteConnectionManager::memory();
        let pool = r2d2::Pool::builder()
            .max_size(1)
            .build(manager)
            .expect("user pool");
        pool.get()
            .unwrap()
            .execute_batch(
                "CREATE TABLE companion_approval (
                    id               TEXT PRIMARY KEY,
                    session_id       TEXT NOT NULL,
                    kind             TEXT NOT NULL,
                    payload          TEXT NOT NULL,
                    status           TEXT NOT NULL DEFAULT 'pending',
                    human_review_id  TEXT,
                    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
                    resolved_at      TEXT
                );",
            )
            .unwrap();
        pool
    }

    #[test]
    fn kp_insert_creates_a_pending_approval_row_the_inbox_can_read() {
        let pool = kp_test_user_pool();
        let body = kp_body();
        let mut params = serde_json::to_value(&body).unwrap();
        params["requestId"] = serde_json::Value::String("appr_test1".into());
        insert_kp_hire_approval(&pool, "appr_test1", &params, &kp_hire_rationale(&body))
            .expect("insert");

        let conn = pool.get().unwrap();
        let (kind, status, payload): (String, String, String) = conn
            .query_row(
                "SELECT kind, status, payload FROM companion_approval WHERE id = 'appr_test1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("row");
        assert_eq!(kind, "op_execute");
        assert_eq!(status, "pending");
        // Payload carries the {action, params, rationale} shape the approvals
        // lifecycle reads without a special case.
        let v: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(v["action"], "kp_hire_request");
        assert_eq!(v["params"]["kp"]["jobId"], "job-42");
        assert_eq!(v["params"]["requestId"], "appr_test1");
        assert_eq!(v["params"]["reportToken"], "tok_abc123");
        let rationale = v["rationale"].as_str().unwrap();
        assert!(rationale.contains("Senior Rust Engineer"));
        assert!(rationale.contains("Rust Sourcing Scout"));
        assert!(rationale.contains("2 connector(s)"));
        assert!(rationale.contains("$25/mo"));
    }

    #[test]
    fn kp_connector_catalog_has_key_name_description() {
        let catalog = builtin_connector_catalog();
        assert!(!catalog.is_empty(), "builtin catalog must not be empty");
        for entry in &catalog {
            assert!(entry["key"].as_str().is_some_and(|s| !s.is_empty()));
            assert!(entry["name"].as_str().is_some_and(|s| !s.is_empty()));
            // Descriptions are trimmed to a picker-friendly size.
            assert!(entry["description"].as_str().unwrap().chars().count() <= 201);
        }
    }

    #[test]
    fn authorize_execute_broad_or_per_persona() {
        // Broad execute works for any persona.
        assert!(authorize(
            &Method::POST,
            "/api/execute/p1",
            &scopes(&["personas:execute"])
        )
        .is_ok());
        // Per-persona grant works only for the matching persona.
        assert!(authorize(
            &Method::POST,
            "/api/execute/p1",
            &scopes(&["personas:execute:persona:p1"])
        )
        .is_ok());
        assert!(authorize(
            &Method::POST,
            "/api/execute/p2",
            &scopes(&["personas:execute:persona:p1"])
        )
        .is_err());
        // Read scope alone cannot execute.
        assert!(authorize(
            &Method::POST,
            "/api/execute/p1",
            &scopes(&["personas:read"])
        )
        .is_err());
    }

    #[test]
    fn authorize_proxy_requires_proxy_not_execute() {
        // execute scope no longer authorizes the credential proxy (lockdown).
        assert!(authorize(
            &Method::POST,
            "/api/proxy/cred-1",
            &scopes(&["personas:execute"])
        )
        .is_err());
        // Broad proxy works.
        assert!(authorize(&Method::POST, "/api/proxy/cred-1", &scopes(&["proxy"])).is_ok());
        // Per-credential grant works only for the matching credential.
        assert!(authorize(
            &Method::POST,
            "/api/proxy/cred-1",
            &scopes(&["proxy:credential:cred-1"])
        )
        .is_ok());
        assert!(authorize(
            &Method::POST,
            "/api/proxy/cred-2",
            &scopes(&["proxy:credential:cred-1"])
        )
        .is_err());
    }

    #[test]
    fn authorize_broker_mint_requires_broad_proxy() {
        // Minting is a trust operation: broad `proxy` only.
        assert!(authorize(
            &Method::POST,
            "/api/broker/mint/cred-1",
            &scopes(&["proxy"])
        )
        .is_ok());
        // A derived handle's own scopes must NOT be able to mint further handles.
        assert!(authorize(
            &Method::POST,
            "/api/broker/mint/cred-1",
            &scopes(&["proxy:credential:cred-1", "cred:github:use"])
        )
        .is_err());
        assert!(authorize(
            &Method::POST,
            "/api/broker/mint/cred-1",
            &scopes(&["personas:execute"])
        )
        .is_err());
        assert!(authorize(&Method::POST, "/api/broker/mint/cred-1", &[]).is_err());
    }

    #[test]
    fn authorize_proxy_passes_connector_grants_to_handler() {
        // A per-connector grant passes the coarse middleware gate; the exact
        // connector match is enforced in the handler via credential_broker
        // (default-deny once the credential row is known).
        assert!(authorize(
            &Method::POST,
            "/api/proxy/cred-1",
            &scopes(&["cred:github:use"])
        )
        .is_ok());
        // Malformed / non-use cred scopes do NOT pass the gate.
        assert!(authorize(
            &Method::POST,
            "/api/proxy/cred-1",
            &scopes(&["cred:github:read"])
        )
        .is_err());
        assert!(authorize(&Method::POST, "/api/proxy/cred-1", &scopes(&["cred::use"])).is_err());
    }

    #[test]
    fn audit_persona_id_extracts_from_named_routes() {
        assert_eq!(audit_persona_id("/api/execute/p1").as_deref(), Some("p1"));
        assert_eq!(
            audit_persona_id("/a2a/persona-xyz").as_deref(),
            Some("persona-xyz")
        );
        assert_eq!(audit_persona_id("/agent-card/p2").as_deref(), Some("p2"));
        assert_eq!(audit_persona_id("/api/personas/p3").as_deref(), Some("p3"));
        // Routes that don't name a persona.
        assert_eq!(audit_persona_id("/api/personas"), None);
        assert_eq!(audit_persona_id("/api/executions"), None);
        assert_eq!(audit_persona_id("/api/build/sess-1"), None);
    }

    #[test]
    fn system_api_key_is_cached_across_calls() {
        // Reset the cache so the test is hermetic regardless of test order.
        {
            let cache = system_api_key_cache();
            *cache.lock().unwrap() = None;
        }
        let pool = test_pool();
        let a = get_or_create_system_api_key(&pool).expect("first");
        let b = get_or_create_system_api_key(&pool).expect("second");
        assert_eq!(a, b, "cached system key must be stable across calls");
        assert!(a.starts_with("pk_"));
    }

    #[test]
    fn agent_card_uses_design_context_use_cases() {
        let now = chrono::Utc::now().to_rfc3339();
        let design_context = serde_json::json!({
            "useCases": [
                {
                    "id": "uc-1",
                    "title": "Summarize emails",
                    "description": "Reads and summarizes incoming email threads.",
                    "category": "email"
                }
            ]
        })
        .to_string();
        let persona = Persona {
            lifecycle: "active".to_string(),
            core_profile: None,
            id: "p-1".into(),
            project_id: "default".into(),
            name: "Email Buddy".into(),
            description: Some("Summarizes email".into()),
            system_prompt: "You summarize email.".into(),
            structured_prompt: None,
            icon: None,
            color: None,
            enabled: true,
            sensitive: false,
            headless: false,
            starred: false,
            max_concurrent: 1,
            timeout_ms: 30_000,
            notification_channels: None,
            last_design_result: None,
            last_test_report: None,
            model_profile: None,
            max_budget_usd: None,
            max_turns: None,
            design_context: Some(design_context),
            home_team_id: None,
            source_review_id: None,
            trust_level: PersonaTrustLevel::Verified,
            trust_origin: PersonaTrustOrigin::Builtin,
            trust_verified_at: None,
            trust_score: 1.0,
            parameters: None,
            gateway_exposure: PersonaGatewayExposure::Public,
            template_category: None,
            cli_awareness_enabled: false,
            setup_status: "ready".to_string(),
            setup_detail: None,
            disabled_dims_json: None,
            created_at: now.clone(),
            updated_at: now,
        };
        let card = build_agent_card(&persona, "http://localhost:9420");
        assert_eq!(card.name, "Email Buddy");
        assert_eq!(card.url, "http://localhost:9420/a2a/p-1");
        assert_eq!(card.skills.len(), 1);
        assert_eq!(card.skills[0].id, "uc-1");
        assert_eq!(card.skills[0].name, "Summarize emails");
        assert_eq!(card.skills[0].tags, vec!["email".to_string()]);
        assert!(!card.capabilities.streaming);
    }

    #[test]
    fn agent_card_falls_back_to_default_skill_when_no_use_cases() {
        let now = chrono::Utc::now().to_rfc3339();
        let persona = Persona {
            lifecycle: "active".to_string(),
            core_profile: None,
            id: "p-2".into(),
            project_id: "default".into(),
            name: "Helper".into(),
            description: Some("Generic helper".into()),
            system_prompt: "Help.".into(),
            structured_prompt: None,
            icon: None,
            color: None,
            enabled: true,
            sensitive: false,
            headless: false,
            starred: false,
            max_concurrent: 1,
            timeout_ms: 30_000,
            notification_channels: None,
            last_design_result: None,
            last_test_report: None,
            model_profile: None,
            max_budget_usd: None,
            max_turns: None,
            design_context: None,
            home_team_id: None,
            source_review_id: None,
            trust_level: PersonaTrustLevel::Verified,
            trust_origin: PersonaTrustOrigin::Builtin,
            trust_verified_at: None,
            trust_score: 1.0,
            parameters: None,
            gateway_exposure: PersonaGatewayExposure::Public,
            template_category: None,
            cli_awareness_enabled: false,
            setup_status: "ready".to_string(),
            setup_detail: None,
            disabled_dims_json: None,
            created_at: now.clone(),
            updated_at: now,
        };
        let card = build_agent_card(&persona, "http://x");
        assert_eq!(card.skills.len(), 1);
        assert_eq!(card.skills[0].id, "default");
        assert_eq!(card.skills[0].name, "Helper");
        assert_eq!(card.skills[0].description, "Generic helper");
    }

    #[test]
    fn host_origin_falls_back_to_loopback_without_host_header() {
        let headers = axum::http::HeaderMap::new();
        assert_eq!(host_origin_from_request(&headers), "http://127.0.0.1:9420");
    }

    #[test]
    fn host_origin_uses_supplied_host_header() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(header::HOST, "personas.local:8080".parse().unwrap());
        assert_eq!(
            host_origin_from_request(&headers),
            "http://personas.local:8080"
        );
    }

    /// Build a `PersonaExecution` with the minimum fields needed by
    /// `build_a2a_task` so the per-status branches can be tested directly.
    fn make_exec_row(
        id: &str,
        persona_id: &str,
        status: &str,
        output: Option<&str>,
        error: Option<&str>,
    ) -> PersonaExecution {
        let now = chrono::Utc::now().to_rfc3339();
        PersonaExecution {
            id: id.into(),
            persona_id: persona_id.into(),
            trigger_id: None,
            use_case_id: None,
            status: status.into(),
            input_data: None,
            output_data: output.map(|s| s.to_string()),
            claude_session_id: None,
            log_file_path: None,
            execution_flows: None,
            model_used: None,
            thinking_level: None,
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: 0.0,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            error_message: error.map(|s| s.to_string()),
            duration_ms: None,
            tool_steps: None,
            retry_of_execution_id: None,
            retry_count: 0,
            started_at: Some(now.clone()),
            completed_at: Some(now.clone()),
            created_at: now,
            execution_config: Some("{}".into()),
            log_truncated: false,
            is_simulation: false,
            business_outcome: "unknown".to_string(),
            director_score: None,
            director_review_md: None,
        }
    }

    #[test]
    fn build_a2a_task_completed_attaches_output_artifact() {
        let row = make_exec_row("exec-1", "p-1", "completed", Some("the answer"), None);
        let task = build_a2a_task(&row, "p-1");
        assert_eq!(task.id, "exec-1");
        assert_eq!(task.kind, "task");
        assert_eq!(task.status.state, "completed");
        assert!(task.status.message.is_none());
        assert_eq!(task.artifacts.len(), 1);
        assert_eq!(task.artifacts[0].parts[0].text, "the answer");
        assert_eq!(task.context_id, "persona-p-1");
    }

    #[test]
    fn build_a2a_task_failed_attaches_status_message_not_artifact() {
        let row = make_exec_row("exec-2", "p-2", "failed", None, Some("kapow"));
        let task = build_a2a_task(&row, "p-2");
        assert_eq!(task.status.state, "failed");
        assert!(task.artifacts.is_empty());
        let msg = task.status.message.expect("status message");
        assert_eq!(msg.parts[0].text, "kapow");
        assert_eq!(msg.role, "agent");
    }

    #[test]
    fn build_a2a_task_cancelled_uses_canceled_state_with_message() {
        let row = make_exec_row("exec-3", "p-3", "cancelled", None, Some("user aborted"));
        let task = build_a2a_task(&row, "p-3");
        // Personas writes "cancelled" (UK), A2A spec uses "canceled" (US) — the
        // mapper bridges the spelling without dropping the message context.
        assert_eq!(task.status.state, "canceled");
        let msg = task.status.message.expect("status message");
        assert_eq!(msg.parts[0].text, "user aborted");
    }

    #[test]
    fn build_a2a_task_running_has_no_artifacts_or_message() {
        let row = make_exec_row("exec-4", "p-4", "running", None, None);
        let task = build_a2a_task(&row, "p-4");
        assert_eq!(task.status.state, "working");
        assert!(task.artifacts.is_empty());
        assert!(task.status.message.is_none());
    }

    #[test]
    fn build_a2a_task_completed_with_empty_output_emits_no_artifact() {
        // Edge case: status is terminal-success but output is empty. We do
        // NOT emit an empty artifact because that would mislead clients into
        // thinking there's a result to inspect.
        let row = make_exec_row("exec-5", "p-5", "completed", Some(""), None);
        let task = build_a2a_task(&row, "p-5");
        assert_eq!(task.status.state, "completed");
        assert!(task.artifacts.is_empty());
    }

    // NB: the former `scope_mapping_gates_sensitive_routes_but_not_reads` test
    // (which asserted the removed `required_scope_for_request`) is superseded by
    // the `authorize_*` tests above, which cover the same routes plus the new
    // resource-scoped (per-persona / per-credential) grants.

    #[test]
    fn a2a_request_dispatcher_recognizes_new_methods() {
        // Round-trip the three method names through serde to confirm they
        // parse into the `A2ARequest` envelope that `handle_a2a_request`
        // matches on. This guards against typos in the dispatcher table.
        for method in ["message/send", "tasks/get", "tasks/cancel"] {
            let raw = format!(
                r#"{{ "jsonrpc": "2.0", "id": 1, "method": "{}", "params": {{}} }}"#,
                method
            );
            let req: A2ARequest = serde_json::from_str(&raw).expect("parse");
            assert_eq!(req.method, method);
        }
    }

    // =========================================================================
    // POST /api/kp/test/retire (§13.11)
    // =========================================================================

    /// A fully-migrated pool — the retire path reads `personas` AND
    /// `app_settings` (where the mandate lives), so the initial-schema-only
    /// `test_pool` above is not enough.
    fn retire_pool() -> DbPool {
        crate::db::init_test_db().expect("migrated test db")
    }

    fn make_persona(pool: &DbPool, name: &str) -> Persona {
        persona_repo::create(
            pool,
            CreatePersonaInput {
                name: name.into(),
                system_prompt: "You are a test App master.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .expect("create persona")
    }

    fn make_mandate(pool: &DbPool, persona_id: &str, project_id: &str) {
        let record = personas_engine::app_master::MandateRecord {
            persona_id: persona_id.into(),
            project_id: project_id.into(),
            mandate: personas_engine::app_master::Mandate::default(),
            probation_ends_at: "2026-09-30T00:00:00+00:00".into(),
            hired_at: "2026-08-01T00:00:00+00:00".into(),
            review_cadence_days: 30,
            budget_monthly_usd: None,
            retire_criteria: vec![],
            probation_decided_at: None,
            probation_decision: None,
            probation_review_id: None,
            headless_incomplete_streak: 0,
        };
        personas_engine::app_master::set_mandate(pool, &record).expect("set mandate");
    }

    #[test]
    fn a_retire_plan_reads_both_records_and_only_then_calls_it_done() {
        // Nothing done yet, and a mandate is open: both halves are work.
        let fresh = RetirePlan::decide("active", Some(true));
        assert_eq!(
            fresh,
            RetirePlan {
                archive: true,
                carry_out_mandate: true
            }
        );
        assert!(!fresh.already_retired());

        // Half-done in either direction is still NOT already retired — that is
        // the state a probation `retire` (mandate only) and a hand-archive
        // (persona only) each leave behind.
        assert!(!RetirePlan::decide("archived", Some(true)).already_retired());
        assert!(!RetirePlan::decide("active", Some(false)).already_retired());

        // Archived, with the mandate decided (or with no mandate at all).
        assert!(RetirePlan::decide("archived", Some(false)).already_retired());
        assert!(RetirePlan::decide("archived", None).already_retired());
    }

    #[test]
    fn retiring_archives_the_persona_and_the_second_call_is_a_no_op() {
        let pool = retire_pool();
        let persona = make_persona(&pool, "Bench App Master");
        assert_eq!(persona.lifecycle, "active");

        let (retired, plan, mandate) = retire_persona_db(&pool, &persona.id).expect("retire");
        assert!(plan.archive, "an active persona has to be archived");
        assert!(!plan.already_retired());
        assert_eq!(retired.lifecycle, "archived");
        assert_eq!(mandate, None, "this hire holds no App master mandate");

        // Idempotent: the same call again writes nothing and says so, which is
        // what lets a bench driver retry a retirement it is not sure landed.
        let (again, plan, _) = retire_persona_db(&pool, &persona.id).expect("retire twice");
        assert!(plan.already_retired(), "{plan:?}");
        assert_eq!(again.lifecycle, "archived");
    }

    #[test]
    fn retiring_reports_the_linked_mandate_until_it_is_decided() {
        let pool = retire_pool();
        let persona = make_persona(&pool, "Mandated App Master");
        make_mandate(&pool, &persona.id, "proj-retire");

        // The hire record is found by the persona it names, and it is open.
        let (_, plan, mandate) = retire_persona_db(&pool, &persona.id).expect("retire");
        assert_eq!(mandate.as_deref(), Some("proj-retire"));
        assert!(
            plan.carry_out_mandate,
            "an undecided mandate is still owed a `retired` — archiving the persona alone \
             would leave the roster claiming a live tenure"
        );

        // Once the carry-out has stamped the record terminal, a repeat retire
        // has nothing left in EITHER record.
        let mut record = personas_engine::app_master::get_mandate(&pool, "proj-retire").unwrap();
        record.probation_decided_at = Some("2026-08-29T00:00:00+00:00".into());
        record.probation_decision = Some("retired".into());
        personas_engine::app_master::set_mandate(&pool, &record).unwrap();

        let (_, plan, mandate) = retire_persona_db(&pool, &persona.id).expect("retire twice");
        assert_eq!(mandate.as_deref(), Some("proj-retire"));
        assert!(plan.already_retired(), "{plan:?}");
    }

    #[test]
    fn retiring_an_unknown_persona_is_a_not_found() {
        let pool = retire_pool();
        match retire_persona_db(&pool, "no-such-persona") {
            Err(AppError::NotFound(msg)) => assert!(msg.contains("no-such-persona"), "{msg}"),
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    // =========================================================================
    // The overnight phase's proposal list and decline log (§13.12)
    // =========================================================================

    #[test]
    fn an_overnight_summary_carries_both_lists_even_when_the_night_produced_nothing() {
        let mut overnight = phase_stub();
        overnight.phase = "overnight";
        overnight.proposals = Some(Vec::new());
        overnight.declines = Some(Vec::new());

        let json = serde_json::to_value(&overnight).expect("serialize");
        // Present and EMPTY. The bug this replaces is a summary that carried
        // only prose ("1 accepted idea(s) left for the morning") and never the
        // ideas — a reader could not tell a quiet night from an unreported one.
        assert_eq!(json["proposals"], serde_json::json!([]));
        assert_eq!(json["declines"], serde_json::json!([]));

        // Nothing an existing consumer deep-scans has moved.
        assert_eq!(json["phase"], serde_json::json!("overnight"));
        assert_eq!(json["ran"], serde_json::json!(true));
        assert_eq!(json["durationMs"], serde_json::json!(0));
        assert!(json.get("counts").is_none(), "counts still skips when None");
        assert!(
            json.get("details").is_none(),
            "details still skips when empty"
        );
        assert!(
            json.get("errors").is_none(),
            "errors still skips when empty"
        );
    }

    #[test]
    fn a_populated_overnight_summary_names_the_ideas_and_the_reasons() {
        use personas_engine::headless::{NightDecline, NightProposal};

        let mut overnight = phase_stub();
        overnight.phase = "overnight";
        overnight.proposals = Some(vec![NightProposal {
            title: "Close the decode seam".into(),
            target: "Decode seam".into(),
            why: Some("two call sites already disagree".into()),
            journey: Some("Role to schedule".into()),
            axis: Some("stabilize".into()),
            size: Some("s".into()),
            confidence: None,
            created_at: "2026-08-29T21:39:09+00:00".into(),
            origin: None,
        }]);
        overnight.declines = Some(vec![
            NightDecline {
                title: "Rewrite the renderer".into(),
                reason: Some("outside-mandate"),
                created_at: "2026-08-25T09:00:00+00:00".into(),
                origin: Some("standards_finding".into()),
            },
            NightDecline {
                title: "Something the rule name does not explain".into(),
                reason: None,
                created_at: "2026-08-25T09:01:00+00:00".into(),
                origin: None,
            },
        ]);

        let json = serde_json::to_value(&overnight).expect("serialize");
        assert_eq!(
            json["proposals"][0],
            serde_json::json!({
                "title": "Close the decode seam",
                "target": "Decode seam",
                "why": "two call sites already disagree",
                "journey": "Role to schedule",
                "axis": "stabilize",
                "size": "s",
                // Nothing in the lane records a confidence, so the field is
                // emitted as null rather than filled with a number nobody
                // measured.
                "confidence": null,
                // §13.13 — the row's own stamp and sensor, verbatim. These two
                // lists select by STATE and carry no time window, so a project
                // that held a deck before the tenure began reports that deck;
                // `createdAt` is what lets a reader tell those apart, and
                // `origin` whether a sensor raised it rather than the holder.
                "createdAt": "2026-08-29T21:39:09+00:00",
                "origin": null,
            })
        );
        assert_eq!(
            json["declines"],
            serde_json::json!([
                { "title": "Rewrite the renderer", "reason": "outside-mandate",
                  "createdAt": "2026-08-25T09:00:00+00:00", "origin": "standards_finding" },
                // An unmappable reason is null, never invented.
                { "title": "Something the rule name does not explain", "reason": null,
                  "createdAt": "2026-08-25T09:01:00+00:00", "origin": null },
            ])
        );

        // Additive, asserted as such: the seven fields a7955297b shipped are
        // still spelled exactly the way they were, and the two new ones are the
        // only difference.
        let row = json["proposals"][0].as_object().expect("a proposal object");
        assert_eq!(row.len(), 9);
        for key in [
            "title",
            "target",
            "why",
            "journey",
            "axis",
            "size",
            "confidence",
        ] {
            assert!(row.contains_key(key), "`{key}` must not be renamed");
        }
    }

    #[test]
    fn a_phase_with_no_backlog_to_report_omits_both_lists_rather_than_claiming_empty() {
        for phase in ["reconcile", "report", "probation"] {
            let mut result = phase_stub();
            result.phase = phase;
            let json = serde_json::to_value(&result).expect("serialize");
            assert!(
                json.get("proposals").is_none(),
                "{phase} never looks at the backlog — reporting `[]` would claim it did"
            );
            assert!(json.get("declines").is_none(), "{phase}");
        }
    }

    // =========================================================================
    // The ideation night (§13.13) — authoring, the mode override, and the
    // provenance the two lists now carry
    // =========================================================================

    #[test]
    fn an_ideation_reading_appears_only_on_a_night_that_was_asked_to_author() {
        // Not asked: the key is absent. The same rule the two lists follow —
        // `[]` means "the night produced nothing", and there is no such thing
        // as an ideation reading for a night that never attempted one.
        let mut quiet = phase_stub();
        quiet.phase = "overnight";
        quiet.proposals = Some(Vec::new());
        quiet.declines = Some(Vec::new());
        let json = serde_json::to_value(&quiet).expect("serialize");
        assert!(
            json.get("ideation").is_none(),
            "a night nobody asked to ideate must not report `ran: false`"
        );

        // Asked, and it ran: four fields, and the count is the scan row's own.
        let mut authored = phase_stub();
        authored.phase = "overnight";
        authored.proposals = Some(Vec::new());
        authored.declines = Some(Vec::new());
        authored.ideation = Some(personas_engine::headless::Ideation::authored(
            "architecture-analyst,business-strategist",
            6,
        ));
        let json = serde_json::to_value(&authored).expect("serialize");
        assert_eq!(
            json["ideation"],
            serde_json::json!({
                "ran": true,
                "lens": "architecture-analyst,business-strategist",
                "authored": 6,
                "blocked": null,
            })
        );

        // Asked, and refused: never an error, always a reading — and `authored`
        // is null, because unmeasured is not zero.
        let mut blocked = phase_stub();
        blocked.phase = "overnight";
        blocked.proposals = Some(Vec::new());
        blocked.declines = Some(Vec::new());
        blocked.ideation = Some(personas_engine::headless::Ideation::blocked(
            personas_engine::headless::IDEATION_QUOTA_BLOCKED,
        ));
        let json = serde_json::to_value(&blocked).expect("serialize");
        assert_eq!(json["ran"], serde_json::json!(true), "the night still ran");
        assert_eq!(json["ideation"]["ran"], serde_json::json!(false));
        assert_eq!(json["ideation"]["authored"], serde_json::Value::Null);
        assert!(json["ideation"]["blocked"]
            .as_str()
            .expect("a blocked ideation says why")
            .contains("quota cooldown"));
    }

    #[test]
    fn the_ideation_reading_is_additive_and_moves_nothing_the_night_already_reported() {
        let mut overnight = phase_stub();
        overnight.phase = "overnight";
        overnight.counts = Some(serde_json::json!({
            "projects": 1, "dispatched": 0, "blocked": 1, "degraded": 0
        }));
        overnight.details = vec![serde_json::json!({ "id": "run-1" })];
        overnight.errors = vec!["proj-1: nope".to_string()];
        overnight.proposals = Some(Vec::new());
        overnight.declines = Some(Vec::new());
        let without = serde_json::to_value(&overnight).expect("serialize");

        overnight.ideation = Some(personas_engine::headless::Ideation::authored(
            "ux-reviewer",
            3,
        ));
        let with = serde_json::to_value(&overnight).expect("serialize");

        for key in [
            "phase",
            "ran",
            "durationMs",
            "counts",
            "details",
            "proposals",
            "declines",
            "errors",
        ] {
            assert_eq!(
                with[key], without[key],
                "`{key}` is deep-scanned by a driver already — ideation is added beside it"
            );
        }
        assert_eq!(
            with.as_object().unwrap().len(),
            without.as_object().unwrap().len() + 1
        );
    }

    #[test]
    fn no_phase_but_overnight_can_carry_an_ideation_reading() {
        for phase in ["reconcile", "report", "probation"] {
            let mut result = phase_stub();
            result.phase = phase;
            let json = serde_json::to_value(&result).expect("serialize");
            assert!(
                json.get("ideation").is_none(),
                "{phase} never authors — reporting an ideation reading would claim it did"
            );
        }
    }

    #[test]
    fn a_suggest_override_is_the_mode_that_triages_without_dispatching() {
        use crate::engine::autopilot::Capability;
        use personas_engine::headless::select_autopilot_override;

        // Why `autopilot: "suggest"` produces `dispatched: 0`: this is the same
        // matrix `run_project_night` consults, and it is the only thing between
        // an accepted idea and a fleet session. `suggest` grants the triage half
        // and refuses the dispatch half, so the night reaches
        // `blockedReason: "mode `suggest` triages but does not dispatch (N
        // accepted idea(s) left for the morning)"` — which is exactly the list
        // §13.12 then reports.
        let suggest = select_autopilot_override(Some("suggest"))
            .expect("a known mode")
            .expect("an override was asked for");
        assert!(suggest.allows(Capability::ScanAndTriage));
        assert!(
            !suggest.allows(Capability::DispatchFixes),
            "an ideation night that dispatched would be the night the override exists to avoid"
        );

        // And `full`, which the kp project actually stores, does dispatch —
        // the reason the override is needed at all rather than just asking
        // nicely.
        let full = select_autopilot_override(Some("full"))
            .expect("a known mode")
            .expect("an override was asked for");
        assert!(full.allows(Capability::DispatchFixes));

        // The override is a value passed into one night. Nothing here writes a
        // mode, and `run_overnight_now_core` reads `load_modes` and never
        // writes it back — so the project is the same after the tick as before.
        assert_eq!(
            select_autopilot_override(None),
            Ok(None),
            "a tick that names no mode runs the project's stored one"
        );
        assert!(
            select_autopilot_override(Some("suggets")).is_err(),
            "a typo is a 400, never a silently-full night"
        );
    }
}
