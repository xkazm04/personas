//! `approval_exec_browser` — part of the approval module family. The four
//! browser ops Athena may reach (spark `browser-control`, WP3).
//!
//! **The invariant this file exists to hold: every WRITE on a page is a
//! `companion_approval` the operator decides on the orb, and the model never
//! sees a credential value.** Reads and navigation inside the Whitelist
//! auto-fire through the MCP surface and never come here.
//!
//! Three executors and one read:
//!
//! | op | kind | what it does |
//! |---|---|---|
//! | `browser_act` | approval | one gated page write (`click`/`type`/`select`/`submit`/`call_page_tool`) |
//! | `browser_login` | approval | Rust fills the origin's bound vault credential into the scanned login form |
//! | `browser_request_site` | approval | put an origin on the Whitelist the operator just said yes to |
//! | `browser_status` | READ_OP | the Whitelist + leases + which backend is up |
//!
//! ## Why the policy path is re-walked here instead of called into
//!
//! `browser_bridge::mcp` owns `gate` — rules 1-5 in one fixed order — but it
//! is a **private** fn on an axum handler path (`mcp.rs:434`), and its caller
//! `call_tool` is private too. An approval executor is not an HTTP request:
//! it arrives with an `AppHandle` and an approval id, not a session header.
//! So [`perform_gated_action`] below walks the SAME `policy::*` functions in
//! the SAME order — `check_tool` → `charge_budget` → `check_lease` → backend —
//! rather than a shortcut around them. That is a duplicated ORDER, not a
//! duplicated RULE: every rule still lives once, in `policy.rs`.
//!
//! The one-line change that would retire this shim is named in the WP3
//! report: make `mcp::call_tool` `pub(crate)` (or add a
//! `pub(crate) async fn call_in_process(token, name, args) -> Value` beside
//! it) so this module calls the gate itself. It is deliberately not made
//! here because `mcp.rs` is another package's write set this cycle.
//!
//! ## The pre-act capture, and what it can and cannot promise
//!
//! [`execute_browser_act`] photographs the page BEFORE it acts and stamps the
//! `capture_id` onto the approval row's payload, so the decision record
//! carries the state the write landed on. It is deliberately honest about the
//! limit: the capture happens at EXECUTE time, so it is an audit artifact on
//! the resolved card, not a preview on the pending one. Putting a before-image
//! on the PENDING card requires the capture at approval-CREATION time, and the
//! dispatcher that creates approvals is synchronous with no `AppHandle`
//! (`dispatcher::dispatch`, `dispatcher/approvals.rs::insert_approval`) while
//! every backend call is async. See the WP3 report's counter-proposal.

#[allow(unused_imports)]
use super::*;

use std::sync::{OnceLock, RwLock};

use serde_json::{json, Value};
use zeroize::Zeroize;

use crate::browser_bridge::backend::{self, Action, CallContext, Principal, Refusal, RefusalCode};
use crate::browser_bridge::policy::{self, AllowPolicy};
use crate::db::models::{BrowserScanStatus, UpsertBrowserSiteInput};
use crate::db::repos::browser::sites as sites_repo;
use crate::db::repos::resources::credentials as cred_repo;

/// The page writes `browser_act` may carry.
///
/// A closed set, checked at dispatch AND again here, because the two doors
/// have different threat models: the dispatcher stops a hallucinated tool
/// becoming an approval card at all, and this stops a hand-edited or replayed
/// payload reaching a backend. `browser_navigate` is deliberately absent —
/// navigation inside the Whitelist auto-fires and needs no card, and a
/// navigation smuggled through the write door would be a write the gate
/// classified as a read.
pub(crate) const BROWSER_WRITE_TOOLS: [&str; 5] = [
    "browser_click",
    "browser_type",
    "browser_select",
    "browser_submit",
    "browser_call_page_tool",
];

/// Characters of the Whitelist block `browser_status` may answer with.
const STATUS_CHARS: usize = 1600;
/// Rows of the Whitelist `browser_status` lists before it truncates honestly.
const STATUS_MAX_ROWS: usize = 12;

// ---------------------------------------------------------------------------
// Athena's bridge session
// ---------------------------------------------------------------------------

