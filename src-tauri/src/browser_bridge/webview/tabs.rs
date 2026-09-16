//! Tabs — ported from athena-portable's `tabs.rs`.
//!
//! Source: `C:\Users\kazda\kiro\athena-portable\apps\desktop\src-tauri\src\tabs.rs`
//! at athena-portable `c5ec8ca`.
//!
//! One page webview per tab, labelled `browser-page-<id>`, **all sharing one
//! browsing profile**: the same `data_directory` goes to every one of them, so
//! a login in one tab is a login in all of them. That is a deliberate choice
//! and not an accident of the API — per-origin browsing profiles are a declared
//! non-goal, and an operator who signs into an app once and then opens a second
//! tab on it is the reason.
//!
//! **What the port added.** Personas' tabs are shared between an operator and
//! agents, which athena-portable's were not, so a tab carries two things the
//! source had no use for:
//!
//! - a **lease**, which this module does NOT store. There is ONE lease table
//!   and it is `policy`'s (`acquire_lease` / `check_lease` / `release_lease` /
//!   `lease_holder`); `Tab.lease` on the wire is a read of `policy::lease_holder`.
//!   A second table beside it is how a tab ends up free on one surface and held
//!   on another.
//! - a **history cursor** — Tauri 2.11's `Webview` exposes no `back()`/
//!   `forward()` (checked in `tauri-2.11.2/src/webview/mod.rs`; only
//!   `navigate`/`reload` exist), so the page's own `history` is driven by
//!   `eval` and the depth either side of the cursor is counted here. That
//!   count is what `can_go_back` / `can_go_forward` answer with.
//!
//! Tab state lives here and the frontend mirrors it off the `browser-tabs`
//! event. Nothing in the UI is authoritative: every mutation is a command, and
//! the whole list comes back on the event. One event carrying the whole list
//! rather than a diff — the list is capped at eight, and a diff is a bug
//! surface a tab strip does not need.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, Url, WebviewUrl};

use super::super::backend::{CallContext, Principal, Refusal, RefusalCode, TAB_CAP};
use super::super::policy;
use super::layout;

/// Label prefix for every page webview. `capabilities/browser-page.json`
/// names the same prefix — the two are edited together or not at all.
pub const PAGE_LABEL_PREFIX: &str = "browser-page-";

/// One tab on the wire. Mirrors `BrowserTab` in
/// `src/features/browser/types.ts` field for field; a tripwire test at the
/// bottom of this file names the other side.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Tab {
    pub id: u32,
    pub url: String,
    pub title: String,
    pub origin: String,
    pub focused: bool,
    pub lease: Option<Principal>,
    pub can_go_back: bool,
    pub can_go_forward: bool,
}

/// Where a tab sits in its own history.
///
/// Counts, not a url list: a url list would have to be reconciled with the
/// page's real `history` on every redirect, and a redirect is the normal case.
/// The counts move only on the two events that can move them — a navigation
/// the shell caused, and a history step the shell asked for — so they are
/// exactly as right as the page lets them be, and wrong in the direction of
/// offering a button that does nothing rather than hiding one that would work.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct History {
    back: u32,
    forward: u32,
    /// A `history.back()`/`forward()` the shell asked for and has not yet seen
    /// the navigation event of. Without it the resulting `on_navigation` reads
    /// as a fresh navigation and throws the forward half away.
    stepping: bool,
}

impl History {
    /// A navigation the page performed (a link, a form, `navigate`).
    pub fn navigated(self) -> Self {
        if self.stepping {
            // The step we asked for landed; the cursor already moved.
            return Self {
                stepping: false,
                ..self
            };
        }
        Self {
            back: self.back.saturating_add(1),
            forward: 0,
            stepping: false,
        }
    }

    /// The first document a tab ever shows is not a "back" from anywhere.
    pub fn opened() -> Self {
        Self::default()
    }

    pub fn can_go_back(self) -> bool {
        self.back > 0
    }

    pub fn can_go_forward(self) -> bool {
        self.forward > 0
    }

