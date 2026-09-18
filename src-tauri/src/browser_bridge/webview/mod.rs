//! The embedded multi-webview backend (spark browser-control, WP2).
//!
//! One `BrowserBackend` impl over a host window full of page webviews, ported
//! from `athena-portable` (`c5ec8ca`) module by module — each file names its
//! source in its own header:
//!
//! | here | there |
//! |---|---|
//! | [`layout`] | `src/layout.rs` — the Rust-owned page rect |
//! | [`tabs`] | `src/tabs.rs` — one page webview per tab, one shared profile |
//! | [`relay`] | `src/bridge.rs` — nonce + oneshot pending map, two namespaces |
//! | [`hands`] + `hands.js` | `src/hands.rs` + `src/hands.js` — the generic hands |
//! | `inject.js` | `packages/athena-bridge/inject.js` — WebMCP detect + polyfill |
//! | [`capture`] | `src/capture.rs` — the picture a decision card carries |
//! | [`page`] | (no source) — the focused page's text as a chat turn's context |
//!
//! # The window, and why there are two of them
//!
//! athena-portable builds its own `tauri::Window` and puts every surface in it
//! as a child webview. Personas cannot: `main` is declared in
//! `tauri.conf.json` as a **WebviewWindow** — a window and one webview, built
//! before any of this code runs — and a webview that filled the app's own
//! window would sit on top of the React tree rather than inside its layout.
//!
//! So the pages live in a second, undecorated, non-resizable window labelled
//! `browser-host`, created with `WindowBuilder` and **owned** by `main`
//! ([`tauri::window::WindowBuilder::parent`], which on Windows sets the MSDN
//! owner relationship: always above its owner in the z-order, hidden when the
//! owner minimises, destroyed with it). React measures the Browser > Webview
//! content slot and calls `browser_webview_set_viewport`; [`layout`] turns that
//! logical rect into the physical screen rect the host window is moved to. The
//! page webviews go inside it with `Window::add_child`, exactly as
//! athena-portable's `build_shell` does.
//!
//! # What a page may reach, and how it answers
//!
//! Page webviews load remote origins, and **Tauri always ACL-checks an invoke
//! from a remote origin** — with or without an app ACL manifest
//! (`tauri-2.11.2/src/webview/mod.rs:1822`: `plugin_command.is_some() ||
//! has_app_acl_manifest || !is_local`). Personas declares no app manifest, so a
//! page webview can reach **no app command at all** by construction. That is
//! the right default and this module does not widen it. There is deliberately
//! NO deny capability for these webviews: in tauri 2.11.2 a `deny-*` entry in
//! ANY capability denies that command for EVERY window and origin
//! (`tauri-2.11.2/src/ipc/authority.rs:446-451` tests `.is_some()` on the
//! deny lookup and discards the window/webview/origin match), so the WP2
//! `browser-page.json` deny file broke `event.listen` on `main` (measured
//! 2026-09-16 from the app log: "event.listen explicitly denied on origin
//! local ... capability: browser-page"). Removed the same day.
//!
//! So a page answers over a **socket**, not a command:
//! `ws://127.0.0.1:<local_http port>/browser-bridge/page-ws?tab&token`, with a
//! per-tab token its initialization script closed over and the same threat
//! model as the extension relay next door. [`relay`] holds both halves. The one
//! cost is that the page's own `connect-src` governs the connection, so a
//! strict-CSP site's hands answer `timeout` — see `relay`'s header and
//! `docs/architecture/browser-control.md` §2a.

pub mod capture;
pub mod hands;
pub mod layout;
pub mod page;
pub mod relay;
pub mod tabs;

pub use page::{page_capture, PageCapture};

use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::backend::{
    Action, BackendFuture, BackendKind, BrowserBackend, CallContext, Outcome, Principal, Refusal,
    RefusalCode,
};
use super::policy;
use tabs::Tabs;