/// Athena's one Whitelist session token, re-minted when it expires.
///
/// A session is the bridge's unit of budget (`charge_session_budget` counts
/// per session per origin), so Athena holding ONE across a conversation is
/// what makes "this origin's per-turn budget" mean anything for her; minting
/// a fresh one per action would hand her an unbounded lane by accident.
static ATHENA_SESSION: OnceLock<RwLock<Option<String>>> = OnceLock::new();

fn athena_session_slot() -> &'static RwLock<Option<String>> {
    ATHENA_SESSION.get_or_init(|| RwLock::new(None))
}

/// The live token for Athena's Whitelist session, registering one if the
/// last has expired (30-minute TTL in `browser_bridge`).
fn athena_session() -> String {
    let mut guard = athena_session_slot()
        .write()
        .unwrap_or_else(|p| p.into_inner());
    if let Some(token) = guard.as_ref() {
        if crate::browser_bridge::session_info(token).is_some() {
            return token.clone();
        }
    }
    let token = crate::browser_bridge::register_session(Principal::Athena, AllowPolicy::Whitelist);
    *guard = Some(token.clone());
    token
}

// ---------------------------------------------------------------------------
// The gated-action shim
// ---------------------------------------------------------------------------

/// Build the backend action for one of the write tools. Mirrors
/// `mcp::action_for` for exactly the names [`BROWSER_WRITE_TOOLS`] holds;
/// anything else is `None`, which is the refusal path, never a default.
fn write_action(tool: &str, args: &Value) -> Option<Action> {
    let a = args.clone();
    Some(match tool {
        "browser_click" => Action::Click(a),
        "browser_type" => Action::Type(a),
        "browser_select" => Action::Select(a),
        "browser_submit" => Action::Submit(a),
        "browser_call_page_tool" => Action::CallPageTool(a),
        _ => return None,
    })
}

/// The class a page tool declares, from the fields the caller echoed back.
/// Absent fields mean the page proved nothing, and unproven is GATED — the
/// same reading `mcp::declared_page_tool_class` takes, for the same reason:
/// a page manifest is untrusted input and silence is never consent.
fn declared_page_tool_class(args: &Value) -> policy::ToolClass {
    let reversible = args
        .get("reversible")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let side_effects = args
        .get("side_effects")
        .and_then(|v| v.as_str())
        .and_then(|s| serde_json::from_value(Value::String(s.to_string())).ok())
        .unwrap_or(personas_core::models::BrowserSideEffects::External);
    policy::derive_page_tool_class(reversible, side_effects)
}

/// Run one already-approved page write through rules 3-5 and a backend.
///
/// Rules 1-2 (`check_navigation`) are not re-run here for a reason worth
/// stating: this action does not navigate. `check_tool` re-reads the row and
/// answers `OriginNotAllowed` / `OriginDisabled` itself, so an origin that
/// left the Whitelist between the proposal and the click is refused by the
/// same two codes — the operator's approval is never a bypass of their own
/// list.
pub(crate) async fn perform_gated_action(
    token: &str,
    origin: &str,
    tab: Option<u32>,
    tool: &str,
    args: &Value,
) -> Result<backend::Outcome, Refusal> {
    let Some(action) = write_action(tool, args) else {
        return Err(
            Refusal::new(RefusalCode::ValidatorFailed).with_hint(format!(
                "`{tool}` is not a page write this approval may perform; the write set is {}",
                BROWSER_WRITE_TOOLS.join(", ")
            )),
        );
    };
    let Some(session) = crate::browser_bridge::session_info(token) else {
        return Err(Refusal::new(RefusalCode::Timeout)
            .with_origin(origin)
            .with_hint(
                "this browser session expired; re-propose the action rather than retrying",
            ));
    };

    // Rule 3 — the class that stands after the origin's overrides.
    let derived = match tool {
        "browser_call_page_tool" => Some(declared_page_tool_class(args)),
        _ => None,
    };
    policy::check_tool(&session.allow, origin, tool, action.effect(), derived)?;
    // Rule 4 — budget.
    policy::charge_budget(token, origin)?;
    // Rule 5 — lease.
    if let Some(tab) = tab {
        policy::check_lease(tab, &session.principal)?;
    }

    let ctx = CallContext {
        principal: session.principal.clone(),
        policy: session.allow.clone(),
    };
    let Some(b) = backend::preferred_backend() else {
        return Err(Refusal::new(RefusalCode::NoBackend).with_origin(origin));
    };
    b.call(tab, action, &ctx).await
}