    /// Move the cursor one step back, if there is one. `None` = nothing to do.
    ///
    /// `then`, not `then_some`: `then_some` takes a VALUE, so the subtraction
    /// runs whether or not the condition held and a fresh tab's `back - 1`
    /// panics on underflow in debug. Caught by
    /// `stepping_where_there_is_nothing_is_refused_rather_than_wrapped`.
    pub fn stepped_back(self) -> Option<Self> {
        (self.back > 0).then(|| Self {
            back: self.back - 1,
            forward: self.forward.saturating_add(1),
            stepping: true,
        })
    }

    pub fn stepped_forward(self) -> Option<Self> {
        (self.forward > 0).then(|| Self {
            back: self.back.saturating_add(1),
            forward: self.forward - 1,
            stepping: true,
        })
    }
}

#[derive(Debug)]
struct TabRecord {
    id: u32,
    url: String,
    title: String,
    history: History,
}

#[derive(Default)]
pub struct Tabs {
    inner: Mutex<TabsState>,
}

#[derive(Default)]
struct TabsState {
    next_id: u32,
    focused: Option<u32>,
    list: Vec<TabRecord>,
}

pub fn label_for(id: u32) -> String {
    format!("{PAGE_LABEL_PREFIX}{id}")
}

impl Tabs {
    fn lock(&self) -> std::sync::MutexGuard<'_, TabsState> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn list(&self) -> Vec<Tab> {
        let state = self.lock();
        state
            .list
            .iter()
            .map(|t| Tab {
                id: t.id,
                url: t.url.clone(),
                title: t.title.clone(),
                origin: origin_of(&t.url),
                focused: state.focused == Some(t.id),
                // ONE lease table, and it is not this one.
                lease: policy::lease_holder(t.id),
                can_go_back: t.history.can_go_back(),
                can_go_forward: t.history.can_go_forward(),
            })
            .collect()
    }

    pub fn focused(&self) -> Option<u32> {
        self.lock().focused
    }

    pub fn is_empty(&self) -> bool {
        self.lock().list.is_empty()
    }

    pub fn len(&self) -> usize {
        self.lock().list.len()
    }

    pub fn exists(&self, id: u32) -> bool {
        self.lock().list.iter().any(|t| t.id == id)
    }

    /// Where one tab currently is. `None` when there is no such tab.
    pub fn url_for(&self, id: u32) -> Option<String> {
        self.lock()
            .list
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.url.clone())
    }

    pub fn labels_with_focus(&self) -> Vec<(String, bool)> {
        let state = self.lock();
        state
            .list
            .iter()
            .map(|t| (label_for(t.id), state.focused == Some(t.id)))
            .collect()
    }

    fn add(&self, url: &str) -> Result<u32, Refusal> {
        let mut state = self.lock();
        if state.list.len() >= TAB_CAP {
            return Err(Refusal::new(RefusalCode::TabCap));
        }
        state.next_id += 1;
        let id = state.next_id;
        state.list.push(TabRecord {
            id,
            url: url.to_string(),
            title: String::new(),
            history: History::opened(),
        });
        state.focused = Some(id);
        Ok(id)
    }

    fn remove(&self, id: u32) {
        let mut state = self.lock();
        state.list.retain(|t| t.id != id);
        if state.focused == Some(id) {
            state.focused = state.list.last().map(|t| t.id);
        }
    }

    fn focus(&self, id: u32) -> bool {
        let mut state = self.lock();
        if state.list.iter().any(|t| t.id == id) {
            state.focused = Some(id);
            true
        } else {
            false
        }
    }

    /// Keep the record current as the page navigates itself. It is what makes
    /// the address field show where a tab really is, and what makes "is this
    /// still the document we asked for?" answerable.
    pub fn set_url(&self, id: u32, url: &str) {
        if let Some(tab) = self.lock().list.iter_mut().find(|t| t.id == id) {
            tab.url = url.to_string();
            tab.history = tab.history.navigated();
        }
    }

    pub fn set_title(&self, id: u32, title: &str) {
        if let Some(tab) = self.lock().list.iter_mut().find(|t| t.id == id) {
            tab.title = title.to_string();
        }
    }

    /// Record a history step the shell is about to ask the page for. `false`
    /// when there is nowhere to step, which is the caller's refusal.
    fn step(&self, id: u32, back: bool) -> bool {
        let mut state = self.lock();
        let Some(tab) = state.list.iter_mut().find(|t| t.id == id) else {
            return false;
        };
        let next = if back {
            tab.history.stepped_back()
        } else {
            tab.history.stepped_forward()
        };
        match next {
            Some(history) => {
                tab.history = history;
                true
            }
            None => false,
        }
    }
}