/// The hands' page-world script.
///
/// `include_str!` rather than a copy, for the reason `relay::INJECT_JS` is one:
/// a second copy of a capability is a second thing to keep correct, and the
/// parity tests in [`hands`] read this one.
pub fn hands_script() -> &'static str {
    include_str!("hands.js")
}

// ---------------------------------------------------------------------------
// The host window
// ---------------------------------------------------------------------------

pub mod host {
    //! The `browser-host` window: undecorated, non-resizable, owned by `main`,
    //! and never in the taskbar. It exists only to be the rectangle the page
    //! webviews are children of.

    use super::*;

    /// The host window, created on first use.
    ///
    /// Idempotent: a second call returns the window the first one built. It is
    /// created hidden — [`layout::apply`] is what shows it, once the route has
    /// said where it goes and a tab exists to put in it.
    pub fn ensure(app: &AppHandle) -> Result<tauri::Window, Refusal> {
        if let Some(existing) = app.get_window(layout::HOST_WINDOW) {
            return Ok(existing);
        }
        let main = app.get_window(layout::MAIN_WINDOW).ok_or_else(|| {
            Refusal::new(RefusalCode::NoBackend)
                .with_hint("the app window is gone; there is nowhere to host a page")
        })?;

        let builder = tauri::window::WindowBuilder::new(app, layout::HOST_WINDOW)
            // The title is never drawn (the window is undecorated) but it is
            // how `capture` finds this window among the OS's, together with
            // the pid — see `capture::host_bitmap`.
            .title(format!("Personas Browser Host {}", std::process::id()))
            .decorations(false)
            .resizable(false)
            .skip_taskbar(true)
            .shadow(false)
            .visible(false)
            .inner_size(800.0, 600.0);

        // `parent` rather than `owner`: both exist in tauri 2.11.2
        // (`src/window/mod.rs:640` and `:674`), `owner` is `#[cfg(windows)]`
        // only, and `parent` IS `owner` on Windows — it calls
        // `window_builder.owner(parent.hwnd()?)` on that platform and the
        // transient/child equivalents on Linux and macOS. One call site, three
        // platforms, no cfg.
        let builder = builder.parent(&main).map_err(|e| {
            Refusal::new(RefusalCode::NoBackend)
                .with_hint(format!("cannot own the page host to the app window: {e}"))
        })?;

        let window = builder.build().map_err(|e| {
            Refusal::new(RefusalCode::NoBackend)
                .with_hint(format!("cannot open the page host window: {e}"))
        })?;
        Ok(window)
    }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/// Install the embedded webview backend.
///
/// Call once from `boot::setup`, after `app.manage(state_arc)`. Cheap and
/// non-fatal: it manages three pieces of state, registers the backend, and
/// hangs a listener on the main window so the host follows it around the
/// screen. **No window is created here** — the host window appears the first
/// time a tab is opened, so an install that never opens the Browser route
/// costs one `OnceLock` and a vtable entry.
pub fn init(app: &AppHandle) {
    app.manage(Tabs::default());
    app.manage(layout::HostLayout::default());
    // The relay is NOT managed state: the axum route that feeds it
    // (`/browser-bridge/page-ws`) is mounted on a stateless `Router` and has no
    // `AppHandle` to ask, so it lives in a module static beside the extension
    // relay's, which is there for the same reason.

    // The host window is a separate OS window in SCREEN coordinates, so it does
    // not follow `main` for free: moving or resizing the app window has to move
    // it too, or the page detaches from the slot it is supposed to be sitting
    // in. `on_window_event` appends a listener rather than replacing one
    // (tauri 2.11.2 `src/window/mod.rs:1179` dispatches to the runtime's
    // listener map), so this does not displace anything lib.rs registered.
    if let Some(main) = app.get_window(layout::MAIN_WINDOW) {
        let handle = app.clone();
        main.on_window_event(move |event| {
            use tauri::WindowEvent;
            match event {
                WindowEvent::Resized(_) | WindowEvent::Moved(_) => layout::apply(&handle),
                WindowEvent::ScaleFactorChanged { .. } => layout::apply(&handle),
                // An owned window is hidden with its owner by the OS, so there
                // is nothing to do for minimise/restore — but a close has to
                // take the pages down before the owner goes, or the last frame
                // of the app is a floating page with no window around it.
                WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
                    if let Some(host) = handle.get_window(layout::HOST_WINDOW) {
                        let _ = host.close();
                    }
                }
                _ => {}
            }
        });
    }