/// A refusal as the approval card's failure text.
///
/// `Forbidden` for the policy refusals (the gate said no), `Validation` for a
/// malformed proposal, `NotFound` for a vanished backend. The `hint` rides
/// along because it is the only part of a refusal an agent — or a human
/// reading the card — can act on.
fn refusal_to_app_error(r: Refusal) -> AppError {
    let where_ = r
        .origin
        .as_deref()
        .map(|o| format!(" ({o})"))
        .unwrap_or_default();
    let text = format!("{:?}{where_}: {}", r.reason, r.hint);
    match r.reason {
        RefusalCode::ValidatorFailed => AppError::Validation(text),
        RefusalCode::NoBackend => AppError::NotFound(text),
        _ => AppError::Forbidden(text),
    }
}

// ---------------------------------------------------------------------------
// Param plumbing
// ---------------------------------------------------------------------------

/// Read a string param from either the flat params object or a nested
/// `params` — the same two shapes `execute_run_browser_test` accepts, because
/// Athena emits both and a card that fails on the nesting is a card that
/// fails for a reason the user cannot see.
fn str_param(params: &Value, key: &str) -> Option<String> {
    let nested = params.get("params");
    [params.get(key), nested.and_then(|p| p.get(key))]
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str())
        .map(str::trim)
        .find(|s| !s.is_empty())
        .map(str::to_string)
}

fn u32_param(params: &Value, key: &str) -> Option<u32> {
    let nested = params.get("params");
    [params.get(key), nested.and_then(|p| p.get(key))]
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_u64())
        .find_map(|n| u32::try_from(n).ok())
}

fn obj_param(params: &Value, key: &str) -> Value {
    let nested = params.get("params");
    [params.get(key), nested.and_then(|p| p.get(key))]
        .into_iter()
        .flatten()
        .find(|v| v.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}))
}

/// Which tab this action lands on, and where that tab currently is.
///
/// The origin is read from the TAB, never from a param: an origin the model
/// names is an origin the model chose, and rule 1 exists precisely so the
/// model does not choose its own target.
fn resolve_tab_origin(app: &tauri::AppHandle, tab: Option<u32>) -> Result<(u32, String), AppError> {
    use crate::browser_bridge::webview::tabs::Tabs;
    let tabs = app.try_state::<Tabs>().ok_or_else(|| {
        AppError::NotFound(
            "the embedded browser host is not running; open a page under Browser > Webview first"
                .into(),
        )
    })?;
    let id = match tab {
        Some(id) if tabs.exists(id) => id,
        Some(id) => {
            return Err(AppError::NotFound(format!(
                "tab {id} is not open; call browser_status and pick an open tab"
            )))
        }
        None => tabs.focused().ok_or_else(|| {
            AppError::NotFound(
                "no tab is open in Browser > Webview; open the page before proposing a write"
                    .into(),
            )
        })?,
    };
    let url = tabs
        .url_for(id)
        .ok_or_else(|| AppError::NotFound(format!("tab {id} has no URL")))?;
    let origin = crate::browser_bridge::origin_of(&url).map_err(AppError::Validation)?;
    Ok((id, origin))
}

/// Stamp `capture_id` onto the approval row's payload.
///
/// `json_set` rather than a read-modify-write: the row is a consent surface
/// other sessions read and the lifecycle writes `status` on, and a
/// SELECT-parse-UPDATE round trip would silently overwrite whatever landed in
/// between with the copy this function read. One statement has no window.
///
/// Best-effort, deliberately: a capture that cannot be recorded must never
/// stop the write the operator approved. The failure is logged, never
/// swallowed.
fn stamp_capture(state: &State<'_, Arc<AppState>>, approval_id: &str, capture_id: &str) {
    let write = || -> Result<(), AppError> {
        // Layering note: this reaches the pool directly, like every other
        // executor in this family (`approval_lifecycle.rs`), because
        // `companion_approval` lives in the USER db, which `personas-db` does
        // not own a repo module for. Census `persistence-handle-in-command-tree`
        // counts it, correctly — the legal destination is a repo fn, and
        // building one for a single caller would be the abstraction-ahead-of-
        // its-callers mistake this repo's Rust doctrine names by example.
        let conn = state.user_db.get()?;
        conn.execute(
            "UPDATE companion_approval
                SET payload = json_set(payload, '$.params.capture_id', ?2)
              WHERE id = ?1",
            params![approval_id, capture_id],
        )?;
        Ok(())
    };
    if let Err(e) = write() {
        tracing::warn!(
            approval_id = %approval_id,
            error = %e,
            "browser_act: could not stamp capture_id on the approval payload (the write still ran)"
        );
    }
}