/// `scheme://host[:port]` for a tab's url, or an empty string when it has none.
///
/// The one identity every trust decision is keyed on. An unparseable or opaque
/// url answers with an empty string rather than with the url: a row holding
/// `about:blank` in an origin column would read as an origin, and the empty
/// string cannot be mistaken for one.
pub fn origin_of(url: &str) -> String {
    match Url::parse(url) {
        Ok(parsed) if parsed.has_host() => parsed.origin().ascii_serialization(),
        _ => String::new(),
    }
}

/// Announce the whole tab list — to the `main` webview ONLY.
///
/// **Never `app.emit` in this module.** `app.emit` broadcasts into the page
/// webviews as well, and a page webview is whatever site the operator or an
/// agent navigated to. Personas' app events carry execution ids, session
/// tokens and vault metadata; a page must receive none of it.
pub fn announce(app: &AppHandle) {
    use tauri::{Emitter, EventTarget};
    let list = app.state::<Tabs>().list();
    if let Err(e) = app.emit_to(
        EventTarget::AnyLabel {
            label: layout::MAIN_WINDOW.to_string(),
        },
        personas_core::events::event_name::BROWSER_TABS,
        list,
    ) {
        // A serialisation failure here is permanent and per-call-site, never
        // transient: surface it instead of letting the tab strip go silently stale.
        tracing::warn!(error = %e, "browser-tabs: emit to main failed");
    }
}

/// Create a page webview for `url` inside the host window, focus it, re-lay.
///
/// The FIRST navigation is a navigation: it goes through `check_navigation`
/// under the opener's own context, because an ungated `open` would be a way
/// around the gate that every later navigation goes through.
pub fn create(app: &AppHandle, url: &str, ctx: &CallContext) -> Result<u32, Refusal> {
    let parsed = Url::parse(url).map_err(|e| {
        Refusal::new(RefusalCode::ValidatorFailed).with_hint(format!("`{url}` is not a url: {e}"))
    })?;
    policy::check_navigation(&ctx.policy, &origin_of(parsed.as_str()), &ctx.principal)?;

    // The page answers over a socket to the shared local_http server, so a tab
    // built before that server is up is a tab whose hands can never answer.
    // Refuse, naming the condition, rather than opening one and timing out
    // eight times before anybody suspects the port.
    let port = crate::local_http::port().ok_or_else(|| {
        Refusal::new(RefusalCode::NoBackend).with_hint(
            "the local bridge server is not up yet; retry in a moment or reopen the Browser tab",
        )
    })?;
    let window = super::host::ensure(app)?;

    // `add` focuses the new tab before its webview exists, so a failure below
    // would leave a focused record with nothing to render — and `layout::apply`
    // hides every page webview that is not the focused one, which blanks the
    // whole browsing area. Remember who had focus, so the error path can put
    // the window back exactly as it was.
    let previous = app.state::<Tabs>().focused();
    let id = app.state::<Tabs>().add(parsed.as_str())?;
    let label = label_for(id);

    let app_for_nav = app.clone();
    let app_for_title = app.clone();
    // The three page-world scripts, in the order they have to run: `inject.js`
    // first, so it reaches `document.modelContext` before the application's own
    // scripts do, then the forwarder that carries its answers back to Rust,
    // then the hands. A navigation re-runs all three, which is what makes a
    // page that replaced itself a page with a working bridge.
    let (inject, relay) = super::relay::scripts(id, port);

    let builder = tauri::webview::WebviewBuilder::new(&label, WebviewUrl::External(parsed))
        .initialization_script(inject)
        .initialization_script(relay)
        .initialization_script(super::hands_script())
        // One profile for every tab: passing the same directory to each webview
        // is what makes a login in one tab a login in the next.
        .data_directory(profile_dir(app))
        // `window.open` is allowed. Tauri v2's default is to deny it, which
        // would fail every OAuth "Sign in with…" popup silently. `Allow` hands
        // the request to the platform webview's own default: a plain popup in
        // the SAME environment, so the login it performs is a login in the
        // shared profile above. That popup is not a Tauri webview at all — no
        // IPC, no capability, no command — so this widens what a page can
        // display and not what it can reach.
        .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Allow)
        .on_navigation(move |url| {
            app_for_nav.state::<Tabs>().set_url(id, url.as_str());
            announce(&app_for_nav);
            true
        })
        .on_document_title_changed(move |_, title| {
            app_for_title.state::<Tabs>().set_title(id, &title);
            announce(&app_for_title);
        });

    let size = app
        .state::<layout::HostLayout>()
        .viewport()
        .map(|v| (v.width, v.height))
        .unwrap_or((800.0, 600.0));
    if let Err(e) = window.add_child(
        builder,
        tauri::LogicalPosition::new(0.0, 0.0),
        tauri::LogicalSize::new(size.0, size.1),
    ) {
        // Undo the registration, or the strip lists a tab that cannot render
        // and nothing on screen says why.
        app.state::<Tabs>().remove(id);
        if let Some(previous) = previous {
            app.state::<Tabs>().focus(previous);
        }
        layout::apply(app);
        announce(app);
        return Err(Refusal::new(RefusalCode::NoBackend)
            .with_hint(format!("cannot open a page webview: {e}")));
    }

    // An AGENT that opened a tab holds it; the operator's own tabs stay free,
    // because an operator who leased every tab they opened would lock every
    // agent out of the browser they share. `acquire_lease` on a brand-new id
    // cannot refuse -- nobody can already hold a tab that did not exist -- so
    // the result is a formality this records rather than swallows.
    if ctx.principal != Principal::Operator {
        if let Err(refusal) = policy::acquire_lease(id, &ctx.principal) {
            tracing::warn!(
                tab = id,
                "browser: fresh tab was already leased: {refusal:?}"
            );
        }
    }

    layout::apply(app);
    announce(app);
    Ok(id)
}