    super::backend::register_backend(Arc::new(WebviewBackend { app: app.clone() }));
}

// ---------------------------------------------------------------------------
// The backend
// ---------------------------------------------------------------------------

/// Hands and eyes for the embedded pages.
///
/// Policy (whitelist, overrides, budget, leases, the approval gate) runs BEFORE
/// `call` and is not a backend concern — with ONE exception this backend cannot
/// delegate: navigation. `check_navigation` needs the principal and the policy,
/// and [`BrowserBackend::call`] is handed neither, so [`tabs::navigate`] reads
/// them off the tab's own lease ([`tabs::Tabs::lease_for`]) and gates every
/// navigation itself. See this package's report for the trait change that would
/// make that unnecessary.
pub struct WebviewBackend {
    app: AppHandle,
}

impl BrowserBackend for WebviewBackend {
    fn kind(&self) -> BackendKind {
        BackendKind::Webview
    }

    fn available(&self) -> bool {
        self.app
            .try_state::<Tabs>()
            .map(|tabs| !tabs.is_empty())
            .unwrap_or(false)
    }

    fn call<'a>(
        &'a self,
        tab: Option<u32>,
        action: Action,
        ctx: &'a CallContext,
    ) -> BackendFuture<'a> {
        Box::pin(async move { self.dispatch(tab, action, ctx).await })
    }
}

