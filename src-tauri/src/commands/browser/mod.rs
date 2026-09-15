//! Browser control commands (spark browser-control, 2026-09-15).
//!
//! - [`sites`]   — the Whitelist: `browser_sites` CRUD, overrides, credential
//!                 binding, the controllability scan (WP1 / WP3).
//! - [`webview`] — the embedded multi-webview host: tabs, navigation,
//!                 viewport, leases (WP2).
//!
//! Registration in `lib.rs`'s `invoke_handler` is done by the Director after
//! each package lands; builders add commands here and do not edit `lib.rs`.

pub mod sites;
pub mod webview;