pub fn close(app: &AppHandle, id: u32) -> Result<(), Refusal> {
    if let Some(webview) = app.get_webview(&label_for(id)) {
        let _ = webview.close();
    }
    super::relay::forget_tab(id);
    // A closed tab holds nothing. Releasing here rather than leaving the entry
    // is what stops tab 3's lease refusing the NEXT tab 3.
    policy::release_lease(id);
    app.state::<Tabs>().remove(id);
    layout::apply(app);
    announce(app);
    Ok(())
}

pub fn focus(app: &AppHandle, id: u32) -> Result<(), Refusal> {
    if !app.state::<Tabs>().focus(id) {
        return Err(Refusal::new(RefusalCode::UnknownRef)
            .with_hint(format!("there is no tab {id}; call browser_tabs")));
    }
    layout::apply(app);
    announce(app);
    Ok(())
}

/// Navigate a tab, through the gate, as whoever is asking.
///
/// `check_navigation` runs on EVERY navigation the shell causes, against the
/// [`CallContext`] the caller was handed — never against one this module made
/// up. Rule 5 runs too: a tab somebody else holds is not yours to steer, and
/// the operator is no exception (their own UI shows the badge, and
/// `browser_lease_revoke` is the door).
pub fn navigate(app: &AppHandle, id: u32, url: &str, ctx: &CallContext) -> Result<(), Refusal> {
    let parsed = Url::parse(url).map_err(|e| {
        Refusal::new(RefusalCode::ValidatorFailed).with_hint(format!("`{url}` is not a url: {e}"))
    })?;
    let origin = origin_of(parsed.as_str());
    policy::check_navigation(&ctx.policy, &origin, &ctx.principal)?;
    policy::check_lease(id, &ctx.principal)?;

    let webview = app.get_webview(&label_for(id)).ok_or_else(|| {
        Refusal::new(RefusalCode::UnknownRef)
            .with_hint(format!("there is no tab {id}; call browser_tabs"))
    })?;
    webview.navigate(parsed.clone()).map_err(|e| {
        Refusal::new(RefusalCode::Timeout).with_hint(format!("tab {id} would not navigate: {e}"))
    })?;
    app.state::<Tabs>().set_url(id, parsed.as_str());
    announce(app);
    Ok(())
}

