//! Curated, per-project MCP connectors for build turns (C8). The user toggles
//! these in Studio; enabled ones are written into a temp mcp-config that the
//! build turn's CLI spawn loads via `--mcp-config`. Each is a small npx package.

/// `(command, args)` for each curated connector id we expose.
fn entry(id: &str) -> Option<(&'static str, &'static [&'static str])> {
    match id {
        // Up-to-date, version-correct library / framework docs.
        "context7" => Some(("npx", &["-y", "@upstash/context7-mcp"])),
        // Drive a real browser to check the rendered page.
        "playwright" => Some(("npx", &["-y", "@playwright/mcp@latest"])),
        _ => None,
    }
}

/// Build a Claude Code mcp-config (`{"mcpServers": {...}}`) for the enabled ids.
/// Returns `None` when nothing is enabled / recognized.
pub fn build_config(enabled: &[String]) -> Option<serde_json::Value> {
    let servers: Vec<_> = enabled
        .iter()
        .filter_map(|id| {
            entry(id).map(|(cmd, args)| {
                (
                    id.clone(),
                    personas_core::mcp_config::McpServer::stdio(cmd, args.iter().copied()),
                )
            })
        })
        .collect();
    if servers.is_empty() {
        None
    } else {
        Some(personas_core::mcp_config::mcp_config_json(servers))
    }
}
