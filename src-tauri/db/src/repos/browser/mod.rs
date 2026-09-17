//! Browser-control repositories (spark `browser-control`).
//!
//! One table today — the Whitelist. It lives in its own family rather than
//! under `resources`/`core` because the gate reads it on every navigation
//! and the scan writes it from a different lane; a shared module would put
//! two very different access patterns behind one door.

/// `browser_sites` — the deny-by-default origin whitelist.
pub mod sites;