/// Step one document back or forward.
///
/// Driven by `eval` because Tauri 2.11's `Webview` has no `back()`/`forward()`
/// (only `navigate` and `reload`). The page's own `history` is the authority;
/// this module only counts how far either side of it we are.
pub fn step_history(app: &AppHandle, id: u32, back: bool) -> Result<(), Refusal> {
    let webview = app.get_webview(&label_for(id)).ok_or_else(|| {
        Refusal::new(RefusalCode::UnknownRef)
            .with_hint(format!("there is no tab {id}; call browser_tabs"))
    })?;
    if !app.state::<Tabs>().step(id, back) {
        return Err(
            Refusal::new(RefusalCode::ValidatorFailed).with_hint(format!(
                "tab {id} has nowhere to go {}",
                if back { "back" } else { "forward" }
            )),
        );
    }
    let script = if back {
        "window.history.back();"
    } else {
        "window.history.forward();"
    };
    webview.eval(script).map_err(|e| {
        Refusal::new(RefusalCode::Timeout).with_hint(format!("tab {id} would not step: {e}"))
    })?;
    announce(app);
    Ok(())
}

/// The shared browsing profile, under the app data dir. It survives an update
/// and can be removed by hand when a login has to go.
pub fn profile_dir(app: &AppHandle) -> std::path::PathBuf {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let dir = base.join("browser-profile");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

#[cfg(test)]
mod tests {
    use super::*;

    const TS_CONTRACT: &str = include_str!("../../../../src/features/browser/types.ts");

    fn tabs_with(n: usize) -> Tabs {
        let tabs = Tabs::default();
        for i in 0..n {
            tabs.add(&format!("https://{i}.test/"))
                .expect("under the cap");
        }
        tabs
    }

    #[test]
    fn every_browser_tab_field_is_named_by_the_ts_contract() {
        // The tripwire `backend.rs` keeps on the caps, applied to the one shape
        // the event carries. A field renamed on one side and not the other is a
        // tab strip that renders `undefined` and says nothing.
        let tabs = tabs_with(1);
        let tab = tabs.list().remove(0);
        let wire = serde_json::to_value(&tab).expect("a tab serialises");
        let object = wire.as_object().expect("an object");
        assert_eq!(object.len(), 8, "BrowserTab has eight fields");
        for key in object.keys() {
            assert!(
                TS_CONTRACT.contains(&format!("{key}:")),
                "TS BrowserTab lacks `{key}`"
            );
        }
    }

    #[test]
    fn adding_focuses_the_new_tab_and_closing_falls_back_to_another() {
        let tabs = Tabs::default();
        let first = tabs.add("https://a.test/").unwrap();
        let second = tabs.add("https://b.test/").unwrap();
        assert_eq!(tabs.focused(), Some(second));

        tabs.remove(second);
        assert_eq!(
            tabs.focused(),
            Some(first),
            "focus falls back to what is left"
        );

        tabs.remove(first);
        assert_eq!(tabs.focused(), None);
        assert!(tabs.list().is_empty());
    }

    #[test]
    fn the_cap_refuses_rather_than_growing() {
        let tabs = tabs_with(TAB_CAP);
        let refusal = tabs.add("https://over.test/").unwrap_err();
        assert_eq!(refusal.reason, RefusalCode::TabCap);
        assert!(!refusal.hint.is_empty());
        assert_eq!(tabs.len(), TAB_CAP, "and the cap is still the cap");
    }

    #[test]
    fn a_rolled_back_create_restores_the_previous_focus() {
        let tabs = Tabs::default();
        let first = tabs.add("https://a.test/").unwrap();
        let _second = tabs.add("https://b.test/").unwrap();
        tabs.focus(first);

        let previous = tabs.focused();
        let phantom = tabs.add("https://c.test/").unwrap();
        assert_eq!(tabs.focused(), Some(phantom));

        // What `create`'s error path does.
        tabs.remove(phantom);
        if let Some(previous) = previous {
            tabs.focus(previous);
        }
        let list = tabs.list();
        assert_eq!(list.len(), 2);
        assert_eq!(
            list.iter().find(|t| t.focused).map(|t| t.id),
            Some(first),
            "focus is back where it was, not on the last tab in the list"
        );
    }

    #[test]
    fn a_tabs_lease_is_read_from_the_one_lease_table_and_not_a_second_one() {
        // The duplicate this file used to keep is gone. `Tab.lease` on the wire
        // is a read of `policy::lease_holder`, so a tab held through the MCP
        // gate shows its badge here without anything copying the fact across --
        // and a tab released there cannot still look held here.
        let tabs = tabs_with(1);
        let id = tabs.list()[0].id;
        policy::release_lease(id);
        assert_eq!(tabs.list()[0].lease, None, "a free tab reads as free");

        policy::acquire_lease(id, &Principal::Session("run-7".into())).expect("a free tab");
        assert_eq!(
            tabs.list()[0].lease,
            Some(Principal::Session("run-7".into())),
            "and a held one reads its holder straight out of policy"
        );

        policy::release_lease(id);
        assert_eq!(tabs.list()[0].lease, None);
    }

    #[test]
    fn a_fresh_tab_can_go_neither_way() {
        let tabs = tabs_with(1);
        let tab = tabs.list().remove(0);
        assert!(!tab.can_go_back && !tab.can_go_forward);
    }

    #[test]
    fn a_navigation_opens_the_back_door_and_shuts_the_forward_one() {
        let one = History::opened();
        assert!(!one.can_go_back());
        let two = one.navigated();
        assert!(two.can_go_back() && !two.can_go_forward());

        let stepped = two.stepped_back().expect("there is one to step to");
        assert!(!stepped.can_go_back() && stepped.can_go_forward());

        // The navigation event the step itself produces must not be counted as
        // a fresh one — that is what would throw the forward half away.
        let landed = stepped.navigated();
        assert_eq!(
            (landed.can_go_back(), landed.can_go_forward()),
            (false, true),
            "the step's own navigation event does not move the cursor twice"
        );

        // But a real navigation from there does, and it burns the forward half.
        let onward = landed.navigated();
        assert!(onward.can_go_back() && !onward.can_go_forward());
    }

    #[test]
    fn stepping_where_there_is_nothing_is_refused_rather_than_wrapped() {
        assert!(History::opened().stepped_back().is_none());
        assert!(History::opened().stepped_forward().is_none());
        let tabs = tabs_with(1);
        assert!(!tabs.step(1, true), "a fresh tab has nowhere to go back to");
        assert!(!tabs.step(99, true), "and no such tab has nowhere at all");
    }

    #[test]
    fn a_tab_follows_the_page_rather_than_the_address_it_was_opened_at() {
        let tabs = tabs_with(1);
        tabs.set_url(1, "https://0.test/elsewhere");
        tabs.set_title(1, "A page");
        let tab = tabs.list().remove(0);
        assert_eq!(tab.url, "https://0.test/elsewhere");
        assert_eq!(tab.title, "A page");
        assert_eq!(tab.origin, "https://0.test");
    }

    #[test]
    fn an_origin_is_scheme_host_and_port_and_nothing_else() {
        assert_eq!(origin_of("https://a.test/path?q=1#frag"), "https://a.test");
        assert_eq!(origin_of("http://a.test:3001/x"), "http://a.test:3001");
        assert_eq!(
            origin_of("https://a.test:443/x"),
            "https://a.test",
            "the default port is not part of the name"
        );
    }

    #[test]
    fn a_url_with_no_host_has_no_origin_rather_than_a_made_up_one() {
        for url in [
            "about:blank",
            "data:text/html,<p>hi",
            "not a url at all",
            "",
        ] {
            assert_eq!(origin_of(url), "", "{url} is not an origin");
        }
    }

    #[test]
    fn a_page_label_carries_the_prefix_the_capability_names() {
        assert_eq!(label_for(3), "browser-page-3");
        assert!(label_for(3).starts_with(PAGE_LABEL_PREFIX));
    }
}