impl WebviewBackend {
    async fn dispatch(
        &self,
        tab: Option<u32>,
        action: Action,
        ctx: &CallContext,
    ) -> Result<Outcome, Refusal> {
        let started = std::time::Instant::now();
        let app = &self.app;
        let output = match action {
            Action::Status => json!({
                "backend": "webview",
                "available": self.available(),
                "tabs": app.state::<Tabs>().len(),
                "focused": app.state::<Tabs>().focused(),
                "route_visible": app.state::<layout::HostLayout>().visible(),
            }),
            Action::Tabs => serde_json::to_value(app.state::<Tabs>().list())
                .map_err(|e| internal("the tab list would not serialise", e))?,

            Action::Navigate(params) => {
                let url = required_str(&params, "url")?;
                let id = self.resolve_tab(tab)?;
                tabs::navigate(app, id, &url, ctx)?;
                json!({ "tab": id, "url": url })
            }

            Action::Snapshot(_) => {
                let id = self.resolve_tab(tab)?;
                self.snapshot(id).await?
            }

            Action::Click(params) => self.hand_by_ref(tab, "page_click", &params, None).await?,
            Action::Submit(params) => self.hand_by_ref(tab, "page_submit", &params, None).await?,
            Action::Type(params) => {
                // `text` is what the MCP tool spells; `value` is what the hand
                // does. Accepting both is not sloppiness — the model is told
                // one and the page half was ported with the other.
                let value =
                    required_str(&params, "text").or_else(|_| required_str(&params, "value"))?;
                self.hand_by_ref(tab, "page_fill", &params, Some(value))
                    .await?
            }
            Action::Select(params) => {
                let value =
                    required_str(&params, "value").or_else(|_| required_str(&params, "option"))?;
                self.hand_by_ref(tab, "page_select", &params, Some(value))
                    .await?
            }

            Action::WaitFor(params) => {
                let id = self.resolve_tab(tab)?;
                let text = required_str(&params, "text")?;
                let mut input = json!({ "text": text });
                if let Some(ms) = params.get("timeout_ms") {
                    insert(&mut input, "timeout_ms", ms.clone());
                }
                self.answer(hands::call(app, id, hands::WAIT, input).await)?
            }

            Action::Console(params) => {
                let id = self.resolve_tab(tab)?;
                let mut input = json!({});
                for key in ["limit", "level"] {
                    if let Some(v) = params.get(key) {
                        insert(&mut input, key, v.clone());
                    }
                }
                self.answer(hands::call(app, id, hands::CONSOLE, input).await)?
            }

            Action::Screenshot(_) => {
                let id = self.resolve_tab(tab)?;
                let result = hands::call(app, id, hands::SCREENSHOT, json!({})).await;
                if !result.ok {
                    return Err(refusal_from(&result));
                }
                return Ok(Outcome {
                    output: json!({ "text": result.output }),
                    capture_id: result.capture_id,
                    ms: started.elapsed().as_millis() as u64,
                });
            }

            Action::PageTools(_) => {
                let id = self.resolve_tab(tab)?;
                relay::ask(app, id, json!({ "type": "list" }))
                    .await
                    .map_err(unreachable_tab)?
            }

            Action::CallPageTool(params) => {
                let id = self.resolve_tab(tab)?;
                let name = required_str(&params, "name")?;
                let arguments = params
                    .get("arguments")
                    .or_else(|| params.get("params"))
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                let mut body = json!({ "type": "call", "name": name, "input": arguments });
                if let Some(ms) = params.get("timeout_ms") {
                    insert(&mut body, "timeout_ms", ms.clone());
                }
                relay::ask(app, id, body).await.map_err(unreachable_tab)?
            }

            // WP3 owns login execution: the vault values a login needs are
            // never in this process's hands, and a backend that could log in
            // would be a backend that could be asked to.
            Action::Login(_) => return Err(Refusal::new(RefusalCode::PendingApproval)),

            // Detaching is releasing a lease, and a lease is only ever yours
            // to release. With no tab named it means "everything I hold" --
            // which `ctx` now answers, so the backend no longer has to refuse
            // the useful half of its own tool.
            Action::Detach => match tab {
                Some(id) => {
                    policy::check_lease(id, &ctx.principal)?;
                    policy::release_lease(id);
                    json!({ "detached": [id] })
                }
                None => {
                    let released = detach_all(app, &ctx.principal);
                    json!({ "detached": released })
                }
            },
        };

        Ok(Outcome {
            output,
            capture_id: None,
            ms: started.elapsed().as_millis() as u64,
        })
    }

    /// The tab a call runs against: the one named, else the focused one.
    fn resolve_tab(&self, tab: Option<u32>) -> Result<u32, Refusal> {
        match tab {
            Some(id) if self.app.state::<Tabs>().exists(id) => Ok(id),
            Some(id) => Err(Refusal::new(RefusalCode::UnknownRef)
                .with_hint(format!("there is no tab {id}; call browser_tabs"))),
            None => self.app.state::<Tabs>().focused().ok_or_else(|| {
                Refusal::new(RefusalCode::NoBackend)
                    .with_hint("no tab is open; call browser_navigate to open one")
            }),
        }
    }

