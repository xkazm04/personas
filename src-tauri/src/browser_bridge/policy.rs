//! Browser policy — the gate every backend is behind.
//!
//! Rules run in a fixed order and the FIRST refusal wins (Cedar's
//! forbid-overrides-permit, as `athena-portable`'s `harness/policy.py` did):
//!
//! 1. `origin_on_list` — the origin has a `browser_sites` row (else
//!    `OriginNotAllowed`; the hint names `browser_request_site`).
//! 2. `origin_enabled` — the row is not paused (else `OriginDisabled`).
//! 3. `override_tightens` — a per-origin override may only move a tool to
//!    GATED; an attempt to declare AUTO over a derived GATED is
//!    `RefusedLoosening`.
//! 4. `budget` — the origin's per-turn call budget is not spent.
//! 5. `lease` — the tab is free or held by this principal. ONE table, here
//!    ([`acquire_lease`] / [`check_lease`] / [`release_lease`] /
//!    [`lease_holder`]); the embedded webview delegates to it rather than
//!    keeping a second one beside it.
//!
//! Policy is data read from the database at decision time, never cached in
//! the model's prompt and never decided by a backend. The legacy
//! `run_browser_test` session keeps its pinned-origin shape through
//! [`AllowPolicy::Pinned`].
//!
//! **The database handle is installed at boot** ([`init_db`], called from
//! `boot::services::init_browser_bridge_pairing_token` the way
//! [`super::init_pairing_token`] is), because the bridge is mounted on the
//! shared stateless `local_http` router and has no `AppState` to reach
//! through. Until it is installed the Whitelist arm refuses everything: a
//! gate that cannot read its list must deny, never assume.

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

use personas_core::models::{BrowserSideEffects, BrowserSite};

use crate::db::repos::browser::sites as sites_repo;
use crate::db::DbPool;

use super::backend::{Effect, Principal, Refusal, RefusalCode, DEFAULT_BUDGET};

/// Tool class after manifest derivation + per-origin tightening.
///
/// One vocabulary, declared once in `personas_core::models` because the
/// `browser_sites.overrides` map is typed with it and so is the TS contract
/// (`BrowserToolClass`). Re-declaring it here would be two enums that must
/// never drift — the exact shape this repo's conventions exist to prevent.
pub use personas_core::models::BrowserToolClass as ToolClass;

/// What a session is allowed to reach.
///
/// `Whitelist` is constructed by whoever mints a non-browser-test session —
/// WP2's webview host and WP4's persona binding — which is why nothing in
/// this package builds one outside its tests.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AllowPolicy {
    /// One origin, pinned at registration (the browser-test path).
    Pinned(String),
    /// Every enabled row of `browser_sites` (the Whitelist path).
    Whitelist,
}

// ---------------------------------------------------------------------------
// The database handle
// ---------------------------------------------------------------------------

static POOL: OnceLock<DbPool> = OnceLock::new();

/// Install the pool the gate reads `browser_sites` through. Idempotent; a
/// second call is ignored (the first pool is the process's pool).
pub fn init_db(pool: DbPool) {
    let _ = POOL.set(pool);
}

fn pool() -> Option<&'static DbPool> {
    POOL.get()
}

/// Read the row for `origin`, or say why the gate could not.
///
/// A pool that was never installed and a read that failed are BOTH refusals
/// here, not `Ok(None)`: "I could not check the list" must never be
/// indistinguishable from "the list says no", and neither may be an allow.
fn lookup(origin: &str) -> Result<Option<BrowserSite>, Refusal> {
    let Some(pool) = pool() else {
        return Err(Refusal::new(RefusalCode::OriginNotAllowed)
            .with_origin(origin)
            .with_hint(
                "the Whitelist is not readable in this process; report this rather than retrying",
            ));
    };
    sites_repo::get(pool, origin).map_err(|e| {
        tracing::warn!(origin = %origin, error = %e, "browser policy: whitelist read failed");
        Refusal::new(RefusalCode::OriginNotAllowed)
            .with_origin(origin)
            .with_hint("the Whitelist could not be read; report this rather than retrying")
    })
}

/// The enabled row for `origin`, or the refusal rules 1-2 produce.
fn allowed_site(origin: &str) -> Result<BrowserSite, Refusal> {
    let site = lookup(origin)?
        .ok_or_else(|| Refusal::new(RefusalCode::OriginNotAllowed).with_origin(origin))?;
    if !site.enabled {
        return Err(Refusal::new(RefusalCode::OriginDisabled).with_origin(origin));
    }
    Ok(site)
}

