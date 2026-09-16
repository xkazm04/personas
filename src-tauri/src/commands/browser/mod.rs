//! Browser control commands (spark browser-control, 2026-09-15).
//!
//! - [`sites`] — the Whitelist: `browser_sites` CRUD, overrides, credential
//!   binding, the controllability scan (WP1 / WP3).
//! - [`webview`] — the embedded multi-webview host: tabs, navigation,
//!   viewport, leases (WP2).
//!
//! Registration in `lib.rs`'s `invoke_handler` is done by the Director after
//! each package lands; builders add commands here and do not edit `lib.rs`.

pub mod scan_prompt;
pub mod sites;
pub mod webview;

/// The `mcpServers` block that points a CLI turn at this app's browser bridge
/// under `token`.
///
/// **One construction, two callers** (the controllability scan in [`sites`],
/// and the runner when a persona binds the `browser` connector), built from
/// the shared typed model `personas_core::mcp_config` rather than a `json!`
/// literal — the module that exists because eight sites had drifted into five
/// spellings of the same object. `browser_bridge::build_browser_mcp_config`
/// makes the same two calls for the browser-TEST lane; it cannot be reused
/// directly because it resolves the PINNED session itself and writes its own
/// temp file, and neither caller here wants either.
///
/// `None` when the local HTTP server is not up — which is not an error, it is
/// "there is no bridge to point at", and both callers degrade rather than
/// fail.
pub(crate) fn bridge_mcp_config_json(token: &str) -> Option<serde_json::Value> {
    let port = crate::local_http::port()?;
    serde_json::to_value(personas_core::mcp_config::mcp_config_json([(
        "browser",
        personas_core::mcp_config::McpServer::http(format!(
            "http://127.0.0.1:{port}/browser-bridge/mcp"
        ))
        .with_header(
            crate::browser_bridge::mcp::SESSION_HEADER,
            token.to_string(),
        ),
    )]))
    .ok()
}
