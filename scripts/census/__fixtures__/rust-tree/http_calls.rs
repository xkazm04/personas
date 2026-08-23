//! Census self-test fixture — the `fx-adhoc-http` twin of `adhoc-http-client`.
//!
//! EVERY count here is asserted exactly by `rules.fixture.json`'s baseline, which
//! `self-test.mjs` runs under `--check`. Editing this file without updating that
//! baseline fails the self-test, which is the point.
//!
//! This doc block names reqwest::Client::new() and Client::builder() deliberately:
//! a comment-only line must never count as a violation.

use personas_core::http_clients::SHARED_HTTP;

// --- POSITIVES (3) ---------------------------------------------------------

pub async fn adhoc_bare() -> reqwest::Client {
    reqwest::Client::new()
}

pub async fn adhoc_builder() -> reqwest::Client {
    reqwest::Client::builder().build().unwrap()
}

pub async fn adhoc_imported_builder() -> Client {
    Client::builder().timeout(TIMEOUT).build().unwrap()
}

// --- NEGATIVES -------------------------------------------------------------
// A DIFFERENT type whose name merely ENDS in `Client`. The lookbehind is what
// keeps this out; without it the rule reads any `*Client::new()` as a violation.
pub fn vendor_sdk() -> ZapierClient {
    ZapierClient::new()
}

pub fn namespaced_other() -> zapier::ZapierClient {
    zapier::ZapierClient::new()
}

/// The compliant form: reuse the process-wide pool instead of building one.
pub async fn compliant() -> reqwest::Response {
    SHARED_HTTP.get("https://example.invalid/").send().await.unwrap()
}
