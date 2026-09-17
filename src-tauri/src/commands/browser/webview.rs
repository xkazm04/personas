//! Embedded webview commands (spark browser-control, WP2).
//!
//! Nine adapters over `browser_bridge::webview`. Each validates, makes one call
//! into the module, and maps the result — the shape
//! `.claude/rules/rust-backend.md` names ("a body over ~40 lines is a service
//! function sitting in the wrong file"). All of them are `async` and none of
//! them touches rusqlite.
//!
//! **These are the operator's hands, and they say so.** Every one builds a
//! `CallContext` with `AllowPolicy::Whitelist` and no session token — the
//! operator's UI has no MCP session and therefore no budget to charge — and
//! `browser_webview_navigate` runs as `Principal::Operator` whoever holds the
//! tab, because an operator typing an address is the operator (rule 5 still
//! refuses a tab an agent is holding; `browser_lease_revoke` is the door).
//! `browser_webview_open` takes an optional `principal` so the operator can
//! open a tab FOR an agent, which then holds its lease. Every agent path
//! reaches the same pages through `browser_bridge::backend`, under the
//! `CallContext` the MCP gate built.
//!
//! **Refusals become `AppError`.** A command answers a frontend, not a model,
//! and the frontend's contract is `AppError`'s `{error, kind, category}`. The
//! structured `BrowserRefusal` (reason code + hint) is the MCP surface's shape
//! and stays on the `BrowserBackend` path. Mapping is by cause, per
//! [`refusal_to_error`] — WP4 reads the message, never parses it.
//!
//! **There is no `browser_page_reply`.** athena-portable's page half answers
//! over a Tauri command; Personas' pages cannot reach one (remote origins are
//! ACL-checked and no app manifest grants them), so the answer channel is a
//! WebSocket to the shared `local_http` server —
//! `GET /browser-bridge/page-ws?tab&token`, handled in
//! `browser_bridge::webview::relay`. Nine commands here, all the operator's.
//!
//! **Wire names are camelCase.** Bare `#[tauri::command]`, like all 1,656
//! others in this tree — measured 2026-09-15 with
//! `scripts/lib/rustCommandDefs.mjs`, whose `ATTR` is the literal
//! `"#[tauri::command]"` (`:42`), so a `rename_all = "snake_case"` spelling is
//! invisible to `npm run check:command-registration` AND to
//! `scripts/generate-command-names.mjs`. athena-portable used `rename_all`;
//! every argument here is a single word, so the two spellings agree anyway —
//! the attribute is bare so the gates can see these commands at all.
//!
//! Registration in `lib.rs`'s `invoke_handler` is the Director's; this file
//! never edits it. See `docs/architecture/browser-control.md` §2a.

use personas_core::error::AppError;
use tauri::{AppHandle, Manager};

use crate::browser_bridge::backend::{CallContext, Principal, Refusal, RefusalCode};
use crate::browser_bridge::policy::AllowPolicy;
use crate::browser_bridge::webview::{layout, tabs};
use crate::db::models::PickedTarget;

/// One refusal as the frontend's typed error.
///
/// By cause, not by convenience: a policy refusal is `Forbidden` (the operator
/// can act on it in Browser > Whitelist), a malformed call is `Validation`, a
/// tab that is gone is `NotFound`, a page that would not answer is `Execution`.
/// The hint travels as the message because it is the only part a person can do
/// anything with.
fn refusal_to_error(refusal: Refusal) -> AppError {
    match refusal.reason {
        RefusalCode::OriginNotAllowed
        | RefusalCode::OriginDisabled
        | RefusalCode::RefusedLoosening
        | RefusalCode::BudgetExhausted
        | RefusalCode::TabLeased
        | RefusalCode::PendingApproval
        | RefusalCode::UserDenied => AppError::Forbidden(refusal.hint),
        RefusalCode::UnknownRef | RefusalCode::StalePage => AppError::NotFound(refusal.hint),
        RefusalCode::Timeout => AppError::Execution(refusal.hint),
        RefusalCode::TabCap
        | RefusalCode::ValidatorFailed
        | RefusalCode::UnsupportedPlatform
        | RefusalCode::NoBackend => AppError::Validation(refusal.hint),
    }
}