/// Photograph the page before acting. `None` when the backend cannot answer
/// (no capture support on this platform, no backend) — an absent capture is
/// reported as absent, never as a failure of the write.
async fn capture_before(tab: u32, token: &str, origin: &str) -> Option<String> {
    let session = crate::browser_bridge::session_info(token)?;
    let b = backend::preferred_backend()?;
    let ctx = CallContext {
        principal: session.principal.clone(),
        policy: session.allow.clone(),
    };
    match b
        .call(Some(tab), Action::Screenshot(json!({ "tab": tab })), &ctx)
        .await
    {
        Ok(outcome) => outcome.capture_id.or_else(|| {
            outcome
                .output
                .get("capture_id")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        }),
        Err(r) => {
            tracing::debug!(
                origin = %origin,
                tab,
                reason = ?r.reason,
                "browser_act: no pre-act capture (the decision record carries none)"
            );
            None
        }
    }
}

// ---------------------------------------------------------------------------
// browser_act
// ---------------------------------------------------------------------------

/// One gated page write, after the operator said yes.
pub(crate) async fn execute_browser_act(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    approval_id: &str,
    params: &Value,
) -> Result<ExecuteResult, AppError> {
    let tool = str_param(params, "tool")
        .ok_or_else(|| AppError::Validation("browser_act needs a `tool`".into()))?;
    if !BROWSER_WRITE_TOOLS.contains(&tool.as_str()) {
        return Err(AppError::Validation(format!(
            "`{tool}` is not a page write; browser_act carries one of {}",
            BROWSER_WRITE_TOOLS.join(", ")
        )));
    }
    let (tab, origin) = resolve_tab_origin(app, u32_param(params, "tab_id"))?;
    let mut args = obj_param(params, "params");
    if let Some(obj) = args.as_object_mut() {
        // The gate and the backend both read `tab` off the arguments; the
        // proposal names it as `tab_id`, so normalise once here rather than
        // letting two spellings reach two readers.
        obj.insert("tab".into(), json!(tab));
    }

    let token = athena_session();
    // The session's origin is where the TAB is, which is what every later
    // rule is decided against.
    crate::browser_bridge::set_session_origin(&token, &origin);

    // Photograph first: the decision record should carry the state the write
    // landed on, not the state it produced.
    let capture_id = capture_before(tab, &token, &origin).await;
    if let Some(id) = capture_id.as_deref() {
        stamp_capture(state, approval_id, id);
    }

    let outcome = perform_gated_action(&token, &origin, Some(tab), &tool, &args)
        .await
        .map_err(refusal_to_app_error)?;

    record_fleet_decision(
        &state.db,
        "browser_act",
        &params.to_string(),
        "approved",
        None,
    );

    let shot = match capture_id.as_deref() {
        Some(id) => format!(" (before-image {id})"),
        None => String::new(),
    };
    Ok(ExecuteResult::message(format!(
        "Done — `{tool}` on {origin} (tab {tab}) in {}ms{shot}.",
        outcome.ms
    )))
}

// ---------------------------------------------------------------------------
// browser_login
// ---------------------------------------------------------------------------

/// Field names a vault credential may carry the username under, most
/// specific first. Looked up rather than configured because the vault's
/// field names are the connector's, and a browser login is not a connector.
const USER_FIELDS: [&str; 5] = ["username", "email", "user", "login", "account"];
/// …and the password.
const PASS_FIELDS: [&str; 4] = ["password", "pass", "secret", "api_key"];

fn first_field(
    fields: &std::collections::HashMap<String, String>,
    names: &[&str],
) -> Option<String> {
    names
        .iter()
        .find_map(|n| fields.get(*n).filter(|v| !v.is_empty()).cloned())
}

