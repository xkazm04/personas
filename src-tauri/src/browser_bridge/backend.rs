//! Browser backends — the seam between the bridge's gate and its hands.
//!
//! One bridge, several backends (spark browser-control, 2026-09-15). The
//! `browser_*` MCP vocabulary in [`super::mcp`] is the only thing an agent
//! ever learns; whichever backend answers is a routing decision made HERE,
//! after policy, never by the model:
//!
//! - [`BackendKind::Extension`] — the user's real Chrome through the paired
//!   extension over [`super::relay`] (the Phase 1 path).
//! - [`BackendKind::Webview`] — the embedded multi-webview host inside the
//!   app (`browser_bridge::webview`, WP2).
//! - [`BackendKind::Playwright`] — the bundled `@playwright/mcp` fallback,
//!   which speaks MCP itself and therefore has no [`BrowserBackend`] impl:
//!   the CLI is pointed at it directly by [`super::build_browser_mcp_config`].
//!
//! This file is WP0: the CONTRACT the parallel packages build against — the
//! action vocabulary, the closed refusal vocabulary, the caps, and the trait.
//! The mirror of these shapes for the frontend is
//! `src/features/browser/types.ts`; the tripwire test at the bottom keeps the
//! two cap tables equal.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, OnceLock, RwLock};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Max open tabs in the embedded webview. Mirrors `BROWSER_TAB_CAP` in
/// `src/features/browser/types.ts`.
pub const TAB_CAP: usize = 8;
/// Default per-origin call budget per turn. Mirrors `BROWSER_DEFAULT_BUDGET`.
pub const DEFAULT_BUDGET: u32 = 50;
/// Snapshot / read output cap; longer answers carry `(showing N of M)`.
/// Mirrors `BROWSER_SNAPSHOT_CAP_CHARS`.
pub const SNAPSHOT_CAP_CHARS: usize = 8_000;

/// Who is acting: the operator at the keyboard, Athena's own turn, or a
/// fleet/persona session identified by its execution id. Serialises to the
/// TS `BrowserPrincipal` strings (`operator` | `athena` | `session:<id>`).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Principal {
    Operator,
    Athena,
    Session(String),
}

impl Principal {
    pub fn as_wire(&self) -> String {
        match self {
            Principal::Operator => "operator".to_string(),
            Principal::Athena => "athena".to_string(),
            Principal::Session(id) => format!("session:{id}"),
        }
    }
    pub fn parse(s: &str) -> Option<Principal> {
        match s {
            "operator" => Some(Principal::Operator),
            "athena" => Some(Principal::Athena),
            other => other
                .strip_prefix("session:")
                .filter(|id| !id.is_empty())
                .map(|id| Principal::Session(id.to_string())),
        }
    }
}

impl Serialize for Principal {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.as_wire())
    }
}

impl<'de> Deserialize<'de> for Principal {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(d)?;
        Principal::parse(&raw)
            .ok_or_else(|| serde::de::Error::custom(format!("invalid principal `{raw}`")))
    }
}

/// Which backend drives a page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackendKind {
    Webview,
    Extension,
    Playwright,
}

/// The closed refusal vocabulary every backend answers with. Anything a
/// backend produces outside this set is normalised to `Timeout`/`NoBackend`
/// by the caller — a model must never see a driver's own error text
/// (agent-actionable-errors). Mirrors `BrowserRefusalCode` in the TS contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefusalCode {
    OriginNotAllowed,
    OriginDisabled,
    RefusedLoosening,
    BudgetExhausted,
    TabLeased,
    TabCap,
    UnknownRef,
    StalePage,
    Timeout,
    ValidatorFailed,
    UnsupportedPlatform,
    NoBackend,
    PendingApproval,
    UserDenied,
}

impl RefusalCode {
    /// Every variant, for the parity test against the TS union.
    #[cfg(test)]
    pub const ALL: [RefusalCode; 14] = [
        RefusalCode::OriginNotAllowed,
        RefusalCode::OriginDisabled,
        RefusalCode::RefusedLoosening,
        RefusalCode::BudgetExhausted,
        RefusalCode::TabLeased,
        RefusalCode::TabCap,
        RefusalCode::UnknownRef,
        RefusalCode::StalePage,
        RefusalCode::Timeout,
        RefusalCode::ValidatorFailed,
        RefusalCode::UnsupportedPlatform,
        RefusalCode::NoBackend,
        RefusalCode::PendingApproval,
        RefusalCode::UserDenied,
    ];