/// The context a command-driven action runs under.
///
/// Always `AllowPolicy::Whitelist` and never a session token: these commands
/// are the operator's own UI, which has no MCP session and therefore no budget
/// to charge. `principal` is who the operator is opening the tab FOR — an
/// agent handoff — and defaults to the operator themself.
fn operator(principal: Option<String>) -> Result<CallContext, AppError> {
    let principal = match principal {
        None => Principal::Operator,
        Some(raw) => Principal::parse(&raw)
            .ok_or_else(|| AppError::Validation(format!("`{raw}` is not a principal")))?,
    };
    Ok(CallContext {
        principal,
        policy: AllowPolicy::Whitelist,
    })
}

/// Open a tab on `url` and focus it. `principal` defaults to the operator.
#[tauri::command]
pub async fn browser_webview_open(
    app: AppHandle,
    url: String,
    principal: Option<String>,
) -> Result<u32, AppError> {
    let ctx = operator(principal)?;
    tabs::create(&app, &url, &ctx).map_err(refusal_to_error)
}

/// Close a tab and everything the relay held for it.
#[tauri::command]
pub async fn browser_webview_close(app: AppHandle, id: u32) -> Result<(), AppError> {
    tabs::close(&app, id).map_err(refusal_to_error)
}

/// Bring one tab to the front of the host window.
#[tauri::command]
pub async fn browser_webview_focus(app: AppHandle, id: u32) -> Result<(), AppError> {
    tabs::focus(&app, id).map_err(refusal_to_error)
}

/// Point a tab at a url, through the gate, as the operator.
#[tauri::command]
pub async fn browser_webview_navigate(
    app: AppHandle,
    id: u32,
    url: String,
) -> Result<(), AppError> {
    tabs::navigate(&app, id, &url, &CallContext::operator()).map_err(refusal_to_error)
}

/// One document back in this tab's own history.
#[tauri::command]
pub async fn browser_webview_back(app: AppHandle, id: u32) -> Result<(), AppError> {
    tabs::step_history(&app, id, true).map_err(refusal_to_error)
}

/// One document forward.
#[tauri::command]
pub async fn browser_webview_forward(app: AppHandle, id: u32) -> Result<(), AppError> {
    tabs::step_history(&app, id, false).map_err(refusal_to_error)
}

/// Every open tab. The same list the `browser-tabs` event carries — this is
/// what a freshly mounted route reads before the first event arrives.
#[tauri::command]
pub async fn browser_webview_list(app: AppHandle) -> Result<Vec<tabs::Tab>, AppError> {
    Ok(app
        .try_state::<tabs::Tabs>()
        .map(|tabs| tabs.list())
        .unwrap_or_default())
}

/// Where the page goes: the content slot React measured, in LOGICAL pixels
/// relative to the main window's client area.
///
/// Called on mount, on every resize of that slot and on every sidebar/panel
/// change. Idempotent and cheap — it moves one window.
#[tauri::command]
pub async fn browser_webview_set_viewport(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), AppError> {
    let layout = app
        .try_state::<layout::HostLayout>()
        .ok_or_else(|| AppError::Validation("the webview backend is not installed".into()))?;
    layout.set_viewport(layout::Viewport {
        x,
        y,
        width,
        height,
    });
    layout::apply(&app);
    Ok(())
}

/// Whether the route that owns the page host is on screen.
///
/// `false` on nav-away hides the host window and keeps every tab: leaving the
/// route is not closing anybody's page.
#[tauri::command]
pub async fn browser_webview_set_visible(app: AppHandle, visible: bool) -> Result<(), AppError> {
    let layout = app
        .try_state::<layout::HostLayout>()
        .ok_or_else(|| AppError::Validation("the webview backend is not installed".into()))?;
    layout.set_visible(visible);
    layout::apply(&app);
    Ok(())
}