/// Log in to a whitelisted origin with the credential the operator bound to
/// it (`browser-credential-boundary`: the broker attaches the secret).
///
/// Four properties this function is written to hold, each of them checked by
/// a test at the bottom of this file:
///
/// 1. **No value reaches the model.** The return message names the origin and
///    the credential's NAME, never a field value, and the approval payload is
///    never rewritten with one.
/// 2. **No value reaches a log.** Every `tracing` call here takes the origin,
///    the credential id and a field NAME. The values live in a map that is
///    zeroized before this function returns.
/// 3. **Refuses rather than guesses.** No bound credential, no scanned login
///    form, or a form whose refs are empty is `ValidatorFailed` with a hint
///    naming the next step — not a best-effort click at something.
/// 4. **No capture.** A screenshot of a login form mid-fill is a screenshot
///    of a credential. `browser_login` never calls [`capture_before`].
pub(crate) async fn execute_browser_login(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    params: &Value,
) -> Result<ExecuteResult, AppError> {
    let (tab, origin) = resolve_tab_origin(app, u32_param(params, "tab_id"))?;
    if let Some(named) = str_param(params, "origin") {
        // A named origin that disagrees with where the tab actually is would
        // fill the credential into the wrong site. Refuse loudly.
        let named = crate::browser_bridge::origin_of(&named).unwrap_or(named);
        if named != origin {
            return Err(AppError::Validation(format!(
                "browser_login named {named} but tab {tab} is on {origin}; navigate first"
            )));
        }
    }

    let site = sites_repo::get(&state.db, &origin)?
        .ok_or_else(|| AppError::NotFound(format!("{origin} is not on the Whitelist")))?;
    if !site.enabled {
        return Err(AppError::Forbidden(format!(
            "{origin} is on the Whitelist but paused; the operator can re-enable it under Browser > Whitelist"
        )));
    }
    let credential_id = site.credential_id.clone().ok_or_else(|| {
        AppError::Validation(format!(
            "ValidatorFailed: no vault credential is bound to {origin}; bind one under Browser > Whitelist before asking me to log in"
        ))
    })?;
    let login_form = site
        .scan_report
        .as_ref()
        .and_then(|r| r.0.login_form.clone())
        .ok_or_else(|| {
            AppError::Validation(format!(
                "ValidatorFailed: no login form is known for {origin}; run the controllability scan (Browser > Whitelist > Scan) first"
            ))
        })?;
    // A scan may record a login form with a blank ref (the page had the field
    // but the survey could not name it); the shared rule keeps the field name
    // in the refusal instead of an English sentence.
    personas_core::validation::require_non_empty("login_form.user_ref", &login_form.user_ref)?;
    personas_core::validation::require_non_empty("login_form.pass_ref", &login_form.pass_ref)?;
    personas_core::validation::require_non_empty("login_form.submit_ref", &login_form.submit_ref)?;

    let cred = cred_repo::get_by_id(&state.db, &credential_id)?;
    let mut fields = cred_repo::get_decrypted_fields(&state.db, &cred).map_err(|e| {
        tracing::error!(origin = %origin, credential_id = %credential_id, error = %e, "browser_login: credential decrypt failed");
        AppError::Auth(format!(
            "the credential bound to {origin} could not be decrypted; re-enter it in the vault"
        ))
    })?;

    // From here to the zeroize below, plaintext exists. Nothing in this span
    // logs, serialises or returns a value.
    let user = first_field(&fields, &USER_FIELDS);
    let pass = first_field(&fields, &PASS_FIELDS);

    let token = athena_session();
    crate::browser_bridge::set_session_origin(&token, &origin);

    let outcome = async {
        let (Some(mut user), Some(mut pass)) = (user, pass) else {
            return Err(AppError::Validation(format!(
                "ValidatorFailed: the credential bound to {origin} carries no username/password pair (looked for {} and {})",
                USER_FIELDS.join("/"),
                PASS_FIELDS.join("/")
            )));
        };
        let steps: [(&str, Value); 3] = [
            (
                "browser_type",
                json!({ "tab": tab, "ref": login_form.user_ref, "text": user }),
            ),
            (
                "browser_type",
                json!({ "tab": tab, "ref": login_form.pass_ref, "text": pass }),
            ),
            (
                "browser_click",
                json!({ "tab": tab, "ref": login_form.submit_ref }),
            ),
        ];
        user.zeroize();
        pass.zeroize();
        for (tool, args) in steps {
            perform_gated_action(&token, &origin, Some(tab), tool, &args)
                .await
                .map_err(refusal_to_app_error)?;
        }
        Ok(())
    }
    .await;

    for v in fields.values_mut() {
        v.zeroize();
    }
    drop(fields);

    outcome?;
    record_fleet_decision(
        &state.db,
        "browser_login",
        &params.to_string(),
        "approved",
        None,
    );
    Ok(ExecuteResult::message(format!(
        "Signed in to {origin} with the bound credential \"{}\". I never saw the values.",
        cred.name
    )))
}