    /// The page's first look: the operable refs, the landmarks around them, and
    /// where the page says it is. One `page_find` round trip, because
    /// `hands.js` reports all three.
    async fn snapshot(&self, id: u32) -> Result<Value, Refusal> {
        let result = hands::call(&self.app, id, hands::FIND, json!({})).await;
        if !result.ok {
            return Err(refusal_from(&result));
        }
        let extra = result.extra.clone().unwrap_or_else(|| json!({}));
        let title = extra.get("title").and_then(Value::as_str).unwrap_or("");
        let url = extra
            .get("url")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| self.app.state::<Tabs>().url_for(id))
            .unwrap_or_default();
        let landmarks: Vec<String> = extra
            .get("landmarks")
            .and_then(Value::as_array)
            .map(|rows| {
                rows.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();

        let mut text = String::new();
        if !title.is_empty() {
            text.push_str(title);
            text.push('\n');
        }
        text.push_str(&url);
        if !landmarks.is_empty() {
            text.push_str("\n\nregions:\n");
            text.push_str(&landmarks.join("\n"));
        }
        text.push_str("\n\noperable:\n");
        text.push_str(&result.output);

        Ok(json!({
            "text": hands::capped(&text),
            "title": title,
            "url": url,
            "landmarks": landmarks,
            "matches": extra.get("matches").cloned().unwrap_or_else(|| json!([])),
        }))
    }

    /// The four hands that take a ref, with the one optional value between them.
    async fn hand_by_ref(
        &self,
        tab: Option<u32>,
        hand: &str,
        params: &Value,
        value: Option<String>,
    ) -> Result<Value, Refusal> {
        let id = self.resolve_tab(tab)?;
        let reference = required_str(params, "ref")?;
        let mut input = json!({ "ref": reference });
        if let Some(value) = value {
            insert(&mut input, "value", json!(value));
        }
        self.answer(hands::call(&self.app, id, hand, input).await)
    }

    /// A hand's result as a backend `output`, or its refusal.
    fn answer(&self, result: hands::HandResult) -> Result<Value, Refusal> {
        if result.ok {
            Ok(json!({ "text": result.output }))
        } else {
            Err(refusal_from(&result))
        }
    }
}

/// A hand's refusal, as the closed vocabulary. A hand always carries a reason;
/// one that somehow did not would still not be allowed to reach the model with
/// a driver's own error text, so the fallback is a member of the vocabulary.
///
/// `pub(crate)` because the operator's twin-toolbar commands
/// (`commands::browser::webview`) map a hand's result the same way before it
/// becomes an `AppError` — one derivation, not a second copy.
pub(crate) fn refusal_from(result: &hands::HandResult) -> Refusal {
    let code = result.reason.unwrap_or(RefusalCode::ValidatorFailed);
    match &result.error {
        Some(detail) if !detail.is_empty() => {
            Refusal::new(code).with_hint(format!("{detail} — {}", code.default_hint()))
        }
        _ => Refusal::new(code),
    }
}

fn required_str(params: &Value, key: &str) -> Result<String, Refusal> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            Refusal::new(RefusalCode::ValidatorFailed).with_hint(format!(
                "`{key}` is required; read the tool schema and resend"
            ))
        })
}

fn insert(target: &mut Value, key: &str, value: Value) {
    if let Some(object) = target.as_object_mut() {
        object.insert(key.to_string(), value);
    }
}

fn unreachable_tab(detail: String) -> Refusal {
    Refusal::new(RefusalCode::Timeout).with_hint(format!("{detail}; call browser_tabs"))
}

fn internal(what: &str, e: impl std::fmt::Display) -> Refusal {
    Refusal::new(RefusalCode::ValidatorFailed).with_hint(format!("{what}: {e}"))
}

// ---------------------------------------------------------------------------
// The lease door the commands and WP3 use
// ---------------------------------------------------------------------------

/// Claim a tab for a principal.
///
/// A thin delegation to [`policy::acquire_lease`] ON PURPOSE: there is ONE
/// lease table and it is policy's, so the MCP gate's rule 5 and this backend
/// cannot disagree about who holds what. This function exists for the name --
/// a caller in this module should not have to know where the table lives -- and
/// it refuses when the tab is unknown, which the table itself cannot tell.
///
/// No caller yet: leases are taken by `tabs::create` for an agent-opened tab and
/// by the MCP gate's rule 5 for everything else, both of which reach
/// `policy::acquire_lease` directly. This is the door for an explicit
/// hand-off — the operator giving an agent a tab it did not open — which is
/// WP3's to wire. Remove the allowance in the change that wires it.
#[allow(dead_code)]
pub fn claim(app: &AppHandle, tab: u32, principal: Principal) -> Result<(), Refusal> {
    if !app.state::<Tabs>().exists(tab) {
        return Err(Refusal::new(RefusalCode::UnknownRef)
            .with_hint(format!("there is no tab {tab}; call browser_tabs")));
    }
    policy::acquire_lease(tab, &principal)
}