    /// The default next-step hint. Callers may replace it with a more
    /// specific one (e.g. naming the lease holder) but never with nothing.
    pub fn default_hint(self) -> &'static str {
        match self {
            RefusalCode::OriginNotAllowed => {
                "this origin is not on the Whitelist; call browser_request_site to ask the operator, or they can add it under Browser > Whitelist"
            }
            RefusalCode::OriginDisabled => {
                "this origin is on the Whitelist but paused; the operator can re-enable it under Browser > Whitelist"
            }
            RefusalCode::RefusedLoosening => {
                "per-origin overrides may only tighten a tool class; the declared class stands"
            }
            RefusalCode::BudgetExhausted => {
                "this origin's per-turn call budget is spent; finish the turn and continue in the next one"
            }
            RefusalCode::TabLeased => {
                "another principal holds this tab; call browser_tabs and open or pick a free tab"
            }
            RefusalCode::TabCap => "the tab cap is reached; call browser_tabs and close one before opening another",
            RefusalCode::UnknownRef => {
                "that ref is from a page that has since navigated; call browser_snapshot and use a fresh ref"
            }
            RefusalCode::StalePage => "the page changed under the last snapshot; call browser_snapshot again",
            RefusalCode::Timeout => {
                "the page did not settle in time; call browser_wait_for with the text you expect, then retry once"
            }
            RefusalCode::ValidatorFailed => "the parameters did not validate; read the tool schema and resend",
            RefusalCode::UnsupportedPlatform => {
                "this capability is not available on this platform; continue with browser_snapshot"
            }
            RefusalCode::NoBackend => {
                "no browser backend is available; open a tab in Browser > Webview or pair the extension"
            }
            RefusalCode::PendingApproval => {
                "this write is waiting for the operator's decision; do not resend it"
            }
            RefusalCode::UserDenied => "the operator declined this action; do not retry it",
        }
    }
}

/// A refusal as the agent receives it. `hint` is mandatory: an error the
/// agent cannot act on without a human is a defect in the tool.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Refusal {
    pub reason: RefusalCode,
    pub hint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub holder: Option<String>,
}

impl Refusal {
    pub fn new(reason: RefusalCode) -> Self {
        Self {
            reason,
            hint: reason.default_hint().to_string(),
            origin: None,
            holder: None,
        }
    }
    pub fn with_origin(mut self, origin: impl Into<String>) -> Self {
        self.origin = Some(origin.into());
        self
    }
    pub fn with_holder(mut self, holder: impl Into<String>) -> Self {
        self.holder = Some(holder.into());
        self
    }
    pub fn with_hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = hint.into();
        self
    }
}

/// Effect class of an action — the backend dispatches by it and the gate
/// decides by it (effect-classed-commands). `Read` never mutates and is safe
/// to retry; `Write` mutates page state and goes through the operator's
/// approval unless a page manifest proves it reversible and internal; `Meta`
/// addresses the host itself (tabs, status).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Effect {
    Read,
    Write,
    Meta,
}

/// The action vocabulary, one variant per `browser_*` MCP tool that reaches
/// a backend. Params are the tool's validated `arguments` object.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "tool", content = "params", rename_all = "snake_case")]
pub enum Action {
    Status,
    Navigate(Value),
    Snapshot(Value),
    Click(Value),
    Type(Value),
    Select(Value),
    Submit(Value),
    Screenshot(Value),
    Console(Value),
    WaitFor(Value),
    Tabs,
    PageTools(Value),
    CallPageTool(Value),
    /// Executed by Rust with vault values the model never sees.
    Login(Value),
    Detach,
}

impl Action {
    pub fn effect(&self) -> Effect {
        match self {
            Action::Status | Action::Tabs | Action::Detach => Effect::Meta,
            Action::Navigate(_)
            | Action::Snapshot(_)
            | Action::Screenshot(_)
            | Action::Console(_)
            | Action::WaitFor(_)
            | Action::PageTools(_) => Effect::Read,
            Action::Click(_)
            | Action::Type(_)
            | Action::Select(_)
            | Action::Submit(_)
            | Action::CallPageTool(_)
            | Action::Login(_) => Effect::Write,
        }
    }