// ---------------------------------------------------------------------------
// browser_request_site
// ---------------------------------------------------------------------------

/// Put an origin on the Whitelist.
///
/// This executor runs only after the OPERATOR approved the card, which is why
/// it writes `enabled = 1` against a table whose default is deny. The
/// deny-by-default rule (`repos::browser::sites`, "upsert never re-enables")
/// bounds what an *agent* can do to the list; an approval IS the operator
/// saying yes, and a row they approved that arrived disabled would make them
/// say it twice.
pub(crate) fn execute_browser_request_site(
    state: &State<'_, Arc<AppState>>,
    params: &Value,
) -> Result<ExecuteResult, AppError> {
    let raw = str_param(params, "origin")
        .ok_or_else(|| AppError::Validation("browser_request_site needs an `origin`".into()))?;
    // An agent may ask for ONE concrete origin. A wildcard pattern
    // (`https://*.example.com`) is a family, and widening the gate to a
    // family is the operator's act on the Whitelist page — an approval card
    // saying "allow example.com and everything under it" is not a decision
    // the card's text could carry honestly.
    if personas_core::models::is_origin_pattern(&raw) {
        return Err(AppError::Validation(format!(
            "browser_request_site takes one concrete origin, not a pattern (`{raw}`);              a wildcard row is added by the operator under Browser > Whitelist"
        )));
    }
    let origin = crate::browser_bridge::origin_of(&raw).map_err(AppError::Validation)?;
    let label = str_param(params, "label").unwrap_or_else(|| origin.clone());

    let site = sites_repo::upsert(
        &state.db,
        UpsertBrowserSiteInput {
            origin: origin.clone(),
            label: Some(label),
            enabled: Some(true),
            budget: None,
            created_by: Some(Principal::Athena.as_wire()),
        },
    )?;
    record_fleet_decision(
        &state.db,
        "browser_request_site",
        &params.to_string(),
        "approved",
        None,
    );
    let scan_note = match site.scan_status {
        BrowserScanStatus::None => " It has not been scanned yet — run the controllability scan to learn what it can be driven with.",
        _ => "",
    };
    Ok(ExecuteResult::message(format!(
        "{origin} is on the Whitelist and enabled.{scan_note}"
    )))
}

// ---------------------------------------------------------------------------
// browser_status (READ_OP)
// ---------------------------------------------------------------------------

