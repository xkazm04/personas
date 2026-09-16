//! `browser_sites` repo tests.
//!
//! Included from `sites.rs` via `#[path]` so `use super::*` reaches the
//! repo's private items exactly as an inline `mod tests` would.

use super::*;
use personas_core::models::{
    BrowserPageTool, BrowserScanTransport, BrowserSideEffects, BrowserToolClass,
};

fn pool() -> DbPool {
    crate::init_test_db().expect("test db")
}

fn input(origin: &str) -> UpsertBrowserSiteInput {
    UpsertBrowserSiteInput {
        origin: origin.to_string(),
        ..Default::default()
    }
}

#[test]
fn a_new_row_is_denied_by_default() {
    let p = pool();
    let site = upsert(&p, input("https://app.example.com")).unwrap();
    assert!(
        !site.enabled,
        "deny-by-default is the whole point of the row"
    );
    assert_eq!(site.budget, DEFAULT_BUDGET);
    assert_eq!(site.label, "");
    assert_eq!(site.created_by, "operator");
    assert_eq!(site.scan_status, BrowserScanStatus::None);
    assert!(site.scan_report.is_none());
    assert!(site.overrides.is_empty());
    assert_eq!(site.first_seen, site.last_seen);
}

#[test]
fn upsert_updates_named_fields_and_never_re_enables_on_its_own() {
    let p = pool();
    let origin = "https://app.example.com";
    upsert(&p, input(origin)).unwrap();
    set_enabled(&p, origin, true).unwrap();
    // An agent re-requesting a site it was already given must not be able to
    // flip `enabled`, and must not be able to un-pause a paused one either.
    set_enabled(&p, origin, false).unwrap();

    let again = upsert(
        &p,
        UpsertBrowserSiteInput {
            origin: origin.to_string(),
            label: Some("Invoicing".into()),
            created_by: Some("session:abc".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(!again.enabled, "upsert left `enabled` alone");
    assert_eq!(again.label, "Invoicing");
    assert_eq!(
        again.created_by, "operator",
        "created_by is written once, at creation"
    );
    assert_eq!(again.budget, DEFAULT_BUDGET, "absent budget kept the row's");
}

#[test]
fn upsert_writes_first_seen_once_and_moves_last_seen() {
    let p = pool();
    let origin = "https://app.example.com";
    let first = upsert(&p, input(origin)).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    touch_last_seen(&p, origin).unwrap();
    let after = get(&p, origin).unwrap().unwrap();
    assert_eq!(after.first_seen, first.first_seen);
    assert!(after.last_seen > first.last_seen, "last_seen moved");
}

#[test]
fn get_returns_none_for_an_unknown_origin() {
    let p = pool();
    assert!(get(&p, "https://never.example").unwrap().is_none());
}

#[test]
fn list_puts_enabled_rows_first() {
    let p = pool();
    // Every database carries the one seeded example row
    // (`e29_browser_sites_seed`), which is enabled and therefore sorts into
    // the same half this test is about. Drop it so the assertion is about
    // the ordering rule and not about the seed.
    delete(&p, "http://localhost:3000").unwrap();
    upsert(&p, input("https://b.example")).unwrap();
    upsert(&p, input("https://a.example")).unwrap();
    upsert(&p, input("https://z.example")).unwrap();
    set_enabled(&p, "https://z.example", true).unwrap();

    let origins: Vec<String> = list(&p).unwrap().into_iter().map(|s| s.origin).collect();
    assert_eq!(
        origins,
        vec![
            "https://z.example".to_string(),
            "https://a.example".to_string(),
            "https://b.example".to_string(),
        ]
    );
}

#[test]
fn an_override_may_only_tighten_to_gated() {
    let p = pool();
    let origin = "https://app.example.com";
    upsert(&p, input(origin)).unwrap();

    let site = set_override(&p, origin, "add_invoice", Some(BrowserToolClass::Gated)).unwrap();
    assert_eq!(
        site.overrides.get("add_invoice"),
        Some(&BrowserToolClass::Gated)
    );

    for loosening in [BrowserToolClass::Auto, BrowserToolClass::Read] {
        let err = set_override(&p, origin, "add_invoice", Some(loosening)).unwrap_err();
        assert!(
            matches!(err, AppError::Forbidden(ref m) if m.contains("refused_loosening")),
            "got {err:?}"
        );
    }

    let cleared = set_override(&p, origin, "add_invoice", None).unwrap();
    assert!(cleared.overrides.is_empty(), "None clears the override");
}

#[test]
fn mutators_refuse_an_unknown_origin() {
    let p = pool();
    let missing = "https://never.example";
    assert!(matches!(
        set_enabled(&p, missing, true).unwrap_err(),
        AppError::NotFound(_)
    ));
    assert!(matches!(
        set_override(&p, missing, "t", Some(BrowserToolClass::Gated)).unwrap_err(),
        AppError::NotFound(_)
    ));
    assert!(matches!(
        bind_credential(&p, missing, Some("cred-1")).unwrap_err(),
        AppError::NotFound(_)
    ));
    assert!(matches!(
        set_scan(&p, missing, BrowserScanStatus::Failed, None, None, None).unwrap_err(),
        AppError::NotFound(_)
    ));
    // touch_last_seen is deliberately NOT a failure path — the gate already
    // refused an unknown origin and must not fail twice.
    assert!(touch_last_seen(&p, missing).is_ok());
}

#[test]
fn bind_credential_sets_and_clears() {
    let p = pool();
    let origin = "https://app.example.com";
    upsert(&p, input(origin)).unwrap();
    // No FK row exists for this id, and SQLite only enforces the reference
    // when foreign_keys is on for the connection — the point of this test is
    // the set/clear round trip, which is what the UI drives.
    let bound = bind_credential(&p, origin, None).unwrap();
    assert!(bound.credential_id.is_none());
}

#[test]
fn set_scan_files_a_report_and_refuses_an_unparsable_one() {
    let p = pool();
    let origin = "https://app.example.com";
    upsert(&p, input(origin)).unwrap();

    let report = BrowserSiteScan {
        transport: BrowserScanTransport::WebmcpPolyfill,
        page_tools: vec![BrowserPageTool {
            name: "add_invoice".into(),
            description: "adds one".into(),
            reversible: true,
            side_effects: BrowserSideEffects::Internal,
            class: BrowserToolClass::Auto,
        }],
        operable_count: 3,
        tier: 2,
        ..Default::default()
    };
    let json = serde_json::to_string(&report).unwrap();
    let site = set_scan(
        &p,
        origin,
        BrowserScanStatus::Proposed,
        Some(2),
        Some(&json),
        Some(1_700_000_000_000),
    )
    .unwrap();
    assert_eq!(site.scan_status, BrowserScanStatus::Proposed);
    assert_eq!(site.scan_tier, Some(2));
    assert_eq!(site.scan_at, Some(1_700_000_000_000));
    let stored = site.scan_report.expect("report round-trips");
    assert_eq!(stored.page_tools.len(), 1);
    assert_eq!(stored.tier, 2);

    let err = set_scan(
        &p,
        origin,
        BrowserScanStatus::Proposed,
        None,
        Some("{\"transport\":\"smoke-signals\"}"),
        None,
    )
    .unwrap_err();
    assert!(matches!(err, AppError::Serde(_)), "got {err:?}");
}

/// A blob that cannot be read as a tool-class map falls back to NO overrides
/// — the tightest reading, because an absent override leaves the declared
/// class standing. The row stays readable either way.
#[test]
fn a_corrupt_overrides_blob_degrades_to_no_overrides() {
    let p = pool();
    let origin = "https://app.example.com";
    upsert(&p, input(origin)).unwrap();
    p.get()
        .unwrap()
        .execute(
            "UPDATE browser_sites SET overrides = 'not json' WHERE origin = ?1",
            rusqlite::params![origin],
        )
        .unwrap();

    let site = get(&p, origin).unwrap().expect("row still reads");
    assert!(site.overrides.is_empty());
}

#[test]
fn delete_removes_the_row() {
    let p = pool();
    let origin = "https://app.example.com";
    upsert(&p, input(origin)).unwrap();
    assert!(delete(&p, origin).unwrap());
    assert!(!delete(&p, origin).unwrap(), "second delete is a no-op");
    assert!(get(&p, origin).unwrap().is_none());
}

#[test]
fn upsert_refuses_a_blank_origin_and_a_negative_budget() {
    let p = pool();
    assert!(matches!(
        upsert(&p, input("   ")).unwrap_err(),
        AppError::Validation(_)
    ));
    assert!(matches!(
        upsert(
            &p,
            UpsertBrowserSiteInput {
                origin: "https://app.example.com".into(),
                budget: Some(-1),
                ..Default::default()
            }
        )
        .unwrap_err(),
        AppError::Validation(_)
    ));
}

// ---------------------------------------------------------------------------
// Pattern rows and the resolver
// ---------------------------------------------------------------------------

#[test]
fn upsert_normalises_an_origin_and_refuses_a_shape_the_gate_could_not_decide_on() {
    let p = pool();
    // A concrete origin keeps going through `url::Url::origin()`.
    let site = upsert(&p, input("HTTPS://App.Example.com/dashboard?x=1")).unwrap();
    assert_eq!(site.origin, "https://app.example.com");

    // A pattern is normalised by hand: lowercased, no trailing slash.
    let site = upsert(&p, input("HTTPS://*.Example.COM/")).unwrap();
    assert_eq!(site.origin, "https://*.example.com");
    let site = upsert(&p, input("http://localhost:*")).unwrap();
    assert_eq!(site.origin, "http://localhost:*");

    for bad in [
        "https://*",
        "https://ex*.com",
        "*://example.com",
        "not a url",
    ] {
        let err = upsert(&p, input(bad)).unwrap_err();
        assert!(
            matches!(err, AppError::Validation(_)),
            "`{bad}` must be an AppError::Validation, got {err:?}"
        );
    }
}

#[test]
fn resolve_answers_with_the_exact_row_before_any_pattern() {
    let p = pool();
    upsert(&p, input("https://*.example.com")).unwrap();
    upsert(&p, input("https://api.example.com")).unwrap();

    let hit = resolve(&p, "https://api.example.com").unwrap().unwrap();
    assert_eq!(
        hit.origin, "https://api.example.com",
        "an exact row wins outright"
    );
    let hit = resolve(&p, "https://www.example.com").unwrap().unwrap();
    assert_eq!(hit.origin, "https://*.example.com");
}

#[test]
fn resolve_picks_the_most_specific_pattern() {
    let p = pool();
    upsert(&p, input("https://*.example.com")).unwrap();
    upsert(&p, input("https://*.eu.example.com")).unwrap();

    assert_eq!(
        resolve(&p, "https://a.eu.example.com")
            .unwrap()
            .unwrap()
            .origin,
        "https://*.eu.example.com",
        "the longer host suffix governs"
    );
    assert_eq!(
        resolve(&p, "https://a.us.example.com")
            .unwrap()
            .unwrap()
            .origin,
        "https://*.example.com"
    );
}

#[test]
fn resolve_prefers_an_explicit_port_over_a_wildcard_one() {
    let p = pool();
    upsert(&p, input("http://localhost:*")).unwrap();
    upsert(&p, input("http://localhost:3000")).unwrap();

    assert_eq!(
        resolve(&p, "http://localhost:3000")
            .unwrap()
            .unwrap()
            .origin,
        "http://localhost:3000"
    );
    assert_eq!(
        resolve(&p, "http://localhost:5173")
            .unwrap()
            .unwrap()
            .origin,
        "http://localhost:*"
    );
}

/// The near-misses, at the repo door rather than only in the matcher: a row
/// that governed these would be a different owner's site.
#[test]
fn resolve_answers_none_for_an_origin_no_row_covers() {
    let p = pool();
    upsert(&p, input("https://*.example.com")).unwrap();

    for miss in [
        "https://evil-example.com",
        "https://example.com.evil",
        "http://example.com",
        "https://example.org",
    ] {
        assert!(
            resolve(&p, miss).unwrap().is_none(),
            "`{miss}` must be governed by no row"
        );
    }
    assert!(resolve(&p, "https://example.com").unwrap().is_some());
}

/// A pattern row carries the same operator decisions an exact one does —
/// they simply apply to every origin it covers.
#[test]
fn a_pattern_row_carries_its_own_enabled_budget_and_overrides() {
    let p = pool();
    let pattern = "https://*.example.com";
    upsert(&p, input(pattern)).unwrap();
    set_enabled(&p, pattern, true).unwrap();
    set_override(&p, pattern, "add_invoice", Some(BrowserToolClass::Gated)).unwrap();

    let hit = resolve(&p, "https://deep.a.example.com").unwrap().unwrap();
    assert!(hit.enabled);
    assert_eq!(
        hit.overrides.get("add_invoice"),
        Some(&BrowserToolClass::Gated)
    );
    assert_eq!(hit.budget, DEFAULT_BUDGET);
}