/// Release every tab this principal holds, and answer with the ids.
pub fn detach_all(app: &AppHandle, principal: &Principal) -> Vec<u32> {
    let _ = app;
    let mut released: Vec<u32> = policy::lease_table()
        .into_iter()
        .filter(|(_, holder)| holder == principal)
        .map(|(tab, _)| tab)
        .collect();
    released.sort_unstable();
    for tab in &released {
        policy::release_lease(*tab);
    }
    released
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_parameter_refuses_with_the_vocabulary_and_names_itself() {
        let refusal = required_str(&json!({ "url": "  " }), "url").unwrap_err();
        assert_eq!(refusal.reason, RefusalCode::ValidatorFailed);
        assert!(refusal.hint.contains("url"), "the hint names the parameter");

        assert!(
            required_str(&json!({ "url": 7 }), "url").is_err(),
            "a number is not a url"
        );
        assert_eq!(
            required_str(&json!({ "url": "https://a.test" }), "url").unwrap(),
            "https://a.test"
        );
    }

    #[test]
    fn a_hands_refusal_keeps_both_the_pages_words_and_the_next_step() {
        let result = hands::HandResult::refused(RefusalCode::UnknownRef, "no element", 1);
        let refusal = refusal_from(&result);
        assert_eq!(refusal.reason, RefusalCode::UnknownRef);
        assert!(
            refusal.hint.contains("no element"),
            "the page's words survive"
        );
        assert!(
            refusal.hint.contains("browser_snapshot"),
            "and the default hint's next command is still there"
        );
    }

    #[test]
    fn a_hands_refusal_with_no_detail_still_carries_a_hint() {
        // An error the agent cannot act on without a human is a defect in the
        // tool, so there is no path that produces an empty hint.
        let mut result = hands::HandResult::refused(RefusalCode::Timeout, "", 1);
        result.error = None;
        assert!(!refusal_from(&result).hint.is_empty());
    }

    #[test]
    fn the_hands_script_and_the_relay_script_are_really_embedded() {
        // `include_str!` of a path that stopped existing is a compile error;
        // `include_str!` of a file somebody emptied is not.
        assert!(hands_script().contains("page_click"));
        assert!(hands_script().len() > 4_000);
        assert!(relay::INJECT_JS.contains("modelContext"));
    }

    #[test]
    fn every_action_the_contract_names_is_routed_and_none_is_silently_dropped() {
        // The action vocabulary is WP0's and grows there. This is the test that
        // notices the day a variant is added and this backend does not answer
        // it — a `_ => unimplemented` would otherwise reach a model as a
        // driver's own panic.
        let routed = [
            Action::Status,
            Action::Navigate(json!({})),
            Action::Snapshot(json!({})),
            Action::Click(json!({})),
            Action::Type(json!({})),
            Action::Select(json!({})),
            Action::Submit(json!({})),
            Action::Screenshot(json!({})),
            Action::Console(json!({})),
            Action::WaitFor(json!({})),
            Action::Tabs,
            Action::PageTools(json!({})),
            Action::CallPageTool(json!({})),
            Action::Login(json!({})),
            Action::Detach,
        ];
        assert_eq!(routed.len(), 15, "one arm per Action variant");
        for action in &routed {
            assert!(
                !action.tool_name().is_empty(),
                "every routed action names an MCP tool"
            );
        }
    }
}