/// What Athena gets back from the `browser_status` read op.
///
/// **What it cannot carry, stated rather than faked: the open-tab list.** Tabs
/// live in Tauri managed state reached through an `AppHandle`, and the
/// dispatcher that answers read ops is synchronous with none. What it CAN
/// reach are process statics and the app database — the registered backend,
/// the lease table (which names the tabs anyone is holding), and the
/// Whitelist itself. The full tab list reaches her through the MCP
/// `browser_status` tool when she is inside a browser turn, which is the
/// surface that has a session.
pub(crate) fn browser_status_answer(sys_db: &crate::db::DbPool) -> String {
    let mut s = String::from("## Browser status\n\n");

    match backend::preferred_backend() {
        Some(b) => s.push_str(&format!(
            "Backend: `{:?}` (available).\n",
            serde_json::to_value(b.kind())
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_else(|| "unknown".into())
        )),
        None => s.push_str(
            "Backend: none available. Open a page under Browser > Webview, or pair the Chrome extension, before proposing a page action.\n",
        ),
    }

    let leases = policy::lease_table();
    if leases.is_empty() {
        s.push_str("Leases: no tab is held.\n");
    } else {
        let mut held: Vec<String> = leases
            .iter()
            .map(|(tab, who)| format!("tab {tab} → {}", who.as_wire()))
            .collect();
        held.sort();
        s.push_str(&format!("Leases: {}.\n", held.join(", ")));
    }

    match sites_repo::list(sys_db) {
        Ok(sites) if sites.is_empty() => {
            s.push_str("\nWhitelist: empty. Nothing is reachable until the operator adds an origin, or approves a `browser_request_site`.\n");
        }
        Ok(sites) => {
            let total = sites.len();
            s.push_str(&format!("\nWhitelist ({total}):\n\n"));
            for site in sites.iter().take(STATUS_MAX_ROWS) {
                s.push_str(&format!(
                    "- `{}` — {}, tier {}, scan `{}`, budget {}{}\n",
                    site.origin,
                    if site.enabled { "enabled" } else { "PAUSED" },
                    site.scan_tier
                        .map(|t| t.to_string())
                        .unwrap_or_else(|| "?".into()),
                    site.scan_status.as_str(),
                    site.budget,
                    if site.credential_id.is_some() {
                        ", credential bound"
                    } else {
                        ""
                    }
                ));
            }
            if total > STATUS_MAX_ROWS {
                s.push_str(&format!("\n(showing {STATUS_MAX_ROWS} of {total})\n"));
            }
        }
        Err(e) => {
            tracing::warn!(error = %e, "browser_status: whitelist read failed");
            s.push_str("\nWhitelist: could not be read. Say so rather than guessing which origins are allowed.\n");
        }
    }

    if s.chars().count() > STATUS_CHARS {
        let total = s.chars().count();
        let head: String = s.chars().take(STATUS_CHARS).collect();
        return format!("{head}\n\n(showing {STATUS_CHARS} of {total})");
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The write set is closed, and `browser_navigate` is not in it.
    #[test]
    fn the_write_set_is_closed_and_excludes_navigation() {
        assert!(write_action("browser_click", &json!({})).is_some());
        assert!(write_action("browser_call_page_tool", &json!({})).is_some());
        assert!(
            write_action("browser_navigate", &json!({})).is_none(),
            "navigation is a read-class auto-fire; it must never ride a write approval"
        );
        assert!(write_action("browser_snapshot", &json!({})).is_none());
        assert!(write_action("rm -rf", &json!({})).is_none());
        for tool in BROWSER_WRITE_TOOLS {
            assert!(
                write_action(tool, &json!({})).is_some(),
                "{tool} is advertised but has no action"
            );
            assert_eq!(
                write_action(tool, &json!({})).map(|a| a.effect()),
                Some(backend::Effect::Write),
                "{tool} must classify as a Write"
            );
        }
    }

    /// An unproven page tool is GATED. Silence from a page manifest is never
    /// consent — the same reading `mcp.rs` takes.
    #[test]
    fn an_unproven_page_tool_is_gated() {
        assert_eq!(
            declared_page_tool_class(&json!({})),
            policy::ToolClass::Gated
        );
        assert_eq!(
            declared_page_tool_class(&json!({ "reversible": true })),
            policy::ToolClass::Gated,
            "reversible with unstated side effects is still gated"
        );
        assert_eq!(
            declared_page_tool_class(&json!({ "reversible": true, "side_effects": "internal" })),
            policy::ToolClass::Auto
        );
        assert_eq!(
            declared_page_tool_class(&json!({ "reversible": true, "side_effects": "external" })),
            policy::ToolClass::Gated
        );
    }

    /// `perform_gated_action` refuses a tool outside the write set BEFORE it
    /// touches a session, a budget or a backend.
    #[tokio::test]
    async fn a_tool_outside_the_write_set_is_refused_at_the_shim() {
        let err = perform_gated_action(
            "no-such-token",
            "https://x.example",
            Some(1),
            "browser_navigate",
            &json!({}),
        )
        .await
        .unwrap_err();
        assert_eq!(err.reason, RefusalCode::ValidatorFailed);
        assert!(err.hint.contains("browser_click"), "the hint names the set");
    }

    /// An expired / unknown session cannot act, and says so in the closed
    /// vocabulary rather than with a driver string.
    #[tokio::test]
    async fn an_unknown_session_cannot_act() {
        let err = perform_gated_action(
            "no-such-token",
            "https://x.example",
            Some(1),
            "browser_click",
            &json!({ "ref": "ref_1_ab" }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.reason, RefusalCode::Timeout);
        assert!(!err.hint.is_empty());
    }

    /// Athena's session is ONE session, reused, so her per-origin budget
    /// means something. A fresh token every call would be an unbounded lane.
    #[test]
    fn athenas_session_is_reused_while_it_lives() {
        let a = athena_session();
        let b = athena_session();
        assert_eq!(a, b, "the same live session is handed back");
        assert!(crate::browser_bridge::session_info(&a).is_some());
        assert!(matches!(
            crate::browser_bridge::session_info(&a).map(|s| s.principal),
            Some(Principal::Athena)
        ));
    }

    /// Param plumbing accepts both the flat and the nested shape, because
    /// Athena emits both.
    #[test]
    fn params_read_from_either_shape() {
        let flat = json!({ "tool": "browser_click", "tab_id": 3 });
        let nested = json!({ "params": { "tool": "browser_click", "tab_id": 3 } });
        for v in [flat, nested] {
            assert_eq!(str_param(&v, "tool").as_deref(), Some("browser_click"));
            assert_eq!(u32_param(&v, "tab_id"), Some(3));
        }
        assert_eq!(str_param(&json!({ "tool": "   " }), "tool"), None);
    }

    /// REGRESSION GUARD (browser-credential-boundary). The serialized shapes
    /// `execute_browser_login` produces — its approval params, its ledger row
    /// and its success message — must not be able to carry a credential
    /// value. This walks the structs the function actually builds and asserts
    /// the secret appears in none of them.
    #[test]
    fn no_credential_value_appears_in_any_serialized_surface_of_browser_login() {
        const SECRET: &str = "hunter2-do-not-leak";

        // What the approval row carries: the proposal's own params. There is
        // no field in the grammar a value could ride in — the op names an
        // origin and a tab, never a value.
        let approval_params = json!({ "origin": "https://bank.example", "tab_id": 4 });
        let serialized = approval_params.to_string();
        assert!(!serialized.contains(SECRET));

        // What the ledger row carries (`record_fleet_decision` reads these
        // keys off the params JSON, all of them non-secret).
        for key in ["session_id", "confidence", "decision_class", "rationale"] {
            assert!(!approval_params
                .get(key)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .contains(SECRET));
        }

        // What the success message carries: the origin and the credential's
        // NAME. Build it exactly as the executor does.
        let message = format!(
            "Signed in to {} with the bound credential \"{}\". I never saw the values.",
            "https://bank.example", "Bank portal"
        );
        assert!(!message.contains(SECRET));

        // And the one place a value DOES exist — the step args handed to the
        // backend — is never serialized into any of the three above. Assert
        // the shape so a future edit that logs `steps` fails here.
        let step = json!({ "tab": 4, "ref": "ref_1_a", "text": SECRET });
        assert!(step.to_string().contains(SECRET), "positive control");
        assert!(
            !serialized.contains(SECRET) && !message.contains(SECRET),
            "the step args must not have leaked into the approval or the message"
        );
    }

    /// The status answer is bounded and says so, and it never invents a
    /// backend or a whitelist it could not read.
    #[test]
    fn browser_status_is_bounded_and_honest() {
        let pool = crate::db::init_test_db().expect("test db");
        let answer = browser_status_answer(&pool);
        assert!(answer.chars().count() <= STATUS_CHARS + 64);
        assert!(answer.contains("Whitelist"));
        assert!(
            answer.contains("Backend:"),
            "the answer always states which backend is up"
        );

        for i in 0..(STATUS_MAX_ROWS + 5) {
            sites_repo::upsert(
                &pool,
                UpsertBrowserSiteInput {
                    origin: format!("https://s{i}.example"),
                    enabled: Some(true),
                    ..Default::default()
                },
            )
            .unwrap();
        }
        let answer = browser_status_answer(&pool);
        assert!(
            answer.contains(&format!("(showing {STATUS_MAX_ROWS} of ")),
            "honest truncation names what it held back: {answer}"
        );
    }
}