// ---------------------------------------------------------------------------
// Twin toolbar (spark twin-browser-reply, WP1). WP0 STUBS — contract final,
// bodies are WP1's. All four run as the operator (`CallContext::operator()`),
// refuse a leased tab (rule 5) and an origin the gate refuses (rules 1-2).
// ---------------------------------------------------------------------------

/// Arm pick mode on a tab and wait for the user to click a writable element.
/// Answers with what the page gathered at click time. A cancel answers
/// `AppError::Validation("pick_cancelled")`.
#[tauri::command]
pub async fn browser_webview_pick_target(
    app: AppHandle,
    id: u32,
) -> Result<PickedTarget, AppError> {
    let _ = (app, id);
    Err(AppError::Validation(
        "browser_webview_pick_target is not implemented yet (WP1)".into(),
    ))
}

/// Disarm pick mode; the pending pick answers cancelled.
#[tauri::command]
pub async fn browser_webview_pick_cancel(app: AppHandle, id: u32) -> Result<(), AppError> {
    let _ = (app, id);
    Err(AppError::Validation(
        "browser_webview_pick_cancel is not implemented yet (WP1)".into(),
    ))
}

/// Put `text` into the field `ref` names (`page_fill`), replacing its value.
#[tauri::command]
pub async fn browser_webview_fill(
    app: AppHandle,
    id: u32,
    r#ref: String,
    text: String,
) -> Result<(), AppError> {
    let _ = (app, id, r#ref, text);
    Err(AppError::Validation(
        "browser_webview_fill is not implemented yet (WP1)".into(),
    ))
}

/// Submit the form the field `ref` sits in (`page_submit`).
#[tauri::command]
pub async fn browser_webview_submit(
    app: AppHandle,
    id: u32,
    r#ref: String,
) -> Result<(), AppError> {
    let _ = (app, id, r#ref);
    Err(AppError::Validation(
        "browser_webview_submit is not implemented yet (WP1)".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_refusal_code_maps_to_a_cause_and_keeps_its_hint() {
        // The closed vocabulary is WP0's and grows there. This is the test that
        // notices the day a code is added and lands in whichever arm happens to
        // be last — an `AppError::Internal` for a policy refusal would take the
        // Whitelist out of the message the operator reads.
        for code in RefusalCode::ALL {
            let refusal = Refusal::new(code);
            let hint = refusal.hint.clone();
            let error = refusal_to_error(refusal);
            assert!(
                error.to_string().contains(&hint),
                "{code:?} lost its hint on the way to the frontend"
            );
            assert!(
                !matches!(error, AppError::Internal(_) | AppError::External(_)),
                "{code:?} collapsed into an untyped error"
            );
        }
    }

    #[test]
    fn a_policy_refusal_is_forbidden_and_a_malformed_call_is_validation() {
        assert!(matches!(
            refusal_to_error(Refusal::new(RefusalCode::OriginNotAllowed)),
            AppError::Forbidden(_)
        ));
        assert!(matches!(
            refusal_to_error(Refusal::new(RefusalCode::ValidatorFailed)),
            AppError::Validation(_)
        ));
        assert!(matches!(
            refusal_to_error(Refusal::new(RefusalCode::UnknownRef)),
            AppError::NotFound(_)
        ));
    }

    #[test]
    fn an_omitted_principal_is_the_operator_and_a_bogus_one_is_refused() {
        let context = operator(None).expect("the default");
        assert_eq!(context.principal, Principal::Operator);
        assert_eq!(context.policy, AllowPolicy::Whitelist);

        assert_eq!(
            operator(Some("session:run-7".into())).unwrap().principal,
            Principal::Session("run-7".into())
        );
        assert!(
            operator(Some("root".into())).is_err(),
            "an invented principal is not one"
        );
    }
}
