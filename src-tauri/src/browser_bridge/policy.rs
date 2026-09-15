//! Browser policy — the gate every backend is behind.
//!
//! Rules run in a fixed order and the FIRST refusal wins (Cedar's
//! forbid-overrides-permit, as `athena-portable`'s `harness/policy.py` did):
//!
//! 1. `origin_on_list`   — the origin has a `browser_sites` row (else
//!                          `OriginNotAllowed`; the hint names
//!                          `browser_request_site`).
//! 2. `origin_enabled`   — the row is not paused (else `OriginDisabled`).
//! 3. `override_tightens`— a per-origin override may only move a tool to
//!                          GATED; an attempt to declare AUTO over a derived
//!                          GATED is `RefusedLoosening`.
//! 4. `budget`           — the origin's per-turn call budget is not spent.
//! 5. `lease`            — the tab is free or held by this principal.
//!
//! Policy is data read from the database at decision time, never cached in
//! the model's prompt and never decided by a backend. The legacy
//! `run_browser_test` session keeps its pinned-origin shape through
//! [`AllowPolicy::Pinned`].
//!
//! WP0 status: signatures and the `Pinned` arm are real; the whitelist arm is
//! filled by WP1 (`browser_sites` repo). Until then `check_navigation` with
//! `AllowPolicy::Whitelist` refuses everything, which is the safe default.

// WP0 scaffolding: this is the contract the parallel packages (WP1 policy +
// sessions, WP2 webview backend) consume. Remove this allowance in the package
// that lands the first caller.
#![allow(dead_code)]

use super::backend::{Principal, Refusal, RefusalCode};

/// What a session is allowed to reach.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AllowPolicy {
    /// One origin, pinned at registration (the browser-test path).
    Pinned(String),
    /// Every enabled row of `browser_sites` (the Whitelist path).
    Whitelist,
}

/// May `principal` navigate a page to `origin` under `policy`?
///
/// `origin` is the ascii serialization `super::origin_of` produces.
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
            // WP1 replaces this arm with the `browser_sites` lookup
            // (rules 1-2 above). Refusing is the safe default until then.
            let _ = principal;
            Err(Refusal::new(RefusalCode::OriginNotAllowed).with_origin(origin))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pinned_allows_only_its_origin() {
        let p = AllowPolicy::Pinned("http://localhost:8765".into());
        assert!(check_navigation(&p, "http://localhost:8765", &Principal::Athena).is_ok());
        let err = check_navigation(&p, "https://evil.example", &Principal::Athena).unwrap_err();
        assert_eq!(err.reason, RefusalCode::OriginNotAllowed);
        assert!(err.hint.contains("localhost:8765"));
    }

    #[test]
    fn whitelist_arm_refuses_until_backed_by_rows() {
        let err = check_navigation(
            &AllowPolicy::Whitelist,
            "https://app.example.com",
            &Principal::Operator,
        )
        .unwrap_err();
        assert_eq!(err.reason, RefusalCode::OriginNotAllowed);
        assert_eq!(err.origin.as_deref(), Some("https://app.example.com"));
    }
}