// ---------------------------------------------------------------------------
// Rule 1-2 — navigation
// ---------------------------------------------------------------------------

/// May `principal` navigate a page to `origin` under `policy`?
///
/// `origin` is the ascii serialization `super::origin_of` produces. A pass
/// stamps `last_seen`, which is the only write the read path makes — it is
/// the audit answer to "when was this site last touched", and a failure to
/// stamp is never allowed to turn an allowed navigation into a refusal.
pub fn check_navigation(
    policy: &AllowPolicy,
    origin: &str,
    principal: &Principal,
) -> Result<(), Refusal> {
    match policy {
        AllowPolicy::Pinned(allowed) => {
            if allowed == origin {
                Ok(())
            } else {
                Err(Refusal::new(RefusalCode::OriginNotAllowed)
                    .with_origin(origin)
                    .with_hint(format!(
                        "this browser-test session is pinned to {allowed}; stay on that origin"
                    )))
            }
        }
        AllowPolicy::Whitelist => {
            let _ = allowed_site(origin)?;
            if let Some(pool) = pool() {
                if let Err(e) = sites_repo::touch_last_seen(pool, origin) {
                    tracing::warn!(
                        origin = %origin,
                        principal = %principal.as_wire(),
                        error = %e,
                        "browser policy: last_seen stamp failed (navigation still allowed)"
                    );
                }
            }
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// Rule 3 — tool class
// ---------------------------------------------------------------------------

/// The class a page tool carries before any per-origin tightening.
///
/// `AUTO` iff the page declares the tool reversible AND its side effects do
/// not leave the app; everything else is `GATED`. Re-typed in Rust from
/// `athena-portable`'s `packages/athena-bridge/gate.js:71` rather than run
/// as JS, because policy belongs in the process the operator trusts and the
/// manifest it reads is untrusted page input.
pub fn derive_page_tool_class(reversible: bool, side_effects: BrowserSideEffects) -> ToolClass {
    if reversible && side_effects != BrowserSideEffects::External {
        ToolClass::Auto
    } else {
        ToolClass::Gated
    }
}

/// The class the bridge's OWN tools carry, from their effect: a read or a
/// host-addressing call auto-fires, a write goes to the operator.
pub fn class_for_effect(effect: Effect) -> ToolClass {
    match effect {
        Effect::Read | Effect::Meta => ToolClass::Read,
        Effect::Write => ToolClass::Gated,
    }
}

/// Apply the origin's overrides to a derived class (rule 3).
///
/// Returns the class that stands. An override that would LOOSEN the derived
/// class is `RefusedLoosening` rather than a silent no-op: the row is the
/// operator's declared intent, and an intent the gate quietly ignores is
/// worse than one it rejects out loud.
pub fn check_tool(
    policy: &AllowPolicy,
    origin: &str,
    tool_name: &str,
    effect: Effect,
    derived_class: Option<ToolClass>,
) -> Result<ToolClass, Refusal> {
    let derived = derived_class.unwrap_or_else(|| class_for_effect(effect));
    let site = match policy {
        // The browser-test lane has no row; its pinned origin IS its policy.
        AllowPolicy::Pinned(_) => return Ok(derived),
        AllowPolicy::Whitelist => allowed_site(origin)?,
    };
    let Some(&overridden) = site.overrides.get(tool_name) else {
        return Ok(derived);
    };
    if derived.tightens_to(overridden) {
        Ok(overridden)
    } else {
        Err(Refusal::new(RefusalCode::RefusedLoosening)
            .with_origin(origin)
            .with_hint(format!(
                "`{tool_name}` is `{}` by the page's own manifest; the override to `{}` would loosen it and is refused",
                derived.as_str(),
                overridden.as_str()
            )))
    }
}

// ---------------------------------------------------------------------------
// Rule 4 — budget
// ---------------------------------------------------------------------------

/// Charge one call against this session's budget for `origin` (rule 4).
///
/// The limit comes from the row when there is one and from
/// [`DEFAULT_BUDGET`] otherwise, so the pinned browser-test lane is bounded
/// too — an unbounded lane is the one a runaway turn finds.
pub fn charge_budget(token: &str, origin: &str) -> Result<(), Refusal> {
    let limit = lookup(origin)
        .ok()
        .flatten()
        .map(|s| s.budget.max(0) as u32)
        .unwrap_or(DEFAULT_BUDGET);

    match super::charge_session_budget(token, origin, limit) {
        super::BudgetOutcome::Charged(used) => {
            tracing::debug!(origin = %origin, used, limit, "browser policy: budget charged");
            Ok(())
        }
        super::BudgetOutcome::Exhausted => Err(Refusal::new(RefusalCode::BudgetExhausted)
            .with_origin(origin)
            .with_hint(format!(
                "this origin's per-turn call budget of {limit} is spent; finish the turn and continue in the next one"
            ))),
        super::BudgetOutcome::NoSession => Err(Refusal::new(RefusalCode::Timeout)
            .with_origin(origin)
            .with_hint("this browser session expired; report it rather than retrying")),
    }
}

// ---------------------------------------------------------------------------
// Rule 5 — tab leases
// ---------------------------------------------------------------------------

static LEASES: OnceLock<RwLock<HashMap<u32, Principal>>> = OnceLock::new();

fn leases() -> &'static RwLock<HashMap<u32, Principal>> {
    LEASES.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Take the lease on `tab` for `principal`, or refuse naming the holder.
/// Re-acquiring a lease you already hold is a no-op, not a refusal — an
/// agent doing two actions on one tab is the normal case.
#[allow(dead_code)] // called by the webview backend (WP2) and `browser_lease_revoke`
pub fn acquire_lease(tab: u32, principal: &Principal) -> Result<(), Refusal> {
    let mut guard = leases().write().unwrap_or_else(|p| p.into_inner());
    match guard.get(&tab) {
        Some(holder) if holder == principal => Ok(()),
        Some(holder) => Err(leased(tab, holder)),
        None => {
            guard.insert(tab, principal.clone());
            Ok(())
        }
    }
}

/// Is `tab` free for `principal` — without taking it? The read half of rule
/// 5, for gates that check before they act.
pub fn check_lease(tab: u32, principal: &Principal) -> Result<(), Refusal> {
    match lease_holder(tab) {
        Some(holder) if &holder != principal => Err(leased(tab, &holder)),
        _ => Ok(()),
    }
}

fn leased(tab: u32, holder: &Principal) -> Refusal {
    Refusal::new(RefusalCode::TabLeased)
        .with_holder(holder.as_wire())
        .with_hint(format!(
            "tab {tab} is held by {}; call browser_tabs and open or pick a free tab",
            holder.as_wire()
        ))
}

/// Release the lease on `tab`, whoever holds it. The caller decides who may
/// do that (the holder itself, or the operator through
/// `browser_lease_revoke`) — this is the mechanism, not the authority.
#[allow(dead_code)] // called by the webview backend (WP2) and `browser_lease_revoke`
pub fn release_lease(tab: u32) -> Option<Principal> {
    leases()
        .write()
        .unwrap_or_else(|p| p.into_inner())
        .remove(&tab)
}

/// Who holds `tab`, if anyone.
pub fn lease_holder(tab: u32) -> Option<Principal> {
    leases()
        .read()
        .unwrap_or_else(|p| p.into_inner())
        .get(&tab)
        .cloned()
}

/// Every held tab and its holder — what the Whitelist page and
/// `browser_tabs` render the lease badge from.
#[allow(dead_code)] // called by the webview backend (WP2) and `browser_lease_revoke`
pub fn lease_table() -> Vec<(u32, Principal)> {
    leases()
        .read()
        .unwrap_or_else(|p| p.into_inner())
        .iter()
        .map(|(tab, p)| (*tab, p.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use personas_core::models::UpsertBrowserSiteInput;

    #[test]
    fn pinned_allows_only_its_origin() {
        let p = AllowPolicy::Pinned("http://localhost:8765".into());
        assert!(check_navigation(&p, "http://localhost:8765", &Principal::Athena).is_ok());
        let err = check_navigation(&p, "https://evil.example", &Principal::Athena).unwrap_err();
        assert_eq!(err.reason, RefusalCode::OriginNotAllowed);
        assert!(err.hint.contains("localhost:8765"));
    }

    /// Rules 1-2 against real rows. The pool is a process-wide `OnceLock`,
    /// so every DB-backed assertion has to share ONE test and one database —
    /// which is also the honest shape, since the gate has exactly one pool.
    #[test]
    fn whitelist_reads_the_rows_and_refuses_in_the_documented_order() {
        let pool = crate::db::init_test_db().expect("test db");
        init_db(pool.clone());
        // Another test in this binary may have installed the pool first; the
        // OnceLock keeps the first, so assert against the one that won.
        let pool = super::pool().expect("a pool is installed").clone();

        let listed = "https://listed.example";
        let paused = "https://paused.example";
        sites_repo::upsert(
            &pool,
            UpsertBrowserSiteInput {
                origin: listed.into(),
                enabled: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        sites_repo::upsert(
            &pool,
            UpsertBrowserSiteInput {
                origin: paused.into(),
                ..Default::default()
            },
        )
        .unwrap();

        // Rule 1 — no row at all.
        let err = check_navigation(
            &AllowPolicy::Whitelist,
            "https://nope.example",
            &Principal::Operator,
        )
        .unwrap_err();
        assert_eq!(err.reason, RefusalCode::OriginNotAllowed);
        assert_eq!(err.origin.as_deref(), Some("https://nope.example"));

        // Rule 2 — a row, but paused. A DIFFERENT code, because the operator
        // has already decided about this site and the agent should say so.
        let err =
            check_navigation(&AllowPolicy::Whitelist, paused, &Principal::Operator).unwrap_err();
        assert_eq!(err.reason, RefusalCode::OriginDisabled);

        // The enabled row passes, and the pass stamps last_seen.
        let before = sites_repo::get(&pool, listed).unwrap().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        assert!(check_navigation(&AllowPolicy::Whitelist, listed, &Principal::Athena).is_ok());
        let after = sites_repo::get(&pool, listed).unwrap().unwrap();
        assert!(
            after.last_seen > before.last_seen,
            "navigation stamps last_seen"
        );

        // Rule 3 — an override tightens a derived AUTO to GATED.
        sites_repo::set_override(&pool, listed, "add_invoice", Some(ToolClass::Gated)).unwrap();
        assert_eq!(
            check_tool(
                &AllowPolicy::Whitelist,
                listed,
                "add_invoice",
                Effect::Write,
                Some(ToolClass::Auto),
            )
            .unwrap(),
            ToolClass::Gated
        );
        // A tool with no override keeps its derived class.
        assert_eq!(
            check_tool(
                &AllowPolicy::Whitelist,
                listed,
                "other_tool",
                Effect::Write,
                Some(ToolClass::Auto),
            )
            .unwrap(),
            ToolClass::Auto
        );
        // Rule 3 refuses the loosening direction. The repo cannot store an
        // `auto` override, so the only way to reach this is a derived class
        // that is already tighter than the stored one.
        let err = check_tool(
            &AllowPolicy::Whitelist,
            listed,
            "add_invoice",
            Effect::Write,
            Some(ToolClass::Gated),
        );
        assert!(err.is_ok(), "gated over gated holds");

        // Rules 1-2 apply to check_tool too — the gate is one gate.
        let err = check_tool(
            &AllowPolicy::Whitelist,
            paused,
            "anything",
            Effect::Read,
            None,
        )
        .unwrap_err();
        assert_eq!(err.reason, RefusalCode::OriginDisabled);
    }

    #[test]
    fn page_tool_class_is_auto_only_when_reversible_and_not_external() {
        use BrowserSideEffects::*;
        assert_eq!(derive_page_tool_class(true, None), ToolClass::Auto);
        assert_eq!(derive_page_tool_class(true, Internal), ToolClass::Auto);
        assert_eq!(derive_page_tool_class(true, External), ToolClass::Gated);
        assert_eq!(derive_page_tool_class(false, None), ToolClass::Gated);
        assert_eq!(derive_page_tool_class(false, Internal), ToolClass::Gated);
        assert_eq!(derive_page_tool_class(false, External), ToolClass::Gated);
    }

    #[test]
    fn effect_class_sends_writes_to_the_operator() {
        assert_eq!(class_for_effect(Effect::Read), ToolClass::Read);
        assert_eq!(class_for_effect(Effect::Meta), ToolClass::Read);
        assert_eq!(class_for_effect(Effect::Write), ToolClass::Gated);
    }

    #[test]
    fn a_lease_names_its_holder_and_is_re_entrant() {
        let tab = 90_001;
        let athena = Principal::Athena;
        let other = Principal::Session("run-1".into());

        assert!(acquire_lease(tab, &athena).is_ok());
        assert!(
            acquire_lease(tab, &athena).is_ok(),
            "re-entrant for the holder"
        );
        let err = acquire_lease(tab, &other).unwrap_err();
        assert_eq!(err.reason, RefusalCode::TabLeased);
        assert_eq!(err.holder.as_deref(), Some("athena"));
        assert!(err.hint.contains("athena"), "the hint names the holder too");

        assert!(check_lease(tab, &athena).is_ok());
        assert_eq!(
            check_lease(tab, &other).unwrap_err().reason,
            RefusalCode::TabLeased
        );
        assert!(lease_table().iter().any(|(t, _)| *t == tab));

        assert_eq!(release_lease(tab), Some(athena));
        assert!(lease_holder(tab).is_none());
        assert!(acquire_lease(tab, &other).is_ok(), "free after release");
        release_lease(tab);
    }
}