    /// The MCP tool name this action answers to. Test-only today: the wire
    /// name is owned by the descriptors in `mcp.rs`; this exists so the
    /// parity tests can name an action without a second table.
    #[cfg(test)]
    pub fn tool_name(&self) -> &'static str {
        match self {
            Action::Status => "browser_status",
            Action::Navigate(_) => "browser_navigate",
            Action::Snapshot(_) => "browser_snapshot",
            Action::Click(_) => "browser_click",
            Action::Type(_) => "browser_type",
            Action::Select(_) => "browser_select",
            Action::Submit(_) => "browser_submit",
            Action::Screenshot(_) => "browser_screenshot",
            Action::Console(_) => "browser_console",
            Action::WaitFor(_) => "browser_wait_for",
            Action::Tabs => "browser_tabs",
            Action::PageTools(_) => "browser_page_tools",
            Action::CallPageTool(_) => "browser_call_page_tool",
            Action::Login(_) => "browser_login",
            Action::Detach => "browser_detach",
        }
    }
}

/// A backend's answer. `capture_id` is set by writes that filed a
/// screenshot for the decision card before acting.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Outcome {
    pub output: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture_id: Option<String>,
    pub ms: u64,
}

pub type BackendFuture<'a> = Pin<Box<dyn Future<Output = Result<Outcome, Refusal>> + Send + 'a>>;

/// WHO is acting and WHAT they may reach, carried with every action.
///
/// Added 2026-09-15 (WP2). The trait used to hand a backend a tab id and
/// nothing else, on the reasoning that policy runs before `call` — true for
/// four of the five rules, and false for the one that cannot: **a navigation
/// the backend itself causes.** The embedded webview follows redirects,
/// `window.open`, and a page rewriting its own location; each is a navigation
/// the gate upstream never saw. Without this the backend had to invent a
/// principal (WP2 shipped a default-to-Operator workaround for exactly one
/// review cycle), and a backend that invents its own principal is a backend
/// that can choose to be allowed.
///
/// A backend may still assume the action it was handed passed rules 1-5 for
/// the call site the gate DID see. This is what it re-checks the ones it
/// causes itself against.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallContext {
    pub principal: Principal,
    pub policy: super::policy::AllowPolicy,
}

impl CallContext {
    /// The operator at the keyboard: their own principal, the Whitelist, and
    /// no session to charge.
    pub fn operator() -> Self {
        Self {
            principal: Principal::Operator,
            policy: super::policy::AllowPolicy::Whitelist,
        }
    }
}

/// Hands and eyes. Policy (whitelist, overrides, budget, leases, the
/// approval gate) runs BEFORE `call`; a backend that receives an action may
/// assume it was allowed, and re-checks only the navigations it causes itself
/// — against [`CallContext`], never against a principal of its own choosing.
pub trait BrowserBackend: Send + Sync {
    fn kind(&self) -> BackendKind;
    /// Can this backend act right now (extension connected / a tab open)?
    fn available(&self) -> bool;
    /// Perform one action against `tab` (`None` = the backend's current tab).
    fn call<'a>(
        &'a self,
        tab: Option<u32>,
        action: Action,
        ctx: &'a CallContext,
    ) -> BackendFuture<'a>;
}

// ---------------------------------------------------------------------------
// Registry — backends announce themselves at boot; the gate picks one.
// ---------------------------------------------------------------------------

static BACKENDS: OnceLock<RwLock<Vec<Arc<dyn BrowserBackend>>>> = OnceLock::new();

fn registry() -> &'static RwLock<Vec<Arc<dyn BrowserBackend>>> {
    BACKENDS.get_or_init(|| RwLock::new(Vec::new()))
}

/// Register a backend. Idempotent per kind: a second registration of the
/// same kind replaces the first (re-entrant boot paths, tests).
pub fn register_backend(backend: Arc<dyn BrowserBackend>) {
    let mut g = registry().write().unwrap_or_else(|p| p.into_inner());
    g.retain(|b| b.kind() != backend.kind());
    g.push(backend);
}

/// All registered backends, in registration order.
pub fn backends() -> Vec<Arc<dyn BrowserBackend>> {
    registry().read().unwrap_or_else(|p| p.into_inner()).clone()
}

/// The backend a call should go to: the embedded webview when it has a tab,
/// else the extension when it is connected, else `None` (→ `NoBackend`).
/// Playwright is not in the registry (the CLI is pointed at it directly).
pub fn preferred_backend() -> Option<Arc<dyn BrowserBackend>> {
    let all = backends();
    for kind in [BackendKind::Webview, BackendKind::Extension] {
        if let Some(b) = all.iter().find(|b| b.kind() == kind && b.available()) {
            return Some(b.clone());
        }
    }
    None
}

#[cfg(test)]
/// Test double: a backend that is declared but never available. Every
/// call refuses with `NoBackend`, so the route through policy is exercisable
/// before WP2 lands the webview.
pub struct Unavailable(pub BackendKind);

#[cfg(test)]
impl BrowserBackend for Unavailable {
    fn kind(&self) -> BackendKind {
        self.0
    }
    fn available(&self) -> bool {
        false
    }
    fn call<'a>(
        &'a self,
        _tab: Option<u32>,
        _action: Action,
        _ctx: &'a CallContext,
    ) -> BackendFuture<'a> {
        Box::pin(async { Err(Refusal::new(RefusalCode::NoBackend)) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TS_CONTRACT: &str = include_str!("../../../src/features/browser/types.ts");

    #[test]
    fn caps_match_the_ts_contract() {
        assert!(TS_CONTRACT.contains(&format!("BROWSER_TAB_CAP = {TAB_CAP};")));
        assert!(TS_CONTRACT.contains(&format!("BROWSER_DEFAULT_BUDGET = {DEFAULT_BUDGET};")));
        assert!(TS_CONTRACT.contains(&format!(
            "BROWSER_SNAPSHOT_CAP_CHARS = {SNAPSHOT_CAP_CHARS};"
        )));
    }

    #[test]
    fn refusal_codes_match_the_ts_union() {
        for code in RefusalCode::ALL {
            let wire = serde_json::to_value(code).unwrap();
            let wire = wire.as_str().unwrap();
            assert!(
                TS_CONTRACT.contains(&format!("'{wire}'")),
                "TS BrowserRefusalCode lacks '{wire}'"
            );
            assert!(!code.default_hint().is_empty());
        }
    }

    #[test]
    fn every_write_is_classified_as_write() {
        assert_eq!(Action::Click(Value::Null).effect(), Effect::Write);
        assert_eq!(Action::Login(Value::Null).effect(), Effect::Write);
        assert_eq!(Action::Snapshot(Value::Null).effect(), Effect::Read);
        assert_eq!(Action::Tabs.effect(), Effect::Meta);
    }

    #[test]
    fn principal_wire_roundtrip() {
        for p in [
            Principal::Operator,
            Principal::Athena,
            Principal::Session("ab12".into()),
        ] {
            let s = serde_json::to_string(&p).unwrap();
            assert_eq!(serde_json::from_str::<Principal>(&s).unwrap(), p);
        }
        assert!(Principal::parse("session:").is_none());
        assert!(Principal::parse("root").is_none());
    }

    #[test]
    fn registry_replaces_same_kind_and_skips_unavailable() {
        register_backend(Arc::new(Unavailable(BackendKind::Webview)));
        register_backend(Arc::new(Unavailable(BackendKind::Webview)));
        assert_eq!(
            backends()
                .iter()
                .filter(|b| b.kind() == BackendKind::Webview)
                .count(),
            1
        );
        assert!(preferred_backend().is_none());
    }

    #[tokio::test]
    async fn unavailable_refuses_with_no_backend() {
        let b = Unavailable(BackendKind::Webview);
        assert!(!b.available());
        let ctx = CallContext::operator();
        let err = b.call(None, Action::Status, &ctx).await.unwrap_err();
        assert_eq!(err.reason, RefusalCode::NoBackend);
        assert!(!err.hint.is_empty());
    }

    #[test]
    fn a_call_context_never_defaults_to_a_principal_it_was_not_given() {
        // The workaround this type replaced: a backend with no principal made
        // one up. The only constructor that mints a principal is `operator`,
        // and it says so in its name -- every other context is one a caller
        // passed in, which is the whole point.
        let ctx = CallContext::operator();
        assert_eq!(ctx.principal, Principal::Operator);
        assert_eq!(ctx.policy, super::super::policy::AllowPolicy::Whitelist);
    }
}
